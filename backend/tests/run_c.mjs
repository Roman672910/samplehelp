// backend/tests/run_c.mjs — интеграционные тесты Фазы C (заход 48).
// Новые/расширенные эндпойнты для механического адаптера api.mjs:
// справочники, агрегат профиля + dev-contact, user_id/unanswered в ленте,
// полный PATCH вопросов/ответов (+edited_at, сброс аудио), пакетные ответы,
// best-ответы, правка комментариев + count-mine, likes/status, избранное
// (on/off-идемпотентность, status, вложенный question+author), обогащённые
// жалобы (reporter/target), donations/count + confirmed в уведомлении,
// одиночная выдача достижений, ref-candidates/ref-card, logout, /files-статика,
// CORS-префлайт. Живой PostgreSQL (sh_test), как run.mjs/run_b.mjs.
process.env.AUTH_RATE_MAX = '1000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_test';
process.env.STORAGE_DIR = fileURLToPath(new URL('./storage-tmp-c', import.meta.url));
process.env.JWT_SECRET = 'test-secret';
process.env.REFRESH_SECRET = 'test-refresh-secret';

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
await dbc.query("update owner_config set owner_email = 'alice@test.ru'");
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
    body: raw ? body : (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, json, headers: res.headers };
}

console.log('0) подготовка: alice (владелец/админ) и bob:');
const alice = await api('POST', '/api/auth/register', { body: { email: 'alice@test.ru', password: 'secret1', username: 'Alice' } });
const bob = await api('POST', '/api/auth/register', { body: { email: 'bob@test.ru', password: 'secret1', username: 'Bob' } });
const A = alice.json.access;
const B = bob.json.access;
const AID = alice.json.user.id;
const BID = bob.json.user.id;
ok(alice.status === 201 && bob.status === 201, 'оба аккаунта созданы');

console.log('\n1) справочники (сиды + добавление):');
const synths = await api('GET', '/api/catalog/synths');
ok(Array.isArray(synths.json) && synths.json.includes('Serum') && synths.json.includes('Vital'), 'сиды синтезаторов на месте (Serum, Vital)');
const daws = await api('GET', '/api/catalog/daws');
ok(daws.json.includes('FL Studio') && daws.json.includes('Reaper'), 'сиды DAW на месте');
const addSynth = await api('POST', '/api/catalog/synths', { token: B, body: { name:  'Helix Native' } });
ok(addSynth.status === 201 && (await api('GET', '/api/catalog/synths')).json.includes('Helix Native'), 'свой синтезатор добавлен в общий справочник');
const addAnon = await api('POST', '/api/catalog/daws', { body: { name: 'Nope' } });
ok(addAnon.status === 401, 'аноним справочник не пополняет (401)');

console.log('\n2) лента: sort=unanswered, фильтр user_id, bio в джойне:');
const qb = await api('POST', '/api/questions', { token: B, body: { title: 'Как сделать жирный бас?', description: 'Сингл-осциллятор не качает', synth: 'Serum', audio_url: '/files/question-audio/demo.webm', waveform_data: [0.1, 0.9, 0.4] } });
ok(qb.status === 201, 'вопрос bob создан');
const un = await api('GET', '/api/questions?sort=unanswered');
ok(un.json.some((q) => q.id === qb.json.id), 'sort=unanswered содержит вопрос без ответов');
const byUser = await api('GET', `/api/questions?user_id=${BID}`);
ok(byUser.json.length === 1 && byUser.json[0].id === qb.json.id, 'фильтр user_id отдаёт вопросы автора');
const one = await api('GET', `/api/questions/${qb.json.id}`);
ok(one.json.profile && 'bio' in one.json.profile, 'в джойне профиля есть bio (карточка вопроса)');

console.log('\n3) PATCH вопроса: поля, сброс аудио явным null, edited_at:');
const patchQ = await api('PATCH', `/api/questions/${qb.json.id}`, { token: B, body: { title: 'Как сделать жирный бас (v2)?', audio_url: null, waveform_data: null, markers: [{ time: 1.5, note: 'тут' }] } });
ok(patchQ.json.title.endsWith('(v2)?'), 'заголовок обновлён');
ok(patchQ.json.audio_url === null && patchQ.json.waveform_data === null, 'явный null сбрасывает аудио и пики');
ok(!!patchQ.json.edited_at && patchQ.json.markers.length === 1, 'edited_at проставлен, маркеры сохранены');

