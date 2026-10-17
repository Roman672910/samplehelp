// ============================================================
// messages.mjs — личные сообщения:
// • диалоги, окно переписки, «онлайн» и «прочитано»
// • 🔢 непрочитанные видны на иконке «Сообщения» в шапке
//   (счётчик #msg-count, см. notifications.mjs) — в колокольчик
//   уведомления о сообщениях НЕ попадают
// • 📎 карточки-ссылки на вопрос/ответ/профиль вместо аудио-вложений
//   (аудио убрано 2026-10-13: приватность — переписка не должна лежать
//   в публичном бакете; в БД — только messages.ref jsonb, ноль байт)
// • 😀 реакции на сообщения
// • ✍️ индикатор «печатает…» (Realtime broadcast / демо-эмуляция)
// • 📅 разделители дат + кнопка «Новые сообщения ↓»
// • 👤 кликабельная шапка диалога → профиль
// • ✏️ редактирование и 🗑 удаление своих сообщений
// • 🔗 превью ссылок на вопросы карточкой
// ============================================================

import { t, getLocale } from './i18n.mjs';
import {
  fetchConversations, fetchThread, sendMessage, markThreadRead,
  subscribeMessages, openTypingChannel, updateMessage, deleteMessage,
  toggleMessageReaction, fetchQuestion, fetchRefCandidates, fetchRefCard,
} from './api.mjs';
import { getState } from './store.mjs';
import { escapeHtml, initials, toast, confirmModal } from './utils.mjs';
import { requireAuth } from './auth.mjs';
import { refreshUnreadMessages } from './notifications.mjs';
import { subscribeOnlineSet } from './presence.mjs';

const REACTION_EMOJIS = ['🔥', '👍', '❤️', '😂', '🎉'];

// Заход 42: онлайн/офлайн в ЛС — из ТОГО ЖЕ presence-множества, что точки в
// ленте (раньше был хардкод: демо — «u-anna онлайн», реал — всегда false, и
// диалог противоречил ленте). Точки живут в списке диалогов и в шапке чата,
// обновляются на тиках без перерисовки.
let msgPresenceUnsub = null;
let msgOnlineIds = new Set();
function applyMsgDots(scope) {
  scope.querySelectorAll('[data-odot]').forEach((el) => {
    const on = msgOnlineIds.has(el.dataset.odot);
    el.classList.toggle('off', !on);
    const label = on ? t('common.online') : t('common.offline');
    el.setAttribute('title', label);
    el.setAttribute('aria-label', label);
  });
}
const questionPreviewCache = new Map();
const refCardCache = new Map(); // key: `${type}:${id}` → пейлоад fetchRefCard | null

// ============================================================
// ЭКРАН: список диалогов + чат
// ============================================================

