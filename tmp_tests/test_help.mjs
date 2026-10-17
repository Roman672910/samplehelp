// Контекстная справка «What's this?» + тур первого визита + страница /help:
//  1) режим: включение/выключение (класс body, aria-pressed, баннер);
//  2) перехват: собственные обработчики клика и document-делегирование НЕ срабатывают,
//     вместо действия — поповер с описанием из help.items.*;
//  3) фолбэк на предка с data-help и тост «нет справки» без него;
//  4) выход: Esc, кнопка баннера, крестик поповера (клики внутри help-ui работают);
//  5) клавиши Enter/Space по фокусу показывают справку; wheel на канвасе блокируется;
//  6) тур: шаги по TOUR_STEPS, «далее/пропустить», флаг samplehelp_tour_seen;
//  7) maybeAutoTour: с флагом не стартует, без — стартует;
//  8) /help: 8 секций FAQ + CTA-кнопки (режим запускается после navigate).
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><html><body>
  <nav class="main-nav">
    <a href="/" data-route class="nav-icon">Лента</a>
    <a href="/favorites" data-route class="nav-icon" data-help="nav_favorites"><span class="inner">★</span></a>
    <button type="button" id="notif-bell" class="nav-icon"></button>
    <button type="button" id="btn-help-mode" aria-pressed="false"></button>
  </nav>
  <div id="auth-area"><button type="button" id="btn-ask"></button><button type="button" id="btn-user-menu"></button></div>
  <main id="app">
    <a class="avatar sm"><span class="p-dot"></span></a>
    <article class="q-card" data-help="feed_card"><canvas class="mini-wave"></canvas></article>
    <button type="button" id="plain-btn" data-help="like_btn">🔥</button>
    <button type="button" id="lonely-btn">без справки</button>
  </main>
  <div id="toast-container"></div>
