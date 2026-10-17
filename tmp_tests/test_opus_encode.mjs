// SCALE_PLAN, этап 2 — кодирование загружаемого аудио в Opus:
//  (1) pickRecorderMime: приоритет webm/opus → mp4 (Safari) → ogg; без MediaRecorder — null;
//  (2) toMono: даунмикс стерео → моно (среднее), моно возвращается как есть;
//  (3) encodeOpus БЕЗ MediaRecorder → фолбэк WAV (загрузка не ломается, тесты/jsdom);
//  (4) encodeOpus с MediaRecorder: webm/opus 48 kbps, моно-даунмикс, прогресс 0→1,
//      timeslice 200 мс, контекст закрывается;
//  (5) ошибка рекордера → фолбэк WAV (не reject);
//  (6) prepareUploadAudio: нормализация до -1 dBFS, пики ДО кодирования
//      (одно декодирование на весь конвейер), duration, webm-blob;
//  (7) триммер: принимает AudioBuffer без декодирования; getResult({needAudio:false})
//      — только маркеры (без нарезки/кодирования); getResult() — Opus-blob + 160 пиков.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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
globalThis.URL.revokeObjectURL = () => {};
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;

// ---------- canvas-заглушка (для триммера) ----------
const gradient = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(_, p) {
      if (p === 'createLinearGradient') return () => gradient;
      if (typeof p === 'symbol') return undefined;
      return () => {};
    },
    set() { return true; },
  });
}
dom.window.HTMLCanvasElement.prototype.getContext = () => makeCtx();

// ---------- фейковое аудио ----------
function bufFrom(datas, sr) {
  const len = datas[0].length;
  return { numberOfChannels: datas.length, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => datas[i] };
}
// стерео 2 с @ 8 кГц: L=0.5, R=0.25 → пик 0.5 → gain 1.782 → моно ≈ 0.668
function makeStereoBuf(sr = 8000, dur = 2) {
  const len = sr * dur;
  return bufFrom([new Float32Array(len).fill(0.5), new Float32Array(len).fill(0.25)], sr);
}

class FakeAC {
  static instances = [];
  static decodeCalls = 0;
  static lastSource = null;
  constructor() { this.state = 'running'; this.currentTime = 0; this.closed = false; FakeAC.instances.push(this); }
  decodeAudioData() { FakeAC.decodeCalls++; return Promise.resolve(makeStereoBuf()); }
  createMediaStreamDestination() { return { stream: { id: 'fake-stream' } }; }
  createBufferSource() {
    const self = this;
    return {
      buffer: null,
      connect(node) { return node; },
      start() {
        FakeAC.lastSource = this;
        setTimeout(() => { self.currentTime = this.buffer ? this.buffer.duration : 0; if (this.onended) this.onended(); }, 5);
      },
      onended: null,
    };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; }
}
class FakeOfflineAC {
  constructor(ch, len, sr) { this.ch = ch; this.len = len; this.sr = sr; }
  createBuffer(ch, len, sr) {
    const datas = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => datas[i] };
  }
  createBufferSource() { this._src = { buffer: null, connect(n) { return n; }, start() {} }; return this._src; }
  createGain() { this._gain = { gain: { value: 1 }, connect(n) { return n; } }; return this._gain; }
  get destination() { return {}; }
  startRendering() {
    const b = this._src.buffer, g = this._gain.gain.value;
    const out = this.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const d = b.getChannelData(ch), o = out.getChannelData(ch);
      for (let i = 0; i < d.length; i++) o[i] = d[i] * g;
    }
    return Promise.resolve(out);
  }
}
dom.window.AudioContext = FakeAC;
dom.window.OfflineAudioContext = FakeOfflineAC;
globalThis.AudioContext = FakeAC;
globalThis.OfflineAudioContext = FakeOfflineAC;

