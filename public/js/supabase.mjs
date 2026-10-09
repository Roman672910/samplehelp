// ============================================================
// supabase.mjs — клиент Supabase + слой доступа к данным.
// Если ключи в config.mjs не заданы — работает DEMO-режим:
// моковые данные в памяти + процедурно генерируемое аудио (WAV),
// вейвформа которого соответствует реальным пикам семпла.
// ============================================================

import { CONFIG, IS_DEMO } from './config.mjs';
import { getState } from './store.mjs';
import { uid } from './utils.mjs';

let client = null;

/**
 * Загрузка Supabase SDK по приоритетам:
 * 1. Локальный UMD-бандл (public/vendor/supabase.js) — работает без интернета
 * 2. CDN esm.sh
 * 3. CDN jsdelivr
 */
async function loadSdk() {
  if (typeof window !== 'undefined' && window.supabase?.createClient) {
    return { createClient: window.supabase.createClient, source: 'local' };
  }
  try {
    const mod = await import(/* @vite-ignore */ 'https://esm.sh/@supabase/supabase-js@2');
    return { createClient: mod.createClient, source: 'esm.sh' };
  } catch { /* пробуем следующий источник */ }
  try {
    const mod = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return { createClient: mod.createClient, source: 'jsdelivr' };
  } catch { /* все источники недоступны */ }
  return null;
}

async function createSupabaseClient() {
  const sdk = await loadSdk();
  if (!sdk?.createClient) {
    throw new Error(
      'Не удалось загрузить Supabase SDK: локальный файл /vendor/supabase.js отсутствует, ' +
      'а CDN (esm.sh, jsdelivr) недоступны. Проверьте подключение к интернету ' +
      'или выполните npm install и скопируйте node_modules/@supabase/supabase-js/dist/umd/supabase.js в public/vendor/'
    );
  }
  try {
    return sdk.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, storageKey: 'samplehelp_auth' },
    });
  } catch (e) {
    throw new Error(`Не удалось создать клиент Supabase (проверьте SUPABASE_URL и SUPABASE_ANON_KEY в js/config.mjs): ${e.message}`);
  }
}

/**
 * Ленивое создание клиента.
 * В демо-режиме возвращает null (данные — из моков).
 * В реальном режиме НЕ возвращает null: либо клиент, либо понятная ошибка.
 * Неудача не кэшируется — следующая попытка повторит загрузку.
 */
let clientPromise = null;
export function ensureClient() {
  if (IS_DEMO) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = createSupabaseClient()
      .then((c) => { client = c; return c; })
      .catch((e) => {
        clientPromise = null; // разрешить повторную попытку
        throw e;
      });
  }
  return clientPromise;
}

/** Клиент с гарантией не-null (для вызовов вне try/catch) */
export function getClientOrNull() {
  return client;
}

export function isDemo() {
  return IS_DEMO;
}

// ============================================================
// ПРОЦЕДУРНАЯ ГЕНЕРАЦИЯ ДЕМО-АУДИО (WAV blob URL + РЕАЛЬНЫЕ пики)
// ============================================================

const demoAudioCache = new Map();

/**
 * Генерирует короткий WAV-фрагмент заданного «характера» и
 * сразу вычисляет пики из сгенерированных сэмплов — вейвформа
 * точно соответствует аудио.
 * kind: bass | pad | pluck | fx | lead
 * @returns {{ url: string, peaks: number[], duration: number }}
 */
export function getDemoAudio(kind = 'bass', seed = 1, points = 160) {
  const key = `${kind}_${seed}`;
  if (demoAudioCache.has(key)) return demoAudioCache.get(key);

  const sr = 22050;
  const dur = 4;
  const n = sr * dur;
  const data = new Float32Array(n);
  const rnd = mulberry32(seed * 9973);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 0.7) * Math.min(1, t * 40); // attack + decay
    let s = 0;
    switch (kind) {
      case 'bass':
        s = saw(55 + seed * 3, t) * 0.6 + saw(110 + seed * 6, t) * 0.25;
        break;
      case 'pad':
        s = (sine(220, t) + sine(277, t) + sine(330, t) + sine(440, t)) * 0.18
          * (0.6 + 0.4 * Math.sin(t * 0.8));
        break;
      case 'pluck':
        s = karplus(seed, i, sr) * env;
        break;
      case 'fx':
        s = (rnd() * 2 - 1) * Math.pow(t / dur, 1.6) * 0.5 + sine(200 + t * 900, t) * 0.2;
        break;
      case 'lead':
        s = saw(330, t) * 0.3 + sine(660, t) * 0.2 + sine(990 + Math.sin(t * 6) * 40, t) * 0.12;
        s *= 0.5 + 0.5 * Math.sin(t * 5);
        break;
      default:
        s = sine(220, t) * 0.3;
    }
    data[i] = Math.tanh(s * 1.4) * 0.85; // мягкое ограничение
  }

  // Реальные пики из сгенерированных сэмплов
  const block = Math.floor(n / points) || 1;
  const peaks = [];
  for (let p = 0; p < points; p++) {
    let max = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[p * block + j] || 0);
      if (v > max) max = v;
    }
    peaks.push(+max.toFixed(3));
  }

  const result = { url: encodeWav(data, sr), peaks, duration: dur };
  demoAudioCache.set(key, result);
  return result;
}

