# backend/ — self-hosted backend SampleHelp (Фаза A, заход 48)

Замена Supabase (санкции): Node.js + Express + PostgreSQL + (Фаза B: Socket.IO),
хранение на локальном SSD, аутентификация своя (JWT + bcrypt).

## Запуск (dev)
```bash
cd backend
npm install
export DATABASE_URL=postgres://samplehelp:samplehelp_dev_pwd@127.0.0.1:5432/sh_dev
node src/migrate.js          # идемпотентно создаёт БД и схему
STATIC_DIR=../public node src/app.js   # dev: API + статика/SPA на :3100
```

### Windows (PowerShell) — то же самое
Переменных окружения через `export` в PowerShell НЕТ — используется `$env:`.
1. PostgreSQL (один из двух способов; запомните пароль суперпользователя):
   - `winget install -e --id PostgreSQL.PostgreSQL.16`
   - или Docker: `docker run --name sh-pg -e POSTGRES_PASSWORD=MyPassword -p 5432:5432 -d postgres:16`
2. `$env:DATABASE_URL = "postgres://postgres:MyPassword@127.0.0.1:5432/sh_dev"`
3. `node src/migrate.js` — создаст БД sh_dev и применит схему
4. `$env:STATIC_DIR = "..\public"; node src/app.js` → http://localhost:3100/api/health
5. Тесты: `$env:TEST_DATABASE_URL = "postgres://postgres:MyPassword@127.0.0.1:5432/sh_test"; npm test`

### Windows + VS Code — пошагово (без мини-ПК, всё локально)
0. Обновить зависимости после обновления дампа: `npm install` в `backend/`
   (ошибка «Cannot find package 'socket.io'» = именно этот пропущенный шаг).
1. Поставить PostgreSQL: `winget install -e --id PostgreSQL.PostgreSQL.16`
   (в установке задать пароль суперпользователя postgres; служба стартует сама).
2. Прописать переменные ОДИН РАЗ (новые терминалы и VS Code подхватят):
   ```powershell
   setx DATABASE_URL "postgres://postgres:MyPassword@127.0.0.1:5432/sh_dev"
   setx TEST_DATABASE_URL "postgres://postgres:MyPassword@127.0.0.1:5432/sh_test"
   setx STATIC_DIR "K:\samplehelp\public"
   setx JWT_SECRET "lokalnyy-secret-podlinnee"
   setx REFRESH_SECRET "lokalnyy-refresh-secret"
   ```
   (STATIC_DIR абсолютным путём — надёжнее для launch-конфигов VS Code.)
3. Перезапустить VS Code (setx действует на новые процессы).
4. Открыть папку K:\samplehelp; в backend/: `node src/migrate.js`
   (или F5 → «backend: миграция схемы»).
5. F5 → «backend: сервер (:3100)» → в браузере http://localhost:3100/api/health
   → `{"ok":true,...}`; там же отдаётся фронт. Фаза C выполнена: чтобы фронт
   работал с этим API (а не в демо), поставьте `USE_LOCAL_BACKEND: true` в
   `public/js/config.mjs` (в репозитории флаг выключен — тесты идут в демо).
6. Вторым запуском F5 → «backend: realtime-демо…» → в консоли все строки ✓
   (пуши уведомлений/ЛС, typing, presence с гостем).
7. F5 → «backend: тесты Фаз A+B+C» → 60+19+51 проверка на живом PG; живой
   смоук адаптера: `node tools/phase_c_smoke.mjs` (сервер должен слушать :3100).
8. Данные смотреть в pgAdmin (ставится вместе с PostgreSQL): базы sh_dev/sh_test,
   таблицы notifications/messages/questions — всё, что нагоняет демо-скрипт.
Прод: Nginx отдаёт статику/SPA и проксирует `/api` (и позже `/socket.io`)
на node; см. Фазу D спеки `../PLAN_BACKEND_REWRITE.md`.

## Переменные окружения
`DATABASE_URL`, `JWT_SECRET`, `REFRESH_SECRET`, `ACCESS_TTL`, `REFRESH_TTL_DAYS`,
`STATIC_DIR`, `STORAGE_DIR`, `UPLOAD_LIMIT_MB`, `SMTP_HOST/PORT/USER/PASS`,
`MAIL_FROM`, `PUBLIC_URL`, `PORT`, `AUTH_RATE_MAX` (тесты: 1000).
`STORAGE_DIR` можно не задавать: по умолчанию — `backend/storage` (с фикса
2026-10-16 путь резолвится через fileURLToPath — на Windows корректный
`K:\...\backend\storage`; старая версия давала `/K:/...` и загрузка аудио
падала в «Внутренняя ошибка сервера»). При старте сервер печатает
разрешённые пути `storage:` и `static:` — сверяйтесь с ними.

