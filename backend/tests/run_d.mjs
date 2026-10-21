// backend/tests/run_d.mjs — интеграционные тесты захода 50: админ-просмотрщик БД.
// Живой PostgreSQL (sh_test), как run/run_b/run_c. Матрица: права (аноним/юзер/
// админ), белый список таблиц (refresh_tokens/reset_tokens скрыты), секретные
// колонки (users.password_hash не выезжает ни в одном ответе), валидация
// limit/offset/order_by, детерминированная пагинация, 404 на неизвестную таблицу.
process.env.AUTH_RATE_MAX = '1000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_test';
process.env.JWT_SECRET = 'test-secret';
process.env.REFRESH_SECRET = 'test-refresh-secret';

import fs from 'node:fs';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
process.env.STORAGE_DIR = fileURLToPath(new URL('./storage-tmp-d', import.meta.url));

// ---------- чистая БД + схема ----------
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
await admin.query('drop schema if exists public cascade; create schema public;');
await admin.end();
const schema = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
await dbc.connect();
await dbc.query(schema);
await dbc.query("update owner_config set owner_email = 'alice@test.ru'");
await dbc.end();
fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });

const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
await new Promise((r) => server.once('listening', r));
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
  return { status: res.status, json, text: JSON.stringify(json) };
}

console.log('0) подготовка: alice — админ (owner), bob — обычный:');
const alice = await api('POST', '/api/auth/register', { body: { email: 'alice@test.ru', password: 'secret1', username: 'Alice' } });
const bob = await api('POST', '/api/auth/register', { body: { email: 'bob@test.ru', password: 'secret1', username: 'Bob' } });
const A = alice.json.access;
const B = bob.json.access;
ok(alice.json.user.is_admin === true && bob.json.user.is_admin === false, 'роли раздались (owner-бутстрап)');

console.log('\n1) права: аноним и не-админ не проходят:');
ok((await api('GET', '/api/admin/tables')).status === 401, 'аноним → 401 на /tables');
ok((await api('GET', '/api/admin/tables', { token: B })).status === 403, 'не-админ → 403 на /tables');
ok((await api('GET', '/api/admin/tables/questions/meta', { token: B })).status === 403, 'не-админ → 403 на meta');
ok((await api('GET', '/api/admin/tables/questions/rows', { token: B })).status === 403, 'не-админ → 403 на rows');

console.log('\n2) список таблиц: белые/скрытые:');
const list = await api('GET', '/api/admin/tables', { token: A });
const names = list.json.map((t) => t.name);
ok(list.status === 200 && names.includes('questions') && names.includes('users') && names.includes('profiles'), 'список: продуктовые таблицы на месте');
ok(!names.includes('refresh_tokens') && !names.includes('reset_tokens'), 'секретные таблицы (refresh/reset_tokens) скрыты');
ok(names.every((n) => typeof n === 'string') && list.json.every((t) => Number.isInteger(Number(t.rows_estimate))), 'у каждой таблицы — имя и оценка строк');

console.log('\n3) meta: колонки, PK, точное число строк, секреты:');
const meta = await api('GET', '/api/admin/tables/questions/meta', { token: A });
ok(meta.status === 200 && meta.json.columns.some((c) => c.name === 'id' && c.pk === true), 'questions: id помечен PK');
ok(meta.json.columns.some((c) => c.name === 'title' && c.type === 'text'), 'questions: колонки с типами');
ok(Number.isInteger(meta.json.rows_total) && meta.json.rows_total >= 0, 'rows_total — целое');
const metaUsers = await api('GET', '/api/admin/tables/users/meta', { token: A });
ok(!metaUsers.json.columns.some((c) => c.name === 'password_hash'), 'users.meta: password_hash ИСКЛЮЧЁН');
ok(!metaUsers.text.includes('password_hash'), 'users.meta: хеш не встречается даже в сыром ответе');
ok((await api('GET', '/api/admin/tables/refresh_tokens/meta', { token: A })).status === 404, 'meta скрытой таблицы → 404');
ok((await api('GET', '/api/admin/tables/nope_nope/meta', { token: A })).status === 404, 'meta неизвестной таблицы → 404');