// ---------- фейковый MediaRecorder ----------
class FakeMediaRecorder {
  static instances = [];
  static supported = [];   // заполняется по ходу теста
  static failNext = false; // имитация onerror
  static isTypeSupported(m) { return FakeMediaRecorder.supported.includes(m); }
  constructor(stream, opts) {
    this.stream = stream; this.options = opts || {};
    this.mimeType = (opts && opts.mimeType) || 'audio/webm';
    this.state = 'inactive';
    FakeMediaRecorder.instances.push(this);
  }
  start(timeslice) {
    this.state = 'recording'; this.timeslice = timeslice;
    if (FakeMediaRecorder.failNext) {
      FakeMediaRecorder.failNext = false;
      setTimeout(() => { if (this.onerror) this.onerror({ error: new Error('boom') }); }, 2);
      return;
    }
    setTimeout(() => {
      if (this.state !== 'recording') return;
      if (this.ondataavailable) this.ondataavailable({ data: new Blob(['opus-bytes'], { type: this.mimeType }) });
    }, 2);
  }
  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    setTimeout(() => { if (this.onstop) this.onstop(); }, 0);
  }
}
class FakeAudio { constructor(url) { this.src = url; this.paused = true; } play() { return Promise.resolve(); } pause() {} addEventListener() {} }
dom.window.Audio = FakeAudio;
globalThis.Audio = FakeAudio;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { CONFIG } = await import('../public/js/config.mjs');
const {
  pickRecorderMime, toMono, encodeOpus, prepareUploadAudio, normalizeToBuffer, bufferToWavBlob, fixWebmDuration,
} = await import('../public/js/audio.mjs');
const { createTrimmer } = await import('../public/js/trimmer.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };

console.log('0) Конфиг этапа 2:');
ok(CONFIG.OPUS_BITS_PER_SECOND === 48000, 'CONFIG.OPUS_BITS_PER_SECOND = 48000');
ok(CONFIG.OPUS_MONO === true, 'CONFIG.OPUS_MONO = true');

console.log('\n1) pickRecorderMime:');
ok(pickRecorderMime() === null, 'без MediaRecorder → null');
dom.window.MediaRecorder = FakeMediaRecorder;
globalThis.MediaRecorder = FakeMediaRecorder;
FakeMediaRecorder.supported = ['audio/mp4'];
ok(pickRecorderMime() === 'audio/mp4', 'Safari-набор → audio/mp4 (AAC-фолбэк)');
FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
ok(pickRecorderMime() === 'audio/webm;codecs=opus', 'полный набор → webm/opus (приоритет)');
FakeMediaRecorder.supported = [];
ok(pickRecorderMime() === null, 'ни один формат не поддерживается → null');
FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

console.log('\n2) toMono:');
const stereo = bufFrom([Float32Array.from([0.4, 0.4, -0.2, -0.2]), Float32Array.from([0.2, 0.2, 0.0, 0.0])], 8000);
const mono = toMono(stereo);
ok(mono.numberOfChannels === 1 && mono.length === 4, 'стерео → моно-буфер той же длины');
ok(Math.abs(mono.getChannelData(0)[0] - 0.3) < 1e-6, 'значение = среднее каналов: (0.4+0.2)/2 = 0.3 (точность float32)');
ok(toMono(mono) === mono, 'моно-буфер возвращается как есть (без копии)');

console.log('\n3) encodeOpus без MediaRecorder → фолбэк WAV:');
{
  const saved = dom.window.MediaRecorder;
  delete dom.window.MediaRecorder;
  const blob = await encodeOpus(makeStereoBuf());
  ok(blob.type === 'audio/wav', 'blob — WAV (загрузка не ломается в старых браузерах/тестах)');
  // моно по умолчанию: 44 + 16000*2
  ok(blob.size === 44 + 16000 * 2, `моно-WAV: размер ${blob.size} = 44 + 16000×2`);
  const blobStereo = await encodeOpus(makeStereoBuf(), { mono: false });
  ok(blobStereo.size === 44 + 16000 * 2 * 2, 'mono:false → стерео-WAV (каналы сохранены)');
  dom.window.MediaRecorder = saved;
}

console.log('\n4) encodeOpus с MediaRecorder → webm/opus 48k mono + прогресс:');
{
  FakeAC.instances.length = 0;
  const progress = [];
  const blob = await encodeOpus(makeStereoBuf(), { onProgress: (r) => progress.push(r) });
  ok(blob.type === 'audio/webm;codecs=opus', `blob.type = ${blob.type}`);
  ok(blob.size > 0, 'blob не пустой');
  const rec = FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
  ok(rec.options.audioBitsPerSecond === 48000, 'audioBitsPerSecond = 48000 (битрейт плана)');
  ok(rec.options.mimeType === 'audio/webm;codecs=opus', 'mimeType передан рекордеру');
  ok(rec.timeslice === 200, 'start(200) — куски по 200 мс для плавного прогресса');
  ok(FakeAC.lastSource && FakeAC.lastSource.buffer.numberOfChannels === 1, 'в рекордер ушёл МОНО-буфер (даунмикс)');
  ok(progress.length >= 2 && progress[progress.length - 1] === 1, `onProgress: ${progress.length} вызовов, последний = 1`);
  const encAc = FakeAC.instances[FakeAC.instances.length - 1];
  ok(encAc.closed === true, 'AudioContext закрыт после кодирования');
}

console.log('\n5) ошибка рекордера → фолбэк WAV (без reject):');
{
  FakeMediaRecorder.failNext = true;
  const blob = await encodeOpus(makeStereoBuf());
  ok(blob.type === 'audio/wav', 'аудио не потеряно: отдан WAV');
}

console.log('\n6) prepareUploadAudio: нормализация → пики ДО кодирования → Opus:');
{
  FakeAC.decodeCalls = 0;
  const progress = [];
  const file = { arrayBuffer: async () => new ArrayBuffer(8) }; // FakeAC.decodeAudioData вернёт стерео
  const res = await prepareUploadAudio(file, { onProgress: (r) => progress.push(r) });
  ok(FakeAC.decodeCalls === 1, `одно декодирование на конвейер (decodeCalls=${FakeAC.decodeCalls}) — пики не из сжатого blob`);
  ok(res.blob.type === 'audio/webm;codecs=opus', `blob — webm/opus (${res.blob.type})`);
  ok(res.peaks.length === 160, '160 пиков вейвформы');
  // L=0.5→0.891, R=0.25→0.4455, моно=(0.891+0.4455)/2≈0.668
  ok(Math.abs(res.peaks[0] - 0.668) < 0.0011, `пики нормализованного моно: ${res.peaks[0]} ≈ 0.668`);
  ok(res.duration === 2, 'duration = 2 с (из буфера, до кодирования)');
  ok(progress[progress.length - 1] === 1, 'прогресс кодирования проброшен вызывающему');
}

console.log('\n6b) normalizeToBuffer: громкость → -1 dBFS, каналы сохранены:');
{
  const norm = await normalizeToBuffer({ arrayBuffer: async () => new ArrayBuffer(8) });
  ok(norm.numberOfChannels === 2, 'промежуточный буфер остаётся стерео (сжатие — позже, один раз перед загрузкой)');
  const l = norm.getChannelData(0)[0];
  ok(Math.abs(l - 0.891) < 0.001, `пик канала L = ${l.toFixed(4)} ≈ 0.891 (-1 dBFS)`);
}

console.log('\n7) Триммер: AudioBuffer без декодирования + getResult → Opus/пики/маркеры:');
{
  const host = document.createElement('div');
  document.body.appendChild(host);
  const before = FakeAC.decodeCalls;
  const buf = makeStereoBuf(8000, 2);
  const trimmer = createTrimmer(host, buf); // AudioBuffer — не Blob
  let st = null;
  for (let i = 0; i < 50 && !(st = trimmer.getState()); i++) await sleep(20);
  ok(!!st, 'триммер инициализирован');
  ok(FakeAC.decodeCalls === before, 'AudioBuffer принят КАК ЕСТЬ — decodeAudioData не вызывался');
  ok(st && st.duration === 2, 'duration = 2 с из буфера');

  const markersOnly = await trimmer.getResult({ needAudio: false });
  ok(markersOnly.blob === null && Array.isArray(markersOnly.markers), 'needAudio:false → blob=null, маркеры есть (правка без перекодирования)');

  const recCountBefore = FakeMediaRecorder.instances.length;
  const full = await trimmer.getResult();
  ok(FakeMediaRecorder.instances.length === recCountBefore + 1, 'полный getResult задействовал MediaRecorder');
  ok(full.blob.type === 'audio/webm;codecs=opus', `blob — webm/opus (${full.blob.type})`);
  ok(Array.isArray(full.peaks) && full.peaks.length === 160, 'пики (160) извлечены ДО кодирования');
  ok(full.start === 0 && full.end === 2, 'регион: 0–2 с (весь клип ≤ TRIM_MAX_SECONDS)');
  trimmer.destroy();

  // Blob-вход (файл/захват/исходный клип из БД) по-прежнему декодируется
  const host2 = document.createElement('div');
  document.body.appendChild(host2);
  const decBefore = FakeAC.decodeCalls;
  const trimmer2 = createTrimmer(host2, new dom.window.Blob(['x'], { type: 'audio/wav' }));
  let st2 = null;
  for (let i = 0; i < 50 && !(st2 = trimmer2.getState()); i++) await sleep(20);
  ok(!!st2 && FakeAC.decodeCalls === decBefore + 1, 'Blob-вход декодируется (decodeAudioData вызван)');
  const resWav = await trimmer2.getResult(); // в jsdom-среде рекордер доступен → webm
  ok(resWav.blob.type === 'audio/webm;codecs=opus', 'Blob-конвейер тоже заканчивается Opus');
  trimmer2.destroy();
}

console.log('\n8) fixWebmDuration: EBML-патч Duration (маркеры без «подвисания»):');
{
  // Синтетический webm: EBML-шапка, Segment c НЕИЗВЕСТНЫМ размером (как у
  // MediaRecorder), Info c TimecodeScale=1ms и БЕЗ Duration, кластер-заглушка
  const U = (arr) => Uint8Array.from(arr);
  const tcsEl = U([0x2a, 0xd7, 0xb1, 0x84, 0x00, 0x0f, 0x42, 0x40]); // 1 000 000 ns
  const cluster = U([0x1f, 0x43, 0xb6, 0x75, 0x84, 0xde, 0xad, 0xbe, 0xef]);
  const infoPayload = tcsEl;
  const webm = new Blob([
    U([0x1a, 0x45, 0xdf, 0xa3, 0x82, 0x00, 0x00]),           // EBML-шапка
    U([0x18, 0x53, 0x80, 0x67]),                             // Segment id
    U([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),     // размер неизвестен (live)
    U([0x15, 0x49, 0xa9, 0x66, 0x80 | infoPayload.length]),  // Info id + size
    infoPayload,
    cluster,
  ], { type: 'audio/webm' });

  const fixed = await fixWebmDuration(webm, 7123);
  const out = new Uint8Array(await fixed.arrayBuffer());
  const findSeq = (seq) => {
    outer: for (let i = 0; i < out.length - seq.length + 1; i++) {
      for (let j = 0; j < seq.length; j++) if (out[i + j] !== seq[j]) continue outer;
      return i;
    }
    return -1;
  };
  const durAt = findSeq([0x44, 0x89]);
  ok(durAt >= 0, 'элемент Duration (0x4489) вшит в Info');
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const durVal = dv.getFloat64(durAt + 3, false); // id(2)+size(1) → float64 BE
  ok(Math.abs(durVal - 7123) < 0.001, `Duration = ${durVal.toFixed(2)} мс (TimecodeScale учтён)`);
  ok(findSeq([0x1f, 0x43, 0xb6, 0x75]) === out.length - 9, 'кластер остался последним (структура не рассыпалась)');
  const infoSizeIdx = findSeq([0x15, 0x49, 0xa9, 0x66]) + 4;
  ok(out[infoSizeIdx] === (0x80 | (infoPayload.length + 11)), 'размер Info увеличен на 11 байт элемента');

  // Duration УЖЕ есть → патч на месте, длина файла не меняется
  const durEl = U([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webm2 = new Blob([
    U([0x1a, 0x45, 0xdf, 0xa3, 0x82, 0x00, 0x00]),
    U([0x18, 0x53, 0x80, 0x67]),
    U([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    U([0x15, 0x49, 0xa9, 0x66, 0x80 | (infoPayload.length + durEl.length)]),
    infoPayload, durEl, cluster,
  ], { type: 'audio/webm' });
  const fixed2 = await fixWebmDuration(webm2, 4000);
  const out2 = new Uint8Array(await fixed2.arrayBuffer());
  ok(out2.length === (await webm2.arrayBuffer()).byteLength, 'готовый Duration правится на месте (размер тот же)');
  const at2 = (() => {
    for (let i = 0; i < out2.length - 1; i++) if (out2[i] === 0x44 && out2[i + 1] === 0x89) return i;
    return -1;
  })();
  ok(at2 >= 0, 'Duration найден во втором файле');
  const dv2 = new DataView(out2.buffer, out2.byteOffset, out2.byteLength);
  ok(Math.abs(dv2.getFloat64(at2 + 3, false) - 4000) < 0.001, 'значение перезаписано (4000 мс)');

  // Не-webm и mp4 (Safari) — не трогаем
  const mp4 = new Blob([U([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], { type: 'audio/mp4' });
  const same = await fixWebmDuration(mp4, 5000);
  ok(same === mp4, 'mp4/AAC проходит мимо (no-op)');
  const zero = await fixWebmDuration(webm, 0);
  ok(zero === webm, 'durationMs=0 → no-op');
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