const sine = (f, t) => Math.sin(2 * Math.PI * f * t);
const saw = (f, t) => 2 * ((f * t) % 1) - 1;
// Упрощённый Karplus-Strong для «щипка»
const ksCache = new Map();
function karplus(seed, i, sr) {
  let buf = ksCache.get(seed);
  if (!buf) {
    buf = new Float32Array(Math.floor(sr / (180 + seed * 20)));
    const rnd = mulberry32(seed);
    for (let j = 0; j < buf.length; j++) buf[j] = rnd() * 2 - 1;
    ksCache.set(seed, buf);
  }
  const idx = i % buf.length;
  const next = (idx + 1) % buf.length;
  buf[idx] = (buf[idx] + buf[next]) * 0.499;
  return buf[idx];
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Кодирование Float32 → 16-bit PCM WAV → blob URL */
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

// ============================================================
// ДЕМО-ДАННЫЕ
// ============================================================

const DEMO = {
  profiles: [
    { id: 'u-anna', username: 'AnnaSynth', avatar_url: null, bio: 'Саунд-дизайнер. Обожаю FM-синтез и странные пэды. Пишу ambient под псевдонимом NULLSEA.', links: [{ platform: 'instagram', url: 'https://instagram.com/annasynth' }, { platform: 'youtube', url: 'https://youtube.com/@annasynth' }, { platform: 'soundcloud', url: 'https://soundcloud.com/annasynth' }, { platform: 'bandcamp', url: 'https://nullsea.bandcamp.com' }], rating: 1240, solutions_count: 1, open_to_collab: true },
    { id: 'u-max', username: 'MaxWavetable', avatar_url: null, bio: 'Serum-маньяк. 300+ пресетов, 12 паков. Учу людей делать жирные басы.', links: [{ platform: 'youtube', url: 'https://youtube.com/@maxwavetable' }, { platform: 'spotify', url: 'https://open.spotify.com/artist/maxwavetable' }], rating: 2110, solutions_count: 1, open_to_collab: true },
    { id: 'u-lena', username: 'LenaFX', avatar_url: null, bio: 'FX-дизайнер для игр и трейлеров. Phase Plant — мой главный инструмент.', links: [{ platform: 'soundcloud', url: 'https://soundcloud.com/lenafx' }], rating: 870 },
    { id: 'u-demo', username: 'DemoUser', avatar_url: null, bio: 'Это ваш демо-профиль. Заполните его в онбординге!', links: [], rating: 0 },
  ],
  software: {
    'u-anna': ['Ableton Live', 'Reaper'],
    'u-max': ['FL Studio'],
    'u-lena': ['Reaper', 'Cubase'],
    'u-demo': [],
  },
  skills: {
    'u-anna': ['FM-синтез', 'Ambient', 'Sound design'],
    'u-max': ['Wavetable', 'Bass design', 'Serum'],
    'u-lena': ['FX', 'Game audio', 'Foley'],
    'u-demo': [],
  },
  arsenal: {
    'u-anna': ['Serum', 'Phase Plant', 'Valhalla DSP'],
    'u-max': ['Serum', 'Massive X', 'FabFilter Pro-Q 3'],
    'u-lena': ['Phase Plant', 'Kontakt', 'Soundtoys'],
    'u-demo': [],
  },
  showcase: [
    { id: 'sh1', user_id: 'u-anna', title: 'NULLSEA — ambient sketch', audio_kind: 'pad' },
    { id: 'sh2', user_id: 'u-max', title: 'Growl bass pack demo', audio_kind: 'bass' },
  ],
  questions: [
    // «Заглушка»: вопрос решён давно, содержимое удалено по таймеру (7 дней).
    // Демонстрирует жизненный цикл: по старой ссылке остаётся страница-архив.
    { id: 'q0', user_id: 'u-lena', title: '', description: '', audio_kind: null, synth: '', category: null, status: 'solved', likes_count: 12, answers_count: 3, created_at: daysAgo(16), solved_at: daysAgo(9), purge_at: daysAgo(2), purged: true, purge_summary: { purged_at: daysAgo(2), solved_at: daysAgo(9), answers_count: 3, best_username: 'MaxWavetable', best_user_id: 'u-max', rep: 25 } },
    { id: 'q1', user_id: 'u-max', title: 'Как сделать такой «рычащий» бас?', description: 'Слышал этот бас в треке одного DnB-продюсера. Пытался крутить wavetable с FM-модуляцией, но грязь не та. Как получить такой рычащий низ с чётким субом?', audio_kind: 'bass', synth: 'Serum', category: 'synth', status: 'solved', likes_count: 34, markers: [{ time: 0.8, note: 'тот самый рык' }, { time: 2.6, note: 'хвост уплывает по высоте' }], created_at: daysAgo(5), solved_at: daysAgo(4), purge_at: daysAgo(-3) },
    { id: 'q2', user_id: 'u-anna', title: 'Тёплый эволюционирующий пэд — как повторить?', description: 'Очень медленная эволюция тембра, почти живое дыхание. Пробовала LFO на cutoff, но звучит слишком механически. В чём секрет органичности?', audio_kind: 'pad', synth: 'Phase Plant', category: 'synth', status: 'open', likes_count: 21, created_at: daysAgo(2) },
    { id: 'q3', user_id: 'u-lena', title: 'Кинематографичный riser + impact для трейлера', description: 'Нужен длинный нарастающий эффект с переходом в мощный удар. Удару не хватает веса. Как наслоить слои?', audio_kind: 'fx', synth: '', category: 'fx', status: 'open', likes_count: 15, created_at: daysAgo(1) },
    { id: 'q4', user_id: 'u-max', title: 'Плакучий lead в стиле Flume', description: 'Классический «плачущий» лид с портато и вибрато на кончике ноты. Это реально собрать с нуля? Или нужен сэмпл?', audio_kind: 'lead', synth: 'Vital', category: 'synth', status: 'open', likes_count: 9, created_at: daysAgo(0.2) },
    { id: 'q5', user_id: 'u-anna', title: 'Щипковый луп с бесконечным затуханием', description: 'Звучит как карплус-стринг, но хвост тянется секундами и слегка «плывёт» по высоте. Что это за техника?', audio_kind: 'pluck', synth: '', category: 'sample', status: 'open', likes_count: 6, created_at: daysAgo(0.5) },
  ],
  answers: [
    { id: 'a1', question_id: 'q1', user_id: 'u-anna', content: 'Секрет в двух слоях:\n\n1. Основной osc — wavetable с FM from AC (модуляция собственным выходом), drive перед фильтром.\n2. Отдельный sin-осциллатор на суб (чистая синусоида, без эффектов).\n\nДальше дисторшен (Diode-clip) ТОЛЬКО на верхнем слое, суб остаётся чистым. LFO на FM-amount с ретриггером на каждой ноте даёт тот самый «рык».\n\nПрикладываю пресет — дальше покрути под себя.', links: [{ url: 'https://www.youtube.com/watch?v=serum-growl-tutorial', kind: 'video' }], preset_url: 'demo://growl-bass.fxb', preset_name: 'growl_bass_v2.fxb', sound_type: 'Bass', difficulty: 'intermediate', tags: ['DnB', 'Growl', 'Serum'], audio_kind: 'bass', markers: [{ time: 1.2, note: '' }, { time: 2.8, note: '' }], is_solution: true, awarded_rep: true, likes_count: 28, created_at: daysAgo(4)},
    { id: 'a2', question_id: 'q1', user_id: 'u-lena', content: 'Добавлю: попробуй OTT после дисторшена на глубину 20-30% и параллельно сухой сигнал. Это вытаскивает средние частоты, из-за которых бас «слышится» на маленьких колонках.', links: [], preset_url: null, sound_type: 'Bass', difficulty: 'beginner', tags: ['OTT', 'Mixing'], is_solution: false, likes_count: 11, created_at: daysAgo(3.5) },
    { id: 'a3', question_id: 'q2', user_id: 'u-lena', content: 'Органичность даёт НЕ LFO, а случайные модуляции. Используй несколько random-модуляторов (smoothed noise) на: время атаки, уровень отдельного слоя, микро-детюн.\n\nКлюч: каждая модуляция со своей скоростью (0.05Hz, 0.13Hz, 0.07Hz — некруглые значения!). Пэд начинает «дышать», потому что изменения никогда не повторяются.', links: [{ url: 'https://kilohearts.com/products/phase_plant/tutorials', kind: 'docs' }], preset_url: null, sound_type: 'Pad', difficulty: 'advanced', tags: ['Ambient', 'Random modulation'], audio_kind: 'pad', markers: [{ time: 0.9, note: '' }], is_solution: false, likes_count: 17, created_at: daysAgo(1.5)},
    { id: 'a5', question_id: 'q4', user_id: 'u-max', content: 'Отвечаю сам себе: раскопал! «Плач» даёт glide (portamento) ~80 мс в voicing-секции + LFO-вибрато на pitch с задержкой включения ~200 мс. В Vital всё нашлось без сэмплов.', links: [], preset_url: null, sound_type: 'Lead', difficulty: 'beginner', tags: ['Vital', 'Portamento'], is_solution: false, likes_count: 3, created_at: daysAgo(0.15) },
    { id: 'a4', question_id: 'q3', user_id: 'u-anna', content: 'Удару не хватает веса из-за фазовых проблем. Чек-лист:\n\n1. Все слои impact должны стартовать с нулевой фазы (включи fixed phase).\n2. Суб-слой (40-60Hz sine) с быстрым pitch-drop.\n3. Проверь сумму в моно — если удар пропадает, слои в противофазе.\n4. Транзиент (щелчок) отдельно от тела удара, с задержкой 3-5 мс.', links: [], preset_url: null, sound_type: 'FX', difficulty: 'intermediate', tags: ['Cinematic', 'Impact'], is_solution: false, likes_count: 8, created_at: daysAgo(0.7) },
  ],
  comments: [
    { id: 'c1', answer_id: 'a1', user_id: 'u-max', content: 'Пресет — огонь! Диодный клипер вообще магия, спасибо 🙏', created_at: daysAgo(3.9) },
    { id: 'c2', answer_id: 'a1', user_id: 'u-lena', content: 'Подтверждаю, FM from AC + diode — рабочая схема. Ещё drive можно заменить на Downsample для более «злого» характера.', created_at: daysAgo(3.2) },
    { id: 'c3', answer_id: 'a3', user_id: 'u-anna', content: 'Никогда не думала про некруглые значения LFO... Попробую сегодня же!', created_at: daysAgo(1.2) },
  ],
  likes: [],
  favorites: [],
  messages: [
    { id: 'm1', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'Привет! Видела твой вопрос про пэды — готовлю подробный ответ 😉', read: true, created_at: daysAgo(1) },
    { id: 'm2', sender_id: 'u-demo', recipient_id: 'u-anna', content: 'Привет! Буду очень ждать, спасибо!', read: true, created_at: daysAgo(0.9) },
    { id: 'm3', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'Кстати, попробуй random-модуляторы вместо LFO — я про это в ответе писала.', read: false, reactions: [{ user_id: 'u-demo', username: 'DemoUser', emoji: '🔥' }], created_at: daysAgo(0.2) },
    { id: 'm4', sender_id: 'u-max', recipient_id: 'u-demo', content: 'Здарова! Если нужны пресеты для Serum — пиши, у меня их сотни.', read: false, created_at: daysAgo(0.1) },
    { id: 'm5', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'Послушай, какой щипковый луп у меня получился!', audio_kind: 'pluck', read: false, created_at: daysAgo(0.03) },
  ],
  notifications: [
    { id: 'n1', user_id: 'u-demo', type: 'answer', payload: { questionTitle: 'Тёплый эволюционирующий пэд — как повторить?', by: 'LenaFX' }, read: false, created_at: daysAgo(1.5) },
    { id: 'n2', user_id: 'u-demo', type: 'like', payload: { by: 'MaxWavetable', target: 'твой ответ' }, read: false, created_at: daysAgo(0.8) },
    // Уведомлений типа 'message' больше нет: личные сообщения показываются
    // счётчиком непрочитанных на иконке «Сообщения» (см. notifications.mjs)
  ],
  achievements: [],
  subscriptions: [
    { user_id: 'u-demo', target_type: 'author', target_id: 'u-anna' },
  ],
  donations: [
    { id: 'd1', donor_id: 'u-max', recipient_user_id: 'u-anna', amount: 300, currency: 'RUB', message: 'За эволюционирующий пэд!', status: 'intent', created_at: daysAgo(3) },
    { id: 'd2', donor_id: 'u-lena', recipient_user_id: 'u-anna', amount: 5, currency: 'USD', message: 'Спасибо за разбор FM', status: 'intent', created_at: daysAgo(2) },
    { id: 'd3', donor_id: 'u-anna', recipient_user_id: 'u-max', amount: 1000, currency: 'RUB', message: 'Growl-бас спас мой трек', status: 'intent', created_at: daysAgo(1) },
    { id: 'd4', donor_id: 'u-max', recipient_user_id: null, amount: 500, currency: 'RUB', message: 'На развитие платформы!', status: 'intent', created_at: daysAgo(4) },
  ],
  // Справочники: базовые значения + пользовательские (общие для всех)
  synthCatalog: ['Serum', 'Phase Plant', 'Vital', 'Massive X', 'Diva', 'Omnisphere', 'Sylenth1', 'Pigments'],
  dawCatalog: ['FL Studio', 'Ableton Live', 'Logic Pro', 'Reaper', 'Cubase', 'Studio One', 'Bitwig Studio', 'Pro Tools', 'GarageBand', 'Reason'],
};

function daysAgo(d) { return new Date(Date.now() - d * 86400000).toISOString(); }

// Константы времени — используются sweep-проходом жизненного цикла,
// который запускается СРАЗУ при загрузке модуля (объявляем заранее,
// иначе будет TDZ-ошибка «Cannot access before initialization»)
const HOUR = 3600000;
const DAY = 86400000;

/** Демо-сообщение: материализуем аудио из «характера» звука */
function demoMsg(m) {
  if (!m.audio_kind || m.audio_url) return m;
  const audio = getDemoAudio(m.audio_kind, m.id.charCodeAt(1) || 7);
  return { ...m, audio_url: audio.url, waveform_data: audio.peaks };
}

// демо-пользователь по умолчанию
const DEMO_USER = DEMO.profiles.find((p) => p.id === 'u-demo');

// Персистентность пользовательских справочников в демо-режиме
const CATALOG_KEY = 'samplehelp_catalogs';
if (IS_DEMO) {
  try {
    const saved = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null');
    if (saved?.synths?.length) DEMO.synthCatalog = [...new Set([...DEMO.synthCatalog, ...saved.synths])];
    if (saved?.daws?.length) DEMO.dawCatalog = [...new Set([...DEMO.dawCatalog, ...saved.daws])];
  } catch { /* ignore */ }
}
function persistCatalogs() {
  if (!IS_DEMO) return;
  localStorage.setItem(CATALOG_KEY, JSON.stringify({ synths: DEMO.synthCatalog, daws: DEMO.dawCatalog }));
}

// ============================================================
// ПЕРСИСТЕНТНОСТЬ ДЕМО-РЕЖИМА
// Все пользовательские изменения (аватар, био, ссылки, DAW, навыки,
// вопросы, ответы, комментарии, лайки, избранное, сообщения,
// уведомления, достижения, подписки) сохраняются в LocalStorage
// и восстанавливаются после перезагрузки страницы.
// ============================================================
const DEMO_DB_KEY = 'samplehelp_demo_db';
export const DEMO_DB_VERSION = 4; // v4: маркеры в комментариях убраны (сиды без marker_time)
const DEMO_PERSIST_KEYS = [
  'profiles', 'software', 'skills', 'arsenal', 'showcase', 'questions', 'answers', 'comments',
  'likes', 'favorites', 'messages', 'notifications', 'achievements', 'subscriptions', 'donations',
];

/** Сохранить текущее состояние демо-базы в LocalStorage */
export function persistDemo() {
  if (!IS_DEMO) return;
  try {
    const slimQuestions = DEMO.questions.map((q) => {
      // Сид-вопросы: аудио генерируется заново при загрузке — не храним
      if (q.audio_kind) {
        const { audio_url, waveform_data, ...rest } = q;
        void audio_url; void waveform_data;
        return rest;
      }
      // Пользовательские вопросы: audio_url — dataURL, храним целиком
      return q;
    });
    const snapshot = { v: DEMO_DB_VERSION };
    for (const key of DEMO_PERSIST_KEYS) snapshot[key] = key === 'questions' ? slimQuestions : DEMO[key];
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[demo] не удалось сохранить состояние (возможно, переполнен LocalStorage):', e);
  }
}

/** Восстановить демо-базу из LocalStorage при старте */
function loadDemo() {
  if (!IS_DEMO) return;
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_DB_KEY) || 'null');
    if (!saved || saved.v !== DEMO_DB_VERSION) return;
    for (const key of DEMO_PERSIST_KEYS) {
      if (!saved[key]) continue;
      if (key === 'questions' || key === 'answers' || key === 'comments') {
        // Пользовательские данные важнее, но новые демо-сиды доливаются,
        // а их новые поля (маркеры, аудио) наслаиваются на сохранённые
        const seedsById = new Map(DEMO[key].map((x) => [x.id, x]));
        const savedIds = new Set(saved[key].map((x) => x.id));
        const mergedSaved = saved[key].map((item) =>
          seedsById.has(item.id) ? { ...seedsById.get(item.id), ...item } : item);
        DEMO[key] = [...mergedSaved, ...DEMO[key].filter((x) => !savedIds.has(x.id))];
      } else {
        DEMO[key] = saved[key];
      }
    }
  } catch { /* повреждённые данные — стартуем с чистого демо */ }
}
loadDemo();
// Сразу прогоняем жизненный цикл решённых вопросов (удаление по таймеру,
// напоминания) — заглушки и уведомления готовы до первого рендера
demoLifecycleSweep();

