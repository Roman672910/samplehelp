// ============================================================
// challenges.mjs — еженедельные челленджи:
// карточка задания с аудио, таймер обратного отсчёта,
// сетка работ участников, голосование, загрузка своей работы.
// ============================================================

import { t, getLocale, applyTranslations } from './i18n.mjs';
import {
  fetchCurrentChallenge, submitChallengeWork, voteSubmission, hasVoted, uploadAudio,
} from './supabase.mjs';
import { createPlayer, attachMiniPlayer, normalizeAudio } from './audio.mjs';
import { escapeHtml, initials, toast, openModal, uid } from './utils.mjs';
import { getState } from './store.mjs';
import { requireAuth } from './auth.mjs';

export async function renderChallenges(container) {
  container.innerHTML = `<div class="screen"><div class="loader"></div></div>`;
  const challenge = await fetchCurrentChallenge();

  if (!challenge) {
    container.innerHTML = `
      <div class="screen empty-state">
        <span class="empty-icon">🏁</span>
        <p>${escapeHtml(t('challenges.none'))}</p>
      </div>`;
    return;
  }

  const { user } = getState();
  const mySubmission = user ? challenge.submissions.find((s) => s.user_id === user.id) : null;

  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title" data-i18n="challenges.title"></h1>
        <p class="page-subtitle" data-i18n="challenges.subtitle"></p>
      </div>

      <!-- Карточка текущего челленджа -->
      <article class="card challenge-hero" style="cursor:default">
        <span class="challenge-label">⚡ ${escapeHtml(t('challenges.current'))}</span>
        <h2 class="challenge-title">${escapeHtml(challenge.title)}</h2>
        <p class="challenge-desc">${escapeHtml(challenge.description || '')}</p>

        <!-- Таймер обратного отсчёта -->
        <div class="countdown" id="countdown" role="timer" aria-label="${escapeHtml(t('challenges.ends_in'))}">
          <div class="countdown-unit"><div class="cd-value" id="cd-d">–</div><div class="cd-label" data-i18n="challenges.days"></div></div>
          <div class="countdown-unit"><div class="cd-value" id="cd-h">–</div><div class="cd-label" data-i18n="challenges.hours"></div></div>
          <div class="countdown-unit"><div class="cd-value" id="cd-m">–</div><div class="cd-label" data-i18n="challenges.minutes"></div></div>
          <div class="countdown-unit"><div class="cd-value" id="cd-s">–</div><div class="cd-label" data-i18n="challenges.seconds"></div></div>
        </div>

        <div class="card" id="challenge-player" style="background:var(--bg-input);margin-bottom:16px"></div>

        <button type="button" class="btn btn-primary" id="btn-participate" ${mySubmission ? 'disabled' : ''}>
          ${mySubmission ? `✓ ${escapeHtml(t('challenges.submitted'))}` : `🎹 ${escapeHtml(t('challenges.participate'))}`}
        </button>
      </article>

      <!-- Работы участников -->
      <section style="margin-top:28px" aria-label="${escapeHtml(t('challenges.submissions'))}">
        <h2 style="font-size:19px;margin-bottom:16px">🏆 ${escapeHtml(t('challenges.submissions'))} (${challenge.submissions.length})</h2>
        ${challenge.submissions.length ? `
          <div class="submissions-grid">
            ${challenge.submissions.map((s, i) => `
              <article class="card submission-card" data-sid="${escapeHtml(s.id)}" style="cursor:default">
                <div class="submission-head">
                  <span class="avatar sm">${escapeHtml(initials(s.profile?.username))}</span>
                  <span>${escapeHtml(s.profile?.username || '?')}</span>
                  ${i === 0 ? '<span style="margin-left:auto" title="Лидер">🥇</span>' : ''}
                </div>
                <canvas class="mini-wave" style="width:100%" role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>
                <button type="button" class="btn btn-ghost btn-sm vote-btn" data-act="vote">
                  ▲ <span class="vote-count">${s.votes_count ?? 0}</span> ${escapeHtml(t('challenges.vote'))}
                </button>
              </article>`).join('')}
          </div>`
          : `<div class="empty-state"><span class="empty-icon">🎧</span><p>${escapeHtml(t('challenges.no_submissions'))}</p></div>`}
      </section>
    </div>`;

  applyTranslations(container);

  // ---------- Плеер аудио-задания ----------
  const playerCleanup = challenge.audio_url
    ? createPlayer(container.querySelector('#challenge-player'), { url: challenge.audio_url, waveform: challenge.waveform_data || [], showSpectro: false })
    : null;

  // ---------- Таймер обратного отсчёта ----------
  const deadline = new Date(challenge.deadline).getTime();
  const tick = () => {
    const diff = Math.max(0, deadline - Date.now());
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const set = (id, v) => { const el = container.querySelector(id); if (el) el.textContent = String(v).padStart(2, '0'); };
    set('#cd-d', d); set('#cd-h', h); set('#cd-m', m); set('#cd-s', s);
  };
  tick();
  const timer = setInterval(tick, 1000);

  // ---------- Мини-плееры работ ----------
  challenge.submissions.forEach((s, i) => {
    const card = container.querySelector(`[data-sid="${s.id}"]`) || container.querySelectorAll('.submission-card')[i];
    const canvas = card?.querySelector('.mini-wave');
    if (canvas && s.audio_url) attachMiniPlayer(canvas, s.audio_url, s.waveform_data || []);
  });

  // ---------- Голосование (делегирование) ----------
  container.querySelector('.submissions-grid')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="vote"]');
    if (!btn) return;
    if (!requireAuth()) return;
    const sid = btn.closest('[data-sid]').dataset.sid;
    if (await hasVoted(sid)) { toast(t('challenges.already_voted'), 'info'); return; }
    const res = await voteSubmission(sid);
    if (res) {
      btn.querySelector('.vote-count').textContent = res.votes_count;
      btn.classList.add('voted');
      toast(t('challenges.vote_registered'));
    }
  });

  // ---------- Участвовать: загрузка своей работы ----------
  container.querySelector('#btn-participate').addEventListener('click', () => {
    if (!requireAuth()) return;
    openParticipateModal(challenge, container);
  });

  return () => {
    clearInterval(timer);
    playerCleanup?.();
  };
}

function openParticipateModal(challenge, container) {
  const content = document.createElement('div');
  content.innerHTML = `
    <p style="color:var(--text-secondary);font-size:13.5px;margin-bottom:16px">${escapeHtml(t('challenges.participate_hint'))}</p>
    <div class="field">
      <label for="work-file">${escapeHtml(t('challenges.your_work'))}</label>
      <input type="file" id="work-file" accept="audio/*">
    </div>
    <div id="work-status" style="font-size:12.5px;color:var(--text-muted);margin-bottom:14px"></div>
    <button type="button" class="btn btn-primary" id="work-submit" style="width:100%" disabled>${escapeHtml(t('challenges.submit_work'))}</button>`;

  const close = openModal({ title: t('challenges.participate'), content });
  let processedBlob = null;

  content.querySelector('#work-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = content.querySelector('#work-status');
    status.textContent = t('trimmer.normalizing');
    try {
      processedBlob = await normalizeAudio(file);
      status.textContent = `✓ ${file.name}`;
      content.querySelector('#work-submit').disabled = false;
    } catch {
      processedBlob = file; // без нормализации, если декодирование не удалось
      status.textContent = `✓ ${file.name}`;
      content.querySelector('#work-submit').disabled = false;
    }
  });

  content.querySelector('#work-submit').addEventListener('click', async () => {
    if (!processedBlob) return;
    const btn = content.querySelector('#work-submit');
    btn.disabled = true;
    try {
      const audioUrl = await uploadAudio(processedBlob, 'challenge-audio');
      await submitChallengeWork(challenge.id, audioUrl);
      toast(t('challenges.work_submitted'));
      close();
      renderChallenges(container);
    } catch (err) {
      toast(err.message || 'Error', 'error');
      btn.disabled = false;
    }
  });
}

void uid; void getLocale;
