// ============================================================
// auth.mjs — регистрация, логин, OAuth, восстановление пароля,
// онбординг и UI зоны авторизации в шапке
// ============================================================

import { getState, setState, subscribeTo } from './store.mjs';
import { t } from './i18n.mjs';
import { escapeHtml, openModal, toast, initials, dawIcon } from './utils.mjs';
import {
  getSessionUser, signUp, signIn, signInWithOAuth, resetPassword, signOut,
  updateProfile, isDemo, fetchDawCatalog, addDawToCatalog,
  syncDemoProfileFromSession,
} from './api.mjs';
import { navigate } from './router.mjs';
import { refreshAchievements } from './achievements.mjs';
import { openSupportModal } from './support.mjs';
import { contactKindOptions, detectContactKind, validateContact } from './contacts.mjs';

const authArea = () => document.getElementById('auth-area');

/**
 * Меню аватара (.notif-panel — position: fixed) раскрывается ровно ПОД
 * аватаром: координаты выставляет JS, правый край меню совпадает с правым
 * краем кнопки и не вылезает за экран. Аналогично панели уведомлений.
 */
function positionUserMenu(menu) {
  const btn = document.getElementById('btn-user-menu');
  if (!btn || !menu) return;
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth || 200;
  let left = r.right - w;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  menu.style.top = `${Math.round(r.bottom + 10)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

// При изменении размера окна удерживаем открытое меню под аватаром
window.addEventListener('resize', () => {
  const menu = document.getElementById('user-menu');
  if (menu && !menu.hidden) positionUserMenu(menu);
});

// ============================================================
// UI шапки: «Войти / Регистрация» или аватар + меню
// ============================================================

export function initAuthUI() {
  subscribeTo('user', renderAuthArea);
  // Кнопки шапки рисуются через t() вне контейнера роутера — перерисовываем
  // их при смене языка, чтобы текст обновлялся сразу, как на остальном сайте
  document.addEventListener('i18n:changed', () => renderAuthArea(getState().user));
  renderAuthArea(getState().user);
}

// Document-обработчик «клик вне меню закрывает его» принадлежит конкретному
// рендеру шапки: снимаем предыдущий, чтобы они не накапливались при
// перерисовках (смена языка, вход/выход)
let authAreaDocClick = null;

function detachAuthAreaDocClick() {
  if (authAreaDocClick) {
    document.removeEventListener('click', authAreaDocClick);
    authAreaDocClick = null;
  }
}

function renderAuthArea(user) {
  const el = authArea();
  if (!el) return;
  detachAuthAreaDocClick();

  if (!user) {
    el.innerHTML = `
      <button type="button" class="btn btn-ghost btn-sm" id="btn-login" data-help="auth_login">${escapeHtml(t('nav.login'))}</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-signup" data-help="auth_signup">${escapeHtml(t('nav.signup'))}</button>`;
    el.querySelector('#btn-login').addEventListener('click', () => openAuthModal('login'));
    el.querySelector('#btn-signup').addEventListener('click', () => openAuthModal('signup'));
    return;
  }

  el.innerHTML = `
    <button type="button" class="btn btn-primary btn-sm" id="btn-ask" data-help="nav_ask">＋ ${escapeHtml(t('nav.ask'))}</button>
    <button type="button" class="avatar" id="btn-user-menu" data-help="nav_usermenu" aria-label="${escapeHtml(t('nav.profile'))}" aria-haspopup="true">
      ${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : escapeHtml(initials(user.username))}
      ${user.is_admin ? `<span class="admin-badge" data-help="admin_badge" title="${escapeHtml(t('auth.role_admin'))}" aria-label="${escapeHtml(t('auth.role_admin'))}">🛡</span>` : ''}
    </button>
    <div id="user-menu" class="notif-panel" style="width:200px" hidden></div>`;

  el.querySelector('#btn-ask').addEventListener('click', () => {
    if (!requireAuth()) return;
    navigate('/ask');
  });

  const menuBtn = el.querySelector('#btn-user-menu');
  const menu = el.querySelector('#user-menu');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !menu.hidden;
    menu.hidden = open;
    menuBtn.setAttribute('aria-expanded', String(!open));
    if (!open) {
      menu.innerHTML = `
        <div style="padding:12px 16px;border-bottom:1px solid var(--border-subtle)">
          <div style="font-weight:650;font-size:14px">${escapeHtml(user.username)}</div>
          <div style="font-size:11.5px;color:var(--text-muted);font-family:var(--font-mono)">${escapeHtml(user.email || '')}</div>
        </div>
        <button type="button" class="conv-item" data-act="profile">👤 <span>${escapeHtml(t('nav.profile'))}</span></button>
        <button type="button" class="conv-item" data-act="help">📖 <span>${escapeHtml(t('help.title'))}</span></button>
        ${user.is_admin ? `<button type="button" class="conv-item" data-act="moderation">🛡 <span>${escapeHtml(t('nav.moderation'))}</span></button>` : ''}
        <button type="button" class="conv-item" data-act="support">☕ <span>${escapeHtml(t('support.menu_btn'))}</span></button>
        <button type="button" class="conv-item" data-act="logout">🚪 <span>${escapeHtml(t('nav.logout'))}</span></button>`;
      menu.querySelector('[data-act="profile"]').addEventListener('click', () => { menu.hidden = true; navigate('/profile'); });
      menu.querySelector('[data-act="help"]').addEventListener('click', () => { menu.hidden = true; navigate('/help'); });
      menu.querySelector('[data-act="moderation"]')?.addEventListener('click', () => { menu.hidden = true; navigate('/moderation'); });
      menu.querySelector('[data-act="support"]').addEventListener('click', () => { menu.hidden = true; openSupportModal({ recipientUserId: null }); });
      menu.querySelector('[data-act="logout"]').addEventListener('click', doLogout);
      // Меню уже видимое и наполненное — ставим его точно под аватар
      positionUserMenu(menu);
    }
  });
  authAreaDocClick = (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) {
      menu.hidden = true;
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('click', authAreaDocClick);
}