// ============================================================
// СПРАВОЧНИКИ (синтезаторы / DAW) — общие для всех пользователей
// ============================================================

export async function fetchSynthCatalog() {
  if (IS_DEMO) return [...DEMO.synthCatalog].map((s) => s.trim()).filter(Boolean);
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('synth_catalog').select('name').order('name');
    if (error) throw error;
    return (data || []).map((r) => r.name);
  } catch (e) {
    console.error('[catalog] synths:', e);
    return ['Serum', 'Phase Plant', 'Vital', 'Massive X', 'Diva'];
  }
}

export async function addSynthToCatalog(name) {
  const clean = name.trim();
  if (!clean) return false;
  if (IS_DEMO) {
    if (!DEMO.synthCatalog.includes(clean)) { DEMO.synthCatalog.push(clean); persistCatalogs(); }
    return true;
  }
  try {
    const sb = await ensureClient();
    await sb.from('synth_catalog').upsert({ name: clean, added_by: getState().user?.id || null }, { onConflict: 'name' });
    return true;
  } catch (e) {
    console.error('[catalog] addSynth:', e);
    return false;
  }
}

export async function fetchDawCatalog() {
  if (IS_DEMO) return [...DEMO.dawCatalog];
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('daw_catalog').select('name').order('name');
    if (error) throw error;
    return (data || []).map((r) => r.name);
  } catch (e) {
    console.error('[catalog] daws:', e);
    return ['FL Studio', 'Ableton Live', 'Logic Pro', 'Reaper'];
  }
}

export async function addDawToCatalog(name) {
  const clean = name.trim();
  if (!clean) return false;
  if (IS_DEMO) {
    if (!DEMO.dawCatalog.includes(clean)) { DEMO.dawCatalog.push(clean); persistCatalogs(); }
    return true;
  }
  try {
    const sb = await ensureClient();
    await sb.from('daw_catalog').upsert({ name: clean, added_by: getState().user?.id || null }, { onConflict: 'name' });
    return true;
  } catch (e) {
    console.error('[catalog] addDaw:', e);
    return false;
  }
}

// ============================================================
// АУТЕНТИФИКАЦИЯ
// ============================================================

const DEMO_SESSION_KEY = 'samplehelp_demo_session';

// Кэш строк профилей: username/аватар меняются редко, а спрашивают их
// на каждой странице. Экономит по одному сетевому запросу на обращение.
const profilesRowCache = new Map();
export function invalidateProfileCache(id) {
  if (id) profilesRowCache.delete(id);
  else profilesRowCache.clear();
}

export async function getSessionUser() {
  if (IS_DEMO) {
    const raw = localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  try {
    const sb = await ensureClient();
    // getSession() читает локальный localStorage — БЕЗ сетевого запроса
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const uid = data.session.user.id;
    let profile = profilesRowCache.get(uid);
    if (profile === undefined) {
      const { data: pdata } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
      profile = pdata || null;
      if (profile) profilesRowCache.set(uid, profile);
    }
    return { id: uid, email: data.session.user.email, ...(profile || {}) };
  } catch (e) {
    console.error('[auth] getSessionUser:', e);
    return null;
  }
}

/**
 * Создаёт строку профиля, если её ещё нет (идемпотентно).
 * Вызывается при регистрации, входе и восстановлении сессии —
 * профиль «долечивается» автоматически, даже если прошлая попытка
 * не удалась (например, не было сессии из-за Confirm email).
 */
export async function ensureProfileRow(authUser, usernameHint = '') {
  if (!authUser?.id || IS_DEMO) return false;
  try {
    const sb = await ensureClient();
    const { data: existing } = await sb.from('profiles').select('id').eq('id', authUser.id).maybeSingle();
    if (existing) return true;
    const base = usernameHint || authUser.user_metadata?.username || (authUser.email || 'user').split('@')[0];
    let { error } = await sb.from('profiles').insert({ id: authUser.id, username: base, links: [] });
    if (error && error.code === '23505') {
      // Имя уже занято — добавляем короткий суффикс
      ({ error } = await sb.from('profiles').insert({ id: authUser.id, username: `${base}_${authUser.id.slice(0, 4)}`, links: [] }));
    }
    if (error) {
      console.error('[profiles] ensureProfileRow:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[profiles] ensureProfileRow:', e);
    return false;
  }
}

export async function signUp({ email, password, username }) {
  if (IS_DEMO) {
    const user = { ...DEMO_USER, id: 'u-demo', username: username || 'DemoUser', email };
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    return { user, needsOnboarding: true };
  }
  const sb = await ensureClient();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { username } }, // username доживёт до подтверждения email в user_metadata
  });
  if (error) throw error;

  // Сессии нет = в Supabase включён «Confirm email».
  // Без сессии RLS не даст создать профиль — честно сообщаем
  // пользователю вместо «полу-входа» без профиля
  if (!data.session) {
    return { user: null, needsConfirmation: true };
  }

  await ensureProfileRow(data.session.user, username);
  return { user: data.session.user, needsOnboarding: true };
}

