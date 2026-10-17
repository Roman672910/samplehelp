# 📒 WORKLOG — журнал работ SampleHelp

Дополнение к проекту: здесь фиксируем **на чём остановились**, чтобы любая следующая
сессия начиналась с полного контекста. Файл обновляется после каждой задачи.

Правило ведения: новая задача → запись в «В работе» → по завершении перенос в
«Сделано» (список сверху вниз, свежие сверху) + обновление «На чём остановились»
и «Дальше».

**Последнее обновление:** 2026-10-16 (заход 48, Фаза C — фронт-адаптер api.mjs: фронт переключается на свой backend флагом)

---

## 📍 На чём остановились

**2026-10-16 (заход 49): бейдж «Beta» в шапке — квадратик с медной обводкой
НАДСТРОЧНИКОМ над правым краем надписи SampleHelp (.beta-badge внутри
.logo-text, top:-10/right:-15, mono 8.5px, hover-подсветка вместе с логотипом).
ПОПРАВКА тем же днём по скриншотной жалобе заказчика («перекрывает сам
логотип»): первая версия стояла на круглой иконке (.logo-icon) — перенесён
на надстрочную позицию над «Help», круг чистый; на ≤420px надпись логотипа
скрыта — бейдж скрывается вместе с ней. Неинтерактивен (клик уходит в ссылку
логотипа), в справке — свой пункт data-help="beta_badge" (каталог 113);
текст через i18n nav.beta="Beta" (счётчик t()-литералов не меняется — 511).
Превью: beta-badge-preview.html. Регрессия в test_dom (+7 ассертов); 37/37
зелёные. ПОПРАВКА 2 (скриншот заказчика «SampleHelp SampleHelp»): правка
переноса бейджа оставила СТАРЫЙ `.logo-text` — в шапке было две надписи;
дубль удалён, в test_dom добавлен ассерт «.logo-text в index.html ровно
одна». Дальше — D2–D5 по приезду мини-ПК, должок #reset= или продуктовый
бэклог по команде.**

**2026-10-16 (заход 48, Фаза D1): деплой-комплект мини-ПК БЕЗ железа готов —
ранбук `DEPLOY_MINIPC.md` (этапы 0–8: покупки/железо, bootstrap Ubuntu,
установка из дампа + секреты, systemd+nginx, Cloudflare Tunnel + CDN-правила,
SMTP и должок `#reset=`, бэкапы 3-2-1 + репетиция + план B на VPS, SECURITY-
чек-лист, мониторинг/запуск) + `deploy/minipc/` (5 скриптов установки,
backup/restore, systemd-юнит с hardening, env-шаблон, cloudflared-конфиг,
nginx-конфиг). Проверено в песочнице: bash -n ✓, nginx -t ✓, ЖИВАЯ топология
nginx→node — 13 проверок ✓ (SPA, /api-прокси, /files с длинным кэшем, приватный
бакет 404, HTML no-store, CORS) + найден и закрыт прод-баг: дефолтный nginx не
знает MIME для .mjs — браузер не исполнял бы модули (types-блок в конфиге).
Selectel-наследие переехало в deploy/legacy_selectel/ (DEPLOY_SELECTEL.md —
архив). Создан `SESSION_RESTART.md` — компактная память для старта новой сессии
по дампу (заказчик шлёт его вместе с filelist_with_content.txt). ДАЛЬШЕ:
D2–D5 по приезду мини-ПК (железо: 4 ядра/8–16 ГБ/NVMe 512 ГБ/Ethernet; домен
RU-регистратор + Cloudflare Free; носитель бэкапов); до этого — должок `#reset=`
или продуктовый бэклог по команде.**

**2026-10-16 (заход 48, фикс C1): «Внутренняя ошибка сервера» при загрузке
аудио на Windows — дефолтный `STORAGE_DIR` в backend/src/config.js строился
как `new URL('../storage').pathname` → на Windows `/K:/samplehelp/...`
(невалидно для NTFS: mkdirSync EINVAL → 500 на /api/upload). Лечение:
fileURLToPath (нативный путь на любой ОС) + понятная ApiError
`storage_unavailable` с путём и кодом ошибки вместо безликой 500 + сервер при
старте печатает разрешённые `storage:`/`static:` пути + те же .pathname-ловушки
вычищены в tests/run*.mjs (тесты на Windows). Регрессия: run_c секция 14
(3 проверки, включая дефолтную ветку в дочернем процессе). Backend 60+19+54 ✓,
живой смоук 70 ✓. Заказчику: обновить backend из свежего дампа (или одна
строка config.js вручную) и перезапустить сервер; STORAGE_DIR задавать не
обязательно (дефолт теперь корректен). Подробности — «Сделано» ниже.**

**2026-10-16 (заход 48, Фаза C): фронт-адаптер api.mjs СДАН — единая точка
доступа к данным вместо supabase.mjs: флаг `USE_LOCAL_BACKEND` + `API_URL`
('http://localhost:3100') в config.mjs; LOCAL-ветка — fetch /api с JWT из
localStorage (access 12h + refresh 30d, тихий single-flight refresh на 401) +
Socket.IO (vendor-бандл socket.io-client + CDN-фолбэк); демо-ветка —
делегирование в supabase.mjs БЕЗ изменений (страховочный пояс). 14 модулей
переименовали импорт; auth.mjs — JWT-restore вместо Supabase-сессии, OAuth-ряд
убран (providers → []); presence — Socket.IO-комната; vendor/supabase.js удалён.
Backend добрал паритет (агрегат профиля, справочники, пакетные ответы,
edited_at, favorites.status/on, likes/status, ref-карточки, donations/count +
confirmed, одиночные achievements, logout, CORS, /files-статика, SPA-fallback-
фикс относительного STATIC_DIR, typing-username из профиля, by-username в
answer/reaction-уведомлениях). Проверки: backend 60+19+51 (run/run_b/run_c на
живом PG 15), ЖИВОЙ смоук tools/phase_c_smoke.mjs — 70 ✓ (вся продуктовая
цепочка через api.mjs против реального сервера, включая живые пуши и
авто-refresh), фронт 37/37 (новый test_api_adapter.mjs — 66 проверок:
fetch-mock + фейковый сокет + паритет 84+ экспортов + статика переключения),
check ✓ 36 модулей, keys ✓ 511, catalog ✓ 112. В репозитории флаг ВЫКЛЮЧЕН
(демо/тесты зелёные); для работы с backend заказчик ставит
`USE_LOCAL_BACKEND: true`. Откат: rollbacks/
filelist_baseline_2026-10-16_before_phase_c.txt. Дальше — Фаза D (деплой
мини-ПК: Nginx, Cloudflare Tunnel+CDN, systemd, бэкапы) по команде; продуктовая
очередь («Дальше») — после перезахода.**

**2026-10-14 (заход 38): сданы «💡 Идеи продукта» — лампочка после колокольчика,
роут /ideas (витрина открыта всем), голосование ▲ с сортировками топ/новые,
модалка предложения, статусы new/in_work/done/rejected с уведомлениями автору,
публичный ответ разработчика в карточке + кнопка ЛС с админом; таблицы
ideas/idea_votes с RLS, DEMO_DB_VERSION 15 с carry идей через пересид; 35
модулей, 507 ключей, каталог 111, 34/34 теста. Дальше — по команде заказчика:
бэклог идей (комментарии/теги/дедуп) или прежние кандидаты («Дальше»).
Раскладка workspace: всё в одной папке samplehelp/ (заход 37).**

**2026-10-14 (заход 32): видимость каналов в модалке «Поддержать автора»
(фикс жалобы «не вижу переключатель QR/Boosty»). Диагноз: переключатель
реализован в заходе (30) и появляется только у авторов с ДВУМЯ включёнными
каналами (в демо — @AnnaSynth); у одноканальных авторов (@MaxWavetable — QR,
@LenaFX — Boosty) скрывался осознанно, но НИЧЕМ не заменялся — донор не понимал,
какой канал у автора и почему выбора нет. Лечение (аддитивно, модель данных и
DEMO_DB_VERSION не тронуты): один способ → шапка `.sup-chan-cap` «Способ
перевода — 📱 QR-код СБП / 🟠 Boosty»; своя модалка автора при способах < 2 →
подсказка `support.owner_chan_hint/owner_chan_none` («выбор у доноров появится,
когда включены оба способа — настройки, блок «Поддержка»»). i18n +3 ключа →
466; каталог 104 без изменений (новых интерактивных элементов нет);
test_donations +секция 9 (7 проверок); 33/33 теста зелёные. Для заказчика сделан
превью-файл `../support-channels-preview.html` (три снапшота модалки, одеты в
боевой CSS, переключатель живой). Где смотреть переключатель в демо: профиль
@AnnaSynth → ☕, или чип «☕ Поблагодарить» на её ответе.**

**2026-10-14 (сессия 31): рабочая область восстановлена из дампа
`uploads/filelist_with_content.txt` (снимок 14.10 09:19:56, после захода (30))
штатным `scripts/restore-filelist.cjs` — 109 текстовых файлов побайтово;
`public/assets/og-cover.png` пересоздан по рецепту записи (5). Код не менялся,
все проверки зелёные (34 модуля / 463 ключа / 104 пункта / 33 теста / смоук).
Состояние функций — как в записи ниже про Boosty (v12). Ждём команду заказчика
по разделу «Дальше».**

**Статус: заход B «Кликабельные #теги» ВЫПОЛНЕН (2026-10-13, спека
`PLAN_CONTACTS_PAYMENTS.md` §4.5 — закрыта последняя часть плана «Контакты и
Оплата вместо Навыков»). Подписка на тег снова имеет точку входа: #теги в
карточках ответов (страница вопроса и раскрытие ленты) и тег синтезатора в
карточках вопросов ленты — чипы-кнопки `tagSubChipHtml` (`data-sub-tag`,
`data-help="tag_subscribe"`, состояние из кэша `store.subscriptions`). Клик →
`requireAuth()` → `toggleTagSubscription()`: запись в БД, кэш, тост и синхронная
перерисовка ВСЕХ чипов того же тега на экране; сайдбар-блок «Подписки» (профиль)
перерисовывается на месте. Обработчик — один capture-слушатель на document
(`initTagSubscriptions()` из main.mjs): `stopPropagation` срабатывает раньше
обработчиков карточек — клик по тегу не раскрывает карточку и не запускает
плеер; в режиме справки (`body.help-active`) чипы уступают клик help.mjs.
Подписка на тег заработала по-настоящему: `createQuestion` генерирует
уведомления `new_question_tag` подписчикам тега (демо + реальная ветка;
рендерер, иконка и i18n-ключ типа существовали с начала проекта — не было
генератора). Мёртвый код `tagSubscribeButtonHtml`/`isTagSubscribed` удалён —
вместо него чип-API (`tagSubChipHtml`, `isTagSubscribedCached`, `syncTagChips`,
`refreshTagSubsCache`). Детали — свежая запись в «Сделано».**
**Дополнено тем же днём по команде заказчика: браузерные подсказки в полях
ЗАПРЕЩЕНЫ** — автоподсказки/автозаполнение (`autocomplete="off"` на всех
form/input/textarea, включая бывшие `username`/`email`/`current-password` в
модалке входа) и нативные валидационные «пузыри» (`novalidate` на всех пяти
формах). Механика централизованная: `disableBrowserHints()`/
`initNoBrowserHints()` в `utils.mjs` (sweep + MutationObserver — будущие поля
ловятся сами), вызов в boot. Валидация в приложении своя, поэтому novalidate
ничего не ломает. Spellcheck/autocorrect НЕ тронуты (полезны для RU-текста;
отключаются отдельной командой). **После скриншота заказчика (Chrome всё равно
показал меню автозаполнения над «Имя пользователя») механика усилена (v2):**
случайный `name` на сессию у текстовых полей (браузер ключует сохранённые
подсказки по name/id — старый «ключ» больше не совпадает, MDN-рекомендация) +
readonly до фокуса на десктопе (на тач-устройствах трюк выключен, чтобы не
мешать клавиатуре). Регрессия — `test_no_browser_hints.mjs` (34 проверки,
включая статический скан исходников). Заказчик дополнительно выключил
автозаполнение на стороне браузера — фронт закрыт с двух сторон.
**Тем же заходом — «наведение порядка» в настройках профиля** (опрос: один
скролл с секциями + липкий подвал, полный пакет, превью ссылок и аватар —
да): пять тематических секций, липкий подвал со статусом и «Готово»,
вертикальная раскладка строк редакторов (подпись больше не режется), превью
ссылок чипами, «Сменить фото» прямо в настройках, ужатые подсказки,
`openEditProfileModal` разгружен (шаблон вынесен в `settingsFormHtml`-хелперы).
**Затем тем же заходом:** опция «Не показывать, что я онлайн» убрана целиком
(тумблер, логика presence, сид, SQL-колонка, ключи), а блоки «Контакты» и
«Поддержка» перестроены по варианту «Г» из превью
`settings-blocks-variants.html` (выбор заказчика): поддержка — два фикс-слота
(заполнил значение = способ включён), контакты — карточки с меню видов при
добавлении. **Затем — QR-заход (команда заказчика): способы приёма sbp-номер и карта
УДАЛЕНЫ, единственный способ — загруженный автором QR-код СБП; QR можно
ПРОЧИТАТЬ до любого перехода (jsQR из `public/vendor/jsQR.js`, фишинг-разбор
по мотивам примера заказчика). `DEMO_DB_VERSION = 11` (сиды с настоящими
сканируемыми QR). Детали — верхняя запись «Сделано». **Сразу после — Boosty
вторым каналом приёма (команда заказчика): в модалке «Поддержать автора» —
переключатель каналов QR/Boosty, у автора в настройках — слот ссылки
boosty.to с канонизацией и валидацией домена; `DEMO_DB_VERSION = 12`.**
Детали — верхняя запись «Сделано».**
**Сразу затем — контекст переводов (опрос): сообщение к переводу
«SampleHelp · поддержка @автор» с кнопкой копирования, отметка «Я перевёл»
(сумма + сообщение → уведомление автору «сверьте с поступлением в банке»),
«Получено ✓» у автора (в уведомлении колокольчика и в списке отметок своей
модалки) со статусом 'done' и благодарностью донору, антимошенническая памятка
в модалке и справке. Код сверки в комментарии отклонён заказчиком («не все
платят с компа»).** Детали — верхняя запись «Сделано». **v3 (второй скриншот заказчика):**
v2 снимал readonly синхронно в focusin — меню всё равно раскрывалось:
Chrome/Yandex решает показать его ПОЗЖЕ focusin, на уже редактируемом поле
(на скриншоте DevTools виден снятый readonly при открытом меню). Теперь
readonly снимается с задержкой 250 мс после фокуса (в момент клика поле ещё
readonly — меню не раскрывается), клавиша в readonly-поле снимает атрибут
сразу и вставляет символ через `execCommand('insertText')` (input-событие для
автосохранения сохраняется), focusout возвращает readonly.
**Сделано 2026-10-13 (заход по спеке `PLAN_DM_AUDIO_REFS.md`, статус
ВЫПОЛНЕН):** аудио-вложения в ЛС УБРАНЫ (причина №1 — приватность: аудио
переписки лежало в публичном бакете `question-audio`), взамен — карточки-ссылки
«📎» на вопрос/ответ/профиль: `messages.ref jsonb` (= { type, id }, ноль байт
медиа), мини-пикер собственного контента (вкладки «Мои ответы»/«Мои вопросы» +
поиск), карточка в пузыре с фолбэками purged/«ссылка недоступна», в списке
диалогов сообщение-ссылка без текста — «📎`. SQL: drop колонок
`audio_url`/`waveform_data` + новая `ref` (идемпотентно). `DEMO_DB_VERSION = 10`
(старые снапшоты теряют аудио-поля сообщений, ref переносятся). Платёжный
эквайринг (ЮKassa и аналоги) НЕ используем вовсе — см. «Важные заметки».**
Проект зелёный. Сделано 2026-10-11 (свежее сверху): «Поддержать автора»
(СБП+карта) + сохранность демо-данных (v9) + свечение навигации → бейдж-кнопка
«Открыт к коллаборациям» вместо рядов в шапке → контакты и оплата вместо
навыков (заход A) → no-store для css/js/html
в dev-сервере → никель для help-режима →
маркеры ответа + presence-строка →
заморозка i18n на ru →
маркеры в профиле → справка → «кто онлайн» вместо счётчика → три правки
аудио-UI → донаты (модель A)
→ ранбук Selectel (`DEPLOY_SELECTEL.md` + `deploy/`) → мягкий пересид демо-базы
→ приоритет 1 (жалобы+модерация, Метрика за флагом, OG/sitemap/robots)
→ рекламные слоты РСЯ → авто-витрина «Лучшие ответы» → Этап 2 SCALE_PLAN (Opus).
Состояние проверок:

- `npm run check` → ✓ 34 модуля (импорты/экспорты/дубли/синтаксис)
- `tmp_tests/check_keys.cjs` → ✓ 463 i18n-ключей, все есть в ru (ru-only;
  заход B: +`common.tag_subscribe`/`tag_subscribed`; порядок в настройках:
  +8 `settings.*`, +`help.items.set_avatar`, −`payment.settings_title`;
  удаление hide_online: −`profile.hide_online`; вариант «Г»: +5 `settings.*`,
  −4 осиротевших; контекст переводов: +17; QR-заход: +46 (`support.qr_*`,
  блок `qr.*`: типы/алерты/поля/кнопки, `payment.invalid_qr`), −6 осиротевших
  (`kind_sbp`/`kind_card`/`qr_soon`/`sbp_hint`/`invalid_phone`/`invalid_card`);
  Boosty: +7 (`support.kind_boosty`/`boosty_open`/`boosty_hint`/`boosty_page`/
  `choose_channel`/`boosty_ph`, `payment.invalid_boosty`)
- `tmp_tests/check_help_catalog.cjs` → ✓ каталог справки: 104 ключа в ru,
  сирот нет (+`tag_subscribe`, +`set_avatar`, −`set_hide_online`, +4 ключа
  блоков перевода, +3 QR-ключа, +2 Boosty: `support_channel`/`boosty_open`)
- все 33 теста `tmp_tests/test_*.mjs` → ✓ (1317 проверок; новые
  `test_tag_subscribe.mjs` — 43, `test_no_browser_hints.mjs` — 34,
  `test_donation_marks.mjs` — 26; `test_donations.mjs` переписан под QR+Boosty
  (54 проверки); версии v12 в `test_contacts`/`test_moderation`/
  `test_demo_persistence`; `test_presence` — пул без opt-out)
- серверный смоук (`/`, `/js/subscriptions.mjs`, `/js/feed.mjs`,
  `/locales/ru.json`, `/css/style.css`, SPA `/question/q1`, `/messages/u-anna`)
  → ✓, css/js/html — `no-store`
- режим: **ДЕМО**; `DEMO_DB_VERSION = 10` — в заходе B НЕ повышался
  (генератор уведомлений аддитивен, структура сидов не менялась — дисциплина
  записи «донаты, модель A»); u-demo — админ, в сидах 3 жалобы;
  контакты засижены у u-anna/u-max/u-lena; способы приёма — только СБП/карта:
  u-anna — СБП+карта, u-max — СБП, u-lena — карта; бейдж «Открыт к
  коллаборациям» включён у u-anna и u-max, а u-lena специально оставлена
  «контакты есть, бейдж выключен» — живой кейс правила видимости;
  пользовательский контент переживает смену версии сидов; сид-сообщения m5/m6 —
  карточки-ссылки 📎 вместо аудио)
- ⚠️ **Приватность контактов пока клиентская**: `profiles_public_read`
  (`using (true)`) отдаёт строку профиля целиком, поэтому «только залогиненным»
  и маска e-mail/телефона защищают от случайного взгляда и наивного парсера, но
  не от DevTools/сырого ответа PostgREST. Серверное решение (вью `profiles_public`
  без `contact` + RPC `reveal_contact()` с `auth.uid()`, логом и rate-limit) —
  на Этапе 3; зафиксировано в «Открытых вопросах». Стало чуть лучше: чипы
  контактов больше не рендерятся в DOM страницы профиля — только в модалке
  «Как связаться», открытой живым человеком.
- ⚠️ Метрика и реклама в демо/на localhost НЕ грузятся (no-op) — включаются
  флагами после домена; OG-домен — placeholder `samplehelp.example` (замена на Этапе 4).
- 🔻 Живой прогон `DEPLOY_SELECTEL.md` — **ПАУСА по оплате** (аккаунт Selectel
  заведён, не оплачен): см. «Важные заметки».

## 🚧 В работе

**Заход 48 (Supabase → свой стек): Фазы A, B, C (+фикс C1) и D1 ВЫПОЛНЕНЫ
(ниже в «Сделано»). D2–D5 — установка на мини-ПК, домен+туннель, SMTP,
бэкапы/запуск — ЖДЁМ ЖЕЛЕЗО (ранбук DEPLOY_MINIPC.md готов).**
Продуктовая очередь (квота/IndexedDB, QR, чипы, SPA-fallback) — ПАУЗА до
завершения перезахода; должок Фазы C — экран `#reset=` (эндпойнт готов).

Сдано 2026-10-14: сессия 31 (восстановление), заходы 32–47 (видимость каналов
поддержки, v13–v15 миграции, EADDRINUSE-диагностика, памятки модерации + петля
жалоб + column-гранты is_admin, единая папка samplehelp, «💡 Идеи» с голосами и
статусами, присутствие-точки на аватарках, единый источник онлайна для ЛС,
роли и вход: OWNER_EMAIL-триггер + демо-тумблер + бейдж 🛡, демо-аккаунты по
почте и онбординг только при регистрации, отступы .sort-tabs).
Кандидаты следующего захода — в разделе «Дальше»: квота localStorage/IndexedDB,
паритет чипов подписки, фикс SPA-fallback с точкой, бэклоги спец (идеи,
модерация, уведомления) — ждём команду заказчика.

## ✅ Сделано (свежие сверху)

### 2026-10-16 — Заход 49: бейдж «Beta» над логотипом
- **Команда заказчика:** «над логотипом добавим надпись Beta как в квадрате».
- **ПОПРАВКА тем же днём (жалоба: «перекрывает сам логотип» — бейдж стоял на
  круглой иконке):** перенесён НАДСТРОЧНИКОМ над правым краем надписи
  SampleHelp — `.beta-badge` теперь внутри `.logo-text` (сразу после
  `Sample<em>Help</em>`), якорь `.logo-text { position: relative }`, позиция
  top:-10px/right:-15px; `.logo-icon` возвращён к прежнему виду (круг чистый).
  Поведение на ≤420px изменилось честно: надпись логотипа скрыта — бейдж
  скрывается вместе с ней (в тесте и превью отражено). ПОПРАВКА 2 тем же днём
  (скриншот заказчика «SampleHelp SampleHelp»): правка переноса бейджа не
  удалила СТАРЫЙ `.logo-text` — в шапке оказалось две надписи; дубль удалён,
  в test_dom добавлен ассерт «.logo-text ровно одна». Остальное — как в
  основной записи ниже.
- **Разметка (index.html, с учётом поправки):** внутри `.logo-text` сразу после
  `Sample<em>Help</em>` —
  `<span class="beta-badge" data-help="beta_badge" data-i18n="nav.beta">Beta</span>`.
  Воздушный зазор шапки (64px при надписи 19px) позволяет бейджу выступать
  на ~10px вверх без обрезки (.app-header без overflow:hidden — проверено).
- **Стили (style.css, с учётом поправки):** `.logo-text { position: relative }`
  (якорь); `.beta-badge` — квадратик 4px-radius: mono 8.5px/700, медный текст
  (--copper-3), тёмная подложка (--bg-main), обводка --copper-1, мягкое
  медное свечение, top:-10px/right:-15px; `.logo:hover .beta-badge` —
  обводка/свечение ярче (синхронно с ховером круга). Кликабельность не
  перехватывает: клик по бейджу = клик по ссылке логотипа (на главную); в
  режиме справки «?» срабатывает собственный data-help (как у .p-dot, но БЕЗ
  pointer-events:none — иначе справка не поймала бы элемент).
- **i18n/справка:** ru.json +2 — `nav.beta`="Beta" (data-i18n; счётчик
  check_keys не меняется — он считает t()-литералы JS: 511) и
  `help.items.beta_badge` (title «Бета-версия» + desc с маршрутом фидбека
  через «💡 Идеи») — каталог **113**, сирот нет.
- **Регрессия:** test_dom +7 ассертов (бейдж в .logo-text сразу после Help с
  data-help/data-i18n, в .logo-icon только svg — круг чистый, `.logo-text`
  ровно одна (урок поправки 2), CSS position+hover, nav.beta,
  help.items.beta_badge).
  Итог: 37/37 тестов, check ✓ 36 модулей, keys ✓ 511, catalog ✓ 113.
- **Превью:** `beta-badge-preview.html` в корне (3 снапшота в боевой теме:
  обычное состояние, ховер, мобильная шапка) — традиция support-channels-preview.
- Файлы: public/index.html, public/css/style.css, public/locales/ru.json,
  tmp_tests/test_dom.mjs, beta-badge-preview.html, WORKLOG, SESSION_RESTART
  (числа), PROJECT_ANALYSIS (история + проверки).
- Откат: `rollbacks/filelist_baseline_2026-10-16_before_beta_badge.txt`.

### 2026-10-16 — Заход 48, Фаза D1: DEPLOY_MINIPC.md + комплект deploy/minipc (без железа) + SESSION_RESTART.md
- **Команда заказчика:** «готовим D1» + «создай небольшой файл, чтобы при потере
  чата прислать его вместе с дампом». Код приложения НЕ менялся (только
  документация и deploy-комплект) — все проверки фронта/backend остаются
  зелёными с Фазы C/C1.
- **DEPLOY_MINIPC.md (ранбук Фазы D):** §0 расчёт нагрузки/железо (из
  SCALE_PLAN: Opus 5–9 ГБ/мес, egress снимает CDN; 4 ядра/8–16 ГБ/NVMe 512 ГБ/
  Ethernet; расходы: мини-ПК разово, домен ~200–400 ₽/год, Cloudflare 0);
  этапы 0–8 с чек-боксами: 0 покупки (мини-ПК, домен RU-регистратор + Cloudflare
  Free — продажа доменов CF в РФ приостановлена, поэтому регистратор RU, DNS/
  туннель/CDN — CF; носитель бэкапов; SMTP), 1 bootstrap, 2 установка приложения
  (восстановление из дампа, секреты, owner_email ДО первой регистрации,
  LAN-проверка), 3 Cloudflare Tunnel (исходящее соединение — белый IP не нужен),
  4 CDN-правила (таблица: /files — кэш месяц, /api,/socket.io — bypass; SSL
  Full; замена samplehelp.example; 152-ФЗ-нюанс: ПДн в РФ на мини-ПК, CDN
  кеширует только публичные медиа — строгий вариант описан), 5 SMTP + должок
  `#reset=`, 6 бэкапы 3-2-1 + РЕПЕТИЦИЯ + план B (VPS ~500 ₽/мес, restore ~1 ч),
  7 SECURITY-чек-лист, 8 мониторинг/триггеры роста/запуск. Troubleshooting-
  таблица и шпаргалка порядка запуска.
