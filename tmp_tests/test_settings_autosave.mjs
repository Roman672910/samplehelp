// «Настройки профиля» с автосохранением. Переключатель языка убран вместе
// с заморозкой ru-only (словари en/de — в locales_archive/).
// Проверяем:
//  1) в index.html нет .lang-switcher;
//  2) модалка настроек открывается кнопкой ⚙ (заголовок, «Готово»,
//     статус-строка автосохранения, кнопки «Сохранить» нет);
//  3) язык: переключателя в модалке нет, чужая локаль клампится к ru;
//  4) автосохранение текста: ввод имени/био → debounce → запись в демо-БД
//     БЕЗ кнопки «Сохранить» (её нет), статус-строка показывает «Сохранено ✓»;
//  5) пустое имя не сохраняется: во время ввода (поле в фокусе) значение НЕ
//     подменяется — откат к сохранённому только при потере фокуса;
//  6) переключатель коллабораций сохраняется мгновенно;
//  7) редактор «Контакты» (замена чипсов навыков): добавление строки,
//     автоопределение типа, валидация (невалидная запись в профиль НЕ уходит),
//     удаление строки, переключатель согласия на показ;
//  7) закрытие с незавершённым debounce (✕) — изменения НЕ теряются (flush);
//  8) «Готово» закрывает модалку и обновляет экран профиля;
//  9) регрессия бага модалок: выделение текста внутри с mouseup на фоне
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
// attachMiniPlayer с маркерами создаёт new Audio() для догрузки длительности пинов
globalThis.Audio = dom.window.Audio;

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
await initI18n();       // ru-only: язык jsdom-браузера («en») игнорируется → ru
await setLocale('ru');  // фиксируем локаль для детерминизма
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

console.log('\n3) Язык: заморозка ru-only — переключателя в настройках нет:');
ok(!document.querySelector('#edit-form .lang-switcher'), 'в модалке нет .lang-switcher');
ok(!document.querySelector('#edit-form [data-lang]'), 'кнопок с data-lang нет');
await setLocale('de'); // чужая локаль игнорируется (CONFIG.LOCALES = ['ru'])
ok(getLocale() === 'ru', "setLocale('de') клампится к ru");
ok(localStorage.getItem('samplehelp_locale') === 'ru', 'в localStorage остаётся ru');
ok(document.querySelector('.modal-head h2')?.textContent === 'Настройки профиля', 'заголовок модалки по-прежнему русский');
ok(document.querySelector('#ed-done')?.textContent.trim() === 'Готово', '«Готово» на месте');

