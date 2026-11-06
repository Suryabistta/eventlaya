/**
 * The one place for the legal pages' company details and dates (Privacy, Terms, Community guidelines,
 * Delete account, Contact). Every page, footer and the mobile app's links read from here or link to those pages.
 *
 * TODO(owner): confirm before launch
 *  - COMPANY_NAME: the registered legal entity (e.g. "Eventlaya Pvt. Ltd."). Until confirmed we use the brand name.
 *  - CONTACT_EMAIL: make sure the support@eventlaya.com mailbox exists and is read; it also takes privacy and
 *    account-deletion requests.
 *  - Have a lawyer in Nepal review /privacy and /terms.
 * When the policies change, bump LAST_UPDATED here and TERMS_VERSION in backend/config/settings.py together.
 */
import { TENANT_HOST, platformUrl } from './tenant-host'

export const COMPANY_NAME = 'Eventlaya'
export const SITE_DOMAIN = 'eventlaya.com'
export const SITE_URL = 'https://eventlaya.com'
/** Support, privacy and deletion requests all go to this one mailbox. */
export const CONTACT_EMAIL = 'support@eventlaya.com'
export const COMPANY_LOCATION = 'Eastern Nepal'
export const COUNTRY = 'Nepal'
/** Shown as "Last updated" on every policy page (ISO date). */
export const LAST_UPDATED = '2026-10-28'
/** Matches backend settings.TERMS_VERSION (stored on the user when they agree). */
export const TERMS_VERSION = LAST_UPDATED
/** Minimum age to hold an account on our own (younger: with a parent or guardian). */
export const MINIMUM_AGE = 16

export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  community: '/community-guidelines',
  deleteAccount: '/delete-account',
  contact: '/contact',
} as const

export const LEGAL_LINKS: { label: string; to: string }[] = [
  { label: 'Privacy policy', to: LEGAL_PATHS.privacy },
  { label: 'Terms of service', to: LEGAL_PATHS.terms },
  { label: 'Community guidelines', to: LEGAL_PATHS.community },
  { label: 'Delete account', to: LEGAL_PATHS.deleteAccount },
  { label: 'Contact', to: LEGAL_PATHS.contact },
]

/**
 * Where a legal page lives for links on this site. White-label sites show Eventlaya's policies (Eventlaya is
 * the platform), so they link to eventlaya.com; the Eventlaya site links in-app.
 */
export function legalHref(path: string): string {
  return TENANT_HOST ? platformUrl(path) : path
}

export const mailto = (subject?: string) =>
  `mailto:${CONTACT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`

export function formatLegalDate(iso: string = LAST_UPDATED): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
