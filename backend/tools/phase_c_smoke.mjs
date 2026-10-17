// backend/tools/phase_c_smoke.mjs — ЖИВОЙ прогон фронт-адаптера api.mjs
// против реального backend (Фаза C, заход 48).
//
// Запуск (сервер уже должен слушать :3100, БД мигрирована):
//   cd backend && node tools/phase_c_smoke.mjs
// Что делает: регистрирует двух пользователей и прогоняет ЦЕПОЧКУ продукта
// через api.mjs (не через fetch напрямую): вопрос → ответ → лайк → решение
// (+25 rep) → ЛС с 📎-карточкой → непрочитанные → донаты модели A →
// избранное/подписки/идеи → права не-админа → загрузка аудио (/files) →
// профиль-агрегат → ЖИВЫЕ пуши уведомлений/ЛС и presence через Socket.IO.
// Демо-слой не задействован (LOCAL-ветка api.mjs).
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3100';
const TOKENS_KEY = 'samplehelp_api_tokens';

// ---------- окружение браузера (localStorage/window) ----------
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: BASE + '/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;

// socket.io-client из dev-зависимостей backend — «vendor» для api.mjs
const require = createRequire(new URL('../package.json', import.meta.url));
window.io = require('socket.io-client').io;

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- LOCAL-режим и модули фронта ----------
const { CONFIG } = await import('../../public/js/config.mjs');
CONFIG.USE_LOCAL_BACKEND = true;
CONFIG.API_URL = BASE;
const { setState } = await import('../../public/js/store.mjs');
const api = await import('../../public/js/api.mjs');

const h = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
if (!h?.ok) { console.error('backend не отвечает на /api/health — поднимите сервер (см. README)'); process.exit(2); }

const stamp = Date.now();
console.log(`backend: ${BASE} (health ✓, фаза «${h.phase}»)\n`);

console.log('1) регистрация и сессия:');
const su1 = await api.signUp({ email: `smoke_a_${stamp}@test.ru`, password: 'secret1', username: `smokeA${stamp % 100000}` });
ok(su1.needsOnboarding === true && !!su1.user?.id, 'signUp: пользователь + needsOnboarding');
const sess1 = await api.getSessionUser();
ok(sess1?.id === su1.user.id && !!sess1.email, 'getSessionUser: профиль + email из JWT');
const t1 = localStorage.getItem(TOKENS_KEY);
const state1 = sess1;

// u2 — «сырым» логином, чтобы не дёргать сокет u1 (api.signIn делает reconnect)
const su2 = await api.signUp({ email: `smoke_b_${stamp}@test.ru`, password: 'secret1', username: `smokeB${stamp % 100000}` });
const login2 = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `smoke_b_${stamp}@test.ru`, password: 'secret1' }),
}).then((r) => r.json());
const t2 = JSON.stringify({ access: login2.access, refresh: login2.refresh });
const state2 = { id: su2.user.id, username: su2.user.username, email: su2.user.email, is_admin: false, avatar_url: null };
ok(state2.id !== state1.id, 'вторая регистрация — отдельный аккаунт');

/** Переключить «текущего пользователя» адаптера (токены + state) */
function as(n) {
  localStorage.setItem(TOKENS_KEY, n === 1 ? t1 : t2);
  setState({ user: n === 1 ? state1 : state2 });
}
as(1);

console.log('\n2) живой Socket.IO от u1: уведомления, ЛС, presence:');
const pushedNotifs = [];
const pushedMsgs = [];
const presenceStates = [];
const unNotif = await api.subscribeNotifications((n) => pushedNotifs.push(n));
const unMsgs = await api.subscribeMessages((m) => pushedMsgs.push(m));
const unPresence = await api.subscribePresenceRoom('presence:global', { uid: state1.id, username: state1.username, avatar_url: null, guest: false }, (st) => presenceStates.push(st));
await wait(500); // даём сокету подключиться и заявить presence
ok(presenceStates.length > 0 && presenceStates.at(-1).total >= 1, 'presence: состояние комнаты пришло (u1 в онлайне)');

