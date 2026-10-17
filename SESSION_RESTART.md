# 🔑 SESSION_RESTART.md — быстрый вход в сессию (шлётся вместе с filelist_with_content.txt)

> **Зачем этот файл:** если чат утерян, ассистент получает ТОЛЬКО дамп проекта и
> этот файл. Здесь — протокол восстановления, текущее состояние, жёсткие
> инварианты (что нельзя ломать) и очередь задач. Глубокая память — в
> `WORKLOG.md` (журнал, ОБЯЗАТЕЛЬНО обновлять после каждой задачи) и
> `PROJECT_ANALYSIS.md` (архитектура/конвенции). Сначала читай их «На чём
> остановились» / «История изменений», потом действуй.

## 0. Что за проект (10 секунд)
**SampleHelp** — Q&A-платформа для саунд-дизайнеров: «загрузи аудио-пример —
сообщество подскажет, как сделать такой звук». Чистый стек без фреймворков:
HTML/CSS/ванильный JS (ES Modules) + свой backend `backend/` (Node+Express+
PostgreSQL+Socket.IO, файлы на SSD, JWT+bcrypt). Заказчик — русскоязычный,
работает с Windows (инструкции давать для PowerShell дословно), общение в чате.

## 1. Протокол восстановления рабочей копии
```bash
# из корня workspace (рядом лежат uploads/filelist_with_content.txt и этот файл):
mkdir -p samplehelp/scripts   # если пусто
# 1) достать restore-скрипт из дампа (он сам в дампе; точные маркеры строк!)
#    или сразу, если samplehelp/scripts/restore-filelist.cjs уцелел:
node samplehelp/scripts/restore-filelist.cjs uploads/filelist_with_content.txt samplehelp
# 2) зависимости (node_modules НЕ живут между сессиями):
cd samplehelp && npm install && npm install jsdom --no-save
cd backend && npm install
# 3) пересоздать бинарник og-cover.png (в дампе только заголовок):
#    PIL 1200×630, фон #0d0d0f, медная вейвформа (#b87333→#cd7f32→#ff8c00),
#    текст «SampleHelp / как сделать такой звук?» (тесту нужны PNG+IHDR 1200×630)
```

## 2. Проверки «всё цело» (зелёные числа на 2026-10-16, заход 48 D1)
```bash
npm run check                          # ✓ 36 модулей
node tmp_tests/check_keys.cjs          # ✓ 511 ключей i18n (ru-only)
node tmp_tests/check_help_catalog.cjs  # ✓ каталог справки 113
for t in tmp_tests/test_*.mjs; do node "$t" >/dev/null 2>&1 || echo "✗ $t"; done   # 37/37
# backend (нужен PostgreSQL; в песочнице: apt-get update && apt-get install -y postgresql;
#   pg_ctlcluster <ver> main start; create role samplehelp login password 'samplehelp_dev_pwd' createdb;
#   create database sh_test owner samplehelp):
cd backend && TEST_DATABASE_URL=postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_test npm test
#   → 60 (Фаза A) + 19 (B) + 54 (C) ✓
DATABASE_URL=postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_dev node src/migrate.js
STATIC_DIR=../public PORT=3100 node src/app.js &   # и в другом процессе:
node tools/phase_c_smoke.mjs                       # → 70 ✓ (живой прогон api.mjs)
```

## 3. Где сейчас проект (статус перезахода 48: Supabase → свой стек)
- **Фаза A** ✅ backend-ядро (routes/rules/storage/notify/lifecycle, JWT+bcrypt,
  ошибки в контракте supabase-js {code,message}).
- **Фаза B** ✅ Socket.IO (комнаты user:<id>, presence:*; события notification/
  message/message_patch/message_delete/typing/presence) + серверный cron lifecycle.
- **Фаза C** ✅ фронт-адаптер `public/js/api.mjs` — ЕДИНАЯ точка доступа к данным:
  флаг `USE_LOCAL_BACKEND` (+`API_URL`) в `public/js/config.mjs`; LOCAL — fetch+JWT
  (localStorage `samplehelp_api_tokens`, авто-refresh на 401 single-flight) +
  Socket.IO; демо — делегирование в `supabase.mjs` (демо-слой НЕ тронут, это
  страховка и среда всех 37 тестов). 14 модулей импортируют api.mjs.
  Фикс C1: STORAGE_DIR на Windows (fileURLToPath) — загрузка аудио работала в 500.
- **Фаза D1** ✅ ранбук `DEPLOY_MINIPC.md` + комплект `deploy/minipc/` (bootstrap/
  install/services/tunnel/backup, nginx+systemd+cloudflared-конфиги).
- **Фаза D2–D5** ⏳ ЖДЁМ МИНИ-ПК: установка на железо → домен+Cloudflare Tunnel+CDN
  → SMTP (+экран `#reset=` — должок Фазы C, эндпойнт reset-confirm готов) →
  бэкапы/мониторинг/запуск. Продуктовый бэклог — после перезахода (WORKLOG «Дальше»).
