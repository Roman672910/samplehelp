// Сохранность демо-данных при смене DEMO_DB_VERSION (фикс бага 2026-10-11:
// заказчик создал вопрос, перезагрузил страницу — вопрос исчез; причина —
// «мягкий пересид» v7→v8 переносил только поля профиля и словари, а весь
// пользовательский контент выбрасывался).
// С v9 migrateDemo переносит пользовательские записи (всё, чего нет в сидах
// по id) поверх новых сидов и чистит «висяки». Проверяем:
//  1) свой вопрос + свой ответ + свой комментарий + ответ на СИДОВЫЙ вопрос
//     переживают пересид; счётчик ответов (динамический) учитывает перенос;
//  2) лайки/избранное/сообщения/подписки/донаты/уведомления/жалобы — переносятся;
//  3) «висяки» (ссылки на несуществующие вопросы/ответы/профили) — удаляются;
//  4) счётчики: у перенесённого вопроса likes_count из снапшота не удваивается;
//     у СИДОВОГО вопроса — свежие сиды + перенесённый лайк пользователя;
//  5) регресс v8: поля профиля (contact/open_to_collab) переносятся, а
//     donate_methods дополнительно фильтруются до СБП/карты (устаревшие виды
//     из старых снапшотов не воскресают);
//  6) тост demo.reseeded — новый честный текст; снапшот фиксируется версией v10;
//  7) повторный старт с той же версией — полное восстановление без миграции;
//  8) v10: аудио-вложения ЛС удалены — старые сообщения снапшота теряют
//     audio_url/waveform_data/audio_kind, но переносятся с текстом;
//     сообщения с ref (карточка-ссылка) переносятся как есть.
// «Перезагрузка» моделируется повторным импортом supabase.mjs с query-суффиксом.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
globalThis.FileReader = dom.window.FileReader;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const DB_KEY = 'samplehelp_demo_db';
const readDb = () => JSON.parse(localStorage.getItem(DB_KEY));
const writeDb = (obj) => localStorage.setItem(DB_KEY, JSON.stringify(obj));
const DEMO_USER = { id: 'u-demo', username: 'DemoUser' };
const ADMIN = { id: 'u-demo', username: 'DemoUser', is_admin: true };

console.log('1) Сессия 1 (v10): пользователь создаёт контент во всех коллекциях:');
const S1 = await import('../public/js/supabase.mjs');
ok(S1.DEMO_DB_VERSION === 16, `DEMO_DB_VERSION = ${S1.DEMO_DB_VERSION} (v13: QR + Boosty, контент переживает пересид)`);
setState({ user: { ...DEMO_USER } });
// Профиль: контакты + устаревший способ приёма (регресс v8 + фильтрация v9)
await S1.updateProfile({
  contact: [{ kind: 'telegram', value: '@my_demo', label: '', visibility: 'members' }],
  contact_consent: true,
  open_to_collab: true,
  donate_methods: [
    { kind: 'yoomoney', value: 'https://yoomoney.ru/to/old', label: 'старьё' },
    { kind: 'qr', value: 'https://qr.nspk.ru/USER0001?crc=FF00', qr_data_url: 'data:image/png;base64,QUFFBQ==', label: 'мой банк' },
  ],
});
const myQ = await S1.createQuestion({ title: 'Мой важный вопрос', description: 'Как собрать пресет?', synth: 'Serum', category: 'synth' });
ok(!!myQ?.id, 'свой вопрос создан: ' + myQ?.id);
const myA = await S1.createAnswer({ question_id: myQ.id, content: 'Мой же ответ для теста' });
const myA2 = await S1.createAnswer({ question_id: 'q2', content: 'Мой ответ на сидовый вопрос про пэд' });
ok(!!myA?.id && !!myA2?.id, 'свои ответы созданы (на свой и на сидовый вопрос)');
const myC = await S1.createComment({ answer_id: myA2.id, content: 'Мой комментарий' });
ok(!!myC?.id, 'свой комментарий создан');
await S1.toggleLike('question', myQ.id);
await S1.toggleLike('question', 'q1'); // лайк СИДОВОГО вопроса — для проверки счётчика
await S1.setFavorite(myQ.id, true);
await S1.sendMessage('u-anna', 'Моё сообщение Анне');
await S1.sendMessage('u-anna', '', { ref: { type: 'question', id: 'q2' } }); // карточка-ссылка (v10)
await S1.toggleSubscription('tag', 'Serum');
await S1.recordDonation({ recipient_user_id: 'u-anna', amount: 0, currency: 'RUB', message: 'Держись!', kind: 'thanks' });
const q1LikesBefore = (await S1.fetchQuestion('q1')).likes_count;
ok(q1LikesBefore === 35, `q1: сидовые 34 лайка + мой = ${q1LikesBefore}`);