export async function signIn({ email, password }) {
  if (IS_DEMO) {
    const user = { ...DEMO_USER, email };
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    return { user };
  }
  const sb = await ensureClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // Самопочинка: если строка профиля отсутствует — создаём
  await ensureProfileRow(data.user);
  return { user: data.user };
}

export async function signInWithOAuth(provider) {
  if (IS_DEMO) {
    const user = { ...DEMO_USER, username: `${provider}_user`, email: `demo@${provider}.local` };
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    return { user };
  }
  const sb = await ensureClient();
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${location.origin}/` },
  });
  if (error) throw error;
  return { user: null }; // страница перезагрузится после OAuth
}

export async function resetPassword(email) {
  if (IS_DEMO) return;
  const sb = await ensureClient();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
  if (error) throw error;
}

export async function signOut() {
  if (IS_DEMO) {
    localStorage.removeItem(DEMO_SESSION_KEY);
    return;
  }
  try {
    const sb = await ensureClient();
    await sb.auth.signOut();
  } catch (e) {
    console.warn('[auth] signOut:', e);
  }
}

// ============================================================
// ВОПРОСЫ / ЛЕНТА
// ============================================================

function demoQuestion(q) {
  const author = DEMO.profiles.find((p) => p.id === q.user_id);
  // Заглушка удалённого вопроса: никакого аудио, только метаданные архива
  if (q.purged) {
    return {
      ...q,
      audio_url: null,
      waveform_data: [],
      author: author ? { id: author.id, username: author.username, avatar_url: author.avatar_url } : null,
      answers_count: q.purge_summary?.answers_count ?? 0,
    };
  }
  const audio = q.audio_url
    ? { url: q.audio_url, peaks: q.waveform_data || [] }
    : getDemoAudio(q.audio_kind || 'bass', q.id.charCodeAt(1) || 1);
  return {
    ...q,
    audio_url: audio.url,
    waveform_data: audio.peaks,
    author: author ? { id: author.id, username: author.username, avatar_url: author.avatar_url } : null,
    answers_count: DEMO.answers.filter((a) => a.question_id === q.id).length,
  };
}

// ============================================================
// ЖИЗНЕННЫЙ ЦИКЛ РЕШЁННОГО ВОПРОСА (демо-режим)
// • через 7 дней после отметки «✓ Решение» содержимое удаляется,
//   на его месте остаётся заглушка (purge_summary)
// • напоминания автору нерешённого вопроса: через 24 ч и 3 дня
//   после первого ответа (чужого), затем тишина
// • статистика отвечающих сохраняется навсегда (purged_answers_count)
// ============================================================

/** Удалить содержимое решённого вопроса, оставив заглушку */
function demoPurgeQuestion(q) {
  const answers = DEMO.answers.filter((a) => a.question_id === q.id);
  const best = answers.find((a) => a.is_solution);
  const bestProfile = best ? DEMO.profiles.find((p) => p.id === best.user_id) : null;
  const oldTitle = q.title;

  // Вечная статистика: сколько ответов каждого пользователя ушло в архив
  const byUser = new Map();
  answers.forEach((a) => byUser.set(a.user_id, (byUser.get(a.user_id) || 0) + 1));
  byUser.forEach((cnt, uid) => {
    const p = DEMO.profiles.find((x) => x.id === uid);
    if (p) p.purged_answers_count = (p.purged_answers_count || 0) + cnt;
  });

  // Каскадная чистка: ответы, комментарии, лайки
  const answerIds = new Set(answers.map((a) => a.id));
  DEMO.comments = DEMO.comments.filter((c) => !answerIds.has(c.answer_id));
  DEMO.answers = DEMO.answers.filter((a) => a.question_id !== q.id);
  DEMO.likes = DEMO.likes.filter((l) => !(
    (l.target_type === 'answer' && answerIds.has(l.target_id)) ||
    (l.target_type === 'question' && l.target_id === q.id)
  ));

  // Превращаем вопрос в заглушку (избранное/ссылки сохраняются — ведут на архив)
  q.purged = true;
  q.purge_summary = {
    purged_at: new Date().toISOString(),
    solved_at: q.solved_at,
    answers_count: answers.length,
    best_username: bestProfile?.username || null,
    best_user_id: best?.user_id || null,
    rep: CONFIG.SOLUTION_REP,
  };
  q.title = '';
  q.description = '';
  q.audio_url = null;
  q.waveform_data = null;
  q.markers = [];
  q.synth = '';
  q.category = null;
  q.audio_kind = null;
  q.likes_count = 0;

  // Финальное уведомление автору вопроса
  DEMO.notifications.unshift({
    id: uid('n-'),
    user_id: q.user_id,
    type: 'purge',
    payload: {
      questionId: q.id,
      questionTitle: oldTitle,
      answersCount: answers.length,
      bestUsername: bestProfile?.username || '',
      purgedAt: q.purge_summary.purged_at,
    },
    read: false,
    created_at: new Date().toISOString(),
  });
}

/**
 * Проход жизненного цикла: удаление просроченных решённых вопросов
 * и напоминания авторам. Идемпотентен — можно вызывать при каждом старте.
 */
export function demoLifecycleSweep() {
  if (!IS_DEMO) return;
  const now = Date.now();
  let changed = false;

  // 1) Удаление решённых вопросов с истёкшим сроком
  DEMO.questions.forEach((q) => {
    if (!q.purged && q.purge_at && new Date(q.purge_at).getTime() <= now) {
      demoPurgeQuestion(q);
      changed = true;
    }
  });

  // 2) Напоминания авторам нерешённых вопросов с чужими ответами
  DEMO.questions.forEach((q) => {
    if (q.purged || q.status === 'solved') return;
    const foreign = DEMO.answers.filter((a) => a.question_id === q.id && a.user_id !== q.user_id);
    if (!foreign.length) return;
    const firstAt = Math.min(...foreign.map((a) => new Date(a.created_at).getTime()));
    const remind = (flagKey, delayMs) => {
      if (q[flagKey] || now < firstAt + delayMs) return;
      q[flagKey] = true;
      changed = true;
      DEMO.notifications.unshift({
        id: uid('n-'),
        user_id: q.user_id,
        type: 'reminder',
        payload: { questionId: q.id, questionTitle: q.title },
        read: false,
        created_at: new Date().toISOString(),
      });
    };
    remind('reminder_24h', 24 * HOUR);
    remind('reminder_3d', 3 * DAY);
  });

  if (changed) persistDemo();
}

/**
 * Запуск жизненного цикла при старте приложения.
 * Демо: локальный sweep. Реальный режим: серверная функция
 * run_question_lifecycle() в БД (см. setup.sql) — fire-and-forget.
 */
export async function runLifecycleSweep() {
  if (IS_DEMO) { demoLifecycleSweep(); return; }
  try {
    const sb = await ensureClient();
    if (!sb || !getState().user) return;
    const { error } = await sb.rpc('run_question_lifecycle');
    if (error) throw error;
  } catch (e) {
    // Не критично: повторим при следующем открытии приложения
    console.warn('[lifecycle] sweep:', e.message || e);
  }
}

export async function fetchFeed(sort = 'new') {
  if (IS_DEMO) {
    // Заглушки удалённых вопросов в ленте не показываются (они живут по своим ссылкам)
    let list = DEMO.questions.filter((q) => !q.purged).map(demoQuestion);
    if (sort === 'new') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sort === 'popular') list.sort((a, b) => b.likes_count - a.likes_count);
    if (sort === 'unanswered') list = list.filter((q) => q.answers_count === 0).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }
  try {
    const sb = await ensureClient();
    let query = sb.from('questions').select('*, profiles(username, avatar_url)').eq('purged', false);
    if (sort === 'popular') query = query.order('likes_count', { ascending: false });
    else query = query.order('created_at', { ascending: false });
    let { data, error } = await query.limit(50);
    if (error && /purged/.test(error.message || '')) {
      // Миграция жизненного цикла ещё не выполнена в БД — работаем без фильтра
      let q2 = sb.from('questions').select('*, profiles(username, avatar_url)');
      if (sort === 'popular') q2 = q2.order('likes_count', { ascending: false });
      else q2 = q2.order('created_at', { ascending: false });
      ({ data, error } = await q2.limit(50));
    }
    if (error) throw error;
    return (data || []).map((q) => ({ ...q, author: q.profiles }));
  } catch (e) {
    console.error('[feed] fetchFeed:', e);
    return [];
  }
}

export async function fetchQuestion(id) {
  if (IS_DEMO) {
    const q = DEMO.questions.find((x) => x.id === id);
    return q ? demoQuestion(q) : null;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('questions').select('*, profiles(username, avatar_url, bio)').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, author: data.profiles } : null;
  } catch (e) {
    console.error('[question] fetchQuestion:', e);
    return null;
  }
}

export async function createQuestion(payload) {
  if (IS_DEMO) {
    const { user } = getState();
    const q = { id: uid('q-'), user_id: user?.id || 'u-demo', likes_count: 0, status: 'open', created_at: new Date().toISOString(), ...payload };
    DEMO.questions.unshift(q);
    persistDemo();
    return demoQuestion(q);
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('questions').insert(payload).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[question] createQuestion:', e);
    throw e;
  }
}

// ---------- Ответы ----------
/**
 * Пакетная загрузка ответов (с комментариями) для списка вопросов.
 * Используется лентой для предзагрузки — раскрытие карточки
 * становится мгновенным. Возвращает Map<questionId, answers[]>.
 */
export async function fetchAnswersForQuestions(questionIds) {
  const map = new Map(questionIds.map((id) => [id, []]));
  if (!questionIds.length) return map;
  if (IS_DEMO) {
    for (const qid of questionIds) map.set(qid, await fetchAnswers(qid));
    return map;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('answers')
      .select('*, profiles(username, avatar_url)')
      .in('question_id', questionIds)
      .order('is_solution', { ascending: false })
      .order('likes_count', { ascending: false });
    if (error) throw error;
    const answerIds = (data || []).map((a) => a.id);
    let comments = [];
    if (answerIds.length) {
      const { data: cdata } = await sb.from('comments')
        .select('*, profiles(username, avatar_url)')
        .in('answer_id', answerIds)
        .order('created_at');
      comments = cdata || [];
    }
    for (const a of data || []) {
      map.get(a.question_id)?.push({
        ...a,
        comments: comments
          .filter((cm) => cm.answer_id === a.id)
          .map((cm) => ({ ...cm, author: cm.profiles })),
      });
    }
    return map;
  } catch (e) {
    console.error('[feed] fetchAnswersForQuestions:', e);
    return map;
  }
}

export async function fetchAnswers(questionId) {
  if (IS_DEMO) {
    return DEMO.answers
      .filter((a) => a.question_id === questionId)
      .map(demoMsg)
      .map((a) => ({
        ...a,
        author: DEMO.profiles.find((p) => p.id === a.user_id),
        comments: DEMO.comments
          .filter((c) => c.answer_id === a.id)
          .map((c) => ({ ...c, author: DEMO.profiles.find((p) => p.id === c.user_id) })),
      }))
      .sort((a, b) => (b.is_solution - a.is_solution) || (b.likes_count - a.likes_count));
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('answers').select('*, profiles(username, avatar_url)').eq('question_id', questionId).order('is_solution', { ascending: false }).order('likes_count', { ascending: false });
    if (error) throw error;
    // Комментарии к ответам
    const ids = (data || []).map((a) => a.id);
    let comments = [];
    if (ids.length) {
      const { data: cdata } = await sb.from('comments').select('*, profiles(username, avatar_url)').in('answer_id', ids).order('created_at');
      comments = cdata || [];
    }
    return (data || []).map((a) => ({ ...a, comments: comments.filter((c) => c.answer_id === a.id).map((c) => ({ ...c, author: c.profiles })) }));
  } catch (e) {
    console.error('[answers] fetchAnswers:', e);
    return [];
  }
}

export async function createAnswer(payload) {
  if (IS_DEMO) {
    const target = DEMO.questions.find((x) => x.id === payload.question_id);
    if (target && (target.status === 'solved' || target.purged)) {
      throw new Error('Вопрос решён — приём новых ответов закрыт');
    }
    const { user } = getState();
    const a = { id: uid('a-'), user_id: user?.id || 'u-demo', likes_count: 0, is_solution: false, created_at: new Date().toISOString(), ...payload };
    DEMO.answers.push(a);
    const q = DEMO.questions.find((x) => x.id === a.question_id);
    if (q) q.answers_count = (q.answers_count || 0) + 1;
    persistDemo();
    return a;
  }
  try {
    const sb = await ensureClient();
    const { user } = getState();
    if (!user) throw new Error('Требуется вход');
    // user_id подставляем централизованно — без него RLS отклоняет вставку
    const { data, error } = await sb.from('answers').insert({ user_id: user.id, ...payload }).select().single();
    if (error) throw error;
    // Счётчик ответов на вопросе обновляет триггер в БД (см. setup.sql)
    return data;
  } catch (e) {
    console.error('[answers] createAnswer:', e);
    throw e;
  }
}

/**
 * Отметить ответ решением (или снять отметку: answerId = null).
 * • автор лучшего ответа мгновенно получает +CONFIG.SOLUTION_REP репутации
 *   (один раз за ответ, флаг awarded_rep) и уведомление
 * • вопрос получает solved_at и purge_at (= +7 дней): по истечении срока
 *   содержимое удалится, останется заглушка (см. demoLifecycleSweep /
 *   SQL-функцию run_question_lifecycle)
 * • снятие отметки («Отменить решение») возвращает вопрос в «открыт»,
 *   таймер удаления снимается; уже выданная репутация не отзывается
 */
export async function markSolution(answerId, questionId) {
  if (IS_DEMO) {
    const q = DEMO.questions.find((x) => x.id === questionId);
    DEMO.answers.forEach((a) => { if (a.question_id === questionId) a.is_solution = a.id === answerId; });
    if (q) {
      if (answerId) {
        q.status = 'solved';
        // Таймер ставится при ПЕРВОЙ отметке; смена лучшего ответа его не сбрасывает
        if (!q.solved_at) {
          q.solved_at = new Date().toISOString();
          q.purge_at = new Date(Date.now() + CONFIG.SOLVED_PURGE_DAYS * 86400000).toISOString();
        }
        // Репутация помощнику — один раз за ответ, только если это не самоответ
        const answer = DEMO.answers.find((a) => a.id === answerId);
        if (answer && !answer.awarded_rep && answer.user_id !== q.user_id) {
          answer.awarded_rep = true;
          const helper = DEMO.profiles.find((p) => p.id === answer.user_id);
          if (helper) {
            helper.rating = (helper.rating || 0) + CONFIG.SOLUTION_REP;
            helper.solutions_count = (helper.solutions_count || 0) + 1;
          }
        }
      } else {
        q.status = 'open';
        q.solved_at = null;
        q.purge_at = null;
      }
    }
    // Уведомление автору ответа: его ответ отметили решением
    if (answerId && q) {
      const { user } = getState();
      const answer = DEMO.answers.find((a) => a.id === answerId);
      if (answer && user && answer.user_id !== user.id) {
        DEMO.notifications.unshift({
          id: uid('n-'),
          user_id: answer.user_id,
          type: 'solution',
          payload: { by: user.username || '?', questionTitle: q.title || '', questionId, rep: CONFIG.SOLUTION_REP },
          read: false,
          created_at: new Date().toISOString(),
        });
      }
    }
    persistDemo();
    return;
  }
  try {
    const sb = await ensureClient();
    // Вся логика (статус, таймер, репутация, уведомление) — в серверной
    // функции mark_solution: клиенту не нужно править чужие строки (RLS)
    const { error } = await sb.rpc('mark_solution', { p_answer: answerId || null, p_question: questionId });
    if (error) throw error;
  } catch (e) {
    console.error('[answers] markSolution:', e);
    throw e;
  }
}

export async function createComment(payload) {
  if (IS_DEMO) {
    const { user } = getState();
    const c = { id: uid('c-'), user_id: user?.id || 'u-demo', created_at: new Date().toISOString(), ...payload };
    DEMO.comments.push(c);
    persistDemo();
    return { ...c, author: DEMO.profiles.find((p) => p.id === c.user_id) };
  }
  try {
    const sb = await ensureClient();
    const { user } = getState();
    if (!user) throw new Error('Требуется вход');
    // user_id подставляем централизованно — без него RLS отклоняет вставку
    const { data, error } = await sb.from('comments').insert({ user_id: user.id, ...payload }).select().single();
    if (error) throw error;
    // Прикладываем автора — карточка комментария строится до перечитывания списка
    return { ...data, author: { id: user.id, username: user.username || '', avatar_url: user.avatar_url || null } };
  } catch (e) {
    console.error('[comments] createComment:', e);
    throw e;
  }
}

// ============================================================
// РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ (вопросы / ответы / комментарии)
// Права: только автор своей записи (RLS-политики в setup.sql).
// ============================================================

/** Изменить свой вопрос. edited_at проставляется автоматически. */
export async function updateQuestion(id, patch) {
  if (IS_DEMO) {
    const q = DEMO.questions.find((x) => x.id === id);
    if (!q) throw new Error('Question not found');
    Object.assign(q, patch, { edited_at: new Date().toISOString() });
    persistDemo();
    return demoQuestion(q);
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('questions')
      .update({ ...patch, edited_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[question] updateQuestion:', e);
    throw e;
  }
}

/**
 * Удалить свой вопрос.
 * В БД ответы/комментарии/избранное удаляются каскадно (FK ON DELETE CASCADE),
 * в демо-режиме чистим связанные записи вручную.
 */
export async function deleteQuestion(id) {
  if (IS_DEMO) {
    const answerIds = new Set(DEMO.answers.filter((a) => a.question_id === id).map((a) => a.id));
    DEMO.comments = DEMO.comments.filter((c) => !answerIds.has(c.answer_id));
    DEMO.answers = DEMO.answers.filter((a) => a.question_id !== id);
    DEMO.questions = DEMO.questions.filter((q) => q.id !== id);
    DEMO.favorites = DEMO.favorites.filter((f) => f.question_id !== id);
    DEMO.likes = DEMO.likes.filter((l) => !(l.target_type === 'question' && l.target_id === id));
    DEMO.notifications = DEMO.notifications.filter((n) => n.payload?.questionId !== id);
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('questions').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[question] deleteQuestion:', e);
    throw e;
  }
}

/** Изменить свой ответ (контент/теги/тип/сложность/ссылки). */
export async function updateAnswer(id, patch) {
  if (IS_DEMO) {
    const a = DEMO.answers.find((x) => x.id === id);
    if (!a) throw new Error('Answer not found');
    Object.assign(a, patch, { edited_at: new Date().toISOString() });
    persistDemo();
    return { ...a };
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('answers')
      .update({ ...patch, edited_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[answers] updateAnswer:', e);
    throw e;
  }
}

/**
 * Удалить свой ответ.
 * Демо: чистим комментарии/лайки ответа, уменьшаем счётчик, если ответ
 * был решением — возвращаем вопросу статус «открыт».
 * БД: комментарии удаляет каскад, счётчик — триггер answers_bump,
 * статус вопроса сбрасывает триггер answers_delete_cleanup (setup.sql).
 */
export async function deleteAnswer(id) {
  if (IS_DEMO) {
    const a = DEMO.answers.find((x) => x.id === id);
    if (!a) return true;
    const wasSolution = !!a.is_solution;
    const qid = a.question_id;
    DEMO.comments = DEMO.comments.filter((c) => c.answer_id !== id);
    DEMO.answers = DEMO.answers.filter((x) => x.id !== id);
    DEMO.likes = DEMO.likes.filter((l) => !(l.target_type === 'answer' && l.target_id === id));
    const q = DEMO.questions.find((x) => x.id === qid);
    if (q) {
      q.answers_count = Math.max(0, (q.answers_count || 0) - 1);
      if (wasSolution) {
        // Удаление ответа-решения отменяет решение и таймер удаления вопроса
        q.status = 'open';
        q.solved_at = null;
        q.purge_at = null;
      }
    }
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('answers').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[answers] deleteAnswer:', e);
    throw e;
  }
}

/** Изменить свой комментарий. */
export async function updateComment(id, content) {
  if (IS_DEMO) {
    const c = DEMO.comments.find((x) => x.id === id);
    if (!c) throw new Error('Comment not found');
    c.content = content;
    c.edited_at = new Date().toISOString();
    persistDemo();
    return { ...c };
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('comments')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[comments] updateComment:', e);
    throw e;
  }
}

/** Удалить свой комментарий. */
export async function deleteComment(id) {
  if (IS_DEMO) {
    DEMO.comments = DEMO.comments.filter((c) => c.id !== id);
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('comments').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[comments] deleteComment:', e);
    throw e;
  }
}

// ---------- Лайки ----------
export async function toggleLike(targetType, targetId) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const idx = DEMO.likes.findIndex((l) => l.user_id === user.id && l.target_type === targetType && l.target_id === targetId);
    const table = targetType === 'question' ? DEMO.questions : DEMO.answers;
    const item = table.find((x) => x.id === targetId);
    if (idx >= 0) {
      DEMO.likes.splice(idx, 1);
      if (item) item.likes_count = Math.max(0, item.likes_count - 1);
      persistDemo();
      return { liked: false, likes_count: item?.likes_count ?? 0 };
    }
    DEMO.likes.push({ user_id: user.id, target_type: targetType, target_id: targetId });
    if (item) item.likes_count += 1;
    persistDemo();
    return { liked: true, likes_count: item?.likes_count ?? 0 };
  }
  try {
    const sb = await ensureClient();
    const { data: existing } = await sb.from('likes').select('id').eq('user_id', user.id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
    if (existing) {
      await sb.from('likes').delete().eq('id', existing.id);
    } else {
      await sb.from('likes').insert({ user_id: user.id, target_type: targetType, target_id: targetId });
    }
    const { count } = await sb.from('likes').select('id', { count: 'exact', head: true }).eq('target_type', targetType).eq('target_id', targetId);
    // likes_count в questions/answers обновляет триггер в БД (см. setup.sql) —
    // клиенту не нужны права на изменение чужих строк
    return { liked: !existing, likes_count: count };
  } catch (e) {
    console.error('[likes] toggleLike:', e);
    return null;
  }
}

export async function isLiked(targetType, targetId) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) return DEMO.likes.some((l) => l.user_id === user.id && l.target_type === targetType && l.target_id === targetId);
  try {
    const sb = await ensureClient();
    const { data } = await sb.from('likes').select('id').eq('user_id', user.id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
    return !!data;
  } catch { return false; }
}

// ---------- Избранное ----------
export async function fetchFavorites() {
  const { user } = getState();
  if (!user) return [];
  if (IS_DEMO) {
    return DEMO.favorites
      .filter((f) => f.user_id === user.id)
      .map((f) => {
        const q = DEMO.questions.find((x) => x.id === f.question_id);
        return q ? { ...f, question: demoQuestion(q) } : null;
      })
      .filter(Boolean);
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('favorites').select('*, questions(*)').eq('user_id', user.id);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[favorites] fetchFavorites:', e);
    return [];
  }
}

export async function setFavorite(questionId, on) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    const idx = DEMO.favorites.findIndex((f) => f.user_id === user.id && f.question_id === questionId);
    if (on && idx < 0) DEMO.favorites.push({ user_id: user.id, question_id: questionId, status: 'preparing', created_at: new Date().toISOString() });
    if (!on && idx >= 0) DEMO.favorites.splice(idx, 1);
    persistDemo();
    return on;
  }
  try {
    const sb = await ensureClient();
    if (on) await sb.from('favorites').upsert({ user_id: user.id, question_id: questionId, status: 'preparing' });
    else await sb.from('favorites').delete().eq('user_id', user.id).eq('question_id', questionId);
    return on;
  } catch (e) {
    console.error('[favorites] setFavorite:', e);
    return !on;
  }
}

export async function setFavoriteStatus(questionId, status) {
  const { user } = getState();
  if (!user) return;
  if (IS_DEMO) {
    const f = DEMO.favorites.find((x) => x.user_id === user.id && x.question_id === questionId);
    if (f) f.status = status;
    persistDemo();
    return;
  }
  try {
    const sb = await ensureClient();
    await sb.from('favorites').update({ status }).eq('user_id', user.id).eq('question_id', questionId);
  } catch (e) { console.error('[favorites] setFavoriteStatus:', e); }
}

export async function isInFavorites(questionId) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) return DEMO.favorites.some((f) => f.user_id === user.id && f.question_id === questionId);
  try {
    const sb = await ensureClient();
    const { data } = await sb.from('favorites').select('id').eq('user_id', user.id).eq('question_id', questionId).maybeSingle();
    return !!data;
  } catch { return false; }
}

// ---------- Хранилище файлов ----------

/**
 * Безопасное имя файла для Supabase Storage.
 * Хранилище отклоняет кириллицу, пробелы и спецсимволы («Invalid key»),
 * поэтому приводим имя к ASCII: «Снимок экрана 2025.png» → «2025.png».
 */
function safeFileName(name) {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // снимаем диакритику
    .replace(/[^\x20-\x7e]/g, '')      // только печатный ASCII (кириллица и т.п. удаляются)
    .replace(/[^a-zA-Z0-9._-]+/g, '_') // пробелы и спецсимволы → «_»
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'file';
}

export async function uploadAudio(file, folder = 'question-audio') {
  if (IS_DEMO) {
    // dataURL вместо blob URL — файл переживает перезагрузку страницы
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  try {
    const sb = await ensureClient();
    const path = `${getState().user?.id || 'anon'}/${uid()}_${safeFileName(file.name)}`;
    const { error } = await sb.storage.from(folder).upload(path, file);
    if (error) throw error;
    const { data } = sb.storage.from(folder).getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error('[storage] uploadAudio:', e);
    throw e;
  }
}

export async function uploadPreset(file) {
  return uploadAudio(file, 'presets');
}

/** Загрузка аватара: демо — dataURL, реальный режим — бакет avatars */
export async function uploadAvatar(file) {
  if (IS_DEMO) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  try {
    const sb = await ensureClient();
    const { user } = getState();
    const path = `${user.id}/avatar_${Date.now()}_${safeFileName(file.name)}`;
    const { error } = await sb.storage.from('avatars').upload(path, file, {
      upsert: true,
      contentType: file.type || 'image/png',
    });
    if (error) throw error;
    const { data } = sb.storage.from('avatars').getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error('[storage] uploadAvatar:', e);
    throw e;
  }
}

// ============================================================
// СООБЩЕНИЯ (+ Realtime)
// ============================================================

export async function fetchConversations() {
  const { user } = getState();
  if (!user) return [];
  if (IS_DEMO) {
    const byUser = DEMO.messages.filter((m) => m.sender_id === user.id || m.recipient_id === user.id);
    const map = new Map();
    byUser.forEach((m) => {
      const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
      const prev = map.get(otherId);
      if (!prev || new Date(m.created_at) > new Date(prev.created_at)) map.set(otherId, m);
    });
    return [...map.values()].map((m) => ({
      lastMessage: m,
      profile: DEMO.profiles.find((p) => p.id === (m.sender_id === user.id ? m.recipient_id : m.sender_id)),
      unread: DEMO.messages.filter((x) => x.sender_id !== user.id && x.recipient_id === user.id && !x.read && (m.sender_id === user.id ? x.sender_id === m.recipient_id : x.sender_id === m.sender_id)).length,
      online: m.recipient_id === 'u-anna', // демо-индикатор
    })).sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('messages').select('*').or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const map = new Map();
    (data || []).forEach((m) => {
      const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
      if (!map.has(otherId)) map.set(otherId, m);
    });
    const ids = [...map.keys()];
    const { data: profiles } = await sb.from('profiles').select('*').in('id', ids);
    return ids.map((id) => ({
      lastMessage: map.get(id),
      profile: (profiles || []).find((p) => p.id === id),
      unread: (data || []).filter((m) => m.sender_id === id && m.recipient_id === user.id && !m.read).length,
      online: false,
    }));
  } catch (e) {
    console.error('[messages] fetchConversations:', e);
    return [];
  }
}

export async function fetchThread(otherUserId) {
  const { user } = getState();
  if (!user) return [];
  if (IS_DEMO) {
    return DEMO.messages
      .filter((m) => (m.sender_id === user.id && m.recipient_id === otherUserId) || (m.sender_id === otherUserId && m.recipient_id === user.id))
      .map(demoMsg)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('messages').select('*')
      .or(`and(sender_id.eq.${user.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${user.id})`)
      .order('created_at', { ascending: true }).limit(200);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[messages] fetchThread:', e);
    return [];
  }
}

export async function sendMessage(recipientId, content, extra = {}) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const m = { id: uid('m-'), sender_id: user.id, recipient_id: recipientId, content, read: false, created_at: new Date().toISOString(), ...extra };
    DEMO.messages.push(m);
    persistDemo();
    return m;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('messages').insert({ sender_id: user.id, recipient_id: recipientId, content, ...extra }).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[messages] sendMessage:', e);
    throw e;
  }
}

/** Редактирование своего сообщения */
export async function updateMessage(messageId, content) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const m = DEMO.messages.find((x) => x.id === messageId && x.sender_id === user.id);
    if (!m) return null;
    m.content = content;
    m.edited_at = new Date().toISOString();
    persistDemo();
    return m;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', messageId).eq('sender_id', user.id).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[messages] updateMessage:', e);
    return null;
  }
}

/** Удаление своего сообщения */
export async function deleteMessage(messageId) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    const idx = DEMO.messages.findIndex((x) => x.id === messageId && x.sender_id === user.id);
    if (idx < 0) return false;
    DEMO.messages.splice(idx, 1);
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('messages').delete().eq('id', messageId).eq('sender_id', user.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[messages] deleteMessage:', e);
    return false;
  }
}

/** Реакция на сообщение: поставить/снять свою. Возвращает обновлённый список */
export async function toggleMessageReaction(messageId, emoji) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const m = DEMO.messages.find((x) => x.id === messageId);
    if (!m) return null;
    m.reactions = m.reactions || [];
    const idx = m.reactions.findIndex((r) => r.user_id === user.id && r.emoji === emoji);
    if (idx >= 0) m.reactions.splice(idx, 1);
    else m.reactions.push({ user_id: user.id, username: user.username || '?', emoji });
    persistDemo();
    return m.reactions;
  }
  try {
    const sb = await ensureClient();
    const { data: m } = await sb.from('messages').select('reactions').eq('id', messageId).maybeSingle();
    const reactions = m?.reactions || [];
    const idx = reactions.findIndex((r) => r.user_id === user.id && r.emoji === emoji);
    if (idx >= 0) reactions.splice(idx, 1);
    else reactions.push({ user_id: user.id, username: user.username || '', emoji });
    await sb.from('messages').update({ reactions }).eq('id', messageId);
    return reactions;
  } catch (e) {
    console.error('[messages] toggleReaction:', e);
    return null;
  }
}

/**
 * Канал индикатора «печатает…» (Realtime broadcast).
 * В демо — заглушка (индикатор эмулируется через subscribeMessages).
 */
export async function openTypingChannel(otherUserId, { onTyping }) {
  if (IS_DEMO) return { send: () => {}, close: () => {} };
  try {
    const sb = await ensureClient();
    const { user } = getState();
    const room = [user.id, otherUserId].sort().join('__');
    const channel = sb.channel(`typing_${room}`);
    channel.on('broadcast', { event: 'typing' }, (msg) => {
      const p = msg.payload || {};
      if (p.userId && p.userId !== user.id) onTyping({ id: p.userId, username: p.username || '' });
    }).subscribe();
    let lastSent = 0;
    return {
      // Не спамим: не чаще раза в 2 секунды
      send: () => {
        const now = Date.now();
        if (now - lastSent < 2000) return;
        lastSent = now;
        channel.send({ type: 'broadcast', event: 'typing', payload: { userId: user.id, username: user.username || '' } });
      },
      close: () => sb.removeChannel(channel),
    };
  } catch (e) {
    console.error('[messages] typing channel:', e);
    return { send: () => {}, close: () => {} };
  }
}

export async function markThreadRead(otherUserId) {
  const { user } = getState();
  if (!user) return;
  if (IS_DEMO) {
    DEMO.messages.forEach((m) => { if (m.sender_id === otherUserId && m.recipient_id === user.id) m.read = true; });
    persistDemo();
    return;
  }
  try {
    const sb = await ensureClient();
    await sb.from('messages').update({ read: true }).eq('sender_id', otherUserId).eq('recipient_id', user.id).eq('read', false);
  } catch (e) { console.error('[messages] markThreadRead:', e); }
}

/** Realtime-подписка на новые сообщения. Возвращает функцию отписки.
 *  onTyping — необязательный колбэк индикатора «печатает…» (демо-эмуляция). */
let demoIncoming = null; // общий отложенный входящий для всех подписчиков (демо)
export async function subscribeMessages(onMessage, onTyping = null) {
  if (IS_DEMO) {
    const { user } = getState();
    if (!user) return () => {};
    // Один общий таймер на всех подписчиков — без дублей сообщений
    if (!demoIncoming) {
      const delay = 12000 + Math.random() * 10000;
      demoIncoming = { callbacks: [], typingCallbacks: [] };
      demoIncoming.typingTimer = setTimeout(() => {
        (demoIncoming?.typingCallbacks || []).forEach((cb) => cb({ id: 'u-anna', username: 'AnnaSynth' }));
      }, Math.max(1000, delay - 3000));
      demoIncoming.timer = setTimeout(() => {
        const m = { id: uid('m-'), sender_id: 'u-anna', recipient_id: user.id, content: 'Кстати, попробуй random-модуляторы вместо LFO — звучит гораздо живее 😉', read: false, created_at: new Date().toISOString() };
        DEMO.messages.push(m);
        // В колокольчик сообщение не пишем — оно учтётся счётчиком
        // непрочитанных на иконке «Сообщения» (onIncomingMessage)
        persistDemo();
        const cbs = demoIncoming?.callbacks.slice() || [];
        demoIncoming = null;
        cbs.forEach((cb) => cb(m));
      }, delay);
    }
    demoIncoming.callbacks.push(onMessage);
    if (onTyping) demoIncoming.typingCallbacks.push(onTyping);
    return () => {
      if (!demoIncoming) return;
      demoIncoming.callbacks = demoIncoming.callbacks.filter((c) => c !== onMessage);
      demoIncoming.typingCallbacks = demoIncoming.typingCallbacks.filter((c) => c !== onTyping);
    };
  }
  try {
    const sb = await ensureClient();
    const { user } = getState();
    const channel = sb.channel('messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${user.id}` }, (payload) => onMessage(payload.new))
      .subscribe();
    return () => sb.removeChannel(channel);
  } catch (e) {
    console.error('[messages] subscribeMessages:', e);
    return () => {};
  }
}

