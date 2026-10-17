// test_ideas.mjs — «💡 Идеи продукта» (заход 38, спека PLAN_IDEAS.md):
//  0) сиды v15 и сортировки топ/новые;
//  1) витрина открыта анониму; «Предложить» и голос зовут вход;
//  2) модалка: инлайн-валидации 3–120 / 10–1000, создание идеи;
//  3) голос toggle + единственность + влияние на «Топ»;
//  4) админ: статус → уведомление автору (посторонним нет), ответ → уведомление,
//     очистка ответа;
//  5) удаления: автор свою, админ любую, чужую — отказ;
//  6) fetchDevContact = админ (кнопка ЛС);
//  7) экран /ideas: блок связи с разработчиком, админ-контролы, сортировки;
//  8) пересид v14→v15 переносит пользовательскую идею и голоса (урок захода 20).
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

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState, getState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const ideas = await import('../public/js/ideas.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const DB_KEY = 'samplehelp_demo_db';
const readDb = () => JSON.parse(localStorage.getItem(DB_KEY));
const writeDb = (o) => localStorage.setItem(DB_KEY, JSON.stringify(o));

console.log('0) сиды v15 и сортировки:');
ok(sb.DEMO_DB_VERSION === 16, `DEMO_DB_VERSION = ${sb.DEMO_DB_VERSION}`);
let top = await sb.fetchIdeas('top');
ok(top.length === 4, `сиды: 4 идеи (${top.length})`);
ok(top[0].id === 'i3' && top[0].votes === 3, `топ: первая — i3 с 3 голосами (${top[0].id}/${top[0].votes})`);
ok(top[1].id === 'i1' && top[1].votes === 2, 'топ: вторая — i1 с 2 голосами');
const fresh = await sb.fetchIdeas('new');
ok(fresh[0].id === 'i1' && fresh[1].id === 'i2', 'новые: порядок по created_at');
ok(top.every((i) => i.author?.username), 'у каждой идеи есть автор');

console.log('\n1) витрина открыта анониму, действия зовут вход:');
setState({ user: null });
const app = document.getElementById('app');
await ideas.renderIdeas(app);
await tick();
ok(app.querySelectorAll('.idea-card').length === 4, 'аноним видит список идей');
ok(!!app.querySelector('#idea-dev-dm'), 'блок связи с разработчиком отрисован');
click(app.querySelector('#idea-suggest'));
await tick();
ok(!!document.querySelector('#modal-root .modal'), 'анониму «Предложить» → модалка входа');
document.querySelectorAll('#modal-root .modal-overlay').forEach((o) => o.remove());

console.log('\n2) модалка предложения: валидации и создание:');
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
ideas.openIdeaModal();
await tick();
let modal = document.querySelector('#modal-root .modal');
modal.querySelector('#idea-title').value = 'аб';
modal.querySelector('#idea-body').value = 'коротко';
click(modal.querySelector('#idea-send'));
await tick();
ok(!modal.querySelector('#idea-title-err').hidden && !modal.querySelector('#idea-body-err').hidden, 'инлайн-ошибки на коротких полях');
ok((await sb.fetchIdeas('new')).length === 4, 'невалидная идея не создана');
modal.querySelector('#idea-title').value = 'Экспорт демо-базы в файл';
modal.querySelector('#idea-body').value = 'Хочу выгружать свои демо-вопросы и ответы в файл и переносить между браузерами.';
click(modal.querySelector('#idea-send'));
await tick(120);
const created = (await sb.fetchIdeas('new')).find((i) => i.title === 'Экспорт демо-базы в файл');
ok(!!created && created.author_id === 'u-demo', 'валидная идея создана от u-demo');
ok(!document.querySelector('#modal-root .modal'), 'модалка закрылась после отправки');

console.log('\n3) голос toggle + единственность:');
setState({ user: { id: 'u-lena', username: 'LenaFX' } });
let cnt = await sb.toggleIdeaVote('i1');
ok(cnt === 1, `u-lena уже голосовала в сидах: toggle СНЯЛ голос → 1 (${cnt})`);
cnt = await sb.toggleIdeaVote('i1');
ok(cnt === 2, 'повторный toggle вернул голос: 2');
const mine = await sb.fetchIdeaVotesMine();
ok(mine.has('i1'), 'fetchIdeaVotesMine: голос u-lena на месте');

console.log('\n4) админ: статус и ответ → уведомления автору:');
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
ok(await sb.setIdeaStatus('i1', 'in_work'), 'статус i1 → in_work');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
let myN = await sb.fetchNotifications();
let nn = myN.find((x) => x.type === 'idea_status');
ok(!!nn && nn.payload?.status === 'in_work' && nn.payload?.ideaTitle === 'Паритет чипов подписки во всех списках', 'автор (u-max) получил idea_status in_work');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
ok(!(await sb.fetchNotifications()).some((x) => x.type === 'idea_status'), 'посторонняя u-anna уведомления не получила');
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
ok(await sb.setIdeaReply('i1', 'Согласен, чипы нужны везде — беру в работу.'), 'ответ разработчика сохранён');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
nn = (await sb.fetchNotifications()).find((x) => x.type === 'idea_reply');
ok(!!nn && nn.payload?.ideaTitle === 'Паритет чипов подписки во всех списках', 'автор получил idea_reply');
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
ok(await sb.setIdeaReply('i1', ''), 'очистка ответа (пустой текст)');
const i1after = (await sb.fetchIdeas('top')).find((i) => i.id === 'i1');
ok(i1after.dev_reply === '' && i1after.dev_reply_at === null, 'ответ очищен полностью');

console.log('\n5) удаления: автор / админ / чужая:');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
ok(await sb.deleteIdea('i4'), 'автор (u-max) удалил свою i4');
let threw = false;
try { await sb.deleteIdea('i2'); } catch { threw = true; }
ok(threw, 'чужую идею (i2, автор u-anna) u-max удалить не может');
setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
ok(await sb.deleteIdea('i2'), 'админ удалил чужую i2');
ok(!(await sb.fetchIdeas('top')).some((i) => i.id === 'i2'), 'i2 исчезла из списка');

console.log('\n6) контакт разработчика:');
const dev = await sb.fetchDevContact();
ok(dev?.id === 'u-demo', `fetchDevContact = админ (${dev?.id})`);

console.log('\n7) экран /ideas глазами админа:');
await ideas.renderIdeas(app);
await tick();
ok(!!app.querySelector('.idea-admin[data-help="idea_admin"]'), 'админ-контролы с data-help="idea_admin"');
ok(app.querySelectorAll('.idea-admin [data-act="status"]').length >= 2, 'кнопки смены статуса на карточке');
ok(!!app.querySelector('#idea-dev-dm[data-help="idea_dev_dm"]'), 'кнопка ЛС с разработчиком + data-help');
click(app.querySelector('.sort-tab[data-sort="new"]'));
await tick();
ok(app.querySelector('.sort-tab[data-sort="new"]').classList.contains('active'), 'сортировка «Новые» переключилась');

console.log('\n8) пересид v14→v15: пользовательская идея и голоса переживают:');
{
  const snap = readDb();
  snap.ideas.push({ id: 'iX', author_id: 'u-anna', title: 'Идея из старого снапшота', body: 'Проверяю перенос пользовательских идей через пересид демо-базы.', status: 'new', dev_reply: '', dev_reply_at: null, created_at: new Date().toISOString() });
  snap.idea_votes.push({ idea_id: 'iX', user_id: 'u-max', created_at: new Date().toISOString() });
  snap.v = 14;
  writeDb(snap);
  const S2 = await import('../public/js/supabase.mjs?v15');
  const carried = await S2.fetchIdeas('top');
  const x = carried.find((i) => i.id === 'iX');
  ok(!!x, 'пользовательская идея iX перенесена через пересид');
  ok(x?.votes === 1, 'голос за перенесённую идею тоже перенесён');
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
