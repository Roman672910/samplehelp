# PLAN_REAL_MODE.md — полный переход на реальный режим

**Статус: В РАБОТЕ. T0 ✅ 2026-10-21 (журнал вычищен), T1 ✅ 2026-10-21
(заход 52 — русификация /admin сдана: 20 таблиц/136 колонок, fallback,
тесты 45, превью admin-ru-preview.html, откат
rollbacks/filelist_baseline_2026-10-21_before_admin_ru.txt). Следующий: T2
(экран #reset= + SMTP). Решения опроса 2026-10-21:
(1) уходим от демо ПОЛНОСТЬЮ — удаление supabase.mjs одним большим заходом;
(2) реальная версия живёт на своём железе (D2–D5 по DEPLOY_MINIPC.md —
железо есть/скоро будет);
(3) экран «🗄 Данные» русифицируется: русские названия таблиц/колонок +
оригинал в тултипе;
(4) значения в ячейках (статусы/перечисления) НЕ переводятся — только названия.**

## 0. Контекст и текущее состояние

Фаза C (заход 48) дала полную изоляцию демо-слоя: `supabase.mjs` (3032 стр.)
импортируется ЕДИНСТВЕННЫМ потребителем — адаптером `api.mjs`; все 15
UI-модулей ходят только через адаптер. Backend-паритет проверен живьём
2026-10-21 в песочнице: PostgreSQL 15 (`sh_dev`/`sh_test`) + `migrate.js` +
backend на :3100 + смоук `phase_c_smoke.mjs` — 71 проверка ✓; фронтовые
тесты 38/38 ✓, `npm run check` ✓ 37 модулей, i18n 525 ✓, справка 118 ✓.

Аудит демо-зависимостей (2026-10-21):
- `public/js/supabase.mjs` — демо-БД (сиды, DEMO_DB_VERSION=16, migrateDemo,
  persistDemo в localStorage); потребитель — только `api.mjs` (демо-ветка
  делегирования).
- Флаги/упоминания демо в 7 UI-модулях: `achievements.mjs`, `ads.mjs`,
  `auth.mjs`, `config.mjs`, `main.mjs`, `metrika.mjs`, `presence.mjs`
  (IS_DEMO-проверки, демо-аккаунты, гашение Метрики/рекламы в демо).
- Тесты: 22 из 42 файлов `tmp_tests/test_*.mjs` импортируют `supabase.mjs`,
  24 завязаны на демо-состояние; `test_api_adapter.mjs` тестирует обе ветки.
- `server.js` (корень) — демо-статика :3000; в реальном режиме дублирует
  `backend/src/app.js` (STATIC_DIR + SPA-fallback).
- i18n: секция `demo.*` (6 ключей) + точечные упоминания; пункты справки с
  упоминанием демо.
- Должок Фазы C: экран `#reset=` — backend-эндпойнты ГОТОВЫ
  (`POST /api/auth/reset-request`, `POST /api/auth/reset-confirm`,
  reset_tokens 1 ч, одноразовые; `mailer.js` без SMTP логирует ссылку —
  dev-фолбэк), фронта нет. В реальном режиме это критический путь
  (восстановление пароля).

Устаревшие пункты бэклога «Дальше» (помечены в WORKLOG 2026-10-21):
- **QR-СБП — ВЫПОЛНЕН 2026-10-13** (QR-заход + Boosty + фишинг-разбор jsQR).
- **Квота localStorage/IndexedDB — ОТМЕНЁН**: касался только демо-базы;
  после удаления демо (T3) данные живут в PostgreSQL.

## T0 — чистка журнала (без кода) — ✅ фактически выполнен 2026-10-21

WORKLOG: пункты QR-СБП и квота/IndexedDB в «Дальше» помечены как
выполненный/устаревший; запись в «В работе» о решениях опроса и этом плане.

## T1 — русификация «🗄 Данные» (/admin) — ✅ ВЫПОЛНЕН 2026-10-21 (заход 52)

Масштаб (по information_schema `sh_dev`, 2026-10-21): **20 видимых таблиц,
137 видимых колонок** (refresh_tokens/reset_tokens и users.password_hash
скрыты backend'ом — в словарь не входят).

### 1.1 Словарь (ru.json, секция `admin_db.schema`)
- `admin_db.schema.<table>` — русское имя таблицы (20 ключей).
- `admin_db.schema.<table>.<column>` — русское имя колонки (137 ключей;
  вложенность допустима — ru.json уже содержит многоуровневые секции).
- Имена таблиц (Приложение A): users → Пользователи, profiles → Профили,
  questions → Вопросы, answers → Ответы, comments → Комментарии,
  likes → Лайки, favorites → Избранное, messages → Сообщения,
  notifications → Уведомления, achievements → Достижения,
  subscriptions → Подписки, synth_catalog → Справочник синтезаторов,
  daw_catalog → Справочник DAW, user_software → Софт пользователей,
  user_arsenal → Арсенал пользователей, donations → Донаты,
  reports → Жалобы, ideas → Идеи, idea_votes → Голоса за идеи,
  owner_config → Настройки владельца.
- Колонки — по смыслу схемы (created_at → «Создано», updated_at →
  «Изменено», author_id → «Автор (id)», is_admin → «Админ» и т.д.; полный
  перечень заполняется в заход по данным `/meta` + schema.sql).

### 1.2 Рендер (admin-db.mjs)
- Список таблиц: русское имя, оригинал — в `title` (тултип) и мелким
  подстрочником (решение опроса: «русский + оригинал в тултипе»).
- Заголовки грида и модалка-карточка: русское имя колонки + 🔑 PK;
  оригинал — в `title`.
- **Fallback:** нет ключа в словаре → показываем оригинал (новые таблицы/
  колонки не ломают экран).
- Значения ячеек НЕ переводим (решение опроса) — рендер по типам остаётся
  как в заходе 50 (null —, bool ✓/✗, jsonb свёрнутый, «N ч назад», uuid
  обрезанный, url).

### 1.3 Валидация и тесты
- Динамические ключи `t()` не ловятся `check_keys.cjs` — поэтому полноту
  словаря проверяет `test_admin_db.mjs`: эталонный список 20 таблиц и их
  колонок (из schema-эталона в тесте) ↔ наличие ключей в ru.json;
  + кейс fallback (неизвестная таблица → оригинал).
- Штатно: `npm run check`, `check_keys.cjs`, `check_help_catalog.cjs`
  (новые пункты справки, если добавляются), все `tmp_tests/test_*.mjs`.
- Откат: снимок `npm run filelist` перед стартом →
  `rollbacks/filelist_baseline_<дата>_before_admin_ru.txt`.

## T2 — реальный режим: экран `#reset=` + SMTP

### 2.1 Фронт (должок Фазы C)
- Обработка хэша `#reset=<token>` (auth.mjs/router.mjs): форма «Новый
  пароль» (пароль + подтверждение, валидация как при регистрации),
  `POST /api/auth/reset-confirm { token, password }` → успех → авто-вход
  или форма входа + тост.
- «Забыли пароль?» в форме входа: `POST /api/auth/reset-request { email }`
  → нейтральный ответ («если почта зарегистрирована — письмо отправлено»),
  письмо со ссылкой `<сайт>/#reset=<token>`.
- i18n: ключи `auth.reset_*` (ru-only), пункты справки `data-help`,
  тест-файл (test_reset.mjs или секция в test_auth_i18.mjs), проверки в
  phase_c_smoke.

### 2.2 SMTP (на железе)
- `.env`: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM (конфиг уже в
  `backend/src/config.js`; без SMTP — mailer логирует ссылку, dev остаётся
  рабочим). Ранбук: DEPLOY_MINIPC.md этап «SMTP и должок #reset=».

## T3 — удаление демо-слоя (большой заход)

Порядок шагов (каждый — с зелёными проверками перед следующим):
1. **Baseline:** `npm run filelist` → снимок в `rollbacks/`.
2. **config.mjs:** `USE_LOCAL_BACKEND: true`; затем — полное удаление флага
   и `IS_DEMO` (api.mjs становится одноветочным). `API_URL` остаётся
   (адрес backend'а).
3. **api.mjs:** удалить демо-ветку делегирования и `демо-*` функции;
   LOCAL-логика (JWT, single-flight refresh, Socket.IO) становится
   единственной.
4. **supabase.mjs:** удалить файл (3032 стр.). Сиды, DEMO_DB_VERSION,
   migrateDemo, persistDemo, демо-аккаунты уходят вместе с ним.
5. **7 UI-модулей:** вычистить IS_DEMO-проверки (Метрика/реклама остаются
   за своими `ENABLE_*`-флагами; presence/achievements/main/auth — точечно).
6. **server.js:** удалить (дубль backend/src/app.js в реальном режиме);
   `package.json`: `start` → запуск backend (STATIC_DIR=public), dev-поток
   единый: PostgreSQL + `node src/app.js`. Решение финализировать в заход.
7. **Тесты (основная масса работы):** 22 файла, импортирующих supabase.mjs,
   переписать на стабы слоя `api.mjs` (in-memory мок экспортов адаптера —
   UI-тесты не должны требовать живого backend); сценарии, ценные как
   интеграционные, перенести в `backend/tests/` (живой PG).
   `test_api_adapter.mjs`: демо-секции удалить, LOCAL-секции сохранить.
   `test_demo_accounts/migration/persistence` — удалить вместе с демо.
   Ориентир: комплект снова 38/38 (минус удалённые демо-тесты, плюс
   переписанные).
8. **i18n/справка:** удалить `demo.*` (6 ключей) и упоминания демо из
   остальных секций и `help.items`; `check_keys` + `check_help_catalog` ✓.
9. **Документация:** README, WORKLOG («В работе»/«Сделано»/«Дальше»),
   PROJECT_ANALYSIS, SESSION_RESTART, DEPLOY_MINIPC (dev-поток без демо),
   tmp_tests/README.
10. **Папка `supabase/`** (6 SQL-файлов исторической Supabase-схемы):
    удалить из проекта (содержимое сохранено в дампах/откатных снимках) —
    финальное решение в заход.
11. **Проверка:** `npm run check` (список модулей уменьшится), check_keys,
    help-каталог, все tmp_tests, backend `npm test` (60+19+54+24),
    живой смоук против backend.

Риски: переписывание тестов — львиная доля; любое UI-поведение проверяется
только с живым backend (в песочнице PG поднят; на железе — после T4).
Откат: baseline-снимок шага 1.

## T4 — деплой на своё железо (D2–D5 по DEPLOY_MINIPC.md)

Железо есть/скоро будет (опрос 2026-10-21). Этапы ранбука 0–8: bootstrap
Ubuntu → установка из дампа + секреты → systemd+nginx → Cloudflare Tunnel +
CDN-правила → SMTP → бэкапы 3-2-1 + репетиция → SECURITY-чек-лист →
мониторинг/запуск.
Предстартовый чек-лист (домен): замена `samplehelp.example` → реальный домен
в `index.html` (og:url/og:image/canonical), `robots.txt` (Sitemap),
`sitemap.xml`; `MAIL_FROM`; CORS/`API_URL` на прод-адрес. Метрика/реклама —
после выкладки по SCALE_PLAN.md Этап 4.

## Порядок заходов

**T1 (русификация /admin)** — быстрый независимый выигрыш;
**T2 (#reset= + SMTP)** — критический путь реального режима;
**T3 (удаление демо)** — большой заход после T2 (тесты T2 уже пишутся
без демо-зависимостей);
**T4 (деплой)** — по готовности железа, после T2 (T3 для деплоя не
блокирующий, но желателен до запуска).

## Команды проверки (штатные, из WORKLOG)

```bash
cd samplehelp
npm install && npm install jsdom --no-save
npm run check
node tmp_tests/check_keys.cjs
node tmp_tests/check_help_catalog.cjs
for t in tmp_tests/test_*.mjs; do node "$t" >/dev/null 2>&1 && echo "✓ $t" || echo "✗ $t"; done
# backend (PG 15 в песочнице поднят: sh_dev/sh_test, postgres/postgres)
cd backend && npm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/sh_dev node src/migrate.js
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sh_test npm test
STATIC_DIR=../public DATABASE_URL=postgres://postgres:postgres@localhost:5432/sh_dev node src/app.js  # :3100
node tools/phase_c_smoke.mjs   # 71 проверка
```

## Приложение A — словарь таблиц (20)

| Таблица | По-русски |
|---|---|
| users | Пользователи |
| owner_config | Настройки владельца |
| profiles | Профили |
| questions | Вопросы |
| answers | Ответы |
| comments | Комментарии |
| likes | Лайки |
| favorites | Избранное |
| messages | Сообщения |
| notifications | Уведомления |
| achievements | Достижения |
| subscriptions | Подписки |
| synth_catalog | Справочник синтезаторов |
| daw_catalog | Справочник DAW |
| user_software | Софт пользователей |
| user_arsenal | Арсенал пользователей |
| donations | Донаты |
| reports | Жалобы |
| ideas | Идеи |
| idea_votes | Голоса за идеи |

Колонки (137 ключей) заполняются в заход T1 по данным `/api/admin/:name/meta`
и `backend/src/schema.sql`.
