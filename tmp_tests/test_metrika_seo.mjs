// Яндекс.Метрика (metrika.mjs) + статическое SEO (OG/robots/sitemap/og-cover):
//  0) флаг выключен → metrikaActive() = false, initMetrika() — строгий no-op
//     (ни скрипта tag.js, ни window.ym);
//  1) демо с заполненным counterId → всё равно не грузится; debugForce включает;
//  2) live: tag.js один раз, ym-очередь получила init(counterId, {…webvisor:false}),
//     повторный initMetrika() не дублирует скрипт;
//  3) SPA-хиты: первый hit при инициализации; повторная смена роута на тот же
//     URL — без дубля; pushState на новый URL + смена роута → новый hit;
//  4) статика: index.html содержит OG/twitter/canonical c placeholder-доменом;
//     robots.txt закрывает служебные разделы и ссылается на sitemap;
//     sitemap.xml валиден по структуре; og-cover.png — PNG 1200×630.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { CONFIG, IS_DEMO } = await import('../public/js/config.mjs');
const { setState } = await import('../public/js/store.mjs');
const { metrikaActive, metrikaHit, initMetrika } = await import('../public/js/metrika.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tagScripts = () => [...document.head.querySelectorAll('script')].filter((s) => s.src.includes('mc.yandex.ru'));
const ymQueue = () => (window.ym?.a || []);
const ymCalls = () => ymQueue().map((args) => [...args]);

console.log('0) Флаг выключен — строгий no-op:');
ok(CONFIG.ENABLE_METRIKA === false, 'ENABLE_METRIKA по умолчанию false');
ok(CONFIG.METRIKA.webvisor === false, 'webvisor по умолчанию ВЫКЛ (приватность: запись сессий — только осознанно)');
ok(metrikaActive() === false, 'metrikaActive() = false');
initMetrika();
ok(tagScripts().length === 0, 'tag.js не инжектится');
ok(typeof window.ym === 'undefined', 'window.ym не создаётся (ноль обращений к Яндексу)');
metrikaHit('http://localhost/question/1'); // без установки — тихо игнорируется
ok(typeof window.ym === 'undefined', 'metrikaHit без init — no-op');

console.log('\n1) Демо-режим не грузит счётчик даже с counterId:');
CONFIG.ENABLE_METRIKA = true;
CONFIG.METRIKA.counterId = '87654321';
ok(IS_DEMO === true && metrikaActive() === false, 'IS_DEMO → счётчик не грузится (статистика не засоряется)');
CONFIG.METRIKA.debugForce = true;
ok(metrikaActive() === true, 'debugForce + counterId → active (для тестов)');

console.log('\n2) Live: инициализация счётчика:');
initMetrika();
ok(tagScripts().length === 1 && tagScripts()[0].src === 'https://mc.yandex.ru/metrika/tag.js', 'tag.js инжектится один раз');
initMetrika();
ok(tagScripts().length === 1, 'повторный initMetrika() не дублирует скрипт');
const initCall = ymCalls().find((c) => c[1] === 'init');
ok(!!initCall && initCall[0] === '87654321', `ym(<counterId>, 'init', …): ${initCall?.[0]}`);
ok(initCall?.[2]?.webvisor === false && initCall?.[2]?.clickmap === true && initCall?.[2]?.trackLinks === true,
  'опции: clickmap/trackLinks/accurateTrackBounce вкл, webvisor выкл');

console.log('\n3) SPA-хиты (History API):');
let hits = ymCalls().filter((c) => c[1] === 'hit');
ok(hits.length === 1 && hits[0][2] === window.location.href, 'первый hit — текущий экран при инициализации');
setState({ route: { path: '/', params: {} } }); // перерисовка того же экрана
hits = ymCalls().filter((c) => c[1] === 'hit');
ok(hits.length === 1, 'смена роута на тот же URL — дубля нет');
history.pushState({}, '', '/question/q1');
setState({ route: { path: '/question/q1', params: { id: 'q1' } } });
hits = ymCalls().filter((c) => c[1] === 'hit');
ok(hits.length === 2 && hits[1][2].endsWith('/question/q1'), 'новый экран → новый hit: ' + hits[1]?.[2]);

console.log('\n4) Статическое SEO (файлы проекта):');
const html = fs.readFileSync('public/index.html', 'utf8');
ok(html.includes('property="og:title"') && html.includes('property="og:description"'), 'index.html: og:title + og:description');
ok(html.includes('property="og:type" content="website"') && html.includes('name="twitter:card" content="summary_large_image"'), 'og:type + twitter:card');
ok(html.includes('og:image" content="https://samplehelp.example/assets/og-cover.png"'), 'og:image → /assets/og-cover.png');
ok(html.includes('og:locale" content="ru_RU"'), 'og:locale ru_RU');
ok(!html.includes('og:locale:alternate'), 'alternate-локалей нет (ru-only заморозка)');
ok(html.includes('rel="canonical"'), 'canonical');
ok((html.match(/samplehelp\.example/g) || []).length >= 3, 'placeholder-домен помечен для замены на Этапе 4');
const robots = fs.readFileSync('public/robots.txt', 'utf8');
ok(robots.includes('User-agent: *') && robots.includes('Allow: /'), 'robots.txt: Allow /');
ok(['/ask', '/favorites', '/messages', '/moderation'].every((p) => robots.includes(`Disallow: ${p}`)), 'robots.txt: служебные разделы закрыты');
ok(robots.includes('Sitemap: https://samplehelp.example/sitemap.xml'), 'robots.txt: Sitemap');
const sitemap = fs.readFileSync('public/sitemap.xml', 'utf8');
ok(sitemap.includes('<urlset') && sitemap.includes('</urlset>') && sitemap.includes('<loc>'), 'sitemap.xml: структура urlset/loc');
// og-cover.png: PNG-сигнатура + IHDR 1200×630
const png = fs.readFileSync('public/assets/og-cover.png');
ok(png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47, 'og-cover.png: валидная PNG-сигнатура');
ok(png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, 'og-cover.png: 1200×630 (стандарт OG)');

// возврат конфигов
CONFIG.ENABLE_METRIKA = false;
CONFIG.METRIKA.counterId = '';
CONFIG.METRIKA.debugForce = false;

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
