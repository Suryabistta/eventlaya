# Feedback batch — 16 Nov 2026

Status of the client feedback list (homepage, dashboard, superadmin, marketplace), checked against the code on `main`
after the 15 Nov deploy (merge `6fee364`). Each item: what was asked, where it stands, and what is left.

Legend: ✅ done and live · 🟡 partly done · ⬜ not started · ❓ needs a decision before building

## Summary

| # | Area | Item | Status |
|---|------|------|--------|
| 1 | Homepage | Voting tab second in the hero (Events, Voting, Vendors) | ✅ |
| 2 | Homepage | Featured marketplace section between Events and Vendors, dark background | ✅ (16 Nov, not deployed) |
| 3 | Homepage | Show 3 featured items | ✅ (16 Nov, not deployed) |
| 4 | Homepage | Remove vendor descriptions | ✅ |
| 5 | Homepage | New layout for the Partners section | ⬜ ❓ |
| 6 | Homepage | Dark Contact section | ✅ (16 Nov, not deployed) |
| 7 | Dashboard | Separate "create" for Voting event, Ticketing event and Dynamic form | 🟡 ❓ |
| 8 | Dashboard | Show / hide price on the first (search) page | ✅ vendors/venues choose (16 Nov, not deployed) |
| 9 | Dashboard | Service area: allow typing places manually | ✅ (16 Nov, not deployed) |
| 10 | Superadmin | Hide / show option for events | ✅ superadmin moderation (16 Nov, not deployed) |
| 11 | Superadmin | Featured on/off works for home and event pages, and for the marketplace | ✅ (16 Nov, not deployed) |
| 12 | Superadmin | "Add vendor", like "Add organization" | ✅ (16 Nov, not deployed) |
| 13 | Superadmin | Mobile number required everywhere | ✅ including signup (16 Nov, not deployed) |
| 14 | Find vendors | Same layout for venues and vendors | ✅ |
| 15 | Find vendors | No description, 3 per row | ✅ |
| 16 | Find vendors | Vendor type on the top left of the photo | ✅ |
| 17 | Vendor page | Calendar only; landscape by default, box view optional | ✅ |

