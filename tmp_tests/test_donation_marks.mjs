// test_donation_marks.mjs — «Я перевёл» + «Получено ✓» + сообщение к переводу
// (заход 2026-10-13, модель A: платформа деньги не проводит).
// Секции:
//  0) модалка донора: блок сообщения к переводу (текст «SampleHelp · поддержка
//     @автор», кнопка копирования), отметка «Я перевёл», антимошенническая
//     строка; у автора своей модалки этих блоков нет;
//  1) отметка: сумма+сообщение → donations(kind=paid, status=intent) +
//     уведомление автору (amount, donationId); невалидная сумма не создаёт строку;
//  2) автор: список отметок в своей модалке, «Получено ✓» → status done +
//     уведомление донору (done), кнопка в списке гаснет;
//  3) уведомление-отметка: кнопка «Получено ✓» прямо в панели колокольчика
//     (payload.confirmed гасит кнопку);
//  4) тексты уведомлений: отметка с суммой, «получил(а) ваш перевод».
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="modal-root"></div><div id="toast-container"></div><header class="app-header"><button id="notif-bell"></button><div id="notif-panel" hidden></div></header></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
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

const { setLocale, t } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { getState, setState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const { openSupportModal } = await import('../public/js/support.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const tick = (ms = 80) => new Promise((r) => realSetTimeout(r, ms));
const click = (el) => el?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const modal = () => [...document.querySelectorAll('#modal-root .modal-overlay')].pop();
const closeModals = () => document.querySelectorAll('#modal-root .modal-overlay').forEach((o) => o.remove());
const ANNA_METHODS = [{ kind: 'qr', value: 'https://qr.nspk.ru/DEMOANNA0001?crc=A1B2', qr_data_url: 'data:image/png;base64,QUFFBQ==', label: 'Сбербанк' }];

// ---------- 0) Модалка донора: блоки сообщения/отметки/памятки ----------
console.log('0) Модалка донора: сообщение к переводу, отметка, памятка:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: ANNA_METHODS });
await tick(120);
{
  const m = modal();
  ok(!!m, 'модалка «Поддержать автора · AnnaSynth» открыта');
  const comment = m.querySelector('#sup-comment-text');
  ok(!!comment && comment.textContent.includes('SampleHelp') && comment.textContent.includes('@AnnaSynth'),
    `текст сообщения к переводу: «${comment?.textContent}»`);
  ok(!!m.querySelector('#sup-copy-comment'), 'кнопка «Скопировать сообщение» на месте');
  ok((m.querySelector('.sup-antifraud')?.textContent || '').includes('мошенники'), 'антимошенническая строка в модалке');
  ok(!!m.querySelector('#sup-mark-amount') && !!m.querySelector('#sup-mark-send'), 'блок «Я перевёл»: сумма + кнопка отметки');
  ok(!m.querySelector('#sup-marks-list'), 'у донора нет списка отметок (он только у автора)');
}
closeModals();

// своя модалка автора: блоков донора нет, список отметок есть
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: ANNA_METHODS });
await tick(120);
{
  const m = modal();
  ok(!m.querySelector('#sup-comment-text') && !m.querySelector('#sup-mark-send'), 'в своей модалке автор не видит блоки донора');
  ok(!!m.querySelector('#sup-marks-list'), 'у автора — список «Отметки о переводах»');
  ok((m.querySelector('#sup-marks-list')?.textContent || '').includes('@MaxWavetable'), 'сид-отметка (300 ₽ от @MaxWavetable) видна в списке автора');
}
closeModals();

// ---------- 1) Отметка «Я перевёл» ----------
console.log('\n1) Отметка: сумма + сообщение → запись и уведомление автору:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: ANNA_METHODS });
await tick(100);
{
  const m = modal();
  // невалидная сумма — строка не создаётся
  m.querySelector('#sup-mark-amount').value = '0';
  click(m.querySelector('#sup-mark-send'));
  await tick(80);
  let stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  ok(!(stored.donations || []).some((d) => d.donor_id === 'u-demo' && d.kind === 'paid' && d.status === 'intent'),
    'сумма 0 → отметка не создана (toast «Введите сумму больше нуля»)');
  // валидная отметка
  m.querySelector('#sup-mark-amount').value = '300';
  m.querySelector('#sup-mark-msg').value = 'за эволюционирующий пэд';
  click(m.querySelector('#sup-mark-send'));
  await tick(120);
  stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  const row = (stored.donations || []).find((d) => d.donor_id === 'u-demo' && d.kind === 'paid' && d.status === 'intent');
  ok(!!row && row.amount === 300 && row.message === 'за эволюционирующий пэд', `запись donations: kind=paid, status=intent, 300 ₽ («${row?.message}»)`);
  const notif = (stored.notifications || []).find((n) => n.user_id === 'u-anna' && n.type === 'support' && n.payload?.donationId === row?.id);
  ok(!!notif && notif.payload.amount === 300 && notif.payload.by === 'DemoUser', 'автору уведомление с суммой и именем донора');
  ok(m.querySelector('#sup-mark-amount').value === '', 'поле суммы очищено после отметки');
}
closeModals();

// ---------- 2) Автор: список отметок + «Получено ✓» ----------
console.log('\n2) Автор: список отметок и подтверждение получения:');
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
openSupportModal({ recipientUserId: 'u-anna', recipientName: 'AnnaSynth', recipientMethods: ANNA_METHODS });
await tick(150);
{
  const m = modal();
  const item = m.querySelector('.sup-mark-item');
  ok(!!item && item.textContent.includes('300 ₽') && item.textContent.includes('@DemoUser'), 'отметка донора в списке: 300 ₽ от @DemoUser');
  ok(!!item?.querySelector('[data-confirm-d]'), 'у отметки кнопка «Получено ✓»');
  click(item.querySelector('[data-confirm-d]'));
  await tick(150);
  const stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  const row = (stored.donations || []).find((d) => d.donor_id === 'u-demo' && d.kind === 'paid');
  ok(row?.status === 'done', 'статус записи: done');
  ok((modal().querySelector('.sup-mark-item')?.textContent || '').includes(t('support.mark_confirmed').replace(' ✓', '')), 'в списке вместо кнопки — «получено ✓»');
  const donorNotif = (stored.notifications || []).find((n) => n.user_id === 'u-demo' && n.type === 'support' && n.payload?.done);
  ok(!!donorNotif && donorNotif.payload.by === 'AnnaSynth', 'донору уведомление «автор получил перевод»');
  const authorNotif = (stored.notifications || []).find((n) => n.user_id === 'u-anna' && n.payload?.donationId === row?.id);
  ok(authorNotif?.payload?.confirmed === true, 'исходное уведомление автора помечено confirmed (кнопка в панели погаснет)');
}
closeModals();

// ---------- 3) Кнопка «Получено ✓» в панели уведомлений ----------
console.log('\n3) Панель колокольчика: подтверждение прямо из уведомления:');
{
  // новая отметка от u-max автору u-anna
  setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
  const row = await sb.markDonationTransfer({ recipientUserId: 'u-anna', amount: 500, message: '' });
  ok(!!row, 'u-max отметил перевод 500 ₽');
  setState({ user: { id: 'u-anna', username: 'AnnaSynth' } });
  const notifs = await sb.fetchNotifications();
  setState({ notifications: notifs, unreadCount: notifs.filter((n) => !n.read).length });
  const { initNotifications } = await import('../public/js/notifications.mjs');
  initNotifications();
  await tick(80);
  const panel = document.getElementById('notif-panel');
  // рендер панели происходит при открытии: кликаем по колокольчику
  click(document.getElementById('notif-bell'));
  await tick(120);
  const btn = panel.querySelector('.notif-confirm');
  ok(!!btn && btn.textContent.includes('Получено'), 'в уведомлении-отметке кнопка «Получено ✓»');
  click(btn);
  await tick(150);
  const stored = JSON.parse(localStorage.getItem('samplehelp_demo_db'));
  ok((stored.donations || []).find((d) => d.id === row.id)?.status === 'done', 'клик из панели → статус done');
  ok(!document.getElementById('notif-panel').querySelector(`.notif-confirm[data-confirm="${row.id}"]`), 'кнопка погасла после подтверждения');
}

// ---------- 4) Тексты уведомлений ----------
console.log('\n4) Тексты уведомлений:');
{
  ok(t('notifications.type_support_mark', { amount: 300 }).includes('300'), `отметка: «${t('notifications.type_support_mark', { amount: 300 })}»`);
  ok(t('notifications.type_support_done').includes('спасибо'), `получено: «${t('notifications.type_support_done')}»`);
  const st = getState();
  void st;
}

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);
