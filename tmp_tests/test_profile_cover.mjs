// Обложка профиля: выбор стиля в модалке «Настройки профиля» (автосохранение).
// Проверяем:
//  1) шапка профиля рисует вейвформу выбранного стиля (profiles.cover_style),
//     по умолчанию — depth; неизвестный/устаревший стиль не роняет рендер;
//  2) пикер в модалке показывает ЖИВЫЕ превью всех пяти стилей, выбор
//     подсвечивается и мгновенно меняет обложку под модалкой;
//  3) автосохранение: выбор стиля СРАЗУ пишет cover_style в профиль (демо-БД),
//     кнопки «Сохранить» нет — модалка закрывается «Готово»;
//  4) закрытие (✕) НЕ откатывает стиль — всё уже сохранено автоматически;
//  5) id градиентов/фильтров уникальны на обложку — 5 превью в пикере
//     не перебивают друг друга (старый sh-cover-grad был один на все).
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

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { renderProfile } = await import('../public/js/profile.mjs');
const { coverSvg, COVER_STYLES, DEFAULT_COVER_STYLE } = await import('../public/js/covers.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const STYLES = COVER_STYLES.map((s) => s.id);
const coverOf = () => app.querySelector('.profile-cover');
// «отпечаток» стиля: характерные id/элементы генератора внутри SVG
const coverFingerprint = () => {
  const html = coverOf()?.innerHTML || '';
  const hit = STYLES.find((s) => html.includes(`shcov-${s}-`));
  return hit || 'none';
};

console.log('0) Модуль обложек: пять стилей, детерминизм, фолбэк:');
ok(STYLES.length === 5 && STYLES.join(',') === 'depth,mirror,spectrum,wave,studio',
  'стили: ' + STYLES.join(', '));
ok(coverSvg('u-anna', 'wave') === coverSvg('u-anna', 'wave'), 'один userId + стиль → одна волна');
ok(coverSvg('u-anna', 'wave') !== coverSvg('u-max', 'wave'), 'разные userId → разные волны');
ok(coverSvg('u-anna', 'нет-такого') === coverSvg('u-anna', DEFAULT_COVER_STYLE),
  'неизвестный стиль → дефолт (' + DEFAULT_COVER_STYLE + ')');
ok(STYLES.every((s) => {
  const out = coverSvg('u-anna', s);
  return out.startsWith('<svg') && out.endsWith('</svg>') && out.includes('viewBox="0 0 640 90"');
}), 'все пять стилей дают валидный inline-SVG');

console.log('\n1) id градиентов/фильтров уникальны на обложку:');
const svgs = STYLES.map((s) => coverSvg('u-anna', s));
const ids = svgs.flatMap((s) => [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
ok(ids.length > 0 && new Set(ids).size === ids.length,
  `${ids.length} id, дублей нет (старый sh-cover-grad был общим)`);
ok(svgs.every((s) => [...s.matchAll(/url\(#([^)]+)\)/g)].every((m) => ids.includes(m[1]))),
  'все ссылки url(#…) ведут на существующие id');
const sameStyleDiffUsers = [coverSvg('u-anna', 'depth'), coverSvg('u-max', 'depth'), coverSvg('u-lena', 'depth')];
const allIds = sameStyleDiffUsers.flatMap((s) => [...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
ok(new Set(allIds).size === allIds.length, 'одинаковый стиль у разных пользователей — id не пересекаются');

console.log('\n2) Шапка профиля: стиль по умолчанию (depth):');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await renderProfile(app, { userId: 'u-anna' });
await tick();
ok(!!coverOf(), 'обложка отрисована');
ok(coverOf().innerHTML.includes('<svg'), 'внутри inline-SVG (без внешних картинок)');
ok(coverFingerprint() === DEFAULT_COVER_STYLE,
  'стиль по умолчанию: ' + coverFingerprint());
ok(coverOf().getAttribute('aria-hidden') === 'true', 'обложка декоративна (aria-hidden)');

console.log('\n3) Пикер в модалке «Настройки профиля»:');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
await renderProfile(app, { userId: 'u-anna' }, { editable: true });
await tick();
click(app.querySelector('#btn-edit-profile'));
await tick();
const picker = document.querySelector('#ed-cover-picker');
ok(!!picker, 'пикер обложки в модалке есть');
ok(!document.querySelector('#edit-form button[type="submit"]'), 'кнопки «Сохранить» больше нет (автосохранение)');
ok(!!document.querySelector('#ed-done'), 'вместо неё — «Готово» (#ed-done)');
ok(!!document.querySelector('#ed-autosave'), 'строка статуса автосохранения на месте');
const opts = [...(picker?.querySelectorAll('[data-cover]') || [])];
ok(opts.length === 5, 'пять вариантов: ' + opts.map((o) => o.dataset.cover).join(', '));
ok(opts.every((o) => o.querySelector('svg')), 'каждый вариант — живое превью волны (SVG)');
ok(opts.every((o) => o.getAttribute('role') === 'radio'), 'radio-семантика (role=radio)');
ok(opts.every((o) => o.querySelector('.cover-opt-name')?.textContent.trim().length > 0),
  'подписи стилей заполнены (i18n): ' + opts.map((o) => o.querySelector('.cover-opt-name').textContent.trim()).join('/'));
ok(picker.querySelector('[data-cover="depth"]')?.classList.contains('selected'),
  'выбран текущий стиль (depth)');
ok(picker.querySelector('[data-cover="depth"]')?.getAttribute('aria-checked') === 'true',
  'aria-checked=true у выбранного');
const pickerIds = [...picker.querySelectorAll('svg [id]')].map((n) => n.id);
ok(pickerIds.length > 0 && new Set(pickerIds).size === pickerIds.length,
  `id внутри пикера не пересекаются (${pickerIds.length} шт.)`);

console.log('\n4) Выбор стиля: подсветка + мгновенное превью + автосохранение:');
click(picker.querySelector('[data-cover="wave"]'));
await tick(150);
const picker2 = document.querySelector('#ed-cover-picker');
ok(picker2.querySelector('[data-cover="wave"]').classList.contains('selected'), '«Волна» подсвечена');
ok(!picker2.querySelector('[data-cover="depth"]').classList.contains('selected'), 'старый выбор снят');
ok(picker2.querySelector('[data-cover="wave"]').getAttribute('aria-checked') === 'true', 'aria-checked переехал');
ok(coverFingerprint() === 'wave', 'обложка под модалкой сразу стала wave: ' + coverFingerprint());
const autoSaved = await sb.fetchProfile('u-anna');
ok(autoSaved.cover_style === 'wave', 'автосохранение: cover_style=wave уже в демо-БД (модалка открыта): ' + autoSaved.cover_style);
ok(document.querySelector('#ed-autosave')?.textContent.includes('Сохранено'), 'статус показывает «Сохранено ✓»');

console.log('\n5) «Готово» закрывает модалку, обложка остаётся:');
click(document.querySelector('#ed-done'));
await tick(200);
ok(!document.querySelector('#ed-cover-picker'), 'модалка закрылась');
const saved = await sb.fetchProfile('u-anna');
ok(saved.cover_style === 'wave', 'в демо-БД сохранено cover_style=wave: ' + saved.cover_style);
ok(coverFingerprint() === 'wave', 'обложка после перерисовки профиля: ' + coverFingerprint());

console.log('\n6) Повторное открытие модалки — текущий стиль подсвечен:');
click(app.querySelector('#btn-edit-profile'));
await tick();
const picker3 = document.querySelector('#ed-cover-picker');
ok(picker3.querySelector('[data-cover="wave"]')?.classList.contains('selected'), 'выбрана «Волна»');
ok(picker3.querySelector('[data-cover="wave"]')?.getAttribute('aria-checked') === 'true', 'aria-checked=true');

console.log('\n7) Автосохранение: выбор фиксируется сразу и остаётся после закрытия (✕):');
click(picker3.querySelector('[data-cover="studio"]'));
await tick(150);
ok(coverFingerprint() === 'studio', 'превью показало studio');
const savedStudio = await sb.fetchProfile('u-anna');
ok(savedStudio.cover_style === 'studio', 'сохранено в профиль без всякой кнопки: ' + savedStudio.cover_style);
click(document.querySelector('#modal-root .modal-close'));
await tick(200);
ok(!document.querySelector('#ed-cover-picker'), 'модалка закрыта');
ok(coverFingerprint() === 'studio', 'отката нет — studio остаётся: ' + coverFingerprint());

console.log('\n8) Устаревшее/пустое значение cover_style не роняет профиль:');
await sb.updateProfile({ cover_style: null });
await renderProfile(app, { userId: 'u-anna' }, { editable: true });
await tick();
ok(coverFingerprint() === DEFAULT_COVER_STYLE,
  'null → дефолт ' + DEFAULT_COVER_STYLE + ': ' + coverFingerprint());
click(app.querySelector('#btn-edit-profile'));
await tick();
ok(document.querySelector('#ed-cover-picker')?.querySelector('[data-cover="depth"]')?.classList.contains('selected'),
  'пикер при null показывает дефолт');
click(document.querySelector('#modal-root .modal-close'));
await tick(60);

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);