</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const {
  initHelp, isHelpMode, startHelpMode, stopHelpMode,
  startTour, maybeAutoTour, renderHelpPage, __testing,
} = await import('../public/js/help.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (k, el = document.body) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const popTitle = () => document.querySelector('.help-pop:not([hidden]) .help-pop-title')?.textContent || '';
const popDesc = () => document.querySelector('.help-pop:not([hidden]) .help-pop-desc')?.textContent || '';
const popVisible = () => !!document.querySelector('.help-pop:not([hidden])');

initHelp();

console.log('1) Режим включается/выключается:');
click(document.getElementById('btn-help-mode'));
ok(isHelpMode(), 'клик по «?» включает режим');
ok(document.body.classList.contains('help-active'), 'body.help-active');
ok(document.getElementById('btn-help-mode').getAttribute('aria-pressed') === 'true', 'aria-pressed=true');
ok(!document.querySelector('.help-banner').hidden, 'баннер виден');
click(document.getElementById('btn-help-mode'));
ok(!isHelpMode() && document.querySelector('.help-banner').hidden, 'повторный клик выключает');

console.log('\n2) Перехват кликов: действие блокируется, показывается справка:');
let plainClicked = 0;
let docDelegate = 0;
document.getElementById('plain-btn').addEventListener('click', () => { plainClicked++; });
document.addEventListener('click', () => { docDelegate++; });
startHelpMode();
click(document.getElementById('plain-btn'));
ok(plainClicked === 0, 'собственный обработчик кнопки НЕ сработал');
ok(docDelegate === 0, 'document-делегирование (роутер) НЕ сработало');
ok(popVisible(), 'поповер показан');
ok(popTitle().includes('Нравится'), `заголовок из каталога: «${popTitle().trim()}»`);
ok(popDesc().length > 20, 'описание непустое');
ok(!document.querySelector('.help-spot').hidden, 'спотлайт на элементе');
stopHelpMode();
click(document.getElementById('plain-btn'));
ok(plainClicked === 1 && docDelegate >= 1, 'после выхода режима кнопки снова работают');

console.log('\n3) Фолбэк на предка и тост «нет справки»:');
startHelpMode();
click(document.querySelector('[data-help="nav_favorites"] .inner'));
ok(popTitle().includes('Избранное'), `клик по вложенному <span> → справка предка: «${popTitle().trim()}»`);
click(document.getElementById('lonely-btn'));
ok(document.querySelector('#toast-container')?.textContent.includes('справки пока нет'), 'элемент без data-help → тост');
ok(!popVisible(), 'поповер при этом не показан');

console.log('\n4) Выход: крестик поповера, Esc, кнопка баннера:');
click(document.querySelector('[data-help="nav_favorites"] .inner'));
click(document.querySelector('.help-pop-close'));
ok(!popVisible(), 'крестик закрывает поповер (режим остаётся)');
ok(isHelpMode(), 'режим не выключен');
key('Escape');
ok(!isHelpMode(), 'Esc выключает режим');
startHelpMode();
click(document.querySelector('#help-banner-exit'));
ok(!isHelpMode(), 'кнопка «Выйти из справки» в баннере выключает');

console.log('\n5) Клавиатура и колесо:');
startHelpMode();
document.getElementById('plain-btn').focus();
key('Enter', document.getElementById('plain-btn'));
ok(popVisible() && popTitle().includes('Нравится'), 'Enter по фокусу показывает справку');
key('Escape');
const wheelEvt = new dom.window.Event('wheel', { bubbles: true, cancelable: true });
document.querySelector('.mini-wave').dispatchEvent(wheelEvt);
ok(!wheelEvt.defaultPrevented, 'вне режима wheel не блокируется');
startHelpMode();
const wheelEvt2 = new dom.window.Event('wheel', { bubbles: true, cancelable: true });
document.querySelector('.mini-wave').dispatchEvent(wheelEvt2);
ok(wheelEvt2.defaultPrevented, 'в режиме wheel на канвасе блокируется');
stopHelpMode();

console.log('\n6) Тур: шаги, далее/пропустить, флаг:');
localStorage.removeItem(__testing.TOUR_SEEN_KEY);
startTour();
ok(popVisible() && document.querySelector('.help-pop-step')?.textContent.includes('1'), 'шаг 1 показан');
ok(popTitle().includes('Лента'), `первый шаг — лента: «${popTitle().trim()}»`);
const steps = __testing.TOUR_STEPS.length;
for (let i = 1; i <= steps; i++) {
  click(document.querySelector('#tour-next'));
}
ok(!popVisible(), 'после последнего шага тур завершён');
ok(localStorage.getItem(__testing.TOUR_SEEN_KEY) === '1', 'флаг «тур пройден» записан');
startTour();
click(document.querySelector('#tour-next'));
click(document.querySelector('#tour-skip'));
ok(!popVisible(), '«Пропустить» закрывает тур');

console.log('\n7) maybeAutoTour уважает флаг:');
maybeAutoTour(); // флаг установлен (после «Пропустить») — тур не должен стартовать
await sleep(1400);
ok(!popVisible(), 'с флагом авто-тур не стартует');
localStorage.removeItem(__testing.TOUR_SEEN_KEY);
maybeAutoTour();
await sleep(1400);
ok(popVisible(), 'без флага авто-тур стартует сам');
click(document.querySelector('#tour-skip'));
ok(localStorage.getItem(__testing.TOUR_SEEN_KEY) === '1', 'и помечает флаг после пропуска');

console.log('\n8) Страница /help:');
const app = document.getElementById('app');
renderHelpPage(app);
ok(app.querySelectorAll('.help-section').length === 9, '9 секций FAQ (+«Идеи и связь с разработчиком», заход 38)');
const ideasSec = [...app.querySelectorAll('.help-section')].find((x) => x.textContent.includes('Идеи и связь с разработчиком'));
ok(!!ideasSec && ideasSec.textContent.includes('один голос'), 'секция идей: правила голосования описаны');
const modSec = [...app.querySelectorAll('.help-section')].find((s) => s.textContent.includes('Жалобы и модерация'));
ok(!!modSec && modSec.textContent.includes('уведомление о факте решения'), 'секция «Жалобы и модерация»: петля обратной связи описана (заход 36)');
ok(!!modSec && modSec.textContent.includes('одна жалоба'), 'секция объясняет антидубль: одна жалоба от человека на цель');
ok(!!modSec && !modSec.textContent.includes('7 дней'), 'чужеродная фраза про 7-дневный архив из секции убрана');
ok(app.querySelector('h1')?.textContent.includes('Справка'), 'заголовок «Справка»');
ok(!!app.querySelector('#help-cta-mode') && !!app.querySelector('#help-cta-tour'), 'CTA: режим и тур');
click(app.querySelector('#help-cta-mode'));
ok(location.pathname === '/', 'CTA «режим» ведёт на главную');
await sleep(120);
ok(isHelpMode(), 'и включает режим справки');
stopHelpMode();

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ help: все проверки пройдены');
process.exit(fails ? 1 : 0);
