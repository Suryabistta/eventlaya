import React from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Mail, MapPin, ShieldCheck, Store, Trash2 } from 'lucide-react'
import { COMPANY_LOCATION, COMPANY_NAME, CONTACT_EMAIL, LEGAL_PATHS, mailto } from '@/lib/legal'
import { LegalPage, type LegalSection } from './LegalPage'

const topics: { icon: React.ElementType; title: string; text: React.ReactNode; subject: string }[] = [
  {
    icon: CalendarDays,
    title: 'Help with Eventlaya',
    text: 'Setting up an event, passes, the gate scanner, your plan or your white-label site.',
    subject: 'Help with Eventlaya',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy and your data',
    text: (
      <>
        Get a copy of your data, correct it, or ask a question about our <Link to={LEGAL_PATHS.privacy}>Privacy policy</Link>.
      </>
    ),
    subject: 'Privacy request',
  },
  {
    icon: Trash2,
    title: 'Delete your account',
    text: (
      <>
        If you can’t do it in the app. See <Link to={LEGAL_PATHS.deleteAccount}>how account deletion works</Link>.
      </>
    ),
    subject: 'Delete my account',
  },
  {
    icon: Store,
    title: 'Report content',
    text: (
      <>
        A fake event, a listing, a review or a message that breaks our <Link to={LEGAL_PATHS.community}>Community guidelines</Link>.
      </>
    ),
    subject: 'Report content',
  },
]

const sections: LegalSection[] = [
  {
    id: 'email',
    title: 'Email us',
    content: (
      <>
        <p>
          One address for everything: <a href={mailto()}>{CONTACT_EMAIL}</a>. A person on our team reads every message. Pick a topic to start
          an email with the right subject:
        </p>
        <ul className="!mt-6 !list-none !space-y-3 !pl-0">
          {topics.map((t) => (
            <li key={t.title} className="!pl-0">
              <div className="flex gap-4 rounded-xl border border-ink-200 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <t.icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <a href={mailto(t.subject)} className="!text-ink-900 !no-underline hover:!underline">
                    <strong>{t.title}</strong>
                  </a>
                  <p className="!mt-1 text-[0.95rem] leading-normal text-ink-600">{t.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: 'events',
    title: 'Questions about a specific event',
    content: (
      <p>
        Each event is run by its organizer. For tickets, prices, refunds, entry or changes to an event, contact the organizer: their details
        are on the event page under <strong>Organizer</strong>. Event sites with their own domain usually show the organizer’s support email
        at the bottom of the page. If you can’t reach them, write to us and we will help.
      </p>
    ),
  },
  {
    id: 'where',
    title: 'Where we are',
    content: (
      <p className="flex items-start gap-2">
        <MapPin className="mt-1.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
        <span>
          {COMPANY_NAME}, {COMPANY_LOCATION}. We work online; please email us rather than visiting.
        </span>
      </p>
    ),
  },
]

export const ContactPage: React.FC = () => (
  <LegalPage
    eyebrow="Contact"
    title="Contact us"
    docTitle="Contact"
    undated
    noToc
    noContactCard
    intro={
      <>
        <p>Questions, problems, privacy requests or reports: email us and we will get back to you as soon as we can.</p>
        <p>
          <a href={mailto()} className="inline-flex items-center gap-2 !no-underline">
            <Mail className="h-5 w-5" aria-hidden />
            <span className="underline">{CONTACT_EMAIL}</span>
          </a>
        </p>
      </>
    }
    sections={sections}
  />
)

export default ContactPage
