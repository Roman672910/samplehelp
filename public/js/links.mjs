// ============================================================
// links.mjs — типизированные ссылки в ответах.
// Формат в БД (answers.links, jsonb):
//   [{ url, kind, label? }]
//   kind: '' | 'video' | 'article' | 'docs' | 'preset' | 'other'
//   label — своя пометка, только когда kind === 'other'
// Старый формат (массив голых строк ["https://…", …]) конвертируется
// на лету через normalizeLinks() — миграция БД не нужна.
// Виджет формы (строка = URL + тип + ✕, максимум 3) используется
// и в форме ответа, и в форме правки ответа.
// ============================================================

import { t } from './i18n.mjs';
import { escapeHtml } from './utils.mjs';
import { detectPlatform, platformIcon } from './profile.mjs';

/** Максимум ссылок в одном ответе */
export const MAX_ANSWER_LINKS = 3;

/** Допустимые виды ссылок ('' — без пометки, 'other' — своя пометка в label) */
export const LINK_KINDS = ['', 'video', 'article', 'docs', 'preset', 'other'];

// Доменные списки для автоопределения вида (совпадение с доменом
// или любым поддоменом: «music.youtube.com» → youtube.com → video)
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'tiktok.com', 'rutube.ru'];
const ARTICLE_HOSTS = ['habr.com', 'medium.com', 'substack.com', 'dev.to'];
const DOCS_HOSTS = ['ableton.com', 'image-line.com', 'xferrecords.com', 'kilohearts.com', 'vital.audio', 'u-he.com', 'native-instruments.com', 'steinberg.net'];
const PRESET_HOSTS = ['github.com', 'splice.com', 'gumroad.com', 'patreon.com', 'boosty.to'];

