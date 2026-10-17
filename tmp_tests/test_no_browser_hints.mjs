// test_no_browser_hints.mjs — запрет браузерных подсказок в полях (2026-10-13):
// автоподсказки/автозаполнение (autocomplete) и нативные валидационные «пузыри»
// (novalidate). Валидация в приложении своя, поэтому novalidate безопасен.
// Chrome/Yandex игнорируют autocomplete="off" на полях, которые узнают по
// name/id/label (MDN: менять name), а менеджер паролей — off на паре логина,
// поэтому к off добавлены: случайный name на сессию (рвёт связь с сохранёнными
// подсказками) и readonly до фокуса на десктопе (дропдаун не раскрывается над
// readonly; focusin снимает, focusout возвращает).
// Секции:
//  0) статический скан исходников: autocomplete в шаблонах — только "off",
//     каждый <form …> — с novalidate;
//  1) disableBrowserHints: sweep (autocomplete/novalidate + случайный name +
//     readonly на текстовых, hidden не тронут), идемпотентность;
//  2) фокус-цикл readonly v3: в момент фокуса поле остаётся readonly (меню
//     не раскрывается), снятие — спустя 250 мс; focusout возвращает; клавиша
//     в readonly-поле снимает атрибут сразу;
//  3) initNoBrowserHints: наблюдатель проставляет всё полям, добавленным
//     ПОСЛЕ инициализации;
//  4) живые экраны и модалки: вход (off вместо username/email/current-password,
//     readonly+name на пароле), ЛС, /ask, «Настройки профиля» (#ed-username);
//  5) поле, вставленное в уже открытую модалку, получает весь пакет.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.Audio = dom.window.Audio;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
// десктоп-сценарий: трюк readonly активен (pointer: fine)
dom.window.matchMedia = (q) => ({ matches: q === '(pointer: fine)', media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = dom.window.matchMedia;
const realSetTimeout = globalThis.setTimeout;
globalThis.requestAnimationFrame = (cb) => realSetTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
globalThis.URL.revokeObjectURL = () => {};
dom.window.URL.revokeObjectURL = globalThis.URL.revokeObjectURL;
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'canvas' ? { width: 300, height: 60 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const { disableBrowserHints, initNoBrowserHints } = await import('../public/js/utils.mjs');
const { openAuthModal } = await import('../public/js/auth.mjs');
const { renderMessages } = await import('../public/js/messages.mjs');
const { renderAskQuestion } = await import('../public/js/question.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 80) => new Promise((r) => realSetTimeout(r, ms));
const fields = (root) => [...root.querySelectorAll('input, textarea')];
const textField = (el) => el.tagName === 'TEXTAREA' || ['', 'text', 'email', 'password', 'search', 'url', 'tel', 'number'].includes((el.type || 'text').toLowerCase());
const allOff = (root) => fields(root).every((el) => el.getAttribute('autocomplete') === 'off');
const formsNoValidate = (root) => [...root.querySelectorAll('form')].every((f) => f.noValidate && f.getAttribute('autocomplete') === 'off');
const NAME_RE = /^f[0-9a-f]{6,12}$/;
const fire = (el, type) => el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));

// ---------- 0) Статический скан исходников ----------
console.log('0) Исходники: autocomplete только "off", все <form> с novalidate:');
{
  const files = fs.readdirSync('public/js').filter((f) => f.endsWith('.mjs')).map((f) => `public/js/${f}`);
  let badAuto = 0, badForm = 0, autoCount = 0, formCount = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/autocomplete="([^"]*)"/g)) {
      autoCount++;
      if (m[1] !== 'off') { badAuto++; console.log(`    ✗ ${f}: autocomplete="${m[1]}"`); }
    }
    for (const m of src.matchAll(/<form\b[^>]*>/g)) {
      formCount++;
      if (!m[0].includes('novalidate')) { badForm++; console.log(`    ✗ ${f}: форма без novalidate: ${m[0]}`); }
    }
  }
  ok(autoCount > 0 && badAuto === 0, `literal autocomplete в шаблонах — только "off" (${autoCount} шт.)`);
  ok(formCount === 5 && badForm === 0, `все ${formCount} форм шаблонов — с novalidate`);
}