// ============================================================
// ПРОФИЛИ
// ============================================================

export async function fetchProfile(userId) {
  if (IS_DEMO) {
    const { user } = getState();
    const p = DEMO.profiles.find((x) => x.id === userId) || (user?.id === userId ? user : null);
    if (!p) return null;
    const questions = DEMO.questions.filter((q) => q.user_id === userId).map(demoQuestion);
    const answers = DEMO.answers.filter((a) => a.user_id === userId)
      .map((a) => ({ ...a, question: DEMO.questions.find((q) => q.id === a.question_id) }));
    return {
      ...p,
      links: p.links || [],
      software: DEMO.software[userId] || [],
      skills: DEMO.skills[userId] || [],
      arsenal: DEMO.arsenal?.[userId] || [],
      stats: {
        questions: questions.length, // включает заглушки архивных — счётчик вечный
        answers: answers.length + (p.purged_answers_count || 0),
        likes: [...questions, ...answers].reduce((s, x) => s + (x.likes_count || 0), 0),
        rating: p.rating || 0,
        // Решения считаются навсегда: выданные награды (solutions_count)
        // + текущие ответы-решения, ещё не отмеченные наградами
        solutions: (p.solutions_count || 0) + answers.filter((a) => a.is_solution && !a.awarded_rep).length,
      },
      questions,
      answers,
    };
  }
  try {
    const sb = await ensureClient();
    // Все запросы параллельно — один раунд-трип вместо пяти последовательных
    const [
      { data: profile, error },
      { data: software },
      { data: skills },
      { data: arsenal },
      { data: questions },
      { data: answers },
    ] = await Promise.all([
      sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
      sb.from('user_software').select('software_name').eq('user_id', userId),
      sb.from('user_skills').select('skill_name').eq('user_id', userId),
      sb.from('user_arsenal').select('item_name').eq('user_id', userId),
      sb.from('questions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      sb.from('answers').select('*, questions(id, title, status)').eq('user_id', userId).order('created_at', { ascending: false }),
    ]);
    if (error) throw error;
    if (!profile) return null;
    const qList = questions || [];
    const aList = answers || [];
    const likes = [...qList, ...aList].reduce((s, x) => s + (x.likes_count || 0), 0);
    return {
      ...profile,
      links: profile.links || [],
      software: (software || []).map((s) => s.software_name),
      skills: (skills || []).map((s) => s.skill_name),
      arsenal: (arsenal || []).map((s) => s.item_name),
      stats: {
        questions: qList.length, // включает заглушки архивных — счётчик вечный
        answers: aList.length + (profile.purged_answers_count || 0),
        likes,
        rating: profile.rating || 0,
        solutions: (profile.solutions_count || 0) + aList.filter((a) => a.is_solution && !a.awarded_rep).length,
      },
      questions: qList,
      answers: aList.map((a) => ({ ...a, question: a.questions || a.question })),
    };
  } catch (e) {
    console.error('[profile] fetchProfile:', e);
    return null;
  }
}

export async function updateProfile(patch) {
  const { user } = getState();
  if (!user) return;
  if (IS_DEMO) {
    Object.assign(user, patch);
    const p = DEMO.profiles.find((x) => x.id === user.id);
    if (p) Object.assign(p, patch);
    if (patch.software) DEMO.software[user.id] = patch.software;
    if (patch.skills) DEMO.skills[user.id] = patch.skills;
    if (patch.arsenal) DEMO.arsenal[user.id] = patch.arsenal;
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    persistDemo();
    return;
  }
  try {
    const sb = await ensureClient();
    const { software, skills, ...profileFields } = patch;
    await sb.from('profiles').update(profileFields).eq('id', user.id);
    invalidateProfileCache(user.id); // профиль изменился — сбрасываем кэш
    if (software) {
      await sb.from('user_software').delete().eq('user_id', user.id);
      if (software.length) await sb.from('user_software').insert(software.map((s) => ({ user_id: user.id, software_name: s })));
    }
    if (skills) {
      await sb.from('user_skills').delete().eq('user_id', user.id);
      if (skills.length) await sb.from('user_skills').insert(skills.map((s) => ({ user_id: user.id, skill_name: s })));
    }
    if (patch.arsenal) {
      await sb.from('user_arsenal').delete().eq('user_id', user.id);
      if (patch.arsenal.length) await sb.from('user_arsenal').insert(patch.arsenal.map((s) => ({ user_id: user.id, item_name: s })));
    }
  } catch (e) {
    console.error('[profile] updateProfile:', e);
    throw e;
  }
}

export async function fetchQuestionsByUser(userId) {
  if (IS_DEMO) return DEMO.questions.filter((q) => q.user_id === userId).map(demoQuestion);
  try {
    const sb = await ensureClient();
    const { data } = await sb.from('questions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

export async function fetchAnswersByUser(userId) {
  if (IS_DEMO) {
    return DEMO.answers.filter((a) => a.user_id === userId)
      .map((a) => ({ ...a, question: DEMO.questions.find((q) => q.id === a.question_id) }));
  }
  try {
    const sb = await ensureClient();
    const { data } = await sb.from('answers').select('*, questions(*)').eq('user_id', userId).order('created_at', { ascending: false });
    return data || [];
  } catch { return []; }
}

// ============================================================
// ШОУКЕЙС «МОЁ ЗВУЧАНИЕ» (до 3 треков в профиле)
// ============================================================

function demoShowcase(s) {
  if (s.audio_url) return s;
  const audio = getDemoAudio(s.audio_kind || 'lead', s.id.charCodeAt(2) || 3);
  return { ...s, audio_url: audio.url, waveform_data: audio.peaks };
}

export async function fetchShowcase(userId) {
  if (IS_DEMO) {
    return (DEMO.showcase || []).filter((s) => s.user_id === userId).map(demoShowcase);
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('user_showcase').select('*').eq('user_id', userId).order('created_at');
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[showcase] fetch:', e);
    return [];
  }
}

export async function addShowcaseTrack({ title, audio_url, waveform_data }) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const row = { id: uid('sh-'), user_id: user.id, title, audio_url, waveform_data, created_at: new Date().toISOString() };
    DEMO.showcase = DEMO.showcase || [];
    DEMO.showcase.push(row);
    persistDemo();
    return row;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('user_showcase').insert({ user_id: user.id, title, audio_url, waveform_data }).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[showcase] add:', e);
    throw e;
  }
}

export async function deleteShowcaseTrack(id) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    const before = (DEMO.showcase || []).length;
    DEMO.showcase = (DEMO.showcase || []).filter((s) => !(s.id === id && s.user_id === user.id));
    persistDemo();
    return DEMO.showcase.length < before;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('user_showcase').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[showcase] delete:', e);
    return false;
  }
}

