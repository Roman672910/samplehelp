// backend/src/auth.js — своя аутентификация: bcrypt + JWT (Фаза A, заход 48)
// Модель сессии (решение опроса): access-токен в localStorage (12h) +
// refresh-токен (30d) с РОТАЦИЕЙ пары на /api/auth/refresh (jti одноразовый).
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { CONFIG } from './config.js';
import { query, ApiError } from './db.js';

export const hashPassword = (plain) => bcrypt.hash(plain, 12);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signAccess(user) {
  return jwt.sign({ sub: user.id, email: user.email, is_admin: !!user.is_admin }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.ACCESS_TTL,
  });
}

/** Создать refresh-токен и сохранить jti в БД (одноразовость ротации) */
export async function issueRefresh(userId) {
  const { rows } = await query(
    `insert into refresh_tokens (user_id, expires_at)
     values ($1, now() + make_interval(days => $2))
     returning id, expires_at`,
    [userId, CONFIG.REFRESH_TTL_DAYS],
  );
  const jti = rows[0].id;
  const token = jwt.sign({ sub: userId, jti }, CONFIG.REFRESH_SECRET, { expiresIn: `${CONFIG.REFRESH_TTL_DAYS}d` });
  return { token, expires_at: rows[0].expires_at };
}

/** Ротация: старый refresh сгорает, выдаётся новая пара */
export async function rotateRefresh(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, CONFIG.REFRESH_SECRET);
  } catch {
    throw new ApiError('invalid_refresh', 'Сессия истекла — войдите заново', 401);
  }
  const del = await query('delete from refresh_tokens where id = $1 returning user_id', [payload.jti]);
  if (!del.rowCount) throw new ApiError('invalid_refresh', 'Сессия истекла — войдите заново', 401);
  return del.rows[0].user_id;
}

export function purgeExpiredTokens() {
  return query(`delete from refresh_tokens where expires_at < now();
                delete from reset_tokens where expires_at < now();`);
}

// ---------- middleware ----------
function bearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Мягкая аутентификация: req.user = {id, email, is_admin} или null */
export function attachUser(req, res, next) {
  req.user = null;
  const token = bearerToken(req);
  if (token) {
    try {
      const p = jwt.verify(token, CONFIG.JWT_SECRET);
      req.user = { id: p.sub, email: p.email, is_admin: !!p.is_admin };
    } catch { /* протухший токен = аноним; фронт сам обновит по 401 */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new ApiError('not_authenticated', 'Требуется вход', 401));
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new ApiError('not_authenticated', 'Требуется вход', 401));
  if (!req.user.is_admin) return next(new ApiError('forbidden', 'Недостаточно прав', 403));
  next();
}

/** Свежий is_admin из БД (токен мог устареть после назначения/снятия) */
export async function freshAdmin(userId) {
  const { rows } = await query('select is_admin from profiles where id = $1', [userId]);
  return !!rows[0]?.is_admin;
}

export async function userRow(userId) {
  const { rows } = await query(
    `select u.id, u.email, p.username, p.avatar_url, p.is_admin
       from users u join profiles p on p.id = u.id where u.id = $1`,
    [userId],
  );
  return rows[0] || null;
}
