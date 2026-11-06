# Eventlaya — technical SEO quick audit

_Last updated: 2026-10-28_

What was checked, what was fixed in `apps/blog` / `apps/seo`, and what is left (in priority order). Companion docs:
`docs/seo.md` (how SEO is built), `docs/seo-research.md` (keywords, competitors, calendar), `docs/seo-offsite-kit.md`
(Google Business Profile, socials, citations, outreach, Search Console).

---

## 1. How it was checked

| Check | How | Notes |
|---|---|---|
| Live site performance / SEO | Lighthouse 12.8.2 (mobile emulation, simulated slow 4G) from this machine against https://eventlaya.com/ | PageSpeed Insights API: keyless daily quota was exhausted, so no PSI/CrUX field data. Re-run PSI after the deploy. |
| New build (not yet deployed) | `vite build` into a scratch folder, prerendered with `scripts/prerender.mjs` against a local backend (copy of the dev DB, all 29 posts seeded), served by a small static server; `/blog/*` went through Django like on production | No gzip/brotli locally, so the **performance** numbers of the new build are not representative; SEO, accessibility, best-practices and CLS are. |
| Titles and descriptions | `GET /api/seo/meta/?path=…` for every URL in the four sitemaps (50 URLs on the local DB copy: pages, marketplace, 29 posts) | Length, duplicates, status |
| Internal links | Every `](/blog/<slug>)` in `seed_posts/*.md` must be a seed slug — enforced by `apps.blog.tests.SeedTests.test_seed_files_are_complete`, which also checks translations (`language`, `translation_of`) | Plus in/out link counts per post (§5) |
| Language versions | Tests `apps.seo.tests.BlogTranslationTests`, `apps.blog.tests.TranslationTests`; prerendered HTML inspected by hand; screenshots in the scratchpad (`mgr-*.png`) | |

---

## 2. Live site today (https://eventlaya.com/, older build)

Lighthouse mobile: **Performance 47 · Accessibility 93 · Best practices 100 · SEO 92**

| Metric | Value |
|---|---|
| First Contentful Paint | 5.0 s |
| Largest Contentful Paint | 5.8 s (a hero paragraph; text, not an image) |
| Total Blocking Time | 730 ms |
| Cumulative Layout Shift | 0.003 |
| Server response (TTFB) | 80 ms |

Findings:

1. **`/robots.txt`, `/sitemap.xml` and `/llms.txt` return the app's HTML** (HTTP 200, `text/html`): the SEO routes are
   not deployed yet. Lighthouse: "robots.txt is not valid — 26 errors". Google would see no sitemap and an unparsable
   robots file. → fixed by the pending deploy (`deploy/enable_seo_routes.sh`).
2. **Render-blocking Google Fonts CSS** (~930 ms on slow 4G) plus the app CSS (~450 ms). → already fixed in the new
   build (self-hosted fonts, Poppins 400 preloaded).
3. **Brand logos are large PNGs:** `/brand/logo-tagline.png` 82 KB (footer, off-screen) and `/brand/logo.png` 53 KB
   (header) for images shown ~36–48 px tall; Lighthouse estimates ~120 KB savings (responsive size + WebP). The live
   build also had them without `width`/`height`; the current `Logo.tsx` sets both (fixed).
4. **Short cache lifetime for `/brand/*.png`** (4 h). The repo's `deploy/nginx.conf` already gives images 30 days —
   check that the live Nginx has that block after the deploy.
5. **JavaScript cost on the home page:** main-thread work 7.3 s (simulated), unused JS ~77 KB (main chunk and the
   `use-reduced-motion` animation chunk).
6. Accessibility: one `<ol>` on the home page has children that aren't `<li>`. (Home page is frozen by the owner rule
   — note only.)

---

## 3. New build (local, prerendered)

| Page | Perf* | A11y | Best practices | SEO | CLS |
|---|---|---|---|---|---|
| `/blog` | 64 | 100 | 100 | 100 | 0.033 |
| `/blog/itahari-ma-event-kasari-garne` (Nepali) | 64 | 100 | 100 | 100 | 0 |
| `/blog/how-to-organize-an-event-in-itahari` (no prerendered copy) | 45 | 100 | 100 | 100 | 0.379 |

\* uncompressed local server; production (Nginx gzip + Cloudflare) will score higher — measure with PSI after deploy.

- **Prerendering matters for CLS:** without the prerendered copy the page is built in the browser and the footer
  jumps (CLS 0.38–0.48). With it, CLS is 0–0.03. `deploy.sh` prerenders every post; if the prerender step fails it
  only warns — check its output on each deploy (`… N/N pages prerendered`).
