// ============================================================
// audio.mjs — аудио-подсистема:
// • кастомный плеер на базе <audio> + canvas-вейвформа
//        (WaveSurfer.js подключается опционально с CDN)
// • мини-вейвформы для карточек ленты
// • нормализация громкости загруженного аудио
// • извлечение РЕАЛЬНЫХ пиков из аудиофайла (вейвформа = семплу)
// Спектрограмма и зацикливание НЕ реализуются (см. ТЗ).
// ============================================================

import { CONFIG } from './config.mjs';
import { formatTime, escapeHtml, toast } from './utils.mjs';
import { t } from './i18n.mjs';

// ---------- WaveSurfer.js: опциональная загрузка с CDN ----------
let wavesurferModule = null;
export async function loadWaveSurfer() {
  if (wavesurferModule !== null) return wavesurferModule;
  try {
    wavesurferModule = await import(/* @vite-ignore */ CONFIG.WAVESURFER_CDN);
  } catch {
    console.info('[audio] WaveSurfer.js недоступен (офлайн) — использую встроенную canvas-вейвформу');
    wavesurferModule = false;
  }
  return wavesurferModule;
}

export async function loadWaveSurferRegions() {
  try {
    return await import(/* @vite-ignore */ CONFIG.WAVESURFER_REGIONS_CDN);
  } catch {
    return null;
  }
}

// ============================================================
// МИНИ-ВЕЙВФОРМА (карточки ленты)
// ============================================================

/**
 * Рисует мини-вейвформу на canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} data — амплитуды 0..1 (реальные пики семпла)
 * @param {number} progress — 0..1 (доля проигранного)
 * @param {Array<{time:number, note?:string}>} markers — пины «вот этот момент»
 * @param {number} duration — длительность аудио (сек) для позиций пинов
 */
