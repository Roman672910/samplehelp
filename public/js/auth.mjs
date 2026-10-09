// ============================================================
// auth.mjs — регистрация, логин, OAuth, восстановление пароля,
// онбординг и UI зоны авторизации в шапке
// ============================================================

import { getState, setState, subscribeTo } from './store.mjs';
import { t } from './i18n.mjs';
import { escapeHtml, openModal, toast, initials, dawIcon } from './utils.mjs';
import { CONFIG } from './config.mjs';
import {
  getSessionUser, signUp, signIn, signInWithOAuth, resetPassword, signOut,
  updateProfile, ensureClient, isDemo, fetchDawCatalog, addDawToCatalog,
  ensureProfileRow, invalidateProfileCache,
} from './supabase.mjs';
import { navigate } from './router.mjs';
import { refreshAchievements } from './achievements.mjs';
import { openSupportModal } from './support.mjs';

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
      <button type="button" class="btn btn-ghost btn-sm" id="btn-login">${escapeHtml(t('nav.login'))}</button>
      <button type="button" class="btn btn-primary btn-sm" id="btn-signup">${escapeHtml(t('nav.signup'))}</button>`;
    el.querySelector('#btn-login').addEventListener('click', () => openAuthModal('login'));
    el.querySelector('#btn-signup').addEventListener('click', () => openAuthModal('signup'));
    return;
  }

  el.innerHTML = `
    <button type="button" class="btn btn-primary btn-sm" id="btn-ask">＋ ${escapeHtml(t('nav.ask'))}</button>
    <button type="button" class="avatar" id="btn-user-menu" aria-label="${escapeHtml(t('nav.profile'))}" aria-haspopup="true">
      ${user.avatar_url ? `<img src="${escapeHtml(user.avatar_url)}" alt="">` : escapeHtml(initials(user.username))}
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
        <button type="button" class="conv-item" data-act="support">☕ <span>${escapeHtml(t('support.menu_btn'))}</span></button>
        <button type="button" class="conv-item" data-act="logout">🚪 <span>${escapeHtml(t('nav.logout'))}</span></button>`;
      menu.querySelector('[data-act="profile"]').addEventListener('click', () => { menu.hidden = true; navigate('/profile'); });
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
      setState({ user });
      refreshAchievements();
    }
    return;
  }

  try {
    const sb = await ensureClient();
    // getSession() — локальное чтение, БЕЗ сетевого запроса:
    // интерфейс разблокируется мгновенно
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    const authUser = data.session.user;

    // Сразу ставим пользователя из метаданных (имя может уточниться фоном)
    setState({
      user: {
        id: authUser.id,
        email: authUser.email,
        username: authUser.user_metadata?.username || (authUser.email || '').split('@')[0],
      },
    });

    // Фоном: полный профиль из БД + самопочинка + достижения
    (async () => {
      let full = await getSessionUser();
      if (full && !full.username) {
        // Строки профиля нет (регистрация до исправления) — создаём
        await ensureProfileRow(authUser);
        invalidateProfileCache(authUser.id);
        full = await getSessionUser();
      }
      if (full) setState({ user: full });
      refreshAchievements();
    })().catch((e) => console.warn('[auth] фоновая догрузка профиля:', e));

    // Слушаем изменения сессии (OAuth-возврат, выход, обновление токена)
    sb.auth.onAuthStateChange(async (event, session) => {
      // INITIAL_SESSION дублирует код выше — пропускаем
      if (event === 'INITIAL_SESSION') return;
      if (session?.user) {
        const { user: cur } = getState();
        // Вход уже обработан модалкой (профиль в state есть) — не дублируем
        if (cur && cur.id === session.user.id && cur.username) return;
        await ensureProfileRow(session.user);
        const merged = (await getSessionUser()) || { id: session.user.id, email: session.user.email };
        setState({ user: merged });
        refreshAchievements();
      } else if (event === 'SIGNED_OUT') {
        setState({ user: null });
      }
    });
  } catch (e) {
    // Клиент недоступен — не роняем приложение
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
 * Какие OAuth-провайдеры реально включены в проекте Supabase.
 * В демо-режиме доступны все (локальная имитация входа).
 * Результат кэшируется; после включения провайдера в дашборде
 * достаточно перезагрузить страницу.
 */
let enabledProvidersPromise = null;
function fetchEnabledProviders() {
  if (isDemo()) return Promise.resolve(['google', 'github', 'apple']);
  if (!enabledProvidersPromise) {
    enabledProvidersPromise = fetch(`${CONFIG.SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY },
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s) =>
        Object.entries(s.external || {})
          .filter(([name, on]) => on && PROVIDER_META[name])
          .map(([name]) => name)
      )
      .catch(() => []);
  }
  return enabledProvidersPromise;
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
        <input type="text" id="auth-username" required minlength="3" maxlength="24" autocomplete="username" placeholder="wavetable_wizard">
      </div>`}
      <div class="field">
        <label for="auth-email">${escapeHtml(t('auth.email'))}</label>
        <input type="email" id="auth-email" required autocomplete="email" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="auth-password">${escapeHtml(t('auth.password'))}</label>
        <input type="password" id="auth-password" required minlength="6" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="••••••••">
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
            if (res.user) { await afterSignIn(res.user, true); close(); }
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
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">${escapeHtml(t('auth.onboarding_skills'))}</p>
      <div class="field">
        <label>${escapeHtml(t('profile.skills'))}</label>
        <div class="chips-input-wrap" id="ob-skills">
          <input type="text" placeholder="FM-синтез, Bass design…" aria-label="${escapeHtml(t('profile.skills'))}">
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button type="button" class="btn btn-quiet" data-next="2">← ${escapeHtml(t('common.back'))}</button>
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

  // Чипсы-инпут для навыков
  {
    const wrap = content.querySelector('#ob-skills');
    const input = wrap.querySelector('input');
    const values = wrap._values = [];
    const addChip = (val) => {
      const v = val.trim();
      if (!v || values.includes(v)) return;
      values.push(v);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(v)} <button type="button" aria-label="Удалить">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        values.splice(values.indexOf(v), 1);
        chip.remove();
      });
      wrap.insertBefore(chip, input);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip(input.value); input.value = ''; }
      if (e.key === 'Backspace' && !input.value && values.length) {
        values.pop();
        wrap.querySelectorAll('.chip').forEach((c, i, arr) => { if (i === arr.length - 1) c.remove(); });
      }
    });
  }

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

  content.querySelector('#ob-finish').addEventListener('click', async () => {
    const bio = content.querySelector('#ob-bio').value.trim();
    const software = [...chosenDaws];
    const skills = content.querySelector('#ob-skills')._values;
    try {
      await updateProfile({ bio, software, skills });
      const { user } = getState();
      setState({ user: { ...user, bio } });
      toast(t('auth.onboarding_done'));
      close();
    } catch (e) {
      toast(e.message || 'Error', 'error');
    }
  });
}