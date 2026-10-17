# 🇷🇺 DEPLOY_MINIPC.md — выкладка SampleHelp на мини-ПК (Фаза D перезахода 48)

> **Решение заказчика 2026-10-14 (перекрывает DEPLOY_SELECTEL.md):** Supabase
> убирается полностью; целевая инфраструктура — **мини-ПК дома**: Ubuntu Server
> (Node.js + Express + PostgreSQL + Socket.IO + Nginx), выход в интернет через
> **Cloudflare Tunnel + CDN** (кэш аудио/статики), хранилище — локальный SSD.
> Фазы A–C выполнены (backend + адаптер api.mjs); этот ранбук — Фаза D.
> Комплект скриптов: `deploy/minipc/` (порядок запуска — в конце документа).
> Статус: **D1 готово (2026-10-16, документация+комплект), D2–D5 — по приезду мини-ПК.**

## 0. Расчёт нагрузки и требования к железу (из SCALE_PLAN, цель ~10k DAU)

| Ресурс | Расход (Opus 48 kbps mono) | Вывод |
|---|---|---|
| Хранилище аудио | ~5–9 ГБ/мес (~60–100 ГБ/год) | NVMe SSD 512 ГБ = 5+ лет |
| Egress (прослушивание) | ~250–350 ГБ/мес | снимает CDN-кэш Cloudflare; домашний канал почти не нагружается |
| База данных | ~250–300 МБ/мес | годы без обслуживания |
| RAM | PG ~300 МБ + node ~150 МБ + nginx ~20 МБ | 8 ГБ хватает с запасом (16 — комфорт) |
| CPU | Socket.IO single-node держит 1k+ одновременных | 4 ядра (N100-класс или б/у NUC/ThinkCentre) |

Обязательно: проводной Ethernet (не Wi-Fi), UPS желателен. Расходы: мини-ПК
разово ~15–30 т.₽, домен ~200–400 ₽/год, Cloudflare Free — 0 ₽, электричество
~100–200 ₽/мес, внешний носитель для бэкапов ~5 т.₽ разово.

## Этапы (порядок фиксирован)

### Этап 0 — покупки и аккаунты (не блокируют ничего)
- [ ] 0.1. Мини-ПК: 4 ядра / 8–16 ГБ RAM / NVMe 512 ГБ / Ethernet. Ubuntu Server
      22.04 или 24.04 LTS (при покупке без ОС — поставить с флешки; Wi-Fi-настройка
      не нужна, сразу кабель).
- [ ] 0.2. Домен .ru/.рф у RU-регистратора (reg.ru, RU-CENTER, nic.ru). Имя занять
      ДО выкладки. **Cloudflare-аккаунт** (Free): Add site → прописать NS-серверы
      Cloudflare у регистратора (продажа доменов Cloudflare в РФ приостановлена —
      поэтому регистратор RU, DNS/туннель/CDN — Cloudflare, это работает).
- [ ] 0.3. Внешний носитель для бэкапов (USB-SSD/HDD ≥ 256 ГБ) + решение по
      оффсайт-копии (вторая машина / арендованный VPS / облако РФ).
- [ ] 0.4. SMTP для писем сброса пароля: UniSender / SendPulse (free-тарифы) или
      Яндекс.Почта для домена. До настройки SMTP ссылка сброса печатается в
      `journalctl -u samplehelp-backend` — для семьи/друзей на старте достаточно.

### Этап 1 — базовая система (D2; ~30 минут, скрипт `00-bootstrap.sh`)
- [ ] 1.1. Первый вход: `ssh <пользователь>@<IP-мини-ПК>` (IP смотрите в роутере;
      закрепите за машиной статическую аренду DHCP — пригодится для LAN-проверки).
- [ ] 1.2. Скопировать проект на машину (любым способом: флешка + дамп
      `filelist_with_content.txt`, scp, git). Достаточно ОДНОГО файла дампа —
      `10-install-app.sh` восстановит всё дерево сам.
