// ============================================================
// profile.mjs — профиль пользователя:
// • аватар (с возможностью замены), имя, био
// • ссылки: кнопка «+» → вставка URL → автораспознавание
//   платформы и логотип (inline SVG)
// • софт: модалка выбора DAW из общего справочника (+ свой через «+»)
// • навыки (теги), статистика, достижения
// • вкладки «Мои вопросы / Мои ответы / Избранное»
// ============================================================

import { t, tp, getLocale, applyTranslations } from './i18n.mjs';
import { CONFIG } from './config.mjs';
import {
  fetchProfile, fetchAnswersByUser, fetchFavorites, updateProfile,
  fetchDawCatalog, addDawToCatalog, uploadAvatar, uploadAudio, ensureProfileRow,
  fetchSubscriptions, toggleSubscription,
  fetchShowcase, addShowcaseTrack, deleteShowcaseTrack,
  fetchSynthCatalog, addSynthToCatalog, fetchSupportCount,
} from './supabase.mjs';
import { getState, setState } from './store.mjs';
import { escapeHtml, initials, timeAgo, toast, openModal, confirmModal, dawIcon } from './utils.mjs';
import { coverSvg, COVER_STYLES, DEFAULT_COVER_STYLE } from './covers.mjs';
import { stripFormat } from './format.mjs';
import { attachMiniPlayer, normalizeAudio, extractWaveform } from './audio.mjs';
import { renderAchievementsGrid, refreshAchievements } from './achievements.mjs';
import { renderSubscriptionsBlock, toggleTagSubscription, isTagSubscribed } from './subscriptions.mjs';
import { openAvatarCropper } from './cropper.mjs';
import { openSupportModal } from './support.mjs';
import { navigate } from './router.mjs';
import { requireAuth } from './auth.mjs';

// ============================================================
// РАСПОЗНАВАНИЕ ПЛАТФОРМ И ЛОГОТИПЫ (inline SVG)
// ============================================================

/** Человекочитаемые названия платформ (бренды не переводятся) */
const PLATFORM_NAMES = {
  instagram: 'Instagram', youtube: 'YouTube', youtube_music: 'YouTube Music',
  soundcloud: 'SoundCloud', spotify: 'Spotify', bandcamp: 'Bandcamp',
  x: 'X', telegram: 'Telegram', tiktok: 'TikTok', apple_music: 'Apple Music',
  facebook: 'Facebook', vk: 'VK', vk_music: 'VK Музыка',
  yandex_music: 'Яндекс Музыка', zvuk: 'Звук', rutube: 'Rutube', dzen: 'Дзен',
  boosty: 'Boosty', mixcloud: 'Mixcloud', deezer: 'Deezer', tidal: 'Tidal',
  twitch: 'Twitch', discord: 'Discord', patreon: 'Patreon', ok: 'OK.ru',
  whatsapp: 'WhatsApp', lastfm: 'Last.fm',
};

/** Определение платформы по URL (порядок проверок важен) */
export function detectPlatform(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.toLowerCase();
    // Музыкальные сервисы
    if (host.includes('music.yandex')) return 'yandex_music';
    if (host.includes('zvuk.com')) return 'zvuk';
    if (host.includes('music.apple.com')) return 'apple_music';
    if (host.includes('music.youtube.com')) return 'youtube_music';
    if (host.includes('vk.com') || host.includes('vk.ru')) {
      return (path.startsWith('/audio') || path.startsWith('/music') || host.startsWith('music.')) ? 'vk_music' : 'vk';
    }
    if (host.includes('soundcloud.com')) return 'soundcloud';
    if (host.includes('spotify.com')) return 'spotify';
    if (host.includes('bandcamp.com')) return 'bandcamp';
    if (host.includes('mixcloud.com')) return 'mixcloud';
    if (host.includes('deezer.com')) return 'deezer';
    if (host.includes('tidal.com')) return 'tidal';
    if (host.includes('last.fm') || host.includes('lastfm')) return 'lastfm';
    // Видео и стриминг
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('rutube.ru')) return 'rutube';
    if (host.includes('twitch.tv')) return 'twitch';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('dzen.ru')) return 'dzen';
    // Соцсети и мессенджеры
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
    if (host.includes('t.me') || host.includes('telegram')) return 'telegram';
    if (host.includes('facebook.com')) return 'facebook';
    if (host.includes('ok.ru') || host.includes('odnoklassniki.ru')) return 'ok';
    if (host.includes('wa.me') || host.includes('whatsapp.com')) return 'whatsapp';
    if (host.includes('discord.gg') || host.includes('discord.com')) return 'discord';
    // Поддержка авторов
    if (host.includes('boosty.to')) return 'boosty';
    if (host.includes('patreon.com')) return 'patreon';
    return 'link';
  } catch {
    return null; // невалидный URL
  }
}

// Брендовые цвета платформ
const BRAND = {
  youtube: '#FF0000', youtube_music: '#FF0000', instagram: 'GRADIENT',
  spotify: '#1DB954', soundcloud: '#FF5500', bandcamp: '#629AA9',
  x: '#FFFFFF', telegram: '#2AABEE', tiktok: '#FFFFFF', apple_music: '#FA243C',
  facebook: '#1877F2', vk: '#0077FF', vk_music: '#0077FF',
  yandex_music: '#FFCC00', zvuk: '#21A038', rutube: '#00B9FF', dzen: '#FFFFFF',
  boosty: '#F15F16', mixcloud: '#5000FF', deezer: '#A238FF', tidal: '#FFFFFF',
  twitch: '#9146FF', discord: '#5865F2', patreon: '#FF424D', ok: '#EE8208',
  whatsapp: '#25D366', lastfm: '#D51007',
};

