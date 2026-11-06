# Eventlaya — operations & status

How Eventlaya is built, deployed and switched on/off, plus what is still open.
Secrets (passwords, keys) are **not** in this file — they live outside the repo in
`~/.eventlaya-deploy/credentials.md` on the deploy machine.

_Last updated: 2026-10-29_

## 1. What runs where

| Part | Tech | Where |
|---|---|---|
| Web app | Vite + React 19 + TS (`frontend/`) | https://eventlaya.com (static files served by Nginx) |
| API | Django 6 + DRF + Channels (`backend/`) | https://api.eventlaya.com and `https://eventlaya.com/api/` |
| Real-time chat | Channels WebSockets + Redis | `wss://api.eventlaya.com/ws/chat/` |
| Mobile app | Flutter (`scanner_app/`), package `com.eventlaya.eventlaya_scanner`, name "Eventlaya" | Android (iOS later) |
| Database | PostgreSQL 16 | on the droplet |
| Uploads | DigitalOcean block-storage volume `eventlaya-media` | `/mnt/eventlaya_media/media` (`MEDIA_ROOT`) |
| Push | Firebase Cloud Messaging, project `eventlaya` | key on server, `FIREBASE_CREDENTIALS_PATH` |
| DNS / CDN | Cloudflare (proxied), Let's Encrypt on origin (certbot, auto-renew) | SSL mode: Full (strict) |

Server: DigitalOcean droplet `eventlaya-prod` (Bangalore, 1 vCPU / 1 GB, Ubuntu 24.04, 2 GB swap).
App process: Gunicorn with 2 Uvicorn workers (`deploy/eventlaya.service`), Redis capped at 64 MB.

## 2. Deploying

```bash
deploy/deploy.sh                    # build web + ship backend + migrate + restart
SKIP_FRONTEND=1 deploy/deploy.sh    # backend only (leave the live web app as it is)
```
The script builds the frontend, rsyncs `backend/` and `frontend/dist/`, uploads the Firebase key
(from `~/.eventlaya-deploy/firebase-service-account.json`), makes sure Redis + the Nginx `/ws/` proxy
exist (`deploy/enable_websockets.sh`), installs Python deps, migrates, collects static, syncs event
crew chats and restarts. Deploy key: `~/.eventlaya-deploy/id_ed25519`.
It also adds the SEO routes to Nginx (`deploy/enable_seo_routes.sh`: robots.txt, sitemaps, llms.txt, link-preview
HTML for `/e/`, `/blog`, marketplace pages, prerendered marketing pages), publishes new starter blog posts
(`seed_blog`) and, after the restart, prerenders the public pages with local headless Chrome (`npm run prerender`,
`SKIP_PRERENDER=1` to skip). Details, checks and how to refresh WhatsApp/Facebook previews: `docs/seo.md`.

**Never re-run `deploy/setup_server.sh` on the live server** — it re-renders the Nginx config and would
remove certbot's SSL blocks. It is only for a brand-new server.

Checks after a deploy: `systemctl status eventlaya redis-server`, `journalctl -u eventlaya -n 50`,
open https://eventlaya.com and https://api.eventlaya.com/api/docs/.

Cron jobs (user `eventlaya`): `check_tenant_domains` every 10 min (`/var/log/eventlaya/domains.log`, set up by
`deploy/enable_whitelabel.sh`) and `expire_payments` every 2 min (`/var/log/eventlaya/payments.log`, set up by
`deploy/deploy.sh`). `/etc/logrotate.d/eventlaya` (`deploy/logrotate-eventlaya`) rotates both logs weekly.

## 3. Local development

