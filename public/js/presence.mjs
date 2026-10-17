// ============================================================
// presence.mjs — «кто онлайн» (заход 40, 2026-10-14): ОТДЕЛЬНОГО чипа-
// виджетa больше нет — статус онлайн/офлайн рисуется ТОЧКОЙ на аватарках
// авторов в ленте (команда заказчика: «убрать presence-chip, отмечать прямо
// в ленте на avatar sm»). Точка неинтерактивна; описание — в режиме справки
// (data-help="presence_dot").
// • subscribeOnlineSet(cb): cb(Set<id> онлайн-пользователей) → unsubscribe.
// • Демо — симуляция: пул getDemoPresencePool() (сид-профили), суточная
//   кривая + редкие ротации на тиках; залогиненный добавляет себя всегда.
// • Реал — Supabase Realtime presence: канал presence:global,
//   track({uid, username, avatar_url, guest}); гости не персонализируются
//   (точка — только для участников с id).
// • Приватность: opt-out «Не показывать мой онлайн» удалён 2026-10-13.
// ============================================================

import { CONFIG, IS_DEMO } from './config.mjs';
import { getDemoPresencePool, subscribePresenceRoom } from './api.mjs';
import { getState } from './store.mjs';

const scopes = new Map(); // 'global' -> { users, guests, subs:Set, timer, pool }

function tickMs() { return CONFIG.PRESENCE_TICK_MS || 15000; }

function clientId() {
  try {
    let id = window.sessionStorage?.getItem('sh_presence_id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      window.sessionStorage?.setItem('sh_presence_id', id);
    }
    return id;
  } catch { return 'anon'; }
}

const jitter = (n) => Math.floor(Math.random() * (n + 1));

function selfEntry() {
  const { user } = getState();
  if (!user) return null;
  return { id: user.id, username: user.username, avatar_url: user.avatar_url || null, you: true };
}

// ---------- демо-симуляция ----------
function demoGlobalBase() {
  const h = new Date().getHours();
  const day = Math.sin(((h - 5) / 24) * Math.PI * 2);
  return Math.max(1, Math.round(3 + day * 2)); // 1..5 именнованных онлайн
}
function pickUsers(pool, count, offset = 0) {
  if (!pool.length) return [];
  const out = [];
  const n = Math.min(pool.length, count);
  for (let i = 0; i < n; i++) out.push(pool[(offset + i) % pool.length]);
  return out;
}

function demoSubscribe(cb) {
  let sc = scopes.get('global');
  if (!sc) {
    const pool = getDemoPresencePool();
    const h = new Date().getHours();
    sc = {
      pool,
      users: pickUsers(pool, demoGlobalBase(), h % Math.max(1, pool.length)),
      guests: 1 + jitter(3),
      subs: new Set(), timer: null,
    };
    scopes.set('global', sc);
  }
  sc.subs.add(cb);
  if (!sc.timer) {
    sc.timer = setInterval(() => {
      // редкая ротация: кто-то зашёл / вышел + дрейф гостей
      if (sc.pool.length > sc.users.length && (sc.users.length === 0 || Math.random() < 0.5)) {
        const free = sc.pool.filter((p) => !sc.users.some((u) => u.id === p.id));
        if (free.length) sc.users = [...sc.users, free[jitter(free.length - 1)]] ;
      } else if (sc.users.length > Math.max(0, demoGlobalBase() - 1) && Math.random() < 0.4) {
        sc.users = sc.users.slice(0, -1);
      }
      sc.guests = Math.max(0, Math.min(7, sc.guests + [-1, 0, 1][jitter(2)]));
      emitScope(sc);
    }, tickMs());
  }
  emitTo(cb, sc);
  return () => {
    sc.subs.delete(cb);
    if (!sc.subs.size) {
      clearInterval(sc.timer);
      scopes.delete('global');
    }
  };
}
function emitTo(cb, sc) {
  const me = selfEntry();
  const users = me ? [me, ...sc.users] : [...sc.users];
  cb({ users, guests: sc.guests, total: users.length + sc.guests });
}
function emitScope(sc) { sc.subs.forEach((cb) => emitTo(cb, sc)); }

// ---------- реал: Socket.IO presence (Фаза B/C перезахода 48) ----------
// Комната presence:global на сервере (realtime.js): track/untrack пересчитывают
// { users, guests, total } — payload один в один с прежним Supabase presence.
async function realSubscribe(cb) {
  const me = clientId();
  const { user } = getState();
  // заход 42: uid = id профиля (не случайный clientId), иначе множество
  // онлайна не совпадало бы с id авторов в ленте/диалогах
  const meta = { uid: user?.id || me, username: user?.username || '', avatar_url: user?.avatar_url || null, guest: !user };
  return subscribePresenceRoom('presence:global', meta, (st) => {
    const myId = getState().user?.id || me;
    const users = (st.users || []).map((m) => ({
      id: m.uid, username: m.username || '?', avatar_url: m.avatar_url || null, you: m.uid === myId,
    }));
    const guests = st.guests || 0;
    cb({ users, guests, total: users.length + guests });
  });
}

function subscribe(cb) {
  if (CONFIG.FEATURES?.PRESENCE === false) return () => {};
  if (IS_DEMO) return demoSubscribe(cb);
  let un = () => {};
  let dead = false;
  realSubscribe(cb).then((fn) => { if (dead) fn(); else un = fn; });
  return () => { dead = true; un(); };
}

/**
 * Множество id пользователей, сейчас онлайн (лента: точки на аватарках).
 * cb(Set<string>) вызывается сразу и на каждом тике/синке. → unsubscribe.
 */
export function subscribeOnlineSet(cb) {
  return subscribe((st) => cb(new Set((st.users || []).map((u) => u.id))));
}

/** Число живых скоупов (тесты: таймеры не текут после cleanup) */
export function presenceScopeCount() { return scopes.size; }