// ============================================================
// ДОНАТЫ / ПОДДЕРЖКА (recipient_user_id = null → поддержка проекта)
// Сейчас статус 'intent' (намерение): реальные платежи включаются
// флагом CONFIG.ENABLE_DONATIONS и провайдером на этапе монетизации.
// ============================================================

export async function fetchSupportCount(recipientUserId) {
  if (IS_DEMO) {
    return (DEMO.donations || []).filter((d) =>
      recipientUserId === null ? d.recipient_user_id === null : d.recipient_user_id === recipientUserId
    ).length;
  }
  try {
    const sb = await ensureClient();
    let q = sb.from('donations').select('id', { count: 'exact', head: true });
    q = recipientUserId === null ? q.is('recipient_user_id', null) : q.eq('recipient_user_id', recipientUserId);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  } catch (e) {
    console.error('[support] count:', e);
    return 0;
  }
}

export async function recordDonation({ recipient_user_id = null, amount, currency, message = '' }) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const row = { id: uid('d-'), donor_id: user.id, recipient_user_id, amount, currency, message, status: 'intent', created_at: new Date().toISOString() };
    DEMO.donations = DEMO.donations || [];
    DEMO.donations.push(row);
    persistDemo();
    return row;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('donations').insert({ donor_id: user.id, recipient_user_id, amount, currency, message, status: 'intent' }).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[support] recordDonation:', e);
    return null;
  }
}

