# Eventlaya — off-site SEO kit (ready to paste)

_Last updated: 2026-10-28_

Everything the owner needs to do **outside** the codebase to get eventlaya.com found, trusted and cited: Google Business
Profile, social profiles, citations, backlinks, a press release and Search Console/Bing. Everything here is written to be
true today; lines that depend on something not live yet are marked **[when live]**. Items that could not be verified
online are marked **unverified — check before using**. Nothing here has been submitted anywhere.

Related: `docs/seo.md` (what is built + §4 checklist), `docs/seo-research.md` (keywords, competitors, calendar),
`docs/seo-audit.md` (technical audit).

**Three facts to settle before you paste anything** (they must be identical everywhere):
1. **Phone number** — choose one number (mobile/WhatsApp is fine) and use it on GBP, every directory, Facebook and
   `/contact` (`frontend/src/lib/legal.ts`). Until then the blocks below say `[PHONE — choose one number and use it everywhere]`.
2. **support@eventlaya.com must exist and be read** — it is the contact on the site, in JSON-LD, and in every listing.
3. **Legal entity name** — if the registered company name differs from "Eventlaya", directories that ask for a registered
   name (chambers, NAS-IT, Crunchbase) get the legal name *plus* "Eventlaya" as the brand. The GBP name stays **Eventlaya**.

---

## 1. NAP block (copy exactly, everywhere)

```
Name:     Eventlaya
Alt name: इभेन्टलय
Area:     Eastern Nepal (Koshi Province) — service-area business, no public street address
Based in: Dharan, Sunsari, Nepal
Email:    support@eventlaya.com
Phone:    [PHONE — choose one number and use it everywhere]
Website:  https://eventlaya.com
```

One-line description (for directories with a short field, 150 characters):
> Event software from Dharan for Eastern Nepal: online registration, QR passes, gate check-in, contest voting, venues and vendors.

