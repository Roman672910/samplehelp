// ============================================================
// profile.mjs — профиль пользователя:
// • аватар (с возможностью замены), имя, био
// • ссылки: кнопка «+» → вставка URL → автораспознавание
//   платформы и логотип (inline SVG)
// • софт: модалка выбора DAW из общего справочника (+ свой через «+»)
// • контакты (📇) и способы приёма (💳 «Поддержать автора»: СБП + карта) вместо навыков
// • статистика, достижения
// • вкладки «Мои вопросы / Мои ответы / Избранное»
// ============================================================

import { t, tp, getLocale, applyTranslations } from './i18n.mjs';
import {
  fetchProfile, fetchAnswersByUser, fetchFavorites, updateProfile,
  fetchDawCatalog, addDawToCatalog, uploadAvatar, ensureProfileRow,
  fetchSubscriptions, toggleSubscription,
  fetchBestAnswers,
  fetchSynthCatalog, addSynthToCatalog, fetchSupportCount,
} from './api.mjs';
import { getState, setState } from './store.mjs';
import { escapeHtml, initials, timeAgo, toast, openModal, confirmModal, dawIcon } from './utils.mjs';
import { coverSvg, COVER_STYLES, DEFAULT_COVER_STYLE } from './covers.mjs';
import { stripFormat } from './format.mjs';
import { attachMiniPlayer } from './audio.mjs';
import { renderAchievementsGrid, refreshAchievements } from './achievements.mjs';
import { renderSubscriptionsBlock } from './subscriptions.mjs';
import {
  collabBadgeHtml, openContactsModal, contactEditorRowHtml,
  validateContact, normalizeContacts, MAX_CONTACTS,
  CONTACT_KINDS, CONTACT_ICONS,
} from './contacts.mjs';
import { openReportModal } from './moderation.mjs';
import { openAvatarCropper } from './cropper.mjs';
import { openSupportModal, normalizeDonateMethods, validateDonateMethod, KIND_ICONS, canonicalBoostyUrl } from './support.mjs';
import { decodeDataUrl, downscaleDataUrl, readAsDataUrl, analyzeQrPayload, renderQrAnalysis, startCameraScan } from './qrscan.mjs';
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
  let [profile, , subs, bestAnswers, supportCount] = await Promise.all([
    fetchProfile(userId),
    refreshAchievements(),
    user ? fetchSubscriptions().catch(() => []) : Promise.resolve([]),
    fetchBestAnswers(userId),
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
            ? `<button type="button" class="icon-btn" id="btn-edit-profile" data-help="profile_settings_btn" title="${escapeHtml(t('profile.settings'))}" aria-label="${escapeHtml(t('profile.settings'))}">⚙️</button>`
            : `<button type="button" class="icon-btn" id="btn-support-user" data-help="support_user_btn" title="${escapeHtml(t('support.title_user_btn'))}" aria-label="${escapeHtml(t('support.title_user_btn'))}">☕</button>
               <button type="button" class="icon-btn" id="btn-message" data-help="message_btn" title="${escapeHtml(t('profile.message'))}" aria-label="${escapeHtml(t('profile.message'))}">💬</button>
               <button type="button" class="icon-btn" id="btn-report-profile" data-help="report_profile" title="${escapeHtml(t('report.button'))}" aria-label="${escapeHtml(t('report.button'))}">⚑</button>
               <button type="button" class="icon-btn ${subscribedToAuthor ? 'on' : ''}" id="btn-follow-profile" data-help="follow_btn"
                 title="${escapeHtml(subscribedToAuthor ? t('profile.following') : t('profile.follow'))}"
                 aria-label="${escapeHtml(subscribedToAuthor ? t('profile.following') : t('profile.follow'))}"
                 aria-pressed="${subscribedToAuthor}">${subscribedToAuthor ? '✓' : '＋'}</button>`}
        </div>
        <div class="profile-head-inner">
          <div class="avatar-slot">
            <span class="avatar lg" id="profile-avatar">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : escapeHtml(initials(profile.username))}${profile.is_admin ? `<span class="admin-badge" data-help="admin_badge" title="${escapeHtml(t('auth.role_admin'))}" aria-label="${escapeHtml(t('auth.role_admin'))}">🛡</span>` : ''}</span>
          </div>
          <div class="profile-info">
            <div class="profile-name-row">
              <h1 class="profile-name">${escapeHtml(profile.username)}</h1>
              <span class="profile-rating" title="${escapeHtml(t('profile.stat_rating'))}">👑 ${profile.stats?.rating ?? 0}</span>
              ${collabBadgeHtml({ profile, viewer: user })}
            </div>
            ${profile.email && editable ? `<div class="profile-username">${escapeHtml(profile.email)}</div>` : ''}
            <p class="profile-bio">${escapeHtml(profile.bio || t('profile.no_bio'))}</p>
            <div class="profile-links" data-help="profile_links">
              ${(profile.links || []).map((l) => `
                <a class="profile-link link-icon" href="${escapeHtml(externalHref(l))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(linkDisplayName(l))}" aria-label="${escapeHtml(linkDisplayName(l))}">
                  ${platformIcon(l.platform, l.url, 22)}
                </a>`).join('')}
              ${editable ? `<button type="button" class="profile-link add-link-inline" id="btn-quick-add-link" aria-label="${escapeHtml(t('profile.add_link'))}" title="${escapeHtml(t('profile.add_link'))}">＋</button>` : ''}
            </div>
          </div>

          <!-- Статистика полосой -->
          <div class="profile-stats-strip" data-help="profile_stats">
            <div class="pstat"><b>${profile.stats?.questions ?? 0}</b><span>${escapeHtml(t('profile.stat_questions'))}</span></div>
            <div class="pstat"><b>${profile.stats?.answers ?? answers.length}</b><span>${escapeHtml(t('profile.stat_answers'))}</span></div>
            <div class="pstat"><b>${profile.stats?.likes ?? 0}</b><span>${escapeHtml(t('profile.stat_likes'))}</span></div>
            <div class="pstat"><b>${profile.stats?.solutions ?? 0}</b><span>${escapeHtml(t('profile.stat_solutions'))}</span></div>
            <div class="pstat"><b>${supportCount}</b><span>☕ ${escapeHtml(t('support.stat_supported'))}</span></div>
          </div>

          <!-- DAW и арсенал: полосы внизу шапки. Контакты сюда не вернулись —
               они открываются по клику на бейдж «🤝 Открыт к коллаборациям»
               (модалка «Как связаться»), а реквизиты — по кнопке ☕. -->
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
          </div>
        </div>
      </article>

      <!-- Авто-витрина «Лучшие ответы» (заменила шоукейс «Моё звучание»):
           топ ответов СО ЗВУКОМ из вопросов — без пользовательских загрузок -->
      <section class="best-answers-block" data-help="best_answers" aria-label="${escapeHtml(t('profile.best_answers'))}">
        <div class="best-answers-head">
          <h2>🏆 ${escapeHtml(t('profile.best_answers'))}</h2>
        </div>
        <div class="best-answers-grid" id="best-answers-grid">${bestAnswersHtml(bestAnswers)}</div>
      </section>

      <div class="question-layout" style="margin-top:20px">
        <div>
          <!-- Вкладки -->
          <div class="tabs" role="tablist" data-help="profile_tabs">
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

  if (editable) {
    // Быстрое добавление ссылки прямо в профиле
    container.querySelector('#btn-quick-add-link')?.addEventListener('click', () => openAddLinkModal(profile, async (links) => {
      await updateProfile({ links });
      const { user: u } = getState();
      setState({ user: { ...u, links } });
      renderProfile(container, { userId }, { editable: true });
    }));
  }

  // ---------- «Лучшие ответы»: мини-плееры (с маркерами — паритет с лентой) ----------
  container.querySelectorAll('#best-answers-grid .mini-wave').forEach((canvas) => {
    if (canvas.dataset.audio) attachMiniPlayer(canvas, canvas.dataset.audio, dsJson(canvas, 'wave'), dsJson(canvas, 'markers'));
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
      // Маркеры пробрасываем в мини-плеер: пины на вейвформе + чипы под ней,
      // как в ленте и на /favorites (data-help у чипов уже в каталоге справки)
      attachMiniPlayer(canvas, canvas.dataset.audio, dsJson(canvas, 'wave'), dsJson(canvas, 'markers'));
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
    openSupportModal({ recipientUserId: userId, recipientName: profile.username, recipientMethods: profile.donate_methods || [] });
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

  // ---------- Бейдж «🤝 Открыт к коллаборациям» → модалка «Как связаться» ----------
  // Единственная точка входа в контакты: чипы рендерятся только внутри модалки,
  // в DOM страницы профиля их больше нет (решение заказчика 2026-10-11).
  // Анониму клик открывает окно входа — так же, как остальные действия шапки.
  container.querySelector('#btn-collab')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    openContactsModal({
      profile,
      viewer: user,
      onRequireAuth: () => requireAuth(),
      onMessage: () => navigate(`/messages/${userId}`),
      onEdit: () => openEditProfileModal(profile, container, userId),
    });
  });

  // ---------- Жалоба на профиль (мошенничество / чужие реквизиты) ----------
  container.querySelector('#btn-report-profile')?.addEventListener('click', () => {
    if (!requireAuth()) return;
    openReportModal('profile', userId);
  });
}

