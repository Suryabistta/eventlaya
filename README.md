# Eventlaya

Event management SaaS for Nepal: online registration and ticketing, QR passes,
gate in/out scanning, live voting, a vendor marketplace, and white-label event
sites on a client's own domain.

Live at [eventlaya.com](https://eventlaya.com) · API at `api.eventlaya.com`.

## What it does

| Area | What you get |
|---|---|
| **Events & ticketing** | Create/publish events, ticket types, promo codes, capacity, online payments, emailed QR passes |
| **Registration forms** | Google-Forms-style builder (text, dropdown, radio, checkbox, number…) bound to the public event page |
| **Gate scanning** | Web scanner and Flutter app: gate in / gate out, duplicate detection, multiple gates, offline queue |
| **Voting** | Live audience voting with one-person-one-vote checks and live tallies |
| **Marketplace** | Vendor profiles (photography, sound, venues, catering…), quote requests and bookings |
| **Team & crew** | Team members, roles, staff credentials, task distribution |
| **Chat** | Real-time organiser ↔ team chat over WebSockets |
| **Reviews, analytics, blog, SEO** | Event reviews, per-event analytics (Chart.js), blog, SEO pages |
| **White-label** | Multi-tenant: each client gets their own domain/subdomain and branding |
| **Superadmin** | Every feature is a module the superadmin can switch on/off per account, enforced in the API |

## Repository layout

```
backend/       Django 6 + DRF + Channels API
  apps/        accounts, events, dynamic_forms, voting, marketplace, chat,
               reviews, payments, blog, seo, site_analytics, platform, core
  config/      settings, URLs, ASGI
frontend/      Vite + React 19 + TypeScript + Tailwind web app
scanner_app/   Flutter mobile app (attendee + gate scanner), Android first
deploy/        Server setup, Nginx, systemd unit, deploy script
docs/          Operations runbook and feature docs (payments, voting, white-label, SEO…)
```

## Running locally

**Backend** (Python 3.12+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python populate_sample_data.py      # optional sample events, tickets, vendors
python manage.py runserver 0.0.0.0:8000
```

API docs (Swagger): http://127.0.0.1:8000/api/docs/

Locally the backend uses SQLite; production uses PostgreSQL and Redis
(Channels). Configuration comes from environment variables / a `.env` file,
which is never committed.

**Frontend:**

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

**Mobile app:** see [scanner_app/README.md](scanner_app/README.md) and
[scanner_app/FIREBASE_SETUP.md](scanner_app/FIREBASE_SETUP.md) (you need your own
`google-services.json`).

## Tests

```bash
cd backend && python manage.py test
```

## Deployment

Production runs on a DigitalOcean droplet (Gunicorn + Uvicorn workers, Nginx,
PostgreSQL, Redis) behind Cloudflare. `deploy/deploy.sh` builds the web app,
ships the backend, migrates and restarts. Full runbook:
[docs/OPERATIONS.md](docs/OPERATIONS.md).

Secrets (keys, passwords, service accounts) live outside the repo.
