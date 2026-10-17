// ============================================================
// metrika.mjs — Яндекс.Метрика за флагом ENABLE_METRIKA (config.mjs).
// Грузится ТОЛЬКО в реальном режиме на реальном домене: не в демо и не на
// localhost (дев-прогоны не должны загрязнять статистику), и пока counterId
// не заполнен. SPA-специфика: переходы через History API не порождают
// pageview сами — подписываемся на 'route' в store и шлём ym('hit')
// на каждую смену экрана (первый хит — при инициализации).
// ============================================================

import { CONFIG, IS_DEMO } from './config.mjs';
import { subscribeTo } from './store.mjs';

const TAG_SRC = 'https://mc.yandex.ru/metrika/tag.js';

let installed = false;
let lastHit = '';

/**
 * Грузить ли Метрику: флаг + заполненный counterId + реальный режим.
 * debugForce (тесты) пропускает проверки демо/localhost.
 */
export function metrikaActive() {
  if (!CONFIG.ENABLE_METRIKA || !CONFIG.METRIKA?.counterId) return false;
  if (CONFIG.METRIKA.debugForce) return true;
  if (IS_DEMO) return false;
  const host = window.location?.hostname ?? '';
  return !(host === 'localhost' || host === '127.0.0.1' || host === '');
}

/**
 * Отправить pageview (ym 'hit'). Повторный хит того же URL не отправляется
 * (перерисовка экрана роутером — не новый просмотр).
 */
export function metrikaHit(url = window.location.href) {
  if (!url || url === lastHit) return;
  lastHit = url;
  if (typeof window.ym === 'function') {
    window.ym(CONFIG.METRIKA.counterId, 'hit', url);
  }
}

/**
 * Вызывается один раз при старте приложения (main.mjs → boot).
 * При выключенном флаге / в демо — строгий no-op: ни скрипта, ни обращений.
 */
export function initMetrika() {
  if (installed || !metrikaActive()) return;
  installed = true;

  const m = CONFIG.METRIKA;
  // Официальная очередь ym (асинхронный tag.js обработает её после загрузки)
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = 1 * new Date();
  if (![...document.scripts].some((s) => s.src === TAG_SRC)) {
    const s = document.createElement('script');
    s.src = TAG_SRC;
    s.async = true;
    document.head.appendChild(s);
  }

  window.ym(m.counterId, 'init', {
    clickmap: m.clickmap !== false,
    trackLinks: m.trackLinks !== false,
    accurateTrackBounce: m.accurateTrackBounce !== false,
    webvisor: m.webvisor === true, // приватность: запись сессий только явно
  });

  metrikaHit(); // первый экран
  subscribeTo('route', () => metrikaHit()); // SPA: смена экрана → hit
}
