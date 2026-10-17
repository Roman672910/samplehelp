// backend/src/routes/social.js — лайки, избранное, подписки, достижения
import { Router } from 'express';
import { query, ApiError } from '../db.js';
import { requireAuth, userRow } from '../auth.js';
import { notify } from '../notify.js';

export const socialRouter = Router();

socialRouter.post('/likes/toggle', requireAuth, async (req, res, next) => {
  try {
    const { target_type: ttype, target_id: tid } = req.body || {};
    if (!['question', 'answer'].includes(ttype) || !tid) throw new ApiError('invalid_target', 'Некорректная цель');
    const table = ttype === 'question' ? 'questions' : 'answers';
    const row = await query(`select id, user_id, question_id from ${table} where id = $1`, [tid]);
    if (!row.rowCount) throw new ApiError('not_found', 'Цель не найдена', 404);
    const existing = await query(
      'select 1 from likes where user_id = $1 and target_type = $2 and target_id = $3',
      [req.user.id, ttype, tid],
    );
    let liked;
    if (existing.rowCount) {
      await query('delete from likes where user_id = $1 and target_type = $2 and target_id = $3', [req.user.id, ttype, tid]);
      liked = false;
    } else {
      await query('insert into likes (user_id, target_type, target_id) values ($1,$2,$3)', [req.user.id, ttype, tid]);
      liked = true;
      // Заход 47 (порт): лайк уведомляет автора контента, себе — нет
      const author = row.rows[0].user_id;
      if (author && author !== req.user.id) {
        const me = await userRow(req.user.id);
        const qid = ttype === 'question' ? tid : row.rows[0].question_id;
        await notify(author, 'like', {
          by: me?.username || '?',
          targetKey: ttype === 'question' ? 'notifications.target_question' : 'notifications.target_answer',
          questionId: qid,
        });
      }
    }
    const cnt = await query(`select likes_count from ${table} where id = $1`, [tid]);
    res.json({ liked, likes_count: cnt.rows[0]?.likes_count ?? 0 });
  } catch (e) { next(e); }
});

socialRouter.get('/likes/status', async (req, res, next) => {
  try {
    // Фаза C: состояние лайка для начального рендера (порт isLiked)
    const ttype = String(req.query.target_type || '');
    const tid = String(req.query.target_id || '');
    if (!req.user || !['question', 'answer'].includes(ttype) || !tid) return res.json({ liked: false });
    const { rowCount } = await query(
      'select 1 from likes where user_id = $1 and target_type = $2 and target_id = $3',
      [req.user.id, ttype, tid],
    );
    res.json({ liked: !!rowCount });
  } catch (e) { next(e); }
});

socialRouter.get('/favorites', requireAuth, async (req, res, next) => {
  try {
    // Фаза C: форма боевой ветки fetchFavorites — строка избранного
    // (question_id, status, created_at) + вложенный question с автором.
    // Поля favorites алиасятся (fav_*), чтобы не столкнуться с q.status/q.created_at.
    const { rows } = await query(
      `select f.user_id as fav_user_id, f.status as fav_status, f.created_at as fav_created_at,
              q.*, pr.username, pr.avatar_url, pr.donate_methods
         from favorites f
         join questions q on q.id = f.question_id
         left join profiles pr on pr.id = q.user_id
        where f.user_id = $1 order by f.created_at desc`,
      [req.user.id],
    );
    res.json(rows.map((r) => {
      const { fav_user_id, fav_status, fav_created_at, username, avatar_url, donate_methods, ...q } = r;
      return {
        user_id: fav_user_id,
        question_id: q.id,
        status: fav_status || 'preparing',
        created_at: fav_created_at,
        question: { ...q, author: { id: q.user_id, username, avatar_url, donate_methods } },
      };
    }));
  } catch (e) { next(e); }
});

socialRouter.post('/favorites/toggle', requireAuth, async (req, res, next) => {
  try {
    const qid = req.body?.question_id;
    const existing = await query('select 1 from favorites where user_id = $1 and question_id = $2', [req.user.id, qid]);
    // Фаза C: body.on — желаемое состояние (идемпотентно); без on — прежний toggle
    const on = req.body?.on;
    if (on === true) {
      await query(
        `insert into favorites (user_id, question_id) values ($1,$2)
         on conflict (user_id, question_id) do nothing`,
        [req.user.id, qid],
      );
      return res.json({ favorited: true });
    }
    if (on === false) {
      await query('delete from favorites where user_id = $1 and question_id = $2', [req.user.id, qid]);
      return res.json({ favorited: false });
    }
    if (existing.rowCount) {
      await query('delete from favorites where user_id = $1 and question_id = $2', [req.user.id, qid]);
      return res.json({ favorited: false });
    }
    await query('insert into favorites (user_id, question_id) values ($1,$2)', [req.user.id, qid]);
    res.json({ favorited: true });
  } catch (e) { next(e); }
});

socialRouter.post('/favorites/status', requireAuth, async (req, res, next) => {
  try {
    // Фаза C: «готовлюсь ответить» ⇄ «готово» (порт setFavoriteStatus)
    const qid = req.body?.question_id;
    const status = req.body?.status === 'ready' ? 'ready' : 'preparing';
    await query('update favorites set status = $3 where user_id = $1 and question_id = $2', [req.user.id, qid, status]);
    res.json({ ok: true, status });
  } catch (e) { next(e); }
});

socialRouter.get('/subscriptions', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select target_type, target_id from subscriptions where user_id = $1', [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

socialRouter.post('/subscriptions/toggle', requireAuth, async (req, res, next) => {
  try {
    const { target_type: ttype, target_id: tid } = req.body || {};
    if (!['author', 'tag'].includes(ttype) || !tid) throw new ApiError('invalid_target', 'Некорректная цель');
    const existing = await query('select 1 from subscriptions where user_id = $1 and target_type = $2 and target_id = $3', [req.user.id, ttype, String(tid)]);
    if (existing.rowCount) {
      await query('delete from subscriptions where user_id = $1 and target_type = $2 and target_id = $3', [req.user.id, ttype, String(tid)]);
      return res.json({ subscribed: false });
    }
    await query('insert into subscriptions (user_id, target_type, target_id) values ($1,$2,$3)', [req.user.id, ttype, String(tid)]);
    res.json({ subscribed: true });
  } catch (e) { next(e); }
});

socialRouter.get('/achievements', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select achievement_type, created_at from achievements where user_id = $1', [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

// Клиент считает значки сам (демо-логика achievements.mjs); сервер хранит факт
socialRouter.post('/achievements', requireAuth, async (req, res, next) => {
  try {
    // Фаза C: одиночная выдача (порт awardAchievement): повтор → awarded=false
    const type = String(req.body?.achievement_type || '').slice(0, 40);
    if (!type) throw new ApiError('invalid_type', 'Некорректный тип достижения');
    const { rows } = await query(
      'insert into achievements (user_id, achievement_type) values ($1,$2) on conflict do nothing returning achievement_type',
      [req.user.id, type],
    );
    res.status(201).json({ awarded: rows.length > 0, achievement_type: type });
  } catch (e) { next(e); }
});

socialRouter.post('/achievements/sync', requireAuth, async (req, res, next) => {
  try {
    const types = Array.isArray(req.body?.types) ? req.body.types.map(String) : [];
    await query('delete from achievements where user_id = $1 and not (achievement_type = any($2))', [req.user.id, types]);
    for (const t of types) {
      await query('insert into achievements (user_id, achievement_type) values ($1,$2) on conflict do nothing', [req.user.id, t]);
    }
    const { rows } = await query('select achievement_type, created_at from achievements where user_id = $1', [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});