export function drawMiniWave(canvas, data = [], progress = 0, markers = [], duration = 0) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 200;
  const h = canvas.clientHeight || 44;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const bars = data.length || 60;
  const barW = w / bars;
  const gap = Math.max(1, barW * 0.25);

  for (let i = 0; i < bars; i++) {
    const amp = data[i] ?? 0.1;
    const barH = Math.max(2, amp * (h - 8));
    const x = i * barW;
    const y = (h - barH) / 2;
    const played = i / bars <= progress;
    if (played) {
      const grad = ctx.createLinearGradient(x, 0, x, h);
      grad.addColorStop(0, '#ff8c00');
      grad.addColorStop(1, '#b87333');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(154,154,160,0.35)';
    }
    ctx.fillRect(x + gap / 2, y, Math.max(1, barW - gap), barH);
  }

  // Линия воспроизведения
  if (progress > 0 && progress < 1) {
    ctx.fillStyle = 'rgba(255,140,0,0.9)';
    ctx.fillRect(progress * w - 0.5, 2, 1.5, h - 4);
  }

  // Пины маркеров («слушай здесь»)
  if (duration > 0 && markers.length) {
    for (const m of markers) {
      const mx = ((m.time || 0) / duration) * w;
      if (mx < 0 || mx > w) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(mx, 4);
      ctx.lineTo(mx, h - 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8c00';
      ctx.beginPath();
      ctx.arc(Math.max(2, Math.min(w - 2, mx)), 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- Реестр транзиентных плееров: глушим при смене экрана ----------
const transientCleanups = new Set();
export function registerTransient(fn) {
  transientCleanups.add(fn);
  return () => transientCleanups.delete(fn);
}
/** Остановить все превью/A-B плееры (вызывается роутером при смене экрана) */
export function cleanupTransientAudio() {
  stopPreview();
  transientCleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  transientCleanups.clear();
}

// ---------- Глобальный одиночный preview-плеер ----------
let previewAudio = null;
let previewCanvas = null;
let previewRaf = null;
let previewData = [];
let previewMarkers = [];    // маркеры текущего превью (пины на вейвформе)
let previewDuration = 0;    // длительность — для пинов после остановки
let previewMarkerIdx = -1;  // с какого маркера играет превью (-1 — не с маркера)
let previewChipsEl = null;  // контейнер мини-чипов маркеров рядом с canvas
let previewChipEl = null;   // конкретный чип (мини или комментария), запустивший превью
let previewSeekTo = 0;      // перемотка после loadedmetadata

/** Подсветка чипа, с которого сейчас идёт превью */
function updatePreviewChips() {
  const playing = !!(previewAudio && !previewAudio.paused);
  if (previewChipsEl) {
    previewChipsEl.querySelectorAll('.marker-chip').forEach((chip) => {
      chip.classList.toggle('playing', playing && Number(chip.dataset.mi) === previewMarkerIdx);
    });
  }
  if (previewChipEl) previewChipEl.classList.toggle('playing', playing);
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  if (previewRaf) cancelAnimationFrame(previewRaf);
  previewRaf = null;
  previewMarkerIdx = -1;
  previewSeekTo = 0;
  updatePreviewChips(); // снять подсветку до сброса ссылок
  previewChipEl = null;
  if (previewCanvas) {
    drawMiniWave(previewCanvas, previewData, 0, previewMarkers, previewDuration);
    previewCanvas = null;
  }
  previewChipsEl = null;
}

/**
 * Запускает глобальное превью на canvas (одно на всё приложение).
 * @param {HTMLCanvasElement} canvas
 * @param {string} audioUrl
 * @param {number[]} data — пики вейвформы
 * @param {Array} markers — маркеры (пины)
 * @param {number} startTime — с какого момента играть (сек)
 * @param {number} markerIdx — индекс маркера-источника (подсветка чипа)
 * @param {HTMLElement|null} chipEl — чип-источник (для toggle и подсветки)
 */
export function startPreviewAt(canvas, audioUrl, data = [], markers = [], startTime = 0, markerIdx = -1, chipEl = null) {
  stopPreview();
  previewCanvas = canvas;
  previewData = data;
  previewMarkers = markers || [];
  previewMarkerIdx = markerIdx;
  previewChipEl = chipEl;
  previewChipsEl = canvas.parentElement?.querySelector('.mini-marker-list') || null;
  previewSeekTo = Math.max(0, startTime || 0);
  previewAudio = new Audio(audioUrl);
  previewAudio.addEventListener('loadedmetadata', () => {
    previewDuration = previewAudio?.duration || 0;
    if (previewSeekTo && previewAudio) {
      try { previewAudio.currentTime = Math.min(previewSeekTo, previewAudio.duration || previewSeekTo); } catch { /* ignore */ }
    }
    updatePreviewChips();
  });
  previewAudio.addEventListener('play', updatePreviewChips);
  previewAudio.addEventListener('pause', updatePreviewChips);
  previewAudio.addEventListener('ended', stopPreview);
  previewAudio.play().catch((err) => console.warn('[audio] preview play:', err));
  const tick = () => {
    if (!previewAudio) return;
    drawMiniWave(canvas, data, previewAudio.duration ? previewAudio.currentTime / previewAudio.duration : 0, markers, previewAudio.duration);
    if (!previewAudio.paused) previewRaf = requestAnimationFrame(tick);
  };
  tick();
}

/** Приводит маркеры к [{ time: number, note: string }] (защита от мусора) */
function normalizeMarkers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => ({ time: Number(m?.time) || 0, note: String(m?.note || '') }))
    .filter((m) => m.time >= 0);
}

/**
 * Привязывает клик по мини-вейвформе к аудио-превью.
 * Одновременно играет только один превью-плеер.
 * Маркеры (если есть) рисуются пинами на вейвформе и чипами под ней:
 * клик по чипу — игра с этого момента, повторный клик — пауза.
 */
export function attachMiniPlayer(canvas, audioUrl, data = [], markers = []) {
  if (canvas.dataset.miniBound) return;
  canvas.dataset.miniBound = '1';
  const marks = normalizeMarkers(markers);
  let knownDuration = 0;
  const redraw = (progress) => drawMiniWave(canvas, data, progress, marks, knownDuration);

  if (marks.length) {
    // Чипы маркеров под вейвформой
    const chips = document.createElement('div');
    chips.className = 'marker-list mini-marker-list';
    const hint = t('question.marker_toggle_hint');
    chips.innerHTML = marks.map((m, i) => `
      <button type="button" class="marker-chip" data-mi="${i}" title="${escapeHtml(m.note ? `${m.note} — ${hint}` : hint)}">
        <span class="marker-dot" aria-hidden="true"></span>${escapeHtml(formatTime(m.time))}${m.note ? ` · ${escapeHtml(m.note)}` : ''}
      </button>`).join('');
    canvas.insertAdjacentElement('afterend', chips);
    chips.addEventListener('click', (e) => {
      e.stopPropagation(); // не раскрывать карточку вопроса в ленте
      const chip = e.target.closest('[data-mi]');
      if (!chip) return;
      const i = Number(chip.dataset.mi);
      const m = marks[i];
      if (!m) return;
      // Повторный клик по маркеру, с которого сейчас идёт игра, — пауза
      if (previewCanvas === canvas && previewAudio && !previewAudio.paused && previewMarkerIdx === i) {
        previewAudio.pause();
        return;
      }
      startPreviewAt(canvas, audioUrl, data, marks, m.time, i, chip);
    });
    // Пины видны сразу: догружаем длительность из метаданных
    const meta = new Audio(audioUrl);
    meta.preload = 'metadata';
    meta.addEventListener('loadedmetadata', () => {
      knownDuration = meta.duration || 0;
      if (previewCanvas !== canvas) redraw(0); // не затираем играющее превью
    });
  }

  canvas.addEventListener('click', (e) => {
    e.stopPropagation();
    // Клик по тому же плееру — пауза
    if (previewCanvas === canvas && previewAudio && !previewAudio.paused) {
      previewAudio.pause();
      return;
    }
    startPreviewAt(canvas, audioUrl, data, marks, 0, -1, null);
  });
  // Перерисовать в исходном состоянии
  requestAnimationFrame(() => redraw(0));
}

// ============================================================
// ПИКЕР МАРКЕРОВ (форма ответа): «вот этот момент» в своём аудио
// ============================================================

/**
 * Мини-плеер с кнопкой «📍 Маркер» для аудио в форме ответа.
 * Маркер ставится на текущую позицию прослушивания; не больше max штук.
 * @param {HTMLElement} container
 * @param {object} opts { blob, peaks, duration, markers, max }
 * @returns {{ getValue(): Array<{time:number, note:string}>, destroy(): void }}
 */
export function createMarkerPicker(container, { blob, peaks = [], duration = 0, markers = [], max = CONFIG.MAX_MARKERS } = {}) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'metadata';
  let marks = normalizeMarkers(markers).slice(0, max);
  let raf = null;

  container.innerHTML = `
    <div class="marker-picker">
      <div class="marker-picker-head">📍 ${escapeHtml(t('answer.markers_label', { n: max }))}</div>
      <canvas class="picker-wave" role="button" tabindex="0" aria-label="${escapeHtml(t('feed.play_preview'))}"></canvas>
      <div class="picker-controls">
        <button type="button" class="play-btn picker-play" aria-label="${escapeHtml(t('question.play'))}">▶</button>
        <span class="time-display"><span class="p-cur">0:00</span> / <span class="p-dur">${escapeHtml(formatTime(duration))}</span></span>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm picker-mark">📍 ${escapeHtml(t('trimmer.marker_add'))}</button>
      </div>
      <div class="mark-list picker-list"></div>
      <div class="hint">${escapeHtml(t('answer.marker_hint'))}</div>
    </div>`;

  const canvas = container.querySelector('.picker-wave');
  const playBtn = container.querySelector('.picker-play');
  const markBtn = container.querySelector('.picker-mark');
  const list = container.querySelector('.picker-list');
  const tCur = container.querySelector('.p-cur');
  const tDur = container.querySelector('.p-dur');

  const draw = (progress = 0) => drawMiniWave(canvas, peaks, progress, marks, audio.duration || duration);

  audio.addEventListener('loadedmetadata', () => {
    tDur.textContent = formatTime(audio.duration || duration);
    draw(audio.currentTime / (audio.duration || 1));
  });
  audio.addEventListener('play', () => {
    playBtn.textContent = '⏸';
    playBtn.setAttribute('aria-label', t('question.pause'));
    const tick = () => {
      tCur.textContent = formatTime(audio.currentTime);
      draw(audio.duration ? audio.currentTime / audio.duration : 0);
      if (!audio.paused) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  audio.addEventListener('pause', () => {
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', t('question.play'));
    if (raf) cancelAnimationFrame(raf);
  });
  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶';
    draw(1);
  });

  const toggle = () => {
    if (audio.paused) audio.play().catch((e) => console.warn('[picker] play:', e));
    else audio.pause();
  };
  playBtn.addEventListener('click', toggle);
  // Клик по вейвформе — перемотка (игра продолжается с нового места)
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    if (audio.duration) audio.currentTime = ratio * audio.duration;
    tCur.textContent = formatTime(audio.currentTime);
    draw(ratio);
  });

  function sortedMarks() {
    return [...marks].sort((a, b) => a.time - b.time);
  }

  function renderList() {
    list.innerHTML = sortedMarks().map((m, i) => `
      <span class="mark-chip">
        <span class="marker-dot" aria-hidden="true"></span>
        <span class="mark-time">${escapeHtml(formatTime(m.time))}</span>
        <button type="button" data-mrm="${i}" aria-label="${escapeHtml(t('common.delete'))}">✕</button>
      </span>`).join('');
    const full = marks.length >= max;
    markBtn.disabled = full;
    markBtn.title = full ? t('trimmer.marker_limit', { n: max }) : '';
  }

  markBtn.addEventListener('click', () => {
    if (marks.length >= max) { toast(t('trimmer.marker_limit', { n: max })); return; }
    marks.push({ time: +(audio.currentTime || 0).toFixed(3), note: '' });
    renderList();
    draw(audio.duration ? audio.currentTime / audio.duration : 0);
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mrm]');
    if (!btn) return;
    const target = sortedMarks()[Number(btn.dataset.mrm)];
    marks = marks.filter((m) => m !== target);
    renderList();
    draw(audio.duration ? audio.currentTime / audio.duration : 0);
  });

  renderList();
  requestAnimationFrame(() => draw(0));

  return {
    /** Маркеры в порядке времени, относительные к загруженному аудио */
    getValue() {
      const dur = audio.duration || duration || Infinity;
      return sortedMarks()
        .filter((m) => m.time <= dur)
        .map((m) => ({ time: +m.time.toFixed(3), note: m.note || '' }));
    },
    destroy() {
      audio.pause();
      audio.src = '';
      if (raf) cancelAnimationFrame(raf);
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      container.innerHTML = '';
    },
  };
}

