// test_tag_subscribe.mjs — заход B: кликабельные #теги (подписка на тег).
// Секции:
//  0) tagSubChipHtml: разметка чипа (button.tag.tag-sub, data-sub-tag,
//     data-help, aria-pressed, ✓ у подписанного, пустое имя → '');
//  1) лента: тег синтезатора — чип-кнопка; клик → подписка (БД + store +
//     чип ✓), карточка НЕ раскрывается (stopPropagation); повторный клик —
//     отписка;
//  2) #теги ответов (раскрытие ленты): чипы, кросс-синхронизация одного тега
//     на нескольких чипах (синтезатор вопроса + тег ответа);
//  3) аноним: клик → модалка входа, подписка не создаётся;
//  4) режим справки (body.help-active): клик чипом не обрабатывается
//     (клики принадлежат help.mjs);
//  5) сайдбар-блок «Подписки»: подписка из другого места экрана
//     перерисовывает блок; ✕ в блоке синхронизирует кэш store;
//  6) генератор уведомлений: новый вопрос с тегом (synth) →
//     new_question_tag подписчику, автору самому — нет, вопрос без synth — нет.
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

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { getState, setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const subs = await import('../public/js/subscriptions.mjs');
const { renderFeed } = await import('../public/js/feed.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 80) => new Promise((r) => realSetTimeout(r, ms));
const hasTagSub = async (tag, userId = null) => {
  const saved = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  return (saved?.subscriptions || []).some((s) => s.target_type === 'tag' && s.target_id === tag && (userId == null || s.user_id === userId));
};

// Общий обработчик кликов по чипам — как в main.mjs при старте приложения
subs.initTagSubscriptions();
subs.initTagSubscriptions(); // повторный вызов не вешает второй слушатель
setState({ user: { id: 'u-demo', username: 'DemoUser' } });

// ---------- 0) Разметка чипа ----------
console.log('0) tagSubChipHtml: разметка и состояние из кэша:');
{
  const html = subs.tagSubChipHtml('Serum');
  const box = document.createElement('div');
  box.innerHTML = html;
  const chip = box.querySelector('[data-sub-tag="Serum"]');
  ok(!!chip && chip.tagName === 'BUTTON' && chip.classList.contains('tag') && chip.classList.contains('tag-sub'), 'чип — button.tag.tag-sub');
  ok(chip?.dataset.help === 'tag_subscribe', 'data-help="tag_subscribe" (конвенция справки)');
  ok(chip?.getAttribute('aria-pressed') === 'false' && !chip.classList.contains('subbed'), 'не подписан: aria-pressed=false, без ✓');
  ok(chip?.textContent === '#Serum', 'текст чипа — #Serum');
  ok(chip?.title === t('common.tag_subscribe'), 'title — «Подписаться на тег»');
  ok(subs.tagSubChipHtml('') === '' && subs.tagSubChipHtml('   ') === '', 'пустое имя — чипа нет');
  // подписан (кэш store)
  setState({ subscriptions: [{ target_type: 'tag', target_id: 'Serum', user_id: 'u-demo' }] });
  const chip2box = document.createElement('div');
  chip2box.innerHTML = subs.tagSubChipHtml('Serum');
  const chip2 = chip2box.querySelector('[data-sub-tag="Serum"]');
  ok(chip2?.getAttribute('aria-pressed') === 'true' && chip2.classList.contains('subbed') && chip2.textContent === '✓ #Serum', 'подписан: .subbed, aria-pressed=true, «✓ #Serum»');
  setState({ subscriptions: [] });
  box.remove(); chip2box.remove();
}

// ---------- 1) Лента: клик по тегу синтезатора ----------
console.log('\n1) Лента: тег синтезатора — подписка, карточка не раскрывается:');
const box1 = document.createElement('div');
document.body.appendChild(box1);
let cleanup1 = await renderFeed(box1);
await tick(250); // предзагрузка ответов + refreshTagSubsCache
{
  const card = box1.querySelector('[data-qid="q1"]');
  const chip = card?.querySelector('[data-sub-tag="Serum"]');
  ok(!!chip && chip.tagName === 'BUTTON', 'тег синтезатора q1 (Serum) — чип-кнопка');
  ok(!!box1.querySelector('[data-qid="q2"] [data-sub-tag="Phase Plant"]') && !!box1.querySelector('[data-qid="q4"] [data-sub-tag="Vital"]'), 'чипы q2 (Phase Plant) и q4 (Vital) на месте');
  ok(!box1.querySelector('[data-qid="q3"] [data-sub-tag]'), 'у вопроса без synth (q3) чипа нет');

  chip.click();
  await tick(120);
  ok(await hasTagSub('Serum', 'u-demo'), 'клик → подписка на #Serum в демо-БД');
  ok(chip.classList.contains('subbed') && chip.getAttribute('aria-pressed') === 'true' && chip.textContent === '✓ #Serum', 'чип перерисован: ✓ #Serum');
  ok(getState().subscriptions.some((s) => s.target_type === 'tag' && s.target_id === 'Serum'), 'кэш store.subscriptions обновлён');
  ok(!card.classList.contains('expanded') && card.querySelector('.q-card-expand').hidden, 'stopPropagation: карточка НЕ раскрылась');

  chip.click();
  await tick(120);
  ok(!(await hasTagSub('Serum', 'u-demo')), 'повторный клик → отписка');
  ok(!chip.classList.contains('subbed') && chip.textContent === '#Serum', 'чип вернулся в обычное состояние');

  chip.click(); // оставляем Serum подписанным для секции 2
  await tick(120);
  ok(await hasTagSub('Serum', 'u-demo'), '#Serum снова подписан');
}

// ---------- 2) #теги ответов + кросс-синхронизация ----------
console.log('\n2) Раскрытая карточка: #теги ответов, один тег на двух чипах:');
{
  const card = box1.querySelector('[data-qid="q1"]');
  card.querySelector('.q-card-desc').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await tick(300);
  ok(card.classList.contains('expanded'), 'клик по описанию раскрывает ответы (обычное поведение карточки)');
  const answerChips = [...card.querySelectorAll('.q-card-expand [data-sub-tag]')].map((c) => c.dataset.subTag);
  ok(answerChips.includes('DnB') && answerChips.includes('Growl') && answerChips.includes('Serum'), '#теги ответа a1 (DnB, Growl, Serum) — чипы');
  ok(answerChips.includes('OTT') && answerChips.includes('Mixing'), '#теги ответа a2 (OTT, Mixing) — чипы');
  const serumAnswerChip = card.querySelector('.q-card-expand [data-sub-tag="Serum"]');
  ok(serumAnswerChip?.classList.contains('subbed') && serumAnswerChip?.textContent === '✓ #Serum', 'тот же тег Serum в ответе сразу с ✓ (кэш store)');

  // клик по чипу ответа — отписка ОБИХ чипов Serum снимается ✓
  serumAnswerChip.click();
  await tick(150);
  ok(!(await hasTagSub('Serum', 'u-demo')), 'клик по ✓-чипу ответа → отписка от #Serum');
  const feedChip = card.querySelector('.q-card-meta [data-sub-tag="Serum"]');
  ok(!serumAnswerChip.classList.contains('subbed') && !feedChip.classList.contains('subbed'), 'оба чипа Serum (ответ + карточка) синхронно погасли');
  ok(card.classList.contains('expanded'), 'клик по тегу ответа не свернул карточку');

  const growl = card.querySelector('.q-card-expand [data-sub-tag="Growl"]');
  growl.click();
  await tick(150);
  ok(await hasTagSub('Growl', 'u-demo') && growl.classList.contains('subbed'), 'подписка на #Growl из карточки ответа');
}
cleanup1?.();
box1.remove(); // дубли id (#feed-list) ломают querySelector следующих секций в jsdom

// ---------- 3) Аноним: модалка входа ----------
console.log('\n3) Аноним: клик по чипу → модалка входа, подписки нет:');
const box3 = document.createElement('div');
document.body.appendChild(box3);
setState({ user: null });
let cleanup3 = await renderFeed(box3);
await tick(250);
{
  const chip = box3.querySelector('[data-qid="q4"] [data-sub-tag="Vital"]');
  ok(!!chip && !chip.classList.contains('subbed'), 'анониму чипы видны (не подписан)');
  chip.click();
  await tick(150);
  ok(!!document.querySelector('#modal-root .modal-overlay'), 'клик открыл модалку входа (requireAuth)');
  ok(!(await hasTagSub('Vital')), 'подписка НЕ создана');
  document.querySelector('#modal-root .modal-overlay')?.remove();
}
cleanup3?.();
box3.remove();

// ---------- 4) Режим справки: чипы не действуют ----------
console.log('\n4) Режим справки (body.help-active): клик не подписывает:');
const box4 = document.createElement('div');
document.body.appendChild(box4);
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
let cleanup4 = await renderFeed(box4);
await tick(250);
{
  const chip = box4.querySelector('[data-qid="q4"] [data-sub-tag="Vital"]');
  document.body.classList.add('help-active');
  chip.click();
  await tick(150);
  ok(!(await hasTagSub('Vital')), 'в режиме справки подписка не создаётся (клики у help.mjs)');
  document.body.classList.remove('help-active');
  chip.click();
  await tick(150);
  ok(await hasTagSub('Vital'), 'после выхода из режима справки клик снова работает');
}
cleanup4?.();
box4.remove();

// ---------- 5) Сайдбар-блок «Подписки» ----------
console.log('\n5) Сайдбар-блок «Подписки»: живая перерисовка и синхронизация кэша:');
const box5 = document.createElement('div');
document.body.appendChild(box5);
await subs.renderSubscriptionsBlock(box5);
await tick(120);
{
  ok(box5.textContent.includes('#Growl') && box5.textContent.includes('#Vital'), 'подписанные теги (Growl, Vital) в блоке');
  ok(box5.textContent.includes('@AnnaSynth'), 'подписка на автора (сид u-demo → u-anna) в блоке');

  await subs.toggleTagSubscription('Phase Plant'); // «с другого экрана»
  await tick(120);
  ok(box5.textContent.includes('#Phase Plant'), 'toggleTagSubscription перерисовала блок на месте');

  box5.querySelector('[data-unsub-tag="Phase Plant"]').click();
  await tick(150);
  ok(!box5.textContent.includes('#Phase Plant') && box5.textContent.includes('#Growl'), '✕ в блоке отписал только Phase Plant');
  ok(!getState().subscriptions.some((s) => s.target_type === 'tag' && s.target_id === 'Phase Plant'), 'кэш store после отписки в блоке свежий');
}
box5.remove(); // subsBlockHost.isConnected гаснет — блок больше не перерисовывается

// ---------- 6) Генератор уведомлений new_question_tag ----------
console.log('\n6) Новый вопрос с тегом → уведомление подписчику:');
{
  // u-anna подписывается на тег 'Pluck'
  setState({ user: { id: 'u-anna', username: 'AnnaSynth' }, subscriptions: [] });
  await subs.toggleTagSubscription('Pluck');
  await tick(80);
  ok(await hasTagSub('Pluck', 'u-anna'), 'u-anna подписана на #Pluck');

  // u-demo создаёт вопрос с synth 'Pluck'
  setState({ user: { id: 'u-demo', username: 'DemoUser' } });
  const created = await sb.createQuestion({ title: 'Щипковый дроп как у Flume — с чего начать?', description: 'тест генератора', synth: 'Pluck', category: 'synth' });
  ok(!!created?.id, 'вопрос создан');

  setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
  const annaNotifs = await sb.fetchNotifications();
  const tagNotif = annaNotifs.find((n) => n.type === 'new_question_tag' && n.payload?.questionId === created.id);
  ok(!!tagNotif, 'u-anna получила уведомление new_question_tag');
  ok(tagNotif?.payload?.tag === 'Pluck' && tagNotif?.payload?.questionTitle === created.title, 'payload: тег + заголовок вопроса');
  ok(tagNotif?.read === false, 'уведомление непрочитанное');

  setState({ user: { id: 'u-demo', username: 'DemoUser' } });
  const demoNotifs = await sb.fetchNotifications();
  ok(!demoNotifs.some((n) => n.type === 'new_question_tag' && n.payload?.questionId === created.id), 'автору вопроса уведомление о собственном теге не приходит');

  // вопрос без synth → никаких уведомлений
  setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
  const annaBefore = (await sb.fetchNotifications()).filter((n) => n.type === 'new_question_tag').length;
  setState({ user: { id: 'u-demo', username: 'DemoUser' } });
  await sb.createQuestion({ title: 'Вопрос без синтезатора', description: '', synth: '', category: null });
  setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
  const annaAfter = (await sb.fetchNotifications()).filter((n) => n.type === 'new_question_tag').length;
  ok(annaAfter === annaBefore, 'вопрос без synth уведомлений не порождает');

  const stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  ok((stored.notifications || []).some((n) => n.type === 'new_question_tag'), 'уведомление персистится в снапшоте демо-БД');
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
