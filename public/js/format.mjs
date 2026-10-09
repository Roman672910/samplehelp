// ============================================================
// format.mjs — безопасное мини-форматирование текста.
// Поддержка: **жирный**, *курсив*, `код`, ```блок кода```,
// > цитата, - список, авто-ссылки, переносы строк.
// Безопасность: исходный текст ПОЛНОСТЬЮ экранируется, и только
// затем к экранированному тексту применяются наши собственные
// маркеры — вставить произвольный HTML невозможно.
// ============================================================

import { t } from './i18n.mjs';
import { escapeHtml } from './utils.mjs';

/** Инлайн-разметка одной строки (вход уже экранирован) */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code class="fmt-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(https?:\/\/[^\s<&]+(?:&amp;[^\s<]+)*)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

/**
 * Текст → безопасный HTML с ограниченной разметкой.
 * Результат вставлять через innerHTML БЕЗ дополнительного экранирования.
 */
export function formatText(raw) {
  if (raw == null || raw === '') return '';
  const lines = escapeHtml(String(raw)).split('\n');
  const out = [];
  let listOpen = false;
  let quoteOpen = false;
  let preOpen = false;

  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };
  const closeQuote = () => { if (quoteOpen) { out.push('</blockquote>'); quoteOpen = false; } };

  for (const line of lines) {
    // Переключатель блока кода ```
    if (/^\s*```/.test(line)) {
      closeList(); closeQuote();
      if (!preOpen) { out.push('<pre class="fmt-pre"><code>'); preOpen = true; }
      else { out.push('</code></pre>'); preOpen = false; }
      continue;
    }
    // Внутри блока кода — никакой разметки, только текст (переносы сохраняем)
    if (preOpen) { out.push(`${line}\n`); continue; }

    const trimmed = line.trim();

    // Пункт списка: "- …" или "* …"
    if (/^[-*]\s+/.test(trimmed)) {
      closeQuote();
      if (!listOpen) { out.push('<ul class="fmt-ul">'); listOpen = true; }
      out.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    closeList();

    // Цитата: "> …" (после экранирования — "&gt; …")
    if (/^&gt;\s?/.test(trimmed)) {
      if (!quoteOpen) { out.push('<blockquote class="fmt-quote">'); quoteOpen = true; }
      out.push(inline(trimmed.replace(/^&gt;\s?/, '')));
      out.push('<br>');
      continue;
    }
    closeQuote();

    if (!trimmed) { out.push('<br>'); continue; }
    out.push(`${inline(line)}<br>`);
  }

  closeList(); closeQuote();
  if (preOpen) out.push('</code></pre>');

  // Аккуратный финал: пустая строка перед концом цитаты и хвостовые переносы
  return out.join('')
    .replace(/<br><\/blockquote>/g, '</blockquote>')
    .replace(/(?:<br>)+$/g, '');
}

/**
 * Снять маркеры разметки — для превью в ленте и списков,
 * где HTML не нужен, а «звёздочки» мешают.
 */
export function stripFormat(raw) {
  return String(raw ?? '')
    .replace(/```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Простой текст с сохранением переносов строк — для ответов и комментариев,
 * где форматирование отключено: экранирует HTML, убирает маркеры разметки
 * (**жирный**, *курсив*, `код`, цитаты, списки) и превращает \n в <br>.
 * Ссылки НЕ становятся кликабельными (для них есть виджет 🔗 в ответе).
 * В отличие от stripFormat() переносы строк сохраняются.
 */
export function plainText(raw) {
  if (raw == null || raw === '') return '';
  return escapeHtml(String(raw))
    .replace(/```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/^&gt;\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n/g, '<br>');
}

/**
 * Мини-тулбар форматирования над textarea:
 * оборачивает выделенный текст в маркеры или добавляет префикс строкам.
 */
export function attachFormatToolbar(textarea) {
  if (!textarea || textarea.dataset.fmtBound) return;
  textarea.dataset.fmtBound = '1';

  const defs = [
    { label: 'B', title: t('fmt.bold'), wrap: ['**', '**'], css: 'font-weight:700' },
    { label: 'I', title: t('fmt.italic'), wrap: ['*', '*'], css: 'font-style:italic;font-family:Georgia,serif' },
    { label: '</>', title: t('fmt.code'), wrap: ['`', '`'], css: 'font-family:var(--font-mono);font-size:10.5px' },
    { label: '❝', title: t('fmt.quote'), linePrefix: '> ' },
    { label: '•—', title: t('fmt.list'), linePrefix: '- ' },
  ];

  const bar = document.createElement('div');
  bar.className = 'fmt-toolbar';

  for (const d of defs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fmt-btn';
    b.textContent = d.label;
    b.title = d.title;
    b.setAttribute('aria-label', d.title);
    if (d.css) b.style.cssText = d.css;
    b.addEventListener('click', () => {
      const val = textarea.value;
      const s = textarea.selectionStart;
      const e = textarea.selectionEnd;
      if (d.wrap) {
        const [pre, post] = d.wrap;
        const sel = val.slice(s, e);
        textarea.value = val.slice(0, s) + pre + sel + post + val.slice(e);
        textarea.focus();
        textarea.setSelectionRange(s + pre.length, s + pre.length + sel.length);
      } else {
        // Префикс для всех затронутых строк
        const lineStart = val.lastIndexOf('\n', s - 1) + 1;
        const nextNl = val.indexOf('\n', e);
        const lineEnd = nextNl === -1 ? val.length : nextNl;
        const block = val.slice(lineStart, lineEnd);
        const prefixed = block
          .split('\n')
          .map((l) => (l.startsWith(d.linePrefix) ? l.slice(d.linePrefix.length) : d.linePrefix + l))
          .join('\n');
        textarea.value = val.slice(0, lineStart) + prefixed + val.slice(lineEnd);
        textarea.focus();
        textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    bar.appendChild(b);
  }

  const hint = document.createElement('span');
  hint.className = 'fmt-hint';
  hint.textContent = t('fmt.hint');
  bar.appendChild(hint);

  textarea.insertAdjacentElement('beforebegin', bar);
}