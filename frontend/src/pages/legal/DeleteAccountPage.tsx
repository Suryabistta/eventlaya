import React from 'react'
import { Link } from 'react-router-dom'
import { CONTACT_EMAIL, LEGAL_PATHS, SITE_DOMAIN } from '@/lib/legal'
import { Email, LegalPage, type LegalSection } from './LegalPage'

/**
 * /delete-account — the public URL for Google Play ("Delete account URL") and Facebook Login ("Data deletion
 * instructions URL"). Mirrors apps/accounts/account.py: deletion_blocker() and delete_account().
 */
const sections: LegalSection[] = [
  {
    id: 'website',
    title: 'Delete your account on the website',
    content: (
      <ol>
        <li>
          Sign in at <a href="/login">{SITE_DOMAIN}</a>.
        </li>
        <li>
          Open your <strong>Profile</strong> (the menu with your initials at the top right, or <a href="/app/profile">{SITE_DOMAIN}/app/profile</a>
          ).
        </li>
        <li>
          In <strong>Delete account</strong>, choose <strong>Delete my account</strong>.
        </li>
        <li>
          Enter your password. If you only sign in with Google or Facebook, tick the box to confirm instead.
        </li>
        <li>
          Choose <strong>Delete account</strong>. You are signed out and the account is deleted straight away.
        </li>
      </ol>
    ),
  },
  {
    id: 'app',
    title: 'Delete your account in the Eventlaya app',
    content: (
      <>
        <ol>
          <li>Open the Eventlaya app and sign in.</li>
          <li>
            <strong>Attendees:</strong> go to the <strong>Profile</strong> tab. <strong>Vendors and venue owners:</strong> go to{' '}
            <strong>More</strong>. <strong>Organizers and gate staff:</strong> go to <strong>More</strong> (or <strong>Account</strong>), choose{' '}
            <strong>Switch to attendee view</strong>, then open the <strong>Profile</strong> tab.
          </li>
          <li>
            Scroll to the bottom and tap <strong>Delete account</strong>.
          </li>
          <li>Enter your password (not needed for Google or Facebook accounts) and tap <strong>Delete account</strong>.</li>
        </ol>
        <p>Uninstalling the app does not delete your account.</p>
      </>
    ),
  },
  {
    id: 'deleted',
    title: 'What is deleted',
    content: (
      <>
        <p>As soon as you confirm, we permanently delete:</p>
        <ul>
          <li>your profile: name, email address, phone number, city, organization name, profile photo and password;</li>
          <li>your Google or Facebook sign-in links, email verification codes and the app’s notification tokens;</li>
          <li>reviews you wrote;</li>
          <li>your place in team chats and gate assignments;</li>
          <li>
            for organizers whose events have no registrations: those events with their ticket types, gates, forms and polls, your team chats
            and tasks, your branding and white-label site and your plan;
          </li>
          <li>for vendors and venue owners whose listings have no inquiries: those listings and their availability.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'kept',
    title: 'What is kept, and for how long',
    content: (
      <>
        <p>Some information also belongs to other people, so it stays with them after your account is gone, no longer linked to you:</p>
        <ul>
          <li>
            <strong>Event registrations and tickets</strong> (your name, email, phone number, answers and check-in times) stay with the
            organizer of that event as part of their records, for as long as the organizer keeps their account. Your passes keep working.
          </li>
          <li>
            <strong>Inquiries and booking requests</strong> you sent stay with the vendor or venue you sent them to.
          </li>
          <li>
            <strong>Team chat messages</strong> you sent stay in that conversation for its other members. Delete messages first if you don’t
            want them kept.
          </li>
          <li>
            <strong>Gate scans</strong> you made as staff stay in the event’s check-in records, without your name.
          </li>
          <li>
            <strong>Votes</strong> stay counted. They are stored as anonymous codes.
          </li>
          <li>
            <strong>Photo files</strong> you uploaded are no longer linked to your account. If you want us to make sure a particular photo file
            is erased from our storage, email us and we will do it.
          </li>
          <li>Deleted data may remain in backup copies for a limited time before it is overwritten.</li>
          <li>
            Passes saved in your browser or in the app on your phone stay on that device until you remove them, sign out or clear the app’s
            data.
          </li>
        </ul>
        <p>
          If you also want your details removed from an event’s or a vendor’s records, email us. We will work with the organizer or vendor to
          remove or anonymise them, unless they have a legal reason to keep them.
        </p>
      </>
    ),
  },
  {
    id: 'blocked',
    title: 'When you can’t delete in the app',
    content: (
      <>
        <p>To protect other people’s records, these accounts are closed by our team instead of in the app:</p>
        <ul>
          <li>organizers whose events have registrations (we keep attendees’ passes and records safe);</li>
          <li>vendors and venue owners whose listings have inquiries;</li>
          <li>accounts with billing history (we keep billing records as the law requires);</li>
          <li>platform administrator accounts.</li>
        </ul>
        <p>
          The app or website tells you if this applies. Email us and we will close the account and delete everything we don’t have to keep.
        </p>
      </>
    ),
  },
  {
    id: 'by-email',
    title: 'Ask us to delete your account by email',
    content: (
      <>
        <p>If you can’t sign in, or prefer us to do it:</p>
        <ol>
          <li>
            Email <Email subject="Delete my account" /> with the subject “Delete my account”.
          </li>
          <li>
            Send it from the email address of your Eventlaya account, or tell us that address. Say whether you sign in with a password, Google
            or Facebook.
          </li>
          <li>We may reply to that address to confirm the request comes from you.</li>
        </ol>
        <p>
          We will delete the account within 30 days of confirming it’s you, and email you when it’s done. What is deleted and kept is the same
          as above.
        </p>
      </>
    ),
  },
  {
    id: 'facebook',
    title: 'If you signed in with Facebook or Google',
    content: (
      <>
        <p>
          From Facebook we receive only your name, email address and Facebook user ID; from Google, your name, email address and Google
          account ID. Deleting your Eventlaya account (on the website, in the app or by email to {CONTACT_EMAIL}) deletes that information
          together with your account.
        </p>
        <p>
          Removing Eventlaya from your Facebook settings (Settings &amp; privacy → Settings → Apps and websites) or from your Google account’s
          third-party connections stops new sign-ins through them, but it does not delete your Eventlaya account. Follow one of the steps above
          to delete it.
        </p>
      </>
    ),
  },
  {
    id: 'more',
    title: 'Other choices',
    content: (
      <ul>
        <li>You can edit your profile, remove your profile photo and delete individual reviews without deleting your account.</li>
        <li>
          To turn off notifications, open your phone’s Settings → Apps → Eventlaya → Notifications.
        </li>
        <li>
          Read more in our <Link to={LEGAL_PATHS.privacy}>Privacy policy</Link>.
        </li>
      </ul>
    ),
  },
]

export const DeleteAccountPage: React.FC = () => (
  <LegalPage
    eyebrow="Your data"
    title="Delete your account"
    docTitle="Delete your account"
    intro={
      <p>
        You can delete your Eventlaya account yourself at any time, on the website or in the app, or ask us to do it by email. This page
        explains how, and exactly what is deleted and what is kept.
      </p>
    }
    sections={sections}
  />
)

export default DeleteAccountPage
