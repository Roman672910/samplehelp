// backend/tests/run.mjs — интеграционные тесты Фазы A (заход 48).
// Живой PostgreSQL (sh_test) + createApp() на эфемерном порту + node fetch.
// Матрица: auth/refresh/reset, owner-бутстрап, белый список PATCH, маски
// контактов на СЕРВЕРЕ, контент+триггеры, петли уведомлений (47/36/38),
// жалобы/модерация, идеи, upload (mime/приватность).
process.env.AUTH_RATE_MAX = '1000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_test';
process.env.STORAGE_DIR = fileURLToPath(new URL('./storage-tmp', import.meta.url));
process.env.JWT_SECRET = 'test-secret';
process.env.REFRESH_SECRET = 'test-refresh-secret';

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// ---------- чистая БД + схема ----------
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
await admin.query('drop schema if exists public cascade; create schema public;');
await admin.end();
const schema = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
await dbc.connect();
await dbc.query(schema);
await dbc.query("update owner_config set owner_email = 'owner@test.ru'");
await dbc.end();
fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });

const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
async function api(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body && !raw ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}

console.log('1) auth: регистрация, owner-бутстрап, дубликаты:');
const regOwner = await api('POST', '/api/auth/register', { body: { email: 'Owner@Test.ru', password: 'secret1', username: 'Owner' } });
ok(regOwner.status === 201 && regOwner.json.user.is_admin === true, 'почта владельца → is_admin=true (триггер захода 43)');
const regUser = await api('POST', '/api/auth/register', { body: { email: 'user@test.ru', password: 'secret1', username: 'UserTwo' } });
ok(regUser.status === 201 && regUser.json.user.is_admin === false, 'обычная регистрация → не админ');
const regDup = await api('POST', '/api/auth/register', { body: { email: 'user@test.ru', password: 'secret1', username: 'Dup' } });
ok(regDup.status === 409 && regDup.json.code === 'duplicate', 'повторная почта → 409 duplicate');
const badLogin = await api('POST', '/api/auth/login', { body: { email: 'user@test.ru', password: 'nope' } });
ok(badLogin.status === 401 && badLogin.json.code === 'invalid_credentials', 'неверный пароль → 401');
const login = await api('POST', '/api/auth/login', { body: { email: 'user@test.ru', password: 'secret1' } });
ok(login.status === 200 && !!login.json.access, 'вход выдаёт access+refresh');
const OWNER = regOwner.json.user.id;
const USER = regUser.json.user.id;
const T_OWNER = regOwner.json.access;
let T_USER = login.json.access;

console.log('\n2) refresh-ротация и сброс пароля:');
const ref1 = await api('POST', '/api/auth/refresh', { body: { refresh: login.json.refresh } });
ok(ref1.status === 200 && !!ref1.json.access, 'refresh выдаёт новую пару');
const refOld = await api('POST', '/api/auth/refresh', { body: { refresh: login.json.refresh } });
ok(refOld.status === 401, 'старый refresh одноразовый → 401');
T_USER = ref1.json.access;
await api('POST', '/api/auth/reset-request', { body: { email: 'user@test.ru' } });
const rt = await dbcToken();
async function dbcToken() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query('select id from reset_tokens order by created_at desc limit 1');
  await c.end();
  return r.rows[0]?.id;
}
const reset = await api('POST', '/api/auth/reset-confirm', { body: { token: rt, password: 'newpass1' } });
ok(reset.status === 200, 'сброс пароля по токену');
const loginNew = await api('POST', '/api/auth/login', { body: { email: 'user@test.ru', password: 'newpass1' } });
ok(loginNew.status === 200, 'вход с новым паролем');
T_USER = loginNew.json.access;

console.log('\n3) профили: белый список PATCH + серверные маски контактов:');
const sneak = await api('PATCH', '/api/profiles/me', { token: T_USER, body: { is_admin: true, bio: 'привет' } });
ok(sneak.status === 200 && sneak.json.is_admin === false, 'is_admin через PATCH не повысить (белый список)');
ok(sneak.json.bio === 'привет', 'bio из белого списка обновился');
await api('PATCH', '/api/profiles/me', { token: T_USER, body: { contact: [{ kind: 'email', value: 'user@test.ru', label: '', visibility: 'members' }], contact_consent: true, open_to_collab: true } });
const viewOwner = await api('GET', `/api/profiles/${USER}`, { token: T_OWNER });
ok(viewOwner.json.contact?.[0]?.value?.includes('•'), 'чужой email приходит МАСКИРОВАННЫМ (сервер!)');
const viewAnon = await api('GET', `/api/profiles/${USER}`);
ok(Array.isArray(viewAnon.json.contact) && viewAnon.json.contact.length === 0, 'аноним контактов не видит вовсе');
const viewSelf = await api('GET', `/api/profiles/${USER}`, { token: T_USER });
ok(viewSelf.json.contact?.[0]?.value === 'user@test.ru', 'владелец видит полный контакт');