console.log('\n4) ответы: пакетная выборка, PATCH-поля, count-mine, best:');
const ans = await api('POST', `/api/questions/${qb.json.id}/answers`, { token: A, body: { content: 'Два осциллятора + сатурация.', audio_url: '/files/question-audio/ans.webm', waveform_data: [0.2, 0.8], tags: ['bass', 'saturation'], sound_type: 'bass', difficulty: 'medium' } });
ok(ans.status === 201, 'ответ alice создан');
const batch = await api('GET', `/api/answers?question_ids=${qb.json.id}`);
ok(batch.json.length === 1 && batch.json[0].profile.username === 'Alice' && Array.isArray(batch.json[0].comments), 'пакетная выборка: профиль автора + массив комментариев');
const pA = await api('PATCH', `/api/answers/${ans.json.id}`, { token: A, body: { content: 'Два осциллятора + сатурация + суб.', tags: ['bass'], sound_type: 'bass', difficulty: 'easy' } });
ok(pA.json.content.includes('суб') && pA.json.difficulty === 'easy' && !!pA.json.edited_at, 'PATCH ответа: content/difficulty + edited_at');
const pAnon = await api('PATCH', `/api/answers/${ans.json.id}`, { token: B, body: { content: 'взлом' } });
ok(pAnon.status === 403, 'чужой ответ не правится (403)');
const byUserA = await api('GET', `/api/answers?user_id=${AID}`);
ok(byUserA.json.length === 1 && byUserA.json[0].question?.id === qb.json.id, 'ответы автора с родителем-вопросом (профиль)');
const best = await api('GET', `/api/answers?best=1&user_id=${AID}&limit=3`);
ok(best.json.length === 1 && best.json[0].question && 'purged' in best.json[0].question, 'best-ответы со звуком + question{purged}');
const cm = await api('POST', `/api/answers/${ans.json.id}/comments`, { token: B, body: { content: 'Спасибо, сатурация помогла!' } });
ok(cm.status === 201, 'комментарий создан');
const cmPatch = await api('PATCH', `/api/answers/comments/${cm.json.id}`, { token: B, body: { content: 'Спасибо! Сатурация + sub — огонь.' } });
ok(cmPatch.json.content.includes('огонь') && !!cmPatch.json.edited_at, 'PATCH комментария + edited_at');
const cmOther = await api('PATCH', `/api/answers/comments/${cm.json.id}`, { token: A, body: { content: 'чужое' } });
ok(cmOther.status === 403, 'чужой комментарий не правится (403)');
const cntMine = await api('GET', '/api/answers/count-mine', { token: B });
ok(cntMine.json.count === 1, 'count-mine: своих комментариев — 1');

console.log('\n5) лайки: статус и toggle:');
const ls0 = await api('GET', `/api/likes/status?target_type=answer&target_id=${ans.json.id}`, { token: B });
ok(ls0.json.liked === false, 'до лайка status=false');
await api('POST', '/api/likes/toggle', { token: B, body: { target_type: 'answer', target_id: ans.json.id } });
const ls1 = await api('GET', `/api/likes/status?target_type=answer&target_id=${ans.json.id}`, { token: B });
ok(ls1.json.liked === true, 'после toggle status=true');
const lsAnon = await api('GET', `/api/likes/status?target_type=answer&target_id=${ans.json.id}`);
ok(lsAnon.json.liked === false, 'аноним: liked=false (без 401)');

console.log('\n6) избранное: идемпотентный on/off, status, форма списка:');
await api('POST', '/api/favorites/toggle', { token: B, body: { question_id: qb.json.id, on: true } });
await api('POST', '/api/favorites/toggle', { token: B, body: { question_id: qb.json.id, on: true } });
const favList = await api('GET', '/api/favorites', { token: B });
ok(favList.json.length === 1, 'двойной on=true не дублирует (идемпотентность)');
const f0 = favList.json[0];
ok(f0.question_id === qb.json.id && f0.status === 'preparing' && f0.question?.author?.username === 'Bob', 'форма строки: question_id + status + question.author');
const favSt = await api('POST', '/api/favorites/status', { token: B, body: { question_id: qb.json.id, status: 'ready' } });
ok(favSt.json.status === 'ready', 'статус «готово» принят');
ok((await api('GET', '/api/favorites', { token: B })).json[0].status === 'ready', 'статус виден в списке');
await api('POST', '/api/favorites/toggle', { token: B, body: { question_id: qb.json.id, on: false } });
ok((await api('GET', '/api/favorites', { token: B })).json.length === 0, 'on=false удаляет (идемпотентно)');

