// backend/src/routes/admin.js — админ-просмотрщик БД (заход 50, Фаза «Данные»).
// Мини-pgAdmin внутри API: СПИСОК таблиц → МЕТА (колонки, точное число строк)
// → СТРАНИЦА строк (сортировка/пагинация). СТРОГО ЧТЕНИЕ.
// Безопасность конструктивная: клиент НЕ передаёт SQL; имя таблицы сверяется
// с белым списком information_schema (иначе 404), колонка сортировки — со
// схемой таблицы (иначе 400), limit/offset — в рамках. Секретные таблицы
// (refresh_tokens, reset_tokens) и колонка users.password_hash не выезжают
// с сервера ВООБЩЕ (фильтрация здесь, а не на клиенте).
import { Router } from 'express';
import { query, ApiError } from '../db.js';
import { requireAdmin } from '../auth.js';

export const adminRouter = Router();

// Таблицы-секреты: не показываются даже админу (токены сессий/сброса)
const HIDDEN_TABLES = new Set(['refresh_tokens', 'reset_tokens']);
// Колонки-секреты по таблицам
const HIDDEN_COLUMNS = { users: new Set(['password_hash']) };

const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 50;

/** Белый список таблиц: базовые таблицы схемы public минус секретные */
async function visibleTables() {
  const { rows } = await query(
    `select c.relname as name, greatest(c.reltuples, 0)::bigint as rows_estimate
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  return rows.filter((r) => !HIDDEN_TABLES.has(r.name));
}

async function assertVisible(name, list) {
  if (!list.includes(name)) throw new ApiError('not_found', 'Таблица не найдена', 404);
}

/** Колонки таблицы (видимые): имя, тип, nullable, pk — из information_schema */
async function columnsOf(name) {
  const { rows } = await query(
    `select c.column_name as name, c.data_type as type,
            (c.is_nullable = 'YES') as nullable,
            exists (
              select 1
                from information_schema.table_constraints tc
                join information_schema.key_column_usage kcu
                  on kcu.constraint_name = tc.constraint_name
                 and kcu.table_schema = tc.table_schema
                 and kcu.table_name = tc.table_name
               where tc.constraint_type = 'PRIMARY KEY'
                 and tc.table_schema = c.table_schema
                 and tc.table_name = c.table_name
                 and kcu.column_name = c.column_name
            ) as pk
       from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = $1
      order by c.ordinal_position`,
    [name],
  );
  const hidden = HIDDEN_COLUMNS[name] || new Set();
  return rows.filter((r) => !hidden.has(r.name));
}

/** Имя таблицы в SQL — только после белого списка; кавычки экранируем */
const qIdent = (name) => `"${name.replace(/"/g, '""')}"`;

// ---------- GET /api/admin/tables ----------
adminRouter.get('/tables', requireAdmin, async (req, res, next) => {
  try {
    res.json(await visibleTables());
  } catch (e) { next(e); }
});

// ---------- GET /api/admin/tables/:name/meta ----------
adminRouter.get('/tables/:name/meta', requireAdmin, async (req, res, next) => {
  try {
    const name = req.params.name;
    await assertVisible(name, (await visibleTables()).map((t) => t.name));
    const columns = await columnsOf(name);
    const cnt = await query(`select count(*)::bigint as n from ${qIdent(name)}`);
    res.json({ name, columns, rows_total: Number(cnt.rows[0].n) });
  } catch (e) { next(e); }
});

// ---------- GET /api/admin/tables/:name/rows ----------
adminRouter.get('/tables/:name/rows', requireAdmin, async (req, res, next) => {
  try {
    const name = req.params.name;
    await assertVisible(name, (await visibleTables()).map((t) => t.name));
    const columns = await columnsOf(name);
    if (!columns.length) throw new ApiError('not_found', 'Таблица пуста схемой', 404);

    // limit/offset — строгие рамки
    const limit = req.query.limit === undefined ? LIMIT_DEFAULT : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) {
      throw new ApiError('invalid_limit', `limit: целое 1..${LIMIT_MAX}`, 400);
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ApiError('invalid_offset', 'offset: целое ≥ 0', 400);
    }

    // Сортировка: только видимая колонка; по умолчанию — PK (или первая колонка),
    // чтобы пагинация была детерминированной
    const dir = String(req.query.dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    let orderBy = String(req.query.order_by || '');
    if (orderBy) {
      if (!columns.some((c) => c.name === orderBy)) {
        throw new ApiError('invalid_order', 'Неизвестная колонка сортировки', 400);
      }
    } else {
      orderBy = (columns.find((c) => c.pk) || columns[0]).name;
    }

    // select — ТОЛЬКО видимые колонки (password_hash и прочие секреты не выезжают)
    const colList = columns.map((c) => qIdent(c.name)).join(', ');
    const { rows } = await query(
      `select ${colList} from ${qIdent(name)} order by ${qIdent(orderBy)} ${dir} limit $1 offset $2`,
      [limit, offset],
    );
    res.json({ rows, limit, offset, order_by: orderBy, dir });
  } catch (e) { next(e); }
});