- [ ] 1.3. `sudo bash deploy/minipc/00-bootstrap.sh` — пакеты (nginx, postgresql,
      node 20, rsync, ufw), сервисный пользователь `samplehelp`, каталоги
      (`/var/www/samplehelp` — код, `/var/lib/samplehelp/storage` — файлы,
      `/etc/samplehelp` — секреты), unattended-upgrades, ufw (только SSH и 80
      для LAN-проверки; **публичный трафик пойдёт исходящим туннелем — открытых
      входящих портов не будет**).
- [ ] 1.4. Каталог `/mnt/backup` — примонтировать внешний носитель (fstab,
      по UUID; `lsblk -f` → `blkid`).

### Этап 2 — приложение (D2; ~10 минут, скрипт `10-install-app.sh`)
- [ ] 2.1. `sudo bash deploy/minipc/10-install-app.sh /путь/к/filelist_with_content.txt ваш-домен.ru`
      Скрипт: восстановит проект из дампа → `npm install` в backend → создаст роль
      и БД `samplehelp` → сгенерирует секреты (`openssl rand -hex 32` для
      JWT_SECRET/REFRESH_SECRET, пароль БД) в `/etc/samplehelp/backend.env`
      (root:samplehelp, 640) → `node src/migrate.js` → поставит в серверной копии
      `config.mjs`: `USE_LOCAL_BACKEND: true`, `API_URL: 'https://ваш-домен.ru'`.
      Повторный запуск безопасен: секреты и БД сохраняются, код обновляется.
- [ ] 2.2. Админ-владелец (до первой регистрации!):
      `sudo -u postgres psql -d samplehelp -c "update owner_config set owner_email = 'вы@почта.ru';"`
      Первая регистрация под этой почтой получит `is_admin` (бейдж 🛡, /moderation).
      После РУЧНОГО повышения существующего профиля — перелогин (is_admin в JWT).
- [ ] 2.3. `sudo bash deploy/minipc/20-services.sh` — systemd-юнит
      `samplehelp-backend` (Restart=always, hardening, ReadWritePaths только
      storage) + сайт nginx (статика/SPA, прокси /api и /socket.io с часовым
      таймаутом для вебсокетов, /files напрямую с SSD только для публичных
      бакетов, client_max_body_size 30m) + health-чеки.
- [ ] 2.4. LAN-проверка: `http://<IP-мини-ПК>/` — сайт, подвал «BACKEND:
      подключено ✓»; регистрация, вопрос с аудио, ЛС из двух окон; файл лёг в
      `/var/lib/samplehelp/storage/question-audio/`, играет с `/files/...`.
      Логи: `journalctl -u samplehelp-backend -f`, `/var/log/nginx/error.log`.

### Этап 3 — Cloudflare Tunnel (D3; ~20 минут + ожидание NS, скрипт `30-tunnel.sh`)
- [ ] 3.1. Домен добавлен в Cloudflare (NS прописаны у регистратора, статус Active).
- [ ] 3.2. `sudo bash deploy/minipc/30-tunnel.sh ваш-домен.ru` — установка
      cloudflared, `tunnel login` (ссылка открывается в браузере любой машины),
      `tunnel create samplehelp`, конфиг `/etc/cloudflared/config.yml`
      (hostname → `http://127.0.0.1:80`, www — по желанию), `tunnel route dns`,
      сервис cloudflared (автозапуск). Соединение ИСХОДЯЩЕЕ: из РФ работает,
      белый IP/проброс портов не нужны.
- [ ] 3.3. Проверка: `curl https://ваш-домен.ru/api/health`, открыть сайт
      из внешней сети (например, с телефона через мобильный интернет).

### Этап 4 — CDN и кэш (D3; дашборд Cloudflare)
- [ ] 4.1. **SSL/TLS → режим Full** (не Flexible — иначе циклический редирект).
- [ ] 4.2. **Cache Rules** (Rules → Cache Rules):
      | Условие | Действие |
      |---|---|
      | URI path starts with `/files/` | Cache eligible, Edge TTL: 1 месяц |
      | URI path starts with `/assets/` или `/vendor/` или `/locales/`, расширение css/js/mjs | Cache eligible, Edge TTL: 1 день |
      | URI path starts with `/api/` или `/socket.io/` | Bypass cache (eligible for cache: off) |
      | Всё прочее (HTML/SPA) | не кешировать (по умолчанию) |
      Статика css/js/mjs отдаётся nginx с `no-store` — после релиза достаточно
      Purge Cache в дашборде (или менять нечего: HTML не кешируется).
