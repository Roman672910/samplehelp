// test_presence.mjs — «кто онлайн» ПОСЛЕ захода 40: чип-виджет УДАЛЁН,
// статус живёт ТОЧКОЙ на аватарках авторов в ленте (.p-dot на .avatar sm).
//  0) FEATURES.PRESENCE=false → подписка noop (скоупов нет);
//  1) subscribeOnlineSet: Set id, «вы» всегда внутри, пул = сид-профили;
//     скоуп один, unsubscribe гасит таймер;
//  2) лента: у каждой карточки точка data-pdot=author_id; класс on/off и
//     title/aria-label соответствуют множеству онлайна; чипа/хоста НЕТ;
//  3) стат-скан: feed.mjs/question.mjs больше не знают createPresenceWidget,
//     presence-chip и q-presence-host (виджет удалён отовсюду);
//  4) живой тик: на emit подписки точки в DOM синхронно обновляются;
//  5) cleanup ленты гасит скоуп (таймеры не текут).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
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

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { CONFIG } = await import('../public/js/config.mjs');
const { setState } = await import('../public/js/store.mjs');
const presence = await import('../public/js/presence.mjs');
const { renderFeed } = await import('../public/js/feed.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));

console.log('0) FEATURES.PRESENCE=false → noop:');
CONFIG.FEATURES.PRESENCE = false;
let un0 = presence.subscribeOnlineSet(() => {});
ok(presence.presenceScopeCount() === 0, 'скоупов не создано');
un0();
CONFIG.FEATURES.PRESENCE = true;

console.log('\n1) subscribeOnlineSet: множество id:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
let first = null;
const un1 = presence.subscribeOnlineSet((s) => { first = s; });
ok(first instanceof Set && first.size >= 1, `множество получено сразу (${first?.size} онлайн)`);
ok(first.has('u-demo'), '«вы» (u-demo) всегда в множестве');
ok(presence.presenceScopeCount() === 1, 'один живой скоуп');
un1();
ok(presence.presenceScopeCount() === 0, 'unsubscribe гасит скоуп и таймер');

console.log('\n2) лента: точки на аватарках, чипа нет:');
const app = document.getElementById('app');
const cleanup = await renderFeed(app);
await tick();
const dots = [...app.querySelectorAll('.q-card .avatar.sm .p-dot')];
ok(dots.length >= 3, `точки есть у карточек ленты (${dots.length})`);
let probeSet = null;
// синхронный стартовый emit = текущее множество скоупа (то же, что уже на точках)
const unProbe = presence.subscribeOnlineSet((s) => { probeSet = s; });
unProbe();
const probe = probeSet;
ok(dots.every((d) => d.classList.contains('on') === probe.has(d.dataset.pdot)), 'класс on/off каждой точки = множество онлайна');
ok(dots.every((d) => (d.classList.contains('on') ? d.getAttribute('title') === t('presence.dot_on') : d.getAttribute('title') === t('presence.dot_off'))), 'title/aria точки = «в сети» / «не в сети»');
ok(!app.querySelector('.presence-chip') && !app.querySelector('#feed-presence-host') && !app.querySelector('.presence-stack'), 'чипа/хоста/стека в ленте больше нет');

console.log('\n3) стат-скан: виджет удалён из модулей:');
const feedSrc = fs.readFileSync('public/js/feed.mjs', 'utf8');
const qSrc = fs.readFileSync('public/js/question.mjs', 'utf8');
ok(!feedSrc.includes('createPresenceWidget') && !feedSrc.includes('feed-presence-host'), 'feed.mjs не знает виджет и хост');
ok(!qSrc.includes('createPresenceWidget') && !qSrc.includes('q-presence-host') && !qSrc.includes('presence-row'), 'question.mjs: ряда «Сейчас смотрят» больше нет');
ok(!fs.readFileSync('public/js/presence.mjs', 'utf8').includes('createPresenceWidget'), 'presence.mjs: виджет удалён из модуля');

console.log('\n4) живой тик: точки обновляются без перерисовки:');
CONFIG.PRESENCE_TICK_MS = 40;
cleanup(); // снимаем ленту...
const cleanup2 = await renderFeed(app);
await tick();
const cardBefore = app.querySelector('.q-card .avatar.sm .p-dot');
await new Promise((res) => {
  let emits = 0;
  let u;
  u = presence.subscribeOnlineSet((s) => {
    emits++;
    if (emits === 1) return; // первый emit — синхронный стартовый; ждём ТИК
    // feed-подписка в скоупе создана РАНЬШЕ → её applyDots уже отработал
    const d = app.querySelector(`.p-dot[data-pdot="${[...s][0]}"]`);
    ok(!d || d.classList.contains('on'), 'на тике точки синхронны с множеством');
    ok(app.querySelector('.q-card .avatar.sm .p-dot') === cardBefore, 'DOM карточек не пересоздавался (обновлены только точки)');
    u();
    res();
  });
});
CONFIG.PRESENCE_TICK_MS = 15000;

console.log('\n5) cleanup ленты гасит скоуп:');
cleanup2();
ok(presence.presenceScopeCount() === 0, 'после cleanup ленты скоупов нет');

console.log('\n6) ЛС: онлайн-точки диалогов — из того же множества (заход 42):');
{
  const { fetchConversations } = await import('../public/js/supabase.mjs');
  const convs = await fetchConversations();
  ok(convs.length > 0 && convs.every((c) => c.online === undefined), 'фейкового поля online у диалогов больше нет');
  const { renderMessages } = await import('../public/js/messages.mjs');
  const mbox = document.createElement('div');
  document.body.appendChild(mbox);
  const mCleanup = await renderMessages(mbox, { userId: 'u-anna' });
  await tick(80);
  const odots = [...mbox.querySelectorAll('[data-odot]')];
  ok(odots.length >= 2, `точки есть в списке диалогов и в шапке чата (${odots.length})`);
  let pset = null;
  const unP = presence.subscribeOnlineSet((s) => { pset = s; });
  unP();
  ok(odots.every((d) => d.classList.contains('off') !== pset.has(d.dataset.odot)), 'класс off/on каждой точки ЛС = множество онлайна');
  const headDot = mbox.querySelector('.chat-head [data-odot="u-anna"]');
  ok(!!headDot, 'точка в шапке чата привязана к собеседнику (u-anna)');
  ok(headDot.getAttribute('title') === (pset.has('u-anna') ? t('common.online') : t('common.offline')), 'title точки ЛС = «в сети»/«не в сети»');
  ok(presence.presenceScopeCount() === 1, 'ЛС держат одну presence-подписку');
  mCleanup?.();
  ok(presence.presenceScopeCount() === 0, 'cleanup экрана ЛС гасит подписку');
  mbox.remove();
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
