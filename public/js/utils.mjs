// ============================================================
// utils.mjs — общие утилиты (DOM, тосты, модалки, форматирование)
// ============================================================

/** Безопасное экранирование HTML */
export function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Форматирование секунд в m:ss */
export function formatTime(seconds = 0) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Относительная дата ("5 мин назад", "2 ч назад", "3 дн назад") */
export function timeAgo(dateInput, locale = 'ru') {
  const diff = (Date.now() - new Date(dateInput).getTime()) / 1000;
  const units = {
    ru: [['мин', 60], ['ч', 3600], ['дн', 86400]],
    en: [['min', 60], ['h', 3600], ['d', 86400]],
    de: [['Min', 60], ['Std', 3600], ['T', 86400]],
  };
  const u = units[locale] || units.en;
  if (diff < 60) return locale === 'de' ? 'gerade eben' : locale === 'en' ? 'just now' : 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} ${u[0][0]}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ${u[1][0]}`;
  return `${Math.floor(diff / 86400)} ${u[2][0]}`;
}

/**
 * Остаток времени до момента (для обратного отсчёта удаления решённого вопроса).
 * Возвращает «6 дн 23 ч» / «5 ч 12 мин» или null, если срок уже истёк.
 */
export function formatRemaining(targetInput, locale = 'ru') {
  const ms = new Date(targetInput).getTime() - Date.now();
  if (!(ms > 0)) return null;
  const units = {
    ru: { d: 'дн', h: 'ч', m: 'мин' },
    en: { d: 'd', h: 'h', m: 'min' },
    de: { d: 'T', h: 'Std', m: 'Min' },
  };
  const u = units[locale] || units.en;
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} ${u.d} ${h} ${u.h}`;
  if (h > 0) return `${h} ${u.h} ${m} ${u.m}`;
  return `${m} ${u.m}`;
}

/** Сколько полных дней осталось до момента (минимум 1) — для чипа «Решено · N дн» */
export function daysLeft(targetInput) {
  const ms = new Date(targetInput).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 86400000));
}

/** Инициалы из имени пользователя */
export function initials(name = '?') {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
}

/** Тост-уведомление снизу справа */
export function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 320);
  }, duration);
}

/**
 * Модальное окно.
 * @param {object} opts { title, content (HTML-строка или элемент), wide, onMount(modal, close) }
 * @returns {function} close — функция закрытия
 */
