#!/usr/bin/env bash
# ============================================================
# SampleHelp: бутстрап VPS Selectel (Ubuntu 24.04) — Этап 1 ранбука
# DEPLOY_SELECTEL.md. Запуск ОДИН РАЗ от root на свежем сервере:
#   scp -r deploy/ supabase/ public/ root@<IP>:/opt/stage/   (со своей машины)
#   ssh root@<IP> 'bash /opt/stage/deploy/bootstrap.sh'
# Секреты генерируются НА СЕРВЕРЕ и складываются в /root/samplehelp-secrets.txt
# (chmod 600) — оттуда anon-ключ потом вписывается в public/js/config.mjs.
# ============================================================
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
echo ">> пакеты (docker, nginx, certbot, ufw, fail2ban)…"
apt-get update && apt-get -y upgrade
apt-get -y install docker.io docker-compose-v2 nginx certbot \
  python3-certbot-nginx ufw fail2ban git curl ca-certificates

echo ">> firewall: только 22/80/443 (+8000 ВРЕМЕННО для фазы «по IP»)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp   # kong напрямую до Этапа 2; ПОСЛЕ nginx+домена: ufw delete allow 8000/tcp
ufw --force enable

systemctl enable --now docker

# ---------- Supabase self-hosted стек ----------
SUPA_DIR=/opt/supabase
if [ ! -d "$SUPA_DIR/volumes" ]; then
  echo ">> клонирую официальный compose-стек Supabase…"
  rm -rf /tmp/supabase-repo
  git clone --depth 1 https://github.com/supabase/supabase.git /tmp/supabase-repo
  mkdir -p "$SUPA_DIR"
  cp -r /tmp/supabase-repo/docker/. "$SUPA_DIR"/
  rm -rf /tmp/supabase-repo
fi
cd "$SUPA_DIR"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt_hs256() { # $1 = payload json, $2 = secret
  local h p s
  h=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '%s' "$1" | b64url)
  s=$(printf '%s' "$h.$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

if [ ! -f .env ]; then
  echo ">> генерирую секреты и .env…"
  JWT_SECRET=$(openssl rand -hex 32)
  PG_PASS=$(openssl rand -hex 24)
  DASH_PASS=$(openssl rand -hex 16)
  IAT=$(date +%s); EXP=$(( IAT + 315360000 ))   # 10 лет
  ANON_KEY=$(jwt_hs256 "{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}" "$JWT_SECRET")
  SERVICE_KEY=$(jwt_hs256 "{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}" "$JWT_SECRET")
  cp .env.example .env
  sed -i \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=\"${PG_PASS}\"|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
    -e "s|^ANON_KEY=.*|ANON_KEY=${ANON_KEY}|" \
    -e "s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${SERVICE_KEY}|" \
    -e "s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=\"${DASH_PASS}\"|" \
    -e "s|^SITE_URL=.*|SITE_URL=http://localhost:3000|" \
    .env
  # Временная фаза «по IP»: API снаружи по http://<IP>:8000 (домен — Этап 2)
  IP=$(curl -s --max-time 5 http://169.254.169.254/latest/meta-data/public-ipv4 || hostname -I | awk '{print $1}')
  sed -i "s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=http://${IP}:8000|" .env || true
  umask 077
  {
    echo "# SampleHelp: секреты self-hosted Supabase (сгенерировано $(date -Is))"
    echo "IP=${IP}"
    echo "SUPABASE_URL=http://${IP}:8000"
    echo "SUPABASE_ANON_KEY=${ANON_KEY}"
    echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}   # ТОЛЬКО для админ-задач, НЕ в фронтенд!"
    echo "POSTGRES_PASSWORD=${PG_PASS}"
    echo "DASHBOARD_PASSWORD=${DASH_PASS}   # Studio: http://${IP}:8000 (user supabase)"
  } > /root/samplehelp-secrets.txt
  chmod 600 /root/samplehelp-secrets.txt
  echo ">> секреты: /root/samplehelp-secrets.txt (chmod 600)"
fi

echo ">> поднимаю стек (первый раз — несколько минут: тянет образы)…"
docker compose pull --quiet || true
docker compose up -d

echo ">> жду здоровье сервисов (до 3 минут)…"
for i in $(seq 1 36); do
  if curl -sf -o /dev/null http://127.0.0.1:8000/auth/v1/health \
     && curl -sf -o /dev/null http://127.0.0.1:8000/rest/v1/ \
     && curl -sf -o /dev/null http://127.0.0.1:8000/storage/v1/status; then
    echo "✓ стек здоров: auth + rest + storage отвечают"
    break
  fi
  [ "$i" = 36 ] && { echo "✗ стек не ожил за 3 минуты: docker compose logs"; exit 1; }
  sleep 5
done

cat <<'HINT'

==============================================================
 ГОТОВО к шагам 1.7–1.11 ранбука:
  1) Selectel-панель: создайте бакеты S3 (один физический
     samplehelp-storage + samplehelp-backups) и ключи S3 →
     bash /opt/stage/deploy/configure-s3.sh <ACCESS> <SECRET> [region]
  2) SQL: bash /opt/stage/deploy/apply-sql.sh /opt/stage/supabase
  3) Бэкапы: bash /opt/stage/deploy/backup-install.sh
  4) Ключи для приложения: cat /root/samplehelp-secrets.txt
     → SUPABASE_URL и SUPABASE_ANON_KEY в public/js/config.mjs
  Память: после приёмки можно освободить ~1 ГБ:
     cd /opt/supabase && docker compose stop studio analytics
==============================================================
HINT
