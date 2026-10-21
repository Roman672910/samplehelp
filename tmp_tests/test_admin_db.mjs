// test_admin_db.mjs — заход 50: экран «🗄 Данные» (/admin); заход 52 — русификация.
// Проверяет: guard (гость/не-админ → редирект, контента нет), демо-заглушку,
// LOCAL-рендер на fetch-mock: список таблиц с оценками строк, авто-открытие
// первой, грид (типы колонок, 🔑 у PK), пагинация по 50 (offset в запросе,
// disabled на краях), сортировка кликом (order_by/dir/сброс offset в запросе,
// ▲/▼ в шапке), карточка строки в модалке (все колонки, jsonb — pre, uuid
// целиком), кнопка «Обновить» перечитывает.
// Заход 52 (PLAN_REAL_MODE T1): русские имена таблиц/колонок из словаря
// admin_db.schema.* (ru.json), оригиналы — в title и подстрочниках;
// fallback на оригинал для неизвестных имён (mystery_tbl); словарь синхронен
// с backend/src/schema.sql (парсер create table + alter add column; скрытые
// refresh/reset_tokens и users.password_hash исключены).
// Mock честный: 120 строк, limit/offset/dir берутся из query запроса.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const fs = await import('node:fs');

// ---------- данные мока: 120 строк questions ----------
const TOTAL = 120;
const uuidOf = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const FULL = Array.from({ length: TOTAL }, (_, i) => ({
  id: uuidOf(i),
  title: `Q-${String(i).padStart(3, '0')}`,
  markers: i % 2 ? [] : [{ time: i, note: 'заметка' }],
  created_at: new Date(Date.UTC(2026, 9, 1 + (i % 28), 8)).toISOString(),
}));
const COLUMNS = [
  { name: 'id', type: 'uuid', nullable: false, pk: true },
  { name: 'title', type: 'text', nullable: false, pk: false },
  { name: 'markers', type: 'jsonb', nullable: false, pk: false },
  { name: 'created_at', type: 'timestamp with time zone', nullable: false, pk: false },
];

