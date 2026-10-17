// backend/src/db.js — пул PostgreSQL + помощники (Фаза A, заход 48)
import pg from 'pg';
import { CONFIG } from './config.js';

export const pool = new pg.Pool({ connectionString: CONFIG.DATABASE_URL, max: 10 });

export const query = (text, params) => pool.query(text, params);

/** Одна транзакция: fn(client) → результат; rollback при ошибке */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const res = await fn(client);
    await client.query('commit');
    return res;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Ошибка в контракте supabase-js: { code, message } — фронт не переписываем */
export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}