Rules: same spelling and capitalisation ("Eventlaya", not "EventLaya"/"Event Laya"), the same website URL with `https://`
and no trailing path, and never a street address in public listings (the site and JSON-LD don't publish one either).

---

## 2. Google Business Profile (GBP)

### 2.1 Eligibility — read this first
GBP is for businesses that meet customers in person. Google's guidelines
(https://support.google.com/business/answer/3038177) allow a profile if the business "either has a physical location
that customers can visit, or travels to customers where they are", and a **service-area** profile if it "travels to
customers at their physical locations". A purely online business is not the intended use.
**Eventlaya qualifies only if you really visit organizers** (onboarding, training gate staff, on-site gate support —
the Enterprise plan already promises "on-site gate support in Koshi Province"). If that is true, create a service-area
profile. If not, skip GBP and rely on the website, Bing and social profiles. Nepal is a supported GBP country
(https://support.google.com/business/answer/6270107 lists "NP | Nepal").

### 2.2 Name
- Exactly **Eventlaya**. Google: the name must reflect "your business's real-world name"; adding marketing taglines,
  service descriptions, locations etc. "could result in the suspension of your Business Profile"
  (https://support.google.com/business/answer/3038177).
- Not allowed: "Eventlaya – Event Management Software Nepal", "Eventlaya Itahari", "EVENTLAYA".

### 2.3 Categories
Google: use as few categories as possible, pick ones that complete "This business **is** a…", and don't use categories
as keywords (same page). Category names below were confirmed in a 2026 third-party export of the GBP category list
(https://daltonluka.com/blog/google-my-business-categories); Google's list differs by country, so **confirm each one
appears in the picker for Nepal**.

| Role | Category | Why |
|---|---|---|
| **Primary** | **Software company** | What Eventlaya is. |
| Secondary | **Event ticket seller** | True once online ticket payments are live: Eventlaya collects ticket payments for organizers (Khalti/eSewa). Add it **[when live]**. |
| Secondary (owner decision) | **Event management company** | Only if you actually sell event services (on-site gate/check-in management, running registration for a client). It matches "event management company in Itahari/Dharan" searches, but adding it without the service is misleading. |
| Avoid | Event planner, Wedding planner, Event venue | Eventlaya doesn't plan events or own a venue. |
| Avoid | Website designer, Internet marketing service, Computer software store | White-label event sites are a product feature, not a web-design or marketing service; there is no shop. |

### 2.4 Service area (max 20)
Google allows **up to 20 service areas** and says the overall area "should not extend farther than about 2 hours of
driving time from where your business is based" (https://support.google.com/business/answer/9157481). From Dharan,
pick the towns where you can genuinely visit an organizer:

1. Dharan 2. Itahari 3. Biratnagar 4. Inaruwa 5. Duhabi 6. Sundarharaicha (Biratchowk) 7. Urlabari 8. Pathari-Shanischare
9. Belbari 10. Rangeli 11. Damak 12. Birtamod 13. Bhadrapur 14. Mechinagar (Kakarbhitta) 15. Dhankuta 16. Barahachhetra
17. Triyuga (Gaighat) 18. Sunsari (district) 19. Morang (district) 20. Jhapa (district)

- Districts only if the picker offers them; otherwise replace with Arjundhara, Gauradaha or Kankai (Surunga).
- Mechinagar and Triyuga are at the edge of the 2-hour guidance from Dharan — keep them only if you really travel there.
- **Not on GBP** (too far for the 2-hour rule, still covered by the website and blog): Ilam, Khandbari, Phidim,
  Taplejung, Myanglung (Terhathum), Bhojpur, Okhaldhunga, Diktel, Salleri. Mention them on the blog, not on GBP.
- Hide the address (service-area business). Verification is usually a video of the workplace/tools; do it from Dharan.

### 2.5 Description (≤ 750 characters — this one is 731)
No links, prices or promotions (Google rule). Paste:

```
Eventlaya is event management software built in Dharan for organizers in Eastern Nepal (Koshi Province). Organizers publish an event page with an online registration form, ticket types and promo codes, and every attendee gets a QR code pass. Gate staff check people in with a phone camera, with duplicate-pass alerts and a live count of who is inside. Attendees pay at the venue, or online with Khalti or eSewa where the organizer turns it on. Eventlaya also runs pageant and contest voting with judges' scoring and SMS or email codes, team chat for event crews, white-label event sites and a marketplace where venues and vendors take booking requests. We visit organizers to set up their events and help run the gate on event day.
```
- The last sentence must be true (it is also what makes you eligible). If online payments are not live yet, change the
  fourth sentence to "Attendees pay at the venue; online payment with Khalti and eSewa is being added."
- When the Android app is on Google Play, change "with a phone camera" to "with a phone camera or the Eventlaya Android app".

### 2.6 Services (name + description, each ≤ 300 characters)
| Service | Description |
|---|---|
| Online event registration | An event page with a registration form you build yourself: text, phone, email, dropdown, checkbox, date and more. One link to share on Facebook, TikTok, WhatsApp and Viber. Attendees register from any phone without an app. |
| Ticket types and promo codes | General, Student, VIP, Early Bird or free tickets, each with its own price, quantity and sales window. Hidden tickets unlocked by a code, percentage or rupee discounts, usage limits and a maximum number of tickets per order. |
| QR code passes | Every attendee gets a unique QR pass on screen and by email, with a pass page they can download, print or save. Group orders get one pass per guest, with optional guest names. |
| Gate check-in | Gate staff scan passes with a phone camera. Several gates (entry, exit, VIP), ticket types limited to gates, notes shown on scan, duplicate-pass alerts and a live count of people inside. |
| Online ticket payments **[when live]** | Attendees pay with Khalti or eSewa during registration and the pass is issued after the payment is confirmed with the provider. Organizers can also offer pay at the venue, or both. |
| Pageant and contest voting | Numbered contestants with profiles, award categories, rounds with eliminations, judges scoring on a phone, weighted public and judge results, and verified voting with SMS or email codes. Fraud flags, vote voiding with an audit log and a presenter view. |
| Live polls | Quick audience polls during an event, one vote per pass, account or device, with results on a big screen. |
| Team chat and crew tools | Chats for the organizer and their staff, automatic event crew groups, gate staff accounts and gate assignment, push announcements to staff. |
| Venue and vendor marketplace | Banquets, party palaces, hotels, photographers, sound, decoration and catering in Eastern Nepal. Owners publish availability slots; customers send inquiries and booking requests that the owner confirms or declines. |
| White-label event sites | Approved organizers get their events on their own domain or a name.eventlaya.com address with their own branding. |
| Event analytics and export | Registrations, check-ins and gate traffic per event, and attendee lists as CSV for sponsors and committees. |

### 2.7 First 6 posts ("Add update"; each ≤ 1,500 characters)
Post one per week. Use a real screenshot or a real event photo (with permission) for each. Button + link as given.

**Post 1 — What Eventlaya is** · Button **Learn more** → `https://eventlaya.com/blog/what-is-eventlaya`
```
Eventlaya is event software built in Dharan for organizers across Eastern Nepal.

Publish one event page with your registration form and ticket types, share the link on Facebook, TikTok, WhatsApp or Viber, and every attendee gets a QR code pass. On the day, your gate team scans passes with their phones and sees a live count of who is inside.

It is made for colleges, clubs, schools, event companies, festivals and venues in Biratnagar, Itahari, Dharan, Damak, Birtamod and the rest of Koshi Province. Attendees don't need to install anything.

Read what Eventlaya does and who it is for.
```

**Post 2 — Faster entry at the gate** · Button **Learn more** → `https://eventlaya.com/blog/qr-code-tickets-gate-check-in-nepal`
```
Long queues at the gate are the first thing your audience remembers.

With QR passes, each attendee shows a code on their phone (or a printout) and your staff scan it with a phone camera. Eventlaya flags a pass that was already used, shows staff a note for each ticket type (for example "Check student ID"), and supports separate entry, exit and VIP gates.

Our guide explains how to set up QR check-in for an event in Nepal, how many scanners you need and what to do when mobile data is slow.
```

**Post 3 — Start with the free plan** · Button **Sign up** → `https://eventlaya.com/signup`
```
Running a small event? Eventlaya's free plan covers events of up to 150 attendees: an online registration form, QR code passes for every attendee, a web scanner on any phone camera, and an attendee list you can export as CSV.

Create your event, share the link and do a test scan with your team before the day. When your events grow, paid plans add more gates and staff, branding, live voting and more.

Create a free account.
```
(Check the free-plan limits on https://eventlaya.com/pricing before posting; they come from the live plans.)

**Post 4 — Fair voting for pageants and talent shows** · Button **Learn more** → `https://eventlaya.com/blog/online-voting-for-pageants-talent-shows-nepal`
```
Running a pageant, talent hunt or band competition? Audience voting is only exciting if people trust the result.

Eventlaya contests give every contestant a number and a profile page, let judges score on a phone or tablet, and combine judges' scores and public votes with weights you announce in advance. Voters can confirm with an SMS or email code, daily vote limits follow Nepal time, and suspicious votes are flagged and can be voided with an audit log.

Read how online voting works for pageants and talent shows in Nepal.
```

**Post 5 — For venue owners and event vendors** · Button **Learn more** → `https://eventlaya.com/marketplace`
```
Own a banquet, party palace or hotel hall in Eastern Nepal, or run a photo, sound, decoration or catering business?

List it on the Eventlaya marketplace. Publish your available dates and time slots, receive inquiries and booking requests from organizers, and confirm or decline each one with a note. Organizers browsing venues in Itahari, Dharan, Biratnagar and nearby can find you in one place.

See the venues and vendors already listed.
```

**Post 6 — Wedding season and festival planning** · Button **Learn more** → `https://eventlaya.com/blog/event-planning-checklist-nepal`
```
Mangsir and Magh–Falgun are the busiest months for banquets, caterers, decorators and photographers in Eastern Nepal, and Dashain, Tihar and Chhath change when people can travel.

Our event planning checklist for Nepal works backwards from your event date: what to book first, when to open registration, how to plan for festivals, the monsoon and power cuts, and what to check on the day itself.

Read the checklist before you book your venue.
```

Optional **Post 7 [when live] — Online payments** · Button **Learn more** → `https://eventlaya.com/blog/selling-event-tickets-online-nepal`
```
Attendees can now pay for event tickets with Khalti or eSewa on Eventlaya. The pass is issued only after the payment is confirmed with the provider, and tickets are held for a few minutes while the buyer pays. Organizers choose per event: online, pay at the venue, or both.

Read the guide to selling event tickets online in Nepal.
```

### 2.8 Q&A — status and seed answers
Google shut down the Business Profile **Q&A API on 3 November 2025** (announced September 2025), and several sources
report the public Q&A section being replaced by an AI "Ask" feature in Maps from December 2025; others say profiles
still show it unevenly (https://ppc.land/google-discontinues-business-profile-q-a-api-effective-november-3/,
https://www.brightlocal.com/learn/google-business-profile-qa). **If your profile still shows "Ask a question", post
these from your own account; if not, the same answers already live on the website as FAQs** (blog FAQPage data), which
is what Google's AI answers read.

| Question | Answer |
|---|---|
| Do attendees need to install an app? | No. Attendees register on a web page and get their QR pass on screen and by email. Only gate staff use the scanner, and it works in a phone browser. |
| Is there a free plan? | Yes, for events of up to 150 attendees. See eventlaya.com/pricing for current plans. |
| Can attendees pay with eSewa or Khalti? | **[when live]** Yes, where the organizer turns on online payment; organizers can also accept payment at the venue. **Until then:** Payment is collected at the venue today; online payment with Khalti and eSewa is being added. |
| Does Eventlaya work outside Dharan? | Yes. The software works anywhere in Nepal; we can visit organizers across Sunsari, Morang and Jhapa. |
| Can we run a pageant vote with judges? | Yes. Contests support judges scoring on a phone, public voting with SMS or email codes, rounds and award categories, and results that combine both with weights you set. |
| Can a venue or vendor list its services? | Yes. Venues and vendors can create a marketplace listing, publish available slots and receive booking requests. |

### 2.9 Photo checklist
- **Logo** (square, the same mark as `frontend/public/icon-512.png`) and a **cover** (1024×576 or larger, brand colours, no text-heavy banners).
- **Product screenshots** (5–8): event page on a phone, registration form, a QR pass, the scanner screen with a
  successful scan, the duplicate-pass warning, the live "inside" count, a contest voting page, the marketplace.
  Use demo events with fake attendee names — never real attendees' data.
- **Real event photos** (only with the organizer's permission, and avoid identifiable faces without consent): gate staff
  scanning, a queue moving through, the presenter screen at a contest.
- **Team / at work**: the team setting up a gate, training volunteers (with consent).
- **No** stock photos pretending to be your events, no edited "crowd" images.
- Add 2–3 new photos a month (fresh photos keep the profile active).

### 2.10 Review requests (genuine customers only)
Rules (Google's review policy + Nepal consumer law): ask **every** organizer you served, not just happy ones (selectively
asking for positive reviews is "review gating" and is not allowed); no discounts, gifts or free months for reviews; never
write, buy or swap reviews; don't post reviews from the office or your own phones; reply to every review, including bad
ones, calmly and specifically. Ask within 2–3 days after the event. Get `[REVIEW LINK]` from GBP → "Ask for reviews".

**English — WhatsApp / Viber**
```
Namaste [Name], thank you for running [Event name] on Eventlaya. Could you share a short Google review of your experience — what worked and what we should improve? It takes about a minute: [REVIEW LINK]
Honest feedback, good or bad, helps other organizers in Eastern Nepal decide. Thank you! — [Your name], Eventlaya
```

**English — email** (subject: "How did [Event name] go?")
```
Hi [Name],

Thank you for using Eventlaya for [Event name] on [date]. We'd like to hear how it went for you and your gate team.

If you have a minute, please leave an honest Google review: [REVIEW LINK]
If something went wrong, reply to this email too — we read every message and fix what we can.

Thank you,
[Your name]
Eventlaya · support@eventlaya.com
```

**नेपाली — WhatsApp / Viber**
```
नमस्ते [नाम] जी, [कार्यक्रमको नाम] इभेन्टलयमा चलाउनुभएकोमा धन्यवाद। तपाईंको अनुभव — के राम्रो भयो र हामीले के सुधार्नुपर्छ — एउटा छोटो Google रिभ्युमा लेखिदिन मिल्छ? एक मिनेट जति लाग्छ: [REVIEW LINK]
राम्रो होस् वा नराम्रो, इमानदार प्रतिक्रियाले पूर्वी नेपालका अरू आयोजकलाई निर्णय गर्न सजिलो हुन्छ। धन्यवाद! — [तपाईंको नाम], इभेन्टलय
```

**नेपाली — इमेल** (विषय: "[कार्यक्रमको नाम] कस्तो रह्यो?")
```
नमस्ते [नाम] जी,

[मिति] मा भएको [कार्यक्रमको नाम] का लागि इभेन्टलय प्रयोग गर्नुभएकोमा धन्यवाद। तपाईं र तपाईंको गेट टोलीको अनुभव कस्तो रह्यो, जान्न चाहन्छौं।

समय मिलेमा यहाँ एउटा इमानदार Google रिभ्यु लेखिदिनुहोस्: [REVIEW LINK]
केही समस्या भएको थियो भने यही इमेलमा जवाफ दिनुहोस् — हामी हरेक सन्देश पढ्छौं र सकेसम्म सुधार्छौं।

धन्यवाद,
[तपाईंको नाम]
इभेन्टलय · support@eventlaya.com
```

**Reply templates** — positive: "Thank you, [Name]! Glad the gate ran smoothly at [Event]. See you at the next one." ·
negative: "Thank you for telling us, [Name]. [One sentence on what happened and what we changed]. Please write to
support@eventlaya.com so we can sort it out." (Never share attendee data or argue in public.)

---

## 3. Social profiles

Handles: try **@eventlaya** everywhere; fall back to **@eventlaya.np** / **@eventlayanepal** (availability not checked —
**unverified**). Use the same logo, the same cover style and the link `https://eventlaya.com` on all of them.
Character limits from third-party 2026 references (https://socialk.it/en/tools/social-media-character-limits,
https://typecount.com/blog/social-media-character-limits); confirm in each form.

| Platform | Category / type | English bio | नेपाली bio |
|---|---|---|---|
| **Facebook Page** (intro ≤ 101) | Software (or "Software Company" if offered); add "Event Planner" only if you sell event services | Event registration, QR passes and gate check-in for Eastern Nepal. Built in Dharan. (83) | पूर्वी नेपालका लागि अनलाइन दर्ता, QR पास र गेट चेक-इन। धरानमा बनेको। (68) |
| **Instagram** (bio ≤ 150) — Business account | Software / App page | Event registration, QR passes and gate check-in for organizers in Eastern Nepal. Built in Dharan. Free plan for small events. (125) | पूर्वी नेपालका आयोजकका लागि अनलाइन दर्ता, QR पास र गेट चेक-इन। धरानमा बनेको इभेन्ट सफ्टवेयर। साना कार्यक्रमका लागि निःशुल्क। (124) |
| **LinkedIn company page** (tagline ≤ 120; About ~2,000) | Industry: Software Development; size 2–10 (or true size); type: Privately held | Event registration, QR passes, gate check-in and contest voting for organizers in Eastern Nepal. Built in Dharan. (113) | (LinkedIn has one tagline — use the English one; put the Nepali summary in About) |
| **YouTube** (description ≤ 1,000) | — | Short how-to videos for organizers in Nepal: create an event, build a registration form, set up ticket types, scan QR passes at the gate, run a pageant vote. Eventlaya is event software built in Dharan for Eastern Nepal. https://eventlaya.com | नेपालका आयोजकका लागि छोटा भिडियो: कार्यक्रम बनाउने, दर्ता फारम तयार गर्ने, टिकटका प्रकार राख्ने, गेटमा QR पास स्क्यान गर्ने र प्रतियोगितामा भोटिङ चलाउने तरिका। |
| **TikTok** (bio ≤ 80) — Business account | Software & Apps | Event tickets, QR passes and gate check-in for Eastern Nepal. Built in Dharan. (78) | पूर्वी नेपालका कार्यक्रमका लागि अनलाइन टिकट, QR पास र चेक-इन (60) |
| **X** (bio ≤ 160) | — | Event software from Dharan for Eastern Nepal: online registration, QR passes, gate check-in, contest voting, venues & vendors. Free plan for small events. (154) | पूर्वी नेपालका लागि इभेन्ट सफ्टवेयर: अनलाइन दर्ता, QR पास, गेट चेक-इन। (70) |

Counts are characters (Unicode code points; X counts Devanagari as 1). Use one language per bio, or English bio + Nepali
in the first post/pinned post.

**First 3 posts per platform** (same ideas, adapted):
- Facebook / LinkedIn: (1) "What is Eventlaya" with a screenshot + link to `/blog/what-is-eventlaya`; (2) a carousel
  "From registration form to front gate in 5 steps" (event page → form → pass → scan → live count); (3) the event
  planning checklist for wedding season / Mangsir (`/blog/event-planning-checklist-nepal`).
- Instagram / TikTok / YouTube Shorts: (1) 20-second screen recording: scan a pass, scan it again → duplicate alert;
  (2) "Make a registration form in 60 seconds"; (3) behind the scenes at a real event gate (with permission).
- X: (1) launch note + link; (2) thread "5 things that go wrong at event gates in Nepal" (from the QR guide);
  (3) link to the pageant voting guide.
- Post in Nepali and English (or both in one caption, Nepali first) — local audiences search and share in both.

**Then add the URLs to the site's structured data.** Edit `backend/apps/seo/site.py` (it becomes `Organization.sameAs`
in the home page JSON-LD, which helps Google and AI assistants connect the profiles to Eventlaya):

```python
SAME_AS: list[str] = [
    'https://www.facebook.com/eventlaya',          # replace each with the real profile URL
    'https://www.instagram.com/eventlaya/',
    'https://www.linkedin.com/company/eventlaya/',
    'https://www.youtube.com/@eventlaya',
    'https://www.tiktok.com/@eventlaya',
    'https://x.com/eventlaya',
]
```
Only list profiles that exist and are clearly Eventlaya's (same name/logo, link back to eventlaya.com). Also add the
GBP "share" URL and the Crunchbase/LinkedIn URLs once live. Deploy (`SKIP_FRONTEND=1 deploy/deploy.sh` is enough), then
check the home page in https://search.google.com/test/rich-results.

---

## 4. Directories and citations

Use the NAP block exactly. Priority: P1 = this month, P2 = next month, P3 = optional.

| Directory | URL | What it is | Cost | Priority | Notes / verification |
|---|---|---|---|---|---|
| Google Business Profile | https://business.google.com | Maps / local pack | Free | P1 | Nepal supported (https://support.google.com/business/answer/6270107). Eligibility caveat §2.1. |
| Bing Places for Business | https://www.bingplaces.com | Bing Maps; feeds Copilot/ChatGPT search | Free | P1 | Can import from GBP. **Nepal coverage unverified — check before using.** |
| Apple Business Connect | https://businessconnect.apple.com | Apple Maps / Siri | Free | P3 | **Availability in Nepal unverified — check before using.** |
| Facebook Page | https://www.facebook.com/pages/create | Main local social channel | Free | P1 | Fill About, category, email, website, service area. |
| LinkedIn company page | https://www.linkedin.com/company/setup/new/ | B2B trust, colleges, sponsors | Free | P1 | |
| Crunchbase | https://www.crunchbase.com | Company profile cited by AI assistants | Free basic | P2 | Needs founders + founding date (real ones only). |
| G2 | https://www.g2.com/categories/event-management | Software review site; "Event Management" category exists | Free vendor profile | P2 | Reviews only from real users; don't incentivise. |
| Capterra / GetApp (Gartner) | https://www.capterra.com/vendors/ | Software directory | Free basic listing | P3 | Listing terms **unverified — check before using.** |
| AlternativeTo | https://alternativeto.net | "Alternatives to …" lists, often cited by AI | Free | P3 | List as an alternative to the tools organizers in Nepal actually compare. |
| Product Hunt | https://www.producthunt.com | Launch platform | Free | P3 | Only when the English UI and a demo event are polished. |
| Nepal Invests | https://nepalinvests.com | Free Nepali startup discovery directory + LinkedIn feature | Free | P2 | Described by AeroLeads (https://aeroleads.com/c/nepalinvests); **form not verified — check before using.** |
| NAS-IT (Nepal Association for Software and IT Services Companies) | https://nasit.org.np | Software industry association; member directory at `/members/` | Membership (Associate tier for companies < 3 years old) | P2 | Verified 2026-10-28; membership is for companies, ~2 weeks to process. |
| CAN Federation | https://can.org.np | ICT federation with 74 district branches | Membership | P2 | Ask the Sunsari/Morang district branch about local ICT events and member listing. |
| FNCCI — Koshi Province | https://koshi.fncci.org | Provincial chamber federation; member database of district/municipal chambers | Via a district chamber | P2 | Join the local chamber (below) to appear in member lists. |
| CNI (Confederation of Nepalese Industries) | **unverified URL — check before using** | National industry body | Membership | P3 | Mostly large industry; low priority. |
| Cybo | https://www.cybo.com | Global directory with Nepal listings ("Add a business") | Free | P3 | |
| NepalYP | https://www.nepalyp.com/create-business-listing | Nepal business directory | **Paid** (USD 20 one-time and up; payments to a US company) | P3 | Optional; no free tier shown on 2026-10-28. |
| Nepali Search Engine | https://nepalisearchengine.com | Nepal business directory | ? | P3 | **Unverified — check before using.** |
| Koshi Province Government | https://koshi.gov.np | Official provincial site | — | — | No business listing found; useful only for news/tenders. |

### 4.1 Chambers of commerce in Koshi Province
Source for every row: FNCCI district/municipal chamber list, https://fncci.org/member/dmlcci.php (fetched 2026-10-28;
emails for each chamber are listed there). Membership usually requires a registered business and a fee — ask.

| Chamber | Town | Website / page (as listed by FNCCI) | Why |
|---|---|---|---|
| **Sunsari Chamber of Commerce & Industry** | Dharan | — (email on FNCCI page) | Home chamber — join first. |
| Chamber of Commerce & Industry, Itahari, Sunsari | Itahari-4 | — | Itahari events, trade fairs. |
| Chamber of Commerce & Industry, Inaruwa | Inaruwa | https://www.facebook.com/cci.inaruwa | District HQ. |
| Morang Chamber of Commerce & Industry | Biratnagar-7 | https://morangcci.org.np | Biratnagar business events, expos. |
| Chamber of Industries, Morang | Biratnagar-2 | https://www.cim.org.np/ | Industry events in Biratnagar. |
| Birtamode Chamber of Commerce & Industry | Birtamod-1 | https://www.facebook.com/cci.birtamod | Jhapa's commercial hub. |
| Damak Chamber of Commerce & Industry | Damak | https://www.facebook.com/dcci.damak | |
| Mechi Chamber of Commerce & Industry | Mechinagar (Dhulabari) | http://www.mechicci.org.np/ | |
| Jhapa Chamber of Commerce & Industry | Bhadrapur-6 | — | District chamber. |
| Kankai Chamber of Commerce & Industry | Kankai (Surunga) | Facebook (on FNCCI page) | |
| Urlabari / Belbari / Pathari chambers | Morang | — | Smaller towns; one email each. |
| Sundardulari Udyog Banijya Sangh | Morang | http://www.sundardularicci.org | |
| Triyuga Chamber of Commerce & Industry | Gaighat | — | |
| Dhankuta Chamber of Commerce & Industry | Dhankuta | — | |
| Ilam Chamber of Commerce & Industry | Ilam | http://icciilam.org.np/ | |
| Taplejung Chamber of Commerce & Industry | Fungling | http://www.tcci.org.np | Hill HQ. |
| Panchthar CCI (Phidim), Sankhuwasabha CCI (Khandbari), Terhathum CCI (Myanglung), Bhojpur CCI, Okhaldhunga CCI, Khotang CCI (Diktel), Solukhumbu CCI (Salleri), Udayapur CCI (Katari) | Hills | Panchthar: https://www.facebook.com/panchthar.pcci; others email only | Later, for hill events. |

The Itahari chamber elected a new president in July 2026 (https://english.ratopati.com/story/69910/katuwal-elected-as-president-of-itahari-chamber-of-commerce-and-industry) — a natural moment to introduce Eventlaya for their events.

---

## 5. Backlink outreach

Principle: earn links by being useful (running a real gate, listing a venue, a guide that answers a question). No paid
links, no link swaps, no private blog networks.

### 5.1 Colleges and universities (Koshi Province)
Targets: the student union / IT club / event committee page, the college news page ("Fest registration powered by
Eventlaya" with a link), and their Facebook event posts. Verification column: "fetched" = the site was opened on
2026-10-28; "listed" = URL taken from an official directory or the college's own indexed pages.

| Institution | Town | URL | Verified |
|---|---|---|---|
| B.P. Koirala Institute of Health Sciences (BPKIHS) | Dharan | https://www.bpkihs.edu | listed (search results) |
| Purbanchal University | Biratnagar | https://www.purbanchaluniversity.edu.np | listed (official about page indexed) |
| Purwanchal Campus, IOE (TU) | Dharan | https://ioepc.edu.np (TU page: https://purc.tu.edu.np) | listed |
| Central Campus of Technology (Hattisar) | Dharan | https://www.cctdharan.edu.np (also https://cct.tu.edu.np) | listed |
| Mahendra Multiple Campus | Dharan | https://mahmc.tu.edu.np | listed (TU campus directory) |
| Mahendra Morang Adarsh Multiple Campus | Biratnagar | https://mmamc.tu.edu.np | listed (TU campus directory) |
| Sukuna Multiple Campus | Sundarharaicha, Morang | https://sukuna.edu.np | fetched |
| Itahari International College (London Met programmes) | Itahari area (listings say Sundarharaicha, Morang) | https://iic.edu.np | listed (official site indexed) |
| Eastern College of Engineering | Biratnagar | https://eascoll.edu.np | fetched |
| Purbanchal University School of Engineering | Biratnagar | https://www.puse.edu.np | listed by aggregators; **site returned an error (522) on 2026-10-28 — recheck** |
| Mechi Multiple Campus | Bhadrapur, Jhapa | https://memc.tu.edu.np | fetched |
| Damak Multiple Campus | Damak | https://damakcampus.edu.np | listed (official pages indexed) |
| Mahendra Ratna Multiple Campus | Ilam | https://mrmc.tu.edu.np | listed (TU campus directory) |
| Dhankuta Multiple Campus | Dhankuta | https://dhmc.tu.edu.np | listed (TU campus directory) |
| Itahari Namuna College | Itahari-8 | **no official website found** — use its Facebook page | unverified |

Also: school and college **IT clubs**, Rotaract/Leo clubs, and community tech events — e.g. WordCamp Biratnagar has run
before (https://biratnagar.wordcamp.org/2018/) — and hackathon organizers in Itahari/Dharan/Biratnagar.

### 5.2 Event organizers, venues and vendors
No verified websites were found for event companies or party palaces in Itahari/Dharan/Biratnagar — most run on
Facebook and Google Maps. Build the list from: Google Maps searches ("party palace Itahari", "banquet Biratnagar",
"event management Dharan", "sound and light Biratnagar"), Facebook pages, and the venues/vendors who list on
`/marketplace`. Hotels with their own sites can link from their events page (e.g. Ramada by Wyndham Itahari,
https://www.wyndhamhotels.com/ramada/itahari-nepal/ramada-itahari-pashupati-marg/overview — example only, not contacted).
Ask every marketplace listing and every organizer who used Eventlaya to add a "Tickets by Eventlaya" link.

### 5.3 News portals and media
| Outlet | URL | Why | Verified |
|---|---|---|---|
| Onlinekhabar (Nepali) / OnlineKhabar English | https://www.onlinekhabar.com, https://english.onlinekhabar.com/tag/biratnagar | Koshi province news; startup section | listed |
| Kantipur / eKantipur | https://ekantipur.com | Koshi correspondents (Jhapa, Biratnagar) | listed |
| The Kathmandu Post — Koshi Province | https://kathmandupost.com/province-no-1 | English provincial section | listed |
| Ratopati English | https://english.ratopati.com | Covers Itahari/Biratnagar business news | listed |
| Hamro Patro News | https://www.hamropatro.com/news | Widely read; Koshi city stories | listed |
| Himalpress English | https://en.himalpress.com/tag/koshi-province | Koshi tag | listed |
| Radio Nepal online — Koshi | https://onlineradionepal.gov.np/en/topics/province/koshi | State broadcaster, provincial page | listed |
| Our Biratnagar | https://ourbiratnagar.net/ | Local Biratnagar media (est. 2011) | URL from WordCamp Biratnagar sponsor page; **not opened — check** |
| Udghosh (daily, Biratnagar) | **URL unverified** | Biratnagar daily newspaper | existence only |
| Technology Khabar | https://www.technologykhabar.com | Nepali tech news (covers NAS-IT, startups) | listed |
| B360 Nepal | https://www.b360nepal.com | Business news (covers NAS-IT, CNI) | listed |
| ShareSansar | https://www.sharesansar.com | Business news (covered Morang trade expo) | listed |

Also local FM stations and Dharan/Itahari Facebook news pages — they reach the event audience directly.

### 5.4 Outreach templates
Keep each email short, send from a real person, personalise the first line, follow up once after a week, then stop.

**A. College club / student union** (owner decision: offer the free plan, or a free paid-plan month for student clubs — decide first)
```
Subject: Registration and QR entry for [Fest name]

Namaste [Name],

I'm [Your name] from Eventlaya, an event software team in Dharan. I saw that [College] runs [Fest name] every [month].

Eventlaya gives you an online registration form, a QR pass for every participant and phone-based check-in at the gate, so you get a clean list for your sponsors and a faster entry. [OFFER — e.g. "Student clubs can use the free plan for events up to 150 people" / your decision].

If it helps, I can set up your event with your team in 30 minutes, in person or on a call. If you use it, we'd appreciate a "Registration by Eventlaya" link on your fest page.

Thank you,
[Your name] · [PHONE] · support@eventlaya.com · https://eventlaya.com
```
Nepali short version:
```
नमस्ते [नाम] जी, म इभेन्टलय (धरान) बाट [तपाईंको नाम]। [कलेज] को [फेस्टको नाम] का लागि अनलाइन दर्ता फारम, हरेक सहभागीलाई QR पास र गेटमा फोनबाटै चेक-इन गर्न सकिने व्यवस्था मिलाइदिन सक्छौं। [प्रस्ताव]। तपाईंको टोलीसँग ३० मिनेटमा सेटअप गरिदिन सक्छु। चासो भए यही नम्बरमा सम्पर्क गर्नुहोला: [PHONE]
```

**B. Venue / party palace / hotel**
```
Subject: List [Venue name] on Eventlaya — free

Namaste [Name],

Eventlaya is an event platform from Dharan. Organizers in [Town] use it to find venues and vendors, and to run registration and QR check-in.

You can list [Venue name] on our marketplace (https://eventlaya.com/marketplace): photos, capacity, amenities and your available dates. Organizers send inquiries and booking requests, and you confirm or decline each one.

For events held at your venue, we can also add a small "Tickets by Eventlaya" badge you can place on your website or Facebook page.

[Your name] · [PHONE] · support@eventlaya.com
```
Nepali short version:
```
नमस्ते [नाम] जी, इभेन्टलयको मार्केटप्लेसमा [भेन्युको नाम] निःशुल्क सूचीकृत गर्न सकिन्छ — फोटो, क्षमता, सुविधा र खाली मितिहरू राख्न सकिन्छ। आयोजकले सोधपुछ र बुकिङ अनुरोध पठाउँछन्, तपाईंले स्वीकार वा अस्वीकार गर्नुहुन्छ। विवरण: https://eventlaya.com/marketplace
```
(Listing has no fee in the product today — `apps/marketplace` has no listing charge — and each listing is approved by
Eventlaya before it appears. If you ever charge for featured listings, change "free" in this template.)

**C. News portal (press note)**
```
Subject: Press note: Dharan-built event platform for Eastern Nepal

Namaste [Editor's name],

Please find below a short press note about Eventlaya, an event registration and check-in platform built in Dharan for organizers in Koshi Province. Photos and a demo are available on request, and [FOUNDER NAME] is available for an interview in Nepali or English.

[Paste the press release, §6]

[Your name] · [PHONE] · support@eventlaya.com
```

**D. Event organizer — case study (only with permission and real numbers)**
```
Subject: Could we write about [Event name]?

Namaste [Name],

Thank you for running [Event name] on Eventlaya. We'd like to write a short case study for our blog: what the event was, how registration and the gate worked, and what you'd do differently. We would use only numbers you approve (for example registrations and check-ins) and send you the draft before publishing. You'd get a link back to your page.

Would that be OK?

[Your name]
```

**E. Chamber of commerce**
```
Subject: Membership enquiry — Eventlaya (event software, Dharan)

Namaste,

Eventlaya is a software business based in Dharan that helps organizers run event registration, QR passes and gate check-in. We would like to know the membership process and fees for [Chamber name], and whether members are listed in your directory.

We'd also be glad to support the chamber's own events — trade fairs, seminars, award programmes — with registration and check-in.

[Your name] · [PHONE] · support@eventlaya.com · https://eventlaya.com
```

---

## 6. Press release

Use only when there is something real to announce (public launch, online payments live, first big event on the gate).
Replace every placeholder; do not add numbers you can't back up.

```
FOR IMMEDIATE RELEASE

Eastern Nepal startup launches event platform for organizers in Koshi Province

Dharan, [LAUNCH DATE] — Eventlaya, a software startup based in Dharan, has launched an online platform that helps organizers in Eastern Nepal run event registration, ticketing and gate check-in from one place.

Many events in the region still run on paper lists, phone calls and screenshots of payments, and gates slow down when hundreds of people arrive at once and mobile data weakens. Eventlaya was built in Dharan to handle these local conditions.

Organizers create an event page with a registration form they design themselves, set up ticket types such as General, Student or VIP, add promo codes for partners or students, and share a single link on social media and messaging apps. Every attendee receives a QR code pass on screen and by email. At the venue, gate staff scan passes with a phone camera; the system flags passes that were already used and shows how many people are inside. Attendees can pay at the venue, and organizers can also accept online payment through Khalti and eSewa where it is enabled. [Remove the last sentence if online payments are not live on the launch date.]

The platform also supports pageant and talent-contest voting, with judges scoring on their phones and public votes confirmed by SMS or email codes, as well as team chat for event crews and a marketplace where venues and vendors in the region publish their services and accept booking requests. Organizations that want their own branding can run their events on their own web address.

"[QUOTE — founder name, title: why Eventlaya was built in Dharan and what problem it solves for local organizers]," said [FOUNDER NAME], [title] of Eventlaya.

Eventlaya is aimed at colleges, clubs, schools, event companies, festivals and venues in Biratnagar, Itahari, Dharan, Damak, Birtamod and across Koshi Province, though events anywhere in Nepal can use it. A free plan is available for small events; paid plans are listed at eventlaya.com/pricing.

About Eventlaya
Eventlaya (इभेन्टलय) is event management software built in Dharan for organizers in Eastern Nepal. It covers event pages, online registration, QR passes, gate check-in, contest voting, team tools and a venue and vendor marketplace. Website: https://eventlaya.com

Media contact
[FOUNDER NAME] · [CONTACT PHONE] · support@eventlaya.com
```

**नेपाली शीर्षक:** धरानमा बनेको इभेन्ट प्लेटफर्म 'इभेन्टलय' सार्वजनिक, कोशीका आयोजकलाई अनलाइन दर्तादेखि गेट चेक-इनसम्म एकै ठाउँमा

```
धरान, [मिति] — धरानको सफ्टवेयर स्टार्टअप इभेन्टलयले पूर्वी नेपालका कार्यक्रम आयोजकका लागि अनलाइन दर्ता, टिकट र गेट चेक-इन एकै ठाउँबाट गर्न सकिने प्लेटफर्म सार्वजनिक गरेको छ। आयोजकले आफ्नै प्रश्नसहितको दर्ता फारम र जनरल, विद्यार्थी, भीआईपीजस्ता टिकटका प्रकार बनाएर एउटै लिंक सामाजिक सञ्जालमा बाँड्न सक्छन्। दर्ता गर्ने हरेक व्यक्तिले स्क्रिन र इमेलमा QR पास पाउँछन्, र गेटमा कर्मचारीले फोनको क्यामेराबाटै पास स्क्यान गर्छन्।

प्लेटफर्मले सौन्दर्य तथा प्रतिभा प्रतियोगितामा निर्णायकको अंक र SMS वा इमेल कोडबाट पुष्टि हुने दर्शक भोट, कार्यक्रम टोलीका लागि च्याट, र भेन्यु तथा सेवा प्रदायकलाई बुकिङ अनुरोध लिन मिल्ने मार्केटप्लेस पनि दिन्छ। विराटनगर, इटहरी, धरान, दमक, बिर्तामोडलगायत कोशी प्रदेशका कलेज, क्लब, विद्यालय, इभेन्ट कम्पनी र भेन्युलाई लक्षित यो प्लेटफर्ममा साना कार्यक्रमका लागि निःशुल्क योजना पनि छ। "[उद्धरण — संस्थापकको नाम, पद]"
```

---

## 7. Search Console and Bing Webmaster Tools

### 7.1 Google Search Console
**Option A — URL-prefix property with an HTML tag (uses the superadmin setting being built now):**
1. https://search.google.com/search-console → Add property → **URL prefix** → `https://eventlaya.com/`.
2. Choose **HTML tag**. Google shows `<meta name="google-site-verification" content="AbC123…" />`.
3. Copy only the **content value** (`AbC123…`) and paste it into **Superadmin → Analytics → "Search Console verification"**.
   (The backend in `apps/site_analytics` also accepts the whole tag or the `google-site-verification=…` DNS form and keeps
   only the code.) Save, deploy if the setting isn't live yet, then open the home page source and check the tag is there.
4. Back in Search Console → **Verify**. Keep the tag in place forever (removing it un-verifies the property).

**Option B — Domain property via Cloudflare DNS (covers www/api/subdomains too):**
1. Add property → **Domain** → `eventlaya.com` → copy the TXT value `google-site-verification=…`.
2. Cloudflare → DNS → Add record: Type `TXT`, Name `@`, Content = the value, Proxy status n/a (TXT is always DNS only) → Save.
3. Wait a few minutes → Verify. (You can have both properties; the Domain property shows white-label subdomains too.)

**Then (either option):**
1. **Sitemaps** → submit `https://eventlaya.com/sitemap.xml` (it's an index: pages, events, marketplace, blog).
2. **URL inspection** → "Request indexing" for: `/`, `/blog`, `/pricing`, `/events`, `/marketplace`,
   `/blog/event-management-software-nepal-guide`, `/blog/how-to-organize-an-event-in-itahari`,
   `/blog/how-to-organize-an-event-in-dharan`, `/blog/how-to-organize-an-event-in-biratnagar`, and the Nepali pillar
   guide once published (its slug is in the blog seed files, 14+). About 10 requests a day is the practical limit.
3. Settings → Users: add a second owner (backup account).

### 7.2 Bing Webmaster Tools (also feeds ChatGPT search, Copilot, DuckDuckGo)
1. https://www.bing.com/webmasters → **Import from Google Search Console** (fastest; brings the site and sitemaps), or
   add `https://eventlaya.com/` manually.
2. Manual verification: Bing offers an XML file, a **`msvalidate.01` meta tag**, or a DNS CNAME. The analytics backend
   has a Bing verification setting (`apps/site_analytics`, field "Bing Webmaster Tools: content of the msvalidate.01 meta
   tag"); **confirm the superadmin page shows it** — if it does, paste the content value there the same way as Google's.
   Otherwise use the DNS CNAME in Cloudflare.
3. Submit `https://eventlaya.com/sitemap.xml`.
4. **IndexNow**: Cloudflare → Caching → Configuration → **Crawler Hints: On** pings Bing/Yandex when pages change. No code needed.
5. White-label clients: they verify their own domain and submit `https://<their-domain>/sitemap.xml`.

### 7.3 Weekly (15 minutes, e.g. every Sunday)
- **Pages (indexing)**: new "Not indexed" reasons? "Crawled – currently not indexed" on blog posts → improve/merge;
  "Duplicate without user-selected canonical" → check canonicals; 404s from old links.
- **Performance → Search results**, last 7 days vs previous: queries containing *event*, *Itahari*, *Dharan*,
  *Biratnagar*, *Koshi*, *ticket*, *voting*, Nepali queries (इभेन्ट, टिकट, कार्यक्रम). Filter **Country = Nepal**.
- New events/venues indexed? (URL inspection on one new event page.)
- Bing → Site Explorer / Search Performance: same queries.
- GBP **[if created]**: new reviews (reply), new photos by users, profile edits suggested by Google (accept/reject).

### 7.4 Monthly
- **Performance by page**: which guides get impressions but low CTR → rewrite the title/description (≤ 60/≤ 155 chars).
- **Queries at position 8–20** → add a section or FAQ to the matching post, or write the missing post.
- **Enhancements**: Event, Breadcrumbs, FAQ (rich results limited by Google but data still read), Review snippets (none
  expected — no ratings are published). Fix any "invalid item".
- **Core Web Vitals** (mobile): LCP/INP/CLS for `/`, `/blog/*`, `/e/*`. Compare with PageSpeed Insights.
- **Manual actions** and **Security issues**: should both say "No issues".
- **Links report**: top linking sites — thank and keep partners (colleges, venues); disavow nothing unless there's a manual action.
- **hreflang (en ↔ ne posts)**: Search Console no longer has an International Targeting report, so spot-check with URL
  inspection → "View crawled page" → HTML: each paired post should list both `hreflang="en"` and `hreflang="ne"`
  alternates plus `x-default`, pointing at indexable 200 URLs, and each should be its own canonical. Check that Nepali
  posts get impressions from Nepali queries.
- **AI answers** (log in a sheet: date, engine, question, cited?, URL): ChatGPT (search on), Perplexity, Gemini, Google AI
  Overview, Copilot — "best event management software in Eastern Nepal", "how to sell event tickets online in Nepal",
  "QR check-in app for events in Dharan", "online voting for pageant Nepal", "event venues in Itahari", "what is Eventlaya",
  and one Nepali question ("नेपालमा अनलाइन टिकट कसरी बेच्ने?").
- **Citations**: NAP still identical everywhere (especially after the phone number is chosen).

---

## 8. Owner actions, in priority order

1. **Decide the phone number**, make sure **support@eventlaya.com** is a working, read mailbox, and confirm the legal entity name.
2. **Search Console** (Option A via the superadmin field, or Option B via Cloudflare TXT) → submit the sitemap → request
   indexing for the key URLs. Then **Bing**: import from Search Console, submit the sitemap, turn on Cloudflare Crawler Hints.
3. **Facebook Page, Instagram, LinkedIn page** with the bios above (same logo/link) → then YouTube, TikTok, X.
4. **Add the profile URLs to `SAME_AS`** in `backend/apps/seo/site.py` and deploy.
5. **Google Business Profile** — only if you visit organizers in person (§2.1): name "Eventlaya", primary "Software
   company", service-area business with the 20 areas, description, services, photos; verify by video from Dharan.
   Add "Event ticket seller" when online payments are live; "Event management company" only if you sell that service.
6. Publish the **first GBP post**, then one a week (§2.7); answer every review.
7. **Join the Sunsari Chamber of Commerce & Industry (Dharan)** and ask NAS-IT about Associate membership; list on Crunchbase and Nepal Invests.
8. **Outreach**: 5 colleges/clubs per week (§5.1, template A), every venue/vendor you meet (template B), and a press note
   to 3–5 portals (§5.3, template C) when there is real news (launch, online payments, a notable event on the gate).
9. After each event: **review request** to the organizer (§2.10) and, with permission, a **case study** (template D).
10. Monthly: run the §7.4 checklist and the AI-answer spot checks; keep NAP identical.

### Still to confirm (could not be verified online on 2026-10-28)
- Whether the GBP picker for Nepal offers "Event ticket seller", "Software company" and "Event management company" (seen
  in a 2026 third-party category list, not in Google's own docs).
- Bing Places and Apple Business Connect availability for Nepal.
- Handles @eventlaya on each platform.
- URLs: CNI, Udghosh, Nepali Search Engine, Nepal Invests submission form, Itahari Namuna College (no site found),
  PU School of Engineering (site down when checked), Our Biratnagar (not opened).
- The superadmin Analytics page fields (Google field confirmed in the backend; Bing field exists in the backend — check the UI).
