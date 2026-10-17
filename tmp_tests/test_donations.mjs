// test_donations.mjs — поддержка (модель A) после QR-захода 2026-10-13:
// способ приёма ОДИН — QR-код СБП (картинка + декодированное содержимое),
// СБП-номер и карта удалены; чтение QR с фишинг-разбором ДО переходов.
//  0) конфиг/сиды v11: ENABLE_DONATIONS=true; DONATE_KINDS=['qr'], MAX_METHODS=1;
//     u-anna — QR (настоящая сид-картинка), u-lena — пусто;
//  1) правила donate.mjs: normalize фильтрует sbp/card/qr без картинки/дубли,
//     validate требует картинку и payload (payment.invalid_qr);
//  2) модалка донора: QR-картинка, «Прочитать QR» → разбор (NSPK-инфо, домен,
//     копирование); фишинговый payload → предупреждения и заблокированный переход;
//  3) «спасибо» → donations(kind='thanks') + счётчик ☕ + уведомление автору;
//  4) чип «☕ Поблагодарить» только на ЧУЖИХ ответах;
//  5) модалка проекта: способов в конфиге нет → подсказка + «спасибо» проекту;
//  6) ENABLE_DONATIONS=false → заглушка «Скоро»;
//  7) настройки автора: заполненный слот → удалить → дропзона → загрузка файла
//     (декод + разбор ДО сохранения) → «Сохранить» → способ в профиле;
//     нечитаемый файл → тост-ошибка; камера недоступна → тост.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="modal-root"></div><div id="toast-container"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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
globalThis.FileReader = dom.window.FileReader;
globalThis.File = dom.window.File;
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

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { CONFIG } = await import('../public/js/config.mjs');
const { getState, setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const donate = await import('../public/js/donate.mjs');
const { openSupportModal } = await import('../public/js/support.mjs');
const { answerCardHtml } = await import('../public/js/question.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 80) => new Promise((r) => realSetTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const modal = () => [...document.querySelectorAll('#modal-root .modal-overlay')].pop();
const closeModals = () => document.querySelectorAll('#modal-root .modal-overlay').forEach((o) => o.remove());
const toasts = () => document.getElementById('toast-container').textContent;
const setFakeDecode = (fn) => { dom.window.__QR_FAKE_DECODE__ = fn; };

// ---------- 0) Конфиг и сиды ----------
console.log('0) Конфиг и сиды v11: единственный способ — QR СБП:');
ok(CONFIG.ENABLE_DONATIONS === true, 'ENABLE_DONATIONS=true (модель A: деньги мимо платформы)');
ok(JSON.stringify(donate.DONATE_KINDS) === '["qr","boosty"]' && donate.MAX_METHODS === 2, 'DONATE_KINDS=["qr","boosty"], MAX_METHODS=2 (по одному на вид)');
ok(sb.DEMO_DB_VERSION === 16, `DEMO_DB_VERSION = ${sb.DEMO_DB_VERSION}`);
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
const anna = await sb.fetchProfile('u-anna');
ok((anna.donate_methods || []).length === 2 && anna.donate_methods[0].kind === 'qr'
  && anna.donate_methods[0].qr_data_url.startsWith('data:image/png;base64,'),
  'сид u-anna: QR-способ с настоящей картинкой (dataURL png)');
ok(anna.donate_methods[1]?.kind === 'boosty' && anna.donate_methods[1]?.value === 'https://boosty.to/annasynth',
  'сид u-anna: второй канал — Boosty (каноническая ссылка)');
ok(anna.donate_methods[0].value.startsWith('https://qr.nspk.ru/'), `payload сида — URL НСПК: ${anna.donate_methods[0].value}`);
const lena = await sb.fetchProfile('u-lena');
ok((lena.donate_methods || []).length === 1 && lena.donate_methods[0].kind === 'boosty', 'u-lena: только Boosty (одноканальный автор)');

// ---------- 1) Правила donate.mjs ----------
console.log('\n1) normalize/validate: старые виды и битые QR отфильтрованы:');
{
  const norm = donate.normalizeDonateMethods([
    { kind: 'sbp', value: '+7 900 000-00-00' },
    { kind: 'card', value: '2202 0000 0000 0000' },
    { kind: 'qr', value: 'https://qr.nspk.ru/X' }, // без картинки
    { kind: 'qr', value: 'https://qr.nspk.ru/A', qr_data_url: 'data:image/png;base64,QQ==', label: '  банк  ' },
    { kind: 'qr', value: 'https://qr.nspk.ru/B', qr_data_url: 'data:image/png;base64,QQ==' }, // дубль сверх лимита
  ]);
  ok(norm.length === 1 && norm[0].kind === 'qr' && norm[0].label === 'банк', 'sbp/card/qr-без-картинки/дубль отфильтрованы, label трим');
  ok(donate.validateDonateMethod({ kind: 'qr', value: 'x', qr_data_url: 'data:image/png;base64,QQ==' }).ok === true, 'валидный QR проходит');
  ok(donate.validateDonateMethod({ kind: 'qr', value: 'x', qr_data_url: 'https://evil/x.png' }).errorKey === 'payment.invalid_qr', 'картинка не data:image → invalid_qr');
  ok(donate.validateDonateMethod({ kind: 'qr', value: '', qr_data_url: 'data:image/png;base64,QQ==' }).errorKey === 'payment.invalid_qr', 'пустой payload → invalid_qr');
  // Boosty: канонизация ссылки и отсев чужих доменов
  ok(donate.canonicalBoostyUrl('boosty.to/annasynth') === 'https://boosty.to/annasynth', 'canonical: без протокола → https://boosty.to/…');
  ok(donate.canonicalBoostyUrl('@Lenafx') === 'https://boosty.to/Lenafx', 'canonical: @имя и регистр сохраняют имя');
  ok(donate.canonicalBoostyUrl('https://boosty.evil.com/anna') === null && donate.canonicalBoostyUrl('https://boosty.to/') === null, 'чужой домен и пустое имя → null');
  const normB = donate.normalizeDonateMethods([
    { kind: 'boosty', value: 'boosty.to/annasynth' },
    { kind: 'boosty', value: 'boosty.to/second' }, // дубль вида — второй не проходит
    { kind: 'boosty', value: 'https://evil.tld/x' },
    { kind: 'sbp', value: '+7 900 000-00-00' },
  ]);
  ok(normB.length === 1 && normB[0].value === 'https://boosty.to/annasynth', 'normalize boosty: канон + дубли вида + чужой домен + sbp отфильтрованы');
}

// ---------- 2) Модалка донора: QR + чтение с разбором ----------
console.log('\n2) Модалка донора: картинка QR и безопасное чтение:');
setFakeDecode(() => 'https://qr.nspk.ru/DEMOANNA0001?crc=A1B2');
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: anna.donate_methods });
await tick(120);
{
  const m = modal();
  const img = m.querySelector('.sup-qr-block img.qr-img');
  ok(!!img && img.getAttribute('src').startsWith('data:image/png;base64,'), 'QR-картинка показана донору');
  ok((m.querySelector('.sup-qr-side b')?.textContent || '') === 'Сбербанк', 'подпись способа: «Сбербанк»');
  ok(!m.querySelector('[data-copy]'), 'кнопок «Скопировать номер» больше нет (номера нет)');
  click(m.querySelector('[data-qr-read]'));
  await tick(120);
  const host = m.querySelector('[data-qr-host]');
  ok(!host.hidden && host.querySelector('.qa-badge')?.textContent.includes('URL'), 'чтение QR: бейдж типа «URL-ссылка»');
  ok((host.textContent || '').includes('qr.nspk.ru'), 'домен qr.nspk.ru показан в разборе');
  ok((host.textContent || '').includes(t('qr.alert_nspk').slice(0, 20)), 'инфо-алерт НСПК: проверьте получателя в приложении банка');
  ok(!!host.querySelector('.qa-copy'), 'кнопка «Скопировать содержимое» есть');
  ok(!host.querySelector('.qa-open[disabled]'), 'для чистого NSPK-URL переход разрешён');
  click(m.querySelector('[data-qr-read]'));
  await tick(50);
  ok(host.hidden, 'повторный клик сворачивает разбор');
  // переключатель каналов: у u-anna два способа (QR + Boosty)
  const chans = m.querySelectorAll('.chan-btn');
  ok(chans.length === 2, 'два канала: переключатель QR / Boosty виден');
  ok(m.querySelector('[data-chank="0"]').hidden === false && m.querySelector('[data-chank="1"]').hidden === true, 'по умолчанию открыт первый канал (QR)');
  click(chans[1]);
  await tick(50);
  const bBlock = m.querySelector('[data-chank="1"] .sup-boosty');
  ok(!!bBlock && !m.querySelector('[data-chank="1"]').hidden && m.querySelector('[data-chank="0"]').hidden, 'клик по «Boosty» — переключился канал');
  const bLink = bBlock.querySelector('a.boosty-btn');
  ok(bLink?.getAttribute('href') === 'https://boosty.to/annasynth' && bLink.getAttribute('target') === '_blank', 'кнопка-ссылка на страницу автора (new tab, noopener)');
  ok((bBlock.textContent || '').includes(t('support.boosty_hint').slice(0, 30)), 'подсказка: оплату проводит Boosty, SampleHelp платёж не проводит');
  click(chans[0]);
  await tick(50);
  ok(!m.querySelector('[data-chank="0"]').hidden, 'обратное переключение на QR');
}
closeModals();
// одноканальный автор (u-lena: только Boosty) — переключателя нет
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
const lenaM = await sb.fetchProfile('u-lena');
openSupportModal({ recipientUserId: 'u-lena', recipientName: 'LenaFX', recipientMethods: lenaM.donate_methods });
await tick(100);
{
  const m = modal();
  ok(m.querySelectorAll('.chan-btn').length === 0, 'u-lena (только Boosty): переключатель не показан');
  ok(!!m.querySelector('.sup-boosty a.boosty-btn'), 'сразу виден Boosty-блок');
  ok(!m.querySelector('.sup-qr-block'), 'QR-блока нет');
}
closeModals();
// фишинговый payload: предупреждения + заблокированный переход
setFakeDecode(() => 'http://sberbanl.ru/pay');
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: anna.donate_methods });
await tick(100);
{
  const m = modal();
  click(m.querySelector('[data-qr-read]'));
  await tick(100);
  const host = m.querySelector('[data-qr-host]');
  const txt = host.textContent || '';
  ok(txt.includes(t('qr.alert_brand', { domain: 'sberbanl', brand: 'sberbank' }).slice(0, 24)), 'typosquatting: sberbanl похож на sberbank — danger-алерт');
  ok(txt.includes(t('qr.alert_http').slice(0, 20)), 'http-алерт');
  ok(!!host.querySelector('.qa-open[disabled]') || (host.querySelector('.qa-actions')?.textContent || '').includes(t('qr.open_blocked')), 'переход по опасной ссылке заблокирован');
}
closeModals();
setFakeDecode(null);

