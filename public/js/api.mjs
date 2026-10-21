// ============================================================
// api.mjs — ЕДИНАЯ ТОЧКА ДОСТУПА К ДАННЫМ (Фаза C, заход 48).
//
// Тот же набор экспортов и те же сигнатуры, что supabase.mjs — модули
// приложения меняют только имя импорта (принцип №1 спеки
// PLAN_BACKEND_REWRITE.md). Режимы:
//
//  • CONFIG.USE_LOCAL_BACKEND && CONFIG.API_URL («LOCAL») — свой backend
//    (backend/: Express + PostgreSQL + Socket.IO): обычный fetch к
//    <API_URL>/api/... с JWT из localStorage (access 12h + refresh 30d,
//    тихий ротационный refresh на 401 — один полёт на все параллельные
//    запросы). Realtime (уведомления/ЛС/typing/presence) — Socket.IO.
//  • иначе — ДЕМО: вызовы делегируются в supabase.mjs БЕЗ изменений
//    (страховочный пояс перезахода; на этой ветке живут все тесты фронта).
//
// Формы ответов приводятся к формам прежних боевых веток supabase.mjs
// (author вместо profile-джойна, Set для голосов, bool для toggle-действий),
// поэтому UI-модули не меняются вовсе.
// ============================================================

import { CONFIG } from './config.mjs';
import { getState } from './store.mjs';
// Чистые модули (без обратных зависимостей): нормализация контактов и
// способов приёма — как в supabase.mjs, формы ответов должны совпадать.
import { normalizeContacts } from './contacts.mjs';
import { normalizeDonateMethods } from './donate.mjs';
// Демо-слой целиком (сиды, персистентность, миграции, процедурное аудио).
// В LOCAL-режиме его функции-«демо-*» сами гасятся (IS_DEMO=false) —
// импорт безопасен и даёт мгновенный откат флагом в config.mjs.
import * as demo from './supabase.mjs';

/** Работаем ли против своего backend (а не демо-слоя) */
export function isLocalBackend() {
  return !!(CONFIG.USE_LOCAL_BACKEND && CONFIG.API_URL);
}
const local = isLocalBackend;
const apiBase = () => String(CONFIG.API_URL || '').replace(/\/+$/, '');

/** Демо-режим (для UI-веток isDemo() в auth/achievements и т.д.) */
export function isDemo() {
  return !local();
}

// ============================================================
// JWT-сессия: токены в localStorage + ротационный refresh на 401
// ============================================================
const TOKENS_KEY = 'samplehelp_api_tokens';

function ls() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function readTokens() {
  const s = ls();
  if (!s) return null;
  try { return JSON.parse(s.getItem(TOKENS_KEY) || 'null'); } catch { return null; }
}

function saveTokensRaw(tk) {
  const s = ls();
  if (!s) return;
  if (tk) s.setItem(TOKENS_KEY, JSON.stringify(tk));
  else s.removeItem(TOKENS_KEY);
}

/** Смена токенов → переподключение сокета (handshake несёт свежий access) */
function setTokens(tk) {
  saveTokensRaw(tk);
  reconnectSocket();
}

