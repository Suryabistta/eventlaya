# Event journeys: applications, tickets and voting under one event

Status: Phase 1 built 2026-11-10 (applications and tickets as separate switchable stages, date to be announced, Apply page, module `applications`). Phases 2–4 not built.

## The three kinds of event we run

| # | Example | What happens, in order |
|---|---|---|
| 1 | **Film festival** | Filmmakers submit films (open call) → submissions close → organizer selects films → the public buys or books tickets for the screening days at a venue |
| 2 | **Concert, conference, run** | The public gets tickets (paid or free) or simply registers. There is a date and a venue from the start |
| 3 | **Beauty pageant** | Contestants apply → organizer selects finalists → the public votes (often paid votes) → the public buys tickets for the grand finale at a venue |

Journey 2 is a single step. Journeys 1 and 3 have **several stages, each with different people**. Applicants are not the
audience, and voters may never attend.

## What we have today

- **Registration type per event**: *With pass* (tickets, paid or free), *Registration only* (form, no pass) or
  *Applications / submissions* (open call: form, review, accept/reject emails, no date or venue).
- **One registration form per event** and **one registration type per event**.
- **Voting contests** (`Contest / pageant`) belong to an event, with their own open/close times, paid vote packs and a
  public results page. **Contestants are entered by hand.**
- **Sub-events**: a main event with child events, each with its own date, form and registration.

The gap: journeys 1 and 3 need **an application stage and a ticket stage on the same event**, and a way to carry
**accepted applicants into the voting contest**. Today the organizer would have to create two separate events (one open
call, one ticketed) and retype the finalists into the contest.

## Proposal: one event, up to three stages

An event keeps its single public page, but gains a **timeline of stages**. Each stage has its own dates, its own
people and its own button.

| Stage | Who | What it uses | Button |
|---|---|---|---|
| **Applications** (optional) | Participants: filmmakers, contestants | Its own application form, closing date, review (accept / not selected) and emails | Apply / Submit your film (custom) |
| **Voting** (optional) | The public | The existing voting contest, linked to this event | Vote |
| **Tickets / registration** (optional) | Audience | Today's ticket types, free passes or registration only, with date and venue | Get tickets / Book a spot / Register |

### How each journey looks

1. **Film festival**: Applications (Nov 1–30) → Tickets for screenings (Dec 15–17, City Hall). After review, the
   organizer can list selected films on the event page in the Schedule section.
2. **Concert / conference / run**: Tickets or registration only, exactly as today. No change for organizers.
3. **Beauty pageant**: Applications (Nov 1–20) → Voting (Dec 1–15) → Tickets for the grand finale (Dec 20, venue).
   Accepted applicants become contestants in one click ("Add accepted applicants to the contest": name, photo and bio
   copied from the application).

### The event page

- A **timeline** near the top: `Applications · closed Nov 20` → `Voting · open now` → `Grand finale · Dec 20`.
- The **main button follows the current stage** (Apply → Vote → Get tickets). Stages that are over or not started
  show their dates instead.
- **Date and venue may be "to be announced"** while only applications are open. They become required when the
  tickets stage is switched on.
- The open-call facts rule stays: no spots or price while only applications are open.

### For the organizer

- The event form gets a **Stages** step with three switches: *Applications*, *Voting*, *Tickets / registration*. Each
  stage shows only its own settings (closing date and form for Applications, contest for Voting, ticket types, date
  and venue for Tickets).
- The dashboard shows a tab per stage: **Applications** (review), **Voting** (results), **Attendees** (tickets and
  check-in).
- Two forms per event: the **application form** (participants) and the **registration form** (audience), both built
  with the form builder and its templates.

### Rules

- An applicant is never sent a ticket by applying; accepted applicants who want to attend buy or book a ticket like anyone else
  (or the organizer gives them a free ticket type).
- Applications and tickets can run at the same time (film festival early-bird tickets while submissions are still open).
- Each stage can be closed early by the organizer.
- Existing events keep working: today's three registration types become "tickets stage only" or "applications stage only".

## How we get there

| Phase | What | Effort |
|---|---|---|
| 1 | Separate the application stage from the ticket stage: application form, closing date and review on any event, next to its tickets. "Date to be announced" while only applications are open | Medium |
| 2 | Event page timeline and a main button that follows the current stage; Stages step in the event form | Medium |
| 3 | Link a voting contest as a stage; "Add accepted applicants to the contest" | Small to medium |
| 4 | App: the timeline, the stage button and applying (photo/file upload in the app) | Medium, needs an app release |

Phase 1 alone already lets a film festival take submissions and sell screening tickets on one event page.

## Decisions needed

1. **One event with stages (recommended), or separate linked events?** Stages keep one page, one link and one set of
   followers. Separate events (using sub-events) is quicker but splits the audience across pages.
2. **Accepted applicants and tickets**: should accepted applicants get a free participant pass automatically (useful for
   pageant contestants and filmmakers attending), or buy/book like everyone else?
3. **Voting money**: keep paid votes going to the organizer as today, or show applicants' vote totals publicly during
   voting? (Today contests already support paid vote packs and hidden or live results.)
4. **Rejected applicants**: is the current "not selected" email (with an optional note) enough, or do you want a
   waiting list?