// ============================================================
// Сессия
// ============================================================

export async function restoreSession() {
  if (isDemo()) {
    const user = await getSessionUser(); // читает LocalStorage — мгновенно
    if (user) {
      syncDemoProfileFromSession(user); // сессия свежее пересозданной базы
      setState({ user });
      refreshAchievements();
    }
    return;
  }

  try {
    // Свой backend (Фаза C): JWT в localStorage + GET /api/profiles/me.
    // Протухший access тихо обновляется внутри getSessionUser (api.mjs);
    // сессии нет/refresh истёк — остаёмся гостем. OAuth-возвратов больше
    // нет (вход только e-mail+пароль), onAuthStateChange не нужен.
    const user = await getSessionUser();
    if (!user) return;
    setState({ user });
    refreshAchievements();
  } catch (e) {
    // Сервер недоступен — не роняем приложение
    console.error('[auth] restoreSession:', e);
  }
}

/** Требовать авторизацию: если не залогинен — открыть модалку. Возвращает bool */
export function requireAuth() {
  if (getState().user) return true;
  openAuthModal('login');
  return false;
}

async function doLogout() {
  await signOut();
  setState({ user: null, notifications: [], unreadCount: 0, unreadMessages: 0, favorites: [], subscriptions: [], achievements: [] });
  toast(t('auth.logged_out'));
  navigate('/');
}

// ============================================================
// Модалка входа / регистрации
// ============================================================

const PROVIDER_META = {
  google: ['🔵', 'Google'],
  github: ['⚫', 'GitHub'],
  apple: ['⚪', 'Apple'],
};

/**
 * Какие OAuth-провайдеры доступны.
 * В демо-режиме — все три (локальная имитация входа, страховочный пояс).
 * На своём backend (Фаза C) OAuth УДАЛЁН решением заказчика (2026-10-14,
 * опрос): вход только e-mail+пароль — список пуст, ряд кнопок не рендерится.
 */
function fetchEnabledProviders() {
  if (isDemo()) return Promise.resolve(['google', 'github', 'apple']);
  return Promise.resolve([]);
}

