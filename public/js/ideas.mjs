// ============================================================
// ideas.mjs — «💡 Идеи продукта» (заход 38, спека PLAN_IDEAS.md).
// Окно предложений пользователей + связь с разработчиком:
// • витрина открыта ВСЕМ (аноним читает), предлагают и голосуют залогиненные;
// • голос ▲ один на пользователя (toggle), сортировки «Топ / Новые»;
// • связь с разработчиком двуслойно: публичный ответ админа в карточке
//   (dev_reply) + кнопка «💬 Написать разработчику» → ЛС с админом (is_admin);
// • петля обратной связи захода 36: смена статуса и ответ шлют автору
//   уведомления idea_status / idea_reply (см. supabase.mjs);
// • отклонённые идеи НЕ скрываем — судьба предложения прозрачна.
// Админ-контролы: статусы new/in_work/done/rejected + поле ответа.
// ============================================================

import { t, getLocale } from './i18n.mjs';
import { escapeHtml, toast, openModal, timeAgo, confirmModal } from './utils.mjs';
import { getState } from './store.mjs';
import { requireAuth } from './auth.mjs';
import { navigate } from './router.mjs';
import {
  fetchIdeas, fetchIdeaVotesMine, createIdea, toggleIdeaVote,
  setIdeaStatus, setIdeaReply, deleteIdea, fetchDevContact,
} from './api.mjs';

// Литеральные t() по конвенции check_keys (тернарники с ключом чекер не видит)
function statusLabel(st) {
  if (st === 'in_work') return t('ideas.status_in_work');
  if (st === 'done') return t('ideas.status_done');
  if (st === 'rejected') return t('ideas.status_rejected');
  return t('ideas.status_new');
}

function ideaCardHtml(i, voted, viewer) {
  const isAdmin = !!viewer?.is_admin;
  const isAuthor = !!viewer && viewer.id === i.author_id;
  const statusBtns = ['in_work', 'done', 'rejected']
    .filter((st) => st !== i.status)
    .map((st) => `<button type="button" class="btn btn-quiet btn-sm" data-act="status" data-st="${st}">${st === 'in_work' ? '→' : st === 'done' ? '✓' : '✗'} ${escapeHtml(statusLabel(st))}</button>`)
    .join('');
  return `
  <article class="card idea-card" data-idea-id="${escapeHtml(i.id)}">
    <div class="idea-head">
      <span class="idea-status st-${escapeHtml(i.status)}">${escapeHtml(statusLabel(i.status))}</span>
      <h3 class="idea-title">${escapeHtml(i.title)}</h3>
    </div>
    <p class="idea-body">${escapeHtml(i.body).replace(/\n/g, '<br>')}</p>
    ${i.dev_reply ? `
    <div class="idea-devreply">
      <b>🛠 ${escapeHtml(t('ideas.dev_reply'))}</b>
      <p>${escapeHtml(i.dev_reply).replace(/\n/g, '<br>')}</p>
      <span class="idea-meta">${escapeHtml(timeAgo(i.dev_reply_at, getLocale()))}</span>
    </div>` : ''}
    <div class="idea-foot">
      <button type="button" class="idea-vote${voted ? ' voted' : ''}" data-act="vote" aria-pressed="${voted}" data-help="idea_vote" aria-label="${escapeHtml(t('ideas.vote'))}" title="${escapeHtml(t('ideas.vote'))}">▲ <span class="vc">${i.votes}</span></button>
      <span class="idea-meta">@${escapeHtml(i.author?.username || '?')} · ${escapeHtml(timeAgo(i.created_at, getLocale()))}</span>
      <span class="idea-actions">
        ${isAuthor ? `<button type="button" class="btn btn-quiet btn-sm" data-act="del" data-help="idea_delete">${escapeHtml(t('ideas.delete_own'))}</button>` : ''}
      </span>
    </div>
    ${isAdmin ? `
    <div class="idea-admin" data-help="idea_admin">
      <div class="idea-admin-row">${statusBtns}</div>
      <div class="idea-admin-row">
        <textarea class="idea-reply-in" rows="2" maxlength="600" placeholder="${escapeHtml(t('ideas.admin_reply_ph'))}" aria-label="${escapeHtml(t('ideas.admin_reply_ph'))}">${escapeHtml(i.dev_reply)}</textarea>
        <button type="button" class="btn btn-ghost btn-sm" data-act="reply">${escapeHtml(t('ideas.admin_reply_btn'))}</button>
      </div>
    </div>` : ''}
  </article>`;
}

