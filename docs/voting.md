# Voting: quick polls and contests / pageants

Eventlaya voting has two kinds, both stored as a `Poll` row in `backend/apps/voting/`:

| Kind | `Poll.kind` | What it is | Organizer pages | Public pages |
|---|---|---|---|---|
| **Quick poll** | `poll` | One ballot per voter (pick 1 or up to N), live tally. Unchanged from before. | `/app/voting/new`, `/app/voting/:id` | `/e/<event>/vote/<poll id>` |
| **Contest / pageant** | `contest` | Numbered contestants with profiles, award categories, rounds with eliminations, judges' scoring, weighted results, verified voting (SMS / email codes), vote allowances, anti-fraud, paid-vote extension point. | `/app/voting/contests/new`, `/app/voting/contests/:id` (dashboard), `…/edit` (builder), `…/present` | `/e/<event>/vote/<contest slug>`, `/e/<event>/vote/<contest slug>/c/<number or slug>` |

Migrations: `voting 0004_contests` (contests), `0005_vote_purchases` (paid votes, depends on `payments 0002`),
`0006_voting_modules` (superadmin modules).

**Backwards compatibility.** Contests extend the existing `Poll` / `Candidate` / `Vote` tables instead of a parallel
model, so every existing poll, its API (`/api/voting/polls/`, `/api/voting/public/<slug>/…`), the presenter and the
mobile app keep working untouched. Migration `voting 0004_contests` only adds columns/tables. It also replaces the old
unique constraint `(poll, voter, candidate)` with `Vote.unique_key` (`"<voter>:<candidate>"` for quick-poll votes,
backfilled for existing rows), because contest voters may vote for the same contestant many times. Quick-poll
behaviour is identical. Counts everywhere now sum `Vote.quantity` and skip voided votes; for quick polls quantity is
always 1 and nothing is voided, so the numbers are unchanged. New vote modes (`account`, `email_otp`, `sms_otp`) also
work for quick polls through the same endpoints.

### Superadmin modules

Voting is split into four modules (Superadmin → Modules & permissions, mobile More → Modules; global and per role).
A module is only on when every module it requires is on (`MODULE_REQUIRES` in `apps/accounts/modules.py`), and
`GET /api/auth/modules/` leaves out modules that are effectively off and lists each module's `requires`.

| Key | Name | Requires | Default roles | Off means |
|---|---|---|---|---|
| `voting` | Voting | — | organizer, attendee | Master switch: every `/api/voting/…` endpoint → 403 `module_disabled` (middleware); all voting UI hidden. |
| `contests` | Pageant & contests | `voting` | organizer, attendee | Contest API, public contest/contestant pages, contest votes, codes, link previews, presenter → 403 `{"code":"module_disabled","module":"contests"}`; contests drop out of poll lists; "New contest" hidden; quick polls unaffected. |
| `judging` | Judges' scoring | `contests` | organizer, attendee, staff | `/api/voting/judge/…`, judge management, score sheets, score export → 403; **judges' scores stop counting** (results = public votes; judge-based tie-breakers and "judges" categories ignored); judges UI hidden. |
| `paid_votes` | Paid votes | `contests` + `payments` | organizer, attendee | Packs hidden (`paid.enabled=false`, `payments_available=false`), buy endpoint → 403 `module_disabled`. Purchase history stays visible to the organizer. |

Checks are per view (`apps/voting/access.py`: `RequiresModule(slug)` permission + `require(slug, request, contest)`):
the **requesting user's role** (anonymous visitors: the global switch) **and the contest organizer's role** (a feature
switched off for organizers is off on their contests for everyone). Superadmins always pass. Staff have `voting` off by
default, so a staff account made a judge also needs `voting` (and `contests`) on for the staff role.
Seeded by migration `voting 0006_voting_modules` (also renames the `voting` row and replaces its old description).

---

## 1. Data model

