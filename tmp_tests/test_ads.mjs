// Рекламные слоты (ads.mjs, Яндекс РСЯ) — инфраструктура за флагом ENABLE_ADS:
//  (0) дефолты конфига: флаг выключен, слоты ленты/сайдбара описаны;
//  (1) режим 'off': разметка пустая, в DOM ноль следов, mountAd безопасен;
//  (2) режим 'placeholder' (демо/нет ID): заглушка с подписью «Реклама»,
//      реальный лоадер НЕ инжектится, cleanup снимает слот;
//  (3) shouldPlaceFeedAd: плотность every (каждая 6-я карточка, настраивается);
//  (4) режим 'live' (debugForceLive + ID): лоадер один раз, очередь yaContextCb,
//      render({blockId, renderTo(уникальный), darkTheme, statId}), onRender →
//      .ad-filled, onError → слот снят, guard при отсутствии показа → снят,
//      cleanup: once-слот зовёт destroy({blockId}), повторяющийся — нет;
//  (5) слот отключился от DOM до flush очереди → render не вызывается.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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
const { CONFIG, IS_DEMO } = await import('../public/js/config.mjs');
const { adsMode, initAds, shouldPlaceFeedAd, adSlotHtml, mountAd } = await import('../public/js/ads.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = document.createElement('div');
document.body.appendChild(host);
const headScripts = () => [...document.head.querySelectorAll('script')];

console.log('0) Дефолты конфига:');
ok(IS_DEMO === true, 'тесты идут в демо-режиме (IS_DEMO = true)');
ok(CONFIG.ENABLE_ADS === false, 'ENABLE_ADS по умолчанию выключен');
ok(!!CONFIG.ADS?.blocks?.feed_inline && !!CONFIG.ADS?.blocks?.question_sidebar, 'слоты feed_inline и question_sidebar описаны');
ok(CONFIG.ADS.blocks.feed_inline.every === 6, 'плотность ленты: каждая 6-я карточка');
ok(CONFIG.ADS.darkTheme === true, 'тёмная тема блоков включена (под тему сайта)');

console.log('\n1) Режим off (флаг выключен):');
ok(adsMode('feed_inline') === 'off', "adsMode('feed_inline') = 'off'");
ok(adSlotHtml('feed_inline') === '', 'adSlotHtml → пустая строка (в DOM ноль следов)');
ok([0, 4, 5, 11, 100].every((i) => shouldPlaceFeedAd(i) === false), 'shouldPlaceFeedAd → false на всех индексах');
ok(typeof mountAd(null, 'feed_inline') === 'function', 'mountAd(null) безопасен, возвращает noop');
initAds(); // no-op при выключенном флаге
ok(headScripts().length === 0, 'initAds() при off не инжектит лоадер');

console.log('\n2) Режим placeholder (флаг включён, демо/нет ID):');
CONFIG.ENABLE_ADS = true;
ok(adsMode('feed_inline') === 'placeholder', "adsMode = 'placeholder'");
const slotHtml = adSlotHtml('question_sidebar');
ok(slotHtml.includes('class="ad-slot"') && slotHtml.includes('data-ad-mode="placeholder"'), 'разметка слота с data-ad-mode');
ok(slotHtml.includes('Реклама'), 'подпись «Реклама» (ads.label) в разметке');
host.innerHTML = slotHtml;
const phSlot = host.querySelector('.ad-slot');
const phCleanup = mountAd(phSlot, 'question_sidebar');
ok(phSlot.classList.contains('ad-placeholder'), 'слот помечен .ad-placeholder');
ok(phSlot.querySelector('.ad-container').textContent === 'Рекламный слот', 'текст заглушки = ads.placeholder');
ok(headScripts().length === 0, 'лоадер Яндекса НЕ инжектится в демо');
phCleanup();
ok(!phSlot.isConnected, 'cleanup снимает слот из DOM');
initAds();
ok(headScripts().length === 0, 'initAds() в демо тоже не инжектит лоадер (нет live-блоков)');
// примечание: injectLoader вызывается только из mountAd в live-режиме

console.log('\n3) shouldPlaceFeedAd — плотность:');
ok([5, 11, 17].every((i) => shouldPlaceFeedAd(i)) , 'every=6: после карточек 6, 12, 18 (индексы 5, 11, 17)');
ok([0, 1, 2, 3, 4, 6, 7, 8, 9, 10].every((i) => !shouldPlaceFeedAd(i)), 'every=6: остальные индексы — без слота');
CONFIG.ADS.blocks.feed_inline.every = 4;
ok(shouldPlaceFeedAd(3) && shouldPlaceFeedAd(7) && !shouldPlaceFeedAd(4), 'every=4 учитывается динамически');
CONFIG.ADS.blocks.feed_inline.every = 6;

console.log('\n4) Режим live (debugForceLive + ID блоков):');
CONFIG.ADS.debugForceLive = true;
CONFIG.ADS.blocks.feed_inline.id = 'R-A-100000-1';
CONFIG.ADS.blocks.question_sidebar.id = 'R-A-100000-2';
ok(adsMode('feed_inline') === 'live', "adsMode = 'live'");
initAds();
ok(headScripts().length === 1 && headScripts()[0].src.includes('yastatic.net'), 'лоадер Яндекса инжектится один раз');
initAds();
ok(headScripts().length === 1, 'повторный initAds() не дублирует скрипт');

// Фейковый Ya + очередь
const rendered = [];
const destroyed = [];
const fakeYa = {
  Context: {
    AdvManager: {
      render(opts) { rendered.push(opts); },
      destroy(o) { destroyed.push(o); },
    },
  },
};
dom.window.Ya = fakeYa;
globalThis.Ya = fakeYa;
dom.window.yaContextCb = [];

// 4a) два слота ленты: уникальные renderTo, очередь копится до flush
host.innerHTML = adSlotHtml('feed_inline') + adSlotHtml('feed_inline');
const feedSlots = [...host.querySelectorAll('.ad-slot')];
const feedCleanups = feedSlots.map((el) => mountAd(el, 'feed_inline'));
ok(dom.window.yaContextCb.length === 2, 'два render-вызова в очереди yaContextCb');
ok(headScripts().length === 1, 'лоадер по-прежнему один (mountAd не дублирует)');
const rt1 = host.querySelector('#' + feedSlots[0].querySelector('.ad-container').id);
ok(!!rt1, 'контейнер получил id = renderTo');
dom.window.yaContextCb.splice(0).forEach((fn) => fn()); // «лоадер готов»
ok(rendered.length === 2, 'flush очереди → 2 вызова AdvManager.render');
ok(rendered[0].blockId === 'R-A-100000-1' && rendered[1].blockId === 'R-A-100000-1', 'blockId слота ленты');
ok(rendered[0].renderTo !== rendered[1].renderTo, 'renderTo уникальны (один blockId дважды на странице)');
ok(rendered[0].darkTheme === true && rendered[0].statId === 1, 'darkTheme:true + statId:1 (срез ленты)');

// 4b) onRender → .ad-filled
rendered[0].onRender();
ok(feedSlots[0].classList.contains('ad-filled'), 'onRender → слот помечен .ad-filled');

// 4c) onError → слот снят
rendered[1].onError();
ok(!feedSlots[1].isConnected, 'onError → пустой слот удалён из DOM');

// 4d) cleanup ленты: destroy НЕ зовётся (блок повторяющийся), слот снят
const destroyedBefore = destroyed.length;
feedCleanups[0]();
ok(!feedSlots[0].isConnected, 'cleanup снял слот ленты');
ok(destroyed.length === destroyedBefore, 'destroy не вызван для повторяющегося блока (не убиваем соседей)');

// 4e) guard: показ не случился → слот снимается по таймауту
CONFIG.ADS.emptyGuardMs = 40;
host.innerHTML = adSlotHtml('feed_inline');
const guardSlot = host.querySelector('.ad-slot');
const guardCleanup = mountAd(guardSlot, 'feed_inline');
await sleep(90);
ok(!guardSlot.isConnected, 'guard (emptyGuardMs): нет показа — слот снят, дыры в ленте нет');
guardCleanup(); // идемпотентно

// 4f) once-слот (сайдбар): cleanup зовёт destroy({blockId})
host.innerHTML = adSlotHtml('question_sidebar');
const sideSlot = host.querySelector('.ad-slot');
const sideCleanup = mountAd(sideSlot, 'question_sidebar');
dom.window.yaContextCb.splice(0).forEach((fn) => fn());
const sideRender = rendered[rendered.length - 1];
ok(sideRender.statId === 2 && sideRender.renderTo.includes('R-A-100000-2'), 'сайдбар: свой statId и renderTo от своего blockId');
sideRender.onRender();
sideCleanup();
ok(destroyed.length === destroyedBefore + 1 && destroyed[destroyed.length - 1].blockId === 'R-A-100000-2',
  'cleanup once-слота → AdvManager.destroy({blockId})');

console.log('\n5) Слот отключили до flush очереди — render не вызывается:');
{
  const before = rendered.length;
  host.innerHTML = adSlotHtml('feed_inline');
  const s = host.querySelector('.ad-slot');
  const c = mountAd(s, 'feed_inline');
  c(); // экран «сменился» до готовности лоадера
  dom.window.yaContextCb.splice(0).forEach((fn) => fn());
  ok(rendered.length === before, 'render не вызван для отключённого слота');
}

console.log('\n6) Интеграция с лентой (демо: плейсхолдеры между карточками):');
{
  // Конфиг для демо-ленты: флаг включён, live выключен, плотность 2 (видно на 5 карточках)
  CONFIG.ENABLE_ADS = true;
  CONFIG.ADS.debugForceLive = false;
  CONFIG.ADS.blocks.feed_inline.id = '';
  CONFIG.ADS.blocks.question_sidebar.id = '';
  CONFIG.ADS.blocks.feed_inline.every = 2;

  const { setState } = await import('../public/js/store.mjs');
  const { renderFeed } = await import('../public/js/feed.mjs');
  setState({ user: { id: 'u-demo', username: 'DemoUser' } });
  const app = document.createElement('div');
  document.body.appendChild(app);
  const feedCleanup = await renderFeed(app);
  await sleep(60);

  const cards = app.querySelectorAll('#feed-list .q-card');
  const slots = app.querySelectorAll('#feed-list .ad-slot');
  ok(cards.length >= 4, `карточки отрисованы: ${cards.length}`);
  ok(slots.length === Math.floor(cards.length / 2), `слотов: ${slots.length} = каждые 2 карточки`);
  ok([...slots].every((s) => s.classList.contains('ad-placeholder') && s.querySelector('.ad-container').textContent === 'Рекламный слот'),
    'все слоты — плейсхолдеры (демо, внешний код не грузится)');
  // Позиция: слоты стоят МЕЖДУ карточками (после 2-й и 4-й)
  const kids = [...app.querySelector('#feed-list').children];
  const slotPos = kids.map((el, i) => (el.classList.contains('ad-slot') ? i : -1)).filter((i) => i >= 0);
  ok(slotPos.every((pos, n) => pos === (n + 1) * 2 + n), `позиции слотов: ${slotPos.join(',')} (после каждой 2-й карточки)`);
  // Проводка карточек не сломана вставками (поиск по data-qid вместо индекса)
  ok(app.querySelectorAll('#feed-list .q-card[data-qid]').length === cards.length, 'у всех карточек data-qid');
  ok(app.querySelectorAll('#feed-list .mini-wave').length > 0, 'мини-плееры attached (вейвформы на месте)');
  ok(typeof feedCleanup === 'function', 'renderFeed возвращает cleanup (роутер снимет слоты при уходе)');
  feedCleanup();
  ok(app.querySelectorAll('#feed-list .ad-slot').length === 0, 'cleanup снял все слоты');

  // Перерисовка (смена сортировки) не копит дубли слотов
  await renderFeed(app);
  await sleep(60);
  app.querySelector('.sort-tab[data-sort="popular"]')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  const slots2 = app.querySelectorAll('#feed-list .ad-slot');
  ok(slots2.length === Math.floor(app.querySelectorAll('#feed-list .q-card').length / 2),
    `после смены сортировки слоты пересозданы без дублей: ${slots2.length}`);

  CONFIG.ADS.blocks.feed_inline.every = 6;
}

// возврат конфигов (другие тесты процесса не зависят, но держим чистоту)
CONFIG.ENABLE_ADS = false;
CONFIG.ADS.debugForceLive = false;
CONFIG.ADS.blocks.feed_inline.id = '';
CONFIG.ADS.blocks.question_sidebar.id = '';

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