console.log('\n3) вопрос → ответ → лайк → решение (+25 rep):');
const q = await api.createQuestion({ title: 'Смоук: как сделать воббл?', description: 'Проверка Фазы C', synth: 'Vital' });
ok(q?.id && q.author?.username === state1.username, 'createQuestion: строка + author из сессии');
const feed = await api.fetchFeed('new');
ok(feed.some((x) => x.id === q.id) && feed[0].author !== undefined, 'вопрос в ленте (author на месте)');
ok((await api.fetchFeed('unanswered')).some((x) => x.id === q.id), 'sort=unanswered видит вопрос без ответов');
ok((await api.fetchSynthCatalog()).includes('Vital'), 'synth-справочник пополнился при создании вопроса');

as(2);
const a = await api.createAnswer({ question_id: q.id, content: 'LFO на питч + сатурация.', tags: ['wobble'] });
ok(a?.id, 'createAnswer (от u2) создан');
await wait(400);
ok(pushedNotifs.some((n) => n.type === 'answer' && n.payload?.questionId === q.id), 'u1 получил ЖИВОЙ пуш answer-уведомления');
const answers = await api.fetchAnswers(q.id);
ok(answers.length === 1 && !!answers[0].author && Array.isArray(answers[0].comments), 'fetchAnswers: author + comments[]');

as(1);
const like = await api.toggleLike('answer', a.id);
ok(like?.liked === true && like.likes_count === 1, 'u1 лайкнул ответ u2');
const cm = await api.createComment({ answer_id: a.id, content: 'Спасибо!' });
ok(cm?.id && cm.author?.username === state1.username, 'createComment + author из сессии');
const cmUpd = await api.updateComment(cm.id, 'Спасибо! (дополнено)');
ok(cmUpd?.content?.includes('дополнено') && !!cmUpd.edited_at, 'updateComment + edited_at');
await api.markSolution(a.id, q.id);
const qAfter = await api.fetchQuestion(q.id);
ok(qAfter.status === 'solved' && !!qAfter.purge_at, 'markSolution: статус solved + таймер purge');
const profU2 = await api.fetchProfile(state2.id);
ok(profU2.stats.rating >= 25 && profU2.stats.solutions >= 1, 'решение: +25 rep и solutions у автора ответа (агрегат профиля)');
as(2);
ok((await api.fetchNotifications()).some((n) => n.type === 'like' && n.payload?.targetKey === 'notifications.target_answer'), 'u2 получил like-уведомление (заход 47, REST)');
ok((await api.fetchNotifications()).some((n) => n.type === 'solution'), 'u2 получил solution-уведомление');

console.log('\n4) ЛС: 📎-карточка, пуш, непрочитанные, реакции, правка:');
const cands = await api.fetchRefCandidates();
ok(cands.answers.some((x) => x.id === a.id && x.title === q.title), 'ref-candidates: мой ответ с заголовком вопроса');
// Смоук-специфика: ОДИН клиент играет обоих пользователей. Отправка — с
// токеном u2, но «текущий пользователь» в state остаётся u1: recipient-фильтр
// subscribeMessages смотрит state В МОМЕНТ ПУША (переключение обратно после
// await гонку бы не закрыло — пуш приходит раньше). В браузере такой
// ситуации нет: клиент всегда один.
localStorage.setItem(TOKENS_KEY, t2);
setState({ user: state1 });
const msg = await api.sendMessage(state1.id, 'Привет! Смоук ЛС.', { ref: { type: 'question', id: q.id, title: q.title } });
ok(msg?.id && msg.ref?.type === 'question', 'u2 → u1: сообщение с 📎-ссылкой');
await wait(400);
ok(pushedMsgs.some((m) => m.id === msg.id), 'u1 получил ЖИВОЙ пуш сообщения');
const card = await api.fetchRefCard({ type: 'question', id: q.id });
ok(card?.href === `/question/${q.id}` && card.title === q.title, 'fetchRefCard: карточка вопроса');
ok(card.purged === true || card.purged === false, 'ref-card несёт purged/purge_summary (вопрос решён)');
as(2); // реакцию и правку делает ОТПРАВИТЕЛЬ (u2)
const react = await api.toggleMessageReaction(msg.id, '🔥');
ok(Array.isArray(react) && react.length === 1, 'реакция на сообщение');
const mUpd = await api.updateMessage(msg.id, 'Привет! (ред.)');
ok(mUpd?.content === 'Привет! (ред.)' && !!mUpd.edited_at, 'updateMessage + edited_at');
as(1);
const notMine = await api.updateMessage(msg.id, 'чужая правка');
ok(notMine === null, 'правка ЧУЖОГО сообщения → null (403 с сервера)');
const convs = await api.fetchConversations();
ok(convs.length === 1 && convs[0].unread === 1 && convs[0].profile?.username === state2.username, 'диалог u1: непрочитанное + профиль собеседника');
await api.markThreadRead(state2.id);
ok((await api.fetchConversations())[0].unread === 0, 'markThreadRead: непрочитанных нет');
const thread = await api.fetchThread(state2.id);
ok(thread.length === 1 && thread[0].content.includes('ред.'), 'fetchThread: сообщение с правкой');