// Наблюдатель включён ДО рендеров экранов — как в main.mjs (boot)
initNoBrowserHints();
setState({ user: { id: 'u-demo', username: 'DemoUser' } });

// ---------- 1) Sweep ----------
console.log('\n1) disableBrowserHints: sweep (off/novalidate + name + readonly):');
{
  const box = document.createElement('div');
  box.innerHTML = `
    <form id="t-form" autocomplete="on">
      <input type="email" autocomplete="email">
      <textarea autocomplete="on"></textarea>
      <input type="hidden">
      <input type="checkbox">
    </form>
    <input id="t-loose">`;
  document.body.appendChild(box);
  disableBrowserHints(box);
  ok(box.querySelector('#t-form').noValidate === true && box.querySelector('#t-form').getAttribute('autocomplete') === 'off', 'форма: novalidate + autocomplete=off');
  ok(allOff(box), 'все input/textarea (включая hidden) — autocomplete=off');
  const texts = fields(box).filter(textField);
  ok(texts.every((el) => NAME_RE.test(el.getAttribute('name') || '') && el.dataset.hintsName === '1'), 'текстовые поля получили случайный name (ключ сохранённых подсказок сломан)');
  ok(texts.every((el) => el.hasAttribute('readonly') && el.dataset.hintsRo === '1'), 'текстовые поля (десктоп) — readonly до фокуса');
  const hidden = box.querySelector('input[type="hidden"]');
  const check = box.querySelector('input[type="checkbox"]');
  ok(!hidden.hasAttribute('readonly') && !check.hasAttribute('readonly') && !hidden.getAttribute('name'), 'hidden/checkbox трюки не получают (бессмысленно)');
  const names = new Set(texts.map((el) => el.getAttribute('name')));
  ok(names.size === texts.length, 'имена уникальны в пределах sweep');
  disableBrowserHints(box);
  ok(allOff(box) && formsNoValidate(box) && texts.every((el) => NAME_RE.test(el.getAttribute('name'))), 'повторный sweep идемпотентен (name не пересоздаётся)');
  box.remove();
}

// ---------- 2) Фокус-цикл readonly ----------
console.log('\n2) readonly до фокуса (v3): меню не раскроется, печать не теряется:');
{
  const inp = document.createElement('input');
  document.body.appendChild(inp);
  disableBrowserHints(inp);
  ok(inp.hasAttribute('readonly'), 'свежее поле — readonly');
  fire(inp, 'focusin');
  ok(inp.hasAttribute('readonly'), 'в момент фокуса/клика поле ЕЩЁ readonly — браузеру нечего раскрывать');
  await tick(300);
  ok(!inp.hasAttribute('readonly'), 'спустя 250 мс readonly снят — можно печатать/вставлять');
  fire(inp, 'focusout');
  ok(inp.hasAttribute('readonly'), 'focusout — readonly вернулся (следующий фокус снова защищён)');
  inp.remove();

  // быстрая печать: клавиша снимает readonly сразу
  const fast = document.createElement('input');
  document.body.appendChild(fast);
  disableBrowserHints(fast);
  fast.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
  ok(!fast.hasAttribute('readonly'), 'keydown в readonly-поле (до паузы) — атрибут снят сразу, ввод не блокируется');
  fast.remove();
}

// ---------- 3) Наблюдатель ----------
console.log('\n3) Наблюдатель: поля, добавленные после init:');
{
  const late = document.createElement('form');
  late.innerHTML = '<input type="text" autocomplete="username"><textarea></textarea>';
  document.body.appendChild(late);
  await tick(30);
  ok(late.noValidate === true && late.getAttribute('autocomplete') === 'off', 'поздно вставленная форма обработана');
  ok(allOff(late), 'поздно вставленные поля — autocomplete=off (username затёрт)');
  ok(fields(late).every((el) => NAME_RE.test(el.getAttribute('name') || '') && el.hasAttribute('readonly')), 'поздно вставленные поля — name + readonly');
  late.remove();
}

