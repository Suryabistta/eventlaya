import { useQuery } from '@tanstack/react-query'
import { request } from '@/services/api'

/** The editable home page (superadmin → Home page, backend apps.platform HomePageContent). The server stores only
 *  what the superadmin changed; everything else comes from HOME_DEFAULTS below. */

export interface Section {
  show: boolean
  eyebrow: string
  title: string
}
export interface FeatureItem {
  icon: string
  title: string
  body: string
  accent: boolean
}
export interface StepItem {
  title: string
  body: string
}
export interface StepsTab {
  label: string
  cta_label: string
  cta_to: string
  steps: StepItem[]
}
export interface Testimonial {
  quote: string
  name: string
  org: string
  photo: string
  rating: number
}
export interface Partner {
  name: string
  logo: string
  url: string
}
export interface Faq {
  q: string
  a: string
}

export interface HomeContent {
  hero: { badge: string; title_before: string; title_highlight: string; title_after: string; subtitle: string; show_categories: boolean; show_vendor_links: boolean }
  flow: Section & { body: string; cta_label: string; points: string[] }
  events: Section
  vendors: Section
  features: Section & { items: FeatureItem[] }
  dashboard: Section & { subtitle: string }
  testimonials: Section & { items: Testimonial[] }
  partners: Section & { items: Partner[] }
  portfolio: Section
  steps: Section & { attendee: StepsTab; organizer: StepsTab; vendor: StepsTab }
  faq: Section & { subtitle: string; items: Faq[] }
  contact: Section & { body: string; email: string; phone: string; location: string; hours: string }
  footer: { about: string }
  socials: { facebook: string; instagram: string; youtube: string; tiktok: string }
}

/** Icons the superadmin can pick for feature tiles (names map to lucide icons in the landing page). */
export const FEATURE_ICONS = ['grid', 'user', 'ticket', 'vote', 'users', 'wifi', 'calendar', 'checklist', 'qr', 'chart', 'store', 'mail', 'globe', 'sparkles'] as const

