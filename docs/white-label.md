# White-label sites

An organizer's events under their own brand on **their own domain** (e.g. `event.dharanfilmfestival.org`)
or a free **`<name>.eventlaya.com`** address. Visitors see only that organizer's events, with their logo,
colours, footer and support email, and "Powered by Eventlaya" unless the approved request hides it.

Every new client is onboarded with data + DNS only: no code change, no Nginx change, no redeploy.

_Last updated: 2026-10-27_

## 1. How it works

```
visitor ──https──▶ Cloudflare edge ──▶ fallback origin tenants.eventlaya.com ──▶ droplet (Nginx default server)
 event.dharanfilmfestival.org          (Cloudflare for SaaS: issues + renews        │  same web app (SPA) + /api /ws /media
   CNAME tenants.eventlaya.com          the certificate per customer hostname)      ▼
                                                                                  Django: Host → organization
```

| Piece | Where |
|---|---|
| Host → organization (custom domain or `<sub>.eventlaya.com`), cached 30 s | `backend/apps/accounts/tenancy.py` |
| Host validation (replaces Django `ALLOWED_HOSTS`) | `tenancy.TenantMiddleware` |
| DNS verification (CNAME + TXT), certificate status, "Check now" | `backend/apps/accounts/domains.py` |
| Cloudflare for SaaS API client (create / get / re-validate / delete custom hostname) | `backend/apps/accounts/cloudflare.py` |
| Periodic re-check | `manage.py check_tenant_domains` |
| Scoped public API (events list/detail, registration, promo check, pass, my tickets, public voting) | `scope_events()` in those views |
| Branded emails (pass/event links on the tenant domain, "X via Eventlaya" sender) | `backend/apps/core/email.py` |
| Web app tenant mode | `frontend/src/lib/tenant-host.ts`, `src/lib/tenant.tsx`, `src/tenant/TenantApp.tsx` |
| Organizer UI | `/app/branding` (`WhiteLabelPage.tsx`, `branding/DomainStatus.tsx`) |
| Superadmin UI | `/admin/approvals/white-label` → Active → Details |
| Nginx catch-all server | `deploy/nginx.conf` (last server block) |

**A site is live when** the organizer's white-label request is approved (not revoked), their account is
active, the `white_label` module is on (globally and for the organizer role) and — for a custom domain —
DNS verification passed. Links in emails switch to the custom domain only once its HTTPS certificate is
active (until then they use `<sub>.eventlaya.com` if subdomains are enabled, else eventlaya.com).

### Design decisions

- **Verification = CNAME + TXT.** The domain must `CNAME tenants.eventlaya.com` (traffic reaches us) *and*
  publish `TXT _eventlaya.<domain> = eventlaya-verify=<per-organization token>`. Every tenant points at the
  same CNAME target, so a CNAME alone can't say *which* organization the domain owner meant; whoever claimed
  the domain first on Eventlaya would win once the real owner adds the CNAME. The TXT token binds the domain
  to one account. (`WHITELABEL_REQUIRE_TXT=0` turns it off.) A domain can only be claimed by one
  organization; `eventlaya.com`, its subdomains and the CNAME target can't be claimed. A live domain only
  loses "verified" on a definite DNS answer, never on a resolver timeout.
- **Host checking.** Customer domains can't be listed in an env var, so Django's `ALLOWED_HOSTS` is `*`
  and `TenantMiddleware` does the check instead: it accepts the old `ALLOWED_HOSTS` env list
  (now `PLATFORM_HOSTS`), any `<label>.eventlaya.com`, and domains some organization has claimed. Any
  other `Host` gets **400** before reaching a view (no Host-header poisoning of absolute URLs).
- **Same-origin API.** The web app calls `/api` on whatever host it is served from, so no CORS changes are
  needed; Nginx's `proxy_params` passes the original `Host` to Django. The SPA also sends `X-Tenant-Host`
  (needed for the local `?tenant=` preview). Scoping only ever *narrows* public data to one organizer, so a
  client choosing its own header sees nothing it couldn't see on eventlaya.com.