console.log('\n2) «Прошлая версия»: снапшот v9 + мусорные записи («висяки»):');
const snap = readDb();
snap.v = S1.DEMO_DB_VERSION - 1; // имитируем снапшот предыдущей версии
snap.answers.push({ id: 'a-ghost', question_id: 'q-ghost', user_id: 'u-demo', content: 'ответ на удалённый вопрос', likes_count: 0, created_at: new Date().toISOString() });
snap.comments.push({ id: 'c-ghost', answer_id: 'a-ghost2', user_id: 'u-demo', content: 'коммент на удалённый ответ', created_at: new Date().toISOString() });
snap.favorites.push({ user_id: 'u-demo', question_id: 'q-ghost2', status: 'preparing', created_at: new Date().toISOString() });
snap.likes.push({ user_id: 'u-demo', target_type: 'question', target_id: 'q-ghost3' });
snap.messages.push({ id: 'm-ghost', sender_id: 'u-ghost', recipient_id: 'u-demo', content: 'от призрака', read: false, created_at: new Date().toISOString() });
// v10: сообщение из «старого» снапшота с аудио-полями — поля должны сняться
snap.messages.push({ id: 'm-audio', sender_id: 'u-demo', recipient_id: 'u-anna', content: 'старое аудио-ЛС', audio_url: 'data:audio/webm;base64,AAA', waveform_data: [1, 2], audio_kind: 'pluck', read: false, created_at: new Date().toISOString() });
snap.subscriptions.push({ user_id: 'u-demo', target_type: 'author', target_id: 'u-ghost' });
snap.reports.push({ id: 'r-ghost', reporter_id: 'u-demo', target_type: 'question', target_id: 'q-ghost4', reason: 'spam', note: '', status: 'new', created_at: new Date().toISOString() });
// Валидная пользовательская жалоба (на живой профиль) — должна пережить пересид
snap.reports.push({ id: 'r-user1', reporter_id: 'u-demo', target_type: 'profile', target_id: 'u-anna', reason: 'fraud', note: 'подозрительные реквизиты', status: 'new', created_at: new Date().toISOString() });
writeDb(snap);

console.log('\n3) Сессия 2: пересид v9 → v10, весь пользовательский контент на месте:');
const S2 = await import('../public/js/supabase.mjs?p1');
setState({ user: { ...DEMO_USER } });
const notice = S2.takeDemoReseedNotice();
ok(!!notice && notice.from === snap.v && notice.to === 16, `уведомление о пересиде: v${notice?.from} → v${notice?.to}`);
const toastText = t('demo.reseeded', notice);
ok(toastText.includes('вопросы') && toastText.includes('перенесены') && toastText.includes('демонстрационный контент обновлён'),
  'новый честный тост: «' + toastText.slice(0, 60) + '…»');
ok(readDb().v === 16, 'снапшот сразу зафиксирован версией v13 (повторной миграции не будет)');

const qAfter = await S2.fetchQuestion(myQ.id);
ok(!!qAfter && qAfter.title === 'Мой важный вопрос', 'ВОПРОС пережил пересид (главный фикс захода)');
ok(qAfter.likes_count === 1, `лайк своего вопроса не удвоен: likes_count = ${qAfter.likes_count}`);
ok(await S2.isLiked('question', myQ.id), 'статус «лайкнуто» перенесён');
const myQAnswers = await S2.fetchAnswers(myQ.id);
ok(myQAnswers.some((a) => a.id === myA.id && a.content === 'Мой же ответ для теста'), 'свой ответ на свой вопрос перенесён');
const q2 = await S2.fetchQuestion('q2');
ok(q2.answers_count === 2, `сидовый q2: ответов = ${q2.answers_count} (сидовый a3 + мой перенесённый)`);
const q2Answers = await S2.fetchAnswers('q2');
const myA2After = q2Answers.find((a) => a.id === myA2.id);
ok(!!myA2After, 'свой ответ на СИДОВЫЙ вопрос перенесён');
ok((myA2After?.comments || []).some((c) => c.id === myC.id), 'свой комментарий к своему ответу перенесён');
const q1After = await S2.fetchQuestion('q1');
ok(q1After.likes_count === 35 && await S2.isLiked('question', 'q1'),
  `сидовый q1: свежие сиды (34) + перенесённый лайк = ${q1After.likes_count}, статус «лайкнуто» на месте`);