console.log('\n4) rows: пагинация, сортировка, валидация:');
const q1 = await api('POST', '/api/questions', { token: A, body: { title: 'Альфа-вопрос', description: 'а' } });
const q2 = await api('POST', '/api/questions', { token: B, body: { title: 'Бета-вопрос', description: 'б' } });
const q3 = await api('POST', '/api/questions', { token: A, body: { title: 'Гамма-вопрос', description: 'в' } });
ok(q1.status === 201 && q2.status === 201 && q3.status === 201, 'три вопроса созданы');
const p0 = await api('GET', '/api/admin/tables/questions/rows?limit=2&offset=0', { token: A });
const p1 = await api('GET', '/api/admin/tables/questions/rows?limit=2&offset=2', { token: A });
ok(p0.json.rows.length === 2 && p1.json.rows.length === 1, 'пагинация 2+1 покрывает 3 строки без пересечений');
const ids0 = p0.json.rows.map((r) => r.id);
ok(!p1.json.rows.some((r) => ids0.includes(r.id)), 'страницы не пересекаются');
const sorted = await api('GET', '/api/admin/tables/questions/rows?order_by=title&dir=desc', { token: A });
const titles = sorted.json.rows.map((r) => r.title);
ok(JSON.stringify(titles) === JSON.stringify([...titles].sort((a, b) => b.localeCompare(a))), 'order_by=title&dir=desc отсортирован');
ok(sorted.json.order_by === 'title' && sorted.json.dir === 'desc', 'эхо параметров сортировки');
ok((await api('GET', '/api/admin/tables/questions/rows?order_by=passw0rd', { token: A })).status === 400, 'order_by вне схемы → 400');
ok((await api('GET', '/api/admin/tables/questions/rows?limit=500', { token: A })).status === 400, 'limit=500 → 400 (рамки 1..100)');
ok((await api('GET', '/api/admin/tables/questions/rows?offset=-5', { token: A })).status === 400, 'offset=-5 → 400');
ok((await api('GET', '/api/admin/tables/nope_nope/rows', { token: A })).status === 404, 'rows неизвестной таблицы → 404');

console.log('\n5) формы значений и тотальные секреты:');
const rowQ = p0.json.rows.find((r) => r.id === q1.json.id) || p1.json.rows[0];
ok(Array.isArray(rowQ.markers), 'jsonb приходит объектом/массивом (markers)');
ok(typeof rowQ.created_at === 'string' && !Number.isNaN(Date.parse(rowQ.created_at)), 'timestamptz → ISO-строка');
const usersRows = await api('GET', '/api/admin/tables/users/rows', { token: A });
ok(usersRows.json.rows.length === 2 && usersRows.json.rows.every((r) => !('password_hash' in r)), 'users.rows: password_hash нет ни в одной строке');
const allScan = [list, meta, metaUsers, p0, p1, sorted, usersRows].map((r) => r.text).join('');
ok(!allScan.includes('password_hash') && !allScan.includes('refresh_tokens'), 'ни в одном ответе админ-API нет хешей и токен-таблиц');

console.log('\n6) jsonb-таблицы и оценки:');
const notif = await api('GET', '/api/admin/tables/notifications/rows', { token: A });
ok(notif.status === 200 && Array.isArray(notif.json.rows), 'notifications читается (payload jsonb)');
const ideas = await api('GET', '/api/admin/tables/ideas/meta', { token: A });
ok(ideas.status === 200 && ideas.json.columns.some((c) => c.name === 'dev_reply'), 'ideas meta на месте');

server.close();
fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
console.log(fails ? `\n✗ Заход 50 (backend): ${fails} провалов` : '\n✓ Все проверки backend захода 50 пройдены');
process.exit(fails ? 1 : 0);
