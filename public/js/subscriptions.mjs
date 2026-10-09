// ============================================================
// subscriptions.mjs — подписки на авторов и на теги.
// Подписка на автора даёт уведомления о его активности,
// подписка на тег — о новых вопросах с этим тегом.
// ============================================================

import { t, applyTranslations } from './i18n.mjs';
import { fetchSubscriptions, toggleSubscription } from './supabase.mjs';
import { getState, setState } from './store.mjs';
import { escapeHtml, toast } from './utils.mjs';
import { requireAuth } from './auth.mjs';

/** Подписан ли текущий пользователь (по кэшу в store или свежей выборке) */
export async function isTagSubscribed(tagName) {
  const subs = await fetchSubscriptions();
  setState({ subscriptions: subs });
  return subs.some((s) => s.target_type === 'tag' && s.target_id === tagName);
}

/** Переключить подписку на тег; возвращает новое состояние */
export async function toggleTagSubscription(tagName) {
  if (!requireAuth()) return false;
  const nowSub = await toggleSubscription('tag', tagName);
  const subs = await fetchSubscriptions();
  setState({ subscriptions: subs });
  toast(nowSub ? `${t('subscriptions.subscribed_tag')} #${tagName}` : t('subscriptions.unsubscribed'));
  return nowSub;
}

/** Кнопка подписки на тег (для встраивания в карточки) */
export function tagSubscribeButtonHtml(tagName, subscribed) {
  return `<button type="button" class="toggle-chip" data-tag-sub="${escapeHtml(tagName)}" aria-pressed="${subscribed}">
    ${subscribed ? '✓' : '＋'} #${escapeHtml(tagName)}
  </button>`;
}

/**
 * Блок управления подписками (используется в профиле).
 * @param {HTMLElement} container
 */
export async function renderSubscriptionsBlock(container) {
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
        toast(t('subscriptions.unsubscribed'));
        renderSubscriptionsBlock(container);
      }
      if (authorBtn) {
        await toggleSubscription('author', authorBtn.dataset.unsubAuthor);
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

void getState;