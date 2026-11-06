import React from 'react'
import { Link } from 'react-router-dom'
import { COMPANY_LOCATION, COMPANY_NAME, LEGAL_PATHS, MINIMUM_AGE, SITE_DOMAIN } from '@/lib/legal'
import { Email, LegalPage, type LegalSection } from './LegalPage'

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'About these terms',
    content: (
      <>
        <p>
          These terms are an agreement between you and {COMPANY_NAME} (“we”, “us”) for using {SITE_DOMAIN}, the white-label event sites
          that run on Eventlaya, and the Eventlaya mobile app (together, “Eventlaya”). By creating an account, registering for an event or
          otherwise using Eventlaya, you agree to these terms, our <Link to={LEGAL_PATHS.privacy}>Privacy policy</Link> and our{' '}
          <Link to={LEGAL_PATHS.community}>Community guidelines</Link>.
        </p>
        <p>
          If you use Eventlaya for an organization (a club, college, company or business), you confirm you are allowed to accept these
          terms for it, and “you” includes that organization.
        </p>
        <p>
          You must be at least {MINIMUM_AGE} years old to create an account on your own. Younger people may use Eventlaya only with the
          permission and supervision of a parent or guardian, who accepts these terms for them.
        </p>
      </>
    ),
  },
  {
    id: 'what-eventlaya-is',
    title: 'What Eventlaya is (and isn’t)',
    content: (
      <>
        <p>
          Eventlaya is a software platform. Organizers use it to publish events, take registrations, issue QR passes, check people in, run
          polls and work with their team. Vendors and venue owners use it to list their services and receive inquiries and booking requests.
        </p>
        <p>
          <strong>We don’t organize the events, own the venues or provide the vendors’ services.</strong> Each event is run by its
          organizer, and each booking is between the customer and the vendor or venue. We are not a party to those arrangements and are not
          responsible for how they are carried out.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    content: (
      <ul>
        <li>Give accurate information and keep it up to date. Use your real name and an email address you can access.</li>
        <li>
          Keep your password private and use “Keep me signed in” only on your own devices. You are responsible for what happens under your
          account. Tell us straight away at <Email subject="Account security" /> if you think someone else has used it.
        </li>
        <li>One person per account. Don’t share accounts or create accounts for other people without their permission.</li>
        <li>
          If you sign in with Google or Facebook, your use of those services is also covered by their terms.
        </li>
        <li>
          You can delete your account at any time (see <Link to={LEGAL_PATHS.deleteAccount}>Delete your account</Link>).
        </li>
      </ul>
    ),
  },
  {
    id: 'organizers',
    title: 'If you organize events',
    content: (
      <>
        <ul>
          <li>
            <strong>Be accurate.</strong> Describe your event honestly: date, time, venue, prices, what’s included and any age or entry rules.
            Update the event page promptly if something changes, and cancel it on Eventlaya if it won’t happen.
          </li>
          <li>
            <strong>Honour your tickets.</strong> A valid pass issued through Eventlaya is your promise to let that person in on the terms you
            published.
          </li>
          <li>
            <strong>Payments and refunds are yours to handle.</strong> Ticket prices on Eventlaya are paid at the venue, directly to you.
            Eventlaya does not collect ticket money and cannot issue refunds. Publish your refund policy and handle refunds yourself, including
            when you cancel or change an event.
          </li>
          <li>
            <strong>Look after your attendees’ data.</strong> You decide what your registration form asks, so you are responsible for that
            information. Only ask for what you need, tell attendees how you will use it, keep it safe, don’t use it for anything they wouldn’t
            expect, and answer their requests to see, correct or delete it. Follow Nepal’s privacy law. We process attendee data for you, as
            described in our <Link to={LEGAL_PATHS.privacy}>Privacy policy</Link>.
          </li>
          <li>
            <strong>Your team.</strong> You are responsible for the gate staff and team members you add, for giving them only the access they
            need, and for removing them when they leave.
          </li>
          <li>
            <strong>Polls and promo codes.</strong> Run polls fairly and honour the promo codes you publish.
          </li>
          <li>
            <strong>Follow the law</strong>, including any permits, tax and venue rules for your event.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'attendees',
    title: 'If you attend events',
    content: (
      <ul>
        <li>Give accurate details when you register. The organizer uses them to let you in.</li>
        <li>
          Your pass is for you (or the guest it is issued to). Don’t copy, resell or share a pass to let more people in. A pass is usually
          accepted once at the entry gate.
        </li>
        <li>
          Follow the organizer’s and the venue’s rules. The organizer can refuse entry or remove people under their own policies and the law.
        </li>
        <li>
          If a ticket has a price, you pay it at the venue to the organizer. Questions about prices, changes, cancellations and refunds go to
          the organizer, whose contact details are on the event page.
        </li>
        <li>Your registration details are shared with the organizer of that event.</li>
      </ul>
    ),
  },
  {
    id: 'gate-staff',
    title: 'If you are gate staff or a team member',
    content: (
      <ul>
        <li>Your account is created and managed by the organizer whose team you are on. They can change your access or remove you.</li>
        <li>
          Use the scanner and attendee lists only to run the event you are working on. Don’t copy, keep or share attendees’ personal
          details.
        </li>
        <li>Keep your sign-in details to yourself and sign out on shared phones.</li>
        <li>Team chat is for working together. The <Link to={LEGAL_PATHS.community}>Community guidelines</Link> apply there too.</li>
      </ul>
    ),
  },
  {
    id: 'vendors',
    title: 'If you list a business or venue',
    content: (
      <ul>
        <li>
          Keep your listing accurate: what you offer, prices, photos, location, capacity and contact details. Use only photos you have the
          right to use.
        </li>
        <li>Keep your availability calendar up to date and answer inquiries and booking requests within a reasonable time.</li>
        <li>
          <strong>Bookings are agreements between you and your customer.</strong> A booking confirmed through Eventlaya records that you and
          the customer agreed on a date. Price, deposits, payment, cancellation and the service itself are between you and the customer.
          Eventlaya is not a party to the booking and doesn’t take payment for it.
        </li>
        <li>Use the contact details customers send you only to answer their inquiry and provide what they asked for.</li>
        <li>We may review, pause or remove listings that break these terms or the Community guidelines.</li>
      </ul>
    ),
  },
  {
    id: 'white-label',
    title: 'White-label sites',
    content: (
      <>
        <p>
          Approved organizers can show their events on their own domain or on a {SITE_DOMAIN} subdomain with their own branding. If you use
          this:
        </p>
        <ul>
          <li>You must own or control the domain and the brand, logo and content you use.</li>
          <li>
            Your site still runs on Eventlaya, so these terms and our Privacy policy apply to it. Your site links to them, and shows your support
            email so visitors can reach you.
          </li>
          <li>
            You are responsible for your domain’s DNS settings. We may stop serving a white-label site if the domain stops pointing to us, if
            the feature is no longer part of your plan, or if the site breaks these terms.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'billing',
    title: 'Plans, billing and payments',
    content: (
      <>
        <ul>
          <li>
            <strong>Free plan.</strong> You can use Eventlaya on the Free plan without paying. Its limits are shown on the{' '}
            <Link to="/pricing">Pricing</Link> page.
          </li>
          <li>
            <strong>Paid plans.</strong> Prices are in Nepali rupees and shown on the Pricing page. Paid plans are billed monthly or yearly.
            When you move to a paid plan, it may start with a free trial (currently 14 days).
          </li>
          <li>
            <strong>How you pay.</strong> You pay us by eSewa, Khalti, Fonepay QR or bank transfer, and our team records your payment. Your plan
            runs until the end of the period you paid for. We don’t keep card or bank details, and nothing is charged automatically: to renew,
            you pay again for the next period.
          </li>
          <li>
            <strong>If you don’t renew.</strong> When a paid period or trial ends without payment, your account is marked as past due or
            expired. We may then limit paid features or move you to the Free plan. Your events, registrations and data stay in your account.
          </li>
          <li>
            <strong>Refunds.</strong> Plan fees are generally not refundable once a period has started, and we don’t give refunds for
            partly used periods. If we charged you by mistake, or we end your service without you having broken these terms, we will refund
            the unused part. Where the law gives you a right to a refund, that right applies.
          </li>
          <li>
            <strong>Price changes.</strong> We may change our prices. We will tell you at least 30 days before a change affects your next
            payment. A period you already paid for isn’t affected.
          </li>
          <li>
            <strong>Taxes.</strong> Prices include or exclude taxes as shown on the Pricing page or your invoice.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'your-content',
    title: 'Your content',
    content: (
      <>
        <p>
          “Your content” is what you put on Eventlaya: events, listings, photos, reviews, chat messages, poll options and replies. You keep
          ownership of it.
        </p>
        <p>
          You give us a non-exclusive, worldwide, royalty-free licence to host, store, copy, display, resize and send your content, only as
          needed to run, show and improve Eventlaya. For public content (events, listings, reviews), this includes showing it to the public
          on Eventlaya and on the organizer’s white-label site, and in links and previews of those pages. The licence ends when you delete the
          content or your account, except for copies other people already received (for example a chat message they read) and backup
          copies kept for a limited time.
        </p>
        <p>
          You confirm you have the right to post your content and that it follows these terms and the law. We don’t claim ownership of
          your content and don’t sell it.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    content: (
      <>
        <p>
          Follow our <Link to={LEGAL_PATHS.community}>Community guidelines</Link>. In particular, don’t use Eventlaya to:
        </p>
        <ul>
          <li>publish fake events, fake listings or fake reviews, or sell passes for events that won’t happen;</li>
          <li>harass, threaten, impersonate or discriminate against anyone;</li>
          <li>post illegal, violent, sexually explicit or hateful content, or content that infringes someone else’s rights;</li>
          <li>collect other users’ personal information or send them spam;</li>
          <li>forge, copy or tamper with passes or QR codes, or try to vote more than once;</li>
          <li>
            break or overload Eventlaya, get around its security or limits, access accounts or data that aren’t yours, or scrape it
            automatically without our permission;
          </li>
          <li>break any law of Nepal or the country you are in.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'reviews',
    title: 'Reviews and moderation',
    content: (
      <ul>
        <li>
          Reviews must be honest and based on your own experience. Only people who were checked in at an event can review it, and only
          people who contacted a vendor or venue can review them.
        </li>
        <li>
          Organizers can hide reviews of their events, and vendors and venue owners can reply to reviews of their listings. We may hide or
          remove reviews and other content that break these terms or the Community guidelines.
        </li>
        <li>
          We don’t check every piece of content before it appears and aren’t responsible for what users post, but we act on reports. Report
          content to <Email subject="Report content" />.
        </li>
      </ul>
    ),
  },
  {
    id: 'service',
    title: 'Our service',
    content: (
      <>
        <p>
          We work to keep Eventlaya running and your data safe, but we can’t promise it will always be available or error-free. We may
          need to pause it for maintenance, and things outside our control (internet, power or provider outages) can affect it. Keep your
          own copy of information you can’t afford to lose, such as attendee exports before a big event, and have a backup plan at the gate
          (the app can scan offline and sync later).
        </p>
        <p>
          We may add, change or turn off features. If we remove a feature that is a main part of a paid plan you are on, we will tell you
          in advance and you can cancel for a refund of the unused period.
        </p>
        <p>
          Some features rely on other services (Google, Facebook, push notifications, email delivery, payment apps). Those services are
          governed by their own terms.
        </p>
      </>
    ),
  },
  {
    id: 'disclaimer',
    title: 'No warranty',
    content: (
      <p>
        Eventlaya is provided “as is” and “as available”. As far as the law allows, we don’t give any promises or warranties beyond those
        written in these terms, for example that Eventlaya will meet all your needs, or about events, listings, vendors, venues or other
        users. Nothing in these terms takes away rights you have under Nepal’s consumer protection laws that can’t be excluded.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    content: (
      <>
        <p>As far as the law allows:</p>
        <ul>
          <li>
            We are not liable for how events are run, for what happens at events or venues, for vendors’ services, for payments or refunds
            between users, or for content posted by other users.
          </li>
          <li>
            We are not liable for indirect or consequential losses, such as lost profits, lost ticket sales or lost data, that we could not
            reasonably have foreseen.
          </li>
          <li>
            Our total liability to you for any claim about Eventlaya is limited to the greater of the fees you paid us in the 12 months
            before the claim and NPR 5,000.
          </li>
        </ul>
        <p>
          These limits don’t apply to liability that can’t be limited by law, such as for fraud, or for death or injury caused by our
          negligence.
        </p>
        <p>
          Organizers and vendors are responsible for claims that arise from their own events, listings, bookings or content, and agree to
          cover our reasonable costs if someone makes such a claim against us.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    content: (
      <>
        <p>
          You can stop using Eventlaya and delete your account at any time. We may suspend or close an account, remove content or stop
          serving a white-label site if you seriously or repeatedly break these terms, if we have to by law, or to protect users or
          Eventlaya. Where reasonable, we will warn you first and give you a chance to fix the problem or export your data.
        </p>
        <p>
          If your account is closed, attendees’ registrations for your events and the related records may be kept as described in our{' '}
          <Link to={LEGAL_PATHS.privacy}>Privacy policy</Link>. Sections of these terms that by their nature should continue (such as your
          content licence for copies already shared, liability limits and governing law) continue after your account ends.
        </p>
      </>
    ),
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    content: (
      <>
        <p>
          These terms are governed by the laws of Nepal. If you have a problem with Eventlaya, please contact us first at{' '}
          <Email subject="Complaint" />. Most problems can be solved quickly that way.
        </p>
        <p>If we can’t resolve a dispute together, it will be decided by the competent courts of Nepal.</p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    content: (
      <p>
        We may update these terms as Eventlaya changes or the law changes. We will update the date at the top, and for important changes
        we will tell you in the app, on the website or by email before they take effect. If you keep using Eventlaya after a change takes
        effect, the new terms apply. If you don’t agree, you can delete your account.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    content: (
      <p>
        {COMPANY_NAME}, {COMPANY_LOCATION}. Email <Email subject="Terms of service" />, or see our{' '}
        <Link to={LEGAL_PATHS.contact}>contact page</Link>.
      </p>
    ),
  },
]

export const TermsPage: React.FC = () => (
  <LegalPage
    title="Terms of service"
    docTitle="Terms of service"
    intro={
      <p>
        These are the rules for using Eventlaya. We have tried to keep them short and clear. The most important parts: organizers run their
        own events and handle ticket payments and refunds; bookings are between customers and vendors; and everyone treats each other and
        each other’s data with respect.
      </p>
    }
    sections={sections}
  />
)

export default TermsPage
