// Поведенческий тест: типизированные ссылки в ответах
// (автоопределение вида, normalizeLinks старого формата, виджет формы, рендер чипов)
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.Audio = dom.window.Audio;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.URL.createObjectURL = () => 'blob:demo-audio';
const ctx2d = () => new Proxy({}, { get: (t, p) => (p === 'measureText' ? () => ({ width: 10 }) : p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : p === 'canvas' ? { width: 300, height: 60 } : () => {}) });
dom.window.HTMLCanvasElement.prototype.getContext = () => ctx2d();

const fs = await import('node:fs');
globalThis.fetch = async (url) => {
  const m = String(url).match(/locales\/(\w+)\.json/);
  if (m) return { ok: true, json: async () => JSON.parse(fs.readFileSync(`public/locales/${m[1]}.json`, 'utf8')) };
  throw new Error('unexpected fetch: ' + url);
};

const { setLocale } = await import('../public/js/i18n.mjs');
await setLocale('ru');
const { setState } = await import('../public/js/store.mjs');
const {
  detectLinkKind, isValidLinkUrl, normalizeLinks, linkChipHtml, createLinksWidget, MAX_ANSWER_LINKS,
} = await import('../public/js/links.mjs');
const { answerCardHtml } = await import('../public/js/question.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const host = document.getElementById('host');
const inputEvent = (el) => el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
const changeEvent = (el) => el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

console.log('1) Автоопределение вида по домену:');
ok(detectLinkKind('https://www.youtube.com/watch?v=x') === 'video', 'youtube.com → video');
ok(detectLinkKind('https://youtu.be/x') === 'video', 'youtu.be → video');
ok(detectLinkKind('https://music.youtube.com/x') === 'video', 'поддомен music.youtube.com → video');
ok(detectLinkKind('https://vimeo.com/1') === 'video', 'vimeo → video');
ok(detectLinkKind('https://twitch.tv/ch') === 'video', 'twitch → video');
ok(detectLinkKind('https://tiktok.com/@x') === 'video', 'tiktok → video');
ok(detectLinkKind('https://habr.com/ru/articles/1/') === 'article', 'habr → article');
ok(detectLinkKind('https://medium.com/@x/y') === 'article', 'medium → article');
ok(detectLinkKind('https://x.substack.com/p/y') === 'article', 'поддомен substack → article');
ok(detectLinkKind('https://www.ableton.com/en/live/') === 'docs', 'ableton → docs');
ok(detectLinkKind('https://kilohearts.com/products/phase_plant') === 'docs', 'kilohearts → docs');
ok(detectLinkKind('https://image-line.com/flstudio/') === 'docs', 'image-line → docs');
ok(detectLinkKind('https://xferrecords.com/products/serum') === 'docs', 'xfer → docs');
ok(detectLinkKind('https://docs.google.com/document/d/1') === 'docs', 'docs.* → docs');
ok(detectLinkKind('https://github.com/u/repo') === 'preset', 'github → preset');
ok(detectLinkKind('https://splice.com/packs/x') === 'preset', 'splice → preset');
ok(detectLinkKind('https://gumroad.com/l/x') === 'preset', 'gumroad → preset');
ok(detectLinkKind('https://patreon.com/x') === 'preset', 'patreon → preset');
ok(detectLinkKind('https://example.com/page') === null, 'неизвестный домен → null (без пометки)');
ok(detectLinkKind('не url') === null, 'мусор → null');
ok(detectLinkKind('https://notyoutube.com/x') === null, 'похожий домен не матчится (notyoutube.com)');

console.log('2) Валидность URL:');
ok(isValidLinkUrl('https://a.b') === true, 'https — валиден');
ok(isValidLinkUrl('http://a.b/x?y=1') === true, 'http — валиден');
ok(isValidLinkUrl('javascript:alert(1)') === false, 'javascript: — невалиден');
ok(isValidLinkUrl('ftp://a.b') === false, 'ftp: — невалиден');
ok(isValidLinkUrl('просто текст') === false, 'текст — невалиден');
ok(isValidLinkUrl('') === false, 'пусто — невалиден');

console.log('3) normalizeLinks (старый формат → новый):');
const legacy = normalizeLinks(['https://www.youtube.com/watch?v=x']);
ok(legacy.length === 1 && legacy[0].kind === 'video', 'голая строка youtube → {url, kind:"video"}');
const typed = normalizeLinks([{ url: 'https://example.com/p', kind: 'other', label: 'Мой пак' }]);
ok(typed[0].kind === 'other' && typed[0].label === 'Мой пак', 'объект с label проходит как есть');
ok(normalizeLinks([{ url: 'https://e.com', kind: 'bogus' }])[0].kind === '', 'неизвестный kind → ""');
ok(normalizeLinks(['', '   ']).length === 0, 'пустые строки отбрасываются');
ok(normalizeLinks(['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com']).length === MAX_ANSWER_LINKS, `обрезка до ${MAX_ANSWER_LINKS}`);
ok(normalizeLinks(null).length === 0 && normalizeLinks('x').length === 0, 'не массив → []');
const once = normalizeLinks(['https://github.com/u/r']);
ok(JSON.stringify(normalizeLinks(once)) === JSON.stringify(once), 'идемпотентность (нормализация нормализованного)');
ok(!('label' in normalizeLinks([{ url: 'https://e.com', kind: 'video', label: 'лишнее' }])[0]), 'label сохраняется только для kind=other');

console.log('4) Виджет: пустая форма — одна пустая строка, счётчик, лимит 3:');
host.innerHTML = '<div id="w1"></div>';
const w1 = createLinksWidget(host.querySelector('#w1'));
ok(w1.rows().length === 1, 'стартовая пустая строка');
ok(host.querySelector('.links-counter').textContent === '1 из 3', 'счётчик «1 из 3»: ' + host.querySelector('.links-counter').textContent);
click(host.querySelector('.links-add'));
click(host.querySelector('.links-add'));
ok(w1.rows().length === 3, 'две кнопки «＋» → 3 строки');
ok(host.querySelector('.links-add').disabled, 'на 3 строках кнопка «＋» заблокирована');
ok(!host.querySelector('.links-max-hint').hidden, 'подсказка «Максимум 3 ссылки» видна');
click(w1.rows()[2].querySelector('.link-del'));
ok(w1.rows().length === 2 && !host.querySelector('.links-add').disabled, 'удаление строки → 2, кнопка снова активна');
ok(host.querySelector('.links-max-hint').hidden, 'подсказка скрылась');

console.log('5) Виджет: автоопределение вида при вводе URL:');
host.innerHTML = '<div id="w2"></div>';
const w2 = createLinksWidget(host.querySelector('#w2'));
const row = w2.rows()[0];
const urlInput = row.querySelector('.link-url');
const kindSel = row.querySelector('.link-kind');
urlInput.value = 'https://www.youtube.com/watch?v=serum';
inputEvent(urlInput);
ok(kindSel.value === 'video', 'youtube → select «video» автоматически');
ok(!!row.querySelector('.link-row-icon svg'), 'появилась фирменная иконка платформы (svg)');
ok(row.dataset.touched !== 'true', 'строка ещё не «тронута» вручную');
urlInput.value = 'https://example.com/page';
inputEvent(urlInput);
ok(kindSel.value === '', 'неизвестный домен → вид сбросился на «Ссылка»');

console.log('6) Виджет: ручной выбор не перебивается автоопределением (touched):');
kindSel.value = 'article';
changeEvent(kindSel);
ok(row.dataset.touched === 'true', 'select change → touched=true');
urlInput.value = 'https://www.youtube.com/watch?v=x';
inputEvent(urlInput);
ok(kindSel.value === 'article', 'после ввода youtube вид остался «article»');

console.log('7) Виджет: «Другое» → своя пометка:');
kindSel.value = 'other';
changeEvent(kindSel);
const custom = row.querySelector('.link-custom');
ok(!custom.hidden, 'поле своей пометки открылось');
custom.value = 'Гайд от автора';
ok(JSON.stringify(w2.getValue()) === JSON.stringify([{ url: 'https://www.youtube.com/watch?v=x', kind: 'other', label: 'Гайд от автора' }]), 'getValue: ' + JSON.stringify(w2.getValue()));
kindSel.value = 'video';
changeEvent(kindSel);
ok(custom.hidden, 'при смене вида поле пометки скрылось');
ok(!('label' in w2.getValue()[0]), 'label не сохраняется для kind != other');

console.log('8) Виджет: валидация (мусор, дубликаты, пустые строки):');
host.innerHTML = '<div id="w3"></div>';
const w3 = createLinksWidget(host.querySelector('#w3'));
click(host.querySelector('.links-add'));
click(host.querySelector('.links-add'));
const [r1, r2, r3] = w3.rows();
r1.querySelector('.link-url').value = 'не-ссылка';
r2.querySelector('.link-url').value = 'https://youtube.com/watch?v=dup';
r3.querySelector('.link-url').value = 'https://youtube.com/watch?v=dup';
let v = w3.validate();
ok(!v.ok && v.message.includes('Некорректная ссылка'), 'мусор: ok=false, «Некорректная ссылка»: ' + v.message);
ok(r1.classList.contains('invalid'), 'строка с мусором подсвечена (.invalid)');
ok(!host.querySelector('.links-error').hidden, 'блок ошибки виден');
r1.querySelector('.link-url').value = '';
inputEvent(r1.querySelector('.link-url'));
v = w3.validate();
ok(!v.ok && v.message.includes('уже добавлена'), 'дубликат: ok=false: ' + v.message);
ok(!r1.classList.contains('invalid'), 'пустая строка не считается ошибкой');
r3.querySelector('.link-url').value = 'https://vimeo.com/1';
inputEvent(r3.querySelector('.link-url'));
v = w3.validate();
ok(v.ok, 'после исправления — ok');
ok(host.querySelector('.links-error').hidden, 'блок ошибки скрыт');
ok(w3.getValue().length === 2, 'getValue игнорирует пустую строку (2 ссылки)');

console.log('9) Виджет: инициализация из данных (форма правки):');
host.innerHTML = '<div id="w4"></div>';
const w4 = createLinksWidget(host.querySelector('#w4'), {
  links: [{ url: 'https://www.youtube.com/watch?v=a', kind: 'video' }, { url: 'https://example.com', kind: '', label: '' }],
});
ok(w4.rows().length === 2, 'две строки из данных');
ok(w4.rows()[0].querySelector('.link-url').value === 'https://www.youtube.com/watch?v=a', 'URL подставлен');
ok(w4.rows()[0].querySelector('.link-kind').value === 'video', 'вид подставлен');
ok(w4.rows()[0].dataset.touched === 'true', 'сохранённый вид помечен touched (не перебивается)');
w4.rows()[0].querySelector('.link-url').value = 'https://habr.com/x';
inputEvent(w4.rows()[0].querySelector('.link-url'));
ok(w4.rows()[0].querySelector('.link-kind').value === 'video', 'touched-строка: вид не сбросился на article');

console.log('10) Рендер чипа ссылки в карточке ответа:');
const chip1 = linkChipHtml({ url: 'https://www.youtube.com/watch?v=x', kind: 'video' });
ok(chip1.includes('target="_blank"') && chip1.includes('rel="noopener noreferrer"'), 'открывается в новой вкладке, rel=noopener');
ok(chip1.includes('Видео-туториал') && chip1.includes('youtube.com'), '«Видео-туториал · youtube.com»');
ok(chip1.includes('<svg'), 'фирменная иконка YouTube (svg)');
const chip2 = linkChipHtml({ url: 'https://example.com/pack', kind: 'other', label: 'Мой пак' });
ok(chip2.includes('Мой пак') && chip2.includes('example.com'), 'своя пометка «Мой пак · example.com»');
const chip3 = linkChipHtml({ url: 'https://example.com/x', kind: '' });
ok(chip3.includes('Ссылка') && chip3.includes('🔗'), 'без вида → «🔗 Ссылка · example.com»');
const chip4 = linkChipHtml({ url: 'https://example.com/<script>', kind: '' });
ok(!chip4.includes('<script>'), 'экранирование HTML в URL');

console.log('11) Карточка ответа целиком (answerCardHtml):');
setState({ user: { id: 'u-test', username: 'Tester' } });
host.innerHTML = answerCardHtml({
  id: 'a-test', user_id: 'u-anna', content: 'Держи туториал',
  links: ['https://www.youtube.com/watch?v=x'], // СТАРЫЙ формат — нормализуется на лету
  created_at: new Date().toISOString(),
}, false);
const card = host.querySelector('.answer-card');
ok(!!card.querySelector('.answer-links .link-chip'), 'чип ссылки отрендерился');
ok(card.querySelector('.link-chip').textContent.includes('Видео-туториал'), 'старая строка youtube получила вид «Видео-туториал»');
ok(JSON.parse(card.dataset.links)[0].kind === 'video', 'data-links содержит нормализованный формат');
host.innerHTML = answerCardHtml({ id: 'a2', user_id: 'u-anna', content: 'Без ссылок', links: [], created_at: new Date().toISOString() }, false);
ok(!host.querySelector('.answer-links'), 'пустые ссылки → блока нет');

console.log(fails ? `\n✗ ПРОВАЛЕНО: ${fails}` : '\n✓ Все проверки пройдены');
process.exit(fails ? 1 : 0);