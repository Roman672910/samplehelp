// DOM-смоук: страница вопроса (заглушка/баннер/блокировки), лента, избранное;
// секция 9 — статический CSS-тест навигации (свечение .nav-icon.active не
// обрезается: .main-nav без overflow-x:auto, фикс 2026-10-11)
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast-container"></div><div id="modal-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
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
const sb = await import('../public/js/supabase.mjs');
const { renderQuestion } = await import('../public/js/question.mjs');
const { renderFeed } = await import('../public/js/feed.mjs');
const { renderFavorites } = await import('../public/js/favorites.mjs');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`); if (!cond) fails++; };
const app = document.getElementById('app');
const tick = () => new Promise((r) => setTimeout(r, 60));

console.log('1) Страница-заглушка (q0, удалённый вопрос):');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await renderQuestion(app, { id: 'q0' });
ok(!!app.querySelector('.tombstone'), 'рендерится tombstone');
ok(app.textContent.includes('Вопрос решён и отправлен в архив'), 'заголовок архива');
ok(app.textContent.includes('@MaxWavetable') && app.textContent.includes('+25 реп.'), 'лучший ответ и награда');
ok(/·\s*3 ответа/.test(app.textContent), '«3 ответа» (плюрализация): ' + (app.textContent.match(/Решён [^·]+·[^·]+/) || [''])[0].trim());
ok(!app.querySelector('#q-player'), 'нет плеера');

console.log('2) Решённый вопрос (q1) глазами автора (u-max):');
setState({ user: { id: 'u-max', username: 'MaxWavetable' } });
let cleanup = await renderQuestion(app, { id: 'q1' });
ok(!!app.querySelector('#purge-banner'), 'баннер отсчёта на месте');
ok(/Вопрос решён\. Удаление через \d+ дн \d+ ч/.test(app.querySelector('#purge-text').textContent), 'текст: ' + app.querySelector('#purge-text').textContent);
ok(!!app.querySelector('#btn-unresolve'), 'у автора есть «Отменить решение»');
ok(!app.querySelector('#answer-form') && !!app.querySelector('.answers-closed'), 'форма ответа закрыта плашкой');
ok(app.querySelector('#btn-fav').disabled, '«В избранное» неактивна');
cleanup?.();

console.log('3) Решённый вопрос глазами другого пользователя:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
cleanup = await renderQuestion(app, { id: 'q1' });
ok(!!app.querySelector('#purge-banner') && !app.querySelector('#btn-unresolve'), 'баннер есть, кнопки отмены нет');
ok(app.querySelector('#btn-fav').disabled, 'избранное неактивно');
cleanup?.();

console.log('4) Открытый вопрос (q2): всё активно, форма на месте:');
cleanup = await renderQuestion(app, { id: 'q2' });
ok(!app.querySelector('#purge-banner'), 'баннера нет');
ok(!!app.querySelector('#answer-form'), 'форма ответа рендерится');
ok(!app.querySelector('#btn-fav').disabled, 'избранное активно');
// Presence-чив удалён (заход 40): статус онлайн/офлайн — точки на аватарках ленты
ok(!app.querySelector('.presence-row') && !app.querySelector('#q-presence-host') && !app.querySelector('.presence-chip'), 'заход 40: presence-ряда/хоста/чипа на странице вопроса нет');
ok(app.querySelectorAll('.sidebar-block .stat-row b').length === 3, 'в строках статистики 3 <b> (ответы/лайки/статус)');
cleanup?.();

console.log('5) Лента:');
setState({ user: { id: 'u-demo', username: 'DemoUser' } });
await renderFeed(app);
await tick();
const card1 = app.querySelector('[data-qid="q1"]');
ok(!!card1, 'карточка q1 в ленте');
ok(!app.querySelector('[data-qid="q0"]'), 'заглушка q0 не в ленте');
const chip = card1?.querySelector('.status-purge');
ok(!!chip && /Решено · \d+ дн/.test(chip.textContent), 'чип: ' + (chip?.textContent || 'нет'));
ok(card1.querySelector('[data-act="answer"]').disabled, '«Ответить» неактивна у решённого');
ok(card1.querySelector('[data-act="fav"]').disabled, '«В избранное» неактивна у решённого');
const card2 = app.querySelector('[data-qid="q2"]');
ok(card2 && !card2.querySelector('[data-act="answer"]').disabled, 'у открытого q2 кнопки активны');

console.log('6) Избранное с архивным вопросом:');
await sb.setFavorite('q0', true);
await sb.setFavorite('q2', true);
await renderFavorites(app);
const purgedCard = app.querySelector('.q-card.purged');
ok(!!purgedCard, 'серая карточка «решён и удалён»');
ok(purgedCard.textContent.includes('Вопрос решён и удалён'), 'текст-примечание');
ok(!!purgedCard.querySelector('a[href="/question/q0"]'), 'ссылка на страницу-архив');
ok(!app.querySelector('[data-qid="q2"] [data-act="answer"]')?.disabled, 'обычный вопрос — кнопки активны');

console.log('7) Клик «✓ Решение» на странице вопроса → полный ре-рендер через роутер:');
const { route, navigate } = await import('../public/js/router.mjs');
route('/question/:id', (el, params) => renderQuestion(el, params));
setState({ user: { id: 'u-anna', username: 'AnnaSynth' } }); // автор q2
navigate('/question/q2');
await tick(); await tick();
const solChip = app.querySelector('.answer-card[data-answer-id="a3"] [data-act="solution"]');
ok(!!solChip && solChip.dataset.value === 'false', 'чип «✓ Решение» у ответа a3');
solChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await tick(); await tick(); await tick();
ok(!!app.querySelector('#purge-banner'), 'появился баннер отсчёта');
ok(!!app.querySelector('.answers-closed') && !app.querySelector('#answer-form'), 'форма ответа закрыта');
ok(!!app.querySelector('.answer-card[data-answer-id="a3"] .solution-badge'), 'a3 помечен как решение');
ok(app.querySelector('#btn-fav')?.disabled === true, '«В избранное» деактивирована');
const lena = await sb.fetchProfile('u-lena');
ok(lena.stats.rating === 895, 'LenaFX получила +25 реп через UI-цепочку');

console.log('8) «Отменить решение» через баннер + модалку подтверждения:');
const unresolveBtn = app.querySelector('#btn-unresolve');
ok(!!unresolveBtn, 'кнопка отмены видна автору');
unresolveBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await tick();
const yesBtn = document.querySelector('#modal-root [data-act="yes"]');
ok(!!yesBtn, 'модалка подтверждения открылась');
yesBtn?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
await tick(); await tick(); await tick();
ok(!app.querySelector('#purge-banner'), 'баннер исчез');
ok(!!app.querySelector('#answer-form'), 'форма ответа снова активна');
ok(!app.querySelector('#btn-fav')?.disabled, '«В избранное» снова активна');
const q2after = await sb.fetchQuestion('q2');
ok(q2after.status === 'open' && !q2after.purge_at, 'q2 открыт, таймер снят');
const lenaKept2 = await sb.fetchProfile('u-lena');
ok(lenaKept2.stats.rating === 895, 'репутация LenaFX сохранена навсегда');

console.log('\n9) CSS: свечение активной иконки навигации больше не обрезается (фикс 2026-10-11):');
const css = fs.readFileSync('public/css/style.css', 'utf8');
const navStart = css.indexOf('.main-nav {');
// Комментарии внутри блока убираем: в них «overflow-x:auto» упоминается как диагноз
const navBlock = css.slice(navStart, css.indexOf('}', css.indexOf('position: relative', navStart))).replace(/\/\*[\s\S]*?\*\//g, '');
ok(/\.main-nav\s*{[^}]*overflow:\s*hidden/.test(navBlock), '.main-nav { overflow: hidden } — clip-бокс больше не режет ореол по высоте иконок');
ok(/\.main-nav\s*{[^}]*height:\s*var\(--header-h\)/.test(navBlock), '.main-nav во всю высоту шапки: height: var(--header-h) (64px ≥ 40 + 2·18 ореола)');
ok(!/\.main-nav\s*{[^}]*overflow-x:\s*auto/.test(navBlock), 'overflow-x: auto у .main-nav удалён');
ok(!css.includes('.main-nav::-webkit-scrollbar'), 'правило::-webkit-scrollbar для .main-nav удалено (скролла больше нет)');
ok(/@media \(max-width: 420px\)[^@]*\.nav-icon \{ width: 32px; height: 32px; \}/.test(css),
  'адаптив ≤420px: иконки 32px + gap 1px — 6 иконок (с 💡 идей) помещаются в 320px без скролла');
const htmlIdx = fs.readFileSync('public/index.html', 'utf8');
const iBell = htmlIdx.indexOf('id="notif-bell"');
const iIdeas = htmlIdx.indexOf('id="btn-ideas"');
const iHelp = htmlIdx.indexOf('id="btn-help-mode"');
ok(iBell > -1 && iIdeas > iBell && iHelp > iIdeas, 'порядок иконок шапки: колокольчик → 💡 идеи → «?»');
ok(/id="btn-ideas"[^>]*data-help="ideas_btn"/.test(htmlIdx), 'кнопка 💡 с data-help="ideas_btn" (конвенция справки)');
ok(/\.idea-dev \{[^}]*margin: 14px 0 16px/.test(css), 'карточка «Написать разработчику» с отступом снизу — табы «Топ/Новые» не прилипают');
const mainSrc = fs.readFileSync('public/js/main.mjs', 'utf8');
ok(/if \(IS_DEMO[\s\S]{0,500}demo-role-switch/.test(mainSrc), 'заход 43: демо-тумблер ролей создаётся ТОЛЬКО при IS_DEMO');
ok(css.includes('.admin-badge'), 'заход 44: стиль бейджа админа .admin-badge на месте');
ok(!css.includes('.role-note') && !css.includes('.avatar-edit-btn'), 'заход 44: стили role-note и avatar-edit-btn вычищены');
const profSrc = fs.readFileSync('public/js/profile.mjs', 'utf8');
ok(!profSrc.includes('avatar-edit-btn') && !profSrc.includes('btn-change-avatar'), 'заход 44: кнопки загрузки фото в шапке профиля нет (функция осталась в настройках)');
ok(/\.sort-tabs \{[^}]*margin-top: 16px/.test(css), 'заход 45: у .sort-tabs глобальный margin-top 16px — не прилипают к блоку выше (лента/ideas/модерация)');
// Заход 49 (с поправкой): бейдж «Beta» надстрочником над «Help» (не на круге — перекрывал логотип)
ok(/<span class="logo-text">Sample<em>Help<\/em><span class="beta-badge" data-help="beta_badge" data-i18n="nav\.beta">Beta<\/span><\/span>/.test(htmlIdx),
  'заход 49: бейдж «Beta» — в .logo-text сразу после Help, с data-help и data-i18n');
const logoIconInner = (htmlIdx.match(/class="logo-icon"[^>]*>((?:(?!<\/span>)[\s\S])*)<\/span>/) || [])[1] || '';
ok(logoIconInner.includes('<svg') && !logoIconInner.includes('beta-badge'),
  'заход 49 (поправка): в .logo-icon только svg — круг логотипа чистый');
ok((htmlIdx.match(/class="logo-text"/g) || []).length === 1,
  'заход 49 (поправка 2): надпись .logo-text в шапке ровно ОДНА (дубль из правки переноса бейджа удалён)');
ok(/\.logo-text \{ position: relative; \}/.test(css)
  && /\.beta-badge \{[^}]*position: absolute/.test(css) && /\.logo:hover \.beta-badge/.test(css),
  'заход 49: .logo-text — якорь, .beta-badge — абсолютный + отзыв на hover');
{
  const ru = JSON.parse(fs.readFileSync('public/locales/ru.json', 'utf8'));
  ok(ru.nav?.beta === 'Beta', 'заход 49: ru.json nav.beta = «Beta»');
  ok(!!ru.help?.items?.beta_badge?.title && !!ru.help?.items?.beta_badge?.desc,
    'заход 49: help.items.beta_badge в каталоге справки');
}
const avBlock = (css.match(/\.avatar \{[^}]*\}/) || [''])[0];
ok(avBlock && !/overflow:\s*hidden/.test(avBlock), 'заход 41: у .avatar нет overflow:hidden — круглая маска не срезает точку .p-dot');
ok(/\.avatar img \{[^}]*border-radius: 50%/.test(css), 'фото скругляется на самом .avatar img');
ok(css.includes('.sup-method-hint'), 'стиль .sup-method-hint для фолбэк-инструкции СБП на месте');
ok(css.includes('.donate-row.invalid .donate-value'), 'подсветка ошибок валидации способов приёма на месте');

console.log(fails ? `\n✗ ${fails} провалов` : '\n✓ DOM-смоук пройден');
process.exit(fails ? 1 : 0);
