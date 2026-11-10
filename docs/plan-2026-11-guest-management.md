# Guest management, host alerts and guest messages

Status: being built 2026-11-10 (module `guest_management`).

## Why

Organizers want to know who matters is at the door ("Hari Rai, VIP, is IN"), keep notes on guests, and reach their
guests before and during the event (reminders, venue changes, "doors open"). Today the dashboard lists attendees and
staff can get a broadcast push, but there are no guest tags or notes, no arrival alerts, no messages to guests and
no reminders.

## What we build

### 1. Guest list (dashboard → Attendees)
- **Tags** per guest: VIP, Speaker, Press, Sponsor, Performer, Staff guest, or any custom tag. Filter the list by tag.
- **Host note** per guest (only organizers and event staff see it), e.g. "reserved front row", "pays at the door".
- Tags and notes also show to gate staff after a scan, so they can greet VIPs properly.

### 2. Host alerts (push notifications)
- Setting per event, **Arrival alerts**: *Tagged guests only* (default), *Every guest*, or *Off*.
- When a guest is scanned in for the first time: push to the organizer and the event's staff,
  "Hari Rai (VIP) is IN · Main gate · 6:42 PM".
- The dashboard shows a live **Arrivals** feed (latest check-ins, tagged guests highlighted) from the gate scan log.

### 3. Messages to guests
- **Message guests** on the dashboard: subject + message, sent by email (and app push to guests who use the app).
- **Who gets it**: everyone, not arrived yet, already inside, a tag (e.g. VIP), or a ticket type.
- Ready-made texts: reminder, venue or time change, doors open, thank you.
- One message per email address (buyers with several tickets get it once). A **sent messages** log shows who sent
  what, when and to how many people.
- Limits: 5 messages per event per hour, so a mistake can't spam everyone.

### 4. Automatic reminders
- Per event switch **Reminders** (on by default): an email the day before and about two hours before the start,
  with the pass link (or "No ticket needed" for registration-only events).
- Sent by a scheduled job every 10 minutes on the server; each reminder goes out once.

### 5. Phone number
- Phone becomes **required by default** for registrations and applications, so organizers can call or message guests.
- Per event switch to make it optional.

## Module and permissions
- New superadmin module **Guest management** (`guest_management`): tags, notes, arrival alerts, messages and reminders.
  Off → the API refuses those endpoints and the dashboard hides them.

## Later
- SMS through Aakash for messages and reminders (needs an SMS account).
- Guests replying to messages (chat module).
- Seating plans per table.

## Depends on
- **Email delivery**: production needs an email provider (SMTP) or messages, reminders and passes don't reach anyone.
