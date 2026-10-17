// backend/src/lifecycle.js — Фаза B: серверный cron жизненного цикла вопросов.
// Порт run_question_lifecycle() из supabase/setup_part2.sql: purge решённых
// по таймеру (7 дней) + напоминания автору через 24ч и 3 дня после первого
// ЧУЖОГО ответа. Файлы на SSD удаляются вместе с архивированием.
import { query, tx } from './db.js';
import { notify } from './notify.js';
import { deleteObject, parseFileUrl } from './storage.js';

export async function runLifecycleSweep() {
  let purged = 0;
  let reminders = 0;

  // ---------- 1) purge решённых с истёкшим сроком ----------
  const due = await query(
    `select id, user_id, title, solved_at from questions
      where purged = false and purge_at is not null and purge_at <= now()`,
  );
  for (const q of due.rows) {
    const best = await query(
      `select a.user_id, p.username from answers a
        left join profiles p on p.id = a.user_id
       where a.question_id = $1 and a.is_solution limit 1`,
      [q.id],
    );
    const nAns = await query('select count(*)::int as n from answers where question_id = $1', [q.id]);
    const files = await tx(async (c) => {
      // вечная статистика: сколько ответов участника ушло в архив
      await c.query(
        `update profiles p set purged_answers_count = coalesce(p.purged_answers_count, 0) + s.cnt
           from (select user_id, count(*)::int as cnt from answers where question_id = $1 group by user_id) s
          where p.id = s.user_id`,
        [q.id],
      );
      // пути файлов на SSD: аудио вопроса/ответов и пресеты
      const fa = await c.query('select audio_url, preset_url from answers where question_id = $1', [q.id]);
      const fq = await c.query('select audio_url from questions where id = $1', [q.id]);
      const list = [];
      for (const r of [...fa.rows, ...fq.rows]) {
        for (const u of [r.audio_url, r.preset_url]) {
          const p = parseFileUrl(u);
          if (p) list.push(p);
        }
      }
      // лайки вопроса и ответов, затем ответы (комментарии — каскадом)
      await c.query(
        `delete from likes where (target_type = 'question' and target_id = $1)
           or (target_type = 'answer' and target_id in (select id from answers where question_id = $1))`,
        [q.id],
      );
      await c.query('delete from answers where question_id = $1', [q.id]);
      // вопрос → заглушка-архив (избранное и ссылки продолжают вести сюда)
      await c.query(
        `update questions set purged = true,
           purge_summary = jsonb_build_object(
             'purged_at', now(), 'solved_at', $2::timestamptz, 'answers_count', $3::int,
             'best_username', $4::text, 'best_user_id', $5::uuid, 'rep', 25),
           title = '', description = null, audio_url = null, waveform_data = null,
           markers = '[]'::jsonb, synth = null, category = null, likes_count = 0
         where id = $1`,
        [q.id, q.solved_at, nAns.rows[0].n, best.rows[0]?.username || null, best.rows[0]?.user_id || null],
      );
      return list;
    });
    for (const f of files) deleteObject(f.bucket, f.name);
    await notify(q.user_id, 'purge', {
      questionId: q.id,
      questionTitle: q.title || '',
      answersCount: nAns.rows[0].n,
      bestUsername: best.rows[0]?.username || '',
      purgedAt: new Date().toISOString(),
    });
    purged++;
  }

  // ---------- 2) напоминания: 24ч и 3 дня после первого чужого ответа ----------
  const rem = await query(
    `select q.id, q.user_id, q.title, q.reminder_24h, q.reminder_3d, min(a.created_at) as first_answer
       from questions q
       join answers a on a.question_id = q.id and a.user_id <> q.user_id
      where q.purged = false and q.status = 'open' and (q.reminder_24h = false or q.reminder_3d = false)
      group by q.id, q.user_id, q.title, q.reminder_24h, q.reminder_3d`,
  );
  for (const r of rem.rows) {
    const first = new Date(r.first_answer).getTime();
    if (!r.reminder_24h && Date.now() >= first + 24 * 3600e3) {
      await notify(r.user_id, 'reminder', { questionId: r.id, questionTitle: r.title || '' });
      await query('update questions set reminder_24h = true where id = $1', [r.id]);
      reminders++;
    }
    if (!r.reminder_3d && Date.now() >= first + 3 * 24 * 3600e3) {
      await notify(r.user_id, 'reminder', { questionId: r.id, questionTitle: r.title || '' });
      await query('update questions set reminder_3d = true where id = $1', [r.id]);
      reminders++;
    }
  }
  return { purged, reminders };
}

export function startLifecycleTimer(ms = 600_000) {
  const t = setInterval(() => {
    runLifecycleSweep().catch((e) => console.error('[lifecycle]', e));
  }, ms);
  t.unref?.();
  return t;
}
