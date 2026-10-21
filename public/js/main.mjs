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
import { initAds } from './ads.mjs';
import { initMetrika } from './metrika.mjs';
import { ensureClient, runLifecycleSweep, takeDemoReseedNotice, setDemoRole } from './api.mjs';
import { toast, initNoBrowserHints } from './utils.mjs';
import { initHelp, renderHelpPage, maybeAutoTour } from './help.mjs';
import { initTagSubscriptions } from './subscriptions.mjs';

// Экраны
import { renderFeed } from './feed.mjs';
import { renderQuestion, renderAskQuestion } from './question.mjs';
import { renderFavorites } from './favorites.mjs';
import { renderMessages } from './messages.mjs';
import { renderProfile } from './profile.mjs';
import { renderMarketplace } from './marketplace.mjs';
import { renderPremium } from './premium.mjs';
import { renderAffiliate } from './affiliate.mjs';
import { renderModeration } from './moderation.mjs';
import { renderAdminDb } from './admin-db.mjs';
import { renderIdeas } from './ideas.mjs';

async function boot() {
  // 1. Мультиязычность (до первого рендера)
  await initI18n();

  // 1.5. Реклама (Яндекс РСЯ): no-op при ENABLE_ADS=false, иначе — прогрев лоадера
  initAds();
  // 1.6. Яндекс.Метрика: no-op при ENABLE_METRIKA=false / в демо / без counterId
  initMetrika();

  // 1.7. Демобаза пересоздана при смене версии (мягкий пересид) — предупреждаем
  const reseed = takeDemoReseedNotice();
  if (reseed) toast(t('demo.reseeded', { from: reseed.from, to: reseed.to }), 'info', 9000);

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
  // Модерация жалоб — доступна только админам (profiles.is_admin)
  route('/moderation', renderModeration);
  // Заход 50: админ-просмотрщик БД (guard внутри, как /moderation)
  route('/admin', renderAdminDb);
  route('/ideas', renderIdeas);
  // Справка: FAQ + запуск режима «что делает кнопка?» и тура
  route('/help', renderHelpPage);

  // 3. Инициализация роутера и авторизации
  initRouter();
  initAuthUI();
  initHelp();
  await restoreSession();
  initNotifications();
  // Чипы подписки на теги (#теги ответов, теги синтезатора в ленте):
  // общее capture-делегирование кликов — один слушатель на всё приложение
  initTagSubscriptions();
  // Запрет браузерных подсказок в полях: autocomplete=off + novalidate
  // на все form/input/textarea — существующие и будущие (наблюдатель)
  initNoBrowserHints();

  // Жизненный цикл решённых вопросов: удаление по таймеру (7 дней)
  // и напоминания авторам. Демо — локально, реальный режим — функция в БД.
  runLifecycleSweep();
  // В реальном режиме sweep требует входа — повторим после авторизации
  subscribeTo('user', (u) => { if (u) runLifecycleSweep(); });

  // Лампочка «Идеи» в шапке (заход 38): витрина открыта всем
  document.getElementById('btn-ideas')?.addEventListener('click', () => navigate('/ideas'));

  // Кнопка «Поддержать проект» в подвале
  document.getElementById('btn-support-project')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    openSupportModal({ recipientUserId: null });
  });

  // 4. Индикатор режима в подвале + диагностика подключения к Supabase
  const modeEl = document.getElementById('demo-indicator');
  // Заход 43: демо-тумблер ролей «разработчик / пользователь» (только IS_DEMO)
  if (IS_DEMO && modeEl?.parentElement) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.id = 'demo-role-switch';
    sw.className = 'btn btn-quiet btn-sm';
    sw.dataset.help = 'demo_role';
    modeEl.parentElement.appendChild(sw);
    const drawSw = () => {
      const admin = !!getState().user?.is_admin;
      sw.textContent = `${t('demo.role_switch')}: ${admin ? t('demo.role_dev') : t('demo.role_user')}`;
      sw.setAttribute('aria-pressed', String(admin));
    };
    drawSw();
    subscribeTo('user', () => drawSw());
    sw.addEventListener('click', () => {
      const next = !getState().user?.is_admin;
      const user = setDemoRole(next);
      if (!user) return;
      setState({ user });
      toast(next ? t('demo.role_toast_dev') : t('demo.role_toast_user'));
      drawSw();
      handleRoute(); // экран перерисовывается: меню/guard/админ-контролы реагируют сразу
    });
  }
  if (IS_DEMO) {
    if (modeEl) modeEl.textContent = 'DEMO MODE — аккаунты и данные живут в этом браузере; backend включается флагом USE_LOCAL_BACKEND в js/config.mjs';
  } else {
    if (modeEl) modeEl.textContent = `BACKEND: подключение… ${CONFIG.API_URL}`;
    ensureClient()
      .then(() => { if (modeEl) modeEl.textContent = `BACKEND: подключено ✓ ${CONFIG.API_URL}`; })
      .catch((e) => {
        if (modeEl) modeEl.textContent = 'BACKEND: ошибка подключения — детали в консоли';
        console.error('[SampleHelp] backend:', e);
        toast(e.message, 'error', 10000);
      });
  }
  void CONFIG;

  // 5. Первый рендер
  handleRoute();

  // 6. Тур первого визита — запускается сам, если пользователь его ещё не видел
  maybeAutoTour();
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
