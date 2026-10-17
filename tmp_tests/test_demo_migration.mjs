// Мягкий пересид демо-базы (фикс бага 2026-10-11: после смены DEMO_DB_VERSION
// шапка показывала аватар из сессии, а профиль — пересозданный пустой, настройки
// сбрасывались). Проверяем:
//  1) смена версии снапшота в LocalStorage → пользовательские поля профиля
//     (аватар/био/обложка/контакты/флаги согласия) ПЕРЕНОСЯТСЯ поверх новых сидов;
//  2) одноразовое уведомление takeDemoReseedNotice() {from,to} (тост в main.mjs);
//  3) пользовательский контент (свой вопрос) с v9 ТОЖЕ переносится через
//     пересид (детально — в test_demo_persistence.mjs);
//  4) снапшет после миграции сразу новой версии (повторная миграция не крутится);
//  5) та же версия → полное восстановление, уведомления нет;
//  6) syncDemoProfileFromSession: расхождение сессии и базы (база пересоздана)
//     лечится копированием полей сессии в строку профиля.
// «Новая сессия браузера» моделируется повторным импортом модуля с query-суффиксом
// (ESM считает это другим модулем → loadDemo() выполняется заново); store/i18n
// при этом остаются общими (импортируются без суффикса).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
globalThis.FileReader = dom.window.FileReader;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const DB_KEY = 'samplehelp_demo_db';
const SESSION_KEY = 'samplehelp_demo_session';
const readDb = () => JSON.parse(localStorage.getItem(DB_KEY));
const writeDb = (obj) => localStorage.setItem(DB_KEY, JSON.stringify(obj));

console.log('1) Сессия 1: пользователь меняет профиль и создаёт вопрос:');
const S1 = await import('../public/js/supabase.mjs');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await S1.updateProfile({
  avatar_url: 'data:image/png;base64,QUFB', bio: 'моя био', cover_style: 'wave',
  // v8: контакты открываются по бейджу — эти поля тоже должны пережить пересид
  contact: [{ kind: 'telegram', value: '@my_demo', label: 'по работе', visibility: 'members' }],
  contact_consent: true, open_to_collab: true,
});
const myQ = await S1.createQuestion({ title: 'Мой черновик-вопрос', description: 'текст', synth: 'Serum', category: 'synth' });
ok(!!myQ?.id, 'пользовательский вопрос создан: ' + myQ?.id);
const snap1 = readDb();
ok(snap1.v === S1.DEMO_DB_VERSION, `снапшет версии ${snap1.v}`);
ok(snap1.profiles.find((p) => p.id === 'u-demo').avatar_url === 'data:image/png;base64,QUFB', 'аватар в демобазе');
ok(JSON.parse(localStorage.getItem(SESSION_KEY)).avatar_url === 'data:image/png;base64,QUFB', 'аватар дублируется в сессию');

console.log('\n2) «Обновление кода»: версия снапшета старая (симуляция v-1):');
const oldV = snap1.v - 1;
snap1.v = oldV;
// В старом снапшоте (v7) лежал удалённый флаг payment_markers — проверяем,
// что при переносе он не «воскреснет» в профиле
snap1.profiles.find((p) => p.id === 'u-demo').payment_markers = false;
writeDb(snap1);