- Nepali pages: `<html lang="ne">`, `og:locale` `ne_NP` + `og:locale:alternate` `en_US`, three `hreflang` links
  (`en`, `ne`, `x-default` → English) — identical in the Django-injected HTML and in the prerendered copy.

---

## 4. Titles and descriptions (50 sitemap URLs)

| Check | Result |
|---|---|
| Blog post `<title>` | 29 posts, 44–57 characters, all unique (Nepali titles count code points; they display shorter) |
| Blog descriptions | 127–157 characters, all unique |
| Titles > 60 characters | **8 marketplace pages** (62–74) → **fixed**: `fit_title()` in `apps/seo/pages.py` tries "Name, City — Type \| Eventlaya", then without the brand, then "Name, City" |
| Description outside 70–160 | `/delete-account` (62) → **fixed** (longer, accurate description in `LEGAL`) |
| Duplicate URL across sitemaps | `/blog` was in both `pages.xml` and `blog.xml` → **fixed** (kept in `blog.xml` with its lastmod) |
| Short titles | `Contact \| Eventlaya` (19), `Privacy policy \| Eventlaya` (26), `Terms of service \| Eventlaya` (28) — fine for legal pages |
| Non-200 in sitemaps | none |

Event pages (`/e/<slug>`) weren't in the local copy's sitemap (no upcoming public events there); their titles are
"<Event> — <date>, <city> | Eventlaya" and drop the brand when long (`with_brand`, 65).

---

## 5. Internal links

- All internal `/blog/…` links in the 29 seed posts resolve (test-enforced). App links used: `/pricing` (24),
  `/marketplace` (13), `/signup` (9), `/events` (5). External links: 2 (Khalti and TicketChha pages cited in post 14).
- Pillar ↔ cluster: the pillar (`event-management-software-nepal-guide`) now has a "Which guide should you read next?"
  hub table linking every cluster and city guide, and every English cluster/city post links back to it (it had 3
  inbound links before, now 22: every English post links to it). The Nepali pillar is linked from every Nepali post and from the English pillar.
- Each English original with a Nepali version links to it ("यो गाइड नेपालीमा …"), and the post page shows a
  "नेपालीमा पढ्नुहोस् / Read in English" switch; related-post cards prefer the same language and leave out the
  translation (the switch offers it).

| Post | out | in |
|---|---|---|
| 01 pillar | 22 | 22 |
| 13 what-is-eventlaya | 6 | 1 (from the pillar) |
| 18 wedding guests | 4 | 5 |
| 19 voting without fraud | 4 | 7 |
| city guides 26–29 | 5–6 | 5–7 |

---

## 6. Fix list (priority order)

| # | Fix | Where | Who |
|---|---|---|---|
| 1 | **Deploy** the SEO/blog work (routes, migrations `blog 0001–0003`, `seed_blog`, prerender). Then run the curl checks in `docs/seo.md` §2: robots.txt is text, sitemap.xml is XML, a Nepali post has `lang="ne"` + hreflang. | `deploy/deploy.sh` | owner |
| 2 | Configure **email** (`EMAIL_*`) — posts promise passes by email — and an **SMS provider** for contest codes. | server `.env` | owner |
| 3 | Search Console + Bing: submit `https://eventlaya.com/sitemap.xml`; watch "Indexing → Pages": each language version is its own canonical, so English and Nepali posts should both end up "Indexed" (not "Duplicate, Google chose different canonical"). | `docs/seo-offsite-kit.md` §7 | owner |
| 4 | Run **PageSpeed Insights** on `/`, `/blog`, `/blog/nepal-ma-event-management-software` after deploy; record LCP/INP/CLS. | pagespeed.web.dev | owner |
| 5 | Logos: ship header/footer logos as SVG or a 2× WebP at display size (~5–10 KB each instead of 53/82 KB). | `frontend/public/brand`, `components/ui/Logo.tsx` | dev |
| 6 | Long cache for `/brand/*`, `/icon-*.png`, `/og-default.png` (30 days, or versioned names + 1 year immutable). Check the live Nginx matches `deploy/nginx.conf`. | Nginx | dev |
| 7 | Cut JS on public pages: lazy-load animation code on marketing routes, split the main chunk (448 KB raw / 138 KB gzip). | `frontend/src` | dev |
| 8 | Cloudflare: Brotli on, HTTP/3, **Crawler Hints** (IndexNow) on, cache static assets. | Cloudflare | owner |
| 9 | Home page `<ol>` markup (a11y) — only when the home page is next changed. | home page | dev (later) |
| 10 | Blog cover images: posts use generated category art; adding real photos (with `cover_alt`) improves Discover/image results. Never use photos of people without consent. | Superadmin → Blog | owner |

Nothing in this list changes the home/marketing pages' content.
