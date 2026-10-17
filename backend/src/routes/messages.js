// backend/src/routes/messages.js — личные сообщения (порт веток messages)
import { Router } from 'express';
import { query, ApiError } from '../db.js';
import { requireAuth } from '../auth.js';
import { pushMessage, pushMessageEvent } from '../realtime.js';

export const messagesRouter = Router();

messagesRouter.get('/conversations', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select distinct on (other_id) * from (
         select m.*, case when m.sender_id = $1 then m.recipient_id else m.sender_id end as other_id
           from messages m
          where m.sender_id = $1 or m.recipient_id = $1
          order by created_at desc
       ) sub order by other_id, created_at desc`,
      [req.user.id],
    );
    const ids = rows.map((r) => r.other_id);
    const profs = ids.length ? await query('select id, username, avatar_url from profiles where id = any($1)', [ids]) : { rows: [] };
    const unread = await query(
      'select sender_id, count(*)::int as n from messages where recipient_id = $1 and read = false group by sender_id',
      [req.user.id],
    );
    const unreadMap = new Map(unread.rows.map((r) => [r.sender_id, r.n]));
    res.json(rows.map((m) => ({
      lastMessage: m,
      profile: profs.rows.find((p) => p.id === m.other_id) || null,
      unread: unreadMap.get(m.other_id) || 0,
    })));
  } catch (e) { next(e); }
});

messagesRouter.get('/thread/:uid', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select * from messages
        where (sender_id = $1 and recipient_id = $2) or (sender_id = $2 and recipient_id = $1)
        order by created_at asc`,
      [req.user.id, req.params.uid],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

messagesRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const recipient = req.body?.recipient_id;
    const content = String(req.body?.content || '');
    const ref = req.body?.ref || null;
    if (!recipient) throw new ApiError('invalid_recipient', 'Кому?');
    if (!content && !ref) throw new ApiError('invalid_message', 'Пустое сообщение');
    const { rows } = await query(
      'insert into messages (sender_id, recipient_id, content, ref) values ($1,$2,$3,$4) returning *',
      [req.user.id, recipient, content, ref ? JSON.stringify(ref) : null],
    );
    pushMessage(rows[0]); // Фаза B: живой пуш обеим сторонам
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

messagesRouter.post('/read/:uid', requireAuth, async (req, res, next) => {
  try {
    await query('update messages set read = true where sender_id = $1 and recipient_id = $2 and read = false', [req.params.uid, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

messagesRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from messages where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Сообщение не найдено', 404);
    if (rows[0].sender_id !== req.user.id) throw new ApiError('forbidden', 'Недостаточно прав', 403);
    const { rows: up } = await query(
      'update messages set content = $2, edited_at = now() where id = $1 returning *',
      [req.params.id, String(req.body?.content || '')],
    );
    pushMessageEvent('message_patch', up[0]);
    res.json(up[0]);
  } catch (e) { next(e); }
});

messagesRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from messages where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Сообщение не найдено', 404);
    if (rows[0].sender_id !== req.user.id) throw new ApiError('forbidden', 'Недостаточно прав', 403);
    await query('delete from messages where id = $1', [req.params.id]);
    pushMessageEvent('message_delete', rows[0]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Карточки-ссылки «📎» (Фаза C: порт fetchRefCandidates/fetchRefCard) ----------
// Мои вопросы и ответы для пикера вложений (purged-вопросы исключены)
messagesRouter.get('/ref-candidates', requireAuth, async (req, res, next) => {
  try {
    const [a, q] = await Promise.all([
      query(
        `select a.id, a.created_at, a.is_solution, q.id as qid, q.title, q.purged
           from answers a join questions q on q.id = a.question_id
          where a.user_id = $1 and q.purged = false
          order by a.created_at desc limit 30`,
        [req.user.id],
      ),
      query(
        `select id, title, answers_count, created_at from questions
          where user_id = $1 and purged = false
          order by created_at desc limit 30`,
        [req.user.id],
      ),
    ]);
    res.json({
      answers: a.rows.map((x) => ({ type: 'answer', id: x.id, title: x.title, is_solution: !!x.is_solution, created_at: x.created_at })),
      questions: q.rows.map((x) => ({ type: 'question', id: x.id, title: x.title, answers_count: x.answers_count ?? 0, created_at: x.created_at })),
    });
  } catch (e) { next(e); }
});

// Дисплей-пейлоад карточки из messages.ref (чтение публичных таблиц — как
// прежняя боевая ветка: вопросы/ответы/профили открыты всем)
messagesRouter.get('/ref-card', async (req, res, next) => {
  try {
    const type = String(req.query.type || '');
    const id = String(req.query.id || '');
    if (!id) return res.json(null);
    if (type === 'question') {
      const { rows } = await query(
        `select q.id, q.title, q.status, q.purged, q.purge_summary, q.answers_count, pr.username
           from questions q left join profiles pr on pr.id = q.user_id where q.id = $1`,
        [id],
      );
      const d = rows[0];
      if (!d) return res.json(null);
      return res.json({
        type: 'question', id: d.id, href: `/question/${d.id}`, title: d.title,
        purged: !!d.purged, purge_summary: d.purge_summary || null,
        author: d.username || '?', status: d.status, answers_count: d.answers_count ?? 0,
      });
    }
    if (type === 'answer') {
      const { rows } = await query(
        `select a.id, a.is_solution, a.question_id, q.title, q.purged, q.purge_summary
           from answers a join questions q on q.id = a.question_id where a.id = $1`,
        [id],
      );
      const d = rows[0];
      if (!d) return res.json(null);
      return res.json({
        type: 'answer', id: d.id, href: `/question/${d.question_id}`, title: d.title,
        purged: !!d.purged, purge_summary: d.purge_summary || null, is_solution: !!d.is_solution,
      });
    }
    if (type === 'profile') {
      const { rows } = await query('select id, username, avatar_url from profiles where id = $1', [id]);
      const d = rows[0];
      if (!d) return res.json(null);
      return res.json({ type: 'profile', id: d.id, href: `/profile/${d.id}`, title: d.username, avatar_url: d.avatar_url || null, purged: false, purge_summary: null });
    }
    res.json(null);
  } catch (e) { next(e); }
});

messagesRouter.post('/:id/reactions', requireAuth, async (req, res, next) => {
  try {
    const emoji = String(req.body?.emoji || '');
    const { rows } = await query('select * from messages where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Сообщение не найдено', 404);
    // Фаза C-фикс: username из профиля (в JWT его нет)
    const { rows: meRows } = await query('select username from profiles where id = $1', [req.user.id]);
    const me = { user_id: req.user.id, username: meRows[0]?.username || '', emoji };
    let list = Array.isArray(rows[0].reactions) ? rows[0].reactions : [];
    const had = list.some((r) => r.user_id === req.user.id && r.emoji === emoji);
    list = had ? list.filter((r) => !(r.user_id === req.user.id && r.emoji === emoji)) : [...list, me];
    const { rows: up } = await query('update messages set reactions = $2 where id = $1 returning *', [req.params.id, JSON.stringify(list)]);
    pushMessageEvent('message_patch', up[0]);
    res.json({ reacted: !had, message: up[0] });
  } catch (e) { next(e); }
});
