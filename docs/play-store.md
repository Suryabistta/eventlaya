# Google Play & Facebook — store answers

Answers for the Play Console (Data safety, App content) and the Meta app settings, derived from the code
as of 2026-10-28. Keep them in step with the policies (`frontend/src/pages/legal/`) and the code; when a
feature starts collecting something new, update the policy, this file and the Play form together.

App: **Eventlaya** — package `com.eventlaya.eventlaya_scanner` (`scanner_app/`).

## 1. URLs to paste

| Where | Field | URL |
|---|---|---|
| Play Console → App content → Privacy policy | Privacy policy URL | https://eventlaya.com/privacy |
| Play Console → App content → Data safety → Data deletion | Delete account URL | https://eventlaya.com/delete-account |
| Play Console → Store listing | Website / email | https://eventlaya.com · support@eventlaya.com |
| Meta app → App settings → Basic | Privacy Policy URL | https://eventlaya.com/privacy |
| Meta app → App settings → Basic | Terms of Service URL | https://eventlaya.com/terms |
| Meta app → App settings → Basic | User data deletion → "Data deletion instructions URL" | https://eventlaya.com/delete-account (section "If you signed in with Facebook or Google": `#facebook`) |
| Google Cloud → OAuth consent screen (project `eventlaya`) | Privacy policy / Terms links | the same two URLs |

The pages are public, need no sign-in, and are **not** a superadmin module (they must always be reachable).
In the app they are linked from sign-in / create account, attendee Profile, organizer More, staff Account and
vendor More ("Privacy & support"), opening in an in-app browser tab (`lib/core/legal.dart`).

## 2. Data safety form

