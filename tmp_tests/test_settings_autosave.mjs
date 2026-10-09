// «Настройки профиля» с автосохранением + переезд переключателя языка из шапки.
// Проверяем:
//  1) в index.html больше нет .lang-switcher в шапке;
//  2) переключатель языка живёт в модалке настроек (RU/EN/DE, активен текущий),
//     клик меняет язык мгновенно: локаль, localStorage, заголовок и подписи
//     модалки переводятся без перезакрытия (data-i18n + перерисовка);
//  3) автосохранение текста: ввод имени/био → debounce → запись в демо-БД
//     БЕЗ кнопки «Сохранить» (её нет), статус-строка показывает «Сохранено ✓»;
//  4) пустое имя не сохраняется: во время ввода (поле в фокусе) значение НЕ
//     подменяется — откат к сохранённому только при потере фокуса;
//  5) переключатель коллабораций и чипсы навыков сохраняются автоматически;
//  6) закрытие с незавершённым debounce (✕) — изменения НЕ теряются (flush);
//  7) «Готово» закрывает модалку и обновляет экран профиля;
//  8) регрессия бага модалок: выделение текста внутри с mouseup на фоне
//     (и обратный драг) окно НЕ закрывает — закрывает только клик,
//     полностью совершённый на фоне (openModal в utils.mjs).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
dom.window.URL.createObjectURL = globalThis.URL.createObjectURL;
globalThis.FileReader = dom.window.FileReader;

const ctx2d = () => new Proxy({}, {
  get: (t, p) => (p === 'measureText' ? () => ({ width: 10 })
    : p === 'createLinearGradient' ? () => ({ addColorStop() {} })
      : p === 'canvas' ? { width: 300, height: 60 }
        : typeof p === 'symbol' ? undefined : () => {}),
  set: () => true,
});
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  if (String(url).startsWith('blob:') || String(url).startsWith('data:')) {
    return { ok: true, blob: async () => new globalThis.Blob(['fake-wav']) };
  }
  throw new Error('unexpected fetch: ' + url);
};

const { initI18n, setLocale, getLocale } = await import('../public/js/i18n.mjs');
await initI18n();       // навешивает document-делегирование кликов по .lang-switcher
await setLocale('ru');  // jsdom-браузер «en» — фиксируем русский
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const type = (el, value, ev = 'input') => { el.value = value; el.dispatchEvent(new dom.window.Event(ev, { bubbles: true })); };

console.log('1) Шапка: переключатель языка убран из index.html:');
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
ok(!indexHtml.includes('lang-switcher'), 'в index.html больше нет .lang-switcher');
ok(indexHtml.includes('id="auth-area"'), 'шапка на месте (auth-area)');

console.log('\n2) Модалка «Настройки профиля» открывается кнопкой ⚙:');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await renderProfile(app, { userId: 'u-anna' }, { editable: true });
await tick();
const editBtn = app.querySelector('#btn-edit-profile');
ok(editBtn?.textContent.includes('⚙'), 'кнопка настроек — шестерёнка');
ok(editBtn?.getAttribute('aria-label') === 'Настройки профиля', 'aria-label: «Настройки профиля»');
click(editBtn);
await tick();
ok(document.querySelector('.modal-head h2')?.textContent === 'Настройки профиля', 'заголовок модалки: «Настройки профиля»');
ok(!document.querySelector('#edit-form button[type="submit"]'), 'кнопки «Сохранить» нет — автосохранение');
ok(document.querySelector('#ed-done')?.textContent.trim() === 'Готово', 'внизу — «Готово»');
ok(document.querySelector('#ed-autosave')?.textContent.includes('автоматически'), 'подсказка «Изменения сохраняются автоматически»');

console.log('\n3) Язык в настройках: переключатель RU/EN/DE, активен текущий:');
const langBtns = [...document.querySelectorAll('#edit-form .lang-switcher button[data-lang]')];
ok(langBtns.length === 3, 'три кнопки: ' + langBtns.map((b) => b.dataset.lang).join('/'));
ok(document.querySelector('.lang-switcher button[data-lang="ru"]')?.classList.contains('active'), 'активен русский');
ok(document.querySelector('.lang-switcher button[data-lang="ru"]')?.getAttribute('aria-pressed') === 'true', 'aria-pressed=true у активного');

console.log('\n4) Клик по DE меняет язык мгновенно, модалка переводится на глазах:');
click(document.querySelector('.lang-switcher button[data-lang="de"]'));
await tick(200);
ok(getLocale() === 'de', 'локаль стала de');
ok(localStorage.getItem('samplehelp_locale') === 'de', 'выбор сохранён в localStorage');
ok(document.querySelector('.lang-switcher button[data-lang="de"]')?.classList.contains('active'), 'активная кнопка переехала на DE');
ok(!document.querySelector('.lang-switcher button[data-lang="ru"]')?.classList.contains('active'), 'с RU подсветка снята');
ok(document.querySelector('.modal-head h2')?.textContent === 'Profil-Einstellungen', 'заголовок переведён: ' + document.querySelector('.modal-head h2')?.textContent);
ok(document.querySelector('label[for="ed-username"]')?.textContent === 'Benutzername', 'подпись поля имени переведена');
ok(document.querySelector('#ed-done')?.textContent.trim() === 'Fertig', '«Готово» → «Fertig»');
ok(document.querySelector('#ed-autosave')?.textContent.includes('automatisch'), 'подсказка автосохранения переведена');
ok(document.querySelector('#ed-cover-picker [data-cover="depth"] .cover-opt-name')?.textContent === 'Tiefe', 'пикер обложки перерисован на немецком');

