// backend/src/rules.js — ПОРТ RLS-политик Supabase в серверные правила
// (Фаза A, заход 48) + серверная приватность контактов (заход 18: маски
// наконец на сервере, а не в клиенте).
import { ApiError } from './db.js';

export const deny = (code = 'forbidden', message = 'Недостаточно прав', status = 403) =>
  new ApiError(code, message, status);

/** Чтение публично (аналог policies *_public_read using (true)) */
export const canReadPublic = () => true;

/** Изменение/удаление СВОЕЙ строки: маршруты проверяют явно через isOwner */
export function assertOwnRow(row, user, code = 'forbidden') {
  if (!isOwner(row, user)) throw deny(code);
}

export function isOwner(row, user) {
  return !!user && (row.user_id === user.id || row.author_id === user.id || row.id === user.id);
}

/** Админ-ветки (reports status, ideas status/reply, удаления любые) */
export function assertAdmin(user) {
  if (!user?.is_admin) throw deny();
}

// ---------- Контакты: серверные маски (порт contacts.mjs canSeeContact/mask*) ----------
const maskEmail = (v) => {
  const [name, domain] = String(v).split('@');
  if (!domain) return '•'.repeat(Math.min(name?.length || 1, 3)) + '@' + (domain || '');
  const head = name.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(3, Math.min(name.length - 1, 6)))}@${domain}`;
};
const maskPhone = (v) => {
  const digits = String(v).replace(/\D/g, '');
  if (digits.length <= 4) return String(v).replace(/\d/g, '•');
  let seen = 0;
  return String(v).replace(/\d/g, (d) => {
    seen += 1;
    return seen <= 2 || seen > digits.length - 2 ? d : '•';
  });
};
export function maskContactValue(kind, value) {
  if (kind === 'email') return maskEmail(value);
  if (kind === 'phone') return maskPhone(value);
  return value;
}

/**
 * Что видит viewer профиля owner: возвращает контакты ГОТОВЫМИ к показу
 * (полные — владельцу; маскированные — участнику при согласии и бейдже;
 * иначе — пустой список). Клиент (Фаза C) больше не маскирует сам.
 */
export function visibleContacts(profile, viewer) {
  const owner = !!viewer && viewer.id === profile.id;
  const list = Array.isArray(profile.contact) ? profile.contact : [];
  if (owner) return list;
  if (!viewer) return [];
  const allowed = profile.open_to_collab && profile.contact_consent;
  if (!allowed) return [];
  return list
    .filter((c) => c?.visibility !== 'hidden')
    .map((c) => ({ ...c, value: maskContactValue(c.kind, c.value), masked: true }));
}

/** Публичный профиль: сервер резет чувствительные поля для не-владельца */
export function sanitizeProfile(profile, viewer) {
  const owner = !!viewer && viewer.id === profile.id;
  const out = { ...profile };
  out.contact = visibleContacts(profile, viewer);
  if (!owner) {
    delete out.contact_consent;
  }
  return out;
}
