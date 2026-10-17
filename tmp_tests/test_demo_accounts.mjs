// test_demo_accounts.mjs — заход 46: демо-аккаунты по почте + онбординг
// только при регистрации.
//  1) регистрация (signUp) новой почтой = чистый профиль (не u-demo!),
//     needsOnboarding = true;
//  2) вход (signIn) той же почтой = тот же профиль, онбординга нет,
//     username не затирается;
//  3) новая почта = другой чистый профиль (avatar_url null — «фото не
//     перетекает»);
//  4) OAuth демо: первый клик создаёт аккаунт (needsOnboarding true,
//     username google_user), второй — вход в тот же (имя не затирается,
//     онбординга нет);
//  5) легаси: сессия u-demo без записи в реестре продолжает работать;
//  6) пересоздание демо-БД не роняет реестр: строка профиля восстанавливается.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Audio = dom.window.Audio;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
const realSetTimeout = globalThis.setTimeout;
globalThis.requestAnimationFrame = (cb) => realSetTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'getImageData' ? () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }) : p === 'canvas' ? { width: 2, height: 2 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();
dom.window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,STUBCANVAS';

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const SESSION_KEY = 'samplehelp_demo_session';
const ACCOUNTS_KEY = 'samplehelp_demo_accounts';

console.log('1) регистрация новой почтой = чистый профиль + онбординг:');
const reg = await sb.signUp({ email: 'Anna@Test.ru', password: 'secret1', username: 'AnnaX' });
ok(!!reg.user && reg.user.id !== 'u-demo', `новый профиль ≠ u-demo (${reg.user.id})`);
ok(reg.user.username === 'AnnaX', 'username из формы регистрации');
ok(reg.needsOnboarding === true, 'needsOnboarding = true (регистрация)');
const profA = await sb.fetchProfile(reg.user.id);
ok(profA.avatar_url === null && profA.bio === '', 'профиль чистый: без фото и био');
ok(profA.is_admin !== true, 'новый демо-аккаунт — не админ (роль даст тумблер захода 43)');

console.log('\n2) вход той же почтой = тот же профиль, без онбординга:');
const log = await sb.signIn({ email: 'anna@test.ru', password: 'secret1' });
ok(log.user.id === reg.user.id, 'ta же почта → тот же профиль');
ok(!log.needsOnboarding, 'вход: онбординга нет');
ok(log.user.username === 'AnnaX', 'username не затёрся');

console.log('\n3) другая почта = другой чистый профиль (фото не перетекает):');
const reg2 = await sb.signUp({ email: 'max@test.ru', password: 'secret1', username: 'MaxX' });
ok(reg2.user.id !== reg.user.id, 'новая почта → другой id');
const profB = await sb.fetchProfile(reg2.user.id);
ok(profB.avatar_url === null, 'у нового профиля нет чужого фото');

console.log('\n4) OAuth демо: первый клик — регистрация, второй — вход:');
const o1 = await sb.signInWithOAuth('google');
ok(!!o1.user && o1.user.username === 'google_user', 'первый OAuth: аккаунт google_user создан');
ok(o1.needsOnboarding === true, 'первый OAuth: онбординг нужен');
const o1id = o1.user.id;
// «фото» в профиль первого OAuth-аккаунта — проверяем, что не протечёт во второй
setState({ user: o1.user });
await sb.updateProfile({ avatar_url: 'data:image/png;base64,OAUTHTOKEN' });
const o2 = await sb.signInWithOAuth('google');
ok(o2.user.id === o1id, 'второй OAuth: тот же аккаунт');
ok(o2.user.username === 'google_user', 'username не перезаписан повторно');
ok(!o2.needsOnboarding, 'второй OAuth: онбординга нет');
ok(o2.user.avatar_url === 'data:image/png;base64,OAUTHTOKEN', 'своё фото на своём аккаунте осталось');

console.log('\n5) легаси-сессия u-demo работает без реестра:');
localStorage.setItem(SESSION_KEY, JSON.stringify({ id: 'u-demo', username: 'DemoUser', email: 'legacy@x.ru' }));
const sess = await sb.getSessionUser();
ok(sess?.id === 'u-demo', 'сессия u-demo читается');
ok((await sb.fetchProfile('u-demo')).is_admin === true, 'u-demo остаётся админом сидов');

console.log('\n6) пересоздание демо-БД не роняет реестр:');
localStorage.setItem(SESSION_KEY, JSON.stringify({ id: o1id, username: 'google_user', email: 'demo@google.local' }));
const db = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
db.profiles = db.profiles.filter((p) => p.id === 'u-demo' || p.id.startsWith('u-anna') || p.id === 'u-max' || p.id === 'u-lena');
localStorage.setItem('samplehelp_demo_db', JSON.stringify(db));
const S2 = await import('../public/js/supabase.mjs?re');
const relog = await S2.signIn({ email: 'demo@google.local', password: 'x' });
const restored = await S2.fetchProfile(o1id);
ok(!!restored && restored.username === 'google_user', 'строка профиля восстановлена из реестра при входе после чистки демо-БД');
ok(relog.user.id === o1id, 'вход после чистки демо-БД ведёт в тот же аккаунт');
ok(registryHas(ACCOUNTS_KEY, 'demo@google.local'), 'реестр пережил пересоздание демо-БД');

function registryHas(key, email) {
  try { return Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).includes(email); } catch { return false; }
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
