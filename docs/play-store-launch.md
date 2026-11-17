# Google Play launch — every screen, from "Create app" to production

App: **Eventlaya** · package `com.eventlaya.eventlaya_scanner` · code in `scanner_app/` · same Play developer account
as Flapmo. Signing and builds: `docs/mobile-release.md`. Data safety answers: `docs/play-store.md`.

Checked against the code on 16 Nov 2026: permissions are CAMERA, POST_NOTIFICATIONS, INTERNET, ACCESS_NETWORK_STATE,
VIBRATE, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, USE_BIOMETRIC / USE_FINGERPRINT and Firebase push (c2dm). **No** location,
SMS, contacts, call log, all-files access, or advertising ID (`AD_ID`).

---

## 0. Before you start

| Check | Why |
|---|---|
| **Account type** (Play Console → Settings → Developer account) | A **personal** account created after 13 Nov 2023 must run a **closed test with at least 12 testers for 14 days in a row** before it can publish to production. **Organization** accounts skip this. If Flapmo went to production without it, the account is an organization or older one. |
| Signed `.aab` | `scanner_app/tool/make_upload_keystore.sh` once, then `scanner_app/tool/build_release.sh` → `~/Desktop/eventlaya-releases/` |
| Demo accounts on **production** (eventlaya.com) | Reviewers must be able to sign in. Use the demo attendee / organizer / staff accounts (`~/.eventlaya-deploy/credentials.md`); change their passwords to something you can share with Google, and make sure each has a **phone number** saved (the app now asks for one). |
| Graphics (section 3) | Icon, feature graphic, screenshots |

---

## 1. Create the app

Play Console → **Home → Create app**

