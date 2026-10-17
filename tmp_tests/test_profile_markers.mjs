// Маркеры в списках профиля (паритет с лентой, 2026-10-11):
//  0) слой данных: fetchProfile/fetchBestAnswers пробрасывают markers (демо);
//  1) вкладка «Вопросы»: data-markers на canvas, пины-чипы под вейвформой,
//     клик по чипу играет с отметки и НЕ всплывает до карточки (stopPropagation);
//     вопрос без маркеров — без чипов;
//  2) вкладка «Избранное» (та же questionsListHtml) — чипы на месте;
//  3) витрина «Лучшие ответы» — маркеры ответа чипами;
//  4) мусор в markers (строка/null) — dsJson/normalizeMarkers гасят, без чипов и крашей.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
globalThis.FileReader = dom.window.FileReader;

const ctx2d = () => new Proxy({}, {
  get: (t, p) => (p === 'measureText' ? () => ({ width: 10 })
    : p === 'createLinearGradient' ? () => ({ addColorStop() {} })
      : p === 'canvas' ? { width: 300, height: 60 }
        : typeof p === 'symbol' ? undefined : () => {}),
  set: () => true,
});
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

// Фейковое Audio: paused остаётся true → RAF-цикл превью не запускается;
// loadedmetadata внутри play() позволяет проверить старт «с отметки маркера».
class FakeAudio {
  static instances = [];
  constructor(url) {
    this.src = url; this.paused = true; this.currentTime = 0; this.duration = 60; this.preload = '';
    this.playCalls = 0; this._l = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(ev, fn) { (this._l[ev] ||= []).push(fn); }
  _fire(ev) { for (const fn of this._l[ev] || []) fn({ type: ev }); }
  play() { this.playCalls++; this._fire('loadedmetadata'); this._fire('play'); return Promise.resolve(); }
  pause() { this.paused = true; this._fire('pause'); return Promise.resolve(); }
}
globalThis.Audio = FakeAudio;
dom.window.Audio = FakeAudio;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const cardByTitle = (root, text) => [...root.querySelectorAll('.q-card')]
  .find((c) => (c.querySelector('.q-card-title')?.textContent || '').includes(text));
const chipsOf = (card) => [...card.querySelectorAll('.mini-marker-list .marker-chip')];

console.log('0) Слой данных (демо): маркеры доходят до профиля и витрины');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
const profMax = await sb.fetchProfile('u-max');
const q1 = (profMax.questions || []).find((q) => q.id === 'q1');
ok(Array.isArray(q1?.markers) && q1.markers.length === 2, 'fetchProfile: у q1 два маркера');
ok(q1?.markers?.[0]?.note === 'тот самый рык', 'маркеры с заметками проброшены');
const best = await sb.fetchBestAnswers('u-anna');
ok(best.length === 1 && Array.isArray(best[0].markers) && best[0].markers.length === 2,
  'fetchBestAnswers: у a1 два маркера');

console.log('\n1) Профиль u-max, вкладка «Вопросы»:');
await renderProfile(app, { userId: 'u-max' });
await tick();
const card1 = cardByTitle(app, 'рычащий');
ok(!!card1, 'карточка q1 найдена');
const cv1 = card1?.querySelector('.mini-wave');
ok(cv1?.dataset.markers && JSON.parse(cv1.dataset.markers).length === 2,
  'canvas получил data-markers (2 шт.)');
const chips1 = chipsOf(card1);
ok(chips1.length === 2, 'под вейвформой два чипа (.mini-marker-list)');
ok(chips1[0]?.textContent.includes('0:00') && chips1[0]?.textContent.includes('тот самый рык'),
  'чип №1: время 0:00 + заметка «тот самый рык»');
ok(chips1[1]?.textContent.includes('0:02') && chips1[1]?.textContent.includes('хвост'),
  'чип №2: время 0:02 (2.6с) + заметка «хвост…»');
const card4 = cardByTitle(app, 'Плакучий lead');
ok(!!card4 && !!card4.querySelector('.mini-wave') && !card4.querySelector('.mini-marker-list'),
  'q4 без маркеров: вейвформа есть, чипов нет');

// Клик по чипу: играет с отметки, не всплывает до карточки (иначе — уход по onclick)
let cardClicked = false;
card1.addEventListener('click', () => { cardClicked = true; });
const before = FakeAudio.instances.length;
chips1[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await tick(10);
const preview = FakeAudio.instances[FakeAudio.instances.length - 1];
ok(FakeAudio.instances.length > before, 'клик по чипу создал превью-плеер');
ok(preview?.playCalls === 1 && preview?.src === cv1.dataset.audio, 'превью играет тот же аудио-URL');
ok(Math.abs((preview?.currentTime ?? -1) - 0.8) < 1e-6, 'старт с отметки маркера (currentTime = 0.8)');
ok(chips1[0].classList.contains('loading'), 'чип в состоянии .loading до события playing');
ok(!cardClicked, 'stopPropagation: клик по чипу не дошёл до карточки (перехода нет)');

console.log('\n2) Профиль u-anna, вкладка «Избранное» (избранный q1):');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await sb.setFavorite('q1', true);
await renderProfile(app, { userId: 'u-anna' });
await tick();
app.querySelector('.tab-btn[data-tab="favorites"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await tick(120);
const favCard = cardByTitle(app.querySelector('#profile-tab-content'), 'рычащий');
ok(!!favCard, 'избранный q1 отрисован во вкладке');
ok(chipsOf(favCard).length === 2, 'маркеры-чипы на месте (та же questionsListHtml)');
await sb.setFavorite('q1', false);

console.log('\n3) Витрина «Лучшие ответы» (u-anna):');
const baCard = app.querySelector('.best-answer-card');
const baCv = baCard?.querySelector('.mini-wave');
ok(baCv?.dataset.markers && JSON.parse(baCv.dataset.markers).length === 2,
  'canvas ответа получил data-markers (2 шт.)');
const baChips = chipsOf(baCard);
ok(baChips.length === 2, 'два чипа под мини-вейвформой ответа');
ok(baChips[0]?.textContent.includes('0:01') && baChips[1]?.textContent.includes('0:02'),
  'времена чипов: 0:01 (1.2с) и 0:02 (2.8с)');

console.log('\n4) Мусор в markers не ломает рендер:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await sb.createQuestion({ title: 'Мусорные маркеры', description: 'тест', markers: 'мусор' });
await sb.createQuestion({ title: 'Нулевые маркеры', description: 'тест', markers: null });
await renderProfile(app, { userId: 'u-demo' });
await tick();
const junkCard = cardByTitle(app, 'Мусорные маркеры');
const nullCard = cardByTitle(app, 'Нулевые маркеры');
ok(!!junkCard?.querySelector('.mini-wave') && !junkCard.querySelector('.mini-marker-list'),
  'markers-строка: canvas есть, чипов нет, без краша');
ok(junkCard?.querySelector('.mini-wave')?.dataset.markers === '"мусор"', 'data-markers сериализован как JSON-строка');
ok(!!nullCard?.querySelector('.mini-wave') && !nullCard.querySelector('.mini-marker-list'),
  'markers=null: canvas есть, чипов нет');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
