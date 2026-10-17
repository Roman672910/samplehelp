// ============================================================
// contacts.mjs — контакты участника: модалка «Как связаться» + редактор.
//
// Чистый модуль: зависит только от i18n и utils, поэтому его может
// импортировать supabase.mjs (нормализация записей в fetchProfile) —
// циклов в графе модулей не возникает.
//
// ИСТОРИЯ (важно для понимания кода):
//  2026-10-11, заход A — контакты пришли на смену «Навыкам» и стояли
//  отдельным рядом в шапке профиля (плюс ряд «💳 Оплата»).
//  2026-10-11, решение заказчика — шапка возвращена к прежнему виду
//  (только DAW и арсенал), ряды убраны, а бейдж «🤝 Открыт к
//  коллаборациям» стал КНОПКОЙ: по клику открывается модалка
//  «Как связаться» (openContactsModal). Ряд «Оплата» и флаг
//  payment_markers удалены вовсе: вход в реквизиты — кнопка ☕ в шапке.
//  Побочный плюс: контакты больше не лежат в DOM страницы профиля —
//  чипы рендерятся только внутри модалки, открытой живым человеком.
//
// Модель: profiles.contact = [{ kind, value, label?, visibility }].
//  • kind — из CONTACT_KINDS (whatsapp сознательно не добавляли: для
//    аудитории RU мёртв, всё прочее покрывает 'other');
//  • visibility — 'members' | 'hidden'. Значение 'all' в схеме оставлено
//    на вырост, но клиент его НЕ выдаёт: normalizeContacts() приводит
//    'all' и любой мусор к 'members', чтобы контакт никогда не оказался
//    публичнее, чем задумано (решение заказчика от 2026-10-11: контакты
//    видят только зарегистрированные участники).
//  • e-mail и телефон дополнительно маскируются до нажатия «Показать».
//
// Правило видимости (единственная точка — canSeeContact):
//  владелец → всё без маски; остальные → только если включены ОБА
//  тумблера профиля: open_to_collab (бейдж — точка входа) и
//  contact_consent (согласие на публикацию, 152-ФЗ).
//
// ⚠️ Честное ограничение: строку профиля целиком отдаёт RLS-политика
// profiles_public_read (using (true)), поэтому «скрыто от анонимов» и
// маска — защита клиентская (от случайного взгляда и наивных парсеров),
// а не от DevTools/сырого ответа PostgREST. Серверное решение — вью
// profiles_public без колонки contact + RPC reveal_contact() с проверкой
// auth.uid(), логом и rate-limit — запланировано на Этап 3 (боевой режим).
// ============================================================

import { t } from './i18n.mjs';
import { escapeHtml, toast, openModal } from './utils.mjs';

export const CONTACT_KINDS = ['telegram', 'email', 'phone', 'discord', 'website', 'vk', 'other'];
/** Сколько контактов можно добавить (лимит проверяется на клиенте) */
export const MAX_CONTACTS = 6;
export const MAX_VALUE_LEN = 200;
export const MAX_LABEL_LEN = 40;