/** Декодировать payload JWT (без проверки подписи — только display-поля) */
function jwtPayload(token) {
  try {
    const b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { return null; }
}

let refreshing = null;
async function doRefresh() {
  const tk = readTokens();
  if (!tk?.refresh) return false;
  let res;
  try {
    res = await fetch(`${apiBase()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh: tk.refresh }),
    });
  } catch {
    // Сетевой отказ (сервер лежит/недоступен): пару НЕ сжигаем — она ещё валидна,
    // следующая попытка после подъёма сервера пройдём нормально
    return false;
  }
  if (!res.ok) {
    saveTokensRaw(null); // сервер ответил: сессия окончательно истекла
    return false;
  }
  try {
    const data = await res.json();
    if (!data?.access) throw new Error('refresh: нет access');
    saveTokensRaw({ access: data.access, refresh: data.refresh });
    return true;
  } catch {
    saveTokensRaw(null);
    return false;
  }
}
/** Single-flight: параллельные 401 ждут ОДИН refresh-запрос */
function refreshTokens() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; reconnectSocket(); });
  return refreshing;
}

/**
 * fetch к /api с авто-refresh на 401 (план Фазы C: «при 401 один раз тихо
 * обновляем»). Ошибки — в контракте supabase-js: Error с .code и .message
 * (фронтовые проверки e.code === 'duplicate' и т.п. работают без правок).
 */
async function apiFetch(path, { method = 'GET', body, auth = true, formData = null } = {}) {
  const url = `${apiBase()}/api${path}`;
  const call = (token) => fetch(url, {
    method,
    headers: {
      ...(formData ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let res;
  try {
    res = await call(auth ? (readTokens()?.access || null) : null);
  } catch (netErr) {
    // Сетевой отказ (сервер мёртв/недоступен, CORS, DNS): браузерное
    // «Failed to fetch» ни о чём не говорит — объясняем сами (заход 50+)
    const e = new Error(
      `Backend недоступен по адресу ${apiBase()} (${netErr.message || 'сетевая ошибка'}). ` +
      'Проверьте, что сервер запущен (node src/app.js), а API_URL в public/js/config.mjs верный.',
    );
    e.code = 'network';
    throw e;
  }
  if (res.status === 401 && auth && readTokens()?.refresh) {
    const okRefresh = await refreshTokens();
    if (okRefresh) res = await call(readTokens()?.access || null);
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* не-JSON ответ */ }
    const e = new Error(data?.message || `Ошибка сервера (${res.status})`);
    e.code = data?.code || `http_${res.status}`;
    e.status = res.status;
    throw e;
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

/** Относительный /files/... → абсолютный (фронт может жить на другом порту) */
function absoluteUrl(u) {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return u.startsWith('/') ? `${apiBase()}${u}` : `${apiBase()}/${u}`;
}

// ============================================================
// Socket.IO (Фаза B backend): уведомления, ЛС, typing, presence.
// Приоритет загрузки: локальный vendor-бандл (public/vendor/, как прежний
// supabase.js) → CDN esm.sh → CDN jsdelivr. Вне LOCAL — никогда не грузится.
// ============================================================
let socketPromise = null;
let socketInstance = null;

async function loadSocketIoLib() {
  if (typeof window !== 'undefined' && window.io?.connect) return window.io;
  try {
    const m = await import(/* @vite-ignore */ 'https://esm.sh/socket.io-client@4');
    if (m?.io) return m.io;
  } catch { /* пробуем следующий источник */ }
  try {
    const m = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/socket.io-client@4/+esm');
    if (m?.io) return m.io;
  } catch { /* все источники недоступны */ }
  return null;
}

/** Ленивый синглтон сокета; handshake несёт текущий access-токен (анонимы — гости) */
export function getSocket() {
  if (!local()) return Promise.resolve(null);
  if (!socketPromise) {
    socketPromise = loadSocketIoLib()
      .then((io) => {
        if (!io) throw new Error('socket.io-client недоступен (vendor/CDN)');
        socketInstance = io(apiBase(), {
          path: '/socket.io',
          // Функциональная форма: перечитывает токен при КАЖДОМ (ре)коннекте
          auth: (cb) => cb({ token: readTokens()?.access || '' }),
          transports: ['websocket', 'polling'],
        });
        return socketInstance;
      })
      .catch((e) => { socketPromise = null; throw e; });
  }
  return socketPromise;
}

/** Переподключить сокет со свежим токеном (вход/выход/refresh) */
export function reconnectSocket() {
  if (!socketInstance) return;
  try { socketInstance.disconnect(); socketInstance.connect(); } catch { /* ignore */ }
}

/**
 * Presence-комната (presence.mjs): track мета-данных + подписка на состояние.
 * Payload сервера один в один с прежним Supabase presence:
 * { room, users: [{uid, username, avatar_url}], guests, total }.
 * @returns {Promise<() => void>} отписка (untrack + снять слушатели)
 */
export async function subscribePresenceRoom(room, meta, onState) {
  const socket = await getSocket().catch(() => null);
  if (!socket) return () => {};
  const handler = (st) => { if (st && st.room === room) onState(st); };
  const track = () => { try { socket.emit('presence:track', { room, meta }); } catch { /* ignore */ } };
  socket.on('presence', handler);
  socket.on('connect', track); // (ре)коннект — повторно заявляем себя
  if (socket.connected) track();
  return () => {
    try {
      socket.off('presence', handler);
      socket.off('connect', track);
      socket.emit('presence:untrack', { room });
    } catch { /* ignore */ }
  };
}

// ============================================================
// ДЕМО-ЭКСПОРТЫ (переносятся как есть — страховочный пояс)
// ============================================================
export const DEMO_DB_VERSION = demo.DEMO_DB_VERSION;
export const persistDemo = demo.persistDemo;
export const takeDemoReseedNotice = demo.takeDemoReseedNotice;
export const setDemoRole = demo.setDemoRole;
export const syncDemoProfileFromSession = demo.syncDemoProfileFromSession;
export const demoLifecycleSweep = demo.demoLifecycleSweep;
export const getDemoPresencePool = demo.getDemoPresencePool;
export const getDemoAudio = demo.getDemoAudio;
export const invalidateProfileCache = demo.invalidateProfileCache;
export const getClientOrNull = demo.getClientOrNull;

/**
 * Диагностика подключения (main.mjs: индикатор в подвале).
 * LOCAL: пинг /api/health; демо: null (как раньше).
 */
export async function ensureClient() {
  if (!local()) return demo.ensureClient();
  const h = await apiFetch('/health', { auth: false });
  if (!h?.ok) throw new Error('backend ответил некорректно на /api/health');
  return h;
}

// ============================================================
// АУТЕНТИФИКАЦИЯ (JWT; OAuth удалён решением заказчика 2026-10-14)
// ============================================================

export async function getSessionUser() {
  if (!local()) return demo.getSessionUser();
  const tk = readTokens();
  if (!tk?.access && !tk?.refresh) return null;
  try {
    const me = await apiFetch('/profiles/me'); // 401 → тихий refresh внутри
    if (!me) return null;
    const email = me.email || jwtPayload(readTokens()?.access)?.email || '';
    return { ...me, email };
  } catch (e) {
    if (e.status !== 401) console.error('[api] getSessionUser:', e);
    return null; // сессия истекла/сервер недоступен — стартуем гостем
  }
}

/**
 * Профиль создаётся сервером при регистрации — «самопочинка» сведена
 * к честной проверке (контракт 'existing'/false сохранён для auth.mjs).
 */
export async function ensureProfileRow(authUser, usernameHint = '') {
  if (!local()) return demo.ensureProfileRow(authUser, usernameHint);
  try {
    const me = await apiFetch('/profiles/me');
    return me ? 'existing' : false;
  } catch { return false; }
}

export async function signUp({ email, password, username }) {
  if (!local()) return demo.signUp({ email, password, username });
  const res = await apiFetch('/auth/register', { method: 'POST', auth: false, body: { email, password, username } });
  setTokens({ access: res.access, refresh: res.refresh });
  return { user: res.user, needsOnboarding: !!res.needsOnboarding };
}

export async function signIn({ email, password }) {
  if (!local()) return demo.signIn({ email, password });
  const res = await apiFetch('/auth/login', { method: 'POST', auth: false, body: { email, password } });
  setTokens({ access: res.access, refresh: res.refresh });
  return { user: res.user };
}

/** OAuth на своём backend НЕТ (решение опроса): ряд кнопок не рендерится (fetchEnabledProviders → []) */
export async function signInWithOAuth(provider) {
  if (!local()) return demo.signInWithOAuth(provider);
  throw new Error('Вход через соцсети отключён — используйте e-mail и пароль');
}

export async function resetPassword(email) {
  if (!local()) return demo.resetPassword(email);
  // Сервер не раскрывает существование почты; без SMTP ссылка приходит в лог backend
  await apiFetch('/auth/reset-request', { method: 'POST', auth: false, body: { email } });
}

export async function signOut() {
  if (!local()) return demo.signOut();
  const tk = readTokens();
  try {
    if (tk?.refresh) await apiFetch('/auth/logout', { method: 'POST', auth: false, body: { refresh: tk.refresh } });
  } catch { /* выход локальный важнее серверного */ }
  setTokens(null);
}

// ============================================================
// СПРАВОЧНИКИ (синтезаторы / DAW)
// ============================================================

export async function fetchSynthCatalog() {
  if (!local()) return demo.fetchSynthCatalog();
  try {
    const rows = await apiFetch('/catalog/synths', { auth: false });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error('[api] synths:', e);
    return ['Serum', 'Phase Plant', 'Vital', 'Massive X', 'Diva'];
  }
}

export async function addSynthToCatalog(name) {
  const clean = String(name || '').trim();
  if (!clean) return false;
  if (!local()) return demo.addSynthToCatalog(clean);
  try {
    await apiFetch('/catalog/synths', { method: 'POST', body: { name: clean } });
    return true;
  } catch (e) { console.error('[api] addSynth:', e); return false; }
}

export async function fetchDawCatalog() {
  if (!local()) return demo.fetchDawCatalog();
  try {
    const rows = await apiFetch('/catalog/daws', { auth: false });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error('[api] daws:', e);
    return ['FL Studio', 'Ableton Live', 'Logic Pro', 'Reaper'];
  }
}

export async function addDawToCatalog(name) {
  const clean = String(name || '').trim();
  if (!clean) return false;
  if (!local()) return demo.addDawToCatalog(clean);
  try {
    await apiFetch('/catalog/daws', { method: 'POST', body: { name: clean } });
    return true;
  } catch (e) { console.error('[api] addDaw:', e); return false; }
}

// ============================================================
// ЖИЗНЕННЫЙ ЦИКЛ (серверный cron в backend — клиент больше не гоняет sweep)
// ============================================================

export async function runLifecycleSweep() {
  if (!local()) return demo.runLifecycleSweep();
  // Lifecycle (purge/напоминания) крутится на сервере (lifecycle.js, 10 мин) —
  // клиентский вызов сохранён только для совместимости сигнатуры.
}

// ============================================================
// ВОПРОСЫ / ЛЕНТА
// ============================================================

/** Строка вопроса/ответа backend → форма прежней боевой ветки (author) */
function withAuthor(r) {
  if (!r) return r;
  return {
    ...r,
    author: r.author || (r.username === undefined && r.avatar_url === undefined
      ? null
      : { id: r.user_id, username: r.username ?? null, avatar_url: r.avatar_url ?? null, donate_methods: r.donate_methods ?? [] }),
  };
}

export async function fetchFeed(sort = 'new') {
  if (!local()) return demo.fetchFeed(sort);
  try {
    const s = sort === 'popular' ? 'top' : (sort === 'unanswered' ? 'unanswered' : 'new');
    const rows = await apiFetch(`/questions?sort=${s}&limit=50`, { auth: false });
    return (rows || []).map(withAuthor);
  } catch (e) { console.error('[api] fetchFeed:', e); return []; }
}

export async function fetchQuestion(id) {
  if (!local()) return demo.fetchQuestion(id);
  try {
    const row = await apiFetch(`/questions/${encodeURIComponent(id)}`, { auth: false });
    return row ? withAuthor(row) : null;
  } catch (e) {
    if (e.code !== 'not_found') console.error('[api] fetchQuestion:', e);
    return null;
  }
}

export async function createQuestion(payload) {
  if (!local()) return demo.createQuestion(payload);
  // Уведомления подписчикам тега шлёт сервер (notifyTagSubscribers) — клиент не дублирует
  const row = await apiFetch('/questions', { method: 'POST', body: payload });
  const { user } = getState();
  return withAuthor({ ...row, username: user?.username, avatar_url: user?.avatar_url, donate_methods: user?.donate_methods });
}

/** Пакетная загрузка ответов для ленты → Map<questionId, answers[]> */
export async function fetchAnswersForQuestions(questionIds) {
  const map = new Map((questionIds || []).map((id) => [id, []]));
  if (!questionIds?.length) return map;
  if (!local()) return demo.fetchAnswersForQuestions(questionIds);
  try {
    const rows = await apiFetch(`/answers?question_ids=${questionIds.map(encodeURIComponent).join(',')}`, { auth: false });
    for (const a of rows || []) {
      map.get(a.question_id)?.push(mapAnswer(a));
    }
    return map;
  } catch (e) { console.error('[api] fetchAnswersForQuestions:', e); return map; }
}

/** Строка ответа backend → форма боевой ветки (author + comments[].author) */
function mapAnswer(a) {
  return {
    ...withAuthor(a),
    comments: (a.comments || []).map((c) => ({
      ...c,
      author: c.author || { id: c.user_id, username: c.profile?.username ?? c.username ?? null, avatar_url: c.profile?.avatar_url ?? c.avatar_url ?? null },
    })),
  };
}

export async function fetchAnswers(questionId) {
  if (!local()) return demo.fetchAnswers(questionId);
  try {
    const rows = await apiFetch(`/questions/${encodeURIComponent(questionId)}/answers`, { auth: false });
    return (rows || []).map(mapAnswer);
  } catch (e) { console.error('[api] fetchAnswers:', e); return []; }
}

export async function createAnswer(payload) {
  if (!local()) return demo.createAnswer(payload);
  const { user } = getState();
  if (!user) throw new Error('Требуется вход');
  const { question_id: qid, ...rest } = payload;
  // Уведомление автору вопроса + счётчик ответов — на сервере (триггер/notify)
  return apiFetch(`/questions/${encodeURIComponent(qid)}/answers`, { method: 'POST', body: rest });
}

export async function markSolution(answerId, questionId) {
  if (!local()) return demo.markSolution(answerId, questionId);
  // +25 rep, таймер purge, уведомление автору ответа — транзакция сервера
  await apiFetch(`/questions/${encodeURIComponent(questionId)}/solution`, {
    method: 'POST',
    body: { answerId: answerId || null },
  });
}

export async function createComment(payload) {
  if (!local()) return demo.createComment(payload);
  const { user } = getState();
  if (!user) throw new Error('Требуется вход');
  const row = await apiFetch(`/answers/${encodeURIComponent(payload.answer_id)}/comments`, {
    method: 'POST',
    body: { content: payload.content },
  });
  // Автор прикладывается сразу — карточка комментария строится до перечитывания списка
  return { ...row, author: { id: user.id, username: user.username || '', avatar_url: user.avatar_url || null } };
}

export async function updateQuestion(id, patch) {
  if (!local()) return demo.updateQuestion(id, patch);
  return apiFetch(`/questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export async function deleteQuestion(id) {
  if (!local()) return demo.deleteQuestion(id);
  await apiFetch(`/questions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

export async function updateAnswer(id, patch) {
  if (!local()) return demo.updateAnswer(id, patch);
  return apiFetch(`/answers/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export async function deleteAnswer(id) {
  if (!local()) return demo.deleteAnswer(id);
  await apiFetch(`/answers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

export async function updateComment(id, content) {
  if (!local()) return demo.updateComment(id, content);
  return apiFetch(`/answers/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: { content } });
}

export async function deleteComment(id) {
  if (!local()) return demo.deleteComment(id);
  await apiFetch(`/answers/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

// ---------- Лайки ----------
export async function toggleLike(targetType, targetId) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.toggleLike(targetType, targetId);
  try {
    // Уведомление автору контента (заход 47) — на сервере
    return await apiFetch('/likes/toggle', { method: 'POST', body: { target_type: targetType, target_id: targetId } });
  } catch (e) { console.error('[api] toggleLike:', e); return null; }
}

export async function isLiked(targetType, targetId) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.isLiked(targetType, targetId);
  try {
    const r = await apiFetch(`/likes/status?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(targetId)}`);
    return !!r?.liked;
  } catch { return false; }
}

// ---------- Избранное ----------
export async function fetchFavorites() {
  const { user } = getState();
  if (!user) return [];
  if (!local()) return demo.fetchFavorites();
  try {
    // Сервер отдаёт готовые строки { question_id, status, created_at, question{…author} }
    return await apiFetch('/favorites') || [];
  } catch (e) { console.error('[api] fetchFavorites:', e); return []; }
}

export async function setFavorite(questionId, on) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.setFavorite(questionId, on);
  try {
    await apiFetch('/favorites/toggle', { method: 'POST', body: { question_id: questionId, on: !!on } });
    return on;
  } catch (e) { console.error('[api] setFavorite:', e); return !on; }
}

export async function setFavoriteStatus(questionId, status) {
  const { user } = getState();
  if (!user) return;
  if (!local()) return demo.setFavoriteStatus(questionId, status);
  try {
    await apiFetch('/favorites/status', { method: 'POST', body: { question_id: questionId, status } });
  } catch (e) { console.error('[api] setFavoriteStatus:', e); }
}

export async function isInFavorites(questionId) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.isInFavorites(questionId);
  try {
    const rows = await apiFetch('/favorites');
    return (rows || []).some((f) => f.question_id === questionId);
  } catch { return false; }
}

// ---------- Хранилище файлов (SSD backend, отдача /files/<bucket>/…) ----------

/** Расширение по MIME (как в боевой ветке uploadAudio) + фолбэк по подтипу */
const AUDIO_EXT_BY_MIME = {
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/flac': 'flac',
};
function extFromMime(mime) {
  const m = String(mime || '').split(';')[0].toLowerCase();
  if (AUDIO_EXT_BY_MIME[m]) return AUDIO_EXT_BY_MIME[m];
  return (m.split('/')[1] || '').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
}
/** Безопасное ASCII-имя (порт safeFileName из supabase.mjs) */
function safeFileName(name) {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || '';
}
function uploadFileName(file, base) {
  let name = file?.name ? safeFileName(file.name) : '';
  const ext = extFromMime(file?.type);
  if (!name) name = `${base}.${ext}`;
  else if (!/\.[a-z0-9]{2,5}$/i.test(name)) name = `${name}.${ext}`;
  return name;
}

async function uploadToBucket(file, bucket, base) {
  const fd = new FormData();
  fd.append('file', file, uploadFileName(file, base));
  const res = await apiFetch(`/upload/${bucket}`, { method: 'POST', formData: fd });
  return absoluteUrl(res?.url);
}

export async function uploadAudio(file, folder = 'question-audio') {
  if (!local()) return demo.uploadAudio(file, folder);
  return uploadToBucket(file, folder, 'sample');
}

export async function uploadPreset(file) {
  return uploadAudio(file, 'presets');
}

export async function uploadAvatar(file) {
  if (!local()) return demo.uploadAvatar(file);
  return uploadToBucket(file, 'avatars', 'avatar');
}

// ============================================================
// СООБЩЕНИЯ (+ Socket.IO: пуши, typing)
// ============================================================

export async function fetchConversations() {
  const { user } = getState();
  if (!user) return [];
  if (!local()) return demo.fetchConversations();
  try {
    return await apiFetch('/messages/conversations') || [];
  } catch (e) { console.error('[api] fetchConversations:', e); return []; }
}

export async function fetchThread(otherUserId) {
  const { user } = getState();
  if (!user) return [];
  if (!local()) return demo.fetchThread(otherUserId);
  try {
    return await apiFetch(`/messages/thread/${encodeURIComponent(otherUserId)}`) || [];
  } catch (e) { console.error('[api] fetchThread:', e); return []; }
}

export async function fetchRefCandidates() {
  const { user } = getState();
  if (!user) return { answers: [], questions: [] };
  if (!local()) return demo.fetchRefCandidates();
  try {
    const r = await apiFetch('/messages/ref-candidates');
    return { answers: r?.answers || [], questions: r?.questions || [] };
  } catch (e) { console.error('[api] fetchRefCandidates:', e); return { answers: [], questions: [] }; }
}

export async function fetchRefCard(ref) {
  if (!ref || typeof ref !== 'object' || !ref.type || !ref.id) return null;
  if (!local()) return demo.fetchRefCard(ref);
  try {
    return await apiFetch(`/messages/ref-card?type=${encodeURIComponent(ref.type)}&id=${encodeURIComponent(ref.id)}`, { auth: false });
  } catch (e) { console.error('[api] fetchRefCard:', e); return null; }
}

export async function sendMessage(recipientId, content, extra = {}) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.sendMessage(recipientId, content, extra);
  // Живой пуш обеим сторонам — pushMessage на сервере
  return apiFetch('/messages', { method: 'POST', body: { recipient_id: recipientId, content, ...extra } });
}

export async function updateMessage(messageId, content) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.updateMessage(messageId, content);
  try {
    return await apiFetch(`/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: { content } });
  } catch (e) { console.error('[api] updateMessage:', e); return null; }
}

export async function deleteMessage(messageId) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.deleteMessage(messageId);
  try {
    await apiFetch(`/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
    return true;
  } catch (e) { console.error('[api] deleteMessage:', e); return false; }
}

export async function toggleMessageReaction(messageId, emoji) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.toggleMessageReaction(messageId, emoji);
  try {
    const r = await apiFetch(`/messages/${encodeURIComponent(messageId)}/reactions`, { method: 'POST', body: { emoji } });
    return r?.message?.reactions ?? null;
  } catch (e) { console.error('[api] toggleReaction:', e); return null; }
}

/** Индикатор «печатает…»: событие typing через user-комнаты Socket.IO */
export async function openTypingChannel(otherUserId, { onTyping }) {
  if (!local()) return demo.openTypingChannel(otherUserId, { onTyping });
  const noop = { send: () => {}, close: () => {} };
  try {
    const { user } = getState();
    if (!user) return noop;
    const socket = await getSocket();
    if (!socket) return noop;
    const conv = [user.id, otherUserId].sort().join('__');
    const handler = (p) => {
      if (p?.from && p.from === otherUserId) onTyping({ id: p.from, username: p.username || '' });
    };
    socket.on('typing', handler);
    let lastSent = 0;
    return {
      // Не спамим: не чаще раза в 2 секунды (как прежняя боевая ветка)
      send: () => {
        const now = Date.now();
        if (now - lastSent < 2000) return;
        lastSent = now;
        try { socket.emit('typing', { to: otherUserId, conv }); } catch { /* ignore */ }
      },
      close: () => { try { socket.off('typing', handler); } catch { /* ignore */ } },
    };
  } catch (e) { console.error('[api] typing channel:', e); return noop; }
}

export async function markThreadRead(otherUserId) {
  const { user } = getState();
  if (!user) return;
  if (!local()) return demo.markThreadRead(otherUserId);
  try {
    await apiFetch(`/messages/read/${encodeURIComponent(otherUserId)}`, { method: 'POST' });
  } catch (e) { console.error('[api] markThreadRead:', e); }
}

/** Пуш новых ЛС (recipient-фильтр на клиенте: сервер шлёт обеим сторонам) */
export async function subscribeMessages(onMessage, onTyping = null) {
  if (!local()) return demo.subscribeMessages(onMessage, onTyping);
  try {
    const socket = await getSocket();
    if (!socket) return () => {};
    const handler = (m) => {
      const me = getState().user;
      if (m && me && m.recipient_id === me.id) onMessage(m);
    };
    socket.on('message', handler);
    return () => { try { socket.off('message', handler); } catch { /* ignore */ } };
  } catch (e) { console.error('[api] subscribeMessages:', e); return () => {}; }
}

// ============================================================
// ПРОФИЛИ
// ============================================================

export async function fetchProfile(userId) {
  if (!local()) return demo.fetchProfile(userId);
  try {
    const p = await apiFetch(`/profiles/${encodeURIComponent(userId)}`);
    if (!p) return null;
    // Контакты: решение о видимости и маскировку принимает СЕРВЕР (rules.js,
    // 152-ФЗ) — пустой список = не положено; непустой для чужого = уже
    // маскированные значения. contact_consent сервер для чужих удаляет,
    // поэтому восстанавливаем его из факта «контакты выданы» — клиентская
    // механика chips (canSeeContact) тогда показывает то, что разрешил сервер.
    const contact = normalizeContacts(p.contact);
    const isSelf = getState().user?.id === userId;
    return {
      ...p,
      links: p.links || [],
      software: p.software || [],
      arsenal: p.arsenal || [],
      contact,
      contact_consent: p.contact_consent !== undefined ? !!p.contact_consent : (!isSelf && contact.length > 0),
      open_to_collab: !!p.open_to_collab,
      donate_methods: normalizeDonateMethods(p.donate_methods),
      stats: p.stats || { questions: 0, answers: 0, likes: 0, rating: p.rating || 0, solutions: 0 },
      questions: p.questions || [],
      answers: (p.answers || []).map((a) => ({ ...a, question: a.question || null })),
    };
  } catch (e) { console.error('[api] fetchProfile:', e); return null; }
}

export async function updateProfile(patch) {
  const { user } = getState();
  if (!user) return;
  if (!local()) return demo.updateProfile(patch);
  // Белый список колонок + подтаблицы software/arsenal — на сервере
  await apiFetch('/profiles/me', { method: 'PATCH', body: patch });
  invalidateProfileCache(user.id);
}

export async function fetchQuestionsByUser(userId) {
  if (!local()) return demo.fetchQuestionsByUser(userId);
  try {
    const rows = await apiFetch(`/questions?user_id=${encodeURIComponent(userId)}&limit=200`, { auth: false });
    return (rows || []).map(withAuthor);
  } catch { return []; }
}

export async function fetchAnswersByUser(userId) {
  if (!local()) return demo.fetchAnswersByUser(userId);
  try {
    const rows = await apiFetch(`/answers?user_id=${encodeURIComponent(userId)}`, { auth: false });
    return rows || [];
  } catch { return []; }
}

/** Топ-ответы со звуком (авто-витрина профиля) */
export async function fetchBestAnswers(userId, limit = 3) {
  if (!local()) return demo.fetchBestAnswers(userId, limit);
  try {
    const rows = await apiFetch(`/answers?best=1&user_id=${encodeURIComponent(userId)}&limit=${limit}`, { auth: false });
    return (rows || []).map((a) => ({ ...a, question: a.question || null }));
  } catch (e) { console.error('[api] best-answers:', e); return []; }
}

// ============================================================
// ЖАЛОБЫ И МОДЕРАЦИЯ
// ============================================================

export async function submitReport({ target_type, target_id, reason, note = '' }) {
  const { user } = getState();
  if (!user) throw new Error('Требуется вход');
  if (!local()) return demo.submitReport({ target_type, target_id, reason, note });
  // Дубликат → 409 {code:'duplicate'} (контракт сохранён: moderation.mjs
  // проверяет e.code), сервер возвращает готовую строку жалобы.
  return apiFetch('/reports', { method: 'POST', body: { target_type, target_id, reason, note } });
}

export async function fetchReports(status = 'new') {
  const { user } = getState();
  if (!user?.is_admin) return [];
  if (!local()) return demo.fetchReports(status);
  try {
    // reporter + target (содержимое цели) компонует сервер — форма строк
    // совпадает с демо/боевой веткой
    return await apiFetch(`/reports?status=${encodeURIComponent(status)}`) || [];
  } catch (e) { console.error('[api] fetchReports:', e); return []; }
}

export async function setReportStatus(id, status, moderator_note = '') {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  if (!local()) return demo.setReportStatus(id, status, moderator_note);
  // Уведомление жалобщику (петля захода 36) — на сервере
  await apiFetch(`/reports/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: { status, moderator_note },
  });
  return true;
}

/** Админ: удалить контент по жалобе и закрыть её как 'actioned' (один запрос) */
export async function removeReportedContent(report) {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  if (!local()) return demo.removeReportedContent(report);
  await apiFetch(`/reports/${encodeURIComponent(report.id)}/remove`, { method: 'POST' });
}

// ============================================================
// ИДЕИ ПРОДУКТА (заход 38)
// ============================================================

export async function fetchIdeas(sort = 'top') {
  if (!local()) return demo.fetchIdeas(sort);
  try {
    const rows = await apiFetch(`/ideas?sort=${encodeURIComponent(sort)}`, { auth: false });
    return (rows || []).map((r) => ({
      ...r,
      author: r.author || { id: r.author_id, username: r.profile?.username ?? r.username ?? null, avatar_url: r.profile?.avatar_url ?? r.avatar_url ?? null },
      votes: r.votes ?? 0,
    }));
  } catch (e) { console.error('[api] fetchIdeas:', e); return []; }
}

export async function fetchIdeaVotesMine() {
  const { user } = getState();
  if (!user) return new Set();
  if (!local()) return demo.fetchIdeaVotesMine();
  try {
    const rows = await apiFetch('/ideas/votes-mine');
    return new Set(rows || []);
  } catch (e) { console.error('[api] idea votes:', e); return new Set(); }
}

export async function createIdea({ title, body }) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.createIdea({ title, body });
  try {
    const row = await apiFetch('/ideas', { method: 'POST', body: { title, body } });
    return { ...row, author: { id: user.id, username: user.username || '', avatar_url: user.avatar_url || null }, votes: row?.votes ?? 0 };
  } catch (e) { console.error('[api] createIdea:', e); return null; }
}

