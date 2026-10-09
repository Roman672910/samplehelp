// Смоук-тест жизненного цикла решённого вопроса (демо-слой данных)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;
globalThis.navigator = { language: 'ru' };
globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }) };

const sb = await import('../public/js/supabase.mjs');
const { setState } = await import('../public/js/store.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };

setState({ user: { id: 'u-max', username: 'MaxWavetable' } });

console.log('1) Сиды и sweep при загрузке:');
const q1 = await sb.fetchQuestion('q1');
ok(q1.status === 'solved' && !!q1.solved_at && !!q1.purge_at, 'q1 решён, есть solved_at/purge_at');
const q0 = await sb.fetchQuestion('q0');
ok(q0.purged === true && q0.audio_url === null, 'q0 — заглушка без аудио');
ok(q0.purge_summary.best_username === 'MaxWavetable', 'q0: лучший ответ в архивной справке');
const feed = await sb.fetchFeed('new');
ok(!feed.some((q) => q.id === 'q0'), 'заглушка q0 не попадает в ленту');
ok(feed.some((q) => q.id === 'q1'), 'решённый q1 остаётся в ленте');

console.log('2) Напоминания:');
const q2raw = await sb.fetchQuestion('q2');
ok(q2raw.reminder_24h === true && !q2raw.reminder_3d, 'q2 (ответ 1,5 дня назад): 24ч отправлено, 3д — нет');
const q3raw = await sb.fetchQuestion('q3');
ok(!q3raw.reminder_24h, 'q3 (ответ ~17 ч назад): напоминаний нет');
const q4raw = await sb.fetchQuestion('q4');
ok(!q4raw.reminder_24h, 'q4 (только самоответ): напоминаний нет');

console.log('3) Отметка решения (u-max отмечает a3 от u-lena на q2):');
const lenaBefore = (await sb.fetchProfile('u-lena')).stats;
await sb.markSolution('a3', 'q2');
const q2 = await sb.fetchQuestion('q2');
ok(q2.status === 'solved' && !!q2.purge_at, 'q2 решён, таймер поставлен');
const msLeft = new Date(q2.purge_at) - Date.now();
ok(Math.abs(msLeft - 7 * 86400000) < 60000, 'purge_at ≈ +7 дней');
const lenaAfter = (await sb.fetchProfile('u-lena')).stats;
ok(lenaAfter.rating === lenaBefore.rating + 25, `LenaFX +25 реп (${lenaBefore.rating} → ${lenaAfter.rating})`);
ok(lenaAfter.solutions === lenaBefore.solutions + 1, 'solutions +1');

console.log('4) Повторная/смена отметки БЕЗ отмены — таймер не сбрасывается, награда не двоится:');
await sb.markSolution('a3', 'q2');
const lenaAgain = (await sb.fetchProfile('u-lena')).stats;
ok(lenaAgain.rating === lenaAfter.rating, 'репутация не удвоилась');
const q2b = await sb.fetchQuestion('q2');
ok(q2b.purge_at === q2.purge_at, 'таймер не сброшен');

console.log('5) Отмена решения → повторная отметка ставит НОВЫЙ таймер:');
await sb.markSolution(null, 'q2');
const q2c = await sb.fetchQuestion('q2');
ok(q2c.status === 'open' && !q2c.solved_at && !q2c.purge_at, 'q2 открыт, таймер снят');
const lenaKept = (await sb.fetchProfile('u-lena')).stats;
ok(lenaKept.rating === lenaAfter.rating && lenaKept.solutions === lenaAfter.solutions, 'репутация/решения сохранены навсегда');
await sb.markSolution('a3', 'q2');
const q2d = await sb.fetchQuestion('q2');
ok(q2d.status === 'solved' && Math.abs(new Date(q2d.purge_at) - Date.now() - 7 * 86400000) < 60000, 'новый таймер ≈ +7 дней');
await sb.markSolution(null, 'q2'); // вернуть в открытые для следующих тестов

console.log('6) Удаление по таймеру (q3):');
setState({ user: { id: 'u-lena', username: 'LenaFX' } });
let blocked = false;
try { await sb.createAnswer({ question_id: 'q1', content: 'поздний ответ' }); } catch { blocked = true; }
ok(blocked, 'новый ответ на решённый вопрос отклоняется слоем данных');
await sb.markSolution('a4', 'q3');            // u-lena отмечает ответ u-anna
const annaBefore = (await sb.fetchProfile('u-anna')).stats;
// искусственно «состариваем» таймер и запускаем sweep
await sb.updateQuestion('q3', { purge_at: new Date(Date.now() - 1000).toISOString() });
sb.demoLifecycleSweep();
const q3 = await sb.fetchQuestion('q3');
ok(q3.purged === true && q3.title === '' && q3.audio_url === null, 'q3 стал заглушкой без содержимого');
ok(q3.purge_summary.answers_count === 1 && q3.purge_summary.best_username === 'AnnaSynth', 'архивная справка: 1 ответ, лучшая — AnnaSynth');
ok(q3.purge_summary.rep === 25, 'в справке указана награда +25');
const answersGone = await sb.fetchAnswers('q3');
ok(answersGone.length === 0, 'ответы удалены');
const annaAfter = (await sb.fetchProfile('u-anna')).stats;
ok(annaAfter.answers === annaBefore.answers, 'счётчик ответов AnnaSynth сохранён навсегда');
const feed2 = await sb.fetchFeed('new');
ok(!feed2.some((q) => q.id === 'q3'), 'заглушка не в ленте');
const lenaNotifs = await sb.fetchNotifications();
ok(lenaNotifs.some((n) => n.type === 'purge' && n.payload?.questionId === 'q3'), 'автору пришло финальное уведомление');
const lenaProfile = await sb.fetchProfile('u-lena');
ok(lenaProfile.questions.some((q) => q.id === 'q3' && q.purged), 'в профиле автора вопрос виден как архивный');

console.log(fails ? `\n✗ ${fails} провалов` : '\n✓ Все проверки пройдены');
process.exitCode = fails ? 1 : 0;