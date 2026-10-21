// backend/src/app.js — Express-приложение SampleHelp (Фаза A+B, заход 48)
// Прод: Nginx отдаёт статику/SPA и проксирует /api и /socket.io сюда.
// Dev: STATIC_DIR=../public — приложение само раздаёт фронт (как server.js).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { CONFIG, PUBLIC_BUCKETS } from './config.js';
import { attachUser } from './auth.js';
import { ApiError } from './db.js';
import { initRealtime, getIo } from './realtime.js';
import { startLifecycleTimer } from './lifecycle.js';
import { authRouter } from './routes/auth.js';
import { profilesRouter } from './routes/profiles.js';
import { questionsRouter, answersRouter } from './routes/questions.js';
import { socialRouter } from './routes/social.js';
import { messagesRouter } from './routes/messages.js';
import { adminRouter } from './routes/admin.js';
import {
  notificationsRouter, donationsRouter, reportsRouter, ideasRouter, uploadRouter, catalogRouter,
} from './routes/misc.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // CORS (Фаза C): фронт может жить на другом порту/хосте (dev: server.js :3000,
  // прод: домен за Nginx/Cloudflare). Авторизация — Bearer-токен (не cookie),
  // поэтому достаточно простого Access-Control-Allow-Origin.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(attachUser);

  // Аутентификация: брутфорс-защита 5/мин/IP
  app.use('/api/auth', rateLimit({ windowMs: 60_000, max: CONFIG.AUTH_RATE_MAX, standardHeaders: true, legacyHeaders: false }), authRouter);

  app.use('/api/profiles', profilesRouter);
  app.use('/api/questions', questionsRouter);
  app.use('/api/answers', answersRouter);
  app.use('/api', socialRouter); // /api/likes/toggle, /api/favorites…, /api/subscriptions…, /api/achievements…
  app.use('/api/messages', messagesRouter);
  // Заход 50: админ-просмотрщик БД (строго чтение; секреты не выезжают).
  // Свой rate-limit: 60 запросов/мин — от случайного «прокликать» всё защищаемся
  app.use('/api/admin', rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }), adminRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/donations', donationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/ideas', ideasRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/upload', uploadRouter);

  app.get('/api/health', (req, res) => res.json({ ok: true, service: 'samplehelp-backend', phase: 'C' }));

  // Публичные бакеты с SSD: /files/<bucket>/<name> (прод: кэш сверху снимет
  // Nginx/Cloudflare; приватные бакеты сюда НЕ попадают — только /api/upload/private)
  for (const bucket of PUBLIC_BUCKETS) {
    app.use(`/files/${bucket}`, express.static(path.join(CONFIG.STORAGE_DIR, bucket), {
      maxAge: '30d',
      fallthrough: false,
    }));
  }

  // Dev-режим: статика+SPA из STATIC_DIR (фронт-разработка без Nginx).
  // Фаза C-фикс: STATIC_DIR приводим к абсолютному — sendFile с относительным
  // путём падал в 500 на SPA-fallback (README dev-команды используют ../public).
  if (CONFIG.STATIC_DIR) {
    const staticDir = path.resolve(CONFIG.STATIC_DIR);
    app.use(express.static(staticDir, {
      setHeaders(res, filePath) {
        if (/\.(css|js|mjs|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store, must-revalidate');
      },
    }));
    app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // Ошибки — в контракте supabase-js { code, message }: фронт (Фаза C) не переписываем
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ApiError) return res.status(err.status).json({ code: err.code, message: err.message });
    if (err?.code === '23505') return res.status(409).json({ code: 'duplicate', message: 'Уже существует' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ code: 'too_large', message: 'Файл слишком большой' });
    console.error('[api]', err);
    res.status(500).json({ code: 'server_error', message: 'Внутренняя ошибка сервера' });
  });
  return app;
}

// Прямой запуск: node src/app.js — поднимает HTTP + Socket.IO + cron lifecycle
export function createServer({ realtime = true, lifecycleMs = CONFIG.LIFECYCLE_MS } = {}) {
  const app = createApp();
  const server = http.createServer(app);
  const io = realtime ? initRealtime(server) : null;
  const timer = lifecycleMs > 0 ? startLifecycleTimer(lifecycleMs) : null;
  return { app, server, io, timer };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { server } = createServer();
  server.listen(CONFIG.PORT, () => {
    console.log(`🎛️ SampleHelp backend: http://localhost:${CONFIG.PORT} (api + socket.io)`);
    console.log(`   storage: ${CONFIG.STORAGE_DIR}`);
    console.log(`   static:  ${CONFIG.STATIC_DIR ? path.resolve(CONFIG.STATIC_DIR) : '— (только API)'}`);
  });
}
