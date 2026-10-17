// backend/tests/run_b.mjs — интеграционные тесты ФАЗЫ B (заход 48):
// Socket.IO-пуши уведомлений и ЛС, typing, presence (включая гостей),
// серверный cron жизненного цикла (purge + напоминания 24ч/3д).
process.env.AUTH_RATE_MAX = '1000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_test';
process.env.STORAGE_DIR = fileURLToPath(new URL('./storage-tmp-b', import.meta.url));
process.env.JWT_SECRET = 'test-secret';
process.env.REFRESH_SECRET = 'test-refresh-secret';
process.env.LIFECYCLE_MS = '0'; // cron выключаем: sweep зовём вручную

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { io as ioClient } from 'socket.io-client';

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
await admin.query('drop schema if exists public cascade; create schema public;');
await admin.end();
const schema = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
await dbc.connect();
await dbc.query(schema);
await dbc.query("update owner_config set owner_email = 'alice@test.ru'");
fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });

const { createServer } = await import('../src/app.js');
const { runLifecycleSweep } = await import('../src/lifecycle.js');
const { server } = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json };
}
const waitEvent = (sock, name, ms = 1500) => new Promise((res) => {
  const t = setTimeout(() => res(null), ms);
  sock.once(name, (d) => { clearTimeout(t); res(d); });
});
const connect = (token) => ioClient(BASE, { auth: { token: token || undefined }, transports: ['websocket'] });

console.log('0) подготовка: два аккаунта (alice — владелец/админ, bob — обычный):');
const alice = await api('POST', '/api/auth/register', { body: { email: 'alice@test.ru', password: 'secret1', username: 'Alice' } });
const bob = await api('POST', '/api/auth/register', { body: { email: 'bob@test.ru', password: 'secret1', username: 'Bob' } });
const A = alice.json.access;
const B = bob.json.access;
ok(alice.json.user.is_admin === true && bob.json.user.is_admin === false, 'alice — админ (owner-бутстрап), bob — обычный');

console.log('\n1) пуш уведомления в сокет автора вопроса:');
const sockA = connect(A);
const sockB = connect(B);
await Promise.all([new Promise((r) => sockA.on('connect', r)), new Promise((r) => sockB.on('connect', r))]);
ok(sockA.connected && sockB.connected, 'оба сокета подключились с токенами');
const q = await api('POST', '/api/questions', { token: A, body: { title: 'Пэд без LFO?', description: 'Хочется органичной эволюции', synth: 'Vital' } });
const pAnswer = waitEvent(sockA, 'notification');
await api('POST', `/api/questions/${q.json.id}/answers`, { token: B, body: { content: 'Попробуйте random-модуляторы: smoothed noise на атаку и детюн.' } });
const nPush = await pAnswer;
ok(!!nPush && nPush.type === 'answer' && nPush.payload?.questionId === q.json.id, 'alice получила answer-уведомление ЖИВЫМ пушем');

console.log('\n2) пуш ЛС обеим сторонам + typing:');
const pMsg = waitEvent(sockA, 'message');
const sent = await api('POST', '/api/messages', { token: B, body: { recipient_id: alice.json.user.id, content: 'Здравствуйте! Гляньте мой ответ.' } });
const mPush = await pMsg;
ok(!!mPush && mPush.id === sent.json.id, 'alice получила сообщение пушем');
const pMsgB = waitEvent(sockB, 'message');
await api('POST', '/api/messages', { token: B, body: { recipient_id: alice.json.user.id, content: 'И дополнение.' } });
ok(!!(await pMsgB), 'отправитель тоже получает пуш своего сообщения (вторая вкладка)');
const pTyp = waitEvent(sockA, 'typing');
sockB.emit('typing', { to: alice.json.user.id, conv: 'demo-conv' });
const typ = await pTyp;
ok(!!typ && typ.conv === 'demo-conv' && typ.username === 'Bob', 'typing дошёл до адресата с именем отправителя (username из профиля, Фаза C)');

