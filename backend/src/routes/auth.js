// backend/src/routes/auth.js — регистрация/вход/refresh/сброс (Фаза A)
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query, tx, ApiError } from '../db.js';
import { hashPassword, checkPassword, signAccess, issueRefresh, rotateRefresh, userRow } from '../auth.js';
import { sendPasswordReset } from '../mailer.js';
import { CONFIG } from '../config.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tokensFor(user) {
  return { access: signAccess(user), refresh: user.refresh };
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const username = String(req.body?.username || '').trim();
    if (!EMAIL_RE.test(email)) throw new ApiError('invalid_email', 'Проверьте e-mail');
    if (password.length < 6) throw new ApiError('invalid_password', 'Пароль от 6 символов');
    if (username.length < 3 || username.length > 24) throw new ApiError('invalid_username', 'Имя: 3–24 символа');
    const exists = await query('select 1 from users where lower(email) = $1', [email]);
    if (exists.rowCount) throw new ApiError('duplicate', 'Такой e-mail уже зарегистрирован', 409);
    const user = await tx(async (c) => {
      const u = await c.query(
        'insert into users (email, password_hash) values ($1, $2) returning id, email',
        [email, await hashPassword(password)],
      );
      const id = u.rows[0].id;
      let name = username;
      const taken = await c.query('select 1 from profiles where lower(username) = lower($1)', [name]);
      if (taken.rowCount) name = `${name}_${id.slice(0, 4)}`;
      // is_admin проставит триггер profiles_owner_admin (почта владельца)
      await c.query('insert into profiles (id, username, links) values ($1, $2, \'[]\')', [id, name]);
      return u.rows[0];
    });
    const profile = await query('select username, is_admin from profiles where id = $1', [user.id]);
    const refresh = await issueRefresh(user.id);
    res.status(201).json({
      user: { id: user.id, email: user.email, username: profile.rows[0].username, is_admin: profile.rows[0].is_admin },
      access: tokensFor({ ...user, is_admin: profile.rows[0].is_admin }).access,
      refresh: refresh.token,
      needsOnboarding: true,
    });
  } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const { rows } = await query(
      `select u.id, u.email, u.password_hash, p.username, p.is_admin
         from users u join profiles p on p.id = u.id where lower(u.email) = $1`,
      [email],
    );
    const row = rows[0];
    if (!row || !(await checkPassword(password, row.password_hash))) {
      throw new ApiError('invalid_credentials', 'Неверный e-mail или пароль', 401);
    }
    const refresh = await issueRefresh(row.id);
    res.json({
      user: { id: row.id, email: row.email, username: row.username, is_admin: row.is_admin },
      access: signAccess(row),
      refresh: refresh.token,
    });
  } catch (e) { next(e); }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const userId = await rotateRefresh(String(req.body?.refresh || ''));
    const row = await userRow(userId);
    if (!row) throw new ApiError('invalid_refresh', 'Сессия истекла', 401);
    const refresh = await issueRefresh(userId);
    res.json({ user: row, access: signAccess(row), refresh: refresh.token });
  } catch (e) { next(e); }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    // Фаза C: выход сжигает конкретный refresh-токен (jti), остальные устройства живут
    const token = String(req.body?.refresh || '');
    if (token) {
      try {
        const payload = jwt.verify(token, CONFIG.REFRESH_SECRET);
        if (payload.jti) await query('delete from refresh_tokens where id = $1', [payload.jti]);
      } catch { /* протухший/битый токен — удалять нечего */ }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

authRouter.post('/reset-request', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const { rows } = await query('select id from users where lower(email) = $1', [email]);
    // Не раскрываем существование почты: ответ всегда 200
    if (rows[0]) {
      const t = await query(
        `insert into reset_tokens (user_id, expires_at) values ($1, now() + interval '1 hour') returning id`,
        [rows[0].id],
      );
      await sendPasswordReset(email, t.rows[0].id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

authRouter.post('/reset-confirm', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 6) throw new ApiError('invalid_password', 'Пароль от 6 символов');
    const del = await query('delete from reset_tokens where id = $1 and expires_at > now() returning user_id', [token]);
    if (!del.rowCount) throw new ApiError('invalid_token', 'Ссылка недействительна или устарела', 401);
    await query('update users set password_hash = $1 where id = $2', [await hashPassword(password), del.rows[0].user_id]);
    await query('delete from refresh_tokens where user_id = $1', [del.rows[0].user_id]); // сброс сессий
    res.json({ ok: true });
  } catch (e) { next(e); }
});
