// ============================================================
// admin-db.mjs — экран «🗄 Данные» (/admin, заход 50): таблицы backend-БД
// как в мини-просмотрщике (pgAdmin-стайл): список таблиц → колонки и строки
// (сортировка кликом, пагинация 50/100) → карточка строки в модалке.
// СТРОГО ЧТЕНИЕ: никаких правок из грида (админ-действия живут в /moderation).
// Только для is_admin (guard как у /moderation); в демо — честная заглушка
// (БД показывать нечего: демо-слой живёт в localStorage браузера).
// Секреты (refresh/reset_tokens, password_hash) не приезжают ВООБЩЕ —
// их фильтрует сервер (backend/src/routes/admin.js).
// Заход 52 (PLAN_REAL_MODE T1): названия таблиц/колонок — по-русски
// (словарь admin_db.schema.* в ru.json), оригиналы — в title-подсказках и
// подстрочниках; нет ключа в словаре → показывается оригинал (fallback).
// ============================================================

import { t, getLocale } from './i18n.mjs';
import { escapeHtml, openModal, timeAgo } from './utils.mjs';
import { getState } from './store.mjs';
import { navigate } from './router.mjs';
import {
  isAdminDbAvailable, fetchAdminTables, fetchAdminTableMeta, fetchAdminTableRows,
} from './api.mjs';

const PAGE_SIZES = [50, 100];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- русские имена таблиц/колонок (заход 52, PLAN_REAL_MODE T1) ----------
// Словарь — admin_db.schema.tables.* / admin_db.schema.cols.* в ru.json.
// Нет ключа → t() возвращает сам ключ → показываем оригинал (fallback:
// новые таблицы/колонки не ломают экран). Оригиналы — в title-подсказках
// и мелком подстрочнике (нужны админу для SQL/отладки). Префикс в t(`…`) —
// литералом: check_keys.cjs валидирует динамические ключи по префиксу.
function ruTableName(name) {
  const v = t(`admin_db.schema.tables.${name}`);
  return v.startsWith('admin_db.schema.tables.') ? name : v;
}
function ruColName(table, col) {
  const v = t(`admin_db.schema.cols.${table}.${col}`);
  return v.startsWith('admin_db.schema.cols.') ? col : v;
}

// ---------- рендер ячеек по типам значений ----------
function cellHtml(v) {
  if (v === null || v === undefined) return '<span class="adb-null">—</span>';
  if (typeof v === 'boolean') return `<span class="adb-bool ${v ? 'on' : 'off'}">${v ? '✓' : '✗'}</span>`;
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    const short = s.length > 44 ? `${s.slice(0, 44)}…` : s;
    return `<span class="adb-json" title="${escapeHtml(s)}">${escapeHtml(short)}</span>`;
  }
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+$/.test(v) && Math.abs(Number(v)) > 2 ** 53)) {
    return `<span class="adb-num">${escapeHtml(String(v))}</span>`;
  }
  const str = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return `<span class="adb-time" title="${escapeHtml(str)}">${escapeHtml(timeAgo(str, getLocale()))}</span>`;
  }
  if (UUID_RE.test(str)) return `<span class="adb-uuid" title="${escapeHtml(str)}">${escapeHtml(str.slice(0, 8))}…</span>`;
  if (/^https?:\/\//.test(str)) {
    const short = str.length > 40 ? `${str.slice(0, 40)}…` : str;
    return `<span class="adb-url" title="${escapeHtml(str)}">${escapeHtml(short)}</span>`;
  }
  const clipped = str.length > 64 ? `${str.slice(0, 64)}…` : str;
  return `<span class="adb-text">${escapeHtml(clipped)}</span>`;
}

function fullValueHtml(v) {
  if (v === null || v === undefined) return '<span class="adb-null">—</span>';
  if (typeof v === 'object') return `<pre class="adb-pre">${escapeHtml(JSON.stringify(v, null, 2))}</pre>`;
  return `<span class="adb-full">${escapeHtml(String(v))}</span>`;
}

// ============================================================
// ЭКРАН
// ============================================================

