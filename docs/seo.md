# Eventlaya — SEO, link previews, AI visibility and the blog

How eventlaya.com gets found on Google/Bing, shows good previews in WhatsApp/Facebook/Viber, and gets cited by
ChatGPT, Gemini, Perplexity and Google AI Overviews — and what the owner still has to do off-site.

_Last updated: 2026-10-28_

---

## 1. What is built

| Piece | Where | What it does |
|---|---|---|
| Blog | `backend/apps/blog`, `frontend/src/pages/blog/`, editor `frontend/src/pages/admin/blog/` | `/blog` (search, categories, city + tag + language filters), `/blog/<slug>` (TOC, FAQ, related, share, CTA). Superadmin → **Blog** to write/edit/schedule. Module `blog`. |
| Languages (English + Nepali) | `Post.language` (`en`/`ne`), `Post.translation_of` (slug of the original), migration `blog 0003_post_language` | A Nepali post that sets `translation_of` is paired with its original: "नेपालीमा पढ्नुहोस् / Read in English" switch on both pages, `<html lang>`, `og:locale` (`ne_NP`) + `og:locale:alternate`, `hreflang` en/ne/x-default (x-default → English) in the HTML, the prerendered copy and `sitemaps/blog.xml` (`xhtml:link`), JSON-LD `inLanguage` + `workTranslation`/`translationOfWork`, llms.txt marks Nepali posts. Nepali headings get Devanagari anchor ids; word count understands Devanagari. Site chrome (menus, footer, CTA) stays English. |
| Page metadata (one source of truth) | `backend/apps/seo/pages.py` | Title, description, canonical, robots, Open Graph, Twitter, JSON-LD and a plain-HTML summary for every public page. |
| Link previews | `backend/apps/seo/og_images.py` | 1200×630 JPEG per event / venue / vendor / post under `MEDIA_ROOT/og/…` (resized banner or a branded card). |
| Server-visible HTML for dynamic pages | `apps.seo.views.page_view` | `/e/<slug>`, `/blog`, `/blog/<slug>`, `/marketplace/venues/<slug>`, `/marketplace/vendors/<id>` → the app's `index.html` with that page's tags + `<noscript>` summary. Unknown/draft → **404 + noindex**, generic preview. |
| Prerendered static pages | `frontend/scripts/prerender.mjs` (`npm run prerender`) | Headless Chrome renders `/`, `/events`, `/marketplace`, `/pricing`, legal pages, `/blog` and every post into `dist/prerender/…`. `src/main.tsx` swaps in the live app invisibly (no flash). |
| Head manager in the app | `frontend/src/lib/seo.tsx` (`<SeoHead />` in `App.tsx`) | Applies `GET /api/seo/meta/?path=…` on every navigation (all tags marked `data-seo`). |
| robots.txt, sitemaps, llms.txt | `apps.seo.views` | `/robots.txt`, `/sitemap.xml` → `/sitemaps/{pages,events,marketplace,blog}.xml`, `/llms.txt`, `/llms-full.txt`. Per host (white-label sites get their own). |
| Nginx routing | `deploy/enable_seo_routes.sh` (run by `deploy/deploy.sh`), same block in `deploy/nginx.conf` | Patches the live site in place (keeps certbot's SSL blocks), backup + `nginx -t` + restore on failure. The homepage `/` goes through Django (it serves the prerendered copy plus the Search Console/Bing verification tags from Superadmin → Analytics; the static copy if Django is down). |
| Fonts | `frontend/src/fonts.css`, `src/assets/fonts/` | Self-hosted Bricolage Grotesque, Poppins, JetBrains Mono (latin + latin-ext, `font-display: swap`, Poppins 400 preloaded). No request to Google any more. |

### Structured data (JSON-LD) per page

| Page | Types |
|---|---|
| `/` | `Organization` (name, alternateName इभेन्टलय, logo, contactPoint support@eventlaya.com, areaServed Koshi Province + cities, `sameAs` when filled in), `WebSite`, `SoftwareApplication` (BusinessApplication, Web/Android, offers from the live `Plan` rows in NPR; **no rating**) |
| `/pricing` | `SoftwareApplication` + `BreadcrumbList` |
| `/events`, `/marketplace` | `CollectionPage` + `ItemList` + `BreadcrumbList` |
| `/e/<slug>` | `Event` (start/end with +05:45, Place + PostalAddress, organizer, offers per visible ticket type in NPR with availability, eventStatus incl. cancelled, offline attendance mode, image) + `BreadcrumbList` |
| `/marketplace/venues/<slug>` | `["EventVenue","LocalBusiness"]` (address, phone, capacity, price range, amenities, photos) + `BreadcrumbList` |
| `/marketplace/vendors/<id>` | `Service` with a `LocalBusiness` provider, starting price + `BreadcrumbList` |
| `/blog` | `Blog` with its posts + `BreadcrumbList` |
| `/blog/<slug>` | `BlogPosting` + `BreadcrumbList` + `FAQPage` |
| legal pages | `WebPage` / `ContactPage` + `BreadcrumbList` |

No `aggregateRating` anywhere: venue/vendor `rating` fields are defaults, not real reviews. Add it only from real
reviews (`apps/reviews`) once there are enough. No `SearchAction`: Google retired the sitelinks search box (2024).

**Other apps can add pages** (e.g. contest/contestant pages) without touching apps/seo:
```python
from apps.seo.pages import PageMeta, register
@register(r'^/e/(?P<slug>[^/]+)/contest/(?P<entry>[^/]+)$', hosts='both')
def contestant(ctx, slug, entry): ...  # return PageMeta(...) or None (→ 404)
```
Call it from the app's `AppConfig.ready()`. Every `/e/…` path already reaches Django, so no Nginx change is needed.
Use `og_images.render_card(...)` / `_photo_or_card(...)` for the preview image.

### White-label sites
- Event pages on a tenant host use the tenant's brand as `og:site_name` and its domain in `og:url`/canonical. The
  same event on eventlaya.com also points (canonical) to the tenant site, and is listed only in the tenant's sitemap.
- Blog, marketplace, llms.txt and the prerendered marketing pages are **not** served on tenant hosts (404 / plain app).
- A host nobody has claimed gets `robots.txt: Disallow: /` and 404s.

---

## 2. Deploying

`deploy/deploy.sh` does everything:
1. builds the web app (`npm run build`),
2. uploads, runs `deploy/enable_seo_routes.sh` on the server (idempotent; replaces only the
   `# BEGIN eventlaya-seo … # END eventlaya-seo` block in each web-app server block),
3. `pip install` (new: `Markdown`, `nh3`), `migrate` (new: `blog 0001_initial`, `blog 0002_blog_module`, `blog 0003_post_language`),
   `seed_blog` (publishes the starter articles that aren't there yet; never overwrites edits),
4. restarts, then **prerenders** the public pages from the live site with local headless Chrome and uploads
   `dist/prerender/` (`SKIP_PRERENDER=1` to skip; failure only warns).

Check after deploy:
```bash
curl -s https://eventlaya.com/robots.txt | head
curl -s https://eventlaya.com/sitemap.xml
curl -s https://eventlaya.com/e/<a-real-slug> | grep -E 'og:(title|description|image)"'
curl -sI https://eventlaya.com/e/does-not-exist | head -1        # 404
curl -s https://eventlaya.com/ | grep -c 'data-prerendered'      # 1
curl -s https://eventlaya.com/llms.txt | head
```
Then paste an event link into https://developers.facebook.com/tools/debug/ and https://cards-dev.twitter.com (or
https://www.opengraph.xyz) and Google's Rich Results Test (https://search.google.com/test/rich-results).

**Shipping link previews alone (backend only):** `SKIP_FRONTEND=1 deploy/deploy.sh` is enough for event/venue/
vendor previews and robots/sitemaps/llms — the existing `index.html` on the server is used as the shell and its old
title/description are replaced. (It ships the whole `backend/` folder, so coordinate with other in-progress work.)

### Refreshing cached previews
Chat apps cache a link's preview.
- **Facebook / Messenger / Instagram:** https://developers.facebook.com/tools/debug/ → paste the URL → **Scrape Again**.
- **WhatsApp:** caches per exact URL (often for days) and has no tool. Share the link with something added, e.g.
  `https://eventlaya.com/e/pathibhara-film-festival-2083?v=2` — the page is the same, WhatsApp fetches it fresh.
- **Viber / Telegram / Slack / LinkedIn:** the same `?v=2` trick (LinkedIn also has https://www.linkedin.com/post-inspector/).
- A new banner, title, date or venue changes the image file name (and so its URL), so the image refreshes as soon
  as the page is scraped again. To regenerate every image after a design change, bump `VERSION` in
  `apps/seo/og_images.py`.

---

## 3. Writing blog posts (superadmin → Blog)

- Title answers a real question ("How to…", "What is…", "<topic> in <city>"); SEO title ≤ 60 characters;
  description 120–160 characters.
- First paragraph = the direct answer in 2–4 sentences (this is what Google snippets and AI assistants quote).
- `##` headings phrased as questions people search; a direct answer under each; lists and a table where they help.
- 3–6 FAQ items (become FAQPage data), 2–5 links to other guides and to `/pricing`, `/events`, `/marketplace`.
- Only facts you are sure of: no invented venues, prices, statistics, testimonials or "best/#1" claims.
- Pick target cities so the post shows under the city filter. Use **Scheduled** to publish later.
- **Nepali posts:** set **Language** to नेपाली and, when it is a version of an English post, **Translation of** to that
  post's slug (the editor checks it exists). Write natural, code-mixed Nepali the way people search (इभेन्ट,
  कार्यक्रम, अनलाइन टिकट, QR पास, भोटिङ) — not a word-for-word translation; keep the slug in romanized Nepali
  (`itahari-ma-event-kasari-garne`). Seed files use front matter `language: ne` and `translation_of: <slug>`.
  Only pair true equivalents: hreflang tells Google the two pages are the same article in two languages.
- The editor's checklist shows title/description length, focus keyword placement, length, headings, FAQ and links.

### Starter articles (published by `seed_blog`, author "Eventlaya team")
Files: `backend/apps/blog/seed_posts/*.md` (01–29). Points flagged for the owner's review are in the deploy report and
`docs/seo-audit.md`. Research behind 14–29: `docs/seo-research.md`.

| # | Title (short) | Lang | Focus keyword |
|---|---|---|---|
| 01 | Event management software in Nepal: a complete guide (2026) — **pillar** | en | event management software Nepal |
| 02 | How to organize an event in Itahari | en | organize an event in Itahari |
| 03 | How to organize an event in Dharan | en | organize an event in Dharan |
| 04 | How to organize an event in Biratnagar | en | organize an event in Biratnagar |
| 05 | Organizing events across Koshi Province (Jhapa, Morang, Sunsari, hills) | en | organizing events in Koshi Province |
| 06 | Event venues and banquet halls in Eastern Nepal: how to choose | en | event venues Eastern Nepal |
| 07 | QR code tickets and gate check-in for events in Nepal | en | QR code tickets in Nepal |
| 08 | Online registration forms for college fests in Koshi Province | en | online registration form for a college fest |
| 09 | How online voting works for pageants and talent shows in Nepal | en | online voting for pageants |
| 10 | Event planning checklist for Nepal | en | event planning checklist for Nepal |
| 11 | Event management company vs event software | en | event management company vs event software |
| 12 | Selling event tickets online in Nepal: Khalti, eSewa and pay at the venue | en | sell event tickets online |
| 13 | What is Eventlaya? | en | what is Eventlaya |
| 14 | Best event management software in Nepal: how to compare (2026) | en | best event management software in Nepal |
| 15 | Event management companies in Eastern Nepal: how to choose one | en | event management company in Eastern Nepal |
| 16 | How to sell concert tickets in Nepal | en | sell concert tickets in Nepal |
| 17 | College fest management: from registration to gate | en | college fest management |
| 18 | Wedding and reception guest management with QR passes | en | wedding guest management with QR passes |
| 19 | How to run an online voting contest without fraud | en | online voting contest without fraud |
| 20 | नेपालमा इभेन्ट म्यानेजमेन्ट सफ्टवेयर (Nepali pillar ↔ 01) | ne | इभेन्ट म्यानेजमेन्ट सफ्टवेयर |
| 21 | इटहरीमा कार्यक्रम कसरी आयोजना गर्ने? (↔ 02) | ne | इटहरीमा कार्यक्रम |
| 22 | धरानमा कार्यक्रम कसरी आयोजना गर्ने? (↔ 03) | ne | धरानमा कार्यक्रम |
| 23 | विराटनगरमा कार्यक्रम कसरी आयोजना गर्ने? (↔ 04) | ne | विराटनगरमा कार्यक्रम |
| 24 | नेपालमा अनलाइन टिकट कसरी बेच्ने? (↔ 12) | ne | अनलाइन टिकट |
| 25 | Pageant र ट्यालेन्ट शोमा अनलाइन भोटिङ (↔ 09) | ne | अनलाइन भोटिङ |
| 26 | How to organize an event in Damak | en | organize an event in Damak |
| 27 | How to organize an event in Birtamod (Jhapa) | en | organize an event in Birtamod |
| 28 | How to organize an event in Inaruwa | en | organize an event in Inaruwa |
| 29 | How to organize an event in Ilam | en | organize an event in Ilam |

`seed_blog` only creates posts whose slug doesn't exist yet; `seed_blog --update` rewrites existing ones from the files
(loses edits made in the editor). The blog is not deployed yet, so the first deploy publishes all 29 as they are now.
Paid vote packs: 09 says "where enabled"; 19 and 25 make no paid-voting claim — revisit them when packs go on sale.

---

## 4. Owner's off-site checklist

Ready-to-paste texts (GBP description/posts/services, social bios EN+NE, directories, outreach emails, press release)
are in **`docs/seo-offsite-kit.md`**; keyword map, competitors and the Nov 2026–Jan 2027 calendar in
**`docs/seo-research.md`**; technical findings in **`docs/seo-audit.md`**. The summary below stays as the checklist.

### 4.1 Search Console and Bing (day 1)
1. **Google Search Console** → Add property → **Domain** `eventlaya.com` → copy the TXT record →
   Cloudflare → DNS → Add record `TXT`, name `@`, content `google-site-verification=…` (DNS only) → Verify.
   (Or a URL-prefix property with the *HTML tag* method: paste the tag in Superadmin → Analytics; Django adds it to the
   homepage and the server-rendered pages — `docs/analytics.md`. Bing's `msvalidate.01` tag works the same way.)
2. Sitemaps → submit `https://eventlaya.com/sitemap.xml`.
3. URL inspection → "Request indexing" for `/`, `/blog`, the pillar guide and the three city guides.
4. **Bing Webmaster Tools** → "Import from Google Search Console" (fastest) or add the site with its own TXT record.
   Submit the sitemap there too (Bing also feeds ChatGPT search, Copilot and DuckDuckGo).
5. Optional: IndexNow in Cloudflare (Caching → Configuration → Crawler Hints: on).
6. White-label clients who want Google traffic should verify their own domain in Search Console and submit
   `https://<their-domain>/sitemap.xml`.

### 4.2 Google Business Profile
- Business name exactly **Eventlaya** (no keywords added to the name — that gets profiles suspended).
- Primary category: **Software company**. Secondary: **Event management company**, **Event ticket seller**,
  **Internet marketing service** only if true. Don't pick "Event venue".
- No storefront → choose **service-area business**, hide the address. Service areas: Koshi Province, Biratnagar,
  Itahari, Dharan, Inaruwa, Damak, Birtamod, Mechinagar, Bhadrapur, Ilam, Dhankuta, Urlabari, Gaighat (up to 20).
- NAP must match the website everywhere: name "Eventlaya", area "Eastern Nepal", email support@eventlaya.com,
  one phone number used consistently (add it to `/contact` and `legal.ts` once chosen), website https://eventlaya.com.
- Description: plain explanation of what Eventlaya does (reuse the first paragraph of the "What is Eventlaya?" post).
- Add the logo, a cover photo, real photos/screens from events you ran; post updates (new features, events) monthly.
- Verification is by video or postcard; do it from Dharan.

### 4.3 Social profiles (then fill `SAME_AS` in `backend/apps/seo/site.py`)
Create/claim with the same name, logo and one-line description, linking to https://eventlaya.com:
Facebook Page, Instagram, TikTok, YouTube, LinkedIn company page, X. Add each URL to `SAME_AS` (it goes into the
Organization JSON-LD and helps Google and AI assistants link them to Eventlaya).

### 4.4 Reviews (genuine only)
- After each event, ask the organizer (not attendees) for a Google review with the short "Ask for reviews" link.
- Never buy, swap or write reviews; don't offer discounts for 5 stars (against Google policy and Nepal consumer law).
- Reply to every review. When there are real reviews in `apps/reviews`, `aggregateRating` can be added to venue
  and vendor pages.

### 4.5 Citations and backlinks (Nepal / Koshi Province)
- Directories: Google Business Profile, Bing Places, Apple Business Connect, Facebook Page, LinkedIn, Crunchbase,
  Nepali business directories (e.g. Yellow Pages Nepal, local chamber of commerce member lists — FNCCI/ district
  chambers in Morang, Sunsari, Jhapa), startup lists (Nepal startup communities, Product Hunt when ready).
- Partners: every venue/vendor listed on the marketplace and every white-label client can link "Tickets by
  Eventlaya" to eventlaya.com — offer a small badge.
- Colleges: student unions and IT/management clubs of colleges in Biratnagar, Itahari and Dharan (fests, hackathons)
  — ask for a link on the event page or the club page; offer a free plan for student clubs.
- Local news and blogs: a press note when a notable event (film festival, college fest) runs its gate on Eventlaya.
- Event organizers' and wedding planners' sites, tourism/festival pages for Koshi Province.
- Answer questions where organizers ask them (Facebook groups for Itahari/Dharan/Biratnagar events, Reddit
  r/Nepal, Quora) with genuinely useful answers and a link only where it helps.

### 4.6 Content calendar (2 posts per month)
City × topic matrix — each cell is one possible guide. Start with the cities that have real customers.

| Topic ↓ / City → | Biratnagar | Itahari | Dharan | Damak / Birtamod | Inaruwa | Ilam / Dhankuta |
|---|---|---|---|---|---|---|
| Event venues & banquet halls: how to choose | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Organizing a college fest | ✓ | ✓ | ✓ (BPKIHS, campuses) | ✓ | | |
| Concerts & music events: permits, gates, sound | ✓ | | ✓ | ✓ | | |
| Weddings & receptions: guest list + QR entry | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Conferences & seminars | ✓ | ✓ | | | | |
| Sports tournaments: registration & entry | | ✓ | ✓ | ✓ | ✓ | |
| Festivals (Dashain/Tihar/Chhath/Udhauli/Ubhauli events) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Also: "How to run a hackathon in Nepal", "Pageant voting: how to keep it fair", "Ticket pricing for small events
in Nepal", "Gate staff training checklist", "Case study: <real client event>" (with their permission and real numbers).

### 4.7 Keywords and search intent
| Keyword | Intent | Best page |
|---|---|---|
| event management software Nepal / best event management software in Nepal | commercial | pillar guide 01, home |
| event management software Itahari / Dharan / Biratnagar / Eastern Nepal | commercial-local | city guides, home |
| event management company in Itahari / Dharan / Eastern Nepal | commercial-local (service) | guide 11, Google Business Profile |
| online event registration Nepal / registration form for event | transactional | guide 08, `/signup` |
| QR ticket Nepal / QR code entry system / gate check-in app | commercial | guide 07, `/pricing` |
| sell tickets online Nepal / Khalti eSewa tickets | commercial | guide 12 |
| online voting for pageant Nepal / audience voting app | commercial | guide 09 |
| event venues in Itahari / Dharan / Biratnagar, banquet in … | local | guide 06, `/marketplace` |
| events in Biratnagar / Itahari / Dharan this week | navigational/local | `/events`, event pages |
| event planning checklist Nepal | informational | guide 10 |
| what is Eventlaya / इभेन्टलय | navigational | guide 13, home |

### 4.8 Measuring
- **Search Console → Performance**: filter queries containing *event*, *Itahari*, *Dharan*, *Biratnagar*, *Koshi*;
  watch impressions first (weeks 2–6), then clicks and average position. Pages report: which guides get impressions.
- **Indexing → Pages**: everything in the sitemap should become "Indexed"; investigate "Crawled – not indexed".
- **Enhancements**: Event, Breadcrumb, FAQ items should show as valid.
- **AI visibility spot checks (monthly)**: ask ChatGPT (search on), Perplexity, Gemini and Google (AI Overview) the
  same questions — "best event management software in Eastern Nepal", "how to sell event tickets online in Nepal",
  "QR check-in app for events in Dharan", "what is Eventlaya" — and note whether Eventlaya is mentioned/cited and
  which page. Keep a simple sheet (date, engine, question, cited?, URL).
- Link previews: paste a new event link into WhatsApp and Facebook after each deploy that touches `apps/seo`.

---

## 5. Notes and limits
- The prerendered pages are a snapshot from deploy time; visitors always get live data (the app re-fetches), and
  Django serves blog posts edited after the deploy with fresh tags (the prerendered copy is ignored once the post is
  newer). `/events` and `/marketplace` crawler snapshots refresh on the next deploy.
- `og:image` files live in `MEDIA_ROOT/og/` (block storage) and are safe to delete — they are rebuilt on demand.
- Local check without Nginx: `PRERENDER_API=http://127.0.0.1:<backend port> npm run prerender` after `npm run build`.
