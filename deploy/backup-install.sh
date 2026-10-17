#!/usr/bin/env bash
# ============================================================
# Бэкапы PostgreSQL в Selectel S3 («Ледяное» не ставится через S3-API —
# кладём в отдельный бакет samplehelp-backups, класс стандарт, копейки).
# Установка: bash backup-install.sh <ACCESS> <SECRET> [REGION]
# Дальше работает cron: ежедневно 04:17, ротация 30 дней локально не нужна
# (локальный файл удаляется сразу после загрузки).
# ============================================================
set -euo pipefail
AK=${1:?access key}; SK=${2:?secret key}; REGION=${3:-ru-3}
apt-get -y install awscli >/dev/null 2>&1 || true
cat > /root/.s3backup-creds <<EOF
export AWS_ACCESS_KEY_ID=${AK}
export AWS_SECRET_ACCESS_KEY=${SK}
export AWS_ENDPOINT_URL=https://s3.${REGION}.storage.selcloud.ru
export BACKUP_BUCKET=samplehelp-backups
EOF
chmod 600 /root/.s3backup-creds

cat > /usr/local/bin/samplehelp-backup.sh <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
source /root/.s3backup-creds
STAMP=$(date +%F_%H%M)
cd /opt/supabase
docker compose exec -T db pg_dump -U postgres --format=custom > "/tmp/pg_${STAMP}.dump"
gzip -f "/tmp/pg_${STAMP}.dump"
aws s3 cp "/tmp/pg_${STAMP}.dump.gz" "s3://${BACKUP_BUCKET}/pg/" --endpoint-url "$AWS_ENDPOINT_URL"
rm -f "/tmp/pg_${STAMP}.dump.gz"
echo "$(date -Is) ok pg_${STAMP}.dump.gz"
EOS
chmod +x /usr/local/bin/samplehelp-backup.sh

grep -q samplehelp-backup /etc/crontab || \
  echo '17 4 * * * root /usr/local/bin/samplehelp-backup.sh >> /var/log/samplehelp-backup.log 2>&1' >> /etc/crontab
echo "✓ cron установлен (04:17 ежедневно); контрольный прогон…"
/usr/local/bin/samplehelp-backup.sh && echo "✓ первый бэкап ушёл в S3"