/** Карточки авто-витрины «Лучшие ответы»: заголовок вопроса (ссылка),
 *  мини-вейвформа аудио ответа, лайки и бейдж принятого решения */
function bestAnswersHtml(rows) {
  if (!rows.length) return `<p class="compact-empty" style="padding:4px 2px">${escapeHtml(t('profile.best_answers_empty'))}</p>`;
  return rows.map((a) => {
    const q = a.question;
    const title = (q && !q.purged && q.title) ? q.title : t('question.purged_title');
    return `
    <div class="card best-answer-card" data-aid="${escapeHtml(a.id)}" style="cursor:default">
      <div class="ba-title">
        <a href="/question/${escapeHtml(a.question_id)}" data-route>${escapeHtml(title)}</a>
      </div>
      ${a.audio_url ? `<canvas class="mini-wave" style="width:100%" data-audio="${escapeHtml(a.audio_url)}" data-wave='${escapeHtml(JSON.stringify(a.waveform_data || []))}' data-markers='${escapeHtml(JSON.stringify(a.markers || []))}' role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>` : ''}
      <div class="ba-meta">
        <span class="counter">🔥 ${a.likes_count ?? 0}</span>
        ${a.is_solution ? `<span class="ba-solution">✓ ${escapeHtml(t('question.solution'))}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// СПИСКИ ВКЛАДОК
// ============================================================

/** Безопасный разбор JSON из dataset canvas (вейвформа/маркеры): мусор → [] */
function dsJson(canvas, key) {
  try { return JSON.parse(canvas.dataset[key] || '[]'); } catch { return []; }
}

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
          ${q.audio_url ? `<canvas class="mini-wave" data-audio="${escapeHtml(q.audio_url)}" data-wave='${escapeHtml(JSON.stringify(q.waveform_data || []))}' data-markers='${escapeHtml(JSON.stringify(q.markers || []))}' role="button" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>` : ''}
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
// контакты, способы приёма) — мгновенно. Переключателя языка здесь больше нет:
// интерфейс заморожен на ru (см. CONFIG.LOCALES и locales_archive/).
// ============================================================

const AUTOSAVE_TEXT_DELAY = 700;  // мс, debounce текстовых полей
const AUTOSAVE_CHIPS_DELAY = 400; // мс, debounce строк контактов

// ---------- Настройки: секционная разметка (наведение порядка, 2026-10-13) ----------
/** Тематическая секция модалки настроек: заголовок-иконка + содержимое */
function setSection(id, icon, titleKey, inner) {
  return `
    <div class="set-section" data-section="${id}">
      <h3 class="set-section-title">${icon} <span data-i18n="${titleKey}">${escapeHtml(t(titleKey))}</span></h3>
      ${inner}
    </div>`;
}

/** Строка аватара в настройках: превью + «Сменить фото» (тот же кроппер, что на профиле) */
function settingsAvatarRowHtml(profile) {
  return `
    <div class="set-avatar-row">
      <span class="avatar md" id="ed-avatar-preview" aria-hidden="true">${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="">` : escapeHtml(initials(profile.username))}</span>
      <button type="button" class="btn btn-ghost btn-sm" id="ed-avatar-btn" data-help="set_avatar">📷 <span data-i18n="settings.avatar_change">${escapeHtml(t('settings.avatar_change'))}</span></button>
      <input type="file" id="ed-avatar-input" accept="image/*" hidden>
    </div>`;
}

/** Внутренность превью ссылок (чипы платформ или пусто-состояние) */
function settingsLinksPreviewInner(profile) {
  const links = profile.links || [];
  if (!links.length) return `<span class="hint" data-i18n="settings.links_empty">${escapeHtml(t('settings.links_empty'))}</span>`;
  return links.map((l) => `
    <span class="set-link-chip" title="${escapeHtml(linkDisplayName(l))}">${platformIcon(l.platform, l.url, 15)} ${escapeHtml(linkDisplayName(l))}</span>`).join('');
}

function openEditProfileModal(profile, container, userId) {
  let software = [...(profile.software || [])];
  let arsenal = [...(profile.arsenal || [])];
  let coverStyle = COVER_STYLES.some((s) => s.id === profile.cover_style)
    ? profile.cover_style
    : DEFAULT_COVER_STYLE;

  const content = document.createElement('div');
  content.innerHTML = `
    <form id="edit-form" novalidate>
      ${setSection('profile', '👤', 'settings.sec_profile', `
        ${settingsAvatarRowHtml(profile)}
        <div class="field">
          <label for="ed-username" data-i18n="auth.username">${escapeHtml(t('auth.username'))}</label>
          <input type="text" id="ed-username" data-help="set_username" value="${escapeHtml(profile.username || '')}" maxlength="24">
        </div>
        <div class="field">
          <label for="ed-bio" data-i18n="profile.bio">${escapeHtml(t('profile.bio'))}</label>
          <textarea id="ed-bio" data-help="set_bio" rows="3">${escapeHtml(profile.bio || '')}</textarea>
        </div>
        <div class="field">
          <label id="ed-cover-label" data-i18n="profile.cover">${escapeHtml(t('profile.cover'))}</label>
          <div class="hint" style="margin:-4px 0 8px" data-i18n="profile.cover_hint">${escapeHtml(t('profile.cover_hint'))}</div>
          <div class="cover-picker" id="ed-cover-picker" data-help="set_cover" role="radiogroup"
               aria-labelledby="ed-cover-label"></div>
        </div>
      `)}
      ${setSection('gear', '🎛️', 'settings.sec_gear', `
        <div class="field">
          <label data-i18n="profile.links">${escapeHtml(t('profile.links'))}</label>
          <div id="ed-links-preview" class="set-links-preview"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="ed-add-links" data-help="set_links">＋ <span data-i18n="profile.add_link">${escapeHtml(t('profile.add_link'))}</span></button>
        </div>
        <div class="field">
          <label data-i18n="profile.daw">${escapeHtml(t('profile.daw'))}</label>
          <div id="ed-daw-preview" class="software-row" style="margin-bottom:8px"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="ed-pick-daw" data-help="set_daw">🎛️ <span data-i18n="profile.choose_daw">${escapeHtml(t('profile.choose_daw'))}</span></button>
        </div>
        <div class="field">
          <label data-i18n="profile.arsenal">${escapeHtml(t('profile.arsenal'))}</label>
          <div id="ed-arsenal-preview" class="tags-row" style="margin-bottom:8px"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="ed-pick-arsenal" data-help="set_arsenal">🧰 <span data-i18n="profile.choose_arsenal">${escapeHtml(t('profile.choose_arsenal'))}</span></button>
        </div>
      `)}
      ${setSection('privacy', '🛡️', 'settings.sec_privacy', `
        <p class="ed-hint set-privacy-hint" data-i18n="settings.privacy_hint">${escapeHtml(t('settings.privacy_hint'))}</p>
        <div class="field">
          <label class="switch">
            <input type="checkbox" id="ed-collab" data-help="set_collab" ${profile.open_to_collab ? 'checked' : ''}>
            <span class="slider" aria-hidden="true"></span>
            <span data-i18n="profile.collab_toggle">${escapeHtml(t('profile.collab_toggle'))}</span>
          </label>
          <p class="ed-hint" style="color:var(--text-muted);font-size:12px;line-height:1.5;margin:6px 0 0" data-i18n="profile.collab_hint">${escapeHtml(t('profile.collab_hint'))}</p>
          <p class="ed-hint" id="ed-collab-warn" style="color:var(--warn,#e0a458);font-size:12px;margin:6px 0 0" hidden>⚠️ <span data-i18n="contact.collab_off_warn">${escapeHtml(t('contact.collab_off_warn'))}</span></p>
        </div>
        <div class="field">
          <label class="switch">
            <input type="checkbox" id="ed-contact-consent" data-help="set_contact_consent" ${profile.contact_consent ? 'checked' : ''}>
            <span class="slider" aria-hidden="true"></span>
            <span data-i18n="contact.consent">${escapeHtml(t('contact.consent'))}</span>
          </label>
          <p class="ed-hint" id="ed-consent-warn" style="color:var(--warn,#e0a458);font-size:12px;margin:6px 0 0" hidden>⚠️ <span data-i18n="contact.consent_off_warn">${escapeHtml(t('contact.consent_off_warn'))}</span></p>
        </div>
      `)}
      ${setSection('contacts', '📇', 'settings.sec_contacts', `
        <div class="field">
          <p class="ed-hint" style="color:var(--text-muted);font-size:12px;line-height:1.5;margin:0 0 8px" data-i18n="contact.settings_hint">${escapeHtml(t('contact.settings_hint'))}</p>
          <div id="ed-kind-menu-host"></div>
          <div id="ed-contact-list" class="set-slots" data-help="set_contact"></div>
          <p class="ed-hint" id="ed-contact-hint" style="color:var(--text-muted);font-size:12px;margin:0 0 8px"></p>
          <button type="button" class="btn btn-ghost btn-sm" id="ed-add-contact" data-help="set_contact">＋ <span data-i18n="contact.add">${escapeHtml(t('contact.add'))}</span></button>
        </div>
      `)}
      ${setSection('support', '💳', 'settings.sec_support', `
        <div class="field">
          <p class="ed-hint" style="color:var(--text-muted);font-size:12px;line-height:1.5;margin:0 0 8px" data-i18n="profile.donate_hint">${escapeHtml(t('profile.donate_hint'))}</p>
          <div id="ed-donate-list" class="set-slots" data-help="set_payment"></div>
        </div>
      `)}
      <div class="settings-footer">
        <span class="autosave-status" id="ed-autosave" role="status" aria-live="polite"></span>
        <button type="button" class="btn btn-primary" id="ed-done" data-help="set_done"><span data-i18n="profile.done">${escapeHtml(t('profile.done'))}</span></button>
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
  const contacts = normalizeContacts(profile.contact).map((c) => ({ ...c }));
  // Способы приёма нормализуем на входе: в старом снапшоте/профиле могли
  // остаться устаревшие виды (ЮMoney/Boosty/крипта — удалены в v9)
  const donateMethods = normalizeDonateMethods(profile.donate_methods).map((m) => ({ ...m }));
  const consentInput = content.querySelector('#ed-contact-consent');
  const collabWarn = content.querySelector('#ed-collab-warn');

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
      arsenal,
      cover_style: coverStyle,
      open_to_collab: collabInput.checked,
      // В БД уходят только валидные контакты: незаполненные и кривые строки
      // остаются в редакторе, но не сохраняются (validateContact на каждый элемент)
      contact: contacts
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => String(c.value || '').trim() && validateContact(c, contacts, i).ok)
        .map(({ c }) => ({
          kind: c.kind,
          value: String(c.value).trim(),
          label: String(c.label || '').trim(),
          visibility: c.visibility === 'hidden' ? 'hidden' : 'members',
        })),
      contact_consent: consentInput.checked,
      // В БД уходят только валидные способы (как у контактов): незаполненные
      // и кривые строки остаются в редакторе с подсказкой, но не сохраняются
      donate_methods: donateMethods
        .filter((m) => String(m.value || '').trim() && validateDonateMethod(m).ok)
        .map((m) => ({
          kind: m.kind,
          value: String(m.value).trim(),
          qr_data_url: String(m.qr_data_url || '').trim(), // QR-заход 2026-10-13: картинка способа
          label: String(m.label || '').trim(),
        })),
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
  collabInput.addEventListener('change', () => { drawContacts(); saveNow(); });
  consentInput.addEventListener('change', () => { drawContacts(); saveNow(); });

  // ---------- «Поддержать автора»: способы приёма, строго СБП + карта (v9) ----------
  const donateList = content.querySelector('#ed-donate-list');

  /** Инлайн-ошибки валидации (зеркало drawContactErrors): addNew=true — после blur */
  function drawDonateErrors(addNew = false) {
    donateList.querySelectorAll('.donate-slot').forEach((slot) => {
      const m = donateMethods.find((x) => x.kind === slot.dataset.kind);
      const err = slot.querySelector('.row-error');
      const res = m && String(m.value || '').trim() ? validateDonateMethod(m) : { ok: true };
      if (res.ok) {
        slot.classList.remove('invalid');
        if (err) err.remove();
        return;
      }
      if (!addNew && !err) return; // пока идёт ввод — не дёргаем подсказками
      slot.classList.add('invalid');
      const el = err || (() => {
        const span = document.createElement('span');
        span.className = 'row-error';
        slot.appendChild(span);
        return span;
      })();
      el.textContent = t(res.errorKey);
    });
  }

  // ---------- «Поддержать автора»: один фикс-слот QR-кода (вариант «Г» + QR-заход) ----------
  // pendingQr — декодированный, но ещё не сохранённый QR (preview до «Сохранить»)
  let pendingQr = null;
  let stopCam = null;

  async function copyText(v) {
    try {
      await navigator.clipboard.writeText(v);
      toast(t('support.copied'));
    } catch {
      toast(v, 'info', 8000);
    }
  }

  /** Слот Boosty: ссылка на страницу автора (платёж проводит платформа) */
  function boostySlotHtml(mB) {
    const on = !!mB && !!mB.value;
    return `
      <div class="set-slot donate-slot${on ? '' : ' empty'}" data-kind="boosty">
        <div class="set-slot-head">
          <span class="ico" aria-hidden="true">${KIND_ICONS.boosty}</span>
          <span class="kind-name">${escapeHtml(t('support.kind_boosty'))}</span>
          <span class="st">${on ? escapeHtml(t('settings.slot_on')) : escapeHtml(t('settings.slot_off'))}</span>
        </div>
        <input type="text" class="boosty-value" value="${escapeHtml(mB?.value || '')}" placeholder="${escapeHtml(t('support.boosty_ph'))}" maxlength="120" aria-label="${escapeHtml(t('support.kind_boosty'))}">
        <span class="row-error" id="ed-boosty-err" hidden></span>
        ${on ? `<a class="set-slot-open" href="${escapeHtml(mB.value)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(t('support.boosty_page'))}</a>` : ''}
        <p class="sup-hint" style="margin:2px 0 0">${escapeHtml(t('support.boosty_hint'))}</p>
      </div>`;
  }

  function renderDonateList() {
    const m = donateMethods.find((x) => x.kind === 'qr') || null;
    const mB = donateMethods.find((x) => x.kind === 'boosty') || null;
    donateList.innerHTML = (m ? `
      <div class="set-slot donate-slot" data-kind="qr">
        <div class="set-slot-head">
          <span class="ico" aria-hidden="true">${KIND_ICONS.qr}</span>
          <span class="kind-name">${escapeHtml(t('support.kind_qr'))}</span>
          <span class="st">${escapeHtml(t('settings.slot_on'))}</span>
        </div>
        <div class="qr-edit-row">
          <img class="qr-img sm" src="${escapeHtml(m.qr_data_url)}" alt="${escapeHtml(t('support.kind_qr'))}">
          <div class="qr-edit-side">
            <input type="text" class="donate-label" value="${escapeHtml(m.label || '')}" placeholder="${escapeHtml(t('support.qr_bank_ph'))}" maxlength="40" aria-label="${escapeHtml(t('support.qr_bank_ph'))}">
            <div class="qr-edit-btns">
              <button type="button" class="btn btn-ghost btn-sm" id="ed-qr-read">🔍 ${escapeHtml(t('support.qr_read_btn'))}</button>
              <button type="button" class="btn btn-ghost btn-sm" id="ed-qr-replace">🖼️ ${escapeHtml(t('support.qr_replace'))}</button>
              <button type="button" class="btn btn-quiet btn-sm" id="ed-qr-remove">🗑 ${escapeHtml(t('common.delete'))}</button>
            </div>
          </div>
        </div>
        <div class="qr-analysis" id="ed-qr-analysis" data-help="qr_analysis" hidden></div>
        <input type="file" id="ed-qr-input" accept="image/*" hidden>
      </div>` : `
      <div class="set-slot donate-slot empty">
        <div class="set-slot-head">
          <span class="ico" aria-hidden="true">${KIND_ICONS.qr}</span>
          <span class="kind-name">${escapeHtml(t('support.kind_qr'))}</span>
          <span class="st">${escapeHtml(t('settings.slot_off'))}</span>
        </div>
        <div class="qr-drop" id="ed-qr-drop" data-help="qr_upload">
          <p>${escapeHtml(t('support.qr_upload_hint'))}</p>
          <button type="button" class="btn btn-ghost btn-sm" id="ed-qr-file-btn">🖼️ ${escapeHtml(t('support.qr_file'))}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="ed-qr-cam-btn">📹 ${escapeHtml(t('support.qr_camera'))}</button>
          <input type="file" id="ed-qr-input" accept="image/*" hidden>
          <video id="ed-qr-video" autoplay playsinline hidden></video>
        </div>
        <div class="qr-analysis" id="ed-qr-analysis" data-help="qr_analysis" hidden></div>
        <div class="qr-save-row" id="ed-qr-save-row" hidden>
          <input type="text" id="ed-qr-label" placeholder="${escapeHtml(t('support.qr_bank_ph'))}" maxlength="40" aria-label="${escapeHtml(t('support.qr_bank_ph'))}">
          <button type="button" class="btn btn-primary btn-sm" id="ed-qr-save">✓ ${escapeHtml(t('common.save'))}</button>
        </div>
      </div>`) + boostySlotHtml(mB);
    bindDonateWidgets();
  }

  /** Декодированный payload показываем ДО сохранения: автор видит, что публикует */
  async function applyQrPayload(payload, imageDataUrl) {
    let small = imageDataUrl || '';
    if (small) {
      try { small = await downscaleDataUrl(small); } catch { /* останется как есть */ }
    }
    pendingQr = { value: payload, qr_data_url: small };
    const host = donateList.querySelector('#ed-qr-analysis');
    if (host) renderQrAnalysis(host, analyzeQrPayload(payload), { onCopy: copyText });
    const saveRow = donateList.querySelector('#ed-qr-save-row');
    if (saveRow) saveRow.hidden = false;
  }

  async function handleQrFile(file) {
    if (!file.type.startsWith('image/')) { toast(t('profile.avatar_type_error'), 'error'); return; }
    try {
      const dataUrl = await readAsDataUrl(file);
      const payload = await decodeDataUrl(dataUrl);
      if (!payload) { toast(t('support.qr_decode_fail'), 'error'); return; }
      await applyQrPayload(payload, dataUrl);
    } catch {
      toast(t('support.qr_decode_fail'), 'error');
    }
  }

  function bindDonateWidgets() {
    const fileInput = donateList.querySelector('#ed-qr-input');
    donateList.querySelector('#ed-qr-file-btn')?.addEventListener('click', () => fileInput?.click());
    donateList.querySelector('#ed-qr-replace')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void handleQrFile(file);
    });
    const drop = donateList.querySelector('#ed-qr-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
      drop.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) void handleQrFile(file);
      });
    }
    donateList.querySelector('#ed-qr-cam-btn')?.addEventListener('click', async () => {
      const video = donateList.querySelector('#ed-qr-video');
      try {
        stopCam?.();
        stopCam = await startCameraScan(video, (payload, frameUrl) => {
          stopCam = null;
          void applyQrPayload(payload, frameUrl);
        });
      } catch {
        toast(t('support.qr_camera_fail'), 'error');
      }
    });
    donateList.querySelector('#ed-qr-read')?.addEventListener('click', async () => {
      const m = donateMethods[0];
      const host = donateList.querySelector('#ed-qr-analysis');
      if (!m || !host) return;
      if (!host.hidden) { host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = `<p class="sup-hint">${escapeHtml(t('support.qr_reading'))}</p>`;
      try {
        const payload = await decodeDataUrl(m.qr_data_url);
        if (!payload) { host.innerHTML = `<p class="sup-hint">${escapeHtml(t('support.qr_decode_fail'))}</p>`; return; }
        renderQrAnalysis(host, analyzeQrPayload(payload), { onCopy: copyText });
      } catch {
        host.innerHTML = `<p class="sup-hint">${escapeHtml(t('support.qr_decode_fail'))}</p>`;
      }
    });
    donateList.querySelector('#ed-qr-remove')?.addEventListener('click', () => {
      stopCam?.();
      donateMethods.length = 0;
      pendingQr = null;
      renderDonateList();
      saveNow();
    });
    donateList.querySelector('#ed-qr-save')?.addEventListener('click', () => {
      if (!pendingQr || !pendingQr.qr_data_url) { toast(t('payment.invalid_qr'), 'error'); return; }
      const label = donateList.querySelector('#ed-qr-label')?.value.trim().slice(0, 40) || '';
      donateMethods.length = 0;
      donateMethods.push({ kind: 'qr', value: pendingQr.value, qr_data_url: pendingQr.qr_data_url, label });
      pendingQr = null;
      renderDonateList();
      saveNow();
    });
    donateList.querySelector('.donate-label')?.addEventListener('change', (e) => {
      const m = donateMethods.find((x) => x.kind === 'qr');
      if (!m) return;
      m.label = e.target.value.trim().slice(0, 40);
      saveNow();
    });
    // Boosty: ввод ссылки → канонизация/валидация → автосохранение;
    // пусто = способ выключен; кривая ссылка остаётся в слоте с ошибкой
    const bIn = donateList.querySelector('.boosty-value');
    const bErr = donateList.querySelector('#ed-boosty-err');
    const bSlot = donateList.querySelector('[data-kind="boosty"]');
    bIn?.addEventListener('change', () => {
      const v = bIn.value.trim();
      const idx = donateMethods.findIndex((x) => x.kind === 'boosty');
      if (!v) {
        if (idx >= 0) donateMethods.splice(idx, 1);
        renderDonateList();
        saveNow();
        return;
      }
      const url = canonicalBoostyUrl(v);
      if (!url) {
        if (bErr) { bErr.textContent = t('payment.invalid_boosty'); bErr.hidden = false; }
        bSlot?.classList.add('invalid');
        return; // в профиль не сохраняется
      }
      if (idx >= 0) donateMethods[idx].value = url;
      else donateMethods.push({ kind: 'boosty', value: url, label: '' });
      renderDonateList();
      saveNow();
    });
  }

  renderDonateList();

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
  // Превью ссылок: чипы уже установленных (паритет с превью DAW/арсенала)
  const linksPreview = content.querySelector('#ed-links-preview');
  const drawLinksPreview = () => { linksPreview.innerHTML = settingsLinksPreviewInner(profile); };
  drawLinksPreview();
  content.querySelector('#ed-add-links').addEventListener('click', () => {
    openAddLinkModal(profile, async (links) => {
      profile.links = links;
      drawLinksPreview();
      await saveNow(); // автосохранение сразу после «Готово» во вложенной модалке
    });
  });

  // Аватар: тот же поток, что на странице профиля (файл → кроппер → upload)
  const avatarInput = content.querySelector('#ed-avatar-input');
  content.querySelector('#ed-avatar-btn').addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast(t('profile.avatar_type_error'), 'error'); return; }
    openAvatarCropper(file, async (croppedBlob) => {
      try {
        const avatar_url = await uploadAvatar(croppedBlob);
        await updateProfile({ avatar_url });
        const { user: u } = getState();
        setState({ user: { ...u, avatar_url } });
        const prev = content.querySelector('#ed-avatar-preview');
        if (prev) prev.innerHTML = `<img src="${escapeHtml(avatar_url)}" alt="">`;
        toast(t('profile.avatar_updated'));
      } catch (err) {
        toast(err.message || 'Error', 'error');
      }
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

  // ---------- Редактор «Контакты» (массив contacts объявлен выше) ----------
  const contactList = content.querySelector('#ed-contact-list');
  const contactHint = content.querySelector('#ed-contact-hint');
  const consentWarn = content.querySelector('#ed-consent-warn');

  /**
   * Подсветка ошибок валидации: строка остаётся редактируемой, в профиль не уходит.
   * @param {boolean} addNew добавлять ли НОВУЮ подсказку. По умолчанию false:
   *   пока пользователь набирает значение, автоопределение типа ещё не сработало
   *   (оно на change/blur), и строка «@почта» при типе Telegram мигала бы ошибкой.
   *   Уже показанная подсказка при этом обновляется и гаснет, как только запись
   *   стала валидной.
   */
  function drawContactErrors(addNew = false) {
    contactList.querySelectorAll('.contact-row').forEach((row) => {
      const i = Number(row.dataset.i);
      const c = contacts[i];
      if (!c) return;
      const err = row.querySelector('.row-error');
      const res = String(c.value || '').trim() ? validateContact(c, contacts, i) : { ok: true };
      if (res.ok) {
        row.classList.remove('invalid');
        if (err) err.remove();
        return;
      }
      if (!addNew && !err) return;
      row.classList.add('invalid');
      const el = err || (() => {
        const span = document.createElement('span');
        span.className = 'row-error';
        row.appendChild(span);
        return span;
      })();
      el.textContent = t(res.errorKey);
    });
  }

  /**
   * Предупреждения «контакты никто не видит». Два независимых выключателя:
   * согласие на публикацию (152-ФЗ) и бейдж «Открыт к коллаборациям» —
   * единственный вход в контакты для других участников.
   */
  function updateVisibilityWarns() {
    const hasContacts = contacts.some((c) => String(c.value || '').trim());
    consentWarn.hidden = !(!consentInput.checked && hasContacts);
    collabWarn.hidden = !(!collabInput.checked && hasContacts);
  }

  function drawContacts() {
    contactList.innerHTML = contacts.map((c, i) => contactEditorRowHtml(c, i)).join('');
    const addBtn = content.querySelector('#ed-add-contact');
    const full = contacts.length >= MAX_CONTACTS;
    addBtn.disabled = full;
    contactHint.textContent = full ? t('contact.limit') : '';
    closeKindMenu();
    drawContactErrors();
    updateVisibilityWarns();
  }

  // Вариант «Г»: вид контакта выбирается в меню при добавлении — карточка
  // дальше живёт с фиксированным видом (сменить вид = удалить и добавить)
  const kindMenuHost = content.querySelector('#ed-kind-menu-host');
  function closeKindMenu() { kindMenuHost.innerHTML = ''; }
  function openKindMenu() {
    const busy = new Set(contacts.map((c) => c.kind)); // дубли видов запрещены валидацией
    kindMenuHost.innerHTML = `
      <div class="kind-menu" role="menu">
        <p class="cap" data-i18n="settings.kind_menu_cap">${escapeHtml(t('settings.kind_menu_cap'))}</p>
        ${CONTACT_KINDS.map((k) => `<button type="button" class="k" data-kind="${k}" ${busy.has(k) ? 'disabled' : ''}>${CONTACT_ICONS[k]} ${escapeHtml(t(`contact.kind_${k}`))}</button>`).join('')}
      </div>`;
  }
  drawContacts();

  content.querySelector('#ed-add-contact').addEventListener('click', () => {
    if (contacts.length >= MAX_CONTACTS) { toast(t('contact.limit'), 'error'); return; }
    if (kindMenuHost.innerHTML.trim()) closeKindMenu(); else openKindMenu();
  });
  kindMenuHost.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn || btn.disabled) return;
    contacts.push({ kind: btn.dataset.kind, value: '', label: '', visibility: 'members' });
    drawContacts();
    contactList.querySelector('.contact-row:last-child .contact-value-in')?.focus();
  });

  contactList.addEventListener('input', (e) => {
    const row = e.target.closest('.contact-row');
    const c = contacts[Number(row?.dataset.i)];
    if (!c) return;
    if (e.target.classList.contains('contact-value-in')) c.value = e.target.value;
    if (e.target.classList.contains('contact-label-in')) c.label = e.target.value;
    drawContactErrors(); // только гасим/обновляем уже показанные подсказки
    updateVisibilityWarns();
    scheduleSave(AUTOSAVE_CHIPS_DELAY);
  });

  contactList.addEventListener('change', (e) => {
    const row = e.target.closest('.contact-row');
    const c = contacts[Number(row?.dataset.i)];
    if (!c) return;
    if (e.target.classList.contains('contact-value-in')) c.value = e.target.value.trim();
    if (e.target.classList.contains('contact-label-in')) c.label = e.target.value.trim();
    drawContactErrors(true); // поле подтверждено (blur/Enter) — подсказку можно добавить
    saveNow();
  });

  contactList.addEventListener('click', (e) => {
    const del = e.target.closest('.contact-del');
    if (!del) return;
    contacts.splice(Number(del.closest('.contact-row').dataset.i), 1);
    drawContacts();
    saveNow();
  });

  const close = (() => {
    const realClose = openModal({
      title: t('profile.settings'),
      content,
      wide: true,
    onMount: (overlay) => {
      // Заголовок тоже переводимый: при смене языка его обновит applyTranslations
      overlay.querySelector('.modal-head h2')?.setAttribute('data-i18n', 'profile.settings');
    },
    });
    // Закрытие модалки гасит камеру (иначе трек продолжит жить)
    return (...args) => {
      stopCam?.();
      stopCam = null;
      return realClose(...args);
    };
  })();

  // Смена языка при открытой модалке: статические тексты переводит
  // applyTranslations(document) по data-i18n-атрибутам, здесь перерисовываем
  // только части, собранные вызовами t() (пикер обложки, превью, чипсы, статус).
  const onLangChange = () => {
    drawCoverPicker();
    drawDaw();
    drawArsenal();
    drawContacts();
    renderDonateList();
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