export async function toggleIdeaVote(ideaId) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.toggleIdeaVote(ideaId);
  try {
    const r = await apiFetch(`/ideas/${encodeURIComponent(ideaId)}/vote`, { method: 'POST' });
    return r?.votes ?? 0;
  } catch (e) { console.error('[api] idea vote:', e); return null; }
}

export async function setIdeaStatus(id, status) {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  if (!local()) return demo.setIdeaStatus(id, status);
  await apiFetch(`/ideas/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } });
  return true;
}

export async function setIdeaReply(id, text) {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  if (!local()) return demo.setIdeaReply(id, text);
  await apiFetch(`/ideas/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { text: String(text || '') } });
  return true;
}

export async function deleteIdea(id) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.deleteIdea(id);
  await apiFetch(`/ideas/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

/** Контакт разработчика (кнопка «Написать разработчику» в /ideas) */
export async function fetchDevContact() {
  if (!local()) return demo.fetchDevContact();
  try {
    return await apiFetch('/profiles/dev-contact', { auth: false });
  } catch (e) { console.error('[api] dev contact:', e); return null; }
}

// ============================================================
// ДОНАТЫ / ПОДДЕРЖКА (модель A: деньги мимо платформы)
// ============================================================

export async function markDonationTransfer({ recipientUserId, amount, message = '' }) {
  const { user } = getState();
  if (!user || !recipientUserId || recipientUserId === user.id) return null;
  if (!local()) return demo.markDonationTransfer({ recipientUserId, amount, message });
  try {
    // Уведомление автору (type 'support', payload c donationId) — на сервере
    return await apiFetch('/donations/mark', { method: 'POST', body: { recipientUserId, amount, message } });
  } catch (e) { console.error('[api] markDonationTransfer:', e); return null; }
}

export async function confirmDonation(donationId) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.confirmDonation(donationId);
  try {
    // Сервер: статус 'done' + confirmed в исходном уведомлении + благодарность донору
    await apiFetch(`/donations/${encodeURIComponent(donationId)}/confirm`, { method: 'POST' });
    return true;
  } catch (e) { console.error('[api] confirmDonation:', e); return false; }
}

/** Отметки о переводах — видны только автору (серверный /for-me) */
export async function fetchDonationsFor(userId) {
  if (!userId) return [];
  if (!local()) return demo.fetchDonationsFor(userId);
  const me = getState().user;
  if (!me || me.id !== userId) return []; // чужие отметки не отдаёт ни сервер, ни UI
  try {
    return await apiFetch('/donations/for-me') || [];
  } catch (e) { console.error('[api] fetchDonationsFor:', e); return []; }
}

export async function fetchSupportCount(recipientUserId) {
  if (!local()) return demo.fetchSupportCount(recipientUserId);
  try {
    const key = recipientUserId === null || recipientUserId === undefined ? 'project' : encodeURIComponent(recipientUserId);
    const r = await apiFetch(`/donations/count?recipient_user_id=${key}`, { auth: false });
    return r?.count ?? 0;
  } catch { return 0; }
}

export async function recordDonation({ recipient_user_id = null, amount = 0, currency = 'RUB', message = '', kind = 'paid' }) {
  const { user } = getState();
  if (!user) return null;
  if (!local()) return demo.recordDonation({ recipient_user_id, amount, currency, message, kind });
  void currency; // backend хранит RUB (модель A: валюта одна)
  try {
    if (kind === 'thanks') {
      return await apiFetch('/donations/thanks', { method: 'POST', body: { recipient_user_id, message } });
    }
    return await apiFetch('/donations/mark', { method: 'POST', body: { recipientUserId: recipient_user_id, amount, message } });
  } catch (e) { console.error('[api] recordDonation:', e); return null; }
}

// ============================================================
// УВЕДОМЛЕНИЯ (+ Socket.IO-пуш)
// ============================================================

export async function fetchNotifications() {
  const { user } = getState();
  if (!user) return [];
  if (!local()) return demo.fetchNotifications();
  try {
    const rows = await apiFetch('/notifications') || [];
    // 'message'-уведомления не показываются (ЛС живут в разделе «Сообщения»)
    return rows.filter((n) => n.type !== 'message');
  } catch (e) { console.error('[api] fetchNotifications:', e); return []; }
}

export async function markNotificationRead(id) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.markNotificationRead(id);
  try {
    await apiFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
    return true;
  } catch (e) { console.error('[api] notif read:', e); return false; }
}

export async function markAllNotificationsRead() {
  const { user } = getState();
  if (!user) return;
  if (!local()) return demo.markAllNotificationsRead();
  try {
    await apiFetch('/notifications/read-all', { method: 'POST' });
  } catch (e) { console.error('[api] markAllRead:', e); }
}

export async function subscribeNotifications(onNotification) {
  if (!local()) return demo.subscribeNotifications(onNotification);
  try {
    const socket = await getSocket();
    if (!socket) return () => {};
    // Сервер пушит строку уведомления только в комнату её владельца
    socket.on('notification', onNotification);
    return () => { try { socket.off('notification', onNotification); } catch { /* ignore */ } };
  } catch (e) { console.error('[api] subscribeNotifications:', e); return () => {}; }
}

// ============================================================
// ПОДПИСКИ (авторы / теги)
// ============================================================

export async function fetchSubscriptions() {
  const { user } = getState();
  if (!user) return [];
  if (!local()) return demo.fetchSubscriptions();
  try {
    return await apiFetch('/subscriptions') || [];
  } catch (e) { console.error('[api] subscriptions:', e); return []; }
}

export async function toggleSubscription(targetType, targetId) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.toggleSubscription(targetType, targetId);
  try {
    const r = await apiFetch('/subscriptions/toggle', { method: 'POST', body: { target_type: targetType, target_id: targetId } });
    return !!r?.subscribed;
  } catch (e) { console.error('[api] toggleSubscription:', e); return false; }
}

// ============================================================
// ДОСТИЖЕНИЯ
// ============================================================

export async function fetchAchievements(userId) {
  if (!local()) return demo.fetchAchievements(userId);
  const me = getState().user;
  if (!me) return [];
  if (userId && userId !== me.id) return []; // сервер хранит/отдаёт только свои
  try {
    const rows = await apiFetch('/achievements') || [];
    return rows.map((r) => r.achievement_type);
  } catch (e) { console.error('[api] achievements:', e); return []; }
}

export async function awardAchievement(achievementType) {
  const { user } = getState();
  if (!user) return false;
  if (!local()) return demo.awardAchievement(achievementType);
  try {
    const r = await apiFetch('/achievements', { method: 'POST', body: { achievement_type: achievementType } });
    return !!r?.awarded;
  } catch (e) { console.error('[api] award:', e); return false; }
}

/** Своих комментариев — счётчиком (статистика достижений; новая функция Фазы C) */
export async function fetchMyCommentCount() {
  if (!local()) return 0;
  try {
    const r = await apiFetch('/answers/count-mine');
    return r?.count ?? 0;
  } catch { return 0; }
}

// ============================================================
// АДМИН-ПРОСМОТРЩИК БД (заход 50): экран /admin, строго чтение.
// Секреты (refresh/reset_tokens, users.password_hash) фильтрует СЕРВЕР.
// В демо недоступен: показывать нечего (нет БД) — экран рисует заглушку.
// ============================================================

/** Доступен ли просмотрщик (только при подключённом backend) */
export function isAdminDbAvailable() {
  return local();
}

/** Список таблиц public-схемы (без секретных) + оценка числа строк */
export async function fetchAdminTables() {
  if (!local()) return [];
  return apiFetch('/admin/tables');
}

/** Колонки таблицы (без секретных) + точное число строк */
export async function fetchAdminTableMeta(name) {
  if (!local()) return null;
  return apiFetch(`/admin/tables/${encodeURIComponent(name)}/meta`);
}

/** Страница строк: limit 1..100, offset ≥ 0, order_by — только колонка таблицы */
export async function fetchAdminTableRows(name, { limit = 50, offset = 0, orderBy = '', dir = 'asc' } = {}) {
  if (!local()) return null;
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (orderBy) q.set('order_by', orderBy);
  if (dir) q.set('dir', dir);
  return apiFetch(`/admin/tables/${encodeURIComponent(name)}/rows?${q.toString()}`);
}