// ---------- 3) «Спасибо» ----------
console.log('\n3) Бесплатное «спасибо» (без денег):');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
setFakeDecode(() => null);
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: anna.donate_methods });
await tick(100);
{
  const m = modal();
  m.querySelector('#sup-msg').value = 'Спасибо за разбор!';
  click(m.querySelector('#sup-thanks-send'));
  await tick(150);
  const cnt = await sb.fetchSupportCount('u-anna');
  ok(cnt >= 3, `счётчик ☕ u-anna вырос: ${cnt}`);
  const stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  ok((stored.notifications || []).some((n) => n.user_id === 'u-anna' && n.type === 'support' && !n.payload?.amount), 'уведомление «спасибо» без суммы');
}
closeModals();

// ---------- 4) Чип «Поблагодарить» только на чужих ответах ----------
console.log('\n4) Чип «☕ Поблагодарить»:');
{
  const foreign = answerCardHtml({ id: 'a1', user_id: 'u-anna', content: 'x', author: { username: 'AnnaSynth', donate_methods: anna.donate_methods } }, false, 'u-max');
  ok(foreign.includes('data-act="thanks"'), 'на чужом ответе чип есть');
  const own = answerCardHtml({ id: 'a9', user_id: 'u-demo', content: 'x', author: { username: 'DemoUser', donate_methods: [] } }, false, 'u-max');
  ok(!own.includes('data-act="thanks"'), 'на своём ответе чипа нет');
}

