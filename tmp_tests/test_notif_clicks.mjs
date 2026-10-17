// test_notif_clicks.mjs — заход 47 «Живые уведомления»:
//  1) генераторы: createAnswer → автору вопроса (себе нет); лайк → автору
//     контента (снятие и свой лайк — тихо);
//  2) панель: шеврон у кликабельных, клик = прочитано (бейдж честный);
//  3) карта кликов: answer → /question/:id; thanks → профиль донора;
//     отметка автору → своя модалка поддержки; done → профиль автора;
//     report_status — некликабелен и не навигирует.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div><div id="modal-root"></div><button id="notif-bell"></button><div id="notif-panel" hidden></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
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
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'getImageData' ? () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }) : p === 'canvas' ? { width: 2, height: 2 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();
dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,STUBCANVAS';

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState, getState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { initNotifications } = await import('../public/js/notifications.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const clearModals = () => document.querySelectorAll('#modal-root .modal-overlay').forEach((o) => o.remove());

initNotifications();
const bell = document.getElementById('notif-bell');
const panel = document.getElementById('notif-panel');
const openPanel = async () => { click(bell); await tick(); return [...panel.querySelectorAll('.notif-item')]; };
// эмуляция прихода realtime: панель рендерит из store, поэтому свежие
// уведомления кладём в state вручную (в бою это делает subscribeNotifications)
const refresh = async () => {
  const ns = await sb.fetchNotifications();
  setState({ notifications: ns, unreadCount: ns.filter((x) => !x.read).length });
  await tick();
};

console.log('1) генераторы answer/like:');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
const before = (await sb.fetchNotifications()).length;
await sb.createAnswer({ question_id: 'q4', content: 'Тестовый ответ Анны на открытый вопрос Макса: попробуйте FM-модуляцию собственным выходом.' });
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
let mine = await sb.fetchNotifications();
let nAns = mine.find((n) => n.type === 'answer' && n.payload?.questionId === 'q4');
ok(!!nAns && !!nAns.payload?.answerId && nAns.payload?.by === 'AnnaSynth', 'автор вопроса получил answer с questionId/answerId');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
ok((await sb.fetchNotifications()).length === before, 'себе за свой ответ уведомление не пришло');
// лайк: автору контента, targetKey + questionId вопроса ответа
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await sb.toggleLike('answer', 'a5'); // ответ Макса на q4
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
mine = await sb.fetchNotifications();
const nLike = mine.find((n) => n.type === 'like' && n.payload?.targetKey === 'notifications.target_answer');
ok(!!nLike && nLike.payload?.questionId === 'q4', 'лайк ответа → автору: targetKey + questionId вопроса');
const likeCount = mine.length;
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await sb.toggleLike('answer', 'a5'); // снятие — тихо
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
ok((await sb.fetchNotifications()).length === likeCount, 'снятие лайка — без уведомления');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
await sb.toggleLike('answer', 'a5'); // свой лайк на свой ответ — тихо
ok((await sb.fetchNotifications()).length === likeCount, 'свой лайк на свой контент — без уведомления');
await sb.toggleLike('answer', 'a5'); // возвращаем лайк Анны для кликов ниже

console.log('\n2) панель: шевроны, клик = прочитано, карта переходов:');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
let items = await openPanel();
const ansItem = items.find((el) => el.dataset.id === nAns.id);
ok(!!ansItem && ansItem.classList.contains('clickable') && !!ansItem.querySelector('.notif-go'), 'answer-уведомление кликабельно и с шевроном');
const unreadBefore = getState().unreadCount;
click(ansItem);
await tick();
ok(dom.window.location.pathname === '/question/q4', 'клик по answer → /question/q4');
ok(getState().unreadCount === unreadBefore - 1, 'бейдж: клик пометил прочитанным (−1)');
items = await openPanel();
const ansItem2 = items.find((el) => el.dataset.id === nAns.id);
ok(!!ansItem2 && !ansItem2.classList.contains('unread'), 'помечено прочитанным в UI');
click(panel.querySelector('#notif-mark-all'));
await tick();
click(bell); // закрыть панель: следующий openPanel должен открыть, а не закрыть
await tick();

console.log('\n3) карта кликов support-семейства и report_status:');
// спасибо: донор anna → автор max; клик максом → профиль донора
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await sb.recordDonation({ recipient_user_id: 'u-max', amount: 0, currency: 'RUB', message: 'спасибо за бас!', kind: 'thanks' });
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
await refresh();
items = await openPanel();
const thanksItem = items.find((el) => el.classList.contains('clickable') && el.textContent.includes('спасибо'));
ok(!!thanksItem, '«спасибо» кликабельно');
click(thanksItem);
await tick();
ok(dom.window.location.pathname === '/profile/u-anna', 'клик по «спасибо» → профиль донора /profile/u-anna');
// отметка перевода: автору — своя модалка поддержки
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
const mark = await sb.markDonationTransfer({ recipientUserId: 'u-max', amount: 500, message: 'за бас' });
ok(!!mark, 'отметка перевода создана');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
await refresh();
items = await openPanel();
const markItem = items.find((el) => el.textContent.includes('500'));
ok(!!markItem && markItem.classList.contains('clickable'), 'отметка перевода кликабельна');
const pathBefore = dom.window.location.pathname;
click(markItem);
await tick();
ok(!!document.querySelector('#modal-root .modal .sup-marks'), 'клик по отметке → своя модалка поддержки со списком отметок');
ok(dom.window.location.pathname === pathBefore, 'навигации при этом нет');
clearModals();
// done: донору — профиль автора
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
ok(await sb.confirmDonation(mark.id), 'автор подтвердил получение');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await refresh();
items = await openPanel();
const doneItem = items.find((el) => el.classList.contains('clickable') && el.textContent.includes('ваш перевод'));
ok(!!doneItem, '«получено ✓» донору кликабельно');
click(doneItem);
await tick();
ok(dom.window.location.pathname === '/profile/u-max', 'клик по done → профиль автора /profile/u-max');
// report_status: некликабелен
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
const rep = await sb.submitReport({ target_type: 'question', target_id: 'q5', reason: 'spam' });
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
await sb.setReportStatus(rep.id, 'dismissed');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await refresh();
items = await openPanel();
const repItem = items.find((el) => el.textContent.includes('жалоба'));
ok(!!repItem && !repItem.classList.contains('clickable') && !repItem.querySelector('.notif-go'), 'report_status: без шеврона и курсора');
const pathRep = dom.window.location.pathname;
click(repItem);
await tick();
ok(dom.window.location.pathname === pathRep, 'клик по report_status не навигирует (осознанно)');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
