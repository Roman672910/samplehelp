# PLAN_BACKEND_REWRITE.md — уход с Supabase на self-hosted backend (Фазы A–D)

**Статус: инфраструктурное решение заказчика 2026-10-14: Supabase убирается
ПОЛНОСТЬЮ (санкции), вместо него свой стек: мини-ПК Ubuntu Server (Node.js +
Express + PostgreSQL + Socket.IO + Nginx), выход в интернет через Cloudflare
Tunnel + CDN (кэш аудио/статики), аутентификация своя (JWT + bcrypt), хранилище
— локальный SSD. Решения опроса: OAuth убираем (email+пароль+сброс письмом);
данных в Supabase ценных нет (продукт не запущен) — миграции данных НЕТ;
регистрация без подтверждения почты; JWT: access в localStorage + refresh-
эндпойнт. ХРОНОЛОГИЯ: Фаза A ✅ 2026-10-14 (ядро backend, 60 проверок),
Фаза B ✅ 2026-10-14 (Socket.IO + cron lifecycle, +19), Фаза C ✅ 2026-10-16
(фронт-адаптер api.mjs + добор паритета backend, +51 и живой смоук 70),
Фаза D — деплой мини-ПК: ЖДЁМ КОМАНДУ.**
Прежнее инфраструктурное решение (2026-10-11: Selectel VPS + self-hosted
Supabase, DEPLOY_SELECTEL.md) ЭТОЙ задачей отменяется; журналы обновим в Фазах A/D.

## 0. Принципы перезахода

1. **Фронт не трогаем:** `api.mjs` (Фаза C) реализует ТОТ ЖЕ набор экспортов с
   ТЕМИ ЖЕ сигнатурами, что supabase.mjs сегодня (fetchProfile, fetchIdeas,
   sendMessage, subscribeMessages, uploadAudio, presence-подписки…). Остальные
   модули меняют только имя импорта.
2. **Демо-слой — страховочный пояс:** переезжает в api.mjs без изменений;
   IS_DEMO = нет CONFIG.API_URL. Все 36 тест-файлов фронта остаются зелёными
   весь перезаход (они гоняют демо-ветку).
3. **Схема БД переносится, а не изобретается:** setup.sql — стандартный
   PostgreSQL; триггеры счётчиков/rep/жизненного цикла остаются; убираются
   RLS-политики и зависимость от auth.users.
4. **Авторизация = серверный модуль правил** (порт ~40 RLS-политик) + тест-
   матрица «роль × действие». Это главный риск корректности перезахода.
5. Каждая фаза — отдельный заход со спекой, тестами и откатом; фронт
   переключается (Фаза C) ТОЛЬКО после зелёного backend (Фазы A–B).

## 1. ФАЗА A — ядро backend (спека к реализации)

### 1.1 Раскладка
```
backend/
├── package.json            # type:module; express, pg, bcryptjs, jsonwebtoken,
│                           # nodemailer, express-rate-limit, multer
├── src/
│   ├── app.js              # Express: /api/*, health; в dev ещё статика+SPA
│   ├── config.js           # env: DATABASE_URL, JWT_SECRET, REFRESH_SECRET,
│   │                       # PORT, STATIC_DIR, SMTP_*
│   ├── db.js               # pg Pool + helper query
│   ├── auth.js             # bcrypt(12), sign/verify JWT, requireAuth/requireAdmin
│   ├── rules.js            # ПОРТ RLS: правила «своё/чужое/админ/публично»
│   ├── mailer.js           # nodemailer + SMTP (UniSender по DEPLOY-плану)
│   ├── storage.js          # SSD-папки бакетов, static, приватный доступ
│   ├── schema.sql          # порт setup.sql: таблицы+триггеры+check, без RLS
│   ├── migrate.js          # идемпотентное применение schema.sql
│   └── routes/             # auth, profiles, questions, answers, comments,
│                           # likes, favorites, subscriptions, achievements,
│                           # notifications, messages, donations, reports,
│                           # ideas, upload
└── tests/                  # интеграционные: node:test + тестовая БД sh_test
```
Прод: Nginx отдаёт статику/SPA и проксирует /api и (Фаза B) /socket.io на node;
dev: backend сам отдаёт статику, чтобы фронт-разработка не менялась.

### 1.2 Схема (порт setup.sql)
- `users`: id uuid pk, email citext unique not null, password_hash text not
  null, created_at. Подтверждения почты НЕТ (решение опроса).
- `profiles`: нынешние колонки (username unique, avatar_url, bio, links,
  rating, solutions_count, purged_answers_count, cover_style, open_to_collab,
  contact, contact_consent, donate_methods, is_admin) + id → users cascade.
  Column-grants захода 36 выражаются иначе: PATCH /api/profiles/me принимает
  ТОЛЬКО белый список колонок на сервере (самоповышение is_admin исключено).
- Остальные таблицы — как в setup.sql (questions…ideas/idea_votes), включая
  check-ограничения; `owner_config` переносится: триггер/логика регистрации
  ставит is_admin=true при совпадении почты с owner_email (порт захода 43).
