// ============================================================
// supabase.mjs — клиент Supabase + слой доступа к данным.
// Если ключи в config.mjs не заданы — работает DEMO-режим:
// моковые данные в памяти + процедурно генерируемое аудио (WAV),
// вейвформа которого соответствует реальным пикам семпла.
// ============================================================

import { CONFIG, IS_DEMO } from './config.mjs';
import { getState } from './store.mjs';
import { uid } from './utils.mjs';
// Чистый модуль без обратных зависимостей (i18n + utils): нормализация
// записей контакта нужна и здесь — в getProfile обоих режимов.
import { normalizeContacts } from './contacts.mjs';
// Правила способов приёма (СБП/карта) — чистый модуль без импортов:
// нормализация нужна уже в migrateDemo на старте (цикл с support.mjs недопустим)
import { normalizeDonateMethods } from './donate.mjs';

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

// QR-коды СБП для демо-сидов (сгенерированы офлайн библиотекой qrcode,
// настоящие сканируемые картинки: payload → https://qr.nspk.ru/…):
// автор «загрузил» их из приложения банка, как в боевом сценарии
const QR_IMG_ANNA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAFACAYAAADNkKWqAAAAAklEQVR4AewaftIAAAhFSURBVO3BgW0dCw4EwR7i5Z/ynBPwB41beyWxq9JfkKSDBkk6apCkowZJOmqQpKMGSTpqkKSjBkk6apCkowZJOmqQpKM+/IEk6Pfa8tUlYastG0nYaMvTkrDRlrckYastG0nQ77VlY5CkowZJOmqQpKMGSTpqkKSjBkk6apCkowZJOmqQpKM+/AVt+UmS8KQkbLVlIwkbbdlKwlfXlo0kbLXlp2jLT5KEJw2SdNQgSUcNknTUIElHDZJ01CBJRw2SdNQgSUcNknTUhxcl4S1teUtbtpKw0ZaNJLwlCVtt2UjCRlv035Lwlra8YZCkowZJOmqQpKMGSTpqkKSjBkk6apCkowZJOmqQpKMGSTrqg05py3eQhI22bCRhqy0bSdD3NkjSUYMkHTVI0lGDJB01SNJRgyQdNUjSUYMkHTVI0lEf9M8lYastT0rCVluelISnJeFpSdhoi763QZKOGiTpqEGSjhok6ahBko4aJOmoQZKOGiTpqEGSjvrworZc1Ja3tGUrCU9qy0+ShI22fAdtuWaQpKMGSTpqkKSjBkk6apCkowZJOmqQpKMGSTpqkKSjBkk66sNfkAT9XhK22rKRhI22PK0tG0nYastGEjbaspWEjbZsJGGrLU9Kgn5vkKSjBkk6apCkowZJOmqQpKMGSTpqkKSjBkk6apCko9Jf0BlJ2GrLRhKe1paNJDytLRtJeFpb9O8MknTUIElHDZJ01CBJRw2SdNQgSUcNknTUIElHDZJ01Ic/kISNtmwkYastG0nYaMtWEjba8rQkfHVt2UjCVhI22vK0JDypLd9BEjba8rQkbLTlSYMkHTVI0lGDJB01SNJRgyQdNUjSUYMkHTVI0lGDJB01SNJRH76JJGy05Wlt2UjC09qi/18SfpIkbLRlqy0bSdhoy1ZbNpKw0ZaNQZKOGiTpqEGSjhok6ahBko4aJOmoQZKOGiTpqEGSjvrworZ8B0n46pKw0ZatJGy05atry1YS9Htt2UjCVzdI0lGDJB01SNJRgyQdNUjSUYMkHTVI0lGDJB01SNJRH/5AW766JGy0Zastb0nCRls2kvC0JHx1SXhaWzaSsNWWtyRhoy0bbdlKwkZbnjRI0lGDJB01SNJRgyQdNUjSUYMkHTVI0lGDJB01SNJRgyQdlf7CS5Kg/9aWjSRstOUtSdhqy1uS8FO05WlJ2GjLVhKe1JaNQZKOGiTpqEGSjhok6ahBko4aJOmoQZKOGiTpqEGSjvrwB5LwlrZsJGGjLd9BEp6UhLe05Sdpy0YSttqykYSfpC0bSXjSIElHDZJ01CBJRw2SdNQgSUcNknTUIElHDZJ01CBJR334C9rylrZsJOE7aMuTkrDVliclYastb2mL/q0kvGGQpKMGSTpqkKSjBkk6apCkowZJOmqQpKMGSTpqkKSjBkk66sMfaMtbkrDRlo22fAdJeFJbnpaEjbZsJWGjLRtJ2GrLRhI22rKVhI22PC0JX11bnjRI0lGDJB01SNJRgyQdNUjSUYMkHTVI0lGDJB01SNJR6S88LAkbbdlKwpPaspWEt7RlIwlPa8uTkvC0tmwk4Wlt2UjCW9rytCRstGUrCU9qy8YgSUcNknTUIElHDZJ01CBJRw2SdNQgSUcNknTUIElHffgL2rKRhO+gLRtJ+OraspWEjbZstOU7aMuT2rKVhCclYastT0rCVls2kvCkQZKOGiTpqEGSjhok6ahBko4aJOmoQZKOGiTpqEGSjhok6agPfyAJG2356pLwtLb8JG3ZSMJGW7aSsNGWjbZsJWGjLU9ry1fXlqcl4Q2DJB01SNJRgyQdNUjSUYMkHTVI0lGDJB01SNJRgyQd9eEPtGUjCRtt2UrCk9rytCQ8rS1fXVu+uiRstWUjCU9ry0YSntaWjSRstOVpbXnSIElHDZJ01CBJRw2SdNQgSUcNknTUIElHDZJ01CBJR6W/sJSEjbZ8dUl4Wls2kvCWtmwlYaMtP0kSNtqykYSfpC0/xSBJRw2SdNQgSUcNknTUIElHDZJ01CBJRw2SdNQgSUcNknTUhz/Qlp+iLd9BW56UhK22bCRhoy1vScJWW97Slrck4UlJeEtbNgZJOmqQpKMGSTpqkKSjBkk6apCkowZJOmqQpKMGSTrqwx9Ign6vLRtt+UnaspGEp7Vloy1bSfjqkrDRlqclYaMtW0l4wyBJRw2SdNQgSUcNknTUIElHDZJ01CBJRw2SdNQgSUd9+Ava8pMk4atLwtOS8Ja2bCThaW15UhKe1hb9/wZJOmqQpKMGSTpqkKSjBkk6apCkowZJOmqQpKMGSTpqkKSjPrwoCW9py1uSsNWWjbZsJGGrLU9KwlYSNtrytCRstOVpSfjq2vK0tmwk4UmDJB01SNJRgyQdNUjSUYMkHTVI0lGDJB01SNJRgyQd9UH/XFu2krDRlo22bCXhorZsJOEtbXlaEp6UhK22bLTlSYMkHTVI0lGDJB01SNJRgyQdNUjSUYMkHTVI0lGDJB31Qf9cErba8qQkbLXlLUnYSMJb2rKRhK22PCkJT0vCRlueloSNtmwMknTUIElHDZJ01CBJRw2SdNQgSUcNknTUIElHDZJ01CBJR314UVsuastb2rKVhIva8tUlYaMt30ESNtrypEGSjhok6ahBko4aJOmoQZKOGiTpqEGSjhok6ahBko768BckQb+XhK22bCRhoy1Pa8tGErbaspGEjbZsJeGra8vTkvCktjwtCRtt2Rgk6ahBko4aJOmoQZKOGiTpqEGSjhok6ahBko4aJOmo9Bck6aBBko4aJOmoQZKOGiTpqEGSjhok6ahBko4aJOmoQZKO+h9ZMGl3AwoSEAAAAABJRU5ErkJggg==';
const QR_IMG_MAX = 'data:image/png;base64,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';

