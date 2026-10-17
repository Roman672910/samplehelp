# 🇷🇺 INFRA: Selectel + self-hosted Supabase — ранбук выкладки SampleHelp

> ⛔ **АРХИВ (2026-10-14):** план ОТМЕНЁН решением заказчика — Supabase убирается
> полностью (санкции), целевая инфраструктура — мини-ПК Ubuntu + свой backend
> (Node+Express+PostgreSQL+Socket.IO) + Cloudflare Tunnel/CDN. Актуальный ранбук:
> **`DEPLOY_MINIPC.md`** (комплект `deploy/minipc/`). Скрипты этого плана
> перемещены в `deploy/legacy_selectel/` и не используются. Документ сохранён
> как история (расчёты нагрузки частично перенесены в DEPLOY_MINIPC.md §0).


> Решение заказчика 2026-10-11: целевая инфраструктура — **Selectel** (санкции,
> оплата рублями, 152-ФЗ) + **self-hosted Supabase** (open-source стек на нашем
> сервере). Код приложения НЕ меняется: в `public/js/config.mjs` подставляется наш
> `SUPABASE_URL` + наш anon-ключ. Расчёт нагрузки и денег — в конце документа.
> Статус: СОГЛАСОВАНО как целевая архитектура; выполняется на Этапе 1/4.

## Почему так (коротко)

- Облачный Supabase из РФ нельзя оплатить, аккаунт под санкционным комплаенсом,
  а персональные данные РФ-пользователей по 152-ФЗ должны жить на серверах в РФ.
- Supabase — open source: тот же функционал (Postgres+RLS, Auth/OAuth, Realtime,
  Storage, Studio) поднимается docker-compose на своём сервере → 0 правок кода.
- Selectel: рубли, НДС-чеки, 3 ТБ бесплатного внешнего трафика, S3 1,96 ₽/ГБ,
  CDN-пакет 550 ₽/800 ГБ подключается одной кнопкой при росте.
- Не используем: Cloudflare (продажи в РФ приостановлены), Stripe (не работает в
  РФ), иностранных регистраторов для критичных доменов, NAS-файлохранилище
  (сервер один; бэкапы дешевле в S3 «Ледяное»).

---

## Этап 0 — подготовка (0 ₽, не блокирует разработку)

- [ ] 0.1. Придумать и проверить домен (.ru / .com): регистратор reg.ru / RU-CENTER
      / сам Selectel тоже продаёт домены. Критичное имя занять ДО выкладки.
- [ ] 0.2. Зарегистрироваться в Selectel (my.selectel.ru): физлицо/самозанятый/ИП,
      пополнить баланс российской картой (достаточно 5 000 ₽ на первый месяц).
- [ ] 0.3. Параллельно добить юридические страницы (Этап 3 SCALE_PLAN):
      Terms / Privacy / DMCA — нужны и для рекламы, и для приличия на бою.
- [ ] 0.4. Выбрать SMTP: UniSender / SendPulse (free-тарифы) или Яндекс.Почта для
      домена; подготовить учётку для боевой рассылки писем авторизации.
- [ ] 0.5. Решить открытый вопрос Confirm email (включать сразу или позже).

## Этап 1 — сервер и «свой Supabase» (~1 день, старт расходов)

> **Автоматизация (добавлено 2026-10-11):** шаги 1.2–1.10 закрыты скриптами в
> `deploy/`: `bootstrap.sh` (пакеты, ufw, docker, стек Supabase, генерация
> секретов НА СЕРВЕРЕ → /root/samplehelp-secrets.txt, health-чек),
> `configure-s3.sh` (S3-бэкенд Storage), `apply-sql.sh` (setup.sql + storage.sql),
> `backup-install.sh` (pg_dump → S3 по cron), `nginx-sample.conf` (Этап 2).
> Порядок: scp проекта на сервер → bootstrap → configure-s3 → apply-sql →
> backup-install → ключи в config.mjs → живой прогон.

- [ ] 1.1. Панель Selectel → Облачные серверы → создать:
      **2 vCPU / 8 ГБ RAM / 100 ГБ SSD (Standard Line)**, Ubuntu 24.04 LTS,
      регион Санкт-Петербург (пулы ru-9a и соседние), **публичная сеть + IP**.
      Имя: `samplehelp-prod`. (~3 609 ₽/мес + диск + сеть, см. таблицу ниже.)