| Field | Enter |
|---|---|
| App name | `Eventlaya` |
| Default language | English (United States) – en-US |
| App or game | App |
| Free or paid | Free (can't be changed to paid later) |
| Declarations | Tick Developer Program Policies and US export laws |

---

## 2. "Set up your app" (Dashboard → App content)

### 2.1 Privacy policy
`https://eventlaya.com/privacy`

### 2.2 App access
Choose **"All or some functionality in my app is restricted"** → **Add instructions** (one per role):

| Name | Username / password | Instructions |
|---|---|---|
| Attendee | demo attendee email / password | Open the app → Profile → Sign in. Explore, register for an event, view your pass under My Pass, vote under Voting. |
| Organizer | demo organizer email / password | Sign in → the organizer app opens: dashboard, event controls, attendees, applications, team chat. |
| Gate staff | demo staff email / password | Sign in → choose a gate → scan a pass QR code (use a pass from the attendee account). |

Tick "No other information is required". Browsing events and vendors works without an account.

### 2.3 Ads
**No, my app does not contain ads.**

### 2.4 Content rating (IARC questionnaire)
- Email: support@eventlaya.com · Category: **All other app types** (utility / productivity / communication / other)
- Violence, fear, sexuality, language, controlled substances, crude humour: **No** to all
- **Does the app allow users to interact or exchange content?** **Yes** (team chat between organizers and their
  staff; reviews; inquiries to vendors; contestant photos and bios)
- Does it share the user's current physical location with other users? **No**
- **Does it allow users to purchase digital goods?** **Yes** (vote packs; tickets are for real-world events, paid with
  Khalti / eSewa or at the venue)
- Gambling or simulated gambling: **No** · Unrestricted internet browser: **No**
- Expected result: **Everyone / PEGI 3 / IARC 3+** with descriptors "Users Interact" and "In-App Purchases".

### 2.5 Target audience and content
- Target age: **18 and over** (simplest: no Families-policy requirements; events, payments and pageants are adult
  activities). If you want teenagers too, choose 16–17 and 18+, but then content must suit them.
- "Could your app unintentionally appeal to children?" **No**.

### 2.6 News apps → **No** · 2.7 COVID-19 tracing / status → **No** · 2.8 Government app → **No**

### 2.9 Data safety
Fill in from `docs/play-store.md` **with one change since it was written**: the **phone number is now required**
for every account (sign-up asks for it; Google / Facebook sign-ins add it once). In the form:
Personal info → Phone number → Collected, **Required**, purposes App functionality + Account management.
Also confirm: data encrypted in transit **Yes**; users can request deletion **Yes** (in app: Profile → Delete
account; web: https://eventlaya.com/delete-account).

### 2.10 Financial features
**My app doesn't provide any financial features.** (Ticket and vote-pack payments go through Khalti / eSewa
checkout; Eventlaya is not a bank, wallet, lender or payment service.)

### 2.11 Health apps → **No health features**

### 2.12 Advertising ID
**No** — the app does not use the advertising ID (no `AD_ID` permission in the merged manifest).

### 2.13 Permissions declarations
None needed: no SMS / call log, no background location, no all-files access, no exact alarms, no accessibility
or VPN services. (CAMERA, notifications and biometric are ordinary runtime permissions.)

### 2.14 Child safety standards (if Play asks)
Eventlaya has user content (chat, reviews, photos). If the form appears: link the published standards
`https://eventlaya.com/community-guidelines`, contact support@eventlaya.com, and confirm content can be reported
(review reporting / organizer and superadmin moderation) and that you comply with child-safety law. **Verify in the
app that a review or contestant can be reported before submitting.**

---

## 3. Main store listing (Grow → Store presence → Main store listing)

### Text (ready to paste)

**App name** (max 30): `Eventlaya: Events & Voting`

**Short description** (max 80):
`Find events in Nepal, get QR tickets, vote in contests and book vendors.`

**Full description** (max 4000):
```
Eventlaya is Nepal's event app: discover concerts, festivals, college fests, pageants and workshops near you,
register in seconds and keep your QR pass on your phone.

FOR ATTENDEES
• Explore upcoming events in Dharan, Itahari, Biratnagar and across Nepal
• Register or buy tickets and get a QR pass instantly
• Save passes on your phone for quick entry at the gate
• Vote for your favourite contestants in pageants and talent shows
• Save events you like and get reminders
• Find venues, photographers, caterers and decorators for your own event

FOR ORGANIZERS
• See registrations, check-ins and applications live
• Open or close registration, applications and voting from your phone
• Message your team and manage gate staff
• Review applications and run contests with live results

FOR GATE STAFF
• Scan QR passes at the gate, even with a weak connection
• See who is in and out in real time

Eventlaya is built in Dharan for events across Nepal.
Questions? support@eventlaya.com · https://eventlaya.com
```
(Avoid words Play rejects in listings: "best", "#1", "free" in the title, prices, emojis in the title.)

### Graphics

| Asset | Required | Spec |
|---|---|---|
| **App icon** | Yes | 512 × 512 PNG, 32-bit, max 1 MB. Same design as the launcher icon; no rounded corners or shadow (Play adds them) |
| **Feature graphic** | Yes | 1024 × 500 JPG or 24-bit PNG (no transparency). Logo + one line, e.g. "Events, tickets & voting in Nepal" on the brand colour |
| **Phone screenshots** | Yes, 2–8 | PNG/JPG, 9:16, e.g. **1080 × 1920**. Suggested order: 1 Explore events · 2 Event page · 3 QR pass (My Pass) · 4 Voting list · 5 Contest page · 6 Vendors · 7 Organizer dashboard · 8 Gate scanner |
| 7" and 10" tablet screenshots | Only to be featured on tablets | 1–8 each, 16:9 or 9:16 |
| Promo video | Optional | YouTube URL |

Use real-looking demo data (the demo organizer's events), no personal data of real people.

---

## 4. Store settings (Grow → Store presence → Store settings)

| Field | Enter |
|---|---|
| App category | **Events** |
| Tags | Events, Tickets, Social (pick up to 5 offered) |
| Email | support@eventlaya.com |
| Phone | optional |
| Website | https://eventlaya.com |
| External marketing | On |

---

## 5. Countries and pricing

Monetize → **Countries / regions**: Nepal (add India, Gulf countries, etc. later if you want the diaspora).
Price: Free. In-app products: none (vote packs and tickets are paid through Khalti / eSewa on the server, not Google
Play Billing — allowed because they are for real-world events and services; keep it that way).

---

## 6. Releases

### 6.1 Internal testing (first upload)
Test and release → **Testing → Internal testing** → Testers: create a list (your Gmail and the team's) → **Create
new release** → accept **Play App Signing** → upload `eventlaya-<version>-<build>.aab` → release name e.g.
`1.0.1 (3)` → release notes:
```
<en-US>
First release: explore events, QR passes, voting, vendors, organizer dashboard and gate scanner.
</en-US>
```
→ Save → Review → **Start rollout to Internal testing**. Testers install via the opt-in link.

### 6.2 Right after the first upload (important)
Test and release → **App integrity → App signing**:
1. Copy the **SHA-1** of the **App signing key** (Play's) and of the **Upload key** (yours) → Firebase → Project
   settings → Android app `com.eventlaya.eventlaya_scanner` → **Add fingerprint** (both). Download the new
   `google-services.json` into `scanner_app/android/app/`. **Without this, Google sign-in fails in Play builds.**
2. Copy the **SHA-256** of both keys → add them to `frontend/public/.well-known/assetlinks.json`
   (`sha256_cert_fingerprints`), then deploy the website. **Without this, eventlaya.com/e/… and /ticket/… links
   open in the browser instead of the app.** (Today the file lists only one key, most likely the debug key.)

### 6.3 Closed testing (personal accounts: required before production)
Testing → **Closed testing** → create track → at least **12 testers** opted in for **14 days in a row** → then
Dashboard → **Apply for production access** (answer the short questionnaire about the test).

### 6.4 Production
Production → Create new release → reuse the tested build → release notes → **Staged rollout** 20% → watch
**Android vitals** (crashes, ANRs) for a day or two → 100%.

---

## 7. Before you press "Send for review"

- [ ] Demo logins in App access work on **production** and each has a phone number
- [ ] Privacy policy URL loads; Data safety matches it (phone required)
- [ ] Delete account works in the app and at /delete-account
- [ ] Content can be reported (reviews / contestants) — see 2.14
- [ ] Screenshots show the current app, no real people's personal data
- [ ] Google sign-in tested on the **internal testing** build after adding the Play SHA-1
- [ ] App links tested after updating `assetlinks.json`
- [ ] Version / build number higher than any earlier upload

Review usually takes 1–7 days for a new app. Rejection emails name the policy; fix and resubmit the same track.
