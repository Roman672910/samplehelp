// ============================================================
// moderation.mjs — жалобы пользователей и экран модерации.
// • openReportModal(type, id) — модалка «⚑ Пожаловаться» (причина +
//   пояснение); вызывается со страницы вопроса (вопрос/ответ/комментарий)
//   и из шапки чужого профиля (type='profile' — мошенничество/чужие реквизиты).
// • renderModeration(container) — экран /moderation, доступен только
//   админам (profiles.is_admin): список жалоб с содержимым целей,
//   «Отклонить» и «Удалить контент» (с подтверждением).
// Повторная жалоба того же пользователя на тот же объект отклоняется
// (unique в БД / проверка в демо-слое) — защита от спама жалобами.
// ============================================================

import { t, getLocale } from './i18n.mjs';
import { escapeHtml, toast, openModal, confirmModal, timeAgo, initials } from './utils.mjs';
import { getState } from './store.mjs';
import { navigate } from './router.mjs';
import { requireAuth } from './auth.mjs';
import { submitReport, fetchReports, setReportStatus, removeReportedContent } from './api.mjs';

const REASONS = ['spam', 'offense', 'copyright', 'fraud', 'other'];
const REASON_ICONS = { spam: '🚫', offense: '⚠️', copyright: '©️', fraud: '💸', other: '❔' };

function truncate(text, n = 220) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Модалка жалобы на вопрос/ответ/комментарий/профиль.
 * @param {'question'|'answer'|'comment'|'profile'} targetType
 * @param {string} targetId
 */
export function openReportModal(targetType, targetId) {
  // На свой профиль пожаловаться нельзя — кнопка и так только у чужих,
  // но подстрахуемся (и от прямого вызова из консоли/теста)
  const { user } = getState();
  if (targetType === 'profile' && user && user.id === targetId) {
    toast(t('report.self'), 'error');
    return;
  }
  // Жалоба на профиль — почти всегда про реквизиты, поэтому «мошенничество»
  // сразу активной кнопкой: модератору меньше кликов, жалующемуся — понятнее
  let reason = targetType === 'profile' ? 'fraud' : REASONS[0];
  const content = document.createElement('div');
  content.dataset.help = 'report_modal'; // справка: вся форма жалобы
  content.innerHTML = `
    <div class="report-reasons" role="radiogroup" aria-label="${escapeHtml(t('report.title'))}">
      ${REASONS.map((r) => `
        <button type="button" class="report-reason ${r === reason ? 'active' : ''}" data-reason="${r}"
          role="radio" aria-checked="${r === reason}">${REASON_ICONS[r]} ${escapeHtml(t(`report.reason_${r}`))}</button>`).join('')}
    </div>
    <div class="field" style="margin-top:14px">
      <textarea id="report-note" rows="3" maxlength="500" placeholder="${escapeHtml(t('report.note_ph'))}" aria-label="${escapeHtml(t('report.note_ph'))}"></textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button type="button" class="btn btn-ghost" id="report-cancel">${escapeHtml(t('common.cancel'))}</button>
      <button type="button" class="btn btn-primary" id="report-send">⚑ ${escapeHtml(t('report.submit'))}</button>
    </div>`;

  openModal({
    title: t('report.title'),
    content,
    onMount: (overlay, close) => {
      content.querySelector('#report-cancel').addEventListener('click', close);
      content.querySelectorAll('.report-reason').forEach((b) => b.addEventListener('click', () => {
        reason = b.dataset.reason;
        content.querySelectorAll('.report-reason').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-checked', String(x === b));
        });
      }));
      content.querySelector('#report-send').addEventListener('click', async () => {
        const btn = content.querySelector('#report-send');
        btn.disabled = true;
        try {
          await submitReport({
            target_type: targetType,
            target_id: targetId,
            reason,
            note: content.querySelector('#report-note').value.trim(),
          });
          close();
          toast(t('report.sent'));
        } catch (e) {
          btn.disabled = false;
          toast(e.code === 'duplicate' ? t('report.duplicate') : (e.message || 'Error'), 'error');
        }
      });
    },
  });
}

