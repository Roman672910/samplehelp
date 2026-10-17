// test_msg_refs.mjs — ЛС без аудио: карточки-ссылки (messages.ref, заход 2026-10-13).
// Секции:
//  1) сид-карточки: m5 (ответ a3) рендерится карточкой, аудио-остатков нет;
//  2) пикер «📎»: вкладки/поиск/прикрепление/отправка без текста;
//  3) исчезнувшая цель → «ссылка недоступна», purged-вопрос → мини-заглушка;
//  4) список диалогов: последнее сообщение-ссылка показывается как 📎.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
const realSetTimeout = globalThis.setTimeout;
globalThis.requestAnimationFrame = (cb) => realSetTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { getState, setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const messages = await import('../public/js/messages.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 80) => new Promise((r) => realSetTimeout(r, ms));

// ---------- 1) Сид-карточки и отсутствие аудио-остатков ----------
console.log('1) Сиды v10: карточка-ссылка вместо аудио, старых элементов нет:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
const box = document.createElement('div');
document.body.appendChild(box);
let cleanup = await messages.renderMessages(box, { userId: 'u-anna' });
await tick(150);
ok(!box.querySelector('#audio-file') && !box.querySelector('#attach-btn'), 'кнопки 🎧 и file-input аудио удалены из формы');
ok(!!box.querySelector('#attach-ref-btn'), 'кнопка 📎 на месте');
const seedCard = [...box.querySelectorAll('.msg-ref')].find((el) => el.textContent.includes('Тёплый эволюционирующий пэд'));
ok(!!seedCard, 'm5 (ref answer a3) отрисован карточкой с заголовком вопроса q2');
ok(seedCard?.textContent.includes(t('messages.ref_answer_badge')), 'у карточки ответа подпись «Ответ»');
ok(!box.querySelector('.msg-audio') && !box.querySelector('.msg-ref-slot canvas'), 'аудио-плееров в переписке нет');
const maxThread = box.querySelector('#chat-pane');
ok(maxThread.dataset.with === 'u-anna', 'открыт диалог с u-anna');
cleanup?.();
box.remove(); // дубли id (#conv-items и др.) ломают querySelector следующих секций в jsdom

// ---------- 2) Пикер и отправка карточки без текста ----------
console.log('2) Пикер «📎»: вкладки, поиск, прикрепление, отправка без текста:');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
const box2 = document.createElement('div');
document.body.appendChild(box2);
cleanup = await messages.renderMessages(box2, { userId: 'u-max' });
await tick(150);
box2.querySelector('#attach-ref-btn').click();
await tick(80);
const picker = box2.querySelector('.ref-picker');
ok(!!picker, 'пикер открылся');
ok(picker.querySelector('[data-tab="answers"]').classList.contains('active'), 'вкладка «Мои ответы» активна по умолчанию');
let items = [...picker.querySelectorAll('.ref-item')].map((b) => b.textContent);
ok(items.some((s) => s.includes('рычащий')) && items.some((s) => s.includes('Кинематографичный')), 'мои ответы a1 (q1) и a4 (q3) в списке');
picker.querySelector('[data-tab="questions"]').click();
await tick(30);
items = [...box2.querySelectorAll('.ref-item')].map((b) => b.textContent);
ok(items.some((s) => s.includes('Тёплый')) && items.some((s) => s.includes('Щипковый')), 'мои вопросы q2 и q5 во вкладке «Мои вопросы»');
const search = box2.querySelector('#ref-search');
search.value = 'щипк';
search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await tick(30);
items = [...box2.querySelectorAll('.ref-item')].map((b) => b.textContent);
ok(items.length === 1 && items[0].includes('Щипковый'), 'поиск по заголовку фильтрует список');
search.value = '';
search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
await tick(30);
box2.querySelector('[data-tab="answers"]').click();
await tick(30);
const first = [...box2.querySelectorAll('.ref-item')].find((b) => b.textContent.includes('рычащий'));
first.click();
await tick(30);
ok(!box2.querySelector('.ref-picker'), 'пикер закрылся после выбора');
ok(box2.querySelector('.pending-audio')?.textContent.includes('рычащий'), 'превью прикрепления над полем ввода');
box2.querySelector('#chat-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await tick(150);
const sentWrap = [...box2.querySelectorAll('.msg-wrap')].pop();
const sentCard = sentWrap.querySelector('.msg-ref');
ok(!!sentCard && sentCard.textContent.includes('рычащий'), 'сообщение БЕЗ текста ушло с карточкой q1');
ok(sentCard.textContent.includes(t('question.solution')), 'карточка решения a1 помечена ✓ Решение');
const stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
const sentRow = stored.messages.find((m) => m.ref && m.ref.id === 'a1');
ok(!!sentRow && sentRow.content === '' && sentRow.ref.type === 'answer', 'в БД только { type, id } и пустой content');
// снятие прикрепления
box2.querySelector('#attach-ref-btn').click();
await tick(50);
box2.querySelector('.ref-item')?.click();
await tick(30);
box2.querySelector('#pending-rm')?.click();
await tick(20);
ok(!box2.querySelector('.pending-audio'), 'крестик снимает прикрепление');
cleanup?.();
box2.remove();

// ---------- 3) Исчезнувшая цель и purged-вопрос ----------
console.log('3) Цели нет → заглушка; purged-вопрос → мини-заглушка:');
await sb.sendMessage('u-max', '', { ref: { type: 'question', id: 'no-such-id' } });
await sb.sendMessage('u-max', 'был такой вопрос?', { ref: { type: 'question', id: 'q0' } });
const box3 = document.createElement('div');
document.body.appendChild(box3);
cleanup = await messages.renderMessages(box3, { userId: 'u-max' });
await tick(150);
const gone = box3.querySelector('.msg-ref.gone');
ok(!!gone && gone.textContent.includes(t('messages.ref_gone')), 'исчезнувшая цель — «ссылка недоступна»');
const purged = box3.querySelector('.msg-ref.purged');
ok(!!purged && purged.textContent.includes(t('question.purged_title')), 'purged-вопрос q0 — мини-заглушка');
ok(purged?.getAttribute('href') === '/question/q0', 'у заглушки сохранён маршрут вопроса');
cleanup?.();
box3.remove();

// ---------- 4) Список диалогов: 📎 для сообщения-ссылки ----------
console.log('4) Список диалогов:');
const box4 = document.createElement('div');
document.body.appendChild(box4);
cleanup = await messages.renderMessages(box4, {});
await tick(150);
const lasts = [...box4.querySelectorAll('.conv-last')].map((el) => el.textContent);
ok(lasts.some((s) => s.includes('📎')), 'последнее сообщение-ссылка без текста показано как 📎');
ok(!lasts.some((s) => s.includes('🎧')), 'значок 🎧 в списке диалогов не встречается');
cleanup?.();
box4.remove();

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
