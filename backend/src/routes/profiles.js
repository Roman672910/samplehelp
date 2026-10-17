// backend/src/routes/profiles.js — профили + словари + серверные маски контактов
import { Router } from 'express';
import { query, ApiError } from '../db.js';
import { requireAuth } from '../auth.js';
import { sanitizeProfile } from '../rules.js';

export const profilesRouter = Router();

const PROFILE_FIELDS = [
  'username', 'avatar_url', 'bio', 'links', 'cover_style',
  'open_to_collab', 'contact', 'contact_consent', 'donate_methods',
]; // белого списка достаточно: is_admin/rating/счётчики серверными путями

profilesRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from profiles where id = $1', [req.user.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Профиль не найден', 404);
    res.json(sanitizeProfile(rows[0], req.user));
  } catch (e) { next(e); }
});

profilesRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const patch = {};
    for (const f of PROFILE_FIELDS) {
      if (req.body?.[f] !== undefined) patch[f] = req.body[f];
    }
    if (patch.username !== undefined) {
      const name = String(patch.username).trim();
      if (name.length < 3 || name.length > 24) throw new ApiError('invalid_username', 'Имя: 3–24 символа');
      const taken = await query('select 1 from profiles where lower(username) = lower($1) and id <> $2', [name, req.user.id]);
      if (taken.rowCount) throw new ApiError('duplicate', 'Имя занято', 409);
      patch.username = name;
    }
    const keys = Object.keys(patch);
    if (!keys.length) return res.json({ ok: true });
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = keys.map((k) => (typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]));
    const { rows } = await query(`update profiles set ${sets} where id = $1 returning *`, [req.user.id, ...vals]);
    // словари software/arsenal — отдельными таблицами
    if (Array.isArray(req.body?.software)) {
      await query('delete from user_software where user_id = $1', [req.user.id]);
      for (const s of req.body.software) {
        await query('insert into user_software (user_id, software_name) values ($1, $2) on conflict do nothing', [req.user.id, String(s)]);
      }
    }
    if (Array.isArray(req.body?.arsenal)) {
      await query('delete from user_arsenal where user_id = $1', [req.user.id]);
      for (const s of req.body.arsenal) {
        await query('insert into user_arsenal (user_id, item_name) values ($1, $2) on conflict do nothing', [req.user.id, String(s)]);
      }
    }
    res.json(sanitizeProfile(rows[0], req.user));
  } catch (e) { next(e); }
});

// Контакт разработчика для кнопки «Написать разработчику» (Фаза C):
// первый профиль с is_admin. ВАЖНО: маршрут до '/:id', иначе 'dev-contact'
// воспринимался бы как id.
profilesRouter.get('/dev-contact', async (req, res, next) => {
  try {
    const { rows } = await query(
      'select id, username, avatar_url from profiles where is_admin order by username limit 1',
    );
    res.json(rows[0] || null);
  } catch (e) { next(e); }
});

profilesRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('select * from profiles where id = $1', [req.params.id]);
    if (!rows[0]) return res.json(null);
    const software = await query('select software_name from user_software where user_id = $1', [req.params.id]);
    const arsenal = await query('select item_name from user_arsenal where user_id = $1', [req.params.id]);
    // Фаза C: агрегат профиля одной выборкой (порт боевой ветки fetchProfile):
    // вопросы (включая purge-заглушки — счётчик вечный), ответы с родителем
    // и stats для шапки профиля.
    const questions = await query(
      'select * from questions where user_id = $1 order by created_at desc',
      [req.params.id],
    );
    const answers = await query(
      `select a.*, jsonb_build_object('id', q.id, 'title', q.title, 'status', q.status, 'purged', q.purged) as question
         from answers a join questions q on q.id = a.question_id
        where a.user_id = $1 order by a.created_at desc`,
      [req.params.id],
    );
    const qList = questions.rows;
    const aList = answers.rows;
    const likes = [...qList, ...aList].reduce((s, x) => s + (x.likes_count || 0), 0);
    const profile = rows[0];
    res.json({
      ...sanitizeProfile(profile, req.user),
      software: software.rows.map((r) => r.software_name),
      arsenal: arsenal.rows.map((r) => r.item_name),
      questions: qList,
      answers: aList,
      stats: {
        questions: qList.length,
        answers: aList.length + (profile.purged_answers_count || 0),
        likes,
        rating: profile.rating || 0,
        solutions: (profile.solutions_count || 0) + aList.filter((a) => a.is_solution && !a.awarded_rep).length,
      },
    });
  } catch (e) { next(e); }
});
