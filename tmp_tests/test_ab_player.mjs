// A/B-плеер после редизайна 2026-10-11 (просьба заказчика):
// кнопки play НЕТ; клик по стороне = play/pause этой стороны; старт ВСЕГДА
// с начала; одновременно играет одна сторона; клавиши A/B/Space = те же клики.
//  1) старт: ничего не играет; клик по A → A с 0:00, row.playing;
//  2) пауза по повторному клику (позиция сохраняется для UI, но следующий
//     старт всё равно с 0);
//  3) третий клик → снова с 0:00 (не с паузы);
//  4) клик по B во время игры A → B с 0:00, A на паузе; active-подсветка;
//  5) ended стороны → currentTime=0, playing-класс снят;
//  6) клавиатура: b / a / Space переключают и тумблят стороны;
//  7) cleanup гасит оба аудио.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

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
const ctx2d = () => new Proxy({}, {
  get: (t, p) => (p === 'measureText' ? () => ({ width: 10 })
    : p === 'createLinearGradient' ? () => ({ addColorStop() {} })
      : p === 'canvas' ? { width: 300, height: 60 }
        : typeof p === 'symbol' ? undefined : () => {}),
  set: () => true,
});
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

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
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const key = (k) => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

const host = document.getElementById('host');
const cleanup = createABPlayer(host, {
  a: { url: 'question.webm', waveform: [0.2, 0.5, 0.8], label: 'Вопрос (референс)' },
  b: { url: 'answer.webm', waveform: [0.3, 0.9, 0.4], label: 'Ответ' },
});
const [A, B] = FakeAudio.instances;
A.duration = 7;
B.duration = 3;
A._fire('loadedmetadata');
B._fire('loadedmetadata');

const rowA = host.querySelector('[data-side="A"]');
const rowB = host.querySelector('[data-side="B"]');

console.log('1) Стартовый вид: кнопки play нет, ничего не играет:');
ok(!host.querySelector('.ab-play') && !host.querySelector('.ab-toggle'), 'кнопки play и переключателя A/B больше нет');
ok(A.paused && B.paused, 'обе стороны на паузе');
ok(host.querySelector('.ab-hint').textContent.includes('всегда с начала'), 'подсказка объясняет новую семантику');

console.log('\n2) Клик по A → играет с 0:00:');
click(rowA);
ok(!A.paused && B.paused, 'A играет, B молчит');
ok(A.currentTime === 0, 'A стартовал с 0:00');
ok(rowA.classList.contains('playing') && rowA.classList.contains('active'), 'row A: .playing + .active');

console.log('\n3) Пауза и повторный старт — всегда с начала:');
A.currentTime = 2.5;
click(rowA);
ok(A.paused, 'повторный клик — пауза');
ok(A.currentTime === 2.5, 'позиция паузы видна (2.5)');
ok(!rowA.classList.contains('playing'), '.playing снят');
click(rowA);
ok(!A.paused && A.currentTime === 0, 'третий клик — снова с 0:00, не с 2.5');

console.log('\n4) Клик по B во время игры A:');
A.currentTime = 4;
click(rowB);
ok(!B.paused && A.paused, 'B играет, A встал на паузу');
ok(B.currentTime === 0, 'B с 0:00');
ok(rowB.classList.contains('active') && rowB.classList.contains('playing'), 'row B: .active + .playing');
ok(!rowA.classList.contains('active'), 'с A снят .active');
ok(host.querySelector('.ab-dur').textContent === '0:03', 'длительность в UI — активной стороны (B, 3 с)');

console.log('\n5) ended стороны:');
B.currentTime = 3;
B.paused = true; // реальный браузер на ended сам встаёт на паузу — эмулируем
B._fire('ended');
ok(B.currentTime === 0, 'после окончания трек сброшен в 0');
ok(!rowB.classList.contains('playing'), '.playing снят после ended');

console.log('\n6) Клавиатура A/B/Space:');
key('a');
ok(!A.paused && B.paused, 'клавиша a → играет A');
A.currentTime = 1.2;
key(' ');
ok(A.paused, 'Space по активной стороне → пауза');
key(' ');
ok(!A.paused && A.currentTime === 0, 'Space снова → старт с 0:00');
key('b');
key('ф'); // русская раскладка = A
ok(!A.paused && B.paused, '«ф» (русская A) переключило обратно на A');

console.log('\n7) cleanup:');
cleanup();
ok(A.paused && B.paused, 'оба трека остановлены');
ok(A.src === '' && B.src === '', 'src очищены');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
