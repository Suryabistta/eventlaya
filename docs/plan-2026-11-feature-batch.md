# Feature batch plan — November 2026

Status: **phases 1–6 and section E built (uncommitted, not deployed).** Covers 19 requested items, grouped by area.
Each item lists what exists today, the change (backend / web / mobile), and
acceptance criteria.

Ground rules that apply to every item:

- New user-facing features are platform modules the superadmin can switch off,
  enforced in the API, not just hidden in the UI (`apps/accounts/modules.py`).
- Every model change gets a migration and tests next to the existing ones
  (`apps/*/test_*.py`).
- Web (`frontend/`) and the Flutter app (`scanner_app/`) both show tickets and
  marketplace, so ticket/marketplace changes are done in both.

---

## A. Events & registration

### A1. Sub registration forms under a main event
**Today:** `Event.registration_form` is a single FK to `dynamic_forms.Form`. One
event = one form. Ticket types (`TicketType`) already exist.

**Decided:** sub-events — a festival (main event) with child events (e.g.
"Film screening", "Workshop"). Each sub-event has its own registration that
the organizer can enable or disable (existing `allow_registration` flag), its
own form, capacity and tickets. Behind the **Sub-events** module.

- Backend: `Event.parent = FK('self', null=True, related_name='sub_events')`.
  Sub-events inherit organizer, branding and payment settings; have their own
  `registration_form`, capacity, dates, ticket types. Gate scanning of a sub-event
  ticket is checked against the sub-event. Analytics roll up to the parent.
- API: `GET /events/<slug>/` includes `sub_events[]`; create sub-event via
  `POST /events/` with `parent`. Only one level deep (no grandchildren).
- Web: event editor gets a "Sub-events" tab; public event page lists sub-events
  as cards with their own "Register" button.
- Mobile: attendee app shows sub-events under the parent.

**Done when:** an organizer creates a main event with 2 sub-events, each with a
different form; an attendee registers for one; the pass shows both names
("Dharan Film Festival › Workshop"); scanning works per sub-event.

### A2. "Managed by" next to organization name (toggle)
**Today:** public pages show `organizer_name` (from `User.organization_name`).

- Backend: `Event.managed_by = CharField(blank=True)`, `Event.show_managed_by =
  BooleanField(default=False)`. Serializer only returns `managed_by` when enabled.
- Web: event form field + switch; public event page and event cards show
  "Organized by **X** · Managed by **Y**".
- Mobile: same line on event detail.

**Decided:** plain text plus a logo. Add `Event.managed_by_logo`
(uploaded via `apps/core/uploads.py`); shown as a small logo before the name.