console.log('\n7) жалобы: reporter/target на сервере, remove:');
const rep = await api('POST', '/api/reports', { token: B, body: { target_type: 'question', target_id: qb.json.id, reason: 'spam', note: 'похоже на спам' } });
ok(rep.status === 201, 'жалоба создана');
const repList = await api('GET', '/api/reports?status=new', { token: A });
ok(repList.json.length === 1 && repList.json[0].reporter?.username === 'Bob', 'reporter с username (композиция сервера)');
ok(repList.json[0].target?.kind === 'question' && repList.json[0].target?.title.includes('(v2)'), 'target: kind + свежий заголовок вопроса');
const rm = await api('POST', `/api/reports/${rep.json.id}/remove`, { token: A });
ok(rm.json.ok === true, 'remove: контент удалён, жалоба actioned');
ok((await api('GET', `/api/questions/${qb.json.id}`)).status === 404, 'вопрос действительно удалён');

console.log('\n8) донаты: счётчики, confirmed-уведомление, проект:');
const q2 = await api('POST', '/api/questions', { token: A, body: { title: 'Вопрос для отметок', description: 'тест донатов' } });
const mark = await api('POST', '/api/donations/mark', { token: B, body: { recipientUserId: AID, amount: 300, message: 'за пресет' } });
ok(mark.status === 201, 'отметка перевода создана');
const cnt = await api('GET', `/api/donations/count?recipient_user_id=${AID}`);
ok(cnt.json.count === 1, 'публичный счётчик ☕ получателя = 1');
await api('POST', '/api/donations/thanks', { token: B, body: { recipient_user_id: null, message: 'спасибо проекту' } });
const cntProj = await api('GET', '/api/donations/count?recipient_user_id=project');
ok(cntProj.json.count === 1, 'счётчик поддержки проекта (null-получатель) = 1');
await api('POST', `/api/donations/${mark.json.id}/confirm`, { token: A });
const notifA = await api('GET', '/api/notifications', { token: A });
const supN = notifA.json.find((n) => n.type === 'support' && n.payload?.donationId === mark.json.id);
ok(!!supN && supN.payload.confirmed === true, 'уведомление автора помечено confirmed (кнопка «Получено ✓» гаснет)');

console.log('\n9) достижения: одиночная выдача:');
const aw1 = await api('POST', '/api/achievements', { token: B, body: { achievement_type: 'first_answer' } });
ok(aw1.status === 201 && aw1.json.awarded === true, 'первая выдача → awarded=true');
const aw2 = await api('POST', '/api/achievements', { token: B, body: { achievement_type: 'first_answer' } });
ok(aw2.json.awarded === false, 'повтор → awarded=false (без дубля)');
ok((await api('GET', '/api/achievements', { token: B })).json.some((r) => r.achievement_type === 'first_answer'), 'список своих достижений');

console.log('\n10) ЛС: edited_at, ref-candidates, ref-card:');
const q3 = await api('POST', '/api/questions', { token: B, body: { title: 'Ещё вопрос про пэды', description: 'для ref-карточек' } });
const a3 = await api('POST', `/api/questions/${q3.json.id}/answers`, { token: A, body: { content: 'Попробуй хорус перед ревером.' } });
const msg = await api('POST', '/api/messages', { token: B, body: { recipient_id: AID, content: 'Привет!' } });
const msgPatch = await api('PATCH', `/api/messages/${msg.json.id}`, { token: B, body: { content: 'Привет! (дополнено)' } });
ok(!!msgPatch.json.edited_at, 'edited_at у сообщения проставляется');
const refs = await api('GET', '/api/messages/ref-candidates', { token: B });
ok(refs.json.questions.some((x) => x.id === q3.json.id && x.type === 'question'), 'ref-candidates: мои вопросы');
const refsA = await api('GET', '/api/messages/ref-candidates', { token: A });
ok(refsA.json.answers.some((x) => x.id === a3.json.id && x.title.includes('пэды')), 'ref-candidates: мои ответы с заголовком вопроса');
const cardQ = await api('GET', `/api/messages/ref-card?type=question&id=${q3.json.id}`);
ok(cardQ.json.href === `/question/${q3.json.id}` && cardQ.json.author === 'Bob', 'ref-card вопроса: href + автор');
const cardA = await api('GET', `/api/messages/ref-card?type=answer&id=${a3.json.id}`);
ok(cardA.json.href === `/question/${q3.json.id}` && cardA.json.type === 'answer', 'ref-card ответа ведёт на вопрос');
const cardP = await api('GET', `/api/messages/ref-card?type=profile&id=${AID}`);
ok(cardP.json.title === 'Alice' && cardP.json.href === `/profile/${AID}`, 'ref-card профиля');
const cardX = await api('GET', '/api/messages/ref-card?type=question&id=00000000-0000-0000-0000-000000000000');
ok(cardX.json === null, 'исчезнувшая цель → null');

