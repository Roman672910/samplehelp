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

const tick43 = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const openMenu43 = () => { document.getElementById('btn-user-menu').click(); return document.getElementById('user-menu'); };
const closeMenu43 = () => document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
console.log('\nзаход 43: строка роли в меню + демо-переключатель:');
const sb43 = await import('../public/js/supabase.mjs');
const { renderModeration } = await import('../public/js/moderation.mjs');
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
await tick43();
let menu43 = openMenu43();
ok(!!document.querySelector('#btn-user-menu .admin-badge'), 'админ: бейдж 🛡 на аватарке в шапке (заход 44: вместо строки в меню);');
ok(!menu43.querySelector('.role-note'), 'строки role-note в меню больше нет');
ok(!!menu43.querySelector('[data-act="admindb"]'), 'заход 50: у админа в меню пункт «🗄 Данные» (data-act=admindb)');
closeMenu43();
const u43 = sb43.setDemoRole(false);
ok(!!u43 && u43.is_admin === false, 'setDemoRole(false) вернул пользователя без админства');
setState({ user: u43 });
await tick43();
ok((await sb43.fetchProfile('u-demo')).is_admin === false, 'строка демо-базы тоже потеряла is_admin');
menu43 = openMenu43();
ok(!document.querySelector('#btn-user-menu .admin-badge'), 'обычный пользователь: бейджа на аватарке нет');
ok(!menu43.querySelector('[data-act="moderation"]'), 'и пункта «Модерация» нет');
ok(!menu43.querySelector('[data-act="admindb"]'), 'заход 50: у обычного пользователя пункта «Данные» нет');
closeMenu43();
const gbox = document.createElement('div');
document.body.appendChild(gbox);
await renderModeration(gbox);
await tick43();
ok(!gbox.querySelector('.mod-guide') && !gbox.querySelector('.mod-card'), 'роль снята: /moderation не открылся (guard)');
gbox.remove();
const u43b = sb43.setDemoRole(true);
setState({ user: u43b });
await tick43();
ok((await sb43.fetchProfile('u-demo')).is_admin === true, 'setDemoRole(true) вернул админа (идемпотентно)');
menu43 = openMenu43();
ok(!!document.querySelector('#btn-user-menu .admin-badge'), 'бейдж снова на месте');
closeMenu43();

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