- **deploy/minipc/ (комплект):** 00-bootstrap.sh (пакеты, пользователь
  samplehelp, каталоги /var/www|/var/lib|/etc/samplehelp, ufw только SSH+80-LAN,
  unattended-upgrades); 10-install-app.sh <dump> [домен] (восстановление из
  дампа — restore-скрипт вырезается из дампа же; npm; роль+БД samplehelp;
  openssl-секреты в /etc/samplehelp/backend.env 640 root:samplehelp; migrate;
  серверный патч config.mjs: USE_LOCAL_BACKEND=true + API_URL=домен; повторный
  запуск сохраняет секреты/БД — обновление кода); 20-services.sh (systemd-юнит
  + nginx + health-чеки); 30-tunnel.sh <домен> (cloudflared: deb-репо с
  GitHub-фолбэком, login, create, конфиг, route dns, сервис); 40-backup-install.sh
  (cron 03:30 + контрольный прогон); backup.sh (pg_dump -Fc + rsync storage +
  env, ротация 7 дневных/4 недельных, OPTIONAL_OFFSITE); restore.sh (план B);
  samplehelp-backend.service (Restart=always, NoNewPrivileges, ProtectSystem=
  strict, ReadWritePaths только storage); samplehelp.env.example; 
  cloudflared-config.yml; nginx-samplehelp.conf (SPA-fallback, /api-прокси,
  /socket.io с Upgrade и часовыми таймаутами, /files только публичных бакетов
  alias-ом с SSD + immutable-кэш 30d, /files/ прочее → 404, client_max_body_size
  30m, HTML/css/js/mjs no-store).
- **Проверки в песочнице:** bash -n всех 7 скриптов ✓; nginx -t ✓; ЖИВАЯ
  продакшн-топология (nginx :80 → node :3100, storage-стаб): 13 проверок ✓ —
  SPA / и /question/any, /api/health-прокси, статика, /files отдача+кэш,
  приватный бакет 404, HTML no-store, CORS-префлайт через nginx. **Находка
  этапа (закрыта):** дефолтный mime.types nginx НЕ знает .mjs → octet-stream →
  браузер отказался бы исполнять ES-модули (strict MIME checking) — в конфиг
  добавлен http-уровневый `types { text/javascript mjs; }` (таблицу дополняет,
  остальные MIME не ломает — перепроверено: css/json/js/png на месте).
  Systemd-юниты в песочнице не верифицируются (нет systemd) — визуально +
  живой прогон на D2.
- **Наследие:** deploy/{apply-sql,backup-install,bootstrap,configure-s3}.sh и
  nginx-sample.conf → deploy/legacy_selectel/; DEPLOY_SELECTEL.md — баннер
  «АРХИВ, актуален DEPLOY_MINIPC.md».
- **SESSION_RESTART.md (новый, корень проекта):** компактный протокол старта
  потерянной сессии — восстановление из дампа, команды проверок с ожидаемыми
  числами (36 модулей/511/112/37 тестов; 60+19+54; смоук 70), статус перезахода
  (A/B/C/C1/D1 ✅, D2–D5 ждут железо), 8 жёстких инвариантов (флаг false в репо,
  IS_DEMO-семантика, контракт {code}, t()-only-ru + data-help, DEMO_DB_VERSION,
  регламент захода с baseline, POSIX-переносы, идемпотентная схема ПОСЛЕ create
  table), ловушки среды ($ARENA_WORKSPACE в heredoc, нет curl/ps, node_modules
  не живут между сессиями, экземпляры supabase.mjs?suffix), карта файлов,
  очередь «Дальше», стиль работы с заказчиком. PROJECT_ANALYSIS.md обновлён
  (записи 48C/48C1/48D1, «Стек.Данные», «Текущее состояние» с указателем на
  SESSION_RESTART, «Структура» — backend/, deploy/minipc, vendor socket.io).
- Файлы: DEPLOY_MINIPC.md, deploy/minipc/* (12 файлов), deploy/legacy_selectel/
  (перемещение), DEPLOY_SELECTEL.md (баннер), SESSION_RESTART.md,
  PROJECT_ANALYSIS.md, PLAN_BACKEND_REWRITE.md (§4 D1 ✅), WORKLOG.
- Откат: удалить DEPLOY_MINIPC.md, SESSION_RESTART.md, deploy/minipc/; вернуть
  5 файлов из legacy_selectel в deploy/; снять баннер DEPLOY_SELECTEL.md
  (всё из baseline Фазы C).

### 2026-10-16 — Заход 48, фикс C1: STORAGE_DIR на Windows (загрузка аудио падала в 500)
- **Жалоба заказчика:** «не в демо, загружаю вопрос и аудио — пишет ошибка
  сервера». Диагноз: `backend/src/config.js` строил дефолт `STORAGE_DIR` как
  `new URL('../storage', import.meta.url).pathname` — на Windows это
  `/K:/samplehelp/backend/storage` (ведущий слэш + двоеточие в имени папки
  невалидны для NTFS) → `fs.mkdirSync` в `bucketDir()` бросал EINVAL →
  обработчик ошибок app.js отдавал 500 «Внутренняя ошибка сервера». База
  пустая, поэтому воспроизвелось только при первой реальной загрузке файла;
  интеграционные тесты в песочнице (Linux) путь не задевали, а Windows-прогоны
  Фазы A до upload-секции, судя по всему, не доходили (те же .pathname были
  и в STORAGE_DIR тестов).
- **Лечение:** (1) `config.js` — `fileURLToPath(new URL('../storage',
  import.meta.url))` (нативный абсолютный путь на любой ОС); (2) `storage.js`
  — mkdirSync/writeFileSync обёрнуты: вместо безликой 500 теперь
  `ApiError('storage_unavailable', 'Файловое хранилище недоступно: не создать
  папку <путь> (<код>). Проверьте STORAGE_DIR.')` — диагноз виден прямо в
  тосте и в контракте {code}; (3) `app.js` при прямом запуске печатает
  разрешённые пути `storage:` и `static:` — проверка глазами на старте;
  (4) tests/run{,_b,_c}.mjs — STORAGE_DIR тоже через fileURLToPath (тесты на
  Windows); (5) backend/README — STORAGE_DIR в разделе env + новый раздел
  «Если что-то не так» (эта ошибка, BACKEND-индикатор, JWT-ловушка is_admin,
  пустые данные).
- **Регрессия:** run_c.mjs секция 14 — статический скан config.js
  (fileURLToPath, нет .pathname у STORAGE_DIR), дефолтная ветка в дочернем
  процессе (нативный абсолютный путь, не `/X:`), env-ветка нормализована.
  Проверка вживую: saveUpload с STORAGE_DIR=/etc/hostname → code
  'storage_unavailable' + путь в сообщении.
- **Прогон:** backend 60+19+54 ✓, живой смоук phase_c_smoke 70 ✓ (storage/
  после прогонов вычищен; .gitignore пополнен storage-масками ещё в Фазе C).
  Фронт не менялся (37/37 от Фазы C остаются в силе).
- Откат: в rollbacks/baseline Фазы C (config.js/storage.js/app.js/tests —
  четыре файла, правки точечные).

### 2026-10-16 — Заход 48, Фаза C: фронт-адаптер api.mjs + добор паритета backend
- **Задача (план заказчика):** фронт общается с новым локальным сервером
  (http://localhost:3100), а не с Supabase; UI сохранён целиком; спека —
  PLAN_BACKEND_REWRITE.md §3. Сессия началась с восстановления рабочей копии
  из дампа `uploads/filelist_with_content.txt` штатным restore-filelist.cjs
  (145 файлов; og-cover.png пересоздан по рецепту записи (5): PIL 1200×630,
  медная вейвформа — тесту нужны только PNG-сигнатура и IHDR).
- **public/js/api.mjs (новый, ядро фазы):** ЕДИНАЯ точка доступа к данным —
  все 84+ экспорта supabase.mjs с теми же сигнатурами/формами ответов.
  Два режима: `USE_LOCAL_BACKEND && API_URL` → fetch к /api с JWT; иначе →
  делегирование в supabase.mjs (демо-слой не тронут вовсе). LOCAL-механика:
  токены в localStorage `samplehelp_api_tokens` ({access, refresh});
  `apiFetch` — авто-refresh на 401 ОДНИМ полётом на параллельные запросы
  (single-flight) + повтор; ошибки в контракте supabase-js (Error.code:
  'duplicate' и т.д. — проверка e.code в moderation.mjs работает без правок);
  маппинг форм: серверный profile-джойн → `author{id,username,avatar_url,
  donate_methods}` (лента/вопрос/ответы/комментарии), голоса идей → Set,
  toggle-действия → bool, /files-URL → абсолютные (фронт может жить на :3000);
  upload — FormData с расширением из MIME (webm/m4a/png…), имя ASCII-safe;
  fetchProfile — серверный агрегат + normalizeContacts/normalizeDonateMethods
  (маски контактов уже серверные — клиент не перемаскирует приватность,
  contact_consent для чужого восстанавливается по факту выдачи контактов);
  recordDonation/markDonationTransfer/confirmDonation → donations/thanks|mark|
  confirm (петли уведомлений — на сервере); runLifecycleSweep — no-op (cron
  backend); signInWithOAuth — понятная ошибка (OAuth удалён).
- **Socket.IO на фронте:** getSocket() — ленивый синглтон, vendor-бандл
  `public/vendor/socket.io-client.min.js` (скопирован из client-dist socket.io
  4.8.4, как прежний supabase.js — работа без интернета) → CDN esm.sh →
  jsdelivr; handshake `auth: cb({token})` функциональный — перечитывает токен
  на каждом (ре)коннекте; смена токенов (вход/выход/refresh) → reconnect.
  subscribeNotifications/subscribeMessages (recipient-фильтр: сервер шлёт обеим
  сторонам)/openTypingChannel (троттлинг 2с, conv-ключ пары, фильтр по
  собеседнику)/subscribePresenceRoom (track на connect — переживает реконнект;
  untrack на отписку). presence.mjs: реальная ветка — комната presence:global
  через адаптер (payload {users,guests,total} один в один с прежним).
- **config.mjs:** `USE_LOCAL_BACKEND: false` (В РЕПОЗИТОРИИ ВЫКЛЮЧЕН — иначе
  37 тест-файлов пошли бы в сеть; заказчик ставит true для работы с backend) +
  `API_URL: 'http://localhost:3100'`; `IS_DEMO = !(USE_LOCAL_BACKEND &&
  API_URL)` (прежняя привязка к ключам Supabase снята). SUPABASE_URL/KEY
  оставлены пустыми как архив.
- **Точечная замена (принцип «меняется только имя импорта»):** 14 модулей
  (achievements/auth/favorites/feed/ideas/main/messages/moderation/
  notifications/presence/profile/question/subscriptions/support) — import
  './supabase.mjs' → './api.mjs'. auth.mjs: restoreSession — JWT-ветка
  (getSessionUser + refresh внутри) вместо sb.auth.getSession/
  onAuthStateChange; fetchEnabledProviders → [] (OAuth-ряд не рендерится);
  ensureProfileRow/invalidateProfileCache/CONFIG из импортов убраны.
  main.mjs: индикатор подвала «BACKEND: подключение…/подключено ✓/ошибка»
  (ensureClient = пинг /api/health). achievements.mjs: счётчик комментариев —
  fetchMyCommentCount() (/api/answers/count-mine) вместо прямого sb.from.
  index.html: vendor-тег supabase.js → socket.io-client.min.js;
  public/vendor/supabase.js УДАЛЁН (план Фазы C). supabase.mjs сохранён ЦЕЛИКОМ
  как демо-слой + страховка отката (его боевые Supabase-ветки недостижимы).
- **i18n (тексты, ключи те же — 511):** убраны 4 анахронизма Supabase
  (auth.oauth_disabled, auth.confirm_email_required, help footer_demo и
  presence_dot — теперь про свой backend/Socket.IO).
- **Backend — добор паритета (аддитивно, контракты Фаз A/B не сломаны;
  подробности — backend/README «Эндпойнты Фазы C»):** схема — edited_at у
  questions/answers/comments/messages (метка «(изменено)» в UI), favorites.
  status ('preparing'/'ready'), сиды synth_catalog/daw_catalog (= демо-сидам);
  profiles — GET /:id агрегат (questions/answers+question/stats) + GET
  /dev-contact; questions — sort=unanswered, user_id (профиль: включая
  purge-заглушки), bio в джойне, PATCH: полный белый список + сброс аудио
  явным null + edited_at; answers — GET / (question_ids|user_id|best),
  PATCH +tags/sound_type/difficulty/edited_at, PATCH/DELETE comments/:id,
  count-mine; likes/status; favorites — форма {…question{…author}}, toggle с
  on (идемпотентно), POST status; messages — edited_at, ref-candidates,
  ref-card (публичный); donations/count (публичный, recipient_user_id=project),
  confirm дополнительно ставит payload.confirmed в исходном уведомлении автора
  (кнопка «Получено ✓» гаснет — петля test_donation_marks); achievements —
  одиночная выдача POST {achievement_type} → {awarded}; reports GET —
  композиция reporter+target на сервере (порт боевой ветки fetchReports);
  catalog synths/daws GET/POST; auth — POST /logout (сжигает jti refresh);
  app.js — CORS (Bearer, не cookie; фронт на :3000 работает) + публичная
  отдача /files/<bucket> (только PUBLIC_BUCKETS, 30d-кэш) + ФИКС: STATIC_DIR →
  path.resolve (SPA-fallback падал в 500 с относительным путём — README dev-
  команды используют ../public); realtime — typing несёт username из профиля
  (не email); фиксы «by: ?» — username из userRow в answer-уведомлении и
  реакциях ЛС (в JWT username нет).
- **Тесты:** backend/tests/run_c.mjs — 51 проверка на живом PG (все новые
  эндпойнты + CORS-префлайт + /files + приватный бакет не торчит); npm test =
  A+B+C (60+19+51). backend/tools/phase_c_smoke.mjs — ЖИВОЙ прогон (70 ✓):
  два пользователя, вся продуктовая цепочка ЧЕРЕЗ api.mjs против реального
  сервера — регистрация/онбординг-данные, вопрос→ответ→лайк→решение (+25 rep
  в агрегате), ЛС с 📎-карточкой и ЖИВЫМИ пушами Socket.IO (уведомления и
  сообщения), реакции/правка/непрочитанные, донаты (thanks/mark/confirm +
  confirmed-уведомление + счётчик ☕ + приватность чужих отметок), избранное
  (on/status), подписки, идеи с голосами, права не-админа (жалобы/идеи 403),
  жалобы duplicate, загрузки (webm → /files играется, exe отклонён, аватар),
  профиль-агрегат/словари/настройки, count-mine, авто-refresh на живом 401,
  lifecycle no-op, logout (refresh сгорает). Фронт: новый
  tmp_tests/test_api_adapter.mjs (37-й файл, 66 проверок) — паритет экспортов
  api ⊇ supabase (все 84+, типы совпадают), демо-делегирование БЕЗ сети,
  LOCAL на fetch-mock (токены/refresh-single-flight/ротация/очистка, формы
  запросов и ответов, absoluteUrl, e.code='duplicate', FormData-имя из MIME),
  Socket.IO на фейковом сокете (пуши/фильтры/троттлинг typing/presence
  track-untrack/reconnect на signIn), статика переключения (14 модулей,
  vendor, флаг false в репозитории). Итог: фронт 37/37, check ✓ 36 модулей,
  keys ✓ 511, catalog ✓ 112, смоук статики с backend (/, /js/api.mjs, vendor,
  locales, css, SPA-fallback /question/…, og-cover) ✓.
- **Документация:** README (стек/быстрый старт с backend/структура — api.mjs,
  backend/, vendor; «Свой backend вместо Supabase»), backend/README
  (эндпойнты Фазы C, npm test = A+B+C, смоук, шаг 5 VS Code — флаг вместо
  «пока в ДЕМО»), launch.json (+«живой смоук Фазы C», тесты «A+B+C»),
  PLAN_BACKEND_REWRITE (Фаза C ✅, хронология в шапке), tmp_tests/README
  (test_api_adapter + пометка «приватность контактов теперь серверная»).
- **Ловушки захода (в копилку):** (1) alter table в schema.sql должен идти
  ПОСЛЕ create table всех таблиц — вставка блока edited_at посередине роняла
  migrate («relation answers does not exist»); (2) recipient-фильтр
  subscribeMessages смотрит getState().user В МОМЕНТ ПУША — в смоуке «один
  клиент за двух пользователей» переключение state после await не спасает
  (пуш приходит раньше): токены и state надо разносить до отправки; (3)
  sendFile с относительным STATIC_DIR — 500 на всех SPA-маршрутах (на Windows
  заказчика маскировалось абсолютным путём из инструкции); (4) тесты фронта
  стабят fetch и бросаются на «неожиданный URL» — любой сетевой вызов в демо-
  режиме ломает их, поэтому LOCAL-ветка api.mjs не делает НИ ОДНОГО запроса
  при выключенном флаге (проверено тестом).
- Откат: `rollbacks/filelist_baseline_2026-10-16_before_phase_c.txt`
  (восстановление штатным restore-filelist.cjs; backend-изменения фазы C
  аддитивны — откатывается вместе с фронтом).

### 2026-10-14 — Заход 48, Фаза B: Socket.IO + серверный cron жизненного цикла
- **realtime.js:** Socket.IO вместо Supabase Realtime. Комнаты user:<id>
  (уведомления/ЛС/typing) и presence:* (онлайн и зрители); handshake по JWT
  (анонимы — только presence, гостями, без персональных комнат — приватность
  прежняя). События: notification, message, message_patch, message_delete,
  typing, presence. track/untrack/disconnect пересчитывают состояние комнаты
  ({users, guests, total} — payload один в один с прежним).
- **Пуши из маршрутов:** notify.js → pushNotification; messages.js →
  pushMessage/pushMessageEvent (send/patch/delete/reactions). Best-effort:
  io не поднят — молча пропускаем.
- **lifecycle.js:** порт run_question_lifecycle() из setup_part2.sql: purge
  решённых по purge_at (заглушка с purge_summary, purged_answers_count
  отвечающих, удаление файлов аудио/пресетов с SSD, лайки/ответы каскадом,
  purge-уведомление автору) + напоминания 24ч/3д после первого чужого ответа
  с флагами reminder_24h/3d (колонки добавлены в схему идемпотентно). Cron
  LIFECYCLE_MS (10 мин; 0 = выкл для тестов, sweep зовётся вручную).
- **app.js:** createServer() = http + io + cron; прямой запуск node src/app.js
  поднимает всё разом; createApp() оставлен для тестов Фазы A.
- **Тесты:** backend/tests/run_b.mjs — 19 проверок на живом PG + socket.io-
  клиенте: пуш answer-уведомления, пуш ЛС обеим сторонам, typing, presence
  (2 пользователя + гость, пересчёт на disconnect), purge (заглушка,
  purge_summary.best_username, счётчик отвечающих, идемпотентность),
  напоминания 24ч/3д без дублей. npm test = Фаза A + Фаза B (60+19).
- **Ручная проверка:** backend/tools/realtime-demo.mjs — сам регистрирует двух
  пользователей и прогоняет пуши/typing/presence против живого сервера
  (прогнан в песочнице: все ✓).
- multer 2.4.0 (Фаза A сопровождение), фронт НЕ тронут: 36/36, 35 модулей,
  511 ключей, 112 каталог. Откат Фазы B = откат backend/ до baseline_48A?
  Нет: baseline перед Фазой A покрывает обе фазы (backend/ аддитивен целиком).

### 2026-10-14 — Сопровождение Фазы A: multer 2.x (уязвимости 1.x) + инструкция для Windows
- Заказчик запустил backend на Windows и поймал npm warn: multer 1.x имеет
  известные уязвимости → обновлен на ^2.0.1 (фактически 2.4.0, API для нашего
  использования тот же: memoryStorage + single); интеграционные тесты Фазы A
  перепрогнаны — зелёные.
- Там же вскрылось: `export VAR=…` из bash-инструкции не работает в PowerShell
  (заказчик копирует команды дословно). В backend/README.md добавлен раздел
  «Windows (PowerShell)»: `$env:DATABASE_URL = …`, два способа поставить
  PostgreSQL (winget / docker), migrate, app, тесты с TEST_DATABASE_URL.
- Фронт не тронут; 36/36 и 60 проверок backend зелёные.

### 2026-10-14 — Заход 48, Фаза A: ядро self-hosted backend (Supabase → свой стек)
- **Решение заказчика:** Supabase убирается полностью (санкции); мини-ПК Ubuntu
  (Node+Express+PG+Socket.IO+Nginx), Cloudflare Tunnel+CDN, JWT+bcrypt, SSD.
  Опрос: OAuth убрать (email+пароль+сброс письмом), миграции данных нет,
  регистрация без подтверждения почты, access 12h в localStorage + refresh 30d
  с ротацией пары (jti одноразовый). Спека `PLAN_BACKEND_REWRITE.md`.
- **backend/ (новый каталог, фронт НЕ тронут):** package.json; src/schema.sql —
  порт setup.sql/setup_part2: 22 таблицы + триггеры (bump_like_counts,
  bump_answers_count, answers_delete_cleanup, answers_no_new_on_solved) + порт
  триггера owner-бутстрапа (owner_config, заход 43); без RLS/auth.users.
  migrate.js идемпотентно создаёт БД и схему; db.js (pool, tx, ApiError в
  контракте supabase-js {code,message}); auth.js (bcrypt 12, JWT, requireAuth/
  requireAdmin, ротация refresh); rules.js — ПОРТ ~40 RLS-политик в серверные
  правила + СЕРВЕРНЫЕ маски контактов (заход 18 наконец закрыт по-настоящему:
  чужой email/phone уходят маскированными, полные — только владельцу);
  mailer.js (nodemailer, без SMTP — лог ссылки); storage.js (бакеты на SSD,
  mime-белые списки, приватный бакет через авторизованный эндпойнт); notify.js
  (серверные петли заходов 36/38/47 + подписчики тега); routes: auth, profiles,
  questions+answers+comments+solution (+25 rep транзакцией), social (likes/
  favorites/subscriptions/achievements), messages, misc (notifications/
  donations/reports/ideas/upload); app.js (rate-limit на /api/auth, ошибки в
  контракте {code}, dev-статика при STATIC_DIR).
- **Тесты:** backend/tests/run.mjs — интеграционные на ЖИВОМ PostgreSQL 15
  (поставлен в песочнице через apt; роли/базы sh_dev/sh_test): 60 проверок —
  auth/refresh-ротация/reset, owner-бутстрап, 409 duplicate, белый список
  PATCH (is_admin не повысить), маски контактов для чужого/анонима/владельца,
  контент+триггеры (+25 rep, 409 на решённый), петли answer/like/solution/
  support/report_status/idea_*, ЛС (тред/непрочитанные/реакции), жалобы
  (дубликат/403 не-админу), идеи (403 не-админу), upload (exe отклонён,
  приватный бакет 401/200), прочитанность. Всё зелёное.
- **Фронт-страховка не пострадала:** 36/36 тест-файлов, check ✓ 35 модулей,
  keys ✓ 511, catalog ✓ 112 (фронт в Фазе A не менялся вовсе).
- backend/README.md: запуск dev, env, админ, тесты, контракты, фазы.
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_backend.txt`
  (backend/ аддитивен: откат = удаление папки).

### 2026-10-14 — Заход 47: живые уведомления (спека PLAN_LIVE_NOTIFICATIONS.md, ВЫПОЛНЕН)
- **Диагноз анализа:** типы answer/like — декорация (рендерер и сиды есть,
  генераторов нет); support-семейство и answer/like — кликовые тупики; клик не
  помечал прочитанным (бейдж считал просмотренное).
- **Генераторы:** createAnswer → уведомление автору вопроса (себе за свой —
  нет), payload {by, questionTitle, questionId, answerId}; лайк — автору
  контента только на постановку (снятие и свой лайк — тихо), payload {by,
  targetKey, questionId}; демо + реал best-effort (сбой не рвёт действие).
- **Карта кликов:** question-семейство → /question/:id; «спасибо» → профиль
  донора; отметка перевода автору → своя модалка поддержки (список отметок +
  «Получено ✓» в один клик); done → профиль автора (в payload добавлен
  authorId); idea_* → /ideas; report_status осознанно некликабелен.
- **Гигиена:** клик = прочитано (новый markNotificationRead + синхрон
  unreadCount в store — бейдж честный); кликабельные .notif-item.clickable с
  шевроном «›», некликабельные без него (общий хелпер isNavigable).
- **Сиды/версия:** n1 + questionId/answerId, n2 → targetKey + questionId;
  DEMO_DB_VERSION 16 (сиды менялись → старый снапшот пересоздаёт их);
  попутно исправлена СПЯЩАЯ битая ссылка модерации /u/<id> → /profile/<id>
  (роута /u не существовало).
- **i18n:** +2 data-driven ключа target_answer/target_question (чекер считает
  только литералы → 511; в словаре 826 листьев); каталог 112 без изменений.
- **Тесты:** новый test_notif_clicks.mjs (24 проверки: генераторы, тишина
  снятия/своего лайка, шевроны, клик=прочитано с честным бейджем, вся карта
  кликов включая модалку поддержки, тупик report_status); ассерты v16 в 5
  файлах (включая пропущенный сначала test_ideas). Итог 36/36 тест-файлов,
  check ✓ 35 модулей, смоук не менялся. Единичный флак test_units (временна́я
  граница) — соло 4/4 зелёный, наблюдаем с захода 36.
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_live_notifs.txt`.

### 2026-10-14 — Заход 46: вход/регистрация без сюрпризов — онбординг только при регистрации, демо-аккаунты по почте
- **Жалобы заказчика (анализ без кода, потом опрос):** (1) «при входе открывается
  окно настроек, должно только при регистрации»; (2) «захожу под одной почтой —
  фото осталось моё, а в новой нет».
- **Диагноз 1:** онбординг («окно настроек» из 3 шагов) запускался при КАЖДОМ
  входе кнопкой Google: в auth.mjs обработчик OAuth звал afterSignIn(user,
  true) с константой true. Зеркальный баг в бою: OAuth-возврат подхватывает
  restoreSession, где онбординг не запускался ВООБЩЕ — даже для свежей
  регистрации. Правило стало единым: онбординг = «строка профиля создана
  сейчас»: ensureProfileRow возвращает 'created'/'existing'/false; демо-OAuth и
  signUp дают needsOnboarding=created; боевой onAuthStateChange после
  OAuth-возврата стартует startOnboarding() только при 'created'; email-тракты
  не изменились. Попутно restoreSession чинит и случай «строки профиля нет
  вовсе» (раньше self-heal работал только при full && !username).
- **Диагноз 2:** заказчик в ДЕМО: аккаунтов там не было — любой email/OAuth вели
  в один u-demo, идентичность жила в localStorage браузера → «фото остаётся»
  при любой почте и «исчезает» в новом браузере. Лечение (решение опроса):
  реестр `samplehelp_demo_accounts` «почта → профиль»: signUp/signIn/OAuth
  создают/подхватывают профиль под конкретной почтой (новая почта = чистый
  профиль, avatar_url null); старая сессия u-demo работает без записи в
  реестре (легаси); новые демо-аккаунты — не админы (роль даёт тумблер захода
  43); если демо-БД очищена, а реестр жив — строка профиля восстанавливается
  при входе. Честная граница демо прописана в индикаторе подвала: «аккаунты и
  данные живут в этом браузере».
- **i18n/каталог:** без новых ключей (511/112). DEMO_DB_VERSION 15 не повышен
  (модель данных демо не изменилась: новые профили — пользовательские строки,
  migrateDemo их переносит).
- **Тесты:** новый test_demo_accounts.mjs (18 проверок: чистый профиль при
  регистрации + онбординг, вход без онбординга и без затирания username, другая
  почта = другой чистый профиль, OAuth первый/второй клик, легаси u-demo,
  восстановление строки из реестра после чистки демо-БД). Итог 35/35
  тест-файлов, check ✓ 35 модулей.
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_roles.txt`.

### 2026-10-14 — Микрофикс захода 36/40: `.sort-tabs` больше нигде не прилипает
- Жалоба заказчика: табы «прилипают» к блоку выше. Болезнь та же, что в заходе
  39 (карточка разработчика в /ideas), но системнее: у `.sort-tabs` вообще не
  было верхнего поля — воздух случайно появлялся только там, где сосед сверху
  имел свой margin-bottom (после уборки presence-чипа из шапки ленты и после
  добавления карточки-регламента в модерации табы встали впритык).
- Фикс системный, а не точечный: `.sort-tabs { margin-top: 16px }` — разом для
  ленты, /ideas и /moderation; соседние margin-bottom схлопываются (16 против
  16 у .idea-dev), двойного воздуха нет.
- Регрессия: test_dom + статический CSS-ассерт margin-top у .sort-tabs.
- 34/34 теста, check ✓ 35, keys ✓ 511, catalog ✓ 112.

### 2026-10-14 — Заход 44: бейдж админа на аватарке вместо строки в меню; дубль загрузки фото из шапки профиля убран
- **Команда заказчика:** роль разработчика помечать НЕ строкой в меню
  (.conv-item role-note), а бейджем НАД аватаркой (class avatar / avatar-slot,
  «там где моя фото»); кнопку загрузки фото в шапке профиля (.avatar-edit-btn)
  убрать вообще — функция уже есть в настройках профиля.
- **Бейдж 🛡 `.admin-badge`:** медный кружок 18px с щитом, top/right −6px на
  аватарке (position absolute; .avatar уже position:relative с захода 41):
  в шапке на своей аватарке (#btn-user-menu) и в .avatar-slot страницы
  профиля у админа (profile.is_admin — работает и для чужого админ-профиля).
  title/aria = auth.role_admin; data-help admin_badge (каталог 112: −avatar_btn,
  +admin_badge). Строка role-note из меню удалена вместе со стилями.
- **Шапка профиля:** удалены .avatar-edit-btn (#btn-change-avatar), скрытый
  #avatar-input и весь обработчик смены аватара (включая клик по самой
  аватарке — неочевидный вход); if(editable) сохранён для quick-add ссылки.
  Смена фото — единственная точка: настройки → «Сменить фото» (data-help
  set_avatar, кроппер тот же). Ключи profile.change_avatar и help.items.
  avatar_btn удалены (511 используемых ключей).
- **Тесты:** test_user_menu — ассерты бейджа вместо role-note (админ/обычный/
  возврат); test_dom — статика: .admin-badge в CSS, нет .role-note/
  .avatar-edit-btn в CSS и profile.mjs. 34/34, check ✓ 35, keys ✓ 511,
  catalog ✓ 112. DEMO_DB_VERSION 15 не тронут.

### 2026-10-14 — Заход 43: роли и вход — владелец-админ по OWNER_EMAIL, демо-тумблер ролей, строка роли (спека PLAN_ROLES_LOGIN.md, ВЫПОЛНЕН)
- **Бой, единственный автопуть в админы — почта владельца:** таблица-настройка
  `owner_config(owner_email)` + BEFORE INSERT триггер `profiles_owner_admin`
  (security definer): email нового пользователя (auth.users) совпал с
  owner_email (регистронезависимо) → is_admin := true. Пустая строка = бутстрап
  выключен. В setup.sql и setup_part1.sql идемпотентно; schema.sql — комментарий.
  Клиентских путей в админы по-прежнему нет (column-гранты захода 36).
- **SETUP.md:** раздел «Админ-владелец и обычный пользователь»: вписать
  owner_email до первого входа; команда «применить сейчас» для уже созданного
  профиля (идемпотентный update); чек-лист из 4 пунктов (владелец → строка роли
  и модерация; чужая почта → нет; самоповышение → 42501; демо-тумблер).
- **Демо-тумблер ролей в подвале** (только IS_DEMO, у #demo-indicator):
  `setDemoRole(isAdmin)` в supabase.mjs (сессия + строка DEMO.profiles +
  persistDemo + invalidateProfileCache; бой — no-op); клик → setState + toast +
  handleRoute(): меню, guard /moderation и админ-контролы реагируют сразу;
  data-help demo_role (каталог 112).
- **Строка роли в меню аватара:** «🛡 Вы админ платформы» (.role-note,
  неинтерактивна) над пунктом «Модерация» — «кто я сейчас» больше не угадывается.
- **i18n:** demo.role_* (5) + auth.role_admin → 512 используемых ключей.
  (Ловушка самого захода: замена блока demo.* в ru.json затёрла demo.reseeded —
  восстановлено из дампа и объединено; check_keys поймал сразу.)
- **Тесты:** test_user_menu +секция (строка роли у админа/обычного, пункт
  «Модерация» исчезает, guard /moderation после снятия роли, идемпотентность
  setDemoRole, свежесть ссылок меню после renderAuthArea); test_dom +2 статических
  ассерта (тумблер только под IS_DEMO, .role-note в CSS). 34/34, check ✓ 35,
  keys ✓ 512, catalog ✓ 112. DEMO_DB_VERSION 15 не повышен. SQL-триггер в jsdom
  не проверяется — чек-лист в SETUP.md.
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_roles.txt`.

### 2026-10-14 — Заход 42: онлайн в ЛС и в ленте — ОДИН источник (жалоба «в ленте онлайн, в сообщениях офлайн»)
- **Диагноз по жалобе заказчика:** индикатор «онлайн» в ЛС жил своей жизнью:
  в демо хардкод `online: recipient === 'u-anna'` (онлайн только Анна), в бою
  всегда `online: false` — диалог ВСЕГДА показывал «офлайн», пока лента честно
  рисовала точки из presence. Плюс скрытый баг боевого presence: track слал
  случайный session clientId вместо id профиля → множество онлайна в бою
  вообще не совпадало с id авторов.
- **Лечение:** единый источник — `subscribeOnlineSet` (presence.mjs):
  - messages.mjs: точки `.online-dot` в списке диалогов и в шапке чата теперь
    `data-odot` + класс off/on + title/aria «в сети»/«не в сети» из того же
    множества, что точки ленты; обновляются на тиках без перерисовки;
    подписка одна на экран, cleanup гасит; фейковое поле online из
    fetchConversations удалено (демо и реал);
  - presence.mjs: реал track'ает `uid = user.id` (профиль), guests по-прежнему
    без id; you = совпадение с id профиля;
  - CSS `.online-dot.off`; i18n +common.offline (506 ключей); тернарники
    t(cond ? a : b) разведены на два статических t() (ловушка check_keys).
- **Тесты:** test_presence +секция 6 (нет поля online, точки ЛС = множество,
  точка шапки = собеседник, title, одна подписка, cleanup); 34/34, check ✓ 35,
  keys ✓ 506, catalog ✓ 111, смоук ✓. DEMO_DB_VERSION 15 не тронут.

### 2026-10-14 — Микрофикс захода 40: точку онлайн срезала круглая маска аватарки
- Скриншот заказчика: зелёный кружок на аватарке в ленте виден на четверть —
  обрезан по кругу. Причина: `.avatar { overflow: hidden }` (маска для фото),
  а точка .p-dot — ребёнок якоря с right/bottom −1px → попадала под срез
  border-radius.
- Фикс: `.avatar { overflow: visible }`, скругление фото перенесено на
  `.avatar img { border-radius: 50% }` — маска там, где она нужна, точка
  рисуется поверх аватарки целиком (кольцо border 2px под фон карточки).
- Регрессия: test_dom + 2 статических CSS-ассерта (у .avatar нет
  overflow:hidden; у .avatar img есть border-radius 50%).
- 34/34 теста, check ✓ 35, keys ✓ 503, catalog ✓ 111.

### 2026-10-14 — Заход 40: presence-чип УДАЛЁН, онлайн/офлайн — точки на аватарках ленты
- **Команда заказчика:** «уберём class="presence-chip", отмечать кто онлайн/
  офлайн будем прямо в ленте на class="avatar sm"».
- **presence.mjs переписан:** UI-виджет (createPresenceWidget, стек аватарок,
  панель со списком, question-скоуп «Сейчас смотрят») УДАЛЁН целиком; модуль
  теперь — чистый источник данных: `subscribeOnlineSet(cb)` → Set id онлайн
  (демо — симуляция пула с суточной кривой и ротациями, реал — Realtime
  presence канала presence:global; «вы» всегда в множестве; гости не
  персонализируются). `presenceScopeCount` для тестов сохранён.
- **feed.mjs:** у аватарки автора карточки (`.avatar sm`) — точка
  `<span class="p-dot" data-pdot data-help="presence_dot">`; on/off и
  title/aria («в сети»/«не в сети») ставятся из множества онлайна; подписка
  одна на отрисовку, тики обновляют ТОЛЬКИ точки (DOM карточек не трогается);
  cleanup ленты гасит скоуп. page-head без with-presence/хоста.
- **question.mjs:** ряд «Сейчас смотрят» (.presence-row + хост) и монтаж
  виджета удалены; cleanup без presenceUnsub.
- **CSS:** все .presence-* правила и @keyframes presence-pulse удалены
  (−2.2 КБ); `.avatar { position: relative }` + `.p-dot` (on — зелёная с
  свечением, off — серая; pointer-events none — точка неинтерактивна).
- **i18n:** presence.* сокращён до dot_on/dot_off (−6 осиротевших листов →
  503 используемых ключа); help.items: presence_widget → presence_dot
  (каталог 111, сирот нет); тур первого визита: шаг виджета → шаг точки
  (sel '.p-dot').
- **Тесты:** test_presence переписан (5 секций: noop-флаг, Set API, точки в
  ленте + title/aria + отсутствие чипа, стат-скан feed/question/presence,
  живой тик без перерисовки, cleanup); test_dom — инверсия ассертов
  (presence-ряда/хоста/чипа НЕТ) + порядок иконок не тронут; test_help —
  фикстура шага тура (.p-dot вместо чипа). 34/34 тест-файла, check ✓ 35.
- DEMO_DB_VERSION = 15 не повышен (данные не менялись). SQL не тронут.
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_ideas.txt` (состояние
  ДО заходов 38–40).

### 2026-10-14 — Микрофикс захода 38: воздух между карточкой разработчика и табами
- Жалоба заказчика: на /ideas кнопки `.sort-tab` («Топ/Новые») визуально
  «прилипали» к карточке `.idea-dev card` («Личный вопрос… Написать
  разработчику»). Причина: у `.idea-dev` было только margin-top, а у
  `.sort-tabs` верхнего поля нет вовсе (на других экранах они стоят сразу за
  page-head, у которого свой нижний отступ).
- Фикс: `.idea-dev { margin: 14px 0 16px; }` — 16px воздуха до табов.
- Регрессия: test_dom + статический CSS-ассерт margin карточки (не прилипают).
- Прочее зелёное: test_ideas 35, check ✓ 35 модулей.

### 2026-10-14 — Заход 38: «💡 Идеи продукта» + связь с разработчиком (спека PLAN_IDEAS.md, ВЫПОЛНЕН)
- **Иконка 💡 `#btn-ideas` в шапке ПОСЛЕ колокольчика** (SVG-лампочка,
  data-help ideas_btn, data-i18n-aria/title) → роут `/ideas`; витрина открыта
  ВСЕМ, предлагают и голосуют залогиненные (requireAuth).
- **Новый модуль `ideas.mjs` (35-й):** экран (page-head + блок связи с
  разработчиком + sort-tabs «Топ/Новые» + список карточек), карточка идеи
  (бейдж статуса 4 цветов, тело с переносами, блок «🛠 Ответ разработчика»,
  голос ▲ toggle aria-pressed, удаление своей), модалка «Предложить идею»
  (инлайн-валидации 3–120/10–1000 после клика, как в контактах), админ-контролы
  (контекстные кнопки статусов + поле публичного ответа, data-help idea_admin).
- **Связь с разработчиком двуслойно:** публичный ответ админа в карточке
  (dev_reply/dev_reply_at) + карточка «Личный вопрос, а не идея? 💬 Написать
  разработчику» → ЛС с админом (`fetchDevContact` по is_admin; демо — u-demo).
- **Слой данных (supabase.mjs):** fetchIdeas(sort)/fetchIdeaVotesMine/
  createIdea/toggleIdeaVote/setIdeaStatus/setIdeaReply/deleteIdea/
  fetchDevContact (демо+реал); петля захода 36: смена статуса → idea_status,
  ответ → idea_reply автору (себя не уведомляем, best-effort в реале).
- **SQL:** таблицы ideas (check'и длин 3–120/10–1000, статус-чек) + idea_votes
  (pk idea_id+user_id) и 8 RLS-политик (публичное чтение, вставка/голос/своё
  удаление — authenticated, статусы/ответ/удаление любых — is_admin) в
  setup.sql/setup_part1.sql; schema.sql — комментарий.
- **Демо:** 4 честных сида из реального бэклога (new/in_work/done/rejected с
  ответами) + голоса; DEMO_DB_VERSION 15; migrateDemo carry идей и голосов +
  чистка висяков (урок захода 20 — проверено тестом пересида v14→v15).
- **Уведомления:** TYPE_ICONS 💡/💬 + 5 ключей (4 статуса + ответ), клик →
  /ideas; экранирование title однократное (тест-ловушка double-escape снята
  ручной правкой до прогона).
- **Адаптив:** ≤420px иконки 32px + gap 1px + компактная шапка — 6 иконок
  помещаются в 320px без клипа (test_dom переассерчен).
- **i18n:** +30 ключей ideas.* + 5 уведомлений → 507 используемых; 9-я секция
  /help «Идеи и связь с разработчиком»; каталог справки 111 (+6 data-help).
- **Тесты:** новый test_ideas.mjs (35 проверок, включая пересид и отказ
  удаления чужой идеи); test_dom +порядок иконок; test_help 9 секций; ассерты
  v15 в 5 файлах. Итог: 34/34 тест-файла, check ✓ 35 модулей, смоук ✓
  (/, /js/ideas.mjs, SPA /ideas, ru.json с новыми ключами).
- Откат: `rollbacks/filelist_baseline_2026-10-14_before_ideas.txt`.
- Бэклог спеки §6: комментарии сообщества, теги, дедуп дубликатов, роадмап-
  страница, жалобы на идеи, редактирование своей идеи, бейдж на 💡.

### 2026-10-14 — Единая папка: всё нужное внутри samplehelp (команда заказчика)
- **Команда:** «все нужные файлы кроме папки uploads — в одной папке samplehelp,
  чтобы при скачивании всё было в одном месте». Корень workspace теперь =
  только `samplehelp/` + `uploads/` (входящие заказчика, не трогаем).
- **Переехали внутрь проекта:** `filelist_with_content.txt` (свежий дамп;
  `npm run filelist` теперь пишет ВНУТРЬ проекта — дефолт OUT в make-filelist.cjs
  изменён), `rollbacks/filelist_baseline_2026-10-14_before_mod_guide.txt`
  (откатная точка захода 36), `PROJECT_ANALYSIS.md` (память ассистента — теперь
  путешествует с проектом и попадает в дамп: следующая сессия восстановит и её),
  `support-channels-preview.html` (превью захода 32–34). Скретч-зонды
  `/home/user/scratch/` удалены за ненадобностью.
- **Защита от саморекурсии дампа:** make-filelist.cjs исключает из обхода
  `filelist_with_content.txt` по имени (иначе при OUT=tmp в roundtrip-тесте
  дамп носил бы сам себя — квадратичный рост) и `filelist_baseline_*.txt`
  (иначе удвоение размера: baseline сам является полным дампом). В
  test_filelist_roundtrip те же исключения зеркально добавлены в сравнение
  живого дерева (112 файлов сравнения вместо 114).
- **Проверки:** roundtrip 112/112 побайтово, 33/33 теста, check ✓ 34,
  keys ✓ 477, catalog ✓ 105. Дамп: 113 файлов, 2.76 MB, себя и rollbacks не
  включает, память и превью — включает.
- Регламент обновлён: дамп и откатные снимки живут внутри проекта; скачать
  одну папку samplehelp = забрать всё (код, тесты, дампы, память, превью).

### 2026-10-14 — Заход 36: памятки модерации + петля обратной связи + защита флага админа (спека PLAN_MODERATION_GUIDE.md, ВЫПОЛНЕН)
- **/help:** секция «Жалобы и модерация» ПЕРЕПИСАНА: где ⚑ и что жалоба только
  на чужое; причины с примерами (включая «верните ошибочный перевод» /
  «подтвердите код» — перекрёстно с антимошеннической памяткой); антидубль;
  решения модератора; петля обратной связи; границы полномочий. Убрана
  чужеродная фраза про 7-дневный архив (тема lifecycle).
