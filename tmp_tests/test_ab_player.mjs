// Поведенческий тест: A/B-плеер синхронизирует треки РАЗНОЙ длины по проценту,
// оба доигрывают до конца, после «ended» ▶ снова стартует с нуля.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'canvas' ? { width: 300, height: 32 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

// Фейковое аудио: play/pause/ended с событиями, как в браузере
class FakeAudio {
  static instances = [];
  constructor(url) {
    this.src = url; this.paused = true; this.ended = false;
    this.currentTime = 0; this.duration = 60; this.preload = '';
    this._l = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(ev, fn) { (this._l[ev] ||= []).push(fn); }
  _fire(ev) { for (const fn of this._l[ev] || []) fn({ type: ev }); }
  play() { this.paused = false; this.ended = false; this._fire('play'); return Promise.resolve(); }
  pause() { if (this.paused) return Promise.resolve(); this.paused = true; this._fire('pause'); return Promise.resolve(); }
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
const { createABPlayer } = await import('../public/js/audio.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const near = (v, target, eps = 0.01) => Math.abs(v - target) <= eps;
const click = (el, opts = {}) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...opts }));

const host = document.getElementById('host');
const cleanup = createABPlayer(host, {
  a: { url: 'question.wav', waveform: [0.2, 0.5, 0.8], label: 'Вопрос (референс)' },
  b: { url: 'answer.wav', waveform: [0.3, 0.9, 0.4], label: 'Ответ' },
});
const [A, B] = FakeAudio.instances; // порядок создания: сначала A, потом B
A.duration = 7; // референс вопроса — 7 секунд
B.duration = 3; // ответ — 3 секунды (ДРУГАЯ длина)
A._fire('loadedmetadata');
B._fire('loadedmetadata');

const playBtn = host.querySelector('.ab-play');
const toggleBtn = host.querySelector('.ab-toggle');
const curEl = host.querySelector('.ab-cur');
const durEl = host.querySelector('.ab-dur');

console.log('1) Старт: играет A (референс), длительность в UI — его own:');
click(playBtn);
ok(!A.paused && A.currentTime === 0, 'A играет с нуля');
ok(durEl.textContent === '0:07', 'в UI длительность A: ' + durEl.textContent);

console.log('2) Переключение A→B на 50% (3.5с из 7): B продолжает с 50% СВОЕЙ длины (1.5с из 3):');
A.currentTime = 3.5;
click(toggleBtn);
ok(A.paused && !B.paused, 'пауза на A, играет B');
ok(near(B.currentTime, 1.5), 'B на 50% своей длины (1.5с): ' + B.currentTime);
ok(durEl.textContent === '0:03', 'в UI длительность B: ' + durEl.textContent);
ok(B.currentTime < B.duration, 'B НЕ уперся в конец — есть что играть');

console.log('3) B доигрывает до конца — оба трека отматываются в начало:');
B.currentTime = B.duration;
B.paused = true; B.ended = true;
B._fire('ended');
ok(A.currentTime === 0 && B.currentTime === 0, 'A и B снова на 0:00');
ok(playBtn.textContent === '▶', 'кнопка показывает ▶');

console.log('4) ▶ после окончания — играет заново с нуля (не «молчит»):');
click(playBtn);
ok(!B.paused && B.currentTime === 0, 'B играет с начала');

console.log('5) Переключение B→A на 50% (1.5с из 3): A на 50% своей длины (3.5с из 7):');
B.currentTime = 1.5;
click(toggleBtn);
ok(!A.paused && B.paused, 'играет A, B на паузе');
ok(near(A.currentTime, 3.5), 'A на 50% своей длины (3.5с): ' + A.currentTime);

console.log('6) Клавиша B переключает сторону:');
document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', bubbles: true }));
ok(!B.paused && A.paused, 'по клавише B игра перешла на B');
ok(near(B.currentTime, 1.5), 'позиция B — 50%: ' + B.currentTime);

console.log('7) Клик по вейвформе — оба трека на один процент:');
const waveA = host.querySelector('[data-side="A"] .ab-wave');
waveA.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 32 });
click(waveA, { clientX: 25 }); // 25%
ok(near(A.currentTime, 1.75) && near(B.currentTime, 0.75), 'A=1.75с (25% от 7), B=0.75с (25% от 3)');

console.log('8) Страховка: трек стоит на конце без события ended — ▶ перематывает в начало:');
B.currentTime = B.duration; B.ended = true; B.paused = true;
A.paused = true; A.currentTime = 5;
click(playBtn); // active сейчас B
ok(!B.paused && B.currentTime === 0, 'B стартовал с нуля');
ok(A.currentTime === 0, 'A тоже перемотан в начало');

cleanup();
console.log(fails ? `✗ ПРОВАЛЕНО: ${fails}` : '✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);