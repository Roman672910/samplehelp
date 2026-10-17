// ============================================================
// subscriptions.mjs — подписки на авторов и на теги.
// Подписка на автора даёт уведомления о его активности,
// подписка на тег — о новых вопросах с этим тегом (генератор —
// в createQuestion, тип уведомления 'new_question_tag').
//
// Заход B (2026-10-13): теги стали кликабельными там, где живут —
// чип #тега в карточке ответа (question.mjs) и тег синтезатора
// в карточке вопроса ленты (feed.mjs). Состояние «подписан» чипы
// берут из кэша store.subscriptions; экраны после рендера вызывают
// refreshTagSubsCache(), чтобы подтянуть свежее состояние из БД.
// ============================================================

import { t, applyTranslations } from './i18n.mjs';
import { fetchSubscriptions, toggleSubscription } from './api.mjs';
import { getState, setState } from './store.mjs';
import { escapeHtml, toast } from './utils.mjs';
import { requireAuth } from './auth.mjs';

// Контейнер сайдбар-блока «Подписки» (профиль). После переключения
// подписки на тег в другом месте экрана блок перерисовывается на месте,
// если всё ещё в DOM (роутер при уходе заменяет контейнер — isConnected гаснет).
let subsBlockHost = null;

/** Подписан ли текущий пользователь на тег — по кэшу store (синхронно, для рендера чипов) */
export function isTagSubscribedCached(tagName) {
  const { user, subscriptions } = getState();
  if (!user) return false;
  return (subscriptions || []).some((s) => s.target_type === 'tag' && s.target_id === tagName);
}

/**
 * Чип подписки на тег для встраивания в карточки: #теги ответов
 * (answerCardHtml в question.mjs) и тег синтезатора вопроса (feed.mjs).
 * Начальное состояние — из кэша store; после рендера экран зовёт
 * refreshTagSubsCache(). Пустое имя — пустая строка (чипа нет).
 */
export function tagSubChipHtml(tagName) {
  const name = String(tagName || '').trim();
  if (!name) return '';
  const subbed = isTagSubscribedCached(name);
  const label = subbed ? t('common.tag_subscribed') : t('common.tag_subscribe');
  return `<button type="button" class="tag tag-sub${subbed ? ' subbed' : ''}" data-sub-tag="${escapeHtml(name)}" data-help="tag_subscribe" aria-pressed="${subbed}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${subbed ? '✓ ' : ''}#${escapeHtml(name)}</button>`;
}

/** Привести все чипы [data-sub-tag] в scope в соответствие с кэшем store */
export function syncTagChips(scope = document) {
  scope?.querySelectorAll?.('[data-sub-tag]').forEach((chip) => {
    const tag = chip.dataset.subTag;
    const subbed = isTagSubscribedCached(tag);
    const label = subbed ? t('common.tag_subscribed') : t('common.tag_subscribe');
    chip.classList.toggle('subbed', subbed);
    chip.setAttribute('aria-pressed', String(subbed));
    chip.title = label;
    chip.setAttribute('aria-label', label);
    chip.textContent = `${subbed ? '✓ ' : ''}#${tag}`;
  });
}

/**
 * Подтянуть свежие подписки в кэш store и перерисовать чипы.
 * Вызывается экранами после рендера (лента, страница вопроса) —
 * чипы не дёргают БД на каждую карточку, один запрос на экран.
 */
export async function refreshTagSubsCache(scope = document) {
  if (getState().user) {
    try {
      const subs = await fetchSubscriptions();
      setState({ subscriptions: subs });
    } catch (e) {
      console.error('[subscriptions] cache refresh:', e);
    }
  }
  syncTagChips(scope);
}

/** Переключить подписку на тег; возвращает новое состояние */
export async function toggleTagSubscription(tagName) {
  if (!requireAuth()) return false;
  const nowSub = await toggleSubscription('tag', tagName);
  const subs = await fetchSubscriptions();
  setState({ subscriptions: subs });
  toast(nowSub ? `${t('subscriptions.subscribed_tag')} #${tagName}` : t('subscriptions.unsubscribed'));
  // Один тег может быть на нескольких карточках экрана (синтезатор вопроса
  // и тег ответа) — синхронизируем все чипы сразу
  syncTagChips();
  // Сайдбар-блок «Подписки» (профиль), если открыт — перерисовать на месте
  if (subsBlockHost?.isConnected) void renderSubscriptionsBlock(subsBlockHost);
  return nowSub;
}