// ============================================================
// ПОЛНЫЙ ПЛЕЕР (страница вопроса) — только вейвформа
// ============================================================

/**
 * Создаёт плеер: вейвформа по реальным пикам семпла с прогрессом,
 * play/pause, перемотка кликом, время.
 * Чипы маркеров работают как независимый play/pause «от маркера»:
 * клик — игра с этого момента, повторный клик по играющему — пауза.
 * Кнопка ▶ при этом ведёт себя как раньше (с текущего места).
 * @param {HTMLElement} container
 * @param {object} opts { url, waveform }
 * @returns {function} cleanup — остановить аудио
 */
export function createPlayer(container, { url, waveform = [], markers = [] }) {
  const audio = new Audio(url);
  audio.preload = 'metadata';

  container.innerHTML = `
    <div class="player-wave-wrap">
      <canvas class="player-wave" role="img" aria-label="${escapeHtml(t('question.waveform_aria'))}"></canvas>
    </div>
    <div class="player-controls">
      <button type="button" class="play-btn" aria-label="${escapeHtml(t('question.play'))}">▶</button>
      <span class="time-display"><span class="t-cur">0:00</span> / <span class="t-dur">0:00</span></span>
    </div>
    ${markers.length ? `<div class="marker-list" id="marker-list"></div>` : ''}`;

  const waveCanvas = container.querySelector('.player-wave');
  const playBtn = container.querySelector('.play-btn');
  const tCur = container.querySelector('.t-cur');
  const tDur = container.querySelector('.t-dur');
  const data = waveform;

  let raf = null;
  let activeMarker = -1; // с какого маркера запущено воспроизведение (-1 — не с маркера)
  const markerList = container.querySelector('#marker-list');

  /** Подсветка чипа маркера, с которого сейчас идёт игра */
  function updateMarkerChips() {
    if (!markerList) return;
    const playing = !audio.paused;
    markerList.querySelectorAll('.marker-chip').forEach((chip) => {
      chip.classList.toggle('playing', playing && Number(chip.dataset.mi) === activeMarker);
    });
  }

  function drawProgress() {
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    drawPlayerWave(waveCanvas, data, progress, markers, audio.duration);
    tCur.textContent = formatTime(audio.currentTime);
    if (!audio.paused) raf = requestAnimationFrame(drawProgress);
  }

  playBtn.addEventListener('click', () => {
    activeMarker = -1; // ручное управление — игра больше не «от маркера»
    updateMarkerChips();
    if (audio.paused) {
      stopPreview(); // глушим превью в ленте
      audio.play().catch((e) => console.warn('[audio] play:', e));
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => {
    playBtn.textContent = '⏸';
    playBtn.setAttribute('aria-label', t('question.pause'));
    updateMarkerChips();
    raf = requestAnimationFrame(drawProgress);
  });
  audio.addEventListener('pause', () => {
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', t('question.play'));
    updateMarkerChips();
    if (raf) cancelAnimationFrame(raf);
  });
  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶';
    activeMarker = -1; // трек доиграл — привязка к маркеру сброшена
    updateMarkerChips();
    drawPlayerWave(waveCanvas, data, 1, markers, audio.duration);
  });
  audio.addEventListener('loadedmetadata', () => {
    tDur.textContent = formatTime(audio.duration);
    drawPlayerWave(waveCanvas, data, 0, markers, audio.duration);
  });
  if (audio.duration) {
    tDur.textContent = formatTime(audio.duration);
    drawPlayerWave(waveCanvas, data, 0, markers, audio.duration);
  }

  // Клик по вейвформе — перемотка
  waveCanvas.addEventListener('click', (e) => {
    const rect = waveCanvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    if (audio.duration) audio.currentTime = ratio * audio.duration;
    activeMarker = -1; // перемотка руками — привязка к маркеру снята
    updateMarkerChips();
    drawPlayerWave(waveCanvas, data, ratio, markers, audio.duration);
  });

  // Чипы маркеров: клик — play/pause «от маркера» (независимо от кнопки ▶).
  // Первый клик — игра с этого момента, повторный клик по играющему — пауза,
  // клик по другому маркеру — переход на него без остановки.
  if (markerList && markers.length) {
    const hint = t('question.marker_toggle_hint');
    markerList.innerHTML = markers.map((m, i) => `
      <button type="button" class="marker-chip" data-mi="${i}" title="${escapeHtml(m.note ? `${m.note} — ${hint}` : hint)}">
        <span class="marker-dot" aria-hidden="true"></span>${escapeHtml(formatTime(m.time || 0))}${m.note ? ` · ${escapeHtml(m.note)}` : ''}
      </button>`).join('');
    markerList.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-mi]');
      if (!chip) return;
      const i = Number(chip.dataset.mi);
      const m = markers[i];
      if (!m || !audio.duration) return;
      // Повторный клик по маркеру, с которого сейчас идёт игра, — пауза
      if (i === activeMarker && !audio.paused) {
        audio.pause();
        return;
      }
      // Иначе — игра с этого момента
      stopPreview(); // глушим превью в ленте
      activeMarker = i;
      audio.currentTime = Math.min(m.time || 0, audio.duration);
      drawPlayerWave(waveCanvas, data, audio.currentTime / audio.duration, markers, audio.duration);
      tCur.textContent = formatTime(audio.currentTime);
      audio.play().catch((err) => console.warn('[audio] marker play:', err));
    });
  }

  drawPlayerWave(waveCanvas, data, 0, markers, audio.duration);

  return function cleanup() {
    audio.pause();
    audio.src = '';
    if (raf) cancelAnimationFrame(raf);
  };
}