- **/moderation:** блок `.mod-guide` над списком (только админу — внутри guard):
  матрица 4 строк «причина → действие», правила «не удаляем за вкус» и «закрой
  дубли по цели», ссылка «📖 Подробнее» на /help с `data-help="moderation_guide"`
  (каталог 105). CSS `.mod-guide*`.
- **Петля обратной связи:** `setReportStatus` при dismissed/actioned шлёт
  РЕПОРТЁРУ строки уведомление `report_status` payload {status, target_type}
  (демо — unshift+persist, реал — best-effort insert, сбой не рвёт решение);
  notifications.mjs: иконка 🛡️ + 3 ключа-факта (actioned / actioned_profile
  «меры организационного характера» / dismissed), без причин и цитат; клик не
  навигирует. Модератор своих уведомлений не получает.
- **Защита флага (дыра из §0 спеки):** `revoke update on profiles from
  authenticated` + `grant update (username, avatar_url, bio, links, cover_style,
  open_to_collab, donate_methods, contact, contact_consent)` в setup.sql и
  setup_part1.sql (идемпотентно) — самоповышение is_admin отклоняется БД (42501);
  триггеры-счётчики не затронуты. schema.sql — исторический комментарий;
  SETUP.md — раздел «Админ (модератор): назначение, снятие, проверка защиты»
  (SQL назначения/снятия, критерии кандидата, что умеет/не умеет, чек 42501).
- **i18n:** +11 листьев → 477 используемых; каталог 105 (+moderation_guide).
- **Тесты:** test_moderation +секция 8 (13 проверок: чек-лист/ссылка/data-help,
  уведомления репортёрам dismissed/actioned, модератор не получает, profile-
  payload, не-админ без чек-листа); test_help +3 ассерта текста секции.
  33/33; в одном прогоне единичный флак test_units (временна́я граница
  округления лайфсайкла) — соло и повторы зелёные, наблюдаем.
- DEMO_DB_VERSION = 14 (не повышен: схема БД и сиды не менялись).
- Откат: `../filelist_baseline_2026-10-14_before_mod_guide.txt`.
- Бэклог (§6 спеки): группировка дублей жалоб по цели; команда модераторов
  (RPC grant/revoke + аудит, колонка resolved_by); «мои жалобы»; DMCA (Этап 3).

### 2026-10-14 — server.js: человечная диагностика EADDRINUSE (вместо стектрейса)
- Вопрос заказчика после победы над переключателем: `npm start` упал с
  `Error: listen EADDRINUSE :::3000` + «Debugger attached». Разбор: порт занят
  ПРЕЖНИМ процессом сервера (не остановлен Ctrl+C / зависшая debug-сессия VS
  Code); новый экземпляр не поднялся, сайт продолжил отдавать старый процесс —
  и именно поэтому правки видны даже без «перезпуска»: express.static читает
  файлы с диска на каждый запрос (no-store с захода 17).
- `server.js`: обработчик `server.on('error')` — при EADDRINUSE печатает по-
  русски три способа освободить порт (Ctrl+C в старом терминале / Диспетчер
  задач → node.exe / PowerShell-команда Get-NetTCPConnection+Stop-Process) и
  пояснение, что уже запущенный сервер продолжит работать; exit 1. Проверено
  вживую: второй экземпляр печатает подсказку, первый отдаёт 200.
- Тесты не задеты (server.js вне графа public/js); check ✓ 34, 33/33.

### 2026-10-14 — НАСТОЯЩИЙ корень «автор не настроил способы»: migrateDemo переносил способы сидов-авторов из старого снапшота (v14)
- **Скриншоты заказчика (14:00):** копия свежая (консоль: `DEMO_DB_VERSION = 13`
  отдаётся сервером), папка K:\samplehelp обновлена целиком, `localStorage.clear()`
  выполнен — а модалка AnnaSynth всё равно «Автор ещё не настроил способы».
  Значит, дело НЕ в файлах и не в кэше страницы.
- **Корень найден в `migrateDemo`:** для СИДОВЫХ профилей миграция копировала
  `donate_methods` из снапшота поверх свежих сидов (`DEMO_MIGRATE_PROFILE_FIELDS`
  включает donate_methods) и затем нормализовала. Снапшот эпохи sbp/card
  (v9–v10) → после фильтра видов v11+ у Анны остаётся `[]` → снапшот
  перезаписывается уже с `[]` → следующий пересид (v12, v13) переносит эту
  пустоту дальше. «Залипшая пустота» переживала любые версии и любые новые
  файлы — ровно симптом заказчика. Тесты были зелёные: они мигрировали
  снапшоты ТЕХ ЖЕ эпох, где сиды совпадали.
- **Фикс (v14):** сиды-авторы (u-anna/u-max/u-lena) берут способы ТОЛЬКО из
  свежих сидов; перенос `donate_methods` из снапшота сохранён лишь для
  «своего» профиля демо-сессии (id из `samplehelp_demo_session`) — это настройка
  пользователя, она переживает пересид. Попутно TDZ-ловушка: `DEMO_SESSION_KEY`
  объявлен после `loadDemo()` (вызов при вычислении модуля) — константа
  перенесена выше миграции, дубль удалён.
- **Тест:** test_demo_migration +секция 7: «залипший» снапшот v10 (у Анны
  sbp/card, у своего — boosty) → после миграции u-anna = qr+boosty, u-max = qr,
  свой = boosty (перенесён). Ассерты версии 13→14 в 5 тестах.
- Итог: 33/33, check ✓ 34, keys ✓ 466, catalog ✓ 104. DEMO_DB_VERSION = 14.
- Заказчику: применить новый дамп на месте, рестарт сервера, Ctrl+F5 —
  миграция v14 вылечит снапшот САМА, localStorage.clear() больше не обязателен.

### 2026-10-14 — DEMO_DB_VERSION 13: гарантийное освежение сидов в браузере заказчика (после скриншота «автор не настроил способы»)
- **Скриншот заказчика:** модалка «Поддержать автора · AnnaSynth» показывает
  «Автор ещё не настроил способы получения» — способов НЕТ вовсе. В корректной
  сборке v12+ с чистым localStorage у AnnaSynth сиды QR+Boosty → такой экран
  невозможен. Диагноз: копия заказчика «смешанная»/устаревшая (старый
  `supabase.mjs` с сидами sbp/card эпохи v9–v10 + новый `support.mjs`, который
  фильтрует эти виды → methods=[]) ИЛИ старый снапшот localStorage той же
  версии с протухшими сидами; плюс к этому сегодняший дамп ещё не применён
  (на скрине нет и шапки одного канала из захода 32).
- **Лечение:** `DEMO_DB_VERSION = 13` — любой старый снапшот (любой версии)
  проходит migrateDemo: сиды пересоздаются свежими (u-anna: QR+Boosty),
  пользовательский контент переносится по правилам захода (20). Ручная чистка
  localStorage больше не обязательна (но рекомендуется для верности).
- Тесты: ассерты версии 12→13 в test_donations/test_contacts/test_moderation/
  test_demo_persistence (5 мест). Итог: 33/33, check ✓ 34, keys ✓ 466,
  catalog ✓ 104.
- Заказчику: инструкция применения дампа НА МЕСТЕ (`node scripts/restore-filelist.cjs
  <дамп> .` из папки с server.js), рестарт сервера, Ctrl+F5 (+ localStorage.clear()
  по желанию), самопроверка копии консолью: `fetch('/js/supabase.mjs').then(r=>r.text())
  .then(t=>console.log(t.match(/DEMO_DB_VERSION = \d+/)[0]))` → должно быть 13.

### 2026-10-14 — Модалка «Поддержать автора»: видимость каналов перевода (фикс «не вижу переключатель QR/Boosty»)
- **Жалоба заказчика (повтор команды захода (30)):** «добавить в модалку выбор
  через что перевести — Boosty или QR». Разбор показал: выбор УЖЕ реализован
  (заход 30: `.sup-channels` tablist «📱 QR / 🟠 Boosty», блоки `.sup-chan`
  переключаются скрытием; Boosty-блок — ссылка `_blank noopener` + честная
  подсказка, что платёж проводит Boosty). Опрос заказчика: смотрел на ☕
  ЧУЖОГО профиля, копия свежая → попал в автора с ОДНИМ каналом, где
  переключатель скрыт по проекту (выбирать нечего) и ничем не заменён —
  отсюда ощущение «фичи нет».