- **Module `white_label`** (default on for organizers + superadmin, off for staff/attendee/vendor). It guards
  `/api/auth/tenant-branding/*` and `/api/platform/white-label/*`. Switching it off (globally, or for the
  organizer role) also **stops serving tenant sites**: visitors see "This site isn't available right now"
  with a link to the same page on eventlaya.com, public APIs on that host stop being scoped, and emails go
  back to eventlaya.com links. eventlaya.com itself is unaffected. The public resolve endpoint is
  deliberately not module-guarded so visitors always get that friendly answer.
- **Revoke** deletes the Cloudflare custom hostname, clears the custom domain and the hidden watermark.
  Approving a request with a different domain deletes the old hostname and starts verification again.

## 2. One-time platform setup (owner)

All of this is in the Cloudflare dashboard for the **eventlaya.com** zone plus the droplet. Nothing here has
been done yet — the code works in "manual" mode until step 5.

1. **Enable Cloudflare for SaaS** — Cloudflare → eventlaya.com → *SSL/TLS → Custom Hostnames* → enable.
   Cost (Free/Pro/Business plans): **first 100 custom hostnames included, then $0.10 per hostname per month,
   up to 50,000** (Enterprise: custom). It may ask for a payment method even within the free 100.
2. **Fallback origin** — DNS → add `A tenants → 168.144.79.15` (the droplet), **Proxied** (orange cloud).
   Then *Custom Hostnames → Fallback Origin* = `tenants.eventlaya.com` → wait for **Active**.
   (Customers CNAME to this same name; it's also the default `WHITELABEL_CNAME_TARGET`.)
3. **Free subdomains** — DNS → add `A * → 168.144.79.15`, **Proxied**. Cloudflare's Universal SSL already
   covers `*.eventlaya.com` at the edge. Existing records (`@`, `www`, `api`, `tenants`) keep priority over
   the wildcard.
4. **Origin certificate for the droplet** — *SSL/TLS → Origin Server → Create certificate* for
   `eventlaya.com, *.eventlaya.com` (RSA, 15 years, free). On the droplet save them as
   `/etc/ssl/eventlaya/origin-wildcard.pem` and `.key` (`chmod 600` the key). Then add the last `server { … }`
   block of `deploy/nginx.conf` (with `__DOMAIN__` → `eventlaya.com`) as
   `/etc/nginx/sites-available/eventlaya-tenants`, uncomment its `listen 443` + `ssl_*` lines, symlink it into
   `sites-enabled`, `nginx -t && systemctl reload nginx`. **Don't** re-run `setup_server.sh` (it drops the
   certbot blocks). The existing eventlaya.com / api server blocks stay as they are.
   - SSL mode stays **Full (strict)**. Cloudflare connects to the origin with SNI = the customer's hostname,
     which our certificate doesn't cover. Set `CLOUDFLARE_CUSTOM_ORIGIN=tenants.eventlaya.com` (step 5) so
     new custom hostnames are created with that custom origin server: Cloudflare then uses SNI
     `tenants.eventlaya.com` (covered by the wildcard) and keeps the visitor's Host header. If a site still
     shows **error 526**, add a Configuration Rule for hostnames not ending in `eventlaya.com` with SSL = Full.
5. **API token (automatic certificates)** — *My Profile → API Tokens → Create token*, permission
   **Zone → SSL and Certificates → Edit**, zone resources = eventlaya.com. Copy the zone id from the zone
   overview. Add to `/srv/eventlaya/.env` (never in the repo; note them in `~/.eventlaya-deploy/credentials.md`):
   ```
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ZONE_ID=...
   CLOUDFLARE_CUSTOM_ORIGIN=tenants.eventlaya.com
   WHITELABEL_SUBDOMAINS_ENABLED=1      # only after steps 3 and 4
   ```
   Optional: `WHITELABEL_CNAME_TARGET` (default `tenants.eventlaya.com`), `WHITELABEL_REQUIRE_TXT` (default 1),
   `WHITELABEL_DNS_SERVERS=1.1.1.1,8.8.8.8` (resolvers used for verification), `PLATFORM_DOMAIN`.
   `ALLOWED_HOSTS` keeps listing `eventlaya.com,www.eventlaya.com,api.eventlaya.com` — it is now the list of
   platform hosts for `TenantMiddleware`.
