#!/usr/bin/env bash
# deploy/minipc/restore.sh — восстановление SampleHelp из каталога бэкапа
# (план B: та же машина после сбоя ИЛИ резервный VPS — см. DEPLOY_MINIPC.md §7).
# Запуск: sudo bash restore.sh /mnt/backup/samplehelp/daily/2026-10-20_033000
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Нужен root: sudo bash $0 <каталог-бэкапа>"; exit 1; fi
SRC="${1:-}"
[ -d "$SRC" ] || { echo "Каталог бэкапа не найден: $SRC"; exit 1; }
[ -f "$SRC/db.dump" ] || { echo "В каталоге нет db.dump"; exit 1; }

DB_NAME="${DB_NAME:-samplehelp}"
STORAGE_DIR="${STORAGE_DIR:-/var/lib/samplehelp/storage}"

echo "Восстановление из: $SRC"
read -r -p "Текущие БД '$DB_NAME' и storage будут ПЕРЕЗАПИСАНЫ. Продолжить? [y/N] " ans
[ "$ans" = "y" ] || { echo "Отменено"; exit 0; }

systemctl stop samplehelp-backend || true

echo "== База =="
sudo -u postgres pg_restore --clean --if-exists -d "$DB_NAME" "$SRC/db.dump" \
  || echo "⚠ pg_restore сообщил о пропущенных объектах (обычно не критично — см. вывод выше)"

echo "== Файлы =="
mkdir -p "$STORAGE_DIR"
rsync -a --delete "$SRC/storage/" "$STORAGE_DIR/"
chown -R samplehelp:samplehelp "$(dirname "$STORAGE_DIR")"

echo "== Конфигурация =="
if [ -f "$SRC/backend.env" ] && [ ! -f /etc/samplehelp/backend.env ]; then
  mkdir -p /etc/samplehelp
  cp "$SRC/backend.env" /etc/samplehelp/backend.env
  chown root:samplehelp /etc/samplehelp/backend.env && chmod 640 /etc/samplehelp/backend.env
fi

systemctl start samplehelp-backend
sleep 2
curl -fsS http://127.0.0.1:3100/api/health && echo && echo "✓ Восстановлено и запущено"
