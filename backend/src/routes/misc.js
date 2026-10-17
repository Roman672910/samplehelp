// backend/src/routes/misc.js — notifications, donations, reports, ideas, upload
import { Router } from 'express';
import multer from 'multer';
import { query, ApiError } from '../db.js';
import { requireAuth, requireAdmin, userRow } from '../auth.js';
import { isOwner, deny, assertAdmin } from '../rules.js';
import { notify } from '../notify.js';
import { saveUpload, readPrivate } from '../storage.js';
import { CONFIG } from '../config.js';

export const notificationsRouter = Router();
export const donationsRouter = Router();
export const reportsRouter = Router();
export const ideasRouter = Router();
export const uploadRouter = Router();
export const catalogRouter = Router();

// ---------- Справочники (Фаза C: порт fetchSynthCatalog/addSynthToCatalog и DAW) ----------
catalogRouter.get('/synths', async (req, res, next) => {
  try {
    const { rows } = await query('select name from synth_catalog order by name');
    res.json(rows.map((r) => r.name));
  } catch (e) { next(e); }
});
catalogRouter.post('/synths', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) throw new ApiError('invalid_name', 'Пустое название');
    await query('insert into synth_catalog (name, added_by) values ($1,$2) on conflict (name) do nothing', [name, req.user.id]);
    res.status(201).json({ ok: true, name });
  } catch (e) { next(e); }
});
catalogRouter.get('/daws', async (req, res, next) => {
  try {
    const { rows } = await query('select name from daw_catalog order by name');
    res.json(rows.map((r) => r.name));
  } catch (e) { next(e); }
});
catalogRouter.post('/daws', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!name) throw new ApiError('invalid_name', 'Пустое название');
    await query('insert into daw_catalog (name) values ($1) on conflict (name) do nothing', [name]);
    res.status(201).json({ ok: true, name });
  } catch (e) { next(e); }
});

