// Жалобы и модерация (moderation.mjs + слой данных reports):
//  0) демо-БД v7: u-demo — админ, сиды жалоб (2 новых + 1 отклонённая);
//  1) модалка «⚑ Пожаловаться»: причины-чипы, пояснение, отправка → жалоба
//     создана; повторная жалоба на тот же объект → ошибка duplicate, модалка открыта;
//  2) слой данных: без входа — отказ; не-админ не видит жалобы; setReportStatus;
//     removeReportedContent удаляет контент (answers_count--) и закрывает жалобу
//     ('actioned'), цель пропадает (target: null);
//  3) экран /moderation: не-админа редиректит в ленту; админу — список с вкладками
//     «Новые/Все», чипы статусов, «контент удалён», «Отклонить» из UI;
//  4) кнопки жалобы на странице вопроса: сайдбар (не у автора), чип ⚑ у чужих
//     ответов и комментариев; клик открывает модалку;
//  5) жалоба на ПРОФИЛЬ (2026-10-11, причина «мошенничество/чужие реквизиты»):
//     кнопка ⚑ в шапке чужого профиля, 'fraud' причиной по умолчанию, защита от
//     жалобы на себя, target.kind='profile' с био/реквизитами для модератора,
//     «✓ Разобрано» вместо «Удалить контент» (профиль удалять нельзя).
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
const { setState, getState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { openReportModal, renderModeration } = await import('../public/js/moderation.mjs');
const { renderQuestion } = await import('../public/js/question.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const ADMIN = { id: 'u-demo', username: 'DemoUser', is_admin: true };

console.log('0) Демо-сиды и версия:');
ok(sb.DEMO_DB_VERSION === 16, `DEMO_DB_VERSION = ${sb.DEMO_DB_VERSION} (v13: гарантийное освежение сидов; контент переживает пересид)`);
setState({ user: ADMIN });
const seedReports = await sb.fetchReports('all');
ok(seedReports.length === 3, `в сидах 3 жалобы (новых: ${seedReports.filter((r) => r.status === 'new').length})`);
ok(seedReports.some((r) => r.status === 'dismissed'), 'есть отклонённая (для вкладки «Все»)');
const r1 = seedReports.find((r) => r.id === 'r1');
ok(r1.target?.kind === 'question' && r1.target.title.includes('riser'),
  'r1: цель-вопрос с заголовком: «' + (r1.target?.title || '').slice(0, 30) + '…»');
ok(r1.reporter?.username === 'MaxWavetable', 'r1: автор жалобы проброшен (MaxWavetable)');
const r2 = seedReports.find((r) => r.id === 'r2');
ok(r2.target?.kind === 'answer' && r2.target.question_id === 'q4', 'r2: цель-ответ + вопрос-родитель');

console.log('\n1) Модалка «Пожаловаться» (u-max жалуется на комментарий c2):');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
openReportModal('comment', 'c2');
await tick();
const chips = modalRoot.querySelectorAll('.report-reason');
ok(chips.length === 5, '5 причин: ' + [...chips].map((c) => c.textContent.trim()).join(' / '));
ok([...chips].some((c) => c.textContent.includes('Мошенничество')), 'среди причин есть «Мошенничество / чужие реквизиты»');
ok(chips[0].classList.contains('active'), 'по умолчанию выбрана первая (спам)');
click(chips[2]); // копирайт
ok(chips[2].classList.contains('active') && !chips[0].classList.contains('active'), 'выбор причины переключается');
modalRoot.querySelector('#report-note').value = 'Кажется, это текст из чужого туториала';
const before = (await (setState({ user: ADMIN }), sb.fetchReports('all'))).length;
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
click(modalRoot.querySelector('#report-send'));
await tick(120);
ok(!modalRoot.querySelector('.modal'), 'после отправки модалка закрыта');
setState({ user: ADMIN });
const after = await sb.fetchReports('all');
const created = after.find((r) => r.target_type === 'comment' && r.target_id === 'c2' && r.reporter_id === 'u-max');
ok(after.length === before + 1 && !!created, 'жалоба создана (comment/c2 от u-max)');
ok(created.reason === 'copyright' && created.note.includes('чужого'), 'причина и пояснение сохранены');
ok(created.status === 'new', 'статус — new');

console.log('\n1b) Повторная жалоба → duplicate:');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
openReportModal('comment', 'c2');
await tick();
click(modalRoot.querySelector('#report-send'));
await tick(120);
ok(!!modalRoot.querySelector('.modal'), 'модалка осталась открытой (отправка не прошла)');
ok(!modalRoot.querySelector('#report-send').disabled, 'кнопка снова активна');
setState({ user: ADMIN });
ok((await sb.fetchReports('all')).length === after.length, 'вторая жалоба НЕ создалась');
click(modalRoot.querySelector('.modal-close'));
await tick();

console.log('\n2) Слой данных:');
setState({ user: null });
let threw = null;
try { await sb.submitReport({ target_type: 'comment', target_id: 'c1', reason: 'spam' }); } catch (e) { threw = e; }
ok(!!threw, 'без входа submitReport отказывает');
ok((await sb.fetchReports('all')).length === 0, 'не-админ (гость) жалобы не видит');
setState({ user: { id: 'u-anna', username: 'AnnaKS' } });
ok((await sb.fetchReports('all')).length === 0, 'не-админ (u-anna) жалобы не видит');
threw = null;
try { await sb.setReportStatus('r1', 'dismissed'); } catch (e) { threw = e; }
ok(!!threw, 'не-админ не может менять статус');

setState({ user: ADMIN });
ok(await sb.setReportStatus('r1', 'dismissed', 'Показалось'), 'админ отклонил r1');
const r1b = (await sb.fetchReports('all')).find((r) => r.id === 'r1');
ok(r1b.status === 'dismissed' && r1b.moderator_note === 'Показалось' && !!r1b.resolved_at, 'r1: dismissed + заметка + resolved_at');
const a5Before = (await sb.fetchAnswers('q4')).length;
await sb.removeReportedContent(r2);
const a5After = (await sb.fetchAnswers('q4')).length;
ok(a5After === a5Before - 1, `контент по жалобе удалён (ответов у q4: ${a5Before} → ${a5After})`);
const r2b = (await sb.fetchReports('all')).find((r) => r.id === 'r2');
ok(r2b.status === 'actioned', 'жалоба закрыта как actioned');
ok(r2b.target === null, 'цель исчезла → target: null (UI покажет «контент удалён»)');

console.log('\n3) Экран /moderation:');
setState({ user: { id: 'u-anna', username: 'AnnaKS' } });
await renderModeration(app);
await tick(80);
ok(location.pathname === '/', 'не-админа редиректит в ленту');
setState({ user: ADMIN });
history.replaceState({}, '', '/moderation');
await renderModeration(app);
await tick(80);
let cards = app.querySelectorAll('.mod-card');
ok(cards.length === 1, `вкладка «Новые»: 1 жалоба (c2 от u-max; r1/r2 разобраны) — факт: ${cards.length}`);
ok(cards[0].querySelector('.mod-reason').textContent.includes('авторские'), 'бейдж причины «©️ Чужой контент…»');
ok(cards[0].querySelector('.mod-note').textContent.includes('чужого'), 'пояснение жалобщика видно');
ok(cards[0].querySelector('.mod-target').textContent.includes('Подтверждаю'), 'содержимое комментария (c2) показано');
click(app.querySelector('.sort-tab[data-st="all"]'));
await tick(80);
cards = app.querySelectorAll('.mod-card');
ok(cards.length === 4, `вкладка «Все»: 4 жалобы (3 сида + созданная в тесте; факт: ${cards.length})`);
ok(!!app.querySelector('.mod-status-dismissed') && !!app.querySelector('.mod-status-actioned'), 'чипы статусов «Отклонена»/«Контент удалён»');
ok(app.textContent.includes('Контент уже удалён'), 'для actioned-жалобы — «контент уже удалён»');
// «Отклонить» из UI (c2)
click(app.querySelector('.sort-tab[data-st="new"]'));
await tick(80);
click(app.querySelector('.mod-card [data-act="dismiss"]'));
await tick(150);
ok(app.querySelectorAll('.mod-card').length === 0 && app.textContent.includes('Новых жалоб нет'),
  'после «Отклонить» вкладка «Новые» пуста (empty-state)');

console.log('\n4) Кнопки жалобы на странице вопроса (q1, автор u-max):');
setState({ user: ADMIN }); // u-demo — не автор q1
await renderQuestion(app, { id: 'q1' });
await tick(80);
ok(!!app.querySelector('#btn-report-q'), 'в сайдбаре есть «⚑ Пожаловаться» (u-demo — не автор)');
ok(app.querySelectorAll('.answer-card [data-act="report"]').length >= 1, 'чип ⚑ у чужих ответов');
ok(app.querySelectorAll('[data-act="report-comment"]').length >= 1, '⚑ у чужих комментариев');
click(app.querySelector('#btn-report-q'));
await tick();
ok(!!modalRoot.querySelector('.report-reasons'), 'клик по «⚑» открыл модалку (вопрос q1)');
click(modalRoot.querySelector('.modal-close'));
await tick();
// автору вопроса (u-max для q1) кнопка жалобы на вопрос не показана
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
await renderQuestion(app, { id: 'q1' });
await tick(80);
ok(!app.querySelector('#btn-report-q'), 'автору вопроса кнопка жалобы не показана');
// на СВОЁМ ответе чипа ⚑ нет: u-lena смотрит q2, где её ответ a3
setState({ user: { id: 'u-lena', username: 'LenaFX' } });
await renderQuestion(app, { id: 'q2' });
await tick(80);
ok(!app.querySelector('.answer-card[data-answer-id="a3"] [data-act="report"]'), 'на своём ответе (a3 от u-lena) чипа ⚑ нет');
ok(!!app.querySelector('#btn-report-q'), 'u-lena не автор q2 → кнопка жалобы на вопрос есть');

console.log('\n5) Жалоба на профиль (мошенничество / чужие реквизиты):');
const { renderProfile } = await import('../public/js/profile.mjs');
const toasts = document.getElementById('toast-container');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
await renderProfile(app, { userId: 'u-anna' });
await tick(80);
ok(!!app.querySelector('#btn-report-profile'), 'в шапке ЧУЖОГО профиля есть кнопка ⚑');
click(app.querySelector('#btn-report-profile'));
await tick();
const pChips = modalRoot.querySelectorAll('.report-reason');
ok(pChips.length === 5, `модалка жалобы на профиль открыта (${pChips.length} причин)`);
ok(pChips[3].classList.contains('active'), 'по умолчанию активна причина «Мошенничество» (для профиля)');
modalRoot.querySelector('#report-note').value = 'Просит предоплату на карту и пропадает';
const beforeP = (await (setState({ user: ADMIN }), sb.fetchReports('all'))).length;
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
click(modalRoot.querySelector('#report-send'));
await tick(150);
ok(!modalRoot.querySelector('.modal'), 'после отправки модалка закрыта');
setState({ user: ADMIN });
const allP = await sb.fetchReports('all');
const rp = allP.find((r) => r.target_type === 'profile' && r.target_id === 'u-anna');
ok(allP.length === beforeP + 1 && !!rp, 'жалоба на профиль создана');
ok(rp.reason === 'fraud' && rp.note.includes('предоплату'), 'причина fraud + пояснение сохранены');
ok(rp.target?.kind === 'profile' && rp.target.title === '@AnnaSynth', `цель-профиль: ${rp.target?.title}`);
ok(rp.target.text.includes('Оплата:') && rp.target.text.includes('USDT') === false,
   'модератору видно способы приёма (но не крипто-адрес u-anna — его у неё нет)');
ok(rp.target.text.includes('Контакты:') && rp.target.text.includes('@annasynth'),
   'и контакты профиля — чтобы оценить жалобу');

console.log('\n5b) Жалоба на свой профиль отклоняется:');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
openReportModal('profile', 'u-anna');
await tick();
ok(!modalRoot.querySelector('.report-reasons'), 'модалка не открылась');
ok(toasts.textContent.includes('свой профиль'), 'показан тост-отказ: «' + toasts.textContent.trim().slice(-46) + '»');
ok((await (setState({ user: ADMIN }), sb.fetchReports('all'))).length === allP.length, 'жалоба на себя не создалась');

console.log('\n5c) Экран модерации: профиль нельзя «удалить», только «Разобрано»:');
setState({ user: ADMIN });
history.replaceState({}, '', '/moderation');
await renderModeration(app);
await tick(80);
click(app.querySelector('.sort-tab[data-st="all"]'));
await tick(80);
const pCard = [...app.querySelectorAll('.mod-card')].find((c) => c.querySelector('.mod-reason')?.textContent.includes('Мошенничество'));
ok(!!pCard, 'карточка жалобы на профиль в списке');
ok(pCard.querySelector('.mod-reason').textContent.includes('💸'), 'иконка причины 💸');
ok(pCard.querySelector('.mod-kind').textContent.includes('Профиль'), 'тип цели: «' + pCard.querySelector('.mod-kind').textContent.trim() + '»');
ok(!!pCard.querySelector('.mod-target-title a[href="/profile/u-anna"]'), 'заголовок цели — ссылка на профиль');
ok(!pCard.querySelector('[data-act="remove"]'), 'кнопки «Удалить контент» у жалобы на профиль НЕТ');
ok(!!pCard.querySelector('[data-act="action"]'), 'вместо неё — «✓ Разобрано»');
click(pCard.querySelector('[data-act="action"]'));
await tick(200);
const rpAfter = (await sb.fetchReports('all')).find((r) => r.id === rp.id);
ok(rpAfter.status === 'actioned' && !!rpAfter.resolved_at, 'жалоба закрыта как actioned (профиль не удалён)');
ok(!!(await sb.fetchProfile('u-anna')), 'профиль u-anna на месте');

console.log('\n8) заход 36: чек-лист модератору на экране + петля обратной связи жалобщику:');
{
  setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
  history.replaceState({}, '', '/moderation');
  await renderModeration(app);
  await tick(80);
  const guide = app.querySelector('.mod-guide');
  ok(!!guide, 'админ: чек-лист .mod-guide отрисован над списком жалоб');
  ok(!!guide && guide.querySelectorAll('li').length === 4, 'чек-лист: матрица из 4 строк «причина → действие»');
  ok(!!guide?.querySelector('a[data-help="moderation_guide"][data-route="/help"]'), 'ссылка «подробнее в справке» с data-help="moderation_guide"');

  // петля обратной связи: жалобщик получает уведомление о ФАКТЕ решения
  setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
  const repM = await sb.submitReport({ target_type: 'question', target_id: 'q1', reason: 'spam' });
  ok(!!repM?.id, 'u-max пожаловался на вопрос q1');
  setState({ user: { id: 'u-lena', username: 'LenaFX' } });
  const repL = await sb.submitReport({ target_type: 'question', target_id: 'q2', reason: 'offense' });
  ok(!!repL?.id, 'u-lena пожаловалась на вопрос q2');
  setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
  ok(await sb.setReportStatus(repM.id, 'dismissed'), 'админ отклонил жалобу u-max');
  ok(await sb.setReportStatus(repL.id, 'actioned'), 'админ закрыл жалобу u-lena как actioned');
  setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
  let rn = (await sb.fetchNotifications()).find((x) => x.type === 'report_status');
  ok(!!rn && rn.payload?.status === 'dismissed' && rn.payload?.target_type === 'question', 'репортёр получил уведомление «отклонено» (факт, без причин)');
  setState({ user: { id: 'u-lena', username: 'LenaFX' } });
  rn = (await sb.fetchNotifications()).find((x) => x.type === 'report_status');
  ok(!!rn && rn.payload?.status === 'actioned' && rn.payload?.target_type === 'question', 'второй репортёр получил уведомление «приняты меры»');
  setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
  ok(!(await sb.fetchNotifications()).some((x) => x.type === 'report_status'), 'модератор (не репортёр) уведомлений о решениях не получает — петля только для жалобщиков');

  // жалоба на профиль: payload.target_type = profile (особая формулировка текста)
  setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
  const repP = await sb.submitReport({ target_type: 'profile', target_id: 'u-lena', reason: 'fraud' });
  setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
  ok(await sb.setReportStatus(repP.id, 'actioned'), 'жалоба на профиль разобрана («Разобрано»)');
  setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
  rn = (await sb.fetchNotifications()).find((x) => x.type === 'report_status' && x.payload?.target_type === 'profile');
  ok(!!rn && rn.payload?.status === 'actioned', 'уведомление по профилю: target_type=profile → формулировка «меры организационного характера»');

  // не-админ: чек-лист и список не рендерятся (guard разворачивает на главную)
  const app2 = document.createElement('div');
  document.body.appendChild(app2);
  setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
  await renderModeration(app2);
  await tick(50);
  ok(!app2.querySelector('.mod-guide') && !app2.querySelector('.mod-card'), 'не-админ: ни чек-листа, ни списка (guard)');
  app2.remove();
  setState({ user: { id: 'u-demo', username: 'DemoUser', is_admin: true } });
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
