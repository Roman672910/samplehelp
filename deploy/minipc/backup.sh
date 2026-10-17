#!/usr/bin/env bash
# deploy/minipc/backup.sh — ежедневный бэкап SampleHelp (Фаза D5).
# Состав: pg_dump базы + rsync storage/ (аудио/аватары/пресеты) + копия env.
# Ротация: 7 дневных + 4 недельных (воскресных). Оффсайт — OPTIONAL_OFFSITE
# (rsync-цель вида user@backup-host:samplehelp/ или путь второго носителя).
# Ставится как /usr/local/bin/samplehelp-backup (40-backup-install.sh), cron 03:30.
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/mnt/backup/samplehelp}"
DB_NAME="${DB_NAME:-samplehelp}"
STORAGE_DIR="${STORAGE_DIR:-/var/lib/samplehelp/storage}"
ENV_FILE="${ENV_FILE:-/etc/samplehelp/backend.env}"
KEEP_DAILY=7
KEEP_WEEKLY=4
OPTIONAL_OFFSITE="${OPTIONAL_OFFSITE:-}"   # напр. user@backup-host:samplehelp/

STAMP=$(date +%F_%H%M%S)
DEST="$BACKUP_ROOT/daily/$STAMP"
mkdir -p "$DEST"

# 1) База (кастомный формат: сжатие + выборочное восстановление)
sudo -u postgres pg_dump -Fc "$DB_NAME" > "$DEST/db.dump"

# 2) Файлы загрузок
rsync -a --delete "$STORAGE_DIR/" "$DEST/storage/"

# 3) Конфигурация (секреты! каталог бэкапов — только root)
cp "$ENV_FILE" "$DEST/backend.env"
chmod -R go-rwx "$BACKUP_ROOT"

# 4) Ротация дневных
ls -1d "$BACKUP_ROOT"/daily/20* 2>/dev/null | sort | head -n -"$KEEP_DAILY" | xargs -r rm -rf

# 5) Недельная копия (по воскресеньям) + её ротация
if [ "$(date +%u)" = "7" ]; then
  WDEST="$BACKUP_ROOT/weekly/$STAMP"
  mkdir -p "$WDEST"
  cp -a "$DEST/." "$WDEST/"
  ls -1d "$BACKUP_ROOT"/weekly/20* 2>/dev/null | sort | head -n -"$KEEP_WEEKLY" | xargs -r rm -rf
fi

# 6) Оффсайт-копия (если задана): свежий дневной каталок целиком
if [ -n "$OPTIONAL_OFFSITE" ]; then
  rsync -az --delete "$DEST/" "$OPTIONAL_OFFSITE/latest/" \
    && echo "  ✓ оффсайт-копия отправлена: $OPTIONAL_OFFSITE" \
    || echo "  ⚠ оффсайт-копия НЕ отправлена (проверьте доступность цели)"
fi

echo "✓ Бэкап готов: $DEST ($(du -sh "$DEST" | cut -f1))"
