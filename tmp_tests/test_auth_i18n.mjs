// Заморозка ru-only + перерисовка шапки (auth-area) без перезагрузки:
//  1) гостевые кнопки «Войти/Регистрация» на русском;
//  2) setLocale('en'/'de') клампится к ru (CONFIG.LOCALES = ['ru']):
//     локаль, localStorage и UI остаются русскими, en/de.json не запрашиваются;
//  3) авторизованный: «Задать вопрос» и меню аватара перерисовываются
//     по событию i18n:changed (setLocale('ru') диспатчит его даже когда
//     язык не изменился — механика возврата языков не сломана);
//  4) document-обработчики при этом не накапливаются.
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
const localeFetches = [];
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) {
    localeFetches.push(m[1]);
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  }
  throw new Error('unexpected fetch: ' + url);
};

// Считаем document-обработчики click, чтобы поймать накопление слушателей
const docClickHandlers = new Set();
const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);
document.addEventListener = (type, fn, opts) => { if (type === 'click' && typeof fn === 'function') docClickHandlers.add(fn); return origAdd(type, fn, opts); };
document.removeEventListener = (type, fn, opts) => { if (type === 'click') docClickHandlers.delete(fn); return origRemove(type, fn, opts); };

const { setLocale, getLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const { initAuthUI } = await import('../public/js/auth.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const txt = (id) => document.getElementById(id)?.textContent.trim() ?? null;

initAuthUI();

console.log('1) Гость: кнопки шапки на русском:');
ok(txt('btn-signup') === 'Регистрация' && txt('btn-login') === 'Войти', 'гость: кнопки на русском');

console.log('\n2) Чужие локали клампятся к ru (заморозка):');
await setLocale('en');
ok(getLocale() === 'ru', "setLocale('en') → локаль осталась ru");
ok(localStorage.getItem('samplehelp_locale') === 'ru', 'в localStorage записан ru');
ok(txt('btn-signup') === 'Регистрация' && txt('btn-login') === 'Войти', 'кнопки не сменили язык');
await setLocale('de');
ok(getLocale() === 'ru', "setLocale('de') → локаль осталась ru");
ok(txt('btn-signup') === 'Регистрация', 'кнопки по-прежнему русские');
ok(localeFetches.every((l) => l === 'ru'), 'запрашивался только ru.json: ' + JSON.stringify(localeFetches));

console.log('\n3) Авторизованный: кнопка вопроса и меню аватара:');
setState({ user: { id: 'u-demo', username: 'DemoUser', email: 'demo@example.com' } });
ok(txt('btn-ask').includes('Задать вопрос'), 'авторизован: кнопка вопроса на русском');
ok(document.getElementById('btn-user-menu')?.getAttribute('aria-label') === 'Профиль', 'aria-label аватара на русском');

// setLocale('ru') диспатчит i18n:changed → auth-area перерисовывается
await setLocale('ru');
ok(txt('btn-ask').includes('Задать вопрос'), 'после i18n:changed перерисовка сохранила русский');
ok(document.getElementById('btn-user-menu')?.getAttribute('aria-label') === 'Профиль', 'aria-label после перерисовки на русском');

console.log('\n4) Меню открывается, пункты на русском, клик вне закрывает:');
document.getElementById('btn-user-menu').click();
const menu = document.getElementById('user-menu');
ok(!menu.hidden, 'меню открылось');
ok(menu.textContent.includes('Профиль') && menu.textContent.includes('Выйти'), 'пункты меню на русском');
document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(menu.hidden, 'клик вне меню закрывает его');

console.log('\n5) Нет накопления document-слушателей после всех перерисовок:');
ok(docClickHandlers.size === 1, `document-обработчик click ровно один (факт: ${docClickHandlers.size})`);

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