/** Большая вейвформа плеера: медный прогресс + пины маркеров + курсор */
function drawPlayerWave(canvas, data, progress, markers = [], duration = 0) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 90;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!data || !data.length) {
    ctx.strokeStyle = 'rgba(154,154,160,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    return;
  }

  const bars = Math.min(data.length, Math.floor(w / 3));
  const barW = w / bars;
  const mid = h / 2;

  for (let i = 0; i < bars; i++) {
    const amp = data[Math.floor((i / bars) * data.length)] ?? 0.1;
    const barH = Math.max(2, amp * (h - 10));
    const x = i * barW;
    const played = i / bars <= progress;
    if (played) {
      const grad = ctx.createLinearGradient(0, mid - barH / 2, 0, mid + barH / 2);
      grad.addColorStop(0, '#ff8c00');
      grad.addColorStop(0.5, '#cd7f32');
      grad.addColorStop(1, '#b87333');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(154,154,160,0.3)';
    }
    ctx.fillRect(x + 0.5, mid - barH / 2, Math.max(1, barW - 1.5), barH);
  }

  // Пины маркеров («слушай здесь»)
  if (duration && markers.length) {
    for (const m of markers) {
      const x = ((m.time || 0) / duration) * w;
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8c00';
      ctx.shadowColor = 'rgba(255,140,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, 6, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Курсор воспроизведения
  ctx.fillStyle = '#ff8c00';
  ctx.shadowColor = 'rgba(255,140,0,0.8)';
  ctx.shadowBlur = 6;
  ctx.fillRect(progress * w - 1, 0, 2, h);
  ctx.shadowBlur = 0;
}

// ============================================================
// НОРМАЛИЗАЦИЯ ГРОМКОСТИ ЗАГРУЖЕННОГО АУДИО
// ============================================================

/**
 * Нормализует пиковую громкость файла до targetPeak (по умолчанию -1 dBFS).
 * @param {File|Blob} file
 * @returns {Promise<Blob>} — WAV-blob нормализованного аудио
 */
export async function normalizeAudio(file, targetPeak = 0.891) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const arrayBuf = await file.arrayBuffer();
    const buffer = await ac.decodeAudioData(arrayBuf);

    // Поиск пика
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak === 0) peak = 1;
    const gain = targetPeak / peak;

    // OfflineAudioContext: буфер → GainNode → выход
    const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    const gainNode = offline.createGain();
    gainNode.gain.value = gain;
    src.connect(gainNode).connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return bufferToWavBlob(rendered);
  } finally {
    ac.close();
  }
}

