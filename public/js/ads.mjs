// ============================================================
// ads.mjs — рекламные слоты (рычаг монетизации №3: ENABLE_ADS в config.mjs,
// независимо от ENABLE_MONETIZATION / ENABLE_DONATIONS).
// Провайдер: Яндекс РСЯ — RTB-блоки через Ya.Context.AdvManager
// (официальный паттерн для SPA: очередь window.yaContextCb + render по месту;
//  darkTheme под тёмную тему сайта; statId — срез статистики на размещение;
//  onRender/onError — показ/скрытие слота).
//
// Режимы слота (adsMode):
// • 'off'         — ENABLE_ADS выключен: adSlotHtml() → '', в DOM ничего нет;
// • 'placeholder' — флаг включён, но демо/localhost/не вписан ID блока:
//                   пунктирная заглушка (вёрстка видна, код Яндекса не грузится);
// • 'live'        — реальный рендер блока Яндекса.
//
// Экраны вызывают adSlotHtml(slot) в разметке и mountAd(el, slot) после
// вставки в DOM; mountAd возвращает cleanup (роутер вызывает при уходе,
// лента — при перерисовке сортировки).
// Слоты сознательно НЕ размещаются: в модалках, у рекордера/триммера/плееров
// (критические сценарии), полноэкранные форматы — не используем (UX).
// ============================================================

import { CONFIG, IS_DEMO } from './config.mjs';
import { t } from './i18n.mjs';
import { escapeHtml } from './utils.mjs';

let loaderInjected = false;
let mountSeq = 0; // уникальность renderTo: один blockId может повторяться (лента)

/**
 * Режим слота: 'off' | 'placeholder' | 'live'.
 * debugForceLive (тесты) пропускает проверки демо/localhost — ID блока обязателен.
 */
export function adsMode(slot) {
  if (!CONFIG.ENABLE_ADS) return 'off';
  const block = CONFIG.ADS?.blocks?.[slot];
  if (!block) return 'off';
  if (CONFIG.ADS.debugForceLive && block.id) return 'live';
  const host = window.location?.hostname ?? '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  if (IS_DEMO || isLocal || !block.id) return 'placeholder';
  return 'live';
}

/** Однократная инъекция лоадера Яндекса (async, не блокирует загрузку SPA) */
function injectLoader() {
  if (loaderInjected) return;
  const src = CONFIG.ADS?.loader;
  if (!src) return;
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  document.head.appendChild(s);
  loaderInjected = true;
}

/**
 * Вызывается один раз при старте приложения (main.mjs → boot): прогрев лоадера
 * до первого слота. При выключенном флаге — no-op; в демо/localhost (нет live-
 * слотов) лоадер тоже НЕ грузится — плейсхолдерам внешний код не нужен.
 */
export function initAds() {
  if (!CONFIG.ENABLE_ADS) return;
  const hasLive = Object.keys(CONFIG.ADS?.blocks || {}).some((slot) => adsMode(slot) === 'live');
  if (hasLive) injectLoader();
}

/**
 * Лента: ставить ли рекламный слот ПОСЛЕ карточки с индексом index (0-based)?
 * Плотность — CONFIG.ADS.blocks.feed_inline.every (по умолчанию каждая 6-я).
 */
export function shouldPlaceFeedAd(index) {
  if (adsMode('feed_inline') === 'off') return false;
  const every = Math.max(1, CONFIG.ADS?.blocks?.feed_inline?.every || 6);
  return (index + 1) % every === 0;
}

/**
 * Разметка слота. 'off' → пустая строка (в DOM ноль следов рекламы).
 * Подпись «Реклама» — прозрачность и требование закона о маркировке
 * (сетевые объявления РСЯ маркируются Яндексом автоматически: erid внутри блока).
 */
export function adSlotHtml(slot) {
  const mode = adsMode(slot);
  if (mode === 'off') return '';
  return `
    <div class="ad-slot" data-help="ad_slot" data-ad-slot="${escapeHtml(slot)}" data-ad-mode="${mode}">
      <span class="ad-label">${escapeHtml(t('ads.label'))}</span>
      <div class="ad-container"></div>
    </div>`;
}

/**
 * Активация слота: плейсхолдер или живой рендер Яндекса.
 * @param {HTMLElement|null} slotEl — элемент .ad-slot из adSlotHtml
 * @param {string} slot — имя слота (ключ CONFIG.ADS.blocks)
 * @returns {() => void} cleanup — снять слот (роутер/перерисовка ленты)
 */
export function mountAd(slotEl, slot) {
  if (!slotEl) return () => {};
  const mode = slotEl.dataset.adMode || adsMode(slot);
  if (mode === 'off') return () => {};
  const containerEl = slotEl.querySelector('.ad-container');

  if (mode === 'placeholder') {
    slotEl.classList.add('ad-placeholder');
    if (containerEl) containerEl.textContent = t('ads.placeholder');
    return () => { slotEl.remove(); };
  }

  // ---------- Live: Яндекс РСЯ ----------
  const block = CONFIG.ADS.blocks[slot];
  injectLoader();
  const renderTo = `yandex_rtb_${String(block.id).replace(/[^A-Za-z0-9_-]/g, '')}_${++mountSeq}`;
  if (containerEl) containerEl.id = renderTo;

  // Пустой слот не должен оставлять «дыру»: если показ не случился
  // (нет инвентаря для EN/DE-трафика, адблокер, ошибка) — убираем целиком.
  let settled = false;
  const guardMs = CONFIG.ADS.emptyGuardMs || 10000;
  const guard = setTimeout(() => { if (!settled) slotEl.remove(); }, guardMs);

  window.yaContextCb = window.yaContextCb || [];
  window.yaContextCb.push(() => {
    if (!slotEl.isConnected) return; // экран сменился до готовности лоадера
    Ya.Context.AdvManager.render({
      blockId: block.id,
      renderTo,
      darkTheme: CONFIG.ADS.darkTheme !== false,
      statId: block.statId,
      onRender: () => {
        settled = true;
        clearTimeout(guard);
        slotEl.classList.add('ad-filled'); // резерв высоты больше не нужен
      },
      onError: () => {
        settled = true;
        clearTimeout(guard);
        slotEl.remove();
      },
    });
  });

  return () => {
    settled = true;
    clearTimeout(guard);
    slotEl.remove();
    // destroy() у Яндекса keyed по blockId: зовём только для единственных
    // экземпляров (once) — иначе в ленте убили бы соседние слоты того же блока.
    if (block.once && window.Ya?.Context?.AdvManager?.destroy) {
      try { Ya.Context.AdvManager.destroy({ blockId: block.id }); } catch { /* ignore */ }
    }
  };
}