console.log('\n11) профиль: агрегат и dev-contact:');
const profB = await api('GET', `/api/profiles/${BID}`, { token: A });
ok(profB.json.stats && profB.json.stats.questions === 1 && Array.isArray(profB.json.questions), 'агрегат: stats + questions[]');
ok(profB.json.answers.length === 0 && profB.json.software !== undefined, 'агрегат: answers[] и словари на месте');
const dev = await api('GET', '/api/profiles/dev-contact');
ok(dev.json?.id === AID && dev.json.username === 'Alice', 'dev-contact: первый админ');

console.log('\n12) logout: refresh сгорает:');
const carol = await api('POST', '/api/auth/register', { body: { email: 'carol@test.ru', password: 'secret1', username: 'Carol' } });
const lo = await api('POST', '/api/auth/logout', { body: { refresh: carol.json.refresh } });
ok(lo.json.ok === true, 'logout принят');
const refAfter = await api('POST', '/api/auth/refresh', { body: { refresh: carol.json.refresh } });
ok(refAfter.status === 401, 'после logout refresh-токен не работает (401)');

console.log('\n13) файлы и CORS:');
const fd = new FormData();
fd.append('file', new Blob([Buffer.from('opusdata')], { type: 'audio/webm' }), 'take.webm');
const up = await api('POST', '/api/upload/question-audio', { token: B, body: fd, raw: true });
ok(up.status === 201 && up.json.url.startsWith('/files/question-audio/'), 'upload → публичный url /files/…');
const fileRes = await fetch(BASE + up.json.url);
ok(fileRes.status === 200 && (await fileRes.text()) === 'opusdata', 'файл отдаётся по /files/<bucket>/<name>');
const priv = await fetch(`${BASE}/files/marketplace-files/whatever`);
ok(priv.status === 404, 'приватный бакет НЕ торчит через /files (404)');
const pre = await fetch(`${BASE}/api/questions`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://localhost:3000', 'CORS-префлайт: 204 + Allow-Origin по Origin');

console.log('\n14) Windows-безопасность STORAGE_DIR (фикс 2026-10-16: .pathname давал «/K:/…» → EINVAL → 500 на загрузке аудио):');
{
  const cfgSrc = fs.readFileSync(fileURLToPath(new URL('../src/config.js', import.meta.url)), 'utf8');
  ok(cfgSrc.includes('fileURLToPath') && !/STORAGE_DIR[^\n]*\.pathname/.test(cfgSrc), 'config.js: STORAGE_DIR через fileURLToPath (не .pathname)');
  // Дефолтная ветка (без env) — в дочернем процессе: путь должен быть нативным абсолютным
  const out = execFileSync(process.execPath, ['-e',
    "delete process.env.STORAGE_DIR; import('./src/config.js').then(m => console.log(m.CONFIG.STORAGE_DIR));"],
  { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim();
  ok(path.isAbsolute(out) && !/^\/[A-Za-z]:/.test(out), `дефолт STORAGE_DIR — нативный абсолютный путь: ${out}`);
  const { CONFIG: C } = await import('../src/config.js');
  ok(path.isAbsolute(C.STORAGE_DIR) && !/^\/[A-Za-z]:/.test(C.STORAGE_DIR), 'STORAGE_DIR из env тоже нормализован (тесты на Windows)');
}

server.close();
console.log(fails ? `\n✗ Фаза C: ${fails} провалов` : '\n✓ Все проверки backend Фазы C пройдены');
process.exit(fails ? 1 : 0);
