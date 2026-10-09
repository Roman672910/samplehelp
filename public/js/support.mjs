// ============================================================
// support.mjs — поддержка: пользователей и проекта.
// Сейчас — заглушка: модалка с выбором суммы и сообщения,
// намерение фиксируется в donations (счётчик на профиле растёт),
// оплата появится при ENABLE_DONATIONS = true (свой провайдер,
// вебхуки и комиссия подключаются внутрь этого модуля — UI не меняется).
// Одна сущность на два случая: recipientUserId = null → проект.
// ============================================================

import { CONFIG } from './config.mjs';
import { t } from './i18n.mjs';
import { openModal, toast, escapeHtml } from './utils.mjs';
import { recordDonation } from './supabase.mjs';

/** Чипы сумм по валютам */
const AMOUNTS = { RUB: [100, 300, 500, 1000], USD: [1, 3, 5, 10] };
const CUR_SIGN = { RUB: '₽', USD: '$' };

/**
 * Модалка поддержки.
 * @param {object} opts { recipientUserId = null (проект), recipientName }
 * Вызывающая сторона сама проверяет авторизацию (requireAuth).
 */
export function openSupportModal({ recipientUserId = null, recipientName = '' } = {}) {
  const isProject = recipientUserId === null;
  let currency = 'RUB';
  let amount = AMOUNTS.RUB[1];

  const content = document.createElement('div');
  content.innerHTML = `
    <p class="sup-sub">${escapeHtml(isProject ? t('support.subtitle_project') : t('support.subtitle_user'))}</p>
    <div class="sup-cur-row" role="group" aria-label="${escapeHtml(t('support.currency'))}">
      <button type="button" class="toggle-chip active" data-cur="RUB">₽ RUB</button>
      <button type="button" class="toggle-chip" data-cur="USD">$ USD</button>
    </div>
    <div class="sup-amounts" id="sup-amounts"></div>
    <div class="field" style="margin-top:12px">
      <input type="number" id="sup-custom" min="1" step="1" placeholder="${escapeHtml(t('support.custom_ph'))}" aria-label="${escapeHtml(t('support.custom_ph'))}">
    </div>
    <div class="field">
      <textarea id="sup-msg" rows="2" placeholder="${escapeHtml(t('support.message_ph'))}" aria-label="${escapeHtml(t('support.message_ph'))}"></textarea>
    </div>
    <button type="button" class="btn btn-primary" id="sup-submit" style="width:100%">
      ☕ ${escapeHtml(t('support.submit'))} <span id="sup-sum"></span>
    </button>
    <div class="sup-soon" id="sup-soon" hidden>
      <span class="cs-badge">${escapeHtml(t('monetization.soon_badge'))}</span>
      <p>${escapeHtml(t('support.soon_text'))}</p>
    </div>`;

  const amountsEl = content.querySelector('#sup-amounts');
  const customEl = content.querySelector('#sup-custom');
  const sumEl = content.querySelector('#sup-sum');

  function drawAmounts() {
    amountsEl.innerHTML = AMOUNTS[currency].map((a) => `
      <button type="button" class="sup-amt ${a === amount ? 'active' : ''}" data-amt="${a}">
        ${a} ${CUR_SIGN[currency]}
      </button>`).join('');
    sumEl.textContent = `· ${amount} ${CUR_SIGN[currency]}`;
  }
  drawAmounts();

  amountsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-amt]');
    if (!btn) return;
    amount = Number(btn.dataset.amt);
    customEl.value = '';
    drawAmounts();
  });
  customEl.addEventListener('input', () => {
    const v = Math.max(0, Math.floor(Number(customEl.value) || 0));
    if (v > 0) { amount = v; drawAmounts(); }
  });
  content.querySelectorAll('[data-cur]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currency = btn.dataset.cur;
      content.querySelectorAll('[data-cur]').forEach((b) => b.classList.toggle('active', b === btn));
      // Пересчитываем выбранную сумму под валюту
      amount = customEl.value ? amount : AMOUNTS[currency][1];
      drawAmounts();
    });
  });

  const close = openModal({
    title: isProject ? t('support.title_project') : t('support.title_user', { name: recipientName }),
    content,
  });

  content.querySelector('#sup-submit').addEventListener('click', async () => {
    if (!amount || amount <= 0) { toast(t('support.amount_required'), 'error'); return; }
    const btn = content.querySelector('#sup-submit');
    btn.disabled = true;
    const message = content.querySelector('#sup-msg').value.trim();
    const row = await recordDonation({ recipient_user_id: recipientUserId, amount, currency, message });
    btn.disabled = false;
    if (!row) { toast('Error', 'error'); return; }

    if (!CONFIG.ENABLE_DONATIONS) {
      // Заглушка: намерение учтено, счётчик вырос, оплата — скоро
      content.querySelector('#sup-soon').hidden = false;
      btn.disabled = true;
      toast(t('support.thanks'));
    } else {
      // Сюда встанет вызов платёжного провайдера (этап монетизации)
      toast(t('premium.payments_pending'), 'info');
    }
  });
}