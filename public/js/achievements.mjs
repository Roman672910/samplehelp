// ============================================================
// achievements.mjs — система достижений (без уровней).
// Значки выдаются за конкретные действия; проверка после каждого
// действия (checkAndAward). В профиле полученные — цветные,
// неполученные — серые.
// ============================================================

import { t } from './i18n.mjs';
import { getState, setState } from './store.mjs';
import {
  fetchAchievements, awardAchievement,
  fetchQuestionsByUser, fetchAnswersByUser, fetchFavorites, isDemo, ensureClient,
} from './supabase.mjs';
import { toast } from './utils.mjs';

/** Каталог достижений: тип → иконка + ключи i18n (name/desc) */
export const ACHIEVEMENTS = [
  { type: 'first_answer', icon: '🚀' },
  { type: 'commenter', icon: '💬' },
  { type: 'on_fire', icon: '🔥' },
  { type: 'solver', icon: '✅' },
  { type: 'tag_expert', icon: '🎯' },
  { type: 'melomaniac', icon: '🎧' },
  { type: 'helper', icon: '🤝' },
  { type: 'legend', icon: '👑' },
  { type: 'generous', icon: '📎' },
  { type: 'curator', icon: '⭐' },
];

/** Загрузить полученные достижения текущего пользователя в store */
export async function refreshAchievements() {
  const { user } = getState();
  if (!user) { setState({ achievements: [] }); return; }
  const earned = await fetchAchievements(user.id);
  setState({ achievements: earned });
}

/**
 * Проверить правило достижения и выдать значок, если выполнено.
 * Вызывается после релевантных действий (ответ, лайк, избранное…).
 */
export async function checkAndAward(type) {
  const { user, achievements } = getState();
  if (!user || achievements.includes(type)) return false;

  const stats = await collectStats(user.id);
  if (!meetsRule(type, stats)) return false;

  const awarded = await awardAchievement(type);
  if (awarded) {
    setState({ achievements: [...achievements, type] });
    const def = ACHIEVEMENTS.find((a) => a.type === type);
    toast(`${def?.icon || '🏆'} ${t('achievements.earned')}: ${t(`achievements.${type}.name`)}`);
  }
  return awarded;
}

/** Сбор статистики пользователя для проверки правил */
async function collectStats(userId) {
  const [questions, answers, favorites] = await Promise.all([
    fetchQuestionsByUser(userId),
    fetchAnswersByUser(userId),
    fetchFavorites(),
  ]);

  const answerLikes = answers.reduce((s, a) => s + (a.likes_count || 0), 0);
  const questionLikes = questions.reduce((s, q) => s + (q.likes_count || 0), 0);
  const solutions = answers.filter((a) => a.is_solution);

  // 10 решений по одному тегу (теги проставляет отвечающий)
  const solutionsByTag = {};
  solutions.forEach((a) => {
    (a.tags || []).forEach((tg) => { solutionsByTag[tg] = (solutionsByTag[tg] || 0) + 1; });
  });
  const maxTagSolutions = Math.max(0, ...Object.values(solutionsByTag));

  // Избранное, на которое пользователь ответил
  const answeredIds = new Set(answers.map((a) => a.question_id || a.question?.id));
  const favoritesAnswered = favorites.filter((f) => answeredIds.has(f.question_id)).length;

  let commentsCount = 0;
  let presetsCount = answers.filter((a) => a.preset_url).length;
  if (!isDemo()) {
    try {
      const sb = await ensureClient();
      const { count } = await sb.from('comments').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      commentsCount = count || 0;
    } catch { /* недоступно — оставляем 0 */ }
  } else {
    // В демо комментарии текущего пользователя считаем по store-данным
    const mod = await import('./supabase.mjs');
    void mod;
    commentsCount = statsDemoComments(userId);
    presetsCount = answers.filter((a) => a.preset_url).length;
  }

  return {
    questions: questions.length,
    answers: answers.length,
    distinctQuestionsAnswered: new Set(answers.map((a) => a.question_id || a.question?.id)).size,
    answerLikes,
    totalLikes: answerLikes + questionLikes,
    solutions: solutions.length,
    maxTagSolutions,
    favoritesAnswered,
    commentsCount,
    presetsCount,
  };
}

// Небольшой хелпер: в демо-режиме комментарии лежат в闭 closure supabase.mjs;
// считаем их через публичный fetch только для своего профиля.
let _demoCommentsCache = { userId: null, count: 0 };
function statsDemoComments(userId) {
  if (_demoCommentsCache.userId === userId) return _demoCommentsCache.count;
  return 0;
}
/** Вызывается из question.mjs после добавления комментария (демо-подсчёт) */
export function registerDemoComment(userId) {
  if (_demoCommentsCache.userId !== userId) _demoCommentsCache = { userId, count: 0 };
  _demoCommentsCache.count += 1;
}

/** Правила выдачи значков (пороги из ТЗ) */
function meetsRule(type, s) {
  switch (type) {
    case 'first_answer': return s.answers >= 1;                 // 🚀 Ответил на 1 вопрос
    case 'commenter': return s.commentsCount >= 10;             // 💬 10 комментариев
    case 'on_fire': return s.answerLikes >= 100;                // 🔥 100 лайков на ответах
    case 'solver': return s.solutions >= 5;                     // ✅ 5 ответов-решений
    case 'tag_expert': return s.maxTagSolutions >= 10;          // 🎯 10 решений по одному тегу
    case 'melomaniac': return s.questions >= 10;                // 🎧 10 аудио-вопросов
    case 'helper': return s.distinctQuestionsAnswered >= 25;    // 🤝 Ответил на 25 вопросов
    case 'legend': return s.totalLikes >= 1000;                 // 👑 1000 лайков
    case 'generous': return s.presetsCount >= 5;                // 📎 5 пресетов в ответах
    case 'curator': return s.favoritesAnswered >= 20;           // ⭐ 20 избранных с ответом
    default: return false;
  }
}

/** Рендер сетки значков: полученные — цветные, неполученные — серые */
export function renderAchievementsGrid(earnedTypes = []) {
  const earned = new Set(earnedTypes);
  return `
    <div class="achievements-grid">
      ${ACHIEVEMENTS.map((a) => `
        <div class="card achievement-card ${earned.has(a.type) ? 'earned' : 'locked'}" title="${escapeAttr(t(`achievements.${a.type}.desc`))}">
          <span class="ach-icon" aria-hidden="true">${a.icon}</span>
          <div class="ach-name">${escapeHtmlText(t(`achievements.${a.type}.name`))}</div>
          <div class="ach-desc">${escapeHtmlText(t(`achievements.${a.type}.desc`))}</div>
        </div>`).join('')}
    </div>`;
}

function escapeHtmlText(s = '') {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function escapeAttr(s = '') {
  return escapeHtmlText(s).replaceAll('"', '&quot;');
}