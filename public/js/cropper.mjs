// ============================================================
// cropper.mjs — редактор обрезки аватара.
// Перед сохранением пользователь выбирает видимую область:
// перетаскивает изображение и меняет масштаб; круглая маска
// показывает, как аватар будет выглядеть в профиле.
// На выход — квадратный PNG 256×256 (экономим трафик и место).
// ============================================================

import { t } from './i18n.mjs';
import { openModal, toast, escapeHtml } from './utils.mjs';

const OUT_SIZE = 256;   // итоговый размер аватара
const VIEW_SIZE = 320;  // размер холста редактора

/**
 * Открыть модалку кропа изображения.
 * @param {File|Blob} fileOrBlob
 * @param {(blob: Blob) => void|Promise<void>} onSave — получит обрезанный квадрат
 */
export function openAvatarCropper(fileOrBlob, onSave) {
  const url = URL.createObjectURL(fileOrBlob);
  const img = new Image();
  const state = { zoom: 1, ox: 0, oy: 0 };
  let ready = false;

  const el = document.createElement('div');
  el.innerHTML = `
    <div class="crop-stage">
      <canvas class="crop-canvas" width="${VIEW_SIZE}" height="${VIEW_SIZE}" role="img" aria-label="${escapeHtml(t('profile.crop_title'))}"></canvas>
    </div>
    <div class="crop-row">
      <span class="crop-zoom-mark" aria-hidden="true">−</span>
      <input type="range" id="crop-zoom" min="1" max="5" step="0.01" value="1" aria-label="${escapeHtml(t('profile.crop_zoom'))}">
      <span class="crop-zoom-mark" aria-hidden="true">＋</span>
      <button type="button" class="btn btn-quiet btn-sm" id="crop-reset" title="${escapeHtml(t('trimmer.reset'))}">↺</button>
    </div>
    <p class="crop-hint">${escapeHtml(t('profile.crop_hint'))}</p>
    <div style="display:flex;gap:10px">
      <button type="button" class="btn btn-primary" id="crop-save" style="flex:1">${escapeHtml(t('common.save'))}</button>
      <button type="button" class="btn btn-quiet" id="crop-cancel">${escapeHtml(t('common.cancel'))}</button>
    </div>`;

  const canvas = el.querySelector('.crop-canvas');
  const ctx = canvas.getContext('2d');
  const zoomSlider = el.querySelector('#crop-zoom');

  // ---------- Отрисовка ----------
  function transform() {
    const S = VIEW_SIZE;
    const base = Math.max(S / img.width, S / img.height); // cover-масштаб
    const s = base * state.zoom;
    const w = img.width * s;
    const h = img.height * s;
    return { w, h, x: (S - w) / 2 + state.ox, y: (S - h) / 2 + state.oy };
  }

  function clampOffsets() {
    const { w, h } = transform();
    const mx = Math.max(0, (w - VIEW_SIZE) / 2);
    const my = Math.max(0, (h - VIEW_SIZE) / 2);
    state.ox = Math.min(mx, Math.max(-mx, state.ox));
    state.oy = Math.min(my, Math.max(-my, state.oy));
  }

  function draw() {
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.fillStyle = '#161619';
    ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    if (!ready) return;

    const { w, h, x, y } = transform();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();

    // Круглая маска: затемняем всё вне будущего аватара + медное кольцо
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.arc(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2 - 6, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(13,13,15,0.78)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE / 2 - 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,140,0,0.7)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Перетаскивание (панорама) ----------
  let dragging = false;
  let lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const k = canvas.width / canvas.getBoundingClientRect().width; // CSS px → px холста
    state.ox += (e.clientX - lastX) * k;
    state.oy += (e.clientY - lastY) * k;
    lastX = e.clientX; lastY = e.clientY;
    clampOffsets();
    draw();
  });
  const stopDrag = () => { dragging = false; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  // ---------- Зум: слайдер, колесо, двойной клик-сброс ----------
  zoomSlider.addEventListener('input', () => {
    state.zoom = parseFloat(zoomSlider.value) || 1;
    clampOffsets();
    draw();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = Math.min(5, Math.max(1, state.zoom * (e.deltaY < 0 ? 1.12 : 0.9)));
    zoomSlider.value = String(state.zoom);
    clampOffsets();
    draw();
  }, { passive: false });
  el.querySelector('#crop-reset').addEventListener('click', () => {
    state.zoom = 1; state.ox = 0; state.oy = 0;
    zoomSlider.value = '1';
    draw();
  });

  // ---------- Сохранение: квадрат 256×256 ----------
  function save() {
    const out = document.createElement('canvas');
    out.width = OUT_SIZE;
    out.height = OUT_SIZE;
    const octx = out.getContext('2d');
    const { w, h, x, y } = transform();
    const k = OUT_SIZE / VIEW_SIZE;
    octx.drawImage(img, x * k, y * k, w * k, h * k);
    out.toBlob((blob) => {
      URL.revokeObjectURL(url);
      if (blob) onSave(blob);
      close();
    }, 'image/png');
  }

  const close = openModal({ title: t('profile.crop_title'), content: el });

  el.querySelector('#crop-save').addEventListener('click', save);
  el.querySelector('#crop-cancel').addEventListener('click', () => {
    URL.revokeObjectURL(url);
    close();
  });

  // ---------- Загрузка изображения ----------
  img.onload = () => { ready = true; draw(); };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast(t('profile.avatar_type_error'), 'error');
    close();
  };
  img.src = url;
}