export async function renderAdminDb(container) {
  const { user } = getState();
  // Guard как у /moderation: не-админа разворачивает на главную
  if (!user || !user.is_admin) { navigate('/', { replace: true }); return; }

  const st = {
    tables: [], current: null, meta: null,
    rows: [], offset: 0, limit: PAGE_SIZES[0], orderBy: '', dir: 'asc',
  };

  container.innerHTML = `
    <div class="screen">
      <div class="page-head">
        <h1 class="page-title">${escapeHtml(t('admin_db.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('admin_db.subtitle'))}</p>
      </div>
      ${!isAdminDbAvailable() ? `
        <div class="empty-state">
          <span class="empty-icon">🗄️</span>
          <p>${escapeHtml(t('admin_db.unavailable'))}</p>
        </div>` : `
        <div class="admin-db">
          <aside class="card admin-db-side" aria-label="${escapeHtml(t('admin_db.tables'))}">
            <div class="admin-db-side-head">
              <span>${escapeHtml(t('admin_db.tables'))}</span>
              <button type="button" class="icon-btn" id="adb-refresh" data-help="admin_db_refresh"
                title="${escapeHtml(t('admin_db.refresh'))}" aria-label="${escapeHtml(t('admin_db.refresh'))}">⟳</button>
            </div>
            <div id="adb-list"><div class="loader" style="padding:14px"></div></div>
          </aside>
          <section class="card admin-db-main" id="adb-main">
            <div class="empty-state" style="padding:40px 20px">
              <span class="empty-icon">🧭</span>
              <p>${escapeHtml(t('admin_db.pick_table'))}</p>
            </div>
          </section>
        </div>`}
    </div>`;

  if (!isAdminDbAvailable()) return;

  const listEl = container.querySelector('#adb-list');
  const mainEl = container.querySelector('#adb-main');

  // ---------- список таблиц ----------
  async function loadTables() {
    listEl.innerHTML = '<div class="loader" style="padding:14px"></div>';
    try {
      st.tables = await fetchAdminTables();
    } catch (e) {
      listEl.innerHTML = `<p class="adb-error">${escapeHtml(e.message || 'Error')}</p>`;
      return;
    }
    listEl.innerHTML = st.tables.map((tb) => {
      const ru = ruTableName(tb.name);
      return `
      <button type="button" class="adb-table-btn ${tb.name === st.current ? 'active' : ''}"
        data-table="${escapeHtml(tb.name)}" data-help="admin_db_table" title="${escapeHtml(tb.name)}">
        <span class="adb-table-cell">
          <span class="adb-table-name">${escapeHtml(ru)}</span>
          ${ru !== tb.name ? `<span class="adb-table-orig">${escapeHtml(tb.name)}</span>` : ''}
        </span>
        <span class="adb-table-count">≈${tb.rows_estimate}</span>
      </button>`;
    }).join('');
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-table]');
    if (!btn) return;
    openTable(btn.dataset.table);
  });

  container.querySelector('#adb-refresh')?.addEventListener('click', async () => {
    await loadTables();
    if (st.current) await openTable(st.current);
  });

  // ---------- таблица: meta + строки ----------
  async function openTable(name, keep = false) {
    if (!keep) { st.offset = 0; st.orderBy = ''; st.dir = 'asc'; }
    st.current = name;
    listEl.querySelectorAll('.adb-table-btn').forEach((b) => b.classList.toggle('active', b.dataset.table === name));
    mainEl.innerHTML = '<div class="loader" style="padding:20px"></div>';
    try {
      const [meta, page] = await Promise.all([
        fetchAdminTableMeta(name),
        fetchAdminTableRows(name, { limit: st.limit, offset: st.offset, orderBy: st.orderBy, dir: st.dir }),
      ]);
      st.meta = meta;
      st.rows = page.rows;
      st.orderBy = page.order_by;
      st.dir = page.dir;
      drawGrid();
    } catch (e) {
      mainEl.innerHTML = `<p class="adb-error" style="padding:16px">${escapeHtml(e.message || 'Error')}</p>`;
    }
  }

  function drawGrid() {
    const cols = st.meta.columns;
    const total = st.meta.rows_total;
    const tbRu = ruTableName(st.meta.name);
    const from = total === 0 ? 0 : st.offset + 1;
    const to = Math.min(total, st.offset + st.rows.length);
    mainEl.innerHTML = `
      <div class="admin-db-head">
        <h2 class="admin-db-name" title="${escapeHtml(st.meta.name)}">${escapeHtml(tbRu)}${tbRu !== st.meta.name ? ` <span class="adb-orig">${escapeHtml(st.meta.name)}</span>` : ''}</h2>
        <span class="adb-total">${escapeHtml(t('admin_db.rows_total', { n: total }))}</span>
      </div>
      <div class="admin-db-scroll">
        <table class="adb-grid">
          <thead>
            <tr>${cols.map((c) => `
              <th scope="col">
                <button type="button" class="adb-th" data-col="${escapeHtml(c.name)}" data-help="admin_db_sort"
                  title="${escapeHtml(`${c.name} — ${c.pk ? t('admin_db.pk') : t('admin_db.sort_hint')}`)}">
                  <span class="adb-col">${escapeHtml(ruColName(st.meta.name, c.name))}${c.pk ? ' 🔑' : ''}</span>
                  <span class="adb-type">${escapeHtml(c.type)}</span>
                  ${st.orderBy === c.name ? `<span class="adb-dir">${st.dir === 'asc' ? '▲' : '▼'}</span>` : ''}
                </button>
              </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${st.rows.length ? st.rows.map((r, i) => `
              <tr class="adb-row" data-row="${i}" data-help="admin_db_row" tabindex="0">
                ${cols.map((c) => `<td>${cellHtml(r[c.name])}</td>`).join('')}
              </tr>`).join('') : `<tr><td colspan="${cols.length}" class="adb-empty">${escapeHtml(t('admin_db.empty'))}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="adb-pager" data-help="admin_db_pager">
        <button type="button" class="btn btn-quiet btn-sm" id="adb-prev" ${st.offset === 0 ? 'disabled' : ''}>‹</button>
        <span class="adb-page">${escapeHtml(t('admin_db.page', { from, to, total }))}</span>
        <button type="button" class="btn btn-quiet btn-sm" id="adb-next" ${to >= total ? 'disabled' : ''}>›</button>
        <label class="adb-size">
          <select id="adb-limit">${PAGE_SIZES.map((s) => `<option value="${s}" ${s === st.limit ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <span>${escapeHtml(t('admin_db.page_size'))}</span>
        </label>
      </div>`;

    mainEl.querySelectorAll('.adb-th').forEach((th) => th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (st.orderBy === col) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
      else { st.orderBy = col; st.dir = 'asc'; st.offset = 0; } // новая колонка — с первой страницы
      openTable(st.current, true);
    }));
    mainEl.querySelector('#adb-prev')?.addEventListener('click', () => {
      st.offset = Math.max(0, st.offset - st.limit);
      openTable(st.current, true);
    });
    mainEl.querySelector('#adb-next')?.addEventListener('click', () => {
      st.offset += st.limit;
      openTable(st.current, true);
    });
    mainEl.querySelector('#adb-limit')?.addEventListener('change', (e) => {
      st.limit = Number(e.target.value);
      st.offset = 0;
      openTable(st.current, true);
    });
    mainEl.querySelectorAll('.adb-row').forEach((tr) => {
      const open = () => rowModal(st.rows[Number(tr.dataset.row)]);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  // ---------- карточка строки ----------
  function rowModal(row) {
    if (!row) return;
    const cols = st.meta.columns;
    const content = document.createElement('div');
    content.innerHTML = `
      <dl class="adb-card">${cols.map((c) => `
        <div class="adb-card-row">
          <dt title="${escapeHtml(c.name)}">${escapeHtml(ruColName(st.meta.name, c.name))}${c.pk ? ' 🔑' : ''}<span class="adb-type">${escapeHtml(c.type)}</span></dt>
          <dd>${fullValueHtml(row[c.name])}</dd>
        </div>`).join('')}
      </dl>`;
    openModal({ title: `${t('admin_db.row_card')}: ${ruTableName(st.meta.name)}`, content, wide: true });
  }

  await loadTables();
  if (st.tables.length) await openTable(st.tables[0].name);
}
