// ============================================================
// help.mjs — контекстная справка «What's this?» + тур первого визита
// + статическая страница /help.
//
// Режим: кнопка «?» в шапке (за колокольчиком) блокирует функционал
// ВСЕХ элементов (перехват кликов/клавиш в capture-фазе на document —
// без disabled, интерфейс остаётся «живым»), а клик по любому элементу
// показывает поповер с описанием из каталога data-help + i18n (help.items.*).
// Элемент без data-help — фолбэк на ближайшего предка, иначе тост.
//
// Тур: те же поповеры, но по шагам (спотлайт + «назад/далее/пропустить»).
// Авто-тур при первом визите (флаг samplehelp_tour_seen в LocalStorage).
//
// Конвенция: каждый новый интерактивный элемент получает data-help="ключ"
// и пару help.items.<ключ>.title/desc во всех трёх локалях.
// ============================================================

import { t } from './i18n.mjs';
import { escapeHtml, toast } from './utils.mjs';
import { navigate } from './router.mjs';
import { subscribeTo } from './store.mjs';

const TOUR_SEEN_KEY = 'samplehelp_tour_seen';

let active = false;          // режим справки включён
let spotEl = null;           // рамка-спотлайт (fixed)
let popEl = null;            // поповер с описанием
let bannerEl = null;         // нижний баннер режима
let popTarget = null;        // элемент, к которому прижат поповер
let tourState = null;        // { steps, idx } когда идёт тур

// ------------------------------------------------------------
// UI-каркас (создаётся один раз)
// ------------------------------------------------------------

function ensureUi() {
  if (!spotEl) {
    spotEl = document.createElement('div');
    spotEl.className = 'help-spot help-ui';
    spotEl.hidden = true;
    document.body.appendChild(spotEl);
  }
  if (!popEl) {
    popEl = document.createElement('div');
    popEl.className = 'help-pop help-ui';
    popEl.setAttribute('role', 'dialog');
    popEl.setAttribute('aria-label', t('help.title'));
    popEl.hidden = true;
    document.body.appendChild(popEl);
  }
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'help-banner help-ui';
    bannerEl.hidden = true;
    document.body.appendChild(bannerEl);
  }
}

// ------------------------------------------------------------
// Позиционирование спотлайта и поповера
// ------------------------------------------------------------

function placeSpot(el) {
  const r = el.getBoundingClientRect();
  spotEl.hidden = false;
  spotEl.style.left = `${r.left - 4}px`;
  spotEl.style.top = `${r.top - 4}px`;
  spotEl.style.width = `${r.width + 8}px`;
  spotEl.style.height = `${r.height + 8}px`;
}

function placePop(el) {
  const r = el.getBoundingClientRect();
  popEl.hidden = false;
  // Сначала рендерим вне экрана, чтобы узнать размеры
  popEl.style.left = '-9999px';
  popEl.style.top = '0px';
  const pw = popEl.offsetWidth;
  const ph = popEl.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(10, Math.min(left, vw - pw - 10));
  let top = r.bottom + 12;
  if (top + ph > vh - 10) top = Math.max(10, r.top - ph - 12);
  popEl.style.left = `${Math.round(left)}px`;
  popEl.style.top = `${Math.round(top)}px`;
}

function reposition() {
  if (!popTarget || popEl.hidden) return;
  if (!document.contains(popTarget)) { hidePop(); return; }
  placeSpot(popTarget);
  placePop(popTarget);
}

function hidePop() {
  if (popEl) popEl.hidden = true;
  if (spotEl) spotEl.hidden = true;
  popTarget = null;
}

// ------------------------------------------------------------
// Помовер: описание элемента / шаг тура
// ------------------------------------------------------------

function showItemPop(el, { footer = '' } = {}) {
  const key = el.dataset?.help;
  const title = key ? t(`help.items.${key}.title`) : '';
  const desc = key ? t(`help.items.${key}.desc`) : '';
  popEl.innerHTML = `
    <div class="help-pop-title">❓ ${escapeHtml(title)}</div>
    <div class="help-pop-desc">${escapeHtml(desc)}</div>
    <div class="help-pop-foot">
      ${footer ? '' : `<span class="help-pop-hint">${escapeHtml(t('help.esc_hint'))}</span>`}
      ${footer}
      <button type="button" class="help-pop-close" aria-label="${escapeHtml(t('common.cancel'))}">✕</button>
    </div>`;
  popEl.querySelector('.help-pop-close').addEventListener('click', () => hidePop());
  popTarget = el;
  placeSpot(el);
  placePop(el);
}

// ------------------------------------------------------------
// Режим справки: перехват событий в capture-фазе
// ------------------------------------------------------------