// Фигуры иконок. Маркер __FILL__ внутри тега = залить брендовым цветом.
const ICON_PATHS = {
  youtube: '<path d="M23 12s0-3.9-.5-5.8c-.3-1-1.1-1.9-2.1-2.1C18.5 3.5 12 3.5 12 3.5s-6.5 0-8.4.6c-1 .2-1.8 1.1-2.1 2.1C1 8.1 1 12 1 12s0 3.9.5 5.8c.3 1 1.1 1.9 2.1 2.1 1.9.6 8.4.6 8.4.6s6.5 0 8.4-.6c1-.2 1.8-1.1 2.1-2.1.5-1.9.5-5.8.5-5.8zM9.8 15.6v-7.2l6.2 3.6-6.2 3.6z" __FILL__/>',
  instagram: '<rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4.3"/><circle cx="17.6" cy="6.4" r="1.2" __FILL__/>',
  spotify: '<circle cx="12" cy="12" r="9.5"/><path d="M7.2 9.6c3.3-.9 6.6-.6 9.4.8M7.8 12.6c2.7-.7 5.4-.5 7.8.7M8.4 15.5c2.2-.6 4.4-.4 6.3.6" stroke-width="1.7"/>',
  soundcloud: '<path d="M3 16.5v-3.5M6 17.5v-6M9 17.5v-8M12 17.5v-6.5"/><path d="M14.5 17.5h4.2a2.8 2.8 0 0 0 .5-5.6 4.4 4.4 0 0 0-8.4 1.4" stroke-width="1.7"/>',
  bandcamp: '<path d="M3.5 17.5h17L15.8 6.5h-17z" __FILL__/>',
  x: '<path d="M4.5 4.5l15 15M19.5 4.5l-15 15" stroke-width="2.4"/>',
  telegram: '<path d="M21.5 4.2L2.8 11.8l6.1 2.4 2.1 6.3 3.2-4.2 4.9 3.9 2.4-16z" __FILL__/>',
  tiktok: '<path d="M14.2 3v10.9a3.6 3.6 0 1 1-3.1-3.6"/><path d="M14.2 3c.5 2.4 2 3.9 4.5 4.2" stroke-width="2"/>',
  apple_music: '<circle cx="8.5" cy="16.5" r="2.8" __FILL__/><circle cx="17.5" cy="14.5" r="2.8" __FILL__/><path d="M11.3 16.5V7l9-2v9.5"/>',
  facebook: '<path d="M14.5 8.5H17V5h-2.5c-2.2 0-3.5 1.5-3.5 3.5V11H8.5v3.5H11V22h3.5v-7.5H17L17.5 11h-3V9c0-.4.2-.5.5-.5z" __FILL__/>',
  vk: '<path d="M4 7h3c.5 2.5 1.5 4.5 2.5 5V7h3v4.5c1.2-.5 2.2-2.3 2.7-4.5h3c-.5 2.8-1.8 4.8-3 5.9 1.2 1 2.6 2.8 3.3 5.6h-3.2c-.7-2-1.8-3.4-3-4.2V17h-1.3c-3 0-5-3-5.9-6.5H4z" __FILL__/>',
  zvuk: '<path d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4" stroke-width="2.2"/>',
  rutube: '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M10.2 9.3l5 2.7-5 2.7z" __FILL__/>',
  dzen: '<path d="M12 2.2l1.9 7.9 7.9 1.9-7.9 1.9L12 21.8l-1.9-7.9L2.2 12l7.9-1.9z" __FILL__/>',
  boosty: '<circle cx="12" cy="12" r="9.5"/><path d="M13.3 6.5L9 13h3.2l-1 4.5L15.5 11h-3.2z" __FILL__/>',
  mixcloud: '<path d="M7.5 18a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.2A3.4 3.4 0 0 1 17 18z"/><path d="M11 14.5v-4M14 15.5v-6" stroke-width="1.7"/>',
  deezer: '<path d="M4 17h4v3H4zM10 17h4v3h-4zM16 17h4v3h-4zM10 12.5h4v3h-4zM16 12.5h4v3h-4zM16 8h4v3h-4z" __FILL__/>',
  tidal: '<path d="M8.5 4L12 7.5 8.5 11 5 7.5zM15.5 4L19 7.5 15.5 11 12 7.5zM8.5 11L12 14.5 8.5 18 5 14.5z" __FILL__/>',
  twitch: '<path d="M4.5 3h15v10.5L15 18h-3.5l-3 3v-3H4.5z" __FILL__/><path d="M11 7.5v4.5M15 7.5v4.5" stroke="#0d0d0f" stroke-width="1.8"/>',
  discord: '<path d="M8.5 5.5C6 6.2 4.5 8 4 11c-.3 2.4.5 5.5 2.5 7.5 1-1 1.5-1.5 1.5-1.5M15.5 5.5c2.5.7 4 2.5 4.5 5.5.3 2.4-.5 5.5-2.5 7.5-1-1-1.5-1.5-1.5-1.5"/><circle cx="9.3" cy="12.5" r="1.3" __FILL__/><circle cx="14.7" cy="12.5" r="1.3" __FILL__/><path d="M8.5 5.5h7M6 18.5l-1.5.5M18 18.5l1.5.5"/>',
  patreon: '<circle cx="9.5" cy="9.5" r="5.5" __FILL__/><path d="M18.5 4v16" stroke-width="3"/>',
  ok: '<circle cx="12" cy="8" r="4"/><path d="M12 12v4M9 19l3-3 3 3M8.5 15.5l7 0" stroke-width="1.8"/>',
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3z"/><path d="M8.7 8.2c.4-.1.8 0 1 .4l.7 1.3c.1.3.1.6-.1.8l-.5.6c-.1.2-.2.4 0 .7.4.8 1.4 1.7 2.3 2.1.3.1.5 0 .7-.1l.5-.5c.2-.2.5-.3.8-.2l1.3.6c.4.2.5.6.4 1-.2.7-.9 1.3-1.7 1.4-2.8.2-6.4-3.2-6.5-6.3 0-.8.4-1.6 1.1-2z" __FILL__/>',
  lastfm: '<path d="M4 16c2-6 4-9 5.5-9S11 9 12 12c.8 2.4 1.5 4 3 4s2.5-1.5 2.5-3.5" stroke-width="1.9"/><circle cx="18" cy="8" r="2" stroke-width="1.7"/>',
};

/**
 * Логотип платформы в фирменных цветах (inline SVG).
 * Для неизвестного домена — буква домена в медном кружке.
 * @param {string} platform
 * @param {string} url — для фолбэка (буква домена)
 * @param {number} size — размер в px
 */
export function platformIcon(platform, url = '', size = 15) {
  if (platform === 'link' || (!ICON_PATHS[platform] && platform !== 'yandex_music')) {
    let letter = '?';
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      letter = (host[0] || '?').toUpperCase();
    } catch { /* остаётся '?' */ }
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="#cd7f32" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><text x="12" y="16.4" text-anchor="middle" font-size="12" font-weight="700" font-family="monospace" fill="#cd7f32" stroke="none">${escapeHtml(letter)}</text></svg>`;
  }

  // Яндекс Музыка — особый случай: жёлтый круг + чёрная нота
  if (platform === 'yandex_music') {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FFCC00"/><circle cx="9.8" cy="15.8" r="2.4" fill="#000"/><path d="M12.2 15.8V6.8l4.6-1.2v2.4l-4.6 1.2" fill="none" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }

  const color = BRAND[platform] || '#cd7f32';
  // Instagram — фирменный градиент
  const isGradient = color === 'GRADIENT';
  const paint = isGradient ? 'url(#sh-ig-grad)' : color;
  const defs = isGradient
    ? '<defs><linearGradient id="sh-ig-grad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FFC107"/><stop offset=".45" stop-color="#F44336"/><stop offset=".75" stop-color="#D81B60"/><stop offset="1" stop-color="#9C27B0"/></linearGradient></defs>'
    : '';

  // __FILL__ (внутри тега) → заливка брендовым цветом без обводки
  const body = ICON_PATHS[platform].replaceAll('__FILL__', `fill="${paint}" stroke="none"`);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="${paint}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${defs}${body}</svg>`;
}

