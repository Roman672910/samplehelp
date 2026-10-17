// backend/src/config.js — конфигурация из env (Фаза A, заход 48)
import { fileURLToPath } from 'node:url';

export const CONFIG = {
  PORT: Number(process.env.PORT || 3100),
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_dev',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  REFRESH_SECRET: process.env.REFRESH_SECRET || 'dev-only-insecure-refresh-change-me',
  ACCESS_TTL: process.env.ACCESS_TTL || '12h',
  REFRESH_TTL_DAYS: Number(process.env.REFRESH_TTL_DAYS || 30),
  STATIC_DIR: process.env.STATIC_DIR || '', // если задан — dev-режим: статика+SPA из этой папки
  // FIX 2026-10-16 (Windows): new URL(...).pathname давал '/K:/...' — невалидный
  // путь для NTFS, загрузка файлов падала в 500. fileURLToPath возвращает
  // нативный путь на любой ОС (K:\...\storage / /home/.../storage).
  STORAGE_DIR: process.env.STORAGE_DIR || fileURLToPath(new URL('../storage', import.meta.url)),
  UPLOAD_LIMIT_MB: Number(process.env.UPLOAD_LIMIT_MB || 25),
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 465),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'SampleHelp <no-reply@samplehelp.example>',
  PUBLIC_URL: process.env.PUBLIC_URL || 'http://localhost:3100',
  AUTH_RATE_MAX: Number(process.env.AUTH_RATE_MAX || 20), // тесты поднимают потолок
  LIFECYCLE_MS: Number(process.env.LIFECYCLE_MS || 600000), // cron lifecycle: 0 = выключен (тесты зовут sweep вручную)
};

export const PUBLIC_BUCKETS = new Set(['question-audio', 'presets', 'avatars']);
export const PRIVATE_BUCKETS = new Set(['marketplace-files']);