export async function renderMessages(container, params = {}) {
  if (!getState().user) {
    container.innerHTML = `<div class="screen empty-state"><span class="empty-icon">🔒</span><p>${escapeHtml(t('messages.login_required'))}</p></div>`;
    requireAuth();
    return;
  }

  const conversations = await fetchConversations();
  const activeId = params.userId || conversations[0]?.profile?.id || null;

  container.innerHTML = `
    <div class="screen">
      <div class="messages-layout" id="msg-layout">
        <div class="conv-list">
          <div class="conv-list-head">💬 ${escapeHtml(t('messages.title'))}</div>
          <div id="conv-items">
            ${conversations.length ? conversations.map((c) => `
              <button type="button" class="conv-item ${c.profile?.id === activeId ? 'active' : ''}" data-help="msg_conv" data-uid="${escapeHtml(c.profile?.id || '')}">
                <span class="avatar sm">${c.profile?.avatar_url ? `<img src="${escapeHtml(c.profile.avatar_url)}" alt="">` : escapeHtml(initials(c.profile?.username))}</span>
                <span style="min-width:0">
                  <span class="conv-name">
                    <span class="online-dot" data-odot="${escapeHtml(c.profile?.id || '')}"></span>
                    ${escapeHtml(c.profile?.username || '?')}
                    ${c.unread ? `<span class="notif-badge" style="position:static">${c.unread}</span>` : ''}
                  </span>
                  <span class="conv-last">${c.lastMessage.read || c.lastMessage.sender_id === getState().user.id ? '' : '● '}${escapeHtml(c.lastMessage.content || (c.lastMessage.ref ? '📎' : ''))}</span>
                </span>
              </button>`).join('')
              : `<div class="empty-state" style="padding:30px 14px"><p style="font-size:13px">${escapeHtml(t('messages.no_conversations'))}</p></div>`}
          </div>
        </div>
        <div class="chat-pane" id="chat-pane">
          ${activeId ? '<div class="loader"></div>' : `<div class="empty-state" style="margin:auto"><span class="empty-icon">📨</span><p>${escapeHtml(t('messages.select_conversation'))}</p></div>`}
        </div>
      </div>
    </div>`;

  // Переключение диалогов (делегирование)
  container.querySelector('#conv-items').addEventListener('click', (e) => {
    const item = e.target.closest('[data-uid]');
    if (!item) return;
    container.querySelectorAll('.conv-item').forEach((el) => el.classList.remove('active'));
    item.classList.add('active');
    threadCleanup?.();
    renderThread(container, item.dataset.uid);
  });

  let threadCleanup = null;
  if (activeId) threadCleanup = await renderThread(container, activeId);

  // Realtime: входящие сообщения без перезагрузки страницы.
  // Онлайн-точки диалогов: единый источник с лентой (заход 42)
  msgPresenceUnsub?.();
  msgPresenceUnsub = subscribeOnlineSet((ids) => { msgOnlineIds = ids; applyMsgDots(container); });
  applyMsgDots(container);

  // Одна локальная подписка (глобальная — только для колокольчика).
  const unsubscribe = await subscribeMessages(
    (msg) => handleIncoming(container, msg),
    (who) => handleTypingSignal(container, who),
  );

  return () => {
    unsubscribe?.();
    threadCleanup?.();
    msgPresenceUnsub?.();
    msgPresenceUnsub = null;
  };
}

// ============================================================
// ОКНО ДИАЛОГА
// ============================================================