// ============================================================
// УВЕДОМЛЕНИЯ (+ Realtime)
// ============================================================

export async function fetchNotifications() {
  const { user } = getState();
  if (!user) return [];
  // 'message'-уведомления больше не показываются (ни старые, ни новые):
  // личные сообщения живут в разделе «Сообщения» со своим счётчиком
  if (IS_DEMO) return DEMO.notifications.filter((n) => n.user_id === user.id && n.type !== 'message').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    return (data || []).filter((n) => n.type !== 'message');
  } catch (e) {
    console.error('[notifications] fetchNotifications:', e);
    return [];
  }
}

export async function markAllNotificationsRead() {
  const { user } = getState();
  if (!user) return;
  if (IS_DEMO) {
    DEMO.notifications.forEach((n) => { if (n.user_id === user.id) n.read = true; });
    persistDemo();
    return;
  }
  try {
    const sb = await ensureClient();
    await sb.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
  } catch (e) { console.error('[notifications] markAllRead:', e); }
}

export async function subscribeNotifications(onNotification) {
  if (IS_DEMO) return () => {};
  try {
    const sb = await ensureClient();
    const { user } = getState();
    const channel = sb.channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => onNotification(payload.new))
      .subscribe();
    return () => sb.removeChannel(channel);
  } catch (e) {
    console.error('[notifications] subscribe:', e);
    return () => {};
  }
}

