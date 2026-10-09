// Бейдж непрочитанных сообщений + колокольчик без «message»-уведомлений
// + панель уведомлений раскрывается под колокольчиком (position: fixed).
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><html><body>
  <button id="notif-bell" hidden><span class="notif-badge" id="notif-count" hidden>0</span></button>
  <a href="/messages" class="nav-icon"><span class="notif-badge" id="msg-count" hidden>0</span></a>
  <div id="notif-panel" class="notif-panel" hidden></div>
  <div id="app"></div><div id="toast-container"></div><div id="modal-root"></div>
</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.Audio = dom.window.Audio;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
const realSetTimeout = globalThis.setTimeout;
globalThis.requestAnimationFrame = (cb) => realSetTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'canvas' ? { width: 300, height: 60 } : () => {}) });

// Длинные демо-таймеры (входящее сообщение через 12–22 с) не должны
// удерживать процесс — unref, но короткие (ожидания в тесте) остаются
const origSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = function patched(fn, ms, ...args) {
  const h = origSetTimeout(fn, ms, ...args);
  if (h && typeof h.unref === 'function' && Number(ms) > 5000) h.unref();
  return h;
};

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

// Сохранённая демо-база со СТАРЫМ «message»-уведомлением (как у пользователей,
// которые заходили до этой правки) — оно должно фильтроваться.
// Версию берём из исходника, чтобы тест не ломался при следующем бампе сидов.
const demoVer = Number(fs.readFileSync('public/js/supabase.mjs', 'utf8').match(/DEMO_DB_VERSION = (\d+)/)[1]);
localStorage.setItem('samplehelp_demo_db', JSON.stringify({
  v: demoVer,
  notifications: [
    { id: 'nx', user_id: 'u-demo', type: 'message', payload: { by: 'MaxWavetable' }, read: false, created_at: new Date().toISOString() },
    { id: 'ny', user_id: 'u-demo', type: 'answer', payload: { questionTitle: 'Тест', by: 'LenaFX' }, read: false, created_at: new Date().toISOString() },
  ],
}));

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { getState, setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const notif = await import('../public/js/notifications.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 120) => new Promise((r) => realSetTimeout(r, ms));

console.log('1) Колокольчик: «message»-уведомления отфильтрованы (даже из сохранённой базы):');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
const fetched = await sb.fetchNotifications();
ok(!fetched.some((n) => n.type === 'message'), 'среди загруженных нет типа message');
ok(!fetched.some((n) => n.id === 'nx'), 'старое nx (message) скрыто');
ok(fetched.some((n) => n.id === 'ny'), 'обычное ny (answer) на месте');

console.log('2) Инициализация шапки: счётчик на иконке «Сообщения»:');
notif.initNotifications();
await tick();
const msgCount = document.getElementById('msg-count');
const bell = document.getElementById('notif-bell');
ok(!bell.hidden, 'колокольчик виден после входа');
ok(msgCount.textContent === '3' && !msgCount.hidden, 'бейдж = 3 непрочитанных (m3, m4, m5 из сидов): ' + msgCount.textContent);
ok(getState().unreadMessages === 3, 'в store unreadMessages = 3');
ok(!getState().notifications.some((n) => n.type === 'message'), 'в store.notifications нет message');

console.log('3) Панель уведомлений раскрывается под колокольчиком:');
bell.click();
const panel = document.getElementById('notif-panel');
ok(!panel.hidden, 'панель открылась по клику');
ok(panel.style.top === '10px' && panel.style.left === '8px', `координаты выставлены JS (top=${panel.style.top}, left=${panel.style.left})`);
ok(panel.innerHTML.includes('✍️'), 'уведомление об ответе отображается');
ok(!panel.innerHTML.includes('💬'), 'иконки сообщений в панели нет');
bell.click();
ok(panel.hidden, 'второй клик закрывает панель');

console.log('4) Входящее сообщение → только счётчик, не колокольчик:');
let eventsFired = 0;
document.addEventListener('messages:new', () => { eventsFired++; });
const before = getState().notifications.length;
notif.onIncomingMessage({ id: 'm-t1', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'привет', created_at: new Date().toISOString() });
ok(getState().unreadMessages === 4, 'счётчик вырос до 4');
ok(getState().notifications.length === before, 'список уведомлений не изменился');
ok(eventsFired === 1, 'событие messages:new отправлено');
notif.onIncomingMessage({ id: 'm-t2', sender_id: 'u-demo', recipient_id: 'u-anna', content: 'сам себе', created_at: new Date().toISOString() });
ok(getState().unreadMessages === 4, 'своё сообщение счётчик не меняет');

console.log('5) Открытый диалог: счётчик не растёт (сообщение сразу прочитано):');
window.history.pushState({}, '', '/messages');
const chatPane = document.createElement('div');
chatPane.id = 'chat-pane';
chatPane.dataset.with = 'u-anna';
document.body.appendChild(chatPane);
notif.onIncomingMessage({ id: 'm-t3', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'ещё', created_at: new Date().toISOString() });
ok(getState().unreadMessages === 4, 'от AnnaSynth (диалог открыт) — без изменений');
notif.onIncomingMessage({ id: 'm-t4', sender_id: 'u-max', recipient_id: 'u-demo', content: 'здарова', created_at: new Date().toISOString() });
ok(getState().unreadMessages === 5, 'от MaxWavetable (другой диалог) — +1');

console.log('6) Открытие диалога гасит его непрочитанные:');
await sb.markThreadRead('u-anna');
await notif.refreshUnreadMessages();
ok(getState().unreadMessages === 1, 'осталось 1 (непрочитанное от MaxWavetable): ' + getState().unreadMessages);
ok(msgCount.textContent === '1', 'бейдж обновился до 1');

console.log('7) Выход: бейдж и колокольчик скрыты:');
window.history.pushState({}, '', '/');
chatPane.remove();
setState({ user: null });
await tick();
ok(getState().unreadMessages === 0, 'unreadMessages сброшен');
ok(msgCount.hidden, 'бейдж сообщений скрыт');
ok(bell.hidden, 'колокольчик скрыт');

console.log(fails ? `\n✗ ${fails} провалов` : '\n✓ Все проверки пройдены');
process.exitCode = fails ? 1 : 0;