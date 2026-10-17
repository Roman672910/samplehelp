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
import { fetchNotifications, fetchConversations, markAllNotificationsRead, markNotificationRead, subscribeNotifications, subscribeMessages, confirmDonation, fetchProfile } from './api.mjs';
import { openSupportModal } from './support.mjs';
import { escapeHtml, timeAgo, toast } from './utils.mjs';
import { navigate } from './router.mjs';

const TYPE_ICONS = { answer: '✍️', like: '🔥', new_question_tag: '🏷️', solution: '✅', reminder: '⏰', purge: '🗃️', support: '☕', report_status: '🛡️', idea_status: '💡', idea_reply: '💬' };

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

// Заход 47: кликабельность уведомления = наличие куда вести (та же карта, что в open())
function isNavigable(n) {
  if (n.type === 'idea_status' || n.type === 'idea_reply') return true;
  if (n.type === 'report_status') return false; // цель могли удалить — осознанный тупик
  if (n.type === 'support') return true;
  return !!n.payload?.questionId;
}

function renderPanel(panel) {
  const { notifications } = getState();
  panel.innerHTML = `
    <div class="notif-panel-head">
      <h3>${escapeHtml(t('notifications.title'))}</h3>
      <button type="button" id="notif-mark-all" data-help="notif_mark_all">${escapeHtml(t('notifications.mark_all_read'))}</button>
    </div>
    ${notifications.length ? notifications.map((n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}${isNavigable(n) ? ' clickable' : ''}" data-help="notif_item" data-id="${escapeHtml(n.id)}" role="button" tabindex="0">
        <span class="notif-icon" aria-hidden="true">${TYPE_ICONS[n.type] || '🔔'}</span>
        <span class="notif-text">${notificationText(n)}<span class="notif-time">${escapeHtml(timeAgo(n.created_at, getLocale()))}</span></span>
        ${isNavigable(n) ? '<span class="notif-go" aria-hidden="true">›</span>' : ''}
        ${n.type === 'support' && n.payload?.donationId && n.payload?.amount && !n.payload?.confirmed
          ? `<button type="button" class="btn btn-quiet btn-sm notif-confirm" data-help="support_confirm" data-confirm="${escapeHtml(n.payload.donationId)}">${escapeHtml(t('support.mark_confirm'))}</button>`
          : ''}
      </div>`).join('')
      : `<div class="empty-state" style="padding:34px 16px"><span class="empty-icon" style="font-size:28px">🔕</span><p>${escapeHtml(t('notifications.empty'))}</p></div>`}`;

  panel.querySelector('#notif-mark-all')?.addEventListener('click', async () => {
    await markAllNotificationsRead();
    setState({ unreadCount: 0, notifications: getState().notifications.map((n) => ({ ...n, read: true })) });
    renderPanel(panel);
  });

  // «Получено ✓» прямо из уведомления: статус done + благодарность донору
  panel.querySelectorAll('.notif-confirm').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // клик по кнопке не открывает переход уведомления
      const okConf = await confirmDonation(btn.dataset.confirm);
      if (!okConf) return;
      const n = notifications.find((x) => x.payload?.donationId === btn.dataset.confirm);
      if (n) n.payload.confirmed = true;
      setState({ notifications: [...getState().notifications] });
      toast(t('support.mark_confirmed_toast'));
      renderPanel(panel);
    });
  });

  // Клик по уведомлению — переход к вопросу (делегирование)
  panel.querySelectorAll('.notif-item').forEach((item) => {
    const open = async () => {
      const n = notifications.find((x) => x.id === item.dataset.id);
      if (!n) return;
      // Заход 47: клик = прочитано (бейдж честный)
      if (!n.read) {
        n.read = true;
        const upd = [...getState().notifications];
        setState({ notifications: upd, unreadCount: upd.filter((x) => !x.read).length });
        markNotificationRead(n.id);
      }
      if (n.type === 'idea_status' || n.type === 'idea_reply') {
        navigate('/ideas');
      } else if (n.type === 'support') {
        const me = getState().user;
        if (n.payload?.done) {
          // донору: профиль автора, подтвердившего получение
          if (n.payload?.authorId) navigate(`/profile/${n.payload.authorId}`);
        } else if (n.payload?.amount) {
          // автору: своя модалка поддержки со списком отметок и «Получено ✓»
          if (me) {
            const prof = await fetchProfile(me.id);
            openSupportModal({ recipientUserId: me.id, recipientName: prof?.username || me.username || '', recipientMethods: prof?.donate_methods || [] });
          }
        } else if (n.payload?.donorId) {
          // автору: профиль донора, сказавшего «спасибо»
          navigate(`/profile/${n.payload.donorId}`);
        }
      } else if (n.payload?.questionId) {
        navigate(`/question/${n.payload.questionId}`);
      }
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
      return `<b>${escapeHtml(n.payload?.by || '')}</b> ${escapeHtml(t('notifications.type_like'))} ${n.payload?.targetKey ? escapeHtml(t(n.payload.targetKey)) : escapeHtml(n.payload?.target || '')}`;
    case 'new_question_tag':
      return `${escapeHtml(t('notifications.type_new_question_tag'))} <b>#${escapeHtml(n.payload?.tag || '')}</b>: «${escapeHtml(n.payload?.questionTitle || '')}»`;
    case 'solution':
      return `<b>${escapeHtml(n.payload?.by || '')}</b> ${escapeHtml(t('notifications.type_solution'))} «${escapeHtml(n.payload?.questionTitle || '')}»${n.payload?.rep ? ` <span class="notif-rep">(${escapeHtml(t('notifications.rep_awarded', { n: n.payload.rep }))})</span>` : ''}`;
    case 'support': {
      const by = `<b>${escapeHtml(n.payload?.by || '')}</b>`;
      // отметка «я перевёл N ₽» (сверка с банком) и «автор получил» — заход 2026-10-13
      if (n.payload?.done) return `${by} ${escapeHtml(t('notifications.type_support_done'))}`;
      if (n.payload?.amount) return `${by} ${escapeHtml(t('notifications.type_support_mark', { amount: n.payload.amount }))}${n.payload?.message ? `: «${escapeHtml(n.payload.message)}»` : ''}`;
      return `${by} ${escapeHtml(t('notifications.type_support'))}${n.payload?.message ? `: «${escapeHtml(n.payload.message)}»` : ''}`;
    }
    case 'reminder':
      return `${escapeHtml(t('notifications.type_reminder'))} «${escapeHtml(n.payload?.questionTitle || '')}»`;
    case 'purge':
      return `${escapeHtml(t('notifications.type_purge'))} «${escapeHtml(n.payload?.questionTitle || '')}» ${escapeHtml(t('notifications.type_purge_tail'))}`;
    case 'idea_status': {
      // title подставляется СЫРЫМ и экранируется один раз снаружи
      const title = n.payload?.ideaTitle || '';
      if (n.payload?.status === 'in_work') return escapeHtml(t('notifications.type_idea_status_in_work', { title }));
      if (n.payload?.status === 'done') return escapeHtml(t('notifications.type_idea_status_done', { title }));
      if (n.payload?.status === 'rejected') return escapeHtml(t('notifications.type_idea_status_rejected', { title }));
      return escapeHtml(t('notifications.type_idea_status_new', { title }));
    }
    case 'idea_reply':
      return escapeHtml(t('notifications.type_idea_reply', { title: n.payload?.ideaTitle || '' }));
    case 'report_status':
      // Заход 36: петля обратной связи — только факт решения, без причин и цитат
      if (n.payload?.status === 'actioned') {
        return n.payload?.target_type === 'profile'
          ? escapeHtml(t('notifications.type_report_actioned_profile'))
          : escapeHtml(t('notifications.type_report_actioned'));
      }
      return escapeHtml(t('notifications.type_report_dismissed'));
    default:
      return escapeHtml(t('notifications.empty'));
  }
}

export function applyI18nToPanel() {
  applyTranslations(document.getElementById('notif-panel') || document);
}