/** Отображаемое имя ссылки: название платформы или домен */
function linkDisplayName(link) {
  if (link.platform && link.platform !== 'link' && PLATFORM_NAMES[link.platform]) {
    return PLATFORM_NAMES[link.platform];
  }
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return link.url;
  }
}

/**
 * «Глубокая» ссылка для перехода: для YouTube добавляем sub_confirmation=1 —
 * платформа сама покажет свой диалог «Подписаться на канал?» в один клик.
 * Остальные сервисы открываем как есть (кнопка Follow/Вступить у них на виду).
 */
function externalHref(link) {
  if (link.platform === 'youtube') {
    try {
      const u = new URL(link.url);
      if (u.hostname.includes('youtube.com') && !u.searchParams.has('sub_confirmation')) {
        u.searchParams.set('sub_confirmation', '1');
      }
      return u.toString();
    } catch { /* невалидный URL отдаём как есть */ }
  }
  return link.url;
}

// ============================================================
// РЕНДЕР ПРОФИЛЯ
// ============================================================

export async function renderProfile(container, { userId }, opts = {}) {
  const { user } = getState();
  const editable = opts.editable || (user && user.id === userId);

  // Независимые запросы — параллельно (профиль + достижения + подписки за один раунд)
  let [profile, , subs, showcase, supportCount] = await Promise.all([
    fetchProfile(userId),
    refreshAchievements(),
    user ? fetchSubscriptions().catch(() => []) : Promise.resolve([]),
    fetchShowcase(userId),
    fetchSupportCount(userId),
  ]);
  const subscribedToAuthor = subs.some((s) => s.target_type === 'author' && s.target_id === userId);

  // Самопочинка: сессия есть, а строки профиля нет — создаём её
  if (!profile && editable && user) {
    const created = await ensureProfileRow({ id: user.id, email: user.email }, user.username || '');
    if (created) profile = await fetchProfile(userId);
  }

  if (!profile) {
    container.innerHTML = `<div class="empty-state"><span class="empty-icon">👤</span><p>${escapeHtml(t('profile.not_found'))}</p></div>`;
    return;
  }

  const { achievements } = getState();
  // Ответы уже пришли внутри fetchProfile — отдельный запрос не нужен
  const answers = Array.isArray(profile.answers) ? profile.answers : await fetchAnswersByUser(userId);

  container.innerHTML = `
    <div class="screen">
      <!-- Шапка-обложка: уникальная вейвформа, аватар внахлёст, статистика и DAW внутри -->
      <article class="card profile-head-card" style="cursor:default">
        <div class="profile-cover" aria-hidden="true">${coverSvg(userId, profile.cover_style)}</div>
        <div class="profile-head-actions">
          ${editable
            ? `<button type="button" class="icon-btn" id="btn-edit-profile" title="${escapeHtml(t('profile.settings'))}" aria-label="${escapeHtml(t('profile.settings'))}">⚙️</button>`
            : `<button type="button" class="icon-btn" id="btn-support-user" title="${escapeHtml(t('support.menu_btn'))}" aria-label="${escapeHtml(t('support.menu_btn'))}">☕</button>
               <button type="button" class="icon-btn" id="btn-message" title="${escapeHtml(t('profile.message'))}" aria-label="${escapeHtml(t('profile.message'))}">💬</button>
               <button type="button" class="icon-btn ${subscribedToAuthor ? 'on' : ''}" id="btn-follow-profile"
                 title="${escapeHtml(subscribedToAuthor ? t('profile.following') : t('profile.follow'))}"
                 aria-label="${escapeHtml(subscribedToAuthor ? t('profile.following') : t('profile.follow'))}"
                 aria-pressed="${subscribedToAuthor}">${subscribedToAuthor ? '✓' : '＋'}</button>`}
        </div>
        <div class="profile-head-inner">
          <div class="avatar-slot">
            <span class="avatar lg" id="profile-avatar">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : escapeHtml(initials(profile.username))}</span>
            ${editable ? `<button type="button" class="avatar-edit-btn" id="btn-change-avatar" aria-label="${escapeHtml(t('profile.change_avatar'))}" title="${escapeHtml(t('profile.change_avatar'))}">📷</button>` : ''}
            <input type="file" id="avatar-input" accept="image/*" hidden>
          </div>
          <div class="profile-info">
            <div class="profile-name-row">
              <h1 class="profile-name">${escapeHtml(profile.username)}</h1>
              <span class="profile-rating" title="${escapeHtml(t('profile.stat_rating'))}">👑 ${profile.stats?.rating ?? 0}</span>
              ${profile.open_to_collab ? `<span class="collab-badge" title="${escapeHtml(t('profile.collab'))}">🤝 ${escapeHtml(t('profile.collab'))}</span>` : ''}
            </div>
            ${profile.email && editable ? `<div class="profile-username">${escapeHtml(profile.email)}</div>` : ''}
            <p class="profile-bio">${escapeHtml(profile.bio || t('profile.no_bio'))}</p>
            <div class="profile-links">
              ${(profile.links || []).map((l) => `
                <a class="profile-link link-icon" href="${escapeHtml(externalHref(l))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(linkDisplayName(l))}" aria-label="${escapeHtml(linkDisplayName(l))}">
                  ${platformIcon(l.platform, l.url, 22)}
                </a>`).join('')}
              ${editable ? `<button type="button" class="profile-link add-link-inline" id="btn-quick-add-link" aria-label="${escapeHtml(t('profile.add_link'))}" title="${escapeHtml(t('profile.add_link'))}">＋</button>` : ''}
            </div>
          </div>

          <!-- Статистика полосой -->
          <div class="profile-stats-strip">
            <div class="pstat"><b>${profile.stats?.questions ?? 0}</b><span>${escapeHtml(t('profile.stat_questions'))}</span></div>
            <div class="pstat"><b>${profile.stats?.answers ?? answers.length}</b><span>${escapeHtml(t('profile.stat_answers'))}</span></div>
            <div class="pstat"><b>${profile.stats?.likes ?? 0}</b><span>${escapeHtml(t('profile.stat_likes'))}</span></div>
            <div class="pstat"><b>${profile.stats?.solutions ?? 0}</b><span>${escapeHtml(t('profile.stat_solutions'))}</span></div>
            <div class="pstat"><b>${supportCount}</b><span>☕ ${escapeHtml(t('support.stat_supported'))}</span></div>
          </div>

          <!-- DAW + навыки: полосы внизу шапки -->
          <div class="profile-meta-strips">
            <div class="compact-row">
              <span class="compact-label">🎛️ ${escapeHtml(t('profile.daw'))}</span>
              <span class="daw-row">
                ${(profile.software || []).length ? profile.software.map((s) => `
                  <span class="daw-chip" title="${escapeHtml(s)}" aria-label="${escapeHtml(s)}">${dawIcon(s, 20)}</span>`).join('')
                  : `<span class="compact-empty">${escapeHtml(t('profile.no_daw'))}</span>`}
              </span>
            </div>
            <div class="compact-row">
              <span class="compact-label">🧰 ${escapeHtml(t('profile.arsenal'))}</span>
              <span class="tags-row">
                ${(profile.arsenal || []).length ? profile.arsenal.map((s) => `<span class="tag gear-tag">${escapeHtml(s)}</span>`).join('')
                  : `<span class="compact-empty">${escapeHtml(t('profile.no_arsenal'))}</span>`}
              </span>
            </div>
            <div class="compact-row">
              <span class="compact-label">🏷️ ${escapeHtml(t('profile.skills'))}</span>
              <span class="tags-row" id="profile-skills">
                ${(profile.skills || []).length ? profile.skills.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join('')
                  : `<span class="compact-empty">${escapeHtml(t('profile.no_skills'))}</span>`}
              </span>
            </div>
          </div>
        </div>
      </article>

      <!-- Шоукейс «Моё звучание» -->
      <section class="showcase-block" aria-label="${escapeHtml(t('profile.showcase'))}">
        <div class="showcase-head">
          <h2>🎧 ${escapeHtml(t('profile.showcase'))}</h2>
          ${editable ? `
            <button type="button" class="btn btn-ghost btn-sm" id="btn-add-showcase" ${showcase.length >= 3 ? 'disabled' : ''} title="${escapeHtml(t('profile.showcase_max'))}">＋ ${escapeHtml(t('profile.showcase_add'))}</button>
            <input type="file" id="showcase-input" accept="audio/*" hidden>` : ''}
        </div>
        <div class="showcase-grid" id="showcase-grid">${showcaseHtml(showcase, editable)}</div>
      </section>

      <div class="question-layout" style="margin-top:20px">
        <div>
          <!-- Вкладки -->
          <div class="tabs" role="tablist">
            <button type="button" class="tab-btn active" role="tab" data-tab="questions">${escapeHtml(t('profile.tab_questions'))} (${(profile.questions || []).length})</button>
            <button type="button" class="tab-btn" role="tab" data-tab="answers">${escapeHtml(t('profile.tab_answers'))} (${answers.length})</button>
            ${editable ? `<button type="button" class="tab-btn" role="tab" data-tab="favorites">${escapeHtml(t('profile.tab_favorites'))}</button>` : ''}
          </div>
          <div id="profile-tab-content"><div class="loader"></div></div>

          <!-- Достижения -->
          <section style="margin-top:28px" aria-label="${escapeHtml(t('achievements.title'))}">
            <h2 style="font-size:18px;margin-bottom:14px">🏆 ${escapeHtml(t('achievements.title'))}</h2>
            ${renderAchievementsGrid(achievements)}
          </section>
        </div>

        <!-- Сайдбар: подписки -->
        <aside class="question-sidebar" id="profile-sidebar"></aside>
      </div>
    </div>`;

  applyTranslations(container);
  renderSubscriptionsBlock(container.querySelector('#profile-sidebar'));

  // ---------- Смена аватара ----------
  if (editable) {
    const avatarInput = container.querySelector('#avatar-input');
    container.querySelector('#btn-change-avatar').addEventListener('click', () => avatarInput.click());
    container.querySelector('#profile-avatar').style.cursor = 'pointer';
    container.querySelector('#profile-avatar').addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', () => {
      const file = avatarInput.files[0];
      avatarInput.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast(t('profile.avatar_type_error'), 'error'); return; }
      // Редактор обрезки: пользователь выбирает видимую область до загрузки
      openAvatarCropper(file, async (croppedBlob) => {
        try {
          const avatar_url = await uploadAvatar(croppedBlob);
          await updateProfile({ avatar_url });
          const { user: u } = getState();
          setState({ user: { ...u, avatar_url } });
          toast(t('profile.avatar_updated'));
          renderProfile(container, { userId }, { editable: true });
        } catch (err) {
          toast(err.message || 'Error', 'error');
        }
      });
    });

    // Быстрое добавление ссылки прямо в профиле
    container.querySelector('#btn-quick-add-link')?.addEventListener('click', () => openAddLinkModal(profile, async (links) => {
      await updateProfile({ links });
      const { user: u } = getState();
      setState({ user: { ...u, links } });
      renderProfile(container, { userId }, { editable: true });
    }));
  }

  // ---------- Шоукейс: плееры, добавление, удаление ----------
  container.querySelectorAll('.showcase-card').forEach((card, i) => {
    const track = showcase[i];
    const canvas = card.querySelector('.mini-wave');
    if (canvas && track?.audio_url) attachMiniPlayer(canvas, track.audio_url, track.waveform_data || []);
  });
  container.querySelector('#btn-add-showcase')?.addEventListener('click', () => container.querySelector('#showcase-input').click());
  container.querySelector('#showcase-input')?.addEventListener('change', async () => {
    const file = container.querySelector('#showcase-input').files[0];
    container.querySelector('#showcase-input').value = '';
    if (!file) return;
    try {
      const normalized = await normalizeAudio(file);
      const { peaks } = await extractWaveform(normalized, 160);
      const audio_url = await uploadAudio(normalized, 'question-audio');
      const title = file.name.replace(/\.[^.]+$/, '');
      await addShowcaseTrack({ title, audio_url, waveform_data: peaks });
      toast(t('common.saved'));
      renderProfile(container, { userId }, { editable: true });
    } catch (e) {
      toast(e.message || t('trimmer.error'), 'error');
    }
  });
  container.querySelector('#showcase-grid')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    if (await confirmModal(t('profile.showcase'), t('profile.showcase_del_confirm'))) {
      await deleteShowcaseTrack(btn.dataset.del);
      renderProfile(container, { userId }, { editable: true });
    }
  });

  // ---------- Вкладки ----------
  const tabContent = container.querySelector('#profile-tab-content');
  const tabs = {
    questions: () => questionsListHtml(profile.questions || []),
    answers: () => answersListHtml(answers),
    favorites: async () => {
      const favs = await fetchFavorites();
      return questionsListHtml(favs.map((f) => f.question));
    },
  };

  async function showTab(name) {
    container.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    tabContent.innerHTML = '<div class="loader"></div>';
    tabContent.innerHTML = await tabs[name]();
    tabContent.querySelectorAll('[data-audio][data-wave]').forEach((canvas) => {
      try {
        attachMiniPlayer(canvas, canvas.dataset.audio, JSON.parse(canvas.dataset.wave || '[]'));
      } catch { /* некорректные данные вейвформы */ }
    });
  }

  container.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) showTab(btn.dataset.tab);
  });
  showTab('questions');

  // ---------- Кнопки ----------
  container.querySelector('#btn-edit-profile')?.addEventListener('click', () => openEditProfileModal(profile, container, userId));
  container.querySelector('#btn-message')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    navigate(`/messages/${userId}`);
  });

  // ---------- Поддержать автора ----------
  container.querySelector('#btn-support-user')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    openSupportModal({ recipientUserId: userId, recipientName: profile.username });
  });

  // ---------- Подписка на автора ----------
  container.querySelector('#btn-follow-profile')?.addEventListener('click', async () => {
    if (!requireAuth()) return;
    const nowSub = await toggleSubscription('author', userId);
    const btn = container.querySelector('#btn-follow-profile');
    btn.classList.toggle('on', nowSub);
    btn.textContent = nowSub ? '✓' : '＋';
    const label = nowSub ? t('profile.following') : t('profile.follow');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(nowSub));
    toast(nowSub ? t('subscriptions.subscribed_author') : t('subscriptions.unsubscribed'));
    // Освежаем блок «Подписки» в сайдбаре
    renderSubscriptionsBlock(container.querySelector('#profile-sidebar'));
  });

  // ---------- Клик по навыку → подписка на тег ----------
  container.querySelector('#profile-skills')?.addEventListener('click', async (e) => {
    const tag = e.target.closest('.tag');
    if (!tag || !editable) return;
    const name = tag.textContent.trim();
    if (!(await isTagSubscribed(name))) {
      await toggleTagSubscription(name);
      renderSubscriptionsBlock(container.querySelector('#profile-sidebar'));
    }
  });
}

