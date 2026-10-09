// Форма /ask: черновик, одноразовый захват, блокировка источников, правка с аудио.
// Проверяем:
//  1) смена языка (перерисовка экрана) НЕ сбрасывает форму: текст, синтезатор
//     «Другой», категория, аудио, регион трима и маркеры восстанавливаются из черновика;
//  2) захват с компьютера — одноразовый: после записи/отмены вторая кнопка
//     «⏺ Захват с компьютера» не появляется (UI рекордера убирается целиком);
//  3) пока аудио добавляется/добавлено — кнопки источника заблокированы,
//     видна «✕ Очистить аудио»; очистка (через модалку) возвращает кнопки в работу;
//  4) правка /ask?edit=<id>: исходное аудио вопроса ЗАГРУЖАЕТСЯ В ТРИММЕР
//     (вейвформа + маркеры — можно подвинуть), «подвинул только маркеры» не
//     перезагружает файл, обрезка региона — перезагружает, «Очистить» + save убирает аудио.
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
// jsdom-Blob глобально: демо-uploadAudio читает его своим FileReader
globalThis.Blob = dom.window.Blob;
globalThis.FileReader = dom.window.FileReader;

// ---------- Canvas: записывающий контекст-заглушка ----------
const ctx2d = () => new Proxy({}, {
  get: (t, p) => (p === 'measureText' ? () => ({ width: 10 })
    : p === 'createLinearGradient' ? () => ({ addColorStop() {} })
      : p === 'canvas' ? { width: 300, height: 60 }
        : typeof p === 'symbol' ? undefined : () => {}),
  set: () => true,
});
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

// ---------- Фейковое аудио (10 с @ 8 кГц, всплеск на 3.5 с) ----------
const SR = 8000, DUR = 10, LEN = SR * DUR;
const chan = new Float32Array(LEN).fill(0.05);
chan[Math.floor(3.5 * SR)] = 1.0;
const fakeBuf = { numberOfChannels: 1, length: LEN, sampleRate: SR, duration: DUR, getChannelData: () => chan };

class FakeAC {
  decodeAudioData() { return Promise.resolve(fakeBuf); }
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() {
    return { fftSize: 256, frequencyBinCount: 8, getByteFrequencyData: (a) => a.fill(20) };
  }
  close() {}
}
class FakeOfflineAC {
  constructor(ch, len, sr) { this._ch = ch; this._len = len; this._sr = sr; this.destination = {}; }
  createBufferSource() { return { buffer: null, connect: (x) => x, start() {} }; }
  createGain() { return { gain: { value: 1 }, connect: (x) => x }; }
  createBuffer(ch, len, sr) {
    const data = new Float32Array(len);
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: () => data };
  }
  async startRendering() {
    const data = new Float32Array(this._len).fill(0.05);
    return { numberOfChannels: this._ch, length: this._len, sampleRate: this._sr, duration: this._len / this._sr, getChannelData: () => data };
  }
}
dom.window.AudioContext = FakeAC;
dom.window.OfflineAudioContext = FakeOfflineAC;
globalThis.AudioContext = FakeAC;
globalThis.OfflineAudioContext = FakeOfflineAC;

// ---------- Захват с компьютера: getDisplayMedia + MediaRecorder ----------
let gdmMode = 'resolve'; // 'resolve' | 'reject' (пользователь отменил выбор источника)
function makeStreamStub() {
  const videoTrack = { kind: 'video', stop() {} };
  const audioTrack = { kind: 'audio', stop() {}, addEventListener() {} };
  return {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [audioTrack],
    getTracks: () => [videoTrack, audioTrack],
  };
}
Object.defineProperty(dom.window.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    async getDisplayMedia() {
      if (gdmMode === 'reject') throw new Error('user cancelled');
      return makeStreamStub();
    },
  },
});
class FakeMediaStream {
  constructor(tracks) { this._t = tracks || []; }
  getAudioTracks() { return this._t; }
  getVideoTracks() { return []; }
  getTracks() { return this._t; }
}
class FakeMediaRecorder {
  static isTypeSupported(m) { return m === 'audio/webm;codecs=opus' || m === 'audio/webm'; }
  constructor(stream, opts) {
    this.stream = stream;
    this.mimeType = (opts && opts.mimeType) || 'audio/webm';
    this.state = 'inactive';
  }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['chunk-1'], { type: this.mimeType }) });
      this.onstop?.({});
    }, 0);
  }
}
globalThis.MediaStream = FakeMediaStream;
dom.window.MediaStream = FakeMediaStream;
globalThis.MediaRecorder = FakeMediaRecorder;
dom.window.MediaRecorder = FakeMediaRecorder;

