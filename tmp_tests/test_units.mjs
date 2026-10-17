const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis;
globalThis.navigator = { language: 'ru' };
globalThis.document = { documentElement: {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}, dispatchEvent: () => {} };
const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const l = String(url).match(/locales\/(\w+)\.json/)[1];
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${l}.json`, 'utf8')) };
};

const { tp, t, setLocale } = await import('../public/js/i18n.mjs');
const { formatRemaining, daysLeft } = await import('../public/js/utils.mjs');
await setLocale('ru');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };

console.log('Плюрализация (ru):');
ok(tp('question.answers_n', 1) === '1 ответ', tp('question.answers_n', 1));
ok(tp('question.answers_n', 3) === '3 ответа', tp('question.answers_n', 3));
ok(tp('question.answers_n', 5) === '5 ответов', tp('question.answers_n', 5));
ok(tp('question.answers_n', 11) === '11 ответов', tp('question.answers_n', 11));
ok(tp('question.answers_n', 22) === '22 ответа', tp('question.answers_n', 22));
// Плюрализация для форм [1, N] недостижима при CONFIG.LOCALES = ['ru'].
// Ветка в tp() сохранена на случай возврата языков — проверяем, что чужая
// локаль клампится и ru-формы продолжают работать.
console.log('Заморозка ru-only (чужие локали игнорируются):');
await setLocale('en');
ok(tp('question.answers_n', 1) === '1 ответ' && tp('question.answers_n', 3) === '3 ответа', "setLocale('en') → ru-формы");
await setLocale('de');
ok(tp('question.answers_n', 5) === '5 ответов', "setLocale('de') → ru-формы");
await setLocale('ru');

console.log('Обратный отсчёт:');
const in6d23h = new Date(Date.now() + (6 * 24 + 23) * 3600000).toISOString();
ok(formatRemaining(in6d23h, 'ru').startsWith('6 дн 22 ч') || formatRemaining(in6d23h, 'ru').startsWith('6 дн 23 ч'), 'ru: ' + formatRemaining(in6d23h, 'ru'));
ok(/6 d 2[23] h/.test(formatRemaining(in6d23h, 'en')), 'en: ' + formatRemaining(in6d23h, 'en'));
ok(/6 T 2[23] Std/.test(formatRemaining(in6d23h, 'de')), 'de: ' + formatRemaining(in6d23h, 'de'));
ok(formatRemaining(new Date(Date.now() - 1000).toISOString(), 'ru') === null, 'истёкший срок → null');
ok(daysLeft(in6d23h) === 7, 'чип: дней до удаления = 7 (округление вверх)');
ok(t('question.solved_banner', { time: '6 дн 23 ч' }) === 'Вопрос решён. Удаление через 6 дн 23 ч', 'баннер: ' + t('question.solved_banner', { time: '6 дн 23 ч' }));
ok(t('notifications.rep_awarded', { n: 25 }) === '+25 к репутации', 'rep: ' + t('notifications.rep_awarded', { n: 25 }));

console.log(fails ? `✗ ${fails} провалов` : '✓ Все проверки пройдены');
process.exitCode = fails ? 1 : 0;