// ---------- fetch-mock ----------
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET' });
  if (u.includes('/locales/ru.json')) return j(JSON.parse(fs.readFileSync('public/locales/ru.json', 'utf8')));
  if (u.endsWith('/api/admin/tables')) return j([
    { name: 'questions', rows_estimate: 118 },
    { name: 'users', rows_estimate: 2 },
    { name: 'mystery_tbl', rows_estimate: 0 }, // заход 52: нет в словаре → fallback
  ]);
  if (u.includes('/api/admin/tables/questions/meta')) return j({ name: 'questions', rows_total: TOTAL, columns: COLUMNS });
  if (u.includes('/api/admin/tables/mystery_tbl/meta')) return j({
    name: 'mystery_tbl', rows_total: 0,
    columns: [{ name: 'weird_col', type: 'text', nullable: true, pk: true }],
  });
  if (u.includes('/api/admin/tables/mystery_tbl/rows')) return j({ rows: [], limit: 50, offset: 0, order_by: '', dir: 'asc' });
  if (u.includes('/api/admin/tables/questions/rows')) {
    const limit = Number(/limit=(\d+)/.exec(u)?.[1] || 50);
    const offset = Number(/offset=(\d+)/.exec(u)?.[1] || 0);
    const dir = /dir=desc/.test(u) ? 'desc' : 'asc';
    const order = /order_by=([a-z_]+)/.exec(u)?.[1] || 'id';
    let sorted = [...FULL];
    if (order === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    if (dir === 'desc') sorted.reverse();
    return j({ rows: sorted.slice(offset, offset + limit), limit, offset, order_by: order, dir });
  }
  throw new Error('unexpected fetch: ' + u);
};
function j(body) {
  return {
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ---------- модули ----------
const { CONFIG } = await import('../public/js/config.mjs');
CONFIG.USE_LOCAL_BACKEND = true;
CONFIG.API_URL = 'http://api.test';
const { setState } = await import('../public/js/store.mjs');
const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { renderAdminDb } = await import('../public/js/admin-db.mjs');
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const thOf = (box, col) => [...box.querySelectorAll('.adb-th')].find((x) => x.dataset.col === col);

console.log('1) guard: гость и не-админ не видят ничего:');
{
  setState({ user: null });
  const el = document.createElement('div');
  document.body.appendChild(el);
  await renderAdminDb(el);
  await tick();
  ok(el.innerHTML === '' && location.pathname === '/', 'гость: guard развернул на главную, контейнер пуст');
  el.remove();

  setState({ user: { id: 'u-1', username: 'neo', is_admin: false } });
  const el2 = document.createElement('div');
  document.body.appendChild(el2);
  await renderAdminDb(el2);
  await tick();
  ok(el2.innerHTML === '', 'не-админ: контента нет (guard)');
  el2.remove();
}

console.log('\n2) LOCAL: список таблиц + авто-открытие + грид:');
setState({ user: { id: 'u-admin', username: 'root', is_admin: true } });
const box = document.createElement('div');
document.body.appendChild(box);
await renderAdminDb(box);
await tick(80);
{
  const btns = box.querySelectorAll('.adb-table-btn');
  ok(btns.length === 3 && btns[0].dataset.table === 'questions', 'список таблиц из /api/admin/tables (3 шт.)');
  ok(btns[0].classList.contains('active') && btns[0].textContent.includes('≈118'), 'первая таблица активна, оценка строк видна');
  // заход 52: русские имена + оригиналы
  ok(btns[0].querySelector('.adb-table-name').textContent === 'Вопросы', 'список: русское имя таблицы («Вопросы»)');
  ok(btns[0].querySelector('.adb-table-orig')?.textContent === 'questions', 'список: оригинал-подстрочник (questions)');
  ok(btns[0].title === 'questions', 'список: оригинал в title-подсказке');
  ok(box.querySelector('.admin-db-name').textContent.includes('Вопросы')
    && box.querySelector('.admin-db-name .adb-orig')?.textContent === 'questions', 'заголовок грида: «Вопросы» + оригинал-подстрочник');
  const ths = [...box.querySelectorAll('.adb-th')];
  ok(ths.length === 4 && ths[0].textContent.includes('🔑'), 'грид: 4 колонки, у id — значок PK');
  ok(ths[1].textContent.includes('text') && ths[2].textContent.includes('jsonb'), 'типы колонок в шапке');
  ok(thOf(box, 'id').querySelector('.adb-col').textContent === 'ID 🔑', 'заход 52: колонка id → «ID» + 🔑');
  ok(thOf(box, 'title').querySelector('.adb-col').textContent === 'Заголовок', 'заход 52: колонка title → «Заголовок»');
  ok(thOf(box, 'title').title.startsWith('title — '), 'заход 52: оригинал колонки в title (через тире от подсказки сортировки)');
  ok(box.querySelectorAll('.adb-row').length === 50, 'первая страница: 50 строк (лимит по умолчанию)');
  ok(box.querySelector('.adb-total').textContent.includes('120'), 'точное число строк из meta (120)');
  ok(box.querySelector('.adb-grid').textContent.includes('Q-000'), 'значения строк на месте');
  ok(!!box.querySelector('.adb-json') && !!box.querySelector('.adb-time'), 'jsonb- и time-ячейки отрисованы');
  ok(box.querySelector('.adb-pager .adb-page').textContent.includes('1–50 из 120'), 'пейджер: 1–50 из 120');
  ok(box.querySelector('#adb-prev').disabled === true && box.querySelector('#adb-next').disabled === false, 'пейджер-кнопки: назад disabled, вперёд активна');
}

console.log('\n3) пагинация и сортировка уходят на сервер:');
{
  box.querySelector('#adb-next').click();
  await tick(80);
  ok(calls.some((c) => c.url.includes('/rows') && c.url.includes('offset=50')), 'клик «›» → запрос с offset=50');
  ok(box.querySelector('.adb-page').textContent.includes('51–100 из 120'), 'вторая страница: «51–100 из 120»');
  box.querySelector('#adb-next').click();
  await tick(80);
  ok(calls.some((c) => c.url.includes('offset=100')), 'ещё «›» → offset=100');
  ok(box.querySelectorAll('.adb-row').length === 20 && box.querySelector('.adb-page').textContent.includes('101–120 из 120'), 'последняя страница: 20 строк, «101–120 из 120»');
  ok(box.querySelector('#adb-next').disabled === true, 'на последней странице «›» disabled');
  box.querySelector('#adb-prev').click();
  await tick(80);

  thOf(box, 'title').click();
  await tick(80);
  const sortCall = calls.slice(-3).find((c) => c.url.includes('/rows') && c.url.includes('order_by=title'));
  ok(!!sortCall && sortCall.url.includes('dir=asc') && sortCall.url.includes('offset=0'), 'клик по title → order_by=title&dir=asc&offset=0 (смена колонки сбрасывает страницу)');
  ok(thOf(box, 'title').querySelector('.adb-dir')?.textContent === '▲', 'в шапке индикатор ▲ (свежий DOM после перерисовки)');
  thOf(box, 'title').click();
  await tick(80);
  ok(calls.slice(-2).some((c) => c.url.includes('dir=desc')), 'повторный клик → dir=desc');
  ok(box.querySelector('.adb-row .adb-text')?.textContent === 'Q-119', 'desc: первой идёт последняя строка (Q-119)');
}

console.log('\n4) карточка строки и обновление:');
{
  box.querySelector('.adb-row').click();
  await tick(40);
  const modal = document.getElementById('modal-root');
  ok(!!modal.querySelector('.adb-card'), 'клик по строке → модалка с карточкой');
  ok(modal.querySelectorAll('.adb-card-row').length === 4, 'в карточке все 4 колонки');
  ok(!!modal.querySelector('.adb-pre'), 'jsonb в карточке — pretty pre');
  ok(modal.textContent.includes(uuidOf(119)), 'uuid в карточке ПОЛНОСТЬЮ (строка Q-119)');
  // заход 52: русские имена в карточке
  const dts = [...modal.querySelectorAll('.adb-card-row dt')];
  ok(dts[1].textContent.includes('Заголовок') && dts[1].title === 'title', 'карточка: «Заголовок» + оригинал в title');
  ok(modal.textContent.includes('Строка: Вопросы'), 'заголовок модалки: «Строка: Вопросы» (таблица по-русски)');
  const tablesBefore = calls.filter((c) => c.url.endsWith('/api/admin/tables')).length;
  box.querySelector('#adb-refresh').click();
  await tick(80);
  ok(calls.filter((c) => c.url.endsWith('/api/admin/tables')).length === tablesBefore + 1, '«Обновить» перечитывает список таблиц');
  ok(box.querySelectorAll('.adb-row').length === 50, 'после обновления грид живой (сброс к первой странице)');
}

console.log('\n5) заход 52: fallback — неизвестные имена остаются оригиналами:');
{
  [...box.querySelectorAll('.adb-table-btn')].find((b) => b.dataset.table === 'mystery_tbl').click();
  await tick(80);
  ok(box.querySelector('.admin-db-name').textContent.trim() === 'mystery_tbl', 'нет ключа таблицы → имя как в БД');
  ok(!box.querySelector('.admin-db-name .adb-orig'), 'при fallback нет дубля-подстрочника');
  ok(box.querySelector('.adb-th .adb-col').textContent === 'weird_col 🔑', 'нет ключа колонки → оригинал (+🔑 PK)');
  const side = [...box.querySelectorAll('.adb-table-btn')].find((b) => b.dataset.table === 'mystery_tbl');
  ok(side.querySelector('.adb-table-name').textContent === 'mystery_tbl' && !side.querySelector('.adb-table-orig'), 'в списке: оригинал без подстрочника');
}

console.log('\n6) демо-режим: честная заглушка:');
{
  CONFIG.USE_LOCAL_BACKEND = false;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const before = calls.length;
  await renderAdminDb(el);
  await tick(40);
  ok(el.textContent.includes('только при подключённом backend'), 'демо: заглушка с объяснением');
  ok(calls.length === before, 'демо: ни одного запроса к админ-API');
  el.remove();
  CONFIG.USE_LOCAL_BACKEND = true;
}

console.log('\n7) заход 52: словарь admin_db.schema синхронен со схемой backend:');
{
  // Эталон — backend/src/schema.sql: create table + alter table add column,
  // минус скрытое сервером (refresh_tokens, reset_tokens, users.password_hash).
  const sql = fs.readFileSync('backend/src/schema.sql', 'utf8');
  const HIDDEN_T = new Set(['refresh_tokens', 'reset_tokens']);
  const hiddenCol = (tb, c) => tb === 'users' && c === 'password_hash';
  const ref = new Map();
  let cur = null;
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    const cm0 = line.match(/^create table if not exists (\w+)\s*\(/i);
    if (cm0) { cur = HIDDEN_T.has(cm0[1]) ? null : cm0[1]; if (cur) ref.set(cur, new Set()); continue; }
    if (cur) {
      if (/^\);/.test(line)) { cur = null; continue; }
      if (!line || line.startsWith('--')) continue;
      if (/^(primary key|foreign key|unique|check|constraint|exclude)\b/i.test(line)) continue;
      const cm = line.match(/^([a-z_]\w*)/i);
      if (cm && !hiddenCol(cur, cm[1])) ref.get(cur).add(cm[1]);
      continue;
    }
    const am = line.match(/^alter table (\w+) add column if not exists (\w+)/i);
    if (am && !HIDDEN_T.has(am[1]) && !hiddenCol(am[1], am[2])) {
      if (!ref.has(am[1])) ref.set(am[1], new Set());
      ref.get(am[1]).add(am[2]);
    }
  }
  const dict = JSON.parse(fs.readFileSync('public/locales/ru.json', 'utf8')).admin_db.schema;
  const totalCols = [...ref.values()].reduce((s, c) => s + c.size, 0);
  ok(ref.size === 20 && totalCols === 136, `эталон схемы: 20 таблиц / 136 колонок (парсер: ${ref.size}/${totalCols})`);
  ok(Object.keys(dict.tables).length === ref.size, `в словаре столько же таблиц (${Object.keys(dict.tables).length})`);
  const missingT = [], missingC = [], orphan = [];
  for (const [tb, cols] of ref) {
    if (typeof dict.tables[tb] !== 'string' || !dict.tables[tb]) missingT.push(tb);
    const dc = dict.cols[tb] || {};
    for (const c of cols) if (typeof dc[c] !== 'string' || !dc[c]) missingC.push(`${tb}.${c}`);
    for (const k of Object.keys(dc)) if (!cols.has(k)) orphan.push(`${tb}.${k}`);
  }
  for (const tb of Object.keys(dict.tables)) if (!ref.has(tb)) orphan.push(`таблица:${tb}`);
  ok(missingT.length === 0, `у всех таблиц есть русское имя${missingT.length ? ` (нет: ${missingT.join(', ')})` : ''}`);
  ok(missingC.length === 0, `у всех колонок есть русское имя${missingC.length ? ` (нет: ${missingC.slice(0, 6).join(', ')})` : ''}`);
  ok(orphan.length === 0, `в словаре нет сирот вне схемы${orphan.length ? ` (${orphan.slice(0, 6).join(', ')})` : ''}`);
}

console.log(fails ? `\n✗ admin-db: ${fails} провалов` : '\n✓ admin-db: все проверки пройдены');
process.exit(fails ? 1 : 0);
