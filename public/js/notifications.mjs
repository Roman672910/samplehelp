// ============================================================
// notifications.mjs — колокольчик в шапке, панель уведомлений,
// Realtime-подписка (Supabase) и эмуляция в демо-режиме.
// В колокольчике — только действия: ответ на твой вопрос, лайк,
// новый вопрос по подписанному тегу, решение, напоминание, архивация.
// Личные сообщения в уведомления НЕ попадают — для них есть
// счётчик непрочитанных на иконке «Сообщения» (#msg-count).
// Панель уведомлений раскрывается ровно под колокольчиком
// (position: fixed, координаты выставляет positionPanel()).
// ============================================================

import { t, getLocale, applyTranslations } from './i18n.mjs';
import { getState, setState, subscribeTo } from './store.mjs';
import { fetchNotifications, fetchConversations, markAllNotificationsRead, subscribeNotifications, subscribeMessages } from './supabase.mjs';
import { escapeHtml, timeAgo } from './utils.mjs';
import { navigate } from './router.mjs';

const TYPE_ICONS = { answer: '✍️', like: '🔥', new_question_tag: '🏷️', solution: '✅', reminder: '⏰', purge: '🗃️' };

let unsubscribeRealtime = () => {};
let unsubscribeMessages = () => {};
let panelOpen = false;
let loadedForUser = null; // защита от повторных загрузок для того же пользователя

export function initNotifications() {
  const bell = document.getElementById('notif-bell');
  const panel = document.getElementById('notif-panel');
  if (!bell || !panel) return;

  // Синхронизация НАЧАЛЬНОГО состояния: сессия могла восстановиться
  // до создания этой подписки — иначе колокольчик оставался скрытым
  // до первого изменения user (например, после перезагрузки страницы)
  bell.hidden = !getState().user;

  // Показываем колокольчик только авторизованным
  subscribeTo('user', (user) => {
    bell.hidden = !user;
    if (!user) {
      panel.hidden = true;
      panelOpen = false;
      loadedForUser = null;
      setState({ notifications: [], unreadCount: 0, unreadMessages: 0 });
    } else {
      loadAndSubscribe();
    }
  });
  subscribeTo('notifications', renderBadge);
  // Счётчик непрочитанных личных сообщений — на иконке «Сообщения»
  subscribeTo('unreadMessages', renderMsgBadge);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    panelOpen = !panelOpen;
    panel.hidden = !panelOpen;
    bell.setAttribute('aria-expanded', String(panelOpen));
    if (panelOpen) {
      renderPanel(panel);
      positionPanel(panel);
    }
  });

  // При изменении размера окна удерживаем открытую панель под колокольчиком
  window.addEventListener('resize', () => {
    if (panelOpen) positionPanel(panel);
  });

  document.addEventListener('click', (e) => {
    if (panelOpen && !panel.contains(e.target) && e.target !== bell) {
      panelOpen = false;
      panel.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
    }
  });

  if (getState().user) loadAndSubscribe();
}

async function loadAndSubscribe() {
  const { user } = getState();
  if (!user) return;
  // Для того же пользователя уже загружено и подписки активны —
  // не дублируем запросы (важно при фоновом уточнении профиля)
  if (loadedForUser === user.id) return;
  loadedForUser = user.id;

  const notifications = await fetchNotifications();
  setState({ notifications, unreadCount: notifications.filter((n) => !n.read).length });

  // Начальное значение счётчика непрочитанных сообщений (иконка «Сообщения»)
  refreshUnreadMessages();

  // Realtime: новые уведомления (только действия — сообщения отсеиваются)
  unsubscribeRealtime();
  unsubscribeRealtime = await subscribeNotifications((n) => {
    if (n.type === 'message') return; // личные сообщения живут в разделе «Сообщения»
    const { notifications: cur } = getState();
    setState({ notifications: [n, ...cur], unreadCount: getState().unreadCount + 1 });
    if (panelOpen) renderPanel(document.getElementById('notif-panel'));
  });

  // Realtime: новые личные сообщения → счётчик на иконке «Сообщения»
  unsubscribeMessages();
  unsubscribeMessages = await subscribeMessages((m) => onIncomingMessage(m));
}

// ============================================================
// ЛИЧНЫЕ СООБЩЕНИЯ: счётчик непрочитанных на иконке «Сообщения»
// ============================================================

/** Входящее сообщение: в колокольчик не попадает, только +1 к счётчику 💬.
 *  Если диалог с отправителем сейчас открыт — сообщение на глазах
 *  становится прочитанным (см. messages.mjs), счётчик не трогаем. */
export function onIncomingMessage(m) {
  const { user } = getState();
  if (!user || !m || m.sender_id === user.id) return;
  if (!isThreadOpen(m.sender_id)) {
    setState({ unreadMessages: getState().unreadMessages + 1 });
  }
  document.dispatchEvent(new CustomEvent('messages:new', { detail: m }));
}

