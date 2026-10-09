// ============================================================
// feed.mjs — лента вопросов (главный экран).
// • клик по карточке раскрывает ответы и комментарии прямо
//   под карточкой (аккордеон)
// • клик по аватару/имени → профиль пользователя
// • клик по заголовку → страница вопроса
// • кнопка «Ответить» → страница вопроса (форма ответа)
// Сортировка: новые / популярные / без ответа.
// ============================================================

import { t, getLocale, applyTranslations } from './i18n.mjs';
import { fetchFeed, fetchAnswers, fetchAnswersForQuestions, fetchFavorites, setFavorite, isInFavorites, deleteQuestion, fetchQuestion } from './supabase.mjs';
import { attachMiniPlayer } from './audio.mjs';
import { answerCardHtml, bindAnswersEvents, attachAnswerAudioPlayers, categoryMeta, solvedChipHtml } from './question.mjs';
import { stripFormat } from './format.mjs';
import { escapeHtml, timeAgo, initials, toast, confirmModal } from './utils.mjs';
import { navigate } from './router.mjs';
import { requireAuth } from './auth.mjs';
import { getState } from './store.mjs';
import { checkAndAward } from './achievements.mjs';

let currentSort = 'new';
const answersCache = new Map(); // questionId -> answers[]

export async function renderFeed(container) {
  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title">${escapeHtml(t('feed.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('feed.subtitle'))}</p>
      </div>
      <div class="sort-tabs" role="tablist" aria-label="${escapeHtml(t('feed.sort_aria'))}">
        <button type="button" class="sort-tab ${currentSort === 'new' ? 'active' : ''}" role="tab" aria-selected="${currentSort === 'new'}" data-sort="new">${escapeHtml(t('feed.sort_new'))}</button>
        <button type="button" class="sort-tab ${currentSort === 'popular' ? 'active' : ''}" role="tab" aria-selected="${currentSort === 'popular'}" data-sort="popular">${escapeHtml(t('feed.sort_popular'))}</button>
        <button type="button" class="sort-tab ${currentSort === 'unanswered' ? 'active' : ''}" role="tab" aria-selected="${currentSort === 'unanswered'}" data-sort="unanswered">${escapeHtml(t('feed.sort_unanswered'))}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" id="feed-ask">＋ <span>${escapeHtml(t('nav.ask'))}</span></button>
      </div>
      <div class="feed-layout" id="feed-list"><div class="loader"></div></div>
    </div>`;

  // Переключение сортировки (делегирование)
  container.querySelector('.sort-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-tab');
    if (!btn) return;
    currentSort = btn.dataset.sort;
    renderFeed(container);
  });

  container.querySelector('#feed-ask').addEventListener('click', () => {
    if (!requireAuth()) return;
    navigate('/ask');
  });

  // Вопросы и избранное (для звёздочек) грузим параллельно — один сетевой раунд
  const { user } = getState();
  const [questions, favs] = await Promise.all([
    fetchFeed(currentSort),
    user ? fetchFavorites().catch(() => []) : Promise.resolve([]),
  ]);
  const list = container.querySelector('#feed-list');

  if (!questions.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🎧</span><p>${escapeHtml(t('feed.no_questions'))}</p></div>`;
    return;
  }

  const favIds = new Set(favs.map((f) => f.question_id || f.question?.id));

  list.innerHTML = questions.map((q) => questionCardHtml(q, favIds.has(q.id))).join('');

  // Мини-плееры + раскрытие ответов + переходы
  questions.forEach((q, i) => {
    const card = list.children[i];
    const canvas = card.querySelector('.mini-wave');
    if (canvas && q.audio_url) attachMiniPlayer(canvas, q.audio_url, q.waveform_data || [], q.markers || []);
    wireCard(card, q);
  });

  // Предзагрузка ответов для всех карточек — в фоне, не блокирует отрисовку.
  // К моменту клика данные уже в кэше → раскрытие мгновенное.
  // Заодно подписываем решённые вопросы именем автора решения.
  questions.forEach((q) => answersCache.delete(q.id)); // сброс устаревшего
  fetchAnswersForQuestions(questions.map((q) => q.id))
    .then((byQuestion) => {
      byQuestion.forEach((answersForQ, qid) => {
        answersCache.set(qid, answersForQ);
        const card = list.querySelector(`[data-qid="${qid}"]`);
        const q = questions.find((x) => x.id === qid);
        if (card && q) fillSolvedBy(card, q.status, answersForQ);
      });
    })
    .catch(() => { /* клик догрузит сам */ });
}