// ---------- Уведомления ----------
notificationsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from notifications where user_id = $1 order by created_at desc limit 100', [req.user.id]);
    res.json(rows);
  } catch (e) { next(e); }
});
notificationsRouter.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    await query('update notifications set read = true where id = $1 and user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
notificationsRouter.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    await query('update notifications set read = true where user_id = $1 and read = false', [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Донаты (модель A: деньги мимо платформы) ----------
donationsRouter.post('/thanks', requireAuth, async (req, res, next) => {
  try {
    const recipient = req.body?.recipient_user_id || null;
    const message = String(req.body?.message || '');
    const { rows } = await query(
      `insert into donations (recipient_user_id, donor_id, amount, message, kind, status)
       values ($1, $2, 0, $3, 'thanks', 'done') returning *`,
      [recipient, req.user.id, message],
    );
    if (recipient) {
      const me = await userRow(req.user.id);
      await notify(recipient, 'support', { by: me?.username || '?', donorId: req.user.id, amount: 0, message });
    }
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

donationsRouter.post('/mark', requireAuth, async (req, res, next) => {
  try {
    const amount = Math.round(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new ApiError('invalid_amount', 'Некорректная сумма');
    const recipient = req.body?.recipientUserId;
    const message = String(req.body?.message || '');
    const { rows } = await query(
      `insert into donations (recipient_user_id, donor_id, amount, message, kind, status)
       values ($1, $2, $3, $4, 'paid', 'intent') returning *`,
      [recipient, req.user.id, amount, message],
    );
    if (recipient) {
      const me = await userRow(req.user.id);
      await notify(recipient, 'support', { by: me?.username || '?', donorId: req.user.id, amount, message, donationId: rows[0].id });
    }
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

donationsRouter.post('/:id/confirm', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from donations where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Отметка не найдена', 404);
    if (rows[0].recipient_user_id !== req.user.id) throw deny();
    const { rows: up } = await query(
      `update donations set status = 'done', confirmed_at = now() where id = $1 returning *`,
      [req.params.id],
    );
    // Фаза C (порт демо-ветки confirmDonation): исходное уведомление автора
    // помечается confirmed — кнопка «Получено ✓» в колокольчике гаснет
    await query(
      `update notifications set payload = payload || '{"confirmed": true}'::jsonb
        where user_id = $1 and type = 'support' and payload->>'donationId' = $2
          and coalesce((payload->>'confirmed')::boolean, false) = false`,
      [req.user.id, req.params.id],
    );
    if (rows[0].donor_id) {
      const me = await userRow(req.user.id);
      await notify(rows[0].donor_id, 'support', { by: me?.username || '?', amount: rows[0].amount, done: true, authorId: req.user.id });
    }
    res.json(up[0]);
  } catch (e) { next(e); }
});

donationsRouter.get('/count', async (req, res, next) => {
  try {
    // Фаза C: публичный счётчик «☕ N» (профиль/карточка ответа) и поддержка
    // проекта (recipient_user_id=project → строки с null-получателем).
    // Считаем все записи (thanks + paid) — parity с демо-веткой fetchSupportCount.
    const rid = String(req.query.recipient_user_id || '');
    const { rows } = rid === 'project'
      ? await query('select count(*)::int as n from donations where recipient_user_id is null')
      : await query('select count(*)::int as n from donations where recipient_user_id = $1', [rid]);
    res.json({ count: rows[0]?.n ?? 0 });
  } catch (e) { next(e); }
});

donationsRouter.get('/for-me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `select d.*, p.username as donor_name from donations d
        left join profiles p on p.id = d.donor_id
       where d.recipient_user_id = $1 and d.kind = 'paid'
       order by d.created_at desc`,
      [req.user.id],
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ---------- Жалобы и модерация ----------
reportsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!['question', 'answer', 'comment', 'profile'].includes(b.target_type)) throw new ApiError('invalid_target', 'Некорректная цель');
    if (!['spam', 'offense', 'copyright', 'fraud', 'other'].includes(b.reason)) throw new ApiError('invalid_reason', 'Некорректная причина');
    const dup = await query('select 1 from reports where reporter_id = $1 and target_type = $2 and target_id = $3', [req.user.id, b.target_type, b.target_id]);
    if (dup.rowCount) throw new ApiError('duplicate', 'Вы уже жаловались на эту цель', 409);
    const { rows } = await query(
      `insert into reports (reporter_id, target_type, target_id, reason, note) values ($1,$2,$3,$4,$5) returning *`,
      [req.user.id, b.target_type, b.target_id, b.reason, String(b.note || '').slice(0, 500)],
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

reportsRouter.get('/', requireAdmin, async (req, res, next) => {
  try {
    const status = req.query.status;
    const { rows } = await query(
      status && status !== 'all'
        ? 'select * from reports where status = $1 order by created_at desc'
        : 'select * from reports order by created_at desc',
      status && status !== 'all' ? [status] : [],
    );
    // Фаза C: композиция reporter + target на сервере (порт боевой ветки
    // fetchReports — модератор получает карточки, готовые к рендеру;
    // target === null — контент уже удалён)
    const idsOf = (type) => [...new Set(rows.filter((r) => r.target_type === type).map((r) => r.target_id))];
    const as = idsOf('answer').length
      ? (await query('select id, content, user_id, question_id from answers where id = any($1)', [idsOf('answer')])).rows
      : [];
    const cs = idsOf('comment').length
      ? (await query('select id, content, user_id from comments where id = any($1)', [idsOf('comment')])).rows
      : [];
    const targetProfiles = idsOf('profile').length
      ? (await query('select id, username, avatar_url, bio, contact, donate_methods from profiles where id = any($1)', [idsOf('profile')])).rows
      : [];
    const qids = [...new Set([...idsOf('question'), ...as.map((x) => x.question_id)].filter(Boolean))];
    const qs = qids.length
      ? (await query('select id, title, description, user_id, purged from questions where id = any($1)', [qids])).rows
      : [];
    const peopleIds = [...new Set([
      ...rows.map((r) => r.reporter_id),
      ...targetProfiles.map((x) => x.id),
      ...qs.map((x) => x.user_id), ...as.map((x) => x.user_id), ...cs.map((x) => x.user_id),
    ].filter(Boolean))];
    const profs = peopleIds.length
      ? (await query('select id, username, avatar_url from profiles where id = any($1)', [peopleIds])).rows
      : [];
    const person = (id) => profs.find((p) => p.id === id) || null;
    res.json(rows.map((r) => {
      let target = null;
      if (r.target_type === 'question') {
        const x = qs.find((v) => v.id === r.target_id);
        if (x && !x.purged) target = { kind: 'question', title: x.title || '', text: x.description || '', author: person(x.user_id) };
      } else if (r.target_type === 'answer') {
        const x = as.find((v) => v.id === r.target_id);
        if (x) {
          const qx = qs.find((v) => v.id === x.question_id);
          target = { kind: 'answer', title: qx && !qx.purged ? (qx.title || '') : '', text: x.content || '', author: person(x.user_id), question_id: x.question_id };
        }
      } else if (r.target_type === 'profile') {
        const x = targetProfiles.find((v) => v.id === r.target_id);
        if (x) {
          const pay = (x.donate_methods || []).map((m) => `${m.kind}: ${m.value}`).join('; ');
          const ct = (x.contact || []).map((c) => `${c.kind}: ${c.value}`).join('; ');
          target = {
            kind: 'profile', title: `@${x.username}`, user_id: x.id,
            text: [x.bio || '', pay && `Оплата: ${pay}`, ct && `Контакты: ${ct}`].filter(Boolean).join('\n'),
            author: person(x.id),
          };
        }
      } else {
        const x = cs.find((v) => v.id === r.target_id);
        if (x) target = { kind: 'comment', title: '', text: x.content || '', author: person(x.user_id) };
      }
      return { ...r, reporter: person(r.reporter_id), target };
    }));
  } catch (e) { next(e); }
});

reportsRouter.post('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!['new', 'dismissed', 'actioned'].includes(status)) throw new ApiError('invalid_status', 'Некорректный статус');
    const { rows } = await query(
      `update reports set status = $2, moderator_note = coalesce($3, moderator_note),
        resolved_at = case when $2 = 'new' then null else now() end
       where id = $1 returning *`,
      [req.params.id, status, req.body?.moderator_note ?? null],
    );
    if (!rows[0]) throw new ApiError('not_found', 'Жалоба не найдена', 404);
    if (status !== 'new') {
      await notify(rows[0].reporter_id, 'report_status', { status, target_type: rows[0].target_type });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

reportsRouter.post('/:id/remove', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('select * from reports where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Жалоба не найдена', 404);
    const r = rows[0];
    const table = { question: 'questions', answer: 'answers', comment: 'comments' }[r.target_type];
    if (table) await query(`delete from ${table} where id = $1`, [r.target_id]);
    await query(`update reports set status = 'actioned', resolved_at = now() where id = $1`, [r.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Идеи (заход 38) ----------
ideasRouter.get('/', async (req, res, next) => {
  try {
    const sort = req.query.sort === 'new' ? 'i.created_at desc' : 'votes desc, i.created_at desc';
    const { rows } = await query(
      `select i.*, pr.username, pr.avatar_url,
              (select count(*)::int from idea_votes v where v.idea_id = i.id) as votes
         from ideas i left join profiles pr on pr.id = i.author_id
        order by ${sort}`,
    );
    res.json(rows.map((r) => ({ ...r, profile: { username: r.username, avatar_url: r.avatar_url } })));
  } catch (e) { next(e); }
});

ideasRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (title.length < 3 || title.length > 120) throw new ApiError('invalid_title', 'Заголовок: 3–120 знаков');
    if (body.length < 10 || body.length > 1000) throw new ApiError('invalid_body', 'Описание: 10–1000 знаков');
    const { rows } = await query('insert into ideas (author_id, title, body) values ($1,$2,$3) returning *', [req.user.id, title, body]);
    res.status(201).json({ ...rows[0], votes: 0 });
  } catch (e) { next(e); }
});

ideasRouter.get('/votes-mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select idea_id from idea_votes where user_id = $1', [req.user.id]);
    res.json(rows.map((r) => r.idea_id));
  } catch (e) { next(e); }
});

ideasRouter.post('/:id/vote', requireAuth, async (req, res, next) => {
  try {
    const existing = await query('select 1 from idea_votes where idea_id = $1 and user_id = $2', [req.params.id, req.user.id]);
    if (existing.rowCount) {
      await query('delete from idea_votes where idea_id = $1 and user_id = $2', [req.params.id, req.user.id]);
    } else {
      await query('insert into idea_votes (idea_id, user_id) values ($1,$2)', [req.params.id, req.user.id]);
    }
    const cnt = await query('select count(*)::int as n from idea_votes where idea_id = $1', [req.params.id]);
    res.json({ votes: cnt.rows[0].n });
  } catch (e) { next(e); }
});

ideasRouter.post('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!['new', 'in_work', 'done', 'rejected'].includes(status)) throw new ApiError('invalid_status', 'Некорректный статус');
    const { rows } = await query('update ideas set status = $2 where id = $1 returning *', [req.params.id, status]);
    if (!rows[0]) throw new ApiError('not_found', 'Идея не найдена', 404);
    if (rows[0].author_id !== req.user.id) {
      await notify(rows[0].author_id, 'idea_status', { status, ideaTitle: rows[0].title });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

ideasRouter.post('/:id/reply', requireAdmin, async (req, res, next) => {
  try {
    const reply = String(req.body?.text || '').trim();
    const { rows } = await query(
      'update ideas set dev_reply = $2, dev_reply_at = case when $2 = \'\' then null else now() end where id = $1 returning *',
      [req.params.id, reply],
    );
    if (!rows[0]) throw new ApiError('not_found', 'Идея не найдена', 404);
    if (reply && rows[0].author_id !== req.user.id) {
      await notify(rows[0].author_id, 'idea_reply', { ideaTitle: rows[0].title });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

ideasRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('select * from ideas where id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError('not_found', 'Идея не найдена', 404);
    if (!isOwner(rows[0], req.user) && !req.user.is_admin) throw deny();
    await query('delete from ideas where id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Загрузки на SSD ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CONFIG.UPLOAD_LIMIT_MB * 1024 * 1024 } });
uploadRouter.post('/:bucket', requireAuth, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) throw new ApiError('no_file', 'Файл не получен');
    const saved = saveUpload(req.params.bucket, req.file.buffer, req.file.mimetype, req.file.originalname);
    res.status(201).json(saved);
  } catch (e) { next(e); }
});

uploadRouter.get('/private/:bucket/:name', requireAuth, (req, res, next) => {
  try {
    res.sendFile(readPrivate(req.params.bucket, req.params.name));
  } catch (e) { next(e); }
});