export async function openAuthModal(mode = 'login') {
  const isLogin = mode === 'login';
  const providers = await fetchEnabledProviders();
  // Отключённые провайдеры не показываем вовсе — незачем ловить ошибку 400
  const oauthHtml = providers.length ? `
    <div class="oauth-row">
      ${providers.map((p) => `
        <button type="button" class="oauth-btn" data-provider="${p}" aria-label="${PROVIDER_META[p][1]}">
          ${PROVIDER_META[p][0]} <span>${PROVIDER_META[p][1]}</span>
        </button>`).join('')}
    </div>
    <div class="divider">${escapeHtml(t('auth.or_email'))}</div>` : '';

  const content = document.createElement('div');
  content.innerHTML = `
    ${oauthHtml}
    <form id="auth-form" novalidate>
      ${isLogin ? '' : `
      <div class="field">
        <label for="auth-username">${escapeHtml(t('auth.username'))}</label>
        <input type="text" id="auth-username" required minlength="3" maxlength="24" autocomplete="off" placeholder="wavetable_wizard">
      </div>`}
      <div class="field">
        <label for="auth-email">${escapeHtml(t('auth.email'))}</label>
        <input type="email" id="auth-email" required autocomplete="off" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="auth-password">${escapeHtml(t('auth.password'))}</label>
        <input type="password" id="auth-password" required minlength="6" autocomplete="off" placeholder="••••••••">
      </div>
      <div id="auth-error" style="color:#e06a5a;font-size:12.5px;margin-bottom:10px" role="alert"></div>
      <button type="submit" class="btn btn-primary" style="width:100%">
        ${escapeHtml(isLogin ? t('auth.login_btn') : t('auth.signup_btn'))}
      </button>
    </form>
    ${isLogin ? `<div class="auth-switch"><button type="button" id="forgot-btn">${escapeHtml(t('auth.forgot_password'))}</button></div>` : ''}
    <div class="auth-switch">
      ${escapeHtml(isLogin ? t('auth.no_account') : t('auth.has_account'))}
      <button type="button" id="switch-mode">${escapeHtml(isLogin ? t('nav.signup') : t('nav.login'))}</button>
    </div>`;

  const close = openModal({
    title: isLogin ? t('auth.login_title') : t('auth.signup_title'),
    content,
    onMount: (overlay) => {
      const err = content.querySelector('#auth-error');

      // OAuth (только включённые в Supabase провайдеры)
      content.querySelectorAll('.oauth-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await signInWithOAuth(btn.dataset.provider);
            if (res.user) { await afterSignIn(res.user, res.needsOnboarding); close(); }
          } catch (e) {
            // Понятный ответ на «provider is not enabled» и похожие
            err.textContent = /not enabled|unsupported provider/i.test(e.message || '')
              ? t('auth.oauth_disabled', { provider: PROVIDER_META[btn.dataset.provider]?.[1] || btn.dataset.provider })
              : (e.message || 'OAuth error');
            btn.disabled = false;
          }
        });
      });

      // Форма email+пароль
      content.querySelector('#auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        const email = content.querySelector('#auth-email').value.trim();
        const password = content.querySelector('#auth-password').value;
        const username = content.querySelector('#auth-username')?.value.trim();
        // Индикатор занятости: запросы к Supabase занимают секунду-другую
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const origLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ …';
        try {
          const res = isLogin ? await signIn({ email, password }) : await signUp({ email, password, username });
          if (res.needsConfirmation) {
            // В Supabase включён Confirm email — сессии ещё нет,
            // «входить» рано: показываем понятную инструкцию
            err.textContent = t('auth.confirm_email_required');
            return;
          }
          const user = res.user || (await getSessionUser());
          await afterSignIn(user, res.needsOnboarding);
          close();
        } catch (e2) {
          err.textContent = e2.message || 'Error';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = origLabel;
        }
      });

      // Восстановление пароля
      content.querySelector('#forgot-btn')?.addEventListener('click', async () => {
        const email = content.querySelector('#auth-email').value.trim();
        if (!email) { err.textContent = t('auth.enter_email_first'); return; }
        try {
          await resetPassword(email);
          toast(t('auth.reset_sent'), 'info');
        } catch (e2) {
          err.textContent = e2.message;
        }
      });

      // Переключение режима
      content.querySelector('#switch-mode').addEventListener('click', () => {
        close();
        openAuthModal(isLogin ? 'signup' : 'login');
      });
    },
  });
}