console.log('\n5) Автосохранение текста (debounce, без кнопки):');
const nameInput = document.querySelector('#ed-username');
type(nameInput, 'AnnaNeu');
await tick(200);
let p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaSynth', 'сразу после ввода ещё НЕ сохранено (debounce)');
await tick(800);
p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaNeu', 'после debounce имя сохранено в демо-БД: ' + p.username);
ok(document.querySelector('#ed-autosave')?.textContent.includes('Gespeichert'), 'статус: «Gespeichert ✓»');

console.log('\n6) Пустое имя (поле НЕ в фокусе) не сохраняется — откат к сохранённому:');
nameInput.blur();
type(nameInput, '   ');
await tick(900);
p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaNeu', 'в профиле прежнее имя: ' + p.username);
ok(document.querySelector('#ed-username').value === 'AnnaNeu', 'поле откатилось к сохранённому значению');

console.log('\n6b) Регрессия: стёр имя и ввожу новое — старое НЕ подставляется под курсор:');
nameInput.focus();
ok(document.activeElement === nameInput, 'поле в фокусе (пользователь редактирует)');
type(nameInput, '');
await tick(900); // debounce срабатывает посреди редактирования
ok(nameInput.value === '', 'во время ввода старое имя не подставилось');
p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaNeu', 'пустое значение не попало в БД: ' + p.username);
type(nameInput, 'Bob'); // продолжаем ввод нового имени — без «склейки» со старым
await tick(900);
p = await sb.fetchProfile('u-anna');
ok(p.username === 'Bob', 'новое имя сохранилось целиком: ' + p.username);
ok(nameInput.value === 'Bob', 'в поле только новое имя');
type(nameInput, 'AnnaNeu'); // возвращаем исходное для следующих секций
await tick(900);
nameInput.blur();
await tick(30);
p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaNeu' && nameInput.value === 'AnnaNeu', 'имя восстановлено, blur непустое поле не трогает');

console.log('\n7) Переключатель коллабораций сохраняется мгновенно:');
const collab = document.querySelector('#ed-collab');
collab.checked = true;
collab.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await tick(150);
p = await sb.fetchProfile('u-anna');
ok(p.open_to_collab === true, 'open_to_collab=true без debounce');

console.log('\n8) Навыки: Enter → чипс → автосохранение:');
const skillInput = document.querySelector('#ed-skills input');
const chipsBefore = document.querySelectorAll('#ed-skills .chip').length;
type(skillInput, 'FM-Synthese');
skillInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(50);
ok(document.querySelectorAll('#ed-skills .chip').length === chipsBefore + 1, `чипс добавился (${chipsBefore} → ${chipsBefore + 1})`);
await tick(700);
p = await sb.fetchProfile('u-anna');
ok((p.skills || []).includes('FM-Synthese'), 'навык сохранён: ' + JSON.stringify(p.skills));

console.log('\n9) «Готово»: закрытие + экран профиля обновлён:');
click(document.querySelector('#ed-done'));
await tick(300);
ok(!document.querySelector('#ed-cover-picker'), 'модалка закрыта');
ok(app.textContent.includes('AnnaNeu'), 'на экране профиля — новое имя');

console.log('\n10) Закрытие (✕) с незавершённым debounce — изменения не теряются:');
click(app.querySelector('#btn-edit-profile'));
await tick();
type(document.querySelector('#ed-bio'), 'Sound designerin aus Berlin');
click(document.querySelector('#modal-root .modal-close')); // сразу, до окончания debounce
await tick(400);
p = await sb.fetchProfile('u-anna');
ok(p.bio === 'Sound designerin aus Berlin', 'био досохранилось при закрытии (flush): ' + p.bio);

console.log('\n11) Выделение текста с выходом за границы модалки НЕ закрывает её:');
await tick(300);
click(app.querySelector('#btn-edit-profile'));
await tick();
const overlay = document.querySelector('#modal-root .modal-overlay');
const bio = document.querySelector('#ed-bio');
const mouse = (type, target) => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true }));
ok(!!overlay && !!bio, 'модалка открыта');
// Сценарий из бага: mousedown внутри (начали выделять текст), mouseup на фоне
mouse('mousedown', bio);
mouse('mouseup', overlay);
ok(document.body.contains(bio), 'выделение из модалки на фон — окно осталось открытым');
// Обратный драг: нажали на фон, отпустили внутри — тоже не закрывает
mouse('mousedown', overlay);
mouse('mouseup', bio);
ok(document.body.contains(bio), 'драг фон→модалка — окно осталось открытым');
// Обычный клик по фону (нажатие И отпускание на фоне) — закрывает
mouse('mousedown', overlay);
mouse('mouseup', overlay);
await tick(50);
ok(!document.body.contains(bio), 'клик по фону по-прежнему закрывает модалку');

console.log('\n12) Возврат языка на русский (за другими тестами не должно ломаться):');
await setLocale('ru');
ok(getLocale() === 'ru', 'локаль ru');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