/** AudioBuffer → WAV Blob (16-bit PCM) */
export function bufferToWavBlob(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(len);
  const view = new DataView(ab);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, len - 8, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, buffer.length * numCh * 2, true);

  const channels = [];
  for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/**
 * Извлечение РЕАЛЬНЫХ пиков из аудиофайла — вейвформа соответствует семплу.
 * @param {File|Blob} fileOrBlob
 * @param {number} points — число пиков
 * @returns {Promise<{peaks: number[], duration: number}>}
 */
export async function extractWaveform(fileOrBlob, points = 160) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const buf = await ac.decodeAudioData(await fileOrBlob.arrayBuffer());
    return peaksFromBuffer(buf, points);
  } finally {
    ac.close();
  }
}

/** Пики из AudioBuffer (без повторного декодирования) */
export function peaksFromBuffer(buffer, points = 160) {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / points) || 1;
  const peaks = [];
  for (let i = 0; i < points; i++) {
    let max = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[i * block + j] || 0);
      if (v > max) max = v;
    }
    peaks.push(+max.toFixed(3));
  }
  return { peaks, duration: buffer.duration };
}

// ============================================================
// ЗАПИСЬ ЗВУКА: микрофон ('mic') или захват с компьютера ('display')
// ============================================================

/**
 * Универсальный рекордер.
 • source: 'mic' — сразу запись с микрофона
 • source: 'display' — захват звука вкладки/экрана через getDisplayMedia:
     сначала выбирается источник (видео-трек сразу гасится), затем панель
     «сигнал захвачен» с ЖИВЫМ индикатором уровня — пользователь включает
     музыку и жмёт «Начать запись» в нужный момент; авто-стоп по maxSeconds.
 * @param {HTMLElement} container
 * @param {object} opts { onRecorded(blob), source, label, readyText, startLabel, maxSeconds, autoStart, singleShot }
 *        singleShot: true — «одноразовый» режим (захват с компьютера в форме вопроса):
 *        после записи, отмены или ошибки захвата UI рекордера убирается полностью,
 *        вместо возврата к idle-кнопке (иначе она дублирует внешнюю кнопку запуска)
 * @returns {{ destroy(): void }}
 */