async function afterSignIn(user, needsOnboarding) {
  if (!user) return;
  // Подтягиваем полный профиль (username, avatar_url, links),
  // а не «голого» auth-пользователя
  const merged = (await getSessionUser()) || user;
  setState({ user: merged });
  toast(`${t('auth.welcome')}, ${merged.username || 'DJ'}! 🎛️`);
  refreshAchievements();
  document.dispatchEvent(new CustomEvent('auth:changed'));
  if (needsOnboarding) startOnboarding();
}

// ============================================================
// Онбординг после регистрации (заполнение профиля)
// ============================================================

export function startOnboarding() {
  const content = document.createElement('div');
  content.innerHTML = `
    <div class="onboarding-steps">
      <div class="onboarding-step done"></div>
      <div class="onboarding-step" data-step="2"></div>
      <div class="onboarding-step" data-step="3"></div>
    </div>
    <div id="ob-step-1">
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">${escapeHtml(t('auth.onboarding_about'))}</p>
      <div class="field">
        <label for="ob-bio">${escapeHtml(t('profile.bio'))}</label>
        <textarea id="ob-bio" rows="3" placeholder="${escapeHtml(t('auth.onboarding_bio_ph'))}"></textarea>
      </div>
      <button type="button" class="btn btn-primary" style="width:100%" data-next="2">${escapeHtml(t('common.next'))} →</button>
    </div>
    <div id="ob-step-2" hidden>
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">${escapeHtml(t('auth.onboarding_daw'))}</p>
      <div class="field">
        <label>${escapeHtml(t('profile.daw'))}</label>
        <div class="daw-grid" id="ob-daw-grid"><div class="loader" style="padding:14px"></div></div>
      </div>
      <div class="field">
        <div style="display:flex;gap:8px">
          <input type="text" id="ob-daw-custom" placeholder="${escapeHtml(t('profile.daw_other_ph'))}" style="flex:1" aria-label="${escapeHtml(t('profile.daw_other'))}">
          <button type="button" class="btn btn-ghost" id="ob-daw-add" aria-label="${escapeHtml(t('common.add'))}">＋</button>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button type="button" class="btn btn-quiet" data-next="1">← ${escapeHtml(t('common.back'))}</button>
        <button type="button" class="btn btn-primary" style="flex:1" data-next="3">${escapeHtml(t('common.next'))} →</button>
      </div>
    </div>
    <div id="ob-step-3" hidden>
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">${escapeHtml(t('auth.onboarding_contact'))}</p>
      <div class="field">
        <label for="ob-contact">${escapeHtml(t('contact.title'))}</label>
        <div style="display:flex;gap:8px">
          <select id="ob-contact-kind" style="max-width:150px" aria-label="${escapeHtml(t('contact.kind_label'))}">${contactKindOptions('telegram')}</select>
          <input type="text" id="ob-contact" style="flex:1" maxlength="200" placeholder="${escapeHtml(t('contact.value_ph'))}" aria-label="${escapeHtml(t('contact.title'))}">
        </div>
        <p style="color:var(--text-muted);font-size:12px;margin:8px 0 0">${escapeHtml(t('auth.onboarding_contact_hint'))}</p>
        <p id="ob-contact-err" style="color:#e0a458;font-size:12.5px;margin:8px 0 0" hidden></p>
        <!-- Бейдж «Открыт к коллаборациям» — единственная точка входа в контакты:
             без него записанный здесь контакт не увидит никто, кроме владельца -->
        <label class="switch" style="margin-top:12px">
          <input type="checkbox" id="ob-collab" data-help="set_collab" checked>
          <span class="slider" aria-hidden="true"></span>
          <span data-i18n="auth.onboarding_collab">${escapeHtml(t('auth.onboarding_collab'))}</span>
        </label>
      </div>
      <p style="color:var(--text-muted);font-size:12px;margin:0 0 12px">🔒 ${escapeHtml(t('auth.onboarding_contact_privacy'))}</p>
      <div style="display:flex;gap:10px">
        <button type="button" class="btn btn-quiet" data-next="2">← ${escapeHtml(t('common.back'))}</button>
        <button type="button" class="btn btn-quiet" id="ob-skip">${escapeHtml(t('auth.onboarding_contact_skip'))}</button>
        <button type="button" class="btn btn-primary" style="flex:1" id="ob-finish">${escapeHtml(t('auth.onboarding_finish'))} 🚀</button>
      </div>
    </div>`;

  const close = openModal({ title: t('auth.onboarding_title'), content, wide: true });

  // Шаг 2: выбор DAW из общего справочника (мультивыбор)
  const chosenDaws = new Set();
  (async () => {
    const catalog = await fetchDawCatalog();
    const grid = content.querySelector('#ob-daw-grid');
    if (!grid) return;
    const drawGrid = () => {
      grid.innerHTML = catalog.map((d) => `
        <button type="button" class="daw-option ${chosenDaws.has(d) ? 'selected' : ''}" data-daw="${escapeHtml(d)}" aria-pressed="${chosenDaws.has(d)}">${dawIcon(d, 18)} ${escapeHtml(d)}</button>`).join('');
    };
    drawGrid();
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-daw]');
      if (!btn) return;
      const name = btn.dataset.daw;
      if (chosenDaws.has(name)) chosenDaws.delete(name);
      else chosenDaws.add(name);
      btn.classList.toggle('selected', chosenDaws.has(name));
      btn.setAttribute('aria-pressed', String(chosenDaws.has(name)));
    });
    // Свой DAW через «+» — попадает в общий справочник
    content.querySelector('#ob-daw-add').addEventListener('click', async () => {
      const input = content.querySelector('#ob-daw-custom');
      const name = input.value.trim();
      if (!name) return;
      if (await addDawToCatalog(name)) {
        if (!catalog.includes(name)) catalog.push(name);
        chosenDaws.add(name);
        input.value = '';
        drawGrid();
      }
    });
  })();

  // Шаг 3: один контакт (можно пропустить). Тип определяем автоматически,
  // пока пользователь не выбрал его руками.
  const contactInput = content.querySelector('#ob-contact');
  const contactKindSel = content.querySelector('#ob-contact-kind');
  const contactErr = content.querySelector('#ob-contact-err');
  let contactKindManual = false;
  contactKindSel.addEventListener('change', () => { contactKindManual = true; });
  contactInput.addEventListener('change', () => {
    if (contactKindManual) return;
    const detected = detectContactKind(contactInput.value);
    contactKindSel.value = detected;
  });

  // Навигация по шагам
  content.querySelectorAll('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = btn.dataset.next;
      content.querySelectorAll('[id^="ob-step"]').forEach((s) => { s.hidden = true; });
      content.querySelector(`#ob-step-${step}`).hidden = false;
      content.querySelectorAll('.onboarding-step').forEach((dot) => {
        dot.classList.toggle('done', Number(dot.dataset.step || 1) <= Number(step));
      });
    });
  });

  /**
   * Завершить онбординг.
   * @param {boolean} withContact сохранять ли введённый контакт
   *   (false — «Пропустить»: био и DAW всё равно сохраняются)
   */
  async function finishOnboarding(withContact) {
    const bio = content.querySelector('#ob-bio').value.trim();
    const software = [...chosenDaws];
    const patch = { bio, software };

    if (withContact) {
      const value = contactInput.value.trim();
      if (value) {
        const c = { kind: contactKindSel.value, value, label: '', visibility: 'members' };
        const res = validateContact(c, [c], 0);
        if (!res.ok) {
          contactErr.textContent = t(res.errorKey);
          contactErr.hidden = false;
          contactInput.focus();
          return; // не закрываем: даём исправить
        }
        contactErr.hidden = true;
        // Согласие на показ участник даёт явно — здесь, добавляя контакт
        patch.contact = [c];
        patch.contact_consent = true;
        // Бейдж «Открыт к коллаборациям» — единственная точка входа в контакты,
        // поэтому включаем его вместе с контактом (галочку можно снять)
        patch.open_to_collab = content.querySelector('#ob-collab').checked;
      }
    }

    try {
      await updateProfile(patch);
      const { user } = getState();
      setState({ user: { ...user, ...patch } });
      toast(t('auth.onboarding_done'));
      close();
    } catch (e) {
      toast(e.message || 'Error', 'error');
    }
  }

  content.querySelector('#ob-finish').addEventListener('click', () => finishOnboarding(true));
  content.querySelector('#ob-skip').addEventListener('click', () => finishOnboarding(false));
}
