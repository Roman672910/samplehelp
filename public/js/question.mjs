// ============================================================
// question.mjs — страница вопроса + форма создания вопроса.
// • плеер с вейвформой (по реальным пикам семпла)
// • избранное, лайки, ответы, комментарии, «✓ Решение»
// • тип звука / сложность / теги указывает ОТВЕЧАЮЩИЙ
// ============================================================

import { t, tp, getLocale, applyTranslations } from './i18n.mjs';
import { CONFIG } from './config.mjs';
import {

  fetchQuestion, fetchAnswers, createAnswer, createComment,
  markSolution, toggleLike, isLiked, isInFavorites, setFavorite, fetchSubscriptions,
  toggleSubscription, uploadPreset, uploadAudio, createQuestion,
  fetchSynthCatalog, addSynthToCatalog,
  updateQuestion, deleteQuestion, updateAnswer, deleteAnswer,
  updateComment, deleteComment,
} from './supabase.mjs';
import { createPlayer, extractWaveform, normalizeAudio, createRecorder, createABPlayer, attachMiniPlayer, createMarkerPicker } from './audio.mjs';
import { createLinksWidget, normalizeLinks, linkChipHtml } from './links.mjs';
import { createTrimmer } from './trimmer.mjs';
import { plainText } from './format.mjs';
import { escapeHtml, timeAgo, initials, toast, formatTime, confirmModal, formatRemaining, daysLeft } from './utils.mjs';
import { navigate, handleRoute } from './router.mjs';
import { getState } from './store.mjs';
import { requireAuth } from './auth.mjs';
import { checkAndAward } from './achievements.mjs';
// Ссылки в комментариях и описаниях вопросов запрещены (безопасность): ловим http(s):// и www.
const LINK_RE = /(https?:\/\/|www\.)/i;

/** Типы звука — выбираются в форме ОТВЕТА */
export const SOUND_TYPES = ['Bass', 'Pad', 'Lead', 'FX', 'Pluck', 'Drums', 'Keys', 'Vocal', 'Other'];

/**
 * Природа звука — грубая категория, которую выбирает СПРАШИВАЮЩИЙ.
 * Точный тип (Bass/Pad/…) определяет отвечающий: спрашивающий может
 * не знать рецепт, но почти всегда знает природу («вокал с ревером = FX»).
 */
export const SOUND_CATEGORIES = [
  { id: 'synth', icon: '🎹' },
  { id: 'fx', icon: '🌀' },
  { id: 'drums', icon: '🥁' },
  { id: 'sample', icon: '🎞️' },
  { id: 'unknown', icon: '❓' },
];
export function categoryMeta(id) {
  return SOUND_CATEGORIES.find((c) => c.id === id) || null;
}

// ============================================================
// СТРАНИЦА ВОПРОСА
// ============================================================

