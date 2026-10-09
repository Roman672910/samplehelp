// Поведенческий тест триммера: зум + маркеры.
// Аудио-стаб: 10с, ровный фон 0.05, ОДИН всплеск (1.0) ровно на 3.5с.
// Проверяем: (1) пин маркера при зуме стоит на правильном времени,
//           (2) высокий бар вейвформы (всплеск) при зуме остаётся ПОД пином.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;

// ---------- Записывающий canvas-контекст ----------
const calls = [];
const gradient = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(_, p) {
      if (p === 'createLinearGradient') return (...a) => { calls.push(['createLinearGradient', ...a]); return gradient; };
      if (typeof p === 'symbol') return undefined;
      return (...a) => { calls.push([p, ...a]); };
    },
    set() { return true; },
  });
}
dom.window.HTMLCanvasElement.prototype.getContext = () => makeCtx();

// ---------- Фейковое аудио ----------
class FakeAudio {
  static instances = [];
  constructor(url) {
    this.src = url; this.paused = true; this.ended = false;
    this.currentTime = 0; this.duration = 10;
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

// AudioBuffer-стаб: 10с @ 8кГц, всплеск на 3.5с
const SR = 8000, DUR = 10, LEN = SR * DUR;
const chan = new Float32Array(LEN).fill(0.05);
chan[Math.floor(3.5 * SR)] = 1.0;
const fakeBuf = { numberOfChannels: 1, length: LEN, sampleRate: SR, duration: DUR, getChannelData: () => chan };
class FakeAC { decodeAudioData() { return Promise.resolve(fakeBuf); } close() {} }
class FakeOfflineAC {
  createBuffer(ch, len, sr) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => data };
  }
}
dom.window.AudioContext = FakeAC;
dom.window.OfflineAudioContext = FakeOfflineAC;
globalThis.AudioContext = FakeAC;
globalThis.OfflineAudioContext = FakeOfflineAC;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { createTrimmer } = await import('../public/js/trimmer.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg} (есть ${a?.toFixed?.(1)}, жду ${b?.toFixed?.(1)} ±${eps})`);

const W = 600;
const host = document.getElementById('host');
const fakeBlob = { arrayBuffer: async () => new ArrayBuffer(8) };
const trimmer = createTrimmer(host, fakeBlob);

const canvas = host.querySelector('#trim-canvas');
Object.defineProperty(canvas, 'clientWidth', { value: W });
Object.defineProperty(canvas, 'clientHeight', { value: 110 });
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: 110 });

await sleep(120); // ждём async-инициализацию (decode + peaks + draw)
ok(host.querySelector('#trim-len').textContent.includes('7.0s'), 'триммер инициализирован: ' + host.querySelector('#trim-len').textContent);

// ---------- Ставим маркер ровно на 3.5с (через паузу превью) ----------
host.querySelector('#trim-preview').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await sleep(30);
const pa = FakeAudio.instances[FakeAudio.instances.length - 1];
pa.pause();
pa.currentTime = 3.5;
host.querySelector('#trim-mark').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await sleep(30);
ok(host.querySelectorAll('#mark-list .mark-chip').length === 1, 'маркер добавился (1 чип)');
ok(host.querySelector('#mark-list .mark-time').textContent.trim() === '0:03', 'чип показывает 0:03 (3.5с от начала региона): ' + host.querySelector('#mark-list .mark-time').textContent);

// ---------- Измерения рисовки ----------
const markerXs = () => calls.filter((c) => c[0] === 'arc' && c[2] === 5 && c[3] === 3).map((c) => c[1]);
const spikeXs = () => calls.filter((c) => c[0] === 'fillRect' && c[4] > 50 && c[4] < 105).map((c) => c[1]);

function redraw(fn) { calls.length = 0; fn(); }

// Ожидаемая позиция пина: (3.5 - viewStart) / (10 / zoom) * W
const expectedPin = (zoom, viewStart) => ((3.5 - viewStart) / (DUR / zoom)) * W;

