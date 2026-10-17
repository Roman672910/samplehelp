// backend/src/realtime.js — Фаза B (заход 48): Socket.IO вместо Supabase Realtime.
// Комнаты: user:<id> (уведомления, ЛС, typing), presence:* (онлайн/зрители).
// Анонимы допускаются ТОЛЬКО для presence (гостями, без персональных комнат) —
// приватность анонимов как в прежней модели.
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { CONFIG } from './config.js';
import { query } from './db.js';

let io = null;
const presence = new Map(); // room -> Map(socketId -> meta)

export function initRealtime(httpServer) {
  io = new Server(httpServer, { path: '/socket.io', cors: { origin: '*' } });

  io.use((socket, next) => {
    socket.data.user = null;
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const p = jwt.verify(token, CONFIG.JWT_SECRET);
        socket.data.user = { id: p.sub, email: p.email, is_admin: !!p.is_admin };
      } catch { /* аноним: только presence */ }
    }
    next();
  });

  io.on('connection', (socket) => {
    const u = socket.data.user;
    if (u) socket.join(`user:${u.id}`);

    // presence: track/untrack как в Supabase presence (meta: {uid, username, avatar_url, guest})
    socket.on('presence:track', ({ room, meta } = {}) => {
      if (typeof room !== 'string' || !room.startsWith('presence:')) return;
      socket.join(room);
      if (!presence.has(room)) presence.set(room, new Map());
      presence.get(room).set(socket.id, meta && typeof meta === 'object' ? meta : { guest: true });
      emitPresence(room);
    });
    socket.on('presence:untrack', ({ room } = {}) => {
      untrack(socket, room);
      socket.leave(typeof room === 'string' ? room : '');
    });

    // typing: клиент шлёт { to, conv } — сервер добавляет имя и шлёт адресату
    socket.on('typing', async ({ to, conv } = {}) => {
      if (!to) return;
      // Фаза C: имя из профиля (раньше уходил email токена — в ЛС светить его не надо)
      let username = 'гость';
      if (u) {
        try {
          const { rows } = await query('select username from profiles where id = $1', [u.id]);
          username = rows[0]?.username || username;
        } catch { /* best-effort */ }
      }
      io.to(`user:${to}`).emit('typing', { conv: conv || null, from: u?.id || null, username });
    });

    socket.on('disconnect', () => {
      for (const room of [...presence.keys()]) untrack(socket, room);
    });
  });

  function untrack(socket, room) {
    if (typeof room !== 'string') {
      for (const [r, map] of [...presence]) {
        if (map.delete(socket.id)) emitPresence(r);
      }
      return;
    }
    const map = presence.get(room);
    if (map?.delete(socket.id)) emitPresence(room);
  }

  function emitPresence(room) {
    const map = presence.get(room) || new Map();
    const users = [];
    let guests = 0;
    for (const m of map.values()) {
      if (m?.guest) guests++;
      else users.push(m);
    }
    io.to(room).emit('presence', { room, users, guests, total: users.length + guests });
  }
  return io;
}

// ---------- пуши из маршрутов (best-effort: io может быть не поднят) ----------
export function pushNotification(row) {
  if (io && row?.user_id) io.to(`user:${row.user_id}`).emit('notification', row);
}
export function pushMessage(row) {
  if (!io || !row) return;
  io.to(`user:${row.recipient_id}`).to(`user:${row.sender_id}`).emit('message', row);
}
export function pushMessageEvent(event, row) {
  if (!io || !row) return;
  io.to(`user:${row.recipient_id}`).to(`user:${row.sender_id}`).emit(event, row);
}
export function getIo() { return io; }