/** Одна карточка жалобы в списке модерации */
function reportCardHtml(r) {
  const kind = r.target ? t(`report.target_${r.target.kind}`) : t(`report.target_${r.target_type}`);
  const statusChip = r.status !== 'new'
    ? `<span class="mod-status mod-status-${r.status}">${escapeHtml(t(`moderation.status_${r.status}`))}</span>`
    : '';
  return `
    <article class="card mod-card" data-rid="${escapeHtml(r.id)}" style="cursor:default">
      <div class="mod-head">
        <span class="mod-reason reason-${escapeHtml(r.reason)}">${REASON_ICONS[r.reason] || '❔'} ${escapeHtml(t(`report.reason_${r.reason}`))}</span>
        <span class="mod-kind">${escapeHtml(kind)}</span>
        <span class="mod-date">· ${escapeHtml(timeAgo(r.created_at, getLocale()))}</span>
        ${statusChip}
      </div>
      ${r.target ? `
        <div class="mod-target">
          ${r.target.title ? (r.target.kind === 'profile'
            ? `<div class="mod-target-title"><a href="/profile/${escapeHtml(r.target.user_id || '')}" data-route>${escapeHtml(truncate(r.target.title, 90))}</a></div>`
            : `<div class="mod-target-title">${escapeHtml(truncate(r.target.title, 90))}</div>`) : ''}
          <p class="mod-target-text">${escapeHtml(truncate(r.target.text))}</p>
          <div class="mod-target-meta">
            <span class="avatar sm">${r.target.author?.avatar_url ? `<img src="${escapeHtml(r.target.author.avatar_url)}" alt="">` : escapeHtml(initials(r.target.author?.username))}</span>
            ${escapeHtml(r.target.author?.username || '?')}
          </div>
        </div>`
        : `<p class="mod-gone">${escapeHtml(t('moderation.content_gone'))}</p>`}
      ${r.note ? `<div class="mod-note">💬 ${escapeHtml(truncate(r.note, 300))}</div>` : ''}
      <div class="mod-foot">
        <span class="mod-reporter">${escapeHtml(t('moderation.reporter'))} @${escapeHtml(r.reporter?.username || '?')}</span>
        <span class="spacer"></span>
        ${r.status === 'new' ? `
          <button type="button" class="btn btn-ghost btn-sm" data-help="mod_dismiss" data-act="dismiss">${escapeHtml(t('moderation.dismiss'))}</button>
          ${r.target && r.target.kind === 'profile'
            // Профиль удалить нельзя: модератор разбирается вручную и закрывает жалобу
            ? `<button type="button" class="btn btn-primary btn-sm" data-help="mod_action" data-act="action">${escapeHtml(t('moderation.action_taken'))}</button>`
            : (r.target ? `<button type="button" class="btn btn-danger btn-sm" data-help="mod_remove" data-act="remove">${escapeHtml(t('moderation.remove'))}</button>` : '')}` : ''}
      </div>
    </article>`;
}

/**
 * Экран «🛡 Модерация» (/moderation). Только для profiles.is_admin —
 * остальные перенаправляются в ленту. Вкладки: новые / все.
 */
export async function renderModeration(container) {
  const { user } = getState();
  if (!user || !user.is_admin) { navigate('/', { replace: true }); return; }

  let status = 'new';
  const cache = new Map(); // rid → строка жалобы (для removeReportedContent)

  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title">🛡 ${escapeHtml(t('moderation.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('moderation.subtitle'))}</p>
      </div>
      <div class="mod-guide">
        <b>${escapeHtml(t('moderation.guide_title'))}</b>
        <ul>
          <li>${escapeHtml(t('moderation.guide_r_spam'))}</li>
          <li>${escapeHtml(t('moderation.guide_r_copyright'))}</li>
          <li>${escapeHtml(t('moderation.guide_r_fraud'))}</li>
          <li>${escapeHtml(t('moderation.guide_r_other'))}</li>
        </ul>
        <p class="mod-guide-rules">${escapeHtml(t('moderation.guide_rule_taste'))} ${escapeHtml(t('moderation.guide_rule_dupes'))}</p>
        <a class="mod-guide-more" href="/help" data-route="/help" data-help="moderation_guide">📖 ${escapeHtml(t('moderation.guide_more'))}</a>
      </div>
      <div class="sort-tabs" role="tablist" aria-label="${escapeHtml(t('moderation.title'))}">
        <button type="button" class="sort-tab active" role="tab" data-st="new">${escapeHtml(t('moderation.tab_new'))}</button>
        <button type="button" class="sort-tab" role="tab" data-st="all">${escapeHtml(t('moderation.tab_all'))}</button>
      </div>
      <div id="mod-list" class="mod-list"><div class="loader"></div></div>
    </div>`;

  const listEl = container.querySelector('#mod-list');

  async function draw() {
    listEl.innerHTML = '<div class="loader"></div>';
    const reports = await fetchReports(status);
    cache.clear();
    reports.forEach((r) => cache.set(r.id, r));
    if (!reports.length) {
      listEl.innerHTML = `<div class="empty-state"><span class="empty-icon">🛡</span><p>${escapeHtml(t('moderation.empty'))}</p></div>`;
      return;
    }
    listEl.innerHTML = reports.map(reportCardHtml).join('');
  }

  container.querySelector('.sort-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-tab');
    if (!btn || btn.dataset.st === status) return;
    status = btn.dataset.st;
    container.querySelectorAll('.sort-tab').forEach((x) => x.classList.toggle('active', x === btn));
    draw();
  });

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.mod-card');
    const rid = card?.dataset.rid;
    if (!rid) return;
    btn.disabled = true;
    try {
      if (btn.dataset.act === 'dismiss') {
        await setReportStatus(rid, 'dismissed');
        toast(t('moderation.dismissed'));
      } else if (btn.dataset.act === 'action') {
        await setReportStatus(rid, 'actioned');
        toast(t('moderation.action_taken_toast'));
      } else if (btn.dataset.act === 'remove') {
        btn.disabled = false;
        if (!(await confirmModal(t('moderation.remove'), t('moderation.remove_confirm')))) return;
        const report = cache.get(rid);
        if (report) await removeReportedContent(report);
        toast(t('moderation.removed'));
      }
      await draw();
    } catch (err) {
      toast(err.message || 'Error', 'error');
      btn.disabled = false;
    }
  });

  await draw();
}
