// backend/src/storage.js — файловое хранилище на SSD (Фаза A, заход 48):
// порт Supabase Storage-бакетов в папки; публичные отдаёт Nginx/Express-static
// (CDN-кэш сверху), приватные — авторизованный эндпойнт.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG, PUBLIC_BUCKETS, PRIVATE_BUCKETS } from './config.js';
import { ApiError } from './db.js';

const MIME_OK = {
  'question-audio': ['audio/', 'video/webm', 'audio/webm'],
  presets: ['application/', 'audio/', 'text/', 'image/'],
  avatars: ['image/png', 'image/jpeg', 'image/webp'],
  'marketplace-files': ['application/', 'audio/', 'text/', 'image/'],
};

export function bucketDir(bucket) {
  if (!PUBLIC_BUCKETS.has(bucket) && !PRIVATE_BUCKETS.has(bucket)) {
    throw new ApiError('invalid_bucket', 'Неизвестный бакет', 404);
  }
  const dir = path.join(CONFIG.STORAGE_DIR, bucket);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // FIX 2026-10-16: внятная диагностика вместо «Внутренняя ошибка сервера»
    // (на Windows так проявлялся битый STORAGE_DIR)
    throw new ApiError('storage_unavailable',
      `Файловое хранилище недоступно: не создать папку ${dir} (${e.code || e.message}). Проверьте STORAGE_DIR.`, 500);
  }
  return dir;
}

/** Сохранить загруженный файл; имя = uid + безопасное расширение */
export function saveUpload(bucket, buffer, mimeType, origName) {
  const ok = (MIME_OK[bucket] || []).some((p) => mimeType.startsWith(p));
  if (!ok) throw new ApiError('invalid_type', `Недопустимый тип файла для ${bucket}: ${mimeType}`);
  const ext = path.extname(origName || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  const name = `${crypto.randomUUID()}${ext}`;
  const dir = bucketDir(bucket);
  try {
    fs.writeFileSync(path.join(dir, name), buffer);
  } catch (e) {
    throw new ApiError('storage_unavailable',
      `Файловое хранилище недоступно: не записать ${path.join(dir, name)} (${e.code || e.message}). Проверьте STORAGE_DIR и права.`, 500);
  }
  return { name, url: PUBLIC_BUCKETS.has(bucket) ? `/files/${bucket}/${name}` : null };
}

/** Удаление файла бакета (purge-цикл вопросов) */
export function deleteObject(bucket, name) {
  try {
    const full = path.join(bucketDir(bucket), path.basename(name));
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) {
    console.warn('[storage] delete:', e.message);
  }
}

/** Разобрать url вида /files/<bucket>/<name> или прежний storage-путь */
export function parseFileUrl(url) {
  const m = String(url || '').match(/\/?(?:files|question-audio|presets|avatars)\/([^/]+)\/([^/?#]+)/)
    || String(url || '').match(/^\/(question-audio|presets|avatars|marketplace-files)\/(.+)$/);
  if (!m) return null;
  if (m[1] === 'files') return null;
  return { bucket: m[1], name: m[2] };
}

export function readPrivate(bucket, name) {
  if (!PRIVATE_BUCKETS.has(bucket)) throw new ApiError('invalid_bucket', 'Бакет не приватный', 400);
  const full = path.join(bucketDir(bucket), path.basename(name));
  if (!fs.existsSync(full)) throw new ApiError('not_found', 'Файл не найден', 404);
  return full;
}
