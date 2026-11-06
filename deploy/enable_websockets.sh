#!/usr/bin/env bash
# Prepare an existing Eventlaya droplet for team chat websockets (run as root; safe to re-run).
#   1. Redis (localhost only, 64 MB, allkeys-lru) for the Channels layer
#   2. REDIS_URL in /srv/eventlaya/.env
#   3. A /ws/ websocket location in every server block of the live Nginx site that proxies to the API.
#      The live file was rewritten by certbot (listen 443 ssl + redirect blocks), so we patch it in
#      place instead of re-rendering deploy/nginx.conf. A backup is kept and restored if `nginx -t` fails.
# deploy.sh runs this on every deploy; it changes nothing once everything is in place.
set -euo pipefail

ENV_FILE=${ENV_FILE:-/srv/eventlaya/.env}
SITE=${SITE:-/etc/nginx/sites-available/eventlaya}
REDIS_CONF=/etc/redis/redis.conf

# ---- 1. Redis ----
if ! command -v redis-server >/dev/null 2>&1; then
  echo "==> Installing redis-server"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -yq redis-server
fi
redis_changed=0
set_redis() {  # set_redis <directive> <value>
  if ! grep -qE "^$1 $2\$" "$REDIS_CONF"; then
    sed -i -E "/^#? ?$1 /d" "$REDIS_CONF"
    echo "$1 $2" >> "$REDIS_CONF"
    redis_changed=1
  fi
}
set_redis bind "127.0.0.1 -::1"
set_redis protected-mode yes
set_redis maxmemory 64mb
set_redis maxmemory-policy allkeys-lru
systemctl enable --now redis-server >/dev/null 2>&1
if [ "$redis_changed" = 1 ]; then
  echo "==> Restarting redis-server with the new settings"
  systemctl restart redis-server
fi
redis-cli ping >/dev/null && echo "Redis OK"

# ---- 2. REDIS_URL ----
if [ -f "$ENV_FILE" ] && ! grep -q '^REDIS_URL=' "$ENV_FILE"; then
  echo "==> Adding REDIS_URL to $ENV_FILE"
  echo 'REDIS_URL=redis://127.0.0.1:6379/0' >> "$ENV_FILE"
fi

# ---- 3. Nginx /ws/ locations ----
if [ -f "$SITE" ]; then
  BACKUP="$SITE.bak-$(date +%Y%m%d%H%M%S)"
  cp "$SITE" "$BACKUP"
  python3 - "$SITE" <<'PY'
import re, sys

path = sys.argv[1]
text = open(path).read()
WS = """    # Team chat websockets (added by enable_websockets.sh)
    location /ws/ {
        proxy_pass http://eventlaya_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        include /etc/nginx/proxy_params;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
"""

def server_blocks(s):
    """(start, end) of each top-level `server { ... }` block."""
    out, i = [], 0
    for m in re.finditer(r'(?m)^\s*server\s*\{', s):
        if m.start() < i:
            continue
        depth, j = 0, m.end() - 1
        while j < len(s):
            if s[j] == '{':
                depth += 1
            elif s[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append((m.start(), j))
        i = j
    return out

changed = 0
for start, end in reversed(server_blocks(text)):
    block = text[start:end]
    # Only blocks that proxy to the app (skips certbot's port-80 redirect blocks), and only once.
    if 'proxy_pass http://eventlaya_api' not in block or re.search(r'location\s+/ws/', block):
        continue
    first_location = re.search(r'(?m)^[ \t]*location\s', block)
    at = start + (first_location.start() if first_location else len(block))
    text = text[:at] + WS + text[at:]
    changed += 1

if changed:
    open(path, 'w').write(text)
print(f'nginx: added /ws/ to {changed} server block(s)')
PY
  if cmp -s "$SITE" "$BACKUP"; then
    rm -f "$BACKUP"
  elif nginx -t; then
    systemctl reload nginx
    echo "Nginx reloaded (backup: $BACKUP)"
  else
    echo "nginx -t failed; restoring $BACKUP" >&2
    cp "$BACKUP" "$SITE"
    exit 1
  fi
else
  echo "WARNING: $SITE not found; skipped the Nginx websocket patch" >&2
fi
echo "Websocket prerequisites ready."
