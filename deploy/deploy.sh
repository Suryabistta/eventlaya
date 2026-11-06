#!/usr/bin/env bash
# Build locally and ship to the droplet. Usage: deploy/deploy.sh [host]
#   SKIP_FRONTEND=1  ship only the backend (leave the live web app as it is)
#   SKIP_PRERENDER=1 don't refresh the prerendered pages (dist/prerender, needs Chrome on this machine)
#   PRERENDER_API    site the prerender takes its data from (default https://eventlaya.com, i.e. after this deploy)
#   FIREBASE_KEY     local service-account JSON for push (default ~/.eventlaya-deploy/firebase-service-account.json)
set -euo pipefail

HOST=${1:-${DEPLOY_HOST:-168.144.79.15}}
KEY=${DEPLOY_KEY:-$HOME/.eventlaya-deploy/id_ed25519}
SSH_OPTS="-i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
SSH="ssh $SSH_OPTS root@$HOST"
ROOT=$(cd "$(dirname "$0")/.." && pwd)

FIREBASE_KEY=${FIREBASE_KEY:-$HOME/.eventlaya-deploy/firebase-service-account.json}

if [ -z "${SKIP_FRONTEND:-}" ]; then
  echo "==> Building frontend"
  (cd "$ROOT/frontend" && npm ci --silent && npm run build)
fi

echo "==> Uploading"
rsync -az --delete -e "ssh $SSH_OPTS" \
  --exclude .venv --exclude __pycache__ --exclude db.sqlite3 --exclude media --exclude staticfiles \
  "$ROOT/backend/" root@$HOST:/srv/eventlaya/backend/
if [ -z "${SKIP_FRONTEND:-}" ]; then
  rsync -az --delete -e "ssh $SSH_OPTS" "$ROOT/frontend/dist/" root@$HOST:/srv/eventlaya/frontend/
fi
if [ -f "$FIREBASE_KEY" ]; then
  # Secret: only the app user can read it on the server
  rsync -a --chmod=F600 -e "ssh $SSH_OPTS" "$FIREBASE_KEY" root@$HOST:/srv/eventlaya/firebase-service-account.json
fi
rsync -az --delete -e "ssh $SSH_OPTS" "$ROOT/deploy/" root@$HOST:/tmp/eventlaya-deploy/

echo "==> Installing and migrating"
$SSH bash -s <<'REMOTE'
set -euo pipefail
# Redis + REDIS_URL + Nginx /ws/ proxy for team chat (no-op once in place).
bash /tmp/eventlaya-deploy/enable_websockets.sh
# SEO: robots.txt, sitemaps, llms.txt, link-preview HTML for /e/, /blog, marketplace pages and the prerendered
# marketing pages (no-op once in place; docs/seo.md).
bash /tmp/eventlaya-deploy/enable_seo_routes.sh
# Keep the systemd unit in step with the repo (ASGI/uvicorn workers).
if ! cmp -s /tmp/eventlaya-deploy/eventlaya.service /etc/systemd/system/eventlaya.service; then
  install -m 644 /tmp/eventlaya-deploy/eventlaya.service /etc/systemd/system/eventlaya.service
  systemctl daemon-reload
fi
chown -R eventlaya:eventlaya /srv/eventlaya
if [ -f /srv/eventlaya/firebase-service-account.json ]; then
  chmod 600 /srv/eventlaya/firebase-service-account.json
  grep -q '^FIREBASE_CREDENTIALS_PATH=' /srv/eventlaya/.env || \
    echo 'FIREBASE_CREDENTIALS_PATH=/srv/eventlaya/firebase-service-account.json' >> /srv/eventlaya/.env
fi
# Google Analytics 4 for eventlaya.com: the default Measurement ID (public, not a secret). Added once; Admin →
# Analytics can override it or switch analytics off (docs/analytics.md).
grep -q '^GA_MEASUREMENT_ID=' /srv/eventlaya/.env || echo 'GA_MEASUREMENT_ID=G-LF7MHZQJBB' >> /srv/eventlaya/.env
# Online payments: close expired holds / catch late payments every 2 minutes (docs/payments.md §6), and rotate the
# app's cron logs weekly (/var/log/eventlaya). Both idempotent.
mkdir -p /var/log/eventlaya && chown eventlaya:eventlaya /var/log/eventlaya
install -m 644 /tmp/eventlaya-deploy/logrotate-eventlaya /etc/logrotate.d/eventlaya
PAY_CRON='*/2 * * * * cd /srv/eventlaya/backend && set -a && . /srv/eventlaya/.env && set +a && .venv/bin/python manage.py expire_payments >> /var/log/eventlaya/payments.log 2>&1'
( crontab -u eventlaya -l 2>/dev/null | grep -v 'manage.py expire_payments' || true; echo "$PAY_CRON" ) | crontab -u eventlaya -
cd /srv/eventlaya/backend
sudo -u eventlaya bash -c '
  set -euo pipefail
  [ -d .venv ] || python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
  set -a; . /srv/eventlaya/.env; set +a
  .venv/bin/python manage.py migrate --noinput
  .venv/bin/python manage.py collectstatic --noinput -v 0
  .venv/bin/python manage.py sync_crew_chats
  .venv/bin/python manage.py seed_blog
'
systemctl restart eventlaya
sleep 2
systemctl is-active eventlaya
REMOTE

# Prerendered HTML for crawlers (search engines, AI assistants): rendered here with headless Chrome from the
# just-deployed site's data, then uploaded next to the web app. Failing this never fails the deploy: without it
# Nginx serves the normal app shell.
if [ -z "${SKIP_FRONTEND:-}" ] && [ -z "${SKIP_PRERENDER:-}" ]; then
  echo "==> Prerendering public pages"
  if (cd "$ROOT/frontend" && PRERENDER_API="${PRERENDER_API:-https://eventlaya.com}" npm run --silent prerender) \
     && [ -d "$ROOT/frontend/dist/prerender" ]; then
    rsync -az --delete -e "ssh $SSH_OPTS" "$ROOT/frontend/dist/prerender/" root@$HOST:/srv/eventlaya/frontend/prerender/
    $SSH chown -R eventlaya:eventlaya /srv/eventlaya/frontend/prerender
  else
    echo "WARNING: prerender failed; the site works without it (see docs/seo.md)" >&2
  fi
fi
echo "==> Deployed to $HOST"