export async function renderQuestion(container, { id }) {
  const question = await fetchQuestion(id);
  if (!question) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">🔇</span><p>${escapeHtml(t('question.not_found'))}</p></div>`;
    return;
  }

  // Архивная заглушка: содержимое удалено через 7 дней после решения
  if (question.purged) {
    renderTombstone(container, question);
    return;
  }

  const { user } = getState();
  const isOwner = user && user.id === question.user_id;
  const solved = question.status === 'solved';

  const [answers, liked, fav, subs] = await Promise.all([
    fetchAnswers(id),
    isLiked('question', id),
    isInFavorites(id),
    user ? fetchSubscriptions().catch(() => []) : Promise.resolve([]),
  ]);

  const subscribed = question.author && user && question.author.id !== user.id
    ? subs.some((s) => s.target_type === 'author' && s.target_id === question.user_id)
    : false;

  // Автор решения — для подписи рядом со статусом «✓ Решён»
  const solution = answers.find((a) => a.is_solution);
  const solvedByHtml = solution
    ? `${escapeHtml(t('common.solved_by'))} <a href="/profile/${escapeHtml(solution.user_id)}" data-route>${escapeHtml((solution.author || solution.profiles)?.username || '?')}</a>`
    : '';

  // Аудио вопроса — для A/B-сравнения в ответах.
  // ВАЖНО: объявить ДО шаблона (используется в answers.map внутри innerHTML)
  const questionAudio = question.audio_url
    ? { url: question.audio_url, waveform: question.waveform_data || [] }
    : null;

  container.innerHTML = `
    <div class="screen question-layout">
      <div class="question-main">
        ${solved ? purgeBannerHtml(question, isOwner) : ''}
        <!-- Шапка вопроса -->
        <article class="card" style="cursor:default">
          <div class="question-head">
            <h1 class="question-title">${escapeHtml(question.title)}</h1>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span class="status-badge ${question.status === 'solved' ? 'status-solved' : 'status-open'}">
                ${question.status === 'solved' ? `✓ ${escapeHtml(t('feed.status_solved'))}` : escapeHtml(t('feed.status_open'))}
              </span>
              <span class="solved-by" id="q-solved-by" ${solution ? '' : 'hidden'}>${solvedByHtml}</span>
            </div>
          </div>
          <div class="question-author">
            <a href="/profile/${escapeHtml(question.user_id)}" data-route class="avatar" aria-hidden="true">${question.author?.avatar_url ? `<img src="${escapeHtml(question.author.avatar_url)}" alt="">` : escapeHtml(initials(question.author?.username))}</a>
            <div>
              <a href="/profile/${escapeHtml(question.user_id)}" data-route>${escapeHtml(question.author?.username || '?')}</a>
              <div style="font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono)">${escapeHtml(timeAgo(question.created_at, getLocale()))}${question.edited_at ? ` · <span class="edited-mark">${escapeHtml(t('common.edited_mark'))}</span>` : ''}</div>
            </div>
            ${question.category && question.category !== 'unknown' && categoryMeta(question.category) ? `<span class="tag category-tag">${categoryMeta(question.category).icon} ${escapeHtml(t(`ask.category_${question.category}`))}</span>` : ''}
            ${question.synth ? `<span class="tag" style="margin-left:4px">${escapeHtml(question.synth)}</span>` : ''}
            ${question.author && question.author.id !== user?.id ? `
            <button type="button" class="btn btn-ghost btn-sm" id="btn-follow" style="margin-left:auto" aria-pressed="${subscribed}">
              ${subscribed ? `✓ ${escapeHtml(t('profile.following'))}` : `＋ ${escapeHtml(t('profile.follow'))}`}
            </button>` : ''}
            ${isOwner ? `
            <span class="owner-actions" style="margin-left:auto">
              <button type="button" class="icon-btn-sm" id="btn-edit-q" title="${escapeHtml(t('common.edit'))}" aria-label="${escapeHtml(t('common.edit'))}">✏️</button>
              <button type="button" class="icon-btn-sm danger" id="btn-delete-q" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">🗑</button>
            </span>` : ''}
          </div>
          <p class="question-body">${plainText(question.description || '')}</p>

          <!-- Плеер (только вейвформа) -->
          <div class="card player-card" id="q-player" style="background:var(--bg-input)"></div>
        </article>

        <!-- Ответы -->
        <section class="answers-section" aria-label="${escapeHtml(t('question.answers'))}">
          <div class="answers-head">
            <h2>${escapeHtml(t('question.answers'))} (${answers.length})</h2>
          </div>
          <div id="answers-list" class="answers-list">${answers.map((a) => answerCardHtml(a, isOwner, question.user_id, questionAudio)).join('') || `<div class="empty-state"><span class="empty-icon">🎹</span><p>${escapeHtml(t('question.no_answers'))}</p></div>`}</div>

          <!-- Форма ответа (закрыта, если вопрос решён) -->
          ${solved ? answersClosedHtml() : answerFormHtml()}
        </section>
      </div>

      <!-- Сайдбар -->
      <aside class="question-sidebar">
        <div class="card sidebar-block">
          <h3>${escapeHtml(t('question.actions'))}</h3>
          <div style="display:flex;flex-direction:column;gap:10px">
            <button type="button" class="btn ${liked ? 'btn-primary' : 'btn-ghost'}" id="btn-like-q" aria-pressed="${liked}">
              🔥 <span id="like-q-count">${question.likes_count ?? 0}</span> ${escapeHtml(t('question.like'))}
            </button>
            <button type="button" class="btn ${fav ? 'btn-primary' : 'btn-ghost'}" id="btn-fav" aria-pressed="${fav}" ${solved ? `disabled title="${escapeHtml(t('question.fav_closed_hint'))}"` : ''}>
              ${fav ? '★' : '⭐'} <span>${escapeHtml(fav ? t('question.in_favorites') : t('question.add_to_favorites'))}</span>
            </button>
            <button type="button" class="btn btn-quiet" id="btn-share">🔗 ${escapeHtml(t('common.share'))}</button>
          </div>
        </div>

        <div class="card sidebar-block">
          <h3>${escapeHtml(t('question.stats'))}</h3>
          <div class="stat-row"><span>${escapeHtml(t('question.answers'))}</span><b>${answers.length}</b></div>
          <div class="stat-row"><span>${escapeHtml(t('question.likes'))}</span><b>${question.likes_count ?? 0}</b></div>
          <div class="stat-row"><span>${escapeHtml(t('question.status'))}</span><b>${question.status === 'solved' ? '✓' : '…'}</b></div>
        </div>
      </aside>
    </div>`;

  // ---------- Плеер ----------
  const playerCleanup = question.audio_url
    ? createPlayer(container.querySelector('#q-player'), {
        url: question.audio_url,
        waveform: question.waveform_data || [],
        markers: question.markers || [],
      })
    : null;

  // ---------- Баннер решённого вопроса: обратный отсчёт до удаления ----------
  let bannerTimer = null;
  const banner = container.querySelector('#purge-banner');
  if (banner) {
    const textEl = banner.querySelector('#purge-text');
    const tick = () => {
      const rem = formatRemaining(banner.dataset.purgeAt, getLocale());
      textEl.textContent = rem ? t('question.solved_banner', { time: rem }) : t('question.purge_soon');
    };
    bannerTimer = setInterval(tick, 30000); // раз в 30 секунд — точность до минут
  }

  // ---------- «Отменить решение» (только автор вопроса) ----------
  container.querySelector('#btn-unresolve')?.addEventListener('click', async () => {
    if (!(await confirmModal(t('question.unresolve'), t('question.unresolve_confirm')))) return;
    try {
      await markSolution(null, id);
      toast(t('question.unresolved_toast'));
      handleRoute(); // таймер снят, кнопки снова активны — перерисовываем страницу
    } catch (err) {
      toast(err.message || 'Error', 'error');
    }
  });

  // ---------- Лайк вопроса ----------
  container.querySelector('#btn-like-q').addEventListener('click', async () => {
    if (!requireAuth()) return;
    const res = await toggleLike('question', id);
    if (res) {
      container.querySelector('#like-q-count').textContent = res.likes_count;
      const btn = container.querySelector('#btn-like-q');
      btn.classList.toggle('btn-primary', res.liked);
      btn.classList.toggle('btn-ghost', !res.liked);
      btn.setAttribute('aria-pressed', String(res.liked));
    }
  });

  // ---------- Избранное ----------
  container.querySelector('#btn-fav').addEventListener('click', async () => {
    if (solved) return; // решённые вопросы в избранное не добавляются
    if (!requireAuth()) return;
    const nowFav = !(await isInFavorites(id));
    const ok = await setFavorite(id, nowFav);
    const btn = container.querySelector('#btn-fav');
    btn.classList.toggle('btn-primary', ok);
    btn.classList.toggle('btn-ghost', !ok);
    btn.querySelector('span').textContent = ok ? t('question.in_favorites') : t('question.add_to_favorites');
    btn.firstChild.textContent = ok ? '★ ' : '⭐ ';
    toast(ok ? t('favorites.added') : t('favorites.removed'));
    if (ok) checkAndAward('curator');
  });

  // ---------- Поделиться ----------
  container.querySelector('#btn-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast(t('common.link_copied'));
    } catch {
      toast(location.href, 'info', 6000);
    }
  });

  // ---------- Подписка на автора ----------
  container.querySelector('#btn-follow')?.addEventListener('click', async () => {
    if (!requireAuth()) return;
    const nowSub = await toggleSubscription('author', question.user_id);
    const btn = container.querySelector('#btn-follow');
    btn.innerHTML = nowSub ? `✓ ${escapeHtml(t('profile.following'))}` : `＋ ${escapeHtml(t('profile.follow'))}`;
    btn.setAttribute('aria-pressed', String(nowSub));
    toast(nowSub ? t('subscriptions.subscribed_author') : t('subscriptions.unsubscribed'));
  });

  // ---------- Правка/удаление своего вопроса ----------
  container.querySelector('#btn-edit-q')?.addEventListener('click', () => {
    navigate(`/ask?edit=${encodeURIComponent(id)}`);
  });
  container.querySelector('#btn-delete-q')?.addEventListener('click', async () => {
    if (!(await confirmModal(t('common.delete'), t('question.delete_confirm')))) return;
    try {
      await deleteQuestion(id);
      toast(t('common.deleted'));
      navigate('/');
    } catch (err) {
      toast(err.message || 'Error', 'error');
    }
  });

  // ---------- Действия в ответах (делегирование) ----------
  attachAnswerAudioPlayers(container);

  /** Перечитать ответы и обновить всё на месте: список, счётчики, статус, «решение: …» */
  async function refreshAnswersBlock() {
    const fresh = await fetchAnswers(id);
    const solved = fresh.some((a) => a.is_solution);
    // Статус решения изменился не через чип «✓ Решение» (например, удалён
    // ответ-решение) — жизненный цикл страницы изменился, перерисовываем целиком
    if (solved !== (question.status === 'solved')) { handleRoute(); return; }
    const listEl = container.querySelector('#answers-list');
    if (listEl) {
      listEl.innerHTML = fresh.map((a) => answerCardHtml(a, isOwner, question.user_id, questionAudio)).join('')
        || `<div class="empty-state"><span class="empty-icon">🎹</span><p>${escapeHtml(t('question.no_answers'))}</p></div>`;
      attachAnswerAudioPlayers(listEl);
    }
    const head = container.querySelector('.answers-head h2');
    if (head) head.textContent = `${t('question.answers')} (${fresh.length})`;
    const badge = container.querySelector('.question-head .status-badge');
    if (badge) {
      badge.className = `status-badge ${solved ? 'status-solved' : 'status-open'}`;
      badge.textContent = solved ? `✓ ${t('feed.status_solved')}` : t('feed.status_open');
    }
    // Подпись «решение: <автор>» рядом со статусом
    const solBy = container.querySelector('#q-solved-by');
    if (solBy) {
      const sol = fresh.find((a) => a.is_solution);
      if (solved && sol) {
        const author = sol.author || sol.profiles;
        solBy.innerHTML = `${escapeHtml(t('common.solved_by'))} <a href="/profile/${escapeHtml(sol.user_id)}" data-route>${escapeHtml(author?.username || '?')}</a>`;
        solBy.hidden = false;
      } else {
        solBy.hidden = true;
      }
    }
    // Статистика в сайдбаре: ответы + статус
    const statValues = container.querySelectorAll('.sidebar-block .stat-row b');
    if (statValues[0]) statValues[0].textContent = String(fresh.length);
    if (statValues[2]) statValues[2].textContent = solved ? '✓' : '…';
  }

  bindAnswersEvents(container, id, {
    questionAudio,
    // Пометка «✓ Решение», правка/удаление ответа — без полной перерисовки
    // (скролл не прыгает, плеер не перезапускается)
    onRerender: refreshAnswersBlock,
    onAnswersChanged: refreshAnswersBlock,
    // Отметка/снятие решения меняет весь жизненный цикл страницы
    // (баннер с отсчётом, закрытая форма, кнопки) — перерисовываем целиком
    onSolutionToggled: () => { handleRoute(); },
  });

  // ---------- Форма ответа ----------
  const answerFormCleanup = initAnswerForm(container, question);

  return () => {
    if (bannerTimer) clearInterval(bannerTimer);
    playerCleanup?.();
    answerFormCleanup?.();
  };
}