export function createRecorder(container, {
  onRecorded,
  source = 'mic',
  label = '🎙',
  readyText = '',
  startLabel = '',
  maxSeconds = 60,
  autoStart = false,
  singleShot = false,
}) {
  const isDisplay = source === 'display';
  container.innerHTML = `
    <span class="rec-idle">
      <button type="button" class="rec-start" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>
    </span>
    <span class="rec-ready" hidden>
      <span class="rec-live" aria-hidden="true"></span>
      <span class="rec-ready-text">${escapeHtml(readyText || t('ask.capture_ready'))}</span>
      <canvas class="rec-meter" width="56" height="16" aria-hidden="true"></canvas>
      <button type="button" class="rec-start-btn">⏺ ${escapeHtml(startLabel || t('ask.capture_start'))}</button>
      <button type="button" class="rec-cancel" aria-label="${escapeHtml(t('common.cancel'))}">✕</button>
    </span>
    <span class="rec-ui" hidden>
      <span class="rec-dot" aria-hidden="true"></span>
      <span class="rec-time">0:00</span>
      <canvas class="rec-meter rec-meter-rec" width="56" height="16" aria-hidden="true"></canvas>
      <button type="button" class="rec-stop" aria-label="${escapeHtml(t('messages.stop_record'))}" title="${escapeHtml(t('messages.stop_record'))}">⏹</button>
    </span>`;

  const idleEl = container.querySelector('.rec-idle');
  const readyEl = container.querySelector('.rec-ready');
  const recEl = container.querySelector('.rec-ui');

  let sourceStream = null;   // исходный поток (mic или display)
  let audioStream = null;    // только аудио — для рекордера/анализатора
  let recorder = null, chunks = [];
  let raf = null, audioCtx = null, analyser = null;
  let startedAt = 0, autoStopTimer = null, activeMeter = null;
  let destroyed = false;

  function show(el) {
    [idleEl, readyEl, recEl].forEach((x) => { x.hidden = x !== el; });
  }

  // ---------- Индикатор уровня (работает и в «готов», и в записи) ----------
  function ensureAnalyser() {
    if (audioCtx || !audioStream) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      const src = audioCtx.createMediaStreamSource(audioStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
    } catch { /* индикатор не критичен */ }
  }

  function meterLoop() {
    if (destroyed || !analyser) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (destroyed || !analyser) return;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (const v of bins) sum += v;
      const level = sum / bins.length / 255;
      if (activeMeter) {
        const mctx = activeMeter.getContext('2d');
        mctx.clearRect(0, 0, 56, 16);
        mctx.fillStyle = '#ff8c00';
        mctx.fillRect(0, 8 - Math.max(1, level * 7), 56, Math.max(2, level * 14));
      }
      if (!recEl.hidden) {
        recEl.querySelector('.rec-time').textContent = formatTime((Date.now() - startedAt) / 1000);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
  }

  function startMeter(canvasEl) {
    activeMeter = canvasEl;
    ensureAnalyser();
    if (raf) cancelAnimationFrame(raf);
    meterLoop();
  }

  // ---------- Захват источника ----------
  async function acquire() {
    if (isDisplay) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        toast(t('ask.capture_unsupported'), 'error');
        if (singleShot) teardown(); // не оставляем idle-кнопку-дубль
        return;
      }
      try {
        sourceStream = await navigator.mediaDevices.getDisplayMedia({
          video: true, // большинство браузеров без видео не открывают окно выбора источника
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        if (singleShot) teardown(); // пользователь отменил выбор — убираем UI
        return; // пользователь отменил выбор
      }
      if (destroyed) { sourceStream.getTracks().forEach((tr) => tr.stop()); return; }
      const audioTracks = sourceStream.getAudioTracks();
      sourceStream.getVideoTracks().forEach((tr) => tr.stop()); // картинка не нужна
      if (!audioTracks.length) {
        toast(t('ask.capture_no_audio'), 'error', 8000);
        sourceStream = null;
        if (singleShot) teardown();
        return;
      }
      audioStream = new MediaStream(audioTracks);
      // Пользователь нажал «Прекратить трансляцию» в браузере
      audioTracks[0].addEventListener('ended', () => {
        if (recorder && recorder.state === 'recording') stopRecording();
        else teardown();
      });
      show(readyEl);
      startMeter(readyEl.querySelector('.rec-meter'));
    } else {
      try {
        sourceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast(t('messages.mic_denied'), 'error');
        return;
      }
      audioStream = sourceStream;
      beginRecording();
    }
  }

  // ---------- Запись ----------
  function beginRecording() {
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
      .find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));
    recorder = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      teardown();
      if (blob.size > 0 && !destroyed) onRecorded(blob);
    };
    recorder.start(250);
    startedAt = Date.now();
    show(recEl);
    startMeter(recEl.querySelector('.rec-meter-rec'));
    autoStopTimer = setTimeout(stopRecording, maxSeconds * 1000);
  }

  function stopRecording() {
    if (recorder && recorder.state === 'recording') recorder.stop();
  }

  function teardown() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (autoStopTimer) clearTimeout(autoStopTimer);
    autoStopTimer = null;
    sourceStream?.getTracks().forEach((tr) => tr.stop());
    audioCtx?.close?.();
    sourceStream = null; audioStream = null; audioCtx = null; analyser = null; recorder = null;
    if (destroyed) return;
    // Одноразовый режим: после остановки/отмены не возвращаемся к idle-кнопке
    // (она продублировала бы внешнюю кнопку запуска) — убираем UI целиком
    if (singleShot) container.innerHTML = '';
    else show(idleEl);
  }

  // ---------- Кнопки ----------
  idleEl.querySelector('.rec-start').addEventListener('click', acquire);
  readyEl.querySelector('.rec-start-btn').addEventListener('click', beginRecording);
  readyEl.querySelector('.rec-cancel').addEventListener('click', teardown);
  recEl.querySelector('.rec-stop').addEventListener('click', stopRecording);

  if (autoStart) acquire();

  return {
    destroy() {
      destroyed = true;
      if (recorder && recorder.state === 'recording') { try { recorder.stop(); } catch { /* ignore */ } }
      teardown();
      container.innerHTML = '';
    },
  };
}