- **Лечение — прозрачность состояния канала (аддитивно):**
  - `support.mjs`: один способ → шапка `.sup-chan-cap` «Способ перевода —
    {kind}» (t с параметром, kind собирается из KIND_ICONS + `support.kind_*`);
    два способа — переключатель как прежде, шапки нет;
    своя модалка (isOwner) при способах < 2 → блок `.sup-owner-cfg` с подсказкой
    (`support.owner_chan_hint` при одном, `support.owner_chan_none` при нуля;
    тернарный выбор ключа РАЗВЕДЁН на два статических t() — ловушка check_keys
    из захода 23). Новых интерактивных элементов НЕТ → каталог справки не тронут
    (кнопку «Настроить» осознанно не добавляли: `openEditProfileModal` не
    экспортирован и требует container — тянул бы цикл support→profile).
  - CSS: `.sup-chan-cap`, `.sup-owner-cfg .sup-hint`.
  - i18n: +3 ключа → **466 используемых**; обновлён протухший desc
    `help.items.sup_methods` (там остались «номер телефона СБП / карта» эпохи v9).
  - Комментарии support.mjs: пункт про видимость каналов.
- **Тесты:** test_donations +секция 9 (7 проверок: один канал — шапка есть и
  переключателя нет; донор не видит подсказку автора; два канала — переключатель
  без шапки; автор 1/2 канала — подсказка есть/нет; способы передаются явными
  массивами, т.к. сегменты настроек выше мутируют сиды). Итог: check ✓ 34,
  keys ✓ 466, catalog ✓ 104, **33/33 теста**, смоук не менялся.
- **Превью для заказчика:** `../support-channels-preview.html` — три снапшота
  модалки, отрисованные реальным support.mjs (jsdom, сиды v12) и одетые в боевой
  style.css; переключатель в первом снапшоте живой (inline-скрипт делегирования).
- **Где переключатель в демо:** профиль @AnnaSynth → ☕ (или чип «☕ Поблагодарить»
  на её ответе): у неё QR + Boosty. У @MaxWavetable (QR) и @LenaFX (Boosty) —
  теперь шапка с названием канала вместо тишины.
- DEMO_DB_VERSION = 12 (не повышен: правка чисто UI). SQL не тронут.

### 2026-10-14 — Восстановление рабочей области из дампа (сессия 31, без изменений кода)
- Новая песочница пуста: от заказчика пришли `uploads/filelist_with_content.txt`
  (снимок 14.10 09:19:56 — состояние после захода (30) «Boosty вторым каналом»)
  и `uploads/PROJECT_ANALYSIS.md` (память ассистента). Восстановление выполнено
  ШТАТНЫМ скриптом проекта: `node scripts/restore-filelist.cjs <дамп>
  /home/user/samplehelp` → 109 текстовых файлов; пропущен единственный
  бинарник дампа `public/assets/og-cover.png`.
- `og-cover.png` пересоздан по рецепту записи от 2026-10-11 (5): PIL,
  1200×630, тёмный фон `#0d0d0f`, медная вейвформа (`#b87333→#cd7f32→#ff8c00`),
  текст «SampleHelp / как сделать такой звук?», PT Sans (OFL) из google/fonts
  (`PT_Sans-Web-Bold/Regular.ttf`). 21.5 KB против 84.3 KB оригинала —
  побайтовость не требуется (тесту нужны PNG-сигнатура и IHDR 1200×630).
- Зависимости: `npm install && npm install jsdom --no-save` (node_modules не
  переживают смену сессии — регламент прежний).
- Проверки после восстановления — всё зелёное: `npm run check` ✓ 34 модуля;
  `check_keys` ✓ 463 ключа; `check_help_catalog` ✓ 104 пункта; все 33 теста
  `tmp_tests/test_*.mjs` ✓ без единого провала; смоук сервера ✓ (`/`, `/css/style.css`,
  `/js/qrscan.mjs`, `/js/supabase.mjs` (DEMO_DB_VERSION = 12), `/vendor/jsQR.js`,
  `/locales/ru.json`, `/assets/og-cover.png`, `/robots.txt`, `/sitemap.xml`,
  SPA-fallback `/u/u-anna` и `/moderation`; no-store для css/js/mjs/html).
- Контроль побайтовости: повторный `npm run filelist` → нормализованный diff с
  дампом заказчика отличается ТОЛЬКО размером og-cover.png (бинарник) и UUID
  пути песочницы — содержимое текстовых файлов совпадает полностью.
- По регламенту `~/filelist_with_content.txt` освежён (`npm run filelist`).
- `PROJECT_ANALYSIS.md` скопирован из uploads в корень рабочей области
  (память ассистента, вне дампа проекта).
- Функциональных правок НЕТ: DEMO_DB_VERSION = 12, i18n 463 ключа, каталог 104 —
  как в заходе (30). Откат не нужен (восстановление аддитивно).

### 2026-10-13 — Boosty вторым каналом приёма: переключатель каналов в модалке, слот ссылки в настройках (v12)
- **Команда заказчика:** «добавить Boosty к оплате; в модалке — выбор, через
  что перевести: Boosty или QR; реализовать по-умному». Boosty — не реквизиты:
  это ссылка на страницу автора, платёж проводит сама платформа (карта/СБП
  внутри их контура) → модель A (деньги мимо SampleHelp) не нарушается.
- **donate.mjs:** `DONATE_KINDS = ['qr', 'boosty']`, `MAX_METHODS = 2` (по
  одному на вид — дубли невозможны по построению слотов); новая
  `canonicalBoostyUrl(value)`: «@имя»/«имя»/«boosty.to/имя»/с http(s)/с www →
  `https://boosty.to/имя`; чужие домены и мусор → null; `normalizeDonateMethods`
  держит по одной записи вида и канонизует boosty-ссылку; `validateDonateMethod`
  → `payment.invalid_boosty` (пустое значение — не ошибка: способ выключен).
- **support.mjs (модалка):** если способов два — сверху переключатель
  `.sup-channels` (role=tablist, `data-help="support_channel"`): кнопки
  «📱 QR-код СБП» / «🟠 Boosty», по умолчанию первый; блоки каналов
  `.sup-chan` переключаются скрытием (разбор QR и ссылки живут каждый в своём).
  Boosty-блок: кнопка-ссылка «🟠 Перевести через Boosty» (target=_blank,
  rel=noopener, `data-help="boosty_open"`), честная подсказка «оплату проводит
  Boosty, SampleHelp платёж не проводит и не видит сумму», URL моноширинным.
  Один способ — переключатель не показывается (u-lena с только Boosty).
- **profile.mjs (настройки → «Поддержка»):** второй фикс-слот Boosty: пусто —
  input с плейсхолдером `https://boosty.to/ваше-имя`; change → канонизация:
  валидно — сохранено (слот включён, ссылка «↗ Открыть страницу»), криво —
  инлайн-ошибка `payment.invalid_boosty` и НЕ сохранено, пусто — способ
  выключен. Автосохранение то же (change → saveNow).
- **Сиды v12:** u-anna — QR + Boosty (демо переключателя), u-max — только QR,
  u-lena — только Boosty (демо одноканальной модалки). `DEMO_DB_VERSION = 12`:
  старые снапшоты теряют sbp/card (нормализация), boosty-ссылки из древних
  снапшотов всплыть не могут (строгая валидация домена).
- **Локали:** +7 ключей (`support.kind_boosty`/`boosty_open`/`boosty_hint`/
  `boosty_page`/`choose_channel`/`boosty_ph`, `payment.invalid_boosty`),
  +2 пункта справки (`support_channel`, `boosty_open`) → **463 / 104**.
  CSS: `.sup-channels`/`.chan-btn`(.active)/`.sup-boosty`/`.boosty-btn`/
  `.sup-boosty-url`/`.set-slot-open`/`.set-slot.invalid .boosty-value`.
- **Тесты:** `test_donations.mjs` +секции (canonical/normalize boosty,
  переключатель каналов u-anna, одноканальная u-lena, boosty-слот:
  валидно/криво/пусто) — 54 проверки; версии v12 в трёх тестах. Итог:
  **33/33 (1317 проверок)**, check ✓ 34, keys ✓ 463, catalog ✓ 104, смоук ✓.
  Откат: `../filelist_baseline_2026-10-13_before_donation_marks.txt`.


### 2026-10-13 — QR-заход: способ приёма — только QR-код СБП (номер и карта удалены), безопасное чтение QR до переходов
- **Команда заказчика:** «вместо номера телефона — загружать QR, карту убрать;
  чтобы можно было прочитать QR — сделаем примерно как [пример сканера с
  фишинг-разбором]». Пример портирован по конвенциям проекта: jsQR лежит
  ЛОКАЛЬНО в `public/vendor/jsQR.js` (не CDN — работает офлайн и в тестах),
  никаких inline-onclick/alert() — только addEventListener, тосты и полное
  экранирование декодированных значений.
- **donate.mjs:** `DONATE_KINDS = ['qr']`, `MAX_METHODS = 1`, запись
  `{kind:'qr', value (payload), qr_data_url (dataURL картинки), label}`;
  `normalizeDonateMethods` выбрасывает sbp/card/крипту/QR без картинки;
  `validateDonateMethod` → `payment.invalid_qr`; `detectDonateKind` удалён.
- **qrscan.mjs (34-й модуль):** `ensureJsQR` (тег из vendor, один раз),
  `decodeDataUrl` (canvas+getImageData+jsQR; тест-хук
  `window.__QR_FAKE_DECODE__`), `downscaleDataUrl` (≤600px, ~380 КБ — квота
  localStorage), `readAsDataUrl`, `startCameraScan` (getUserMedia + цикл
  scan; камера проверяется ДО jsQR — иначе промис виснет без mediaDevices),
  `detectQrType`/`analyzeQrPayload` (фишинг-разбор: опасные схемы, http,
  homograph кириллица+латиница, punycode, IP, подозрительные TLD,
  сокращатели, typosquatting Левенштейном ≤2 по брендам включая банки,
  поддомены-обманки sberbank.ru.evil.com, Wi-Fi hidden/weak, инфо-алерт
  НСПК «проверьте получателя»), `renderQrAnalysis` (бейдж типа, алерты,
  поля с подсветкой домена, «Скопировать содержимое», «Открыть ссылку»
  ТОЛЬКО без danger-находок, сырые данные в details).
- **support.mjs:** способ рендерится QR-блоком: картинка 176px на белом
  фоне, подпись (банк), подсказка «сканируйте телефоном», кнопка
  «🔍 Прочитать QR» → панель разбора внутри модалки (повторный клик
  сворачивает). Кнопок «Скопировать номер» нет — номера больше нет.
- **profile.mjs (настройки):** слот QR: заполнен — превью + подпись +
  «Прочитать/Заменить/Удалить»; пустой — дропзона (drag&drop + файл +
  📹 камера). Загрузка: FileReader → даунскейл → decode → **разбор ДО
  сохранения** (автор видит, что публикует) → строка «Подпись + Сохранить».
  `currentPatch` чинит баг эпохи sbp/card: в map добавлен `qr_data_url`
  (без него сохранённый способ отфильтровывался при чтении — тест поймал).
  Камера гасится при закрытии модалки (обёртка close).
- **Сиды v11:** u-anna и u-max — НАСТОЯЩИЕ сканируемые QR (сгенерированы
  офлайн библиотекой qrcode, payload `https://qr.nspk.ru/…`), u-lena — пусто
  (демо пустого слота). `DEMO_DB_VERSION = 11`: старые снапшоты теряют
  sbp/card-способы (нормализация), пользовательский контент переносится.
- **Локали:** +46 ключей (support.qr_* 12, payment.invalid_qr, блок qr.* 33),
  −6 осиротевших; +3 пункта справки (qr_upload/qr_read/qr_analysis) →
  **456 ключей / 102 пункта**. CSS: .qr-img/.qr-drop/.qr-edit-row/
  .qr-save-row/.qr-analysis + qa-* (бейджи типов, алерты 4 уровней, поля).
- **Тесты:** `test_donations.mjs` переписан (36 проверок: сиды v11, правила
  normalize/validate, модалка донора + чтение чистого и фишингового
  `http://sberbanl.ru/pay` (danger → переход заблокирован), спасибо, чип ☕,
  проект, флаг off, настройки: удалить→дропзона→загрузить→разбор→сохранить,
  нечитаемый файл, камера без mediaDevices); версии v11 в трёх тестах;
  `test_presence` — u-lena в пуле; roundtrip — хвостовой перенос в jsQR.js.
  Итог: **33/33 (1297 проверок)**, check ✓ 34, keys ✓ 456, catalog ✓ 102,
  смоук ✓ (`/vendor/jsQR.js` отдаётся). Откат:
  `../filelist_baseline_2026-10-13_before_donation_marks.txt` (до QR-захода).
- ⚠️ **ВАЖНО для синхронизации:** заказчик видит изменения ТОЛЬКО после
  применения свежего дампа `filelist_with_content.txt` (restore-filelist.cjs)
  + Ctrl+F5; дампы прошлых заходов уже не актуальны.


### 2026-10-13 — Контекст переводов: сообщение к переводу, отметка «Я перевёл», «Получено ✓» у автора, антимошенническая памятка (решения опросом)
- **Боль:** перевод приходил автору «голым» (СБП показывает имя отправителя без
  сообщения) — автор не связывал поступление с человеком и сайтом, рисковал
  испугаться схемы «ошибочный перевод»; донор в банке терял контекст. Код
  сверки в комментарии ОТКЛОНЁН заказчиком («не все оплачивают с компа») —
  вместо него человекочитаемое сообщение + отметка на платформе.
- **Сообщение к переводу (донор):** в модалке «Поддержать автора» блок с
  готовым текстом `SampleHelp · поддержка @автор` (`support.comment_tpl`) и
  кнопкой «Скопировать сообщение» (`data-help="support_copy_comment"`) +
  подсказка «добавьте его к переводу в приложении банка».
- **Отметка «Я перевёл»:** сумма (целая >0, ≤1 000 000) + необязательное
  сообщение → `markDonationTransfer()` (supabase.mjs): строка `donations`
  (kind='paid', status='intent') + уведомление автору type 'support' с
  payload {by, donorId, amount, message, donationId} → текст «отметил(а)
  перевод N ₽ — сверьте с поступлением в банке». Модель A не тронута:
  платформа деньги не проводит, отметка — о ВНЕШНЕМ переводе.
- **«Получено ✓» у автора — в двух точках:** кнопка прямо в уведомлении
  колокольчика (`.notif-confirm`, гаснет через `payload.confirmed`) и список
  «Отметки о переводах» в своей модалке поддержки (`fetchDonationsFor`:
  сумма, @донор, сообщение, время, статус). `confirmDonation()`: статус
  'done' + уведомление донору «получил(а) ваш перевод — спасибо за
  поддержку!» (payload.done).
- **Антимошенническая памятка:** строка 🛡️ в модалке донора
  (`data-help="support_antifraud"`) + абзац в секции donate страницы /help:
  перевод с сообщением «SampleHelp…» — донат с платформы; просьбы «вернуть
  ошибочный перевод» / перевести куда-то ещё / «подтвердить код» — мошенники.
- **Модули:** support.mjs 133→206 (viewer/isOwner: донор видит комментарий +
  отметку + памятку, автор — список отметок; обработчики копирования/отметки/
  подтверждения), notifications.mjs 225→250 (три ветки текста support:
  отметка/получено/спасибо + кнопка в панели), supabase.mjs →2664
  (+`markDonationTransfer`/`confirmDonation`/`fetchDonationsFor` с именем
  донора), CSS: `.sup-comment-row/.sup-mark-row/.sup-antifraud/
  .sup-mark-item/.notif-confirm`.
- **Локали:** +17 ключей, +4 пункта справки → **442 / 99**;
  `helpPage.sections.donate` дополнен памяткой. `DEMO_DB_VERSION` не тронут
  (donations уже в сидах и persist-ключе).
- **Тест:** новый `test_donation_marks.mjs` (26 проверок): модалки донора и
  автора, невалидная сумма не создаёт строку, запись + уведомление с суммой,
  подтверждение из списка и из панели колокольчика, `payload.confirmed`,
  статус done, тексты уведомлений. Итог: **33/33 (1331 проверка)**, check ✓ 33,
  keys ✓ 442, catalog ✓ 99, смоук ✓, CJK-скан чист. Откат:
  `../filelist_baseline_2026-10-13_before_donation_marks.txt`.


### 2026-10-13 — Настройки: блоки «Контакты» и «Поддержка» по варианту «Г» (выбор заказчика по превью `settings-blocks-variants.html`)
- **Поддержка — два фикс-слота** (`renderDonateList` переписан): 📱 СБП и
  💳 Карта всегда на экране, без селекта, кнопок «добавить/удалить» и
  лимит-хинтов: заполнил значение = способ включён (шапка: иконка, название,
  статус «✓ указан»), пусто = выключен (пунктирный слот, «не указан»);
  уникальность видов врождённая. Валидация прежняя (`validateDonateMethod`,
  инлайн `.row-error` под слотом), автосохранение прежнее (input 400 мс,
  change сразу); `drawDonateErrors` ищет способ по `data-kind`, а не по
  индексу. Очистка значения = выключение способа (change → splice).
- **Контакты — карточки + меню видов:** `＋ Добавить контакт` открывает
  `.kind-menu` (7 эмодзи-кнопок; занятые виды disabled — дубли запрещены
  валидацией; лимит 6 — кнопка добавления disabled + хинт), выбор вида →
  карточка `.set-slot.contact-row` с фиксированным видом (иконка + название в
  шапке, 🗑, значение, подпись); сменить вид = удалить и добавить;
  автоопределение вида из настроек ушло (вид выбирается явно;
  `detectContactKind` остался в онбординге). Меню закрывается после выбора и
  при перерисовке списка.
- **profile.mjs (1276):** −`donateAddBtn`/`donateHint` и их слушатели,
  −автоопределение в change контактов; +`kindMenuHost`/`openKindMenu`/
  `closeKindMenu`; импорты: +`KIND_ICONS` (теперь экспорт support.mjs),
  +`CONTACT_KINDS`/`CONTACT_ICONS`, −`detectDonateKind`/`MAX_METHODS`/
  `detectContactKind`. **contacts.mjs (417):** `contactEditorRowHtml` —
  карточка вместо четырёхколонной строки.
- **CSS:** `.set-slots`/`.set-slot`(.empty — пунктир)/`.set-slot-head`
  (иконка/название/статус)/`.set-slot-grid` (1fr 1fr, ≤420px — одна колонка)/
  `.kind-menu` (+`.k`, disabled); прежние `.donate-row`-grid и `.donate-list`
  удалены.
- **Локали:** +5 `settings.*` (`kind_menu_cap` «Что добавить?», `slot_on`
  «✓ указан», `slot_off`, `slot_sbp_ph`, `slot_card_ph`), −4 осиротевших
  (`profile.donate_add`, `profile.donate_value_ph`,
  `contact.autodetect_hint`, `payment.limit`) → **425 ключей / 724 листа**,
  каталог 95 (data-help контейнеров `set_contact`/`set_payment` сохранены).
- **Тесты:** переписаны секции редакторов — `test_settings_autosave` 7/7b
  (меню видов, занятые виды disabled, фикс-вид карточки 📞 без селекта,
  валидация телефона), `test_contacts` (добавление до лимита через меню
  [phone/discord/website/vk], disabled на лимите, тост, удаление 🗑, профиль
  не засорен), `test_donations` 8 (два слота всегда, filled/empty, статусы,
  нет селекта/кнопок, кривая карта → инлайн-ошибка и не сохранена, валидная →
  сохранилась, очистка значения → способ выключен); 3b — CSS-ассерты
  `.set-slot-grid`/`.kind-menu`. Итог: **32/32 (1305 проверок)**, check ✓ 33,
  keys ✓ 425, catalog ✓ 95, смоук ✓. `DEMO_DB_VERSION` не тронут (модель
  данных не менялась — только отображение). Откат:
  `../filelist_baseline_2026-10-13_before_settings_cleanup.txt`.


### 2026-10-13 — Убрана опция «Не показывать, что я онлайн» + превью вариантов блоков «Контакты»/«Поддержка» (ждём выбора)
- **Команда заказчика:** «непоказывать что я онлайн уберём»; блоки контактов и
  поддержки в настройках не нравятся — сначала превью видов на выбор.
- **hide_online удалён ЦЕЛИКОМ** (не только тумблер): настройка (поле,
  `hideOnlineInput`, `currentPatch`), логика presence (`selfEntry`, track в
  realtime-подписке, фильтр демо-пула `getDemoPresencePool`), сид
  `u-lena.hide_online`, SQL — `add column` заменён на идемпотентный
  `drop column if exists hide_online` (долетит до развёрнутых баз, прецедент
  `payment_markers`), ключи `profile.hide_online` и `help.items.set_hide_online`
  (427 ключей / 723 листа / каталог 95). Онлайн теперь виден всем
  залогиненным; гости — по-прежнему счётчиком. `DEMO_DB_VERSION` не повышался:
  старый снапшет с флагом просто игнорируется кодом.
- **Тесты:** `test_presence` — секция 1 и 4 переписаны на уровень пула
  (`getDemoPresencePool`: u-lena в пуле; «вы» в списке даже со старым флагом в
  снапшоте) — видимый список зависит от суточной кривой, поэтому ассерты по
  пулу, а не по срезу; `test_settings_autosave` 3b — тумблера нет.
  Итог: **32/32 (1300 проверок)**, check ✓ 33, keys ✓ 427, catalog ✓ 95, смоук ✓.
- **Превью для выбора:** `"$ARENA_WORKSPACE"/settings-blocks-variants.html` — моки в
  токенах темы и ширине модалки 460px: **A** как сейчас (строки в столбец),
  **Б** одна строка на запись (узкий селект с эмодзи), **В** чипы + inline-
  редактор по месту, **Г** фикс-слоты для поддержки (без селекта/лимитов) +
  меню видов для контактов. Данные/валидация/автосохранение во всех вариантах
  прежние. **В РАБОТЕ:** редизайн блоков по выбранному варианту.


### 2026-10-13 — Наведение порядка в «Настройках профиля» (решения опросом: секции + липкий подвал, полный пакет, превью ссылок и аватар — да)
- **Аудит до правок:** 10 разнородных блоков в один скролл без заголовков;
  приватность размазана (коллабы → онлайн → согласие внутри контактов); подвал
  с «Готово» и статусом автосохранения уезжал за скролл; сетка строки
  редакторов `150px|1fr|110px|30px` в модалке 460px резала колонку «Подпись»
  (скриншот заказчика); подсказки-простыни; ссылки невидимы (только «＋»);
  аватар менялся только со страницы профиля; `openEditProfileModal` — ~540
  строк одной функцией.
- **Секции (П1):** `setSection(id, icon, titleKey, inner)` — пять секций с
  заголовками-иконками и разделителями: `profile` (аватар, имя, био, обложка) →
  `gear` (ссылки + превью, DAW, арсенал) → `privacy` (три тумблера + оба
  предупреждения + сводная строка `settings.privacy_hint`) → `contacts`
  (редактор) → `support` (способы). Один скролл (вариант заказчика): ничего не
  спрятано, автосохранение не осложнено переключением вкладок.
- **Липкий подвал (П1):** `.settings-footer` — `position: sticky; bottom: 0`
  внутри скролла `.modal` + негативные боковые поля под padding модалки:
  статус «Сохранено ✓» и «Готово» видны на любой глубине.
- **Редакторы (П2):** `.donate-row` (общая для контактов и способов) —
  `grid-template-areas: "kind del" "value value" "label label"`: вид + корзина
  сверху, значение и подпись полными строками — обрезки нет ни на 460px, ни
  уже; `.row-error` по-прежнему во всю ширину.
- **Превью и аватар (решение «да, оба»):** `#ed-links-preview` — чипы
  установленных ссылок (`platformIcon` + `linkDisplayName`, пусто-состояние
  `settings.links_empty`), обновляется после «Готово» вложенного редактора
  (`drawLinksPreview` в колбэке `openAddLinkModal`); строка аватара
  `settingsAvatarRowHtml`: превью `.avatar.md` + «📷 Сменить фото»
  (`data-help="set_avatar"`) + скрытый file-input — тот же поток
  `openAvatarCropper → uploadAvatar → updateProfile`, превью в модалке
  обновляется на месте, экран профиля перерисует существующий наблюдатель
  при закрытии.
- **Тексты (П3):** ужаты до строки `profile.cover_hint`, `profile.collab_hint`,
  `contact.settings_hint`, `profile.donate_hint` (подробности — в каталоге
  справки, help-режим их показывает); предупреждения приватности собраны в
  секции `privacy`; осиротевший `payment.settings_title` удалён из ru.
- **Код (П4):** шаблон модалки вынесен из `openEditProfileModal` в хелперы
  `setSection`/`settingsAvatarRowHtml`/`settingsLinksPreviewInner` (profile.mjs
  1230 → 1289: шаблон стал декларативным, биндинги автосохранения и редакторов
  не тронуты — все `#ed-*` id сохранены, старые тесты не переписывались).
- **Локали:** +8 ключей `settings.*` (5 секций, `avatar_change`,
  `links_empty`, `privacy_hint`), +`help.items.set_avatar` → **428
  используемых / 726 листов, каталог 96**; 4 подсказки переписаны короче,
  −1 осиротевший.
- **Тесты:** `test_settings_autosave.mjs` +секция 3b (12 проверок: порядок и
  состав секций, тумблеры и предупреждения в `privacy`, статический CSS-тест
  sticky-подвала и grid-areas строк, аватар-строка, 4 чипа превью u-anna,
  редактор контактов на месте). Итог: **32/32 тестов (1300 проверок)**,
  check ✓ 33, keys ✓ 428, catalog ✓ 96, смоук ✓. `DEMO_DB_VERSION` не тронут.
  Откатная точка: `../filelist_baseline_2026-10-13_before_settings_cleanup.txt`.


### 2026-10-13 — Запрет браузерных подсказок в полях (autocomplete + валидационные «пузыри»)
- **Команда заказчика:** «запретить все браузерные подсказки в полях». Цель —
  автоподсказки/автозаполнение (выпадающие списки ранее введённых значений,
  паролей, адресов) и нативные валидационные «пузыри» браузера. Spellcheck и
  autocorrect НЕ тронуты (подчёркивание/автозамена полезны для RU-текста;
  отключаются отдельной командой, если понадобятся).
- **auth.mjs:** убраны ЯВНЫЕ autocomplete-семантики модалки входа —
  `autocomplete="username"` / `"email"` / `"${isLogin ? 'current-password' :
  'new-password'}"` → все три поля `"off"` (именно они звали менеджеры паролей
  и автозаполнение; `novalidate` на форме уже стоял, валидация своя).
- **messages.mjs, profile.mjs:** `novalidate` добавлен `#chat-form` и
  `#edit-form` — теперь все 5 форм шаблонов без нативных «пузырей»
  (`#auth-form`, `#answer-form`, `#ask-form` уже имели). Поведение не
  изменилось: пустые/кривые значения и раньше ловили свои проверки
  (тосты `answer_required`/`title_required`, инлайн-ошибки редакторов).