async function renderThread(container, otherUserId) {
  const { user } = getState();
  const chatPane = container.querySelector('#chat-pane');
  chatPane.dataset.with = otherUserId;

  const [thread, conversations] = await Promise.all([fetchThread(otherUserId), fetchConversations()]);
  const conv = conversations.find((c) => c.profile?.id === otherUserId);
  const profile = conv?.profile || { username: '?' };

  await markThreadRead(otherUserId);
  // Диалог прочитан — пересчитываем счётчик на иконке «Сообщения»
  void refreshUnreadMessages();

  chatPane.innerHTML = `
    <div class="chat-head">
      <a href="/profile/${escapeHtml(otherUserId)}" data-route class="avatar sm" aria-label="${escapeHtml(t('profile.open'))}">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : escapeHtml(initials(profile.username))}</a>
      <a href="/profile/${escapeHtml(otherUserId)}" data-route>${escapeHtml(profile.username)}</a>
      <span class="online-dot" data-odot="${escapeHtml(otherUserId)}"></span>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="typing-indicator" id="typing-indicator" hidden>
      <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span id="typing-name"></span>
    </div>
    <button type="button" class="new-msg-pill" id="new-msg-pill" hidden></button>
    <div id="ref-picker-slot"></div>
    <div id="pending-slot"></div>
    <form class="chat-input-row" id="chat-form" novalidate>
      <button type="button" class="chat-tool-btn" id="attach-ref-btn" data-help="attach_ref_btn" aria-label="${escapeHtml(t('messages.attach_ref'))}" title="${escapeHtml(t('messages.attach_ref'))}">📎</button>
      <input type="text" id="chat-input" data-help="msg_input" placeholder="${escapeHtml(t('messages.placeholder'))}" aria-label="${escapeHtml(t('messages.placeholder'))}" autocomplete="off">
      <button type="submit" class="btn btn-primary" data-help="msg_send" aria-label="${escapeHtml(t('messages.send'))}">➤</button>
    </form>`;

  applyMsgDots(chatPane); // точка в шапке чата — по текущему множеству

  const list = chatPane.querySelector('#chat-messages');
  const pill = chatPane.querySelector('#new-msg-pill');
  const typingEl = chatPane.querySelector('#typing-indicator');
  const input = chatPane.querySelector('#chat-input');

  // ---------- Рендер переписки с разделителями дат ----------
  let lastDay = null;
  for (const m of thread) {
    const day = dayKey(m.created_at);
    if (day !== lastDay) { list.appendChild(dateSepEl(m.created_at)); lastDay = day; }
    list.appendChild(messageEl(m, user.id));
  }
  list.scrollTop = list.scrollHeight;

  // ---------- Кнопка «Новые сообщения» ----------
  let pillCount = 0;
  const isNearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 100;
  function showPill() {
    pillCount += 1;
    pill.hidden = false;
    pill.textContent = `↓ ${t('messages.new_messages')}${pillCount > 1 ? ` (${pillCount})` : ''}`;
  }
  function hidePill() { pillCount = 0; pill.hidden = true; }
  pill.addEventListener('click', () => { list.scrollTop = list.scrollHeight; hidePill(); });
  list.addEventListener('scroll', () => { if (isNearBottom() && !pill.hidden) hidePill(); });

  // ---------- Индикатор «печатает…» ----------
  let typingHideTimer = null;
  function showTyping(name) {
    chatPane.querySelector('#typing-name').textContent = t('messages.typing', { name: name || profile.username || '…' });
    typingEl.hidden = false;
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(() => { typingEl.hidden = true; }, 3500);
  }
  function hideTyping() { clearTimeout(typingHideTimer); typingEl.hidden = true; }

  // Отправка своего «печатает…» + приём чужого
  const typingChannel = await openTypingChannel(otherUserId, {
    onTyping: (who) => { if (chatPane.dataset.with === who.id) showTyping(who.username); },
  });
  input.addEventListener('input', () => { if (input.value.trim()) typingChannel.send(); });

  // ---------- Карточки-ссылки «📎» (вместо аудио-вложений, 2026-10-13) ----------
  let pendingRef = null;   // { type, id, title } — прикреплено к следующему сообщению
  let refCandidates = null; // { answers, questions } — кэш на поток
  const pendingSlot = chatPane.querySelector('#pending-slot');
  const pickerSlot = chatPane.querySelector('#ref-picker-slot');

  function renderPending() {
    if (!pendingRef) { pendingSlot.innerHTML = ''; return; }
    pendingSlot.innerHTML = `
      <div class="pending-audio">
        📎 ${escapeHtml(t('messages.ref_attached'))} · ${escapeHtml(pendingRef.title)}
        <button type="button" id="pending-rm" aria-label="${escapeHtml(t('common.delete'))}">✕</button>
      </div>`;
    pendingSlot.querySelector('#pending-rm').addEventListener('click', () => { pendingRef = null; renderPending(); });
  }

  function closeRefPicker() { pickerSlot.innerHTML = ''; }

  async function openRefPicker() {
    if (pickerSlot.innerHTML) { closeRefPicker(); return; }
    if (!refCandidates) refCandidates = await fetchRefCandidates();
    const state = { tab: 'answers', q: '' };
    const draw = () => {
      const items = (refCandidates[state.tab] || [])
        .filter((x) => !state.q || x.title.toLowerCase().includes(state.q.toLowerCase()));
      pickerSlot.innerHTML = `
        <div class="ref-picker" data-help="ref_picker">
          <div class="ref-picker-head">
            <span>${escapeHtml(t('messages.ref_picker_title'))}</span>
            <button type="button" id="ref-picker-close" aria-label="${escapeHtml(t('common.cancel'))}">✕</button>
          </div>
          <div class="ref-picker-tabs">
            <button type="button" class="tab-btn ${state.tab === 'answers' ? 'active' : ''}" data-tab="answers">🎧 ${escapeHtml(t('messages.ref_tab_answers'))}</button>
            <button type="button" class="tab-btn ${state.tab === 'questions' ? 'active' : ''}" data-tab="questions">💬 ${escapeHtml(t('messages.ref_tab_questions'))}</button>
          </div>
          <input type="text" id="ref-search" placeholder="${escapeHtml(t('messages.ref_search_ph'))}" value="${escapeHtml(state.q)}" autocomplete="off">
          <div class="ref-picker-list">
            ${items.length ? items.map((x, i) => `
              <button type="button" class="ref-item" data-idx="${i}" data-type="${x.type}" data-id="${escapeHtml(x.id)}">
                ${x.type === 'answer' ? '🎧' : '💬'} ${escapeHtml(x.title)}${x.type === 'answer' && x.is_solution ? ' · ✓' : ''}
              </button>`).join('')
              : `<div class="ref-picker-empty">${escapeHtml(t('messages.ref_empty'))}</div>`}
          </div>
        </div>`;
      pickerSlot.querySelector('#ref-picker-close').addEventListener('click', closeRefPicker);
      pickerSlot.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; draw(); }));
      pickerSlot.querySelector('#ref-search').addEventListener('input', (e) => { state.q = e.target.value.trim(); draw(); });
      pickerSlot.querySelectorAll('.ref-item').forEach((b) => b.addEventListener('click', () => {
        const items2 = (refCandidates[state.tab] || [])
          .filter((x) => !state.q || x.title.toLowerCase().includes(state.q.toLowerCase()));
        const picked = items2[Number(b.dataset.idx)];
        if (!picked) return;
        pendingRef = { type: picked.type, id: picked.id, title: picked.title };
        renderPending();
        closeRefPicker();
        input.focus();
      }));
    };
    draw();
  }

  chatPane.querySelector('#attach-ref-btn').addEventListener('click', () => openRefPicker());

  // ---------- Отправка ----------
  chatPane.querySelector('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content && !pendingRef) return;
    input.value = '';

    const sendBtn = e.target.querySelector('button[type="submit"]');
    sendBtn.disabled = true;
    try {
      const extra = {};
      if (pendingRef) {
        // в БД пишем только тип+id: заголовок карточки дорисует fetchRefCard
        extra.ref = { type: pendingRef.type, id: pendingRef.id };
        pendingRef = null;
        renderPending();
      }
      const msg = await sendMessage(otherUserId, content, extra);
      if (msg) appendMessage(list, msg, user.id, { scroll: true });
    } catch (err) {
      toast(err.message || 'Error', 'error');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });

  // ---------- Приём входящих (общая функция экрана) ----------
  chatPane._appendIncoming = (msg) => {
    hideTyping();
    const nearBottom = isNearBottom();
    appendMessage(list, msg, getState().user.id, { scroll: false });
    markThreadRead(msg.sender_id);
    if (nearBottom) list.scrollTop = list.scrollHeight;
    else showPill();
  };
  chatPane._showTyping = showTyping;

  // Возврат cleanup для потока
  return () => {
    typingChannel.close?.();
    clearTimeout(typingHideTimer);
    chatPane._appendIncoming = null;
    chatPane._showTyping = null;
  };
}

