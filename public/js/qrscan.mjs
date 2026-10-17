// ============================================================
// qrscan.mjs — чтение и БЕЗОПАСНЫЙ разбор QR-кодов (заход 2026-10-13).
// Способ приёма теперь один: автор загружает свой QR (СБП), донор видит
// картинку и может ПРОЧИТАТЬ её до любого перехода: содержимое декодируется
// локально (jsQR из public/vendor/jsQR.js, без сети и без переходов) и
// проходит фишинг-разбор (схемы, http, homograph, punycode, IP, TLD,
// сокращатели, typosquatting, поддомены-обманки, Wi-Fi/vCard-эвристики).
// По мотивам примера заказчика, но по конвенциям проекта: без inline-
// обработчиков и alert(), всё декодированное экранируется, кнопки — через
// addEventListener, тосты вместо alert.
// ============================================================

import { t } from './i18n.mjs';
import { escapeHtml, toast } from './utils.mjs';

let jsQRPromise = null;

/** Подключить jsQR один раз: уже есть в window (тесты/повторный вход) или тегом из vendor */
export function ensureJsQR() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsQRPromise) {
    jsQRPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/jsQR.js';
      script.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR not found')));
      script.onerror = () => reject(new Error('jsQR load failed'));
      document.head.appendChild(script);
    });
  }
  return jsQRPromise;
}

function loadImageEl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load error'));
    img.src = dataUrl;
  });
}

/**
 * Декодировать QR из dataURL изображения. Возвращает строку-содержимое или null.
 * Тест-хук: window.__QR_FAKE_DECODE__ (jsdom не декодирует изображения).
 */
export async function decodeDataUrl(dataUrl) {
  if (typeof window !== 'undefined' && window.__QR_FAKE_DECODE__) return window.__QR_FAKE_DECODE__(dataUrl);
  const jsQR = await ensureJsQR();
  const img = await loadImageEl(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
  return code ? code.data : null;
}

/**
 * Даунскейл изображения QR до maxSide и приемлемого веса (лимит localStorage).
 * PNG: QR не любит JPEG-артефакты. Тест-хук пропускает преобразование.
 */
export async function downscaleDataUrl(dataUrl, maxSide = 600, maxBytes = 380 * 1024) {
  if (typeof window !== 'undefined' && window.__QR_FAKE_DECODE__) return dataUrl;
  const img = await loadImageEl(dataUrl);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return dataUrl;
  let out = dataUrl;
  for (const side of [maxSide, 480, 360, 280]) {
    const k = Math.min(1, side / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return out;
    ctx.drawImage(img, 0, 0, w, h);
    try {
      out = canvas.toDataURL('image/png');
    } catch {
      return dataUrl;
    }
    if (out.length * 0.75 <= maxBytes && k === 1) break;
    if (out.length * 0.75 <= maxBytes) break;
  }
  return out;
}

/** File → dataURL (FileReader) */
export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read error'));
    fr.readAsDataURL(file);
  });
}

/**
 * Камера: сканировать поток, пока jsQR не поймает кадр. Возвращает stop().
 * onFound(payload) вызывается один раз, треки останавливаются.
 */
export async function startCameraScan(videoEl, onFound) {
  // камеру проверяем ДО загрузки jsQR: без mediaDevices промис декодера
  // мог бы повиснуть (в jsdom script не грузится) — а так сразу ошибка
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
  const jsQR = await ensureJsQR();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  videoEl.srcObject = stream;
  videoEl.hidden = false;
  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scan = () => {
    if (stopped) return;
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA && ctx) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      if (canvas.width && canvas.height) {
        ctx.drawImage(videoEl, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code) {
          stop();
          let frameUrl = '';
          try { frameUrl = canvas.toDataURL('image/png'); } catch { /* останется пустым */ }
          onFound(code.data, frameUrl);
          return;
        }
      }
    }
    requestAnimationFrame(scan);
  };
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((tr) => tr.stop());
    videoEl.hidden = true;
    videoEl.srcObject = null;
  };
  requestAnimationFrame(scan);
  return stop;
}