/** Клики по собственному UI справки не блокируем */
function isHelpUi(target) {
  return target.closest?.('.help-ui') || target.closest?.('#btn-help-mode');
}

function blockPointer(e) {
  if (!active || isHelpUi(e.target)) return;
  e.stopPropagation();
  // preventDefault — только для мыши (гасим фокус/drag-start). У тач-указателей
  // не отнимаем дефолт, чтобы страницу можно было скроллить: тап всё равно
  // перехватывается позже, на фазе click.
  const fromTouch = e.pointerType === 'touch'
    || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
  if (!fromTouch) e.preventDefault();
}

function blockClick(e) {
  if (!active || isHelpUi(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  const holder = e.target.closest?.('[data-help]');
  if (holder) showItemPop(holder);
  else { hidePop(); toast(t('help.no_info'), 'info', 2500); }
}

function blockKey(e) {
  if (!active) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    stopHelpMode();
    return;
  }
  if (isHelpUi(e.target)) return;
  if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return; // навигация/копирование
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Enter' || e.key === ' ') {
    const holder = (document.activeElement || e.target)?.closest?.('[data-help]');
    if (holder) showItemPop(holder);
  }
}

function blockWheel(e) {
  if (!active || isHelpUi(e.target)) return;
  // Зум/скраб канвасов (триммер, вейвформы) — тоже функционал
  if (e.target.closest?.('canvas, .trimmer-wrap')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onScrollResize() { reposition(); }

function closeStrayPanels() {
  // Панель уведомлений и меню пользователя могли остаться открытыми —
  // их document-клик-закрылки в режиме справки не сработают
  const panel = document.getElementById('notif-panel');
  if (panel) panel.hidden = true;
  const menu = document.getElementById('user-menu');
  if (menu) menu.hidden = true;
}

export function isHelpMode() { return active; }

export function startHelpMode() {
  if (active) return;
  stopTour(); // тур и режим — взаимоисключающие
  active = true;
  ensureUi();
  closeStrayPanels();
  document.body.classList.add('help-active');
  document.addEventListener('pointerdown', blockPointer, true);
  document.addEventListener('mousedown', blockPointer, true);
  document.addEventListener('click', blockClick, true);
  document.addEventListener('keydown', blockKey, true);
  document.addEventListener('wheel', blockWheel, { capture: true, passive: false });
  window.addEventListener('scroll', onScrollResize, true);
  window.addEventListener('resize', onScrollResize);
  const btn = document.getElementById('btn-help-mode');
  btn?.setAttribute('aria-pressed', 'true');
  if (bannerEl) {
    bannerEl.hidden = false;
    bannerEl.innerHTML = `
      <span>💡 ${escapeHtml(t('help.mode_banner'))}</span>
      <button type="button" class="btn btn-ghost btn-sm" id="help-banner-exit">${escapeHtml(t('help.exit'))}</button>`;
    bannerEl.querySelector('#help-banner-exit').addEventListener('click', () => stopHelpMode());
  }
}

export function stopHelpMode() {
  if (!active) return;
  active = false;
  document.body.classList.remove('help-active');
  document.removeEventListener('pointerdown', blockPointer, true);
  document.removeEventListener('mousedown', blockPointer, true);
  document.removeEventListener('click', blockClick, true);
  document.removeEventListener('keydown', blockKey, true);
  document.removeEventListener('wheel', blockWheel, { capture: true });
  window.removeEventListener('scroll', onScrollResize, true);
  window.removeEventListener('resize', onScrollResize);
  document.getElementById('btn-help-mode')?.setAttribute('aria-pressed', 'false');
  if (bannerEl) bannerEl.hidden = true;
  hidePop();
}

// ------------------------------------------------------------
// Тур первого визита (тот же спотлайт + поповер, но по шагам)
// ------------------------------------------------------------

const TOUR_STEPS = [
  [{ sel: '.main-nav a[href="/"]', key: 'nav_feed' }],
  [{ sel: '#btn-ask', key: 'nav_ask' }, { sel: '#feed-ask', key: 'nav_ask' }],
  [{ sel: '.q-card', key: 'feed_card' }],
  [{ sel: '.q-card .mini-wave', key: 'feed_minplayer' }],
  [{ sel: '.p-dot', key: 'presence_dot' }],
  [{ sel: '#notif-bell:not([hidden])', key: 'nav_bell' }],
  [{ sel: '#btn-user-menu', key: 'nav_usermenu' }, { sel: '#btn-login', key: 'auth_login' }],
  [{ sel: '#btn-help-mode', key: 'nav_help' }],
];

function findStepTarget(step) {
  for (const c of step) {
    const el = document.querySelector(c.sel);
    if (el) { el.dataset.help = c.key; return el; }
  }
  return null;
}

function renderTourStep() {
  if (!tourState) return;
  // Пропускаем шаги, чьи элементы не найдены (гость/другая страница)
  while (tourState.idx < TOUR_STEPS.length) {
    const el = findStepTarget(TOUR_STEPS[tourState.idx]);
    if (el) { showTourPop(el); return; }
    tourState.idx++;
  }
  endTour();
}

function showTourPop(el) {
  const { idx } = tourState;
  const total = TOUR_STEPS.length;
  const key = el.dataset.help;
  const footer = `
    <span class="help-pop-step">${escapeHtml(t('help.tour_step', { n: idx + 1, total }))}</span>
    <span class="help-pop-btns">
      <button type="button" class="btn btn-ghost btn-sm" id="tour-skip">${escapeHtml(t('help.tour_skip'))}</button>
      ${idx > 0 ? `<button type="button" class="btn btn-ghost btn-sm" id="tour-prev">← ${escapeHtml(t('help.tour_prev'))}</button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" id="tour-next">${idx === total - 1 ? escapeHtml(t('help.tour_finish')) : `${escapeHtml(t('help.tour_next'))} →`}</button>
    </span>`;
  showItemPop(el, { footer });
  popEl.querySelector('#tour-skip')?.addEventListener('click', () => endTour());
  popEl.querySelector('#tour-prev')?.addEventListener('click', () => {
    if (!tourState) return;
    tourState.idx = Math.max(0, tourState.idx - 1);
    renderTourStep();
  });
  popEl.querySelector('#tour-next')?.addEventListener('click', () => {
    if (!tourState) return;
    tourState.idx++;
    if (tourState.idx >= TOUR_STEPS.length) endTour();
    else renderTourStep();
  });
}

export function startTour() {
  stopHelpMode();
  ensureUi();
  tourState = { idx: 0 };
  renderTourStep();
}

export function stopTour() {
  if (!tourState) return;
  tourState = null;
  hidePop();
}

function endTour() {
  tourState = null;
  hidePop();
  try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* приватный режим */ }
}

/** Авто-тур при первом визите (после первого рендера ленты) */
export function maybeAutoTour() {
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY)) return;
  } catch { /* без LocalStorage просто не показываем */ return; }
  setTimeout(() => {
    try { if (localStorage.getItem(TOUR_SEEN_KEY)) return; } catch { return; }
    startTour();
  }, 1200);
}

// ------------------------------------------------------------
// Страница /help — FAQ + запуск режима/тура
// ------------------------------------------------------------

const HELP_SECTIONS = ['what_is', 'ask', 'answer', 'audio', 'profile', 'donate', 'social', 'moderation', 'ideas'];

export function renderHelpPage(container) {
  stopHelpMode();
  stopTour();
  container.innerHTML = `
    <div class="screen help-page">
      <div class="page-head">
        <div>
          <h1 class="page-title">❓ ${escapeHtml(t('help.title'))}</h1>
          <p class="page-subtitle">${escapeHtml(t('helpPage.subtitle'))}</p>
        </div>
      </div>
      <div class="card help-cta">
        <p>${escapeHtml(t('helpPage.cta_text'))}</p>
        <div class="help-cta-btns">
          <button type="button" class="btn btn-primary" id="help-cta-mode">❓ ${escapeHtml(t('helpPage.cta_mode'))}</button>
          <button type="button" class="btn btn-ghost" id="help-cta-tour">🧭 ${escapeHtml(t('helpPage.cta_tour'))}</button>
        </div>
      </div>
      ${HELP_SECTIONS.map((s) => `
        <section class="card help-section">
          <h2>${escapeHtml(t(`helpPage.sections.${s}.t`))}</h2>
          <p>${escapeHtml(t(`helpPage.sections.${s}.d`))}</p>
        </section>`).join('')}
    </div>`;

  container.querySelector('#help-cta-mode').addEventListener('click', () => {
    navigate('/');
    setTimeout(() => startHelpMode(), 80);
  });
  container.querySelector('#help-cta-tour').addEventListener('click', () => {
    navigate('/');
    setTimeout(() => startTour(), 350);
  });
}

// ------------------------------------------------------------
// Инициализация: кнопка «?» в шапке + реакция на смену маршрута
// ------------------------------------------------------------

export function initHelp() {
  document.getElementById('btn-help-mode')?.addEventListener('click', () => {
    if (active) stopHelpMode();
    else startHelpMode();
  });
  // Перерисовка экрана — цели поповера больше нет в DOM
  subscribeTo('route', () => {
    if (tourState) renderTourStep();
    else hidePop();
  });
}

export const __testing = { TOUR_STEPS, TOUR_SEEN_KEY };