- [ ] 4.3. SSL/TLS → Edge Certificates: Always Use HTTPS ✓, Minimum TLS 1.2 ✓,
      Automatic HTTPS Rewrites ✓.
- [ ] 4.4. **Замена домена-заглушки** `samplehelp.example` (чек-лист SCALE_PLAN 13а):
      `public/index.html` (og:url, og:image, canonical), `robots.txt` (Sitemap),
      `sitemap.xml`, `API_URL`/`PUBLIC_URL` (скрипт установки уже подставил домен —
      перепроверить). Динамические OG-карточки вопросов — отдельной задачей после
      запуска (Pages Functions/Worker не применимы для туннельной схемы — решим на месте).
- [ ] 4.5. ⚖️ **152-ФЗ-нюанс (осознанное решение):** БД и персональные данные
      (контакты, e-mail) хранятся НА ТЕРРИТОРИИ РФ (мини-ПК дома) ✓; Cloudflare
      кеширует только публичные медиафайлы (аудио/аватары/статику). Если нужен
      строгий режим — отключите кэш для `/files/avatars/` (правилом в 4.2) или
      не включайте CDN-кэш вовсе (origin-трафик вырастет, на старте терпимо).

### Этап 5 — письма (D4)
- [ ] 5.1. SMTP-провайдер → вписать `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` в
      `/etc/samplehelp/backend.env` → `systemctl restart samplehelp-backend`.
      Проверка: «Забыли пароль» → письмо со ссылкой `https://домен/#reset=<токен>`.
- [ ] 5.2. **Должок Фазы C:** экран ввода нового пароля по хэшу `#reset=`
      (эндпойнт `POST /api/auth/reset-confirm {token,password}` готов) — мини-заход
      на фронте до объявления регистрации посторонним.

### Этап 6 — бэкапы и план B (D5; скрипт `40-backup-install.sh`)
- [ ] 6.1. `sudo bash deploy/minipc/40-backup-install.sh` — cron 03:30:
      `pg_dump -Fc` + `rsync storage/` + копия env → `/mnt/backup/samplehelp/daily/<дата>`,
      ротация 7 дневных + 4 недельных, журнал `/var/log/samplehelp-backup.log`.
- [ ] 6.2. Оффсайт-копия: `OPTIONAL_OFFSITE=user@вторая-машина:samplehelp/` в
      `/usr/local/bin/samplehelp-backup` (или ручной вывоз носителя раз в неделю).
      Правило 3-2-1: 3 копии, 2 носителя, 1 вне дома.
- [ ] 6.3. **Репетиция восстановления** (обязательно!): `sudo samplehelp-restore
      /mnt/backup/samplehelp/daily/<свежий>` → health + данные на месте.
- [ ] 6.4. План B (мини-ПК — единая точка отказа): любой дешёвый VPS (2 vCPU/4 ГБ,
      ~500 ₽/мес) — на нём `00-bootstrap.sh` + `10-install-app.sh` (тот же дамп) +
      последний оффсайт-бэкап через `samplehelp-restore` → переключить tunnel
      (cloudflared на VPS с тем же конфигом) — простой ~1 час.

### Этап 7 — SECURITY-чек-лист перед запуском (D5)
- [ ] ufw active, входящие только SSH (+80 для LAN; публичный трафик — туннель).
- [ ] SSH по ключам, парольный вход выключен (`PasswordAuthentication no`).
- [ ] `JWT_SECRET`/`REFRESH_SECRET` — уникальные 32+ байт (сгенерированы скриптом;
      дев-значения из кода НЕ используются); ротация = перегенерировать + restart
      (все сессии сбросятся). Ревизия — раз в полгода.
- [ ] `/etc/samplehelp/backend.env` — root:samplehelp 640, не в дампе/гите.
- [ ] bcrypt cost 12 ✓ (в коде), rate-limit /api/auth ✓ (20/мин/IP), лимит
      загрузки 25 МБ ✓, mime-белые списки ✓, приватный бакет не отдаётся nginx ✓.