console.log('\n5) донаты (модель A): спасибо, отметка, подтверждение:');
as(2);
const thx = await api.recordDonation({ recipient_user_id: state1.id, amount: 0, message: 'спасибо за ответ', kind: 'thanks' });
ok(!!thx?.id, 'u2 → «спасибо» u1');
const mark = await api.markDonationTransfer({ recipientUserId: state1.id, amount: 500, message: 'за пресет' });
ok(mark?.id && mark.status === 'intent', 'отметка «Я перевёл» (intent)');
as(1);
ok((await api.fetchSupportCount(state1.id)) >= 2, 'счётчик ☕ u1 вырос (thanks + paid)');
const forMe = await api.fetchDonationsFor(state1.id);
ok(forMe.length === 1 && forMe[0].donor_name === state2.username && forMe[0].status === 'intent', 'u1 видит отметку с именем донора');
ok((await api.confirmDonation(mark.id)) === true, '«Получено ✓» подтверждено');
const notifs1 = await api.fetchNotifications();
ok(notifs1.some((n) => n.type === 'support' && n.payload?.confirmed === true), 'уведомление u1 помечено confirmed (кнопка гаснет)');
ok(notifs1.every((n) => n.type !== 'message'), "'message'-уведомления не показываются");
ok((await api.fetchDonationsFor(state2.id)).length === 0, 'чужие отметки не отдаются (приватность)');

console.log('\n6) избранное, подписки, идеи:');
ok((await api.setFavorite(q.id, true)) === true && (await api.isInFavorites(q.id)) === true, 'избранное: добавлено');
await api.setFavoriteStatus(q.id, 'ready');
const favs = await api.fetchFavorites();
ok(favs[0].status === 'ready' && !!favs[0].question?.author?.id, 'статус «готово» + question.author');
ok((await api.toggleSubscription('tag', 'Vital')) === true, 'подписка на тег → true');
ok((await api.fetchSubscriptions()).some((s) => s.target_id === 'Vital'), 'подписка в списке');
const idea = await api.createIdea({ title: 'Смоук-идея', body: 'Проверка витрины идей через api.mjs.' });
ok(idea?.id && idea.author?.username === state1.username, 'идея создана (author из сессии)');
ok((await api.toggleIdeaVote(idea.id)) === 1, 'голос ▲ → счётчик 1');
ok((await api.fetchIdeaVotesMine()).has(idea.id), 'Set моих голосов');
ok((await api.fetchIdeas('top')).some((i) => i.id === idea.id && i.votes === 1), 'идея в витрине (топ)');

console.log('\n7) права: жалобы и админ-ветки:');
const rep = await api.submitReport({ target_type: 'answer', target_id: a.id, reason: 'spam', note: 'смоук' });
ok(rep?.id, 'жалоба отправлена');
let dup = null;
try { await api.submitReport({ target_type: 'answer', target_id: a.id, reason: 'other' }); } catch (e) { dup = e; }
ok(dup?.code === 'duplicate', 'дубликат жалобы → code=duplicate (контракт supabase-js)');
ok((await api.fetchReports('new')).length === 0, 'не-админ список жалоб не получает');
let admErr = null;
try { await api.setReportStatus(rep.id, 'dismissed'); } catch (e) { admErr = e; }
ok(!!admErr, 'не-админ статус жалобы не меняет');
let ideaErr = null;
try { await api.setIdeaStatus(idea.id, 'done'); } catch (e) { ideaErr = e; }
ok(!!ideaErr, 'не-админ статус идеи не меняет');