/** Карточки треков шоукейса */
function showcaseHtml(tracks, editable) {
  if (!tracks.length) return `<p class="compact-empty" style="padding:4px 2px">${escapeHtml(t('profile.showcase_empty'))}</p>`;
  return tracks.map((s) => `
    <div class="card showcase-card" data-shid="${escapeHtml(s.id)}" style="cursor:default">
      <div class="showcase-title">${escapeHtml(s.title || 'track')}</div>
      <canvas class="mini-wave" style="width:100%" role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>
      ${editable ? `<button type="button" class="showcase-del" data-del="${escapeHtml(s.id)}" aria-label="${escapeHtml(t('common.delete'))}" title="${escapeHtml(t('common.delete'))}">✕</button>` : ''}
    </div>`).join('');
}

// ============================================================
// СПИСКИ ВКЛАДОК
// ============================================================

function questionsListHtml(questions) {
  if (!questions.length) return `<div class="empty-state"><p>${escapeHtml(t('profile.no_questions'))}</p></div>`;
  return `<div class="feed-layout">${questions.map((q) => {
    // Архивный вопрос: серая строка статистики (ссылка ведёт на заглушку)
    if (q.purged) {
      const s = q.purge_summary || {};
      const dateStr = s.solved_at
        ? new Date(s.solved_at).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long' })
        : '';
      return `
    <article class="card q-card purged" tabindex="0" onclick="location.href='/question/${escapeHtml(q.id)}'" role="link" style="cursor:pointer">
      <div class="purged-fav">
        <span class="purged-icon" aria-hidden="true">🗃️</span>
        <div class="purged-fav-text">
          <div class="purged-title">${escapeHtml(t('question.purged_title'))}</div>
          <div class="purged-meta">${escapeHtml(t('question.purged_solved_on', { date: dateStr }))} · ${escapeHtml(tp('question.answers_n', s.answers_count ?? 0))}${s.best_username ? ` · ${escapeHtml(t('question.purged_best_label'))} @${escapeHtml(s.best_username)}` : ''}</div>
        </div>
      </div>
    </article>`;
    }
    return `
    <article class="card clickable q-card" tabindex="0" onclick="location.href='/question/${escapeHtml(q.id)}'" role="link">
      <div class="q-card-top">
        <div>
          <h2 class="q-card-title">${escapeHtml(q.title)}</h2>
          <div class="q-card-meta">
            <span class="status-badge ${q.status === 'solved' ? 'status-solved' : 'status-open'}">${q.status === 'solved' ? '✓' : '…'}</span>
            <span>${escapeHtml(timeAgo(q.created_at, getLocale()))}</span>
            ${q.synth ? `<span class="tag">${escapeHtml(q.synth)}</span>` : ''}
            <span class="counter">💬 ${q.answers_count ?? 0}</span>
            <span class="counter">🔥 ${q.likes_count ?? 0}</span>
          </div>
        </div>
        <div class="q-card-audio">
          ${q.audio_url ? `<canvas class="mini-wave" data-audio="${escapeHtml(q.audio_url)}" data-wave='${escapeHtml(JSON.stringify(q.waveform_data || []))}' role="button" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>` : ''}
        </div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function answersListHtml(answers) {
  if (!answers.length) return `<div class="empty-state"><p>${escapeHtml(t('profile.no_answers'))}</p></div>`;
  return `<div class="feed-layout">${answers.map((a) => `
    <article class="card clickable" tabindex="0" onclick="location.href='/question/${escapeHtml(a.question_id || a.question?.id || '')}'" role="link" ${a.is_solution ? 'style="border-color:var(--border-active)"' : ''}>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
        ${a.is_solution ? `<span class="status-badge status-solved">✓ ${escapeHtml(t('question.solution'))}</span>` : ''}
        ${a.sound_type ? `<span class="tag">${escapeHtml(a.sound_type)}</span>` : ''}
        <span style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">${escapeHtml(timeAgo(a.created_at, getLocale()))}</span>
      </div>
      <div class="q-card-title" style="font-size:14.5px">${a.question?.purged ? `🗃️ ${escapeHtml(t('question.purged_title'))}` : escapeHtml(a.question?.title || '')}</div>
      <p class="q-card-desc">${escapeHtml(stripFormat(a.content))}</p>
      <div class="q-card-meta"><span class="counter">🔥 ${a.likes_count ?? 0}</span>${a.preset_url ? '<span>📎 preset</span>' : ''}</div>
    </article>`).join('')}</div>`;
}

// ============================================================
// МОДАЛКА ДОБАВЛЕНИЯ ССЫЛКИ («+» → автораспознавание)
// ============================================================

function openAddLinkModal(profile, onSave) {
  const links = [...(profile.links || [])];
  const content = document.createElement('div');
  content.innerHTML = `
    <div id="links-list" class="profile-links" style="margin-bottom:16px"></div>
    <div class="field">
      <div style="display:flex;gap:8px">
        <input type="url" id="link-input" placeholder="${escapeHtml(t('profile.paste_link_ph'))}" style="flex:1" aria-label="${escapeHtml(t('profile.add_link'))}">
        <button type="button" class="btn btn-primary" id="link-add">＋</button>
      </div>
      <div class="hint" id="link-hint">${escapeHtml(t('profile.link_hint'))}</div>
    </div>
    <button type="button" class="btn btn-ghost" id="links-done" style="width:100%">${escapeHtml(t('common.save'))}</button>`;

  const listEl = content.querySelector('#links-list');
  const input = content.querySelector('#link-input');
  const hint = content.querySelector('#link-hint');

  const redraw = () => {
    listEl.innerHTML = links.map((l, i) => `
      <span class="chip link-chip" title="${escapeHtml(l.url)}">
        ${platformIcon(l.platform, l.url, 17)}
        <span>${escapeHtml(linkDisplayName(l))}</span>
        <button type="button" data-rm="${i}" aria-label="${escapeHtml(t('common.delete'))}">&times;</button>
      </span>`).join('');
    listEl.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => { links.splice(Number(btn.dataset.rm), 1); redraw(); });
    });
  };
  redraw();

  const addLink = () => {
    const url = input.value.trim();
    if (!url) return;
    const platform = detectPlatform(url);
    if (!platform) { hint.textContent = t('profile.link_invalid'); hint.style.color = '#e06a5a'; return; }
    hint.style.color = '';
    const name = PLATFORM_NAMES[platform] || (platform === 'link' ? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })() : platform);
    hint.textContent = `${t('profile.link_detected')}: ${name}`;
    if (!links.some((l) => l.url === url)) links.push({ platform, url });
    input.value = '';
    redraw();
  };

  content.querySelector('#link-add').addEventListener('click', addLink);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
  // Живое распознавание при вставке
  input.addEventListener('input', () => {
    const p = detectPlatform(input.value.trim());
    if (p && p !== 'link') {
      hint.textContent = `${t('profile.link_detected')}: ${PLATFORM_NAMES[p] || p}`;
    } else {
      hint.textContent = t('profile.link_hint');
    }
    hint.style.color = '';
  });

  const close = openModal({ title: t('profile.add_link'), content });
  content.querySelector('#links-done').addEventListener('click', async () => {
    await onSave(links);
    toast(t('common.saved'));
    close();
  });
}

