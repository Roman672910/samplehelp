// Контакты участника (модалка «Как связаться» по бейджу, 2026-10-11) — contacts.mjs + UI:
//  0) демо-сиды и константы: v8, у u-anna/u-max контакты + бейдж, у u-lena контакты
//     БЕЗ бейджа (проверка правила видимости), у u-demo пусто; payment_markers удалён;
//  1) detectContactKind: t.me/@user/e-mail/+7/discord.gg/user#1234/vk/https/мусор;
//  2) validateContact: форматы, длина, javascript:/data:, дубли;
//  3) normalizeContacts: мусор отбрасывается, 'all' ужесточается до 'members';
//  4) маски: maskEmail/maskPhone — точный формат, needsMask только email/phone;
//  5) canSeeContact: владелец/аноним/участник × members/hidden × consent × open_to_collab;
//  6) слой данных: contact/contact_consent сохраняются и переживают перезагрузку
//     (мягкий пересид демо-базы), payment_markers больше не существует;
//  7) шапка профиля: рядов «Контакты» и «Оплата» НЕТ (две полосы — DAW и арсенал),
//     бейдж «Открыт к коллаборациям» — кнопка, в DOM страницы чипов контактов нет;
//  7b) модалка «Как связаться»: участнику — чипы (e-mail под маской) + «Написать»,
//     владельцу — всё без маски + «Изменить», анониму — окно входа;
//  7c) правило видимости: тумблер выключен → бейджа нет и контакты не видны никому;
//  8) «Показать» раскрывает маску залогиненному и убирает data-full из DOM;
//  9) «Скопировать» → тост со значением; «Написать» → /messages/<id> и модалка закрыта;
// 10) редактор в настройках: лимит 6 контактов, невалидная строка не сохраняется,
//     тумблера маркеров оплаты нет, предупреждение про выключенный бейдж;
// 11) онбординг, шаг 3 «Как с вами связаться?»: валидация не пускает дальше,
//     «Готово» пишет контакт + согласие + бейдж, «Пропустить» — ничего не пишет.
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
globalThis.Audio = dom.window.Audio;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
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

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const C = await import('../public/js/contacts.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const toasts = document.getElementById('toast-container');
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const change = (el) => el?.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const ANNA = { id: 'u-anna', username: 'AnnaSynth' };
const MAX = { id: 'u-max', username: 'MaxWavetable' };

console.log('0) Демо-сиды и константы:');
ok(sb.DEMO_DB_VERSION === 16, `DEMO_DB_VERSION = ${sb.DEMO_DB_VERSION} (v13: освежение сидов; v12: Boosty вторым каналом)`);
ok(C.CONTACT_KINDS.length === 7 && !C.CONTACT_KINDS.includes('whatsapp'),
   `типов контакта ${C.CONTACT_KINDS.length}: ${C.CONTACT_KINDS.join(', ')} (whatsapp сознательно нет)`);
ok(C.MAX_CONTACTS === 6, `лимит контактов MAX_CONTACTS = ${C.MAX_CONTACTS}`);
const anna = await sb.fetchProfile('u-anna');
ok((anna.contact || []).length === 2 && anna.contact_consent === true && anna.open_to_collab === true,
   `u-anna: ${anna.contact.length} контакта, согласие=true, бейдж включён`);
ok(anna.contact.map((c) => c.kind).join(',') === 'telegram,email', 'типы: ' + anna.contact.map((c) => c.kind).join(', '));
ok((await sb.fetchProfile('u-max')).contact.some((c) => c.kind === 'phone'), 'u-max: есть телефон (для проверки маски)');
ok((await sb.fetchProfile('u-demo')).contact.length === 0, 'u-demo: контактов нет (в модалке будет подсказка)');
const lena0 = await sb.fetchProfile('u-lena');
ok(lena0.contact.length === 2 && lena0.contact_consent === true && !lena0.open_to_collab,
   'u-lena: контакты и согласие есть, а бейдж ВЫКЛЮЧЕН — кейс для правила видимости');
ok((await sb.fetchProfile('u-anna')).skills === undefined, 'поля skills в профиле больше нет');
ok(anna.payment_markers === undefined, 'поля payment_markers в профиле больше нет');

console.log('\n1) detectContactKind:');
const dk = C.detectContactKind;
ok(dk('@annasynth') === 'telegram', '@username → telegram');
ok(dk('https://t.me/annasynth') === 'telegram', 't.me/… → telegram');
ok(dk('anna@nullsea.ru') === 'email', 'name@domain → email');
ok(dk('+7 921 000-11-22') === 'phone', '+7 … → phone');
ok(dk('89210001122') === 'phone', '11 цифр без плюса → phone');
ok(dk('https://discord.gg/sound') === 'discord', 'discord.gg/… → discord');
ok(dk('lenafx#1234') === 'discord', 'user#1234 → discord');
ok(dk('https://vk.com/annasynth') === 'vk', 'vk.com/… → vk');
ok(dk('https://lenafx.ru') === 'website', 'прочий https → website');
ok(dk('какой-то текст') === 'other', 'мусор → other');
ok(dk('') === 'other', 'пусто → other');

console.log('\n2) validateContact:');
const v = C.validateContact;
ok(v({ kind: 'telegram', value: '@annasynth' }).ok, 'валидный telegram');
ok(v({ kind: 'email', value: 'anna@nullsea.ru' }).ok, 'валидный e-mail');
ok(v({ kind: 'email', value: 'anna@nullsea' }).errorKey === 'contact.invalid_email', 'e-mail без домена → invalid_email');
ok(v({ kind: 'phone', value: '123' }).errorKey === 'contact.invalid_phone', '3 цифры → invalid_phone');
ok(v({ kind: 'website', value: 'lenafx.ru' }).errorKey === 'contact.invalid_url', 'сайт без протокола → invalid_url');
ok(v({ kind: 'website', value: 'javascript:alert(1)' }).errorKey === 'contact.invalid_url', 'javascript: → invalid_url');
ok(v({ kind: 'other', value: 'data:text/html,x' }).errorKey === 'contact.invalid_url', 'data: → invalid_url (для любого типа)');
ok(v({ kind: 'other', value: '' }).errorKey === 'contact.invalid_empty', 'пустое значение → invalid_empty');
ok(v({ kind: 'other', value: 'x'.repeat(201) }).errorKey === 'contact.invalid_long', '201 символ → invalid_long');
ok(v({ kind: 'other', value: 'x'.repeat(200) }).ok, '200 символов — ещё валидно');
const dupList = [{ kind: 'telegram', value: '@annasynth' }, { kind: 'telegram', value: '@AnnaSynth ' }];
ok(v(dupList[1], dupList, 1).errorKey === 'contact.invalid_dup', 'дубль (регистр/пробелы не важны) → invalid_dup');
ok(v(dupList[0], dupList, 0).ok === false, 'и первая из двух одинаковых записей тоже invalid_dup');

console.log('\n3) normalizeContacts:');
const norm = C.normalizeContacts([
  { kind: 'telegram', value: ' @annasynth ', label: ' по работе ', visibility: 'all' },
  { kind: 'skype', value: 'old-skype' },              // неизвестный тип → автоопределение
  { kind: 'email', value: '' },                        // пустое значение → отброшено
  null, 'мусор', 42,                                   // не объекты → отброшены
  { kind: 'phone', value: '+7 921 000-11-22', visibility: 'hidden' },
  { kind: 'website', value: 'https://x.ru', label: 'y'.repeat(80) }, // подпись обрежется до 40
]);
ok(norm.length === 4, `мусор отброшен: 7 записей → ${norm.length}`);
ok(norm[0].value === '@annasynth' && norm[0].label === 'по работе', 'значения и подписи обрезаны по краям');
ok(norm[0].visibility === 'members', "visibility 'all' ужесточена до 'members' (публичнее не бывает)");
ok(norm[2].visibility === 'hidden', "'hidden' сохранён (скрывать разрешено)");
ok(norm[3].label.length === 40, `подпись ограничена 40 символами (факт: ${norm[3].label.length})`);
ok(C.normalizeContacts(null).length === 0 && C.normalizeContacts('x').length === 0, 'не-массив → []');

console.log('\n4) Маскирование:');
ok(C.needsMask('email') && C.needsMask('phone'), 'маскируются только e-mail и телефон');
ok(!C.needsMask('telegram') && !C.needsMask('website') && !C.needsMask('discord'), 'telegram/website/discord — без маски');
ok(C.maskEmail('anna@nullsea.ru') === 'a•••@nullsea.ru', 'maskEmail: ' + C.maskEmail('anna@nullsea.ru'));
ok(C.maskPhone('+7 911 222-33-44') === '+7 9•• •••-••-44', 'maskPhone: ' + C.maskPhone('+7 911 222-33-44'));
ok(C.maskPhone('89210001122') === '89•••••••22', 'maskPhone без разделителей: ' + C.maskPhone('89210001122'));
ok(C.maskPhone('123') === '•••', 'короткий «телефон» маскируется целиком: ' + C.maskPhone('123'));
ok(C.maskValue('telegram', '@annasynth') === '@annasynth', 'maskValue для telegram — значение без изменений');

console.log('\n5) canSeeContact — матрица видимости:');
const profile = { id: 'u-anna', contact_consent: true, open_to_collab: true };
const tg = { kind: 'telegram', value: '@annasynth', visibility: 'members' };
const mail = { kind: 'email', value: 'anna@nullsea.ru', visibility: 'members' };
const hidden = { kind: 'telegram', value: '@secret', visibility: 'hidden' };
const see = (viewer, contact, prof = profile) => C.canSeeContact({ viewer, profile: prof, contact });
ok(see(null, tg).show === false, 'аноним: контакт НЕ виден');
ok(see(MAX, tg).show === true && see(MAX, tg).masked === false, 'участник: telegram виден целиком');
ok(see(MAX, mail).show === true && see(MAX, mail).masked === true, 'участник: e-mail виден, но ПОД МАСКОЙ');
ok(see(ANNA, mail).show === true && see(ANNA, mail).masked === false && see(ANNA, mail).owner === true,
   'владелец: видит всё без маски (owner=true)');
ok(see(ANNA, hidden).show === true, 'владелец видит и свой скрытый контакт');
ok(see(MAX, hidden).show === false, 'участник: скрытый контакт не виден');
ok(see(MAX, tg, { id: 'u-anna', contact_consent: false, open_to_collab: true }).show === false,
   'согласие выключено → никому, кроме владельца');
ok(see(ANNA, tg, { id: 'u-anna', contact_consent: false, open_to_collab: true }).show === true,
   '…владелец по-прежнему видит свои контакты');
ok(see(null, tg, { id: 'u-anna', contact_consent: false, open_to_collab: true }).show === false,
   'аноним при выключенном согласии — тоже нет');
ok(see(MAX, tg, { id: 'u-anna', contact_consent: true, open_to_collab: false }).show === false,
   'бейдж выключен (open_to_collab=false) → участник контактов не видит');
ok(see(ANNA, tg, { id: 'u-anna', contact_consent: true, open_to_collab: false }).show === true,
   '…владелец видит их и без бейджа');
ok(see(MAX, tg, { id: 'u-anna' }).show === false,
   'флаги не заданы вовсе → считаем выключенными (безопасно по умолчанию)');

console.log('\n6) Слой данных: сохранение и перенос при пересиде:');
setState({ user: { ...ANNA } });
await sb.updateProfile({
  contact: [{ kind: 'discord', value: 'annasynth', label: '', visibility: 'members' }],
  contact_consent: false, open_to_collab: false,
});
let p = await sb.fetchProfile('u-anna');
ok(p.contact.length === 1 && p.contact[0].kind === 'discord', 'contact сохранён: ' + JSON.stringify(p.contact));
ok(p.contact_consent === false && p.open_to_collab === false, 'contact_consent / open_to_collab сохранены');
ok(p.payment_markers === undefined, 'payment_markers из профиля исчез (флаг удалён из продукта)');
ok(JSON.parse(localStorage.getItem('samplehelp_demo_session')).contact_consent === false,
   'флаги продублированы в демо-сессию');
// «Перезагрузка» — модуль заново читает снапшет из LocalStorage
const sb2 = await import('../public/js/supabase.mjs?contacts1');
setState({ user: { ...ANNA } });
const p2 = await sb2.fetchProfile('u-anna');
ok(p2.contact.length === 1 && p2.contact_consent === false && p2.open_to_collab === false,
   'после перезапуска демо-базы контакты и флаги на месте');
// мягкий пересид (версия снапшота старая) — пользовательские поля переживают
const snap = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
snap.v = snap.v - 1;
localStorage.setItem('samplehelp_demo_db', JSON.stringify(snap));
const sb3 = await import('../public/js/supabase.mjs?contacts2');
setState({ user: { ...ANNA } });
const p3 = await sb3.fetchProfile('u-anna');
ok(p3.contact.length === 1 && p3.contact[0].value === 'annasynth', 'мягкий пересид: contact перенесён поверх новых сидов');
ok(p3.contact_consent === false && p3.open_to_collab === false,
   'мягкий пересид: contact_consent и open_to_collab перенесены');
ok(sb3.DEMO_DB_VERSION === 16, `пересид зафиксирован версией ${sb3.DEMO_DB_VERSION}`);
// Возвращаем сид-состояние ДЛЯ ОСНОВНОГО экземпляра модуля (sb) — именно его
// использует profile.mjs в следующих секциях; sb2/sb3 живут своей копией демо-базы.
setState({ user: { ...ANNA } });
await sb.updateProfile({
  contact: [{ kind: 'telegram', value: '@annasynth', label: '', visibility: 'members' },
            { kind: 'email', value: 'anna@nullsea.ru', label: 'по работе', visibility: 'members' }],
  contact_consent: true, open_to_collab: true,
});

console.log('\n7) Шапка профиля: две полосы + бейдж-кнопка (рядов «Контакты»/«Оплата» нет):');
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
const strips = [...app.querySelectorAll('.profile-meta-strips .compact-row')];
ok(strips.length === 2, `полос в шапке: ${strips.length} (только DAW и арсенал)`);
ok(!!strips[0].querySelector('.daw-row'), 'первая полоса — DAW');
ok(!!strips[1].querySelector('.gear-tag'), 'вторая полоса — арсенал');
ok(!app.querySelector('[data-help="profile_contacts"]'), 'ряда «📇 Контакты» в шапке больше нет');
ok(!app.querySelector('[data-help="profile_payment"]'), 'ряда «💳 Оплата» в шапке больше нет');
ok(!app.querySelector('.pay-marker'), 'маркеров способов приёма в шапке нет');
ok(!app.textContent.includes('@annasynth'), 'значений контактов в DOM страницы профиля нет вовсе');
ok(!app.textContent.includes('anna@nullsea.ru'), 'и e-mail в разметке страницы не лежит (даже маскированный)');
const badge = app.querySelector('#btn-collab');
ok(!!badge && badge.tagName === 'BUTTON', 'бейдж «Открыт к коллаборациям» — КНОПКА');
ok(badge.dataset.help === 'collab_badge', 'у бейджа есть пункт справки data-help="collab_badge"');
ok(badge.getAttribute('aria-haspopup') === 'dialog', 'aria-haspopup="dialog" (открывает окно)');
ok(badge.textContent.includes('Открыт к коллаборациям'), 'текст бейджа: «' + badge.textContent.trim() + '»');
ok(!!app.querySelector('#btn-support-user'), 'вход в оплату не потерялся — кнопка ☕ в шапке');

console.log('\n7b) Модалка «Как связаться»: участник / аноним / владелец:');
click(badge);
await tick();
let modal = document.querySelector('#modal-root .modal');
ok(!!modal, 'клик по бейджу открыл модалку');
ok(modal.querySelector('.modal-head h2').textContent.includes('AnnaSynth'),
   'заголовок: «' + modal.querySelector('.modal-head h2').textContent + '»');
const rowM = modal.querySelector('[data-help="profile_contacts"]');
ok(!!rowM, 'в модалке есть блок контактов');
let chips = [...rowM.querySelectorAll('.contact-chip')];
ok(chips.length === 2, `чипов контактов: ${chips.length}`);
ok(chips[0].textContent.includes('@annasynth') && !chips[0].querySelector('.contact-masked'),
   'telegram — открытым текстом, без маски');
const mailChip = chips[1];
ok(mailChip.querySelector('.contact-value').textContent === 'a•••@nullsea.ru',
   'e-mail под маской: ' + mailChip.querySelector('.contact-value').textContent);
ok(mailChip.querySelector('.contact-value').dataset.full === 'anna@nullsea.ru',
   'полное значение — в data-full (для залогиненного)');
ok(!!mailChip.querySelector('[data-act="reveal"]'), 'у маскированного контакта есть кнопка «Показать»');
ok(!chips[0].querySelector('[data-act="reveal"]'), 'у telegram кнопки «Показать» нет (нечего раскрывать)');
ok(mailChip.querySelector('.contact-label')?.textContent === 'по работе', 'подпись контакта показана');
ok(!!modal.querySelector('.contacts-modal-actions [data-act="write"]'), 'внизу модалки — «💬 Написать»');
ok(!modal.querySelector('[data-act="edit"]'), 'кнопки «Изменить» на чужом профиле нет');
click(modal.querySelector('.modal-close'));
await tick();
ok(!document.querySelector('#modal-root .modal'), 'модалка закрылась по ✕');

setState({ user: null });
await renderProfile(app, { userId: 'u-anna' });
await tick();
const badgeAnon = app.querySelector('#btn-collab');
ok(!!badgeAnon, 'АНОНИМУ бейдж виден (приглашение войти)');
ok(!app.textContent.includes('@annasynth'), 'но контактов в DOM страницы нет');
click(badgeAnon);
await tick();
ok(!!document.querySelector('#auth-form'), 'клик анонима открыл окно входа, а не контакты');
ok(!document.querySelector('[data-help="profile_contacts"]'), 'модалку с контактами анониму не показали');
click(document.querySelector('#modal-root .modal-close'));
await tick();

setState({ user: { ...ANNA } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
click(app.querySelector('#btn-collab'));
await tick();
modal = document.querySelector('#modal-root .modal');
ok(modal.querySelector('.modal-head h2').textContent.includes('Как со мной связаться'),
   'ВЛАДЕЛЕЦ: заголовок «' + modal.querySelector('.modal-head h2').textContent + '»');
ok(modal.textContent.includes('anna@nullsea.ru'), 'владелец видит свой e-mail без маски');
ok(!modal.querySelector('[data-act="reveal"]'), 'кнопка «Показать» владельцу не нужна');
ok(!modal.querySelector('[data-act="write"]'), 'и «Написать» себе — тоже');
const editBtn = modal.querySelector('[data-act="edit"]');
ok(!!editBtn && editBtn.dataset.help === 'contact_edit_btn', 'владельцу — «⚙️ Изменить» со справкой');
click(editBtn);
await tick(150);
ok(!!document.querySelector('#ed-contact-list'), '«Изменить» открыл настройки профиля (блок «Контакты»)');
click(document.querySelector('#ed-done'));
await tick(300);
ok(!document.querySelector('#ed-contact-list'), 'настройки закрыты');

console.log('\n7c) Правило видимости: нет бейджа — нет и контактов:');
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-lena' });
await tick();
ok(!app.querySelector('#btn-collab'), 'u-lena: тумблер выключен → бейджа в шапке нет');
ok(!app.textContent.includes('lenafx'), 'и discord-контакт участнику не виден');
setState({ user: { id: 'u-lena', username: 'LenaFX' } });
await renderProfile(app, { userId: 'u-lena' });
await tick();
ok(!app.querySelector('#btn-collab'), 'владельцу без тумблера кнопка в шапке не показывается');
ok(!app.textContent.includes('lenafx'), 'в DOM страницы профиля её контактов тоже нет');
await sb.updateProfile({ open_to_collab: true });
await renderProfile(app, { userId: 'u-lena' });
await tick();
ok(!!app.querySelector('#btn-collab'), 'включили тумблер — бейдж появился');
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-lena' });
await tick();
click(app.querySelector('#btn-collab'));
await tick();
modal = document.querySelector('#modal-root .modal');
ok(modal.textContent.includes('lenafx'), 'теперь участник видит discord-контакт u-lena');
click(modal.querySelector('.modal-close'));
await tick();
setState({ user: { id: 'u-lena', username: 'LenaFX' } });
await sb.updateProfile({ open_to_collab: false });   // возвращаем сид-состояние

console.log('\n7d) Пустые контакты и выключенное согласие:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await sb.updateProfile({ open_to_collab: true });
await renderProfile(app, { userId: 'u-demo' });
await tick();
click(app.querySelector('#btn-collab'));
await tick();
ok(document.querySelector('#modal-root .modal').textContent.includes('не указаны'),
   'владелец без контактов видит подсказку «Контакты не указаны»');
click(document.querySelector('#modal-root .modal-close'));
await tick();
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-demo' });
await tick();
click(app.querySelector('#btn-collab'));
await tick();
ok(document.querySelector('#modal-root .modal').textContent.includes('не оставил контактов'),
   'участнику — «Участник не оставил контактов» (чипов нет)');
click(document.querySelector('#modal-root .modal-close'));
await tick();
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await sb.updateProfile({ open_to_collab: false });
// бейдж включён, а согласие на публикацию выключено → контакты скрыты
setState({ user: { ...ANNA } });
await sb.updateProfile({ contact_consent: false });
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
click(app.querySelector('#btn-collab'));
await tick();
modal = document.querySelector('#modal-root .modal');
ok(!modal.textContent.includes('@annasynth'), 'согласие выключено → участник контактов не видит');
ok(modal.textContent.includes('не оставил контактов'), 'вместо них — нейтральная подсказка');
click(modal.querySelector('.modal-close'));
await tick();
setState({ user: { ...ANNA } });
await sb.updateProfile({ contact_consent: true });

console.log('\n8) «Показать» раскрывает маску (только залогиненному):');
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
click(app.querySelector('#btn-collab'));
await tick();
const chip = document.querySelector('#modal-root .contact-chip[data-kind="email"]');
ok(chip.querySelector('.contact-value').textContent === 'a•••@nullsea.ru', 'до клика — маска');
click(chip.querySelector('[data-act="reveal"]'));
await tick();
const chip2 = document.querySelector('#modal-root .contact-chip[data-kind="email"]');
ok(chip2.querySelector('.contact-value').textContent === 'anna@nullsea.ru', 'после «Показать» — полное значение');
ok(!chip2.querySelector('.contact-masked'), 'класс маски снят');
ok(chip2.querySelector('.contact-value').dataset.full === undefined, 'data-full из DOM удалён (значение больше не «лежит» в разметке)');
ok(!chip2.querySelector('[data-act="reveal"]'), 'кнопка «Показать» убрана');
ok(chip2.querySelector('a[href="mailto:anna@nullsea.ru"]'), 'появилась ссылка «↗ Открыть» (mailto)');

console.log('\n9) «Скопировать» и «Написать»:');
toasts.textContent = '';
click(document.querySelector('#modal-root .contact-chip[data-kind="telegram"] [data-act="copy"]'));
await tick();
ok(toasts.textContent.includes('@annasynth'), 'копирование без clipboard API → тост со значением: ' + toasts.textContent.trim().slice(0, 30));
ok(!!document.querySelector('#modal-root .modal'), 'модалка при копировании остаётся открытой');
click(document.querySelector('#modal-root [data-act="write"]'));
await tick(120);
ok(location.pathname === '/messages/u-anna', '«Написать» → ' + location.pathname);
ok(!document.querySelector('#modal-root .modal'), 'модалка закрылась перед переходом в чат');

console.log('\n10) Редактор в настройках: лимит 6 и валидация:');
history.replaceState({}, '', '/u/u-anna');
setState({ user: { ...ANNA } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
click(app.querySelector('#btn-edit-profile'));
await tick();
ok(!!document.querySelector('#ed-contact-list'), 'в настройках есть редактор «Контакты»');
ok(!document.querySelector('#ed-skills'), 'редактора «Навыки» больше нет');
ok(!document.querySelector('#ed-payment-markers'), 'тумблера «маркеры оплаты» в настройках больше нет');
ok(!document.querySelector('[data-help="set_payment_markers"]'), 'и пункта справки у него тоже');
ok(!!document.querySelector('#ed-donate-list'), 'блок «Поддержать автора» (способы приёма) остался');
ok(!!document.querySelector('#ed-collab-warn'), 'предупреждение «бейдж выключен — контакты видите только вы» на месте');
// контакты заполнены: предупреждение зависит только от тумблера коллабораций
const collabCb = document.querySelector('#ed-collab');
ok(collabCb.checked === true, 'у сид-профиля u-anna бейдж включён');
collabCb.checked = false; change(collabCb);
await tick(150);
ok(document.querySelector('#ed-collab-warn').hidden === false, 'выключили бейдж → предупреждение показано');
ok(document.querySelector('#ed-consent-warn').hidden === true, 'а предупреждение про согласие при этом молчит');
collabCb.checked = true; change(collabCb);
await tick(150);
ok(document.querySelector('#ed-collab-warn').hidden === true, 'включили обратно → предупреждение скрыто');
ok((await sb.fetchProfile('u-anna')).open_to_collab === true, 'open_to_collab сохранён мгновенно');
const list = document.querySelector('#ed-contact-list');
ok(list.querySelectorAll('.contact-row').length === 2, 'две сид-записи отрисованы строками');
for (const k of ['phone', 'discord', 'website', 'vk']) {
  click(document.querySelector('#ed-add-contact'));
  await tick(20);
  click(document.querySelector(`#ed-kind-menu-host [data-kind="${k}"]`));
  await tick(20);
}
ok(list.querySelectorAll('.contact-row').length === 6, `добавили до лимита через меню видов: ${list.querySelectorAll('.contact-row').length} карточек`);
ok(document.querySelector('#ed-add-contact').disabled, 'на лимите кнопка «＋ Добавить контакт» выключена');
ok(document.querySelector('#ed-contact-hint').textContent.includes('6'),
   'подсказка про лимит: «' + document.querySelector('#ed-contact-hint').textContent + '»');
click(document.querySelector('#ed-add-contact'));
await tick(30);
ok(list.querySelectorAll('.contact-row').length === 6, '7-я строка НЕ добавилась');
ok(toasts.textContent.includes('6'), 'и показан тост про лимит');
// удалим пустые строки и проверим, что профиль не засорился
for (let i = 0; i < 4; i++) click(list.querySelector('.contact-row:last-child .contact-del'));
await tick(250);
const saved = await sb.fetchProfile('u-anna');
ok(saved.contact.length === 2, `пустые строки в профиль не попали (контактов: ${saved.contact.length})`);
ok(saved.contact.every((c) => !('manualKind' in c)), 'служебных полей в записях нет');
click(document.querySelector('#ed-done'));
await tick(250);

console.log('\n11) Онбординг, шаг 3 — «Как с вами связаться?»:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
const { startOnboarding } = await import('../public/js/auth.mjs');
const toStep3 = async () => {
  click(document.querySelector('[data-next="2"]'));
  await tick(120);
  click(document.querySelector('[data-next="3"]'));
  await tick(60);
};
startOnboarding();
await tick();
ok(!!document.querySelector('.modal'), 'модалка онбординга открыта');
ok(!document.querySelector('#ob-skills'), 'чипсов навыков в онбординге больше нет');
await toStep3();
const step3 = document.querySelector('#ob-step-3');
ok(step3 && step3.hidden === false, 'шаг 3 открыт');
ok(step3.textContent.includes('Как с вами связаться?'), 'заголовок: «Как с вами связаться?»');
ok(!!document.querySelector('#ob-contact-kind') && !!document.querySelector('#ob-contact'),
   'селект типа контакта + поле значения');
ok(document.querySelectorAll('#ob-contact-kind option').length === 7, 'в селекте все 7 типов');
ok(step3.textContent.includes('зарегистрированным участникам'), 'напоминание о приватности рядом с полем');
ok(step3.textContent.includes('Открыт к коллаборациям'), 'и сказано, что контакты открываются по бейджу');
const obCollab = document.querySelector('#ob-collab');
ok(!!obCollab && obCollab.checked === true, 'галочка бейджа «Открыт к коллаборациям» есть и включена по умолчанию');
ok(!!document.querySelector('#ob-skip'), 'кнопка «Пропустить» есть');

const cSel = document.querySelector('#ob-contact-kind');
const cIn = document.querySelector('#ob-contact');
cSel.value = 'email'; change(cSel);
cIn.value = 'не почта'; change(cIn);
click(document.querySelector('#ob-finish'));
await tick(150);
ok(!!document.querySelector('.modal'), 'с невалидным значением онбординг НЕ закрывается');
const obErr = document.querySelector('#ob-contact-err');
ok(obErr.hidden === false && obErr.textContent.includes('e-mail'),
   'под полем — текст ошибки: «' + obErr.textContent + '»');
ok((await sb.fetchProfile('u-demo')).contact.length === 0, 'кривой контакт в профиль не попал');

cSel.value = 'telegram'; change(cSel);
cIn.value = '@samplehelp_demo'; change(cIn);
document.querySelector('#ob-bio').value = 'Демо-био';
click(document.querySelector('#ob-finish'));
await tick(250);
ok(!document.querySelector('.modal'), 'после «Готово» онбординг закрыт');
const demoP = await sb.fetchProfile('u-demo');
ok(demoP.contact.length === 1 && demoP.contact[0].kind === 'telegram' && demoP.contact[0].value === '@samplehelp_demo',
   'контакт сохранён: ' + JSON.stringify(demoP.contact));
ok(demoP.contact_consent === true, 'согласие проставлено явно (contact_consent=true)');
ok(demoP.open_to_collab === true, 'бейдж включён вместе с контактом — иначе контакт никто бы не увидел');
ok(demoP.bio === 'Демо-био', 'био сохранено вместе с контактом');

console.log('\n11b) «Пропустить»: контакт не обязателен, согласие не проставляется:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await sb.updateProfile({ contact: [], contact_consent: false, open_to_collab: false });
startOnboarding();
await tick();
await toStep3();
document.querySelector('#ob-bio').value = 'Био без контакта';
document.querySelector('#ob-contact').value = '@ignored';
click(document.querySelector('#ob-skip'));
await tick(250);
ok(!document.querySelector('.modal'), '«Пропустить» закрыл онбординг');
const demoP2 = await sb.fetchProfile('u-demo');
ok(demoP2.bio === 'Био без контакта', 'био при этом сохранено');
ok(demoP2.contact.length === 0 && demoP2.contact_consent === false,
   'контакт НЕ записан и согласие не проставлено (пропуск есть пропуск)');
ok(demoP2.open_to_collab === false, 'и бейдж «Пропустить» не включает');

console.log('\n11c) Галочку бейджа можно снять: контакт сохранится, но увидит его только владелец:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await sb.updateProfile({ contact: [], contact_consent: false, open_to_collab: false });
startOnboarding();
await tick();
await toStep3();
document.querySelector('#ob-collab').checked = false;
const quietInput = document.querySelector('#ob-contact');
quietInput.value = '@quiet_demo'; change(quietInput);
click(document.querySelector('#ob-finish'));
await tick(250);
const demoP3 = await sb.fetchProfile('u-demo');
ok(demoP3.contact.length === 1 && demoP3.contact[0].value === '@quiet_demo',
   'контакт сохранён: ' + JSON.stringify(demoP3.contact));
ok(demoP3.contact_consent === true, 'согласие проставлено');
ok(demoP3.open_to_collab === false, 'а бейдж НЕ включён (галочку сняли)');
setState({ user: { ...MAX } });
await renderProfile(app, { userId: 'u-demo' });
await tick();
ok(!app.querySelector('#btn-collab'), 'в шапке u-demo бейджа нет…');
ok(!app.textContent.includes('@quiet_demo'), '…и его контакт участнику не виден');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
