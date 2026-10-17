#!/usr/bin/env bash
# deploy/minipc/40-backup-install.sh — установка бэкапов по расписанию (Фаза D5).
# Идемпотентен. Запуск: sudo bash 40-backup-install.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Нужен root: sudo bash $0"; exit 1; fi
KIT=/var/www/samplehelp/deploy/minipc
BACKUP_ROOT=/mnt/backup/samplehelp

install -m 755 "$KIT/backup.sh"  /usr/local/bin/samplehelp-backup
install -m 755 "$KIT/restore.sh" /usr/local/bin/samplehelp-restore
mkdir -p "$BACKUP_ROOT"/{daily,weekly}
chmod 700 /mnt/backup

cat > /etc/cron.d/samplehelp-backup <<'EOF'
# Ежедневный бэкап SampleHelp: 03:30 (pg_dump + storage + env, ротация 7/4)
30 3 * * * root /usr/local/bin/samplehelp-backup >> /var/log/samplehelp-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/samplehelp-backup

echo "== Контрольный прогон =="
samplehelp-backup

cat <<EOF

✓ Бэкапы установлены: cron 03:30 → $BACKUP_ROOT, журнал /var/log/samplehelp-backup.log
Что сделать руками (ОБЯЗАТЕЛЬНО, см. DEPLOY_MINIPC.md §6):
  1) Примонтируйте внешний носитель в /mnt/backup (fstab) — НЕ храните бэкапы
     только на том же SSD, что и данные.
  2) Оффсайт-копия: впишите OPTIONAL_OFFSITE в /usr/local/bin/samplehelp-backup
     (rsync-цель на второй машине/хостинге) или вывозите носитель вручную.
  3) РЕПЕТИЦИЯ восстановления: sudo samplehelp-restore <каталог> — план B
     не работает, если его ни разу не запускали.
EOF