const DEMO = {
  profiles: [
    { id: 'u-anna', username: 'AnnaSynth', contact: [{ kind: 'telegram', value: '@annasynth', label: '', visibility: 'members' }, { kind: 'email', value: 'anna@nullsea.ru', label: 'по работе', visibility: 'members' }], contact_consent: true, donate_methods: [{ kind: 'qr', value: 'https://qr.nspk.ru/DEMOANNA0001?crc=A1B2', qr_data_url: QR_IMG_ANNA, label: 'Сбербанк' }, { kind: 'boosty', value: 'https://boosty.to/annasynth', label: '' }], avatar_url: null, bio: 'Саунд-дизайнер. Обожаю FM-синтез и странные пэды. Пишу ambient под псевдонимом NULLSEA.', links: [{ platform: 'instagram', url: 'https://instagram.com/annasynth' }, { platform: 'youtube', url: 'https://youtube.com/@annasynth' }, { platform: 'soundcloud', url: 'https://soundcloud.com/annasynth' }, { platform: 'bandcamp', url: 'https://nullsea.bandcamp.com' }], rating: 1240, solutions_count: 1, open_to_collab: true },
    { id: 'u-max', username: 'MaxWavetable', contact: [{ kind: 'telegram', value: '@maxwavetable', label: '', visibility: 'members' }, { kind: 'phone', value: '+7 911 444-55-66', label: 'звонить после 18:00', visibility: 'members' }], contact_consent: true, donate_methods: [{ kind: 'qr', value: 'https://qr.nspk.ru/DEMOMAX0002?crc=C3D4', qr_data_url: QR_IMG_MAX, label: 'Т-Банк' }], avatar_url: null, bio: 'Serum-маньяк. 300+ пресетов, 12 паков. Учу людей делать жирные басы.', links: [{ platform: 'youtube', url: 'https://youtube.com/@maxwavetable' }, { platform: 'spotify', url: 'https://open.spotify.com/artist/maxwavetable' }], rating: 2110, solutions_count: 1, open_to_collab: true },
    { id: 'u-lena', username: 'LenaFX', contact: [{ kind: 'discord', value: 'lenafx', label: '', visibility: 'members' }, { kind: 'website', value: 'https://lenafx.ru', label: 'портфолио и прайс', visibility: 'members' }], contact_consent: true, donate_methods: [], avatar_url: null, bio: 'FX-дизайнер для игр и трейлеров. Phase Plant — мой главный инструмент.', links: [{ platform: 'soundcloud', url: 'https://soundcloud.com/lenafx' }], rating: 870, donate_methods: [{ kind: 'boosty', value: 'https://boosty.to/lenafx', label: '' }] },
    { id: 'u-demo', username: 'DemoUser', contact: [], contact_consent: false, donate_methods: [], avatar_url: null, bio: 'Это ваш демо-профиль. Заполните его в онбординге!', links: [], rating: 0, is_admin: true },
  ],
  software: {
    'u-anna': ['Ableton Live', 'Reaper'],
    'u-max': ['FL Studio'],
    'u-lena': ['Reaper', 'Cubase'],
    'u-demo': [],
  },
  arsenal: {
    'u-anna': ['Serum', 'Phase Plant', 'Valhalla DSP'],
    'u-max': ['Serum', 'Massive X', 'FabFilter Pro-Q 3'],
    'u-lena': ['Phase Plant', 'Kontakt', 'Soundtoys'],
    'u-demo': [],
  },
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
  // Жалобы: две новые (видно на экране «Модерация» демо-админа u-demo)
  // и одна отклонённая — для вкладки «Все»
  reports: [
    { id: 'r1', reporter_id: 'u-max', target_type: 'question', target_id: 'q3', reason: 'spam', note: 'В описании ссылка на телеграм-канал с «бесплатными пресетами»', status: 'new', moderator_note: '', created_at: daysAgo(0.4), resolved_at: null },
    { id: 'r2', reporter_id: 'u-anna', target_type: 'answer', target_id: 'a5', reason: 'other', note: 'Ответ-самореклама без полезной информации', status: 'new', moderator_note: '', created_at: daysAgo(0.1), resolved_at: null },
    { id: 'r3', reporter_id: 'u-max', target_type: 'comment', target_id: 'c3', reason: 'offense', note: '', status: 'dismissed', moderator_note: 'Нарушений не найдено', created_at: daysAgo(0.9), resolved_at: daysAgo(0.8) },
  ],
  // Заход 38: «💡 Идеи» — сиды из РЕАЛЬНОГО бэклога продукта, чтобы окно не
  // выглядело мёртвым до запуска; статусы показывают весь жизненный цикл
  ideas: [
    { id: 'i1', author_id: 'u-max', title: 'Паритет чипов подписки во всех списках', body: 'Чипы подписки на теги сейчас живут в ленте и ответах. Хотите их же в шапке вопроса, в списках профиля и избранного — чтобы подписка была досягаема откуда угодно.', status: 'new', dev_reply: '', dev_reply_at: null, created_at: daysAgo(2.2) },
    { id: 'i2', author_id: 'u-anna', title: 'Квота демо-базы и экспорт в файл', body: 'LocalStorage переполняется молча: хочется индикатор занятости и экспорт/импорт своего демо-контента в файл, чтобы не терять вопросы и ответы.', status: 'in_work', dev_reply: 'Взято в работу: квота и переезд демо-базы в IndexedDB готовятся к следующим заходам.', dev_reply_at: daysAgo(1.1), created_at: daysAgo(5) },
    { id: 'i3', author_id: 'u-lena', title: 'Форма DMCA-жалобы для правообладателей', body: 'Сейчас о нарушении прав можно сообщить только жалобой «копирайт». Нужна отдельная форма для правообладателей со статусом рассмотрения.', status: 'done', dev_reply: 'Реализовано в контуре Этапа 3: DMCA-процесс описан в Terms, форма добавлена в модерацию.', dev_reply_at: daysAgo(0.4), created_at: daysAgo(9) },
    { id: 'i4', author_id: 'u-max', title: 'Светлая тема оформления', body: 'Тёмная тема красивая, но днём в студии хочется светлый режим с переключателем в настройках.', status: 'rejected', dev_reply: 'Спасибо, но не сейчас: до запуска приоритеты — РСЯ и 152-ФЗ. Тема вернётся в бэклог после запуска.', dev_reply_at: daysAgo(0.2), created_at: daysAgo(7) },
  ],
  idea_votes: [
    { idea_id: 'i1', user_id: 'u-anna', created_at: daysAgo(2) },
    { idea_id: 'i1', user_id: 'u-lena', created_at: daysAgo(1.5) },
    { idea_id: 'i2', user_id: 'u-max', created_at: daysAgo(4) },
    { idea_id: 'i3', user_id: 'u-anna', created_at: daysAgo(8) },
    { idea_id: 'i3', user_id: 'u-max', created_at: daysAgo(8) },
    { idea_id: 'i3', user_id: 'u-lena', created_at: daysAgo(7) },
  ],
  likes: [],
  favorites: [],
  messages: [
    { id: 'm1', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'Привет! Видела твой вопрос про пэды — готовлю подробный ответ 😉', read: true, created_at: daysAgo(1) },
    { id: 'm2', sender_id: 'u-demo', recipient_id: 'u-anna', content: 'Привет! Буду очень ждать, спасибо!', read: true, created_at: daysAgo(0.9) },
    { id: 'm3', sender_id: 'u-anna', recipient_id: 'u-demo', content: 'Кстати, попробуй random-модуляторы вместо LFO — я про это в ответе писала.', read: false, reactions: [{ user_id: 'u-demo', username: 'DemoUser', emoji: '🔥' }], created_at: daysAgo(0.2) },
    { id: 'm4', sender_id: 'u-max', recipient_id: 'u-demo', content: 'Здарова! Если нужны пресеты для Serum — пиши, у меня их сотни.', read: false, created_at: daysAgo(0.1) },
    { id: 'm5', sender_id: 'u-anna', recipient_id: 'u-demo', content: '', ref: { type: 'answer', id: 'a3' }, read: false, created_at: daysAgo(0.03) },
    { id: 'm6', sender_id: 'u-max', recipient_id: 'u-demo', content: 'Глянь, я сам своему вопросу ответил — вдруг пригодится.', ref: { type: 'question', id: 'q4' }, read: true, created_at: daysAgo(0.02) },
  ],
  notifications: [
    { id: 'n1', user_id: 'u-demo', type: 'answer', payload: { questionTitle: 'Тёплый эволюционирующий пэд — как повторить?', by: 'LenaFX', questionId: 'q2', answerId: 'a3' }, read: false, created_at: daysAgo(1.5) },
    { id: 'n2', user_id: 'u-demo', type: 'like', payload: { by: 'MaxWavetable', targetKey: 'notifications.target_answer', questionId: 'q1' }, read: false, created_at: daysAgo(0.8) },
    // Уведомлений типа 'message' больше нет: личные сообщения показываются
    // счётчиком непрочитанных на иконке «Сообщения» (см. notifications.mjs)
  ],
  achievements: [],
  subscriptions: [
    { user_id: 'u-demo', target_type: 'author', target_id: 'u-anna' },
  ],
  donations: [
    { id: 'd1', donor_id: 'u-max', recipient_user_id: 'u-anna', amount: 300, currency: 'RUB', message: 'За эволюционирующий пэд!', status: 'intent', kind: 'paid', created_at: daysAgo(3) },
    { id: 'd2', donor_id: 'u-lena', recipient_user_id: 'u-anna', amount: 5, currency: 'USD', message: 'Спасибо за разбор FM', status: 'intent', kind: 'thanks', amount: 0, currency: 'RUB', created_at: daysAgo(2) },
    { id: 'd3', donor_id: 'u-anna', recipient_user_id: 'u-max', amount: 1000, currency: 'RUB', message: 'Growl-бас спас мой трек', status: 'intent', kind: 'paid', created_at: daysAgo(1) },
    { id: 'd4', donor_id: 'u-max', recipient_user_id: null, amount: 500, currency: 'RUB', message: 'На развитие платформы!', status: 'intent', kind: 'paid', created_at: daysAgo(4) },
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
// Все пользовательские изменения (аватар, био, ссылки, DAW, контакты,
// вопросы, ответы, комментарии, лайки, избранное, сообщения,
// уведомления, достижения, подписки) сохраняются в LocalStorage
// и восстанавливаются после перезагрузки страницы.
// ============================================================
const DEMO_DB_KEY = 'samplehelp_demo_db';
export const DEMO_DB_VERSION = 16; // v16: 2026-10-14 заход 47 — сиды уведомлений answer/like с questionId/targetKey (клик живёт из коробки); v15: 2026-10-14 заход 38 — коллекции ideas/idea_votes (пользовательские идеи переносятся миграцией); v14: миграция не переносит donate_methods СИДОВЫХ профилей (кроме «своего»): сиды-авторы освежаются из свежих сидов; v13: гарантийное освежение сидов после «смешанной» копии; v12: Boosty вторым каналом
const DEMO_PERSIST_KEYS = [
  'profiles', 'software', 'arsenal', 'questions', 'answers', 'comments', 'reports',
  'likes', 'favorites', 'messages', 'notifications', 'achievements', 'subscriptions', 'donations',
  'ideas', 'idea_votes', // заход 38: идеи и голоса переживают пересид
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

// По строки профиля, которые пользователь менял сам (updateProfile /
// «Настройки профиля») — именно их переносим при мягком пересиде, чтобы
// смена DEMO_DB_VERSION не сбрасывала аватар и настройки (баг 2026-10-11:
// шапка показывала аватар из сессии, а профиль — пересозданный пустой).
const DEMO_MIGRATE_PROFILE_FIELDS = [
  'username', 'bio', 'avatar_url', 'links', 'open_to_collab', 'cover_style',
  'donate_methods', // способы приёма («Поддержать автора»: СБП + карта) — пользовательские
  'contact',         // контакты: [{ kind, value, label, visibility }] — видны по бейджу «Открыт к коллаборациям»
  'contact_consent', // согласие на показ контактов участникам (152-ФЗ)
];

// Ключ сессии демо-входа. Объявлен ДО loadDemo()/migrateDemo(): миграция читает
// «свой» id из сессии, а loadDemo() вызывается при вычислении модуля (TDZ-ловушка).
const DEMO_SESSION_KEY = 'samplehelp_demo_session';
// Заход 46: реестр демо-аккаунтов «почта → профиль»: вход/регистрация/OAuth в
// демо ведут себя как настоящие аккаунты внутри браузера (новая почта = чистый
// профиль). Старая сессия u-demo продолжает работать без записи в реестре.
const DEMO_ACCOUNTS_KEY = 'samplehelp_demo_accounts';

let demoReseedNotice = null; // { from, to } — одноразово для тоста после старта

/** Одноразовое уведомление для UI: демо-база пересоздана (после чтения — null) */
export function takeDemoReseedNotice() {
  const n = demoReseedNotice;
  demoReseedNotice = null;
  return n;
}

/**
 * Консистентность сессии и демо-базы: сессия свежее базы (базу могли пересоздать
 * при смене версии сидов) — переносим пользовательские поля из сессии в строку
 * профиля, чтобы шапка и страница профиля показывали ОДИН аватар и настройки.
 */
/**
 * Заход 43: демо-переключатель ролей «разработчик / пользователь».
 * Меняет is_admin у строки демо-профиля и в сессии; бой — no-op.
 * Возвращает обновлённый объект user (для setState) или null.
 */
export function setDemoRole(isAdmin) {
  if (!IS_DEMO) return null;
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem(DEMO_SESSION_KEY) || 'null'); } catch { sess = null; }
  const id = sess?.id || 'u-demo';
  const row = DEMO.profiles.find((x) => x.id === id);
  if (!row) return null;
  row.is_admin = !!isAdmin;
  invalidateProfileCache(id);
  const user = { ...(sess || row), id, is_admin: !!isAdmin };
  localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
  persistDemo();
  return user;
}

export function syncDemoProfileFromSession(user) {
  if (!IS_DEMO || !user) return;
  const row = DEMO.profiles.find((p) => p.id === user.id);
  if (!row) return;
  let touched = false;
  for (const f of DEMO_MIGRATE_PROFILE_FIELDS) {
    if (user[f] !== undefined && row[f] !== user[f]) { row[f] = user[f]; touched = true; }
  }
  if (touched) persistDemo();
}

/**
 * Мягкий пересид: пользовательские данные из старого снапшота → поверх новых сидов.
 *
 * v9 (фикс бага 2026-10-11 — у заказчика пропал созданный вопрос после
 * перезагрузки): раньше переносились ТОЛЬКО поля профилей и словари, а весь
 * пользовательский контент (вопросы, ответы, комментарии, сообщения, лайки,
 * избранное, уведомления, достижения, подписки, донаты, жалобы) выбрасывался
 * и пересоздавался из сидов. Теперь пользовательские записи — всё, чего нет
 * в сидах по id, — добавляются к новым сидам, после чего чистятся «висяки»
 * (ссылки на исчезнувший демо-контент) и корректируются счётчики.
 *
 * Профили из снапшота НОВЫМИ строками не переносятся: иначе вопросы повисли
 * бы на «призрачных» авторах. Вопрос без известного автора рендер показывает
 * как «Участник» (существующий фолбэк demoQuestion → author: null).
 */
function migrateDemo(saved) {
  // Сиды ещё не тронуты — пользовательская запись = та, чьего id нет в сидах
  const seedIds = new Set(DEMO.profiles.map((p) => p.id));
  // «Свой» демо-профиль (тот, под кем сидит сессия) — единственный из сидов,
  // чьи способы приёма являются НАСТРОЙКОЙ пользователя и переносятся.
  // Остальные сиды-авторы — витрина демо: их donate_methods берутся из СВЕЖИХ
  // сидов (v14), иначе снапшот эпохи sbp/card после normalize оставлял автора
  // «без способов» навсегда (скриншот заказчика 2026-10-14).
  let selfId = null;
  try { selfId = JSON.parse(localStorage.getItem(DEMO_SESSION_KEY) || 'null')?.id || null; } catch { /* ignore */ }
  for (const sp of saved.profiles || []) {
    if (!seedIds.has(sp.id)) continue;
    const target = DEMO.profiles.find((p) => p.id === sp.id);
    for (const f of DEMO_MIGRATE_PROFILE_FIELDS) {
      if (f === 'donate_methods' && sp.id !== selfId) continue; // витрина: свежий сид
      if (sp[f] !== undefined) target[f] = sp[f];
    }
    // v9: способы приёма — только СБП и карта; устаревшие виды (ЮMoney,
    // Boosty, крипта… из снапшотов v≤8) отфильтровываются
    target.donate_methods = normalizeDonateMethods(target.donate_methods);
  }
  // Словари пользователя (DAW / арсенал) — целиком пользовательские
  for (const key of ['software', 'arsenal']) {
    if (!saved[key]) continue;
    for (const uid of Object.keys(saved[key])) {
      if (seedIds.has(uid)) DEMO[key][uid] = saved[key][uid];
    }
  }

  // ---------- Перенос пользовательского контента (v9) ----------
  const seedQ = new Set(DEMO.questions.map((x) => x.id));
  const seedA = new Set(DEMO.answers.map((x) => x.id));
  const seedIdsOf = (arr) => new Set((arr || []).map((x) => x.id));
  const seedC = seedIdsOf(DEMO.comments);
  const seedR = seedIdsOf(DEMO.reports);
  const seedM = seedIdsOf(DEMO.messages);
  const seedN = seedIdsOf(DEMO.notifications);
  const seedD = seedIdsOf(DEMO.donations);
  const subKey = (s) => `${s.user_id}|${s.target_type}|${s.target_id}`;
  const seedSub = new Set((DEMO.subscriptions || []).map(subKey));

  const carry = (key, seedSet) => {
    for (const row of saved[key] || []) {
      if (row && !seedSet.has(row.id)) DEMO[key].push(row);
    }
  };
  carry('questions', seedQ); // перенесённые — после сидов; лента всё равно сортирует по created_at
  carry('answers', seedA);
  carry('comments', seedC);
  carry('reports', seedR);     // жалобы пользователя — тоже пользовательский контент
  carry('messages', seedM);
  carry('notifications', seedN);
  carry('donations', seedD);
  // заход 38: пользовательские идеи и голоса переживают пересид (урок захода 20)
  carry('ideas', seedIdsOf(DEMO.ideas));
  for (const v of saved.idea_votes || []) {
    if (v && !DEMO.idea_votes.some((x) => x.idea_id === v.idea_id && x.user_id === v.user_id)) DEMO.idea_votes.push(v);
  }
  // Лайки/избранное/достижения в сидах пусты и без id — переносим все, с дедупом
  for (const l of saved.likes || []) {
    if (!DEMO.likes.some((x) => x.user_id === l.user_id && x.target_type === l.target_type && x.target_id === l.target_id)) DEMO.likes.push(l);
  }
  for (const f of saved.favorites || []) {
    if (!DEMO.favorites.some((x) => x.user_id === f.user_id && x.question_id === f.question_id)) DEMO.favorites.push(f);
  }
  for (const a of saved.achievements || []) {
    if (!DEMO.achievements.some((x) => x.user_id === a.user_id && x.achievement_type === a.achievement_type)) DEMO.achievements.push(a);
  }
  for (const s of saved.subscriptions || []) {
    if (!seedSub.has(subKey(s)) && !DEMO.subscriptions.some((x) => subKey(x) === subKey(s))) DEMO.subscriptions.push(s);
  }

  // ---------- Чистка «висяков» ----------
  // Перенесённая запись могла ссылаться на демо-контент, которого в новых
  // сидах уже нет (ответ на пересозданный вопрос, лайк удалённого и т. п.)
  const aliveQ = new Set(DEMO.questions.map((x) => x.id));
  DEMO.answers = DEMO.answers.filter((a) => aliveQ.has(a.question_id));
  const aliveA = new Set(DEMO.answers.map((x) => x.id));
  DEMO.comments = DEMO.comments.filter((c) => aliveA.has(c.answer_id));
  const aliveC = new Set(DEMO.comments.map((x) => x.id));
  DEMO.likes = DEMO.likes.filter((l) =>
    (l.target_type === 'question' && aliveQ.has(l.target_id)) ||
    (l.target_type === 'answer' && aliveA.has(l.target_id)));
  DEMO.favorites = DEMO.favorites.filter((f) => aliveQ.has(f.question_id));
  // заход 38: голоса за несуществующие идеи — висяки
  const aliveI = new Set(DEMO.ideas.map((x) => x.id));
  DEMO.idea_votes = DEMO.idea_votes.filter((v) => aliveI.has(v.idea_id));
  DEMO.messages = DEMO.messages.filter((m) => seedIds.has(m.sender_id) && seedIds.has(m.recipient_id));
  // v10: аудио-вложения ЛС удалены — вычищаем старые поля из снапшота;
  // ref (карточка-ссылка) переносится как есть
  for (const m of DEMO.messages) {
    if (!m) continue;
    delete m.audio_url;
    delete m.waveform_data;
    delete m.audio_kind;
  }
  DEMO.notifications = DEMO.notifications.filter((n) => seedIds.has(n.user_id));
  DEMO.achievements = DEMO.achievements.filter((a) => seedIds.has(a.user_id));
  DEMO.subscriptions = DEMO.subscriptions.filter((s) => s.target_type !== 'author' || seedIds.has(s.target_id));
  DEMO.donations = (DEMO.donations || []).filter((d) =>
    (d.recipient_user_id == null || seedIds.has(d.recipient_user_id)) && seedIds.has(d.donor_id));
  DEMO.reports = DEMO.reports.filter((r) =>
    (r.target_type === 'question' && aliveQ.has(r.target_id)) ||
    (r.target_type === 'answer' && aliveA.has(r.target_id)) ||
    (r.target_type === 'comment' && aliveC.has(r.target_id)) ||
    (r.target_type === 'profile' && seedIds.has(r.target_id)));

  // ---------- Счётчики ----------
  // Сидовые вопросы/ответы «не знают» про лайки пользователя — добавляем
  // перенесённые. У перенесённых (пользовательских) вопросов likes_count из
  // снапшота уже согласован с их лайками — не трогаем (иначе двойной счёт).
  // answers_count не пересчитываем: демо-слой вычисляет его динамически из
  // DEMO.answers (см. demoQuestion), перенесённые ответы уже на месте.
  for (const l of DEMO.likes) {
    if (l.target_type === 'question' && seedQ.has(l.target_id)) {
      const q = DEMO.questions.find((x) => x.id === l.target_id);
      if (q) q.likes_count = (q.likes_count || 0) + 1;
    } else if (l.target_type === 'answer' && seedA.has(l.target_id)) {
      const a = DEMO.answers.find((x) => x.id === l.target_id);
      if (a) a.likes_count = (a.likes_count || 0) + 1;
    }
  }
}

/** Восстановить демо-базу из LocalStorage при старте */
function loadDemo() {
  if (!IS_DEMO) return;
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_DB_KEY) || 'null');
    if (!saved) return;
    if (saved.v !== DEMO_DB_VERSION) {
      // Версия сидов изменилась: контент пересоздаётся, НО настройки профиля
      // и словари пользователя переносятся (мягкий пересид вместо сброса).
      migrateDemo(saved);
      demoReseedNotice = { from: saved.v ?? 0, to: DEMO_DB_VERSION };
      persistDemo(); // фиксируем новую версию, чтобы не мигрировать каждый старт
      return;
    }
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
function demoHash(str) {
  let h = 5381;
  for (const ch of str) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/**
 * Заход 46: демо-аккаунт по почте. Возвращает { row, created }: строку профиля
 * в DEMO.profiles и факт «создан сейчас» (для онбординга только при регистрации).
 * Если демо-БД очищалась, а реестр жив — строка профиля восстанавливается.
 */
function demoResolveAccount(email, usernameHint) {
  const key = String(email || '').trim().toLowerCase();
  let reg = {};
  try { reg = JSON.parse(localStorage.getItem(DEMO_ACCOUNTS_KEY) || '{}') || {}; } catch { reg = {}; }
  const known = reg[key];
  let row = known ? DEMO.profiles.find((x) => x.id === known.id) : null;
  if (known && !row) {
    row = { id: known.id, username: known.username, contact: [], contact_consent: false, donate_methods: [], avatar_url: null, bio: '', links: [], rating: 0 };
    DEMO.profiles.push(row);
    persistDemo();
    return { row, created: false };
  }
  if (!known) {
    const base = usernameHint || (key.split('@')[0] || 'user');
    const taken = new Set(DEMO.profiles.map((x) => String(x.username || '').toLowerCase()));
    const username = taken.has(base.toLowerCase()) ? `${base}_${demoHash(key).slice(0, 4)}` : base;
    row = { id: `u-${demoHash(key)}`, username, contact: [], contact_consent: false, donate_methods: [], avatar_url: null, bio: '', links: [], rating: 0 };
    DEMO.profiles.push(row);
    reg[key] = { id: row.id, username, created_at: new Date().toISOString() };
    localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(reg));
    persistDemo();
    return { row, created: true };
  }
  return { row, created: false };
}