/** Привязывает мини-плееры к аудио-вложениям ответов внутри root */
export function attachAnswerAudioPlayers(root) {
  root.querySelectorAll('canvas[data-answer-audio]').forEach((cv) => {
    if (cv.dataset.bound) return;
    cv.dataset.bound = '1';
    try {
      attachMiniPlayer(cv, cv.dataset.answerAudio, JSON.parse(cv.dataset.wave || '[]'), JSON.parse(cv.dataset.markers || '[]'));
    } catch { /* некорректные данные вейвформы */ }
  });
}

/** Обработчики ответов/комментариев — используются и на странице вопроса, и в ленте */
export function bindAnswersEvents(root, questionId, { onRerender = null, onAnswersChanged = null, onSolutionToggled = null, questionAudio = null } = {}) {
  const answersList = root.querySelector('.answers-list');
  if (!answersList) return;
  // Делегирование переживает замену innerHTML, поэтому вешаем ОДИН раз
  // НА ЭЛЕМЕНТ СПИСКА (не на контейнер!):
  // • страница вопроса при каждом рендере создаёт НОВЫЙ .answers-list —
  //   ему нужен свежий слушатель (иначе вторая открытая за сессию страница
  //   осталась бы неинтерактивной)
  // • лента при перерисовке ответов ПЕРЕИСПОЛЬЗУЕТ старый .answers-list —
  //   повторные вызовы приводили к двойному срабатыванию действий
  //   (A/B открывался и сразу закрывался), поэтому здесь — пропуск
  if (answersList._eventsBound) return;
  answersList._eventsBound = true;

  /** Перечитать список ответов после изменений (правка/удаление/решение) */
  async function refreshList() {
    if (onAnswersChanged) { await onAnswersChanged(); return; }
    if (onRerender) { await onRerender(); return; }
    renderQuestion(root.closest('.screen')?.parentElement || root, { id: questionId });
  }

  answersList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.answer-card');
    const answerId = card.dataset.answerId;
    const act = btn.dataset.act;

    if (act === 'like') {
      if (!requireAuth()) return;
      const res = await toggleLike('answer', answerId);
      if (res) {
        btn.querySelector('.like-count').textContent = res.likes_count;
        btn.classList.toggle('active', res.liked);
        btn.setAttribute('aria-pressed', String(res.liked));
        if (res.liked) checkAndAward('on_fire');
      }
    }

    if (act === 'solution') {
      const isNowSolution = btn.dataset.value !== 'true';
      await markSolution(isNowSolution ? answerId : null, questionId);
      toast(isNowSolution ? t('question.solution_marked') : t('question.solution_unmarked'));
      // Решение включает жизненный цикл вопроса (таймер удаления, закрытие
      // ответов) — экраны с onSolutionToggled перерисовываются целиком
      if (onSolutionToggled) { await onSolutionToggled(isNowSolution); return; }
      // Мгновенное обновление статусов без перезагрузки страницы
      if (onRerender) await onRerender(isNowSolution);
      else if (onAnswersChanged) await onAnswersChanged();
      else renderQuestion(root.closest('.screen')?.parentElement || root, { id: questionId });
    }

    // ---------- Правка своего ответа (инлайн-форма внутри карточки) ----------
    if (act === 'edit-answer') {
      if (card.classList.contains('editing')) return;
      card.classList.add('editing');
      const editor = document.createElement('div');
      editor.className = 'answer-edit';
      editor.innerHTML = `
        <div class="field">
          <textarea class="edit-content" rows="6" aria-label="${escapeHtml(t('question.add_answer'))}">${escapeHtml(card.dataset.content || '')}</textarea>
        </div>
        <div class="form-row">
          <div class="field">
            <label>${escapeHtml(t('answer.sound_type'))}</label>
            <select class="edit-type">
              <option value="">—</option>
              ${SOUND_TYPES.map((s) => `<option value="${s}" ${card.dataset.soundType === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>${escapeHtml(t('answer.difficulty'))}</label>
            <select class="edit-difficulty">
              <option value="">—</option>
              <option value="beginner" ${card.dataset.difficulty === 'beginner' ? 'selected' : ''}>${escapeHtml(t('feed.difficulty_beginner'))}</option>
              <option value="intermediate" ${card.dataset.difficulty === 'intermediate' ? 'selected' : ''}>${escapeHtml(t('feed.difficulty_intermediate'))}</option>
              <option value="advanced" ${card.dataset.difficulty === 'advanced' ? 'selected' : ''}>${escapeHtml(t('feed.difficulty_advanced'))}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>${escapeHtml(t('answer.tags'))}</label>
          <input type="text" class="edit-tags" placeholder="${escapeHtml(t('answer.tags_ph'))}" value="${escapeHtml(JSON.parse(card.dataset.tags || '[]').join(', '))}">
        </div>
        <div class="field">
          <label>🔗 ${escapeHtml(t('question.links_label'))}</label>
          <div class="links-mount edit-links-mount"></div>
        </div>
        <div class="hint">${escapeHtml(t('answer.edit_audio_hint'))}</div>
        <div style="display:flex;gap:10px;margin-top:10px">
          <button type="button" class="btn btn-primary btn-sm edit-save">${escapeHtml(t('common.save'))}</button>
          <button type="button" class="btn btn-quiet btn-sm edit-cancel">${escapeHtml(t('common.cancel'))}</button>
        </div>`;
      card.appendChild(editor);
      const ta = editor.querySelector('.edit-content');
      // Виджет ссылок: стартуем из сохранённых (нормализованных) данных карточки
      const editLinksWidget = createLinksWidget(editor.querySelector('.edit-links-mount'), {
        links: normalizeLinks(JSON.parse(card.dataset.links || '[]')),
      });
      ta.focus();

      editor.querySelector('.edit-cancel').addEventListener('click', () => {
        card.classList.remove('editing');
        editor.remove();
      });
      editor.querySelector('.edit-save').addEventListener('click', async () => {
        const content = ta.value.trim();
        if (!content) { toast(t('question.answer_required'), 'error'); return; }
        const linksCheck = editLinksWidget.validate();
        if (!linksCheck.ok) { toast(linksCheck.message, 'error'); return; }
        const saveBtn = editor.querySelector('.edit-save');
        saveBtn.disabled = true;
        try {
          await updateAnswer(answerId, {
            content,
            sound_type: editor.querySelector('.edit-type').value || null,
            difficulty: editor.querySelector('.edit-difficulty').value || null,
            tags: editor.querySelector('.edit-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
            links: editLinksWidget.getValue(),
          });
          toast(t('common.saved'));
          await refreshList();
        } catch (err) {
          toast(err.message || 'Error', 'error');
          saveBtn.disabled = false;
        }
      });
      return; // не идём дальше — клик внутри редактора обрабатывается сам
    }

    // ---------- Удаление своего ответа ----------
    if (act === 'delete-answer') {
      if (!(await confirmModal(t('common.delete'), t('answer.delete_confirm')))) return;
      try {
        await deleteAnswer(answerId);
        toast(t('common.deleted'));
        await refreshList();
      } catch (err) {
        toast(err.message || 'Error', 'error');
      }
    }

    // ---------- Правка своего комментария (инлайн) ----------
    if (act === 'edit-comment') {
      const item = btn.closest('.comment-item');
      if (!item || item.querySelector('.comment-edit')) return;
      const textEl = item.querySelector('.comment-text');
      // Исходный текст с маркерами форматирования храним в data-content
      const original = item.dataset.content || '';
      textEl.hidden = true;
      const editor = document.createElement('div');
      editor.className = 'comment-edit';
      editor.innerHTML = `
        <textarea rows="2" aria-label="${escapeHtml(t('question.add_comment'))}">${escapeHtml(original)}</textarea>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button type="button" class="btn btn-primary btn-sm c-save">${escapeHtml(t('common.save'))}</button>
          <button type="button" class="btn btn-quiet btn-sm c-cancel">${escapeHtml(t('common.cancel'))}</button>
        </div>`;
      item.querySelector('.comment-body').appendChild(editor);
      const cta = editor.querySelector('textarea');
      cta.focus();
      cta.setSelectionRange(cta.value.length, cta.value.length);
      editor.querySelector('.c-cancel').addEventListener('click', () => {
        editor.remove();
        textEl.hidden = false;
      });
      editor.querySelector('.c-save').addEventListener('click', async () => {
        const text = cta.value.trim();
        if (!text) return;
        if (LINK_RE.test(text)) { toast(t('question.comment_links_banned'), 'error'); return; }
        try {
          await updateComment(item.dataset.commentId, text);
          item.dataset.content = text;
          editor.remove();
          textEl.hidden = false;
          textEl.innerHTML = plainText(text);
          const dateEl = item.querySelector('.comment-date');
          if (dateEl && !dateEl.querySelector('.edited-mark')) {
            dateEl.insertAdjacentHTML('beforeend', ` · <span class="edited-mark">${escapeHtml(t('common.edited_mark'))}</span>`);
          }
          toast(t('common.saved'));
        } catch (err) {
          toast(err.message || 'Error', 'error');
        }
      });
    }

    // ---------- Удаление своего комментария ----------
    if (act === 'delete-comment') {
      if (!(await confirmModal(t('common.delete'), t('question.comment_delete_confirm')))) return;
      const item = btn.closest('.comment-item');
      try {
        await deleteComment(item.dataset.commentId);
        item.remove();
        const countEl = card.querySelector('.comments-count');
        if (countEl) countEl.textContent = String(Math.max(0, Number(countEl.textContent) - 1));
        toast(t('common.deleted'));
      } catch (err) {
        toast(err.message || 'Error', 'error');
      }
    }

    if (act === 'ab' && questionAudio) {
      // A/B-сравнение: вопрос (A) против аудио этого ответа (B)
      const slot = card.querySelector('.ab-slot');
      if (!slot) return;
      if (!slot.dataset.built) {
        // Сначала показываем слот: канвасы должны получить реальный размер,
        // иначе вейвформы отрисуются нулевой ширины («плеер не работает»)
        slot.hidden = false;
        const canvas = card.querySelector('[data-answer-audio]');
        createABPlayer(slot, {
          a: { url: questionAudio.url, waveform: questionAudio.waveform || [], label: t('question.ab_a') },
          b: {
            url: canvas.dataset.answerAudio,
            waveform: JSON.parse(canvas.dataset.wave || '[]'),
            label: t('question.ab_b'),
          },
        });
        slot.dataset.built = '1';
      } else {
        slot.hidden = !slot.hidden;
      }
      btn.setAttribute('aria-expanded', String(!slot.hidden));
    }

    // ---------- Отправка комментария ----------
    if (act === 'add-comment') {
      if (!requireAuth()) return;
      const input = card.querySelector('.comment-input');
      const text = input.value.trim();
      if (!text) return;
      if (LINK_RE.test(text)) { toast(t('question.comment_links_banned'), 'error'); return; }
      try {
        const comment = await createComment({ answer_id: answerId, content: text });
        const list = card.querySelector('.comments-list');
        const item = document.createElement('div');
        item.innerHTML = commentItemHtml(comment);
        list.appendChild(item.firstElementChild);
        input.value = '';
        card.querySelector('.comments-count').textContent = String(Number(card.querySelector('.comments-count').textContent) + 1);
        checkAndAward('commenter');
      } catch (err) {
        toast(err.message || 'Error', 'error');
      }
    }
  });

  // Enter для отправки комментария
  answersList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('comment-input')) {
      e.target.closest('.comment-form').querySelector('[data-act="add-comment"]').click();
    }
  });
}

// ---------- HTML-фрагменты ----------

export function answerCardHtml(a, isQuestionOwner, questionUserId = null, questionAudio = null) {
  const author = a.author || a.profiles;
  const comments = a.comments || [];
  const answerLinks = normalizeLinks(a.links);
  // Селф-ответ: автор вопроса ответил сам себе — subtly подсвечиваем
  const isSelf = questionUserId != null && a.user_id === questionUserId;
  const isOwnAnswer = getState().user && getState().user.id === a.user_id;
  const metaTags = [
    a.sound_type ? `<span class="tag">${escapeHtml(a.sound_type)}</span>` : '',
    a.difficulty ? `<span class="tag difficulty-${escapeHtml(a.difficulty)}">${escapeHtml(t(`feed.difficulty_${a.difficulty}`))}</span>` : '',
    ...(a.tags || []).slice(0, 4).map((tg) => `<span class="tag">#${escapeHtml(tg)}</span>`),
  ].join('');

  return `
    <article class="card answer-card ${a.is_solution ? 'solution' : ''} ${isSelf ? 'self-answer' : ''}" data-answer-id="${escapeHtml(a.id)}"
      data-content="${escapeHtml(a.content || '')}"
      data-sound-type="${escapeHtml(a.sound_type || '')}"
      data-difficulty="${escapeHtml(a.difficulty || '')}"
      data-tags="${escapeHtml(JSON.stringify(a.tags || []))}"
      data-links="${escapeHtml(JSON.stringify(answerLinks))}"
      style="cursor:default">
      ${a.is_solution ? `<span class="solution-badge">✓ ${escapeHtml(t('question.solution'))}</span>` : ''}
      <div class="answer-head">
        <a href="/profile/${escapeHtml(a.user_id)}" data-route class="avatar sm" aria-hidden="true">${author?.avatar_url ? `<img src="${escapeHtml(author.avatar_url)}" alt="">` : escapeHtml(initials(author?.username))}</a>
        <a href="/profile/${escapeHtml(a.user_id)}" data-route class="author-name">${escapeHtml(author?.username || '?')}</a>
        ${isSelf ? `<span class="author-badge" title="${escapeHtml(t('question.author_badge'))}">${escapeHtml(t('question.author_badge'))}</span>` : ''}
        <span class="answer-date">${escapeHtml(timeAgo(a.created_at, getLocale()))}${a.edited_at ? ` · <span class="edited-mark">${escapeHtml(t('common.edited_mark'))}</span>` : ''}</span>
      </div>
      <div class="answer-content">${plainText(a.content)}</div>
      ${metaTags ? `<div class="tags-row">${metaTags}</div>` : ''}
      ${a.audio_url ? `
      <div class="answer-audio">
        <canvas class="mini-wave" data-answer-audio="${escapeHtml(a.audio_url)}" data-wave='${escapeHtml(JSON.stringify(a.waveform_data || []))}' data-markers='${escapeHtml(JSON.stringify(a.markers || []))}' role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>
        ${questionAudio ? `<button type="button" class="toggle-chip" data-act="ab" aria-expanded="false">🎧 ${escapeHtml(t('question.ab_compare'))}</button>` : ''}
      </div>
      <div class="ab-slot" hidden></div>` : ''}
      ${answerLinks.length ? `
        <div class="answer-links">
          ${answerLinks.map((l) => linkChipHtml(l)).join('')}
        </div>` : ''}
      ${a.preset_url ? `<a class="answer-preset" href="${escapeHtml(a.preset_url)}" download="${escapeHtml(a.preset_name || 'preset')}" aria-label="${escapeHtml(t('question.download_preset'))}">📎 ${escapeHtml(a.preset_name || t('question.preset'))}</a>` : ''}
      <div class="answer-actions">
        <button type="button" class="toggle-chip" data-act="like" aria-pressed="false">🔥 <span class="like-count">${a.likes_count ?? 0}</span></button>
        <span class="toggle-chip static" aria-label="${escapeHtml(t('question.comments'))}">💬 <span class="comments-count">${comments.length}</span></span>
        ${isQuestionOwner ? `
          <button type="button" class="toggle-chip" data-act="solution" data-value="${a.is_solution}" ${a.is_solution ? 'style="color:var(--copper-3);border-color:var(--border-active)"' : ''}>
            ✓ ${escapeHtml(t('question.mark_solution'))}
          </button>` : ''}
        ${isOwnAnswer ? `
          <span class="spacer"></span>
          <button type="button" class="icon-btn-sm" data-act="edit-answer" title="${escapeHtml(t('common.edit'))}" aria-label="${escapeHtml(t('common.edit'))}">✏️</button>
          <button type="button" class="icon-btn-sm danger" data-act="delete-answer" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">🗑</button>` : ''}
      </div>
      <!-- Комментарии всегда раскрыты -->
      <div class="comments-block">
        <div class="comments-list">
          ${comments.map((c) => commentItemHtml(c)).join('')}
        </div>
        <div class="comment-form">
          <input type="text" class="comment-input" placeholder="${escapeHtml(t('question.comment_placeholder'))}" aria-label="${escapeHtml(t('question.add_comment'))}">
          <button type="button" class="btn btn-ghost btn-sm" data-act="add-comment">${escapeHtml(t('common.send'))}</button>
        </div>
      </div>
    </article>`;
}

/** HTML одного комментария (общий для стартового рендера и динамической вставки) */
export function commentItemHtml(c) {
  const isOwnComment = getState().user && getState().user.id === c.user_id;
  return `
    <div class="comment-item" data-comment-id="${escapeHtml(c.id)}" data-content="${escapeHtml(c.content || '')}">
      <span class="avatar sm" aria-hidden="true">${c.author?.avatar_url ? `<img src="${escapeHtml(c.author.avatar_url)}" alt="">` : escapeHtml(initials(c.author?.username))}</span>
      <div class="comment-body">
        <div class="comment-head">
          <span class="comment-author">${escapeHtml(c.author?.username || '?')}</span>
          <span class="comment-date">${escapeHtml(timeAgo(c.created_at, getLocale()))}${c.edited_at ? ` · <span class="edited-mark">${escapeHtml(t('common.edited_mark'))}</span>` : ''}</span>
          ${isOwnComment ? `
            <span class="comment-actions">
              <button type="button" class="icon-btn-sm" data-act="edit-comment" title="${escapeHtml(t('common.edit'))}" aria-label="${escapeHtml(t('common.edit'))}">✏️</button>
              <button type="button" class="icon-btn-sm danger" data-act="delete-comment" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">🗑</button>
            </span>` : ''}
        </div>
        <div class="comment-text">${plainText(c.content)}</div>
      </div>
    </div>`;
}

function answerFormHtml() {
  return `
    <form class="card answer-form" id="answer-form" novalidate>
      <h3>✍️ <span>${escapeHtml(t('question.add_answer'))}</span></h3>
      <div class="field">
        <textarea id="ans-content" rows="5" required placeholder="${escapeHtml(t('question.answer_placeholder'))}" aria-label="${escapeHtml(t('question.add_answer'))}"></textarea>
      </div>

      <!-- Что это за звук — определяет отвечающий -->
      <div class="form-row">
        <div class="field">
          <label for="ans-type">${escapeHtml(t('answer.sound_type'))}</label>
          <select id="ans-type">
            <option value="">—</option>
            ${SOUND_TYPES.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="ans-difficulty">${escapeHtml(t('answer.difficulty'))}</label>
          <select id="ans-difficulty">
            <option value="">—</option>
            <option value="beginner">${escapeHtml(t('feed.difficulty_beginner'))}</option>
            <option value="intermediate">${escapeHtml(t('feed.difficulty_intermediate'))}</option>
            <option value="advanced">${escapeHtml(t('feed.difficulty_advanced'))}</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label for="ans-tags">${escapeHtml(t('answer.tags'))}</label>
        <input type="text" id="ans-tags" placeholder="${escapeHtml(t('answer.tags_ph'))}">
      </div>

      <div class="field">
        <label>🎧 ${escapeHtml(t('answer.audio_label'))}</label>
        <div class="audio-source-row">
          <button type="button" class="btn btn-ghost btn-sm" id="ans-file-btn">📁 ${escapeHtml(t('ask.choose_file'))}</button>
          <span id="ans-rec-slot"></span>
        </div>
        <input type="file" id="ans-audio" accept="audio/*" hidden>
        <div id="ans-pending"></div>
        <div id="ans-markers-mount"></div>
        <div class="hint">${escapeHtml(t('answer.audio_hint'))}</div>
      </div>
      <div class="field">
        <label for="ans-preset">📎 ${escapeHtml(t('question.upload_preset'))} <span style="color:var(--text-muted)">(.fxb/.fxp/.json)</span></label>
        <input type="file" id="ans-preset" accept=".fxb,.fxp,.json">
      </div>
      <div class="field">
        <label>🔗 ${escapeHtml(t('question.links_label'))}</label>
        <div class="links-mount" id="ans-links-mount"></div>
      </div>
      <button type="submit" class="btn btn-primary">${escapeHtml(t('question.submit_answer'))}</button>
    </form>`;
}

// ============================================================
// ЖИЗНЕННЫЙ ЦИКЛ РЕШЁННОГО ВОПРОСА (UI)
// ============================================================

/** Баннер «Вопрос решён. Удаление через 6 дн 23 ч» + «Отменить решение» для автора */
function purgeBannerHtml(q, isOwner) {
  const remaining = q.purge_at ? formatRemaining(q.purge_at, getLocale()) : null;
  const text = remaining ? t('question.solved_banner', { time: remaining }) : t('question.purge_soon');
  return `
    <div class="purge-banner" id="purge-banner" data-purge-at="${escapeHtml(q.purge_at || '')}" role="status">
      <span class="purge-icon" aria-hidden="true">✅</span>
      <span class="purge-text" id="purge-text">${escapeHtml(text)}</span>
      ${isOwner ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-unresolve">↩ ${escapeHtml(t('question.unresolve'))}</button>` : ''}
    </div>`;
}

/** Плашка вместо формы ответа у решённого вопроса */
function answersClosedHtml() {
  return `
    <div class="card answers-closed">
      <span aria-hidden="true">🔒</span>
      <span>${escapeHtml(t('question.answers_closed'))}</span>
    </div>`;
}

/**
 * Страница-заглушка («надгробие») вопроса, удалённого по таймеру.
 * Старые ссылки из чатов/избранного ведут сюда: видно только архивную
 * справку — когда решён, сколько было ответов и кто автор лучшего.
 */
function renderTombstone(container, q) {
  const s = q.purge_summary || {};
  const dateStr = s.solved_at
    ? new Date(s.solved_at).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long' })
    : '';
  const bestHtml = s.best_username ? `
    <p class="tomb-best">
      ${escapeHtml(t('question.purged_best_label'))}
      <a href="/profile/${escapeHtml(s.best_user_id || '')}" data-route>@${escapeHtml(s.best_username)}</a>
      <span class="tomb-rep">(${escapeHtml(t('question.purged_best_rep', { rep: s.rep ?? CONFIG.SOLUTION_REP }))})</span>
    </p>` : '';
  container.innerHTML = `
    <div class="screen tombstone-screen">
      <div class="card tombstone">
        <div class="tomb-icon" aria-hidden="true">🗃️</div>
        <h1 class="tomb-title">${escapeHtml(t('question.purged_title'))}</h1>
        <p class="tomb-line">
          ${escapeHtml(t('question.purged_solved_on', { date: dateStr }))} · ${escapeHtml(tp('question.answers_n', s.answers_count ?? 0))}
        </p>
        ${bestHtml}
        <p class="tomb-note">${escapeHtml(t('question.purged_note'))}</p>
        <a class="btn btn-ghost" href="/" data-route>← ${escapeHtml(t('nav.feed'))}</a>
      </div>
    </div>`;
}

/** Компактный чип «Решено · 6 дн» для карточек (лента/избранное) — экспорт для feed.mjs */
export function solvedChipHtml(q) {
  if (q.status !== 'solved' || q.purged || !q.purge_at) return '';
  return `<span class="status-badge status-purge" title="${escapeHtml(t('question.solved_badge_hint'))}">⏳ ${escapeHtml(t('feed.solved_in', { time: `${daysLeft(q.purge_at)} ${t('common.day_short')}` }))}</span>`;
}

function initAnswerForm(container, question) {
  const form = container.querySelector('#answer-form');
  if (!form) return null; // форма не рендерится для решённых вопросов
  let presetFile = null;
  let answerAudio = null; // { blob, peaks, duration, label }
  let markerPicker = null; // пикер маркеров «вот этот момент» (≤ CONFIG.MAX_MARKERS)

  // Форматирование в ответах отключено: текст простой, ссылки — через виджет 🔗
  // Виджет типизированных ссылок (URL + вид, максимум 3)
  const linksWidget = createLinksWidget(form.querySelector('#ans-links-mount'));

  form.querySelector('#ans-preset').addEventListener('change', (e) => {
    presetFile = e.target.files[0] || null;
  });

  // ---------- Аудио «ваш вариант звука»: файл или микрофон ----------
  const pendingSlot = form.querySelector('#ans-pending');
  const markersMount = form.querySelector('#ans-markers-mount');
  const renderPending = () => {
    // Пикер маркеров живёт только вместе с прикреплённым аудио
    markerPicker?.destroy();
    markerPicker = null;
    markersMount.innerHTML = '';
    if (!answerAudio) { pendingSlot.innerHTML = ''; return; }
    pendingSlot.innerHTML = `
      <div class="pending-audio" style="border-top:none;padding:8px 0 0">
        🎧 ${escapeHtml(t('messages.audio_pending'))} · ${answerAudio.label}
        <button type="button" id="ans-pending-rm" aria-label="${escapeHtml(t('common.delete'))}">✕</button>
      </div>`;
    pendingSlot.querySelector('#ans-pending-rm').addEventListener('click', () => {
      answerAudio = null;
      renderPending();
    });
    markerPicker = createMarkerPicker(markersMount, {
      blob: answerAudio.blob,
      peaks: answerAudio.peaks,
      duration: answerAudio.duration,
      max: CONFIG.MAX_MARKERS,
    });
  };

  async function handleAnswerAudio(blob) {
    try {
      const normalized = await normalizeAudio(blob);
      const { peaks, duration } = await extractWaveform(normalized);
      answerAudio = { blob: normalized, peaks, duration, label: formatTime(duration) };
      renderPending();
    } catch (e) {
      console.error('[answer] audio:', e);
      toast(t('trimmer.error'), 'error');
    }
  }

  form.querySelector('#ans-file-btn').addEventListener('click', () => form.querySelector('#ans-audio').click());
  form.querySelector('#ans-audio').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleAnswerAudio(file);
  });
  const micRecorder = createRecorder(form.querySelector('#ans-rec-slot'), {
    source: 'mic',
    label: '🎙',
    onRecorded: handleAnswerAudio,
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireAuth()) return;
    const content = form.querySelector('#ans-content').value.trim();
    if (!content) { toast(t('question.answer_required'), 'error'); return; }

    const linksCheck = linksWidget.validate();
    if (!linksCheck.ok) { toast(linksCheck.message, 'error'); return; }
    const links = linksWidget.getValue();
    const tags = form.querySelector('#ans-tags').value.split(',').map((s) => s.trim()).filter(Boolean);

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      let preset_url = null, preset_name = null;
      if (presetFile) {
        preset_url = await uploadPreset(presetFile);
        preset_name = presetFile.name;
      }
      let audio_url = null, waveform_data = null;
      if (answerAudio) {
        audio_url = await uploadAudio(answerAudio.blob, 'question-audio');
        waveform_data = answerAudio.peaks;
      }
      await createAnswer({
        question_id: question.id,
        content,
        links,
        tags,
        sound_type: form.querySelector('#ans-type').value || null,
        difficulty: form.querySelector('#ans-difficulty').value || null,
        preset_url,
        preset_name,
        audio_url,
        waveform_data,
        // Маркеры «вот этот момент» — только вместе с аудио ответа
        markers: audio_url && markerPicker ? markerPicker.getValue() : [],
      });
      toast(t('question.answer_posted'));
      checkAndAward('first_answer');
      checkAndAward('helper');
      if (presetFile) checkAndAward('generous');
      renderQuestion(container, { id: question.id });
    } catch (err) {
      toast(err.message || 'Error', 'error');
      submitBtn.disabled = false;
    }
  });

  return () => { micRecorder.destroy?.(); markerPicker?.destroy(); markerPicker = null; };
}

// ============================================================
// СОЗДАНИЕ ВОПРОСА (загрузка + обрезка аудио)
// Тип звука / сложность / теги НЕ спрашиваем — мы не знаем,
// что это за звук; их укажет отвечающий.
// ============================================================

// Черновик формы /ask: роутер на смену языка (i18n:changed) полностью
// перерисовывает экран, из-за чего введённый текст и обработанное аудио
// терялись. Черновик живёт в памяти модуля до публикации или «Отмены»
// (переживает смену языка и уход с экрана). editId разделяет режимы
// «новый вопрос» (null) и «правка» (id вопроса).
let askDraft = null;

// Счётчик незавершённых загрузок исходного аудио (режим правки):
// «Очистить»/замена источника/новая перерисовка делают текущую загрузку недействительной
let audioLoadSeq = 0;

function seedAskDraft(editId, editing) {
  askDraft = {
    editId,
    title: editing?.title || '',
    description: editing?.description || '',
    synth: editing?.synth || '',      // значение select (включая '__other__')
    customSynth: '',                  // текст поля «свой синтезатор»
    category: editing?.category || 'unknown',
    audioBlob: null,                  // аудио в триммере (нормализованное)
    trim: null,                       // { start, end, markers } из trimmer.getState()
    // ---- правка существующего вопроса ----
    origAudioUrl: editing?.audio_url || null, // какое аудио было в БД на входе в форму
    origMarkers: normMarkers(editing?.markers),
    audioReplaced: false,             // загрузили/захватили НОВОЕ аудио взамен исходного
    audioRemoved: false,              // исходное аудио очистили и ничем не заменили
  };
}

/** Маркеры к единому формату [{ time: сек, note }] — как хранит БД/триммер */
function normMarkers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && Number.isFinite(+m.time))
    .slice(0, CONFIG.MAX_MARKERS || 2)
    .map((m) => ({ time: +(+m.time).toFixed(3), note: m.note || '' }));
}

/** Совпадают ли наборы маркеров (время с точностью до мс + заметка) */
function sameMarkers(a, b) {
  const x = normMarkers(a), y = normMarkers(b);
  if (x.length !== y.length) return false;
  const byTime = (p, q) => p.time - q.time;
  x.sort(byTime); y.sort(byTime);
  return x.every((m, i) => Math.abs(m.time - y[i].time) < 0.002 && m.note === y[i].note);
}

/** Регион отличается от «весь клип» (значит, аудио надо пересохранить файлом) */
function regionChanged(st) {
  if (!st) return true;
  const maxLen = CONFIG.TRIM_MAX_SECONDS || 7;
  const fullEnd = Math.min(st.duration, maxLen);
  return st.start > 0.02 || st.end < fullEnd - 0.02;
}

export async function renderAskQuestion(container) {
  if (!getState().user) { navigate('/', { replace: true }); return; }

  // Режим правки: /ask?edit=<id> — только свой вопрос
  const editParam = new URLSearchParams(location.search).get('edit');
  let editing = null;
  if (editParam) {
    editing = await fetchQuestion(editParam);
    if (!editing || editing.user_id !== getState().user.id) { navigate('/', { replace: true }); return; }
  }
  const editId = editing ? editing.id : null;

  // Черновик: инициализируем при первом входе в этот режим;
  // при перерисовке (смена языка / возврат на экран) — оставляем как есть
  if (!askDraft || askDraft.editId !== editId) seedAskDraft(editId, editing);
  const draft = askDraft;

  const synths = await fetchSynthCatalog();

  container.innerHTML = `
    <div class="screen" style="max-width:720px;margin:0 auto">
      <div class="page-head">
        <h1 class="page-title">${escapeHtml(editing ? t('ask.edit_title') : t('ask.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(editing ? t('ask.edit_subtitle') : t('ask.subtitle'))}</p>
      </div>
      <form class="card" id="ask-form" style="cursor:default" novalidate>
        <div class="field">
          <label for="ask-title">${escapeHtml(t('ask.question_title'))}</label>
          <input type="text" id="ask-title" required maxlength="120" placeholder="${escapeHtml(t('ask.title_ph'))}" value="${escapeHtml(draft.title)}">
        </div>
        <div class="field">
          <label for="ask-desc">${escapeHtml(t('ask.description'))}</label>
          <textarea id="ask-desc" rows="4" placeholder="${escapeHtml(t('ask.desc_ph'))}">${escapeHtml(draft.description)}</textarea>
        </div>
        <div class="field">
          <label for="ask-synth">${escapeHtml(t('ask.synth'))}</label>
          <div style="display:flex;gap:8px">
            <select id="ask-synth" style="flex:1">
              <option value="">${escapeHtml(t('ask.synth_unknown'))}</option>
              ${synths.map((s) => `<option value="${escapeHtml(s)}" ${draft.synth === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
              <option value="__other__" ${draft.synth === '__other__' ? 'selected' : ''}>${escapeHtml(t('ask.synth_other'))}</option>
            </select>
            <button type="button" class="btn btn-ghost" id="btn-add-synth" hidden aria-label="${escapeHtml(t('ask.add_custom_synth'))}">＋</button>
          </div>
          <div id="custom-synth-row" class="field" style="margin-top:8px;display:none">
            <input type="text" id="custom-synth-input" placeholder="${escapeHtml(t('ask.custom_synth_ph'))}" maxlength="40" value="${escapeHtml(draft.customSynth)}">
            <div class="hint">${escapeHtml(t('ask.custom_synth_hint'))}</div>
          </div>
        </div>

        <div class="field">
          <label for="ask-category">${escapeHtml(t('ask.category'))}</label>
          <select id="ask-category">
            ${SOUND_CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === draft.category ? 'selected' : ''}>${c.icon} ${escapeHtml(t(`ask.category_${c.id}`))}</option>`).join('')}
          </select>
          <div class="hint">${escapeHtml(t('ask.category_hint'))}</div>
        </div>

        <div class="field">
          <label for="ask-audio">${escapeHtml(t('ask.audio_upload'))}</label>
          <div class="audio-source-row">
            <button type="button" class="btn btn-ghost btn-sm" id="ask-file-btn">📁 ${escapeHtml(t('ask.choose_file'))}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ask-capture-btn">⏺ ${escapeHtml(t('ask.capture_btn'))}</button>
            <button type="button" class="btn btn-quiet btn-sm" id="ask-clear-audio" hidden>✕ ${escapeHtml(t('ask.clear_audio'))}</button>
          </div>
          <input type="file" id="ask-audio" accept="audio/*" hidden>
          <div id="capture-slot"></div>
          ${editing ? `<div class="hint" style="color:var(--copper-2)">${escapeHtml(editing.audio_url ? t('ask.audio_replace_hint') : t('ask.audio_add_hint'))}</div>` : ''}
          <div class="hint">${escapeHtml(t('ask.audio_hint'))}</div>
          <div class="hint" style="color:var(--copper-2)">${escapeHtml(t('ask.capture_hint'))}</div>
        </div>

        <!-- Триммер появится здесь после выбора файла -->
        <div id="trimmer-slot"></div>

        <div style="display:flex;gap:12px;margin-top:8px">
          <button type="submit" class="btn btn-primary">${escapeHtml(editing ? t('common.save') : t('ask.submit'))}</button>
          <button type="button" class="btn btn-quiet" id="ask-cancel">${escapeHtml(t('common.cancel'))}</button>
        </div>
      </form>
    </div>`;

  const form = container.querySelector('#ask-form');
  const audioInput = form.querySelector('#ask-audio');
  const trimmerSlot = form.querySelector('#trimmer-slot');
  const synthSelect = form.querySelector('#ask-synth');
  const addSynthBtn = form.querySelector('#btn-add-synth');
  const customRow = form.querySelector('#custom-synth-row');
  const customInput = form.querySelector('#custom-synth-input');
  const titleInput = form.querySelector('#ask-title');
  const descInput = form.querySelector('#ask-desc');
  const categorySelect = form.querySelector('#ask-category');
  const fileBtn = form.querySelector('#ask-file-btn');
  const captureBtn = form.querySelector('#ask-capture-btn');
  const clearAudioBtn = form.querySelector('#ask-clear-audio');
  const captureSlot = form.querySelector('#capture-slot');
  let trimmer = null;
  let captureRecorder = null;

  // ---- Черновик: сохраняем значения полей при вводе ----
  titleInput.addEventListener('input', () => { draft.title = titleInput.value; });
  descInput.addEventListener('input', () => { draft.description = descInput.value; });
  customInput.addEventListener('input', () => { draft.customSynth = customInput.value; });
  synthSelect.addEventListener('change', () => { draft.synth = synthSelect.value; });
  categorySelect.addEventListener('change', () => { draft.category = categorySelect.value; });

  // ---- Блокировка кнопок источника, пока аудио обрабатывается/добавлено ----
  function setAudioLocked(locked) {
    fileBtn.disabled = locked;
    captureBtn.disabled = locked;
    const hint = locked ? t('ask.audio_locked_hint') : '';
    fileBtn.title = hint;
    captureBtn.title = hint;
    clearAudioBtn.hidden = !locked;
  }

  function destroyCaptureRecorder() {
    captureRecorder?.destroy();
    captureRecorder = null;
    captureSlot.innerHTML = '';
  }

  // ---- «Очистить аудио»: заменить загруженное/захваченное другим ----
  clearAudioBtn.addEventListener('click', async () => {
    const ok = await confirmModal(t('ask.clear_audio'), t('ask.clear_audio_confirm'));
    if (!ok) return;
    audioLoadSeq++; // незавершённая загрузка исходного аудио (правка) больше не нужна
    trimmer?.destroy();
    trimmer = null;
    trimmerSlot.innerHTML = '';
    destroyCaptureRecorder();
    draft.audioBlob = null;
    draft.trim = null;
    draft.audioReplaced = false;
    // Правка: исходное аудио убрали и ничем не заменили — при сохранении
    // вопрос останется БЕЗ аудио (форма — источник правды)
    draft.audioRemoved = !!(editing && draft.origAudioUrl);
    setAudioLocked(false);
    toast(t('ask.audio_cleared'));
  });

  // ---- Черновик: восстанавливаем состояние после перерисовки экрана ----
  function applyDraft() {
    // «Другой» синтезатор — показать «+» и поле ввода
    if (draft.synth === '__other__') {
      addSynthBtn.hidden = false;
      customRow.style.display = 'block';
    } else if (draft.synth) {
      // Синтезатора нет в справочнике (правка вопроса со своим вариантом) —
      // добавляем опцией, чтобы значение не потерялось
      if (![...synthSelect.options].some((o) => o.value === draft.synth)) {
        const opt = document.createElement('option');
        opt.value = draft.synth;
        opt.textContent = draft.synth;
        synthSelect.insertBefore(opt, synthSelect.querySelector('option[value="__other__"]'));
      }
      synthSelect.value = draft.synth;
    }
    // Аудио из черновика: триммер с сохранённым регионом и маркерами
    if (draft.audioBlob) {
      setAudioLocked(true);
      trimmerSlot.innerHTML = '';
      trimmer = createTrimmer(trimmerSlot, draft.audioBlob, draft.trim);
    }
  }
  applyDraft();

  // ---- Правка: исходное аудио вопроса загружается В ТРИММЕР ----
  // Всё как при создании: вейвформа, маркеры (можно подвинуть), обрезка региона.
  // Файл при сохранении не загружается заново, если ничего не тронуто (см. submit).
  async function loadExistingAudio() {
    const mySeq = ++audioLoadSeq;
    const slot = trimmerSlot; // перерисовка экрана заменит DOM — пишем только в свой
    const stale = () => mySeq !== audioLoadSeq || askDraft !== draft;
    setAudioLocked(true);
    slot.innerHTML = `<div class="loader" aria-label="${escapeHtml(t('ask.loading_audio'))}"></div>
      <p style="text-align:center;color:var(--text-muted);font-size:12.5px">${escapeHtml(t('ask.loading_audio'))}</p>`;
    try {
      const res = await fetch(editing.audio_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (stale()) return; // за время загрузки очистили/заменили/перерисовали экран
      slot.innerHTML = '';
      trimmer?.destroy();
      trimmer = createTrimmer(slot, blob, { markers: draft.origMarkers.map((m) => ({ ...m })) });
      draft.audioBlob = blob;
      draft.trim = null; // регион — весь клип, маркеры триммер взял из initialState
    } catch (e) {
      console.error('[ask] existing audio load failed:', e);
      if (stale()) return;
      slot.innerHTML = `<p style="color:#e06a5a;font-size:13px">${escapeHtml(t('trimmer.error'))}</p>`;
      setAudioLocked(false);
    }
  }
  if (editing?.audio_url && !draft.audioBlob && !draft.audioRemoved) void loadExistingAudio();

  container.querySelector('#ask-cancel').addEventListener('click', () => {
    askDraft = null; // «Отмена» — черновик больше не нужен
    navigate(editing ? `/question/${editing.id}` : '/');
  });

  // «Другой» синтезатор → показываем «+» и поле ввода
  synthSelect.addEventListener('change', () => {
    const isOther = synthSelect.value === '__other__';
    addSynthBtn.hidden = !isOther;
    customRow.style.display = isOther ? 'block' : 'none';
    if (isOther) customInput.focus();
  });

  // «+» — добавить свой синтезатор в общий справочник
  addSynthBtn.addEventListener('click', async () => {
    const name = customInput.value.trim();
    if (!name) { toast(t('ask.custom_synth_required'), 'error'); return; }
    const ok = await addSynthToCatalog(name);
    if (ok) {
      // Добавляем в список и выбираем
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      synthSelect.insertBefore(opt, synthSelect.querySelector('option[value="__other__"]'));
      synthSelect.value = name;
      addSynthBtn.hidden = true;
      customRow.style.display = 'none';
      customInput.value = '';
      draft.synth = name;       // value присвоен программно — change не сработал
      draft.customSynth = '';
      toast(t('ask.custom_synth_added'));
    }
  });

  // Загрузка файла → нормализация → триммер (общий конвейер для файла и захвата)
  async function processAudioSource(blobOrFile) {
    // Кнопки источника блокируются сразу: и на время нормализации, и пока аудио на экране
    audioLoadSeq++; // гасим незавершённую загрузку исходного аудио (правка)
    setAudioLocked(true);
    trimmerSlot.innerHTML = `<div class="loader" aria-label="${escapeHtml(t('trimmer.normalizing'))}"></div>
      <p style="text-align:center;color:var(--text-muted);font-size:12.5px">${escapeHtml(t('trimmer.normalizing'))}</p>`;
    try {
      const normalized = await normalizeAudio(blobOrFile);
      trimmerSlot.innerHTML = '';
      trimmer?.destroy();
      trimmer = createTrimmer(trimmerSlot, normalized);
      // В черновик: нормализованный blob переживёт перерисовку экрана (смена языка)
      draft.audioBlob = normalized;
      draft.trim = null; // новое аудио — состояние трима с нуля
      draft.audioReplaced = true;  // это НОВОЕ аудио (в правке — замена исходного)
      draft.audioRemoved = false;
    } catch (e) {
      console.error('[ask] audio processing failed:', e);
      trimmerSlot.innerHTML = `<p style="color:#e06a5a;font-size:13px">${escapeHtml(t('trimmer.error'))}</p>`;
      draft.audioBlob = null;
      draft.trim = null;
      setAudioLocked(false);
    }
  }

  fileBtn.addEventListener('click', () => audioInput.click());
  audioInput.addEventListener('change', () => {
    const file = audioInput.files[0];
    if (file) processAudioSource(file);
    audioInput.value = '';
  });

  // Захват звука с компьютера (вкладка с музыкой / система).
  // singleShot: после записи/отмены рекордер убирает свой UI целиком —
  // его idle-кнопка «⏺ Захват с компьютера» не дублирует внешнюю кнопку
  captureBtn.addEventListener('click', () => {
    destroyCaptureRecorder();
    captureRecorder = createRecorder(captureSlot, {
      source: 'display',
      singleShot: true,
      label: `⏺ ${t('ask.capture_btn')}`,
      readyText: t('ask.capture_ready'),
      startLabel: t('ask.capture_start'),
      maxSeconds: CONFIG.CAPTURE_MAX_SECONDS || 27,
      autoStart: true,
      onRecorded: (blob) => processAudioSource(blob),
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.querySelector('#ask-title').value.trim();
    if (!title) { toast(t('ask.title_required'), 'error'); return; }
    const description = form.querySelector('#ask-desc').value.trim();
    if (LINK_RE.test(description)) { toast(t('ask.links_banned'), 'error'); return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      let synth = synthSelect.value;
      if (synth === '__other__') synth = customInput.value.trim();
      const payload = {
        title,
        description,
        synth,
        category: form.querySelector('#ask-category').value || 'unknown',
      };

      // Аудио: при создании — что дали (может быть пусто).
      // При правке в триммере может лежать ИСХОДНЫЙ клип из БД — тогда
      // файл не загружается заново, пока его не тронули: подвинули только маркеры
      // → обновляем markers; обрезали регион → новый файл + пики + маркеры;
      // ничего не меняли → аудио-поля вообще не попадают в patch.
      if (trimmer) {
        const holdsOriginal = !!(editing && draft.origAudioUrl && !draft.audioReplaced);
        const st = trimmer.getState(); // null, пока аудио не декодировано
        if (holdsOriginal && st && !regionChanged(st)) {
          const result = await trimmer.getResult(); // маркеры относительно клипа
          if (!sameMarkers(result.markers, draft.origMarkers)) {
            payload.markers = result.markers || [];
          } // иначе аудио не тронуто — ничего не отправляем
        } else {
          const result = await trimmer.getResult(); // обрезанный + нормализованный blob
          payload.audio_url = await uploadAudio(result.blob, 'question-audio');
          payload.waveform_data = (await extractWaveform(result.blob)).peaks; // реальные пики
          payload.markers = result.markers || []; // «вот этот момент» + заметка
        }
      } else if (!editing || draft.audioRemoved) {
        // Без аудио: новый вопрос, либо правка, где исходное аудио очистили
        payload.audio_url = null;
        payload.waveform_data = null;
        payload.markers = [];
      }

      if (editing) {
        await updateQuestion(editing.id, payload);
        toast(t('ask.updated'));
        askDraft = null; // опубликовано — черновик больше не нужен
        navigate(`/question/${editing.id}`);
        return;
      }

      payload.user_id = getState().user.id;
      const q = await createQuestion(payload);
      checkAndAward('melomaniac');
      toast(t('ask.created'));
      askDraft = null; // опубликовано — черновик больше не нужен
      navigate(`/question/${q.id}`);
    } catch (err) {
      toast(err.message || 'Error', 'error');
      btn.disabled = false;
    }
  });

  // При уходе с экрана (в т.ч. перерисовка на смену языка) — сохранить
  // состояние триммера в черновик, остановить захват и разобрать триммер
  return () => {
    if (trimmer) {
      const s = trimmer.getState();
      if (s && askDraft === draft) draft.trim = s;
      trimmer.destroy();
      trimmer = null;
    }
    destroyCaptureRecorder();
  };
}

void applyTranslations; void formatTime;