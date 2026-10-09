// Поведенческий тест: чипы маркеров = play/pause «от маркера», кнопка ▶ не меняется
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
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'canvas' ? { width: 300, height: 60 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

// Фейковое аудио: play/pause с событиями, как в браузере
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
const { createPlayer } = await import('../public/js/audio.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const click = (el, opts = {}) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...opts }));

const host = document.getElementById('host');
const cleanup = createPlayer(host, {
  url: 'demo.wav',
  waveform: [0.2, 0.5, 0.8],
  markers: [{ time: 10, note: 'рык' }, { time: 30, note: 'дроп' }],
});
const audio = FakeAudio.instances[0];
const chips = [...host.querySelectorAll('.marker-chip')];
const playBtn = host.querySelector('.play-btn');
const wave = host.querySelector('.player-wave');
wave.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 60 });

console.log('1) Клик по маркеру — игра с его момента:');
ok(chips.length === 2, 'два чипа маркеров');
ok(chips[0].title.includes('Слушать с этого момента'), 'подсказка в title: ' + chips[0].title);
click(chips[0]);
ok(!audio.paused && audio.currentTime === 10, 'играет с 0:10');
ok(chips[0].classList.contains('playing'), 'чип подсвечен');
ok(playBtn.textContent === '⏸', 'кнопка ▶ показывает паузу (как обычно)');

console.log('2) Повторный клик по тому же маркеру — пауза:');
click(chips[0]);
ok(audio.paused && audio.currentTime === 10, 'пауза на 0:10');
ok(!chips[0].classList.contains('playing'), 'подсветка снята');

console.log('3) Клик снова — опять игра С МАРКЕРА (не с места паузы):');
audio.currentTime = 25; // имитируем, что пауза была бы дальше
click(chips[0]);
ok(!audio.paused && audio.currentTime === 10, 'снова с 0:10');

console.log('4) Клик по другому маркеру во время игры — переход без остановки:');
click(chips[1]);
ok(!audio.paused && audio.currentTime === 30, 'играет с 0:30');
ok(chips[1].classList.contains('playing') && !chips[0].classList.contains('playing'), 'подсветка переехала на второй чип');
click(chips[1]);
ok(audio.paused, 'повторный клик по играющему второму — пауза');

console.log('5) Кнопка ▶ независима: пауза/игра с текущего места, привязка к маркеру снимается:');
click(playBtn); // сейчас на паузе (после клика по chips[1]) — старт с 0:30
ok(!audio.paused && audio.currentTime === 30, '▶ запустил с текущего места');
ok(!chips.some((c) => c.classList.contains('playing')), 'ни один маркер не подсвечен (игра «не от маркера»)');
click(playBtn);
ok(audio.paused, '▶ поставил на паузу');
click(chips[1]);
ok(!audio.paused && audio.currentTime === 30, 'клик по маркеру снова работает как play от маркера');

console.log('6) Перемотка по вейвформе снимает привязку к маркеру:');
click(wave, { clientX: 25 }); // 25% от 60с = 15с
ok(audio.currentTime === 15, 'перемотало на 0:15');
ok(!chips.some((c) => c.classList.contains('playing')), 'подсветка маркера снята');

console.log('7) Конец трека — привязка сброшена:');
click(chips[0]);
audio.paused = true; audio.ended = true; audio._fire('ended');
ok(!chips[0].classList.contains('playing'), 'после «ended» подсветки нет');
click(chips[0]);
ok(!audio.paused && audio.currentTime === 10, 'после конца трек снова стартует с маркера');

cleanup();
console.log(fails ? `✗ ПРОВАЛЕНО: ${fails}` : '✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);