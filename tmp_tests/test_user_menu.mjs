// Меню аватара раскрывается ровно ПОД аватаром (position: fixed + координаты JS)
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><header><div id="auth-area"></div></header><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const { initAuthUI } = await import('../public/js/auth.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };

setState({ user: { id: 'u-demo', username: 'DemoUser', email: 'demo@example.com' } });
initAuthUI();

const menuBtn = document.getElementById('btn-user-menu');
ok(!!menuBtn, 'аватар отрендерился');
// Аватар у правого края «экрана» 1024px
menuBtn.getBoundingClientRect = () => ({ left: 960, right: 1000, top: 16, bottom: 56, width: 40, height: 40 });

menuBtn.click();
const menu = document.getElementById('user-menu');
ok(!menu.hidden, 'меню открылось');
ok(menu.style.top === '66px', 'меню под аватаром: top = bottom+10 = 66px, реально: ' + menu.style.top);
// offsetWidth в jsdom = 0 → фолбэк 200; правый край меню = правый край аватара
ok(menu.style.left === '800px', 'правый край меню совпадает с аватаром: left = 1000-200 = 800px, реально: ' + menu.style.left);
ok(menu.querySelector('[data-act="profile"]') && menu.querySelector('[data-act="logout"]'), 'пункты меню на месте');

// Узкий экран: меню не вылезает за правый край (left = innerWidth - 200 - 8)
Object.defineProperty(dom.window, 'innerWidth', { value: 360, configurable: true });
dom.window.dispatchEvent(new dom.window.Event('resize'));
ok(menu.style.left === '152px', 'на узком экране удержано в пределах окна (152px), реально: ' + menu.style.left);

// Закрытие по клику вне меню
document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(menu.hidden, 'клик вне меню закрывает его');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);