console.log('\n8) загрузка файлов (SSD → /files):');
const fileUrl = await api.uploadAudio(new Blob(['smoke-opus-data'], { type: 'audio/webm' }));
ok(fileUrl.startsWith(BASE + '/files/question-audio/'), 'uploadAudio → абсолютный URL /files/...');
ok((await fetch(fileUrl).then((r) => r.text())) === 'smoke-opus-data', 'файл отдаётся по /files (содержимое совпало)');
ok((await api.uploadAvatar(new Blob(['png-bytes'], { type: 'image/png' }))).includes('/files/avatars/'), 'uploadAvatar → бакет avatars');
let exeErr = null;
try { await api.uploadAudio(new Blob(['MZ'], { type: 'application/x-msdownload' })); } catch (e) { exeErr = e; }
ok(!!exeErr, 'exe в аудио-бакет отклонён (mime-белый список)');

console.log('\n9) профиль: агрегат, словари, настройки, достижения:');
const me = await api.fetchProfile(state1.id);
ok(me.stats.questions >= 1 && Array.isArray(me.answers) && me.software !== undefined, 'агрегат: stats + answers + словари');
await api.updateProfile({ bio: 'Смоук-био', software: ['FL Studio'], arsenal: ['Serum'], open_to_collab: true });
const me2 = await api.fetchProfile(state1.id);
ok(me2.bio === 'Смоук-био' && me2.software.includes('FL Studio') && me2.arsenal.includes('Serum'), 'updateProfile: био + software/arsenal');
ok(Array.isArray(await api.fetchBestAnswers(state2.id, 3)), 'fetchBestAnswers работает');
ok((await api.fetchMyCommentCount()) >= 1, 'count-mine: свои комментарии считаются');
ok((await api.fetchDawCatalog()).includes('FL Studio'), 'DAW-справочник с сидами');
ok((await api.addDawToCatalog(`SmokeDAW${stamp % 1000}`)) === true, 'свой DAW добавлен в справочник');
ok(Array.isArray(await api.fetchQuestionsByUser(state1.id)), 'fetchQuestionsByUser работает');
const awarded = await api.awardAchievement('first_answer');
const earned = await api.fetchAchievements(state1.id);
ok(earned.includes('first_answer'), 'awardAchievement → значок в списке своих');
ok(awarded === true || awarded === false, 'awardAchievement → bool (повтор = false)');
const dev = await api.fetchDevContact();
ok(dev === null || !!dev.id, 'fetchDevContact: null или профиль админа (owner в смоук-БД не задан)');

console.log('\n10) авто-refresh на 401 (живой):');
{
  // Протухший access + живой refresh: первый же запрос должен тихо обновить пару
  const tk = JSON.parse(localStorage.getItem(TOKENS_KEY));
  localStorage.setItem(TOKENS_KEY, JSON.stringify({ access: 'expired.token.value', refresh: tk.refresh }));
  const rows = await api.fetchNotifications();
  const tk2 = JSON.parse(localStorage.getItem(TOKENS_KEY));
  ok(Array.isArray(rows) && tk2.access !== 'expired.token.value', '401 → тихий refresh → запрос повторён, пара ротирована');
}

console.log('\n11) lifecycle и выход:');
await api.runLifecycleSweep();
ok(true, 'runLifecycleSweep: no-op (cron на сервере)');
await api.signOut();
ok((await api.getSessionUser()) === null, 'signOut: сессия пуста');
const tkAfter = JSON.parse(localStorage.getItem(TOKENS_KEY) || 'null');
ok(tkAfter === null, 'токены удалены из localStorage');

unNotif(); unMsgs(); unPresence();
await wait(200);
console.log(fails ? `\n✗ Живой смоук Фазы C: ${fails} провалов` : '\n✓ Живой смоук Фазы C пройден полностью');
process.exit(fails ? 1 : 0);