// ============================================================
// ПОДПИСКИ (авторы / теги)
// ============================================================

export async function fetchSubscriptions() {
  const { user } = getState();
  if (!user) return [];
  if (IS_DEMO) return DEMO.subscriptions.filter((s) => s.user_id === user.id);
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('subscriptions').select('*').eq('user_id', user.id);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[subscriptions] fetch:', e);
    return [];
  }
}

export async function toggleSubscription(targetType, targetId) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    const idx = DEMO.subscriptions.findIndex((s) => s.user_id === user.id && s.target_type === targetType && s.target_id === targetId);
    if (idx >= 0) { DEMO.subscriptions.splice(idx, 1); persistDemo(); return false; }
    DEMO.subscriptions.push({ user_id: user.id, target_type: targetType, target_id: targetId });
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { data: existing } = await sb.from('subscriptions').select('id').eq('user_id', user.id).eq('target_type', targetType).eq('target_id', targetId).maybeSingle();
    if (existing) { await sb.from('subscriptions').delete().eq('id', existing.id); return false; }
    await sb.from('subscriptions').insert({ user_id: user.id, target_type: targetType, target_id: targetId });
    return true;
  } catch (e) {
    console.error('[subscriptions] toggle:', e);
    return false;
  }
}

// ============================================================
// ДОСТИЖЕНИЯ
// ============================================================

export async function fetchAchievements(userId) {
  if (IS_DEMO) return DEMO.achievements.filter((a) => a.user_id === userId).map((a) => a.achievement_type);
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('achievements').select('achievement_type').eq('user_id', userId);
    if (error) throw error;
    return (data || []).map((a) => a.achievement_type);
  } catch (e) {
    console.error('[achievements] fetch:', e);
    return [];
  }
}

export async function awardAchievement(achievementType) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    if (DEMO.achievements.some((a) => a.user_id === user.id && a.achievement_type === achievementType)) return false;
    DEMO.achievements.push({ user_id: user.id, achievement_type: achievementType, earned_at: new Date().toISOString() });
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('achievements').insert({ user_id: user.id, achievement_type: achievementType });
    if (error) {
      if (error.code === '23505') return false; // уже получено
      throw error;
    }
    return true;
  } catch (e) {
    console.error('[achievements] award:', e);
    return false;
  }
}