/** Домен из URL без www. (пустая строка, если URL невалиден) */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** Ссылка валидна, если это http(s)-URL (javascript:, ftp: и мусор — нет) */
export function isValidLinkUrl(url) {
  try {
    const u = new URL(String(url).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/**
 * Автоопределение вида ссылки по домену.
 * Неизвестный домен → null («без пометки»).
 */
export function detectLinkKind(url) {
  const host = hostOf(url);
  if (!host) return null;
  const inList = (list) => list.some((d) => host === d || host.endsWith(`.${d}`));
  if (inList(VIDEO_HOSTS)) return 'video';
  if (inList(ARTICLE_HOSTS)) return 'article';
  if (inList(DOCS_HOSTS) || host.startsWith('docs.') || host.startsWith('help.') || host.startsWith('manual.')) return 'docs';
  if (inList(PRESET_HOSTS)) return 'preset';
  return null;
}

/**
 * Приведение ссылок ответа к единому формату [{ url, kind, label? }].
 * Принимает и старый формат (голые строки — вид определяется по домену),
 * и новый. Мусор отбрасывается, список ограничивается MAX_ANSWER_LINKS.
 */
export function normalizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (out.length >= MAX_ANSWER_LINKS) break;
    const isStr = typeof item === 'string';
    const url = (isStr ? item : String(item?.url || '')).trim();
    if (!url) continue;
    let kind = isStr ? '' : String(item?.kind || '');
    if (!LINK_KINDS.includes(kind)) kind = '';
    if (isStr) kind = detectLinkKind(url) || '';
    const entry = { url, kind };
    if (kind === 'other' && typeof item?.label === 'string' && item.label.trim()) {
      entry.label = item.label.trim().slice(0, 60);
    }
    out.push(entry);
  }
  return out;
}

/** Человекочитаемая пометка вида: своя label для 'other', иначе перевод */
export function linkKindTitle(link) {
  if (link.kind === 'other') return link.label?.trim() || t('links.kind_other_plain');
  if (link.kind) return t(`links.kind_${link.kind}`);
  return t('links.generic');
}

/**
 * Чип ссылки для карточки ответа:
 * [иконка платформы] Видео-туториал · youtube.com
 * Для нераспознанного домена вместо логотипа — эмодзи вида.
 */
export function linkChipHtml(link) {
  const KIND_EMOJI = { video: '🎬', article: '📄', docs: '📘', preset: '🎛️', other: '🔗' };
  const platform = detectPlatform(link.url);
  const known = platform && platform !== 'link';
  const icon = known
    ? platformIcon(platform, link.url, 14)
    : `<span aria-hidden="true">${KIND_EMOJI[link.kind] || '🔗'}</span>`;
  const domain = hostOf(link.url) || link.url;
  return `<a class="link-chip" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.url)}">${icon}<span class="link-kind">${escapeHtml(linkKindTitle(link))}</span><span class="link-domain">· ${escapeHtml(domain)}</span></a>`;
}

/**
 * Виджет «ссылки ответа»: строки [иконка][URL][тип][✕] + «＋ Добавить ссылку».
 * • вид подставляется автоматически по домену, пока пользователь не выбрал
 *   тип вручную (флаг touched — автоопределение его не перебивает)
 * • максимум `max` строк, счётчик «N из 3», подсказка при заполнении
 * • validate() подсвечивает невалидные/дублирующиеся URL и возвращает
 *   { ok, message } — сообщение для тоста
 * • getValue() — готовые [{ url, kind, label? }], пустые строки игнорируются
 *
 * @param {HTMLElement} mount — контейнер для виджета
 * @param {{ links?: Array, max?: number }} opts
 */
export function createLinksWidget(mount, { links = [], max = MAX_ANSWER_LINKS } = {}) {
  mount.innerHTML = `
    <div class="links-widget">
      <div class="link-rows"></div>
      <div class="links-add-row">
        <button type="button" class="btn btn-ghost btn-sm links-add">＋ ${escapeHtml(t('links.add'))}</button>
        <span class="links-counter" aria-live="polite"></span>
      </div>
      <div class="hint links-max-hint" hidden>${escapeHtml(t('links.max_hint', { max }))}</div>
      <div class="links-error" role="alert" hidden></div>
    </div>`;

  const rowsEl = mount.querySelector('.link-rows');
  const addBtn = mount.querySelector('.links-add');
  const counterEl = mount.querySelector('.links-counter');
  const maxHint = mount.querySelector('.links-max-hint');
  const errorEl = mount.querySelector('.links-error');

  const allRows = () => [...rowsEl.querySelectorAll('.link-row')];

  function refresh() {
    const n = allRows().length;
    counterEl.textContent = t('links.count', { n, max });
    addBtn.disabled = n >= max;
    maxHint.hidden = n < max;
  }

  function addRow(link = {}) {
    if (allRows().length >= max) return null;
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `
      <span class="link-row-icon" aria-hidden="true"></span>
      <input type="url" class="link-url" value="${escapeHtml(link.url || '')}"
        placeholder="${escapeHtml(t('links.url_ph'))}" aria-label="${escapeHtml(t('links.url_label'))}"
        autocomplete="off" spellcheck="false">
      <select class="link-kind" aria-label="${escapeHtml(t('links.kind_label'))}">
        <option value="">${escapeHtml(t('links.generic'))}</option>
        <option value="video">${escapeHtml(t('links.kind_video'))}</option>
        <option value="article">${escapeHtml(t('links.kind_article'))}</option>
        <option value="docs">${escapeHtml(t('links.kind_docs'))}</option>
        <option value="preset">${escapeHtml(t('links.kind_preset'))}</option>
        <option value="other">${escapeHtml(t('links.kind_other'))}</option>
      </select>
      <input type="text" class="link-custom" placeholder="${escapeHtml(t('links.custom_ph'))}"
        aria-label="${escapeHtml(t('links.custom_ph'))}" maxlength="60" hidden>
      <button type="button" class="icon-btn-sm danger link-del" title="${escapeHtml(t('links.remove'))}" aria-label="${escapeHtml(t('links.remove'))}">✕</button>`;
    rowsEl.appendChild(row);

    const input = row.querySelector('.link-url');
    const sel = row.querySelector('.link-kind');
    const custom = row.querySelector('.link-custom');
    const icon = row.querySelector('.link-row-icon');

    // Явно выбранный вид из данных считаем «ручным» — не перебиваем автодетектом
    if (link.kind) { row.dataset.touched = 'true'; sel.value = link.kind; }
    if (link.label) custom.value = link.label;

    const updateIcon = () => {
      const platform = detectPlatform(input.value.trim());
      icon.innerHTML = platform && platform !== 'link' ? platformIcon(platform, input.value.trim(), 14) : '';
    };
    const syncCustom = () => { custom.hidden = sel.value !== 'other'; };

    input.addEventListener('input', () => {
      row.classList.remove('invalid');
      updateIcon();
      if (row.dataset.touched !== 'true') {
        sel.value = detectLinkKind(input.value.trim()) || '';
      }
      syncCustom();
    });
    sel.addEventListener('change', () => {
      row.dataset.touched = 'true';
      syncCustom();
    });
    row.querySelector('.link-del').addEventListener('click', () => {
      row.remove();
      refresh();
    });

    updateIcon();
    syncCustom();
    refresh();
    return row;
  }

  function clearErrors() {
    errorEl.hidden = true;
    errorEl.textContent = '';
    allRows().forEach((r) => r.classList.remove('invalid'));
  }

  /** Проверка всех строк: http(s) + без дубликатов. Пустые строки пропускаем. */
  function validate() {
    clearErrors();
    const seen = new Set();
    let firstBad = null;
    let message = '';
    for (const row of allRows()) {
      const input = row.querySelector('.link-url');
      const url = input.value.trim();
      if (!url) continue;
      let err = '';
      if (!isValidLinkUrl(url)) err = t('links.invalid');
      else {
        const key = url.toLowerCase().replace(/\/+$/, '');
        if (seen.has(key)) err = t('links.duplicate');
        else seen.add(key);
      }
      if (err) {
        row.classList.add('invalid');
        input.setAttribute('aria-invalid', 'true');
        if (!firstBad) { firstBad = input; message = err; }
      } else {
        input.removeAttribute('aria-invalid');
      }
    }
    if (firstBad) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      firstBad.focus();
      return { ok: false, message };
    }
    return { ok: true, message: '' };
  }

  /** Готовые данные для отправки: [{ url, kind, label? }], пустые строки игнорируются */
  function getValue() {
    const out = [];
    for (const row of allRows()) {
      const url = row.querySelector('.link-url').value.trim();
      if (!url) continue;
      const kind = row.querySelector('.link-kind').value;
      const entry = { url, kind };
      if (kind === 'other') {
        const label = row.querySelector('.link-custom').value.trim();
        if (label) entry.label = label.slice(0, 60);
      }
      out.push(entry);
    }
    return out;
  }

  addBtn.addEventListener('click', () => {
    const row = addRow();
    row?.querySelector('.link-url').focus();
  });

  // Стартовые строки: из данных или одна пустая (для пустой формы)
  const initial = normalizeLinks(links);
  if (initial.length) initial.forEach((l) => addRow(l));
  else addRow();

  return { addRow, getValue, validate, clearErrors, refresh, rows: allRows, el: mount.firstElementChild };
}