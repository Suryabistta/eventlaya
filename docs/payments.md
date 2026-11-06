# Online payments (Khalti + eSewa)

_Last updated: 2026-10-28 (/mine/ endpoint)_

Module `payments` ("Online payments"). Backend `backend/apps/payments/`, first user: online ticket payment
(`backend/apps/events/online_payments.py`). Web: `frontend/src/lib/payments.ts`, `frontend/src/components/payments.tsx`,
`frontend/src/pages/payments/`, `frontend/src/pages/admin/PaymentsAdminPage.tsx`.

Not to be confused with `apps.platform.models.Payment`: that is a subscription payment an admin types in by hand.

## 1. How it works

```
buyer ── Review: "Pay with Khalti" ──► POST /api/forms/events/<slug>/register/ {payment_method:"online", provider, return_url}
                                         │ order created, tickets RESERVED (hold stock + capacity for N minutes)
                                         │ PaymentIntent created, checkout started
        ◄── {payment_required, checkout:{redirect_url}} or {checkout:{form_action, fields}} (eSewa signed form)
buyer ── pays on Khalti / eSewa ──► provider redirects the browser to OUR API:
          /api/payments/return/khalti/<intent>/?pidx=…          (Khalti return_url)
          /api/payments/return/esewa/<intent>/success/?data=…   (eSewa success_url, base64 signed JSON)
          /api/payments/return/esewa/<intent>/failure/          (eSewa failure_url)
        API looks the payment up server to server (Khalti lookup / eSewa status API), checks ids + amount,
        settles it, then 302 → <return_url>?payment=<intent>&status=paid|pending|cancelled|failed|expired
web app ── polls GET /api/payments/intents/<id>/ until settled ──► shows the passes (or "Try again")
```

- **Never trusts the browser.** The `status=Completed` in a Khalti return, or a signed eSewa `data`, only triggers a
  lookup. Khalti: `POST {KHALTI_BASE_URL}epayment/lookup/`. eSewa: `GET {ESEWA_STATUS_URL}?product_code&total_amount&transaction_uuid`.
  The eSewa `data` signature is still verified and mismatches (bad signature, other uuid, other amount) are logged as `tamper`.
- **Amount check.** A "paid" lookup whose amount differs from the intent is refused (logged `tamper`, intent stays open).
- **Exactly once.** `services.mark_paid()` locks the intent row (`select_for_update`), flips it to `paid` once, then runs the
  purpose's `on_paid` inside the same transaction (savepoint) and sets `fulfilled_at`. A second return, a status poll and the cron
  all go through the same lock and do nothing. If `on_paid` raises, the intent stays `paid` + unfulfilled and is retried by the
  next poll / the cron.
- **Holds and expiry.** Unpaid online orders hold tickets for `PaymentSettings.reservation_minutes` (default 15, superadmin
  setting). Released: on cancel/failure returns, lazily on the next registration / event page view (2 min grace), and by the
  cron `manage.py expire_payments` (asks the provider first). Released tickets become `cancelled`, the order `failed`; they no
  longer count as sold and are refused at the gate.
- **Late payments.** Khalti links live 60 minutes, longer than the hold. The cron re-checks intents that expired in the last 3 h.
  A payment that arrives after the hold takes the tickets back if there is still room; otherwise the order is marked paid with
  `needs_attention` ("refund the buyer") and shows up on the organizer's Payments page and the superadmin "Needs attention" list.
- **Gate.** `reserved` tickets → scan result `unpaid` ("Online payment not completed"); released ones → `unpaid` ("…was released");
  refunded → `cancelled`. Older scanner apps get `status: "cancelled"`, so they show "denied". Pay-at-venue scans say "Collect Rs X".
- **Free orders** never pay. Promo codes are applied before the amount is fixed.
- **Test provider** (`test`): a local page with Pay / Fail / Cancel buttons. Only exists when `PAYMENTS_TEST_PROVIDER=1`
  (default on with `DEBUG=1`, off otherwise); the page 404s when it's off.

## 2. Money flow (be honest with organizers)

- The **platform collects** all online payments with **Eventlaya's own** Khalti and eSewa merchant accounts.
- The **organizer is paid out by hand** (bank transfer / wallet). The superadmin records each payout
  (`Payout`: organizer, optional event, amount, method, reference, date) on **Superadmin → Online payments**.