```
Poll (kind=contest) ─┬─ Candidate (contestant)        number, slug, status, photo, gallery, social_links, profile{}
                     ├─ ProfileField                  key, label, type text/number/select/date, options, is_public, required
                     ├─ ContestRound ─┬─ Criterion     name, max_points, weight
                     │                ├─ RoundEntry    contestant in a round: competing/advanced/eliminated/placed, rank, score
                     │                └─ ScoreSheet    judge × contestant × round: scores{criterion_id: points}, comment, draft/submitted
                     ├─ ContestCategory               sub-award: selection public_vote/judges/manual, nominees, own limits, winner
                     ├─ ContestJudge                  user (any role), name, is_active, excluded_contestants (conflicts of interest)
                     ├─ Vote                          contestant, round?, category?, quantity, source free/paid/bonus, method,
                     │                                nepal_date, ip_hash, subnet_hash, device_hash, flags[], is_void + reason
                     ├─ VotePack                      label, votes, bonus_votes, price (paid votes, payments wired later)
                     ├─ VotePurchase                  one checkout: pack, voter hash, votes+bonus, amount, status, payment intent,
                     │                                contestant (attribution / buy-and-vote), flags
                     ├─ VoteCredit                    ledger per voter: +granted (paid/bonus, pack, payment_ref) / −spent (vote, grant)
                     ├─ VoteOTP                       channel, destination_hash, code_hash, expires_at, attempts, verified_at
                     └─ ContestAuditLog               actor, action, summary, detail — advancement, voids, unlocks, presets…
```

### Poll (contest settings)

| Group | Fields |
|---|---|
| Basics | `title`, `description`, `slug` (unique per event, used in URLs), `cover_url`, `status` draft/scheduled/open/closed, `opens_at`, `closes_at`, `show_on_public_page`, `preset` |
| Numbering | `number_prefix` (default `#`), `number_padding` (default 2 → `#07`) |
| Verification | `vote_mode`: `sms_otp`, `email_otp`, `account`, `ticket` (+ `require_checked_in`), `contact` (unverified phone/email), `open` (device) |
| Free votes | `free_votes_enabled`, `votes_per_voter` (whole contest), `votes_per_day` (Nepal day), `votes_per_round`, `votes_per_contestant` + `contestant_cap_period` contest/day/round, `allow_split`, `max_votes_per_submit`, `main_vote_enabled` (off = only categories) |
| Paid votes | `paid_votes_enabled`, `price_per_vote`, `currency`, `max_packs_per_day`, `buy_and_vote`, packs in `VotePack` |
| Anti-fraud | `captcha_enabled`, `ip_votes_per_minute`, `device_votes_per_minute` (hard limits, 0 = off), `flag_ip_burst`, `flag_subnet_burst` (per 10 min), `flag_device_voters` (flags, 0 = off), `transparency_note`, `show_transparency` |
| Results | `results_visibility` live / after_close / hidden_to_public / ranks_only / top_n, `results_top_n`, `show_judge_breakdown`, `placement_titles` (reveal order) |
| Judges | `judges_see_others` |

### ContestRound

`name`, `order`, `status` upcoming/open/closed (+ `opens_at`/`closes_at`: upcoming rounds open and open rounds close on
their own), `public_vote_enabled`, `judging_enabled`, `judge_weight` + `public_weight` (percent, must add to 100 when
both are on), `public_normalization` top/share, `judge_aggregation` average/drop_high_low/median, `advance_count`,
`advance_mode` auto/manual, `carry_over_votes`, `tie_breakers` (ordered list of `judges`, `public`, `earliest`,
`number`, `criterion:<id>`), `results_visibility` + `results_top_n` (blank = contest setting), `finalized_at/by`.

### ContestCategory

`name`, `slug`, `description`, `selection` (`public_vote` = own ballot and tally, `judges` = highest judges' score in
`round` (default: last judged round), optionally on one `criterion`, `manual` = organizer sets `winner`), `nominees`
(empty = every active contestant), `votes_per_voter` / `votes_per_day` overrides, `results_visibility` override.

---

## 2. Presets

