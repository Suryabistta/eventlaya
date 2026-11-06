# Eventlaya — Google Analytics 4, search-engine verification and Cloudflare Web Analytics

How eventlaya.com is measured, what is (and is never) sent, and what the owner does in Google Analytics once.

_Last updated: 2026-10-28_

---

## 1. What is built

| Piece | Where | What it does |
|---|---|---|
| Settings page | Superadmin → **Analytics** (`/admin/analytics`, `frontend/src/pages/admin/MeasurementPage.tsx`) | On/off switch, GA4 Measurement ID, "Also measure signed-in pages", Search Console + Bing verification codes, optional Cloudflare Web Analytics token, change history (who changed what, when). |
| Settings model + API | `backend/apps/site_analytics` (migration `site_analytics 0001_initial`) | Singleton `AnalyticsSettings` (pk 1) + audit log `AnalyticsSettingsChange`. `GET/PUT/PATCH /api/site/settings/` (superadmin only). `GET /api/site/config/` (public): only `enabled`, `measurement_id`, `track_app_pages`, `cloudflare_token`; always "off" on white-label hosts. |
| Production default | `GA_MEASUREMENT_ID` in `/srv/eventlaya/.env` (`deploy/deploy.sh` adds `G-LF7MHZQJBB` if missing) | While nobody has saved the settings page, this ID is used and analytics is **on for public pages**. The page shows "(from the server environment)"; saving an ID there overrides it, an empty ID falls back to it, the switch turns everything off. |
| Verification tags | `apps/seo/html.py` `site_verification()`, called by `apps.seo.views.page_view` | `<meta name="google-site-verification">` / `<meta name="msvalidate.01">` in every HTML page Django serves on eventlaya.com: the homepage (Nginx now sends `/` to Django, which serves the same prerendered copy; static fallback if Django is down), `/e/…`, `/blog…`, marketplace pages. Never on white-label hosts. |
| Loader + events | `frontend/src/lib/analytics.ts` (`<AnalyticsTracker />` in `App.tsx`, `track()`, `trackOnce()`) | Loads gtag.js only when allowed; page views on route changes; the events below. |
| URL / parameter sanitizer | `frontend/src/lib/analytics-url.ts` (pure, tested by `npm run test:analytics`) | Rules in §4. |
| Visitor switch | `/privacy#analytics` (`pages/legal/AnalyticsChoice.tsx`), linked as "Analytics preferences" in the marketing footer and "Analytics" in the attendee-page footer | On/off per browser (localStorage `eventlaya:analytics`); off deletes the `_ga` cookies and stops GA at once. |

### When nothing loads
- white-label tenant sites (the client's site — see §8), and the build-time prerender (user agent `EventlayaPrerender`;
  `scripts/prerender.mjs` also strips any analytics script from the snapshots);
- the switch is off, or there is no Measurement ID (and no Cloudflare token);
- the visitor turned analytics off on /privacy, or the browser sends **Do Not Track** or **Global Privacy Control**;
- signed-in pages (`/app`, `/admin`, `/judge`) unless "Also measure signed-in pages" is on: GA is paused there (a
  public page visited afterwards gets just `…/app` as its referrer, never the screen).

The mobile app has no analytics SDK (unchanged; `docs/play-store.md`).

### Privacy settings in the code
`send_page_view: false` (we send sanitized page views ourselves), `allow_google_signals: false`,
`allow_ad_personalization_signals: false`, `allow_enhanced_conversions: false`, Consent Mode defaults
`ad_storage`, `ad_user_data`, `ad_personalization`, `personalization_storage` = denied (`analytics_storage` granted),
`ads_data_redaction: true`, cookies `SameSite=Lax; Secure`. GA4 does not log or store IP addresses (it only derives
city/country), so there is no `anonymize_ip` to set.

