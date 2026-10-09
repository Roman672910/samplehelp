// ============================================================
// i18n.mjs — мультиязычность (RU / EN / DE)
// API: t(key), setLocale(lang), getLocale(), applyTranslations(root)
// Все текстовые элементы в HTML используют data-i18n="key"
// ============================================================

import { CONFIG } from './config.mjs';
import { getState, setState } from './store.mjs';

const STORAGE_KEY = 'samplehelp_locale';
let dictionaries = {};   // { ru: {...}, en: {...}, de: {...} }
let currentLocale = 'ru';

/** Загрузить словарь текущего языка (лениво, с кэшем) */
async function loadDictionary(locale) {
  if (dictionaries[locale]) return dictionaries[locale];
  try {
    const res = await fetch(`/locales/${locale}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dictionaries[locale] = await res.json();
  } catch (e) {
    console.warn(`[i18n] не удалось загрузить ${locale}.json, fallback на en`, e);
    if (locale !== 'en' && !dictionaries.en) {
      const res = await fetch('/locales/en.json');
      dictionaries.en = await res.json();
    }
    dictionaries[locale] = dictionaries.en || {};
  }
  return dictionaries[locale];
}

/** Поиск значения в словаре (без приведения к строке — для массивов плюральных форм) */
function lookup(key) {
  const dict = dictionaries[currentLocale] || {};
  let value = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict);
  if (value === undefined) {
    // fallback: английский
    value = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dictionaries.en || {});
  }
  return value;
}

/** Перевод по ключу вида "nav.feed". Подстановка: t('key', {name: 'X'}) → {name} */
export function t(key, vars = {}) {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? vars[name] : `{${name}}`));
}

/**
 * Перевод с плюральной формой: значение ключа — массив форм
 * ru: [1 ответ, 2-4 ответа, 5+ ответов], en/de: [1 answer, N answers].
 * Подставляет {n}. tp('question.answers_n', 3) → «3 ответа»
 */
export function tp(key, n) {
  const value = lookup(key);
  const count = Math.abs(Math.floor(Number(n) || 0));
  if (!Array.isArray(value) || !value.length) return String(value === undefined ? key : value).replace('{n}', String(n));
  let idx;
  if (currentLocale === 'ru') {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) idx = 0;
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) idx = 1;
    else idx = 2;
  } else {
    idx = count === 1 ? 0 : 1;
  }
  return String(value[Math.min(idx, value.length - 1)]).replace(/\{n\}/g, String(n));
}

/** Текущий язык */
export function getLocale() {
  return currentLocale;
}

/** Применить переводы ко всем элементам с data-i18n внутри root */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  document.documentElement.lang = currentLocale;
}

/** Смена языка: загрузка словаря, обновление состояния и UI */
export async function setLocale(lang) {
  if (!CONFIG.LOCALES.includes(lang)) lang = CONFIG.DEFAULT_LOCALE;
  await loadDictionary(lang);
  currentLocale = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  setState({ locale: lang });
  applyTranslations(document);
  updateSwitcherUI();
  // Перерисовать текущий экран, чтобы динамические тексты обновились
  document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale: lang } }));
}

function updateSwitcherUI() {
  document.querySelectorAll('.lang-switcher button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === currentLocale);
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === currentLocale));
  });
}

/** Инициализация: язык из LocalStorage → браузер → дефолт */
export async function initI18n() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  const locale = CONFIG.LOCALES.includes(saved)
    ? saved
    : CONFIG.LOCALES.includes(browser)
      ? browser
      : CONFIG.DEFAULT_LOCALE;

  await loadDictionary(locale);
  // подстрахуемся английским для fallback
  if (locale !== 'en') await loadDictionary('en');
  currentLocale = locale;
  setState({ locale });
  applyTranslations(document);
  updateSwitcherUI();

  // Переключатель языка (делегирование на document — работает и для
  // динамически создаваемых переключателей, например в «Настройках профиля»)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.lang-switcher button[data-lang]');
    if (btn) setLocale(btn.dataset.lang);
  });
}