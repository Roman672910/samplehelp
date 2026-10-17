// Авто-витрина «Лучшие ответы» (заменила шоукейс «Моё звучание», 2026-10-11):
//  0) демо-БД v5; showcase-API удалён из слоя данных; fetchBestAnswers на месте;
//  1) слой данных: только ответы СО ЗВУКОМ, решения первыми, далее по лайкам,
//     limit respected, question {id,title,purged} джойнится, аудио материализовано;
//  2) UI: карточка (ссылка на вопрос + mini-wave + 🔥 лайки + ✓ Решение),
//     старых showcase-элементов нет;
//  3) пустое состояние (нет ответов со звуком);
//  4) витрина видна и на чужом профиле (публичная).
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
globalThis.FileReader = dom.window.FileReader;
// attachMiniPlayer с маркерами создаёт new Audio() для догрузки длительности пинов
globalThis.Audio = dom.window.Audio;

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
  if (String(url).startsWith('blob:') || String(url).startsWith('data:')) {
    return { ok: true, blob: async () => new globalThis.Blob(['fake-wav']) };
  }
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log('0) Версия демо-БД и поверхность API:');
ok(sb.DEMO_DB_VERSION >= 5, `DEMO_DB_VERSION = ${sb.DEMO_DB_VERSION} (≥5: шоукейс удалён; v6 — жалобы/модерация)`);
ok(typeof sb.fetchBestAnswers === 'function', 'fetchBestAnswers экспортируется');
ok(sb.fetchShowcase === undefined && sb.addShowcaseTrack === undefined && sb.deleteShowcaseTrack === undefined,
  'showcase-API (fetch/add/delete) удалён из слоя данных');

console.log('\n1) Слой данных (демо-сиды):');
const anna = await sb.fetchBestAnswers('u-anna');
ok(anna.length === 1 && anna[0].id === 'a1', 'u-anna: единственный ответ со звуком (a1)');
ok(anna[0].is_solution === true, 'a1 — принятое решение');
ok(anna[0].likes_count === 28, 'лайки проброшены (28)');
ok(!!anna[0].audio_url && Array.isArray(anna[0].waveform_data) && anna[0].waveform_data.length > 0,
  'аудио материализовано из audio_kind + пики');
ok(anna[0].question && anna[0].question.id === 'q1' && anna[0].question.title.includes('рычащий'),
  'вопрос заджойнен: q1 «…рычащий бас…»');
const max = await sb.fetchBestAnswers('u-max');
ok(max.length === 0, 'u-max: ответ a5 без аудио → витрина пуста');
const lena = await sb.fetchBestAnswers('u-lena');
ok(lena.length === 1 && lena[0].id === 'a3', 'u-lena: a3 со звуком (a2 — без)');

console.log('\n1b) Синтетика: фильтр по аудио, сортировка, limit:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
// q2 открыт (u-anna) — можно отвечать. payload переопределяет defaults в демо-ветке
await sb.createAnswer({ question_id: 'q2', content: 'без аудио', tags: [] });
await sb.createAnswer({ question_id: 'q2', content: 'со звуком, 5 лайков', audio_url: 'blob:x5', waveform_data: [0.1], likes_count: 5 });
await sb.createAnswer({ question_id: 'q2', content: 'со звуком, 50 лайков', audio_url: 'blob:x50', waveform_data: [0.9], likes_count: 50 });
await sb.createAnswer({ question_id: 'q2', content: 'решение, 1 лайк', audio_url: 'blob:x1', waveform_data: [0.5], likes_count: 1, is_solution: true });
const demoBest = await sb.fetchBestAnswers('u-demo');
ok(demoBest.length === 3, 'ответ без аудио отфильтрован (3 из 4)');
ok(demoBest[0].is_solution === true && demoBest[0].likes_count === 1, 'решение — первым, даже с 1 лайком');
ok(demoBest[1].likes_count === 50 && demoBest[2].likes_count === 5, 'остальные — по убыванию лайков (50 → 5)');
ok((await sb.fetchBestAnswers('u-demo', 2)).length === 2, 'limit=2 учитывается');

console.log('\n2) UI: витрина в профиле автора (u-anna, editable):');
setState({ user: { id: 'u-anna', username: 'Anna' } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
const section = app.querySelector('.best-answers-block');
ok(!!section, 'секция .best-answers-block отрисована');
ok(section?.querySelector('h2')?.textContent.includes('Лучшие ответы'), 'заголовок «🏆 Лучшие ответы»');
const cards = app.querySelectorAll('.best-answer-card');
ok(cards.length === 1, 'одна карточка (a1)');
const link = cards[0]?.querySelector('.ba-title a');
ok(link?.getAttribute('href') === '/question/q1' && link?.hasAttribute('data-route'),
  'ссылка на вопрос /question/q1 c data-route (SPA)');
ok(!!cards[0]?.querySelector('.mini-wave[data-audio]'), 'mini-wave с data-audio');
ok(cards[0]?.querySelector('.counter')?.textContent.includes('28'), 'счётчик 🔥 28');
ok(cards[0]?.querySelector('.ba-solution')?.textContent.includes('Решение'), 'бейдж «✓ Решение»');
ok(!app.querySelector('#btn-add-showcase') && !app.querySelector('.showcase-grid') && !app.querySelector('.showcase-card'),
  'старый шоукейс из DOM исчез (кнопка/сетка/карточки)');

console.log('\n3) Пустое состояние (u-max — нет ответов со звуком):');
setState({ user: { id: 'u-max', username: 'Max' } });
await renderProfile(app, { userId: 'u-max' });
await tick();
const emptyEl = app.querySelector('#best-answers-grid .compact-empty');
ok(!!emptyEl, 'пустая витрина показывает .compact-empty');
ok(emptyEl?.textContent === t('profile.best_answers_empty'), 'текст = profile.best_answers_empty');

console.log('\n4) Чужой профиль: витрина публичная, без управляющих элементов:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
ok(app.querySelectorAll('.best-answer-card').length === 1, 'карточка видна гостю/другому пользователю');
ok(!app.querySelector('#btn-add-showcase'), 'кнопки добавления нет (их вообще больше нет)');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