// ------------------------------------------------------------
// Фишинг-разбор содержимого (портировано из примера заказчика,
// все сообщения — через i18n-ключи, значения экранируются на рендере)
// ------------------------------------------------------------
const BRANDS = ['nspk', 'sberbank', 'sber', 'tinkoff', 'tbank', 'alfabank', 'vtb', 'gazprombank', 'raiffeisen', 'rosbank', 'psb', 'yandex', 'google', 'apple', 'microsoft', 'amazon', 'paypal', 'vk', 'mail'];
const SUSPICIOUS_TLD = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.click', '.link'];
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly'];

function levenshtein(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) m[i][j] = m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1 + Math.min(m[i - 1][j - 1], m[i][j - 1], m[i - 1][j]));
  }
  return m[a.length][b.length];
}

/** Тип содержимого: url / wifi / vcard / tel / mail / sms / text */
export function detectQrType(data) {
  const s = String(data || '').trim();
  if (/^https?:\/\//i.test(s)) return 'url';
  if (/^WIFI:/i.test(s)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(s)) return 'vcard';
  if (/^tel:/i.test(s)) return 'tel';
  if (/^mailto:/i.test(s)) return 'mail';
  if (/^sms:/i.test(s)) return 'sms';
  if (/^\+?\d[\d\s\-]{7,}$/.test(s)) return 'tel';
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(s)) return 'mail';
  return 'text';
}

function analyzeUrl(url, alerts, fields) {
  let u;
  try {
    u = new URL(url);
  } catch {
    alerts.push({ level: 'danger', key: 'qr.alert_scheme', params: { scheme: '—' } });
    return null;
  }
  if (['javascript:', 'data:', 'vbscript:'].some((x) => url.toLowerCase().startsWith(x))) {
    alerts.push({ level: 'danger', key: 'qr.alert_scheme', params: { scheme: u.protocol } });
  }
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
    alerts.push({ level: 'warning', key: 'qr.alert_http' });
  }
  const scripts = new Set();
  for (const ch of u.hostname) {
    if (/[а-яё]/i.test(ch)) scripts.add('cyr');
    else if (/[a-z]/i.test(ch)) scripts.add('lat');
  }
  if (scripts.size > 1) alerts.push({ level: 'danger', key: 'qr.alert_homograph' });
  if (u.hostname.includes('xn--')) alerts.push({ level: 'warning', key: 'qr.alert_puny', params: { domain: u.hostname } });
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) alerts.push({ level: 'warning', key: 'qr.alert_ip' });
  const tld = `.${u.hostname.split('.').pop()}`;
  if (SUSPICIOUS_TLD.includes(tld)) alerts.push({ level: 'warning', key: 'qr.alert_tld', params: { tld } });
  if (SHORTENERS.some((x) => u.hostname.endsWith(x))) alerts.push({ level: 'info', key: 'qr.alert_short' });
  const domain = u.hostname.replace(/^(www\.|m\.|login\.|secure\.|account\.)/, '').split('.')[0].toLowerCase();
  const similar = BRANDS.find((b) => b !== domain && levenshtein(b, domain) <= 2);
  if (similar) alerts.push({ level: 'danger', key: 'qr.alert_brand', params: { domain, brand: similar } });
  const parts = u.hostname.split('.');
  if (parts.length >= 3) {
    const head = parts.slice(0, -2).join('.');
    const brand = BRANDS.find((b) => head.includes(b));
    if (brand) alerts.push({ level: 'warning', key: 'qr.alert_subdomain', params: { brand, domain: parts.slice(-2).join('.') } });
  }
  if (u.hostname === 'qr.nspk.ru') alerts.push({ level: 'info', key: 'qr.alert_nspk' });
  fields.push({ key: 'qr.f_proto', value: u.protocol });
  fields.push({ key: 'qr.f_domain', value: u.hostname, highlight: true });
  fields.push({ key: 'qr.f_path', value: `${u.pathname}${u.search}${u.hash}` });
  return u;
}

function analyzeWifi(data, alerts, fields) {
  const params = {};
  String(data).replace(/^WIFI:/i, '').split(';').forEach((p) => {
    const [k, ...v] = p.split(':');
    if (k) params[k.toUpperCase()] = v.join(':');
  });
  if (params.E) alerts.push({ level: 'warning', key: 'qr.alert_wifi_hidden' });
  if (params.T && !['WPA', 'WPA2', 'WPA3'].includes(params.T)) alerts.push({ level: 'danger', key: 'qr.alert_wifi_weak', params: { enc: params.T } });
  fields.push({ key: 'qr.f_ssid', value: params.S || '—' });
  fields.push({ key: 'qr.f_enc', value: params.T || '—' });
  fields.push({ key: 'qr.f_pass', value: params.P ? '•'.repeat(params.P.length) : '—' });
}