## Если что-то не так (частые случаи)
- **«Внутренняя ошибка сервера» / «Файловое хранилище недоступно» при
  загрузке аудио или аватара:** смотрите консоль сервера (`[api] Error: ...`).
  До 2026-10-16 — баг дефолтного `STORAGE_DIR` на Windows (лечение: обновить
  backend из свежего дампа или задать `$env:STORAGE_DIR = "K:\samplehelp\backend\storage"`);
  после фикса ошибка сама говорит, какую папку не удалось создать.
- **«BACKEND: ошибка подключения» в подвале фронта:** сервер не запущен,
  другой порт, или брандмауэр Windows заблокировал Node (разрешите для
  частных сетей). Детали — консоль браузера (F12).
- **Бейдж админа не появился после ручного `update profiles set is_admin`:**
  выйдите и войдите заново (is_admin зашит в JWT, выдаётся при входе).
- **Фронт открывается, но данные пустые:** `USE_LOCAL_BACKEND: true` не
  сохранён, или открыт :3000 (server.js) при незапущенном backend на :3100.

## Админ-владелец
`update owner_config set owner_email = 'you@domain';` — первая регистрация
под этой почтой получает is_admin=true (триггер, порт захода 43). Поздние
модераторы: `update profiles set is_admin = true where id = '<uuid>';`
(или по почте: `... where id = (select id from users where lower(email) = lower('you@domain'));`).
⚠️ is_admin зашит в JWT и выдаётся при входе: после РУЧНОГО повышения в БД
нужно выйти и войти заново (или дождаться авто-refresh токена). Снять флаг:
`update profiles set is_admin = false ...`; выключить бутстрап:
`update owner_config set owner_email = '';`.

Где выполнять SQL (Windows, dev-база `sh_dev`):
- **pgAdmin 4** (ставится с PostgreSQL): Servers → PostgreSQL 16 → Databases →
  `sh_dev` → правый клик → Query Tool → вставить SQL → F5;
- **psql из PowerShell** одной командой:
  `& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d sh_dev -c "update owner_config set owner_email = 'you@domain';"`
  (Docker-вариант: `docker exec -it sh-pg psql -U postgres -d sh_dev -c "..."`);
- на мини-ПК (Ubuntu, боевая база `samplehelp`):
  `sudo -u postgres psql -d samplehelp -c "update owner_config set owner_email = 'you@domain';"`
Проверка: `select u.email, p.username, p.is_admin from profiles p join users u on u.id = p.id;`
На сайте у админа — бейдж 🛡 на аватарке, пункт «🛡 Модерация» в меню, экран /moderation.

## Ручная проверка после переключения фронта (Фаза C)
Порядок: `npm install` → `node src/migrate.js` (идемпотентно, добавит
колонки Фазы C) → `$env:STATIC_DIR="<путь>\public"; node src/app.js` →
`USE_LOCAL_BACKEND: true` в `public/js/config.mjs` → http://localhost:3100
(в подвале «BACKEND: подключено ✓»). Второй аккаунт — в приватном окне.
Чек-лист: регистрация+онбординг → вопрос с записью аудио (файл в
`backend/storage/question-audio/`, играется с `/files/...`) → ответ/лайк/
комментарий/«✓ Решение» (+25 👑) → ЛС в двух окнах (пуш без перезагрузки,
«печатает…», бейдж непрочитанных, 📎-карточка) → колокольчик (живые
уведомления, клик = прочитано) → точки онлайна в ленте → настройки профиля
(автосохранение, аватар, QR/Boosty) → /ideas (предложение, голос; админ:
статус+ответ) → /moderation (жалоба со второго аккаунта → карточка с
содержимым → «Отклонить»/«Удалить контент») → избранное и подписки.
Автосмоук того же сценария: `node tools/phase_c_smoke.mjs` (70 проверок).
⚠️ Сброс пароля без SMTP: ссылка печатается в консоль сервера
(`[mailer] SMTP не настроен; ... http://localhost:3100/#reset=<токен>`);
экран подтверждения `#reset=` на фронте ещё не собран (эндпойнт
`/api/auth/reset-confirm` готов) — кандидат ближайшего мини-захода.