// ============================================================
// УНИВЕРСАЛЬНАЯ МОДАЛКА ВЫБОРА ИЗ КАТАЛОГА (DAW / арсенал)
// ============================================================

async function openCatalogPicker({ title, hint, getCatalog, addCustom, customPh, chosen, onSave, addedToast }) {
  let catalog = await getCatalog();
  const selected = new Set(chosen);

  const content = document.createElement('div');
  content.innerHTML = `
    <p style="color:var(--text-secondary);font-size:13.5px;margin-bottom:14px">${escapeHtml(hint)}</p>
    <div class="daw-grid" id="cat-grid"></div>
    <div class="field" style="margin-top:16px">
      <div style="display:flex;gap:8px">
        <input type="text" id="cat-custom" placeholder="${escapeHtml(customPh)}" style="flex:1" aria-label="${escapeHtml(customPh)}">
        <button type="button" class="btn btn-ghost" id="cat-add-custom" aria-label="${escapeHtml(t('common.add'))}">＋</button>
      </div>
    </div>
    <button type="button" class="btn btn-primary" id="cat-save" style="width:100%">${escapeHtml(t('common.save'))}</button>`;

  const grid = content.querySelector('#cat-grid');
  const drawGrid = () => {
    grid.innerHTML = catalog.map((d) => `
      <button type="button" class="daw-option ${selected.has(d) ? 'selected' : ''}" data-item="${escapeHtml(d)}" aria-pressed="${selected.has(d)}">
        ${dawIcon(d, 18)} ${escapeHtml(d)}
      </button>`).join('');
  };
  drawGrid();

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-item]');
    if (!btn) return;
    const name = btn.dataset.item;
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    btn.classList.toggle('selected', selected.has(name));
    btn.setAttribute('aria-pressed', String(selected.has(name)));
  });

  // Свой вариант через «+» — попадает в общий справочник
  content.querySelector('#cat-add-custom').addEventListener('click', async () => {
    const input = content.querySelector('#cat-custom');
    const name = input.value.trim();
    if (!name) return;
    if (await addCustom(name)) {
      catalog = await getCatalog();
      if (!catalog.includes(name)) catalog.push(name);
      selected.add(name);
      input.value = '';
      drawGrid();
      toast(addedToast);
    }
  });

  const close = openModal({ title, content, wide: true });
  content.querySelector('#cat-save').addEventListener('click', async () => {
    await onSave([...selected]);
    close();
  });
}