/** Модалка «Предложить идею»: заголовок 3–120, описание 10–1000 */
export function openIdeaModal(onCreated) {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="field">
      <input type="text" id="idea-title" maxlength="120" placeholder="${escapeHtml(t('ideas.form_title_ph'))}" aria-label="${escapeHtml(t('ideas.form_title_ph'))}">
      <span class="row-error" id="idea-title-err" hidden></span>
    </div>
    <div class="field">
      <textarea id="idea-body" rows="4" maxlength="1000" placeholder="${escapeHtml(t('ideas.form_body_ph'))}" aria-label="${escapeHtml(t('ideas.form_body_ph'))}"></textarea>
      <span class="row-error" id="idea-body-err" hidden></span>
    </div>
    <button type="button" class="btn btn-primary" id="idea-send" style="width:100%">${escapeHtml(t('ideas.send'))}</button>`;
  openModal({
    title: t('ideas.form_title'),
    content,
    onMount: (overlay, close) => {
      content.querySelector('#idea-send').addEventListener('click', async () => {
        const titleIn = content.querySelector('#idea-title');
        const bodyIn = content.querySelector('#idea-body');
        const title = titleIn.value.trim();
        const body = bodyIn.value.trim();
        let bad = false;
        const drawErr = (input, errId, key, min) => {
          const err = content.querySelector(errId);
          const invalid = input.value.trim().length < min;
          err.hidden = !invalid;
          if (invalid) { err.textContent = t(key); input.classList.add('invalid'); bad = true; }
          else { err.textContent = ''; input.classList.remove('invalid'); }
        };
        drawErr(titleIn, '#idea-title-err', 'ideas.invalid_title', 3);
        drawErr(bodyIn, '#idea-body-err', 'ideas.invalid_body', 10);
        if (bad) return;
        const row = await createIdea({ title, body });
        if (!row) return;
        close();
        toast(t('ideas.sent'));
        onCreated?.(row);
      });
    },
  });
}

/** Экран /ideas: витрина идей + связь с разработчиком */
export async function renderIdeas(container) {
  const viewer = getState().user;
  let sort = 'top';
  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title">💡 ${escapeHtml(t('ideas.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('ideas.subtitle'))}</p>
        <button type="button" class="btn btn-primary" id="idea-suggest" data-help="idea_form">✚ ${escapeHtml(t('ideas.suggest'))}</button>
      </div>
      <div id="idea-dev-host"></div>
      <div class="sort-tabs" role="tablist" aria-label="${escapeHtml(t('ideas.title'))}">
        <button type="button" class="sort-tab active" role="tab" data-sort="top">${escapeHtml(t('ideas.tab_top'))}</button>
        <button type="button" class="sort-tab" role="tab" data-sort="new">${escapeHtml(t('ideas.tab_new'))}</button>
      </div>
      <div id="idea-list" class="idea-list"><div class="loader"></div></div>
    </div>`;

  // Блок связи с разработчиком: ЛС с админом платформы (is_admin)
  const dev = await fetchDevContact();
  const devHost = container.querySelector('#idea-dev-host');
  if (dev) {
    devHost.innerHTML = `
      <div class="idea-dev card">
        <div>
          <b>${escapeHtml(t('ideas.dev_dm_title'))}</b>
          <span class="idea-dev-hint">${escapeHtml(t('ideas.dev_dm_hint'))}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="idea-dev-dm" data-help="idea_dev_dm">${escapeHtml(t('ideas.dev_dm_btn'))}</button>
      </div>`;
    devHost.querySelector('#idea-dev-dm').addEventListener('click', () => {
      if (!requireAuth()) return;
      navigate(`/messages/${dev.id}`);
    });
  }

  const listEl = container.querySelector('#idea-list');
  async function draw() {
    listEl.innerHTML = '<div class="loader"></div>';
    const [ideas, mine] = await Promise.all([fetchIdeas(sort), fetchIdeaVotesMine()]);
    if (!ideas.length) {
      listEl.innerHTML = `<div class="empty-state"><span class="empty-icon">💡</span><p>${escapeHtml(t('ideas.empty'))}</p></div>`;
      return;
    }
    listEl.innerHTML = ideas.map((i) => ideaCardHtml(i, mine.has(i.id), viewer)).join('');
  }
  await draw();

  container.querySelector('.sort-tabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('.sort-tab');
    if (!btn || btn.dataset.sort === sort) return;
    sort = btn.dataset.sort;
    container.querySelectorAll('.sort-tab').forEach((x) => x.classList.toggle('active', x === btn));
    await draw();
  });

  container.querySelector('#idea-suggest').addEventListener('click', () => {
    if (!requireAuth()) return;
    openIdeaModal(() => draw());
  });

  // Делегирование карточек: голос / статус / ответ / удаление
  listEl.addEventListener('click', async (e) => {
    const card = e.target.closest('.idea-card');
    if (!card) return;
    const id = card.dataset.ideaId;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'vote') {
      if (!requireAuth()) return;
      const cnt = await toggleIdeaVote(id);
      if (cnt === null) return;
      const btn = card.querySelector('.idea-vote');
      const voted = !(btn.classList.contains('voted'));
      btn.classList.toggle('voted', voted);
      btn.setAttribute('aria-pressed', String(voted));
      btn.querySelector('.vc').textContent = cnt;
    }
    if (act === 'status') {
      await setIdeaStatus(id, e.target.closest('[data-act="status"]').dataset.st);
      await draw();
    }
    if (act === 'reply') {
      const text = card.querySelector('.idea-reply-in').value;
      const cleared = !text.trim();
      await setIdeaReply(id, text);
      toast(cleared ? t('ideas.admin_reply_cleared') : t('ideas.sent'));
      await draw();
    }
    if (act === 'del') {
      const yes = await confirmModal(t('ideas.delete_own'), card.querySelector('.idea-title').textContent);
      if (!yes) return;
      await deleteIdea(id);
      toast(t('ideas.deleted'));
      await draw();
    }
  });
}