- **utils.mjs (234 → 293): централизованная механика** —
  `disableBrowserHints(root)` (sweep: `form` → `noValidate=true` +
  `autocomplete="off"`; `input`/`textarea` → `autocomplete="off"`;
  идемпотентно; корень-поле обрабатывается сам) и `initNoBrowserHints()`
  (разовый sweep документа + MutationObserver на `body`: поля, добавленные
  позже (модалки, перерисовки экранов), получают атрибуты в момент вставки).
  Причина централизации: поля создаются в десятках мест (модалки
  входа/настроек, редакторы контактов/способов/ссылок, формы чата/ответа/
  вопроса, пикеры) — явные атрибуты в шаблонах обязательно бы забылись на
  новом поле; наблюдатель закрывает и будущие. Вызов — main.mjs boot, после
  `initTagSubscriptions()`.
- **Регрессия:** новый `tmp_tests/test_no_browser_hints.mjs` (18 проверок,
  5 секций): статический скан исходников (литералы `autocomplete="…"` — только
  `"off"` (6 мест), все 5 `<form …>` с `novalidate` — защита от будущих
  шаблонов); sweep+идемпотентность; наблюдатель на поздно вставленной форме;
  живые экраны/модалки (вход — off вместо username/email/current-password,
  ЛС, /ask, «Настройки профиля» через клик `#btn-edit-profile`); input,
  вставленный в УЖЕ открытую модалку.
- **Дополнение v2 (после скриншота заказчика: Chrome показал меню
  автозаполнения над «Имя пользователя» несмотря на off):** браузеры ключуют
  сохранённые подсказки по `name`/id/label и игнорируют `off` на узнанных
  полях (MDN: «change the name attribute»), а менеджер паролей — на паре
  логина. К пакету добавлены: (1) **случайный `name` на сессию** у текстовых
  input/textarea (`f<hex6><seq>`, уникальность счётчиком; код проекта `name`
  не читает — значения по id/селекторам, FormData нет), старые сохранённые
  значения («Алинка», «RK676720», телефоны) перестают совпадать с полем;
  (2) **readonly до фокуса** на десктопе (`matchMedia('(pointer: fine)')`):
  над readonly-полем дропдаун не раскрывается, `focusin` снимает атрибут
  (печать/вставка/Tab работают как обычно), `focusout` возвращает; на
  тач-устройствах трюк ВЫКЛЮЧЕН (readonly рискнул бы не открыть клавиатуру с
  первого тапа). Ловушка, найденная тестом: у `textarea` `type === 'textarea'`
  — не попадал в whitelist текстовых типов и проскакивал мимо трюков.
- **v3 (второй скриншот заказчика, DevTools: `autocomplete="off"` и
  `name="fd3a41901"` на месте, readonly снят, меню открыто):** диагноз — v2
  снимал readonly СИНХРОННО в focusin, а Chrome/Yandex принимает решение о
  меню ПОЗЖЕ focusin (на клике, когда поле уже редактируемое); случайного
  `name` мало, т.к. Yandex ключует сохранённые значения по `id`/label
  (переименовать id нельзя — на них label[for] и все селекторы/тесты).
  Лечение: readonly снимается через `setTimeout(250)` после focusin (в момент
  клика/фокуса поле readonly — над ним меню не раскрывается); keydown в
  readonly-поле снимает атрибут СРАЗУ и вставляет печатный символ через
  `document.execCommand('insertText')` (порождает `input` — автосохранение и
  обработчики видят ввод как обычно; быстрая печать не теряет символ);
  focusout возвращает readonly — следующий фокус снова защищён.
  `RO_REMOVE_DELAY = 250` в utils.mjs.
- **Итог:** `npm run check` ✓ 33 модуля, `check_keys` ✓ 426,
  `check_help_catalog` ✓ 95, **32/32 тестов (1288 проверок;
  `test_no_browser_hints.mjs` — 34: фокус-цикл v3 (readonly в момент фокуса →
  снятие спустя паузу → возврат на blur), keydown-страховка, живые
  #ed-username и #auth-password)**, смоук ✓.
  i18n и каталог справки не менялись (новых строк/элементов нет),
  `DEMO_DB_VERSION` не тронут. Откатная точка:
  `../filelist_baseline_2026-10-13_before_no_hints.txt`.
  ⚠️ Остаточный риск (зафиксирован): повторный клик по УЖЕ редактируемому
  полю теоретически может снова раскрыть меню в отдельных сборках — если
  заказчик поймает, следующий рычаг — перехват pointerdown с временным
  readonly до конца клика.


### 2026-10-13 — Заход B: кликабельные #теги — подписка на тег вернулась в UI (спека `PLAN_CONTACTS_PAYMENTS.md` §4.5, ВЫПОЛНЕН)
- **Закрытая дыра:** с удалением навыков (заход A) пропала единственная точка
  подписки на тег; `tagSubscribeButtonHtml` был мёртвым кодом, сайдбар-блок
  «Подписки» умел только отписывать. Теперь подписка оформляется там, где теги
  живут: **#теги ответов** (карточка ответа — страница вопроса И раскрытие
  ленты, общий `answerCardHtml`) и **тег синтезатора вопроса** (карточка ленты).
- **`subscriptions.mjs` (93 → 175):** удалены мёртвые `tagSubscribeButtonHtml`
  (разметка `.toggle-chip`/`data-tag-sub` не подходила карточкам — спека
  разрешала удалить) и `isTagSubscribed` (заменён кэшем). Новое чип-API:
  `tagSubChipHtml(name)` — `<button class="tag tag-sub" data-sub-tag data-help="tag_subscribe"
  aria-pressed title/aria-label>` (✓ + `.subbed` при подписке; состояние —
  СИНХРОННО из кэша `store.subscriptions`, пустое имя → ''),
  `isTagSubscribedCached(name)`, `syncTagChips(scope)` — приводит все чипы
  `[data-sub-tag]` в соответствие с кэшем (один тег может быть на нескольких
  карточках), `refreshTagSubsCache(scope)` — один `fetchSubscriptions()` на
  экран + setState + синхронизация (вызывают `renderFeed` и `renderQuestion`
  после отрисовки — БД не дёргается на каждую карточку),
  `initTagSubscriptions()` — ОДИН capture-слушатель click на document
  (idempotent-флаг): `closest('[data-sub-tag]')` → guard `body.help-active`
  (в режиме справки клики принадлежат help.mjs — поповер вместо действия) →
  `preventDefault` + `stopPropagation` (capture на document срабатывает РАНЬШЕ
  обработчиков карточек — клик по тегу не раскрывает карточку ленты и не
  запускает мини-плеер) → `toggleTagSubscription`.
  `toggleTagSubscription` дополнен: после тоста — `syncTagChips()` (все чипы
  тега гаснут/загораются вместе) + перерисовка сайдбар-блока «Подписки», если
  он в DOM (`subsBlockHost.isConnected`; роутер при уходе заменяет контейнер —
  гаснет само). В отписках блока (✕) — `setState({subscriptions})` +
  `syncTagChips()`: кэш store больше не расходится с БД.
- **Интеграция:** `question.mjs` (1427) — `answerCardHtml`: `a.tags.slice(0,4)`
  → `tagSubChipHtml` (были плоские span); `renderQuestion` зовёт
  `refreshTagSubsCache(container)`. `feed.mjs` (358) — `questionCardHtml`:
  `q.synth` → `tagSubChipHtml`; `renderFeed` зовёт `refreshTagSubsCache(list)`
  после wireCard-цикла. `main.mjs` (121) — `initTagSubscriptions()` в boot
  после `initNotifications()`. `sound_type`/`difficulty`/`category-tag` и тег в
  шапке страницы вопроса остались плоскими span (вне скоупа спеки — см.
  «Дальше: паритет чипов»).
- **Генератор уведомлений `new_question_tag`** (сверх спеки — осознанное
  дополнение, причина: рендерер случая, иконка 🏷️ и ключ
  `notifications.type_new_question_tag` существовали с начала проекта, но
  подписка ничего не порождала — «рабочая точка входа» без эффекта осталась бы
  декорацией): `supabase.mjs` (2556) — `notifyTagSubscribersDemo(q)` в
  `createQuestion` (демо: подписчики `target_type='tag'` с
  `target_id === q.synth`, автору самому — нет; unshift до `persistDemo` —
  один снапшот на вопрос+уведомления) + `notifyTagSubscribersReal(sb, q)`
  (best-effort: select подписок → insert строк уведомлений, сбой не рвёт
  создание вопроса). Payload: `{ tag, questionTitle, questionId }` — клик по
  уведомлению уже умел ходить в `/question/:id`. SQL НЕ менялся: CHECK на
  `notifications.type` нет, RLS `notifications_auth_insert` позволяет
  authenticated-вставку (тот же путь, что у уведомлений 'support').
  `DEMO_DB_VERSION` НЕ повышался (аддитивно).
- **Локали (ru-only):** +2 ключа — `common.tag_subscribe` («Подписаться на
  тег»), `common.tag_subscribed` («Вы подписаны на тег — нажмите, чтобы
  отписаться»); `help.items.tag_subscribe` (+1 пункт каталога). Тосты —
  существующие `subscriptions.subscribed_tag`/`unsubscribed`. Тернарный выбор
  ключа разведён на два статических `t()`-вызова — `check_keys.cjs` видит
  только литералы (ловушка: `t(cond ? 'a' : 'b')` в счётчик не попадает).
  **424 → 426 используемых ключей**, каталог справки **94 → 95**.
- **CSS:** `.tag.tag-sub` — курсор, переход, hover (медь + свечение),
  `.subbed` (яркая медь, `--border-active`, фон rgba(255,140,0,.14)),
  `:focus-visible`-кольцо; медь = действие (конвенция дизайн-системы).
- **Тест:** новый `tmp_tests/test_tag_subscribe.mjs` (43 проверки, 7 секций):
  разметка чипа и состояние из кэша; лента — подписка/отписка кликом,
  `stopPropagation` (карточка не раскрывается), чипы q2/q4, у вопроса без
  synth чипа нет; раскрытие — #теги ответов a1/a2, кросс-синхронизация Serum
  (синтезатор вопроса + тег ответа гаснут вместе); аноним — модалка входа,
  подписка не создаётся; `body.help-active` — клик не действует; сайдбар-блок —
  живая перерисовка при `toggleTagSubscription`, ✕ синхронизирует кэш;
  генератор уведомлений — подписчик получает `new_question_tag`
  (payload/непрочитанное/персист), автор — нет, вопрос без synth — тишина.
- **Итог:** `npm run check` ✓ 33 модуля, `check_keys` ✓ 426,
  `check_help_catalog` ✓ 95, **31/31 тестов (1252 проверки)**, смоук ✓,
  CJK-скан изменённых файлов чист (символы «＋» — существующая типографика
  кнопок, не иероглифы). Счётчики совпали с ожиданием спеки (33 / ~426 / 95–96 /
  31). Откатная точка: `../filelist_baseline_2026-10-13_before_tag_subs.txt`.
- **Ловушка jsdom (подтверждена):** несколько `renderFeed` в одном документе
  дают дубли id (`#feed-list`) — боксы предыдущих секций снимать после
  cleanup (как в test_msg_refs).


### 2026-10-13 — ЛС без аудио: карточки-ссылки «📎» (спека `PLAN_DM_AUDIO_REFS.md`, ВЫПОЛНЕН)
- **Решение заказчика (опрос):** аудио-вложения в личных сообщениях убрать
  (экономия ресурсов — вторичный мотив: Opus ≈ 0,36 МБ/мин ≈ 0,21 ₽/мес при
  1k DAU; главный — приватность: аудио переписки лежало в ПУБЛИЧНОМ бакете
  `question-audio`, URL = прослушивание чужого ЛС). Замена — карточка-ссылка
  на вопрос/ответ/профиль: в БД только `messages.ref jsonb = { type, id }`.
- **SQL** (`setup.sql`/`setup_part1.sql`, идемпотентно; `schema.sql` обновлён):
  `drop column if exists audio_url/waveform_data` у messages + `add column
  if not exists ref jsonb`. Боевая БД не развёрнута — безопасно.
- **`supabase.mjs` (2518):** `DEMO_DB_VERSION = 10`; сид m5 стал сообщением с
  `ref {answer: a3}` (+ новый m6 `ref {question: q4}`); `migrateDemo` вычищает
  аудио-поля из старых снапшотов сообщений (текст и ref переносятся); новые
  экспорты `fetchRefCandidates()` (мои ответы/вопросы для пикера, purged
  исключены) и `fetchRefCard(ref)` (дисплей-пейлоад карточки: демо и реал,
  question/answer/profile, purged/gone); `fetchThread` демо без материализации
  аудио сообщений.
- **`messages.mjs` (562):** кнопка 🎧 + file-input УДАЛЕНЫ (импорт
  `prepareUploadAudio`/`uploadAudio`/`attachMiniPlayer` снят); кнопка 📎
  (`data-help="attach_ref_btn"`) → мини-пикер (`data-help="ref_picker"`:
  вкладки «Мои ответы»/«Мои вопросы», поиск по заголовку, кэш на поток);
  превью прикрепления над полем (переиспользован `.pending-audio`), крестик
  снимает; отправка с пустым текстом разрешена, если есть ref (в `extra.ref`
  пишем только `{ type, id }`); в пузыре — `.msg-ref`-карточка с асинхронной
  дорисовкой и кэшем: ответ → заголовок вопроса + «Ответ» (+ «✓ Решение»),
  вопрос → автор/статус/число ответов, профиль → имя; purged → мини-заглушка
  (как q-preview), цель исчезла → «ссылка недоступна» (`.gone`, без href);
  клик — `data-route`. Список диалогов: сообщение-ссылка без текста → «📎».
- **Локали:** −2 ключа (`messages.attach_audio`, `messages.record`;
  `audio_pending`/`stop_record`/`mic_denied` ЖИВЫЕ — их использует question.mjs
  и audio.mjs), +9 (`attach_ref`, `ref_picker_title`, `ref_tab_answers`,
  `ref_tab_questions`, `ref_search_ph`, `ref_empty`, `ref_attached`,
  `ref_gone`, `ref_answer_badge`). **416 → 424 используемых ключа.**
- **Справка:** +`attach_ref_btn`, +`ref_picker` → **94 пункта**;
  `attach_audio_btn` НЕ удалён (им помечена кнопка выбора файла в question.mjs).
- **CSS:** −`.msg-audio`; +`.msg-ref` (карточка в пузыре, медные токены,
  hover-свечение, `.purged`/`.gone`/`.loading`), +`.ref-picker` (панель:
  вкладки `.tab-btn`, поиск, список `.ref-item`, пусто-состояние).
- **Тесты:** новый `test_msg_refs.mjs` (24 проверки: сид-карточка, отсутствие
  аудио-остатков, пикер/вкладки/поиск, отправка без текста, `{type,id}` в БД,
  снятие прикрепления, gone/purged, «📎» в списке диалогов); `test_msg_badge` —
  снята заглушка `createObjectURL`; `test_demo_persistence` — секция v10
  (санитизация аудио-полей, перенос ref); `test_contacts`/`test_moderation` —
  хардкоды версии 9 → 10. Ловушка jsdom/nwsapi зафиксирована в тесте: два
  экрана сообщений одновременно в DOM = дубли id → `querySelector('#…')`
  возвращает null (ID-шорткат ищет первый в документе) — боксы снимать
  после cleanup.
- **Итог:** `npm run check` ✓ 33 модуля, `check_keys` ✓ 424, `check_help_catalog`
  ✓ 94, **30/30 тестов (1208 проверок)**, смоук ✓. Откатная точка:
  `../filelist_baseline_2026-10-13_before_dm_refs.txt`.
- **Отклонения от спеки (зафиксированы):** счётчики справки 94 вместо ≈93
  (`attach_audio_btn` остался за question.mjs); ключей 424 вместо ≈419
  (−2 вместо −4 по той же причине живости `audio_pending`); `.pending-audio`
  не удалён из CSS (переиспользуется question.mjs и превью 📎).

### 2026-10-11 — «Поддержать автора» (строго СБП + карта), пользовательский контент переживает пересид, свечение навигации не обрезается
- **Задача заказчика (три пункта, решения закреплены опросом; спека —
  `PLAN_SUPPORT_PERSIST_NAV.md`):** (1) вернуть кнопке ☕ и модалке название
  «Поддержать автора» (вместо «Показать реквизиты» / «Оплата и поддержка ·
  {имя}»); способы приёма — строго СБП и банковская карта, QR-код СБП отложить
  на следующий заход. (2) Починить пропажу созданного вопроса после
  перезагрузки: пересид демо-базы при смене `DEMO_DB_VERSION` (7→8 в прошлом
  заходе) выбрасывал весь пользовательский контент. (3) Свечение активной
  иконки навигации срезалось сверху/снизу — вариант фиксации «без overflow».
- **Новый модуль `public/js/donate.mjs`** (осознанное отступление от плана,
  причина зафиксирована): правила способов приёма — `DONATE_KINDS =
  ['sbp','card']`, `MAX_METHODS = 2`, `detectDonateKind` (телефон → `sbp`,
  16–19 цифр → `card`, прочее → `null`), `normalizeDonateMethods` (фильтр
  устаревших видов/пустых/дублей, обрезка до лимита), `validateDonateMethod`
  (СБП ≥ 10 цифр, карта 16–19 цифр) — вынесены в чистый модуль без импортов.
  Причина: `supabase.mjs` применяет нормализацию уже на старте (`loadDemo →
  migrateDemo`), а `support.mjs` импортирует из `supabase.mjs`
  `recordDonation` — прямой цикл грозил TDZ-ошибкой (константы `support.mjs`
  не инициализированы в момент `loadDemo`). `support.mjs` реэкспортирует все
  имена — публичный API для `profile.mjs` и тестов не изменился.
- **`support.mjs`:** модалка автора — заголовок «Поддержать автора · {имя}»
  (`support.title_user`); способы нормализуются на входе
  (`normalizeDonateMethods`) — старые снапшоты v≤8 с ЮMoney/Boosty/криптой не
  ломают окно; кнопки «Перейти» и `isUrl` удалены (все значения — номера,
  только «Скопировать»); у СБП-строки — подпись-хинт `.sup-method-hint`:
  честная заглушка `support.qr_soon` («QR-код появится позже») + фолбэк
  `support.sbp_hint` («перевод по номеру телефона → банк получателя»); иконки
  видов: СБП — 📱 (прежняя была пустой строкой), карта — 💳. «☕ Отправить
  спасибо» и дисклеймеры — без изменений по логике (тексты обновлены).
- **`profile.mjs`:** кнопка ☕ в шапке — `title`/`aria-label` =
  `support.title_user_btn` («Поддержать автора»); редактор способов: в
  `select` только два вида, занятый другой строкой вид — `disabled` (две СБП
  невозможны), «＋ Добавить способ» на лимите отключается + подсказка
  `payment.limit` (`#ed-donate-hint`), новая строка создаётся сразу свободным
  видом; автоопределение по значению учитывает занятость вида; валидация
  зеркалит контактную (`drawDonateErrors`: инлайн-ошибки после blur,
  `.donate-row.invalid`), кривые строки в профиль НЕ сохраняются
  (`currentPatch` фильтрует через `validateDonateMethod` — как у контактов);
  список при открытии настроек нормализуется.
- **`supabase.mjs`:** `DEMO_DB_VERSION = 9`; сиды способов приёма —
  u-anna: СБП + карта (Сбер), u-max: СБП (Т-Банк), u-lena: карта (Т-Банк) —
  крипта/ЮMoney/Boosty из сидов исчезли; `fetchProfile` (демо И реальная
  ветка) нормализует `donate_methods`; **`migrateDemo` переписан** — переносит
  пользовательские записи (всё, чего нет в сидах по id) в коллекциях
  questions/answers/comments/reports/messages/notifications/donations +
  likes/favorites/achievements/subscriptions с дедупом по составным ключам;
  чистит «висяки» (ответы без вопроса, комментарии без ответа, лайки/избранное/
  подписки/жалобы/сообщения/донаты на несуществующие цели); счётчики: у
  СИДОВЫХ вопросов/ответов `likes_count` += перенесённые лайки пользователя,
  у перенесённых вопросов счётчик из снапшота не удваивается, `answers_count`
  не пересчитывается (демо-слой считает его динамически в `demoQuestion`);
  `donate_methods` перенесённых профилей нормализуются; профили из снапшота
  новыми строками не создаются (вопросы «призрачных» авторов рендерятся как
  «Участник» — существующий фолбэк).
- **Локали (`ru.json`):** −8 ключей (`support.kind_yoomoney/kind_boosty/
  kind_donationalerts/kind_telegram/kind_crypto/kind_other`, `support.go`,
  `payment.show`), +5 (`support.title_user_btn`, `support.qr_soon`,
  `support.sbp_hint`, `payment.invalid_phone`, `payment.invalid_card`);
  переписаны `support.title_user`, `support.disclaimer(+_strong)`,
  `payment.settings_title` («Поддержать автора»), `payment.limit`,
  `profile.donate_hint/donate_title/donate_value_ph`,
  `help.items.support_user_btn/set_payment/sup_methods`,
  `helpPage.sections.donate`, `demo.reseeded` (честный текст: «ваши вопросы,
  ответы и настройки перенесены, демонстрационный контент обновлён»).
  Итог: **415 → 416 используемых ключей** (invalid_* вызываются динамически
  через `t(res.errorKey)` — чекер их не считает, в словаре есть). Каталог
  справки — **92 пункта** (без изменений, новые `data-help` не добавлялись).
- **CSS:** `.main-nav` — `overflow: hidden` + `height: var(--header-h)` +
  центрирование вместо `overflow-x: auto` (clip-бокс 40px → 64px, ореол
  `--copper-glow` ±18px и бейджи помещаются целиком); правило
  `::-webkit-scrollbar` удалено; `@media (max-width: 420px)` — иконки 36px,
  gap 2px (5 иконок ≈ 188px влезают в 320px); `.sup-method-hint`;
  `.donate-row.invalid .donate-value` + `.donate-row .row-error` (та же схема,
  что у `.contact-row`); колонка select в `.donate-row` 132 → 150px.
  `.tabs` оставлены со скроллом сознательно: у `.tab-btn.active` нет свечения
  (только цвет и подчёркивание) — обрезаться нечему.
- **SQL:** только комментарии (`setup.sql`, `setup_part1.sql`, `schema.sql`):
  `donate_methods` содержит лишь `sbp|card`, под QR-заход зарезервированы поля
  `qr_data_url`/`bank` в том же jsonb-объекте (CHECK-ограничений нет —
  миграция не нужна). `config.mjs` — комментарии и пример
  `DONATIONS_PROJECT` без Boosty.
- **Тесты:** новый `test_demo_persistence.mjs` (39 проверок: вопрос/ответ/
  комментарий/лайк/избранное/сообщение/подписка/донат/уведомление/жалоба
  переживают v8→v9, «висяки» удалены, счётчики не удвоены, фильтрация
  `donate_methods`, новый тост, повторный старт без миграции);
  `test_donations.mjs` переписан (72 проверки: сиды СБП+карта, detect → null
  для устаревших, normalize/validate, модалка «Поддержать автора», хинт СБП,
  редактор с disabled-видами и валидацией); `test_demo_migration.mjs` —
  пользовательский вопрос теперь ПЕРЕНОСИТСЯ (инверсия прежней ассерции);
  `test_dom.mjs` — секция 9, статический CSS-тест навигации (7 проверок);
  `test_contacts.mjs`/`test_moderation.mjs` — v9. Все **29 файлов ✓
  (1183 проверки)**, `npm run check` ✓ (33 модуля), чекеры ключей/справки ✓,
  смоук сервера ✓, CJK-скан 17 изменённых файлов чист.
- **Визуалка:** `../nav-glow-compare.html` — «до/после» свечения навигации
  (+ узкий экран 320px), по образцу `help-mode-compare.html`.
- **Точка отката:** `../filelist_baseline_2026-10-11_before_support_v9.txt`
  (снимок до захода); предыдущие — `..._before_collab_badge.txt`,
  `..._before_contacts.txt`.
- **Расширение плана (зафиксировано):** `migrateDemo` переносит ещё и
  `reports` — в списке коллекций PLAN §2.2 их не было (упущение диагноза), но
  пользовательская жалоба — пользовательский контент; «висяки» чистятся так же.
- **Сознательно НЕ делали (отложено):** QR-коды СБП (следующий заход, спека в
  `PLAN_SUPPORT_PERSIST_NAV.md` §0; желателен после квота/IndexedDB —
  QR-картинка тяжёлая); видимая ошибка переполнения localStorage и перенос
  dataURL в IndexedDB; экспорт/импорт демо-данных; маск номера карты в модалке
  (реквизиты затем и показаны, чтобы по ним платили); серверная приватность
  контактов (Этап 3).

### 2026-10-11 — Шапка профиля как прежде: контакты по клику на бейдж «Открыт к коллаборациям»
> ⚠️ **Поправка (того же дня, v9):** подъём `DEMO_DB_VERSION` до 8 в этой
> записи имел побочный эффект: «мягкий пересид» переносил только поля профиля
> и словари, а пользовательские вопросы/ответы/сообщения и т. п. пересоздавались
> из сидов — заказчик потерял созданный вопрос после перезагрузки. Исправлено
> в заходе «Поддержать автора…»: `migrateDemo` переносит весь пользовательский
> контент (`DEMO_DB_VERSION = 9`, тест `test_demo_persistence.mjs`) — см.
> верхнюю запись.
- **Задача заказчика:** «лучше оставить как было до этого, но убрать навыки, и если
  открыт к коллаборациям — просто сделать кнопку кликабельной». То есть откатить
  визуальную часть захода A (ряды «📇 Контакты» и «💳 Оплата» в шапке), а бейдж
  статуса превратить в действие. Навыки при этом не возвращаются.
- **Решения заказчика (ask_user):** (1) клик по бейджу открывает модалку «Как
  связаться» с чипами контактов; (2) при выключенном тумблере контакты видит только
  владелец — бейдж единственная точка входа, в настройках подсказка; (3) ряд
  «💳 Оплата» и флаг `payment_markers` удалить полностью (вход в реквизиты — кнопка ☕);
  (4) заход B (кликабельные теги) — следующим заходом.
- **Почему так лучше (согласовано с заказчиком):** шапка снова читается как «анкета
  из двух строк» (DAW + арсенал); бейдж перестаёт быть декорацией и означает ровно
  то, что на нём написано; контакты больше не лежат в DOM страницы профиля — чипы
  рендерятся только внутри модалки; из захода A ничего не выброшено (схема,
  `contacts.mjs`, редактор, шаг 3 онбординга, жалоба `fraud`, крипто-способ оплаты).