// ---------- Локали с диска + аудио-URL (blob:/data:) для правки ----------
const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  if (String(url).startsWith('blob:') || String(url).startsWith('data:')) {
    return { ok: true, blob: async () => new Blob(['fake-wav-bytes']) };
  }
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { renderAskQuestion } = await import('../public/js/question.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const ev = (type) => new dom.window.Event(type, { bubbles: true });
const captureButtons = () => [...app.querySelectorAll('button')].filter((b) => b.textContent.includes('Захват с компьютера'));

setState({ user: { id: 'u-demo', username: 'DemoUser' } });

console.log('1) Первый вход в /ask: источники активны, «Очистить» скрыта:');
let cleanup = await renderAskQuestion(app);
const fileBtn = () => app.querySelector('#ask-file-btn');
const captureBtn = () => app.querySelector('#ask-capture-btn');
const clearBtn = () => app.querySelector('#ask-clear-audio');
ok(!fileBtn().disabled && !captureBtn().disabled, 'кнопки источника активны');
ok(clearBtn().hidden, '«Очистить аудио» скрыта');
ok(!app.querySelector('#trim-canvas'), 'триммера нет');

console.log('\n2) Заполняем форму + загружаем аудио файлом:');
const title = app.querySelector('#ask-title');
const desc = app.querySelector('#ask-desc');
const synth = app.querySelector('#ask-synth');
const custom = app.querySelector('#custom-synth-input');
const category = app.querySelector('#ask-category');
title.value = 'Как сделать рычащий бас?'; title.dispatchEvent(ev('input'));
desc.value = 'Пробовал FM — грязь не та'; desc.dispatchEvent(ev('input'));
synth.value = '__other__'; synth.dispatchEvent(ev('change'));
custom.value = 'MyCustomSynth'; custom.dispatchEvent(ev('input'));
category.value = 'fx'; category.dispatchEvent(ev('change'));

const audioInput = app.querySelector('#ask-audio');
Object.defineProperty(audioInput, 'files', { configurable: true, value: [{ name: 'demo.wav', arrayBuffer: async () => new ArrayBuffer(16) }] });
audioInput.dispatchEvent(ev('change'));
await tick(120);
ok(!!app.querySelector('#trim-canvas'), 'триммер создан');
ok(fileBtn().disabled && captureBtn().disabled, 'источники заблокированы, пока аудио на экране');
ok(!clearBtn().hidden, '«Очистить аудио» видна');
ok(fileBtn().title.includes('Очистить аудио'), 'подсказка на заблокированной кнопке: ' + fileBtn().title);

console.log('\n3) Правим регион и ставим маркер:');
const endSlider = app.querySelector('#trim-end');
endSlider.value = '50'; endSlider.dispatchEvent(ev('input')); // end = 5.0с
app.querySelector('#trim-mark').click();                       // маркер на 0с
const note = app.querySelector('.mark-note');
note.value = 'рык тут'; note.dispatchEvent(ev('input'));
const rangeBefore = app.querySelector('#trim-range').textContent;
ok(app.querySelectorAll('.mark-chip').length === 1, 'один чип маркера');
ok(rangeBefore.includes('0:05'), 'регион до 5с: ' + rangeBefore);

console.log('\n4) Смена языка (cleanup + перерисовка, как в роутере):');
cleanup?.();
cleanup = await renderAskQuestion(app);
await tick(120);
ok(app.querySelector('#ask-title').value === 'Как сделать рычащий бас?', 'заголовок пережил смену языка');
ok(app.querySelector('#ask-desc').value === 'Пробовал FM — грязь не та', 'описание пережило смену языка');
ok(app.querySelector('#ask-synth').value === '__other__', 'выбран «Другой…»');
ok(app.querySelector('#custom-synth-row').style.display === 'block'
  && app.querySelector('#custom-synth-input').value === 'MyCustomSynth', 'поле своего синтезатора видно и заполнено');
ok(app.querySelector('#ask-category').value === 'fx', 'категория восстановлена');
ok(!!app.querySelector('#trim-canvas'), 'триммер восстановлен из черновика');
ok(app.querySelector('#trim-range').textContent === rangeBefore,
  `регион тот же: ${app.querySelector('#trim-range').textContent} === ${rangeBefore}`);
const chips = app.querySelectorAll('.mark-chip');
ok(chips.length === 1 && app.querySelector('.mark-note').value === 'рык тут', 'маркер и заметка восстановлены');
ok(fileBtn().disabled && captureBtn().disabled && !clearBtn().hidden, 'блокировка источников сохранена');

console.log('\n5) «Очистить аудио» → модалка → кнопки снова в работе:');
clearBtn().click();
await tick(30);
const yesBtn = document.querySelector('#modal-root [data-act="yes"]');
ok(!!yesBtn, 'модалка подтверждения открыта');
yesBtn?.click();
await tick(60);
ok(!app.querySelector('#trim-canvas') && !app.querySelector('.mark-chip'), 'триммер и маркеры убраны');
ok(!fileBtn().disabled && !captureBtn().disabled, 'источники снова активны');
ok(clearBtn().hidden, '«Очистить аудио» скрыта');

console.log('\n6) Захват: отмена выбора источника — второй кнопки нет:');
gdmMode = 'reject';
captureBtn().click();
await tick(60);
ok(app.querySelector('#capture-slot').children.length === 0, 'capture-slot пуст');
ok(captureButtons().length === 1, 'кнопка «Захват с компьютера» одна');
ok(!captureBtn().disabled, 'кнопка захвата активна (аудио не появилось)');

console.log('\n7) Захват: записали — вторая кнопка НЕ появляется, аудио в триммере:');
gdmMode = 'resolve';
captureBtn().click();
await tick(60);
const readyEl = app.querySelector('#capture-slot .rec-ready');
ok(!!readyEl && !readyEl.hidden, 'панель «сигнал захвачен» видна');
app.querySelector('#capture-slot .rec-start-btn').click();
await tick(30);
ok(!app.querySelector('#capture-slot .rec-ui').hidden, 'идёт запись (таймер/уровень)');
app.querySelector('#capture-slot .rec-stop').click();
await tick(200);
ok(app.querySelector('#capture-slot').children.length === 0, 'после остановки UI рекордера убран (singleShot)');
ok(captureButtons().length === 1, 'кнопка «Захват с компьютера» ровно одна');
ok(!!app.querySelector('#trim-canvas'), 'захваченное аудио попало в триммер');
ok(fileBtn().disabled && captureBtn().disabled && !clearBtn().hidden, 'источники заблокированы, «Очистить» видна');

console.log('\n8) Смена языка после захвата — аудио переживает перерисовку:');
cleanup?.();
cleanup = await renderAskQuestion(app);
await tick(120);
ok(!!app.querySelector('#trim-canvas'), 'триммер с захваченным аудио восстановлен');
ok(app.querySelector('#ask-title').value === 'Как сделать рычащий бас?', 'черновик текста на месте');
ok(fileBtn().disabled && captureBtn().disabled, 'блокировка на месте');
cleanup?.();

// ================= ПРАВКА СУЩЕСТВУЮЩЕГО ВОПРОСА =================
// q1 (демо): владелец u-max, аудио ~4с, два маркера (0.8 «тот самый рык», 2.6 «хвост…»).
// В демо audio_url — blob:/data:, их отдаёт fetch-стаб; декодирует FakeAC (10с).
const submitForm = () => app.querySelector('#ask-form')
  .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const goEdit = () => dom.window.history.pushState({}, '', '/ask?edit=q1');

console.log('\n9) Правка /ask?edit=q1: исходное аудио и маркеры видны в триммере:');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
goEdit();
cleanup = await renderAskQuestion(app);
await tick(150);
ok(!!app.querySelector('#trim-canvas'), 'триммер с исходным аудио загружен');
const notes9 = [...app.querySelectorAll('.mark-note')].map((i) => i.value);
ok(app.querySelectorAll('.mark-chip').length === 2, 'оба маркера вопроса на месте');
ok(notes9[0] === 'тот самый рык' && notes9[1] === 'хвост уплывает по высоте',
  'заметки маркеров из БД: ' + JSON.stringify(notes9));
ok(fileBtn().disabled && captureBtn().disabled && !clearBtn().hidden,
  'источники заблокированы, «Очистить аудио» видна');
ok(app.querySelector('#ask-title').value.includes('рычащий'), 'заголовок вопроса в поле');

console.log('\n10) Подвинул только заметку маркера → save: файл и пики НЕ перезагружаются:');
const qBefore = await sb.fetchQuestion('q1');
const waveBefore = JSON.stringify(qBefore.waveform_data);
const urlBefore = qBefore.audio_url;
const note0 = app.querySelectorAll('.mark-note')[0];
note0.value = 'подвинул заметку'; note0.dispatchEvent(ev('input'));
submitForm();
await tick(300);
const q10 = await sb.fetchQuestion('q1');
ok(q10.markers.length === 2 && q10.markers[0].note === 'подвинул заметку',
  'маркер сохранён: ' + JSON.stringify(q10.markers[0]));
ok(JSON.stringify(q10.waveform_data) === waveBefore, 'пики не пересчитывались (файл не тронут)');
ok(q10.audio_url === urlBefore, 'audio_url не изменился');
cleanup?.();

console.log('\n11) Обрезал регион → save: новый файл + пики + маркеры:');
goEdit();
cleanup = await renderAskQuestion(app);
await tick(150);
const endS = app.querySelector('#trim-end');
endS.value = '50'; endS.dispatchEvent(ev('input')); // end = 5с из 10
submitForm();
await tick(350);
const q11 = await sb.fetchQuestion('q1');
ok(String(q11.audio_url).startsWith('data:'),
  'аудио загружено заново (в демо — dataURL): ' + String(q11.audio_url).slice(0, 24) + '…');
ok(JSON.stringify(q11.waveform_data) !== waveBefore, 'пики пересчитаны по новому клипу');
ok(q11.markers.length === 2 && q11.markers[0].note === 'подвинул заметку',
  'маркеры переехали вместе с файлом');
cleanup?.();

console.log('\n12) Очистил аудио в правке → save: вопрос без маркеров:');
goEdit();
cleanup = await renderAskQuestion(app);
await tick(150);
clearBtn().click();
await tick(30);
document.querySelector('#modal-root [data-act="yes"]')?.click();
await tick(60);
ok(!app.querySelector('#trim-canvas'), 'триммер убран');
ok(!fileBtn().disabled && !captureBtn().disabled && clearBtn().hidden, 'источники разблокированы');
submitForm();
await tick(300);
const q12 = await sb.fetchQuestion('q1');
ok(Array.isArray(q12.markers) && q12.markers.length === 0, 'маркеры очищены');
// audio_url в демо-БД регенерируется из audio_kind при чтении — это особенность
// демо-материализации; в реальном режиме payload.audio_url=null удалит файл.
cleanup?.();

console.log('\n13) Смена языка в режиме правки — аудио и поля переживают:');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
goEdit();
cleanup = await renderAskQuestion(app);
await tick(150);
ok(!!app.querySelector('#trim-canvas'), 'исходное аудио загружено в триммер');
const titleE = app.querySelector('#ask-title');
titleE.value = 'Новый заголовок'; titleE.dispatchEvent(ev('input'));
cleanup?.();                       // роутер: cleanup…
cleanup = await renderAskQuestion(app); // …и перерисовка на i18n:changed
await tick(150);
ok(app.querySelector('#ask-title').value === 'Новый заголовок', 'текст пережил смену языка');
ok(!!app.querySelector('#trim-canvas'), 'триммер с исходным аудио пережил смену языка');
ok(fileBtn().disabled && !clearBtn().hidden, 'блокировка и «Очистить» на месте');
cleanup?.();

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);