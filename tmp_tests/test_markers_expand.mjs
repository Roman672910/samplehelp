// Маркеры «вот этот момент»: лимит 2 (вопрос и ответ), пины+чипы в мини-плеере,
// пикер маркеров в форме ответа. В комментариях маркеров НЕТ (убраны).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="host"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
globalThis.URL.revokeObjectURL = () => {};
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;

// ---------- Записывающий canvas-контекст ----------
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

// ---------- Фейковое аудио: play автоматически сообщает метаданные ----------
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
  play() {
    this.paused = false; this.ended = false;
    this._fire('play');
    if (!this._metaFired) { this._metaFired = true; this._fire('loadedmetadata'); }
    return Promise.resolve();
  }
  pause() { if (this.paused) return Promise.resolve(); this.paused = true; this._fire('pause'); return Promise.resolve(); }
}
globalThis.Audio = FakeAudio;
dom.window.Audio = FakeAudio;

// AudioContext-стабы для триммера (10с аудио)
const SR = 8000, DUR = 10, LEN = SR * DUR;
const chan = new Float32Array(LEN).fill(0.05);
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
const { CONFIG } = await import('../public/js/config.mjs');
const { setState } = await import('../public/js/store.mjs');
const { attachMiniPlayer, createMarkerPicker } = await import('../public/js/audio.mjs');
const { createTrimmer } = await import('../public/js/trimmer.mjs');
const { answerCardHtml, commentItemHtml, renderQuestion } = await import('../public/js/question.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const click = (el, opts = {}) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, ...opts }));
const lastAudio = () => FakeAudio.instances[FakeAudio.instances.length - 1];
const blob = () => new dom.window.Blob(['x'], { type: 'audio/wav' });

console.log('0) Конфиг:');
ok(CONFIG.MAX_MARKERS === 2, 'CONFIG.MAX_MARKERS = 2');

console.log('1) Пикер маркеров в форме ответа:');
const pHost = document.createElement('div');
document.body.appendChild(pHost);
const picker = createMarkerPicker(pHost, { blob: blob(), peaks: [0.3, 0.9, 0.2], duration: 60, max: CONFIG.MAX_MARKERS });
const pickerAudio = lastAudio();
const markBtn = pHost.querySelector('.picker-mark');
ok(!!pHost.querySelector('.picker-wave') && !!markBtn, 'вейвформа + кнопка «📍 Маркер»');
pickerAudio.currentTime = 3.4;
click(markBtn);
ok(pHost.querySelectorAll('.picker-list .mark-chip').length === 1, 'первый маркер добавлен');
ok(pHost.querySelector('.picker-list .mark-chip').textContent.includes('0:03'), 'чип показывает 0:03');
pickerAudio.currentTime = 10.25;
click(markBtn);
ok(pHost.querySelectorAll('.picker-list .mark-chip').length === 2, 'второй маркер добавлен');
ok(markBtn.disabled === true, 'на лимите 2 кнопка «📍» заблокирована');
click(markBtn); // даже принудительный клик не добавляет третий
ok(pHost.querySelectorAll('.picker-list .mark-chip').length === 2, 'третий маркер НЕ добавился');
click(pHost.querySelector('.picker-list [data-mrm]')); // ✕ у первого (3.4)
ok(pHost.querySelectorAll('.picker-list .mark-chip').length === 1, 'удаление ✕ работает');
ok(markBtn.disabled === false, 'после удаления кнопка снова активна');
const val = picker.getValue();
ok(val.length === 1 && val[0].time === 10.25 && val[0].note === '', 'getValue: [{time:10.25, note:""}]');
picker.destroy();
ok(pHost.innerHTML === '', 'destroy очищает контейнер');

console.log('2) Мини-плеер: пины-чипы маркеров (лента/аудио ответов):');
const wrap = document.createElement('div');
wrap.innerHTML = '<canvas class="mini-wave"></canvas>';
document.body.appendChild(wrap);
const mCanvas = wrap.querySelector('canvas');
attachMiniPlayer(mCanvas, 'demo.wav', [0.2, 0.5, 0.8], [{ time: 10, note: 'рык' }, { time: 30, note: '' }]);
const chips = [...wrap.querySelectorAll('.mini-marker-list .marker-chip')];
ok(chips.length === 2, 'два чипа под вейвформой');
ok(chips[0].textContent.includes('0:10') && chips[0].textContent.includes('рык'), 'чип: время + заметка');
click(chips[0]);
ok(!lastAudio().paused && lastAudio().currentTime === 10, 'клик по чипу — игра с 0:10');
ok(chips[0].classList.contains('playing'), 'чип подсвечен');
click(chips[0]);
ok(lastAudio().paused && lastAudio().currentTime === 10, 'повторный клик — пауза, позиция остаётся');
ok(!chips[0].classList.contains('playing'), 'подсветка снята');
click(chips[1]);
ok(!lastAudio().paused && lastAudio().currentTime === 30, 'другой чип — игра с 0:30');
ok(chips[1].classList.contains('playing') && !chips[0].classList.contains('playing'), 'подсветка переехала');
click(mCanvas);
ok(lastAudio().paused && !chips[1].classList.contains('playing'), 'клик по вейвформе во время игры — пауза, подсветка маркера снята');
click(mCanvas);
ok(!lastAudio().paused && lastAudio().currentTime === 0, 'повторный клик по вейвформе — игра с начала');
// повторное привязывание не дублирует чипы
attachMiniPlayer(mCanvas, 'demo.wav', [0.2], [{ time: 10 }]);
ok(wrap.querySelectorAll('.mini-marker-list').length === 1, 'повторный attachMiniPlayer не дублирует чипы');

console.log('3) HTML-фрагменты: data-markers у canvas ответа, в комментариях маркеров нет:');
const cardHtml = answerCardHtml({
  id: 'ax', user_id: 'u-1', content: 'текст', audio_url: 'a.wav', waveform_data: [0.1],
  markers: [{ time: 1.5, note: '' }], comments: [], created_at: new Date().toISOString(),
}, false, 'u-2', null);
ok(cardHtml.includes('data-markers='), 'canvas ответа несёт data-markers');
ok(!cardHtml.includes('comment-marker'), 'в форме комментария кнопки «📍» больше нет');
const noAudioHtml = answerCardHtml({ id: 'ay', user_id: 'u-1', content: 'т', comments: [], created_at: new Date().toISOString() }, false, 'u-2', null);
ok(!noAudioHtml.includes('comment-marker'), 'без аудио ответа — тоже без «📍»');
ok(!commentItemHtml({ id: 'c', content: 'слушай тут', marker_time: 2.8, author: { username: 'A' }, created_at: new Date().toISOString() }).includes('comment-chip'), 'даже со старым marker_time чип НЕ рендерится');
ok(commentItemHtml({ id: 'c', content: 'без момента', author: { username: 'A' }, created_at: new Date().toISOString() }).includes('comment-marker-chip') === false, 'без marker_time чипа нет');

console.log('4) Страница вопроса q1 (демо-сиды): маркеры ответа a1, комментарии без маркеров:');
setState({ user: { id: 'u-demo', username: 'DemoUser', email: 'demo@example.com' } });
const app = document.getElementById('app');
const cleanup = await renderQuestion(app, { id: 'q1' });
await sleep(120);
const a1 = app.querySelector('[data-answer-id="a1"]');
ok(!!a1, 'карточка ответа a1 найдена');
const a1Canvas = a1.querySelector('canvas[data-answer-audio]');
ok(JSON.parse(a1Canvas.dataset.markers).length === 2, 'сид-маркеры a1 доехали до canvas (2 шт.)');
ok(a1.querySelectorAll('.mini-marker-list .marker-chip').length === 2, 'чипы маркеров a1 отрисованы');
ok(!a1.querySelector('[data-act="comment-chip"]'), 'в комментариях q1 чипов момента нет (сиды без marker_time)');

console.log('5) Комментарий — как было, без отметок момента:');
const form = a1.querySelector('.comment-form');
ok(!form.querySelector('.comment-marker-btn') && !form.querySelector('.comment-marker-pending'), 'в форме комментария нет элементов маркера');
const input = form.querySelector('.comment-input');
const countEl = a1.querySelector('.comments-count');
const before = Number(countEl.textContent);
input.value = 'Обычный комментарий без отметок';
click(form.querySelector('[data-act="add-comment"]'));
await sleep(80);
ok(Number(countEl.textContent) === before + 1, `комментарий добавлен (${before} → ${countEl.textContent})`);
const items = [...a1.querySelectorAll('.comment-item')];
ok(!items[items.length - 1].querySelector('[data-act="comment-chip"]'), 'у нового комментария нет чипа момента');
cleanup?.();

console.log('6) Триммер вопроса: не больше 2 маркеров:');
const th = document.createElement('div');
document.body.appendChild(th);
const trimmer = createTrimmer(th, blob());
await sleep(60);
const trimMarkBtn = th.querySelector('#trim-mark');
click(trimMarkBtn);
click(trimMarkBtn);
ok(th.querySelectorAll('#mark-list .mark-chip').length === 2, 'два маркера добавлены');
ok(trimMarkBtn.disabled === true, 'кнопка «📍» заблокирована на лимите');
ok(trimMarkBtn.title.includes('максимум 2'), 'подсказка о лимите: ' + trimMarkBtn.title);
click(trimMarkBtn);
ok(th.querySelectorAll('#mark-list .mark-chip').length === 2, 'третий маркер НЕ добавился');
click(th.querySelector('#mark-list [data-mrm]'));
ok(th.querySelectorAll('#mark-list .mark-chip').length === 1 && !trimMarkBtn.disabled, 'после удаления — снова можно');
const res = await trimmer.getResult();
ok(res.markers.length === 1, 'getResult отдаёт 1 маркер');
trimmer.destroy();

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);