const favs = await S2.fetchFavorites();
ok(favs.length === 1 && favs[0].question_id === myQ.id, 'избранное перенесено (1 запись)');
const thread = await S2.fetchThread('u-anna');
ok(thread.some((m) => m.content === 'Моё сообщение Анне'), 'моё сообщение перенесено');
ok(thread.some((m) => m.content.includes('random-модуляторы')), 'сидовые сообщения обновлены (демо-контент на месте)');
const audioOld = thread.find((m) => m.id === 'm-audio');
ok(!!audioOld && audioOld.content === 'старое аудио-ЛС'
  && audioOld.audio_url === undefined && audioOld.waveform_data === undefined && audioOld.audio_kind === undefined,
  'v10: старое сообщение ЛС перенесено с текстом, аудио-поля сняты');
ok(thread.some((m) => m.ref && m.ref.type === 'question' && m.ref.id === 'q2' && m.content === ''),
  'v10: сообщение с ref (карточка-ссылка) перенесено как есть');
const subs = await S2.fetchSubscriptions();
ok(subs.some((s) => s.target_type === 'tag' && s.target_id === 'Serum'), 'подписка на тег перенесена');
ok(subs.some((s) => s.target_type === 'author' && s.target_id === 'u-anna'), 'сидовая подписка на автора на месте');
ok((await S2.fetchSupportCount('u-anna')) === 3, 'донаты: 2 сидовых + мой перенесённый «спасибо» = 3');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
const notsAnna = await S2.fetchNotifications();
ok(notsAnna.some((n) => n.type === 'support' && (n.payload?.message || '') === 'Держись!'),
  'уведомление автору о «спасибо» перенесено');
setState({ user: { ...ADMIN } });
const reports = await S2.fetchReports('all');
ok(reports.some((r) => r.id === 'r-user1'), 'пользовательская жалоба (живая цель) перенесена');
ok(reports.length === 4, `жалоб всего ${reports.length} (3 сидовых + моя; «висяк» удалён)`);

console.log('\n4) «Висяки» удалены:');
ok((await S2.fetchAnswers('q-ghost')).length === 0, 'ответ на несуществующий вопрос удалён');
ok(!(await S2.fetchFavorites()).some((f) => f.question_id === 'q-ghost2'), 'избранное на несуществующий вопрос удалено');
setState({ user: { ...DEMO_USER } });
ok(!(await S2.isLiked('question', 'q-ghost3')), 'лайк несуществующего вопроса удалён');
ok((await S2.fetchThread('u-ghost')).length === 0, 'сообщение от «призрака» удалено');
ok(!(await S2.fetchSubscriptions()).some((s) => s.target_id === 'u-ghost'), 'подписка на «призрака» удалена');

console.log('\n5) Профиль: поля v8 переносятся, способы приёма фильтруются до СБП/карты:');
const prof = await S2.fetchProfile('u-demo');
ok(prof.contact?.[0]?.value === '@my_demo' && prof.contact_consent === true && prof.open_to_collab === true,
  'контакт и флаги перенесены (регресс v8)');
ok((prof.donate_methods || []).length === 1 && prof.donate_methods[0].kind === 'qr' && prof.donate_methods[0].qr_data_url.startsWith('data:image/'),
  'устаревший ЮMoney из снапшота отфильтрован, моя СБП перенесена: ' + JSON.stringify(prof.donate_methods));
ok(readDb().profiles.find((p) => p.id === 'u-demo').donate_methods.length === 1,
  'фильтрация зафиксирована в снапшоте (persistDemo после миграции)');

console.log('\n6) Сиды обновлены (демо-контент свежий):');
ok(!!(await S2.fetchQuestion('q4')), 'сидовый q4 на месте');
ok(!(await S2.fetchQuestion('q0'))?.audio_url, 'сидовая заглушка q0 (purged) на месте');

console.log('\n7) Сессия 3: та же версия — полное восстановление без миграции:');
const S3 = await import('../public/js/supabase.mjs?p2');
setState({ user: { ...DEMO_USER } });
ok(S3.takeDemoReseedNotice() === null, 'уведомления нет (пересида не было)');
const q3 = await S3.fetchQuestion(myQ.id);
ok(!!q3 && q3.title === 'Мой важный вопрос', 'вопрос на месте после обычной перезагрузки');
ok((await S3.fetchFavorites()).length === 1 && (await S3.fetchThread('u-anna')).some((m) => m.content === 'Моё сообщение Анне'),
  'избранное и сообщение тоже на месте');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