console.log('\n4) контент: вопросы/ответы/решение/триггеры/петли:');
const q1 = await api('POST', '/api/questions', { token: T_USER, body: { title: 'Как сделать растущий бас?', description: 'Опишите подход', synth: 'Serum', category: 'synth' } });
ok(q1.status === 201, 'вопрос создан');
const q2 = await api('POST', '/api/questions', { token: T_OWNER, body: { title: 'Тёплый пэд без LFO?', description: 'Хочется органики', synth: 'Vital', category: 'synth' } });
const feed = await api('GET', '/api/questions?sort=new');
ok(feed.json.length === 2 && feed.json[0].profile?.username, 'лента с джойном профиля');
const a1 = await api('POST', `/api/questions/${q2.json.id}/answers`, { token: T_USER, body: { content: 'Попробуйте random-модуляторы вместо LFO.' } });
ok(a1.status === 201, 'ответ создан');
const nOwner = await api('GET', '/api/notifications', { token: T_OWNER });
ok(nOwner.json.some((n) => n.type === 'answer' && n.payload?.questionId === q2.json.id), 'автор вопроса получил уведомление answer (заход 47)');
const sol = await api('POST', `/api/questions/${q2.json.id}/solution`, { token: T_OWNER, body: { answerId: a1.json.id } });
ok(sol.status === 200 && sol.json.solved, 'решение проставлено автором вопроса');
const profAfter = await api('GET', `/api/profiles/${USER}`, { token: T_USER });
ok(profAfter.json.rating === 25, 'триггер/транзакция: +25 rep автору решения');
const aLate = await api('POST', `/api/questions/${q2.json.id}/answers`, { token: T_OWNER, body: { content: 'Опоздавший ответ на решённый.' } });
ok(aLate.status === 409 && aLate.json.code === 'solved', 'ответ на решённый → 409 (триггер БД)');
const nUser = await api('GET', '/api/notifications', { token: T_USER });
ok(nUser.json.some((n) => n.type === 'solution' && n.payload?.rep === 25), 'автор ответа получил solution с rep');

console.log('\n5) лайки/избранное/подписки + петля лайка:');
const like = await api('POST', '/api/likes/toggle', { token: T_OWNER, body: { target_type: 'answer', target_id: a1.json.id } });
ok(like.json.liked === true && like.json.likes_count === 1, 'лайк поставлен, счётчик из триггера');
const nLike = await api('GET', '/api/notifications', { token: T_USER });
ok(nLike.json.some((n) => n.type === 'like' && n.payload?.targetKey === 'notifications.target_answer'), 'автор контента получил like с targetKey');
const likeOff = await api('POST', '/api/likes/toggle', { token: T_OWNER, body: { target_type: 'answer', target_id: a1.json.id } });
ok(likeOff.json.liked === false && likeOff.json.likes_count === 0, 'снятие лайка: счётчик назад, уведомлений не добавилось');
const fav = await api('POST', '/api/favorites/toggle', { token: T_OWNER, body: { question_id: q1.json.id } });
ok(fav.json.favorited === true, 'избранное toggle');
const favList = await api('GET', '/api/favorites', { token: T_OWNER });
ok(favList.json.length === 1, 'список избранного');
const sub = await api('POST', '/api/subscriptions/toggle', { token: T_OWNER, body: { target_type: 'tag', target_id: 'Serum' } });
ok(sub.json.subscribed === true, 'подписка на тег');

console.log('\n6) ЛС: тред, непрочитанные, реакции:');
const msg = await api('POST', '/api/messages', { token: T_USER, body: { recipient_id: OWNER, content: 'Здравствуйте! Вопрос по вашему пэду.' } });
ok(msg.status === 201, 'сообщение отправлено');
const convs = await api('GET', '/api/messages/conversations', { token: T_OWNER });
ok(convs.json.length === 1 && convs.json[0].unread === 1, 'у получателя диалог с непрочитанным');
await api('POST', `/api/messages/read/${USER}`, { token: T_OWNER });
const convs2 = await api('GET', '/api/messages/conversations', { token: T_OWNER });
ok(convs2.json[0].unread === 0, 'прочитано');
const react = await api('POST', `/api/messages/${msg.json.id}/reactions`, { token: T_OWNER, body: { emoji: '🔥' } });
ok(react.json.reacted === true && react.json.message.reactions.length === 1, 'реакция добавлена');

console.log('\n7) донаты: спасибо / отметка / подтверждение + петли:');
await api('POST', '/api/donations/thanks', { token: T_USER, body: { recipient_user_id: OWNER, message: 'спасибо за пэд!' } });
const nThx = await api('GET', '/api/notifications', { token: T_OWNER });
ok(nThx.json.some((n) => n.type === 'support' && n.payload?.donorId === USER), '«спасибо» дошло до автора');
const mark = await api('POST', '/api/donations/mark', { token: T_USER, body: { recipientUserId: OWNER, amount: 500, message: 'за пэд' } });
ok(mark.status === 201, 'отметка перевода создана');
const forMe = await api('GET', '/api/donations/for-me', { token: T_OWNER });
ok(forMe.json.length === 1 && forMe.json[0].status === 'intent', 'автор видит отметку (intent)');
const conf = await api('POST', `/api/donations/${mark.json.id}/confirm`, { token: T_OWNER });
ok(conf.status === 200 && conf.json.status === 'done', 'подтверждение получения');
const nDone = await api('GET', '/api/notifications', { token: T_USER });
ok(nDone.json.some((n) => n.type === 'support' && n.payload?.done && n.payload?.authorId === OWNER), 'донор получил done с authorId (клик → профиль)');

