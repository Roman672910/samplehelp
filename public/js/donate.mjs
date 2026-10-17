// ============================================================
// donate.mjs — правила способов приёма денег (чистый модуль).
// QR-заход 2026-10-13: способ приёма — QR-код СБП автора: картинка
// (qr_data_url — даунскейл ≤600px, ~380 КБ), декодированное содержимое
// (value — payload QR, показывается донору через безопасный разбор
// qrscan.mjs) и подпись (label — банк/пометка). СБП по номеру телефона и
// банковская карта УДАЛЕНЫ из продукта; записи старых видов
// (sbp/card/yoomoney/crypto/…) отфильтровывает normalizeDonateMethods.
// + Boosty (решение заказчика 2026-10-13): ВТОРОЙ канал приёма — ссылка на
// страницу автора boosty.to/<имя>; платёж проводит сама платформа Boosty
// (модель A не нарушается: деньги мимо SampleHelp). Донор в модалке
// поддержки выбирает канал переключателем, если включены оба способа.
//
// Почему отдельный модуль, а не support.mjs: supabase.mjs применяет
// нормализацию уже на стартовой миграции демо-базы (loadDemo →
// migrateDemo), а support.mjs импортирует из supabase.mjs recordDonation.
// Прямой импорт support.mjs из supabase.mjs создал бы цикл с риском TDZ.
// Здесь — ноль импортов, безопасно для любого порядка загрузки.
// support.mjs реэкспортирует эти же имена.
//
// Рабочий QR приёма физлицу нельзя СГЕНЕРИРОВАТЬ на клиенте (payload
// qr.nspk.ru выдаёт НСПК с контрольной суммой; персональный QR получатель
// создаёт в приложении своего банка) — поэтому автор ЗАГРУЖАЕТ картинку,
// а мы её декодируем (jsQR) и показываем содержимое ДО сохранения:
// автор видит, что публикует, донор — куда ведёт код (фишинг-разбор).
// ============================================================

/** Разрешённые способы приёма: единственный — QR-код СБП (2026-10-13) */
export const DONATE_KINDS = ['qr', 'boosty'];

/** Лимит способов: по одному на вид (QR + Boosty) */
export const MAX_METHODS = 2;

/** Потолок веса картинки QR внутри dataURL (квота localStorage), байт */
export const QR_MAX_BYTES = 380 * 1024;

/**
 * Приведение сохранённых способов к правилам продукта. Точки вызова:
 * модалка поддержки (вход), fetchProfile (демо и реал), миграция демо-базы.
 * Выбрасывает всё, кроме kind='qr' с картинкой и декодированным содержимым;
 * обрезает до MAX_METHODS. Структура записи:
 * { kind:'qr', value, qr_data_url, label }.
 */
/**
 * Приведение ссылки Boosty к канону: https://boosty.to/<имя>.
 * Принимает «boosty.to/name», «@name», «name», с http/https, с хвостом;
 * чужие домены и мусор → null.
 */
export function canonicalBoostyUrl(value) {
  let v = String(value || '').trim();
  if (!v) return null;
  const bare = v.replace(/^@/, '');
  // «@имя» или просто имя без точек — это имя страницы на Boosty
  if (!bare.includes('.') && /^[a-z0-9_.-]{3,50}$/i.test(bare)) return `https://boosty.to/${bare}`;
  v = bare;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let u;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'boosty.to') return null;
  const name = u.pathname.replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9_.-]{3,50}$/i.test(name)) return null;
  return `https://boosty.to/${name}`;
}

export function normalizeDonateMethods(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    if (seen.has(raw.kind)) continue; // по одному способу на вид
    if (raw.kind === 'qr') {
      const value = String(raw.value || '').trim();
      const qr = String(raw.qr_data_url || '').trim();
      if (!value || !qr.startsWith('data:image/')) continue;
      out.push({
        kind: 'qr',
        value: value.slice(0, 2000),
        qr_data_url: qr,
        label: String(raw.label || '').trim().slice(0, 40),
      });
      seen.add('qr');
    } else if (raw.kind === 'boosty') {
      const url = canonicalBoostyUrl(raw.value);
      if (!url) continue; // sbp/card/крипта/ЮMoney/чужие домены — устарело или мусор
      out.push({ kind: 'boosty', value: url, label: String(raw.label || '').trim().slice(0, 40) });
      seen.add('boosty');
    }
    if (out.length >= MAX_METHODS) break;
  }
  return out;
}

/** Валидация способа перед сохранением (инлайн-ошибки payment.invalid_*) */
export function validateDonateMethod(m) {
  if (!m) return { ok: false, errorKey: 'payment.invalid_qr' };
  if (m.kind === 'boosty') {
    // пустое значение — не ошибка: способ просто выключен (слот пуст)
    if (!String(m.value || '').trim()) return { ok: true };
    return canonicalBoostyUrl(m.value)
      ? { ok: true }
      : { ok: false, errorKey: 'payment.invalid_boosty' };
  }
  if (m.kind !== 'qr') return { ok: false, errorKey: 'payment.invalid_qr' };
  if (!String(m.value || '').trim()) return { ok: false, errorKey: 'payment.invalid_qr' };
  const qr = String(m.qr_data_url || '');
  if (!qr.startsWith('data:image/')) return { ok: false, errorKey: 'payment.invalid_qr' };
  if (qr.length > QR_MAX_BYTES * 1.4) return { ok: false, errorKey: 'payment.invalid_qr' };
  return { ok: true };
}