- Триггеры: bump_like_counts, answers_count, +25 rep за решение,
  answers_no_new_on_solved, purge-логика — переносятся; места, где триггеры
  смотрели auth.uid(), переходят на параметры транзакции приложения.
- Индексы: FK + горячие пути (messages(sender,recipient,created_at),
  notifications(user_id,read), likes(target), ideas голосов).

### 1.3 Auth-эндпойнты
- POST /api/auth/register {email,password,username}: bcrypt 12; users+profiles
  одной транзакцией (username занят → суффикс); owner_email → is_admin;
  ответ: токены. rate-limit 5/мин/IP.
- POST /api/auth/login: rate-limit 5/мин/IP; ответ {access(12h), refresh(30d)}.
- POST /api/auth/refresh: ротация пары (refresh одноразовый, jti в таблице
  refresh_tokens); фронт (Фаза C) при 401 один раз тихо обновляет.
- POST /api/auth/reset-request {email}: токен в reset_tokens (ttl 1h) + письмо
  ссылкой (mailer.js); POST /api/auth/reset-confirm {token,password}.
- GET /api/me: user+profile одной выборкой.
- OAuth-эндпойнтов НЕТ; fetchEnabledProviders на фронте (Фаза C) → [].

### 1.4 REST-ресурсы = порт боевых веток supabase.mjs
Формы ответов СОВПАДАЮТ с тем, что боевые ветки возвращают сегодня (джойны
profiles(username, avatar_url, donate_methods), счётчики, порядки сортировок),
чтобы Фаза C была механической:
- profiles: GET /api/profiles/:id; PATCH /api/profiles/me (белый список);
  software/arsenal — подтаблицы в том же PATCH.
- questions: GET /api/questions?sort=new|top&limit&before (лента), GET :id,
  POST, PATCH/DELETE свои; solved/purge-эндпойнты жизненного цикла.
- answers, comments: CRUD по тем же правилам; решения: POST /api/answers/:id/solution.
- likes: POST /api/likes/toggle {target_type,target_id} → {liked,likes_count}.
- favorites, subscriptions (авторы/теги), achievements (GET свои),
  notifications (GET, POST read/:id, POST read-all).
- messages: GET convs, GET thread/:uid, POST send, PATCH/DELETE своих,
  reactions toggle, POST read/:uid.
- donations: POST thanks/mark, POST confirm/:id, GET for-me (список отметок).
- reports: POST, GET admin, POST status/:id, POST remove/:id.
- ideas: GET list?sort, POST, POST vote/:id toggle, POST status/:id (admin),
  POST reply/:id (admin), DELETE свои/админ.
- upload: POST /api/upload/:bucket (multipart, лимит 25 МБ, проверка mime) →
  SSD `storage/<bucket>/<uid>_<name>`; отдача: /files/<bucket>/… публичные
  бакеты (question-audio, presets, avatars) с длинным кэшем; marketplace-files
  — только через GET /api/files-private/:id с requireAuth.
- Ошибки: { code, message } — контракт как у supabase-js (error.code), чтобы
  дубли жалоб ('duplicate') и прочие коды фронта не переписывать.

### 1.5 Авторизация (rules.js)
Порт политик по ресурсам: публичное чтение (profiles/questions/answers/…/
ideas), вставка от себя, изменение/удаление своего, админ-ветки (reports/ideas
status/удаления любые), приватность messages (только участники), контактов
(маски/consent — НА СЕРВЕРЕ: чужие email/phone уходят маскированными, кроме
владельца и открытых по бейджу; серверная приватность контактов захода 18
наконец становится настоящей, а не клиентской).

### 1.6 Тесты Фазы A
- Интеграционные backend/tests: auth (register/login/refresh-ротация/reset/
  rate), матрица правил (аноним/юзер/автор/админ × read/write/delete по каждому
  ресурсу, включая маски контактов и 403 на is_admin), триггеры-счётчики,
  upload (mime/лимит/приватный бакет).
- Окружение: в моей песочнице ставлю PostgreSQL (apt); если не встанет —
  unit-тесты rules на pg-mem у меня + интеграция на вашем мини-ПК первым
  деплоем (честно фиксирую в заходе).
- Фронт: 36/36 остаются зелёными (не трогаем).

### 1.7 Откат Фазы A
backend/ аддитивна: фронт от неё не зависит никак → откат = удаление папки;
baseline-дамп по регламенту перед правками.

## 2. ФАЗА B — realtime и жизненный цикл (очерк)
Socket.IO: комнаты conv:<uid-pair>, user:<id> (уведомления), presence:global,
presence:q:<id>, typing:<conv>; эмиты из routes после мутаций (best-effort);
presence track/untrack с теми же payload {uid,username,avatar_url,guest};
cron lifecycle sweep (purge-таймеры, напоминания 24ч/3дня) каждые 10 мин;
подписки фронта получают те же колбэки ({users,guests,total} и т.д.).