6. **Periodic re-check** — every 10 minutes, as the app user:
   ```
   */10 * * * * cd /srv/eventlaya/backend && set -a && . /srv/eventlaya/.env && set +a && .venv/bin/python manage.py check_tenant_domains >> /var/log/eventlaya-domains.log 2>&1
   ```
   (`--all` also re-verifies live domains; `--domain <host>` checks one.)
7. **Deploy** as usual (`deploy/deploy.sh`): installs `dnspython`, runs migrations `accounts 0012_tenant_domain_status`
   and `0013_white_label_module_and_backfill` (adds the module; any custom domain marked verified by the old
   fake check goes back to "Waiting for DNS" and is re-checked for real).

Without steps 1–5 ("manual" mode): approving and DNS verification still work; HTTPS for each customer domain
must be added by hand in *Custom Hostnames* and is detected by "Check now" (HTTPS probe of the domain).

## 3. Onboarding a client (checklist)

1. **Organizer** → Eventlaya → *Branding and domain* → request white-label (brand name, logo, colours, domain).
2. **Superadmin** → *Approvals → White-label* → check the organization and that the domain is plausibly theirs
   → **Approve**. The free address `<name>.eventlaya.com` is live immediately (once subdomains are enabled).
3. **Client** adds two records at their DNS provider (the organizer page shows them with copy buttons):

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `event` (i.e. `event.dharanfilmfestival.org`) | `tenants.eventlaya.com` |
   | TXT | `_eventlaya.event` (i.e. `_eventlaya.event.dharanfilmfestival.org`) | `eventlaya-verify=<token shown on the page>` |

   If their DNS is on Cloudflare: CNAME as **DNS only** (grey cloud). Apex domains (`dharanfilmfestival.org`
   itself) can't take a CNAME at most providers — use a subdomain like `event.` or `tickets.`.
4. **Check now** (organizer or superadmin → Details), or wait for the 10-minute job: DNS verified →
   Cloudflare custom hostname created → certificate issued (usually minutes) → **Live**.
5. Superadmin can see each tenant's DNS / HTTPS / Cloudflare state under *Active → Details*.

**Dharan Film Festival** (first client): after approval of `event.dharanfilmfestival.org`, they add
`CNAME event → tenants.eventlaya.com` and `TXT _eventlaya.event → eventlaya-verify=<their token>`; the token
is generated per organization and shown on their Branding page and in the superadmin Details dialog.

## 4. Local development

- Preview any tenant at `http://localhost:5173/?tenant=event.dharanfilmfestival.org` (kept for the tab in
  sessionStorage; `?tenant=off` leaves it). A local tenant needs an approved request and, for a custom
  domain, `is_domain_verified=True` (set it in Django admin), or use the subdomain form `?tenant=<sub>.eventlaya.com`.
- Tests: `backend/apps/accounts/test_whitelabel.py` (DNS and Cloudflare are mocked).

## 5. Not covered yet

- Real DNS/Cloudflare/HTTPS end-to-end (needs steps above); the 526 / custom-origin behaviour in step 4 is
  from Cloudflare's docs, not yet tried.
- `www.` + apex redirects for customer domains; per-tenant PWA manifest (tenant sites drop the Eventlaya
  manifest); per-tenant email sender domains (emails come from passes@eventlaya.com as "Brand via Eventlaya").
- Password-reset links still point to eventlaya.com.
