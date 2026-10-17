# deploy/minipc/ — комплект выкладки на мини-ПК (Фаза D, заход 48)

Ранбук с этапами и проверками: **`../../DEPLOY_MINIPC.md`** (читать его;
здесь только состав комплекта). Порядок: 00 → 10 → 20 → 30 → 40.

| Файл | Что делает | Куда ставится |
|---|---|---|
| `00-bootstrap.sh` | свежая Ubuntu: пакеты (nginx/PG/node20), пользователь `samplehelp`, каталоги, ufw, unattended-upgrades | запускается из дерева проекта |
| `10-install-app.sh <dump> [домен]` | восстановление проекта из дампа, npm-зависимости, роль+БД, генерация секретов в env, migrate, `USE_LOCAL_BACKEND: true` в серверной копии config.mjs | — |
| `20-services.sh` | systemd-юнит backend + сайт nginx + health-чеки | `/etc/systemd/system/`, `/etc/nginx/sites-*` |
| `30-tunnel.sh <домен>` | cloudflared: установка, login, create, конфиг, DNS, сервис | `/etc/cloudflared/config.yml` |
| `40-backup-install.sh` | cron 03:30 + контрольный прогон бэкапа | `/usr/local/bin/samplehelp-{backup,restore}` |
| `backup.sh` | pg_dump -Fc + rsync storage + env, ротация 7/4, опц. оффсайт | ставится как `samplehelp-backup` |
| `restore.sh <каталог>` | восстановление БД+файлов (план B — на той же машине или резервном VPS) | ставится как `samplehelp-restore` |
| `samplehelp-backend.service` | юнит: Restart=always, hardening, ReadWritePaths=storage | `/etc/systemd/system/` |
| `samplehelp.env.example` | шаблон `/etc/samplehelp/backend.env` (секреты генерирует 10-install-app.sh) | `/etc/samplehelp/backend.env` |
| `cloudflared-config.yml` | шаблон ingress-конфига туннеля (домен/UUID подставляет 30-tunnel.sh) | `/etc/cloudflared/config.yml` |

Каталоги на сервере: код `/var/www/samplehelp`, загрузки
`/var/lib/samplehelp/storage` (бакеты question-audio/presets/avatars публичные,
marketplace-files приватный), секреты `/etc/samplehelp`, бэкапы `/mnt/backup`.

Статус проверки (песочница, 2026-10-16): `bash -n` всех скриптов ✓,
`nginx -t` ✓, ЖИВАЯ топология nginx→node — 13 проверок ✓ (SPA, прокси /api,
/files с кэшем, приватный бакет 404, no-store HTML, CORS-префлайт; закрыт баг
MIME для .mjs — types-блок в конфиге); systemd-юниты визуально (в песочнице
нет systemd); живой прогон на железе — D2.

`../legacy_selectel/` — АРХИВ отменённого плана 2026-10-11 (Selectel +
self-hosted Supabase): не используется, хранится как история.
