// ============================================================
// premium.mjs — премиум-аккаунт (МОДУЛЬ-ЗАГОТОВКА).
// Активируется флагом CONFIG.ENABLE_MONETIZATION = true.
// Таблица: subscriptions_premium.
// Возможности (по ТЗ): больше загрузок, расширенная спектрограмма,
// приоритет в ленте, эксклюзивные значки.
// ВАЖНО: платежи НЕ интегрированы; кнопка «Премиум» ведёт на заглушку.
// ============================================================

import { CONFIG } from './config.mjs';
import { t, applyTranslations } from './i18n.mjs';
import { escapeHtml } from './utils.mjs';
import { getState } from './store.mjs';

/** Общий HTML-блок «Скоро» для выключенных модулей монетизации */
export function comingSoonHtml(icon, title, description) {
  return `
    <div class="screen coming-soon">
      <span class="cs-icon">${icon}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
      <span class="cs-badge">${escapeHtml(t('monetization.soon_badge'))}</span>
    </div>`;
}

export async function renderPremium(container) {
  if (!CONFIG.ENABLE_MONETIZATION) {
    container.innerHTML = comingSoonHtml('👑', t('premium.title'), t('premium.coming_soon'));
    return;
  }
  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title">${escapeHtml(t('premium.title'))}</h1>
      </div>
      <div class="coming-soon card">
        <span class="cs-icon">💳</span>
        <h2>${escapeHtml(t('premium.payments_pending'))}</h2>
        <p>${escapeHtml(t('premium.payments_pending_desc'))}</p>
        <div style="margin-top:20px;display:grid;gap:10px;max-width:380px;margin-inline:auto;text-align:left">
          <div class="stat-row"><span>📦 ${escapeHtml(t('premium.feat_uploads'))}</span><b>∞</b></div>
          <div class="stat-row"><span>◨ ${escapeHtml(t('premium.feat_spectro'))}</span><b>PRO</b></div>
          <div class="stat-row"><span>⬆️ ${escapeHtml(t('premium.feat_priority'))}</span><b>TOP</b></div>
          <div class="stat-row"><span>🏅 ${escapeHtml(t('premium.feat_badges'))}</span><b>★</b></div>
        </div>
      </div>
    </div>`;
  applyTranslations(container);
}

/** Есть ли у текущего пользователя активный премиум (заготовка) */
export function isPremium() {
  if (!CONFIG.ENABLE_MONETIZATION) return false;
  const { user } = getState();
  return !!user?.premium;
}