// ============================================================
// ВХОДЯЩИЕ СОБЫТИЯ
// ============================================================

function handleIncoming(container, msg) {
  const chatPane = container.querySelector('#chat-pane');
  const { user } = getState();
  if (!chatPane || !user || msg.sender_id === user.id) return;
  if (chatPane.dataset.with !== msg.sender_id) return;
  chatPane._appendIncoming?.(msg);
}

function handleTypingSignal(container, who) {
  const chatPane = container.querySelector('#chat-pane');
  if (!chatPane || chatPane.dataset.with !== who.id) return;
  chatPane._showTyping?.(who.username);
}

// ============================================================
// СООБЩЕНИЕ: пузырёк + карточка-ссылка + реакции + действия + превью
// ============================================================

function messageEl(m, myId) {
  const mine = m.sender_id === myId;
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${mine ? 'mine' : 'theirs'}`;
  wrap.dataset.mid = m.id;
  wrap.dataset.day = dayKey(m.created_at);
  wrap.innerHTML = `
    <div class="msg-bubble ${mine ? 'msg-out' : 'msg-in'}">
      <div class="msg-content">${escapeHtml(m.content || '')}</div>
      ${m.ref ? '<div class="msg-ref-slot"><span class="msg-ref loading">…</span></div>' : ''}
      <div class="q-previews"></div>
      <span class="msg-meta">${formatClock(m.created_at)}${m.edited_at ? ` · ${escapeHtml(t('messages.edited'))}` : ''}${mine ? (m.read ? ' ✓✓' : ' ✓') : ''}</span>
    </div>
    <div class="msg-reactions">${reactionsHtml(m.reactions, myId)}</div>
    <div class="msg-hover-actions" data-help="msg_actions">
      <button type="button" data-help="msg_react" data-act="react" aria-label="${escapeHtml(t('messages.add_reaction'))}" title="${escapeHtml(t('messages.add_reaction'))}">😀</button>
      ${mine ? `
        <button type="button" data-act="edit" aria-label="${escapeHtml(t('messages.edit'))}" title="${escapeHtml(t('messages.edit'))}">✏️</button>
        <button type="button" data-act="delete" aria-label="${escapeHtml(t('common.delete'))}" title="${escapeHtml(t('common.delete'))}">🗑</button>` : ''}
    </div>`;

  // Карточка-ссылка (question/answer/profile) — асинхронная дорисовка
  if (m.ref) attachRefCard(wrap.querySelector('.msg-ref-slot'), m.ref);

  // Превью ссылок на вопросы
  attachQuestionPreviews(wrap.querySelector('.q-previews'), m.content || '');

  // Реакции: клик по существующим чипам
  wrap.querySelector('.msg-reactions').addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-emoji]');
    if (!chip) return;
    const updated = await toggleMessageReaction(m.id, chip.dataset.emoji);
    if (updated) {
      m.reactions = updated;
      wrap.querySelector('.msg-reactions').innerHTML = reactionsHtml(updated, myId);
    }
  });

  // Ховер-действия
  wrap.querySelector('[data-act="react"]')?.addEventListener('click', () => openEmojiPop(wrap, m, myId));
  wrap.querySelector('[data-act="edit"]')?.addEventListener('click', () => startEditMessage(wrap, m));
  wrap.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (await confirmModal(t('messages.title'), t('messages.delete_confirm'))) {
      const ok = await deleteMessage(m.id);
      if (ok) wrap.remove();
    }
  });

  return wrap;
}

function reactionsHtml(reactions = [], myId) {
  if (!reactions?.length) return '';
  const groups = new Map();
  reactions.forEach((r) => {
    const g = groups.get(r.emoji) || { count: 0, mine: false };
    g.count += 1;
    if (r.user_id === myId) g.mine = true;
    groups.set(r.emoji, g);
  });
  return [...groups.entries()].map(([emoji, g]) => `
    <button type="button" class="reaction-chip ${g.mine ? 'mine' : ''}" data-emoji="${emoji}" aria-pressed="${g.mine}">
      ${emoji} <span>${g.count}</span>
    </button>`).join('');
}

function openEmojiPop(wrap, m, myId) {
  wrap.querySelector('.emoji-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  pop.innerHTML = REACTION_EMOJIS.map((e) => `<button type="button" data-e="${e}" aria-label="${e}">${e}</button>`).join('');
  wrap.appendChild(pop);
  pop.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-e]');
    if (!btn) return;
    const updated = await toggleMessageReaction(m.id, btn.dataset.e);
    if (updated) {
      m.reactions = updated;
      wrap.querySelector('.msg-reactions').innerHTML = reactionsHtml(updated, myId);
    }
    pop.remove();
  });
  const onOutside = (ev) => {
    if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', onOutside); }
  };
  setTimeout(() => document.addEventListener('click', onOutside), 0);
}

function startEditMessage(wrap, m) {
  const contentEl = wrap.querySelector('.msg-content');
  const original = m.content || '';
  contentEl.innerHTML = `
    <div class="msg-edit">
      <textarea class="edit-input" rows="2">${escapeHtml(original)}</textarea>
      <div class="msg-edit-row">
        <button type="button" class="btn btn-quiet btn-sm" data-x="cancel">${escapeHtml(t('common.cancel'))}</button>
        <button type="button" class="btn btn-primary btn-sm" data-x="save">${escapeHtml(t('common.save'))}</button>
      </div>
    </div>`;
  const ta = contentEl.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  contentEl.querySelector('[data-x="cancel"]').addEventListener('click', () => { contentEl.textContent = original; });
  contentEl.querySelector('[data-x="save"]').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;
    if (text === original) { contentEl.textContent = original; return; }
    const updated = await updateMessage(m.id, text);
    if (updated) {
      m.content = text;
      m.edited_at = updated.edited_at;
      contentEl.textContent = text;
      const meta = wrap.querySelector('.msg-meta');
      if (meta && !meta.textContent.includes(t('messages.edited'))) {
        meta.textContent = `${formatClock(m.created_at)} · ${t('messages.edited')}${m.sender_id === getState().user.id ? (m.read ? ' ✓✓' : ' ✓') : ''}`;
      }
      // Обновляем превью вопросов, если ссылка изменилась
      const previews = wrap.querySelector('.q-previews');
      previews.innerHTML = '';
      attachQuestionPreviews(previews, text);
    } else {
      contentEl.textContent = original;
      toast(t('messages.edit_failed'), 'error');
    }
  });
}

/** Добавляет сообщение в список (с проверкой разделителя даты) */
function appendMessage(list, m, myId, { scroll = false } = {}) {
  const day = dayKey(m.created_at);
  const lastWrap = [...list.querySelectorAll('.msg-wrap')].pop();
  if (!lastWrap || lastWrap.dataset.day !== day) list.appendChild(dateSepEl(m.created_at));
  list.appendChild(messageEl(m, myId));
  if (scroll) list.scrollTop = list.scrollHeight;
}

// ============================================================
// КАРТОЧКА-ССЫЛКА (messages.ref) И ПРЕВЬЮ ССЫЛОК НА ВОПРОСЫ
// ============================================================

/**
 * Дорисовывает карточку-ссылку из messages.ref в пузыре: кэш → fetchRefCard.
 * Цель исчезла — «ссылка недоступна»; вопрос purged — мини-заглушка (как q-preview).
 */
function attachRefCard(slot, ref) {
  if (!slot) return;
  const key = `${ref?.type}:${ref?.id}`;
  const build = (c) => {
    if (!c) {
      const el = document.createElement('span');
      el.className = 'msg-ref gone';
      el.textContent = `🔗 ${t('messages.ref_gone')}`;
      return el;
    }
    const a = document.createElement('a');
    a.className = `msg-ref${c.purged ? ' purged' : ''}`;
    a.href = c.href;
    a.setAttribute('data-route', '');
    if (c.purged) {
      const s = c.purge_summary || {};
      const dateStr = s.solved_at
        ? new Date(s.solved_at).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long' })
        : '';
      a.innerHTML = `
        <b>🗃️ ${escapeHtml(t('question.purged_title'))}</b>
        <span>${escapeHtml(t('question.purged_solved_on', { date: dateStr }))}${s.best_username ? ` · ${escapeHtml(t('question.purged_best_label'))} @${escapeHtml(s.best_username)}` : ''}</span>`;
    } else if (c.type === 'question') {
      a.innerHTML = `
        <b>💬 ${escapeHtml(c.title)}</b>
        <span>${escapeHtml(c.author || '?')} · ${c.status === 'solved' ? `✓ ${escapeHtml(t('feed.status_solved'))}` : escapeHtml(t('feed.status_open'))} · 💬 ${c.answers_count ?? 0}</span>`;
    } else if (c.type === 'answer') {
      a.innerHTML = `
        <b>🎧 ${escapeHtml(c.title)}</b>
        <span>${escapeHtml(t('messages.ref_answer_badge'))}${c.is_solution ? ` · ✓ ${escapeHtml(t('question.solution'))}` : ''}</span>`;
    } else {
      a.innerHTML = `<b>👤 ${escapeHtml(c.title)}</b>`;
    }
    return a;
  };
  const hit = refCardCache.get(key);
  if (hit !== undefined) { slot.innerHTML = ''; slot.appendChild(build(hit)); return; }
  fetchRefCard(ref).then((c) => {
    refCardCache.set(key, c);
    if (slot.isConnected) { slot.innerHTML = ''; slot.appendChild(build(c)); }
  });
}

function attachQuestionPreviews(el, text) {
  if (!el) return;
  const ids = [...text.matchAll(/\/question\/([a-zA-Z0-9-]+)/g)].map((mm) => mm[1]);
  [...new Set(ids)].slice(0, 3).forEach(async (id) => {
    const card = document.createElement('a');
    card.className = 'q-preview';
    card.href = `/question/${id}`;
    card.setAttribute('data-route', '');
    card.textContent = '…';
    el.appendChild(card);
    try {
      let q = questionPreviewCache.get(id);
      if (q === undefined) {
        q = await fetchQuestion(id);
        questionPreviewCache.set(id, q);
      }
      if (!q) { card.remove(); return; }
      if (q.purged) {
        // Вопрос решён и удалён по таймеру — превью становится мини-заглушкой
        const s = q.purge_summary || {};
        const dateStr = s.solved_at
          ? new Date(s.solved_at).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long' })
          : '';
        card.classList.add('purged');
        card.innerHTML = `
          <b>🗃️ ${escapeHtml(t('question.purged_title'))}</b>
          ${escapeHtml(t('question.purged_solved_on', { date: dateStr }))}${s.best_username ? ` · ${escapeHtml(t('question.purged_best_label'))} @${escapeHtml(s.best_username)}` : ''}`;
        return;
      }
      card.innerHTML = `
        <b>💬 ${escapeHtml(q.title)}</b>
        ${escapeHtml(q.author?.username || '?')} · ${q.status === 'solved' ? `✓ ${escapeHtml(t('feed.status_solved'))}` : escapeHtml(t('feed.status_open'))} · 💬 ${q.answers_count ?? 0}`;
    } catch {
      card.remove();
    }
  });
}

// ============================================================
// ДАТЫ
// ============================================================

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateSepEl(iso) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  let label;
  if (dayKey(iso) === dayKey(now.toISOString())) label = t('messages.today');
  else if (dayKey(iso) === dayKey(yesterday.toISOString())) label = t('messages.yesterday');
  else label = new Date(iso).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  const el = document.createElement('div');
  el.className = 'date-sep';
  el.textContent = label;
  return el;
}

function formatClock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
