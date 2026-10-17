#!/usr/bin/env bash
# deploy/minipc/30-tunnel.sh — Cloudflare Tunnel (Фаза D3): публикация сайта
# без белого IP и открытых входящих портов (соединение ИСХОДЯЩЕЕ — работает
# из РФ и из-за NAT домашнего провайдера).
# Запуск: sudo bash 30-tunnel.sh ваш-домен.ru
# Часть шагов интерактивная (браузерный login) — скрипт ведёт по ним пошагово.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Нужен root: sudo bash $0 <домен>"; exit 1; fi
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Использование: sudo bash 30-tunnel.sh ваш-домен.ru"; exit 1; }
KIT=/var/www/samplehelp/deploy/minipc

echo "== 1/5 Установка cloudflared =="
if ! command -v cloudflared >/dev/null 2>&1; then
  # Способ 1: официальный deb-репозиторий
  if curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg 2>/dev/null; then
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
      > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -y && apt-get install -y cloudflared
  else
    # Способ 2: бинарник с GitHub (если репозиторий недоступен)
    echo "deb-репозиторий недоступен — качаю бинарник с GitHub"
    curl -fsSL -o /tmp/cloudflared.deb \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    dpkg -i /tmp/cloudflared.deb && rm -f /tmp/cloudflared.deb
  fi
fi
cloudflared --version

echo "== 2/5 LOGIN (интерактивно) =="
cat <<EOF
Выполните В ЭТОМ терминале:
    cloudflared tunnel login
Откроется ссылка — скопируйте её в браузер ЛЮБОЙ машины, войдите в аккаунт
Cloudflare (домен $DOMAIN должен быть добавлен в аккаунт: Add site → план Free,
NS-серверы прописать у регистратора) и авторизуйте домен.
Файл cert.pem появится в /root/.cloudflared/.
EOF
if [ ! -f /root/.cloudflared/cert.pem ]; then
  cloudflared tunnel login
fi

echo "== 3/5 Создание туннеля =="
TUNNEL_NAME=samplehelp
if ! cloudflared tunnel list | grep -qw "$TUNNEL_NAME"; then
  cloudflared tunnel create "$TUNNEL_NAME"
fi
TUNNEL_UUID=$(cloudflared tunnel list --output json | sed -n "s/.*\"id\":\"\([0-9a-f-]\{36\}\)\",\"name\":\"$TUNNEL_NAME\".*/\1/p")
[ -n "$TUNNEL_UUID" ] || { echo "Не удалось определить UUID туннеля: cloudflared tunnel list"; exit 1; }
echo "  tunnel: $TUNNEL_NAME ($TUNNEL_UUID)"

echo "== 4/5 Конфиг и DNS =="
mkdir -p /etc/cloudflared
sed -e "s/ваш-домен\.ru/$DOMAIN/g" -e "s/TUNNEL-UUID/$TUNNEL_UUID/" \
  "$KIT/cloudflared-config.yml" > /etc/cloudflared/config.yml
# www-поддомен: если не нужен — удалите второй hostname-блок из config.yml
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" || true
cloudflared tunnel route dns "$TUNNEL_NAME" "www.$DOMAIN" || true

echo "== 5/5 Сервис cloudflared =="
cloudflared service install || true   # повторная установка не страшна
systemctl enable cloudflared
systemctl restart cloudflared
sleep 3
systemctl --no-pager --lines=5 status cloudflared | head -10

cat <<EOF

✓ Туннель поднят: https://$DOMAIN → локальный Nginx (:80).
Проверки:
  curl -fsS https://$DOMAIN/api/health   → {"ok":true,...}
  открыть https://$DOMAIN в браузере (подвал: «BACKEND: подключено ✓»).
Дальше в дашборде Cloudflare (по ранбуку DEPLOY_MINIPC.md, этап 4):
  1) SSL/TLS mode: FULL (не Flexible!)
  2) Cache Rules: /files/* и /assets,/css,/js,/vendor → Cache eligible, Edge TTL 30 дней;
     /api/* и /socket.io/* → Bypass cache; HTML (по умолчанию) → не кешировать.
  3) (рекоменд.) Always Use HTTPS + Minimum TLS 1.2.
EOF