```bash
cd backend && .venv/bin/python manage.py runserver 0.0.0.0:8000      # HTTP only
cd backend && .venv/bin/uvicorn config.asgi:application --reload --port 8000   # with chat WebSockets
cd frontend && npm run dev -- --host                                  # http://localhost:5173 (proxies /api, /media, /ws)
cd frontend && API_PORT=8010 npm run dev -- --host                    # when the backend runs on another port (8000 taken)
cd backend && .venv/bin/python manage.py test --noinput              # full suite, run serially
```
Mobile app on a phone: `adb pair` / `adb connect` (wireless debugging), `adb reverse tcp:8000 tcp:8000`,
`flutter build apk --debug` then `adb install -r build/app/outputs/flutter-apk/app-debug.apk`.
The app talks to `https://api.eventlaya.com` by default; tap the logo 7 times on the sign-in screen to
point it at another server (developer only).

Local sample data: `backend/populate_sample_data.py` (demo users with password `password123` — local only).

## 4. Modules (superadmin on/off switches)

Every feature is a module the superadmin switches on/off globally and per role
(web: Superadmin → Modules & permissions; mobile: More → Modules). Enforced server-side by
`apps/accounts/modules.py` (`ModuleAccessMiddleware`; WebSockets check it on connect). Disabled → HTTP 403
`{"code": "module_disabled"}` / WebSocket close 4403, and the apps hide the feature.

| Module | Covers | Default |
|---|---|---|
| `events` | events, public pages, registration, my tickets | on for all |
| `gate_scanner` | scanning, gate stats, attendee list, export | on for all |
| `dynamic_forms` | registration form builder | on for all |
| `voting` | master switch for all voting (quick polls; contests need it). Off → every `/api/voting/` endpoint 403, voting hidden | on for organizer, attendee (+ superadmin) |
| `contests` | pageants & contests: contestants, rounds, categories, public contest pages, SMS/email codes, presenter. Requires `voting`; off → quick polls only. See `docs/voting.md` | on for organizer, attendee (+ superadmin) |
| `judging` | judges' scoring and judge management; off → judges' scores stop counting (public votes decide). Requires `contests` | on for organizer, attendee, staff (+ superadmin) |
| `paid_votes` | paid vote packs in contests. Requires `contests` and `payments`; off → packs hidden, buying refused | on for organizer, attendee (+ superadmin) |
| `marketplace` | vendors, venues, inquiries | on for all |
| `staff_management` | team, staff gate assignment | on for all |
| `chat` | team chat (organizer + their staff) | off for attendee & vendor |
| `reviews` | event / vendor / venue reviews | on for all |
| `white_label` | organizer branding + white-label sites (custom domain / `<name>.eventlaya.com`); off also stops serving tenant sites | on for organizer (+ superadmin) |
| `blog` | public blog `/blog` (+ its API and pages for crawlers); superadmins write in Superadmin → Blog. Off → blog pages 404, the footer/menu link hides, it leaves the sitemap and llms.txt. See `docs/seo.md` | on for all |
| `payments` | online payments (Khalti / eSewa), payments reports, payouts; off → online options disappear, pay at the venue keeps working (provider returns + status polls stay reachable). See `docs/payments.md` | on for organizer, attendee (+ superadmin) |

**Rule for new features:** add a module (data migration), map its URL prefix in `PATH_MODULES`,
and hide it in both apps when it isn't in `/api/auth/modules/`.

**Exception:** the legal pages (`/privacy`, `/terms`, `/community-guidelines`, `/delete-account`, `/contact`) are
deliberately **not** a module — the app stores, Facebook Login and the law need them reachable at all times.

## 5. Feature summary

- **Events & lifecycle** — phase computed in Nepal time: draft → upcoming → live → ended (or cancelled).
  Registration open while live (walk-ins), closed after; scanning refused before/after; events with
  registrations can only be cancelled, not deleted.
- **Tickets** — ticket types (price, quantity, sales window, gate note, hidden, allowed gates), one-click
  presets, promo codes (% / Rs / unlock-only, limits, expiry). Paid at the venue, or online (next item).