- **`contacts.mjs`:** удалены `contactsRowHtml()` и `paymentRowHtml()`; добавлены
  `collabBadgeHtml({ profile, viewer })` (кнопка `#btn-collab` с
  `data-help="collab_badge"` и `aria-haspopup="dialog"`), `visibleContacts({ profile,
  viewer })` и `openContactsModal({ profile, viewer, onRequireAuth, onMessage, onEdit })`
  — заголовок «Как связаться с {name}» (владельцу «Как со мной связаться»), подсказка
  о приватности только когда есть что показывать, чипы, внизу «💬 Написать» или
  владельцу «⚙️ Изменить» → настройки. `bindContactsBlock()` теперь навешивается на
  тело модалки и понимает действие `edit`.
- **Правило видимости (единая точка — `canSeeContact`):** владелец → всё без маски;
  остальные → только если включены ОБА тумблера (`open_to_collab` и `contact_consent`),
  viewer залогинен и `visibility !== 'hidden'`; e-mail/телефон — под маской до
  «Показать». Побочный эффект, закрытый тестом: u-lena (контакты + согласие, бейдж
  выключен) больше не отдаёт контакты никому, кроме себя.
- **`profile.mjs`:** из `.profile-meta-strips` убраны оба ряда (остались DAW и арсенал),
  бейдж рендерит `collabBadgeHtml`, обработчик `#btn-collab` → `requireAuth()` →
  `openContactsModal`; удалены обработчики `[data-act="open-payment"]` и
  `[data-act="edit-payment"]`. В настройках: тумблер маркеров оплаты убран, добавлены
  подсказка `profile.collab_hint` и предупреждение `#ed-collab-warn` («бейдж выключен —
  контакты видите только вы») рядом с прежним `#ed-consent-warn`; `currentPatch()`
  больше не отправляет `payment_markers`.
- **Онбординг, шаг 3:** добавлена галочка `#ob-collab` (по умолчанию включена) —
  «Готово» вместе с контактом пишет `open_to_collab`, иначе записанный контакт не
  увидел бы никто; «Пропустить» бейдж не трогает. Галочку можно снять: контакт
  сохранится, но останется приватным (проверено тестом 11c).
- **Схема и демо:** `setup.sql` / `setup_part1.sql` — вместо `add column
  payment_markers` теперь `alter table public.profiles drop column if exists
  payment_markers` (долетает и до развёрнутых баз), `SETUP.md` переписан, в
  `schema.sql` обновлён исторический комментарий. `DEMO_DB_VERSION = 8`, флаг убран
  из сидов и `DEMO_MIGRATE_PROFILE_FIELDS`, `fetchProfile` в демо-ветке нормализует
  `open_to_collab`; старый снапшет v7 с `payment_markers` пересаживается без
  «воскрешения» удалённого поля (проверено).
- **Локали:** −4 ключа (`payment.title/empty/edit/markers_toggle`), +11
  (`contact.badge_title`, `badge_title_own`, `modal_title_own`, `modal_title_user`,
  `modal_hint`, `modal_hint_own`, `empty_for_viewer`, `collab_off_warn`, `edit`,
  `profile.collab_hint`, `auth.onboarding_collab`); переписаны `contact.settings_hint`,
  `profile.donate_hint`, `auth.onboarding_contact_privacy`, `helpPage.sections.profile`.
  Итог: **414 → 415 ключей**. Каталог справки **94 → 92**: убраны `profile_payment`,
  `profile_payment_show`, `profile_payment_edit`, `set_payment_markers`; добавлены
  `collab_badge` и `contact_edit_btn`; обновлены `profile_contacts`, `set_collab`,
  `set_contact_consent`, `set_payment`.
- **CSS:** `.collab-badge` — сброс кнопки + hover (ярче рамка и фон) + медное
  фокус-кольцо; добавлены `.contacts-modal-list` (чипы в столбик, значение тянется)
  и `.contacts-modal-actions`; удалены `.pay-markers`, `.pay-marker`, `.contacts-row`.
  Статусный зелёный у бейджа сохранён — медь оставлена за действиями-«операциями»,
  кликабельность показываем курсором, hover-подсветкой и фокус-кольцом.
- **Тесты:** `test_contacts.mjs` 116 → **170 проверок** (матрица видимости с
  `open_to_collab`, две полосы в шапке, отсутствие контактов в DOM страницы,
  бейдж-кнопка, модалка для участника/анонима/владельца, правило «нет бейджа — нет
  контактов», пустые состояния, «Показать»/«Скопировать»/«Написать», настройки без
  маркеров и с предупреждениями, онбординг с галочкой бейджа); `test_donations.mjs` —
  секции 7–8 переписаны (реквизиты только через ☕, `payment_markers` удалён);
  `test_demo_migration.mjs` — перенос `open_to_collab` и проверка, что удалённый флаг
  не возвращается; `test_moderation.mjs` — v8. Все 28 тестов ✓, `npm run check` ✓
  (32 модуля), чекеры ключей и справки ✓, смоук сервера ✓, CJK-скан чист.
- **Точка отката:** `../filelist_baseline_2026-10-11_before_collab_badge.txt` (снимок
  до этой правки); предыдущая — `..._before_contacts.txt`.
- **Сознательно НЕ делали:** отдельную иконку 📇 в ряду действий шапки (отклонённый
  вариант обнаруживаемости), показ контактов модератору в карточке жалобы, серверную
  выдачу контактов (Этап 3).

### 2026-10-11 — «Контакты» и «Оплата» вместо «Навыков» (заход A)
> ⚠️ **Поправка того же дня:** визуальная часть захода откатана по решению
> заказчика — ряды «📇 Контакты» и «💳 Оплата» из шапки убраны, контакты открываются
> модалкой по бейджу-кнопке «🤝 Открыт к коллаборациям», флаг `payment_markers`
> удалён из схемы, настроек и демо, `DEMO_DB_VERSION` теперь 8, ключей 415,
> справка — 92 пункта, `test_contacts.mjs` — 170 проверок. Данные и логика захода
> (колонки `contact`/`contact_consent`, `contacts.mjs`, редактор, шаг 3 онбординга,
> жалоба `fraud`, крипто-оплата) остались в силе. Подробности — в записи выше;
> текст ниже сохранён как исторический, устаревшие места помечены «→ поправка».
- **Задача заказчика:** убрать бесполезные «Навыки» и сделать два полезных блока —
  как с человеком связаться и как ему заплатить. Разведка подтвердила, что навыки
  не несут функции: строка в шапке, чипсы в настройках, шаг онбординга, таблица
  `user_skills` + 2 RLS-политики; клик по чипсу подписывал на тег **только в своём
  профиле** (`editable`), поиска/фильтрации по навыкам нет, а `🎛️ DAW` + `🧰 Арсенал`
  + bio их дублируют и не нормализованы («синтез»/«Synth»/«sound design» — три тега).
- **Решения заказчика (ask_user):** оплата = маркеры в шапке + реквизиты по кнопке;
  контакты = отдельный блок `profiles.contact`; приватность = только залогиненным +
  маска с кнопкой «Показать»; шаг 3 онбординга → «Как с вами связаться?» (пропускаемо),
  подписка на тег переезжает на теги ответов/вопроса (заход B).
- **Поправки к плану, согласованные перед стартом:**
  (а) per-contact «Всем/Участникам/Скрыт» из UI убран — поле `visibility` в схеме
  осталось (`members` | `hidden`), но `normalizeContacts()` приводит `all` и любой
  мусор к `members`: контакт никогда не станет публичнее задуманного;
  (б) `whatsapp` из типов исключён (для аудитории RU мёртв, всё прочее — `other`),
  осталось 7 типов: telegram, email, phone, discord, website, vk, other;
  (в) жалоба на мошенничество **не** существовала — добавлена (см. ниже);
  (г) перед правками сделан откатный снимок `../filelist_baseline_2026-10-11_before_contacts.txt`
  (гита в проекте нет — точка восстановления одна).
- **Схема БД** (`setup.sql`, `setup_part1.sql`, `schema.sql` — идемпотентно,
  `SETUP.md` дополнен): `profiles.contact jsonb default '[]'`,
  `contact_consent boolean default false`, `payment_markers boolean default true`
  (→ поправка: `payment_markers` удалён, `drop column if exists`);
  `drop table user_skills cascade` + её политики; `reports.target_type` расширен
  значением `profile`, `reports.reason` — значением `fraud` (через
  `drop constraint if exists … add constraint …`, чтобы долетело и до развёрнутых баз).
- **Новый модуль `public/js/contacts.mjs`** (32-й; чистый — зависит только от
  i18n/utils, поэтому его импортирует `supabase.mjs` без циклов): `CONTACT_KINDS`,
  `MAX_CONTACTS = 6`, `detectContactKind`, `validateContact` (форматы, длина 200/40,
  дубли с нормализацией регистра и пробелов, запрет `javascript:`/`data:`/`vbscript:`),
  `normalizeContacts`, `needsMask`/`maskEmail`/`maskPhone`/`maskValue`,
  **`canSeeContact`** (единственная точка решения о видимости), `contactHref`
  (mailto/tel/t.me/vk/http), `contactsRowHtml`, `paymentRowHtml`, `bindContactsBlock`,
  `copyContactValue` (clipboard → `execCommand` → тост со значением),
  `contactEditorRowHtml`, `contactKindOptions`.
- **Матрица видимости:** владелец — всё без маски; аноним — ряда нет вовсе
  (значения не рендерятся, `data-full` в DOM не появляется); участник — видит,
  e-mail/телефон под маской до «Показать»; `visibility: hidden` — только владелец;
  `contact_consent = false` — только владелец (в настройках — предупреждение).
  Маски: `anna@nullsea.ru → a•••@nullsea.ru`, `+7 911 222-33-44 → +7 9•• •••-••-44`
  (открыты первые 2 и последние 2 цифры, разделители сохраняются).
- **Шапка профиля** (→ поправка: ряды убраны, контакты — модалкой по бейджу):
  вместо строки навыков — ряды «📇 Контакты» (чипы: иконка,
  значение/маска, подпись, «Показать», «⧉ Скопировать», «↗ Открыть», «💬 Написать»)
  и «💳 Оплата» (только НАЗВАНИЯ способов + «Показать реквизиты» / владельцу
  «⚙️ Изменить»). Ряд оплаты скрывается при `payment_markers = false`.
  Пустой ряд контактов видит только владелец («Контакты не указаны»).
- **Настройки профиля:** редактор контактов (тип/значение/подпись/🗑, автоопределение
  типа, лимит 6 — на лимите кнопка «＋» выключена + тост), чекбокс согласия с
  предупреждением, блок «💳 Оплата и поддержка» с тумблером маркеров и лимитом 6
  (`MAX_METHODS`), `data-help`: `set_contact`, `set_contact_consent`, `set_payment`
  (бывший `set_donate` — переименован без алиаса), `set_payment_markers`
  (→ поправка: тумблер маркеров и его пункт справки удалены).
  Валидация: подсказка появляется после подтверждения поля (blur/Enter), а не
  посреди набора — иначе строка «@почта» при типе Telegram мигала бы ошибкой;
  **невалидные и пустые записи в профиль не сохраняются** (фильтр в `currentPatch()`),
  служебный `manualKind` в БД не попадает.
- **Онбординг, шаг 3:** «Как с вами связаться?» — селект типа + одно поле,
  автоопределение, «Пропустить» (био и DAW сохраняются, контакт не пишется,
  согласие НЕ проставляется) и «Готово 🚀» (контакт + `contact_consent = true`
  явно); невалидное значение не пускает дальше и показывает ошибку под полем.
- **Оплата (`support.mjs`):** тип `crypto` (USDT TRC-20 / BTC / TON, автоопределение
  по адресу `T…`/`0x…`/`bc1…`/`UQ…`/`EQ…` и по подписи), `MAX_METHODS = 6`,
  заголовок «Оплата и поддержка · @name», усиленный дисклеймер для получателя
  (`support.disclaimer_strong`): платформа не проводит платежи, не проверяет
  получателя и не выступает гарантом.
- **Жалобы и модерация:** причина `fraud` («💸 Мошенничество / чужие реквизиты»),
  цель `profile` — кнопка ⚑ в шапке чужого профиля; для профиля `fraud` выбран
  причиной по умолчанию; жалоба на себя отклоняется с тостом. Модератору в карточке
  видны био + способы приёма + контакты цели, заголовок — ссылка на профиль;
  вместо «Удалить контент» — «✓ Разобрано» (профиль по жалобе не удаляется).
- **Демо-слой:** `DEMO_DB_VERSION = 7` (→ поправка: 8); сиды контактов и способов приёма
  (u-anna: telegram + e-mail, СБП/ЮMoney/Boosty; u-max: telegram + телефон,
  СБП + USDT TRC-20; u-lena: discord + сайт, Boosty; u-demo: пусто, согласие
  выключено); `skills` убран из `DEMO`, `DEMO_PERSIST_KEYS` и цикла `migrateDemo`;
  `DEMO_MIGRATE_PROFILE_FIELDS` += `contact`, `contact_consent`, `payment_markers`
  (переживают мягкий пересид); `fetchProfile` нормализует `contact` в обоих режимах,
  `updateProfile` больше не ходит в `user_skills`.
- **Локали:** ru −5 ключей (`profile.skills`, `profile.skills_ph`,
  `profile.no_skills`, `auth.onboarding_skills`, `help.items.set_skills`),
  + разделы `contact` (28) и `payment` (7), + `support.kind_crypto`,
  `support.disclaimer_strong`, `report.reason_fraud` / `target_profile` / `self`,
  `moderation.action_taken(_toast)`, 4 ключа онбординга; обновлены
  `helpPage.sections.{profile,donate,moderation}`. Итог: **391 → 414 ключей**,
  каталог справки **84 → 94 пункта** (`check_help_catalog` — без сирот)
  (→ поправка: 415 ключей и 92 пункта).
- **CSS:** `.contacts-row`, `.contact-chip/-ico/-value/-masked/-label/-act/-write`,
  `.pay-markers`, `.pay-marker` (→ поправка: `.contacts-row` и `.pay-marker*` удалены,
  добавлены `.contacts-modal-list/-actions`), `.contact-row.invalid` + `.row-error`
  (сетка редактора переиспользует `.donate-row`).
- **Тесты:** новый `test_contacts.mjs` (116 проверок, → поправка: 170 — вместо рядов
  в шапке проверяется модалка по бейджу; типы, валидация,
  нормализация, маски, матрица видимости, слой данных и пересид, шапка для
  анонима/участника/владельца, «Показать»/«Скопировать»/«Написать», лимит 6,
  онбординг и «Пропустить»); переписаны секция навыков в
  `test_settings_autosave.mjs` (→ контакты, валидация, согласие),
  `test_donations.mjs` (crypto, MAX_METHODS, заголовок и дисклеймер, маркеры в
  шапке без реквизитов, `payment_markers`), `test_moderation.mjs` (v7, 5 причин,
  жалоба на профиль целиком), `test_demo_migration.mjs` (перенос contact/флагов).
  Все 28 тестов + 3 чекера зелёные, смоук сервера ✓, CJK-скан изменённых файлов чист.
- **Сознательно НЕ делали:** прайс-лист услуг и заказы/эскроу, верификация
  получателя, подтверждение e-mail/телефона кодом, серверная выдача контактов
  (Этап 3), страницы Terms/Privacy (Этап 3), кликабельные теги (заход B).

### 2026-10-11 — Dev-сервер без кэша: правки CSS видно сразу («я не заметил изменений»)
- Жалоба заказчика: после перекраски help-режима в никель изменений не видно.
  Диагноз: (1) `server.js` раздавал статику без анти-кэш заголовков — браузер
  показывал старый `style.css`; (2) никель по замыслу виден только внутри режима
  справки (спотлайт/поповер/баннер/активная «?») — обычные страницы и /help
  остались медными, там сравнивать нечего.
- Правка `server.js`: `Cache-Control: no-store, must-revalidate` для
  css/js/mjs/html (и в `express.static`, и в SPA-fallback). В проде кэш — на
  nginx (`deploy/nginx-sample.conf`), dev-сервер теперь всегда отдаёт свежее.
- Наглядное сравнение «медь → никель» — отдельная страница вне проекта
  (`/home/user/help-mode-compare.html`): обе сцены собраны на реальных
  значениях переменных из `style.css`.
- Проверки: смоук (`/css/style.css` → 200 + `no-store` + содержит `--nickel-3`;
  fallback `/` → `no-store`), `npm run check` ✓ 31, 27/27 тестов ✓,
  check_keys ✓ 391, check_help_catalog ✓ 84.

### 2026-10-11 — Режим справки в никелевом серебре (цвет режима ≠ цвет бренда)
- Идея заказчика: help-режим должен отличаться по тону от медных акцентов сайта.
  Диагноз подтвердил: спотлайт, поповер, баннер и активная «?» были в том же
  `--copper-3`/`--border-active`, что и ссылки/кнопки/маркеры — на пёстрых
  страницах режим визуально «не переключался». Палитра и охват выбраны через
  ask_user (нейзильбер + кнопки остаются медными + /help не трогаем).
- **Дизайн-правило** (зафиксировано в `:root` и README): **медь = бренд и
  действия, никель = служебный слой подсказок**. Смена цветового тона — самый
  заметный сигнал смены режима; холодное серебро читается как «инфо» и не
  конфликтует с тёплой палитрой.
- `style.css`: новые переменные `--nickel-1/2/3` (#7f93ab / #a8b8cc / #dde6f2),
  `--nickel-glow(-strong)` rgba(200,215,235), `--border-help`. Перекрашены
  ТОЛЬКО «рамки» режима: `.help-spot` (бордер + свечение; маска затемнения
  сдвинута в холодный тон rgba(6,8,11,.42)), `.help-pop` (бордер, заголовок,
  hover ✕), `.help-banner` (бордер), `body.help-active #btn-help-mode`.
- Кнопки внутри help-UI («Готово», «Далее →», «Пропустить») — прежние
  `btn-ghost`/`btn-primary` в меди: действия остаются брендовыми. Страница
  `/help` не тронута (обычная контентная страница).
- Чисто CSS-правка: JS, i18n (391 ключ), каталог справки (84) без изменений.
- Проверки: `npm run check` ✓ 31 модуль; check_keys ✓ 391; check_help_catalog
  ✓ 84; все 27 тестов ✓ (цвета в тестах не ассертятся); смоук сервера ✓
  (style.css отдаётся с никелевыми переменными); CJK-скан чист.

### 2026-10-11 — Маркеры ответа: полное редактирование + presence влезает в «Статистику»
- Две жалобы заказчика, обе подтвердились диагностикой; варианты fixes выбраны
  через ask_user (A + A).
- **1) Пикер маркеров в форме ответа** (`createMarkerPicker` в `audio.mjs`) умел
  только ставить маркер кнопкой «📍» и удалять ✕ — в отличие от триммера вопроса
  пин нельзя было двигать, подписывать и слушать от него. Прокачан на месте
  (конвейер ответа не тронут: Opus-кодирование остаётся при прикреплении):
  - **драг пина по волне**: `pointerdown` с hit-test ~10px (пин в приоритете над
    перемоткой), `setPointerCapture` в try/catch, живое время в чипе при движении,
    пересортировка чипов на `pointerup`; курсор `ew-resize` над пином;
    `suppressClick` — клик после драга не перематывает (клик по пину без движения
    не делает ничего — как в триммере);
  - **подпись**: input `.mark-note` в чипе (maxlength 40, placeholder
    `trimmer.marker_note_ph`), значение сразу попадает в `getValue()` → БД
    (формат `markers:[{time,note}]` уже поддерживался плеерами ленты/вопроса);
  - **▶ «послушать от маркера»**: семантика один в один с триммером/лентой —
    повторный клик по играющему = пауза, любой другой = ВСЕГДА с начала маркера;
    `.playing`-подсветка чипа, ⏸/▶-иконки синхронизируются по play/pause/ended;
    ручная перемотка кликом по волне снимает режим «игра от маркера»;
    удаление играющего маркера ставит игру на паузу.
  - Новые строки не понадобились (переиспользованы `trimmer.marker_play`,
    `trimmer.marker_note_ph`); обновлены значения `answer.marker_hint` и
    `help.items.marker_picker.desc` (заодно исправлено протухшее «до 8 меток» —
    лимит давно 2). CSS: `.picker-wave { touch-action:none }` для драга на тач-
    устройствах; стили чипов (`.mark-chip/.mark-note/.mark-play/.playing`) уже
    были глобальными — подхватились без правок.
- **2) Presence вылезал за карточку «Статистика»** в сайдбаре вопроса (300px):
  чип (точка + до 4 аватарок + «+N» + текст «N смотрят · N гостей») стоял
  в `.stat-row` (flex nowrap) рядом с подписью «Сейчас смотрят» — сумма ширин
  превышала карточку, а `min-width:0` нигде не было. Fix (вариант «собственная
  строка + защита»):
  - `question.mjs`: presence вынесен из `.stat-row` в отдельную `.presence-row`
    под строками статистики (тонкая верхняя граница); подпись
    `presence.viewing_short` не нужна — чип самодостаточен (ключ удалён из
    `ru.json`, 392 → 391);
  - `presence.mjs`: новая опция `maxStack` (дефолт 4 — лента без изменений),
    сайдбар вопроса передаёт `maxStack: 3` → «3 аватарки + +N»;
  - `style.css`: `.presence-row` + панель «кто смотрит» в сайдбаре открывается
    влево-вниз (`right:auto; left:0`, не выходит за карточку); защитный каскад
    на все ширины: `.presence-chip { min-width:0; max-width:100% }`,
    `.presence-text` — ellipsis, `.presence-stack { flex-shrink:0 }`,
    `.presence-host/.presence-wrap { min-width:0 }`; мёртвое правило
    `.presence-host-side` удалено. Live-обновление статистики
    (`statValues[0]/[2]`) не затронуто — presence и раньше не имел `<b>`.
- Тесты: `test_markers_expand.mjs` — новая секция 1b (13 проверок: ▶/подпись
  в чипе, note → getValue, игра от маркера + пауза, драг 20→45с с живым чипом,
  suppress-click, перемотка не сдвигает маркер и не стирает подпись, ✕ играющего
  маркера); `test_presence.mjs` — секция 3b (maxStack 3 «+3» и дефолт 4 «+2»);
  `test_dom.mjs` — разметка сайдбара (`.presence-row #q-presence-host`,
  в `.stat-row` его нет, 3 `<b>`).
- Итог: 27/27 тестов, `npm run check` → 31 модуль, 391 ключ ru, каталог справки
  84 пункта, серверный смоук OK.

### 2026-10-11 — Заморозка мультиязычности на RU (слой i18n сохранён)
- Вопрос заказчика: аудитория русскоязычная, браузеры сами переводят страницы —
  стоит ли держать переводы? Разбор показал, что цена была не в механике
  (`i18n.mjs` написан и покрыт тестами), а в переводе каждой новой строки ×3:
  653 ключа ru / 649 en / 649 de + каталог справки ×3, и оба валидатора это
  форсили. Через ask_user выбран вариант **«заморозить до ru-only»** (полный
  демонтаж `t()` отвергнут как дорогой и рискованный, ru+en — как налог ×2
  без окупаемости).
- Аргументы за заморозку: контент (вопросы/ответы) — UGC и переводится только
  браузером в любом случае, поэтому EN/DE-обёршка не делала сайт usable для
  иностранца; вся инфраструктура и монетизация RU (РСЯ, Метрика, Selectel,
  донаты в ₽); SPA без отдельных URL под локали — SEO от `og:locale:alternate`
  пользы не было.
- `config.mjs`: `LOCALES: ['ru']` + комментарий с условием возврата и триггером
  пересмотра (>5–10% не-RU трафика по «Географии» в Метрике).
- `i18n.mjs`: убран fallback на английский (словарь-страховка и ветка в
  `lookup()`), `loadDictionary` при ошибке отдаёт `{}`; `updateSwitcherUI()` и
  document-делегирование кликов по `.lang-switcher` **оставлены** — при возврате
  языка переключатель заработает без правок слоя. `setLocale('en')` теперь
  клампится к `DEFAULT_LOCALE`.
- `profile.mjs`: переключатель языка удалён из модалки «Настройки профиля»
  (вместе с `LANG_NATIVE` и импортом `CONFIG`, который больше не использовался);
  стили `.lang-switcher` в `style.css` оставлены с пометкой.
- `index.html`: убраны `og:locale:alternate en_US/de_DE` (`og:locale ru_RU` остался).
- Словари `en.json`/`de.json` перенесены в **`locales_archive/`** + README с
  пошаговым возвратом языка (досинхронизировать устаревший словарь → `LOCALES` →
  переключатель → OG → валидаторы). Из `ru.json` удалены осиротевшие
  `profile.language`, `profile.language_hint` и `help.items.set_lang`, в
  `help.items.profile_settings_btn.desc` убрано «язык интерфейса».
- Валидаторы: `check_keys.cjs` и `check_help_catalog.cjs` переведены на список
  `LOCALES = ['ru']` (одна точка изменения при возврате языков).
- Тесты: `test_auth_i18n.mjs` переписан под заморозку (клампинг en/de, запрашивается
  только ru.json, перерисовка по `i18n:changed`, один document-слушатель);
  в `test_settings_autosave.mjs` секции про RU/EN/DE-кнопки заменены проверкой
  отсутствия переключателя и клампинга, немецкие строки-ожидания → русские,
  секции перенумерованы; `test_units.mjs` — en/de-плюрализация недостижима,
  проверяем клампинг; `test_metrika_seo.mjs` — `og:locale ru_RU` есть,
  alternate нет. Попутно убран иероглиф, затесавшийся в комментарий
  `achievements.mjs` («в‹иероглиф›closure» → «в замыкании»).
- Итог: 27/27 тестов, `npm run check` → 31 модуль, 392 ключа в ru, каталог
  справки 84 пункта, сирот нет. Смоук: `/locales/en.json` → 404, `ru.json` → 200.

### 2026-10-11 — Маркеры в списках профиля: паритет с лентой
- Замечание заказчика: в `feed-layout` профиля маркеры не отображаются. Разбор:
  это не решение, а обрыв рендера — `q.markers` приходили (demoQuestion spreads
  `...q`, реал — `select('*')`), но `questionsListHtml`/`bestAnswersHtml` не
  сериализовали их в canvas, а биндинги звали `attachMiniPlayer` без маркеров.
  Через ask_user выбрано: **полный паритет** (пины+чипы) и **маркеры в «Лучших
  ответах»**.
- `profile.mjs`: `data-markers` у canvas в обеих колодах; хелпер `dsJson()`
  (безопасный JSON.parse из dataset, мусор → []); маркеры передаются в
  `attachMiniPlayer` в биндингах вкладок и витрины. Вкладка «Избранное»
  починилась автоматически (та же `questionsListHtml`).
- `supabase.mjs`: `markers` добавлены в select `fetchBestAnswers` (реальная
  ветка; демо-ветка пробрасывала их и так) + JSDoc.
