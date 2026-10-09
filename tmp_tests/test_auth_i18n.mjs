// Шапка (auth-area) мгновенно меняет язык без перезагрузки:
// кнопки «Войти/Регистрация/Задать вопрос» и меню аватара перерисовываются
// по событию i18n:changed; document-обработчики при этом не накапливаются.
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

// Считаем document-обработчики click, чтобы поймать накопление слушателей
const docClickHandlers = new Set();
const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);
document.addEventListener = (type, fn, opts) => { if (type === 'click' && typeof fn === 'function') docClickHandlers.add(fn); return origAdd(type, fn, opts); };
document.removeEventListener = (type, fn, opts) => { if (type === 'click') docClickHandlers.delete(fn); return origRemove(type, fn, opts); };

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const { initAuthUI } = await import('../public/js/auth.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const txt = (id) => document.getElementById(id)?.textContent.trim() ?? null;

initAuthUI();

// --- Гость: кнопки входа/регистрации ---
ok(txt('btn-signup') === 'Регистрация' && txt('btn-login') === 'Войти', 'гость: кнопки на русском');

await setLocale('en');
ok(txt('btn-signup') === 'Sign up' && txt('btn-login') === 'Log in', 'смена языка без перезагрузки: кнопки на английском');

await setLocale('de');
ok(txt('btn-signup') === 'Registrieren' && txt('btn-login') === 'Anmelden', 'кнопки на немецком');

// --- Авторизованный: «Задать вопрос» + меню аватара ---
setState({ user: { id: 'u-demo', username: 'DemoUser', email: 'demo@example.com' } });
ok(txt('btn-ask').includes('Frage stellen'), 'авторизован: кнопка вопроса на немецком');
ok(document.getElementById('btn-user-menu')?.getAttribute('aria-label') === 'Profil', 'aria-label аватара на немецком');

await setLocale('ru');
ok(txt('btn-ask').includes('Задать вопрос'), 'после переключения: кнопка вопроса на русском');
ok(document.getElementById('btn-user-menu')?.getAttribute('aria-label') === 'Профиль', 'aria-label аватара на русском');

// Меню открывается, пункты переведены, клик вне закрывает
document.getElementById('btn-user-menu').click();
const menu = document.getElementById('user-menu');
ok(!menu.hidden, 'меню открылось');
ok(menu.textContent.includes('Профиль') && menu.textContent.includes('Выйти'), 'пункты меню на русском');
document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(menu.hidden, 'клик вне меню закрывает его');

// --- Нет накопления document-слушателей после всех перерисовок ---
ok(docClickHandlers.size === 1, `document-обработчик click ровно один (факт: ${docClickHandlers.size})`);

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);