console.log('\n3) Сессия 2: мягкий пересид с миграцией:');
const S2 = await import('../public/js/supabase.mjs?m1');
const prof2 = await S2.fetchProfile('u-demo');
ok(prof2.avatar_url === 'data:image/png;base64,QUFB', 'АВАТАР перенесён (не сбросился!)');
ok(prof2.bio === 'моя био', 'био перенесено');
ok(prof2.cover_style === 'wave', 'стиль обложки перенесён');
ok(prof2.contact?.[0]?.value === '@my_demo', 'контакт перенесён: ' + JSON.stringify(prof2.contact));
ok(prof2.contact_consent === true, 'contact_consent перенесён');
ok(prof2.open_to_collab === true, 'open_to_collab перенесён (бейдж остался включён — контакты видны)');
ok(prof2.payment_markers === undefined, 'удалённый payment_markers из старого снапшота НЕ перенесён');
ok(prof2.skills === undefined, 'поля skills в профиле больше нет (навыки удалены из продукта)');
const notice = S2.takeDemoReseedNotice();
ok(!!notice && notice.from === oldV && notice.to === S2.DEMO_DB_VERSION, `уведомление о пересиде: v${notice?.from} → v${notice?.to}`);
ok(t('demo.reseeded', notice).includes('перенесены') && t('demo.reseeded', notice).includes('вопросы'), 'текст тоста: ' + t('demo.reseeded', notice).slice(0, 48) + '…');
ok(S2.takeDemoReseedNotice() === null, 'уведомление одноразовое');
const qAfter = await S2.fetchQuestion(myQ.id);
ok(!!qAfter && qAfter.title === 'Мой черновик-вопрос', 'пользовательский вопрос ПЕРЕНЕСЁН через пересид (v9: фикс потери контента)');
ok(readDb().v === S2.DEMO_DB_VERSION, 'снапшет сразу зафиксирован новой версией (повторной миграции не будет)');

console.log('\n4) Сессия 3: версия совпадает — полное восстановление, без уведомления:');
const S3 = await import('../public/js/supabase.mjs?m2');
const prof3 = await S3.fetchProfile('u-demo');
ok(prof3.bio === 'моя био' && prof3.avatar_url === 'data:image/png;base64,QUFB', 'данные на месте (полный реставр)');
ok(S3.takeDemoReseedNotice() === null, 'уведомления нет (пересида не было)');

console.log('\n5) syncDemoProfileFromSession: база разошлась с сессией:');
const snap4 = readDb();
snap4.profiles.find((p) => p.id === 'u-demo').avatar_url = null; // «база потеряла аватар»
writeDb(snap4);
const S4 = await import('../public/js/supabase.mjs?m3');
ok((await S4.fetchProfile('u-demo')).avatar_url === null, 'база без аватара (восстановилась как есть)');
const sessionUser = JSON.parse(localStorage.getItem(SESSION_KEY));
S4.syncDemoProfileFromSession(sessionUser);
const prof4 = await S4.fetchProfile('u-demo');
ok(prof4.avatar_url === 'data:image/png;base64,QUFB', 'после синка строка профиля = сессия (шапка и профиль совпадают)');
ok(readDb().profiles.find((p) => p.id === 'u-demo').avatar_url === 'data:image/png;base64,QUFB', 'синк персистентен (persistDemo)');

console.log('\n7) v14: способы СИДОВ-авторов освежаются из свежих сидов, свои (сессия) переносятся:');
{
  const snap = readDb();
  // «Залипший» снапшот старой эпохи: у AnnaSynth sbp/card (виды удалены в v11),
  // у своего профиля — своя настройка (boosty), она должна пережить пересид
  snap.profiles.find((p) => p.id === 'u-anna').donate_methods = [
    { kind: 'sbp', value: '+7 900 000-00-00', label: 'старая эпоха' },
    { kind: 'card', value: '6767676767676767', label: 'старая эпоха' },
  ];
  snap.profiles.find((p) => p.id === 'u-demo').donate_methods = [
    { kind: 'boosty', value: 'https://boosty.to/mydemo', label: '' },
  ];
  snap.v = 10;
  writeDb(snap);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ id: 'u-demo', username: 'DemoUser' }));
  const S7 = await import('../public/js/supabase.mjs?m7');
  const anna7 = await S7.fetchProfile('u-anna');
  const kinds7 = (anna7.donate_methods || []).map((m) => m.kind);
  ok(kinds7.join('+') === 'qr+boosty', `u-anna после миграции = свежий сид (${kinds7.join('+')}), а не пустота из старого снапшота`);
  const me7 = await S7.fetchProfile('u-demo');
  const myKinds7 = (me7.donate_methods || []).map((m) => m.kind);
  ok(myKinds7.join('+') === 'boosty', `свой профиль сессии: свои способы перенесены (${myKinds7.join('+') || 'пусто'})`);
  const max7 = await S7.fetchProfile('u-max');
  ok(((max7.donate_methods || [])[0] || {}).kind === 'qr', 'u-max после миграции = свежий сид (qr)');
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