/** Открыт ли сейчас на экране сообщений диалог с этим пользователем? */
function isThreadOpen(userId) {
  return window.location.pathname.startsWith('/messages')
    && document.querySelector('#chat-pane')?.dataset.with === userId;
}

/** Пересчитать счётчик непрочитанных по списку диалогов
 *  (после входа, после открытия диалога / отметки «прочитано»). */
export async function refreshUnreadMessages() {
  const { user } = getState();
  if (!user) { setState({ unreadMessages: 0 }); return; }
  try {
    const conversations = await fetchConversations();
    setState({ unreadMessages: conversations.reduce((sum, c) => sum + (c.unread || 0), 0) });
  } catch (e) {
    console.error('[notifications] refreshUnreadMessages:', e);
  }
}

function renderMsgBadge() {
  const el = document.getElementById('msg-count');
  if (!el) return;
  const { unreadMessages } = getState();
  el.textContent = String(unreadMessages > 99 ? '99+' : unreadMessages);
  el.hidden = !getState().user || unreadMessages === 0;
}

/** Панель раскрывается ровно под колокольчиком (по центру иконки),
 *  с защитой от вылета за края экрана на узких окнах. */
function positionPanel(panel) {
  const bell = document.getElementById('notif-bell');
  if (!bell || !panel) return;
  const r = bell.getBoundingClientRect();
  const w = panel.offsetWidth || 340;
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  panel.style.top = `${Math.round(r.bottom + 10)}px`;
  panel.style.left = `${Math.round(left)}px`;
}

function renderBadge(notifications) {
  const countEl = document.getElementById('notif-count');
  const { unreadCount } = getState();
  if (!countEl) return;
  countEl.textContent = String(unreadCount > 99 ? '99+' : unreadCount);
  countEl.hidden = unreadCount === 0;
  void notifications;
}

function renderPanel(panel) {
  const { notifications } = getState();
  panel.innerHTML = `
    <div class="notif-panel-head">
      <h3>${escapeHtml(t('notifications.title'))}</h3>
      <button type="button" id="notif-mark-all">${escapeHtml(t('notifications.mark_all_read'))}</button>
    </div>
    ${notifications.length ? notifications.map((n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${escapeHtml(n.id)}" role="button" tabindex="0">
        <span class="notif-icon" aria-hidden="true">${TYPE_ICONS[n.type] || '🔔'}</span>
        <span class="notif-text">${notificationText(n)}<span class="notif-time">${escapeHtml(timeAgo(n.created_at, getLocale()))}</span></span>
      </div>`).join('')
      : `<div class="empty-state" style="padding:34px 16px"><span class="empty-icon" style="font-size:28px">🔕</span><p>${escapeHtml(t('notifications.empty'))}</p></div>`}`;

  panel.querySelector('#notif-mark-all')?.addEventListener('click', async () => {
    await markAllNotificationsRead();
    setState({ unreadCount: 0, notifications: getState().notifications.map((n) => ({ ...n, read: true })) });
    renderPanel(panel);
  });

  // Клик по уведомлению — переход к вопросу (делегирование)
  panel.querySelectorAll('.notif-item').forEach((item) => {
    const open = () => {
      const n = notifications.find((x) => x.id === item.dataset.id);
      if (!n) return;
      if (n.payload?.questionId) navigate(`/question/${n.payload.questionId}`);
      panelOpen = false;
      panel.hidden = true;
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function notificationText(n) {
  switch (n.type) {
    case 'answer':
      return `<b>${escapeHtml(n.payload?.by || '')}</b> ${escapeHtml(t('notifications.type_answer'))} «${escapeHtml(n.payload?.questionTitle || '')}»`;
    case 'like':
      return `<b>${escapeHtml(n.payload?.by || '')}</b> ${escapeHtml(t('notifications.type_like'))} ${escapeHtml(n.payload?.target || '')}`;
    case 'new_question_tag':
      return `${escapeHtml(t('notifications.type_new_question_tag'))} <b>#${escapeHtml(n.payload?.tag || '')}</b>: «${escapeHtml(n.payload?.questionTitle || '')}»`;
    case 'solution':
      return `<b>${escapeHtml(n.payload?.by || '')}</b> ${escapeHtml(t('notifications.type_solution'))} «${escapeHtml(n.payload?.questionTitle || '')}»${n.payload?.rep ? ` <span class="notif-rep">(${escapeHtml(t('notifications.rep_awarded', { n: n.payload.rep }))})</span>` : ''}`;
    case 'reminder':
      return `${escapeHtml(t('notifications.type_reminder'))} «${escapeHtml(n.payload?.questionTitle || '')}»`;
    case 'purge':
      return `${escapeHtml(t('notifications.type_purge'))} «${escapeHtml(n.payload?.questionTitle || '')}» ${escapeHtml(t('notifications.type_purge_tail'))}`;
    default:
      return escapeHtml(t('notifications.empty'));
  }
}

export function applyI18nToPanel() {
  applyTranslations(document.getElementById('notif-panel') || document);
}