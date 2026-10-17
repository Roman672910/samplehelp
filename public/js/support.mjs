// ============================================================
// support.mjs — поддержка авторов и проекта.
// МОДЕЛЬ A (решение 2026-10-11): платформа НЕ проводит деньги.
// • Получатель сам настраивает способы приёма в «Настройках профиля»
//   (profiles.donate_methods); для проекта способы лежат в
//   CONFIG.DONATIONS_PROJECT. Модалка показывает способы кнопкой
//   «Скопировать» (все значения — телефон/номер карты, не ссылки).
// • v9 (решение заказчика 2026-10-11): способов приёма СТРОГО ДВА —
//   СБП (по номеру телефона) и банковская карта. ЮMoney/Boosty/
//   DonationAlerts/Telegram/крипта/«другое» из продукта удалены;
//   записи из старых снапшотов отфильтровывает normalizeDonateMethods.
//   Правила способов вынесены в чистый модуль donate.mjs (его импортирует
//   и supabase.mjs для миграции демо-базы — без цикла/TDZ); ниже —
//   реэкспорт, публичный API модуля не изменился.
//   QR-заход 2026-10-13: способ приёма один — QR-код СБП, который автор
//   ЗАГРУЖАЕТ из приложения банка (сгенерировать рабочий QR на клиенте
//   нельзя — payload выдаёт НСПК). Картинка даунскейлится до ≤600px/~380 КБ,
//   декодируется jsQR и проходит фишинг-разбор ДО сохранения/показа: автор
//   видит, что публикует, донор — куда ведёт код (кнопка «Прочитать QR»).
// • Видимость каналов (фикс жалобы «не вижу переключатель», 2026-10-14):
//   два способа → переключатель; один → шапка «Способ перевода — …» (донор
//   сразу видит канал и почему выбора нет); в собственной модалке при
//   способах < 2 — подсказка автору, как включить выбор для доноров.
// • Бесплатное «спасибо»: сообщение → donations(kind='thanks', amount=0) →
//   счётчик «☕ N» на профиле (fetchSupportCount) + уведомление автору
//   (type 'support'). Работает и когда способов приёма нет.
// • Одна сущность на два случая: recipientUserId = null → поддержка проекта.
// • ENABLE_DONATIONS=false — вызывающие стороны прячут кнопки; модалка
//   на всякий случай показывает заглушку «Скоро».
// UI совместим с моделью B (платежи внутри платформы, дорожная карта):
// провайдер встанет отдельным блоком, сигнатура openSupportModal не изменится.
// ============================================================

import { CONFIG } from './config.mjs';
import { t, getLocale } from './i18n.mjs';
import { openModal, toast, escapeHtml, timeAgo } from './utils.mjs';
import { getState } from './store.mjs';
import { recordDonation, markDonationTransfer, confirmDonation, fetchDonationsFor } from './api.mjs';
import { decodeDataUrl, analyzeQrPayload, renderQrAnalysis } from './qrscan.mjs';
import { normalizeDonateMethods, canonicalBoostyUrl } from './donate.mjs';

export { DONATE_KINDS, MAX_METHODS, normalizeDonateMethods, validateDonateMethod, canonicalBoostyUrl } from './donate.mjs';

export const KIND_ICONS = { qr: '📱', boosty: '🟠' };

async function copyValue(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast(t('support.copied'));
  } catch {
    toast(value, 'info', 8000); // нет clipboard API — показываем значение
  }
}

function qrRowHtml(m, i) {
  // QR-заход 2026-10-13: способ один — QR-код СБП. Донор видит картинку
  // (сканирует телефоном) и может ПРОЧИТАТЬ её на компе: декодер jsQR +
  // фишинг-разбор ДО любого перехода (qrscan.mjs).
  return `
    <div class="sup-qr-block" data-kind="${escapeHtml(m.kind)}">
      <div class="sup-qr-top">
        <img class="qr-img" src="${escapeHtml(m.qr_data_url)}" alt="${escapeHtml(t('support.kind_qr'))}">
        <div class="sup-qr-side">
          <b>${escapeHtml(m.label || t('support.kind_qr'))}</b>
          <span class="sup-method-hint">${escapeHtml(t('support.qr_scan_hint'))}</span>
          <button type="button" class="btn btn-quiet btn-sm" data-qr-read="${i}" data-help="qr_read">🔍 ${escapeHtml(t('support.qr_read_btn'))}</button>
        </div>
      </div>
      <div class="qr-analysis" data-qr-host="${i}" data-help="qr_analysis" hidden></div>
    </div>`;
}

/** Boosty: платёж проводит сама платформа — нам хватает ссылки на страницу */
function boostyRowHtml(m) {
  return `
    <div class="sup-boosty" data-kind="boosty">
      <a class="boosty-btn" href="${escapeHtml(m.value)}" target="_blank" rel="noopener noreferrer" data-help="boosty_open">🟠 ${escapeHtml(t('support.boosty_open'))}</a>
      <span class="sup-method-hint">${escapeHtml(t('support.boosty_hint'))}</span>
      <span class="sup-boosty-url">${escapeHtml(m.value)}</span>
    </div>`;
}