// ============================================================
// РЕДАКТИРОВАНИЕ ПРОФИЛЯ
// ============================================================

// ============================================================
// НАСТРОЙКИ ПРОФИЛЯ — модалка с автосохранением.
// Кнопки «Сохранить» нет: текстовые поля сохраняются с debounce,
// переключатели/пикеры (обложка, коллаборации, DAW, арсенал, ссылки,
// навыки) — мгновенно. Смена языка интерфейса тоже здесь (переехала
// из шапки): применяется сразу, хранится в localStorage (i18n.mjs).
// ============================================================

/** Самоназвания языков (не переводятся — всегда на своём языке) */
const LANG_NATIVE = { ru: 'Русский', en: 'English', de: 'Deutsch' };

const AUTOSAVE_TEXT_DELAY = 700;  // мс, debounce текстовых полей
const AUTOSAVE_CHIPS_DELAY = 400; // мс, debounce чипсов навыков

function openEditProfileModal(profile, container, userId) {
  let software = [...(profile.software || [])];
  let arsenal = [...(profile.arsenal || [])];
  let coverStyle = COVER_STYLES.some((s) => s.id === profile.cover_style)
    ? profile.cover_style
    : DEFAULT_COVER_STYLE;

  // Переключатель языка: те же классы .lang-switcher, что были в шапке;
  // активную кнопку поддерживает updateSwitcherUI() из i18n.mjs
  const langSwitcherHtml = CONFIG.LOCALES.map((code) => {
    const full = LANG_NATIVE[code] || code.toUpperCase();
    const active = code === getLocale();
    return `<button type="button" data-lang="${code}"${active ? ' class="active"' : ''}
              aria-pressed="${active}" aria-label="${escapeHtml(full)}" title="${escapeHtml(full)}">${code.toUpperCase()}</button>`;
  }).join('');

  const content = document.createElement('div');
  content.innerHTML = `
    <form id="edit-form">
      <!-- Язык интерфейса (переехал из шапки) -->
      <div class="field">
        <label id="ed-lang-label" data-i18n="profile.language">${escapeHtml(t('profile.language'))}</label>
        <div class="lang-switcher" role="group" aria-labelledby="ed-lang-label">${langSwitcherHtml}</div>
        <div class="hint" data-i18n="profile.language_hint">${escapeHtml(t('profile.language_hint'))}</div>
      </div>

      <div class="field">
        <label for="ed-username" data-i18n="auth.username">${escapeHtml(t('auth.username'))}</label>
        <input type="text" id="ed-username" value="${escapeHtml(profile.username || '')}" maxlength="24">
      </div>
      <div class="field">
        <label for="ed-bio" data-i18n="profile.bio">${escapeHtml(t('profile.bio'))}</label>
        <textarea id="ed-bio" rows="3">${escapeHtml(profile.bio || '')}</textarea>
      </div>

      <!-- Обложка: выбор стиля вейвформы -->
      <div class="field">
        <label id="ed-cover-label" data-i18n="profile.cover">${escapeHtml(t('profile.cover'))}</label>
        <div class="hint" style="margin:-4px 0 8px" data-i18n="profile.cover_hint">${escapeHtml(t('profile.cover_hint'))}</div>
        <div class="cover-picker" id="ed-cover-picker" role="radiogroup"
             aria-labelledby="ed-cover-label"></div>
      </div>

      <!-- Ссылки: только кнопка «+» -->
      <div class="field">
        <label data-i18n="profile.links">${escapeHtml(t('profile.links'))}</label>
        <button type="button" class="btn btn-ghost btn-sm" id="ed-add-links">＋ <span data-i18n="profile.add_link">${escapeHtml(t('profile.add_link'))}</span></button>
      </div>

      <!-- DAW: модалка выбора -->
      <div class="field">
        <label data-i18n="profile.daw">${escapeHtml(t('profile.daw'))}</label>
        <div id="ed-daw-preview" class="software-row" style="margin-bottom:8px"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="ed-pick-daw">🎛️ <span data-i18n="profile.choose_daw">${escapeHtml(t('profile.choose_daw'))}</span></button>
      </div>

      <!-- Арсенал: мои плагины и синтезаторы -->
      <div class="field">
        <label data-i18n="profile.arsenal">${escapeHtml(t('profile.arsenal'))}</label>
        <div id="ed-arsenal-preview" class="tags-row" style="margin-bottom:8px"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="ed-pick-arsenal">🧰 <span data-i18n="profile.choose_arsenal">${escapeHtml(t('profile.choose_arsenal'))}</span></button>
      </div>

      <!-- Статус коллабораций -->
      <div class="field">
        <label class="switch">
          <input type="checkbox" id="ed-collab" ${profile.open_to_collab ? 'checked' : ''}>
          <span class="slider" aria-hidden="true"></span>
          <span data-i18n="profile.collab_toggle">${escapeHtml(t('profile.collab_toggle'))}</span>
        </label>
      </div>

      <!-- Навыки (теги) -->
      <div class="field">
        <label data-i18n="profile.skills">${escapeHtml(t('profile.skills'))}</label>
        <div class="chips-input-wrap" id="ed-skills"><input type="text" placeholder="${escapeHtml(t('profile.skills_ph'))}" data-i18n-placeholder="profile.skills_ph"></div>
      </div>

      <!-- Автосохранение: статус + «Готово» -->
      <div class="settings-footer">
        <span class="autosave-status" id="ed-autosave" role="status" aria-live="polite"></span>
        <button type="button" class="btn btn-primary" id="ed-done"><span data-i18n="profile.done">${escapeHtml(t('profile.done'))}</span></button>
      </div>
    </form>`;

  // ---------- Автосохранение ----------
  // Текстовые поля — с debounce, остальное — мгновенно. Все сохранения
  // идут через одну последовательную очередь (saveQueue), поэтому
  // поздние изменения не могут перезаписать ранние при гонке сети.
  const statusEl = content.querySelector('#ed-autosave');
  const nameInput = content.querySelector('#ed-username');
  const bioInput = content.querySelector('#ed-bio');
  const collabInput = content.querySelector('#ed-collab');
  const skills = [...(profile.skills || [])];

  let saveQueue = Promise.resolve();
  let saveTimer = null;
  let statusTimer = null;
  let statusMode = 'idle';
  let dirtyEver = false;                       // были изменения — при закрытии обновим экран
  let lastSavedName = (profile.username || '').trim();

  function setStatus(mode) {
    statusMode = mode;
    clearTimeout(statusTimer);
    statusEl.classList.remove('saving', 'saved');
    if (mode === 'saving') {
      statusEl.classList.add('saving');
      statusEl.textContent = t('profile.saving');
    } else if (mode === 'saved') {
      statusEl.classList.add('saved');
      statusEl.textContent = t('common.saved');
      statusTimer = setTimeout(() => setStatus('idle'), 2500);
    } else {
      statusEl.textContent = t('profile.settings_hint');
    }
  }

  function currentPatch() {
    return {
      username: nameInput.value.trim() || lastSavedName,
      bio: bioInput.value.trim(),
      links: profile.links || [],
      software,
      skills,
      arsenal,
      cover_style: coverStyle,
      open_to_collab: collabInput.checked,
    };
  }

  /** Немедленно сохранить текущее состояние настроек */
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    // Защита от пустого имени: в БД пустое значение не попадёт никогда
    // (currentPatch подставляет lastSavedName), а отображаемое значение
    // возвращаем, только когда поле НЕ редактируют. Иначе debounce,
    // сработавший посреди набора (стёрли имя → задумались), подставит
    // старое имя под курсор — текст начнёт «склеиваться».
    if (!nameInput.value.trim() && document.activeElement !== nameInput) {
      nameInput.value = lastSavedName;
    }
    dirtyEver = true;
    const patch = currentPatch();
    setStatus('saving');
    saveQueue = saveQueue.then(async () => {
      try {
        await updateProfile(patch);
        Object.assign(profile, patch);
        lastSavedName = patch.username;
        const { user } = getState();
        if (user) setState({ user: { ...user, ...patch } });
        setStatus('saved');
      } catch (err) {
        setStatus('idle');
        toast(err.message || t('profile.save_failed'), 'error');
      }
    });
    return saveQueue;
  }

  /** Отложенное сохранение (текстовые поля, чипсы) */
  function scheduleSave(delay = AUTOSAVE_TEXT_DELAY) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }

  /** Дождаться незавершённых сохранений (вызывается при закрытии) */
  function flushSave() {
    if (saveTimer) saveNow();
    return saveQueue;
  }

  setStatus('idle');
  nameInput.addEventListener('input', () => scheduleSave());
  // Фокус ушёл из пустого поля — возвращаем последнее сохранённое имя.
  // Во время ввода поле не трогаем (см. комментарий в saveNow).
  nameInput.addEventListener('blur', () => {
    if (!nameInput.value.trim()) nameInput.value = lastSavedName;
  });
  bioInput.addEventListener('input', () => scheduleSave());
  collabInput.addEventListener('change', () => saveNow());

  // Обложка: живые превью всех стилей, выбор кликом (radio-семантика)
  const coverPicker = content.querySelector('#ed-cover-picker');
  const drawCoverPicker = () => {
    coverPicker.innerHTML = COVER_STYLES.map((s) => `
      <button type="button" class="cover-opt${s.id === coverStyle ? ' selected' : ''}"
              data-cover="${s.id}" role="radio" aria-checked="${s.id === coverStyle}"
              title="${escapeHtml(t(`profile.cover_${s.id}`))}"
              aria-label="${escapeHtml(t(`profile.cover_${s.id}`))}">
        <span class="cover-opt-wave" aria-hidden="true">${coverSvg(userId, s.id)}</span>
        <span class="cover-opt-name">${escapeHtml(t(`profile.cover_${s.id}`))}</span>
      </button>`).join('');
  };
  drawCoverPicker();
  coverPicker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cover]');
    if (!btn || btn.dataset.cover === coverStyle) return;
    coverStyle = btn.dataset.cover;
    drawCoverPicker();
    // сразу видно результат: перерисовываем обложку профиля под модалкой
    const cover = container.querySelector('.profile-cover');
    if (cover) cover.innerHTML = coverSvg(userId, coverStyle);
    saveNow(); // автосохранение: выбор стиля фиксируется сразу
  });

  // Текущие ссылки — через отдельную модалку «+»
  content.querySelector('#ed-add-links').addEventListener('click', () => {
    openAddLinkModal(profile, async (links) => {
      profile.links = links;
      await saveNow(); // автосохранение сразу после «Готово» во вложенной модалке
    });
  });

  // DAW-превью и модалка
  const dawPreview = content.querySelector('#ed-daw-preview');
  const drawDaw = () => {
    dawPreview.innerHTML = software.length
      ? software.map((s) => `<span class="software-chip">${dawIcon(s, 16)} ${escapeHtml(s)}</span>`).join('')
      : `<span style="font-size:12.5px;color:var(--text-muted)">${escapeHtml(t('profile.no_daw'))}</span>`;
  };
  drawDaw();
  content.querySelector('#ed-pick-daw').addEventListener('click', () => {
    openCatalogPicker({
      title: t('profile.choose_daw'), hint: t('profile.daw_hint'),
      getCatalog: fetchDawCatalog, addCustom: addDawToCatalog,
      customPh: t('profile.daw_other_ph'), chosen: software,
      addedToast: t('profile.daw_added'),
      onSave: async (chosen) => { software = chosen; drawDaw(); await saveNow(); },
    });
  });

  // Арсенал: превью-теги + пикер из справочника синтезаторов
  const arsenalPreview = content.querySelector('#ed-arsenal-preview');
  const drawArsenal = () => {
    arsenalPreview.innerHTML = arsenal.length
      ? arsenal.map((s) => `<span class="tag gear-tag">${escapeHtml(s)}</span>`).join('')
      : `<span style="font-size:12.5px;color:var(--text-muted)">${escapeHtml(t('profile.no_arsenal'))}</span>`;
  };
  drawArsenal();
  content.querySelector('#ed-pick-arsenal').addEventListener('click', () => {
    openCatalogPicker({
      title: t('profile.choose_arsenal'), hint: t('profile.arsenal_hint'),
      getCatalog: fetchSynthCatalog, addCustom: addSynthToCatalog,
      customPh: t('ask.custom_synth_ph'), chosen: arsenal,
      addedToast: t('ask.custom_synth_added'),
      onSave: async (chosen) => { arsenal = chosen; drawArsenal(); await saveNow(); },
    });
  });

  // Чипсы навыков (массив skills объявлен выше — в блоке автосохранения)
  const wrap = content.querySelector('#ed-skills');
  const skillInput = wrap.querySelector('input');
  const redrawSkills = () => {
    wrap.querySelectorAll('.chip').forEach((c) => c.remove());
    skills.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(v)} <button type="button" aria-label="${escapeHtml(t('common.delete'))}">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        skills.splice(i, 1);
        redrawSkills();
        scheduleSave(AUTOSAVE_CHIPS_DELAY);
      });
      wrap.insertBefore(chip, skillInput);
    });
  };
  skillInput.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && skillInput.value.trim()) {
      e.preventDefault();
      skills.push(skillInput.value.trim());
      skillInput.value = '';
      redrawSkills();
      scheduleSave(AUTOSAVE_CHIPS_DELAY);
    }
  });
  redrawSkills();

  const close = openModal({
    title: t('profile.settings'),
    content,
    wide: true,
    onMount: (overlay) => {
      // Заголовок тоже переводимый: при смене языка его обновит applyTranslations
      overlay.querySelector('.modal-head h2')?.setAttribute('data-i18n', 'profile.settings');
    },
  });

  // Смена языка при открытой модалке: статические тексты переводит
  // applyTranslations(document) по data-i18n-атрибутам, здесь перерисовываем
  // только части, собранные вызовами t() (пикер обложки, превью, чипсы, статус).
  const onLangChange = () => {
    drawCoverPicker();
    drawDaw();
    drawArsenal();
    redrawSkills();
    setStatus(statusMode);
  };
  document.addEventListener('i18n:changed', onLangChange);

  // «Готово» (или Enter в поле) — дожидаемся отложенных сохранений и закрываем
  const done = async () => {
    await flushSave();
    close();
  };
  content.querySelector('#ed-done').addEventListener('click', done);
  content.querySelector('#edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    done();
  });

  // Закрытие любым способом (✕ / Escape / клик по фону / «Готово») ловим по
  // удалению СВОЕГО контента из DOM — вложенные модалки (DAW / арсенал / ссылки)
  // его не снимают. При закрытии: завершаем незавершённые сохранения и
  // обновляем экран профиля, чтобы всё автосохранённое было сразу видно.
  const closeObserver = new MutationObserver(() => {
    if (!document.body.contains(content)) {
      closeObserver.disconnect();
      document.removeEventListener('i18n:changed', onLangChange);
      clearTimeout(statusTimer);
      flushSave().then(() => {
        if (dirtyEver) {
          dirtyEver = false;
          renderProfile(container, { userId }, { editable: true });
        }
      });
    }
  });
  closeObserver.observe(document.getElementById('modal-root'), { childList: true, subtree: true });
}