export const CONTACT_ICONS = {
  telegram: '✈️', email: '✉️', phone: '📞', discord: '🎧', website: '🌐', vk: '🔷', other: '🔗',
};

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i;
const RE_TELEGRAM = /^(@[a-z0-9_]{4,32}|https?:\/\/t\.me\/[a-z0-9_]{4,32}\/?)$/i;
const RE_DISCORD = /^([a-z0-9_]{2,32}(#[0-9]{4})?|[0-9]{17,20}|https?:\/\/discord\.(gg|com)\/[a-z0-9/]+)$/i;
const RE_VK = /^(https?:\/\/(www\.|m\.)?vk\.com\/[a-z0-9_.]+|@[a-z0-9_.]{3,}|club[0-9]+|id[0-9]+|[a-z0-9_.]{3,})$/i;
const RE_HTTPS = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
/** Разрешены только http(s): javascript:, data:, vbscript: и прочее — мусор */
const RE_SAFE_URL = /^https?:\/\//i;

const digitsOf = (v) => String(v || '').replace(/\D/g, '');

/**
 * Автоопределение типа контакта по значению (тот же паттерн, что
 * detectDonateKind в support.mjs и detectPlatform в profile.mjs).
 * @param {string} value
 * @returns {string} один из CONTACT_KINDS
 */
export function detectContactKind(value) {
  const v = String(value || '').trim();
  if (!v) return 'other';
  if (/t\.me\//i.test(v)) return 'telegram';
  if (/discord\.(gg|com)\//i.test(v)) return 'discord';
  if (/(^|\/\/|\.)vk\.(com|ru)\//i.test(v) || /^@(club|id)\d+/i.test(v)) return 'vk';
  if (RE_EMAIL.test(v)) return 'email';
  if (/^@/.test(v)) return 'telegram';
  if (/^\+?[\d\s()-]{10,20}$/.test(v) && digitsOf(v).length >= 10) return 'phone';
  if (/^[a-z0-9_]{2,32}#[0-9]{4}$/i.test(v)) return 'discord';
  if (RE_SAFE_URL.test(v)) return 'website';
  return 'other';
}

/**
 * Приведение записей из БД/снапшота к безопасному виду.
 * Отбрасывает мусор (неизвестный kind, пустое/слишком длинное значение,
 * не-строки), 'all'/неизвестная видимость → 'members'.
 * @param {*} raw
 * @returns {Array<{kind:string,value:string,label:string,visibility:string}>}
 */
export function normalizeContacts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const kind = CONTACT_KINDS.includes(c.kind) ? c.kind : detectContactKind(String(c.value || ''));
    const value = String(c.value == null ? '' : c.value).trim().slice(0, MAX_VALUE_LEN);
    if (!value) continue;
    const label = String(c.label == null ? '' : c.label).trim().slice(0, MAX_LABEL_LEN);
    // Видимость ужесточаем: публичнее 'members' не бывает никогда
    const visibility = c.visibility === 'hidden' ? 'hidden' : 'members';
    out.push({ kind, value, label, visibility });
  }
  return out;
}

/** Ключ для сравнения на дубли: один и тот же контакт в разном написании */
function dupKey(c) {
  return `${c.kind}:${String(c.value).toLowerCase().replace(/[\s()-]/g, '')}`;
}

/**
 * Валидация одной записи контакта.
 * @param {object} c { kind, value, label? }
 * @param {Array} [list] весь список — для проверки дублей
 * @param {number} [index] индекс проверяемой записи в list
 * @returns {{ok:boolean, errorKey?:string}}
 */
export function validateContact(c, list = [], index = -1) {
  const kind = CONTACT_KINDS.includes(c?.kind) ? c.kind : 'other';
  const value = String(c?.value == null ? '' : c.value).trim();

  if (!value) return { ok: false, errorKey: 'contact.invalid_empty' };
  if (value.length > MAX_VALUE_LEN) return { ok: false, errorKey: 'contact.invalid_long' };

  if (kind === 'email' && !RE_EMAIL.test(value)) return { ok: false, errorKey: 'contact.invalid_email' };
  if (kind === 'phone' && digitsOf(value).length < 10) return { ok: false, errorKey: 'contact.invalid_phone' };
  if (kind === 'telegram' && !RE_TELEGRAM.test(value)) return { ok: false, errorKey: 'contact.invalid_username' };
  if (kind === 'discord' && !RE_DISCORD.test(value)) return { ok: false, errorKey: 'contact.invalid_username' };
  if (kind === 'vk' && !RE_VK.test(value)) return { ok: false, errorKey: 'contact.invalid_username' };
  if (kind === 'website' && !RE_HTTPS.test(value)) return { ok: false, errorKey: 'contact.invalid_url' };
  // Для любого типа запрещаем «протоколы», которые исполняются в браузере
  if (/^\s*(javascript|data|vbscript|file):/i.test(value)) return { ok: false, errorKey: 'contact.invalid_url' };

  const key = dupKey({ kind, value });
  const dup = list.some((x, i) => i !== index && x && dupKey(x) === key);
  if (dup) return { ok: false, errorKey: 'contact.invalid_dup' };

  return { ok: true };
}

/** Маскируются только персональные данные (152-ФЗ): e-mail и телефон */
export function needsMask(kind) {
  return kind === 'email' || kind === 'phone';
}

/** anna@nullsea.ru → a•••@nullsea.ru (экранирование — на стороне рендера) */
export function maskEmail(value) {
  const v = String(value || '').trim();
  const at = v.lastIndexOf('@');
  if (at <= 0) return '•••';
  return `${v[0]}•••${v.slice(at)}`;
}

/**
 * +7 911 222-33-44 → +7 9•• •••-••-44
 * Разделители сохраняются; открыты первые 2 и последние 2 цифры.
 */
export function maskPhone(value) {
  const v = String(value || '');
  const total = digitsOf(v).length;
  if (total <= 4) return v.replace(/\d/g, '•');
  let seen = 0;
  return v.replace(/\d/g, (d) => {
    seen += 1;
    return (seen <= 2 || seen > total - 2) ? d : '•';
  });
}

/** Значение контакта с учётом маски (или без — если маска не нужна) */
export function maskValue(kind, value) {
  if (!needsMask(kind)) return String(value || '');
  return kind === 'email' ? maskEmail(value) : maskPhone(value);
}

/**
 * Матрица видимости. Единственная точка, где решается, кто что видит.
 * @param {object} p
 * @param {object|null} p.viewer текущий пользователь (null — аноним)
 * @param {object} p.profile владелец профиля
 * @param {object} p.contact запись контакта (уже нормализованная)
 * @returns {{show:boolean, masked:boolean, owner:boolean}}
 */
export function canSeeContact({ viewer, profile, contact }) {
  const owner = !!(viewer && profile && viewer.id === profile.id);
  if (owner) return { show: true, masked: false, owner: true };
  // Бейдж «Открыт к коллаборациям» — единственная точка входа в контакты:
  // тумблер выключен, значит бейджа в шапке нет и показывать негде
  if (!profile?.open_to_collab) return { show: false, masked: false, owner: false };
  // Согласия на публикацию нет → контакты видны только владельцу
  if (!profile?.contact_consent) return { show: false, masked: false, owner: false };
  // Анонимам контакты не отдаём вовсе (visibility 'members' — минимум)
  if (!viewer) return { show: false, masked: false, owner: false };
  if (contact?.visibility === 'hidden') return { show: false, masked: false, owner: false };
  return { show: true, masked: needsMask(contact?.kind), owner: false };
}

/** Внешняя ссылка контакта (если тип её подразумевает) — только http(s)/mailto/tel */
export function contactHref(c) {
  const v = String(c?.value || '').trim();
  if (c.kind === 'email') return `mailto:${v}`;
  if (c.kind === 'phone') return `tel:${digitsOf(v).replace(/^(\d{11})$/, '+$1')}`;
  if (c.kind === 'telegram') return RE_SAFE_URL.test(v) ? v : `https://t.me/${v.replace(/^@/, '')}`;
  if (c.kind === 'website') return RE_SAFE_URL.test(v) ? v : '';
  if (c.kind === 'vk') {
    if (RE_SAFE_URL.test(v)) return v;
    return `https://vk.com/${v.replace(/^@/, '')}`;
  }
  if (c.kind === 'discord' && /^https?:\/\//i.test(v)) return v;
  return '';
}

/**
 * Один чип контакта в модалке «Как связаться».
 * ctx: { viewer, profile, revealed:Set<number>, i:number }
 * Полное значение маскированного контакта кладём в data-full ТОЛЬКО для
 * залогиненных: анонимам чип не рендерится вовсе (см. canSeeContact), а после
 * нажатия «Показать» bindContactsBlock удаляет data-full из DOM.
 */
export function contactChipHtml(c, ctx) {
  const { i } = ctx;
  const masked = ctx.masked && !ctx.revealed?.has(i);
  const shown = masked ? maskValue(c.kind, c.value) : c.value;
  const href = masked ? '' : contactHref(c);
  const extTitle = t('contact.open');
  return `
    <span class="contact-chip" data-ci="${i}" data-kind="${escapeHtml(c.kind)}">
      <span class="contact-ico" aria-hidden="true">${CONTACT_ICONS[c.kind] || CONTACT_ICONS.other}</span>
      <span class="contact-value${masked ? ' contact-masked' : ''}"${masked ? ` data-full="${escapeHtml(c.value)}"` : ''}
            title="${escapeHtml(c.label || t(`contact.kind_${c.kind}`))}">${escapeHtml(shown)}</span>
      ${c.label ? `<span class="contact-label">${escapeHtml(c.label)}</span>` : ''}
      ${masked ? `<button type="button" class="contact-act" data-act="reveal" data-help="contact_reveal">${escapeHtml(t('contact.show'))}</button>` : ''}
      <button type="button" class="contact-act" data-act="copy" title="${escapeHtml(t('support.copy'))}" aria-label="${escapeHtml(t('support.copy'))}">⧉</button>
      ${href ? `<a class="contact-act" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(extTitle)}" aria-label="${escapeHtml(extTitle)}">↗</a>` : ''}
    </span>`;
}

/**
 * Бейдж-кнопка «🤝 Открыт к коллаборациям» для шапки профиля.
 * Единственная точка входа в контакты (решение заказчика 2026-10-11):
 * ряд «📇 Контакты» из шапки убран, вместо него клик по бейджу открывает
 * модалку «Как связаться». Нет тумблера open_to_collab — нет и бейджа.
 * @param {object} opts { profile, viewer }
 * @returns {string} HTML (пустая строка, если бейдж не положен)
 */
export function collabBadgeHtml({ profile, viewer }) {
  if (!profile?.open_to_collab) return '';
  const owner = !!(viewer && profile && viewer.id === profile.id);
  const title = t(owner ? 'contact.badge_title_own' : 'contact.badge_title');
  return `<button type="button" class="collab-badge" id="btn-collab" data-help="collab_badge"
            title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" aria-haspopup="dialog">
            🤝 ${escapeHtml(t('profile.collab'))}</button>`;
}

/** Контакты, которые видит viewer (с флагом маски) — для модалки «Как связаться» */
export function visibleContacts({ profile, viewer }) {
  const list = normalizeContacts(profile?.contact);
  return list
    .map((c, i) => ({ contact: c, i, vis: canSeeContact({ viewer, profile, contact: c }) }))
    .filter((x) => x.vis.show);
}

/**
 * Модалка «Как связаться»: чипы контактов (маска для e-mail/телефона),
 * «⧉ Скопировать», «↗ Открыть», «Показать», плюс «💬 Написать» (внутренний
 * чат) для чужого профиля и «⚙️ Изменить» для своего.
 * @param {object} opts { profile, viewer, onRequireAuth, onMessage, onEdit }
 * @returns {Function} функция закрытия модалки
 */
export function openContactsModal({ profile, viewer, onRequireAuth, onMessage, onEdit }) {
  const owner = !!(viewer && profile && viewer.id === profile.id);
  const shown = visibleContacts({ profile, viewer });

  const content = document.createElement('div');
  content.className = 'contacts-modal';
  content.innerHTML = `
    ${shown.length ? `
      <p class="sup-sub">${escapeHtml(t(owner ? 'contact.modal_hint_own' : 'contact.modal_hint'))}</p>
      <div class="contacts-modal-list" id="profile-contacts" data-help="profile_contacts">
        ${shown.map(({ contact: c, i, vis }) => contactChipHtml(c, {
          viewer, profile, i, masked: vis.masked, revealed: new Set(),
        })).join('')}
      </div>` : `
      <p class="sup-hint">${escapeHtml(t(owner ? 'contact.empty' : 'contact.empty_for_viewer'))}</p>`}
    <div class="contacts-modal-actions">
      ${owner
        ? `<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-help="contact_edit_btn">⚙️ ${escapeHtml(t('contact.edit'))}</button>`
        : `<button type="button" class="btn btn-primary btn-sm" data-act="write" data-help="contact_write">💬 ${escapeHtml(t('contact.write'))}</button>`}
    </div>`;

  return openModal({
    title: owner ? t('contact.modal_title_own') : t('contact.modal_title_user', { name: profile?.username || '' }),
    content,
    // overlay не нужен: клики обрабатывает bindContactsBlock на теле модалки
    onMount: (_overlay, close) => {
      bindContactsBlock(content, {
        profile,
        viewer,
        onRequireAuth: () => { close(); onRequireAuth?.(); },
        onMessage: () => { close(); onMessage?.(profile?.id); },
        onEdit: () => { close(); onEdit?.(); },
      });
    },
  });
}

/**
 * Обработка кликов в модалке «Как связаться»: «Показать» (раскрытие маски),
 * «Скопировать», «Написать» (внутренний чат), «Изменить» (свой профиль).
 * @param {HTMLElement} root контейнер со списком чипов (тело модалки)
 * @param {object} ctx { profile, viewer, onRequireAuth, onMessage, onEdit }
 */
export function bindContactsBlock(root, ctx = {}) {
  if (!root) return;
  const revealed = new Set();

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.act;

    if (act === 'reveal') {
      // Анониму вместо раскрытия показываем модалку входа
      if (!ctx.viewer) { e.preventDefault(); ctx.onRequireAuth?.(); return; }
      const chip = btn.closest('.contact-chip');
      const valueEl = chip?.querySelector('.contact-value');
      if (!chip || !valueEl) return;
      revealed.add(Number(chip.dataset.ci));
      valueEl.textContent = valueEl.dataset.full || valueEl.textContent;
      valueEl.classList.remove('contact-masked');
      delete valueEl.dataset.full; // полного значения в DOM больше не держим
      const href = contactHref({ kind: chip.dataset.kind, value: valueEl.textContent });
      if (href && !chip.querySelector('a.contact-act')) {
        const a = document.createElement('a');
        a.className = 'contact-act';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = t('contact.open');
        a.textContent = '↗';
        chip.appendChild(a);
      }
      btn.remove();
      return;
    }

    if (act === 'copy') {
      e.preventDefault();
      const chip = btn.closest('.contact-chip');
      const valueEl = chip?.querySelector('.contact-value');
      const value = valueEl?.dataset.full || valueEl?.textContent || '';
      // Анониму копировать нечего — чип ему не рендерится, но подстрахуемся
      if (!ctx.viewer) { ctx.onRequireAuth?.(); return; }
      copyContactValue(value);
      return;
    }

    if (act === 'write') {
      e.preventDefault();
      if (!ctx.viewer) { ctx.onRequireAuth?.(); return; }
      ctx.onMessage?.(ctx.profile?.id);
      return;
    }

    if (act === 'edit') {
      // Кнопка владельца — открывает настройки профиля (блок «Контакты»)
      e.preventDefault();
      ctx.onEdit?.();
    }
  });
}

/** Копирование с фолбэком для небезопасного контекста (http без TLS) */
export async function copyContactValue(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast(t('support.copied'));
  } catch {
    // Clipboard API недоступен — пробуем временную textarea, иначе показываем значение
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.('copy');
      ta.remove();
      if (ok) { toast(t('support.copied')); return; }
    } catch { /* ниже — тост со значением */ }
    toast(value, 'info', 8000);
  }
}

/** Опции <select> типа контакта (редактор в настройках и шаг онбординга) */
export function contactKindOptions(selected = 'telegram') {
  return CONTACT_KINDS.map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(t(`contact.kind_${k}`))}</option>`).join('');
}

/** Строка редактора контактов в настройках профиля (сетка как у способов приёма) */
export function contactEditorRowHtml(c, i) {
  // Вариант «Г» (2026-10-13): карточка с фиксированным видом — вид выбирается
  // в меню при добавлении, дальше меняется только значение/подпись
  const kind = CONTACT_KINDS.includes(c.kind) ? c.kind : 'other';
  return `
    <div class="set-slot contact-row" data-i="${i}">
      <div class="set-slot-head">
        <span class="ico" aria-hidden="true">${CONTACT_ICONS[kind]}</span>
        <span class="kind-name">${escapeHtml(t(`contact.kind_${kind}`))}</span>
        <button type="button" class="del contact-del" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">🗑</button>
      </div>
      <input type="text" class="contact-value-in" value="${escapeHtml(c.value || '')}" placeholder="${escapeHtml(t('contact.value_ph'))}" maxlength="${MAX_VALUE_LEN}" aria-label="${escapeHtml(t('contact.value_ph'))}">
      <input type="text" class="contact-label-in" value="${escapeHtml(c.label || '')}" placeholder="${escapeHtml(t('contact.label_ph'))}" maxlength="${MAX_LABEL_LEN}" aria-label="${escapeHtml(t('contact.label_ph'))}">
    </div>`;
}