`GET /api/voting/contests/presets/`; applied on create (`POST /contests/ {preset}`) or later
(`POST /contests/<id>/preset/`, refused once votes or scores exist). All values stay editable.

| Key | Fills |
|---|---|
| `pageant` — *Pageant: online public vote + judges finale* | SMS codes, 5 free votes/day, up to 5 per submission, CAPTCHA on, ranks-only results; rounds Audition (public, top 20) → Top 20 (50/50, top 10) → Top 10 (60/40, top 5) → Finale (70% judges / 30% public, drop high/low, hidden results); criteria Beauty 30 · Talent 30 · Q&A 40; categories People's Choice (public, 1/day), Miss Photogenic (organizer picks), Best Talent (judges, Talent criterion); profile fields Age, Height, District, Hobbies, Phone (private) |
| `talent` — *Talent show: live audience + judges* | Ticket voting, 1 vote per round, no splitting, results after close; Semi-final (top 5) → Final, 60% judges / 40% audience, criteria Skill 40 · Stage presence 30 · Originality 30; profile fields Act (select), From |
| `awards` — *Awards: categories, one vote each* | Email codes, 1 vote per category, main vote off, results hidden; categories Best Film, Best Director, Best Actor |
| `quick` — *Quick poll* | The existing quick-poll builder |

---

## 3. Vote rules (`apps/voting/rules.py`)

