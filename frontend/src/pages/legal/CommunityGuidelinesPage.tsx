import React from 'react'
import { Link } from 'react-router-dom'
import { LEGAL_PATHS } from '@/lib/legal'
import { Email, LegalPage, type LegalSection } from './LegalPage'

const sections: LegalSection[] = [
  {
    id: 'everywhere',
    title: 'Everywhere on Eventlaya',
    content: (
      <>
        <p>Be honest, be respectful, and keep it legal. That means no:</p>
        <ul>
          <li>harassment, threats, bullying or hate based on caste, ethnicity, religion, gender, sexuality, disability or anything else;</li>
          <li>sexually explicit content, graphic violence, or content that puts children at risk;</li>
          <li>impersonating a person, organizer, business or Eventlaya;</li>
          <li>sharing other people’s personal details (phone numbers, addresses, photos) without their permission;</li>
          <li>spam, scams, misleading links, or selling things that are illegal;</li>
          <li>content you don’t have the rights to, such as someone else’s photos or logos.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'events',
    title: 'Events',
    content: (
      <ul>
        <li>Only publish events that are real and that you are organizing or allowed to promote.</li>
        <li>Be clear about the date, venue, price (paid at the venue), entry rules and what people get.</li>
        <li>If an event is cancelled or changes, update it on Eventlaya so attendees know.</li>
        <li>Only ask registration questions you actually need.</li>
      </ul>
    ),
  },
  {
    id: 'reviews',
    title: 'Reviews',
    content: (
      <ul>
        <li>Review only what you experienced yourself. No reviews of your own event or business, and no paid or swapped reviews.</li>
        <li>Criticism is welcome; keep it about the event or service, not personal attacks.</li>
        <li>Don’t put phone numbers, emails or other personal details in reviews.</li>
        <li>Owners: reply politely. Don’t pressure people to change or remove a review.</li>
      </ul>
    ),
  },
  {
    id: 'chat',
    title: 'Team chat',
    content: (
      <ul>
        <li>Team chat is for working on your events. Treat teammates the way you would at work.</li>
        <li>Don’t share attendees’ personal details in chat unless it is needed to run the event.</li>
        <li>Don’t send photos of documents, IDs or anything you wouldn’t want forwarded.</li>
      </ul>
    ),
  },
  {
    id: 'listings',
    title: 'Vendor and venue listings',
    content: (
      <ul>
        <li>List only services you really offer, with honest prices, capacity and photos of your own work or place.</li>
        <li>Keep your availability up to date and answer requests.</li>
        <li>Use customers’ contact details only to answer their request.</li>
      </ul>
    ),
  },
  {
    id: 'report',
    title: 'How to report something',
    content: (
      <>
        <p>
          Email <Email subject="Report content" /> with a link to the page (or the event and the name of the chat or review), what is wrong,
          and screenshots if you have them. If someone is in immediate danger, contact the police first.
        </p>
        <p>
          Organizers can hide reviews of their own events from their dashboard. For problems with an event itself, such as a refund or entry,
          contact the organizer using the details on the event page.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-do',
    title: 'What we do',
    content: (
      <>
        <p>A person on our team looks at every report. Depending on what we find, we may:</p>
        <ul>
          <li>ask the person to fix it;</li>
          <li>hide or remove the review, message, listing or event;</li>
          <li>pause a listing or unpublish an event;</li>
          <li>suspend or close the account, for serious or repeated problems;</li>
          <li>report it to the police or authorities when the law requires it or someone is at risk.</li>
        </ul>
        <p>
          If we act on your content and you think we got it wrong, reply to our email and we will look again. These guidelines are part of our{' '}
          <Link to={LEGAL_PATHS.terms}>Terms of service</Link>.
        </p>
      </>
    ),
  },
]

export const CommunityGuidelinesPage: React.FC = () => (
  <LegalPage
    title="Community guidelines"
    docTitle="Community guidelines"
    intro={
      <p>
        Eventlaya brings together organizers, attendees, gate crews, vendors and venues. These guidelines keep it useful and safe for all of
        them. They apply to events, reviews, team chat, listings, photos and everything else you post.
      </p>
    }
    sections={sections}
  />
)

export default CommunityGuidelinesPage
