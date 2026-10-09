// ============================================================
// trimmer.mjs — обрезка аудио при создании вопроса.
// Единый canvas-движок (работает офлайн, без WaveSurfer):
// • выделение региона драгом за края / переносом целиком
// • ЗУМ (−/+, Ctrl+колесо к курсору, колесо — панорама) для точной правки
// • ПЛЕЙХЕД при прослушивании выделенного фрагмента (+ авто-следование)
// • ограничение максимальной длины выделения (CONFIG.TRIM_MAX_SECONDS)
// • слайдеры точной подстройки начала/конца
// • МАРКЕРЫ: пин перетаскивается по волне (в пределах региона), ▶ в чипе —
//   прослушать фрагмент от маркера; при движении границ маркеры «едут» с ними
// ============================================================

import { CONFIG } from './config.mjs';
import { t } from './i18n.mjs';
import { escapeHtml, formatTime, toast } from './utils.mjs';
import { peaksFromBuffer, bufferToWavBlob } from './audio.mjs';

const ZOOM_LEVELS = [1, 2, 4, 8];

/**
 * @param {HTMLElement} container
 * @param {Blob} audioBlob — уже нормализованное аудио
 * @param {{ start: number, end: number, markers: Array<{time:number,note:string}> }|null} initialState
 *        — необязательное состояние региона/маркеров (абсолютные секунды) для
 *        восстановления черновика (например, после перерисовки экрана при смене языка)
 * @returns {{ getResult(): Promise<{blob, start, end}>, getState(): object|null, destroy(): void }}
 */
