// backend/src/routes/questions.js — вопросы, ответы, комментарии, решение
import { Router } from 'express';
import { query, tx, ApiError } from '../db.js';
import { requireAuth, userRow } from '../auth.js';
import { isOwner, deny } from '../rules.js';
import { notify, notifyTagSubscribers } from '../notify.js';

export const questionsRouter = Router();
export const answersRouter = Router();

const PROF_JOIN = 'left join profiles pr on pr.id = q.user_id';
const qShape = (r) => ({
  ...r,
  profile: r.username === undefined ? null : { username: r.username, avatar_url: r.avatar_url, donate_methods: r.donate_methods, bio: r.bio ?? null },
});

questionsRouter.get('/', async (req, res, next) => {
  try {
    // Фаза C: sort=unanswered (без ответов) и фильтр user_id (профиль:
    // ВСЕ вопросы автора, включая purge-заглушки — счётчик вечный)
    const userId = req.query.user_id;
    let sort = 'q.created_at desc';
    if (req.query.sort === 'top') sort = 'q.likes_count desc, q.created_at desc';
    if (req.query.sort === 'unanswered') sort = 'q.created_at desc';
    const limit = Math.min(200, Number(req.query.limit || 20));
    const where = userId
      ? 'where q.user_id = $2'
      : `where q.purged = false${req.query.sort === 'unanswered' ? ' and q.answers_count = 0' : ''}`;
    const { rows } = await query(
      `select q.*, pr.username, pr.avatar_url, pr.donate_methods, pr.bio
         from questions q ${PROF_JOIN}
        ${where}
        order by ${sort} limit $1`,
      userId ? [limit, userId] : [limit],
    );
    res.json(rows.map(qShape));
  } catch (e) { next(e); }
});

questionsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `select q.*, pr.username, pr.avatar_url, pr.donate_methods, pr.bio
         from questions q ${PROF_JOIN} where q.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) throw new ApiError('not_found', 'Вопрос не найден', 404);
    res.json(qShape(rows[0]));
  } catch (e) { next(e); }
});

questionsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || String(b.title).trim().length < 3) throw new ApiError('invalid_title', 'Заголовок от 3 символов');
    const { rows } = await query(
      `insert into questions (user_id, title, description, audio_url, audio_kind, waveform_data, markers, synth, category)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [req.user.id, String(b.title).trim(), String(b.description || ''), b.audio_url || null, b.audio_kind || null,
        JSON.stringify(b.waveform_data || null), JSON.stringify(b.markers || []), b.synth || null, b.category || null],
    );
    if (b.synth) {
      await query('insert into synth_catalog (name, added_by) values ($1, $2) on conflict do nothing', [b.synth, req.user.id]);
    }
    await notifyTagSubscribers(rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

questionsRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from questions where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Вопрос не найден', 404);
    if (!isOwner(rows[0], req.user)) throw deny();
    const b = req.body || {};
    // Фаза C: полный белый список полей правки (порт боевой ветки
    // updateQuestion). audio_url/waveform_data принимают ЯВНЫЙ null —
    // «аудио удалено при правке» (флаги $9/$10); undefined = не трогаем.
    const { rows: up } = await query(
      `update questions set
         title = coalesce($2, title),
         description = coalesce($3, description),
         markers = coalesce($4, markers),
         synth = coalesce($5, synth),
         category = coalesce($6, category),
         audio_url = case when $9 then null else coalesce($7, audio_url) end,
         waveform_data = case when $10 then null else coalesce($8, waveform_data) end,
         edited_at = now()
       where id = $1 returning *`,
      [req.params.id, b.title ?? null, b.description ?? null, b.markers ? JSON.stringify(b.markers) : null,
        b.synth ?? null, b.category ?? null,
        b.audio_url ?? null,
        b.waveform_data === undefined || b.waveform_data === null ? null : JSON.stringify(b.waveform_data),
        b.audio_url === null, b.waveform_data === null],
    );
    res.json(up[0]);
  } catch (e) { next(e); }
});

questionsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from questions where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Вопрос не найден', 404);
    if (!isOwner(rows[0], req.user) && !req.user.is_admin) throw deny();
    await query('delete from questions where id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Решение: +25 rep автору ответа разово (порт mark_solution) ----------
questionsRouter.post('/:id/solution', requireAuth, async (req, res, next) => {
  try {
    const answerId = req.body?.answerId || null;
    const res_ = await tx(async (c) => {
      const q = await c.query('select * from questions where id = $1', [req.params.id]);
      if (!q.rowCount) throw new ApiError('not_found', 'Вопрос не найден', 404);
      if (q.rows[0].user_id !== req.user.id) throw deny();
      if (!answerId) {
        await c.query(`update questions set status='open', solved_at=null, purge_at=null where id=$1`, [req.params.id]);
        await c.query(`update answers set is_solution=false where question_id=$1`, [req.params.id]);
        return { solved: false };
      }
      const a = await c.query('select * from answers where id = $1 and question_id = $2', [answerId, req.params.id]);
      if (!a.rowCount) throw new ApiError('not_found', 'Ответ не найден', 404);
      await c.query(`update answers set is_solution=false where question_id=$1`, [req.params.id]);
      const award = !a.rows[0].awarded_rep;
      await c.query(`update answers set is_solution=true, awarded_rep = awarded_rep or true where id=$1`, [answerId]);
      await c.query(`update questions set status='solved', solved_at=now(), purge_at=now() + interval '7 days' where id=$1`, [req.params.id]);
      if (award) {
        await c.query('update profiles set rating = rating + 25, solutions_count = solutions_count + 1 where id = $1', [a.rows[0].user_id]);
      }
      return { solved: true, awarded: award, answerUserId: a.rows[0].user_id, question: q.rows[0] };
    });
    if (res_.solved && res_.answerUserId) {
      const me = await userRow(req.user.id);
      await notify(res_.answerUserId, 'solution', { by: me?.username || '?', questionTitle: res_.question.title, questionId: res_.question.id, rep: res_.awarded ? 25 : 0 });
    }
    res.json(res_);
  } catch (e) { next(e); }
});

// ---------- Ответы ----------
// Фаза C: пакетные выборки (порт боевых веток fetchAnswersForQuestions /
// fetchAnswersByUser / fetchBestAnswers) — один эндпойнт, три режима:
//   ?question_ids=a,b,c — ответы с авторами и комментариями для ленты;
//   ?user_id=…          — ответы автора с родителем-вопросом (профиль);
//   ?best=1&user_id=…&limit=N — топ ответов со звуком (авто-витрина).
answersRouter.get('/', async (req, res, next) => {
  try {
    const ids = String(req.query.question_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) {
      const { rows } = await query(
        `select a.*, pr.username, pr.avatar_url, pr.donate_methods
           from answers a left join profiles pr on pr.id = a.user_id
          where a.question_id = any($1)
          order by a.is_solution desc, a.likes_count desc, a.created_at asc`,
        [ids],
      );
      const aIds = rows.map((r) => r.id);
      const cm = aIds.length
        ? await query(
            `select c.*, pr.username, pr.avatar_url from comments c
              left join profiles pr on pr.id = c.user_id
             where c.answer_id = any($1) order by c.created_at`,
            [aIds],
          )
        : { rows: [] };
      return res.json(rows.map((a) => ({
        ...a,
        profile: { username: a.username, avatar_url: a.avatar_url, donate_methods: a.donate_methods },
        comments: cm.rows.filter((c) => c.answer_id === a.id).map((c) => ({ ...c, profile: { username: c.username, avatar_url: c.avatar_url } })),
      })));
    }
    const userId = req.query.user_id;
    if (!userId) return res.json([]);
    if (req.query.best) {
      const limit = Math.min(20, Number(req.query.limit || 3));
      const { rows } = await query(
        `select a.id, a.question_id, a.audio_url, a.waveform_data, a.markers,
                a.is_solution, a.likes_count, a.created_at,
                jsonb_build_object('id', q.id, 'title', q.title, 'purged', q.purged) as question
           from answers a join questions q on q.id = a.question_id
          where a.user_id = $1 and a.audio_url is not null
          order by a.is_solution desc, a.likes_count desc limit $2`,
        [userId, limit],
      );
      return res.json(rows);
    }
    const { rows } = await query(
      `select a.*, jsonb_build_object('id', q.id, 'title', q.title, 'status', q.status, 'purged', q.purged) as question
         from answers a join questions q on q.id = a.question_id
        where a.user_id = $1 order by a.created_at desc`,
      [userId],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Своих комментариев — счётчиком (статистика достижений, Фаза C)
answersRouter.get('/count-mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select count(*)::int as n from comments where user_id = $1', [req.user.id]);
    res.json({ count: rows[0].n });
  } catch (e) { next(e); }
});

questionsRouter.get('/:id/answers', async (req, res, next) => {
  try {
    const { rows } = await query(
      `select a.*, pr.username, pr.avatar_url, pr.donate_methods
         from answers a left join profiles pr on pr.id = a.user_id
        where a.question_id = $1
        order by a.is_solution desc, a.likes_count desc, a.created_at asc`,
      [req.params.id],
    );
    const ids = rows.map((r) => r.id);
    const cm = ids.length
      ? await query(
          `select c.*, pr.username, pr.avatar_url from comments c
            left join profiles pr on pr.id = c.user_id
           where c.answer_id = any($1) order by c.created_at`,
          [ids],
        )
      : { rows: [] };
    res.json(rows.map((a) => ({
      ...a,
      profile: { username: a.username, avatar_url: a.avatar_url, donate_methods: a.donate_methods },
      comments: cm.rows.filter((c) => c.answer_id === a.id).map((c) => ({ ...c, profile: { username: c.username, avatar_url: c.avatar_url } })),
    })));
  } catch (e) { next(e); }
});

questionsRouter.post('/:id/answers', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const created = await tx(async (c) => {
      // Триггер answers_no_new_on_solved страхует: решён/удалён → ошибка
      const r = await c.query(
        `insert into answers (question_id, user_id, content, audio_url, audio_kind, waveform_data, markers, links, preset_url, preset_name, sound_type, difficulty, tags)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [req.params.id, req.user.id, String(b.content || ''), b.audio_url || null, b.audio_kind || null,
          JSON.stringify(b.waveform_data || null), JSON.stringify(b.markers || []), JSON.stringify(b.links || []),
          b.preset_url || null, b.preset_name || null, b.sound_type || null, b.difficulty || null, JSON.stringify(b.tags || [])],
      );
      return r.rows[0];
    });
    const q = await query('select user_id, title from questions where id = $1', [req.params.id]);
    if (q.rows[0] && q.rows[0].user_id !== req.user.id) {
      // Фаза C-фикс: в JWT нет username — берём из профиля (иначе «by: ?»)
      const me = await userRow(req.user.id);
      await notify(q.rows[0].user_id, 'answer', { by: me?.username || '?', questionTitle: q.rows[0].title, questionId: req.params.id, answerId: created.id });
    }
    res.status(201).json(created);
  } catch (e) {
    if (String(e.message).includes('question is solved')) return next(new ApiError('solved', 'Вопрос решён — приём новых ответов закрыт', 409));
    next(e);
  }
});

answersRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from answers where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Ответ не найден', 404);
    if (!isOwner(rows[0], req.user)) throw deny();
    const b = req.body || {};
    // Фаза C: полный белый список правки ответа (порт боевой ветки
    // updateAnswer: content/markers/links/tags/sound_type/difficulty) + edited_at
    const { rows: up } = await query(
      `update answers set
         content = coalesce($2, content),
         markers = coalesce($3, markers),
         links = coalesce($4, links),
         tags = coalesce($5, tags),
         sound_type = coalesce($6, sound_type),
         difficulty = coalesce($7, difficulty),
         edited_at = now()
       where id = $1 returning *`,
      [req.params.id, b.content ?? null, b.markers ? JSON.stringify(b.markers) : null,
        b.links ? JSON.stringify(b.links) : null, b.tags ? JSON.stringify(b.tags) : null,
        b.sound_type ?? null, b.difficulty ?? null],
    );
    res.json(up[0]);
  } catch (e) { next(e); }
});

answersRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from answers where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Ответ не найден', 404);
    if (!isOwner(rows[0], req.user) && !req.user.is_admin) throw deny();
    await query('delete from answers where id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

answersRouter.get('/:id/comments', async (req, res, next) => {
  try {
    const { rows } = await query(
      `select c.*, pr.username, pr.avatar_url from comments c
        left join profiles pr on pr.id = c.user_id
       where c.answer_id = $1 order by c.created_at`,
      [req.params.id],
    );
    res.json(rows.map((c) => ({ ...c, profile: { username: c.username, avatar_url: c.avatar_url } })));
  } catch (e) { next(e); }
});

answersRouter.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const content = String(req.body?.content || '').trim();
    if (!content) throw new ApiError('invalid_comment', 'Пустой комментарий');
    const { rows } = await query(
      'insert into comments (answer_id, user_id, content) values ($1,$2,$3) returning *',
      [req.params.id, req.user.id, content],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

answersRouter.patch('/comments/:id', requireAuth, async (req, res, next) => {
  try {
    const content = String(req.body?.content || '').trim();
    if (!content) throw new ApiError('invalid_comment', 'Пустой комментарий');
    const { rows } = await query('select * from comments where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Комментарий не найден', 404);
    if (!isOwner(rows[0], req.user)) throw deny();
    const { rows: up } = await query(
      'update comments set content = $2, edited_at = now() where id = $1 returning *',
      [req.params.id, content],
    );
    res.json(up[0]);
  } catch (e) { next(e); }
});

answersRouter.delete('/comments/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from comments where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Комментарий не найден', 404);
    if (!isOwner(rows[0], req.user) && !req.user.is_admin) throw deny();
    await query('delete from comments where id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
