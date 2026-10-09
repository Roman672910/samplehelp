// ============================================================
// favorites.mjs — «Избранное»: вопросы, отложенные для ответа.
// Статусы подготовки: «Готовлю материал» / «Готов к ответу».
// ============================================================

import { t, getLocale, applyTranslations } from './i18n.mjs';
import { fetchFavorites, setFavorite, setFavoriteStatus } from './supabase.mjs';
import { attachMiniPlayer } from './audio.mjs';
import { solvedChipHtml } from './question.mjs';
import { escapeHtml, timeAgo, toast } from './utils.mjs';
import { navigate } from './router.mjs';
import { getState } from './store.mjs';
import { requireAuth } from './auth.mjs';

export async function renderFavorites(container) {
  if (!getState().user) {
    container.innerHTML = `
      <div class="screen empty-state">
        <span class="empty-icon">⭐</span>
        <p>${escapeHtml(t('favorites.login_required'))}</p>
        <button type="button" class="btn btn-primary" id="fav-login" style="margin-top:16px">${escapeHtml(t('nav.login'))}</button>
      </div>`;
    container.querySelector('#fav-login').addEventListener('click', () => requireAuth());
    return;
  }

  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title" data-i18n="favorites.title"></h1>
        <p class="page-subtitle" data-i18n="favorites.subtitle"></p>
      </div>
      <div class="feed-layout" id="fav-list"><div class="loader"></div></div>
    </div>`;
  applyTranslations(container);

  const favorites = await fetchFavorites();
  const list = container.querySelector('#fav-list');

  if (!favorites.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🗂️</span>
        <p>${escapeHtml(t('favorites.empty'))}</p>
        <button type="button" class="btn btn-ghost" id="fav-goto-feed" style="margin-top:16px">${escapeHtml(t('favorites.goto_feed'))}</button>
      </div>`;
    list.querySelector('#fav-goto-feed').addEventListener('click', () => navigate('/'));
    return;
  }

  list.innerHTML = favorites.map((f) => {
    const q = f.question;
    if (q.purged) return purgedFavoriteCardHtml(q);
    const preparing = f.status === 'preparing';
    const solved = q.status === 'solved';
    return `
      <article class="card q-card" data-qid="${escapeHtml(q.id)}" style="cursor:default">
        <div class="q-card-top">
        <div>
          <h2 class="q-card-title"><a href="/question/${escapeHtml(q.id)}" data-route>${escapeHtml(q.title)}</a></h2>
          <div class="q-card-meta">
            <span class="status-badge ${preparing ? 'status-open' : 'status-solved'}">
              ${preparing ? `🛠 ${escapeHtml(t('favorites.status_preparing'))}` : `🎯 ${escapeHtml(t('favorites.status_ready'))}`}
            </span>
            ${solvedChipHtml(q)}
            <span>·</span>
            <span>${escapeHtml(timeAgo(q.created_at, getLocale()))}</span>
            ${q.synth ? `<span class="tag">${escapeHtml(q.synth)}</span>` : ''}
            <span class="counter">💬 ${q.answers_count ?? 0}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" data-act="answer" ${solved ? `disabled title="${escapeHtml(t('question.answers_closed'))}"` : ''}>✍️ ${escapeHtml(t('favorites.answer_btn'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-act="toggle-status">
              ${preparing ? escapeHtml(t('favorites.mark_ready')) : escapeHtml(t('favorites.mark_preparing'))}
            </button>
            <button type="button" class="btn btn-quiet btn-sm" data-act="remove">🗑 ${escapeHtml(t('common.delete'))}</button>
          </div>
        </div>
        <div class="q-card-audio">
          <canvas class="mini-wave" role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>
        </div>
        </div>
      </article>`;
  }).join('');

  // Мини-плееры (делегирование не нужно — attachMiniPlayer сам вешает обработчик)
  favorites.forEach((f, i) => {
    const card = list.children[i];
    const q = f.question;
    const canvas = card.querySelector('.mini-wave');
    if (canvas && q.audio_url) attachMiniPlayer(canvas, q.audio_url, q.waveform_data || [], q.markers || []);
  });

  // Действия карточек — делегирование событий
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-qid]');
    const qid = card.dataset.qid;

    if (btn.dataset.act === 'answer') {
      navigate(`/question/${qid}`);
      // После рендера — фокус на форму ответа
      setTimeout(() => {
        document.querySelector('#answer-form textarea')?.focus();
        document.querySelector('#answer-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350);
    }
    if (btn.dataset.act === 'toggle-status') {
      const next = card.querySelector('[data-act="toggle-status"]').textContent.includes(t('favorites.mark_ready')) ? 'ready' : 'preparing';
      await setFavoriteStatus(qid, next);
      renderFavorites(container);
    }
    if (btn.dataset.act === 'remove') {
      await setFavorite(qid, false);
      toast(t('favorites.removed'));
      renderFavorites(container);
    }
  });
}

/** Серая карточка вопроса, который решён и удалён по таймеру (осталась заглушка) */
function purgedFavoriteCardHtml(q) {
  const s = q.purge_summary || {};
  const dateStr = s.solved_at
    ? new Date(s.solved_at).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long' })
    : '';
  return `
    <article class="card q-card purged" data-qid="${escapeHtml(q.id)}" style="cursor:default">
      <div class="purged-fav">
        <span class="purged-icon" aria-hidden="true">🗃️</span>
        <div class="purged-fav-text">
          <div class="purged-title">${escapeHtml(t('favorites.purged_note'))}</div>
          <div class="purged-meta">
            ${escapeHtml(t('question.purged_solved_on', { date: dateStr }))}${s.best_username ? ` · ${escapeHtml(t('question.purged_best_label'))} @${escapeHtml(s.best_username)}` : ''}
          </div>
        </div>
        <span class="spacer"></span>
        <a class="btn btn-quiet btn-sm" href="/question/${escapeHtml(q.id)}" data-route>${escapeHtml(t('favorites.open_archive'))}</a>
        <button type="button" class="btn btn-quiet btn-sm" data-act="remove">🗑 ${escapeHtml(t('common.delete'))}</button>
      </div>
    </article>`;
}