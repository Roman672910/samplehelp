// ============================================================
// affiliate.mjs — партнёрские ссылки (МОДУЛЬ-ЗАГОТОВКА).
// Активируется флагом CONFIG.ENABLE_MONETIZATION = true.
// Таблица: affiliate_links. Идея: при упоминании плагина в ответе
// подставлять реферальную ссылку автора ответа.
// ============================================================

import { CONFIG } from './config.mjs';
import { t } from './i18n.mjs';
import { comingSoonHtml } from './premium.mjs';

export async function renderAffiliate(container) {
  if (!CONFIG.ENABLE_MONETIZATION) {
    container.innerHTML = comingSoonHtml('🤝', t('affiliate.title'), t('affiliate.coming_soon'));
    return;
  }
  container.innerHTML = comingSoonHtml('🤝', t('affiliate.title'), t('affiliate.payments_pending'));
}

/**
 * Заготовка: обогащение текста ответа партнёрскими ссылками.
 * После активации — ищет упоминания плагинов и подставляет
 * реферальные ссылки из таблицы affiliate_links.
 */
export async function enrichWithAffiliateLinks(_answerText) {
  if (!CONFIG.ENABLE_MONETIZATION) return _answerText;
  // const sb = await ensureClient();
  // const { data: links } = await sb.from('affiliate_links').select('*');
  // ...подстановка ссылок по plugin_name...
  return _answerText;
}