**GA's own automatic events are filtered too.** A new GA4 stream has every *Enhanced measurement* option on. Two of them
read raw URLs: "Page changes based on browser history events" sends its own `page_view` with the raw old/new URL on every
in-app navigation (even with `send_page_view: false`), and "Form interactions" sends `form_destination` = the raw page
URL. Checked locally with this property's own container configuration (served from a file under a fake ID, no request
to Google): both leak pass tokens / `?next=` values if left alone.
`analytics.ts` drops those (`gtm.historyChange*`, `gtm.formInteract`, `gtm.formSubmit` pushes into `dataLayer`), so
only our sanitized page views count and nothing raw leaves. Scroll, outbound click, site search, video and download
events keep working. Still switch those two options off in GA (§2 step 3).

---

## 2. Owner steps (once)

The property exists: **Measurement ID `G-LF7MHZQJBB`**, web stream `https://eventlaya.com`. It goes live with the next
deploy (env default). In <https://analytics.google.com> → **Admin**:

1. **Property details** — name *Eventlaya*, reporting time zone **(GMT+05:45) Nepal Time**, currency **Nepalese Rupee (NPR)**.
2. **Account / property access** — add whoever needs reports (Viewer is enough).
3. **Data streams → Web → Enhanced measurement (gear)**:
   - Page views → *Show advanced settings* → **untick "Page changes based on browser history events"** (the site sends
     its own sanitized page views; the code already blocks GA's, this makes it official);
   - **Form interactions: off**;
   - keep Scrolls, Outbound clicks, Site search (query parameters `q,s,search,query,keyword` are fine), Video, File downloads.
4. **Data collection and modification → Data collection**:
   - **Google signals: off** (already off in the container config — keep it);
   - **User-provided data collection: off** (it is currently *on with automatic detection* of emails/phones/addresses
     in the container; we never want that — the code also denies `ad_user_data`, but turn it off);
   - Granular location and device data: on is fine (city-level reports for Koshi Province).
5. **Data retention → Event data retention: 14 months**; "Reset user data on new activity": on. (The privacy policy says 14 months.)
6. **Account settings → Data sharing settings**: turn off "Google products & services"; Technical support on;
   the rest optional (the privacy policy promises the data is not used for advertising).
7. **Data streams → Web → Configure tag settings → List unwanted referrals**: `khalti.com`, `esewa.com.np` (returns from
   the payment page are already sent without a referrer; this is the belt-and-braces setting).
   Optional: **Define internal traffic** (office IP) and turn the *Internal traffic* data filter to **Active**
   (team members can also just use the /privacy switch in their browsers).
8. **Events → Key events** (after the events have happened once, or *New key event* by name): mark `purchase`
   (already a key event), `sign_up`, `register_event`, `generate_lead`, `vote_pack_purchase`.
9. **Custom definitions → Create custom dimension** (event scope), so the parameters show in reports:
   `event_slug`, `account_type`, `lead_type`, `vote_type`, `poll_id`, `contest_id`, `search_area`, `payment`,
   `payment_type`. Custom metrics (standard unit): `ticket_count`, `votes`.
10. **Product links → Search Console links** → link the eventlaya.com property (after step 11).
11. **Search Console**: the Domain property via DNS TXT (`docs/seo.md` §4.1) is still the recommended way. Alternative:
    URL-prefix property `https://eventlaya.com/` → *HTML tag* → paste the tag (or its content) in Superadmin →
    Analytics → Google Search Console → Save → Verify (needs the Nginx change in this release deployed: `/` via Django).
    **Bing Webmaster Tools**: "Import from Google Search Console", or *HTML Meta Tag* → paste in the Bing field.
12. **Cloudflare Web Analytics** (optional, cookieless): Cloudflare → Analytics & Logs → Web Analytics → Add site →
    *Manage site* → JS snippet → paste the token (or the snippet) in the Cloudflare field. Do **not** enable
    "Automatic setup" for eventlaya.com: that injects the beacon at the edge into every page (also pass links and
    signed-in pages) and ignores the visitor switch. Our loader counts only the first page of a visit, only when it is
    public and has nothing secret in its URL.

---

## 3. Events

All go through `track()` (no-op when off/blocked/unmeasured); parameters pass `sanitizeParams` (names such as
`email`, `name`, `phone`, `otp`, `token`, `voter…` are dropped; text is masked; `…_id` values are our own IDs).
Every event also carries the sanitized `page_location` and `page_title` of the page it happened on.

| Event | GA4 type | Fired | Parameters |
|---|---|---|---|
| `page_view` | automatic (sent by us) | every route change (path or query), after the page's title is known | `page_location`, `page_referrer`, `page_title` (sanitized; private pages get `Eventlaya: <clean path>` as title) |
| `sign_up` | recommended | email sign-up done (`pages/auth/SignupPage.tsx`); Google/Facebook when a new account was created (`AuthPages.tsx`, sign-up page) | `method` (`email`/`google`/`facebook`), `account_type` |
| `login` | recommended | email sign-in, Google/Facebook sign-in to an existing account | `method` |
| `register_event` | custom (key) | registration completed: free / pay-at-venue right away (`EventRegisterPage.tsx` onSuccess, not for "already registered"); online after the server confirms payment | `event_slug`, `ticket_count`, `value`, `currency` `NPR`, `payment` (`free`/`venue`/`online`) |
| `purchase` | recommended (key) | online ticket payment confirmed **by the server** (PaymentReturn → `onPaid`), once per order (`trackOnce`, sessionStorage) | `transaction_id` = order reference (`ORD-…`), `value`, `currency` `NPR`, `event_slug`, `payment_type` (provider), `items[]` = ticket types (`item_id` ticket type id, `item_name`, `item_category` `ticket`, `price`, `quantity`) |
| `vote_cast` | custom | poll vote accepted (`PublicVotePage.tsx`); contest vote accepted (`contest/VoteFlow.tsx`) | `vote_type` (`poll`/`contest`), `poll_id` or `contest_id`, `event_slug`, `choices` or `votes`, `category_id` — never the voter or the contestant |
| `vote_pack_purchase` | custom (key) | paid vote pack confirmed by the server (`contest/BuyVotes.tsx` PurchaseReturn), once per payment | `transaction_id` (payment reference), `value`, `currency` `NPR`, `contest_id`, `votes`, `payment_type` |
| `generate_lead` | recommended (key) | venue/vendor inquiry or booking request sent (`VenueInquiryForm.tsx`, `VendorQuoteForm.tsx`) | `lead_type` (`venue_inquiry`/`venue_booking`/`vendor_inquiry`/`vendor_booking`), `item_id` (venue slug / vendor id) |
| `share` | recommended | event share button (native share or copy), blog share buttons, contest/contestant share panel | `method` (`native`, `copy_link`, `facebook`, `whatsapp`, `messenger`, `viber`, `x`, `linkedin`), `content_type` (`event`/`blog_post`/`contest`/`contestant`), `item_id` |
| `search` | recommended | 1.5 s after typing stops on /events and /marketplace; blog search on submit; once per term | `search_term` (emails → `(email)`, 6+ digit numbers → `(number)`), `search_area` |
| `select_content` | recommended | venue / vendor detail page opened | `content_type` (`venue`/`vendor`), `item_id` |
| scroll, click (outbound), view_search_results, video_*, file_download | GA enhanced measurement | GA itself | uses our sanitized page fields |

`vote_pack_purchase` is a custom event, so its value shows as key-event value, not in "Total revenue". If vote-pack
revenue should count as revenue, also send it as `purchase` with `item_category: 'vote_pack'` (one line in BuyVotes).

---

## 4. Sanitizer rules (`frontend/src/lib/analytics-url.ts`)

**Paths**
- `/ticket/<token>` → `/ticket/:token`; the same for anything under `/pass/`, `/invite/`, `/reset-password/`,
  `/verify-email/`, `/unsubscribe/`, `/magic/`, `/confirm/`.
- Any segment that is an email → `:email`, a UUID → `:id`, a phone-like number (7+ digits) → `:number`, a
  random-looking token (mixed-case + digits ≥16 chars, long hex, JWT-like, long non-slug) → `:token`.
  Normal slugs (`/e/pathibhara-film-festival-2083`, contestant pages) stay readable.

**Query string**
- Kept (values masked: emails → `(email)`, 6+ digit numbers → `(number)`, tokens → `(token)`): `utm_*`, `gclid`,
  `gbraid`, `wbraid` and the site's own filters/steps (`search`, `q`, `category`, `city`, `tag`, `type`, `when`,
  `page`, `sort`, `view`, `tab`, `step`, `kind`, `status`, `sent`, …).
