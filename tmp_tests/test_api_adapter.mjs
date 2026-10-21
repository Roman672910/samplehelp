// test_api_adapter.mjs — Фаза C (заход 48): адаптер api.mjs.
// Проверяет:
//  0) паритет экспортов api.mjs ⊇ supabase.mjs (план: те же сигнатуры);
//  1) демо-делегирование при USE_LOCAL_BACKEND=false (fetch НЕ дёргается);
//  2) LOCAL-ветку на fetch-mock: токены в localStorage, авто-refresh на 401
//     (single-flight), формы запросов/ответов (author-маппинг, Set голосов,
//     bool-toggle), абсолютные /files URL, контракт ошибок {code};
//  3) Socket.IO-подписки на фейковом сокете (notification/message/typing/
//     presence) + reconnect при смене токенов;
//  4) статику: 14 модулей импортируют api.mjs, vendor заменён, флаг в
//     репозитории выключен (тесты/демо зелёные).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };

// ---------- fetch-mock ----------
const calls = [];
let routes = [];
function mkRes({ status = 200, json = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => { if (json === null) throw new Error('no json'); return json; },
    text: async () => JSON.stringify(json),
  };
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  calls.push({ url: u, method, headers: { ...(opts.headers || {}) }, body: opts.body });
  for (const r of routes) {
    const m = u.match(r.re);
    if (m && (!r.method || r.method === method)) return mkRes(await r.fn(m, opts));
  }
  throw new Error('unexpected fetch: ' + method + ' ' + u);
};
const callsTo = (frag) => calls.filter((c) => c.url.includes(frag));
const resetCalls = () => { calls.length = 0; };

// ---------- фейковый socket.io ----------
function makeFakeSocket() {
  const handlers = new Map();
  const sock = {
    connected: true,
    disconnects: 0, connects: 0, emitted: [],
    on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); return sock; },
    off(ev, fn) { handlers.get(ev)?.delete(fn); return sock; },
    emit(ev, data) { sock.emitted.push({ ev, data }); return sock; },
    disconnect() { sock.disconnects++; sock.connected = false; return sock; },
    connect() { sock.connects++; sock.connected = true; return sock; },
    fire(ev, data) { (handlers.get(ev) || []).forEach((fn) => fn(data)); },
    has(ev, fn) { return handlers.get(ev)?.has(fn); },
  };
  return sock;
}
let fakeSocket = null;
let lastSocketOpts = null;
const fakeIo = (url, opts) => { fakeSocket = makeFakeSocket(); lastSocketOpts = { url, opts }; return fakeSocket; };
fakeIo.connect = fakeIo; // реальный UMD: window.io.connect === window.io
window.io = fakeIo;

