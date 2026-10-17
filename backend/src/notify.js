// backend/src/notify.js — серверные уведомления (порт петель заходов 36/38/47)
import { query } from './db.js';
import { pushNotification } from './realtime.js';

/** Best-effort: сбой уведомления НЕ рвёт основное действие (конвенция) */
export async function notify(userId, type, payload = {}) {
  if (!userId) return null;
  try {
    const { rows } = await query(
      'insert into notifications (user_id, type, payload) values ($1, $2, $3) returning id, user_id, type, payload, read, created_at',
      [userId, type, JSON.stringify(payload)],
    );
    // Фаза B: живой пуш в сокет владельца строки (best-effort)
    if (rows[0]) pushNotification(rows[0]);
    return rows[0] || null;
  } catch (e) {
    console.warn('[notify]', type, e.message);
    return null;
  }
}

/** Подписчики тега узнают о новом вопросе (заход B / pass 23) */
export async function notifyTagSubscribers(question) {
  if (!question?.synth) return;
  try {
    const { rows } = await query(
      "select user_id from subscriptions where target_type = 'tag' and target_id = $1",
      [question.synth],
    );
    for (const r of rows) {
      if (r.user_id === question.user_id) continue;
      await notify(r.user_id, 'new_question_tag', { tag: question.synth, questionTitle: question.title || '', questionId: question.id });
    }
  } catch (e) {
    console.warn('[notify] tag subscribers:', e.message);
  }
}