- [ ] 1.2. Базовая гигиена: `apt update && apt upgrade`, пользователь не-root с
      sudo и ssh-ключами, `ufw` открыть только 22/80/443, fail2ban по желанию.
- [ ] 1.3. Docker: `apt install docker.io docker-compose-v2` (или официальный
      convenience-скрипт). Проверить: `docker compose version`.
- [ ] 1.4. Supabase self-hosted: склонировать официальный репозиторий
      `github.com/supabase/supabase`, каталог `docker/` (compose-файл со стеком:
      db, kong, auth, rest, realtime, storage, imgproxy, meta, functions,
      vector; studio и analytics на бою ОТКЛЮЧИТЬ — экономят ~1–1,5 ГБ RAM).
- [ ] 1.5. `.env` из `.env.example`: сгенерировать СВОИ секреты —
      `POSTGRES_PASSWORD`, `JWT_SECRET` (32+ байт), `ANON_KEY` и
      `SERVICE_ROLE_KEY` (JWT HS256 с этим секретом, role=anon/service_role;
      сгенерировать любой утилитой/командой, напр. node-онелайнером с crypto).
      `DASHBOARD_PASSWORD` задать (Studio временно нужна для отладки).
- [ ] 1.6. `docker compose up -d`; проверить: `http://<IP>:8000` — Studio,
      `…/auth/v1/health`, `…/rest/v1/`, `…/realtime/v1/` отвечают.
- [ ] 1.7. Selectel → Объектное хранилище (S3): создать бакеты
      `question-audio`, `presets`, `avatars` (публичные) и `marketplace-files`
      (приватный), регион тот же (СПб). Ключи S3 (access/secret) → в `.env`
      storage-сервиса: `STORAGE_BACKEND=s3`, `GLOBAL_S3_ENDPOINT=
      https://s3.ru-3.storage.selcloud.ru` (уточнить регион в панели),
      `GLOBAL_S3_BUCKET/PROTOCOL/REGION` + AWS_*-ключи. Трафик S3↔сервер внутри
      Selectel не тарифицируется.
- [ ] 1.8. Применить НАШИ скрипты БД без изменений: `supabase/setup.sql`, затем
      `supabase/storage.sql` (psql из контейнера db или SQL Editor в Studio).
      Проверить: таблицы, RLS-политики, триггеры, realtime-публикации, бакеты.
- [ ] 1.9. Дымовые тесты инфраструктуры: создать пользователя через
      `/auth/v1/signup`, залить файл в бакет через `/storage/v1/object`,
      выбрать строку через `/rest/v1/...` с anon-ключом (RLS работает?).
- [ ] 1.10. **Бэкапы в день запуска стека** (не откладывать!):
      cron: `docker exec supabase-db pg_dump -U postgres` → gzip → aws-cli/s3cmd
      в отдельный S3-бакет `samplehelp-backups` (класс «Ледяное», 0,89 ₽/ГБ);
      плюс снапшоты диска из панели Selectel по расписанию. Раз в месяц —
      учебное восстановление в песочницу.
- [ ] 1.11. Подключить приложение: в `public/js/config.mjs` вписать
      `SUPABASE_URL = 'http://<IP>:8000'` (временно, до домена) и наш
      `SUPABASE_ANON_KEY`; `IS_DEMO` выключится сам. `npm start` локально →
      живой прогон: регистрация, вопрос с аудио (Opus-конвейер в реальном
      браузере!), ответ, сообщение в чате (Realtime), загрузка аватара.
      ← это и есть прежний «Этап 1 — добить Supabase» в новой формулировке.

## Этап 2 — домен, HTTPS, прод-доступ (~0,5 дня)

- [ ] 2.1. DNS: A-записи `@` → IP (фронтенд) и `db.` → IP (API-субдомен);
      DNS регистратора или бесплатный DNS Selectel.
- [ ] 2.2. nginx на сервере: vhost фронтенда (root = `public/`, SPA:
      `try_files $uri /index.html;` — заменяет и Cloudflare Pages, и server.js)
      + vhost `db.<домен>` → `proxy_pass http://127.0.0.1:8000` (kong) c
      проксированием WebSocket для Realtime (`Upgrade/Connection`).