// ---------- JWT-заготовки ----------
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mkJwt = (payload) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.sig`;
const JWT_NEO = mkJwt({ sub: 'u-1', email: 'neo@test.ru', is_admin: false });

// ---------- общие модули ----------
const { CONFIG } = await import('../public/js/config.mjs');
const { setState, getState } = await import('../public/js/store.mjs');
const sb = await import('../public/js/supabase.mjs');
const api = await import('../public/js/api.mjs');

const NEO = { id: 'u-1', username: 'neo', avatar_url: null, is_admin: true, donate_methods: [] };

console.log('0) паритет экспортов api.mjs ⊇ supabase.mjs:');
{
  const names = Object.keys(sb);
  const missing = names.filter((k) => !(k in api));
  ok(missing.length === 0, `все ${names.length} экспортов supabase.mjs есть в api.mjs${missing.length ? ` (нет: ${missing.join(', ')})` : ''}`);
  const typeMismatch = names.filter((k) => k in api && typeof api[k] !== typeof sb[k]);
  ok(typeMismatch.length === 0, `типы экспортов совпадают${typeMismatch.length ? ` (расхождения: ${typeMismatch.join(', ')})` : ''}`);
  ok(typeof api.isLocalBackend === 'function' && typeof api.getSocket === 'function'
    && typeof api.subscribePresenceRoom === 'function' && typeof api.fetchMyCommentCount === 'function',
  'новые функции Фазы C: isLocalBackend/getSocket/subscribePresenceRoom/fetchMyCommentCount');
}

console.log('\n1) демо-делегирование (USE_LOCAL_BACKEND=false):');
{
  ok(api.isLocalBackend() === false && api.isDemo() === true, 'isLocalBackend=false, isDemo=true');
  resetCalls();
  const feed = await api.fetchFeed();
  ok(Array.isArray(feed) && feed.length > 0 && feed[0].author !== undefined, 'fetchFeed делегирован в демо-слой (сиды с author)');
  ok(calls.length === 0, 'демо-ветка НЕ обращается к сети');
  const prof = await api.fetchProfile('u-anna');
  ok(prof && prof.username === 'AnnaSynth', 'fetchProfile — демо-сид');
  ok(api.DEMO_DB_VERSION === sb.DEMO_DB_VERSION, 'DEMO_DB_VERSION проброшен');
}

console.log('\n2) LOCAL: токены, auth-цикл, авто-refresh на 401:');
CONFIG.USE_LOCAL_BACKEND = true;
CONFIG.API_URL = 'http://api.test';
ok(api.isLocalBackend() === true && api.isDemo() === false, 'флаг включён → isLocalBackend=true, isDemo=false');
{
  // signUp: токены в localStorage, форма ответа {user, needsOnboarding}
  routes = [
    { re: /\/api\/auth\/register$/, method: 'POST', fn: async (m, opts) => {
      const body = JSON.parse(opts.body);
      return { status: 201, json: { user: { id: 'u-1', email: body.email, username: body.username, is_admin: false }, access: JWT_NEO, refresh: 'R1', needsOnboarding: true } };
    } },
  ];
  resetCalls();
  const su = await api.signUp({ email: 'neo@test.ru', password: 'secret1', username: 'neo' });
  ok(su.needsOnboarding === true && su.user.username === 'neo', 'signUp → {user, needsOnboarding:true}');
  const tk = JSON.parse(localStorage.getItem('samplehelp_api_tokens'));
  ok(tk.access === JWT_NEO && tk.refresh === 'R1', 'токены сохранены в localStorage (samplehelp_api_tokens)');
  ok(calls[0].headers.authorization === undefined && calls[0].headers['content-type'] === 'application/json', 'register уходит БЕЗ Authorization, с JSON');

  // getSessionUser: /profiles/me + email из JWT
  routes = [{ re: /\/api\/profiles\/me$/, fn: async () => ({ json: { id: 'u-1', username: 'neo', avatar_url: null, rating: 0, is_admin: false, links: [] } }) }];
  const sess = await api.getSessionUser();
  ok(sess.id === 'u-1' && sess.email === 'neo@test.ru', 'getSessionUser: профиль + email из payload JWT');

  // signIn + 401 → тихий refresh → повтор; токены ротированы
  let refreshHits = 0;
  let notifHits = 0;
  routes = [
    { re: /\/api\/auth\/login$/, method: 'POST', fn: async () => ({ json: { user: { id: 'u-1', email: 'neo@test.ru', username: 'neo', is_admin: false }, access: 'A-STALE', refresh: 'R-OLD' } }) },
    { re: /\/api\/auth\/refresh$/, method: 'POST', fn: async (m, opts) => {
      refreshHits++;
      const body = JSON.parse(opts.body);
      return body.refresh === 'R-OLD'
        ? { json: { user: { id: 'u-1' }, access: 'A-FRESH', refresh: 'R-NEW' } }
        : { status: 401, json: { code: 'invalid_refresh', message: 'Сессия истекла' } };
    } },
    { re: /\/api\/notifications$/, fn: async (m, opts) => {
      notifHits++;
      return (opts.headers?.authorization === 'Bearer A-STALE')
        ? { status: 401, json: { code: 'not_authenticated', message: 'Требуется вход' } }
        : { json: [{ id: 'n1', type: 'answer', read: false }, { id: 'n2', type: 'message', read: false }] };
    } },
    { re: /\/api\/subscriptions$/, fn: async (m, opts) => (opts.headers?.authorization === 'Bearer A-STALE'
      ? { status: 401, json: { code: 'not_authenticated', message: 'x' } }
      : { json: [{ target_type: 'tag', target_id: 'Serum' }] }) },
  ];
  setState({ user: NEO });
  resetCalls();
  await api.signIn({ email: 'neo@test.ru', password: 'secret1' });
  // параллельные запросы с протухшим access: refresh должен взлететь ОДИН раз
  const [notifs, subs] = await Promise.all([api.fetchNotifications(), api.fetchSubscriptions()]);
  ok(refreshHits === 1, 'single-flight: один refresh на два параллельных 401');
  ok(notifHits === 2, '401 → повтор исходного запроса после refresh');
  ok(notifs.length === 1 && notifs[0].type === 'answer', "'message'-уведомления отфильтрованы (parity)");
  ok(subs.length === 1 && subs[0].target_id === 'Serum', 'второй запрос тоже повторён с новым токеном');
  const tk2 = JSON.parse(localStorage.getItem('samplehelp_api_tokens'));
  ok(tk2.access === 'A-FRESH' && tk2.refresh === 'R-NEW', 'пара токенов ротирована в localStorage');
  const retryCall = callsTo('/api/notifications')[1];
  ok(retryCall.headers.authorization === 'Bearer A-FRESH', 'повторный запрос несёт свежий access');

  // refresh не удался → токены очищены, гость
  routes = [{ re: /\/api\/auth\/refresh$/, method: 'POST', fn: async () => ({ status: 401, json: { code: 'invalid_refresh', message: 'Сессия истекла' } }) },
    { re: /\/api\/profiles\/me$/, fn: async () => ({ status: 401, json: { code: 'not_authenticated', message: 'x' } }) }];
  localStorage.setItem('samplehelp_api_tokens', JSON.stringify({ access: 'A-STALE', refresh: 'R-BAD' }));
  const gone = await api.getSessionUser();
  ok(gone === null && localStorage.getItem('samplehelp_api_tokens') === null, 'протухший refresh → null + токены очищены (гость)');

  // signOut: logout на сервер + очистка
  let logoutBody = null;
  routes = [{ re: /\/api\/auth\/logout$/, method: 'POST', fn: async (m, opts) => { logoutBody = JSON.parse(opts.body); return { json: { ok: true } }; } }];
  localStorage.setItem('samplehelp_api_tokens', JSON.stringify({ access: 'A2', refresh: 'R2' }));
  await api.signOut();
  ok(logoutBody?.refresh === 'R2' && localStorage.getItem('samplehelp_api_tokens') === null, 'signOut: refresh сгорел на сервере, localStorage чист');

  // OAuth удалён
  let oauthErr = null;
  try { await api.signInWithOAuth('google'); } catch (e) { oauthErr = e; }
  ok(!!oauthErr && /e-mail/i.test(oauthErr.message), 'signInWithOAuth в LOCAL — понятная ошибка (OAuth удалён)');
}

console.log('\n3) LOCAL: формы запросов/ответов (механический контракт):');
{
  localStorage.setItem('samplehelp_api_tokens', JSON.stringify({ access: JWT_NEO, refresh: 'R1' }));
  setState({ user: NEO });
  const qRow = { id: 'q1', user_id: 'u-2', title: 'T', answers_count: 2, likes_count: 1, username: 'ann', avatar_url: 'av.png', donate_methods: [] };
  routes = [
    { re: /\/api\/questions\?/, fn: async () => ({ json: [qRow] }) },
    { re: /\/api\/questions\/q1$/, fn: async () => ({ json: qRow }) },
    { re: /\/api\/likes\/toggle$/, method: 'POST', fn: async (m, opts) => ({ json: { liked: true, likes_count: 5, echo: JSON.parse(opts.body) } }) },
    { re: /\/api\/likes\/status/, fn: async () => ({ json: { liked: true } }) },
    { re: /\/api\/reports$/, method: 'POST', fn: async () => ({ status: 409, json: { code: 'duplicate', message: 'Вы уже жаловались на эту цель' } }) },
    { re: /\/api\/upload\/question-audio$/, method: 'POST', fn: async () => ({ status: 201, json: { name: 'x.webm', url: '/files/question-audio/x.webm' } }) },
    { re: /\/api\/favorites$/, fn: async () => ({ json: [{ question_id: 'q1', status: 'preparing', created_at: '2026-10-16', question: { id: 'q1', title: 'T', author: { id: 'u-2', username: 'ann', avatar_url: null, donate_methods: [] } } }] }) },
    { re: /\/api\/favorites\/toggle$/, method: 'POST', fn: async (m, opts) => ({ json: { favorited: true, echo: JSON.parse(opts.body) } }) },
    { re: /\/api\/donations\/count/, fn: async (m) => ({ json: { count: 7, q: m[0] } }) },
    { re: /\/api\/catalog\/synths$/, fn: async () => ({ json: ['Serum', 'Vital'] }) },
    { re: /\/api\/messages$/, method: 'POST', fn: async (m, opts) => ({ status: 201, json: { id: 'm1', ...JSON.parse(opts.body) } }) },
    { re: /\/api\/ideas\?/, fn: async () => ({ json: [{ id: 'i1', author_id: 'u-9', username: 'dev', avatar_url: null, votes: 3, status: 'new', title: 'Тема', body: 'Тело', created_at: '2026-10-16' }] }) },
    { re: /\/api\/ideas\/votes-mine$/, fn: async () => ({ json: ['i1'] }) },
    { re: /\/api\/answers\/count-mine$/, fn: async () => ({ json: { count: 4 } }) },
    { re: /\/api\/achievements$/, method: 'POST', fn: async (m, opts) => ({ status: 201, json: { awarded: true, echo: JSON.parse(opts.body) } }) },
    { re: /\/api\/answers\?question_ids=/, fn: async () => ({ json: [{ id: 'a1', question_id: 'q1', user_id: 'u-2', username: 'ann', avatar_url: null, donate_methods: [], comments: [{ id: 'c1', answer_id: 'a1', user_id: 'u-3', username: 'max', avatar_url: null, content: '+' }] }] }) },
    { re: /\/api\/profiles\/u-2$/, fn: async () => ({ json: {
      id: 'u-2', username: 'ann', links: null, contact: [{ kind: 'email', value: 'n•••@test.ru', label: '', visibility: 'members', masked: true }],
      donate_methods: [{ kind: 'qr', value: 'https://qr.nspk.ru/x', qr_data_url: 'data:image/png;base64,AA', label: '' }],
      software: ['FL Studio'], arsenal: [], stats: { questions: 1, answers: 2, likes: 3, rating: 25, solutions: 1 },
      questions: [{ id: 'q1' }], answers: [{ id: 'a1', question: { id: 'q1', title: 'T', status: 'open', purged: false } }],
    } }) },
    { re: /\/api\/health$/, fn: async () => ({ json: { ok: true, service: 'samplehelp-backend' } }) },
  ];

  resetCalls();
  const feed = await api.fetchFeed('popular');
  ok(callsTo('/api/questions?')[0].url.includes('sort=top') && callsTo('/api/questions?')[0].url.includes('limit=50'), "fetchFeed('popular') → sort=top&limit=50");
  ok(feed[0].author?.id === 'u-2' && feed[0].author?.username === 'ann', 'строка ленты: profile-джойн → author{id,username,avatar_url}');
  const feedUn = await api.fetchFeed('unanswered');
  ok(callsTo('/api/questions?')[1].url.includes('sort=unanswered'), 'sort=unanswered проброшен (без ответов)');

  const q = await api.fetchQuestion('q1');
  ok(q.author?.username === 'ann' && q.title === 'T', 'fetchQuestion → author');

  const like = await api.toggleLike('answer', 'a1');
  ok(like.liked === true && like.likes_count === 5, 'toggleLike → {liked, likes_count}');
  const likeCall = callsTo('/api/likes/toggle')[0];
  ok(JSON.parse(likeCall.body).target_type === 'answer' && likeCall.headers.authorization === `Bearer ${JWT_NEO}`, 'toggle: тело {target_type,target_id} + Bearer');
  ok((await api.isLiked('answer', 'a1')) === true, 'isLiked → bool из /likes/status');

  let dupErr = null;
  try { await api.submitReport({ target_type: 'question', target_id: 'q1', reason: 'spam' }); } catch (e) { dupErr = e; }
  ok(dupErr?.code === 'duplicate', "дубликат жалобы → Error с code='duplicate' (контракт supabase-js)");

  const blob = new Blob(['opusdata'], { type: 'audio/webm' });
  const url = await api.uploadAudio(blob);
  const fd = callsTo('/api/upload')[0].body;
  const sentFile = fd.get('file');
  ok(sentFile.name === 'sample.webm', 'blob без имени → sample.webm (расширение из MIME)');
  ok(url === 'http://api.test/files/question-audio/x.webm', 'uploadAudio → АБСОЛЮТНЫЙ url /files/...');

  ok((await api.setFavorite('q1', true)) === true, 'setFavorite(on) → true');
  ok(JSON.parse(callsTo('/api/favorites/toggle')[0].body).on === true, 'toggle отправлен с on:true (идемпотентно)');
  ok((await api.isInFavorites('q1')) === true, 'isInFavorites — по списку избранного');
  const favs = await api.fetchFavorites();
  ok(favs[0].question?.author?.username === 'ann' && favs[0].status === 'preparing', 'fetchFavorites: question+author+status из серверной формы');

  ok((await api.fetchSupportCount(null)) === 7, 'fetchSupportCount(null) → recipient_user_id=project');
  ok(callsTo('/api/donations/count')[0].url.includes('recipient_user_id=project'), 'счётчик проекта: ключ project в query');

  ok(JSON.stringify(await api.fetchSynthCatalog()) === '["Serum","Vital"]', 'fetchSynthCatalog → массив имён');

  const msg = await api.sendMessage('u-2', 'Привет', { ref: { type: 'question', id: 'q1', title: 'T' } });
  ok(msg.id === 'm1' && msg.recipient_id === 'u-2' && msg.ref?.type === 'question', 'sendMessage: recipient_id/content/ref в теле');

  const ideas = await api.fetchIdeas('top');
  ok(ideas[0].author?.id === 'u-9' && ideas[0].author?.username === 'dev' && ideas[0].votes === 3, 'fetchIdeas: author{id,username} + votes');
  const votes = await api.fetchIdeaVotesMine();
  ok(votes instanceof Set && votes.has('i1'), 'fetchIdeaVotesMine → Set(id)');

  ok((await api.fetchMyCommentCount()) === 4, 'fetchMyCommentCount → счётчик backend');
  const aw = await api.awardAchievement('first_answer');
  ok(aw === true && JSON.parse(callsTo('/api/achievements')[0].body).achievement_type === 'first_answer', 'awardAchievement → POST achievement_type');

  const batch = await api.fetchAnswersForQuestions(['q1']);
  const a1 = batch.get('q1')[0];
  ok(a1.author?.username === 'ann' && a1.comments[0].author?.username === 'max', 'пакетные ответы: author у ответа и у комментария');

  const prof = await api.fetchProfile('u-2');
  ok(prof.stats.rating === 25 && prof.questions.length === 1 && prof.answers[0].question?.title === 'T', 'fetchProfile: агрегат stats/questions/answers.question');
  ok(Array.isArray(prof.links) && prof.software[0] === 'FL Studio', 'links нормализованы, словари на месте');
  ok(prof.contact[0].value === 'n•••@test.ru' && prof.contact_consent === true, 'чужой профиль: серверная маска сохранена, consent восстановлен по факту выдачи');
  ok(prof.donate_methods[0].kind === 'qr', 'donate_methods нормализованы (QR/Boosty)');

  const h = await api.ensureClient();
  ok(h?.ok === true, 'ensureClient → /api/health {ok:true} (индикатор подвала)');
}

console.log('\n3b) сетевой отказ: человекочитаемо и без сжигания токенов:');
{
  localStorage.setItem('samplehelp_api_tokens', JSON.stringify({ access: 'A-NET', refresh: 'R-NET' }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let netErr = null;
  try { await api.fetchAdminTables(); } catch (e) { netErr = e; }
  ok(netErr?.code === 'network' && /недоступен|unreachable/i.test(netErr.message) && netErr.message.includes('http://api.test'),
    'сетевой сбой → code=network + сообщение с адресом backend и подсказкой');
  const alive = await api.getSessionUser();
  ok(alive === null, 'getSessionUser при мёртвом сервере → null (гость, без падений)');
  const tkNet = JSON.parse(localStorage.getItem('samplehelp_api_tokens') || 'null');
  ok(tkNet && tkNet.refresh === 'R-NET', 'refresh-пара НЕ сожжена сетевым сбоем (войдёт после подъёма сервера)');
  globalThis.fetch = realFetch;
  localStorage.setItem('samplehelp_api_tokens', JSON.stringify({ access: JWT_NEO, refresh: 'R1' })); // секция 4 ждёт свои токены
}

console.log('\n4) LOCAL: Socket.IO (фейковый клиент) — пуши, typing, presence:');
{
  const gotSocket = await api.getSocket();
  ok(gotSocket === fakeSocket && lastSocketOpts.url === 'http://api.test' && lastSocketOpts.opts.path === '/socket.io', 'getSocket: подключение к API_URL, path=/socket.io');
  let authPayload = null;
  lastSocketOpts.opts.auth((t) => { authPayload = t; });
  ok(authPayload.token === JWT_NEO, 'handshake несёт access-токен (функциональный auth)');

  // уведомления
  const pushed = [];
  const un1 = await api.subscribeNotifications((n) => pushed.push(n));
  fakeSocket.fire('notification', { id: 'n1', type: 'answer', payload: { by: 'ann' } });
  ok(pushed.length === 1 && pushed[0].id === 'n1', 'subscribeNotifications: пуш строки дошёл до колбэка');
  un1();
  fakeSocket.fire('notification', { id: 'n2', type: 'like' });
  ok(pushed.length === 1, 'отписка снимает слушатель');

  // ЛС: recipient-фильтр (сервер шлёт обеим сторонам)
  const msgs = [];
  const un2 = await api.subscribeMessages((m) => msgs.push(m));
  fakeSocket.fire('message', { id: 'm-out', sender_id: 'u-1', recipient_id: 'u-2' });
  fakeSocket.fire('message', { id: 'm-in', sender_id: 'u-2', recipient_id: 'u-1' });
  ok(msgs.length === 1 && msgs[0].id === 'm-in', 'subscribeMessages: только входящие (recipient = я)');
  un2();

  // typing: троттлинг 2с + фильтр по собеседнику
  const typing = [];
  const chan = await api.openTypingChannel('u-2', { onTyping: (w) => typing.push(w) });
  chan.send(); chan.send();
  const typingEmits = fakeSocket.emitted.filter((e) => e.ev === 'typing');
  ok(typingEmits.length === 1 && typingEmits[0].data.to === 'u-2' && typingEmits[0].data.conv === 'u-1__u-2', 'typing: один эмит (троттлинг), to + conv-ключ пары');
  fakeSocket.fire('typing', { from: 'u-3', username: 'max', conv: 'x' });
  ok(typing.length === 0, 'typing от третьего лица игнорируется');
  fakeSocket.fire('typing', { from: 'u-2', username: 'ann', conv: 'u-1__u-2' });
  ok(typing.length === 1 && typing[0].username === 'ann', 'typing от собеседника → onTyping({id,username})');
  chan.close();
  fakeSocket.fire('typing', { from: 'u-2', username: 'ann' });
  ok(typing.length === 1, 'close() снимает слушатель typing');

  // presence: track/untrack + состояние комнаты
  const states = [];
  const un3 = await api.subscribePresenceRoom('presence:global', { uid: 'u-1', username: 'neo', guest: false }, (st) => states.push(st));
  const tr = fakeSocket.emitted.filter((e) => e.ev === 'presence:track');
  ok(tr.length === 1 && tr[0].data.room === 'presence:global' && tr[0].data.meta.uid === 'u-1', 'presence:track с мета-данными пользователя');
  fakeSocket.fire('presence', { room: 'presence:global', users: [{ uid: 'u-2', username: 'ann', avatar_url: null }], guests: 1, total: 2 });
  fakeSocket.fire('presence', { room: 'presence:other', users: [], guests: 5, total: 5 });
  ok(states.length === 1 && states[0].users[0].uid === 'u-2' && states[0].guests === 1, 'состояние своей комнаты дошло, чужая — отфильтрована');
  un3();
  ok(fakeSocket.emitted.some((e) => e.ev === 'presence:untrack'), 'отписка → presence:untrack');

  // смена токенов → reconnect (свежий handshake)
  routes = [{ re: /\/api\/auth\/login$/, method: 'POST', fn: async () => ({ json: { user: { id: 'u-1' }, access: 'A-NEW', refresh: 'R-NEW' } }) }];
  const d0 = fakeSocket.disconnects;
  await api.signIn({ email: 'neo@test.ru', password: 'secret1' });
  ok(fakeSocket.disconnects === d0 + 1 && fakeSocket.connects >= 1, 'signIn → сокет переподключён (новый токен в handshake)');
  let authPayload2 = null;
  lastSocketOpts.opts.auth((t) => { authPayload2 = t; });
  ok(authPayload2.token === 'A-NEW', 'после входа handshake несёт новый access');
}

console.log('\n5) возврат в демо: делегирование снова работает:');
{
  CONFIG.USE_LOCAL_BACKEND = false;
  resetCalls();
  const feed = await api.fetchFeed();
  ok(feed.length > 0 && calls.length === 0, 'флаг выключен → снова демо-слой, сеть молчит');
}

console.log('\n6) статика: переключение модулей и vendor:');
{
  const fs = await import('node:fs');
  const modules = ['achievements', 'auth', 'favorites', 'feed', 'ideas', 'main', 'messages',
    'moderation', 'notifications', 'presence', 'profile', 'question', 'subscriptions', 'support'];
  const stillSupa = modules.filter((m) => fs.readFileSync(`public/js/${m}.mjs`, 'utf8').includes("from './supabase.mjs'"));
  ok(stillSupa.length === 0, `14 модулей импортируют api.mjs (остались на supabase.mjs: ${stillSupa.length ? stillSupa.join(', ') : 'нет'})`);
  const idx = fs.readFileSync('public/index.html', 'utf8');
  ok(idx.includes('/vendor/socket.io-client.min.js') && !idx.includes('/vendor/supabase.js'), 'index.html: vendor socket.io-client вместо supabase.js');
  ok(fs.existsSync('public/vendor/socket.io-client.min.js') && !fs.existsSync('public/vendor/supabase.js'), 'vendor: socket.io-client на месте, supabase.js удалён');
  ok(fs.existsSync('public/js/supabase.mjs'), 'supabase.mjs сохранён как демо-слой (страховочный пояс)');
  const cfg = fs.readFileSync('public/js/config.mjs', 'utf8');
  ok(/USE_LOCAL_BACKEND:\s*false/.test(cfg), 'в репозитории USE_LOCAL_BACKEND=false (демо/тесты зелёные)');
  ok(/API_URL:\s*'http:\/\/localhost:3100'/.test(cfg), "API_URL='http://localhost:3100' (dev-порт backend)");
  ok(/IS_DEMO = !\(CONFIG\.USE_LOCAL_BACKEND && CONFIG\.API_URL\)/.test(cfg), 'IS_DEMO = !(USE_LOCAL_BACKEND && API_URL)');
  const authSrc = fs.readFileSync('public/js/auth.mjs', 'utf8');
  ok(!/\.auth\.(onAuthStateChange|getSession|signInWith|signOut|resetPasswordForEmail)/.test(authSrc), 'auth.mjs: прямых вызовов Supabase-SDK больше нет');
  ok(/return Promise\.resolve\(\[\]\)/.test(authSrc), 'auth.mjs: OAuth-провайдеры в LOCAL → [] (ряд не рендерится)');
}

console.log(fails ? `\n✗ api-адаптер: ${fails} провалов` : '\n✓ api-адаптер: все проверки пройдены');
process.exit(fails ? 1 : 0);