export const HOME_DEFAULTS: HomeContent = {
  hero: {
    badge: 'Nepal’s event & vendor discovery platform',
    title_before: 'Find your next',
    title_highlight: 'event',
    title_after: '& the vendors behind it',
    subtitle: 'Discover concerts, conferences, hackathons and festivals near you, and book photographers, venues, hosts and decorators for your own.',
    show_categories: true,
    show_vendor_links: true,
  },
  flow: {
    show: true,
    eyebrow: 'One platform. Every event.',
    title: 'Registration, ticketing & check-in, all in one flow.',
    body: 'Let attendees register online, get a secure QR pass, scan in at the gate (even offline) and vote live from their phones.',
    cta_label: 'Start your event',
    points: ['Online registration', 'Digital QR passes', 'Online / offline check-in', 'Live voting'],
  },
  events: { show: true, eyebrow: 'Event marketplace', title: 'Featured & upcoming events' },
  vendors: { show: true, eyebrow: 'Vendor marketplace', title: 'Featured vendors' },
  features: {
    show: true,
    eyebrow: 'Features',
    title: 'Everything Eventlaya does for your event',
    items: [
      { icon: 'grid', title: 'Management system', body: 'One dashboard for events, teams, tickets and money.', accent: true },
      { icon: 'user', title: 'Registration', body: 'Custom forms, approvals and instant confirmations.', accent: false },
      { icon: 'ticket', title: 'Ticketing', body: 'Free or paid QR tickets with tiers and promo codes.', accent: false },
      { icon: 'vote', title: 'Voting', body: 'Live public voting and judges’ scores for contests and pageants.', accent: false },
      { icon: 'users', title: 'Vendor marketplace', body: 'Find and book verified photographers, venues and hosts.', accent: false },
      { icon: 'wifi', title: 'Online / offline check-in', body: 'QR scanning that keeps working without internet.', accent: true },
      { icon: 'calendar', title: 'Event management', body: 'Schedules, speakers, staff, gates and attendance.', accent: false },
      { icon: 'checklist', title: 'Event planning', body: 'Crew tasks and checklists for the whole team.', accent: false },
    ],
  },
  dashboard: { show: true, eyebrow: 'Organizer dashboard', title: 'Run the whole event from one dashboard', subtitle: 'Four screens your team actually uses on event day.' },
  testimonials: { show: true, eyebrow: 'Testimonials', title: 'Trusted by event organizers', items: [] },
  partners: { show: true, eyebrow: 'Partners', title: 'Organizers who run on Eventlaya', items: [] },
  portfolio: { show: true, eyebrow: 'Portfolio', title: 'Events powered by Eventlaya' },
  steps: {
    show: true,
    eyebrow: 'How it works',
    title: 'Get started in four simple steps',
    attendee: {
      label: 'Attendee',
      cta_label: 'Browse events',
      cta_to: '/events',
      steps: [
        { title: 'Create an account', body: 'Sign up with Google or email in under a minute.' },
        { title: 'Find an event', body: 'Search or browse by category and city.' },
        { title: 'Register or buy', body: 'Fill in the form, pay if it’s paid, get your QR pass.' },
        { title: 'Scan and enjoy', body: 'Show the QR at the gate and join live voting.' },
      ],
    },
    organizer: {
      label: 'Organizer',
      cta_label: 'Create your event',
      cta_to: '/signup',
      steps: [
        { title: 'Sign up as an organizer', body: 'Free for club-sized events.' },
        { title: 'Create your event', body: 'Pick tickets, free registration or a pageant: four short steps.' },
        { title: 'Share the link', body: 'On Facebook, WhatsApp or your college group.' },
        { title: 'Check in and track', body: 'Scan at the gate and watch sales and check-ins live.' },
      ],
    },
    vendor: {
      label: 'Vendor',
      cta_label: 'List your business',
      cta_to: '/signup',
      steps: [
        { title: 'Create a vendor profile', body: 'Photographer, venue, sound, decor or host.' },
        { title: 'Build your portfolio', body: 'Photos, packages and prices.' },
        { title: 'Get verified', body: 'Our team checks your business for the blue tick.' },
        { title: 'Receive inquiries', body: 'Customers ask for dates; you reply and take bookings.' },
      ],
    },
  },
  faq: {
    show: true,
    eyebrow: 'FAQ',
    title: 'Questions organizers ask',
    subtitle: 'Something else? Write to support@eventlaya.com.',
    items: [
      { q: 'Do attendees need to install an app?', a: 'No. They register on a web page and get their pass on screen and by email. Only your gate crew can optionally use the Android scanner app; any phone browser works too.' },
      { q: 'What happens if the internet drops at the gate?', a: 'The Android scanner keeps scanning and queues check-ins on the phone, then syncs them when the signal returns.' },
      { q: 'Can the same pass be used twice?', a: 'No. A second gate-in with the same pass is flagged as a duplicate straight away, on every gate.' },
      { q: 'How do people pay for tickets?', a: 'Online with Khalti or eSewa when you turn it on, or at the venue. Your plan is paid by eSewa, Khalti, Fonepay or bank transfer.' },
      { q: 'Can we use our own domain and logo?', a: 'Yes. Request white-label from Branding and domain; once approved, registration runs on your domain with your colours.' },
    ],
  },
  contact: {
    show: true,
    eyebrow: 'Contact',
    title: 'Let’s plan your next event together',
    body: 'Questions about tickets, check-in or vendors? Send us a message and the Eventlaya team will reply by email.',
    email: 'support@eventlaya.com',
    phone: '',
    location: 'Dharan · Itahari · Biratnagar, Nepal',
    hours: '',
  },
  footer: { about: 'One platform for event registration, digital tickets, QR entry, live voting and vendor discovery across Nepal. Built in Dharan.' },
  socials: { facebook: '', instagram: '', youtube: '', tiktok: '' },
}

type Plain = Record<string, unknown>
const isObj = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Defaults with the saved values on top (objects merge key by key; a saved list replaces the default list). */
export function mergeHome<T>(base: T, saved: unknown): T {
  if (!isObj(base) || !isObj(saved)) return (saved === undefined || saved === null ? base : (saved as T))
  const out: Plain = { ...base }
  for (const k of Object.keys(base)) {
    if (k in saved) out[k] = isObj(base[k]) ? mergeHome(base[k], saved[k]) : saved[k] ?? base[k]
  }
  return out as T
}

export const HOME_KEY = ['home-content'] as const

export function useHomeContent(): HomeContent {
  const { data } = useQuery({
    queryKey: HOME_KEY,
    queryFn: () => request<{ data: Plain }>('/platform/home-content/'),
    staleTime: 5 * 60_000,
  })
  return mergeHome(HOME_DEFAULTS, data?.data)
}

/** Links the superadmin typed: only site paths, http(s) and mailto/tel. */
export const safeHref = (url: string) => (/^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url.trim() : '')
