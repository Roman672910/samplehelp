// Всё без форматирования: plainText, описание вопроса, ответы, комментарии;
// запрет ссылок в комментариях и в описании вопроса; форма «Задать вопрос» без тулбара
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
globalThis.Audio = dom.window.Audio;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'canvas' ? { width: 300, height: 60 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const { plainText, formatText } = await import('../public/js/format.mjs');
const { renderQuestion, renderAskQuestion, commentItemHtml } = await import('../public/js/question.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = () => new Promise((r) => setTimeout(r, 60));

console.log('1) plainText — юнит:');
ok(plainText('**жирный** и *курсив* и `код`') === 'жирный и курсив и код', 'маркеры **,*,` сняты');
ok(plainText('> цитата') === 'цитата', 'префикс цитаты снят');
ok(plainText('- пункт 1\n* пункт 2') === 'пункт 1<br>пункт 2', 'списки сняты, перенос → <br>');
ok(plainText('строка1\nстрока2') === 'строка1<br>строка2', 'переносы строк сохраняются');
ok(plainText('<script>alert(1)</script>').includes('&lt;script&gt;'), 'HTML экранируется');
ok(!plainText('смотри https://example.com').includes('<a'), 'ссылки НЕ кликабельны');
ok(plainText('') === '' && plainText(null) === '', 'пусто/null → пустая строка');
ok(formatText('**текст**').includes('<strong>'), 'formatText (запас, больше не используется) не сломан');

console.log('2) Страница вопроса q1 — ответы и комментарии без fmt:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
const cleanup = await renderQuestion(app, { id: 'q1' });
await tick();
const contents = [...app.querySelectorAll('.answer-content')];
ok(contents.length > 0, 'ответы отрендерились: ' + contents.length);
ok(contents.every((el) => !el.classList.contains('fmt')), 'у .answer-content нет класса fmt');
ok(!app.querySelector('.answer-content strong') && !app.querySelector('.answer-content a'), 'в ответах нет <strong>/<a>');
const qBody = app.querySelector('.question-body');
ok(!!qBody && !qBody.classList.contains('fmt'), 'описание вопроса — простой текст (без класса fmt)');
ok(!qBody.querySelector('strong') && !qBody.querySelector('a'), 'в описании вопроса нет <strong>/<a>');
const commentTexts = [...app.querySelectorAll('.comment-text')];
ok(commentTexts.every((el) => !el.classList.contains('fmt')), 'у .comment-text нет класса fmt');
ok(commentItemHtml({ id: 'x', content: '**привет** https://a.b', author: { username: 'A' }, created_at: new Date().toISOString() }).includes('привет https://a.b'), 'commentItemHtml рендерит простой текст');

console.log('3) Запрет ссылок в комментариях:');
const card = app.querySelector('[data-answer-id="a1"], .answer-card');
ok(!!card, 'карточка ответа найдена');
const input = card.querySelector('.comment-input');
const countEl = card.querySelector('.comments-count');
const before = countEl.textContent;
input.value = 'зацени https://evil-phishing.com/x';
card.querySelector('[data-act="add-comment"]').click();
await tick();
ok(countEl.textContent === before, 'комментарий со ссылкой НЕ добавлен');
ok(document.getElementById('toast-container').textContent.includes('Ссылки в комментариях запрещены'), 'показана ошибка: ' + document.getElementById('toast-container').textContent.trim().slice(0, 60));
input.value = 'www.example.com тоже нельзя';
card.querySelector('[data-act="add-comment"]').click();
await tick();
ok(countEl.textContent === before, 'www.-ссылка тоже заблокирована');
input.value = 'Обычный комментарий без ссылок';
card.querySelector('[data-act="add-comment"]').click();
await tick();
ok(Number(countEl.textContent) === Number(before) + 1, `чистый комментарий добавлен (${before} → ${countEl.textContent})`);

cleanup?.();

console.log('4) Форма «Задать вопрос»: без тулбара, ссылки в описании запрещены:');
document.getElementById('toast-container').innerHTML = ''; // не путать со старыми тостами
app.innerHTML = '';
await renderAskQuestion(app);
await tick();
const desc = app.querySelector('#ask-desc');
ok(!!desc, 'поле описания #ask-desc на месте');
ok(!app.querySelector('.fmt-toolbar') && desc.dataset.fmtBound === undefined, 'тулбара форматирования НЕТ');
app.querySelector('#ask-title').value = 'Тестовый вопрос';
desc.value = 'Зацени вот это https://example.com/sound';
app.querySelector('#ask-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
const toastsEl = document.getElementById('toast-container');
ok(toastsEl.textContent.includes('Ссылки в описании запрещены'), 'ссылка в описании — ошибка: ' + toastsEl.textContent.trim().slice(0, 60));
ok(!!app.querySelector('#ask-form'), 'вопрос со ссылкой НЕ отправлен');
ok(!app.querySelector('#ask-form button[type="submit"]').disabled, 'кнопка отправки не заблокирована после ошибки');
desc.value = 'Просто описание www.example.com тоже';
app.querySelector('#ask-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
ok(toastsEl.textContent.includes('Ссылки в описании запрещены'), 'www.-ссылка тоже заблокирована');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);