#!/usr/bin/env bash
# deploy/minipc/10-install-app.sh — установка приложения SampleHelp из дампа
# filelist_with_content.txt (Фаза D2). Идемпотентен (перезапуск обновляет код,
# данные БД и storage НЕ трогает).
# Запуск: sudo bash 10-install-app.sh <dump.txt> [ваш-домен.ru]
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Нужен root: sudo bash $0 <dump.txt> [домен]"; exit 1; fi
DUMP="${1:-}"
DOMAIN="${2:-}"
[ -f "$DUMP" ] || { echo "Дамп не найден: $DUMP"; exit 1; }

APP_DIR=/var/www/samplehelp
DATA_DIR=/var/lib/samplehelp
STORAGE_DIR=$DATA_DIR/storage
ENV_FILE=/etc/samplehelp/backend.env
DB_NAME=samplehelp
DB_ROLE=samplehelp

echo "== 1/6 Восстановление проекта из дампа =="
# restore-скрипт вырезаем из дампа точечно (node гарантирован bootstrap'ом),
# затем восстанавливаем весь проект штатным скриптом.
TMP=$(mktemp -d)
cat > "$TMP/extract.cjs" <<'JSEOF'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '').split('\n').map((l) => l.replace(/\r$/, ''));
let start = null, end = null;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('[📄 ФАЙЛ]') && lines[i].trimEnd().endsWith('scripts/restore-filelist.cjs')) {
    for (let j = i; j < Math.min(i + 20, lines.length); j++) if (lines[j].trim() === '--- НАЧАЛО СОДЕРЖИМОГО ---') { start = j + 1; break; }
    break;
  }
}
if (start === null) throw new Error('restore-скрипт не найден в дампе');
for (let j = start; j < lines.length; j++) if (lines[j].trim() === '--- КОНЕЦ СОДЕРЖИМОГО ---') { end = j; break; }
if (end === null) throw new Error('конец блока не найден');
fs.writeFileSync(process.argv[3], lines.slice(start, end).join('\n') + '\n');
JSEOF
node "$TMP/extract.cjs" "$DUMP" "$TMP/restore-filelist.cjs"
node "$TMP/restore-filelist.cjs" "$DUMP" "$APP_DIR"
rm -rf "$TMP"
chown -R samplehelp:samplehelp "$APP_DIR"

echo "== 2/6 Зависимости backend =="
cd "$APP_DIR/backend"
sudo -u samplehelp npm install --no-audit --no-fund

echo "== 3/6 База и роль PostgreSQL =="
DB_PASS=$(openssl rand -hex 16)
if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_ROLE'" | grep -q 1; then
  sudo -u postgres psql -qc "alter role $DB_ROLE with login password '$DB_PASS';"
else
  sudo -u postgres psql -qc "create role $DB_ROLE login password '$DB_PASS';"
fi
sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_ROLE" "$DB_NAME"

echo "== 4/6 Секреты и env-файл =="
if [ -f "$ENV_FILE" ]; then
  # Сохраняем прежние секреты/пароли (обновление кода не должно рвать сессии и БД)
  OLD_DB_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)
  OLD_JWT=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
  OLD_REF=$(grep -E '^REFRESH_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
  DB_URL_OVERRIDE=""
  if [ -n "$OLD_DB_URL" ]; then DB_URL_OVERRIDE="$OLD_DB_URL"; fi
else
  cp "$APP_DIR/deploy/minipc/samplehelp.env.example" "$ENV_FILE"
  DB_URL_OVERRIDE=""
  OLD_JWT=""; OLD_REF=""
fi
DB_URL="${DB_URL_OVERRIDE:-postgres://$DB_ROLE:$DB_PASS@127.0.0.1:5432/$DB_NAME}"
JWT="${OLD_JWT:-$(openssl rand -hex 32)}"
REF="${OLD_REF:-$(openssl rand -hex 32)}"
PUBURL="${PUBLIC_URL_OVERRIDE:-https://${DOMAIN:-localhost}}"
sed -i \
  -e "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" \
  -e "s|^REFRESH_SECRET=.*|REFRESH_SECRET=$REF|" \
  -e "s|^STORAGE_DIR=.*|STORAGE_DIR=$STORAGE_DIR|" \
  -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBURL|" \
  "$ENV_FILE"
chown root:samplehelp "$ENV_FILE" && chmod 640 "$ENV_FILE"

echo "== 5/6 Миграция схемы (идемпотентно) =="
sudo -u samplehelp env DATABASE_URL="$DB_URL" node "$APP_DIR/backend/src/migrate.js"

echo "== 6/6 Фронт-конфиг под backend =="
CFG="$APP_DIR/public/js/config.mjs"
sed -i "s/USE_LOCAL_BACKEND: false/USE_LOCAL_BACKEND: true/" "$CFG"
if [ -n "$DOMAIN" ]; then
  sed -i "s|API_URL: 'http://localhost:3100'|API_URL: 'https://$DOMAIN'|" "$CFG"
else
  echo "⚠ Домен не указан — API_URL оставлен http://localhost:3100."
  echo "  Для LAN-проверки поправьте вручную на http://<IP-мини-ПК>:3100,"
  echo "  после подключения домена — на https://ваш-домен.ru."
fi

cat <<EOF

✓ Приложение установлено: $APP_DIR
  env:      $ENV_FILE (секреты сгенерированы, права 640)
  storage:  $STORAGE_DIR
  БД:       $DB_NAME (роль $DB_ROLE)
Дальше: sudo bash 20-services.sh
EOF