- Each paid intent stores a snapshot of the **platform fee** (`PaymentSettings.platform_fee_percent`, default 0%, superadmin
  setting) → `platform_fee`, `net_amount`. Reports: collected, fee, net, paid out, **owed** — per event and per organizer.
  Nothing is deducted automatically.
- Khalti may also charge the **buyer** a service charge on top (the sandbox merchant shows Rs 5.65 on Rs 1,000); that's
  between Khalti and the merchant account and isn't part of our amount.
- **Refunds are manual.** Return the money from the Khalti / eSewa merchant dashboard (or from the next payout), then
  "Mark refunded" with a note (organizer Payments page, or `POST /api/payments/intents/<id>/refund/`). That records the
  refund (status + audit log) and cancels the order's passes. Cash taken at the venue is refunded by the organizer.
- Organizers see this in the UI: a note on Tickets → Payment options and on the Payments page.

## 3. Data model

`apps/payments/models.py`
- `PaymentIntent` — UUID id, `purpose`, `reference` (the purpose's object id), `description`, `status`
  (created / pending / paid / failed / cancelled / expired / refunded), `amount` (NPR, 2 dp), `provider` (khalti / esewa / test),
  `provider_ref` (Khalti `pidx` / eSewa `transaction_uuid`), `provider_txn_id` (Khalti `transaction_id` / eSewa `ref_id`),
  `provider_fee`, `checkout` (re-used on reload), payer name/email/phone, `user`, `organizer` (gets the money), `event`
  (reports), `metadata`, `return_url`, `platform_fee_percent`, `platform_fee`, `failure_reason`, `refund_note`, timestamps
  (`created_at`, `updated_at`, `expires_at`, `paid_at`, `refunded_at`, `last_checked_at`, `fulfilled_at`).
- `PaymentLog` — audit trail per intent: created, checkout, return, verify (with the provider's raw response), paid, failed,
  cancelled, expired, refunded, fulfilled, tamper, late_payment, *_error. Keys / signatures are masked before saving.
- `PaymentSettings` (one row) — `platform_fee_percent`, `reservation_minutes`.
- `Payout` — manual payouts to organizers.

Tickets (`apps/events`, migration `events 0014_online_payments`):
- `Event.payment_mode` (`venue` / `online` / `both`), `Event.online_providers` (`[]` = all available).
- `TicketType.online_only`.
- `EventTicket.status` gains `reserved`. `Event.registered_count` counts reserved tickets (they hold the spot).
- `TicketOrder.payment_method` (venue / online / free), `payment_status` (free / due / pending / paid / failed / refunded),
  `paid_via` (khalti / esewa / test / venue), `paid_amount`, `paid_at`, `payment_reference`, `payment_intent`,
  `reserved_until`, `needs_attention`, `refunded_at`, `payment_notes` (audit lines), `payment_label` / `payment_info()`.
  Existing orders were backfilled: total 0 → free, else venue/due.

Migrations: `payments 0001_initial`, `payments 0002_payments_module` (module row: on for superadmin, organizer, attendee),
`events 0014_online_payments`.

## 4. API

Public (no sign-in; the intent UUID is the secret):
| | |
|---|---|
| `GET /api/payments/providers/` | `{enabled, providers:[{id,name,sandbox}]}` |
| `GET /api/payments/intents/<id>/` | status for polling; re-checks open intents with the provider (≤ every 4 s); `result` = the purpose's `describe()` (ticket orders: order + passes once paid) |
| `POST /api/payments/intents/<id>/checkout/ {provider}` | start / resume a checkout → `{payment, checkout}` |
| `GET /api/payments/return/khalti/<id>/` · `GET /api/payments/return/esewa/<id>/success/` · `…/failure/` · `GET /api/payments/return/test/<id>/` | provider returns → verify → 302 to the web app |
| `GET/POST /api/payments/test/<id>/` | test provider page (DEBUG / `PAYMENTS_TEST_PROVIDER=1` only) |

Signed in (the payer's own history, every device):
| | |
|---|---|
| `GET /api/payments/mine/?limit=&offset=` | the user's payments, newest first: intents with `user` = them, plus — when their email is verified — ones paid signed out with that `payer_email`. Abandoned checkouts (`created`) are left out. Row: `id, purpose, purpose_label, description, status, amount, currency, provider, provider_name, provider_txn_id, event{title,slug}, created_at, paid_at, expires_at, refunded, refunded_at, fulfilled, failure_reason, summary` (`summary`: ticket orders `{type, order_reference, ticket_count, tickets_issued, needs_attention}`, vote packs `{type, votes, label, credited, auto_voted, contestant, contest{title,slug,event_slug}}`). Never other people's data, payer contact details or provider responses. Anonymous → 401; `payments` module off → 403 `module_disabled`. Web: `/app/my/payments`; app: Profile → My payments (merged with the phone's own history). |

Intents record the payer as `user` whenever they're signed in: vote packs always did; ticket orders now use the signed-in
buyer even when the tickets are for another email (the order's own `user` stays the ticket owner).

Registration (`POST /api/forms/events/<slug>/register/`) takes `payment_method` (`venue` / `online`, default venue),
`provider` and `return_url` (must be one of our hosts: platform hosts or a claimed white-label domain). Online answers
`201 {payment_required:true, order, payment, checkout}` with no passes. Every ticket payload now has `payment`
(`{method,status,provider,reference,amount,paid_at,reserved_until,label}`), `label` like "Paid online · Khalti · ref …" or
"Pay Rs 500 at the venue". The public event detail has `payment_options` `{mode, online, venue, providers, hold_minutes}` and
ticket types have `online_only`.

Organizer:
| | |
|---|---|
| `GET/PUT /api/payments/events/<event>/settings/` | `{payment_mode, online_providers}` (+ effective options, platform fee) |
| `GET /api/events/<event>/orders/?status=&method=&provider=&search=&from=&to=&attention=1&export=csv` | orders with payment status, totals (online collected / venue collected / venue due / refunded / pending / released). Released checkouts are hidden unless `status=failed`. Works with the module off (venue payments). |
| `POST /api/events/<event>/orders/<order>/mark-paid/` · `mark-unpaid/` · `refund/ {note}` | mark paid at the venue / undo / record a refund (cancels passes) |
| `GET /api/payments/organizer/payments/?event=&status=&provider=&purpose=&from=&to=&search=&export=csv` | the organizer's online payments (any purpose) |
| `GET /api/payments/organizer/summary/` | collected / fee / net / paid out / owed, per event, payouts |
| `POST /api/payments/intents/<id>/refund/ {note}` | record a refund on any purpose |

Superadmin: `GET /api/payments/admin/overview/`, `GET /api/payments/admin/payments/` (+ `&organizer=`, `export=csv`),
`GET/POST /api/payments/admin/payments/<id>/` (detail with log / re-check with the provider), `GET/PUT /api/payments/admin/settings/`,
`GET/POST /api/payments/admin/payouts/`, `DELETE /api/payments/admin/payouts/<id>/`.

CSV uses `?export=csv` (DRF reserves `?format=`).

Module: `payments` in `apps/accounts/modules.py`, `PATH_MODULES` maps `/api/payments/`. Off → 403 `module_disabled`,
`payment_options.online=false`, registration falls back to pay at the venue (even for "online only" events; online-only
ticket types then can't be bought). **Exception:** `/api/payments/return/…`, `/api/payments/test/…` and
`GET /api/payments/intents/<id>/` stay reachable so money already taken still settles. The organizer's role must also have the
module for their events to offer online payment. Web: Payments in the sidebar (organizer: orders, always), Superadmin → Online payments.

## 5. Using it from another app (e.g. paid votes in contests)

```python
# apps/voting/apps.py
class VotingConfig(AppConfig):
    def ready(self):
        from . import vote_payments  # noqa: F401  registers 'vote_pack'

# apps/voting/vote_payments.py
from django.db import transaction
from apps.payments.registry import register_purpose
from apps.payments import services as pay

def grant_votes(intent):
    """Runs exactly once per intent, inside the transaction holding the intent's row lock.
    May run after the intent expired (late payment): handle that. Raise to have it retried later."""
    pack = VotePack.objects.select_for_update().get(pk=intent.reference)
    if pack.status == 'paid':
        return
    pack.status = 'paid'
    pack.save()
    VoteCredit.objects.create(...)                      # what was bought
    transaction.on_commit(lambda: send_receipt(pack))   # emails after commit

def release_pack(intent):          # optional: cancelled / failed / expired (runs once)
    VotePack.objects.filter(pk=intent.reference, status='pending').update(status='failed')

def refunded(intent):              # optional: someone recorded a refund
    ...

def describe(intent):              # optional: extra data for GET /api/payments/intents/<id>/ (payer-visible!)
    pack = VotePack.objects.get(pk=intent.reference)
    return {'type': 'vote_pack', 'votes': pack.votes, 'contest': pack.contest.slug}

register_purpose('vote_pack', on_paid=grant_votes, on_failed=release_pack, on_refunded=refunded,
                 describe=describe, label='Vote pack')

# In the view that sells a pack (check module_enabled('payments', request.user) first):
intent = pay.create_intent(
    purpose='vote_pack', amount=pack.price, reference=str(pack.id),
    description=f'{pack.votes} votes · {contest.title}',
    payer_name=name, payer_email=email, payer_phone=phone, user=request.user,
    organizer=contest.event.organizer, event=contest.event,       # who gets the money; reports
    metadata={'contest': str(contest.id)},
    return_url=pay.safe_return_url(request.data.get('return_url')) or f'{FRONTEND}/e/{slug}/vote',
)                                                                # expires_at defaults to now + hold minutes
try:
    checkout = pay.start_checkout(intent, request.data['provider'], request)   # 'khalti' | 'esewa' | 'test'
except pay.PaymentError as e:
    return Response({'error': e.message}, status=e.code)
return Response({'payment': pay.public_intent(intent), 'checkout': checkout})
```

Web: `goToCheckout(checkout)` from `@/lib/payments` (redirect or auto-submitted eSewa form). The provider brings the buyer
back to `return_url?payment=<id>&status=…`; render `<PaymentReturn paymentId=… onPaid=… onRetry=…/>` from
`@/components/payments` (it polls `GET /api/payments/intents/<id>/`), or poll `paymentsApi.intent(id)` yourself.
`<PaymentChoice>` renders the Khalti / eSewa / venue picker. Validate amounts server-side (Khalti needs ≥ Rs 10:
`pay.check_provider(provider, amount)`).

### Purposes in use

| Purpose | App | reference | Notes |
|---|---|---|---|
| `ticket_order` | `apps/events/online_payments.py` | order id | holds tickets while paying |
| `vote_pack` | `apps/voting/vote_payments.py` | `VotePurchase` id | credits votes to the verified voter on `on_paid`; `on_refunded` removes the unused ones; `describe` → `{type:"vote_pack", purchase, contest, credited, credits}`. Buy endpoint `POST /api/voting/public/<event>/contests/<contest>/buy/`. Also needs the `paid_votes` module. See `docs/voting.md` §7 |

Notes for new purposes: Khalti refuses `customer_info` that has a phone/email but no `name` (HTTP 400
`customer_info.name: This field is required`) — always pass a `payer_name` when you pass a phone or email (vote packs
default it to "Voter"). The organizer Payments page's "Online payments, all events" summary and CSV include every purpose.

## 6. Configuration (environment only)

| Variable | Default with `DEBUG=1` | Default with `DEBUG=0` |
|---|---|---|
| `PAYMENTS_ENABLED_PROVIDERS` | `khalti,esewa` | `khalti,esewa` |
| `KHALTI_SECRET_KEY` | Khalti docs' public sandbox example key | **empty → Khalti not offered** |
| `KHALTI_BASE_URL` | `https://dev.khalti.com/api/v2/` | `https://khalti.com/api/v2/` |
| `ESEWA_PRODUCT_CODE` | `EPAYTEST` | **empty → eSewa not offered** |
| `ESEWA_SECRET_KEY` | `8gBm/:&EnhH.1/q` (eSewa's published UAT key) | **empty → eSewa not offered** |
| `ESEWA_FORM_URL` | `https://rc-epay.esewa.com.np/api/epay/main/v2/form` | `https://epay.esewa.com.np/api/epay/main/v2/form` |
| `ESEWA_STATUS_URL` | `https://rc.esewa.com.np/api/epay/transaction/status/` | `https://esewa.com.np/api/epay/transaction/status/` |
| `PAYMENTS_TEST_PROVIDER` | `1` | `0` (never turn on in production) |
| `PAYMENTS_CALLBACK_BASE_URL` | request host | request host — set to `https://api.eventlaya.com` in production |

Superadmin → Online payments shows each provider as Live / Sandbox / "Keys missing: not offered".

Cron (production): `*/2 * * * * cd /srv/eventlaya/backend && .venv/bin/python manage.py expire_payments`
(without it, holds are still released lazily, but late payments are only caught when someone opens the payment).

## 7. Sandbox test credentials (public, from the providers' docs)

- **Khalti** (test-pay.khalti.com): Khalti ID `9800000000`–`9800000005`, MPIN `1111`, OTP `987654`.
  (On 2026-10-28 `9800000000` was MPIN-locked; `9800000001` worked.) Merchant test keys: sign up at
  https://test-admin.khalti.com (login OTP `987654`) and copy `live_secret_key`.
- **eSewa** (rc-epay.esewa.com.np): eSewa ID `9806800001`–`9806800005` (older docs: `9711111111`), password `Nepal@123`,
  MPIN `1122`, token `123456`; merchant `EPAYTEST`, secret `8gBm/:&EnhH.1/q`. The sandbox login has a reCAPTCHA.

## 8. Going live — what the owner must do

1. **Khalti merchant account** (https://admin.khalti.com, "Join as merchant"): registered business (company registration /
   PAN-VAT certificate, owner citizenship, bank account details in the business name, website URL). After KYC approval copy the
   **live secret key** → `KHALTI_SECRET_KEY`, and leave `KHALTI_BASE_URL` at `https://khalti.com/api/v2/`. Decide who pays
   Khalti's service charge (merchant setting). Payment links expire after 60 minutes.
2. **eSewa merchant account** (contact eSewa merchant onboarding; https://merchant.esewa.com.np after approval): same business
   documents. They issue the live **product code (merchant code)** and **secret key** after successful test transactions →
   `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY` (form/status URLs default to production with `DEBUG=0`).
3. **Return URLs to give / whitelist** (if asked): `https://api.eventlaya.com/api/payments/return/khalti/…`,
   `https://api.eventlaya.com/api/payments/return/esewa/…/success/` and `…/failure/` — set
   `PAYMENTS_CALLBACK_BASE_URL=https://api.eventlaya.com`. Website URL: `https://eventlaya.com`.
4. Add the `expire_payments` cron, deploy (migrations above), then make one small real payment with each provider and refund it
   from the merchant dashboard.
5. Set the platform fee and hold time on Superadmin → Online payments; tell organizers how and when payouts happen (terms of
   service / organizer agreement should say Eventlaya collects on their behalf and pays out — have the lawyer check this, and
   check with the accountant how collected-on-behalf money and the fee are invoiced / taxed).
6. Organizers turn it on per event: Tickets → Payment options.

## 9. Verified / not verified (2026-10-28)

- **Real sandbox:** Khalti initiate + payment with a test wallet (9800000001 / 1111 / 987654) + return + lookup `Completed` →
  passes issued (end to end in headless Chrome). Khalti lookup states seen live: `Pending`, `Completed`, 404 `Not found`
  for another merchant's pidx. eSewa: our signed form is accepted (login page shows NPR 1,000.00; a wrong signature gets
  `ES104 Invalid payload signature`); cancel on eSewa → failure URL → status API `NOT_FOUND` → order released (end to end).
  eSewa *successful* payment could not be automated (reCAPTCHA on the sandbox login); the success path is covered by
  tests with a correctly signed response + mocked status API.
- **Mocked in tests:** every Khalti lookup state (Completed, Pending, Initiated, Refunded, Partially Refunded, Expired,
  User canceled), errors, eSewa signature + response decode + all status values, tampering, idempotency, expiry, late payments.
- Note: the signature printed in eSewa's docs example (`4Ov7…`) doesn't match their current UAT key; ours matches what the
  live sandbox accepts.

## 10. Not done yet

- No automatic refunds (Khalti/eSewa refund APIs aren't used); no automatic payouts.
- Mobile app (Flutter): online checkout for tickets and vote packs runs in an in-app web view (eSewa's signed form is
  POSTed there); the app catches the `?payment=<id>&status=` return and polls the intent. The gate scanner shows unpaid
  online orders as "Not paid" and pay-at-venue tickets with "Collect Rs X".
- Organizers can't see the Khalti/eSewa service charge or settlement dates (only the merchant dashboard has them).
- No webhook: Khalti ePayment v2 and eSewa ePay v2 have none; the return + poll + cron cover it.