**Does your app collect or share any of the required user data types?** Yes.
**Is all user data encrypted in transit?** Yes — HTTPS only (`https://api.eventlaya.com`, Cloudflare + Let's Encrypt).
(The hidden developer "server address" setting can point a test build at a plain-http local server; release users never see it.)
**Do you provide a way for users to request that their data is deleted?** Yes — in the app (Profile → Delete account;
vendors: More → Delete account) and on the web, plus by email; URL above.
**Account creation:** username (email) + password, and OAuth (Google, Facebook). Using the app without an account is possible
(browse events, register as a guest, save passes on the phone).

### Collected data types

"Shared" below means *shared with a third party* in Play's sense. Transfers we make are either to **service providers**
(DigitalOcean hosting, Cloudflare, Firebase Cloud Messaging, the email provider) or **initiated by the user** (registering
for an organizer's event, sending an inquiry to a vendor), which Play exempts from "sharing". So we answer **Shared: No**.
If Google reviewers disagree, the conservative alternative is to mark Name, Email, Phone and "Other info" as *Shared —
App functionality* (event organizers / vendors receive them).

| Play category → type | Collected | Required / optional | Purposes | Where it comes from |
|---|---|---|---|---|
| Personal info → **Name** | Yes | Required for an account and for event registration | App functionality, Account management | sign-up, profile, registration, Google/Facebook |
| Personal info → **Email address** | Yes | Required | App functionality, Account management | as above; passes and codes are emailed |
| Personal info → **User IDs** | Yes | Required | App functionality, Account management | Eventlaya account id; Google `sub` / Facebook user id when used |
| Personal info → **Phone number** | Yes | Optional (required for vendor accounts or when an organizer requires it) | App functionality | profile, registration, inquiries |
| Personal info → **Other info** | Yes | Optional | App functionality | organization/business name, city, answers to an organizer's registration questions (organizer-defined), guest names |
| Financial info → **Purchase history** | Yes | Required when you register for a paid ticket | App functionality | ticket orders (type, price due at the venue, promo code). No card / payment info is collected: tickets are paid at the venue, plans are paid outside the app |
| Photos and videos → **Photos** | Yes | Optional | App functionality | profile photo, team chat photos, listing photos — only ones the user picks or takes |
| Messages → **Other in-app messages** | Yes | Optional | App functionality | team chat (organizer + staff), inquiries / booking requests to vendors and replies |
| App activity → **App interactions** | Yes | Required for gate check-in | App functionality | pass check-in / check-out records (time, gate, scanning staff), poll votes (stored as hashed voter codes) |
| App activity → **Other user-generated content** | Yes | Optional | App functionality | reviews, events, listings, poll options, tasks |
| Device or other IDs | Yes | Optional (needed for push) | App functionality | Firebase Cloud Messaging token + platform; random device id for one-vote-per-device polls |

**Not collected:** location (precise or approximate), contacts, calendar, audio, files and docs, health, web browsing,
financial account / payment card info, crash logs and diagnostics (no Crashlytics, no analytics SDK), advertising ID.
The app shows **no ads**. (The **website** eventlaya.com uses Google Analytics — `docs/analytics.md` — but the Android
app has no analytics SDK and sends nothing to Google Analytics, so the Data safety answers above are unchanged. The
in-app browser tabs that open eventlaya.com legal pages are the website, covered by the website's privacy policy.)

**Is the data processed ephemerally?** No (stored on our server). **Can users choose not to collect?** Optional types
above: yes; account basics: no (needed for the account).

## 3. Permissions (merged release manifest)

| Permission | Why | Declared by |
|---|---|---|
| `CAMERA` | Scan QR codes on passes at the gate (organizers / gate staff); take a profile or chat photo when the user chooses. Asked at first use; camera frames for scanning are processed on the device. | app (`mobile_scanner`, `image_picker`) |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Talk to the Eventlaya API; detect offline mode so scans queue and sync later. | app, `connectivity_plus` |
| `POST_NOTIFICATIONS` (Android 13+) | Push notifications: team chat, booking requests/replies, gate alerts, organizer broadcasts. Asked once; can be turned off in system settings. | app, `firebase_messaging` |
| `com.google.android.c2dm.permission.RECEIVE`, `WAKE_LOCK` | Receive Firebase pushes; keep the screen awake on the scanner / pass screens. | `firebase_messaging`, `wakelock_plus` |
| `VIBRATE` | Haptic feedback on scan results. | app |
| `RECEIVE_BOOT_COMPLETED` | Declared for `flutter_local_notifications` (restores scheduled notifications after reboot). The app doesn't schedule notifications today — consider removing it (`tools:node="remove"`) before release. | app manifest |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | **Not used by the app.** Pulled in by `androidx.biometric` through the Google sign-in / Credential Manager dependencies. Remove with `tools:node="remove"` if Play flags them (verify Google sign-in still works). | library |

No photo/media read permission is needed: the gallery uses Android's system photo picker.
Package visibility (`<queries>`): `VIEW https`, Custom Tabs service and `SENDTO mailto` for `url_launcher`.

## 4. Content rating (IARC questionnaire)

- Category: *Utility, Productivity, Communication or Other* (event tickets and management).
- Violence, sexuality, language, controlled substances, gambling: **No**.
- **Users can interact / communicate:** Yes — team chat inside an organization (organizer + their staff) and public
  reviews; vendor inquiries. Moderation: organizers hide reviews, superadmin can hide/remove content, reports to
  support@eventlaya.com (`/community-guidelines`).
- **Shares user's location:** No. **Digital purchases:** No (no in-app purchases; tickets are paid at the venue).
- **Unrestricted internet / web browsing:** No (only our own pages in a browser tab).
- Target audience (App content → Target audience): **16+ / 18+** age groups only. The policies set 16 as the minimum age
  without a guardian; do **not** select under-13 groups (that would bring Families policy requirements).

## 5. Other App content items

- **Ads:** No ads.
- **Government app / financial features / health:** No.
- **News app:** No.
- **Account deletion:** in-app path is Profile → Delete account (attendees; organizers and staff via More/Account →
  Switch to attendee view → Profile), vendors More → Delete account. Organizers with registrations, listing owners with
  inquiries and accounts with billing history are closed by support instead (server returns a message with the email).

## 6. Facebook Login specifics

- From Facebook we read only `id, email, first_name, last_name` (`apps/accounts/social.py`), permission `email` + `public_profile`.
- Data deletion: we use the **instructions URL** (no deletion callback endpoint is implemented). If Meta later requires
  the callback ("Data Deletion Request Callback"), it has to be built (signed request → delete the user → status URL).
- App review: `email` and `public_profile` are standard permissions and need no extra review.
