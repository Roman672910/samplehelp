// ============================================================
// marketplace.mjs — маркетплейс пресетов (МОДУЛЬ-ЗАГОТОВКА).
// Активируется флагом CONFIG.ENABLE_MONETIZATION = true.
// Таблицы: products, orders. Файлы — Supabase Storage (приватный
// бакет marketplace-files, доступ через RLS).
// ВАЖНО: платёжная система НЕ интегрирована в этой версии.
// ============================================================

import { CONFIG } from './config.mjs';
import { t, applyTranslations } from './i18n.mjs';
import { escapeHtml } from './utils.mjs';
import { comingSoonHtml } from './premium.mjs';

export async function renderMarketplace(container) {
  if (!CONFIG.ENABLE_MONETIZATION) {
    container.innerHTML = comingSoonHtml('🛒', t('marketplace.title'), t('marketplace.coming_soon'));
    return;
  }
  // ---- Заглушка активированного состояния (платежи не интегрированы) ----
  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title">${escapeHtml(t('marketplace.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('marketplace.subtitle'))}</p>
      </div>
      <div class="coming-soon card">
        <span class="cs-icon">💳</span>
        <h2>${escapeHtml(t('marketplace.payments_pending'))}</h2>
        <p>${escapeHtml(t('marketplace.payments_pending_desc'))}</p>
      </div>
    </div>`;
  applyTranslations(container);
}

/**
 * Заготовка API маркетплейса (используется после активации флага).
 * Структура соответствует таблицам products / orders.
 */
export const marketplaceApi = {
  async listProducts() {
    if (!CONFIG.ENABLE_MONETIZATION) return [];
    // const sb = await ensureClient();
    // const { data } = await sb.from('products').select('*, profiles(username)').eq('active', true);
    return [];
  },
  async createOrder() {
    if (!CONFIG.ENABLE_MONETIZATION) return null;
    // Платёжная интеграция будет определена при активации монетизации
    return null;
  },
};