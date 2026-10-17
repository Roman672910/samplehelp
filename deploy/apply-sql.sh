#!/usr/bin/env bash
# ============================================================
# Применить НАШИ sql-скрипты БД к self-hosted стеку (шаг 1.8 ранбука).
# Использование: bash apply-sql.sh /opt/stage/supabase
# (порядок важен: setup.sql затем storage.sql; оба идемпотентны)
# ============================================================
set -euo pipefail
SQL_DIR=${1:?путь к папке supabase/ проекта}
cd /opt/supabase
for f in setup.sql storage.sql; do
  echo ">> применяю $f…"
  docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 < "${SQL_DIR}/${f}"
done
echo "✓ схемы, RLS, триггеры, realtime-публикации и бакеты применены"
docker compose exec -T db psql -U postgres -Atc \
  "select count(*) || ' таблиц' from information_schema.tables where table_schema='public'"