## Тесты
```bash
npm test    # INTEGRATION: живой PostgreSQL (sh_test), 60+19+51 проверка:
            # Фаза A — auth/refresh-ротация/reset, owner-бутстрап, белый список
            #   PATCH, СЕРВЕРНЫЕ маски контактов, контент+триггеры, петли
            #   уведомлений (заходы 36/38/47), жалобы/модерация, идеи, upload;
            # Фаза B — Socket.IO-пуши, typing, presence, lifecycle (purge/напоминания);
            # Фаза C — справочники, агрегат профиля, пакетные ответы, edited_at,
            #   favorites (on/status), likes/status, ref-карточки, donations/count,
            #   achievements, logout, /files, CORS.
node tools/phase_c_smoke.mjs   # ЖИВОЙ смоук: api.mjs против сервера на :3100 (70 проверок)
```
Требует локальный PG и роль с CREATEDB (см. create role в журнале захода 48).

## Контракты
- Ошибки: `{ code, message }` с HTTP-статусами — коды совпадают с supabase-js
  (`duplicate`, `not_found`, `forbidden`…), чтобы Фаза C (api.mjs) была механической.
- Формы ответов REST = формы боевых веток прежнего supabase.mjs (джойны
  профиля, счётчики, сортировки) — фронт до Фазы C не меняется.
- Фронтенд-тесты (37 файлов tmp_tests/) продолжают ходить через демо-ветку и
  остаются зелёными весь перезаход.

## Эндпойнты Фазы C (добор паритета с боевыми ветками supabase.mjs)
К фазам A/B добавлены (все — аддитивно, прежние контракты не сломаны):
- `GET /api/profiles/:id` — агрегат: + `questions[]`, `answers[]` (с `question`),
  `stats{questions,answers,likes,rating,solutions}`; `GET /api/profiles/dev-contact`.
- `GET /api/questions?sort=new|top|unanswered&user_id=&limit=` (user_id — ВСЕ
  вопросы автора, включая purge-заглушки); `PATCH` — полный белый список
  (включая сброс `audio_url/waveform_data` явным null) + `edited_at`.
- `GET /api/answers?question_ids=…|user_id=…|best=1&user_id=&limit=` — пакетные
  выборки (лента/профиль/авто-витрина); `PATCH /api/answers/:id` — +tags/
  sound_type/difficulty +edited_at; `PATCH|DELETE /api/answers/comments/:id`;
  `GET /api/answers/count-mine`.
- `GET /api/likes/status?target_type&target_id` (аноним — `liked:false`).
- `GET /api/favorites` — форма `{question_id,status,created_at,question{…author}}`;
  `POST /api/favorites/toggle {on?}` (идемпотентно); `POST /api/favorites/status`.
- `GET /api/messages/ref-candidates`, `GET /api/messages/ref-card?type&id`;
  `PATCH /api/messages/:id` ставит `edited_at`.
- `GET /api/donations/count?recipient_user_id=<id|project>` (публичный счётчик ☕);
  `POST /api/donations/:id/confirm` дополнительно помечает `confirmed` в
  исходном уведомлении автора.
- `POST /api/achievements {achievement_type}` → `{awarded}` (повтор — false);
  `GET /api/reports` — строки сразу с `reporter` и `target` (композиция сервера).
- `GET|POST /api/catalog/synths|daws` (сиды справочников — в schema.sql).
- `POST /api/auth/logout {refresh}` — сжигает jti refresh-токена.
- CORS на `/api` (Bearer, не cookie) + публичная отдача `/files/<bucket>/<name>`
  (только PUBLIC_BUCKETS, длинный кэш); dev-статика: `STATIC_DIR` приводится к
  абсолютному пути (SPA-fallback больше не падает в 500).
- realtime: `typing` несёт username из профиля (не email).
- Схема: `edited_at` у questions/answers/comments/messages, `favorites.status`,
  сиды synth_catalog/daw_catalog (всё идемпотентно — migrate.js).

## Фазы (спека ../PLAN_BACKEND_REWRITE.md)
A ✅ ядро (этот каталог); B ✅ Socket.IO + cron жизненного цикла;
C ✅ api.mjs-адаптер на фронте (те же сигнатуры экспортов; флаг
`USE_LOCAL_BACKEND` в public/js/config.mjs; JWT+авто-refresh; Socket.IO-пуши;
vendor socket.io-client); D — деплой мини-ПК, Nginx, Cloudflare Tunnel+CDN,
бэкапы оффсайт.

Живой прогон Фазы C (сервер на :3100, затем): `node tools/phase_c_smoke.mjs` —
регистрация двух пользователей и вся продуктовая цепочка через api.mjs
(вопрос→ответ→лайк→решение+25 rep→ЛС с 📎→донаты→избранное→идеи→права→
загрузки /files→агрегат профиля→живые пуши и presence→авто-refresh→logout).