- **Online payments** — Khalti (ePayment v2) and eSewa (ePay v2) through Eventlaya's own merchant accounts; organizers
  are paid out by hand (recorded as payouts). Per event: pay at venue / online / both, per ticket type "online only".
  Online orders hold tickets (`reserved`, default 15 min) until the provider confirms server-side; unpaid tickets are refused
  at the gate. Organizer **Payments** page (`/app/payments`: orders, online vs venue totals, mark paid at venue, mark refunded,
  CSV), superadmin **Online payments** (`/admin/payments`: totals, owed per organizer, payouts, platform fee, hold time,
  provider status). Generic purpose registry for other apps (paid votes next). Everything: `docs/payments.md`.
- **Multi-ticket orders** — registration flow Tickets (+/− per type) → Your details (optional guest names)
  → questions → Review → passes. One `TicketOrder` (`ORD-xxxxxx`) per checkout; organizer sets
  "Max tickets per order" (1–50, default 10); "Get more tickets" for repeat buyers; one order email.
- **Passes** — Download pass (PNG with QR, `DownloadPassButton.tsx`), Download all, Save or print pass;
  public pass page `/ticket/<qr_token>` (API `GET /api/events/passes/<token>/`) linked from emails.
- **Hide spots left** — per-event "Show how many spots are left" toggle; when off the public API blanks
  the counts and only sends `is_full` / `spots_hidden`.
- **Event page** — organizer card under registration, schedule shows 3 items + "See full schedule";
  Explore uses vertical cards, 3 per row on desktop.
- **Gates & team** — gates, staff onboarding with temporary passwords, gate assignment.
- **Attendee app (one adaptive app)** — tabs Explore · Tickets · [My Pass] · Vendors · Profile in a
  floating glass navbar; browse without login; email verification links passes to the account;
  profile, password, account deletion; "Keep me signed in".
- **Voting** — ticket / contact / open polls; signed-in attendees vote with their account.
- **Contests / pageants** — numbered contestants with profiles and galleries, award categories, rounds with eliminations,
  judges scoring on a phone/tablet (`/judge`), weighted judges + public results with tie-breaks, SMS/email-code voting
  (Aakash SMS), daily vote allowances (Nepal time), anti-fraud flags + voiding with audit log, CSV exports, presenter with
  winner reveal, share links with previews. Paid vote packs are configured but not sold yet (waits for online payments).
  Full design, API and setup: `docs/voting.md`.
- **Marketplace** — vendors & venues, inquiries for both, business portal inboxes.
- **Vendor bookings** — vendors/venue owners publish availability slots (single, repeat by weekday, block
  dates; full day or timed; per space); customers request an open slot (slot is held), owner confirms or
  declines with a note, customer can cancel; emails + push (`booking_request`, `booking_confirmed`,
  `booking_declined`, `booking_cancelled`). Web: `/app/availability`, Availability card on public
  venue/vendor pages. Mobile: vendor app (`scanner_app/lib/vendor/`, tabs Home · Requests · [Calendar] ·
  Listings · More); organizers with marketplace access open it from More → Business.
  API contract: `docs/api/vendor-bookings.md`.
- **Reviews** — events (checked-in attendees), vendors/venues (users who inquired); organizers hide,
  owners reply.
- **Team chat** — direct + group chats inside an organization, automatic "event crew" groups,
  real-time, photos, read receipts, push notifications.