console.log('\n8) жалобы: дубликат, админ-контур, петля статуса:');
const rep = await api('POST', '/api/reports', { token: T_USER, body: { target_type: 'question', target_id: q2.json.id, reason: 'spam', note: 'тест' } });
ok(rep.status === 201, 'жалоба создана');
const repDup = await api('POST', '/api/reports', { token: T_USER, body: { target_type: 'question', target_id: q2.json.id, reason: 'other' } });
ok(repDup.status === 409 && repDup.json.code === 'duplicate', 'дубликат → 409 duplicate');
const repListNo = await api('GET', '/api/reports', { token: T_USER });
ok(repListNo.status === 403, 'не-админ список жалоб не получает');
const repList = await api('GET', '/api/reports', { token: T_OWNER });
ok(repList.status === 200 && repList.json.length === 1, 'админ видит жалобы');
await api('POST', `/api/reports/${rep.json.id}/status`, { token: T_OWNER, body: { status: 'dismissed' } });
const nRep = await api('GET', '/api/notifications', { token: T_USER });
ok(nRep.json.some((n) => n.type === 'report_status' && n.payload?.status === 'dismissed'), 'жалобщик получил петлю статуса (заход 36)');

console.log('\n9) идеи: голос, админ-статусы, петли:');
const idea = await api('POST', '/api/ideas', { token: T_USER, body: { title: 'Тёмная тема для ночных сессий', body: 'Хочется переключатель тёмной/тёмно-серой темы в настройках профиля.' } });
ok(idea.status === 201, 'идея создана');
const vote = await api('POST', `/api/ideas/${idea.json.id}/vote`, { token: T_OWNER });
ok(vote.json.votes === 1, 'голос админа учтён');
const ideaStatusNo = await api('POST', `/api/ideas/${idea.json.id}/status`, { token: T_USER, body: { status: 'in_work' } });
ok(ideaStatusNo.status === 403, 'не-админ статус не меняет');
await api('POST', `/api/ideas/${idea.json.id}/status`, { token: T_OWNER, body: { status: 'in_work' } });
await api('POST', `/api/ideas/${idea.json.id}/reply`, { token: T_OWNER, body: { text: 'Взято в работу на следующий заход.' } });
const nIdea = await api('GET', '/api/notifications', { token: T_USER });
ok(nIdea.json.some((n) => n.type === 'idea_status') && nIdea.json.some((n) => n.type === 'idea_reply'), 'петли идей дошли до автора (заход 38)');

console.log('\n10) upload: mime-фильтр и приватный бакет:');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'ava.png');
const up = await api('POST', '/api/upload/avatars', { token: T_USER, body: fd, raw: true });
ok(up.status === 201 && up.json.url?.startsWith('/files/avatars/'), 'аватар загружен на SSD, url публичного бакета');
const fdBad = new FormData();
fdBad.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe');
const upBad = await api('POST', '/api/upload/avatars', { token: T_USER, body: fdBad, raw: true });
ok(upBad.status === 400 && upBad.json.code === 'invalid_type', 'exe в аватары отклонён');
const fdPriv = new FormData();
fdPriv.append('file', new Blob([Buffer.from('preset-data')], { type: 'application/octet-stream' }), 'pack.fxb');
const upPriv = await api('POST', '/api/upload/marketplace-files', { token: T_USER, body: fdPriv, raw: true });
ok(upPriv.status === 201 && upPriv.json.url === null, 'приватный бакет: url не выдаётся');
const privNo = await fetch(`${BASE}/api/upload/private/marketplace-files/${upPriv.json.name}`);
ok(privNo.status === 401, 'приватный файл без токена → 401');
const privOk = await fetch(`${BASE}/api/upload/private/marketplace-files/${upPriv.json.name}`, { headers: { authorization: `Bearer ${T_OWNER}` } });
ok(privOk.status === 200, 'приватный файл с токеном → 200');

console.log('\n11) прочитанность уведомлений:');
const before = (await api('GET', '/api/notifications', { token: T_USER })).json.filter((n) => !n.read).length;
const first = (await api('GET', '/api/notifications', { token: T_USER })).json[0];
await api('POST', `/api/notifications/${first.id}/read`, { token: T_USER });
const after = (await api('GET', '/api/notifications', { token: T_USER })).json.filter((n) => !n.read).length;
ok(after === before - 1, 'одиночное прочитанность работает');
await api('POST', '/api/notifications/read-all', { token: T_USER });
const afterAll = (await api('GET', '/api/notifications', { token: T_USER })).json.filter((n) => !n.read).length;
ok(afterAll === 0, 'read-all гасит всё');

server.close();
fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки backend Фазы A пройдены');
process.exit(fails ? 1 : 0);
