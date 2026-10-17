// backend/tools/realtime-demo.mjs — РУЧНАЯ проверка Фазы B без браузера.
// Запуск: сначала поднят сервер (node src/app.js), затем:
//   node tools/realtime-demo.mjs [url]   (по умолчанию http://localhost:3100)
// Скрипт сам регистрирует двух пользователей, открывает два сокета и прогоняет
// сценарии: пуш уведомления, пуш ЛС, typing, presence с гостем.
import { io as ioClient } from 'socket.io-client';

const BASE = process.argv[2] || 'http://localhost:3100';
const suffix = Date.now().toString(36);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitEvent = (sock, name, ms = 3000) => new Promise((res) => {
  const t = setTimeout(() => res(null), ms);
  sock.once(name, (d) => { clearTimeout(t); res(d); });
});

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log(`→ Сервер: ${BASE}`);
const health = await api('GET', '/api/health');
if (health.status !== 200) { console.error('✗ Сервер не отвечает на /api/health — поднимите: node src/app.js'); process.exit(1); }
console.log('✓ /api/health отвечает');

const alice = await api('POST', '/api/auth/register', { body: { email: `alice-${suffix}@test.local`, password: 'secret1', username: `Alice_${suffix}` } });
const bob = await api('POST', '/api/auth/register', { body: { email: `bob-${suffix}@test.local`, password: 'secret1', username: `Bob_${suffix}` } });
if (!alice.json?.access || !bob.json?.access) { console.error('✗ регистрация не удалась:', alice.json, bob.json); process.exit(1); }
console.log(`✓ зарегистрированы ${alice.json.user.username} и ${bob.json.user.username}`);

const sockA = ioClient(BASE, { auth: { token: alice.json.access }, transports: ['websocket'] });
const sockB = ioClient(BASE, { auth: { token: bob.json.access }, transports: ['websocket'] });
await Promise.all([new Promise((r) => sockA.on('connect', r)), new Promise((r) => sockB.on('connect', r))]);
console.log('✓ два сокета подключены');

// 1. Уведомление живым пушем
const q = await api('POST', '/api/questions', { token: alice.json.access, body: { title: `Демо-вопрос ${suffix}`, description: 'Проверка realtime-пуша уведомлений', synth: 'Serum' } });
const pN = waitEvent(sockA, 'notification');
await api('POST', `/api/questions/${q.json.id}/answers`, { token: bob.json.access, body: { content: 'Демо-ответ для проверки пуша уведомления автору вопроса.' } });
const n = await pN;
console.log(n && n.type === 'answer' ? `✓ пуш уведомления: ${n.type} (вопрос ${n.payload.questionId.slice(0, 8)}…)` : `✗ пуш уведомления не дошёл: ${JSON.stringify(n)}`);

// 2. ЛС пушем обеим сторонам
const pM = waitEvent(sockA, 'message');
await api('POST', '/api/messages', { token: bob.json.access, body: { recipient_id: alice.json.user.id, content: 'Привет! Это live-сообщение.' } });
const m = await pM;
console.log(m ? `✓ пуш ЛС: «${m.content}»` : '✗ пуш ЛС не дошёл');

// 3. Typing
const pT = waitEvent(sockA, 'typing');
sockB.emit('typing', { to: alice.json.user.id, conv: 'demo' });
const t = await pT;
console.log(t ? `✓ typing от ${t.username}` : '✗ typing не дошёл');

// 4. Presence с гостем
const room = 'presence:global';
const states = [];
sockA.on('presence', (st) => { if (st.room === room) states.push(st); });
sockA.emit('presence:track', { room, meta: { uid: alice.json.user.id, username: alice.json.user.username, guest: false } });
sockB.emit('presence:track', { room, meta: { uid: bob.json.user.id, username: bob.json.user.username, guest: false } });
const anon = ioClient(BASE, { transports: ['websocket'] });
await new Promise((r) => anon.on('connect', r));
anon.emit('presence:track', { room, meta: { guest: true } });
await wait(800); // presence пересчитывается на каждый track — берём итоговое состояние
const p = states[states.length - 1];
console.log(p && p.users.length === 2 && p.guests >= 1 ? `✓ presence: ${p.users.length} пользователя + ${p.guests} гост(я/ей) = ${p.total}` : `✗ presence: ${JSON.stringify(p)}`);

sockA.disconnect(); sockB.disconnect(); anon.disconnect();
console.log('Готово. Сценарии выше помечены ✓/✗ — это и есть ручная проверка Фазы B.');
process.exit(0);