- Dropped: `fbclid`, `msclkid`, `ttclid`, `twclid`, `igshid`, `mc_*`, `srsltid`, `_gl`, `_ga`, `debug_mode`, `tenant`, ….
- **Everything else keeps its name with the value `redacted`**: `?token=`, `?uid=`, `?email=`, `?next=`, `?code=`,
  `?otp=`, `?payment=`, Khalti's `pidx` / `transaction_id` / `mobile` / `purchase_order_name`, eSewa's `data`, ….
- The `#fragment` is always dropped (OAuth tokens). Empty/`javascript:` URLs → empty.
- Referrers: same rules; Khalti/eSewa/Fonepay referrers are dropped; an unmeasured signed-in page → just `…/app`.

**Titles**: public pages send the document title (masked); `/ticket`, `/reset-password`, `/verify-email`, `/login`,
`/signup`, `/forgot-password` and signed-in pages send `Eventlaya: <clean path>`.

---

## 5. Checking it works

- **DebugView**: open `https://eventlaya.com/?debug_mode=1` (the flag sticks for the browser tab; `?debug_mode=0` turns
  it off; the parameter itself is never sent) → GA → Admin → **DebugView**: page views and events appear within seconds.
- **Realtime**: Reports → Realtime (shows visits within ~30 s).
- **Browser**: DevTools → Network → filter `collect`: each hit's `dl` is the clean URL; open `/ticket/<anything>` and
  check `dl=…/ticket/:token`. `window.dataLayer` shows what the site pushed.