export async function ensureProfileRow(authUser, usernameHint = '') {
  if (!authUser?.id || IS_DEMO) return false;
  try {
    const sb = await ensureClient();
    const { data: existing } = await sb.from('profiles').select('id').eq('id', authUser.id).maybeSingle();
    if (existing) return 'existing';
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
    return 'created';
  } catch (e) {
    console.error('[profiles] ensureProfileRow:', e);
    return false;
  }
}

export async function signUp({ email, password, username }) {
  if (IS_DEMO) {
    const { row, created } = demoResolveAccount(email, username);
    const user = { ...row, email };
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    return { user, needsOnboarding: created };
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
    const { row } = demoResolveAccount(email);
    const user = { ...row, email };
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
    const email = `demo@${provider}.local`;
    const { row, created } = demoResolveAccount(email, `${provider}_user`);
    const user = { ...row, email };
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    return { user, needsOnboarding: created };
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
    let query = sb.from('questions').select('*, profiles(username, avatar_url, donate_methods)').eq('purged', false);
    if (sort === 'popular') query = query.order('likes_count', { ascending: false });
    else query = query.order('created_at', { ascending: false });
    let { data, error } = await query.limit(50);
    if (error && /purged/.test(error.message || '')) {
      // Миграция жизненного цикла ещё не выполнена в БД — работаем без фильтра
      let q2 = sb.from('questions').select('*, profiles(username, avatar_url, donate_methods)');
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

/**
 * Новый вопрос с тегом (synth) → уведомление подписчикам тега (демо).
 * Тип 'new_question_tag' (рендер — notifications.mjs); автору самому не шлём.
 * Вызывается из createQuestion до persistDemo — снапшот сохраняет и вопрос,
 * и уведомления одним записыванием.
 */
function notifyTagSubscribersDemo(q) {
  const tag = String(q.synth || '').trim();
  if (!tag) return;
  for (const s of DEMO.subscriptions) {
    if (s.target_type !== 'tag' || s.target_id !== tag) continue;
    if (s.user_id === q.user_id) continue;
    DEMO.notifications.unshift({
      id: uid('n-'), user_id: s.user_id, type: 'new_question_tag',
      payload: { tag, questionTitle: q.title || '', questionId: q.id },
      read: false, created_at: new Date().toISOString(),
    });
  }
}

/** То же в реальном режиме: best-effort, сбой уведомлений не рвёт создание вопроса */
async function notifyTagSubscribersReal(sb, q) {
  try {
    const tag = String(q.synth || '').trim();
    if (!tag) return;
    const { data: subs } = await sb.from('subscriptions').select('user_id').eq('target_type', 'tag').eq('target_id', tag);
    const rows = (subs || [])
      .map((s) => s.user_id)
      .filter((subId) => subId && subId !== q.user_id)
      .map((subId) => ({ user_id: subId, type: 'new_question_tag', payload: { tag, questionTitle: q.title || '', questionId: q.id } }));
    if (rows.length) await sb.from('notifications').insert(rows);
  } catch (e) {
    console.error('[subscriptions] tag notification:', e);
  }
}

export async function createQuestion(payload) {
  if (IS_DEMO) {
    const { user } = getState();
    const q = { id: uid('q-'), user_id: user?.id || 'u-demo', likes_count: 0, status: 'open', created_at: new Date().toISOString(), ...payload };
    DEMO.questions.unshift(q);
    notifyTagSubscribersDemo(q); // заход B: подписчики тега узнают о новом вопросе
    persistDemo();
    return demoQuestion(q);
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('questions').insert(payload).select().single();
    if (error) throw error;
    await notifyTagSubscribersReal(sb, data);
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
      .select('*, profiles(username, avatar_url, donate_methods)')
      .in('question_id', questionIds)
      .order('is_solution', { ascending: false })
      .order('likes_count', { ascending: false });
    if (error) throw error;
    const answerIds = (data || []).map((a) => a.id);
    let comments = [];
    if (answerIds.length) {
      const { data: cdata } = await sb.from('comments')
        .select('*, profiles(username, avatar_url, donate_methods)')
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
    const { data, error } = await sb.from('answers').select('*, profiles(username, avatar_url, donate_methods)').eq('question_id', questionId).order('is_solution', { ascending: false }).order('likes_count', { ascending: false });
    if (error) throw error;
    // Комментарии к ответам
    const ids = (data || []).map((a) => a.id);
    let comments = [];
    if (ids.length) {
      const { data: cdata } = await sb.from('comments').select('*, profiles(username, avatar_url, donate_methods)').in('answer_id', ids).order('created_at');
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
    // Заход 47: автор вопроса узнаёт о новом ответе (себе за свой ответ — нет)
    if (q && q.user_id && q.user_id !== a.user_id) {
      DEMO.notifications.unshift({ id: uid('n-'), user_id: q.user_id, type: 'answer', payload: { by: user?.username || '?', questionTitle: q.title || '', questionId: q.id, answerId: a.id }, read: false, created_at: new Date().toISOString() });
    }
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
    // Заход 47: уведомление автору вопроса — best-effort, не рвёт ответ
    try {
      const { data: qrow } = await sb.from('questions').select('id, user_id, title').eq('id', data.question_id).maybeSingle();
      if (qrow && qrow.user_id !== user.id) {
        await sb.from('notifications').insert({ user_id: qrow.user_id, type: 'answer', payload: { by: user.username || '?', questionTitle: qrow.title || '', questionId: qrow.id, answerId: data.id } });
      }
    } catch (e) { console.warn('[answers] уведомление автору вопроса:', e); }
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
    // Заход 47: лайк уведомляет автора контента (себя — нет; снятие — тихо)
    if (item && item.user_id && item.user_id !== user.id) {
      const qid = targetType === 'question' ? item.id : (DEMO.answers.find((a) => a.id === targetId)?.question_id || null);
      DEMO.notifications.unshift({ id: uid('n-'), user_id: item.user_id, type: 'like', payload: { by: user.username || '?', targetKey: targetType === 'question' ? 'notifications.target_question' : 'notifications.target_answer', questionId: qid }, read: false, created_at: new Date().toISOString() });
    }
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
      // Заход 47: уведомление автору контента — best-effort
      try {
        const row = targetType === 'question'
          ? (await sb.from('questions').select('id, user_id').eq('id', targetId).maybeSingle()).data
          : (await sb.from('answers').select('id, user_id, question_id').eq('id', targetId).maybeSingle()).data;
        const qid = targetType === 'question' ? targetId : row?.question_id || null;
        if (row?.user_id && row.user_id !== user.id) {
          await sb.from('notifications').insert({ user_id: row.user_id, type: 'like', payload: { by: user.username || '?', targetKey: targetType === 'question' ? 'notifications.target_question' : 'notifications.target_answer', questionId: qid } });
        }
      } catch (e) { console.warn('[likes] уведомление автору:', e); }
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

/** Расширение по MIME: закодированные blob-и (без имени) должны попадать
 *  в Storage с правильным именем и Content-Type — иначе публичный URL
 *  отдаёт application/octet-stream и <audio> может отказаться играть файл. */
const AUDIO_EXT_BY_MIME = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

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
    const mimeBase = String(file.type || '').split(';')[0].toLowerCase();
    const ext = AUDIO_EXT_BY_MIME[mimeBase];
    let name = file.name ? safeFileName(file.name) : '';
    if (!name) name = ext ? `sample.${ext}` : 'sample';
    else if (ext && !/\.[a-z0-9]{2,5}$/i.test(name)) name = `${name}.${ext}`;
    const path = `${getState().user?.id || 'anon'}/${uid()}_${name}`;
    const { error } = await sb.storage.from(folder)
      .upload(path, file, mimeBase ? { contentType: mimeBase } : undefined);
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

/**
 * Контент пользователя для пикера «📎» в ЛС (решение 2026-10-13):
 * мои ответы и мои вопросы (purged-вопросы исключены — они закрыты).
 * Возвращает { answers: [{type,id,title,is_solution,created_at}],
 *              questions: [{type,id,title,answers_count,created_at}] }.
 */
export async function fetchRefCandidates() {
  const { user } = getState();
  if (!user) return { answers: [], questions: [] };
  const byDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  if (IS_DEMO) {
    const answers = DEMO.answers
      .filter((a) => a.user_id === user.id)
      .map((a) => {
        const q = DEMO.questions.find((x) => x.id === a.question_id);
        return q && !q.purged
          ? { type: 'answer', id: a.id, title: q.title, is_solution: !!a.is_solution, created_at: a.created_at }
          : null;
      })
      .filter(Boolean).sort(byDate).slice(0, 30);
    const questions = DEMO.questions
      .filter((q) => q.user_id === user.id && !q.purged)
      .map((q) => ({
        type: 'question', id: q.id, title: q.title,
        answers_count: DEMO.answers.filter((a) => a.question_id === q.id).length,
        created_at: q.created_at,
      }))
      .sort(byDate).slice(0, 30);
    return { answers, questions };
  }
  try {
    const sb = await ensureClient();
    const [a, q] = await Promise.all([
      sb.from('answers')
        .select('id, created_at, is_solution, questions(id, title, purged)')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
      sb.from('questions')
        .select('id, title, answers_count, created_at')
        .eq('user_id', user.id).eq('purged', false)
        .order('created_at', { ascending: false }).limit(30),
    ]);
    if (a.error) throw a.error;
    if (q.error) throw q.error;
    return {
      answers: (a.data || [])
        .filter((x) => x.questions && !x.questions.purged)
        .map((x) => ({ type: 'answer', id: x.id, title: x.questions.title, is_solution: !!x.is_solution, created_at: x.created_at })),
      questions: (q.data || [])
        .map((x) => ({ type: 'question', id: x.id, title: x.title, answers_count: x.answers_count ?? 0, created_at: x.created_at })),
    };
  } catch (e) {
    console.error('[messages] fetchRefCandidates:', e);
    return { answers: [], questions: [] };
  }
}

/**
 * Дисплей-пейлоад карточки-ссылки из messages.ref для пузыря ЛС:
 * { type, id, href, title, avatar_url?, author?, status?, answers_count?,
 *   is_solution?, purged, purge_summary } или null, если цель исчезла.
 */
export async function fetchRefCard(ref) {
  if (!ref || typeof ref !== 'object' || !ref.type || !ref.id) return null;
  if (IS_DEMO) {
    if (ref.type === 'question') {
      const q = DEMO.questions.find((x) => x.id === ref.id);
      if (!q) return null;
      return {
        type: 'question', id: q.id, href: `/question/${q.id}`, title: q.title,
        purged: !!q.purged, purge_summary: q.purge_summary || null,
        author: (DEMO.profiles.find((p) => p.id === q.user_id) || {}).username || '?',
        status: q.status,
        answers_count: DEMO.answers.filter((a) => a.question_id === q.id).length,
      };
    }
    if (ref.type === 'answer') {
      const a = DEMO.answers.find((x) => x.id === ref.id);
      if (!a) return null;
      const q = DEMO.questions.find((x) => x.id === a.question_id);
      if (!q) return null;
      return {
        type: 'answer', id: a.id, href: `/question/${q.id}`, title: q.title,
        purged: !!q.purged, purge_summary: q.purge_summary || null, is_solution: !!a.is_solution,
      };
    }
    if (ref.type === 'profile') {
      const p = DEMO.profiles.find((x) => x.id === ref.id);
      if (!p) return null;
      return { type: 'profile', id: p.id, href: `/profile/${p.id}`, title: p.username, avatar_url: p.avatar_url || null, purged: false, purge_summary: null };
    }
    return null;
  }
  try {
    const sb = await ensureClient();
    if (ref.type === 'question') {
      const { data } = await sb.from('questions')
        .select('id, title, status, purged, purge_summary, answers_count, profiles(username)')
        .eq('id', ref.id).maybeSingle();
      if (!data) return null;
      return {
        type: 'question', id: data.id, href: `/question/${data.id}`, title: data.title,
        purged: !!data.purged, purge_summary: data.purge_summary || null,
        author: data.profiles?.username || '?', status: data.status, answers_count: data.answers_count ?? 0,
      };
    }
    if (ref.type === 'answer') {
      const { data } = await sb.from('answers')
        .select('id, is_solution, question_id, questions(id, title, purged, purge_summary)')
        .eq('id', ref.id).maybeSingle();
      if (!data || !data.questions) return null;
      return {
        type: 'answer', id: data.id, href: `/question/${data.question_id}`, title: data.questions.title,
        purged: !!data.questions.purged, purge_summary: data.questions.purge_summary || null, is_solution: !!data.is_solution,
      };
    }
    if (ref.type === 'profile') {
      const { data } = await sb.from('profiles')
        .select('id, username, avatar_url').eq('id', ref.id).maybeSingle();
      if (!data) return null;
      return { type: 'profile', id: data.id, href: `/profile/${data.id}`, title: data.username, avatar_url: data.avatar_url || null, purged: false, purge_summary: null };
    }
    return null;
  } catch (e) {
    console.error('[messages] fetchRefCard:', e);
    return null;
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
      arsenal: DEMO.arsenal?.[userId] || [],
      // Контакты приводим к безопасному виду уже здесь, чтобы ни один экран
      // не получил «кривую» запись из старого снапшота LocalStorage
      contact: normalizeContacts(p.contact),
      contact_consent: !!p.contact_consent,
      open_to_collab: !!p.open_to_collab,
      // Способы приёма — только СБП/карта: устаревшие виды из старых
      // снапшотов (v≤8) не показываются и не ломают окно поддержки
      donate_methods: normalizeDonateMethods(p.donate_methods),
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
      { data: arsenal },
      { data: questions },
      { data: answers },
    ] = await Promise.all([
      sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
      sb.from('user_software').select('software_name').eq('user_id', userId),
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
      arsenal: (arsenal || []).map((s) => s.item_name),
      contact: normalizeContacts(profile.contact),
      contact_consent: !!profile.contact_consent,
      // Способы приёма — только СБП/карта (в реальной БД могли остаться
      // записи устаревших видов, сохранённые до версии продукта v9)
      donate_methods: normalizeDonateMethods(profile.donate_methods),
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
    if (patch.arsenal) DEMO.arsenal[user.id] = patch.arsenal;
    localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
    persistDemo();
    return;
  }
  try {
    const sb = await ensureClient();
    const { software, ...profileFields } = patch;
    await sb.from('profiles').update(profileFields).eq('id', user.id);
    invalidateProfileCache(user.id); // профиль изменился — сбрасываем кэш
    if (software) {
      await sb.from('user_software').delete().eq('user_id', user.id);
      if (software.length) await sb.from('user_software').insert(software.map((s) => ({ user_id: user.id, software_name: s })));
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
// «ЛУЧШИЕ ОТВЕТЫ» — авто-витрина профиля
// (заменила шоукейс «Моё звучание»: пользовательские треки убраны —
//  вместо них топ ответов СО ЗВУКОМ, которые уже загружены в рамках
//  вопросов: без новых загрузок, без лимитов и DMCA-рисков чужих треков)
// ============================================================

/**
 * Топ-ответы пользователя со звуком: сначала принятые решения, затем по лайкам.
 * Используется авто-витриной в профиле (мини-плееры + ссылка на вопрос).
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<Array<{id, question_id, audio_url, waveform_data, markers, is_solution, likes_count, question: {id, title, purged}|null}>>}
 */
export async function fetchBestAnswers(userId, limit = 3) {
  if (IS_DEMO) {
    return DEMO.answers
      .filter((a) => a.user_id === userId && (a.audio_kind || a.audio_url))
      .sort((a, b) => ((b.is_solution ? 1 : 0) - (a.is_solution ? 1 : 0)) || ((b.likes_count || 0) - (a.likes_count || 0)))
      .slice(0, limit)
      .map(demoMsg) // аудио материализуется из «характера» звука (вопросы/ответы; у сообщений аудио больше нет)
      .map((a) => {
        const q = DEMO.questions.find((qq) => qq.id === a.question_id);
        return { ...a, question: q ? { id: q.id, title: q.title, purged: !!q.purged } : null };
      });
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('answers')
      .select('id, question_id, audio_url, waveform_data, markers, is_solution, likes_count, created_at, questions(id, title, purged)')
      .eq('user_id', userId)
      .not('audio_url', 'is', null)
      .order('is_solution', { ascending: false })
      .order('likes_count', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(({ questions, ...a }) => ({
      ...a,
      question: questions ? { id: questions.id, title: questions.title, purged: !!questions.purged } : null,
    }));
  } catch (e) {
    console.error('[best-answers] fetch:', e);
    return [];
  }
}

/**
 * Пул «кто онлайн» для демо-симуляции присутствия: сид-профили минус
 * текущий пользователь и минус те, кто включил «не показывать мой онлайн».
 * @returns {Array<{id, username, avatar_url}>}
 */
export function getDemoPresencePool() {
  if (!IS_DEMO) return [];
  const { user } = getState();
  return DEMO.profiles
    .filter((p) => !user || p.id !== user.id)
    .map((p) => ({ id: p.id, username: p.username, avatar_url: p.avatar_url || null }));
}

// ============================================================
// ЖАЛОБЫ И МОДЕРАЦИЯ (⚑ «Пожаловаться» → экран /moderation для админов)
// Одна жалоба от пользователя на объект (unique в БД / проверка в демо).
// Админ — profiles.is_admin: владелец проекта выставляет флаг себе в Dashboard.
// ============================================================

/** Содержимое цели жалобы (демо): что показывать модератору; null — контент уже удалён */
function demoReportTarget(r) {
  const author = (id) => DEMO.profiles.find((p) => p.id === id) || null;
  if (r.target_type === 'question') {
    const q = DEMO.questions.find((x) => x.id === r.target_id);
    if (!q || q.purged) return null;
    return { kind: 'question', title: q.title || '', text: q.description || '', author: author(q.user_id) };
  }
  if (r.target_type === 'answer') {
    const a = DEMO.answers.find((x) => x.id === r.target_id);
    if (!a) return null;
    const q = DEMO.questions.find((x) => x.id === a.question_id);
    return { kind: 'answer', title: q && !q.purged ? (q.title || '') : '', text: a.content || '', author: author(a.user_id), question_id: a.question_id };
  }
  if (r.target_type === 'profile') {
    const p = DEMO.profiles.find((x) => x.id === r.target_id);
    if (!p) return null;
    // Модератору показываем то, на что жалуются: био + способы приёма + контакты
    const pay = (p.donate_methods || []).map((m) => `${m.kind}: ${m.value}`).join('; ');
    const ct = (p.contact || []).map((c) => `${c.kind}: ${c.value}`).join('; ');
    return {
      kind: 'profile', title: `@${p.username}`, user_id: p.id,
      text: [p.bio || '', pay && `Оплата: ${pay}`, ct && `Контакты: ${ct}`].filter(Boolean).join('\n'),
      author: author(p.id),
    };
  }
  const c = DEMO.comments.find((x) => x.id === r.target_id);
  if (!c) return null;
  return { kind: 'comment', title: '', text: c.content || '', author: author(c.user_id) };
}

/**
 * Отправить жалобу на вопрос/ответ/комментарий.
 * Повторная жалоба того же пользователя на тот же объект → err.code === 'duplicate'.
 * @param {{target_type: 'question'|'answer'|'comment'|'profile', target_id: string, reason: string, note?: string}} payload
 */
export async function submitReport({ target_type, target_id, reason, note = '' }) {
  const { user } = getState();
  if (!user) throw new Error('Требуется вход');
  const cleanNote = String(note || '').slice(0, 500);
  if (IS_DEMO) {
    DEMO.reports = DEMO.reports || [];
    const dup = DEMO.reports.some((r) => r.reporter_id === user.id && r.target_type === target_type && r.target_id === target_id);
    if (dup) { const e = new Error('duplicate'); e.code = 'duplicate'; throw e; }
    const row = {
      id: uid('r-'), reporter_id: user.id, target_type, target_id, reason,
      note: cleanNote, status: 'new', moderator_note: '',
      created_at: new Date().toISOString(), resolved_at: null,
    };
    DEMO.reports.push(row);
    persistDemo();
    return row;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('reports')
      .insert({ reporter_id: user.id, target_type, target_id, reason, note: cleanNote })
      .select().single();
    if (error) {
      // 23505 — нарушение unique (reporter_id, target_type, target_id)
      if (error.code === '23505') { const e = new Error('duplicate'); e.code = 'duplicate'; throw e; }
      throw error;
    }
    return data;
  } catch (e) {
    console.error('[reports] submit:', e);
    throw e;
  }
}

/**
 * Для админа: жалобы вместе с содержимым целей и авторами.
 * @param {'new'|'dismissed'|'actioned'|'all'} status
 * @returns строки { ...report, reporter, target: {kind,title,text,author,question_id?}|null }
 *          target === null — контент уже удалён (нечего разбирать)
 */
export async function fetchReports(status = 'new') {
  const { user } = getState();
  if (!user?.is_admin) return [];
  if (IS_DEMO) {
    let rows = (DEMO.reports || []).slice();
    if (status !== 'all') rows = rows.filter((r) => r.status === status);
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows.map((r) => ({
      ...r,
      reporter: DEMO.profiles.find((p) => p.id === r.reporter_id) || null,
      target: demoReportTarget(r),
    }));
  }
  try {
    const sb = await ensureClient();
    let q = sb.from('reports').select('*').order('created_at', { ascending: false });
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    const idsOf = (type) => [...new Set(rows.filter((r) => r.target_type === type).map((r) => r.target_id))];
    const as = idsOf('answer').length
      ? (await sb.from('answers').select('id, content, user_id, question_id').in('id', idsOf('answer'))).data || []
      : [];
    const cs = idsOf('comment').length
      ? (await sb.from('comments').select('id, content, user_id').in('id', idsOf('comment'))).data || []
      : [];
    // Цели-профили (жалоба «мошенничество / чужие реквизиты») — берём строки
    // профиля целиком, чтобы показать модератору био, контакты и способы приёма
    const targetProfiles = idsOf('profile').length
      ? (await sb.from('profiles').select('id, username, avatar_url, bio, contact, donate_methods').in('id', idsOf('profile'))).data || []
      : [];
    // Вопросы: цели-вопросы + родители ответов (для заголовка в карточке жалобы)
    const qids = [...new Set([...idsOf('question'), ...as.map((x) => x.question_id)].filter(Boolean))];
    const qs = qids.length
      ? (await sb.from('questions').select('id, title, description, user_id, purged').in('id', qids)).data || []
      : [];
    const peopleIds = [...new Set([
      ...rows.map((r) => r.reporter_id),
      ...targetProfiles.map((x) => x.id),
      ...qs.map((x) => x.user_id), ...as.map((x) => x.user_id), ...cs.map((x) => x.user_id),
    ].filter(Boolean))];
    const profs = peopleIds.length
      ? (await sb.from('profiles').select('id, username, avatar_url').in('id', peopleIds)).data || []
      : [];
    const person = (id) => profs.find((p) => p.id === id) || null;
    return rows.map((r) => {
      let target = null;
      if (r.target_type === 'question') {
        const x = qs.find((v) => v.id === r.target_id);
        if (x && !x.purged) target = { kind: 'question', title: x.title || '', text: x.description || '', author: person(x.user_id) };
      } else if (r.target_type === 'answer') {
        const x = as.find((v) => v.id === r.target_id);
        if (x) {
          const qx = qs.find((v) => v.id === x.question_id);
          target = { kind: 'answer', title: qx && !qx.purged ? (qx.title || '') : '', text: x.content || '', author: person(x.user_id), question_id: x.question_id };
        }
      } else if (r.target_type === 'profile') {
        const x = targetProfiles.find((v) => v.id === r.target_id);
        if (x) {
          const pay = (x.donate_methods || []).map((m) => `${m.kind}: ${m.value}`).join('; ');
          const ct = (x.contact || []).map((c) => `${c.kind}: ${c.value}`).join('; ');
          target = {
            kind: 'profile', title: `@${x.username}`, user_id: x.id,
            text: [x.bio || '', pay && `Оплата: ${pay}`, ct && `Контакты: ${ct}`].filter(Boolean).join('\n'),
            author: person(x.id),
          };
        }
      } else {
        const x = cs.find((v) => v.id === r.target_id);
        if (x) target = { kind: 'comment', title: '', text: x.content || '', author: person(x.user_id) };
      }
      return { ...r, reporter: person(r.reporter_id), target };
    });
  } catch (e) {
    console.error('[reports] fetch:', e);
    return [];
  }
}

/** Для админа: сменить статус жалобы ('new' | 'dismissed' | 'actioned') */
export async function setReportStatus(id, status, moderator_note = '') {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  const resolved_at = status === 'new' ? null : new Date().toISOString();
  if (IS_DEMO) {
    const r = (DEMO.reports || []).find((x) => x.id === id);
    if (!r) return false;
    r.status = status;
    r.moderator_note = moderator_note;
    r.resolved_at = resolved_at;
    // Заход 36: петля обратной связи — жалобщик узнаёт о факте решения
    if (status === 'dismissed' || status === 'actioned') {
      DEMO.notifications.unshift({ id: uid('n-'), user_id: r.reporter_id, type: 'report_status', payload: { status, target_type: r.target_type }, read: false, created_at: new Date().toISOString() });
    }
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    // Строку жалобы читаем ДО обновления: после update нужен reporter_id цели
    const { data: row } = await sb.from('reports').select('id, reporter_id, target_type').eq('id', id).maybeSingle();
    const { error } = await sb.from('reports').update({ status, moderator_note, resolved_at }).eq('id', id);
    if (error) throw error;
    // Уведомление репортёру — best-effort: сбой уведомления не рвёт решение
    if (row && (status === 'dismissed' || status === 'actioned')) {
      try {
        await sb.from('notifications').insert({ user_id: row.reporter_id, type: 'report_status', payload: { status, target_type: row.target_type } });
      } catch (e) { console.warn('[reports] уведомление жалобщику:', e); }
    }
    return true;
  } catch (e) {
    console.error('[reports] status:', e);
    throw e;
  }
}

// ============================================================
// Идеи продукта (заход 38, спека PLAN_IDEAS.md): витрина открыта всем,
// предлагают и голосуют залогиненные, статусы/ответ — админ. Петля обратной
// связи как в жалобах (заход 36): смена статуса и ответ разработчика шлют
// автору идеи уведомление (idea_status / idea_reply).
// ============================================================
const IDEA_STATUSES = ['new', 'in_work', 'done', 'rejected'];

function demoIdeaRow(i) {
  return {
    ...i,
    author: DEMO.profiles.find((p) => p.id === i.author_id) || null,
    votes: DEMO.idea_votes.filter((v) => v.idea_id === i.id).length,
  };
}
const sortIdeas = (rows, sort) => rows.sort(sort === 'new'
  ? (a, b) => b.created_at.localeCompare(a.created_at)
  : (a, b) => (b.votes - a.votes) || b.created_at.localeCompare(a.created_at));

/** Список идей с автором и счётчиком голосов. sort: 'top' | 'new' */
export async function fetchIdeas(sort = 'top') {
  if (IS_DEMO) return sortIdeas(DEMO.ideas.map(demoIdeaRow), sort);
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('ideas').select('*, profiles!ideas_author_id_fkey(username, avatar_url)').order('created_at', { ascending: false });
    if (error) throw error;
    const { data: votes } = await sb.from('idea_votes').select('idea_id');
    const cnt = new Map();
    for (const v of votes || []) cnt.set(v.idea_id, (cnt.get(v.idea_id) || 0) + 1);
    return sortIdeas((data || []).map((i) => ({ ...i, author: i.profiles || null, votes: cnt.get(i.id) || 0 })), sort);
  } catch (e) {
    console.error('[ideas] fetch:', e);
    return [];
  }
}

/** Мои голоса за текущий экран (Set idea_id) */
export async function fetchIdeaVotesMine() {
  const { user } = getState();
  if (!user) return new Set();
  if (IS_DEMO) return new Set(DEMO.idea_votes.filter((v) => v.user_id === user.id).map((v) => v.idea_id));
  try {
    const sb = await ensureClient();
    const { data } = await sb.from('idea_votes').select('idea_id').eq('user_id', user.id);
    return new Set((data || []).map((v) => v.idea_id));
  } catch (e) {
    console.error('[ideas] votes mine:', e);
    return new Set();
  }
}

/** Новая идея (залогиненным). Возвращает строку или null */
export async function createIdea({ title, body }) {
  const { user } = getState();
  if (!user) return null;
  const row = { title: String(title || '').trim(), body: String(body || '').trim() };
  if (IS_DEMO) {
    const idea = { id: uid('i-'), author_id: user.id, status: 'new', dev_reply: '', dev_reply_at: null, created_at: new Date().toISOString(), ...row };
    DEMO.ideas.unshift(idea);
    persistDemo();
    return demoIdeaRow(idea);
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('ideas').insert({ author_id: user.id, ...row }).select('*, profiles!ideas_author_id_fkey(username, avatar_url)').single();
    if (error) throw error;
    return { ...data, author: data.profiles || null, votes: 0 };
  } catch (e) {
    console.error('[ideas] create:', e);
    return null;
  }
}

/** Голос toggle: есть → снять, нет → поставить. Возвращает новый счётчик */
export async function toggleIdeaVote(ideaId) {
  const { user } = getState();
  if (!user) return null;
  if (IS_DEMO) {
    const at = DEMO.idea_votes.findIndex((v) => v.idea_id === ideaId && v.user_id === user.id);
    if (at >= 0) DEMO.idea_votes.splice(at, 1);
    else DEMO.idea_votes.push({ idea_id: ideaId, user_id: user.id, created_at: new Date().toISOString() });
    persistDemo();
    return DEMO.idea_votes.filter((v) => v.idea_id === ideaId).length;
  }
  try {
    const sb = await ensureClient();
    const { data: mine } = await sb.from('idea_votes').select('idea_id').eq('idea_id', ideaId).eq('user_id', user.id).maybeSingle();
    if (mine) {
      await sb.from('idea_votes').delete().eq('idea_id', ideaId).eq('user_id', user.id);
    } else {
      const { error } = await sb.from('idea_votes').insert({ idea_id: ideaId, user_id: user.id });
      if (error) throw error;
    }
    const { count } = await sb.from('idea_votes').select('idea_id', { count: 'exact', head: true }).eq('idea_id', ideaId);
    return count || 0;
  } catch (e) {
    console.error('[ideas] vote:', e);
    return null;
  }
}

function notifyIdeaAuthorDemo(authorId, type, payload) {
  DEMO.notifications.unshift({ id: uid('n-'), user_id: authorId, type, payload, read: false, created_at: new Date().toISOString() });
}
async function notifyIdeaAuthorReal(sb, authorId, type, payload) {
  try {
    await sb.from('notifications').insert({ user_id: authorId, type, payload });
  } catch (e) { console.warn('[ideas] уведомление автору:', e); }
}

/** Админ: смена статуса идеи + уведомление автору (себя не уведомляем) */
export async function setIdeaStatus(id, status) {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  if (!IDEA_STATUSES.includes(status)) return false;
  if (IS_DEMO) {
    const i = DEMO.ideas.find((x) => x.id === id);
    if (!i) return false;
    i.status = status;
    if (i.author_id !== user.id) notifyIdeaAuthorDemo(i.author_id, 'idea_status', { status, ideaTitle: i.title });
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { data: row } = await sb.from('ideas').select('id, author_id, title').eq('id', id).maybeSingle();
    const { error } = await sb.from('ideas').update({ status }).eq('id', id);
    if (error) throw error;
    if (row && row.author_id !== user.id) await notifyIdeaAuthorReal(sb, row.author_id, 'idea_status', { status, ideaTitle: row.title });
    return true;
  } catch (e) {
    console.error('[ideas] status:', e);
    throw e;
  }
}

/** Админ: публичный ответ разработчика (пустой текст = очистить) + уведомление */
export async function setIdeaReply(id, text) {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  const reply = String(text || '').trim();
  if (IS_DEMO) {
    const i = DEMO.ideas.find((x) => x.id === id);
    if (!i) return false;
    i.dev_reply = reply;
    i.dev_reply_at = reply ? new Date().toISOString() : null;
    if (reply && i.author_id !== user.id) notifyIdeaAuthorDemo(i.author_id, 'idea_reply', { ideaTitle: i.title });
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { data: row } = await sb.from('ideas').select('id, author_id, title').eq('id', id).maybeSingle();
    const { error } = await sb.from('ideas').update({ dev_reply: reply, dev_reply_at: reply ? new Date().toISOString() : null }).eq('id', id);
    if (error) throw error;
    if (reply && row && row.author_id !== user.id) await notifyIdeaAuthorReal(sb, row.author_id, 'idea_reply', { ideaTitle: row.title });
    return true;
  } catch (e) {
    console.error('[ideas] reply:', e);
    throw e;
  }
}

/** Удаление: автор свою идею, админ — любую */
export async function deleteIdea(id) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    const i = DEMO.ideas.find((x) => x.id === id);
    if (!i) return false;
    if (i.author_id !== user.id && !user.is_admin) throw new Error('Недостаточно прав');
    DEMO.ideas = DEMO.ideas.filter((x) => x.id !== id);
    DEMO.idea_votes = DEMO.idea_votes.filter((v) => v.idea_id !== id);
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('ideas').delete().eq('id', id);
    if (error) throw error; // RLS: автор или админ
    return true;
  } catch (e) {
    console.error('[ideas] delete:', e);
    throw e;
  }
}

/** Контакт разработчика для кнопки ЛС: профиль с is_admin */
export async function fetchDevContact() {
  if (IS_DEMO) {
    const p = DEMO.profiles.find((x) => x.is_admin);
    return p ? { id: p.id, username: p.username, avatar_url: p.avatar_url } : null;
  }
  try {
    const sb = await ensureClient();
    const { data } = await sb.from('profiles').select('id, username, avatar_url').eq('is_admin', true).limit(1);
    return data?.[0] || null;
  } catch (e) {
    console.error('[ideas] dev contact:', e);
    return null;
  }
}

/**
 * Для админа: удалить контент по жалобе и закрыть её как 'actioned'.
 * Удаление — штатными delete*; в реальном режиме права админа даёт
 * RLS-политика *_admin_delete (см. setup.sql).
 */
export async function removeReportedContent(report) {
  const { user } = getState();
  if (!user?.is_admin) throw new Error('Недостаточно прав');
  if (report.target_type === 'question') await deleteQuestion(report.target_id);
  else if (report.target_type === 'answer') await deleteAnswer(report.target_id);
  else if (report.target_type === 'comment') await deleteComment(report.target_id);
  // target_type === 'profile': удалять профиль по жалобе нельзя — модератор
  // разбирается вручную (связывается с владельцем / скрывает реквизиты) и
  // просто закрывает жалобу как обработанную.
  await setReportStatus(report.id, 'actioned');
}

// ============================================================
// ДОНАТЫ / ПОДДЕРЖКА (recipient_user_id = null → поддержка проекта)
// Сейчас статус 'intent' (намерение): реальные платежи включаются
// флагом CONFIG.ENABLE_DONATIONS и провайдером на этапе монетизации.
// ============================================================

/**
 * Отметка донора «Я перевёл» (заход 2026-10-13): строка donations
 * (kind='paid', status='intent') + уведомление получателю с суммой и
 * donationId — автор сверяет с поступлением в банке. Платформа деньги
 * НЕ проводит (модель A): это именно отметка о внешнем переводе.
 */
export async function markDonationTransfer({ recipientUserId, amount, message = '' }) {
  const { user } = getState();
  if (!user || !recipientUserId || recipientUserId === user.id) return null;
  const notify = (row) => {
    const payload = {
      by: user.username || '', donorId: user.id, amount: row.amount,
      message: String(message || '').slice(0, 140), donationId: row.id,
    };
    if (IS_DEMO) {
      DEMO.notifications.unshift({ id: uid('n-'), user_id: recipientUserId, type: 'support', payload, read: false, created_at: new Date().toISOString() });
      persistDemo();
      return;
    }
    ensureClient().then((sb) => sb.from('notifications').insert({ user_id: recipientUserId, type: 'support', payload }))
      .catch((e) => console.error('[support] notify mark:', e));
  };
  if (IS_DEMO) {
    const row = { id: uid('d-'), donor_id: user.id, recipient_user_id: recipientUserId, amount, currency: 'RUB', message, kind: 'paid', status: 'intent', created_at: new Date().toISOString() };
    DEMO.donations = DEMO.donations || [];
    DEMO.donations.push(row);
    persistDemo();
    notify(row);
    return row;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('donations').insert({ donor_id: user.id, recipient_user_id: recipientUserId, amount, currency: 'RUB', message, kind: 'paid', status: 'intent' }).select().single();
    if (error) throw error;
    notify(data);
    return data;
  } catch (e) {
    console.error('[support] markDonationTransfer:', e);
    return null;
  }
}

/**
 * Кнопка автора «Получено ✓»: статус записи 'done' + уведомление-благодарность
 * донору; исходное уведомление автора помечается confirmed (кнопка гаснет).
 */
export async function confirmDonation(donationId) {
  const { user } = getState();
  if (!user) return false;
  const notifyDonor = (row) => {
    if (!row?.donor_id) return;
    const payload = { by: user.username || '', amount: row.amount || 0, done: true, authorId: user.id };
    if (IS_DEMO) {
      DEMO.notifications.unshift({ id: uid('n-'), user_id: row.donor_id, type: 'support', payload, read: false, created_at: new Date().toISOString() });
      for (const n of DEMO.notifications) {
        if (n.type === 'support' && n.payload?.donationId === donationId && n.user_id === user.id) n.payload.confirmed = true;
      }
      persistDemo();
      return;
    }
    ensureClient().then((sb) => sb.from('notifications').insert({ user_id: row.donor_id, type: 'support', payload }))
      .catch((e) => console.error('[support] notify done:', e));
  };
  if (IS_DEMO) {
    const row = (DEMO.donations || []).find((d) => d.id === donationId);
    if (!row || row.recipient_user_id !== user.id) return false;
    row.status = 'done';
    row.confirmed_at = new Date().toISOString();
    persistDemo();
    notifyDonor(row);
    return true;
  }
  try {
    const sb = await ensureClient();
    const { data: row } = await sb.from('donations').select('*').eq('id', donationId).eq('recipient_user_id', user.id).maybeSingle();
    if (!row) return false;
    await sb.from('donations').update({ status: 'done' }).eq('id', donationId);
    notifyDonor(row);
    return true;
  } catch (e) {
    console.error('[support] confirmDonation:', e);
    return false;
  }
}

/** Отметки о переводах автора (kind='paid', свежие сверху) + имя донора */
export async function fetchDonationsFor(userId) {
  if (!userId) return [];
  if (IS_DEMO) {
    return (DEMO.donations || [])
      .filter((d) => d.recipient_user_id === userId && d.kind === 'paid')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((d) => ({ ...d, donor_name: DEMO.profiles.find((x) => x.id === d.donor_id)?.username || d.donor_id }));
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('donations')
      .select('*, donor:profiles(username)')
      .eq('recipient_user_id', userId).eq('kind', 'paid')
      .order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return (data || []).map((d) => ({ ...d, donor_name: d.donor?.username || d.donor_id }));
  } catch (e) {
    console.error('[support] fetchDonationsFor:', e);
    return [];
  }
}

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

export async function recordDonation({ recipient_user_id = null, amount = 0, currency = 'RUB', message = '', kind = 'paid' }) {
  const { user } = getState();
  if (!user) return null;
  const notifyThanks = () => {
    // «Спасибо» — бесплатное: уведомление получателю в колокольчик (type 'support')
    if (kind !== 'thanks' || !recipient_user_id || recipient_user_id === user.id) return;
    const payload = { by: user.username || '', message: String(message || '').slice(0, 140), donorId: user.id };
    if (IS_DEMO) {
      DEMO.notifications.unshift({ id: uid('n-'), user_id: recipient_user_id, type: 'support', payload, read: false, created_at: new Date().toISOString() });
      persistDemo();
      return;
    }
    ensureClient().then((sb) => sb.from('notifications').insert({ user_id: recipient_user_id, type: 'support', payload }))
      .catch((e) => console.error('[support] notify:', e));
  };
  if (IS_DEMO) {
    const row = { id: uid('d-'), donor_id: user.id, recipient_user_id, amount, currency, message, kind, status: 'intent', created_at: new Date().toISOString() };
    DEMO.donations = DEMO.donations || [];
    DEMO.donations.push(row);
    persistDemo();
    notifyThanks();
    return row;
  }
  try {
    const sb = await ensureClient();
    const { data, error } = await sb.from('donations').insert({ donor_id: user.id, recipient_user_id, amount, currency, message, kind, status: 'intent' }).select().single();
    if (error) throw error;
    notifyThanks();
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

/** Заход 47: отметить прочитанной ОДНУ уведомление (клик в панели) */
export async function markNotificationRead(id) {
  const { user } = getState();
  if (!user) return false;
  if (IS_DEMO) {
    const n = DEMO.notifications.find((x) => x.id === id && x.user_id === user.id);
    if (!n || n.read) return false;
    n.read = true;
    persistDemo();
    return true;
  }
  try {
    const sb = await ensureClient();
    const { error } = await sb.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user.id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[notifications] read:', e);
    return false;
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
