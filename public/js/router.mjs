// ============================================================
// router.mjs — SPA-роутинг через History API (без перезагрузки)
// ============================================================

import { setState } from './store.mjs';
import { cleanupTransientAudio } from './audio.mjs';

const routes = [];
let currentCleanup = null;
let notFoundRenderer = null;
const appEl = () => document.getElementById('app');

/**
 * Регистрация маршрута.
 * @param {string} path — шаблон, напр. '/question/:id'
 * @param {function} renderer — async (container, params) => cleanup?
 */
export function route(path, renderer) {
  const paramNames = [];
  const pattern = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  routes.push({ regex: new RegExp(`^${pattern}/?$`), renderer, paramNames, path });
}

export function setNotFound(renderer) {
  notFoundRenderer = renderer;
}

/** Программная навигация */
export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  handleRoute();
}

/** Обработка текущего URL */
export async function handleRoute() {
  const path = location.pathname;
  const container = appEl();
  if (!container) return;

  for (const r of routes) {
    const match = path.match(r.regex);
    if (match) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });

      // Cleanup предыдущего экрана (таймеры, плееры, подписки)
      if (typeof currentCleanup === 'function') {
        try { currentCleanup(); } catch (e) { console.error('[router] cleanup:', e); }
      }
      currentCleanup = null;
      // Превью и A/B плееры не должны доигрывать на следующем экране
      cleanupTransientAudio();

      setState({ route: { path: r.path, params } });
      updateActiveNav(path);
      container.innerHTML = '<div class="loader" role="status" aria-label="Загрузка"></div>';
      window.scrollTo({ top: 0 });

      try {
        const cleanup = await r.renderer(container, params);
        if (typeof cleanup === 'function') currentCleanup = cleanup;
      } catch (e) {
        console.error('[router] render error:', e);
        container.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>Ошибка загрузки экрана</p></div>`;
      }
      return;
    }
  }

  // 404
  setState({ route: { path: '/404', params: {} } });
  updateActiveNav(path);
  if (notFoundRenderer) notFoundRenderer(container);
}

function updateActiveNav(path) {
  document.querySelectorAll('.main-nav a').forEach((a) => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === '/' ? path === '/' : path.startsWith(href));
  });
}

/** Инициализация: перехват кликов по data-route ссылкам + popstate */
export function initRouter() {
  // Делегирование событий: все ссылки с data-route
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-route], a[href^="/"]:not([target])');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#')) return;
    e.preventDefault();
    if (href !== location.pathname + location.search) navigate(href);
  });

  window.addEventListener('popstate', handleRoute);

  // Смена языка — перерисовка текущего экрана
  document.addEventListener('i18n:changed', () => handleRoute());
}