### A3. Marketplace: remove intro text, add small sliding banner
**Decided:** on the marketplace (vendors and venues tabs), remove the intro
text ("Halls, photographers, sound and stage, decoration and catering in
Dharan, Itahari, Biratnagar and beyond. Compare prices and ask about your date
directly.") and put a **small** sliding banner in its place. The `/events`
page is unchanged. Behind the **Banners** module.

- Remove the intro text; put a compact (about 160–220px tall) auto-sliding carousel in its place
  (swipe on mobile, arrows + dots on desktop, pauses on hover, respects
  reduced-motion).
- Backend: new `HomeBanner` model (image, title, optional link, order,
  is_active, start/end date), superadmin CRUD under `/platform/banners/`, public
  `GET /banners/`.
- Superadmin UI: new "Banners" page in the admin console.
- Fallback when no banners: the slider is not shown.
- Keep an `sr-only` `<h1>` so SEO is not hurt.

### A4. Cities and vendor categories as dropdowns (default "All cities")
**Today:** cities are a hard-coded `CITIES` list rendered as chips on both
`/events` and `/marketplace`; categories are chips too.

- Replace chips with `<select>` dropdowns, default "All cities" / "All
  categories".
- Data source becomes the DB (see B4 cities and B3 categories), not the
  hard-coded list.
- Selection kept in the URL query string so links are shareable.

### A5. Classic QR code for registration
A plain black-on-white QR that opens the public registration page, for posters
and banners.

- Web: in the organizer's event page, a "Registration QR" card: preview,
  download PNG (high-res, 1024px) and SVG, with event title under it. Uses
  the existing `qrcode.react` dependency.
- URL encoded: event's public URL on the organizer's white-label domain if they
  have one, else `eventlaya.com/e/<slug>`.
- No backend change.

### A6. Hide / show seat number publicly (admin setting)
**Today:** there is **no seat number** anywhere in the model.

- Backend: `EventTicket.seat_number = CharField(blank=True)`;
  `Event.show_seat_number = BooleanField(default=False)`. Organizer can
  assign seats (manually per ticket, or bulk CSV import).
  Public/attendee serializers drop `seat_number` when the flag is off; gate
  staff and organizer always see it.
- Web + mobile: seat shown on pass and in my-tickets only when enabled.

Manual + CSV assignment only in this batch (auto-assign not requested). Behind
the **Seat numbers** module.

---

## B. Tickets

### B1. Vertical or landscape ticket layout (default vertical)
**Today:** `DownloadPassButton.tsx` draws a fixed landscape 1200×600 canvas;
`TicketPassModal.tsx` shows the pass.

- Backend: `Event.ticket_layout = CharField(choices=['vertical','landscape'],
  default='vertical')`.
- Web: pass rendering and downloaded image support both layouts; vertical =
  phone-wallpaper shape (1080×1920) with QR in the middle.
- Mobile: same two layouts in the Flutter pass widget.
- Email pass (`apps/core/email.py`) follows the event setting.

### B2. Save and Print options (save to gallery)
- Web: "Save image" (PNG download — on Android/iOS browsers this lands in
  Downloads / Photos via the share sheet; use the Web Share API with the file
  where supported) and "Print" (print stylesheet showing only the pass).
- Mobile (Flutter): "Save to gallery" using `gal` (or `image_gallery_saver`)
  with the storage/photos permission; "Print / PDF" via the `printing`
  package.

**Done when:** on an Android phone the pass appears in the Gallery app, and on
desktop Print produces a single-page pass.

### B3. Verified tick
**Today:** `VendorProfile.is_verified` and `VenueListing.is_verified` exist;
organizations have no verified flag.

- Backend: `User.is_verified_org = BooleanField(default=False)`, settable only
  by superadmin.
- One shared `VerifiedBadge` component (blue tick + tooltip "Verified by
  Eventlaya") used on: organizer name on event pages and cards, vendor/venue
  cards and detail pages, profile header. Same widget in Flutter.

**Decided:** organizations, vendors and venues, each set by superadmin.

---

## C. Superadmin

### C1. Add a business / organization from superadmin
**Today:** superadmin can list, view, suspend and activate organizations
(`/platform/organizations/…`) but not create them.

- Backend: `POST /platform/organizations/` with name, email, phone, city,
  business type, plan, optional verified flag. Creates the user with an unusable
  password and emails a "set your password" link (reuse
  `apps/accounts/password_reset.py`).
- Web: "Add organization" button + form on `admin/OrganizationsPage.tsx`.
- Audit entry in the activity log.

### C2. Reset an organization's password
- Backend: `POST /platform/organizations/<id>/reset-password/` with two modes:
  (a) send a reset email (default), (b) set a temporary password that must be
  changed on next login (`User.must_change_password`). Revokes existing JWT
  sessions.
- Web: action on `admin/OrganizationDetailPage.tsx` with a confirm dialog;
  temp password shown once.
- Never show or log the old password; log who reset whom.

### C3. CRUD vendor categories
**Today:** `VendorCategory` (name, slug, icon) exists; only editable via Django
admin.

- Backend: `/platform/vendor-categories/` list/create/update/delete;
  add `order` and `is_active`. Delete is blocked when vendors use it — offer
  "deactivate" or "move vendors to…".
- Web: "Vendor categories" page in admin console.

### C4. CRUD cities
**Today:** city is free text on `User`, `VendorProfile`, `VenueListing`; the
filter list is hard-coded in the frontend.

- Backend: new `City` model (name, slug, province, order, is_active). Keep the
  existing `city` CharFields for now and add a data migration that creates
  City rows from the distinct values already stored; forms switch to a
  dropdown of active cities. Public `GET /cities/`.
- Web: "Cities" page in admin console; all city pickers and filters read from
  the API.

---

## D. Profiles & marketplace

### D1. Show the user profile logo
**Today:** `User.avatar` exists.

**Decided:** a normal profile logo for **users and vendors**. Users upload
it on their account page (`User.avatar`); vendors get `VendorProfile.logo`.
Shown in the top bar, profile page, event organizer line, chat, and on vendor
cards/detail pages, at its original aspect ratio in a rounded square;
initials when missing.

### D2. Vendor featured image + multiple photos with pop-up gallery
**Today:** `VendorProfile.portfolio_images` is a JSON list of URLs;
`VenueListing.images` likewise. No designated cover image.

- Backend: `VendorProfile.featured_image` (and `VenueListing.featured_image`),
  upload endpoint via `apps/core/uploads.py`; portfolio limit (e.g. 20 images,
  5 MB each, resized server-side).
- Vendor dashboard: drag-to-reorder upload grid, "set as featured" action,
  delete.
- Marketplace cards show the featured image (fallback: first portfolio image,
  then category placeholder).
- Detail page: photo grid; clicking opens a lightbox (full screen, swipe /
  arrow keys, close on Esc, counter "3 / 12").
- Mobile: same lightbox in Flutter.

### D3. Packages for vendors and venues
Behind the **Packages** module.

- Backend: new `ServicePackage` (vendor or venue FK, name, price, price unit
  [per event / per day / per plate / per hour], description, inclusions list,
  max guests, image, is_active, order). CRUD for the owner; public read.
- Quote / inquiry forms (`VendorInquiry`, `VenueInquiry`) get an optional
  `package` FK so the owner sees which package was asked about.
- Web: "Packages" tab in the vendor/venue dashboard; package cards on the
  public detail page with "Request this package".
- Mobile: package list on detail page.

### D4. BS (Bikram Sambat) calendar for availability
**Today:** `AvailabilitySlot` stores AD `date`; `AvailabilitySection.tsx` shows
an AD calendar.

- Storage stays AD (no data change). Conversion happens in the UI.
- Web: calendar toggle "BS / AD", default BS for Nepal users; month grid in BS
  with AD date in small text. Use a maintained AD↔BS conversion library
  (e.g. `nepali-date-converter`) — to be chosen after checking it covers
  2000–2100 BS.
- Also offered on date pickers in the inquiry forms and event form.
- Mobile: equivalent toggle using a Dart BS package (`nepali_utils`).
- User preference saved on the profile (`User.calendar_preference`).

---

## E. Printed tickets for physical sales — built

Module `offline_tickets`. Organizer → Printed tickets (`/app/printed-tickets`).

- **Decided:** blank tickets sold at shops, counters and the door; ready-made designs *and* own artwork;
  generated in bulk.
- A batch = where it's sold ("Bhatbhateni Dharan"), ticket type, quantity (up to 2,000), printed price,
  shape (landscape 3 per A4 / vertical 6 per A4) and design: Classic, Bold, Minimal (pick a colour) or own
  artwork with the QR placed by sliders. Live preview uses the same renderer as the PDF.
- Each ticket is a real `EventTicket` (`batch` set, numbers `PRT-<event>-<batch>-0001`), price 0 at the gate
  (paid at the point of sale). They count toward event capacity.
- Downloads: PDF (several per A4 with cut lines, or one per page) in parts of 500; CSV of numbers.
  ReportLab draws the design once and vector QR codes per ticket: 500 tickets ≈ 7 s, < 1 MB.
- Check-in: the normal gate scanner (web and app, offline queue included); duplicates caught as usual.
- Void: a returned run of numbers (e.g. 401–500) or the whole batch; tickets already used are kept.
- Not built: recording individual sales (who bought which number) — shops just sell the paper ticket.

## Suggested order

| Phase | Items | Why first |
|---|---|---|
| 1 | C4 cities, C3 categories, A4 dropdowns | Data foundation others depend on |
| 2 | C1 add org, C2 reset password, B3 verified tick | Small, superadmin-only, unblocks onboarding |
| 3 | A2 managed by, A3 banner, A5 registration QR, D1 profile logo | Mostly UI, low risk |
| 4 | B1 layouts, B2 save/print, A6 seat number | Ticket work done together, web + mobile |
| 5 | D2 photos/featured, D3 packages, D4 BS calendar | Marketplace work done together |
| 6 | A1 sub-events | Largest change, touches registration, scanning and analytics |

## Decisions (2026-11-06)

1. **A1** — sub-events; each sub-event's registration can be enabled/disabled.
2. **A2** — "managed by" is plain text plus a logo.
3. **A3** — small sliding banner on the marketplace (vendors and venues),
   replacing the intro text; `/events` unchanged.
4. **A6** — seat numbers can be enabled/disabled: per event by the organizer
   (`show_seat_number`) and platform-wide by superadmin (module). Manual/CSV
   assignment.
5. **B3** — verified tick on organizations, vendors and venues.
6. **D1** — profile logo for users and vendors.
7. **Modules** — Sub-events, Seat numbers, Packages and Banners are separate
   superadmin-toggled modules.