- [ ] unattended-upgrades включён ✓; `node -v`, `nginx -v`, PG — из репозитория.
- [ ] Юр-страницы Terms/Privacy/DMCA + политика ПДн (152-ФЗ) — SCALE_PLAN этап 3
      (нужны до публичного запуска; заглушки-ссылки в подвале).
- [ ] Sentry free (5k ошибок/мес) — SCALE_PLAN этап 3, по желанию.

### Этап 8 — мониторинг и запуск (D5)
- [ ] 8.1. Раз в месяц: `df -h` (SSD < 80%), `du -sh /var/lib/samplehelp/storage`,
      размер БД (`select pg_size_pretty(pg_database_size('samplehelp'));`),
      Cloudflare Analytics (egress/запросы), `journalctl -u samplehelp-backend -p err`.
- [ ] 8.2. Триггеры роста (SCALE_PLAN этап 5): storage > 400 ГБ → докупка/чистка;
      egress через CDN > 1 ТБ/мес или туннель нестабилен → переезд на VPS в РФ
      (план B уже отработан в 6.4); MAU > 100k → апгрейд железа/схема с репликой.
- [ ] 8.3. Метрика и РСЯ: после домена — `ENABLE_METRIKA: true` (+counterId),
      `ENABLE_ADS: true` (+ID блоков RTB) — механика в README «Монетизация».
- [ ] 8.4. ЗАПУСК: анонс, сбор обратной связи через /ideas, еженедельный бэкап-контроль.

## Порядок запуска комплекта (шпаргалка)
```bash
# на мини-ПК (Ubuntu Server), проект скопирован (достаточно дампа):
cd <проект>
sudo bash deploy/minipc/00-bootstrap.sh                                  # система
sudo bash deploy/minipc/10-install-app.sh /путь/filelist_with_content.txt ваш-домен.ru
sudo -u postgres psql -d samplehelp -c "update owner_config set owner_email='вы@почта.ru';"
sudo bash deploy/minipc/20-services.sh                                   # systemd+nginx+чеки
# LAN-проверка: http://<IP>/  → регистрация, вопрос с аудио, ЛС
sudo bash deploy/minipc/30-tunnel.sh ваш-домен.ru                        # публикация
# дашборд Cloudflare: Full SSL + Cache Rules (таблица этапа 4)
sudo bash deploy/minipc/40-backup-install.sh                             # бэкапы + репетиция
```

## Troubleshooting
| Симптом | Куда смотреть |
|---|---|
| Подвал «BACKEND: ошибка подключения» | `journalctl -u samplehelp-backend -n 50`; `systemctl status`; env-файл |
| 502 Bad Gateway | backend не поднят (то же, что выше); nginx error.log |
| Сайт открывается, realtime нет | `/socket.io/` proxy c Upgrade-заголовками (nginx conf), `systemctl status cloudflared` |
| Аудио не играет | `/files/question-audio/...` → 404? alias nginx + права на storage (samplehelp) |
| Загрузка файла → ошибка | журнал backend: `storage_unavailable` назовёт папку и код; место на SSD |
| Туннель не поднимается | `cloudflared tunnel info samplehelp`; NS-статус домена Active; время (NS до 24ч) |
| Письмо сброса не пришло | без SMTP — ссылка в `journalctl -u samplehelp-backend` (grep mailer) |
| Обновить код после нового дампа | `10-install-app.sh <новый дамп> домен` → `20-services.sh` (секреты/БД сохранятся) |

## Расходы (итог)
Мини-ПК ~15–30 т.₽ разово + носитель бэкапов ~5 т.₽ разово + домен ~200–400 ₽/год
+ Cloudflare 0 ₽ + электричество ~100–200 ₽/мес + (опц.) VPS плана B ~500 ₽/мес
+ (опц.) SMTP ~0–900 ₽/мес. Это дешевле Selectel-варианта (~3,6 т.₽/мес) и
соответствует решению заказчика от 2026-10-14.