- **Sign-in** — email/password; Google and Facebook built but hidden until keys are configured.
- **Legal & consent** — public pages `/privacy`, `/terms`, `/community-guidelines`, `/delete-account` (the Play Store
  "delete account URL" and Facebook "data deletion instructions URL"), `/contact` (`frontend/src/pages/legal/`).
  Company name, contact email (support@eventlaya.com for everything), location and "Last updated" live in one place:
  `frontend/src/lib/legal.ts`. Linked from the marketing footer, the attendee-page footer (event, registration, pass,
  voting), white-label site footers (they point to eventlaya.com: Eventlaya's policies apply as the platform), sign-up
  (checkbox, new tab), "Continue with Google/Facebook" ("By continuing you agree…"), the registration review step
  ("…your details are shared with <organizer>") and Profile → "What gets deleted". Mobile: sign-in / create account
  consent line, "Privacy & support" rows on attendee Profile, organizer More, staff Account and vendor More
  (`scanner_app/lib/core/legal.dart`, `url_launcher`, in-app browser tab; "Contact support" = mailto).
  **Consent is recorded:** `User.terms_accepted_at` + `terms_version` (setting `TERMS_VERSION`, default `2026-10-28`),
  set on email sign-up (`terms: true` is now **required** by `POST /api/auth/register/`) and on the first
  Google/Facebook sign-in. Store answers (Data safety, permissions, content rating, Meta URLs): `docs/play-store.md`.
- **White-label sites** — approved organizers get their events on their own domain (CNAME + TXT verification,
  Cloudflare for SaaS certificates) or `<name>.eventlaya.com`, branded, with scoped public API and branded
  emails. Setup + client onboarding: `docs/white-label.md`.

## 6. Configuration (environment variables on the server, `/srv/eventlaya/.env`)

| Variable | Status |
|---|---|
| `SECRET_KEY`, `POSTGRES_*`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` | set |
| `MEDIA_ROOT=/mnt/eventlaya_media/media` | set |
| `REDIS_URL` | set |
| `FIREBASE_CREDENTIALS_PATH` | set |
| `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL` | **missing** — emails only go to the server log |
| `GOOGLE_CLIENT_IDS` (web client id first) | **missing** |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | **missing** |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_CUSTOM_ORIGIN` (white-label, see `docs/white-label.md`) | set 2026-10-28 (Cloudflare for SaaS, fallback origin `tenants.eventlaya.com`) |
| `WHITELABEL_SUBDOMAINS_ENABLED` | unset = off — free `<name>.eventlaya.com` sites are not served in production; custom domains only |
| `KHALTI_SECRET_KEY`, `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY`, `PAYMENTS_CALLBACK_BASE_URL=https://api.eventlaya.com` (online payments, `docs/payments.md` §6/§8) | **missing** — online payment not offered until set |
| `SMS_PROVIDER`, `AAKASH_SMS_TOKEN` (contest SMS codes; see `docs/voting.md` §3), `SPARROW_SMS_TOKEN`/`SPARROW_SMS_FROM` (optional), `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` (contest CAPTCHA) | **missing** — SMS codes only go to the server log; CAPTCHA off |
| `GA_MEASUREMENT_ID` | `G-LF7MHZQJBB` (added by `deploy/deploy.sh` if missing) — Google Analytics for eventlaya.com until Superadmin → Analytics overrides it; `docs/analytics.md` |
| `TERMS_VERSION` | optional — defaults to `2026-10-28`; bump with `LAST_UPDATED` in `frontend/src/lib/legal.ts` when the policies change |

## 7. Still open

**Deployed (2026-10-28, lockdown fixes + cron 2026-10-29)** — everything in §5 is live on eventlaya.com: all migrations up to
`accounts 0014`, `events 0014`, `marketplace 0008`, `voting 0006`, `payments 0002`, `blog 0003`, `site_analytics 0001` are
applied; online payments are configured but **not offered until the Khalti/eSewa merchant keys are set** (`docs/payments.md` §8:
onboarding, then one small real payment per provider); contests; blog (29 starter posts, owner to review) + SEO routes;
GA4; legal pages + consent; white-label (Cloudflare for SaaS live, `<name>.eventlaya.com` off, custom domains only).
Deployed 2026-10-29: visitors get nothing from the organizer event list `GET /api/events/` (they use `/api/events/public/`, which
honours "show spots left" and white-label scoping), free subdomains resolve to "not set up" while they are switched off, the
`expire_payments` cron and log rotation. The latest APK (`scanner_app/build/app/outputs/flutter-apk/`, built 2026-10-28:
notification icon, vendor app, contests, payments) is **not yet on the owner's phone**. A production vendor demo account owns
two DEMO listings (see credentials file).
Owner to-dos for SEO (Search Console, Bing, Google Business Profile, socials → `SAME_AS`, reviews, backlinks): `docs/seo.md` §4,
ready-to-paste texts in `docs/seo-offsite-kit.md`, research in `docs/seo-research.md`, audit in `docs/seo-audit.md`.
Owner's one-time GA settings (history page views + form interactions off, user-provided data off, 14-month retention,
key events): `docs/analytics.md` §2.

