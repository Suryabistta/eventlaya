# Vendor availability slots & booking requests — API

Part of the **marketplace** module (superadmin switch). Backend: `backend/apps/marketplace/{booking.py,slot_views.py,notifications.py,test_slots.py}`.
Time zone: Asia/Kathmandu. Dates `YYYY-MM-DD`, times `HH:MM`.

## Model: `AvailabilitySlot`
| field | notes |
|---|---|
| `venue` / `vendor` | exactly one (a venue listing or a service vendor profile) |
| `space` | optional, venues only (a hall/lawn of that venue) |
| `date`, `start_time`, `end_time` | both times null = **full day**; otherwise end > start (no overnight) |
| `price` | optional; `effective_price` falls back to space → venue `price_per_day` → vendor `starting_price` |
| `note` | ≤ 255 chars |
| `status` | `open` · `held` (a pending request) · `booked` · `blocked` |

Overlaps on the same listing + date are rejected (`code: slot_overlap`). Back-to-back slots are fine; a full-day slot
clashes with everything that day; a whole-venue slot clashes with every space; different spaces never clash.

## Request ↔ slot status
| inquiry status | slot status |
|---|---|
| `pending`, `contacted` | `held` |
| `booked` | `booked` |
| `rejected`, `cancelled` (new: cancelled by customer) | `open` |

One active request per slot; double booking is prevented with row locks (`409 slot_unavailable`).

## Owner (vendor / venue owner; JWT with marketplace access)
| method & path | body / query | notes |
|---|---|---|
| `GET /api/marketplace/my/slots/` | `venue` or `vendor`, `space`, `from`, `to`, `status=open,held` | default today→+60d, max 370d; held/booked slots include `request` (customer details) |
| `POST /api/marketplace/my/slots/` | `{venue\|vendor, space?, date, start_time?, end_time?, price?, note?, status?: open\|blocked}` | 201 slot |
| `PATCH /api/marketplace/my/slots/<id>/` | `date, start_time, end_time, price, note, status (open\|blocked)` | held/booked → only `note` (else `409 slot_locked`) |
| `DELETE /api/marketplace/my/slots/<id>/` | | 204, or `409 slot_locked` |
| `POST /api/marketplace/my/slots/bulk/` | `{venue\|vendor, space?, start_date, end_date, weekdays?, start_time?, end_time?, price?, note?}` | **weekdays: 0 = Monday … 6 = Sunday** (convert from JS `getDay()`); ≤ 370 days, ≤ 500 slots; overlaps skipped → `{created, skipped, skipped_dates, slots}` |
| `POST /api/marketplace/my/slots/block/` | `{venue\|vendor, space?, dates:[…], note?}` | creates full-day blocked slots or blocks open ones → `{created, blocked, skipped:[{date, slot_id, reason}], slots}`; unblock = PATCH `status: open` or DELETE |
| `POST /api/marketplace/my/inquiries/<id>/confirm/` · `/decline/` | `{note?}` → `owner_note` | venue requests; `409 request_cancelled` / `slot_unavailable` |
| `POST /api/marketplace/my/vendor-inquiries/<id>/confirm/` · `/decline/` | `{note?}` | vendor requests |
| `PATCH /api/marketplace/my/inquiries/<id>/` (and vendor-inquiries) | `{status}` | keeps the slot in step; list filter `?has_slot=1` |

Slot object: `{id, kind, venue, vendor, listing_name, space, space_name, date, start_time, end_time, is_full_day, price,
effective_price, note, status, request|null, created_at, updated_at}`.

## Public (no auth; approved listings only — paused listings: see below)
`GET /api/marketplace/venues/<id>/availability/?from&to&space&include_unavailable=1`
`GET /api/marketplace/vendors/<id>/availability/?from&to&include_unavailable=1`
→ `{from, to, count, results:[{id, date, start_time, end_time, is_full_day, space, space_name, price, note, status, available}]}`.
Default: open, not-yet-started slots, today→+60d (max 180d). `include_unavailable=1` adds held/booked/blocked
(price null, no note) for a calendar. Never contains customer data.

## Customer
- **Book a slot:** `POST /api/marketplace/venues/<id>/inquiries/` or `/vendors/<id>/inquiries/` with
  `{slot_id, message, guest_count?, event_type?, budget_range?, sender_name/email/phone (guests)}` — date and space come from the slot.
  201 → inquiry with `slot.status: "held"`. `409 slot_unavailable` if someone got it first; `400 {slot_id:[…]}` for invalid slots
  (other listing, started, own listing, inactive space). Without `slot_id` the old inquiry flow is unchanged.
- **My requests:** `GET /api/me/inquiries/` items include `slot`, `owner_note`, `can_cancel`, `updated_at`.
- **Cancel:** `POST /api/me/inquiries/<venue|vendor>/<id>/cancel/` — while pending/contacted, or booked and the date is after today;
  `409 cannot_cancel` otherwise. The slot reopens.
- Inquiry `slot`: `{id, date, start_time, end_time, is_full_day, space_id, space_name, price, status}`.

## Pausing a listing (owner)
`VenueListing` and `VendorProfile` have `is_paused` (default `false`, migration `marketplace 0008_listing_is_paused`),
separate from the approval `listing_status`. The owner toggles it with the normal update endpoints:
`PATCH /api/marketplace/venues/<id>/` or `PATCH /api/marketplace/vendors/<id>/` with `{"is_paused": true|false}`
(owner or platform admin only; pausing/resuming alone never sends a "changes needed" listing back for review).
It is listed in `GET /api/marketplace/my/listings/` and on every listing object.

While paused:
- hidden from the public directory lists (`GET venues/` without `slug`/`my_venues`, `GET vendors/` without `mine`,
  search, category `vendors_count`); the owner still sees it in `my/listings`, `?my_venues=1`, `?mine=1`;
- the detail (`venues/<id>/`, `venues/?slug=`, `vendors/<id>/`) still loads with `is_paused: true`, so the page can say
  it isn't taking requests;
- public availability returns no slots: `{from, to, count: 0, paused: true, results: []}`;
- new inquiries and slot bookings (`POST venues/<id>/inquiries/`, `vendors/<id>/inquiries/`, with or without
  `slot_id`, guests too) → `409 {"code": "listing_paused"}`;
- existing requests, bookings and slots keep working: the owner can confirm/decline, manage slots; customers can cancel.

Paused **spaces** (`VenueSpace.is_active = false`, toggled per space) are a separate, narrower switch.
Everything here is part of the `marketplace` module (403 `module_disabled` when it is off).

## Notifications (after commit; failures never break the request)
- New slot booking → owner (email + push `booking_request`).
- Confirmed / declined → customer (email + push `booking_confirmed` / `booking_declined`) — also for plain inquiries.
- Customer cancels → owner (email + push `booking_cancelled`).
- Push data: `{type, kind, inquiry_id, slot_id}`.
