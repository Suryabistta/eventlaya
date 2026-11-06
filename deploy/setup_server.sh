#!/usr/bin/env bash
# One-time server setup for Eventlaya on Ubuntu (run as root on the droplet).
# Installs Nginx, PostgreSQL, Redis, Python, Certbot; creates the app user, database, .env and swap.
set -euo pipefail

APP_USER=eventlaya
APP_DIR=/srv/eventlaya
DOMAIN=${DOMAIN:-eventlaya.com}
API_DOMAIN=${API_DOMAIN:-api.eventlaya.com}

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq nginx postgresql redis-server python3 python3-venv python3-dev build-essential libpq-dev \
  certbot python3-certbot-nginx ufw rsync

# Swap: small droplets run out of memory during pip installs and under load.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

# Uploaded images live on the DigitalOcean block-storage volume "eventlaya-media".
MEDIA_MNT=/mnt/eventlaya_media
MEDIA_DEV=/dev/disk/by-id/scsi-0DO_Volume_eventlaya-media
if [ -e $MEDIA_DEV ]; then
  mkdir -p $MEDIA_MNT
  grep -q "$MEDIA_MNT" /etc/fstab || echo "$MEDIA_DEV $MEDIA_MNT ext4 defaults,nofail,discard,noatime 0 2" >> /etc/fstab
  mountpoint -q $MEDIA_MNT || mount $MEDIA_MNT
else
  echo "WARNING: volume eventlaya-media not attached; media stays on the droplet disk at $MEDIA_MNT" >&2
fi
mkdir -p $MEDIA_MNT/media

id -u $APP_USER >/dev/null 2>&1 || useradd --system --create-home --home-dir $APP_DIR --shell /bin/bash $APP_USER
mkdir -p $APP_DIR/backend $APP_DIR/frontend
chmod 755 $APP_DIR  # nginx (www-data) serves frontend, static and media from here
chown -R $APP_USER:$APP_USER $APP_DIR $MEDIA_MNT/media
chmod 755 $MEDIA_MNT $MEDIA_MNT/media

# Database and secrets are created once; re-running keeps the existing ones.
if [ ! -f $APP_DIR/.env ]; then
  DB_PASS=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE USER eventlaya WITH PASSWORD '$DB_PASS';
CREATE DATABASE eventlaya OWNER eventlaya;
SQL
  cat > $APP_DIR/.env <<ENV
DEBUG=0
SECRET_KEY=$(openssl rand -hex 48)
ALLOWED_HOSTS=$DOMAIN,www.$DOMAIN,$API_DOMAIN,$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)
CORS_ALLOWED_ORIGINS=https://$DOMAIN,https://www.$DOMAIN
CSRF_TRUSTED_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://$API_DOMAIN
FRONTEND_URL=https://$DOMAIN
POSTGRES_DB=eventlaya
POSTGRES_USER=eventlaya
POSTGRES_PASSWORD=$DB_PASS
POSTGRES_HOST=127.0.0.1
MEDIA_ROOT=$MEDIA_MNT/media
REDIS_URL=redis://127.0.0.1:6379/0
ENV
  chown $APP_USER:$APP_USER $APP_DIR/.env && chmod 600 $APP_DIR/.env
fi

# Team chat websockets share events between workers through Redis. Servers whose .env predates
# chat get REDIS_URL appended here (idempotent).
grep -q '^REDIS_URL=' $APP_DIR/.env || echo 'REDIS_URL=redis://127.0.0.1:6379/0' >> $APP_DIR/.env

install -m 644 /tmp/eventlaya-deploy/eventlaya.service /etc/systemd/system/eventlaya.service
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__API_DOMAIN__/$API_DOMAIN/g" /tmp/eventlaya-deploy/nginx.conf > /etc/nginx/sites-available/eventlaya
ln -sf /etc/nginx/sites-available/eventlaya /etc/nginx/sites-enabled/eventlaya
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
# Redis: localhost only, 64 MB cap with LRU eviction (it only carries transient chat events).
bash /tmp/eventlaya-deploy/enable_websockets.sh
systemctl daemon-reload && systemctl enable eventlaya
echo "Server setup complete."