/** Подпись «решение: <автор>» рядом со статусом решённого вопроса */
function fillSolvedBy(card, status, answers) {
  const el = card.querySelector('.solved-by');
  if (!el) return;
  const sol = status === 'solved' ? (answers || []).find((a) => a.is_solution) : null;
  if (sol) {
    const author = sol.author || sol.profiles;
    el.innerHTML = `${escapeHtml(t('common.solved_by'))} <a href="/profile/${escapeHtml(sol.user_id)}" data-route>${escapeHtml(author?.username || '?')}</a>`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

/** HTML карточки вопроса */
function questionCardHtml(q, fav = false) {
  const solved = q.status === 'solved';
  const { user } = getState();
  const isMine = !!(user && user.id === q.user_id);
  return `
    <article class="card clickable q-card" data-qid="${escapeHtml(q.id)}" tabindex="0" aria-label="${escapeHtml(q.title)}">
      <div class="q-card-top">
        <div>
          <h2 class="q-card-title"><a href="/question/${escapeHtml(q.id)}" data-route>${escapeHtml(q.title)}</a></h2>
          <p class="q-card-desc">${escapeHtml(stripFormat(q.description || ''))}</p>
          <div class="q-card-meta">
            <a href="/profile/${escapeHtml(q.user_id)}" data-route class="avatar sm" aria-label="${escapeHtml(t('profile.open'))}">${q.author?.avatar_url ? `<img src="${escapeHtml(q.author.avatar_url)}" alt="">` : escapeHtml(initials(q.author?.username))}</a>
            <a href="/profile/${escapeHtml(q.user_id)}" data-route class="meta-author">${escapeHtml(q.author?.username || '?')}</a>
            <span>·</span>
            <span>${escapeHtml(timeAgo(q.created_at, getLocale()))}</span>
            ${q.category && q.category !== 'unknown' && categoryMeta(q.category) ? `<span class="tag category-tag">${categoryMeta(q.category).icon} ${escapeHtml(t(`ask.category_${q.category}`))}</span>` : ''}
            ${q.synth ? `<span class="tag">${escapeHtml(q.synth)}</span>` : ''}
            <span class="counter">🔥 ${q.likes_count ?? 0}</span>
            <span class="expand-hint"><span class="chevron">▾</span></span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;align-items:flex-end">
          <div class="card-status-row">
            <span class="status-badge ${solved ? 'status-solved' : 'status-open'}">${solved ? `✓ ${escapeHtml(t('feed.status_solved'))}` : escapeHtml(t('feed.status_open'))}</span>
            ${solvedChipHtml(q)}
            <span class="answers-chip ${q.answers_count ? 'has' : 'none'}" aria-label="${escapeHtml(t('question.answers'))}: ${q.answers_count ?? 0}">
              ${q.answers_count ? `💬 ${q.answers_count}` : escapeHtml(t('feed.no_answers_short'))}
            </span>
          </div>
          <span class="solved-by" hidden></span>
          <div class="q-card-audio">
            <canvas class="mini-wave" role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>
          </div>
        </div>
      </div>

      <!-- Постоянная строка действий: видна всегда (у решённых — неактивна) -->
      <div class="q-card-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="answer" ${solved ? `disabled title="${escapeHtml(t('question.answers_closed'))}"` : ''}>✍️ ${escapeHtml(t('feed.answer_btn'))}</button>
        <button type="button" class="btn btn-ghost btn-sm fav-btn ${fav ? 'star-on' : ''}" data-act="fav" aria-pressed="${fav}" ${solved ? `disabled title="${escapeHtml(t('question.fav_closed_hint'))}"` : ''}>
          <span class="fav-icon">${fav ? '★' : '⭐'}</span> <span class="fav-label">${escapeHtml(fav ? t('question.in_favorites') : t('question.add_to_favorites'))}</span>
        </button>
        ${isMine ? `
          <span class="spacer"></span>
          <button type="button" class="icon-btn-sm" data-act="edit-q" title="${escapeHtml(t('common.edit'))}" aria-label="${escapeHtml(t('common.edit'))}">✏️</button>
          <button type="button" class="icon-btn-sm danger" data-act="delete-q" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">🗑</button>` : ''}
      </div>

      <!-- Раскрывающиеся ответы с комментариями -->
      <div class="q-card-expand" hidden>
        <div class="answers-list"></div>
      </div>
    </article>`;
}

/** Поведение карточки: раскрытие ответов, профиль, вопрос */
function wireCard(card, q) {
  const expandZone = card.querySelector('.q-card-expand');
  const answersList = card.querySelector('.answers-list');
  const chevron = card.querySelector('.chevron');
  let loaded = false;
  let open = false;

  function renderAnswers(answers) {
    const { user } = getState();
    const isOwner = user && user.id === q.user_id;
    const qAudio = q.audio_url ? { url: q.audio_url, waveform: q.waveform_data || [] } : null;
    answersList.innerHTML = answers.length
      ? answers.map((a) => answerCardHtml(a, isOwner, q.user_id, qAudio)).join('')
      : `<p style="color:var(--text-muted);font-size:13px;padding:8px 2px">${escapeHtml(t('question.no_answers'))}</p>`;
    attachAnswerAudioPlayers(answersList);

    // Синхронизация метаданных карточки со свежим списком ответов:
    // статус, чип «💬 N / без ответов», подпись «решение: <автор>»
    const syncCardMeta = (fresh) => {
      const solved = fresh.some((a) => a.is_solution);
      const badge = card.querySelector('.status-badge');
      if (badge) {
        badge.className = `status-badge ${solved ? 'status-solved' : 'status-open'}`;
        badge.textContent = solved ? `✓ ${t('feed.status_solved')}` : t('feed.status_open');
      }
      const chip = card.querySelector('.answers-chip');
      if (chip) {
        chip.className = `answers-chip ${fresh.length ? 'has' : 'none'}`;
        chip.innerHTML = fresh.length ? `💬 ${fresh.length}` : escapeHtml(t('feed.no_answers_short'));
      }
      fillSolvedBy(card, solved ? 'solved' : 'open', fresh);
    };
    // Перечитать ответы и обновить раскрытый блок + метаданные на месте
    const refreshExpanded = async () => {
      const fresh = await fetchAnswers(q.id);
      answersCache.set(q.id, fresh);
      renderAnswers(fresh);
      syncCardMeta(fresh);
    };

    // Отметка/снятие решения меняет жизненный цикл карточки:
    // чип «⏳ Решено · N дн», неактивные «Ответить»/«В избранное»
    const refreshAfterSolution = async () => {
      await refreshExpanded();
      const freshQ = await fetchQuestion(q.id);
      if (!freshQ) return;
      Object.assign(q, { status: freshQ.status, solved_at: freshQ.solved_at, purge_at: freshQ.purge_at, purged: freshQ.purged });
      const row = card.querySelector('.card-status-row');
      const oldChip = row?.querySelector('.status-purge');
      const chipHtml = solvedChipHtml(q);
      if (chipHtml) {
        if (oldChip) oldChip.outerHTML = chipHtml;
        else row?.insertAdjacentHTML('beforeend', chipHtml);
      } else if (oldChip) oldChip.remove();
      const nowSolved = q.status === 'solved';
      card.querySelectorAll('[data-act="answer"], [data-act="fav"]').forEach((b) => {
        b.disabled = nowSolved;
        b.title = nowSolved ? t(b.dataset.act === 'fav' ? 'question.fav_closed_hint' : 'question.answers_closed') : '';
      });
    };

    // Лайки/комментарии/решение/A-B/правка/удаление внутри раскрытых ответов
    bindAnswersEvents(expandZone, q.id, {
      questionAudio: qAudio,
      onRerender: refreshExpanded,
      // Правка/удаление ответа могли снять статус решения (удалён ответ-решение) —
      // поэтому перечитываем и сам вопрос, обновляя чип/кнопки карточки
      onAnswersChanged: refreshAfterSolution,
      onSolutionToggled: refreshAfterSolution,
    });
  }

  async function toggleExpand() {
    open = !open;
    expandZone.hidden = !open;
    chevron.textContent = open ? '▴' : '▾';
    card.classList.toggle('expanded', open);
    if (open && !loaded) {
      loaded = true;
      // Кэш прогрет предзагрузкой → рендерим мгновенно, без лоадера
      const cached = answersCache.get(q.id);
      if (cached) {
        renderAnswers(cached);
      } else {
        // Клик случился раньше, чем завершилась предзагрузка
        answersList.innerHTML = '<div class="loader"></div>';
        const answers = await fetchAnswers(q.id);
        answersCache.set(q.id, answers);
        renderAnswers(answers);
      }
    }
  }

  // Клик по карточке раскрывает ответы;
  // исключения: ссылки (аватар/имя/заголовок), превью-плеер, чипы маркеров, строка действий, раскрытая зона
  card.addEventListener('click', (e) => {
    if (e.target.closest('a, .mini-wave, .mini-marker-list, .q-card-expand, .q-card-actions')) return;
    toggleExpand();
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === card) toggleExpand();
  });

  // ---------- Постоянная строка действий ----------
  const actions = card.querySelector('.q-card-actions');

  // «Ответить» → страница вопроса с фокусом на форму ответа
  actions.querySelector('[data-act="answer"]').addEventListener('click', () => {
    if (!requireAuth()) return;
    navigate(`/question/${q.id}`);
    setTimeout(() => {
      document.querySelector('#answer-form textarea')?.focus();
      document.querySelector('#answer-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
  });

  // «В избранное» → мгновенный toggle прямо в ленте
  actions.querySelector('[data-act="fav"]').addEventListener('click', async () => {
    if (!requireAuth()) return;
    const btn = actions.querySelector('[data-act="fav"]');
    const nowFav = !(await isInFavorites(q.id));
    const ok = await setFavorite(q.id, nowFav);
    btn.classList.toggle('star-on', ok);
    btn.setAttribute('aria-pressed', String(ok));
    btn.querySelector('.fav-icon').textContent = ok ? '★' : '⭐';
    btn.querySelector('.fav-label').textContent = ok ? t('question.in_favorites') : t('question.add_to_favorites');
    toast(ok ? t('favorites.added') : t('favorites.removed'));
    if (ok) checkAndAward('curator');
  });

  // ---------- Свои вопросы: правка и удаление ----------
  actions.querySelector('[data-act="edit-q"]')?.addEventListener('click', () => {
    navigate(`/ask?edit=${encodeURIComponent(q.id)}`);
  });
  actions.querySelector('[data-act="delete-q"]')?.addEventListener('click', async () => {
    if (!(await confirmModal(t('common.delete'), t('question.delete_confirm')))) return;
    try {
      await deleteQuestion(q.id);
      answersCache.delete(q.id);
      toast(t('common.deleted'));
      card.remove();
    } catch (err) {
      toast(err.message || 'Error', 'error');
    }
  });
}

export { applyTranslations };