// ============================================================
// A/B-СРАВНЕНИЕ: два синхронных плеера с мгновенным переключением
// ============================================================

let activeAB = null; // последний созданный — на него реагируют клавиши A/B/Space

/** Клавиатура A/B (и Ф/И в русской раскладке), Space — play/pause */
let abKeyBound = false;
function bindABKeys() {
  if (abKeyBound) return;
  abKeyBound = true;
  document.addEventListener('keydown', (e) => {
    if (!activeAB) return;
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'ф') { activeAB.switchTo('A'); e.preventDefault(); }
    else if (k === 'b' || k === 'и') { activeAB.switchTo('B'); e.preventDefault(); }
    else if (k === ' ') { activeAB.togglePlay(); e.preventDefault(); }
  });
}

/**
 * A/B-плеер: A и B играют с одной относительной позиции (в процентах),
 * переключение без паузы. Процентная синхронизация важна, потому что
 * референс вопроса и аудио ответа почти всегда разной длины: оба трека
 * стартуют с 0% и доигрывают до 100% одновременно.
 * @param {HTMLElement} container
 * @param {object} opts { a: {url, waveform, label}, b: {url, waveform, label} }
 * @returns {function} cleanup
 */
export function createABPlayer(container, { a, b }) {
  const audioA = new Audio(a.url);
  const audioB = new Audio(b.url);
  audioA.preload = 'auto';
  audioB.preload = 'auto';
  let active = 'A';
  let raf = null;

  container.innerHTML = `
    <div class="ab-player">
      <div class="ab-row active" data-side="A">
        <span class="ab-badge">A</span>
        <canvas class="ab-wave" role="button" tabindex="0" aria-label="${escapeHtml(a.label)}"></canvas>
        <span class="ab-label">${escapeHtml(a.label)}</span>
      </div>
      <div class="ab-row" data-side="B">
        <span class="ab-badge">B</span>
        <canvas class="ab-wave" role="button" tabindex="0" aria-label="${escapeHtml(b.label)}"></canvas>
        <span class="ab-label">${escapeHtml(b.label)}</span>
      </div>
      <div class="ab-controls">
        <button type="button" class="play-btn ab-play" aria-label="${escapeHtml(t('question.play'))}">▶</button>
        <button type="button" class="ab-toggle" aria-label="${escapeHtml(t('question.ab_compare'))}">
          <span class="ab-side-a active">A</span><span class="ab-sep">/</span><span class="ab-side-b">B</span>
        </button>
        <span class="time-display"><span class="ab-cur">0:00</span> / <span class="ab-dur">0:00</span></span>
        <span class="ab-hint">${escapeHtml(t('question.ab_hint'))}</span>
      </div>
    </div>`;

  const rowA = container.querySelector('[data-side="A"]');
  const rowB = container.querySelector('[data-side="B"]');
  const waveA = rowA.querySelector('.ab-wave');
  const waveB = rowB.querySelector('.ab-wave');
  const playBtn = container.querySelector('.ab-play');
  const toggleBtn = container.querySelector('.ab-toggle');
  const curEl = container.querySelector('.ab-cur');
  const durEl = container.querySelector('.ab-dur');

  const cur = () => (active === 'A' ? audioA : audioB);
  const both = () => [audioA, audioB];

  function draw() {
    drawMiniWave(waveA, a.waveform || [], audioA.duration ? audioA.currentTime / audioA.duration : 0);
    drawMiniWave(waveB, b.waveform || [], audioB.duration ? audioB.currentTime / audioB.duration : 0);
    curEl.textContent = formatTime(cur().currentTime);
    durEl.textContent = formatTime(cur().duration || 0);
  }

  function tick() {
    draw();
    if (!cur().paused) raf = requestAnimationFrame(tick);
  }

  function setPlayingUI(playing) {
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', playing ? t('question.pause') : t('question.play'));
    if (playing && !raf) tick();
    if (!playing && raf) { cancelAnimationFrame(raf); raf = null; draw(); }
  }

  /** Оба трека в начало — после окончания или перед стартом заново */
  function rewindBoth() {
    both().forEach((x) => { try { x.currentTime = 0; } catch { /* metadata ещё нет */ } });
  }

  both().forEach((au) => {
    au.addEventListener('play', () => setPlayingUI(true));
    au.addEventListener('pause', () => setPlayingUI(false));
    au.addEventListener('ended', () => {
      setPlayingUI(false);
      // Треки синхронны по проценту — дошли до конца оба.
      // Перематываем в начало, чтобы ▶ снова играл с нуля, а не «молчал».
      rewindBoth();
      draw();
    });
    au.addEventListener('loadedmetadata', draw);
  });

  function switchTo(side) {
    if (side === active) return;
    const c = cur();
    const n = side === 'A' ? audioA : audioB;
    const wasPlaying = !c.paused;
    // Синхронизация ПО ПРОЦЕНТУ длины, а не по секундам:
    // треки разной длины доигрывают до конца вместе
    const ratio = c.duration ? Math.min(Math.max(c.currentTime / c.duration, 0), 1) : 0;
    c.pause();
    try {
      n.currentTime = n.duration ? ratio * n.duration : c.currentTime;
    } catch { /* metadata ещё нет */ }
    active = side;
    rowA.classList.toggle('active', side === 'A');
    rowB.classList.toggle('active', side === 'B');
    toggleBtn.querySelector('.ab-side-a').classList.toggle('active', side === 'A');
    toggleBtn.querySelector('.ab-side-b').classList.toggle('active', side === 'B');
    if (wasPlaying) n.play().catch(() => {});
    draw();
  }

  function togglePlay() {
    stopPreview(); // глушим превью ленты
    const c = cur();
    if (c.paused) {
      // Если трек стоит на самом конце (только что доиграл) — начинаем заново
      if (c.ended || (c.duration && c.currentTime >= c.duration - 0.05)) rewindBoth();
      c.play().catch(() => {});
    } else {
      both().forEach((au) => au.pause());
    }
  }

  playBtn.addEventListener('click', togglePlay);
  toggleBtn.addEventListener('click', () => switchTo(active === 'A' ? 'B' : 'A'));

  // Перемотка кликом по вейвформе (синхронно на обоих, по доле длины)
  [[rowA, audioA], [rowB, audioB]].forEach(([row, au]) => {
    row.querySelector('.ab-wave').addEventListener('click', (e) => {
      const rect = e.target.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      both().forEach((x) => { if (x.duration) x.currentTime = ratio * x.duration; });
      draw();
    });
  });

  // Ресайз окна: перерисовать вейвформы под новую ширину
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  function cleanup() {
    window.removeEventListener('resize', onResize);
    both().forEach((au) => { au.pause(); au.src = ''; });
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (activeAB === api) activeAB = null;
  }
  const api = { switchTo, togglePlay, cleanup };

  bindABKeys();
  activeAB = api;
  registerTransient(cleanup);
  draw();
  return cleanup;
}