A contest vote is `POST /api/voting/public/<event>/contests/<contest>/vote/`
`{contestant (id | number | slug), category?, quantity?, voter_token | ticket_code | contact, device_id, captcha_token?}`.
Checks, in order (the contest row is locked with `select_for_update` so allowances can't be raced):

1. CAPTCHA (when active), contest status (draft → 404, scheduled/closed → 409).
2. Category exists and is `public_vote`, or the main vote is enabled.
3. Contestant eligible: not withdrawn/eliminated; in a category → nominated (or any active contestant); in the main
   contest with rounds → a round is open with public voting and the contestant is `competing` in it.
4. Voter identity → `voter_identifier` = SHA-256 of `ticket:<id>` / `contact:<phone or email>` / `user:<id>` /
   `device:<id>`. OTP modes need the signed `voter_token` from `/otp/verify/` (12 h, bound to the contest; it carries
   only the hash). SMS and email codes use the same `contact:` key as the contact mode.
5. Hard rate limits per IP hash and device hash (per minute) → 429.
6. No splitting (when `allow_split` is off): all of a voter's votes in a round (or category) go to one contestant.
7. Free allowance = min of the remaining per-contest, per-day (`nepal_date`, Asia/Kathmandu midnight), per-round and
   per-contestant limits; counted on `source=free` votes, **voided votes included** (a void doesn't hand votes back).
   Category limits override the contest's per-voter/per-day limits.
8. Anything beyond the free allowance is spent from the voter's credit ledger (`source=paid`); not enough → 409
   `allowance_used` with `free_remaining` and `credits`.
9. Fraud flags are stored on the vote (it still counts): `ip_burst`, `subnet_burst` (/24, IPv6 /48),
   `shared_device` (one device used by N voter identities).

The response includes `allowance {free_remaining, resets_daily, credits, voted_for}`;
`POST …/allowance/` returns the same per category without voting.

**Per contestant.** `POST …/allowance/` also takes `contestant` (id | number | slug); the vote response is always about
the contestant just voted for. Each allowance then adds `contestant_id`, `contestant_cap` (the contest's
`votes_per_contestant`), `contestant_cap_period`, `contestant_free_remaining` (the free votes a vote for them would accept
right now — every limit, the per-contestant cap included, counted the same way as step 7; `null` when the contest has no
per-contestant cap, then `free_remaining` applies) and `contestant_used` (free votes already given to them in the cap
period; `null` without a cap). Credits are spent beyond the free cap, so the most one vote for that contestant can give is
`min(max_votes_per_submit, (contestant_free_remaining ?? free_remaining) + credits)` — the web vote modal and the app's
stepper use exactly that. Categories count separately from the main vote (their own `contestant_free_remaining`).

### OTP (`apps/voting/otp.py`, `apps/voting/sms.py`)

6-digit code, 5-minute expiry, 5 wrong tries per code (then a new code is needed), 60-second resend cooldown, 5 codes per
hour per destination, 30 per hour per IP (plus a 10/min DRF throttle on the endpoint). Only HMAC hashes (keyed with
`SECRET_KEY`) of the destination and code are stored. Sending a new code expires older ones. Phone numbers are
normalised to 10 digits starting 97/98 (`+977` stripped). SMS text is plain ASCII (≤ 160 chars) so it costs one credit.

**SMS providers** (env `SMS_PROVIDER`, default `aakash` when `AAKASH_SMS_TOKEN` is set, otherwise `console`):

| Provider | Env | Notes |
|---|---|---|
| `aakash` (**primary**) | `AAKASH_SMS_TOKEN` | `POST https://sms.aakashsms.com/sms/v3/send` with `auth_token`, `to` (comma-separated 10-digit numbers), `text`. Success: `{"error": false, "message": "1 messages has been queued…", "data": {"valid": […], "invalid": […]}}`; failure: `{"error": true, "message": "Not enough balance."}` (we treat an empty `valid` list as failure too). |
| `sparrow` (optional) | `SPARROW_SMS_TOKEN`, `SPARROW_SMS_FROM` | `POST https://api.sparrowsms.com/v2/sms/` with `token`, `from` (approved identity), `to`, `text`. |
| `console` (development) | — | Writes `[SMS console] to 98…: <text>` to the server log; nothing is sent. The builder warns when contests use SMS codes on a server in console mode. |

**Setting up Aakash SMS**
1. Register at https://sms.aakashsms.com/register and log in at https://sms.aakashsms.com.
2. Buy SMS credit (Aakash sells credit packs; price per SMS is not published on their site — ask for a quote via
   https://aakashsms.com/contact-us/). One credit = one 160-character plain-text SMS to a valid number; invalid
   numbers use 0 credits. Check the balance with `POST https://sms.aakashsms.com/sms/v1/credit` (`auth_token`) →
   `available_credit`, `total_sms_sent`.
3. Generate the API **auth token** in the Aakash dashboard (developer / API section) and set on the server:
   `SMS_PROVIDER=aakash` and `AAKASH_SMS_TOKEN=<token>` in `/srv/eventlaya/.env`, then restart.
4. Sender / route: the v3 API has no `from` parameter; messages go out with the sender identity configured on the
   Aakash account. OTP traffic is transactional — ask Aakash to put the account on their transactional/OTP route so
   codes arrive fast and aren't blocked as promotional.
5. Numbers: Nepali mobiles only — 10 digits starting 97 or 98 (NTC and Ncell). `+977` / `977` is stripped and the
   number is sent as `98XXXXXXXX`. (Other prefixes are refused with a clear message; widen `normalize_nepal_mobile` if
   needed.)
6. Test: create a contest with "SMS code", open it, request a code from your phone.

### CAPTCHA (`apps/voting/captcha.py`)

Cloudflare Turnstile, asked before sending a code and before each vote when the contest has `captcha_enabled` **and**
both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set (otherwise skipped). Create a widget at
Cloudflare → Turnstile with the site's domains (eventlaya.com and white-label domains).

---

## 4. Results (`apps/voting/scoring.py`)

Per round (or the whole contest when it has no rounds):

- **Public score (0–100)**: `top` = votes ÷ most-voted contestant's votes × 100; `share` = votes ÷ all votes × 100.
  With `carry_over_votes`, votes from all earlier rounds count too. Voided votes never count.
- **Judge sheet (0–100)** = Σ(points × weight) ÷ Σ(max × weight) × 100 (submitted sheets of active judges only).
- **Judges' score** = average / drop highest and lowest (3+ judges) / median of the sheets; excluded (conflict) judges
  simply don't score that contestant.
- **Final** = (judge_weight × judges + public_weight × public) ÷ 100. A disabled part gets weight 0.
- **Ranking**: final desc, then the round's `tie_breakers` in order (`judges`, `public`, `criterion:<id>` = higher
  average on that criterion, `earliest` = whose last vote came first, `number`). Still equal → shared rank, `tied=true`;
  `tie_at_cutoff` when the tie straddles `advance_count`.
- **Visibility** for the public (`category` > `round` > contest setting): `live` (counts, %, optional judge/public
  split), `after_close` (nothing until the round or contest closes), `ranks_only` (ranks, no counts), `top_n` (top N
  ranks, no counts), `hidden_to_public`. Organizers always see everything.

### Advancement (`decide_round`, `undo_round`)

`POST /contests/<id>/rounds/<rid>/decide/ {confirm: true, contestant_ids?}`:
- Not the last round: top `advance_count` (auto) or the given ids (manual, or required when tied at the cutoff) become
  `advanced` and get a `RoundEntry` in the next round; the rest become `eliminated` (contestant status too).
- Last round: placements in ranking order (or the given order, required when the top place is tied); rank 1 → status
  `winner`. Placement titles come from `placement_titles`.
- Ranks and scores are frozen on the entries (history), the round is closed and `finalized_at` set, audit logged.
- `…/undo/` reverses it while the next round has no votes or scores.

---

## 5. Judges

Least invasive design: **no new role**. A judge is a `ContestJudge` row linking any user account to one contest.
Inviting by email reuses the team onboarding helpers (`apps/accounts/team.py`): an unknown email gets a new
**attendee** account with a temporary password (shown once to the organizer, like staff onboarding); an existing account
is linked as is. The invite email links to `/judge/<judge id>`. Judges score at `/judge` (standalone page, works on a
tablet or phone): criteria sliders + number inputs, comment, autosaved draft, submit (locks the sheet), organizer
unlock (`POST /contests/<id>/sheets/<sid>/unlock/`, audit logged). Judges never see other judges' scores unless
`judges_see_others`. A judge with submitted scores is deactivated instead of deleted (their scores stop counting).

Note: judges use the `voting` module. It is on for organizers and attendees by default; if an existing **staff**
account is made a judge, the superadmin must enable `voting` for the staff role.

---

## 6. Link previews (Open Graph)

The web app is client-rendered, so chat apps can't read meta tags from `/e/…`. Share buttons therefore link to
`/api/voting/og/<event>/<contest>/` and `/api/voting/og/<event>/<contest>/c/<number>/`. That endpoint returns a tiny
HTML page with `og:title` ("Vote for #07 Asha Rai · Miss Dharan 2026"), `og:description`, `og:image` (contestant photo,
else cover, else event banner), `og:url`, and immediately redirects people (meta refresh + `location.replace`) to the
real page on the organizer's site (`site_url()` — white-label aware). It's self-contained (`og_html()` in
`public_contest_views.py`) so a future site-wide crawler-meta mechanism can call it.

Optional upgrade so the pretty `/e/…/vote/…` URLs also preview: in Nginx, send known crawlers to the API page:
```nginx
map $http_user_agent $is_crawler { default 0; ~*(facebookexternalhit|Facebot|Twitterbot|WhatsApp|Viber|TelegramBot|Slackbot|LinkedInBot|Discordbot) 1; }
location ~ ^/e/([^/]+)/vote/([^/]+)(/c/([^/]+))?/?$ {
    if ($is_crawler) { rewrite ^/e/([^/]+)/vote/([^/]+)/c/([^/]+)/?$ /api/voting/og/$1/$2/c/$3/ last;
                       rewrite ^/e/([^/]+)/vote/([^/]+)/?$ /api/voting/og/$1/$2/ last; }
    try_files $uri /index.html;
}
```
The contestant page also offers **Download share card**: a 1080×1350 PNG made in the browser (photo, number, name,
contest, QR code to the profile).

---

## 7. Paid votes (vote packs via `apps.payments`)

**Flow.** A verified voter picks a pack (or N votes at `price_per_vote`) on the contest or contestant page →
`POST …/buy/` creates a `VotePurchase` (pending) and a `PaymentIntent` (purpose `vote_pack`, reference = purchase id,
organizer = contest organizer, event = contest event, metadata `{contest, pack, voter (hash), contestant, purchase}`,
return URL = the page they bought from) and starts the Khalti / eSewa / test checkout → the provider returns to the API,
which verifies server to server → `on_paid` (exactly once, under the intent's row lock) credits the votes to that voter
→ the browser lands on `…?payment=<id>&status=…`, the page polls `GET /api/payments/intents/<id>/` and shows
"N votes added · Vote now" (or "Payment cancelled · Try again").

- **Identity first.** Buying needs the same verified identity the contest votes with: SMS / email code (`voter_token`),
  ticket (code or the account's ticket) or account. `open` and `contact` modes can't sell votes (the builder refuses it,
  the public API says `unverified_mode`), because anyone could type someone else's number.
- **Credits** land in the `VoteCredit` ledger (`source=paid` for the pack's votes, `bonus` for its bonus votes,
  `payment_ref` = intent id, unique per payment → a repeated return / poll / cron can't credit twice). Free votes are used
  first; votes beyond the free allowance are spent from credits, oldest first. Debits point at the grant they used
  (`VoteCredit.grant`), and each paid vote records `Vote.payment_ref` (exports show it).
- **Late payment** (paid after the hold expired / purchase marked failed): `on_paid` still credits it.
- **Refund** (organizer records it on the Payments page / `POST /api/payments/intents/<id>/refund/`): `on_refunded`
  removes that payment's **unused** credits and audit-logs how many were already cast — void those in Votes & fraud if
  they shouldn't count. Voiding paid votes shows a warning to consider a refund (voiding never refunds).
- **Buy and vote** (`Poll.buy_and_vote`, **default off**): a purchase made on a contestant's page casts the votes for them
  as soon as the payment is confirmed, if they can still receive votes (else the votes stay in the balance with a note).
  Off by default because the payment can arrive minutes later (a round may have closed, the contestant may be
  eliminated, a no-split rule may now apply), and because voters should cast their own votes. When off, the contestant
  only attributes the revenue.
- **Limits:** `Poll.max_packs_per_day` purchases per voter per Nepal day (default 10, 0 = none; unfinished checkouts count
  until they time out); Khalti needs ≥ Rs 10 (cheaper packs: eSewa only; `khalti_ok` per pack); custom quantity 1–1000.
  CAPTCHA (when on) is asked before buying too. The buy endpoint has its own 10/min per-IP throttle.
- **Fraud flags on purchases:** `purchase_burst` (≥ 10 purchases from one IP in an hour), `shared_device_purchases`
  (one device buying for `flag_device_voters` different voters). Shown on Dashboard → Paid votes and in the purchases CSV.
- **Money:** Eventlaya collects; it shows on the organizer's Payments page ("Online payments, all events" summary and
  CSV — purpose-agnostic, so vote packs are included per event) and on Dashboard → Paid votes (revenue, per pack, per
  contestant = purchases made on that contestant's page, paid votes received, refunds, unused credits).
- **Organizer bonus votes** (`POST /contests/<id>/credits/grant/`) go through the same ledger without a payment.

**For the mobile app — public contest JSON `paid`** (`GET /api/voting/public/<event>/contests/<contest>/`, also in the
contestant endpoint's `contest`):
```json
"paid": {
  "enabled": true,                 // show the packs section at all
  "payments_available": true,      // packs can be bought right now (else show them disabled with unavailable_message)
  "unavailable_reason": null,      // off | payments_off | paid_votes_off (these three: packs hidden, enabled=false)
                                   // | unverified_mode | no_provider | closed (packs shown, not buyable)
  "unavailable_message": null,     // human text for the reason
  "providers": [{"id": "khalti", "name": "Khalti", "sandbox": true}, {"id": "esewa", "name": "eSewa", "sandbox": true}],
  "currency": "NPR",
  "price_per_vote": "4.00",        // null when only packs are sold
  "custom_votes": true,            // allow "buy N votes" at price_per_vote
  "max_custom_votes": 1000,
  "max_packs_per_day": 5,          // 0 = no limit
  "buy_and_vote": false,
  "packs": [{"id": "uuid", "label": "Fan pack", "votes": 50, "bonus_votes": 5, "total_votes": 55,
             "price": "450.00", "currency": "NPR", "khalti_ok": true}]
}
```
Buy: `POST /api/voting/public/<event>/contests/<contest>/buy/` with
`{"pack": "<uuid>" | "votes": 10, "provider": "khalti"|"esewa", "voter_token": "…" (SMS/email code contests; or
"ticket_code", or a signed-in JWT for account/ticket contests), "device_id": "…", "contestant": "<id|number|slug>"?,
"return_url": "https://…"?, "payer_name"?, "payer_phone"?, "payer_email"?, "captcha_token"?}` →
`201 {"purchase": {...}, "payment": {...public intent}, "checkout": {"redirect_url"} | {"form_action","method","fields"}}`.
Open `checkout.redirect_url` (Khalti) or POST the eSewa form in a browser tab; afterwards poll
`GET /api/payments/intents/<payment.id>/` until `status` is `paid` and `fulfilled` (or `failed` / `cancelled` /
`expired`); `result` = `{"type": "vote_pack", "purchase": {"id","status","label","pack_id","votes","bonus_votes",
"total_votes","amount","currency","contestant","auto_vote","auto_voted","auto_vote_note"}, "contest": {...},
"credited": true, "credits": 55}`. The voter's balance is also in `POST …/allowance/` (`credits`).
Errors: 401 `verification_required` / `sign_in_required`; 403 `module_disabled` (`module: "paid_votes"`) or
`payments_unavailable` (+ `reason`); 409 `not_eligible` / `closed`; 429 `pack_limit`; 400 `provider_unavailable`
(e.g. Khalti under Rs 10), `captcha_required`, `pack_not_found`.

**Python extension points** (`apps/voting/credits.py`, `apps/voting/vote_payments.py`): `grant_pack(pack, voter_hash,
payment_ref)`, `grant_credits(...)`, `voter_hash_for(contest, phone=|email=|user=|ticket=)`, `credit_balance()`,
`remove_unspent()`, `start_purchase()`, purpose handlers `on_paid / on_failed / on_refunded / describe`, registered in
`VotingConfig.ready()`.

---

## 8. Anti-fraud & audit

- Hard limits: votes per minute per IP and per device (configurable, 0 = off). Quick polls keep the 20/min per-IP
  `VoteThrottle`; contests skip it and use their own limits (big venues share one Wi-Fi).
- Flags (`ip_burst`, `subnet_burst`, `shared_device`) are visible in Dashboard → Votes & fraud, grouped by hashed IP /
  device. Organizer voids by vote ids, IP hash, device hash or flag **with a reason** (`POST …/votes/void/`), or
  restores (`undo: true`). Every void/restore, advancement, unlock, preset and conflict change is in `ContestAuditLog`.
- IPs, subnets, devices and phone numbers are never stored raw (HMAC with `SECRET_KEY`).
- Exports (CSV with a UTF-8 BOM so Excel opens Nepali text): every vote (hashed voter / IP / device refs, time in
  Nepal time, contestant, category, round, quantity, source, method, flags, void + reason), judges' scores per round,
  results per round and category.
- Optional public transparency note on the contest page.

---

## 9. API

Organizer (owner or superadmin; `IsOrganizer`), prefix `/api/voting/contests/`:

| Method & path | Purpose |
|---|---|
| `GET /` `?event=` · `POST /` `{event, title, preset}` | list · create from a preset |
| `GET /presets/` | presets |
| `GET/PATCH/DELETE /<id>/` | full config; PATCH accepts settings + nested `rounds[].criteria[]`, `categories[]` (`round_ref`/`criterion_ref` by id or name, `nominees`, `winner`), `profile_fields[]`, `vote_packs[]` (replace-by-id) |
| `POST /<id>/preset/` `{preset}` | re-apply a preset (only before votes/scores) |
| `POST /<id>/status/open/` · `/status/close/` | open / close the contest |
| `GET/POST /<id>/contestants/` · `PATCH/DELETE /<id>/contestants/<cid>/` | contestants (delete refused with votes: withdraw instead) |
| `POST /<id>/contestants/bulk/` `{contestants: […]}` · `/import/` `{csv}` · `/reorder/` `{ids, renumber}` | bulk add (all-or-nothing), CSV import (header row; name/number/subtitle/bio/photo + profile field keys or labels), reorder + renumber |
| `POST /<id>/rounds/<rid>/open/` · `/close/` · `/decide/` · `/undo/` · `/entries/` | round actions |
| `GET /<id>/results/` `?round=` `?category=` | breakdown (per-judge detail, criteria averages) |
| `GET /<id>/dashboard/` | totals, hourly (48 h, Nepal time), daily, per contestant / round / category, judges' progress |
| `GET/POST /<id>/judges/` · `PATCH/DELETE /<id>/judges/<jid>/` | invite (temp password for new accounts), name, active, `excluded_contestants`, `reset_password` |
| `GET /<id>/sheets/` `?round=` · `POST /<id>/sheets/<sid>/unlock/` | all score sheets · unlock |
| `GET /<id>/flags/` `?all=1` `?void=1` · `POST /<id>/votes/void/` | fraud review · void / restore |
| `GET /<id>/audit/` · `POST /<id>/credits/grant/` · `GET /<id>/export/?kind=votes\|scores\|results\|purchases` | audit log · bonus votes · CSV (votes include source + payment ref) |
| `GET /<id>/purchases/` `?status=` | vote-pack purchases + paid summary (revenue, per pack, per contestant) |

Judges (signed in, own assignment only): `GET /api/voting/judge/` · `GET /api/voting/judge/<jid>/?round=` ·
`PUT /api/voting/judge/<jid>/` `{round, contestant, scores, comment, submit}`.

Public (tenant-scoped like every public endpoint; draft contests are 404), prefix
`/api/voting/public/<event slug>/contests/<contest slug or id>/`: `GET` contest · `GET c/<number|slug|id>/`
contestant (+ prev/next) · `POST vote/` · `POST allowance/` · `POST otp/send/` `{destination, captcha_token?}` ·
`POST otp/verify/` `{destination, code}` · `POST buy/` (§7). Also `GET /api/voting/og/<event>/<contest>/[c/<ref>/]`. The old
`/api/voting/public/<slug>/` lists contests too (`kind: "contest"`), `/public/<slug>/<uuid>/` returns contest data for a
contest id, and `/public/<slug>/<uuid>/vote/` forwards to the contest vote.

---

## 10. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SMS_PROVIDER` | `aakash` if `AAKASH_SMS_TOKEN` is set, else `console` | `aakash` / `sparrow` / `console` |
| `AAKASH_SMS_TOKEN` | — | Aakash SMS v3 auth token |
| `SPARROW_SMS_TOKEN`, `SPARROW_SMS_FROM` | — | Sparrow SMS (optional) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | — | Cloudflare Turnstile; CAPTCHA stays off when unset |

Read from Django settings if defined there, else from the environment (`sms.env()`), so no `settings.py` change is
needed. Email codes use the existing `EMAIL_*` settings.

---

## 11. Not done yet / later

- Mobile app (`scanner_app/`): contests, every verification method, vote packs (packs and "any number" at
  `price_per_vote`), results and App Links are in the app (`lib/attendee/screens/contest_*.dart`, `vote_sheet.dart`,
  `vote_packs.dart`).
- SMS codes have no separate module (they are part of `contests`).
- Automatic refunds (the payments module records refunds; money goes back by hand).
- Server-generated share-card image for `og:image` (the preview uses the contestant photo; the designed card is
  downloaded from the browser).
- Rate limits and OTP limits are database-based (work across Gunicorn workers); a Redis cache would make them cheaper
  at very high volume.
