#!/usr/bin/env bash
# deploy/minipc/20-services.sh — systemd-сервис backend + Nginx (Фаза D2).
# Идемпотентен. Запуск: sudo bash 20-services.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Нужен root: sudo bash $0"; exit 1; fi
APP_DIR=/var/www/samplehelp
KIT=$APP_DIR/deploy/minipc
ENV_FILE=/etc/samplehelp/backend.env

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — сначала 10-install-app.sh"; exit 1; }

echo "== 1/4 systemd-юнит backend =="
cp "$KIT/samplehelp-backend.service" /etc/systemd/system/samplehelp-backend.service
systemctl daemon-reload
systemctl enable samplehelp-backend
systemctl restart samplehelp-backend
sleep 2
systemctl --no-pager --lines=5 status samplehelp-backend | head -12

echo "== 2/4 Nginx: сайт SampleHelp =="
cp "$KIT/nginx-samplehelp.conf" /etc/nginx/sites-available/samplehelp.conf
ln -sf /etc/nginx/sites-available/samplehelp.conf /etc/nginx/sites-enabled/samplehelp.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "== 3/4 Health-чеки =="
ok=1
for i in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:3100/api/health >/dev/null 2>&1; then ok=0; break; fi
  sleep 1
done
[ $ok -eq 0 ] && echo "  ✓ backend :3100 /api/health" || { echo "  ✗ backend не отвечает — journalctl -u samplehelp-backend -n 50"; exit 1; }
curl -fsS -H 'Host: samplehelp.local' http://127.0.0.1/ | grep -q '<!DOCTYPE html' \
  && echo "  ✓ nginx отдаёт index.html (SPA)" || { echo "  ✗ nginx не отдаёт фронт"; exit 1; }
curl -fsS http://127.0.0.1/js/api.mjs >/dev/null && echo "  ✓ nginx отдаёт /js/api.mjs" || { echo "  ✗ /js/api.mjs"; exit 1; }

echo "== 4/4 Автозапуск при загрузке машины =="
systemctl is-enabled samplehelp-backend nginx postgresql

cat <<EOF

✓ Сервисы подняты. Локальная проверка: http://<IP-мини-ПК>/ (в LAN).
  Логи backend:  journalctl -u samplehelp-backend -f
  Логи nginx:    tail -f /var/log/nginx/{access,error}.log
Дальше: sudo bash 30-tunnel.sh ваш-домен.ru   (публикация в интернет)
EOF