export function openModal({ title = '', content = '', wide = false, onMount = null }) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="modal-close" aria-label="Закрыть">&times;</button>
      </div>
      <div class="modal-body"></div>
    </div>`;
  const body = overlay.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else body.appendChild(content);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  overlay.querySelector('.modal-close').addEventListener('click', close);
  // Закрытие по клику на фон. Важно: НЕ обычный click на оверлее — при выделении
  // текста внутри модалки (mousedown на контенте, mouseup уже на фоне) браузер
  // порождает click на общем предке, т.е. на оверлее, и окно закрывалось.
  // Требуем, чтобы и нажатие, и отпускание мыши произошли строго на фоне.
  let downOnOverlay = false;
  overlay.addEventListener('mousedown', (e) => { downOnOverlay = e.target === overlay; });
  overlay.addEventListener('mouseup', (e) => {
    if (downOnOverlay && e.target === overlay) close();
    downOnOverlay = false;
  });
  document.addEventListener('keydown', onKey);

  root.appendChild(overlay);
  // Фокус на первый интерактивный элемент (a11y)
  const focusable = overlay.querySelector('input, textarea, select, button:not(.modal-close)');
  focusable?.focus();
  if (onMount) onMount(overlay, close);
  return close;
}

/** Запрос подтверждения через модалку */
export function confirmModal(title, text) {
  return new Promise((resolve) => {
    const content = document.createElement('div');
    content.innerHTML = `
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:18px"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn btn-quiet" data-act="no">—</button>
        <button type="button" class="btn btn-primary" data-act="yes">OK</button>
      </div>`;
    content.querySelector('p').textContent = text;
    let resolved = false;
    const close = openModal({
      title,
      content,
      onMount: (overlay, closeFn) => {
        content.querySelector('[data-act="yes"]').addEventListener('click', () => { resolved = true; closeFn(); resolve(true); });
        content.querySelector('[data-act="no"]').addEventListener('click', () => { resolved = true; closeFn(); resolve(false); });
      },
    });
    // закрытие по Escape / клику вне — считаем отказом
    const observer = new MutationObserver(() => {
      if (!document.body.contains(content)) {
        observer.disconnect();
        if (!resolved) resolve(false);
      }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true, subtree: true });
    void close;
  });
}

/** Дебаунс */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Генерация простого уникального id (для демо-режима) */
export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ============================================================
// ЛОГОТИПЫ DAW (inline SVG, фирменные цвета)
// ============================================================

/**
 * Иконка DAW по названию. Неизвестная DAW — первая буква в медном кружке.
 * @param {string} name — название DAW
 * @param {number} size — размер в px
 */
export function dawIcon(name, size = 18) {
  const n = String(name || '').toLowerCase();
  const wrap = (body) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
  const letterIcon = (letter, bg, fg = '#fff') =>
    wrap(`<circle cx="12" cy="12" r="10" fill="${bg}"/><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="700" font-family="monospace" fill="${fg}">${escapeHtml(letter)}</text>`);

  if (n.includes('fl studio') || n === 'fl') {
    // FL Studio — фирменный «фрукт»: оранжевый плод с бликом, листья и стебель
    return wrap(`
      <defs>
        <linearGradient id="sh-fl-fruit" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stop-color="#FFDD55"/><stop offset="0.45" stop-color="#F7941E"/><stop offset="1" stop-color="#C2410C"/>
        </linearGradient>
        <linearGradient id="sh-fl-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#A5D64C"/><stop offset="1" stop-color="#20602E"/>
        </linearGradient>
      </defs>
      <path d="M12.6 6.2c.6-2.2 1.8-3.8 3.6-4.6" stroke="#6BAF3E" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M12 6c3.5.3 5.8 3.5 5.4 7.2-.4 4-2.4 7.8-5.6 8.4-3 .5-5.2-2.4-5.5-6.4C6 11 8.6 5.7 12 6z" fill="url(#sh-fl-fruit)"/>
      <ellipse cx="9.2" cy="12" rx="1.3" ry="2.4" fill="#FFF3B0" opacity="0.55" transform="rotate(-10 9.2 12)"/>
      <path d="M12.2 6.4C10 4.4 7 4.2 4.6 5.6c1.6 2.4 4.8 2.8 7.6.8z" fill="url(#sh-fl-leaf)"/>
      <path d="M12.4 6.2c-1.2 2.6-.6 4.8 1.6 6.2 1.6-2 1.2-4.2-1.6-6.2z" fill="#2E7D32"/>
      <path d="M12.8 6c2.6-1.2 5.2-.6 7 1.6-2.2 1.8-5 1.4-7-1.6z" fill="url(#sh-fl-leaf)"/>`);
  }
  if (n.includes('ableton')) {
    // Ableton Live — дуги на чёрном
    return wrap('<rect x="2" y="2" width="20" height="20" rx="5" fill="#111"/><path d="M7 17a6.5 6.5 0 0 1 0-10M17 7a6.5 6.5 0 0 1 0 10" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M10.2 14.6a3.4 3.4 0 0 1 0-5.2M13.8 9.4a3.4 3.4 0 0 1 0 5.2" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="1.1" fill="#fff"/>');
  }
  if (n.includes('logic')) {
    // Logic Pro — радужные кольца
    return wrap('<circle cx="12" cy="12" r="10" fill="#101014"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke="#FF5F45" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M20.5 12A8.5 8.5 0 0 1 12 20.5" stroke="#FFC531" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M12 20.5A8.5 8.5 0 0 1 3.5 12" stroke="#4CD964" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M3.5 12A8.5 8.5 0 0 1 12 3.5" stroke="#4C9AFF" stroke-width="2.2" fill="none" stroke-linecap="round"/>');
  }
  if (n.includes('reaper')) return letterIcon('R', '#3a3a3f');
  if (n.includes('cubase')) {
    // Cubase — синий с волнами
    return wrap('<rect x="2" y="2" width="20" height="20" rx="5" fill="#1B6EC2"/><path d="M5 12.5c2-3 4-3 6 0s4 3 6 0M5 16.5c2-3 4-3 6 0s4 3 6 0" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="12" cy="7.5" r="1.4" fill="#fff"/>');
  }
  if (n.includes('studio one')) {
    // Studio One — сине-фиолетовый
    return wrap('<circle cx="12" cy="12" r="10" fill="#5B6EE1"/><path d="M8 9.2c1.5-1.5 6.5-1.5 8 0M8 14.8c1.5 1.5 6.5 1.5 8 0" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="#fff"/>');
  }
  if (n.includes('bitwig')) {
    // Bitwig — оранжевый зигзаг
    return wrap('<rect x="2" y="2" width="20" height="20" rx="5" fill="#161616"/><path d="M5 14l3-4 2.5 3L14 8l2 4 3-2" stroke="#FF6B00" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>');
  }
  if (n.includes('pro tools')) return letterIcon('P', '#0072CE');
  if (n.includes('garageband')) {
    // GarageBand — золотая волна на тёмном
    return wrap('<circle cx="12" cy="12" r="10" fill="#1c1c1e"/><path d="M5 12c2-4.5 4.5-4.5 7 0s5 4.5 7 0" stroke="#F5A623" stroke-width="2" fill="none" stroke-linecap="round"/>');
  }
  if (n.includes('reason')) return letterIcon('R', '#5C7CFA');
  if (n.includes('audacity')) return letterIcon('A', '#FFB400', '#333');
  if (n.includes('cakewalk')) return letterIcon('C', '#FF7A00');
  if (n.includes('tracktion') || n.includes('waveform')) return letterIcon('W', '#00B3A4');
  // Неизвестная DAW — первая буква в медном кружке (стиль приложения)
  const letter = (String(name).trim()[0] || '?').toUpperCase();
  return wrap(`<circle cx="12" cy="12" r="9.5" fill="none" stroke="#cd7f32" stroke-width="2"/><text x="12" y="16.4" text-anchor="middle" font-size="12" font-weight="700" font-family="monospace" fill="#cd7f32">${escapeHtml(letter)}</text>`);
}