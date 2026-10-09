// ============================================================
// store.mjs — глобальное состояние (паттерн Observer)
// ============================================================

const state = {
  user: null,             // { id, username, avatar_url, bio, ... } | null
  locale: 'ru',
  notifications: [],
  unreadCount: 0,
  unreadMessages: 0,      // непрочитанные личные сообщения (бейдж на иконке «Сообщения»)
  favorites: [],          // [{ question_id, status }]
  subscriptions: [],      // [{ target_type, target_id }]
  achievements: [],       // [achievement_type]
  route: null,            // текущий маршрут { path, params }
};

const listeners = new Set();
const keyListeners = new Map(); // key -> Set<fn>

export function getState() {
  return state;
}

/** Обновить состояние (частичный патч) и уведомить подписчиков */
export function setState(patch) {
  const changedKeys = Object.keys(patch);
  Object.assign(state, patch);
  emit(changedKeys);
}

/** Подписка на любые изменения состояния */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Подписка на изменения конкретного ключа состояния */
export function subscribeTo(key, fn) {
  if (!keyListeners.has(key)) keyListeners.set(key, new Set());
  keyListeners.get(key).add(fn);
  return () => keyListeners.get(key)?.delete(fn);
}

function emit(changedKeys = []) {
  listeners.forEach((fn) => {
    try { fn(state); } catch (e) { console.error('[store] listener error:', e); }
  });
  changedKeys.forEach((key) => {
    keyListeners.get(key)?.forEach((fn) => {
      try { fn(state[key], state); } catch (e) { console.error('[store] listener error:', e); }
    });
  });
}