// ---------- 4) Живые экраны и модалки ----------
console.log('\n4) Экраны и модалки: весь пакет на живых полях:');
{
  // Модалка входа/регистрации
  await openAuthModal('signup');
  await tick(120);
  const modal = document.querySelector('#modal-root .modal-overlay');
  ok(!!modal, 'модалка входа открыта');
  ok(allOff(modal), 'поля модалки (username/email/password) — autocomplete=off');
  ok(!modal.innerHTML.includes('current-password') && !modal.innerHTML.includes('autocomplete="username"'), 'прежних autocomplete-семантик (username/email/current-password) нет');
  ok(formsNoValidate(modal), '#auth-form: novalidate + autocomplete=off');
  const pwd = modal.querySelector('#auth-password');
  ok(NAME_RE.test(pwd.getAttribute('name') || '') && pwd.hasAttribute('readonly'), 'пароль: случайный name + readonly (менеджер паролей не раскроется)');
  modal.remove();

  // ЛС
  const boxM = document.createElement('div');
  document.body.appendChild(boxM);
  const cleanupM = await renderMessages(boxM, { userId: 'u-anna' });
  await tick(150);
  ok(allOff(boxM) && formsNoValidate(boxM), 'ЛС: #chat-input и форма чата — off/novalidate');
  ok(fields(boxM).filter(textField).every((el) => el.hasAttribute('readonly')), 'ЛС: текстовые поля — readonly до фокуса');
  cleanupM?.();
  boxM.remove();

  // Форма вопроса /ask
  const boxA = document.createElement('div');
  document.body.appendChild(boxA);
  const cleanupA = await renderAskQuestion(boxA);
  await tick(200);
  ok(fields(boxA).length >= 3, `форма /ask отрисована (${fields(boxA).length} полей)`);
  ok(allOff(boxA) && formsNoValidate(boxA), '/ask: все поля off, #ask-form novalidate');
  cleanupA?.();
  boxA.remove();

  // «Настройки профиля» (модалка редактирования) — поле со скриншота заказчика
  const boxP = document.createElement('div');
  document.body.appendChild(boxP);
  const cleanupP = await renderProfile(boxP, { userId: 'u-demo' });
  await tick(250);
  boxP.querySelector('#btn-edit-profile')?.click();
  await tick(200);
  const editModal = [...document.querySelectorAll('#modal-root .modal-overlay')].pop();
  const nameInput = editModal?.querySelector('#ed-username');
  ok(!!editModal?.querySelector('#edit-form'), 'модалка «Настройки профиля» открыта');
  ok(allOff(editModal) && formsNoValidate(editModal), 'настройки: все поля off, #edit-form novalidate');
  ok(NAME_RE.test(nameInput?.getAttribute('name') || ''), '#ed-username: случайный name — сохранённые «Алинка/RK676720/…» больше не совпадут с полем');
  ok(nameInput?.hasAttribute('readonly'), '#ed-username: readonly до фокуса — меню автозаполнения не раскроется');
  fire(nameInput, 'focusin');
  ok(nameInput.hasAttribute('readonly'), 'фокус на #ed-username: в момент клика поле ещё readonly (v3)');
  await tick(300);
  ok(!nameInput.hasAttribute('readonly'), 'спустя паузу #ed-username редактируется');
  fire(nameInput, 'focusout');
  ok(nameInput.hasAttribute('readonly'), 'blur — readonly вернулся');
  cleanupP?.();
  boxP.remove();
  editModal?.remove();
}

// ---------- 5) Поле, вставленное в открытую модалку ----------
console.log('\n5) Наблюдатель внутри живого DOM:');
{
  await openAuthModal('login');
  await tick(120);
  const modal = [...document.querySelectorAll('#modal-root .modal-overlay')].pop();
  const extra = document.createElement('input');
  extra.type = 'text';
  extra.autocomplete = 'on';
  modal.querySelector('.modal-body').appendChild(extra);
  await tick(30);
  ok(extra.getAttribute('autocomplete') === 'off', 'input, вставленный в открытую модалку, получает off');
  ok(NAME_RE.test(extra.getAttribute('name') || '') && extra.hasAttribute('readonly'), '…и весь пакет (name + readonly)');
  modal.remove();
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