// ---------- 5) Модалка проекта ----------
console.log('\n5) Поддержка проекта (способов в конфиге нет):');
openSupportModal({});
await tick(100);
{
  const m = modal();
  ok((m.textContent || '').includes(t('support.no_methods_project')), 'подсказка «у проекта способов нет»');
  m.querySelector('#sup-msg').value = 'Проекту спасибо';
  click(m.querySelector('#sup-thanks-send'));
  await tick(120);
  ok(true, '«спасибо» проекту отправилось без ошибок');
}
closeModals();

// ---------- 6) Флаг выключен ----------
console.log('\n6) ENABLE_DONATIONS=false → заглушка:');
CONFIG.ENABLE_DONATIONS = false;
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: anna.donate_methods });
await tick(80);
ok((modal().textContent || '').includes(t('support.soon_text')), 'заглушка «Скоро»');
closeModals();
CONFIG.ENABLE_DONATIONS = true;

// ---------- 7) Настройки автора: слот QR ----------
console.log('\n7) Настройки: слот QR (заполнен → удалить → загрузить → сохранить):');
{
  const app = document.createElement('div');
  document.body.appendChild(app);
  setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
  const cleanup = await renderProfile(app, { userId: 'u-anna' }, { editable: true });
  await tick(200);
  click(app.querySelector('#btn-edit-profile'));
  await tick(200);
  const slot = () => document.querySelector('#ed-donate-list .donate-slot');
  ok(!!slot() && !slot().classList.contains('empty'), 'u-anna: слот заполнен (сид-QR)');
  ok(!!slot().querySelector('img.qr-img'), 'превью QR в слоте');
  // удалить
  click(slot().querySelector('#ed-qr-remove'));
  await tick(120);
  ok(!!slot() && slot().classList.contains('empty') && !!slot().querySelector('#ed-qr-drop'), 'после удаления — пустой слот с дропзоной');
  ok(((await sb.fetchProfile('u-anna')).donate_methods || []).length === 0, 'способ удалён из профиля сразу (автосохранение)');
  // загрузка файла: фейк-декодер возвращает payload
  setFakeDecode(() => 'https://qr.nspk.ru/NEWANNA?crc=99');
  const input = slot().querySelector('#ed-qr-input');
  const file = new dom.window.File([new Uint8Array([1, 2, 3])], 'qr.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(200);
  const analysis = slot().querySelector('#ed-qr-analysis');
  ok(!analysis.hidden && (analysis.textContent || '').includes('qr.nspk.ru'), 'до сохранения показан разбор загруженного QR');
  ok(!slot().querySelector('#ed-qr-save-row').hidden, 'появилась строка «Сохранить» с подписью');
  slot().querySelector('#ed-qr-label').value = 'Мой банк';
  click(slot().querySelector('#ed-qr-save'));
  await tick(200);
  const prof = await sb.fetchProfile('u-anna');
  ok((prof.donate_methods || []).length === 1 && prof.donate_methods[0].kind === 'qr'
    && prof.donate_methods[0].value === 'https://qr.nspk.ru/NEWANNA?crc=99' && prof.donate_methods[0].label === 'Мой банк',
    'сохранён именно декодированный QR (value + картинка + подпись)');
  // нечитаемый файл
  setFakeDecode(() => null);
  click(slot().querySelector('#ed-qr-replace'));
  await tick(50);
  const input2 = document.querySelector('#ed-donate-list #ed-qr-input');
  Object.defineProperty(input2, 'files', { value: [file], configurable: true });
  input2.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(150);
  ok(toasts().includes(t('support.qr_decode_fail').slice(0, 20)), 'нечитаемый файл → тост «QR не найден»');
  // камера недоступна в jsdom → тост, без падения (кнопка есть в пустом слоте)
  click(slot().querySelector('#ed-qr-remove'));
  await tick(120);
  click(document.querySelector('#ed-qr-cam-btn'));
  await tick(100);
  ok(toasts().includes(t('support.qr_camera_fail').slice(0, 12)), 'камера недоступна → тост-ошибка, без падения');
  // Boosty-слот: валидная ссылка сохраняется, кривая — нет, пустая — выключает
  const bInput = () => document.querySelector('#ed-donate-list .boosty-value');
  const bSlot = () => document.querySelector('#ed-donate-list [data-kind="boosty"]');
  ok(!!bSlot() && bSlot().classList.contains('empty'), 'u-anna: Boosty-слот пустой (в сидах у неё boosty есть? нет — удалён выше вместе с QR)');
  bInput().value = 'boosty.to/annasynth';
  bInput().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(200);
  let profB = await sb.fetchProfile('u-anna');
  ok((profB.donate_methods || []).some((x) => x.kind === 'boosty' && x.value === 'https://boosty.to/annasynth'),
    'валидная ссылка канонизирована и сохранена (https://boosty.to/annasynth)');
  ok(!bSlot().classList.contains('empty') && !!bSlot().querySelector('a.set-slot-open'), 'слот включён + ссылка «Открыть страницу»');
  bInput().value = 'https://evil.tld/boosty';
  bInput().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(150);
  profB = await sb.fetchProfile('u-anna');
  ok(profB.donate_methods.every((x) => x.value !== 'https://evil.tld/boosty'), 'чужой домен в профиль НЕ сохранён');
  ok(!document.querySelector('#ed-boosty-err').hidden && bSlot().classList.contains('invalid'), 'инлайн-ошибка под слотом');
  bInput().value = '';
  bInput().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(150);
  profB = await sb.fetchProfile('u-anna');
  ok(!(profB.donate_methods || []).some((x) => x.kind === 'boosty'), 'пустое значение → способ выключен');
  cleanup?.();
  app.remove();
  document.querySelectorAll('#modal-root .modal-overlay').forEach((o) => o.remove());
}
setFakeDecode(null);

// ---------- 9) видимость каналов (2026-10-14): шапка одного канала + подсказка автору ----------
{
  const QR = [{ kind: 'qr', value: 'https://qr.nspk.ru/VIS001?crc=D1E2', qr_data_url: 'data:image/png;base64,STUB', label: 'Банк' }];
  const BOO = [{ kind: 'boosty', value: 'https://boosty.to/visuser', label: '' }];
  const clearModals = () => document.querySelectorAll('#modal-root .modal-overlay').forEach((o) => o.remove());
  const openFor = async (viewerId, methods) => {
    clearModals();
    setState({ user: { id: viewerId, username: 'Viewer' } });
    openSupportModal({ recipientUserId: 'u-vis', recipientName: 'VisUser', recipientMethods: methods });
    await tick();
    return document.querySelector('#modal-root .modal');
  };
  // донор смотрит автора с ОДНИМ каналом: переключателя нет, но канал назван
  let m = await openFor('u-demo', QR);
  ok(!m.querySelector('.sup-channels'), 'один канал (QR): переключателя нет');
  let cap = m.querySelector('.sup-chan-cap');
  ok(!!cap && cap.textContent.includes('QR'), 'один канал (QR): шапка «Способ перевода — …QR…»');
  ok(!m.querySelector('.sup-owner-cfg'), 'донор (не автор): подсказки автора нет');
  m = await openFor('u-demo', BOO);
  cap = m.querySelector('.sup-chan-cap');
  ok(!!cap && cap.textContent.includes('Boosty'), 'один канал (Boosty): шапка с названием канала');
  // донор смотрит автора с ДВУМЯ каналами: переключатель, без шапки
  m = await openFor('u-demo', [...QR, ...BOO]);
  ok(!!m.querySelector('.sup-channels') && !m.querySelector('.sup-chan-cap'), 'два канала: переключатель есть, шапки одного канала нет');
  // автор с одним каналом: подсказка, как включить выбор для доноров
  m = await openFor('u-vis', QR);
  ok(!!m.querySelector('.sup-owner-cfg .sup-hint'), 'автор (1 канал): подсказка про включение выбора');
  // автор с двумя каналами: подсказка не нужна
  m = await openFor('u-vis', [...QR, ...BOO]);
  ok(!m.querySelector('.sup-owner-cfg'), 'автор (2 канала): подсказки нет');
  clearModals();
  setState({ user: { id: 'u-demo', username: 'DemoUser' } });
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