- Ноль новых строк i18n и help-ключей: чипы строит сам `attachMiniPlayer`
  (`data-help="player_markers"` уже в каталоге), stopPropagation на чипах и
  канвасе уже был — клик по чипу не вызывает переход по карточке.
- Тесты: новый `test_profile_markers.mjs` (данные/чипы вкладок «Вопросы» и
  «Избранное»/витрина/старт с отметки 0.8/stopPropagation/мусор в markers);
  в `test_best_answers`, `test_profile_cover`, `test_settings_autosave` добавлен
  `globalThis.Audio = dom.window.Audio` (ветка с маркерами создаёт `new Audio()`
  для метаданных пинов). Все 27 тестов + check + 394 ключа + каталог 85 зелёные.

### 2026-10-11 — Контекстная справка: режим «What's this?» + тур первого визита + /help
- Запрос заказчика: «?» за колокольчиком; при нажатии блокируется функционал всех
  кнопок, а клик по любому элементу показывает, что он делает. Через ask_user
  выбран максимальный вариант: режим + тур + страница /help, каталог — сразу все экраны.
- **help.mjs (31-й модуль)**:
  - Режим: перехват pointerdown/mousedown/click/keydown/wheel в **capture-фазе на
    document** — намеренно БЕЗ `disabled` (интерфейс выглядит живым, модалки/фокус
    не ломаются): обработчики элементов и document-делегирование (роутер, панели,
    lang-switcher) просто не получают события. Клик → **спотлайт** (медный контур +
    затемнение остального, box-shadow 9999px) + **поповер** с заголовком/описанием
    из `help.items.<ключ>`. Выход — Esc, кнопка нижнего баннера, повторный клик
    по «?». При включении закрываются «бесхозные» панель уведомлений/меню аватара.
  - Фолбэк: элемент без `data-help` → ближайший предок с описанием; нет и его →
    тост «Об этом элементе справки пока нет».
  - Клавиатура/колесо: Enter/Space по фокусу показывают справку, прочие клавиши
    глушатся (Tab и Ctrl/Meta/Alt-сочетания не трогаем); wheel на канвасах
    (триммер/вейвформы) блокируется; **тач-скролл не блокируется** (preventDefault
    у pointerdown — только для мыши, иначе на мобильном страницу не прокрутить).
  - Тур первого визита: 8 шагов (лента → «Задать вопрос» → карточка → мини-плеер →
    «кто онлайн» → колокольчик → меню аватара/вход → сама «?»), «назад/далее/
    пропустить», шаги без элементов пропускаются (гость/другая страница), флаг
    `samplehelp_tour_seen`; maybeAutoTour стартует через 1,2 с после первого рендера.
  - Страница `/help` (роут в main.mjs): 8 секций FAQ + CTA «Режим» (переход на
    главную и старт) и «Тур». Входы: «?» в шапке, «📖 Справка» в меню аватара,
    ссылка в подвале; /help добавлен в sitemap.xml.
- **Каталог — 85 ключей** `data-help` по всем экранам: шапка/подвал, лента,
  страница вопроса (плеер, маркеры, A/B, лайк/избранное/поделиться/жалоба/подписка,
  карточка ответа, решение, «спасибо», комментарии, сайдбар-статистика, баннер
  архивации), форма ответа и /ask (поля, файл/рекордер, триммер, пресет, ссылки,
  пикер маркеров), профиль (все кнопки, витрина «Лучшие ответы», вкладки, ссылки,
  статистика), «Настройки профиля» (все 12 полей), ЛС, уведомления, модерация,
  модалки жалобы и поддержки, presence-чип, рекламный слот. Описания — i18n
  `help.items.*.title/desc` ×3 локали → **394 ключа всего**. Где HTML собирается
  в JS — `dataset.help` (внутренности рекордера, форма жалобы, мини-маркеры ленты).
- CSS: `.help-spot`/`.help-pop`/`.help-banner`, `body.help-active` (cursor: help
  + подсветка «?»), `.help-section`; слои z-index 2998/3000 (выше модалок 500).
- **Конвенция** (в «Важных заметках»): новый интерактивный элемент ⇒ `data-help`
  + `help.items` в трёх локалях; целостность проверяет `check_help_catalog.cjs`.
