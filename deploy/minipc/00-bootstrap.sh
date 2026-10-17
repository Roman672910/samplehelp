#!/usr/bin/env bash
# deploy/minipc/00-bootstrap.sh — подготовка свежей Ubuntu Server 22.04/24.04
# на мини-ПК (Фаза D2). Идемпотентен: можно запускать повторно.
# Запуск: sudo bash 00-bootstrap.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Нужен root: sudo bash $0"; exit 1; fi

APP_DIR=/var/www/samplehelp
DATA_DIR=/var/lib/samplehelp
STORAGE_DIR=$DATA_DIR/storage
ENV_DIR=/etc/samplehelp
BACKUP_MNT=/mnt/backup

echo "== 1/6 Обновление системы и пакеты =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get -y upgrade
apt-get install -y nginx postgresql postgresql-contrib rsync ufw curl ca-certificates gnupg unzip unattended-upgrades

echo "== 2/6 Node.js 20 (NodeSource; фолбэк — дистрибутивный nodejs) =="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh \
    && bash /tmp/nodesource_setup.sh \
    && apt-get install -y nodejs \
    || { echo "NodeSource недоступен — ставлю nodejs из репозитория Ubuntu"; apt-get install -y nodejs npm; }
fi
node -v

echo "== 3/6 Сервисный пользователь samplehelp =="
id -u samplehelp >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin samplehelp

echo "== 4/6 Каталог =="
mkdir -p "$APP_DIR" "$STORAGE_DIR"/{question-audio,presets,avatars,marketplace-files} "$ENV_DIR" "$BACKUP_MNT"
chown -R samplehelp:samplehelp "$DATA_DIR" "$APP_DIR"
chown root:samplehelp "$ENV_DIR" && chmod 750 "$ENV_DIR"
chmod 750 "$STORAGE_DIR"/marketplace-files   # приватный бакет — только владельцу-сервису

echo "== 5/6 Автоматические обновления безопасности =="
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades || true

echo "== 6/6 Файрвол (входящих минимум: SSH + http для LAN-проверки) =="
# Cloudflare Tunnel — ИСХОДЯЩЕЕ соединение: 443/80 наружу открывать не нужно.
ufw allow OpenSSH
ufw allow 80/tcp comment 'SampleHelp LAN check (публичный трафик идёт через Tunnel)'
ufw --force enable
ufw status verbose

cat <<EOF

✓ Bootstrap готов. Дальше:
  1) bash 10-install-app.sh /путь/к/filelist_with_content.txt [домен]
  2) bash 20-services.sh
  3) bash 30-tunnel.sh ваш-домен.ru        (после покупки домена и аккаунта Cloudflare)
  4) bash 40-backup-install.sh             (и примонтируйте внешний носитель в /mnt/backup)
Каталог: приложение $APP_DIR, данные $DATA_DIR/storage, env $ENV_DIR/backend.env
EOF