**Known gaps (vendor bookings)**
- Booking push taps (`booking_request` / `booking_cancelled`) were tested with real FCM pushes on the
  emulator (background, cold start, foreground; vendor and organizer); not yet on a physical phone.
- Listing-level pause (`is_paused`) and in-app listing editing are built; photos and venue spaces are still
  edited on the website. Web calendar cells cut off long space names on desktop.
- Untested: `409 cannot_cancel` and the `slot_locked` race on the web.
- Local DB only: the attendee role has the marketplace module switched off (from testing).

**Needs the owner**
1. Email provider (Brevo / Mailgun / SES / Gmail app password) → set the `EMAIL_*` variables.
2. Google sign-in: add the Android OAuth client (debug + release SHA-1) and a Web client in project
   `eventlaya`; set `GOOGLE_CLIENT_IDS`.
3. Facebook login: Meta app → App ID, App Secret, Client Token; then the Android SDK setup
   (`strings.xml`, `AndroidManifest.xml`, `flutter_facebook_auth`) and fill in
   `FacebookAuthBridge` in `scanner_app/lib/auth/social_sign_in.dart`.
4. Revoke the DigitalOcean API token that was pasted into a chat.
5. Change the demo account passwords before real users join.
6. Legal pages (`frontend/src/lib/legal.ts` has the TODO): confirm the **legal entity name** (pages say "Eventlaya"
   until then), make sure the **support@eventlaya.com** mailbox exists and is read (it takes privacy and deletion
   requests, promised within 30 days), and have a **lawyer in Nepal review** `/privacy` and `/terms` — in particular the
   liability cap (greater of 12 months' fees and NPR 5,000), the plan refund rules, the 30-day price-change notice,
   minimum age 16, and "competent courts of Nepal".
7. Privacy follow-ups found while writing the policies (the pages describe today's behaviour honestly):
   - the app doesn't unregister its push token on sign-out, so a signed-out phone can still get that account's pushes
     (call `DELETE /api/auth/fcm-token/` before clearing the session); stale tokens are never pruned;
   - uploaded files (avatars, chat/listing photos) stay on disk after account deletion and are public to anyone with the URL
     (chat photos especially should be served behind auth); deletion of a file is a manual support task today;
   - no retention limit: registrations, scan logs and inquiries are kept forever (events with registrations can't be
     deleted) — decide a period (e.g. anonymise attendee details N months after an event);
   - no self-service data export (access requests are answered by email);
   - no database backups are configured (the policy only says deleted data "may" remain in backups);
   - ~~the website loads Google Fonts from Google~~ — fixed 2026-10-28: the web app self-hosts its fonts (the line was
     removed from `/privacy`; consider bumping `LAST_UPDATED`/`TERMS_VERSION` with the next policy change);
   - Facebook data-deletion **callback** isn't implemented (the instructions URL is enough for Meta today).

**Before the Play Store release**
- Release signing key (+ its SHA-1 in Firebase / Google), release build.
- Store listing, screenshots; fill the Data safety form, permissions and content rating from `docs/play-store.md`
  (privacy policy + delete-account pages are built). Consider removing `RECEIVE_BOOT_COMPLETED` and the
  library-added `USE_BIOMETRIC`/`USE_FINGERPRINT` permissions (see that file).
- Regenerate the mobile golden screenshot tests (`flutter test --update-goldens`, then review).
- Sign in with Apple becomes required only if the app ships on iOS with Google/Facebook login.

**Nice to have**
- Organizers switching chat on/off for their own organization (today: superadmin only).
- Attendees messaging the host (decided against for now).
- Splitting into two apps ("Eventlaya" + "Eventlaya Organizer") — code is already separated under
  `scanner_app/lib/attendee/` to keep this cheap.
- Scaling path: managed Postgres → Spaces for media → more app droplets behind a load balancer.