- Заказчик уже гонял фронт против backend на Windows (регистрация/вопросы/аудио
  работают); демо-данные и боевая БД — РАЗНЫЕ миры (миграции данных не было, решение).

## 4. Жёсткие инварианты (сломаешь — тесты/демо умрут)
1. **`USE_LOCAL_BACKEND: false` в репозитории.** Тесты фронта стабят fetch и
   бросаются на неожиданный URL; при true все 37 файлов пойдут в сеть. Флаг в true
   ставит только заказчик у себя (или смоук-скрипты, мутируя CONFIG в памяти).
2. `IS_DEMO = !(USE_LOCAL_BACKEND && API_URL)`; демо-ветка supabase.mjs ветвится
   по IS_DEMO — не менять семантику. `supabase.mjs` не удалять (демо-слой+откат).
3. Контракт ошибок api.mjs = supabase-js: `Error.code` ('duplicate' и т.д.) —
   на нём стоит логика moderation.mjs и тесты.
4. Новые строки UI — только через `t()`/`tp()` и только в **ru**; каждый новый
   интерактивный элемент — `data-help="ключ"` + `help.items.<ключ>.title/desc`;
   после правок гонять check_keys + check_help_catalog (511/113 — обновлять осознанно).
5. `DEMO_DB_VERSION` (сейчас 16) повышать при изменении структуры демо-сидов
   (механизм мягкого пересида migrateDemo переносит пользовательский контент).
6. Регламент захода: baseline-дамп в `rollbacks/` ПЕРЕД правками → работа →
   проверки (раздел 2) → обновление WORKLOG (+PROJECT_ANALYSIS при архитектуре) →
   `npm run filelist` (дамп) → итоговое сообщение заказчику.
7. Текстовые файлы — POSIX (завершающий перенос строки): формат дампа строчный.
8. Backend-схема меняется ТОЛЬКО идемпотентно (`create ... if not exists`,
   `alter table ... add column if not exists` — и ПОСЛЕ create table всех таблиц!).

## 5. Ловушки среды (проверено на себе)
- В python-heredoc литерал абсолютного пути подменяется на `$ARENA_WORKSPACE` →
  использовать относительные пути или argv.
- В песочнице нет `curl`/`ps`/`pkill` → health-чеки через `node -e "fetch(...)"`,
  процессы через `/proc/*/cmdline` или pid-файлы + `kill`.
- node_modules и PostgreSQL не переживают смену сессии — ставить заново (раздел 1–2).
- Тесты с повторным импортом `supabase.mjs?suffix`: каждый экземпляр живёт СВОЕЙ
  копией демо-базы — сид-состояние возвращать через тот экземпляр, который
  использует проверяемый модуль.
- `make-filelist.cjs` исключает из дампа сам дамп и `filelist_baseline_*.txt`.

## 6. Карта ключевых файлов
- `WORKLOG.md` — журнал (свежие записи сверху; «На чём остановились», «Дальше»).
- `PLAN_BACKEND_REWRITE.md` — спека перезахода (Фазы A–D, принципы).
- `DEPLOY_MINIPC.md` + `deploy/minipc/` — выкладка на мини-ПК (Фаза D).
- `public/js/api.mjs` — адаптер данных (LOCAL/демо); `supabase.mjs` — демо-слой.
- `backend/src/` — app/config/db/auth/rules/realtime/lifecycle/storage/mailer/
  notify/migrate + routes/{auth,profiles,questions,social,messages,misc}.js;
  `backend/src/schema.sql` — ЖИВАЯ схема БД (supabase/ — архив).
- `backend/tests/run{,_b,_c}.mjs`, `backend/tools/phase_c_smoke.mjs` — проверки.
- `tmp_tests/` — 37 фронт-тестов + check_keys/check_help_catalog + README.
- `README.md` (корень) — быстрый старт; `backend/README.md` — запуск/контракты/
  troubleshooting (Windows-разделы для заказчика).

## 7. Очередь «Дальше» (кратко; детали — WORKLOG)
1. **Фаза D2–D5** — по приезду мини-ПК (ранбук DEPLOY_MINIPC.md готов).
2. Экран сброса пароля `#reset=<токен>` (эндпойнт есть, UI нет) — мини-заход.
3. Продуктовый бэклог: квота localStorage/IndexedDB для демо-базы; паритет чипов
   подписки на теги в оставшихся списках; фикс SPA-fallback для путей с точкой;
   бэклоги идей (комментарии/теги/дедуп) и модерации.
4. После выкладки: Terms/Privacy/DMCA (152-ФЗ), Sentry free, Метрика и РСЯ
   (флаги ENABLE_METRIKA/ENABLE_ADS уже заложены), замена домена-заглушки
   samplehelp.example (чек-лист в SCALE_PLAN/WORKLOG).

## 8. Стиль работы с заказчиком
Решения принимать опросом (варианты + рекомендация), а не молча; крупные заходы —
со спекой (PLAN_*.md) и baseline-откатом; после захода — честный отчёт: что
сделано, какие проверки зелёные (с числами), что отложено и почему; инструкции для
Windows давать дословно (PowerShell, без bash-измов); журнал WORKLOG обновлять ВСЕГДА.