export function createTrimmer(container, audioBlob, initialState = null) {
  const MAX = CONFIG.TRIM_MAX_SECONDS || 7;
  const MAX_MARKS = CONFIG.MAX_MARKERS || 2;
  const state = {
    start: 0,
    end: 0,
    duration: 0,
    peaks: [],
    zoomIdx: 0,      // индекс в ZOOM_LEVELS
    viewStart: 0,    // начало видимого окна (сек)
    markers: [],     // { time: абсолютное сек, note } — «вот этот момент»
    destroyed: false,
  };

  let audioCtx = null;
  let decodedBuffer = null;
  let previewAudio = null;
  let playRaf = null;
  let playingMarker = null; // маркер, от которого сейчас идёт (или стоит на паузе) прослушивание

  container.innerHTML = `
    <div class="card trimmer-wrap" style="cursor:default">
      <div class="trimmer-head">
        <b style="font-size:14px">✂️ ${escapeHtml(t('trimmer.title'))}</b>
        <span class="trim-len" id="trim-len"></span>
      </div>
      <canvas class="trimmer-canvas" id="trim-canvas"></canvas>
      <div class="trimmer-hint">${escapeHtml(t('trimmer.hint'))}</div>
      <div class="trimmer-hint" style="color:var(--copper-2)">${escapeHtml(t('trimmer.zoom_hint'), { n: MAX })}</div>
      <div class="trimmer-hint" style="color:var(--text-muted)">📍 ${escapeHtml(t('trimmer.marker_drag_hint'))}</div>

      <div class="trim-zoom-row">
        <button type="button" class="zoom-btn" id="zoom-out" aria-label="−">−</button>
        <span class="zoom-label" id="zoom-label">1×</span>
        <button type="button" class="zoom-btn" id="zoom-in" aria-label="+">＋</button>
        <input type="range" id="trim-pan" class="trim-pan" min="0" max="100" value="0" step="0.01" aria-label="${escapeHtml(t('trimmer.pan'))}" hidden>
        <span class="trim-range" id="trim-range"></span>
      </div>

      <div class="trimmer-sliders">
        <div>
          <label for="trim-start" style="font-size:12px;color:var(--text-secondary)">${escapeHtml(t('trimmer.start'))}</label>
          <input type="range" id="trim-start" min="0" max="100" value="0" step="0.01" aria-label="${escapeHtml(t('trimmer.start'))}">
        </div>
        <div>
          <label for="trim-end" style="font-size:12px;color:var(--text-secondary)">${escapeHtml(t('trimmer.end'))}</label>
          <input type="range" id="trim-end" min="0" max="100" value="100" step="0.01" aria-label="${escapeHtml(t('trimmer.end'))}">
        </div>
      </div>

      <div class="trim-mark-row">
        <button type="button" class="btn btn-ghost btn-sm" id="trim-mark" title="${escapeHtml(t('trimmer.marker_hint'))}">📍 ${escapeHtml(t('trimmer.marker_add'))}</button>
        <div class="mark-list" id="mark-list"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button type="button" class="btn btn-ghost btn-sm" id="trim-preview">▶ ${escapeHtml(t('trimmer.preview'))}</button>
        <button type="button" class="btn btn-quiet btn-sm" id="trim-reset">↺ ${escapeHtml(t('trimmer.reset'))}</button>
      </div>
    </div>`;

  const canvas = container.querySelector('#trim-canvas');
  const lenLabel = container.querySelector('#trim-len');
  const rangeLabel = container.querySelector('#trim-range');
  const zoomLabel = container.querySelector('#zoom-label');
  const panSlider = container.querySelector('#trim-pan');
  const startSlider = container.querySelector('#trim-start');
  const endSlider = container.querySelector('#trim-end');

  // ---------- Вьюпорт (зум/панорама) ----------
  const viewDur = () => state.duration / ZOOM_LEVELS[state.zoomIdx];
  const timeToX = (tt, w) => ((tt - state.viewStart) / viewDur()) * w;
  const xToTime = (x, w) => state.viewStart + (x / w) * viewDur();

  function clampView() {
    const maxStart = Math.max(0, state.duration - viewDur());
    state.viewStart = Math.max(0, Math.min(state.viewStart, maxStart));
    panSlider.max = String(maxStart);
    panSlider.value = String(state.viewStart);
    panSlider.hidden = ZOOM_LEVELS[state.zoomIdx] === 1;
    zoomLabel.textContent = `${ZOOM_LEVELS[state.zoomIdx]}×`;
  }

  function zoomAround(anchorTime, dir) {
    const oldViewDur = viewDur();
    const nextIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, state.zoomIdx + dir));
    if (nextIdx === state.zoomIdx) return;
    state.zoomIdx = nextIdx;
    // Якорь (время под курсором/центром) остаётся на том же месте экрана
    const ratio = (anchorTime - state.viewStart) / oldViewDur;
    state.viewStart = anchorTime - ratio * viewDur();
    clampView();
    draw();
  }

  container.querySelector('#zoom-in').addEventListener('click', () => {
    zoomAround(state.viewStart + viewDur() / 2, +1);
  });
  container.querySelector('#zoom-out').addEventListener('click', () => {
    zoomAround(state.viewStart + viewDur() / 2, -1);
  });
  panSlider.addEventListener('input', () => {
    state.viewStart = parseFloat(panSlider.value) || 0;
    draw();
  });

  // Колесо: панорама; Ctrl+колесо: зум к курсору
  canvas.addEventListener('wheel', (e) => {
    if (!state.duration) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const anchor = xToTime(e.clientX - rect.left, rect.width);
      zoomAround(anchor, e.deltaY < 0 ? +1 : -1);
    } else {
      state.viewStart += (e.deltaY || e.deltaX) / 300 * viewDur();
      clampView();
      draw();
    }
  }, { passive: false });

  // ---------- Ограничение длины выделения ----------
  function clampRegion() {
    const maxLen = Math.min(MAX, state.duration);
    let len = state.end - state.start;
    if (len > maxLen) { state.end = state.start + maxLen; len = maxLen; }
    if (len < 0.05) { state.end = Math.min(state.duration, state.start + 0.05); }
    if (state.end > state.duration) {
      state.end = state.duration;
      state.start = Math.max(0, state.end - maxLen);
    }
    if (state.start < 0) state.start = 0;
  }

  // Маркеры всегда остаются внутри региона: при движении границ
  // маркер «едет» вместе с краем и никогда не теряется молча.
  function clampMarkers() {
    for (const m of state.markers) {
      m.time = +Math.max(state.start, Math.min(state.end, m.time)).toFixed(3);
    }
  }

  function updateLabels() {
    const len = state.end - state.start;
    lenLabel.textContent = `${len.toFixed(1)}s / ${MAX}s`;
    lenLabel.classList.toggle('at-max', len >= MAX - 0.05);
    rangeLabel.textContent = `${formatTime(state.start)} — ${formatTime(state.end)}`;
    startSlider.value = String(state.duration ? (state.start / state.duration) * 100 : 0);
    endSlider.value = String(state.duration ? (state.end / state.duration) * 100 : 100);
    renderMarkList();
  }

  // ---------- Отрисовка ----------
  function draw() {
    if (state.destroyed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 110;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!state.duration) return;

    const t0 = state.viewStart;
    const vd = viewDur();
    const bars = Math.min(Math.floor(w / 2), 500);
    const barW = w / bars;
    const mid = h / 2;
    const peaks = state.peaks;

    // Бары вейвформы видимого окна
    for (let i = 0; i < bars; i++) {
      const tt0 = t0 + (i / bars) * vd;
      const tt1 = t0 + ((i + 1) / bars) * vd;
      // Пик k покрывает ровно [k*D/N, (k+1)*D/N) — без заезда на соседние,
      // иначе на зуме вейвформа «размазывается» относительно маркеров
      const p0 = Math.max(0, Math.floor((tt0 / state.duration) * peaks.length));
      const p1 = Math.min(peaks.length - 1, Math.max(p0, Math.ceil((tt1 / state.duration) * peaks.length) - 1));
      let max = 0;
      for (let j = p0; j <= p1; j++) if (peaks[j] > max) max = peaks[j];
      const barH = Math.max(2, max * (h - 12));
      const x = i * barW;
      const inRegion = tt1 > state.start && tt0 < state.end;
      if (inRegion) {
        const grad = ctx.createLinearGradient(0, mid - barH / 2, 0, mid + barH / 2);
        grad.addColorStop(0, '#ff8c00');
        grad.addColorStop(1, '#b87333');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = 'rgba(154,154,160,0.35)';
      }
      ctx.fillRect(x + 0.5, mid - barH / 2, Math.max(1, barW - 1), barH);
    }

    // Затемнение обрезанных зон
    const x1 = Math.max(0, Math.min(w, timeToX(state.start, w)));
    const x2 = Math.max(0, Math.min(w, timeToX(state.end, w)));
    ctx.fillStyle = 'rgba(13,13,15,0.72)';
    if (x1 > 0) ctx.fillRect(0, 0, x1, h);
    if (x2 < w) ctx.fillRect(x2, 0, w - x2, h);

    // Границы региона + ручки
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,140,0,0.8)';
    ctx.shadowBlur = 6;
    [x1, x2].forEach((x) => {
      if (x <= 0 || x >= w) return;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });
    ctx.fillStyle = '#ff8c00';
    [x1, x2].forEach((x) => {
      if (x < -4 || x > w + 4) return;
      ctx.beginPath();
      ctx.arc(Math.max(4, Math.min(w - 4, x)), mid, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

    // Пины маркеров («слушай здесь»); перетаскиваемый/играющий — крупнее и ярче
    state.markers.forEach((m, mi) => {
      const mx = timeToX(m.time, w);
      if (mx < -4 || mx > w + 4) return;
      const active = (dragMode === 'marker' && mi === dragMarkerIdx)
        || (m === playingMarker && previewAudio && !previewAudio.paused);
      ctx.strokeStyle = active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth = active ? 1.6 : 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 5);
      ctx.lineTo(mx, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8c00';
      ctx.shadowColor = 'rgba(255,140,0,0.8)';
      ctx.shadowBlur = active ? 9 : 5;
      ctx.beginPath();
      ctx.arc(mx, 5, active ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // При перетаскивании — тултип со временем (относительно начала региона)
      if (dragMode === 'marker' && mi === dragMarkerIdx) {
        const label = `${(m.time - state.start).toFixed(1)}s`;
        ctx.font = '11px ui-monospace, monospace';
        const tw = ctx.measureText(label).width + 10;
        const tx = Math.max(2, Math.min(w - tw - 2, mx - tw / 2));
        ctx.fillStyle = 'rgba(13,13,15,0.85)';
        ctx.fillRect(tx, 12, tw, 16);
        ctx.strokeStyle = 'rgba(255,140,0,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, 12, tw, 16);
        ctx.fillStyle = '#ffb066';
        ctx.fillText(label, tx + 5, 24);
      }
    });

    // Плейхед при прослушивании
    if (previewAudio && !previewAudio.paused) {
      const pt = state.start + previewAudio.currentTime;
      const px = timeToX(pt, w);
      if (px >= 0 && px <= w) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  // Цикл плейхеда + авто-следование вьюпорта за воспроизведением
  function playLoop() {
    if (!previewAudio || previewAudio.paused || previewAudio.ended) {
      playRaf = null;
      draw();
      return;
    }
    const pt = state.start + previewAudio.currentTime;
    // Если плейхед вышел за видимое окно — центрируем на нём
    const vd = viewDur();
    if (pt < state.viewStart + vd * 0.08 || pt > state.viewStart + vd * 0.92) {
      state.viewStart = pt - vd / 2;
      clampView();
    }
    draw();
    playRaf = requestAnimationFrame(playLoop);
  }

  // ---------- Drag-редактирование региона и маркеров ----------
  let dragMode = null; // 'start' | 'end' | 'move' | 'marker'
  let grabOffset = 0;
  let dragMarkerIdx = -1;   // индекс перетаскиваемого маркера в state.markers
  let dragChipEl = null;    // чип перетаскиваемого маркера (для живого времени)

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.duration) return;
    canvas.setPointerCapture(e.pointerId);
    const w = canvas.clientWidth;
    const time = xToTime(e.clientX - canvas.getBoundingClientRect().left, w);
    const thr = (9 / w) * viewDur(); // 9px в секундах текущего зума

    // Пин маркера — в приоритете над ручками региона: тащим сам маркер.
    // Клик по пину без движения ничего не запускает (прослушивание — только ▶ в чипе).
    if (state.markers.length) {
      let best = -1;
      let bestDist = thr;
      state.markers.forEach((m, i) => {
        const d = Math.abs(time - m.time);
        if (d <= bestDist) { bestDist = d; best = i; }
      });
      if (best >= 0) {
        dragMode = 'marker';
        dragMarkerIdx = best;
        const sortedIdx = sortedMarkers().indexOf(state.markers[best]);
        dragChipEl = container.querySelectorAll('#mark-list .mark-chip')[sortedIdx] || null;
        draw();
        return;
      }
    }

    const nearStart = Math.abs(time - state.start) < thr;
    const nearEnd = Math.abs(time - state.end) < thr;
    const inside = time > state.start && time < state.end;

    if (nearStart) dragMode = 'start';
    else if (nearEnd) dragMode = 'end';
    else if (inside) {
      dragMode = 'move';
      grabOffset = time - state.start;
    } else {
      // Новая выделяемая область: от клика, длиной как текущая (в пределах лимита)
      dragMode = 'start';
      const len = Math.min(state.end - state.start, MAX);
      state.start = time;
      state.end = Math.min(state.duration, time + Math.max(0.3, len));
      clampRegion();
      clampMarkers();
    }
    updateLabels();
    draw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.duration) return;
    const w = canvas.clientWidth;
    const time = xToTime(e.clientX - canvas.getBoundingClientRect().left, w);

    if (!dragMode) {
      // Курсор «взять» над пином маркера — подсказка, что его можно тащить
      const thr = (9 / w) * viewDur();
      const nearPin = state.markers.some((m) => Math.abs(time - m.time) <= thr);
      canvas.style.cursor = nearPin ? 'ew-resize' : '';
      return;
    }

    if (dragMode === 'marker') {
      const m = state.markers[dragMarkerIdx];
      if (!m) return;
      // Маркер не выходит за границы региона
      m.time = +Math.max(state.start, Math.min(state.end, time)).toFixed(3);
      const chipTime = dragChipEl && dragChipEl.querySelector('.mark-time');
      if (chipTime) chipTime.textContent = formatTime(Math.max(0, m.time - state.start));
      draw();
      return;
    }

    const maxLen = Math.min(MAX, state.duration);
    if (dragMode === 'start') {
      state.start = Math.min(time, state.end - 0.05);
      state.start = Math.max(state.start, state.end - maxLen, 0);
    } else if (dragMode === 'end') {
      state.end = Math.max(time, state.start + 0.05);
      state.end = Math.min(state.end, state.start + maxLen, state.duration);
    } else if (dragMode === 'move') {
      const len = state.end - state.start;
      state.start = Math.max(0, Math.min(time - grabOffset, state.duration - len));
      state.end = state.start + len;
    }
    clampMarkers(); // маркеры «едут» вместе с границами региона
    updateLabels();
    draw();
  });

  const stopDrag = () => {
    const wasMarker = dragMode === 'marker';
    dragMode = null;
    dragMarkerIdx = -1;
    dragChipEl = null;
    if (wasMarker) renderMarkList(); // пересортировать чипы по новому времени
    draw();
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  // ---------- Слайдеры точной подстройки ----------
  startSlider.addEventListener('input', () => {
    state.start = (parseFloat(startSlider.value) / 100) * state.duration;
    if (state.end - state.start > MAX) state.end = state.start + MAX;
    if (state.end - state.start < 0.05) state.end = Math.min(state.duration, state.start + 0.05);
    clampRegion();
    clampMarkers();
    updateLabels();
    draw();
  });
  endSlider.addEventListener('input', () => {
    state.end = (parseFloat(endSlider.value) / 100) * state.duration;
    if (state.end - state.start > MAX) state.start = state.end - MAX;
    if (state.end - state.start < 0.05) state.start = Math.max(0, state.end - 0.05);
    clampRegion();
    clampMarkers();
    updateLabels();
    draw();
  });

  // ---------- Маркеры: список, добавление, удаление ----------
  function sortedMarkers() {
    return [...state.markers].sort((x, y) => x.time - y.time);
  }

  function renderMarkList() {
    const list = container.querySelector('#mark-list');
    if (!list) return;
    const marks = sortedMarkers();
    const playingNow = !!(previewAudio && !previewAudio.paused);
    list.innerHTML = marks.map((m, i) => {
      const active = m === playingMarker; // играет (или на паузе) от этого маркера
      return `
      <span class="mark-chip${active ? ' playing' : ''}">
        <button type="button" class="mark-play" data-mplay="${i}" aria-label="${escapeHtml(t('trimmer.marker_play'))}" title="${escapeHtml(t('trimmer.marker_play'))}">${active && playingNow ? '⏸' : '▶'}</button>
        <span class="marker-dot" aria-hidden="true"></span>
        <span class="mark-time">${escapeHtml(formatTime(Math.max(0, m.time - state.start)))}</span>
        <input class="mark-note" data-mi="${i}" value="${escapeHtml(m.note || '')}" placeholder="${escapeHtml(t('trimmer.marker_note_ph'))}" maxlength="40" aria-label="${escapeHtml(t('trimmer.marker_note_ph'))}">
        <button type="button" data-mrm="${i}" aria-label="${escapeHtml(t('common.delete'))}">✕</button>
      </span>`;
    }).join('');
    // Не больше CONFIG.MAX_MARKERS маркеров: кнопка «📍» блокируется на лимите
    const markBtn = container.querySelector('#trim-mark');
    if (markBtn) {
      const full = state.markers.length >= MAX_MARKS;
      markBtn.disabled = full;
      markBtn.title = full ? t('trimmer.marker_limit', { n: MAX_MARKS }) : t('trimmer.marker_hint');
    }
  }

  container.querySelector('#trim-mark').addEventListener('click', () => {
    if (!state.duration) return;
    if (state.markers.length >= MAX_MARKS) {
      toast(t('trimmer.marker_limit', { n: MAX_MARKS }));
      return;
    }
    // Маркер ставится на текущую позицию прослушивания (или на начало региона)
    const pos = previewAudio ? previewAudio.currentTime : 0;
    const abs = Math.max(state.start, Math.min(state.end, state.start + pos));
    state.markers.push({ time: +abs.toFixed(3), note: '' });
    renderMarkList();
    draw();
  });

  container.querySelector('#mark-list').addEventListener('input', (e) => {
    const inp = e.target.closest('.mark-note');
    if (!inp) return;
    sortedMarkers()[Number(inp.dataset.mi)].note = inp.value;
  });
  container.querySelector('#mark-list').addEventListener('click', (e) => {
    // ▶ в чипе: послушать от маркера / пауза / продолжить
    const playBtn = e.target.closest('[data-mplay]');
    if (playBtn) {
      const target = sortedMarkers()[Number(playBtn.dataset.mplay)];
      if (!target) return;
      if (playingMarker === target && previewAudio) {
        if (previewAudio.paused && !previewAudio.ended) {
          previewAudio.play().catch(() => {}); // продолжить с паузы
          playRaf = requestAnimationFrame(playLoop);
        } else {
          previewAudio.pause();
          if (playRaf) { cancelAnimationFrame(playRaf); playRaf = null; }
        }
        renderMarkList();
        draw();
        return;
      }
      startRegionPreview(target);
      renderMarkList();
      return;
    }
    const btn = e.target.closest('[data-mrm]');
    if (!btn) return;
    const target = sortedMarkers()[Number(btn.dataset.mrm)];
    if (!target) return;
    if (target === playingMarker) stopPreview();
    state.markers = state.markers.filter((m) => m !== target);
    renderMarkList();
    draw();
  });

  // ---------- Прослушивание с плейхедом ----------
  function stopPreview() {
    if (previewAudio) { previewAudio.pause(); previewAudio = null; }
    if (playRaf) { cancelAnimationFrame(playRaf); playRaf = null; }
    playingMarker = null;
  }

  /**
   * Играет обрезанный регион целиком.
   * @param {object|null} marker — если передан, старт от этого маркера ({time: абс. сек})
   */
  function startRegionPreview(marker = null) {
    if (!decodedBuffer) return;
    stopPreview();
    const blob = sliceBuffer(decodedBuffer, state.start, state.end);
    previewAudio = new Audio(URL.createObjectURL(blob));
    previewAudio.addEventListener('ended', () => {
      if (playRaf) { cancelAnimationFrame(playRaf); playRaf = null; }
      playingMarker = null;
      renderMarkList();
      draw();
    });
    if (marker) {
      const off = Math.max(0, Math.min(state.end - state.start, marker.time - state.start));
      previewAudio.currentTime = +off.toFixed(3);
      playingMarker = marker;
    }
    previewAudio.play().catch(() => {});
    playRaf = requestAnimationFrame(playLoop);
  }

  container.querySelector('#trim-preview').addEventListener('click', () => {
    if (!decodedBuffer) return;
    startRegionPreview(null);
    renderMarkList();
  });

  // ---------- Сброс: весь файл (в пределах лимита) ----------
  container.querySelector('#trim-reset').addEventListener('click', () => {
    state.start = 0;
    state.end = Math.min(state.duration, MAX);
    state.zoomIdx = 0;
    state.viewStart = 0;
    clampMarkers();
    clampView();
    updateLabels();
    draw();
  });

  // ---------- Нарезка AudioBuffer ----------
  function sliceBuffer(buffer, start, end) {
    const sr = buffer.sampleRate;
    const startSample = Math.floor(start * sr);
    const endSample = Math.min(buffer.length, Math.ceil(end * sr));
    const length = Math.max(1, endSample - startSample);
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const sliced = new AC(buffer.numberOfChannels, length, sr).createBuffer(buffer.numberOfChannels, length, sr);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      sliced.getChannelData(ch).set(buffer.getChannelData(ch).subarray(startSample, endSample));
    }
    return bufferToWavBlob(sliced);
  }

  // ---------- Инициализация ----------
  (async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      decodedBuffer = await audioCtx.decodeAudioData(await audioBlob.arrayBuffer());
      state.duration = decodedBuffer.duration;
      // Стартовый регион: из initialState (черновик) или от начала, не длиннее лимита
      state.start = 0;
      state.end = Math.min(state.duration, MAX);
      if (initialState) {
        if (Number.isFinite(initialState.start) && Number.isFinite(initialState.end)
            && initialState.end > initialState.start) {
          state.start = initialState.start;
          state.end = initialState.end;
          clampRegion();
        }
        // Маркеры восстанавливаются независимо от региона: при правке вопроса
        // в триммер попадает исходный клип из БД целиком, только с маркерами
        if (Array.isArray(initialState.markers)) {
          state.markers = initialState.markers
            .filter((m) => m && Number.isFinite(+m.time))
            .slice(0, MAX_MARKS)
            .map((m) => ({ time: +(+m.time).toFixed(3), note: m.note || '' }));
          clampMarkers();
        }
      }
      // Пики берём из уже декодированного буфера с детализацией под зум 8×
      // (4000 точек ≈ 1.2px на пик при максимальном зуме — без «размазывания»)
      state.peaks = peaksFromBuffer(decodedBuffer, 4000).peaks;
      clampView();
      updateLabels();
      draw();
    } catch (e) {
      console.error('[trimmer] init failed:', e);
      container.querySelector('.trimmer-hint').textContent = t('trimmer.error');
    }
  })();

  return {
    /** Обрезанный (и уже нормализованный) blob — не длиннее TRIM_MAX_SECONDS */
    async getResult() {
      if (!decodedBuffer) throw new Error('Trimmer not ready');
      clampRegion();
      clampMarkers(); // маркеры не теряются: подтягиваются в регион
      const blob = sliceBuffer(decodedBuffer, state.start, state.end);
      // Маркеры относительно обрезанного фрагмента
      const markers = state.markers
        .map((m) => ({ time: +Math.max(0, m.time - state.start).toFixed(3), note: m.note || '' }))
        .sort((x, y) => x.time - y.time);
      return { blob, start: state.start, end: state.end, markers };
    },
    /**
     * Текущее состояние региона и маркеров (АБСОЛЮТНЫЕ секунды) — для черновика
     * формы /ask: переживает перерисовку экрана (смена языка) через initialState.
     * duration — полная длина клипа (форма правки сравнивает с ней регион,
     * чтобы не загружать файл заново, когда тронуты только маркеры).
     * @returns {{ start: number, end: number, duration: number, markers: Array<{time:number,note:string}> }|null}
     *          null, если аудио ещё не декодировано или триммер уничтожен
     */
    getState() {
      if (!decodedBuffer || state.destroyed) return null;
      return {
        start: state.start,
        end: state.end,
        duration: state.duration,
        markers: state.markers.map((m) => ({ time: m.time, note: m.note || '' })),
      };
    },
    destroy() {
      state.destroyed = true;
      stopPreview();
      audioCtx?.close?.();
      container.innerHTML = '';
    },
  };
}