## 3. ФАЗА C — фронт-адаптер ✅ ВЫПОЛНЕНА (2026-10-16)
api.mjs (public/js/api.mjs) — единая точка входа: ВСЕ экспорты supabase.mjs
(84+) с теми же сигнатурами; LOCAL-ветка (USE_LOCAL_BACKEND && API_URL) —
fetch к /api с JWT из localStorage (access 12h + refresh 30d, тихий
single-flight refresh на 401), Socket.IO-пуши (notification/message/typing/
presence, vendor-бандл + CDN-фолбэк), формы ответов приведены к боевым веткам
(author-маппинг, Set голосов, bool-toggle). Демо-ветка — делегирование в
supabase.mjs БЕЗ изменений (страховочный пояс; все 37 тест-файлов фронта
зелёные). 14 модулей переименовали импорт supabase.mjs → api.mjs; auth.mjs:
OAuth-ряд убран (fetchEnabledProviders → []), restoreSession — JWT-ветка;
presence.mjs — Socket.IO-комната; main.mjs — индикатор BACKEND; achievements.mjs
— count-mine. vendor/supabase.js удалён (+ тег из index.html), вместо него
vendor/socket.io-client.min.js. IS_DEMO = !(USE_LOCAL_BACKEND && API_URL);
в репозитории флаг ВЫКЛЮЧЕН (демо/тесты), для работы с backend заказчик ставит
true. Backend добрал недостающий паритет (агрегат профиля, справочники,
пакетные ответы, edited_at, favorites.status, likes/status, ref-карточки,
donations/count, achievements, logout, CORS, /files-статика — см.
backend/README.md «Эндпойнты Фазы C»). Тесты: backend/tests/run_c.mjs (51),
tools/phase_c_smoke.mjs (живой прогон, 70), tmp_tests/test_api_adapter.mjs
(66, fetch-mock + фейковый сокет). Откат: rollbacks/
filelist_baseline_2026-10-16_before_phase_c.txt.

## 4. ФАЗА D — деплой и эксплуатация: **D1 ✅ 2026-10-16 (ранбук + комплект), D2–D5 — по приезду мини-ПК**
Рецепт мини-ПК: Ubuntu (ufw, unattended-upgrades), PG localhost-only + tuning,
systemd-сервис node, Nginx (статика/SPA + proxy /api,/socket.io), Cloudflare
Tunnel (systemd, outgoing-only), CDN cache-rules: /files/* и статика long-cache,
API/HTML no-store; бэкапы: pg_dump ежедневный + rsync storage на внешний носитель
(оффсайт-копия), план восстановления на резервном VPS (единая точка отказа —
мини-ПК); SECURITY-чеклист (bcrypt 12, ротация JWT_SECRET, rate-limits, TLS
только через tunnel, бэкапы оффсайт); DEPLOY_SELECTEL.md → DEPLOY_MINIPC.md;
SCALE_PLAN: инфраструктурный раздел переписан под это решение.
**D1 сдано:** `DEPLOY_MINIPC.md` (этапы 0–8: железо/покупки, bootstrap,
установка из дампа, systemd+nginx, Tunnel+CDN-правила, SMTP+должок `#reset=`,
бэкапы 3-2-1 + репетиция + план B на VPS, SECURITY-чек-лист, мониторинг/запуск)
+ комплект `deploy/minipc/` (00-bootstrap, 10-install-app — восстановление из
дампа + секреты openssl + серверный config-патч флага, 20-services, 30-tunnel,
40-backup-install, backup.sh/restore.sh, systemd-юнит с hardening, env-шаблон,
cloudflared-конфиг, nginx-конфиг). Проверено в песочнице: bash -n ✓, nginx -t ✓,
ЖИВАЯ продакшн-топология nginx→node: 13 проверок ✓ (SPA-fallback, /api-прокси,
/files с SSD + длинный кэш, приватный бакет 404, HTML no-store, CORS-префлайт)
+ фикс MIME: дефолтный nginx не знает .mjs → ES-модули не исполняются в
браузере; в конфиг добавлен types-блок (text/javascript mjs), остальные MIME
не затронуты (проверено). Legacy Selectel-комплект → deploy/legacy_selectel/,
DEPLOY_SELECTEL.md помечен архивным.

## 5. Риски и заметки
- Паритет правил с RLS — главный риск: лечится матрицей тестов (1.6).
- Мини-ПК = единая точка отказа: бэкапы оффсайт + план B (резервный VPS из
  бэкапа за час) зафиксированы в Фазе D.
- Cloudflare free-тариф и Tunnel работают из РФ исходящим соединением; CDN-кэш
  аудио снимает трафик с домашнего канала (3 ТБ/мес лимиты туннеля не требуются
  на free для проксирования, но CDN-кэш снижает origin-трафик).
- Socket.IO single-node держит 1k+ DAU легко; горизонталь — не сейчас.
- Аудит действий админа, несколько owner-почт — бэклог ролей, не Фаза A.