function methodRowHtml(m, i) {
  return m.kind === 'boosty' ? boostyRowHtml(m, i) : qrRowHtml(m, i);
}

/**
 * Модалка поддержки.
 * @param {object} opts { recipientUserId = null (проект), recipientName, recipientMethods }
 * Вызывающая сторона сама проверяет авторизацию (requireAuth).
 */
export function openSupportModal({ recipientUserId = null, recipientName = '', recipientMethods = null } = {}) {
  if (CONFIG.ENABLE_DONATIONS === false) {
    openModal({
      title: t('support.menu_btn'),
      content: `<p class="sup-sub">${escapeHtml(t('support.soon_text'))}</p>`,
    });
    return;
  }
  const isProject = recipientUserId === null;
  // Заход 2026-10-13: донор видит блок «сообщение к переводу» + отметку
  // «Я перевёл»; автор в своей же модалке — список отметок с «Получено ✓»
  const viewer = getState().user;
  const isOwner = !isProject && !!viewer && viewer.id === recipientUserId;
  const commentText = t('support.comment_tpl', { author: `@${recipientName || ''}` });
  // Нормализация на входе: защищает от старых снапшотов LocalStorage (v≤8),
  // где у профилей могли быть ЮMoney/Boosty/крипта и т. п.
  const methods = normalizeDonateMethods(isProject ? CONFIG.DONATIONS_PROJECT : recipientMethods);
  const title = isProject ? t('support.title_project') : t('support.title_user', { name: recipientName });

  const content = document.createElement('div');
  content.innerHTML = `
    <p class="sup-sub">${escapeHtml(isProject ? t('support.subtitle_project') : t('support.subtitle_user'))}</p>
    ${methods.length ? `
      <div class="sup-methods" id="sup-methods" data-help="sup_methods">
        ${methods.length > 1 ? `
        <div class="sup-channels" data-help="support_channel">
          <span class="cap">${escapeHtml(t('support.choose_channel'))}</span>
          <div class="sup-channels-row" role="tablist" aria-label="${escapeHtml(t('support.choose_channel'))}">
            ${methods.map((m, i) => `<button type="button" class="chan-btn${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}" data-chan="${i}">${KIND_ICONS[m.kind] || ''} ${escapeHtml(t(`support.kind_${m.kind}`))}</button>`).join('')}
          </div>
        </div>` : `<span class="sup-chan-cap">${escapeHtml(t('support.channel_single', { kind: `${KIND_ICONS[methods[0].kind] || ''} ${t(`support.kind_${methods[0].kind}`)}`.trim() }))}</span>`}
        ${methods.map((m, i) => `<div class="sup-chan" data-chank="${i}" ${i > 0 ? 'hidden' : ''}>${methodRowHtml(m, i)}</div>`).join('')}
      </div>` : `
      <p class="sup-hint">${escapeHtml(isProject ? t('support.no_methods_project') : t('support.no_methods_other'))}</p>`}
    ${!isProject && !isOwner ? `
    <div class="sup-comment" data-help="support_copy_comment">
      <p class="sup-hint">${escapeHtml(t('support.comment_hint'))}</p>
      <div class="sup-comment-row">
        <code id="sup-comment-text">${escapeHtml(commentText)}</code>
        <button type="button" class="btn btn-quiet btn-sm" id="sup-copy-comment">${escapeHtml(t('support.comment_copy'))}</button>
      </div>
    </div>
    <div class="sup-mark" data-help="support_mark">
      <p class="sup-hint"><b>${escapeHtml(t('support.mark_title'))}</b></p>
      <div class="sup-mark-row">
        <input type="text" inputmode="numeric" id="sup-mark-amount" placeholder="${escapeHtml(t('support.mark_amount_ph'))}" aria-label="${escapeHtml(t('support.mark_amount_ph'))}" maxlength="9">
        <input type="text" id="sup-mark-msg" placeholder="${escapeHtml(t('support.mark_msg_ph'))}" aria-label="${escapeHtml(t('support.mark_msg_ph'))}" maxlength="140">
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="sup-mark-send" style="width:100%;margin-top:8px">💸 ${escapeHtml(t('support.mark_btn'))}</button>
    </div>
    <p class="sup-antifraud" data-help="support_antifraud">🛡️ ${escapeHtml(t('support.antifraud'))}</p>` : ''}
    ${isOwner && methods.length < 2 ? `
    <div class="sup-owner-cfg">
      <p class="sup-hint">💡 ${escapeHtml(methods.length === 1 ? t('support.owner_chan_hint') : t('support.owner_chan_none'))}</p>
    </div>` : ''}
    ${isOwner ? `
    <div class="sup-marks" data-help="support_confirm">
      <p class="sup-hint"><b>${escapeHtml(t('support.marks_title'))}</b></p>
      <div id="sup-marks-list"></div>
    </div>` : ''}
    <div class="sup-thanks" data-help="sup_thanks">
      <div class="field">
        <textarea id="sup-msg" rows="2" maxlength="140" placeholder="${escapeHtml(t('support.thanks_ph'))}" aria-label="${escapeHtml(t('support.thanks_ph'))}"></textarea>
      </div>
      <button type="button" class="btn btn-primary" id="sup-thanks-send" style="width:100%">
        ☕ ${escapeHtml(t('support.thanks_send'))}
      </button>
    </div>
    <p class="sup-disclaimer" data-help="sup_disclaimer">${escapeHtml(t(isProject ? 'support.disclaimer' : 'support.disclaimer_strong'))}</p>`;

  openModal({
    title,
    content,
    onMount: (overlay, close) => {
      // Переключатель каналов перевода (QR / Boosty), если способов несколько
      content.querySelectorAll('.chan-btn').forEach((btn) => btn.addEventListener('click', () => {
        content.querySelectorAll('.chan-btn').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', String(on));
        });
        content.querySelectorAll('#sup-methods .sup-chan').forEach((blk) => {
          blk.hidden = blk.dataset.chank !== btn.dataset.chan;
        });
      }));
      // «Прочитать QR»: декодируем картинку и показываем фишинг-разбор
      // ПЕРЕД любым переходом; повторный клик сворачивает панель
      content.querySelectorAll('[data-qr-read]').forEach((btn) => btn.addEventListener('click', async () => {
        const m = methods[Number(btn.dataset.qrRead)];
        const host = content.querySelector(`[data-qr-host="${btn.dataset.qrRead}"]`);
        if (!m || !host) return;
        if (!host.hidden) { host.hidden = true; return; }
        host.hidden = false;
        host.innerHTML = `<p class="sup-hint">${escapeHtml(t('support.qr_reading'))}</p>`;
        try {
          const payload = await decodeDataUrl(m.qr_data_url);
          if (!payload) {
            host.innerHTML = `<p class="sup-hint">${escapeHtml(t('support.qr_decode_fail'))}</p>`;
            return;
          }
          renderQrAnalysis(host, analyzeQrPayload(payload), { onCopy: (raw) => copyValue(raw) });
        } catch {
          host.innerHTML = `<p class="sup-hint">${escapeHtml(t('support.qr_decode_fail'))}</p>`;
        }
      }));
      // «Скопировать сообщение»: текст для поля «сообщение» в банке
      content.querySelector('#sup-copy-comment')?.addEventListener('click', () => copyValue(commentText));
      // Отметка «Я перевёл»: сумма + сообщение → уведомление автору
      content.querySelector('#sup-mark-send')?.addEventListener('click', async () => {
        const amtRaw = content.querySelector('#sup-mark-amount').value.trim().replace(/\s+/g, '');
        const amount = Number(amtRaw);
        if (!amtRaw || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
          toast(t('support.mark_invalid'), 'error');
          return;
        }
        const message = content.querySelector('#sup-mark-msg').value.trim();
        const row = await markDonationTransfer({ recipientUserId, amount: Math.round(amount), message });
        if (row) {
          toast(t('support.mark_done_toast'));
          content.querySelector('#sup-mark-amount').value = '';
          content.querySelector('#sup-mark-msg').value = '';
        }
      });
      // Автор: список отметок о переводах + «Получено ✓»
      const marksBox = content.querySelector('#sup-marks-list');
      if (marksBox) {
        const drawMarks = async () => {
          const rows = await fetchDonationsFor(recipientUserId);
          marksBox.innerHTML = rows.length ? rows.map((d) => `
            <div class="sup-mark-item">
              <span class="amt">${d.amount} ₽</span>
              <span class="who">@${escapeHtml(d.donor_name || '?')}</span>
              ${d.message ? `<span class="msg">«${escapeHtml(d.message)}»</span>` : ''}
              <span class="tm">${escapeHtml(timeAgo(d.created_at, getLocale()))}</span>
              ${d.status === 'intent'
                ? `<button type="button" class="btn btn-quiet btn-sm" data-confirm-d="${escapeHtml(d.id)}">${escapeHtml(t('support.mark_confirm'))}</button>`
                : `<span class="done">${escapeHtml(t('support.mark_confirmed'))}</span>`}
            </div>`).join('')
            : `<p class="sup-hint">${escapeHtml(t('support.marks_empty'))}</p>`;
          marksBox.querySelectorAll('[data-confirm-d]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const okd = await confirmDonation(btn.dataset.confirmD);
              if (!okd) return;
              toast(t('support.mark_confirmed_toast'));
              await drawMarks();
            });
          });
        };
        drawMarks();
      }
      content.querySelector('#sup-thanks-send').addEventListener('click', async () => {
        const btn = content.querySelector('#sup-thanks-send');
        btn.disabled = true;
        const message = content.querySelector('#sup-msg').value.trim();
        const row = await recordDonation({
          recipient_user_id: recipientUserId,
          amount: 0,
          currency: 'RUB',
          message,
          kind: 'thanks',
        });
        if (row) {
          close();
          toast(t('support.thanks_sent'));
        } else {
          btn.disabled = false;
          toast(t('support.soon_text'), 'error');
        }
      });
    },
  });
}
