# Custom registration forms, by event kind

Status: Phase A built 2026-11-10 (templates, link/photo/file/heading types, rules, server validation, public uploads). Phase B is next.

## Why

Every event asks different things. A 10K run needs a T-shirt size and an emergency contact. A film festival needs the film's
title, runtime and a screener link. A pageant needs age, height, photos and a short bio. A wedding needs "how many are
coming" and meal choice. Today the organizer starts from an empty form every time, several answer types are missing,
and the server trusts whatever is sent.

## What exists today (audit, 2026-11-10)

| Area | Today |
|---|---|
| Model | `Form` → `FormField` (`field_type`, `label`, `placeholder`, `help_text`, `required`, `order`, `options`, `validation_rules`) → `FormResponse` (with `review_status`) → `FormAnswer.value` |
| Answer types in the builder | text, paragraph, number, email, phone, select, radio, checkbox, date |
| `file_upload` | In the model, but the builder can't add it and the web form renders it as a text box |
| `validation_rules` | Stored, never read anywhere |
| Server checks | Only "required" (no type, choice, length, number range or file checks) |
| Templates | None; every form starts empty |
| Layout | No section headings or explanatory text |
| Uploads | `/api/uploads/` is images only and needs a signed-in user, so guests can't attach anything |
| App | Renders text, choices and dates; refuses forms with a file question |

## Plan

### Phase A (now)

1. **Templates by event kind.** The builder offers "Start from a template". Picking one adds a ready set of questions
   that the organizer can then edit, reorder or delete. Templates:

   | Template | Typical questions |
   |---|---|
   | Running / marathon | Category (5K/10K/21K), T-shirt size, date of birth, gender, emergency contact name + phone, medical conditions, waiver consent |
   | Film festival submission | Film title, director, runtime (minutes), genre, language, synopsis, screener link, poster, rights consent |
   | Beauty pageant application | Date of birth (age 18–28), height (cm), city, education, photos (portrait, full length), short bio, talent, consent |
   | Conference / workshop | Organization, job title, dietary needs, sessions of interest, how did you hear |
   | Concert / show | City, age 18+ confirmation, how did you hear |
   | Wedding RSVP | Attending (yes/no), number of guests, meal choice, song request, message |
   | Sports team | Team name, captain phone, players (paragraph), jersey sizes, consent |
   | Hackathon | Team name, team size, skills, GitHub/portfolio link, T-shirt size |
   | Volunteer sign-up | Availability (days), skills, T-shirt size, emergency contact |

   The builder suggests the template that matches the event (open call → submission/pageant, category Sports → running/team,
   Wedding → RSVP, Hackathon → hackathon).

2. **New answer types**
   - **Link**: a web address (film screener, portfolio), checked to start with http(s).
   - **Photo**: an image upload (JPG/PNG/WebP, up to 5 MB).
   - **File**: a PDF or image upload (up to 5 MB), e.g. a CV or a script.
   - **Section heading**: a title with optional text that splits a long form ("About you", "Your film"). It is not a question.
   Large videos are never uploaded; the form asks for a link instead (the server has 1 GB of RAM and a small disk).

3. **Rules per question** (stored in `validation_rules`, enforced on the website, in the app and on the server)
   - Number: minimum / maximum (e.g. height 140–210).
   - Short / long text: maximum length.
   - Date: minimum and maximum age when it's a date of birth (e.g. 18–28).
   - Choices: the answer must be one of the options.

4. **Public uploads for form answers**: `POST /api/forms/events/<slug>/upload/`. No sign-in needed, images and PDFs up to 5 MB,
   rate limited per visitor, stored under `uploads/forms/<event>/`. Answers store the file's URL; the organizer's
   Applications view and the CSV export show it as a link.

5. **Server-side validation** of every answer against its type and rules.

6. **App**: Link and Section heading are supported. Photo and File questions keep sending people to the website for now.

### Phase B (next)

- **Conditional questions**: show a question only when an earlier answer matches ("If 21K, show the finisher time").
- **Questions per ticket type**: VIP buyers get extra questions.
- **Form step inside event creation**: pick a template while creating the event, no separate Forms page visit.
- **Photo / file uploads in the app**.
- **Save and reuse my own form** as a template across the organizer's events.
- **Bib numbers** for runs: assigned in order per category.

## Out of scope

Paid application fees, judging/score sheets and public voting on entries (the voting module covers contests).