- Verification tags: `curl -s https://eventlaya.com/ | grep -E 'google-site-verification|msvalidate'`.
- Ad blockers and Brave block gtag.js: those visitors are not counted (expected; Cloudflare Web Analytics, if on, is
  blocked less often). The site's own URLs avoid the word "analytics" (`/api/site/…`, `MeasurementPage` chunk) so the
  admin page and the app keep working with blockers on.

### Tests
- Backend: `cd backend && .venv/bin/python manage.py test apps.site_analytics apps.seo --noinput` (permissions,
  validation incl. pasted snippets and markup injection, audit trail, env fallback, tenant hosts, verification tags in
  the homepage and server-rendered pages, HEAD on `/`).
- Sanitizer: `cd frontend && npm run test:analytics` (Node ≥ 22.18 runs the TypeScript directly).
- End-to-end (local, headless Chrome, every Google/Cloudflare request intercepted and answered locally, fake ID
  `G-TEST123456` with the real container configuration): see the agent report of 2026-10-28.

---

## 6. Consent and the privacy policy

Nepal (Individual Privacy Act 2075) has no cookie-banner rule like the EU's, so analytics is on by default with an easy
opt-out, Do Not Track / Global Privacy Control honoured, and the policy explains it (`/privacy#analytics`: what is
collected, `_ga` / `_ga_<ID>` cookies up to 2 years, IP not stored, 14-month retention, US processing, opt-out switch,
Google's opt-out add-on). If EU/UK visitors become a real audience, add a consent banner and start with
`analytics_storage: 'denied'` for them (Consent Mode is already wired in `loadGa`).

---

## 7. Changing things

- New event: `track('name', { …ids, counts, amounts… })` from `@/lib/analytics` — never names, emails, phones,
  free text typed by the user, pass codes. Add it to §3, the privacy policy list if it is a new kind of data, and mark
  it as a key event in GA if it matters.
- New page whose URL carries a secret: add its first path segment to `SECRET_PREFIXES` (or rely on the query rule:
  unknown parameters are redacted) and add a test in `scripts/test-analytics-url.mjs`.
- New harmless query parameter you want in reports: add it to `KEEP_PARAMS`.

---

## 8. White-label sites (follow-up, not built)

Tenant hosts never load Eventlaya's GA (the client's site, their visitors). If a client wants their own GA: add
`ga_measurement_id` to `TenantBranding` (validated like here), return it from `/api/site/config/` when
`tenant_for_request()` is that tenant, show the field in the organizer's Branding page, and mention it in their site's
privacy notice (they are the controller for it). The loader already handles everything else.