console.log('\n3b) Наведение порядка (2026-10-13): секции, липкий подвал, аватар, превью ссылок:');
{
  const secs = [...document.querySelectorAll('#edit-form .set-section')].map((x) => x.dataset.section);
  ok(JSON.stringify(secs) === JSON.stringify(['profile', 'gear', 'privacy', 'contacts', 'support']), `пять тематических секций в порядке: ${secs.join(',')}`);
  ok(document.querySelector('#edit-form .set-section-title')?.textContent.includes('Профиль'), 'заголовки секций отрисованы (верхний — «Профиль»)');
  const priv = (id) => document.querySelector(id)?.closest('[data-section]')?.dataset.section;
  ok(priv('#ed-collab') === 'privacy' && priv('#ed-contact-consent') === 'privacy', 'тумблеры приватности — в секции «Приватность»');
  ok(!document.querySelector('#ed-hide-online'), 'тумблер «Не показывать, что я онлайн» удалён (2026-10-13)');
  ok(priv('#ed-collab-warn') === 'privacy' && priv('#ed-consent-warn') === 'privacy', 'предупреждения приватности собраны там же');
  ok(priv('#ed-contact-list') === 'contacts' && priv('#ed-donate-list') === 'support', 'редакторы контактов и способов — в своих секциях');
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  const footRule = css.match(/\.settings-footer \{[^}]*\}/)?.[0] || '';
  ok(/position:\s*sticky/.test(footRule) && /bottom:\s*0/.test(footRule), 'подвал настроек — position: sticky; bottom: 0 (статический CSS-тест)');
  ok(!!document.querySelector('#ed-done')?.closest('.settings-footer'), '«Готово» и статус автосохранения — в липком подвале');
  const slotGrid = css.match(/\.set-slot-grid \{[^}]*\}/)?.[0] || '';
  ok(/grid-template-columns:\s*1fr 1fr/.test(slotGrid), 'слоты поддержки: значение и подпись рядом (статический CSS-тест)');
  ok(/\.kind-menu \{/.test(css) && /\.set-slot\.empty \{/.test(css), 'CSS: меню видов контактов и пустой слот (пунктир) описаны');
  const avBtn = document.querySelector('#ed-avatar-btn');
  ok(avBtn?.dataset.help === 'set_avatar' && !!document.querySelector('#ed-avatar-input[accept="image/*"][hidden]'), 'аватар в настройках: кнопка «Сменить фото» (data-help=set_avatar) + скрытый file-input');
  ok(!!document.querySelector('#ed-avatar-preview.avatar.md'), 'превью аватара в строке');
  const chips = document.querySelectorAll('#ed-links-preview .set-link-chip');
  ok(chips.length === 4, `превью ссылок u-anna: ${chips.length} чипа (instagram/youtube/soundcloud/bandcamp)`);
  ok(document.querySelectorAll('#ed-contact-list .contact-row').length === 2, 'редактор контактов отрисован (2 строки сида)');
}

console.log('\n4) Автосохранение текста (debounce, без кнопки):');
const nameInput = document.querySelector('#ed-username');
type(nameInput, 'AnnaNeu');
await tick(200);
let p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaSynth', 'сразу после ввода ещё НЕ сохранено (debounce)');
await tick(800);
p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaNeu', 'после debounce имя сохранено в демо-БД: ' + p.username);
ok(document.querySelector('#ed-autosave')?.textContent.includes('Сохранено'), 'статус: «Сохранено ✓»');

console.log('\n5) Пустое имя (поле НЕ в фокусе) не сохраняется — откат к сохранённому:');
nameInput.blur();
type(nameInput, '   ');
await tick(900);
p = await sb.fetchProfile('u-anna');
ok(p.username === 'AnnaNeu', 'в профиле прежнее имя: ' + p.username);
ok(document.querySelector('#ed-username').value === 'AnnaNeu', 'поле откатилось к сохранённому значению');

console.log('\n5b) Регрессия: стёр имя и ввожу новое — старое НЕ подставляется под курсор:');
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

console.log('\n6) Переключатель коллабораций сохраняется мгновенно:');
const collab = document.querySelector('#ed-collab');
collab.checked = true;
collab.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await tick(150);
p = await sb.fetchProfile('u-anna');
ok(p.open_to_collab === true, 'open_to_collab=true без debounce');

console.log('\n7) Контакты (замена навыков): строка редактора → автосохранение:');
ok(!document.querySelector('#ed-skills'), 'блока «Навыки» в настройках больше нет');
const contactList = document.querySelector('#ed-contact-list');
const contactsBefore = ((await sb.fetchProfile('u-anna')).contact || []).length;
const rowsBefore = contactList.querySelectorAll('.contact-row').length;
ok(rowsBefore === contactsBefore, `в редакторе столько же строк, сколько контактов (${rowsBefore})`);
click(document.querySelector('#ed-add-contact'));
await tick(30);
ok(!!document.querySelector('#ed-kind-menu-host .kind-menu'), '«＋ Добавить контакт» открывает меню видов (вариант «Г»)');
ok(document.querySelector('.kind-menu [data-kind="telegram"]')?.disabled === true, 'занятые виды (telegram, email) в меню отключены');
click(document.querySelector('.kind-menu [data-kind="phone"]'));
await tick(30);
ok(contactList.querySelectorAll('.contact-row').length === rowsBefore + 1,
   `карточка добавилась из меню (${rowsBefore} → ${rowsBefore + 1})`);
ok(!document.querySelector('#ed-kind-menu-host .kind-menu'), 'меню закрылось после выбора вида');
const lastRow = () => contactList.querySelector('.contact-row:last-child');
const change = (el) => el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
ok(lastRow().querySelector('.set-slot-head .ico')?.textContent === '📞' && !lastRow().querySelector('select'),
   'карточка: вид фиксированный (иконка в шапке), селекта нет');
type(lastRow().querySelector('.contact-value-in'), '+7 921 000-11-22');
change(lastRow().querySelector('.contact-value-in'));
await tick(200);
p = await sb.fetchProfile('u-anna');
ok(p.contact.some((c) => c.value === '+7 921 000-11-22' && c.kind === 'phone'),
   'контакт сохранён с видом из меню: ' + JSON.stringify(p.contact.map((c) => c.kind)));

console.log('\n7b) Валидация: невалидное значение подсвечено и в профиль НЕ уходит:');
type(lastRow().querySelector('.contact-value-in'), 'не почта');
change(lastRow().querySelector('.contact-value-in'));
await tick(200);
ok(lastRow().classList.contains('invalid'), 'карточка помечена .invalid');
const errText = lastRow().querySelector('.row-error')?.textContent || '';
ok(errText.toLowerCase().includes('телефон'), 'ошибка вида «телефон» под карточкой: «' + errText + '»');
p = await sb.fetchProfile('u-anna');
ok(!p.contact.some((c) => c.value === 'не почта'), 'невалидное значение не сохранено');
ok(!p.contact.some((c) => c.value === '+7 921 000-11-22'), 'и прежняя запись этой строки не сохранена (строка целиком невалидна)');

console.log('\n7c) Удаление строки + переключатель согласия:');
click(lastRow().querySelector('.contact-del'));
await tick(200);
p = await sb.fetchProfile('u-anna');
ok(p.contact.length === contactsBefore, `после удаления профиль вернулся к ${contactsBefore} контактам`);
const consent = document.querySelector('#ed-contact-consent');
ok(consent.checked === true, 'у сид-профиля u-anna согласие включено');
consent.checked = false;
consent.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await tick(150);
p = await sb.fetchProfile('u-anna');
ok(p.contact_consent === false, 'contact_consent=false сохранён мгновенно (без debounce)');
ok(document.querySelector('#ed-consent-warn').hidden === false, 'показано предупреждение «контакты никто не видит»');
consent.checked = true;
consent.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await tick(150);
p = await sb.fetchProfile('u-anna');
ok(p.contact_consent === true, 'согласие возвращено (contact_consent=true)');
ok(document.querySelector('#ed-consent-warn').hidden === true, 'предупреждение скрыто');

console.log('\n8) «Готово»: закрытие + экран профиля обновлён:');
click(document.querySelector('#ed-done'));
await tick(300);
ok(!document.querySelector('#ed-cover-picker'), 'модалка закрыта');
ok(app.textContent.includes('AnnaNeu'), 'на экране профиля — новое имя');

console.log('\n9) Закрытие (✕) с незавершённым debounce — изменения не теряются:');
click(app.querySelector('#btn-edit-profile'));
await tick();
type(document.querySelector('#ed-bio'), 'Sound designerin aus Berlin');
click(document.querySelector('#modal-root .modal-close')); // сразу, до окончания debounce
await tick(400);
p = await sb.fetchProfile('u-anna');
ok(p.bio === 'Sound designerin aus Berlin', 'био досохранилось при закрытии (flush): ' + p.bio);

console.log('\n10) Выделение текста с выходом за границы модалки НЕ закрывает её:');
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

console.log('\n11) Локаль не уезжала на протяжении всего теста:');
ok(getLocale() === 'ru', 'локаль ru — заморозка держится');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
