#!/usr/bin/env bash
# ============================================================
# Подключить Selectel S3 как физический бэкенд Supabase Storage.
# Логические бакеты (question-audio, avatars, presets, marketplace-files)
# создаёт наш storage.sql ВНУТРИ Supabase; в S3 они живут префиксами
# внутри ОДНОГО физического бакета samplehelp-storage.
# Использование: bash configure-s3.sh <ACCESS_KEY> <SECRET_KEY> [REGION]
# ============================================================
set -euo pipefail
AK=${1:?access key}; SK=${2:?secret key}; REGION=${3:-ru-3}
ENDPOINT="https://s3.${REGION}.storage.selcloud.ru"
cd /opt/supabase

grep -q '^STORAGE_BACKEND=s3' .env && { echo "S3 уже подключён — правлю значения"; }
# вырезаем прежние s3-строки, дописываем актуальные
sed -i '/^STORAGE_BACKEND=/d;/^STORAGE_S3_/d;/^GLOBAL_S3_/d;/^AWS_ACCESS_KEY_ID=/d;/^AWS_SECRET_ACCESS_KEY=/d' .env
cat >> .env <<EOF
STORAGE_BACKEND=s3
STORAGE_S3_BUCKET=samplehelp-storage
STORAGE_S3_REGION=${REGION}
GLOBAL_S3_ENDPOINT=${ENDPOINT}
GLOBAL_S3_PROTOCOL=https
GLOBAL_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=${AK}
AWS_SECRET_ACCESS_KEY=${SK}
EOF

echo ">> перезапуск storage (+ kong для чистоты)…"
docker compose restart storage kong
sleep 5
curl -sf -o /dev/null http://127.0.0.1:8000/storage/v1/status && echo "✓ storage здоров на S3-бэкенде"
echo ">> проверьте: создайте любой бакет через SQL/Studio и залейте файл (шаг 1.9 ранбука)"