/**
 * Делегирование кликов по чипам подписки. Вешается ОДИН раз при старте
 * (main.mjs → initTagSubscriptions): чипы рендерят разные модули
 * (question.mjs, feed.mjs — включая раскрытые ответы ленты), поэтому
 * обработчик общий. Capture-фаза на document: stopPropagation срабатывает
 * РАНЬШЕ собственных обработчиков карточек (раскрытие ленты, мини-плеер) —
 * клик по тегу не должен их запускать. В режиме справки клики принадлежат
 * help.mjs (поповер вместо действия) — не вмешиваемся.
 */
let tagClicksBound = false;
export function initTagSubscriptions() {
  if (tagClicksBound) return;
  tagClicksBound = true;
  document.addEventListener('click', (e) => {
    const chip = e.target.closest?.('[data-sub-tag]');
    if (!chip) return;
    if (document.body.classList.contains('help-active')) return;
    e.preventDefault();
    e.stopPropagation();
    void toggleTagSubscription(chip.dataset.subTag);
  }, true);
}

/**
 * Блок управления подписками (используется в профиле).
 * @param {HTMLElement} container
 */
export async function renderSubscriptionsBlock(container) {
  subsBlockHost = container;
  const subs = await fetchSubscriptions();
  const tags = subs.filter((s) => s.target_type === 'tag');
  const authors = subs.filter((s) => s.target_type === 'author');

  container.innerHTML = `
    <div class="card sidebar-block" style="cursor:default">
      <h3>${escapeHtml(t('subscriptions.title'))}</h3>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escapeHtml(t('subscriptions.tags'))}</div>
      <div class="tags-row" id="sub-tags">
        ${tags.length ? tags.map((s) => `<span class="chip">#${escapeHtml(s.target_id)} <button type="button" data-unsub-tag="${escapeHtml(s.target_id)}" aria-label="${escapeHtml(t('subscriptions.unsubscribe'))}">&times;</button></span>`).join('')
          : `<span style="font-size:12.5px;color:var(--text-muted)">${escapeHtml(t('subscriptions.no_tags'))}</span>`}
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin:14px 0 8px">${escapeHtml(t('subscriptions.authors'))}</div>
      <div id="sub-authors">
        ${authors.length ? authors.map((s) => `
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
            <a href="/profile/${escapeHtml(s.target_id)}" data-route style="font-size:13px">@${escapeHtml(authorName(s.target_id))}</a>
            <button type="button" data-unsub-author="${escapeHtml(s.target_id)}" class="btn btn-quiet btn-sm" style="margin-left:auto;padding:2px 8px">✕</button>
          </div>`).join('')
          : `<span style="font-size:12.5px;color:var(--text-muted)">${escapeHtml(t('subscriptions.no_authors'))}</span>`}
      </div>
    </div>`;
  applyTranslations(container);

  // Отписки (делегирование) — обработчик вешаем ОДИН раз на контейнер:
  // блок перерисовывается многократно, а дубли слушателей приводили
  // к двойному срабатыванию (отписка тут же отменялась)
  if (!container._subsBound) {
    container._subsBound = true;
    container.addEventListener('click', async (e) => {
      const tagBtn = e.target.closest('[data-unsub-tag]');
      const authorBtn = e.target.closest('[data-unsub-author]');
      if (tagBtn) {
        await toggleSubscription('tag', tagBtn.dataset.unsubTag);
        // Кэш store и чипы на экране держим в согласии с отпиской
        setState({ subscriptions: await fetchSubscriptions() });
        syncTagChips();
        toast(t('subscriptions.unsubscribed'));
        renderSubscriptionsBlock(container);
      }
      if (authorBtn) {
        await toggleSubscription('author', authorBtn.dataset.unsubAuthor);
        setState({ subscriptions: await fetchSubscriptions() });
        toast(t('subscriptions.unsubscribed'));
        renderSubscriptionsBlock(container);
      }
    });
  }
}

function authorName(id) {
  // Простая подстановка имени для демо; в реальном режиме — из кэша профилей
  const names = { 'u-anna': 'AnnaSynth', 'u-max': 'MaxWavetable', 'u-lena': 'LenaFX' };
  return names[id] || id;
}
