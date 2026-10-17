// ============================================================
// knowledge.mjs — база знаний: сетка карточек статей,
// категории, страница чтения.
// ============================================================

import { t, getLocale, applyTranslations } from './i18n.mjs';
import { fetchArticles, fetchArticle } from './supabase.mjs';
import { escapeHtml, timeAgo, initials } from './utils.mjs';
import { navigate } from './router.mjs';

const CATEGORIES = [
  { id: null, key: 'knowledge.cat_all' },
  { id: 'synthesis', key: 'knowledge.cat_synthesis' },
  { id: 'synths', key: 'knowledge.cat_synths' },
  { id: 'processing', key: 'knowledge.cat_processing' },
  { id: 'sampling', key: 'knowledge.cat_sampling' },
];

let currentCategory = null;

export async function renderKnowledge(container) {
  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title" data-i18n="knowledge.title"></h1>
        <p class="page-subtitle" data-i18n="knowledge.subtitle"></p>
      </div>
      <div class="category-pills" id="cat-pills" role="tablist">
        ${CATEGORIES.map((c) => `
          <button type="button" role="tab" aria-selected="${currentCategory === c.id}"
            class="sort-tab ${currentCategory === c.id ? 'active' : ''}" data-cat="${c.id || ''}">
            ${escapeHtml(t(c.key))}
          </button>`).join('')}
      </div>
      <div class="articles-grid" id="articles-grid"><div class="loader"></div></div>
    </div>`;
  applyTranslations(container);

  const articles = await fetchArticles(currentCategory);
  const grid = container.querySelector('#articles-grid');

  if (!articles.length) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-icon">📚</span><p>${escapeHtml(t('knowledge.empty'))}</p></div>`;
  } else {
    grid.innerHTML = articles.map((a) => `
      <article class="card clickable article-card" data-aid="${escapeHtml(a.id)}" tabindex="0" role="link">
        <span class="tag">${escapeHtml(t(`knowledge.cat_${a.category}`) || a.category)}</span>
        <h3>${escapeHtml(a.title)}</h3>
        <p class="article-preview">${escapeHtml(a.preview || '')}</p>
        <div class="article-meta">
          <span>✍️ ${escapeHtml(a.author?.username || a.profiles?.username || '?')}</span>
          <span>⏱ ${a.read_time || 5} ${escapeHtml(t('knowledge.min_read'))}</span>
          <span>${escapeHtml(timeAgo(a.created_at, getLocale()))}</span>
        </div>
      </article>`).join('');

    // Переход к статье (делегирование событий)
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-aid]');
      if (card) navigate(`/article/${card.dataset.aid}`);
    });
    grid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const card = e.target.closest('[data-aid]');
        if (card) navigate(`/article/${card.dataset.aid}`);
      }
    });
  }

  // Категории
  container.querySelector('#cat-pills').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    currentCategory = btn.dataset.cat || null;
    renderKnowledge(container);
  });
}

// ============================================================
// Страница чтения статьи
// ============================================================

export async function renderArticle(container, { id }) {
  const article = await fetchArticle(id);
  if (!article) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">📄</span><p>${escapeHtml(t('knowledge.not_found'))}</p></div>`;
    return;
  }
  const author = article.author || article.profiles;

  container.innerHTML = `
    <div class="screen article-page">
      <button type="button" class="btn btn-quiet btn-sm" id="back-btn" style="margin-bottom:18px">← ${escapeHtml(t('knowledge.back_to_list'))}</button>
      <article class="card" style="cursor:default;padding:32px">
        <span class="tag">${escapeHtml(t(`knowledge.cat_${article.category}`) || article.category)}</span>
        <h1 style="margin-top:12px">${escapeHtml(article.title)}</h1>
        <div class="question-author">
          <a href="/profile/${escapeHtml(article.author_id || '')}" data-route class="avatar sm" aria-hidden="true">${escapeHtml(initials(author?.username))}</a>
          <a href="/profile/${escapeHtml(article.author_id || '')}" data-route>${escapeHtml(author?.username || '?')}</a>
          <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11.5px">
            · ⏱ ${article.read_time || 5} ${escapeHtml(t('knowledge.min_read'))} · ${escapeHtml(timeAgo(article.created_at, getLocale()))}
          </span>
        </div>
        <div class="article-content">${formatArticleContent(article.content || article.preview || '')}</div>
        ${(article.tags || []).length ? `<div class="tags-row">${article.tags.map((tg) => `<span class="tag">#${escapeHtml(tg)}</span>`).join('')}</div>` : ''}
      </article>
    </div>`;

  container.querySelector('#back-btn').addEventListener('click', () => navigate('/knowledge'));
}

/** Простое форматирование контента статьи: ## заголовки, абзацы */
function formatArticleContent(text) {
  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (!line.trim()) return '';
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join('');
}