console.log('\n3) presence: пользователи + гости, track/untrack/disconnect:');
const room = 'presence:global';
const statesA = [];
sockA.on('presence', (s) => { if (s.room === room) statesA.push(s); });
sockA.emit('presence:track', { room, meta: { uid: alice.json.user.id, username: 'Alice', guest: false } });
await new Promise((r) => setTimeout(r, 200));
sockB.emit('presence:track', { room, meta: { uid: bob.json.user.id, username: 'Bob', guest: false } });
const anon = connect(null);
await new Promise((r) => anon.on('connect', r));
anon.emit('presence:track', { room, meta: { guest: true } });
await new Promise((r) => setTimeout(r, 300));
const last = statesA[statesA.length - 1];
ok(!!last && last.users.length === 2 && last.guests === 1 && last.total === 3, `presence: 2 пользователя + 1 гость = ${last?.total}`);
ok(anon.connected, 'аноним допущен к presence (гостем, без личной комнаты)');
const pLeave = new Promise((r) => { sockA.once('presence', (s) => r(s)); });
sockB.disconnect();
const afterLeave = await pLeave;
ok(afterLeave.users.length === 1 && afterLeave.guests === 1, 'disconnect bob: presence пересчитался (1 пользователь + гость)');
anon.disconnect();

console.log('\n4) lifecycle: purge решённого по таймеру:');
const ansList = await api('GET', `/api/questions/${q.json.id}/answers`, { token: A });
await api('POST', `/api/questions/${q.json.id}/solution`, { token: A, body: { answerId: ansList.json[0].id } });
await dbc.query(`update questions set status='solved', solved_at=now() - interval '8 days', purge_at=now() - interval '1 day' where id = $1`, [q.json.id]);
const pPurge = waitEvent(sockA, 'notification', 3000);
const sweep1 = await runLifecycleSweep();
ok(sweep1.purged === 1, 'sweep нашёл и архивировал 1 вопрос');
const pur = await pPurge;
ok(!!pur && pur.type === 'purge' && pur.payload?.questionId === q.json.id, 'автор получил purge-уведомление пушем');
const qRow = await dbc.query('select purged, title, purge_summary from questions where id = $1', [q.json.id]);
ok(qRow.rows[0].purged === true && qRow.rows[0].title === '' && qRow.rows[0].purge_summary?.best_username === 'Bob', 'вопрос стал заглушкой: purged, пустой title, purge_summary с best_username');
const bobProf = await dbc.query('select purged_answers_count from profiles where id = $1', [bob.json.user.id]);
ok(bobProf.rows[0].purged_answers_count === 1, 'purged_answers_count ответающего incremented');
const sweep1b = await runLifecycleSweep();
ok(sweep1b.purged === 0, 'повторный sweep идемпотентен');

console.log('\n5) lifecycle: напоминания 24ч и 3 дня, без дублей:');
const q2 = await api('POST', '/api/questions', { token: A, body: { title: 'Рычащий бас для DnB?', description: 'Не выходит грязь с субом', synth: 'Serum' } });
await dbc.query(`insert into answers (question_id, user_id, content, created_at) values ($1, $2, 'Первый ответ.', now() - interval '25 hours')`, [q2.json.id, bob.json.user.id]);
const pRem = waitEvent(sockA, 'notification', 3000);
const sweep2 = await runLifecycleSweep();
ok(sweep2.reminders === 1, 'напоминание 24ч отправлено');
const rem = await pRem;
ok(!!rem && rem.type === 'reminder' && rem.payload?.questionId === q2.json.id, 'автор получил reminder пушем');
const sweep2b = await runLifecycleSweep();
ok(sweep2b.reminders === 0, 'повторный sweep не дублирует 24ч');
await dbc.query(`update answers set created_at = now() - interval '4 days' where question_id = $1`, [q2.json.id]);
const sweep3 = await runLifecycleSweep();
ok(sweep3.reminders === 1, 'после 3 дней — второе напоминание');
const flags = await dbc.query('select reminder_24h, reminder_3d from questions where id = $1', [q2.json.id]);
ok(flags.rows[0].reminder_24h === true && flags.rows[0].reminder_3d === true, 'флаги напоминаний проставлены (тишина после)');

sockA.disconnect();
server.close();
await dbc.end();
fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки backend Фазы B пройдены');
process.exit(fails ? 1 : 0);