Update 16 Nov (afternoon): 14 done (7 of them built today, waiting for deploy), 1 partly done (#7), 4 waiting for answers (#5, #7, #8, #10).

## Done (live since 15 Nov)

1. **Hero tabs** — Events · Voting · Vendors. Voting only shows while the Contests module is on (`landing/Discover.tsx` SearchHero).
4. **Vendor descriptions removed** — the shared vendor card (`marketplace/Cards.tsx`) has no description; used on the home page and /marketplace. Home vendors show 6, 3 per row.
14–16. **Find vendors** — venues are just another category chip; one grid, 3 per row; type badge top-left of the photo for both cards; descriptions removed from both cards; "Hosted by" can be switched off per venue.
17. **Vendor / venue page calendar** — the list of open dates is gone; Landscape (day strip) by default, Box (month grid) optional and remembered per device (`marketplace/AvailabilitySection.tsx`).

## Partly done

3. **3 featured items on the home page**
   - Done: vendors (6, 3 per row) and live voting (3).
   - Left: **Featured & upcoming events** still shows 4 in a 4-column row (`EventsShowcase`, `slice(0, 4)`, `lg:grid-cols-4`). Change to 3 per row (show 3 or 6).

7. **Separate create flows**
   - Done: "New event" asks the kind first — Ticketing, Registration, Pageant (applications & voting); each has its own steps and form step. Voting has its own "New contest" (Simple vote by default).
   - Left / unclear: "Dynamic Forms" as a third top-level create option. Today forms belong to an event. ❓ Do you want standalone forms (a form with its own link, no event), or just a clearer "Create" menu with three entries: Event, Voting, Form?

11. **Featured on/off**
    - Done: superadmin "Featured events" page with a switch per event (`admin/FeaturedEventsPage.tsx`, `platform/featured_events.py`).
    - Bug to fix: the home page "Featured" tab falls back to **all** upcoming events when none are featured, so switching featured off seems to do nothing. The Featured tab should show only featured events, and hide itself when there are none.
    - Left: **marketplace featured** — venues and vendors have `is_featured` in the database but the superadmin has no page to switch it. Add a "Featured listings" page (same pattern as Featured events), and use it on the home page and /marketplace.

13. **Mobile number required everywhere**
    - Done (server-enforced): event registration, tickets, applications, venue inquiries, vendor quotes, home contact form. The per-event "phone required" switch was removed.
    - Left: superadmin **Add organization** (and the new Add vendor) should require a phone; account signup is optional on purpose (Google / Facebook sign-in gives no phone). ❓ Confirm signup stays optional.

## Not started

2. **Featured marketplace section on the home page** — a dark band between Events and Vendors showing featured venues and vendors (depends on item 11's marketplace featured switch). ❓ Is this the same as today's "Featured vendors" section moved and restyled, or a new section above it (e.g. featured venues), with Vendors staying below?

5. **Partners section layout** — the current section is a centred row of logo chips. ❓ Please share the layout you want (mockup or a site to match); marketing sections are only redesigned from your mockup.

6. **Dark Contact section** — make the home Contact section dark (same dark brand tone as the hero), with the form card on it. Content stays editable from the superadmin home editor.

8. **Show / hide price on the first page** — ❓ Which price and who decides:
   - (a) vendors / venues choose to hide their price on listing cards ("Price on request"), or
   - (b) organizers hide the ticket price on the Explore events card, or
   - (c) a superadmin switch for all cards.

9. **Service area: manual locations** — vendors can only pick their single city today (`Vendor.city`). Add "Service areas": pick from the city list **or type any place** (e.g. "Damak, Urlabari, Jhapa district"); show them on the vendor page and let the city filter match them.

10. **Superadmin hide / show events** — ❓ Two readings:
    - (a) the superadmin can hide any event from public listings (moderation), or
    - (b) when an organizer creates an event, an option "Show on Explore events" (unlisted events reachable only by link).

12. **Superadmin "Add vendor"** — like Add organization: superadmin creates a vendor account (business name, category, city, phone required, email) and the vendor sets their password from the welcome email. Optionally create their listing at the same time.

## Suggested order

1. Quick, no decisions needed: **3** (events 3 per row), **6** (dark Contact), **11** (featured fixes + marketplace featured page), **12** (Add vendor), **13** (phone on Add organization / vendor), **9** (service areas).
2. After your answers: **2**, **5**, **7**, **8**, **10**.

## Open questions

1. (#2) New featured-marketplace section, or move/restyle the existing Vendors section?
2. (#5) Mockup for the Partners layout?
3. (#7) Standalone forms, or a three-option "Create" menu?
4. (#8) Which price, and who switches it (vendor, organizer, superadmin)?
5. (#10) Superadmin moderation hide, or organizer "unlisted" events?
6. (#13) Keep the mobile number optional at account signup (needed for Google / Facebook sign-in)?

## Built on 16 Nov (waiting for deploy)

- **#3** Featured & upcoming events: 3 per row; the Featured tab shows only featured events and hides itself when none are featured (this was the "featured off does nothing" bug).
- **#11** Superadmin **Featured listings** page (`/admin/featured-listings`, API `/api/platform/featured-listings/`): feature venues and vendors; featured listings come first in Find vendors (venues and vendors mixed) with a Featured badge on both cards; `?featured=1` on the public venue and vendor lists.
- **#2** Home page **Featured marketplace** band: dark, right after the events, up to 3 featured venues and vendors, hidden when nothing is featured; heading and on/off in the superadmin home editor ("Featured marketplace").
- **#6** Contact section is dark (hero tone) with the form on a white card.
- **#12** Organizations → **Add vendor** (same form, pre-set to vendor, "Business name").
- **#13** Mobile number required (and checked on the server) on Add organization and Add vendor.
- **#9** Vendor **Service areas**: pick listed cities or type any place; shown as "Also serves" on the vendor page; the Find vendors city filter matches them.

Migrations: `platform 0017_admin_action_listing_featured`, `marketplace 0015_vendor_service_areas`.

## Built later on 16 Nov, after your answers (waiting for deploy)

- **#8 Hide price (vendors and venues decide):** "Hide my price" on the vendor profile and venue forms. The public sees "Price on request" on cards and pages; the server sends no price at all (listing, spaces, calendar slots), while the owner and superadmin still see it. Migration `marketplace 0016_hide_price`.
- **#10 Superadmin hides events (moderation):** "Featured & hidden events" page → Hide (reason required) / Show again. A hidden event disappears from every public list and page (events, voting, sitemap, link previews, reviews, saved events, organizer profile), takes no registrations or applications, and stops being featured. The organizer sees a red notice with the reason on their dashboard. Migrations `events 0032_event_hidden_by_admin`, `platform 0018_admin_action_hide_event`.
- **#13 Mobile number at signup:** required on both signup forms (checked by the server). Anyone signed in without a number (Google / Facebook sign-in, older accounts) sees "Add your mobile number" once and carries on. The mobile app's sign-up still needs the same change.

Still open: **#5** Partners layout (needs your mockup), **#7** Dynamic forms as a third create option (needs a decision).
