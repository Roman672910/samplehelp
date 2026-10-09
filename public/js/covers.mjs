// ============================================================
// covers.mjs — обложка профиля: детерминированная вейвформа из userId.
// Пять стилей на выбор пользователя (сохраняется в profiles.cover_style):
//   depth    — многослойная глубина (три плана баров)
//   mirror   — зеркальное отражение относительно центральной оси
//   spectrum — спектр-иглы (тонкие пики со всплесками)
//   wave     — непрерывная волна (сумма синусоид, path)
//   studio   — студия (бары с «шапками» пиков, сетка, виньетка)
// Каждый стиль — чистый inline-SVG без зависимостей; один и тот же userId
// всегда даёт одну и ту же волну (PRNG ниже). Выбор пользователя меняется
// в модалке редактирования профиля (openEditProfileModal в profile.mjs).
// ============================================================

// Детерминированный PRNG из строки: один userId → всегда одна волна
function makeRnd(seedStr) {
  let s = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { s ^= seedStr.charCodeAt(i); s = Math.imul(s, 16777619) >>> 0; }
  s = s || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------- Стиль «depth»: многослойная глубина ----------
function coverDepth(seed, gid) {
  const rnd = makeRnd(seed);
  const W = 640, H = 90, bars = 64, bw = W / bars;
  let v = 0.3 + rnd() * 0.35;
  let back = '', mid = '', front = '';
  for (let i = 0; i < bars; i++) {
    v = Math.max(0.08, Math.min(0.98, v + (rnd() - 0.5) * 0.36));
    const env = 0.45 + 0.55 * Math.sin((i / bars) * Math.PI);
    const x = (i * bw + bw * 0.18).toFixed(1);
    const w = (bw * 0.64).toFixed(1);
    const hF = Math.round(v * env * 58) + 4;
    const hM = Math.round(hF * 1.45);
    const hB = Math.round(hF * 1.9);
    front += `<rect x="${x}" y="${((H - hF) / 2).toFixed(1)}" width="${w}" height="${hF}" rx="${(w / 2).toFixed(1)}"/>`;
    mid   += `<rect x="${x}" y="${((H - hM) / 2).toFixed(1)}" width="${w}" height="${hM}" rx="${(w / 2).toFixed(1)}"/>`;
    back  += `<rect x="${x}" y="${((H - hB) / 2).toFixed(1)}" width="${w}" height="${hB}" rx="${(w / 2).toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <linearGradient id="${gid}-depth" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b87333"/><stop offset=".5" stop-color="#cd7f32"/><stop offset="1" stop-color="#ff8c00"/>
    </linearGradient>
    <linearGradient id="${gid}-depth-f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb066"/><stop offset=".5" stop-color="#ff8c00"/><stop offset="1" stop-color="#b87333"/>
    </linearGradient>
    <filter id="${gid}-depth-g" x="-20%" y="-60%" width="140%" height="220%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g fill="url(#${gid}-depth)" opacity=".13">${back}</g>
  <g fill="url(#${gid}-depth)" opacity=".26">${mid}</g>
  <g fill="url(#${gid}-depth-f)" opacity=".92" filter="url(#${gid}-depth-g)">${front}</g>
  </svg>`;
}

// ---------- Стиль «mirror»: зеркало + затухание ----------
function coverMirror(seed, gid) {
  const rnd = makeRnd(seed);
  const W = 640, H = 90, bars = 88, bw = W / bars;
  let v = 0.28 + rnd() * 0.3;
  let top = '', bottom = '';
  for (let i = 0; i < bars; i++) {
    v = Math.max(0.06, Math.min(1, v + (rnd() - 0.5) * 0.3));
    // огибающая: два горба — слева и справа, провал в центре (под аватаром тихо)
    const t = i / bars;
    const env = 0.35 + 0.65 * (Math.sin(t * Math.PI * 1.9) ** 2 * 0.7 + Math.sin(t * Math.PI) * 0.3);
    const x = (i * bw + bw * 0.2).toFixed(1);
    const w = (bw * 0.6).toFixed(1);
    const h = Math.round(v * env * 38) + 3;
    top    += `<rect x="${x}" y="${(44 - h).toFixed(1)}" width="${w}" height="${h}" rx="${(w / 2).toFixed(1)}"/>`;
    bottom += `<rect x="${x}" y="45" width="${w}" height="${Math.round(h * 0.72)}" rx="${(w / 2).toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <linearGradient id="${gid}-mirror" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8a5a2b"/><stop offset=".45" stop-color="#cd7f32"/><stop offset="1" stop-color="#ff9a2e"/>
    </linearGradient>
    <linearGradient id="${gid}-mirror-m" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g fill="url(#${gid}-mirror)">${top}</g>
  <g fill="url(#${gid}-mirror)" opacity=".3">${bottom}</g>
  <mask id="${gid}-mirror-mask"><rect width="${W}" height="${H}" fill="url(#${gid}-mirror-m)"/></mask>
  <g fill="url(#${gid}-mirror)" mask="url(#${gid}-mirror-mask)" opacity=".5" transform="translate(0,1) scale(1,-1) translate(0,-89)">${bottom}</g>
  <line x1="0" y1="44.5" x2="${W}" y2="44.5" stroke="#ff8c00" stroke-opacity=".22" stroke-width="1"/>
  </svg>`;
}

// ---------- Стиль «spectrum»: спектр-пики (тонкие иглы) ----------
function coverSpectrum(seed, gid) {
  const rnd = makeRnd(seed);
  const W = 640, H = 90, bars = 160, bw = W / bars;
  let v = 0.2;
  let main = '', glow = '';
  for (let i = 0; i < bars; i++) {
    v = Math.max(0.05, Math.min(1, v + (rnd() - 0.5) * 0.22));
    const t = i / bars;
    const env = 0.4 + 0.6 * Math.sin(t * Math.PI);
    const spike = rnd() > 0.94 ? 1.5 : 1;
    const x = (i * bw + bw * 0.25).toFixed(2);
    const w = (bw * 0.5).toFixed(2);
    const h = Math.max(2, Math.round(v * env * spike * 72));
    main += `<rect x="${x}" y="${(H - h - 6).toFixed(1)}" width="${w}" height="${h}" rx="${(w / 2).toFixed(2)}"/>`;
    glow += `<rect x="${x}" y="${(H - h - 6).toFixed(1)}" width="${w}" height="${h}" rx="${(w / 2).toFixed(2)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <linearGradient id="${gid}-spec" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#7a4d22"/><stop offset=".45" stop-color="#cd7f32"/><stop offset="1" stop-color="#ffc061"/>
    </linearGradient>
    <linearGradient id="${gid}-spec-f" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff8c00" stop-opacity="0"/><stop offset=".5" stop-color="#ff8c00" stop-opacity=".5"/><stop offset="1" stop-color="#ff8c00" stop-opacity="0"/>
    </linearGradient>
    <filter id="${gid}-spec-blur"><feGaussianBlur stdDeviation="2.6"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${gid}-spec-f)" opacity=".35"/>
  <g fill="url(#${gid}-spec)" filter="url(#${gid}-spec-blur)" opacity=".5">${glow}</g>
  <g fill="url(#${gid}-spec)">${main}</g>
  </svg>`;
}

// ---------- Стиль «wave»: непрерывная волна (path) ----------
function coverWave(seed, gid) {
  const rnd = makeRnd(seed);
  const W = 640, H = 90, pts = 96;
  const a1 = 10 + rnd() * 12, a2 = 4 + rnd() * 7, a3 = 2 + rnd() * 4;
  const f1 = 1.2 + rnd() * 1.4, f2 = 3.1 + rnd() * 2.4, f3 = 7 + rnd() * 5;
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
  const ys = [];
  for (let i = 0; i <= pts; i++) {
    const t = i / pts;
    const env = Math.sin(t * Math.PI) ** 0.7;
    const y = 45 - (a1 * Math.sin(t * Math.PI * 2 * f1 + p1)
                  + a2 * Math.sin(t * Math.PI * 2 * f2 + p2)
                  + a3 * Math.sin(t * Math.PI * 2 * f3 + p3)) * env * 0.62;
    ys.push(+y.toFixed(2));
  }
  const line = ys.map((y, i) => `${i ? 'L' : 'M'}${(i / pts * W).toFixed(1)},${y}`).join(' ');
  const band = `${line} L${W},${H} L0,${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <linearGradient id="${gid}-wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b87333"/><stop offset=".5" stop-color="#cd7f32"/><stop offset="1" stop-color="#ff8c00"/>
    </linearGradient>
    <linearGradient id="${gid}-wave-f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cd7f32" stop-opacity=".34"/><stop offset="1" stop-color="#cd7f32" stop-opacity="0"/>
    </linearGradient>
    <filter id="${gid}-wave-glow" x="-10%" y="-60%" width="120%" height="220%">
      <feGaussianBlur stdDeviation="3.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="${band}" fill="url(#${gid}-wave-f)"/>
  <path d="${line}" fill="none" stroke="url(#${gid}-wave)" stroke-width="1.8" stroke-opacity=".85" filter="url(#${gid}-wave-glow)"/>
  <path d="${line}" fill="none" stroke="#ffd7a8" stroke-width=".7" stroke-opacity=".38"/>
  </svg>`;
}

// ---------- Стиль «studio»: бары с шапками, сетка, виньетка ----------
function coverStudio(seed, gid) {
  const rnd = makeRnd(seed);
  const W = 640, H = 90, bars = 56, bw = W / bars;
  let v = 0.32 + rnd() * 0.3;
  let rects = '', peaks = '';
  for (let i = 0; i < bars; i++) {
    v = Math.max(0.08, Math.min(0.98, v + (rnd() - 0.5) * 0.34));
    const env = 0.5 + 0.5 * Math.sin((i / bars) * Math.PI);
    const x = (i * bw + bw * 0.22).toFixed(1);
    const w = (bw * 0.56).toFixed(1);
    const h = Math.round(v * env * 54) + 5;
    rects += `<rect x="${x}" y="${(H - h - 14).toFixed(1)}" width="${w}" height="${h}" rx="${(w / 2).toFixed(1)}"/>`;
    // «шапка» пика как в студийном анализаторе
    peaks += `<rect x="${x}" y="${(H - h - 17.5).toFixed(1)}" width="${w}" height="2" rx="1" opacity=".85"/>`;
  }
  let grid = '';
  for (let g = 0; g <= 8; g++) grid += `<line x1="0" y1="${(g * H / 8).toFixed(1)}" x2="${W}" y2="${(g * H / 8).toFixed(1)}" stroke="#b87333" stroke-opacity=".07" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>
    <linearGradient id="${gid}-studio" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8a5423"/><stop offset=".55" stop-color="#cd7f32"/><stop offset="1" stop-color="#ffab3d"/>
    </linearGradient>
    <radialGradient id="${gid}-studio-vig" cx=".5" cy=".5" r=".72">
      <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0d0d0f" stop-opacity=".72"/>
    </radialGradient>
  </defs>
  ${grid}
  <g fill="url(#${gid}-studio)" opacity=".88">${rects}</g>
  <g fill="#ffd7a8">${peaks}</g>
  <rect width="${W}" height="${H}" fill="url(#${gid}-studio-vig)"/>
  </svg>`;
}

/** Стили обложки: id (в profiles.cover_style) → генератор */
export const COVER_STYLES = [
  { id: 'depth',    gen: coverDepth },
  { id: 'mirror',   gen: coverMirror },
  { id: 'spectrum', gen: coverSpectrum },
  { id: 'wave',     gen: coverWave },
  { id: 'studio',   gen: coverStudio },
];

export const DEFAULT_COVER_STYLE = 'depth';

function styleById(id) {
  return COVER_STYLES.find((s) => s.id === id) || COVER_STYLES[0];
}

/**
 * Обложка профиля.
 * @param {string} seedStr — userId (волна уникальна для пользователя)
 * @param {string} [style] — один из COVER_STYLES[].id (profiles.cover_style)
 * @returns {string} inline-SVG
 */
export function coverSvg(seedStr, style = DEFAULT_COVER_STYLE) {
  const s = String(seedStr || 'anon');
  const st = styleById(style); // неизвестный стиль → DEFAULT (и в id тоже)
  // id градиентов/фильтров уникальны на обложку: на странице может быть
  // несколько превью (пикер в модалке + сама шапка профиля)
  const gid = `shcov-${st.id}-${s.replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 48);
  return st.gen(s, gid);
}