console.log('\n1) Зум 1× — пин и всплеск на месте:');
// перерисуем через zoom-in/zoom-out, чтобы снять чистые calls; сначала просто текущий кадр:
redraw(() => host.querySelector('#trim-reset').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
await sleep(10);
let pins = markerXs();
ok(pins.length === 1, 'нарисован один пин');
near(pins[0], expectedPin(1, 0), 1.5, 'пин на x=210 (3.5с из 10с)');
let spikes = spikeXs();
ok(spikes.length > 0, 'всплеск виден на вейвформе');
near(Math.min(...spikes), pins[0], 4, 'всплеск начинается у пина (1×)');
near(Math.max(...spikes), pins[0], 5, 'всплеск не уезжает вправо от пина (1×)');

console.log('\n2) Зум 2× (кнопка +):');
redraw(() => host.querySelector('#zoom-in').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
await sleep(10);
pins = markerXs(); spikes = spikeXs();
// якорь = центр (5с): viewStart = 5 - 0.5*5 = 2.5
near(pins[0], expectedPin(2, 2.5), 1.5, 'пин на x=120');
near(Math.min(...spikes), pins[0], 4, 'всплеск у пина (2×)');
near(Math.max(...spikes), pins[0], 6, 'всплеск не уезжает вправо (2×)');

console.log('\n3) Зум 4× Ctrl+колесом К МАРКЕРУ — пин остаётся на месте, всплеск под пином:');
const wheel = (clientX, deltaY, ctrlKey) => canvas.dispatchEvent(new dom.window.WheelEvent('wheel', { clientX, deltaY, ctrlKey, bubbles: true, cancelable: true }));
let pinX = markerXs()[0]; // после шага 2 = 120
redraw(() => wheel(pinX, -100, true)); // зум 2× -> 4×, якорь на пине (3.5с)
await sleep(10);
pins = markerXs(); spikes = spikeXs();
ok(pins.length === 1, 'пин виден после зума к маркеру');
near(pins[0], pinX, 1.5, 'пин остался на том же x (якорь)');
near(Math.min(...spikes), pins[0], 4, 'всплеск у пина (4×)');
near(Math.max(...spikes), pins[0], 5, 'всплеск не уезжает вправо (4×)');

console.log('\n4) Зум 8× Ctrl+колесом к маркеру — максимальный:');
pinX = pins[0];
redraw(() => wheel(pinX, -100, true)); // 4× -> 8×
await sleep(10);
pins = markerXs(); spikes = spikeXs();
ok(pins.length === 1, 'пин виден на 8×');
near(pins[0], pinX, 1.5, 'пин остался на том же x (8×)');
near(Math.min(...spikes), pins[0], 4, 'всплеск у пина (8×) — НЕ левее маркера');
near(Math.max(...spikes), pins[0], 6, 'всплеск не уезжает вправо (8×)');

console.log('\n5) Ctrl+колесо обратно (8× -> 4×) — пин снова неподвижен:');
pinX = pins[0];
redraw(() => wheel(pinX, 100, true));
await sleep(10);
let pins2 = markerXs();
near(pins2[0], pinX, 1.5, 'после Ctrl+колеса по маркеру он остался на том же x');
spikes = spikeXs();
near(Math.min(...spikes), pins2[0], 4, 'всплеск по-прежнему у пина');

console.log('\n6) Колесо без Ctrl — панорама, пин едет вместе с вейвформой:');
const panSlider = host.querySelector('#trim-pan');
redraw(() => wheel(300, -150, false)); // панорама влево на пол-окна
await sleep(10);
const vs = parseFloat(panSlider.value);
pins = markerXs(); spikes = spikeXs();
if (pins.length === 1) {
  near(pins[0], expectedPin(4, vs), 1.5, 'пин соответствует новому viewStart');
  near(Math.min(...spikes), pins[0], 5, 'всплеск едет вместе с пином');
} else {
  ok(pins.length === 0 && spikes.length === 0, 'маркер и всплеск уехали за экран вместе');
}

console.log('\n7) getResult: маркер относительно обрезанного фрагмента:');
const res = await trimmer.getResult();
ok(res.markers.length === 1 && Math.abs(res.markers[0].time - 3.5) < 0.011, 'маркер 3.5с в результате: ' + JSON.stringify(res.markers));

trimmer.destroy();
console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);