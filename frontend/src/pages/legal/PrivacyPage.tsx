import React from 'react'
import { Link } from 'react-router-dom'
import { COMPANY_LOCATION, COMPANY_NAME, LEGAL_PATHS, MINIMUM_AGE, SITE_DOMAIN } from '@/lib/legal'
import { Email, LegalPage, type LegalSection } from './LegalPage'
import { AnalyticsChoice } from './AnalyticsChoice'

/**
 * /privacy — written from what the code does (see docs/play-store.md for the data map).
 * Keep it in step with the backend: account deletion (apps/accounts/account.py), uploads (apps/core/uploads.py),
 * voting identifiers (apps/voting), push tokens (apps/core/fcm.py), Google Analytics (lib/analytics.ts, docs/analytics.md).
 */
const sections: LegalSection[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    content: (
      <>
        <p>
          {COMPANY_NAME} (“we”, “us”) runs {SITE_DOMAIN}, the white-label event sites that organizers run on Eventlaya, and the Eventlaya
          mobile app. We are based in {COMPANY_LOCATION}. Eventlaya helps people run events (registration, QR passes, gate check-in, voting,
          team chat) and helps them find vendors and venues.
        </p>
        <p>
          This policy explains what personal information we handle, why, who sees it, how long we keep it and what you can do about it. It
          applies to everyone who uses Eventlaya: people who register for events, organizers, gate staff, vendors and venue owners, and
          visitors who are just looking around.
        </p>
      </>
    ),
  },
  {
    id: 'roles',
    title: 'Who is responsible for your data',
    content: (
      <>
        <p>
          <strong>Eventlaya is the platform.</strong> We are responsible for your Eventlaya account (your sign-in details and profile) and
          for how the platform itself works.
        </p>
        <p>
          <strong>Event organizers decide what they collect.</strong> When you register for an event, the organizer chooses the questions
          on the registration form and uses your answers to run their event. The organizer is responsible for that information and for
          how they use it. We store and process it on their behalf, and we only use it to provide the service to them and to you. The same
          applies to organizers who run their own branded (“white-label”) site on Eventlaya, such as an event on their own domain.
        </p>
        <p>
          <strong>Vendors and venue owners</strong> are responsible for what they do with the inquiries and booking requests you send
          them.
        </p>
        <p>
          If you have a question about how an organizer uses your registration, ask them first; their contact details are on the event
          page. You can always contact us too, and we will help.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-collect',
    title: 'What we collect',
    content: (
      <>
        <p>We only collect what the service needs. What that is depends on how you use Eventlaya.</p>

        <h3>Everyone, including visitors without an account</h3>
        <ul>
          <li>
            <strong>Technical information</strong> that any website or app receives: your IP address, browser or device type and the pages or
            features you request. Our servers and our network provider (Cloudflare) keep this in logs to deliver the service, stop abuse and
            fix problems. Some features also use your IP address to limit repeated attempts (for example, password resets and voting).
          </li>
          <li>
            <strong>Usage statistics</strong> on {SITE_DOMAIN}: which pages are visited and a few actions, through Google Analytics, without
            your name, email or phone number. See <a href="#analytics">Analytics</a>, where you can also turn it off.
          </li>
          <li>
            <strong>Information stored on your device</strong> to make the site and app work, described under{' '}
            <a href="#cookies">Cookies and local storage</a>.
          </li>
        </ul>

        <h3>People who register for events (attendees)</h3>
        <ul>
          <li>
            Your <strong>name, email address and mobile number</strong> (the mobile number is optional unless the organizer requires it),
            and the names of any guests you get passes for.
          </li>
          <li>
            <strong>Answers to the organizer’s questions.</strong> Organizers can add their own questions to the registration form, so this
            can include other details they ask for. Only give what you are comfortable sharing with that organizer.
          </li>
          <li>
            <strong>Your tickets:</strong> ticket type, price, promo code, order reference, the QR code on your pass and its status.
          </li>
          <li>
            <strong>Check-in records:</strong> when your pass was scanned in or out, at which gate, and which staff member’s account scanned
            it.
          </li>
          <li>
            <strong>Votes</strong> in event polls. We don’t store your phone number or email with a vote. Each vote carries a one-way
            scrambled code (a hash) made from your ticket, your contact, a random ID kept on your device or, for open polls without that ID,
            your IP address, so nobody can vote twice. In polls where you vote with your ticket, the vote is also linked to that ticket inside
            our system so it is counted once and cancelled tickets are excluded. Organizers see the results and an anonymous voter code, not
            your name.
          </li>
          <li>
            <strong>Reviews</strong> you write (a star rating and optional text). Reviews are public and show your first name and the first
            letter of your last name, never your email.
          </li>
        </ul>

        <h3>Account holders (everyone who signs up)</h3>
        <ul>
          <li>
            <strong>Account details:</strong> name, email address, phone number (optional for most accounts), city, organization or business
            name, your account type (attendee, organizer, gate staff, vendor) and an optional profile photo.
          </li>
          <li>
            <strong>Your password</strong>, stored only as a secure one-way hash. We cannot see it.
          </li>
          <li>
            <strong>Email verification:</strong> whether you confirmed your email. The 6-digit codes we send are stored only as hashes and
            expire.
          </li>
          <li>
            <strong>Your agreement</strong> to these policies: the date and the version you agreed to.
          </li>
        </ul>

        <h3>If you sign in with Google or Facebook</h3>
        <p>
          We receive your name, email address, whether the provider has verified that email, and the provider’s ID for your account. We
          use them to sign you in and to create or match your Eventlaya account. We do not receive your Google or Facebook password, your
          contacts, your posts or your friends list, and we never post anything on your behalf.
        </p>

        <h3>Organizers</h3>
        <ul>
          <li>
            Your events (title, dates, venue, pictures, schedule, ticket types, prices, promo codes, the organizer contact details you choose
            to show), your registration forms, polls, gates and event tasks.
          </li>
          <li>
            Details of the team members you add (name, email, phone number) and which gate they are assigned to.
          </li>
          <li>
            <strong>Team chat:</strong> messages and photos sent in your organization’s chats, and who has read them.
          </li>
          <li>
            <strong>Plans and billing:</strong> your plan, billing period and the payments our team records for you (amount, date, method such
            as eSewa, Khalti, Fonepay or bank transfer, and a reference number). We do not receive or store card numbers or your bank or wallet
            login.
          </li>
          <li>
            <strong>White-label sites:</strong> your brand name, logo, colours, support email, footer text and domain, and the technical
            records used to verify the domain and set up its security certificate.
          </li>
        </ul>

        <h3>Gate staff and team members</h3>
        <ul>
          <li>The account your organizer created for you (name, email, phone number) and your gate assignment.</li>
          <li>The scans you make (time, gate, result, and basic device information sent by the scanner) and tasks assigned to you.</li>
          <li>Team chat messages and photos you send, and read receipts.</li>
        </ul>

        <h3>Vendors and venue owners</h3>
        <ul>
          <li>
            Your listings: business or venue name, description, photos, prices, address, contact person and phone number. Listings are public.
          </li>
          <li>Your availability calendar, and the booking requests and inquiries you receive and your replies to them.</li>
        </ul>

        <h3>People who contact a vendor or venue</h3>
        <p>
          Your name, email, phone number, the event type, date, guest count, budget and the message you write, plus the time slot if you
          request a booking.
        </p>

        <h3>Push notifications</h3>
        <p>
          If you allow notifications in the app, we store a notification token for your device (from Firebase Cloud Messaging) and the
          device type, so we can send you alerts.
        </p>
      </>
    ),
  },
  {
    id: 'how-we-use',
    title: 'How we use it',
    content: (
      <>
        <ul>
          <li>To create and run your account and sign you in, including with Google or Facebook.</li>
          <li>To register you for events, issue passes with QR codes, send your passes by email and check you in at the gate.</li>
          <li>To let organizers manage their events, attendees, gate staff, tasks, polls and team chat.</li>
          <li>To pass your inquiry or booking request to the vendor or venue you contacted, and to send you their reply.</li>
          <li>
            To send service messages: email verification codes, password resets, passes, booking updates and push notifications you have
            allowed.
          </li>
          <li>To show public content you chose to publish, such as reviews and listings.</li>
          <li>To manage plans and record payments.</li>
          <li>To keep Eventlaya secure: preventing fraud, spam, duplicate votes and misuse, and investigating reports.</li>
          <li>
            To fix problems and improve the service, including usage statistics for {SITE_DOMAIN} (see <a href="#analytics">Analytics</a>).
          </li>
          <li>To meet legal obligations, such as keeping billing records.</li>
        </ul>
        <p>
          <strong>We do not sell your personal information, we do not show ads, and we do not use your information to build advertising
          profiles.</strong> We do not send marketing emails today. If we ever do, you will be able to opt out at any time.
        </p>
      </>
    ),
  },
  {
    id: 'legal-basis',
    title: 'Why we are allowed to use it',
    content: (
      <>
        <p>We use your information because:</p>
        <ul>
          <li>
            <strong>You asked us to.</strong> Creating an account, registering for an event, sending an inquiry or posting a review are things
            you choose to do, and we need your information to do them.
          </li>
          <li>
            <strong>You agreed.</strong> When you sign up, you agree to our <Link to={LEGAL_PATHS.terms}>Terms of service</Link> and this
            policy. Some things are optional and need your separate permission, such as push notifications, the camera and an organizer’s
            optional questions. You can withdraw your permission at any time (see <a href="#your-rights">Your rights and choices</a>).
          </li>
          <li>
            <strong>We need to keep the service safe and working,</strong> for example logs and abuse prevention, and to understand how
            the website is used (analytics, which you can turn off).
          </li>
          <li>
            <strong>The law requires it,</strong> for example keeping billing records.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    content: (
      <>
        <ul>
          <li>
            <strong>The organizer of an event you register for</strong> sees your registration details, your answers, your tickets and your
            check-in times. Their gate staff see your name and pass details when they scan your pass.
          </li>
          <li>
            <strong>The vendor or venue you contact</strong> sees your inquiry or booking request and the contact details in it.
          </li>
          <li>
            <strong>Your team:</strong> in team chat, members of a conversation see your name, photo, messages and whether you have read them.
          </li>
          <li>
            <strong>The public:</strong> event pages, listings, reviews (first name and last initial) and owner replies are public.
          </li>
          <li>
            <strong>Service providers</strong> who run parts of Eventlaya for us, only for that purpose:
            <ul>
              <li>DigitalOcean: our servers, database and uploaded files (data centre in Bangalore, India).</li>
              <li>
                Cloudflare: network, security and HTTPS for our websites and white-label domains (and, if we turn it on, cookieless visit
                counts with Cloudflare Web Analytics).
              </li>
              <li>Google Analytics: usage statistics for {SITE_DOMAIN}, as described under <a href="#analytics">Analytics</a>.</li>
              <li>Google Firebase Cloud Messaging: delivering push notifications to the app.</li>
              <li>Google and Facebook (Meta): only if you choose to sign in with them.</li>
              <li>Our email delivery provider: sending verification codes, passes and notifications.</li>
            </ul>
          </li>
          <li>
            <strong>Authorities,</strong> when Nepali law requires it or to protect people’s safety, and only as much as required.
          </li>
          <li>
            <strong>A new owner,</strong> if Eventlaya is ever merged or sold. This policy would continue to protect your information, and we
            would tell you first.
          </li>
        </ul>
        <p>We do not share your information with anyone else without your permission.</p>
      </>
    ),
  },
  {
    id: 'where',
    title: 'Where your data is stored',
    content: (
      <>
        <p>
          Our servers, database and uploaded files are hosted by DigitalOcean in Bangalore, <strong>India</strong>. That means your information
          leaves Nepal when you use Eventlaya. Cloudflare, Google (Firebase and Analytics) and our email provider may process some of it in other countries
          as part of delivering their service. We choose providers that protect data with industry-standard security.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    content: (
      <>
        <ul>
          <li>
            <strong>Your account</strong> is kept until you delete it. See <Link to={LEGAL_PATHS.deleteAccount}>Delete your account</Link> for
            exactly what is removed.
          </li>
          <li>
            <strong>Event registrations, tickets and check-in records</strong> belong to the organizer’s event records. They stay with the
            event, even if you delete your Eventlaya account, for as long as the organizer keeps their account, so organizers can keep their
            attendance and payment records. Events that have registrations can be cancelled but not deleted. If you want your details removed
            from a past event, ask the organizer or write to us.
          </li>
          <li>
            <strong>Inquiries and booking requests</strong> stay with the vendor or venue you sent them to.
          </li>
          <li>
            <strong>Reviews</strong> stay until you delete them or your account.
          </li>
          <li>
            <strong>Team chat messages</strong> stay in the conversation until the sender deletes them (deleted messages lose their text) or
            the organization’s chat is removed.
          </li>
          <li>
            <strong>Billing records</strong> are kept as long as the law requires.
          </li>
          <li>
            <strong>Notification tokens</strong> are kept while you have an account and removed when you delete it.
          </li>
          <li>
            <strong>Server logs</strong> are kept only for a limited time for security and troubleshooting.
          </li>
          <li>Deleted information may remain in backup copies for a limited time before it is overwritten.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    content: (
      <>
        <ul>
          <li>All traffic to our websites, our API and the app is encrypted with HTTPS.</li>
          <li>Passwords and email codes are stored only as one-way hashes. Vote identifiers are hashed too.</li>
          <li>
            Access is limited by role: organizers only see their own events and attendees, vendors only see their own inquiries, and team chat
            is limited to members of the conversation.
          </li>
          <li>
            Photos you upload (profile pictures, listing photos, chat photos) are stored at long, random web addresses that can’t be guessed.
            Anyone who has the exact address can open the photo, so please don’t upload sensitive documents.
          </li>
        </ul>
        <p>
          No system is perfectly secure. If we learn of a breach that affects your personal information, we will tell you and the relevant
          authorities as the law requires. Keep your password private and use “Keep me signed in” only on your own devices.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    content: (
      <>
        <p>
          You need to be at least <strong>{MINIMUM_AGE} years old</strong> to create an Eventlaya account on your own. Younger people can
          register for events or use an account only with the permission and supervision of a parent or guardian, who is responsible for
          that use. We set this age because events often involve sharing contact details with organizers and other people.
        </p>
        <p>
          We do not knowingly collect information from children under {MINIMUM_AGE} without a parent’s or guardian’s permission. If you
          believe a child has given us information without permission, contact us at <Email subject="Child account" /> and we will delete it.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights and choices',
    content: (
      <>
        <p>You can:</p>
        <ul>
          <li>
            <strong>See your information:</strong> your profile, tickets, inquiries and reviews are in your account (in the app or at{' '}
            {SITE_DOMAIN}/app). For a copy of everything we hold about you, email us.
          </li>
          <li>
            <strong>Correct it:</strong> edit your profile in the app or on the website. For details an organizer holds about your
            registration, ask the organizer or us.
          </li>
          <li>
            <strong>Delete it:</strong> delete your account yourself in the app or on the website, or ask us by email. See{' '}
            <Link to={LEGAL_PATHS.deleteAccount}>Delete your account</Link>.
          </li>
          <li>
            <strong>Withdraw your consent:</strong> turn off notifications or camera access in your phone settings, remove a review, or
            delete your account. Withdrawing consent doesn’t affect what we did before.
          </li>
          <li>
            <strong>Object or complain:</strong> tell us if you think we have used your information wrongly. You can also complain to the
            relevant authority in Nepal.
          </li>
        </ul>
        <p>
          To use any of these rights, write to <Email subject="Privacy request" /> from the email address on your account. We may ask you to
          confirm your identity. We will reply within 30 days. If your request is about an organizer’s event data, we will pass it to the
          organizer and help them answer it.
        </p>
      </>
    ),
  },
  {
    id: 'notifications',
    title: 'Push notifications and emails',
    content: (
      <>
        <p>
          The app asks for permission before sending push notifications. We use them for things that need your attention: team chat
          messages, booking requests and replies, gate alerts and messages from your organizer to their gate staff.
        </p>
        <p>
          <strong>To turn them off:</strong> on Android, open Settings → Apps → Eventlaya → Notifications, or long-press a notification and
          choose to turn it off. You can also uninstall the app.
        </p>
        <p>
          We send emails only for the service: verification codes, password resets, passes, and booking updates. Emails for an event may show
          the organizer’s branding.
        </p>
      </>
    ),
  },
  {
    id: 'app-permissions',
    title: 'Camera and photos in the app',
    content: (
      <>
        <ul>
          <li>
            <strong>Camera:</strong> used to scan QR codes on passes at the gate (organizers and gate staff) and to take a photo when you
            choose to (profile picture, chat). The camera image used for scanning is processed on your phone and is not uploaded.
          </li>
          <li>
            <strong>Photos:</strong> when you choose a picture, Android’s photo picker shares only that picture with the app. We upload only
            the photos you choose to send.
          </li>
        </ul>
        <p>The app doesn’t access your contacts, location, microphone or files.</p>
      </>
    ),
  },
  {
    id: 'analytics',
    title: 'Analytics',
    content: (
      <>
        <p>
          On {SITE_DOMAIN} we use <strong>Google Analytics</strong> to learn how many people visit, which pages they find useful, where they
          come from and where sign-up, registration and checkout get stuck, so we can improve them. It is not used on the white-label sites
          organizers run on their own domains, and the mobile app has no analytics.
        </p>
        <h3>What Google Analytics receives</h3>
        <ul>
          <li>
            The pages you open, with private parts of the address removed first: pass links, password-reset and verification links,
            payment details, email addresses, phone numbers and codes never leave your browser. Pages inside your account (the dashboard and
            admin screens) are not measured unless we decide to, and then with the same clean-up.
          </li>
          <li>
            Where you came from (the previous website or a campaign link), your approximate location (city and country), language, and
            device, browser and screen type.
          </li>
          <li>
            A few actions, without saying who you are: that an account was created or someone signed in (and whether with email, Google or
            Facebook), that a registration was completed (the event, number of tickets and amount), that an online payment went through (the
            order reference, amount and ticket types), that a vote or a vote pack purchase was made (which poll or contest, not who voted or
            for whom), that an inquiry was sent to a venue or vendor, that a page was shared, and the words used in searches (with emails and
            numbers removed).
          </li>
        </ul>
        <p>
          We never send your name, email address, phone number, the answers you give on registration forms, the code on your pass or payment
          details to Google Analytics.
        </p>
        <h3>Cookies, IP address and how long it is kept</h3>
        <ul>
          <li>
            Google Analytics sets two first-party cookies, <code>_ga</code> and <code>_ga_&lt;ID&gt;</code>, holding a random ID for your browser so
            that repeat visits can be counted. They expire after up to 2 years.
          </li>
          <li>
            Google Analytics uses your IP address only to work out an approximate location, and does not log or store it. We have turned off
            Google signals, ad personalization and advertising cookies: this data is not used for advertising.
          </li>
          <li>We keep Google Analytics data for 14 months; after that Google deletes it. Reports only show totals.</li>
          <li>Google may process this data in other countries, including the United States, under its own privacy terms.</li>
        </ul>
        <h3>Your choice</h3>
        <p>
          You can turn analytics off for this browser here at any time. If your browser sends a “Do Not Track” or “Global Privacy Control”
          signal, we don’t load Google Analytics at all. You can also use Google’s{' '}
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
            opt-out browser add-on
          </a>{' '}
          or a content blocker.
        </p>
        <AnalyticsChoice />
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and local storage',
    content: (
      <>
        <p>
          <strong>We don’t use advertising cookies, and we don’t track you across other websites.</strong> On {SITE_DOMAIN}, Google Analytics
          sets the <code>_ga</code> cookies described under <a href="#analytics">Analytics</a>, unless you turn it off. The website also stores a
          few things in your browser (local storage) so it works:
        </p>
        <ul>
          <li>Your sign-in session (kept until you sign out if you choose “Keep me signed in”, otherwise until you close the browser).</li>
          <li>Passes you registered for, so you can open them again on this device.</li>
          <li>A registration you haven’t finished yet, until you close the tab.</li>
          <li>Polls you have voted in, and a random ID for this device used for one-vote-per-device polls.</li>
          <li>Small preferences, such as the event you last selected, whether the sidebar is collapsed and whether you turned analytics off.</li>
        </ul>
        <p>
          The app stores similar things on your phone: your sign-in session, saved passes, your selected event and gate, and scans waiting to
          be sent when the phone is offline.
        </p>
        <p>
          If you use “Continue with Google” or “Continue with Facebook” on the website, their sign-in buttons load from Google or Facebook and
          they may set their own cookies under their own privacy policies. You can clear local storage in your browser settings at any time;
          you will be signed out and saved passes will be removed from that browser (they stay in your account and email).
        </p>
      </>
    ),
  },
  {
    id: 'laws',
    title: 'Laws we follow',
    content: (
      <>
        <p>
          Eventlaya is run from Nepal. We handle personal information in line with Nepal’s <strong>Individual Privacy Act, 2075 (2018)</strong>{' '}
          and the <strong>Electronic Transactions Act, 2063 (2008)</strong>. In plain words: we collect information for clear purposes, use it
          only for those purposes, keep it safe, don’t share it without a good reason and let you see, correct and delete it.
        </p>
        <p>
          If you live outside Nepal, your own country’s laws may give you extra rights. Contact us and we will do our best to help.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    content: (
      <p>
        If we change this policy, we will update the date at the top. If the change is important, we will tell you in the app, on the
        website or by email before it takes effect, and ask you to agree again where the law requires it.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    content: (
      <>
        <p>
          For privacy questions, requests and complaints, write to <Email subject="Privacy question" />. You can also use our{' '}
          <Link to={LEGAL_PATHS.contact}>contact page</Link>.
        </p>
        <p>
          {COMPANY_NAME}, {COMPANY_LOCATION}.
        </p>
      </>
    ),
  },
]

export const PrivacyPage: React.FC = () => (
  <LegalPage
    title="Privacy policy"
    docTitle="Privacy policy"
    intro={
      <>
        <p>
          The short version: we collect what we need to run your events, passes, bookings and account. We don’t sell your information or show
          ads. Organizers see what you give them when you register. You can delete your account at any time.
        </p>
      </>
    }
    sections={sections}
  />
)

export default PrivacyPage
