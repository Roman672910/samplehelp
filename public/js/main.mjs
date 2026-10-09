// ============================================================
// main.mjs — точка входа: инициализация всех подсистем
// ============================================================

import { CONFIG, IS_DEMO } from './config.mjs';
import { initI18n, t } from './i18n.mjs';
import { initRouter, route, handleRoute, navigate } from './router.mjs';
import { getState, setState, subscribeTo } from './store.mjs';
import { initAuthUI, restoreSession, requireAuth } from './auth.mjs';
import { openSupportModal } from './support.mjs';
import { initNotifications } from './notifications.mjs';
import { ensureClient, runLifecycleSweep } from './supabase.mjs';
import { toast } from './utils.mjs';

// Экраны
import { renderFeed } from './feed.mjs';
import { renderQuestion, renderAskQuestion } from './question.mjs';
import { renderFavorites } from './favorites.mjs';
import { renderMessages } from './messages.mjs';
import { renderProfile } from './profile.mjs';
import { renderMarketplace } from './marketplace.mjs';
import { renderPremium } from './premium.mjs';
import { renderAffiliate } from './affiliate.mjs';

async function boot() {
  // 1. Мультиязычность (до первого рендера)
  await initI18n();

  // 2. Регистрация маршрутов
  route('/', renderFeed);
  route('/question/:id', renderQuestion);
  route('/ask', renderAskQuestion);
  route('/favorites', renderFavorites);
  route('/messages', renderMessages);
  route('/messages/:userId', renderMessages);
  route('/profile', (el) => {
    const { user } = getState();
    if (!user) { navigate('/', { replace: true }); return; }
    return renderProfile(el, { userId: user.id }, { editable: true });
  });
  route('/profile/:userId', (el, params) => renderProfile(el, params));
  // Монетизация (структура заложена, выключена флагом)
  route('/marketplace', renderMarketplace);
  route('/premium', renderPremium);
  route('/affiliate', renderAffiliate);

  // 3. Инициализация роутера и авторизации
  initRouter();
  initAuthUI();
  await restoreSession();
  initNotifications();

  // Жизненный цикл решённых вопросов: удаление по таймеру (7 дней)
  // и напоминания авторам. Демо — локально, реальный режим — функция в БД.
  runLifecycleSweep();
  // В реальном режиме sweep требует входа — повторим после авторизации
  subscribeTo('user', (u) => { if (u) runLifecycleSweep(); });

  // Кнопка «Поддержать проект» в подвале
  document.getElementById('btn-support-project')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    openSupportModal({ recipientUserId: null });
  });

  // 4. Индикатор режима в подвале + диагностика подключения к Supabase
  const modeEl = document.getElementById('demo-indicator');
  if (IS_DEMO) {
    if (modeEl) modeEl.textContent = 'DEMO MODE — заполните SUPABASE_URL / SUPABASE_ANON_KEY в js/config.mjs';
  } else {
    if (modeEl) modeEl.textContent = 'SUPABASE: подключение…';
    ensureClient()
      .then(() => { if (modeEl) modeEl.textContent = 'SUPABASE: подключено ✓'; })
      .catch((e) => {
        if (modeEl) modeEl.textContent = 'SUPABASE: ошибка подключения — детали в консоли';
        console.error('[SampleHelp] Supabase:', e);
        toast(e.message, 'error', 10000);
      });
  }
  void CONFIG;

  // 5. Первый рендер
  handleRoute();
}

// Глобальная обработка фатальных ошибок
window.addEventListener('error', (e) => {
  console.error('[SampleHelp]', e.error || e.message);
});

boot().catch((e) => {
  console.error('[SampleHelp] boot failed:', e);
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="empty-state"><span class="empty-icon">🔌</span><p>Не удалось запустить приложение. Проверьте консоль.</p></div>`;
});

export { t };