/**
 * Полный разбор: { type, alerts:[{level,key,params}], fields:[{key,value,highlight}],
 * openUrl (только если нет danger), raw }
 */
export function analyzeQrPayload(data) {
  const raw = String(data || '');
  const type = detectQrType(raw);
  const alerts = [];
  const fields = [];
  let openUrl = null;
  if (type === 'url') {
    const u = analyzeUrl(raw, alerts, fields);
    if (u && !alerts.some((a) => a.level === 'danger')) openUrl = raw;
    if (!alerts.length) alerts.push({ level: 'success', key: 'qr.alert_clean' });
  } else if (type === 'wifi') {
    analyzeWifi(raw, alerts, fields);
  } else if (type === 'vcard') {
    const name = (raw.match(/FN:(.+)/i) || [])[1] || '';
    const tel = (raw.match(/TEL[^:]*:(.+)/i) || [])[1] || '';
    const mail = (raw.match(/EMAIL[^:]*:(.+)/i) || [])[1] || '';
    if (name) fields.push({ key: 'qr.f_name', value: name });
    if (tel) fields.push({ key: 'qr.f_phone', value: tel });
    if (mail) fields.push({ key: 'qr.f_email', value: mail });
    alerts.push({ level: 'info', key: 'qr.alert_text' });
  } else if (type === 'tel' || type === 'mail' || type === 'sms') {
    fields.push({ key: 'qr.f_content', value: raw });
    alerts.push({ level: 'info', key: 'qr.alert_text' });
  } else {
    fields.push({ key: 'qr.f_content', value: raw });
    alerts.push({ level: 'info', key: 'qr.alert_text' });
  }
  return { type, alerts, fields, openUrl, raw };
}

const LEVEL_CLASS = { danger: 'qa-danger', warning: 'qa-warning', info: 'qa-info', success: 'qa-success' };

/**
 * Отрисовать разбор в host (все значения экранируются; кнопки — addEventListener).
 * onCopy(payload) — колбэк копирования (вызывающая сторона решает, чем копировать).
 */
export function renderQrAnalysis(host, analysis, { onCopy = null } = {}) {
  if (!host) return;
  const a = analysis;
  host.hidden = false;
  host.innerHTML = `
    <div class="qa-head">
      <span class="qa-badge qa-type-${escapeHtml(a.type)}">${escapeHtml(t(`qr.type_${a.type}`))}</span>
      <b>${escapeHtml(t('support.qr_analysis_title'))}</b>
    </div>
    ${a.alerts.map((al) => `<div class="qa-alert ${LEVEL_CLASS[al.level] || 'qa-info'}">${escapeHtml(t(al.key, al.params || {}))}</div>`).join('')}
    <div class="qa-fields">${a.fields.map((f) => `
      <div class="qa-field"><span class="qa-label">${escapeHtml(t(f.key))}</span><span class="qa-value${f.highlight ? ' hl' : ''}">${escapeHtml(f.value)}</span></div>`).join('')}</div>
    <div class="qa-actions">
      <button type="button" class="btn btn-quiet btn-sm qa-copy">${escapeHtml(t('qr.copy_payload'))}</button>
      ${a.openUrl
        ? `<button type="button" class="btn btn-quiet btn-sm qa-open">${escapeHtml(t('qr.open_link'))}</button>`
        : `<button type="button" class="btn btn-quiet btn-sm" disabled>${escapeHtml(t('qr.open_blocked'))}</button>`}
    </div>
    <details class="qa-raw"><summary>${escapeHtml(t('qr.raw'))}</summary><code>${escapeHtml(a.raw)}</code></details>`;
  host.querySelector('.qa-copy')?.addEventListener('click', () => {
    if (onCopy) onCopy(a.raw);
  });
  host.querySelector('.qa-open')?.addEventListener('click', () => {
    // открытие — только если разбор не нашёл danger-уровней (openUrl проставлен)
    window.open(a.openUrl, '_blank', 'noopener');
  });
}
