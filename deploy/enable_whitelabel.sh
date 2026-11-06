#!/usr/bin/env bash
# One-time server setup for white-label client domains (docs/white-label.md §2, steps 4–6). Safe to re-run.
# Run from your machine:  deploy/enable_whitelabel.sh [host]
#
# Needs, in ~/.eventlaya-deploy/ (never in the repo):
#   origin-wildcard.pem / origin-wildcard.key   Cloudflare Origin CA certificate for eventlaya.com, *.eventlaya.com
#   cloudflare.env                              CLOUDFLARE_API_TOKEN=… and CLOUDFLARE_ZONE_ID=…
#
# What it does on the droplet:
#   1. installs the certificate in /etc/ssl/eventlaya/ (root only)
#   2. adds the white-label Nginx site (the default server for every host that isn't eventlaya.com / api), rendered
#      from deploy/nginx.conf; if `nginx -t` fails the new site is removed again and Nginx is left as it was
#   3. puts the Cloudflare settings into /srv/eventlaya/.env (replacing old values) and restarts the app
#   4. adds the 10-minute domain re-check (manage.py check_tenant_domains) to the app user's crontab
set -euo pipefail

HOST=${1:-${DEPLOY_HOST:-168.144.79.15}}
KEY=${DEPLOY_KEY:-$HOME/.eventlaya-deploy/id_ed25519}
SECRETS=$HOME/.eventlaya-deploy
SSH_OPTS="-i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
ROOT=$(cd "$(dirname "$0")/.." && pwd)

for f in origin-wildcard.pem origin-wildcard.key cloudflare.env; do
  [ -f "$SECRETS/$f" ] || { echo "Missing $SECRETS/$f (see docs/white-label.md §2)" >&2; exit 1; }
done
grep -q '^CLOUDFLARE_API_TOKEN=.' "$SECRETS/cloudflare.env" && grep -q '^CLOUDFLARE_ZONE_ID=.' "$SECRETS/cloudflare.env" \
  || { echo "cloudflare.env needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID" >&2; exit 1; }

# The white-label server block from deploy/nginx.conf, with the domain filled in and HTTPS switched on
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
python3 - "$ROOT/deploy/nginx.conf" "$WORK/eventlaya-tenants" <<'PY'
import sys
src, out = sys.argv[1], sys.argv[2]
t = open(src).read()
start = t.index('server {', t.index('# White-label sites'))
depth, i = 0, start
while True:
    if t[i] == '{':
        depth += 1
    elif t[i] == '}':
        depth -= 1
        if depth == 0:
            break
    i += 1
block = t[start:i + 1].replace('__DOMAIN__', 'eventlaya.com')
for line in ('listen 443 ssl default_server;', 'listen [::]:443 ssl default_server;',
             'ssl_certificate     /etc/ssl/eventlaya/origin-wildcard.pem;',
             'ssl_certificate_key /etc/ssl/eventlaya/origin-wildcard.key;'):
    assert '# ' + line in block, line
    block = block.replace('# ' + line, line)
assert '__' not in block
open(out, 'w').write('# White-label sites (managed by deploy/enable_whitelabel.sh; rendered from deploy/nginx.conf)\n'
                     + block + '\n')
PY

echo "==> Uploading certificate, Nginx site and Cloudflare settings"
ssh $SSH_OPTS root@$HOST 'install -d -m 700 /root/eventlaya-whitelabel'
rsync -a --chmod=F600 -e "ssh $SSH_OPTS" "$SECRETS/origin-wildcard.pem" "$SECRETS/origin-wildcard.key" \
  "$SECRETS/cloudflare.env" "$WORK/eventlaya-tenants" root@$HOST:/root/eventlaya-whitelabel/

echo "==> Installing"
ssh $SSH_OPTS root@$HOST bash -s <<'REMOTE'
set -euo pipefail
IN=/root/eventlaya-whitelabel
trap 'rm -rf "$IN"' EXIT

# 1. Certificate (root only)
install -d -m 700 /etc/ssl/eventlaya
install -m 644 "$IN/origin-wildcard.pem" /etc/ssl/eventlaya/origin-wildcard.pem
install -m 600 "$IN/origin-wildcard.key" /etc/ssl/eventlaya/origin-wildcard.key

# 2. Nginx site, kept only if the whole config still tests fine
install -m 644 "$IN/eventlaya-tenants" /etc/nginx/sites-available/eventlaya-tenants
ln -sfn /etc/nginx/sites-available/eventlaya-tenants /etc/nginx/sites-enabled/eventlaya-tenants
if nginx -t; then
  systemctl reload nginx
  echo "Nginx: white-label site enabled"
else
  rm -f /etc/nginx/sites-enabled/eventlaya-tenants
  echo "nginx -t failed: white-label site removed again, Nginx unchanged" >&2
  exit 1
fi

# 3. App settings (secrets stay in /srv/eventlaya/.env only)
ENV=/srv/eventlaya/.env
set_env() {
  local name=$1 value=$2
  grep -v "^$name=" "$ENV" > "$ENV.tmp" || true
  printf '%s=%s\n' "$name" "$value" >> "$ENV.tmp"
  cat "$ENV.tmp" > "$ENV" && rm -f "$ENV.tmp"
}
set_env CLOUDFLARE_API_TOKEN "$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$IN/cloudflare.env" | tr -d '\r')"
set_env CLOUDFLARE_ZONE_ID "$(sed -n 's/^CLOUDFLARE_ZONE_ID=//p' "$IN/cloudflare.env" | tr -d '\r')"
set_env CLOUDFLARE_CUSTOM_ORIGIN tenants.eventlaya.com
systemctl restart eventlaya
sleep 2
systemctl is-active eventlaya

# 4. Re-check client domains (DNS + certificate) every 10 minutes
CRON='*/10 * * * * cd /srv/eventlaya/backend && set -a && . /srv/eventlaya/.env && set +a && .venv/bin/python manage.py check_tenant_domains >> /var/log/eventlaya/domains.log 2>&1'
install -d -o eventlaya -g eventlaya /var/log/eventlaya
( crontab -u eventlaya -l 2>/dev/null | grep -v 'check_tenant_domains' || true; echo "$CRON" ) | crontab -u eventlaya -
echo "Cron: check_tenant_domains every 10 minutes"
REMOTE
echo "==> White-label is set up on $HOST"