- Тесты: `test_help.mjs` (8 секций: режим/перехват/фолбэк/выход/клавиши/wheel/тур/
  maybeAutoTour//help) + `check_help_catalog.cjs`. Все 26 тестов зелёные.
  БД не менялась (`DEMO_DB_VERSION = 6`).

### 2026-10-11 — «Кто онлайн»: стек аватарок + список вместо голого счётчика
- Эволюция presence по просьбе заказчика: видно НЕ только сколько, но и кто.
- **UI**: чип в шапке ленты и в сайдбаре вопроса (`createPresenceWidget` в
  presence.mjs): стек до 4 аватарок внахлёст + «+N», текст с плюрализацией и
  «· +G гостей»; клик по чипу — выпадающая панель «Сейчас онлайн»: имена-ссылки
  на профили (data-route), пометка «(вы)», строка гостей; клик мимо — закрыть.
- **Гости** (анонимы) NEVER персонально — только счётчиком (приватность анонимов).
- **Приватность**: тумблер «Не показывать, что я онлайн» в «Настройках профиля»
  (`profiles.hide_online`, ALTER в setup.sql/setup_part1.sql, автосохранение как
  остальные тумблеры). Opted-out не track'ится в бою и исключён из демо-пула;
  остальных видеть может. Сид: u-lena.hide_online = true.
- **Демо**: пул = getDemoPresencePool() (сид-профили без hide_online и без вас),
  суточная кривая + ротации на тиках; гости 0..7. **Реал**: presence track'ит
  {uid, username, avatar_url, guest}; список строится из presenceState.
- Payload подписок теперь { users[], guests, total } (было — число).
- i18n: +6 ключей (presence.who/you/empty_list/guests[]/viewing[], profile.
  hide_online) ×3 → 380 ключей. CSS: стек, панель, mini-вариант сайдбара.
- Тест `test_presence.mjs` переписан (payload, виджет+панель, opt-out, тики).
  Все 25 тестов зелёные.

### 2026-10-11 — Три правки аудио-UI (жалобы заказчика)
1. **`mark-play` (триммер): всегда с начала маркера.** Раньше ▶ при паузе
   «продолжал с паузы» — inconsistently с плеером и лентой, где повторный клик
   стартует маркер заново. Теперь единообразно: клик по играющему маркеру —
   пауза, любой другой клик — ВСЕГДА с начала маркера (trimmer.mjs).
2. **`mini-wave` (лента): маркеры свежих записей больше не «подвисают».**
   Причина: webm от MediaRecorder выходит БЕЗ Duration в Segment/Info (live-
   поток) — Chrome показывает Infinity и ищет позицию сканированием файла.
   Лечение: `fixWebmDuration()` в audio.mjs — EBML-патч (вставка/правка
   Duration в Info с учётом TimecodeScale, корректная пересборка размеров
   vint; mp4/AAC и не-webm — no-op), вызывается в `encodeOpus` сразу после
   записи. Плюс: `preload='auto'` у превью-аудио и мигающий класс `.loading`
   на чипе до события `playing` (честная обратная связь). Юнит-тест: синтетический
   webm (Segment с unknown-size) → Duration вшит, кластер не поехал, in-place
   патч готового Duration, no-op для mp4/нулевой длительности.
3. **`ab-player`: редизайн по просьбе заказчика.** Кнопки play (и переключателя
   A/B) больше нет: клик по стороне A = play/pause трека A, клик по B = play/pause
   B; старт ВСЕГДА с 0:00; играет одна сторона; playing-подсветка бейджа;
   клавиши A/B/Space = те же клики (Space — активная сторона); процентная
   синхронизация и перемотка кликом по вейвформе убраны; ended → сброс в 0.
   `ab_hint` переписан ×3 локали (ab_compare остался — это кнопка ОТКРЫТИЯ сравнения).
- Тест `test_ab_player.mjs` переписан под новую семантику; `test_marker_drag.mjs`
  (секции 7–8) обновлён (resume заменён на рестарт, +1 инстанс превью);
  `test_opus_encode.mjs` +секция 8 (EBML). Все 25 тестов + check + 376 ключей зелёные.
- Файлы: `audio.mjs` (fixWebmDuration, encodeOpus, startPreviewAt, createABPlayer,
  bindABKeys), `trimmer.mjs` (mark-play), CSS (.marker-chip.loading, .ab-row.playing),
  локали (ab_hint), тесты, tmp_tests/README.

### 2026-10-11 — Поддержка авторов и проекта, модель A (деньги мимо платформы)
- Решение заказчика: модель A («способы автора + спасибо»), точки входа — чип
  «☕ Поблагодарить» на чужих ответах + ☕ на профиле + подвал (проект).
- **Суть**: платформа НЕ проводит платежи (нет юрлица/агентства/115-ФЗ, всё
  российское: СБП/ЮMoney/Boosty/DonationAlerts/Telegram). Получатель сам
  настраивает способы в «Настройках профиля» → секция «☕ Поддержка мне»
  (тип/значение/подпись, автоопределение типа по ссылке/телефону — detectDonateKind,
  автосохранение через существующую очередь saveQueue). Хранение:
  `profiles.donate_methods jsonb` (ALTER в setup.sql/setup_part1.sql).
- Модалка поддержки (support.mjs переписан): способы кнопками «Перейти» (ссылки,
  target=_blank) / «Скопировать» (clipboard, фолбэк-тост со значением) + блок
  бесплатного «спасибо» (сообщение → `donations.kind='thanks'`, amount=0 →
  счётчик ☕ на профиле + уведомление автору type 'support' с иконкой ☕).
  Дисклеймер «платформа не проводит платежи» + подсказки, когда способов нет.
- Проект: способы в `CONFIG.DONATIONS_PROJECT` (владелец правит в конфиге);
  «спасибо» проекту — recipient_user_id = null (как и задумано с самого начала).
- `ENABLE_DONATIONS` переключен в **true** (слой безопасен: денег в платформе
  нет); false прячет кнопки/модалку в заглушку.
- SQL: profiles.donate_methods; donations.kind ('paid'|'thanks') + amount >= 0
  (ALTER-ы идемпотентны, работают и на существующей БД).
- i18n: +17 статических ключей (support.kind_*/go/copy/copied/no_methods_*/
  thanks_*/disclaimer, profile.donate_*, answer.thanks_btn, notifications.
  type_support) ×3 → 376 ключей; soon_text переосмыслен (флаг, а не «платежи скоро»).
- CSS: .sup-methods/.sup-method/.sup-thanks/.sup-disclaimer, .donate-row (адаптив).
- `donate_methods` добавлен в DEMO_MIGRATE_PROFILE_FIELDS (переживёт будущие
  пересиды); сиды: u-anna 3 способа, u-max 1, kind у демо-донатов. Версию демо-БД
  НЕ повышали (изменения аддитивные — по новой дисциплине версионирования).
- Модель B (платежи внутри платформы, ЮKassa с выплатами авторам) — в дорожной
  карте: UI модалки уже рассчитан на вставку провайдера блоком без смены сигнатур.
- Тест: `test_donations.mjs` (25-й; 6 секций: детект видов, автосохранение
  способов, модалка+копирование+спасибо+уведомление, чипы на ответах (не на своих),
  проект, флаг-off). Все 25 тестов + check + check_keys зелёные.

### 2026-10-11 — Присутствие («N человек онлайн») вместо общего чата
- Вопрос заказчика: «есть ли смысл делать общий чат, если есть лента с
  комментариями?» Анализ: чат до запуска = мёртвая комната (нужны одновременные
  онлайны) + модерационный поток ×10 + размывание ядра «звук → ответ»; комментарии
  под вопросами уже копят знания, ЛС закрывают приватность. **Решение: чат НЕ
  строить** (бэклог с триггером ≥1,5–2k DAU или явный запрос сообщества).
- Вместо него — realtime-присутствие: новый `presence.mjs` (30-й модуль):
  лента → чип «🟢 N человек онлайн» (page-head), страница вопроса → строка
  «Сейчас смотрят: N» в статистике сайдбара. Показываем ТОЛЬКО счётчик
  (приватность: без списка участников).
- Демо — честная симуляция: суточная кривая (пик ~20:00, спад ~05:00) + блуждание
  ±1; зрители вопроса — от популярности (1 + min(6, лайки/8)). Реал — Supabase
  Realtime presence: каналы presence:global / presence:q:<id>, track своего
  клиента, счёт по presence-ключам.
- Конфиг: `FEATURES.PRESENCE: true` (выключается одним флагом), `PRESENCE_TICK_MS`.
- Cleanup: подписки снимаются перерисовкой ленты и уходом с вопроса (таймеры не
  текут между экранами — проверено тестом через presenceScopeCount()).
- i18n: presence.online (плюрализация ×3), presence.viewing_short ×3 → 366 ключей.
  CSS: .presence-chip + пульсирующая зелёная точка.
- Тест: `test_presence.mjs` (24-й: noop-флаг, тики/коридор/cleanup, базы от
  популярности, UI ленты и вопроса, плюрализация). Все 24 теста зелёные.

### 2026-10-11 — Deploy-комплект для живого прогона (Selectel, аккаунт заведён)
- Заказчик: живой прогон по ранбуку; аккаунт Selectel есть, не оплачен (старт —
  приветственный бонус или пополнение ~5 000 ₽).
- Новые скрипты `deploy/` (bash -n зелёные): `bootstrap.sh` (пакеты/ufw/docker/
  supabase-стек/секреты НА СЕРВЕРЕ в /root/samplehelp-secrets.txt/health-чек),
  `configure-s3.sh` (Selectel S3 как STORAGE_BACKEND=s3; один физический бакет —
  логические бакеты storage.sql живут префиксами), `apply-sql.sh` (setup.sql +
  storage.sql в контейнер db), `backup-install.sh` (pg_dump|gzip → S3 по cron
  04:17), `nginx-sample.conf` (SPA try_files + прокси db.-субдомена на kong c
  WebSocket + client_max_body_size 30m под лимит Этапа 3).
- DEPLOY_SELECTEL.md: Этап 1 ссылается на скрипты; код приложения не менялся.
- Живой прогон Opus/реалам-функций — сразу после apply-sql: config.mjs ←
  SUPABASE_URL=http://<IP>:8000 + anon-ключ из secrets-файла, npm start локально.

### 2026-10-11 — Целевая инфраструктура: Selectel + self-hosted Supabase (решение)
- Контекст: санкции/оплата/152-ФЗ. Облачный Supabase из РФ не оплатить, аккаунт под
  комплаенс-риском, ПДн РФ-граждан по 152-ФЗ должны храниться в РФ; Cloudflare
  приостановил продажи в РФ; Stripe не работает. Selectel/Яндекс — рублёвые и РФ.
- Ключевой факт: Supabase — open source → весь стек (Postgres+RLS, Auth/OAuth,
  Realtime, Storage, Studio) поднимается docker-compose на VPS Selectel;
  **код приложения не меняется** (SUPABASE_URL в config.mjs). Переписывание слоя
  данных под «нативный» бэкенд отклонено (месяцы работы, потеря RLS).
- Расчёт под фактическую планку заказчика **1 000 DAU**: VPS 2vCPU/8GB 3 609 ₽ +
  диск ~400 ₽ + сеть/IP от ~1 140 ₽ + S3 ~40 ₽ + бэкапы ~100 ₽ + домен ~50 ₽;
  **CDN = 0 ₽** (3 ТБ внешнего трафика VPS бесплатно при egress 25–35 ГБ/мес);
  итого ≈ **5 340 ₽/мес**; до выкладки — 0 ₽. Цель 10k DAU ≈ 7 830 ₽/мес.
- Зафиксировано: новый ранбук `DEPLOY_SELECTEL.md` (Этапы 0–4: подготовка, стек,
  S3-бакеты, setup.sql/storage.sql, бэкапы в S3 «Ледяное», nginx+Let's Encrypt,
  SMTP RU, метрика/реклама, триггеры роста); SCALE_PLAN помечен ревизиями
  (Этапы 1 и 4 выполняются по ранбуку вместо облачных версий).
- Код не писался (задача-решение): только документы.

### 2026-10-11 — Фикс: демо-сброс настроек при обновлении кода (мягкий пересид)
- Баг (жалоба заказчика): после обновления кода аватар в шапке (`.avatar`) остаётся,
  а в профиле (`.avatar lg`) исчезает и все настройки сбрасываются.
- Причина: два хранилища LocalStorage — `samplehelp_demo_session` (без версии,
  держит user с avatar_url → шапка живёт) и `samplehelp_demo_db` (с `v:`; при
  несовпадении версии `loadDemo()` брал чистые сиды → профиль/настройки гибли).
  Версию повышали при каждом изменении сидов (v5, v6) — отсюда «каждый раз».
- Лечение (вариант A+D заказчика): **мягкий пересид** — при несовпадении версии
  пользовательские поля строки профиля (username/bio/avatar_url/links/
  open_to_collab/cover_style) и словари (software/skills/arsenal) ПЕРЕНОСЯТСЯ
  из старого снапшота поверх новых сидов (`migrateDemo`); снапшет сразу
  фиксируется новой версией; пользовательский контент (вопросы и т.п.) сбрасывается
  к сидам — осознанно и честно объявляется тостом `demo.reseeded` (v{from}→v{to})
  из main.mjs через `takeDemoReseedNotice()` (одноразово).
- Консистентность: `syncDemoProfileFromSession(user)` в restoreSession (auth.mjs) —
  если сессия свежее базы (база пересоздана), поля сессии копируются в строку
  профиля: шапка и профиль больше не могут показать разные аватары.
- В БОЮ (Supabase) проблемы нет и не было: данные живут в БД, не в LocalStorage.
- Тест: `tmp_tests/test_demo_migration.mjs` (23-й; «новые сессии браузера» —
  повторные импорты модуля с query-суффиксом): миграция полей, одноразовость
  уведомления, сброс пользовательского контента, фикс версии, полный реставр
  при совпадении версии, синк сессии. Все 23 теста + check + check_keys зелёные.

### 2026-10-11 — Приоритет 1, п. 2–3: Яндекс.Метрика за флагом + OG/sitemap/robots
- **`metrika.mjs`** (29-й модуль): официальный сниппет (асинхронный tag.js, очередь
  ym) + **SPA-хиты**: подписка на `route` в store → `ym(id,'hit',url)` на каждую
  смену экрана (History API сам pageview не порождает), дубли того же URL гасятся.
  Грузится ТОЛЬКО при `ENABLE_METRIKA && counterId && !IS_DEMO && не localhost`
  (дев-прогоны не засоряют статистику). `webvisor` по умолчанию ВЫКЛ (приватность:
  запись сессий — осознанное решение), clickmap/trackLinks/accurateTrackBounce вкл.
  Включение: metrika.yandex.ru → номер счётчика → `CONFIG.METRIKA.counterId` → флаг true.
- **SEO-статика**: OG/twitter/canonical в `index.html` (og:title/description/type/
  url/image/locale + alternate en/de, twitter:card summary_large_image);
  **`public/assets/og-cover.png`** 1200×630 — бренд-картинка (тёмный фон, медная
  вейвформа, «SampleHelp — как сделать такой звук?», PT Sans OFL); `robots.txt`
  (Allow /, Disallow служебные: ask/favorites/messages/moderation/маркет-заглушки,
  Sitemap-строка); `sitemap.xml` (заглушка до динамической генерации).
- **Домен — placeholder `samplehelp.example`** (RFC-зарезервирован, никогда не
  резолвится): заменить на реальный на Этапе 4 в index.html (og:url/canonical),
  robots.txt, sitemap.xml — зафиксировано в SCALE_PLAN (чек-лист Этапа 4) и
  комментариях файлов. Динамические OG вопросов + динамический sitemap — Этап 4
  (Cloudflare Pages Functions/Worker).
- Тест: `tmp_tests/test_metrika_seo.mjs` (22-й): no-op при выключенном флаге/в демо,
  debugForce, tag.js один раз, опции init, SPA-хиты без дублей, статика SEO
  (OG-теги, robots, sitemap, PNG 1200×630 по IHDR).
- Попутно: `test_filelist_roundtrip.mjs` научился бинарникам — список исключений
  берёт ИЗ САМОГО ДАМПА (пометки «Тип: Изображение/Бинарный файл»); ранее сравнивал
  все файлы и сломался бы на первом же png.
- Файлы: новые `public/js/metrika.mjs`, `public/robots.txt`, `public/sitemap.xml`,
  `public/assets/og-cover.png`, `tmp_tests/test_metrika_seo.mjs`; правки
  `config.mjs`, `main.mjs`, `index.html`, `test_filelist_roundtrip.mjs`, README,
  tmp_tests/README, SCALE_PLAN, WORKLOG.

### 2026-10-11 — Жалобы «⚑ Пожаловаться» + экран модерации (Приоритет 1, п. 1)
- Задача заказчика (из предложений ассистента): must-have для UGC перед запуском —
  механизм жалоб и минимальная модерация; synergy с Этапом 3 (DMCA/Terms).
- **SQL** (setup.sql + setup_part1.sql, идемпотентно): таблица `reports`
  (reporter_id, target_type question|answer|comment, target_id, reason
  spam|offense|copyright|other, note, status new|dismissed|actioned,
  moderator_note, resolved_at; **unique (reporter_id, target_type, target_id)** —
  защита от спама жалобами); `profiles.is_admin` (default false — владелец
  выставляет себе в Dashboard); RLS: вставка/чтение своих — любому авторизованному,
  чтение всех и смена статуса — админу; политики `*_admin_delete` на
  questions/answers/comments (OR-ятся с владельческими).
- **Слой данных** (supabase.mjs): `submitReport` (duplicate → err.code),
  `fetchReports(status)` — для админа, с джойном содержимого целей и авторов
  (цель удалена → target: null), `setReportStatus`, `removeReportedContent`
  (удаляет контент штатными delete* — в реале права даёт RLS, и закрывает жалобу).
  Демо-ветки у всех; сиды: 3 жалобы (2 новых + 1 отклонённая), u-demo — админ;
  `DEMO_PERSIST_KEYS` += reports; **DEMO_DB_VERSION 5→6**.
- **Новый модуль `moderation.mjs`** (28-й): `openReportModal(type, id)` — модалка
  (4 причины-чипа + пояснение ≤500 + отправка; duplicate → тост, модалка открыта)
  и `renderModeration` — экран `/moderation` (только is_admin, иначе редирект в
  ленту): вкладки «Новые/Все», карточки жалоб (бейдж причины, тип цели, контент
  цитатой, автор, жалобщик, чипы статусов), «Отклонить» и «Удалить контент»
  (с confirmModal).
- **Кнопки жалобы** (не на своё): сайдбар страницы вопроса («⚑ Пожаловаться» под
  «Поделиться»), чип ⚑ в answer-actions у чужих ответов, ⚑ у чужих комментариев;
  обработчики — в общем делегировании bindAnswersEvents (работает и в ленте при
  раскрытии ответов). Гостям — requireAuth.
- **Меню аватара**: пункт «🛡 Модерация» только для админов (auth.mjs).
- **Роут**: `/moderation` в main.mjs.
- **i18n**: +28 ключей ×3 локали (nav.moderation; report.* ×13; moderation.* ×14;
  из них 9 вызываются динамически — reason_*/target_*/status_* — и присутствуют во
  всех локалях; счётчик check_keys 344→363 считает только статические t()).
- **CSS**: чипы причин, .btn-danger, карточки .mod-* (медный акцент на цитате цели).
- Тест: `tmp_tests/test_moderation.mjs` (21-й; 5 секций: сиды/модалка+duplicate/
  слой данных и права/экран модерации с вкладками и действиями/кнопки на странице
  вопроса). `test_best_answers` — ассерт версии сделан версионно-устойчивым (>=5).
- Файлы: новые `public/js/moderation.mjs`, `tmp_tests/test_moderation.mjs`; правки
  `supabase.mjs`, `question.mjs`, `auth.mjs`, `main.mjs`, `style.css`,
  `supabase/{setup,setup_part1}.sql`, локали ×3, README, tmp_tests/README.
- Следующие из Приоритета 1: Яндекс.Метрика за флагом; OG-теги + sitemap/robots
  (динамические OG — вместе с Этапом 4, на Cloudflare Worker/Functions).

### 2026-10-11 — Рекламные блоки Яндекс РСЯ: инфраструктура за флагом ENABLE_ADS
- Задача заказчика: монетизация через рекламу (Яндекс); слоты — **лента** (каждая
  6-я карточка) + **сайдбар страницы вопроса**; строить сразу, включение — после домена.
- Новый модуль `public/js/ads.mjs` (провайдер-агностичные слоты):
  - три режима: `off` (флаг выключен — в DOM ноль следов), `placeholder` (демо/
    localhost/пустой ID — пунктирная заглушка, внешний код НЕ грузится), `live`
    (реальный рендер Яндекса);
  - live: однократный лоадер (yastatic), очередь `window.yaContextCb` (офиц. паттерн
    SPA), `Ya.Context.AdvManager.render({blockId, renderTo(уникальный на маунт),
    darkTheme, statId, onRender, onError})`; пустой слот снимается (onError или
    guard `emptyGuardMs`) — нет «дыр» при отсутствии инвентаря для EN/DE-трафика;
  - cleanup: снятие слота; `destroy({blockId})` — только для once-слотов (сайдбар),
    чтобы не убить соседние экземпляры того же блока в ленте.
- `config.mjs`: `ENABLE_ADS: false` + `CONFIG.ADS` (loader, darkTheme, emptyGuardMs,
  debugForceLive для тестов, blocks: feed_inline {every:6, statId:1},
  question_sidebar {statId:2, once}). ID блоков (`R-A-XXXXXX-N`) — после модерации.
- Интеграции: `main.mjs` (initAds в boot), `feed.mjs` (слоты между карточками;
  поиск карточек переведён с `children[i]` на `data-qid` — индексы съезжают из-за
  слотов; cleanup-и ленты: роутер + перерисовка сортировки без дублей),
  `question.mjs` (слот в сайдбаре между «Действиями» и «Статистикой», cleanup).
- CSS `.ad-slot/.ad-label/.ad-container` (резерв высоты до показа — анти-CLS,
  `.ad-filled` снимает резерв, плейсхолдер — пунктир в меди).
- i18n: `ads.label` («Реклама»), `ads.placeholder` («Рекламный слот») — ×3 локали → 344 ключа.
- Осознанно: НЕТ полноэкранных форматов (interstitial/Floor Ad пока отложены),
  нет рекламы в модалках и у рекордера/триммера/плееров.
- Тест: `tmp_tests/test_ads.mjs` (20-й; 6 секций, 40+ проверок: режимы, плотность,
  лоадер, очередь, render-параметры, onRender/onError/guard, destroy-семантика,
  интеграция с лентой). Все 20 тестов + check + check_keys зелёные.
- Право/деньги (зафиксировано в README «Монетизация»): маркировка erid/ЕРИР для
  РСЯ — автоматически на стороне Яндекса; жёсткого порога трафика для подключения
  нет; выплаты — физлицо (НДФЛ удерживает Яндекс) / самозанятый / ИП.
- Файлы: новые `public/js/ads.mjs`, `tmp_tests/test_ads.mjs`; правки `config.mjs`,
  `main.mjs`, `feed.mjs`, `question.mjs`, `style.css`, локали ×3, README,
  tmp_tests/README, WORKLOG.

### 2026-10-11 — Шоукейс «Моё звучание» заменён авто-витриной «Лучшие ответы»
- Решение заказчика (вариант A): убрать загрузку пользовательских треков. Причины:
  единственный путь загрузки без лимита длины (после этапа 2 длинный трек = минуты
  реального кодирования), DMCA-риск чужих треков перед запуском, стоимость хранения.
- **Новое**: `fetchBestAnswers(userId, limit=3)` в supabase.mjs — топ ответов
  пользователя СО ЗВУКОМ: принятые решения первыми, далее по лайкам; джойн вопроса
  (id/title/purged). Реал: select из answers + questions; демо: фильтр сидов +
  `demoMsg` (аудио из audio_kind).
- **Профиль**: секция «🏆 Лучшие ответы» вместо «🎧 Моё звучание» — карточки:
  заголовок вопроса (ссылка `/question/<id>` c data-route), mini-wave аудио ответа
  (attachMiniPlayer), 🔥 лайки, бейдж «✓ Решение» (`.ba-solution`). Видна всем
  (публичная). Пустое состояние — `profile.best_answers_empty`. Заголовки
  purged-вопросов — `question.purged_title`.
- **Удалено**: секция/хендлеры загрузки и удаления треков (profile.mjs),
  `fetchShowcase`/`addShowcaseTrack`/`deleteShowcaseTrack` + демо-сиды (supabase.mjs),
  таблица `user_showcase` + RLS + политики (setup.sql, setup_part1.sql — заменено
  идемпотентным `drop table if exists`), 5 i18n-ключей `profile.showcase*`,
  CSS `.showcase-*` (~25 строк). `DEMO_DB_VERSION` 4→5.
- **i18n**: +2 ключа (profile.best_answers, best_answers_empty) ×3 локали;
  всего 342 ключа. Лайки — «🔥 N» (без текста, как в ленте).
- **CSS**: `.best-answers-*`, `.ba-title`, `.ba-meta`, `.ba-solution` (медный
  градиент); переиспользованы `.counter` и `.compact-empty`.
- Тесты: новый `tmp_tests/test_best_answers.mjs` (19-й; API/сиды/синтетическая
  сортировка+limit/UI/пустое состояние/публичность/исчезновение шоукейса).
  Все 19 тестов + check + check_keys зелёные.
- Файлы: `public/js/{profile,supabase}.mjs`, `public/css/style.css`,
  `public/locales/{ru,en,de}.json`, `supabase/{setup,setup_part1}.sql`, README,
  SCALE_PLAN (примечание к п. 6), tmp_tests/README, новый тест.

### 2026-10-11 — Этап 2 SCALE_PLAN: Opus вместо WAV во всех путях загрузки
- Задача (команда заказчика): загружаемое аудио — в webm/opus 48 kbps mono вместо
  WAV (27 с ≈ 4,7 МБ → ~160 КБ, ×30); Safari-фолбэк — mp4/AAC.
- **audio.mjs** (ядро этапа):
  - `encodeOpus(buffer, {mono, onProgress})` — AudioContext → MediaStreamDestination
    → MediaRecorder в реальном времени (куски по 200 мс → плавный прогресс); стоп
    через ~120 мс после конца клипа (хвост кодировщика). Фолбэки на WAV: нет
    MediaRecorder/форматов, ошибка записи, пустой результат — загрузка не ломается
    никогда (и DOM-тесты в jsdom работают без стабов рекордера).
  - `pickRecorderMime()` — единый список форматов: webm/opus → webm → mp4 (Safari)
    → ogg/opus; `createRecorder` (захват/микрофон) теперь использует его же.
  - `normalizeToBuffer(file)` — декодирование + нормализация -1 dBFS → AudioBuffer
    (бессменная замена `normalizeAudio`, которая отдавала WAV; удалена).
  - `toMono(buffer)` — даунмикс средним по каналам; моно возвращается как есть.
  - `prepareUploadAudio(file, {onProgress})` — полный конвейер: нормализация → моно
    → пики (160) ДО кодирования → Opus. Возвращает `{blob, peaks, duration}`.
- **Все пути загрузки переключены** (п. 6 плана):
  - форма /ask: `processAudioSource` → `normalizeToBuffer` (триммер принимает
    AudioBuffer БЕЗ повторного декодирования; draft.audioBlob — теперь буфер);
    submit → `trimmer.getResult({onProgress})` (прогресс на кнопке публикации);
    режим «маркеры подвинуты, регион не тронут» → `getResult({needAudio:false})` —
    без нарезки и кодирования вообще.
  - ответы (форма на странице вопроса), чат-аудио, витрина профиля →
    `prepareUploadAudio` с прогрессом (pending-слоты / кнопка «+»).
  - `waveform_data` — пики, извлечённые ДО сжатия (п. 7); `extractWaveform` не менялась.
- **trimmer.mjs**: `sliceToBuffer` (AudioBuffer) + `sliceBuffer` (WAV — только для
  локального превью); `getResult(opts)` → `{blob, peaks, start, end, markers}`,
  blob — Opus (в jsdom/старых браузерах — WAV-фолбэк).
- **supabase.mjs `uploadAudio`**: Content-Type из blob.type + расширение в имени
  (`.webm`/`.m4a`/…) — раньше blob без имени уходил как `uid_file` без расширения
  (octet-stream); теперь `<audio>` гарантированно играет публичный URL.
- **config.mjs**: `OPUS_BITS_PER_SECOND: 48000`, `OPUS_MONO: true`.
- **i18n**: новый ключ `audio.encoding` («Кодирование… {progress}%») — ru/en/de
  (всего 345 ключей).
- Тесты: новый `tmp_tests/test_opus_encode.mjs` (18-й; 7 секций: выбор mime,
  даунмикс, WAV-фолбэки, webm/opus 48k + прогресс, ошибка рекордера, конвейер
  prepareUploadAudio с проверкой «одно декодирование», триммер с AudioBuffer/Blob).
  Все 18 тестов + check + check_keys зелёные.
- Файлы: `public/js/{audio,trimmer,question,messages,profile,supabase,config}.mjs`,
  `public/locales/{ru,en,de}.json`, README, SCALE_PLAN (этап 2 отмечен), новый тест,
  `tmp_tests/README.md`.
- ⚠️ Известный компромисс плана: webm/opus, загруженный из Chrome/Firefox, НЕ
  воспроизводится в Safari (Safari-пользователи сами пишут mp4/AAC — он играет
  везде). Если критично — решение на Этапе 3/4 (например, приоритет mp4 для всех
  или серверный транскод). Зафиксировано в «Открытых вопросах».

### 2026-10-09 — Снимок проекта: генератор + восстановитель filelist_with_content.txt
- Задача: держать дамп `filelist_with_content.txt` всегда со свежим кодом (перенос
  проекта между машинами одним файлом, архивная копия).
- `scripts/make-filelist.cjs` (`npm run filelist`) — генератор: дерево папок + полное
  содержимое текстовых файлов; формат идентичен исходному дампу (BOM, CRLF, маркеры
  [📁 ПАПКА]/[📄 ФАЙЛ], --- НАЧАЛО/КОНЕЦ СОДЕРЖИМОГО ---, разделители «=»); по умолчанию
  пишет в `../filelist_with_content.txt` (рядом с папкой проекта — чтобы дамп не попал
  сам в себя); node_modules/.git исключены; бинарники — только заголовок «Тип: …»;
  текстовые .svg сохраняются целиком (улучшение относительно исходного инструмента).
- `scripts/restore-filelist.cjs <дамп> <папка>` — восстановление проекта из любого
  дампа этого формата (включая исходный Windows-дамп): пути нормализуются, дерево
  воссоздаётся, переносы → LF, завершающий перенос добавляется.
- Все текстовые файлы проекта приведены к POSIX-конвенции (завершающий перенос строки) —
  формат дампа строчный, без этого round-trip терял бы последний байт.
- Round-trip проверен: проект → дамп → восстановление → `diff -r` → **побайтово идентично**
  (71 файл); зафиксирован тестом `tmp_tests/test_filelist_roundtrip.mjs`.
- Замеры: генерация ~0,1 с (1,23 МБ), восстановление ~0,1 с.
- Файлы: `scripts/make-filelist.cjs`, `scripts/restore-filelist.cjs`, `package.json`
  (npm-скрипт `filelist`), `README.md` (секция «📸 Снимок проекта»), `tmp_tests/README.md`,
  новый `tmp_tests/test_filelist_roundtrip.mjs`.

### 2026-10-08 — Фикс: поле имени (#ed-username) подставляло старое имя посреди ввода
- Причина: откат пустого имени в `saveNow()` выполнялся безусловно — debounce
  (700 мс), сработавший во время паузы в наборе, вставлял последнее сохранённое
  имя под курсор, текст «склеивался».
- Фикс: во время ввода (поле в фокусе) значение не подменяется; визуальный откат —
  только на `blur` или когда поле не в фокусе. В БД пустое имя не попадало и раньше
  (`currentPatch`: `username: value || lastSavedName`).
- Файлы: `public/js/profile.mjs`. Регрессия: `tmp_tests/test_settings_autosave.mjs`, секция 6b.

### 2026-10-08 — Фикс: модалка закрывалась при выделении текста за её границами
- Причина: `openModal` закрывался по `click` на оверлее; если mousedown был внутри,
  а mouseup на фоне, браузер порождает click на общем предке (оверлее).
- Фикс: закрытие по фону требует, чтобы И mousedown, И mouseup произошли строго на
  оверлее. Обратный драг (фон→модалка) тоже больше не закрывает.
- Файлы: `public/js/utils.mjs` (чинит ВСЕ модалки проекта). Регрессия:
  `tmp_tests/test_settings_autosave.mjs`, секция 11.

### 2026-10-08 — «Настройки профиля» с автосохранением + язык переехал из шапки
- Переключатель языка RU/EN/DE убран из шапки (`public/index.html`) и переехал в
  модалку «⚙ Настройки профиля» (первое поле). Обработка кликов — document-делегирование
  в `initI18n()` (`public/js/i18n.mjs`), поэтому работает для динамических переключателей.
- Кнопки «Сохранить» нет — **автосохранение**: текстовые поля (имя, био) debounce 700 мс,
  чипсы навыков 400 мс, тумблер коллабораций и пикеры (обложка/DAW/арсенал/ссылки) —
  мгновенно; сохранения через последовательную очередь (гонки исключены); при закрытии —
  flush незавершённых + перерисовка экрана профиля (MutationObserver).
- Статус-строка `#ed-autosave`: подсказка → «Сохранение…» → «Сохранено ✓» (2,5 с) → подсказка.
  Внизу «Готово» (`#ed-done`); Enter в поле = «Готово».
- Модалка переводится на глазах при смене языка: data-i18n атрибуты + слушатель
  `i18n:changed` (перерисовка пикера обложки, превью DAW/арсенала, чипсов, статуса, h2).
- Откат обложки при закрытии без сохранения удалён (не нужен — всё сохраняется сразу).
- Кнопка на профиле: ✏️ «Редактировать профиль» → ⚙️ «Настройки профиля».
- Файлы: `public/js/profile.mjs` (переписана `openEditProfileModal`), `public/js/i18n.mjs`,
  `public/index.html`, `public/css/style.css` (`.settings-footer`, `.autosave-status`,
  `.field .lang-switcher`), `public/locales/{ru,en,de}.json` (+7 ключей: profile.settings,
  settings_hint, saving, save_failed, language, language_hint, done), `README.md`,
  `tmp_tests/README.md`, обновлён `test_profile_cover.mjs`, новый `test_settings_autosave.mjs`.

### 2026-10-08 — Проект развёрнут в рабочей копии
- Восстановлен из дампа `filelist_with_content.txt` (66 файлов; бинарники
  `assets/icons/logo.svg` и `fl-studio-ref.jpg` в дампе были 0 КБ — не восстановлены).
- Прогнаны все встроенные проверки — зелёные.

## 🔜 Дальше (не начато — ждём команду)

### Бэклог
- **Паритет чипов подписки на теги (мини-заход, кандидат после QR):** заход B
  покрыл скоуп спеки — лента и ответы. Плоскими span остались: тег в шапке
  страницы вопроса (`question.mjs:119-120`), `q.synth` в списках профиля и
  «Избранного» (`profile.mjs` `questionsListHtml`, `favorites.mjs`). Механика
  готова (`tagSubChipHtml` + общий capture-обработчик) — замена точечная;
  решение за заказчиком (нужна ли подписка во всех списках сразу).
- **Квота localStorage / IndexedDB для демо-базы (зависимость QR-захода):**
  `persistDemo` при переполнении молча пишет `console.warn` (риск известен с
  захода «Поддержать автора»); QR-картинки (`qr_data_url`) усугубят — до
  QR-захода сделать квоту/IndexedDB/экспорт-импорт.
- **QR-СБП (спека PLAN_SUPPORT_PERSIST_NAV §0.5):** автор загружает картинку
  персонального QR из приложения банка + название банка (`qr_data_url`/`bank`
  зарезервированы в jsonb `donate_methods`), даунскейл ~600px, лимит
  ~300–400 КБ, в модалке ~260px с зумом. Порядок: сначала квота/IndexedDB.
- **Разморозка i18n (возврат EN/DE):** решение 2026-10-11 — заморозка на ru-only
  (см. «Сделано»). Триггер пересмотра: устойчивые >5–10% не-RU трафика по отчёту
  «География» в Яндекс.Метрике. Порядок возврата — `locales_archive/README.md`
  (досинхронизировать словари → `CONFIG.LOCALES` → переключатель в настройках →
  `og:locale:alternate` → список `LOCALES` в валидаторах). Вопрос «язык для
  гостей» снят тем же решением: гости получают ru + встроенный перевод браузера.
- **Общий чат — ОТКЛОНЁН до запуска** (решение 2026-10-11, вместо него сделано
  presence): мёртвая комната при малых DAU, модерационный поток, размывание ядра
  продукта. **Триггер возврата:** стабильные ≥1,5–2k DAU ИЛИ явный запрос
  сообщества. Если строить — мини-вариант: одна комната «флуд» на том же
  Realtime (пайпы messages.mjs) + жалобы/мьют из moderation.mjs.

### Из SCALE_PLAN.md (план согласован; Этап 2 — Opus — ✅ выполнен 2026-10-11)
1. **Этап 1 — добить Supabase:** выполнить `setup.sql` + `storage.sql` в SQL Editor;
   проверить бакеты и политики; решить вопрос Confirm email (выключить vs SMTP
   Brevo/Resend); вписать ключи в `config.mjs`, выключить демо, протестировать
   регистрацию и загрузку аудио (заодно — живой прогон Opus-конвейера в браузере).
2. **Этап 3 — предстартовая защита:** Terms / Privacy / DMCA-страницы, Sentry free,
   лимит исходного файла ~25 МБ, rate-limits.
3. **Этап 4 — выкладка:** домен → Cloudflare DNS; фронтенд на Cloudflare Pages
   (`_redirects`: `/* /index.html 200`, server.js не нужен). Чек-лист замены
   placeholder-домена `samplehelp.example` на реальный: `index.html` (og:url,
   og:image, canonical), `robots.txt` (Sitemap), `sitemap.xml`; там же включить
   динамические OG вопросов и динамический sitemap (Pages Functions/Worker).
4. **Включение аналитики и рекламы (после Этапа 4):**
   - Метрика: metrika.yandex.ru → номер счётчика → `CONFIG.METRIKA.counterId` →
     `ENABLE_METRIKA: true` (в демо/на localhost не грузится сама); webvisor
     включать осознанно (приватность, упоминуть в Privacy);
   - Реклама: регистрация площадки в Яндекс.Рекламе → модерация (~1 день) →
     создать RTB-блоки (тёмная тема; лента + сайдбар, можно добавить Floor Ad
     mobile) → вписать ID в `CONFIG.ADS.blocks` → `ENABLE_ADS: true` → следить за
     statId-срезами; для прямых продаж мест (без РСЯ) — своя маркировка через ОРД.
5. **Этап 5 — мониторинг:** Usage раз в месяц; триггеры egress > 250 ГБ / storage > 80 ГБ / MAU > 100k.

### Открытые вопросы (обсуждались, решения нет)
- **SPA-fallback отдаёт index.html для путей с точкой (находка 2026-10-13,
  НЕ правлена — ждём решения):** запись «заморозка i18n» утверждает в смоке
  `/locales/en.json → 404`, но `server.js` имеет catch-all `app.get('*')` →
  любой неизвестный путь (включая `/locales/en.json`) отдаёт `index.html`
  с 200. Расхождение «журнал vs код» существовало до восстановления рабочей
  копии. Лечение (если согласуют): fallback только на маршруты без точки в
  последнем сегменте (`if (!/\.[^/]+$/.test(path)) …`), иначе `next()` → 404.
  На Cloudflare Pages (Этап 4) поведение задаёт `_redirects` — там та же
  проблема не возникает.
- **Монетизация:** `ENABLE_MONETIZATION` = false (маркет/премиум — заглушки, ждать
  решения). Донаты **ВКЛЮЧЕНЫ по модели A** (2026-10-11): платформа не проводит
  платежи, авторы настраивают способы сами, «спасибо» и счётчики работают;
  модель B (ЮKassa с выплатами авторам) — при появлении юрлица. Реклама — за
  `ENABLE_ADS`, включится после домена и модерации.
- **Серверная приватность контактов (появилось с «Контактами», 2026-10-11):**
  сейчас «только залогиненным» и маска e-mail/телефона — клиентские: RLS-политика
  `profiles_public_read (using (true))` отдаёт строку профиля целиком, поэтому
  значение видно в DevTools и в сыром ответе PostgREST. Полноценное решение на
  Этапе 3 (боевой режим): вью `profiles_public` без колонки `contact` (+ права
  на `profiles` вместо `select *`), RPC `reveal_contact(profile_id, kind)` с
  проверкой `auth.uid()`, записью в лог раскрытий и rate-limit; тогда же —
  пункт о ПДн (152-ФЗ) в Terms/Privacy и, при желании, подтверждение e-mail/
  телефона кодом (нужен SMTP/SMS-провайдер).
- **Обнаруживаемость контактов при выключенном бейдже (2026-10-11, поправка
  захода A):** выбрали правило «бейдж — единственная точка входа» (вариант
  «видно только владельцу»), поэтому участник, заполнивший контакты, но не
  включивший «Открыт к коллаборациям», остаётся недоступным для связи. Сейчас
  это закрыто подсказками в настройках (`profile.collab_hint`, `#ed-collab-warn`)
  и галочкой в онбординге. Отклонённые альтернативы: отдельная иконка 📇 в ряду
  действий шапки и бейдж «📇 Контакты» при выключенном тумблере. Вернуться к
  вопросу, если Метрика покажет заметную долю профилей «контакты есть, бейдж
  выключен».
- **Safari и webm/opus (появился с Этапом 2):** семплы, загруженные из Chrome/Firefox
  (webm/opus), не воспроизводятся в Safari; сами Safari-пользователи пишут mp4/AAC
  (играет везде). Варианты, если окажется критично: кодировать ВСЕХ в mp4/AAC
  (шире совместимость, ~×2 к размеру против opus), либо транскод на бэкенде
  (Cloudflare Worker/функция) — решение принять до Этапа 4 (выкладка).

## ⚠️ Важные заметки

- **Монетизация (решение 2026-10-13, опрос):** платёжный эквайринг (ЮKassa для
  самозанятых и аналоги) НЕ подключаем вовсе. Причины: НПД (422-ФЗ) запрещает
  самозанятому агентские схемы и перепродажу — деньги АВТОРОВ нельзя проводить
  через кассу платформы (вся сумма стала бы доходом заказчика с лимитом
  2,4 млн ₽/год); лимит приёма с карт 500 тыс ₽/мес; подключение требует
  реального домена, оферты и модерации сайта. Доход платформы — РСЯ
  (`ENABLE_ADS`, после Этапа 4) и донаты модели A мимо платформы; премиум и
  маркетплейс — отложены до перехода в юрлицо/ИП или альтернативного решения.
  Донаты авторов НЕ трогаем: модель A (СБП/карта напрямую) + будущий QR-заход.
- **Живой прогон по `DEPLOY_SELECTEL.md` — ПАУЗА по оплате**: аккаунт Selectel
  заведён, НЕ оплачен. Точки входа: приветственный бонус/тестовый период (проверить
  в панели) или пополнение ~5 000 ₽ (месяц конфигурации 2vCPU/8GB). Deploy-комплект
  `deploy/` готов и проверен (bash -n), секреты генерятся на сервере; после старта
  сервера — живой прогон Opus/Realtime против реального бэкенда (п. 1.11 ранбука).

- В начале каждой сессии (или после свежего checkout) ставить зависимости:
  `npm install && npm install jsdom --no-save` — node_modules не хранятся в репозитории.
- DOM-тесты требуют jsdom: `npm install jsdom --no-save`. Последующий обычный
  `npm install` его СНОСИТ (пакет не в package.json) — переустанавливать.
- Все команды — из корня проекта (`cd samplehelp`).
- ⚠️ **Ловушка песочницы (2026-10-11):** в python-heredoc литерал абсолютного пути
  до рабочей папки подменяется на `$ARENA_WORKSPACE`, поэтому сравнение строк
  «молча» расходится (assert падает на визуально идентичном тексте). В скриптах —
  относительные пути или регулярки; `pkill`/`ps`/`curl` в окружении нет — процессы
  искать по `/proc/*/cmdline` (осторожно: шаблон поиска не должен совпасть с
  собственной командой, иначе скрипт убьёт сам себя).
- Новые пользовательские строки — только через `t()`/`tp()` и только в **ru**
  (заморозка ru-only от 2026-10-11: `CONFIG.LOCALES = ['ru']`, словари en/de — в
  `locales_archive/`) — `check_keys.cjs` строго проверяет.
- **Конвенция справки (2026-10-11)**: каждый новый интерактивный элемент получает
  `data-help="ключ"` (или `dataset.help` в JS-сборке) и пару `help.items.<ключ>.title/desc`
  в ru. Целостность каталога — `node tmp_tests/check_help_catalog.cjs`
  (пропуски и сироты — ошибка); запускать вместе с `check_keys.cjs`.
- Чек-лист перед «сдачей» задачи: `npm run check` + все `tmp_tests/test_*.mjs` +
  обновить этот WORKLOG (и README//tmp_tests/README, если задето поведение).
- Демо-данные персистятся в localStorage/IndexedDB (`DEMO_DB_VERSION = 16` в
  `supabase.mjs`; поправлено 2026-10-16: в тексте было устаревшее 9); при
  изменении структуры демо-сидов версию повышать.
  С v9 повышение версии = **мягкий пересид с переносом ВСЕГО пользовательского
  контента** (вопросы/ответы/комментарии/сообщения/лайки/избранное/подписки/
  донаты/жалобы/уведомления/достижения — `migrateDemo`), чисткой «висяков» и
  правкой счётчиков; поля профиля
  (аватар/био/ссылки/обложка/коллабы/способы приёма/контакты/согласие;
  `payment_markers` из списка убран — поля больше нет) и словари (DAW/арсенал)
  мигрируют поверх новых сидов, пользовательский контент ПЕРЕНОСИТСЯ
  (механизм v9, см. «Сделано» захода «Поддержать автора»), демо-контент
  обновляется с честным тостом `demo.reseeded`; шапка и профиль
  консистентны (`syncDemoProfileFromSession`).
  ⚠️ В тестах с повторным импортом `supabase.mjs?suffix` каждый экземпляр живёт
  СВОЕЙ копией демо-базы: возвращать сид-состояние нужно через тот экземпляр,
  который использует проверяемый модуль (иначе UI-секции увидят старые данные).
- **Контакты и персональные данные (2026-10-11):** телефон и e-mail — ПДн
  (152-ФЗ), поэтому публикуются только при `contact_consent = true` (в онбординге
  согласие проставляется явно вместе с контактом, «Пропустить» — не проставляет).
  Любое новое поле с контактными данными добавлять в `normalizeContacts()`
  (whitelist типов, длина, ужесточение `visibility`) и в матрицу `canSeeContact()`,
  а не рендерить «в лоб».
- **Правило видимости контактов (после поправки 2026-10-11):** нужны ОБА тумблера —
  `open_to_collab` (бейдж = единственная точка входа, модалка «Как связаться») и
  `contact_consent` (152-ФЗ). Правит видимостью одна функция `canSeeContact()`;
  чипы рендерятся только внутри модалки — в DOM страницы профиля значений нет.
  Онбординг включает бейдж вместе с контактом (галочка `#ob-collab`), иначе
  записанный контакт не увидел бы никто. В настройках — два независимых
  предупреждения: `#ed-consent-warn` и `#ed-collab-warn`.
- Дизайн-конвенции: тёмная тема, медные акценты (--copper-1/2/3), все стили —
  в `public/css/style.css` (CSS-переменные в :root).

## 🧪 Команды быстрой проверки

```bash
cd samplehelp
npm install && npm install jsdom --no-save   # зависимости + jsdom для DOM-тестов
npm run check                                # валидатор графа модулей
node tmp_tests/check_keys.cjs                # i18n-ключи из кода есть в ru
node tmp_tests/check_help_catalog.cjs        # каталог справки: data-help ↔ help.items (ru)
for t in tmp_tests/test_*.mjs; do node "$t" >/dev/null 2>&1 && echo "✓ $t" || echo "✗ $t"; done
npm run filelist                             # свежий снимок проекта → ../filelist_with_content.txt
npm start                                    # http://localhost:3000 (демо-режим)

# Backend (Фазы A–C): нужен PostgreSQL 15+ (в песочнице: apt-get install postgresql)
cd backend && npm install
node src/migrate.js                          # DATABASE_URL=postgres://…/sh_dev — БД+схема идемпотентно
STATIC_DIR=../public node src/app.js         # API+статика+SPA на :3100 (health: /api/health)
npm test                                     # интеграционные A+B+C (60+19+51) на живом PG: TEST_DATABASE_URL=…/sh_test
node tools/phase_c_smoke.mjs                 # ЖИВОЙ смоук api.mjs против сервера на :3100 (70 проверок)
# Фронт на backend: USE_LOCAL_BACKEND: true в public/js/config.mjs → http://localhost:3100
```
