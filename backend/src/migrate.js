// backend/src/migrate.js — идемпотентное применение schema.sql
import fs from 'node:fs';
import pg from 'pg';
import { CONFIG } from './config.js';

const url = new URL(CONFIG.DATABASE_URL);
const dbName = url.pathname.slice(1);

// Админ-подключение к служебной БД postgres: создаём целевую БД, если её нет
const admin = new pg.Pool({
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: 'postgres',
});
const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
if (!exists.rowCount) {
  await admin.query(`create database "${dbName}"`);
  console.log(`✓ База создана: ${dbName}`);
}
await admin.end();

const pool = new pg.Pool({ connectionString: CONFIG.DATABASE_URL });
const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
await pool.query(sql);
await pool.end();
console.log(`✓ Схема применена (идемпотентно): ${dbName}`);
