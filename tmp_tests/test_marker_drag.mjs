// Поведенческий тест триммера: перетаскивание маркеров + ▶ «слушать от маркера».
// Аудио-стаб: 10с @ 8кГц, регион по умолчанию [0, 7], W=600 → x = 60 * t.
// Проверяем:
//  (1) пин тащится по волне, чип обновляется живо, есть тултип времени;
//  (2) клик по пину БЕЗ движения ничего не запускает (игра — только ▶ в чипе);
//  (3) маркер не выходит за регион (кламп при драге и при движении границ);
//  (4) пин в приоритете над ручкой начала региона;
//  (5) ▶ играет от маркера, повторный клик — пауза, ещё клик — продолжить;
//  (6) ended/«Прослушать»/удаление сбрасывают подсветку чипа;
//  (7) getResult отдаёт маркеры относительно фрагмента (без «потеряшек»).
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
      if (p === 'measureText') return (txt) => { calls.push(['measureText', txt]); return { width: String(txt).length * 7 }; };
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
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg} (есть ${a?.toFixed?.(3)}, жду ${b?.toFixed?.(3)} ±${eps})`);

const W = 600;
const host = document.getElementById('host');
const fakeBlob = { arrayBuffer: async () => new ArrayBuffer(8) };
const trimmer = createTrimmer(host, fakeBlob);

const canvas = host.querySelector('#trim-canvas');
Object.defineProperty(canvas, 'clientWidth', { value: W });
Object.defineProperty(canvas, 'clientHeight', { value: 110 });
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: 110 });
canvas.setPointerCapture = () => {};
canvas.releasePointerCapture = () => {};

const PE = dom.window.PointerEvent || dom.window.MouseEvent;
const ptr = (type, x) => canvas.dispatchEvent(new PE(type, { clientX: x, clientY: 55, bubbles: true, cancelable: true, pointerId: 1 }));
const pd = (x) => ptr('pointerdown', x);
const pmv = (x) => ptr('pointermove', x);
const pu = (x) => ptr('pointerup', x);
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

const chip = () => host.querySelector('#mark-list .mark-chip');
const chipTime = () => host.querySelector('#mark-list .mark-time').textContent.trim();
const playBtn = () => host.querySelector('#mark-list .mark-play');
const rangeLabel = () => host.querySelector('#trim-range').textContent.trim();
const lastAudio = () => FakeAudio.instances[FakeAudio.instances.length - 1];
// x-координаты активных пинов (радиус 4.5) и обычных (радиус 3) из кадра draw()
const activePinXs = () => calls.filter((c) => c[0] === 'arc' && c[2] === 5 && c[3] === 4.5).map((c) => c[1]);
const pinXs = () => calls.filter((c) => c[0] === 'arc' && c[2] === 5 && c[3] === 3).map((c) => c[1]);

await sleep(120); // async-инициализация (decode + peaks + draw)
ok(host.querySelector('#trim-len').textContent.includes('7.0s'), 'триммер инициализирован: ' + host.querySelector('#trim-len').textContent);
ok(host.textContent.includes('перетащить'), 'подсказка про перетаскивание маркера видна');

// ---------- Ставим маркер на 3.5с (пауза превью + «📍 Маркер») ----------
click(host.querySelector('#trim-preview'));
await sleep(20);
const setupAudio = lastAudio();
setupAudio.pause();
setupAudio.currentTime = 3.5;
click(host.querySelector('#trim-mark'));
await sleep(20);
ok(host.querySelectorAll('#mark-list .mark-chip').length === 1, 'маркер добавился (1 чип)');
ok(chipTime() === '0:03', 'чип: 0:03 (3.5с от начала региона): ' + chipTime());

console.log('\n1) Курсор: «взять» над пином, крестик в стороне:');
calls.length = 0; pmv(210); // пин 3.5с = x210
ok(canvas.style.cursor === 'ew-resize', 'над пином курсор ew-resize: ' + JSON.stringify(canvas.style.cursor));
pmv(100);
ok(canvas.style.cursor === '', 'в стороне курсор сбрасывается (CSS crosshair)');

console.log('\n2) Драг пина 3.5с → 5.0с (x210 → x300):');
calls.length = 0;
pd(210);
const audioBefore = FakeAudio.instances.length;
ok(activePinXs().some((x) => Math.abs(x - 210) < 1.5), 'захваченный пин подсвечен (r=4.5) на x=210');
calls.length = 0;
pmv(300);
ok(chipTime() === '0:05', 'время в чипе обновляется ЖИВЬЁМ: ' + chipTime());
ok(calls.some((c) => c[0] === 'fillText' && c[1] === '5.0s'), 'тултип времени 5.0s у пина');
ok(activePinXs().some((x) => Math.abs(x - 300) < 1.5), 'подсвеченный пин едет за курсором (x=300)');
calls.length = 0;
pu(300);
await sleep(10);
ok(chipTime() === '0:05', 'после отпускания чип: 0:05');
ok(pinXs().length === 1 && activePinXs().length === 0, 'после драга пин снова обычный (r=3)');

console.log('\n3) Клик по пину БЕЗ движения — ничего не запускает:');
const rangeBefore = rangeLabel();
pd(300); pu(300);
await sleep(10);
ok(FakeAudio.instances.length === audioBefore, 'новое аудио НЕ создавалось (пин = только драг)');
ok(rangeLabel() === rangeBefore, 'регион не сдвинулся: ' + rangeLabel());
ok(chipTime() === '0:05', 'маркер остался на 5.0: ' + chipTime());

console.log('\n4) Кламп: драг за конец региона (x540 = 9с) упирается в 7.0:');
pd(300); pmv(540);
ok(chipTime() === '0:07', 'живое время уперлось в конец региона: ' + chipTime());
pu(540);
await sleep(10);
let res = await trimmer.getResult();
near(res.markers[0].time, 7.0, 0.011, 'getResult: маркер 7.0 (не потерялся)');

console.log('\n5) Драг обратно к 4.0с и приоритет пина над ручкой начала региона:');
pd(420); pmv(240); pu(240); // маркер 7.0 → 4.0
await sleep(10);
ok(chipTime() === '0:04', 'маркер снова 4.0: ' + chipTime());
pd(240); pmv(6); pu(6); // маркер 4.0 → 0.1 (x6)
await sleep(10);
ok(chipTime() === '0:00', 'маркер у начала: ' + chipTime());
pd(6); pmv(60); pu(60); // пин в 9px от ручки «начало» — тащится МАРКЕР, не регион
await sleep(10);
ok(chipTime() === '0:01', 'маркер переехал на 1.0с: ' + chipTime());
ok(rangeLabel() === '0:00 — 0:07', 'регион не тронут (пин в приоритете): ' + rangeLabel());
pd(60); pmv(240); pu(240); // обратно к 4.0
await sleep(10);

console.log('\n6) Слайдер конца тянет маркер за собой (регион [0,3]):');
const endSlider = host.querySelector('#trim-end');
endSlider.value = '30';
endSlider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await sleep(10);
ok(rangeLabel() === '0:00 — 0:03', 'регион сжат: ' + rangeLabel());
ok(chipTime() === '0:03', 'маркер подтянут к новой границе: ' + chipTime());
click(host.querySelector('#trim-reset'));
await sleep(10);
ok(rangeLabel() === '0:00 — 0:07', 'сброс вернул регион: ' + rangeLabel());
ok(chipTime() === '0:03', 'маркер остался на 3.0: ' + chipTime());

console.log('\n7) ▶ в чипе: игра от маркера, пауза, продолжить:');
const beforePlay = FakeAudio.instances.length;
click(playBtn());
await sleep(20);
ok(FakeAudio.instances.length === beforePlay + 1, 'создано превью региона');
const markAudio = lastAudio();
near(markAudio.currentTime, 3.0, 0.011, 'старт от маркера (currentTime=3.0)');
ok(markAudio.paused === false, 'идёт воспроизведение');
ok(chip().classList.contains('playing'), 'чип подсвечен (.playing)');
ok(playBtn().textContent === '⏸', 'кнопка стала ⏸');
calls.length = 0;
await sleep(20);
ok(activePinXs().some((x) => Math.abs(x - 180) < 1.5), 'играющий пин подсвечен на волне (x=180)');
click(playBtn()); // пауза
await sleep(10);
ok(markAudio.paused === true, 'повторный клик — пауза');
ok(chip().classList.contains('playing'), 'чип остаётся активным на паузе');
ok(playBtn().textContent === '▶', 'кнопка снова ▶ (можно продолжить)');
click(playBtn()); // продолжить
await sleep(10);
ok(markAudio.paused === false, 'третий клик — продолжили с паузы (без нового аудио)');
ok(FakeAudio.instances.length === beforePlay + 1, 'аудио не пересоздавалось');

console.log('\n8) ended → подсветка гаснет; «Прослушать» → игра с начала региона:');
markAudio._fire('ended');
await sleep(20);
ok(!chip() || !chip().classList.contains('playing'), 'после окончания чип не подсвечен');
click(host.querySelector('#trim-preview'));
await sleep(20);
ok(FakeAudio.instances.length === beforePlay + 2, '«Прослушать» создал новое превью');
near(lastAudio().currentTime, 0, 0.001, 'играет с начала региона (currentTime=0)');
ok(!chip().classList.contains('playing'), 'ни один чип не подсвечен');
lastAudio().pause();

console.log('\n9) Удаление играющего маркера гасит превью:');
click(playBtn()); // снова от маркера 3.0
await sleep(20);
const delAudio = lastAudio();
click(host.querySelector('[data-mrm]'));
await sleep(20);
ok(delAudio.paused === true, 'превью остановлено');
ok(host.querySelectorAll('#mark-list .mark-chip').length === 0, 'маркер удалён');

console.log('\n10) getResult: маркеры относительно фрагмента:');
// новый маркер через «📍»: превью с начала региона, пауза на 2.5с → маркер 2.5
click(host.querySelector('#trim-preview'));
await sleep(20);
lastAudio().pause();
lastAudio().currentTime = 2.5;
click(host.querySelector('#trim-mark'));
await sleep(10);
ok(chipTime() === '0:02', 'новый маркер: 0:02 (2.5с от начала региона): ' + chipTime());
res = await trimmer.getResult();
ok(res.markers.length === 1, 'в результате 1 маркер');
near(res.markers[0].time, 2.5, 0.011, 'маркер 2.5с относительно региона: ' + JSON.stringify(res.markers));
near(res.start, 0, 0.001, 'start=0');
near(res.end, 7, 0.001, 'end=7');

trimmer.destroy();
console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);