- [ ] 2.3. HTTPS: `certbot --nginx` (Let's Encrypt, автопродление). Studio снаружи
      закрыть: оставить только через SSH-туннель или basic-auth kong.
- [ ] 2.4. `SUPABASE_URL` в config.mjs → `https://db.<домен>`; в консолях
      OAuth-провайдеров (Google/GitHub/Apple) обновить redirect URI на
      `https://db.<домен>/auth/v1/callback`.
- [ ] 2.5. SMTP в `.env` auth-сервиса (gotrue): хост/порт/логин UniSender и т.п.;
      проверить письмо подтверждения и reset.
- [ ] 2.6. Включить аналитику: счётчик metrika.yandex.ru для домена →
      `CONFIG.METRIKA.counterId` + `ENABLE_METRIKA: true`.
- [ ] 2.7. Заменить placeholder-домен `samplehelp.example` в `index.html`
      (og:url, og:image, canonical), `robots.txt` (Sitemap), `sitemap.xml`.

## Этап 3 — монетизация и защита на бою

- [ ] 3.1. Яндекс.Реклама: добавить площадку → модерация (~1 день) → RTB-блоки
      (тёмная тема) → ID в `CONFIG.ADS.blocks` → `ENABLE_ADS: true`.
- [ ] 3.2. Ошибки на бою: GlitchTip (self-hosted, совместим с Sentry-SDK) или
      Sentry self-host на том же сервере; DSN в конфиг.
- [ ] 3.3. Лимит исходного файла ~25 МБ + rate-limits (kong/nginx limit_req).
- [ ] 3.4. Платежи премиума/донатов, когда решим включать: ЮKassa / CloudPayments
      (Stripe в РФ недоступен). Таблицы products/orders уже готовы.

## Этап 4 — рост (триггеры из SCALE_PLAN, пересмотрены под Selectel)

- [ ] egress > ~1 ТБ/мес ИЛИ аудитория вне РФ → включить Selectel CDN (550 ₽/мес,
      800 ГБ; S3-домен за CDN; origin-трафик 100 ГБ включён).
- [ ] RAM стабильно > 70% (~3–5k DAU) → 4 vCPU / 8 ГБ (5 079 ₽/мес).
- [ ] БД > 8 ГБ или DAU > 5k → managed PostgreSQL Selectel или реплика чтения.
- [ ] Egress > 3 ТБ (конец бесплатного лимита) → 0,90 ₽/ГБ сверх либо CDN раньше.
- [ ] Раз в месяц: панели Selectel (трафик/диск/БД) + отчёты Метрики.

---

## Бюджет (цены калькулятора Selectel, НДС 22%, на 2026-10)

| Статья | Старт (≤1k DAU) | Цель (10k DAU) |
|---|---|---|
| VPS 2vCPU/8GB (стек без studio/analytics + nginx + фронт) | 3 609 ₽ | 5 079 ₽ (4vCPU/8GB) |
| Диск 100 ГБ SSD | ~400 ₽ | ~600 ₽ |
| Публичная сеть / IP (минимум калькулятора) | от ~1 140 ₽ | от ~1 140 ₽ |
| S3 стандарт 1,96 ₽/ГБ + запросы | ~40 ₽ | ~210 ₽ (80 ГБ) |
| CDN | 0 ₽ (3 ТБ трафика VPS бесплатно) | 550 ₽ (пакет 800 ГБ) |
| Бэкапы (S3 «Ледяное» + снапшоты) | ~100 ₽ | ~200 ₽ |
| Домен .ru + Let's Encrypt | ~50 ₽ | ~50 ₽ |
| SMTP free / Метрика / Реклама | 0 ₽ | 0 ₽ |
| **ИТОГО** | **≈ 5 340 ₽/мес** | **≈ 7 830 ₽/мес** |

До выкладки расход = 0 ₽ (демо-режим). Альтернатива «впритык» 2vCPU/4GB
(2 540 ₽) возможна, но запас RAM за ~1 000 ₽ убирает класс ночных инцидентов.

## Чего НЕ делаем (осознанно)

- Не переписываем слой данных под «нативный» бэкенд (месяцы работы, потеря RLS).
- Не покупаем CDN и NAS на старте; не берём managed-БД до 5k DAU.
- Не держим Studio открытой в интернет на бою; не храним секреты в репозитории
  (`.env` только на сервере, в `.gitignore` уже есть `.env`).
