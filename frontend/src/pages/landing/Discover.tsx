import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Camera,
  CheckSquare,
  ClipboardCheck,
  Code2,
  Dumbbell,
  Globe,
  LayoutGrid,
  Mail,
  MapPin,
  Mic2,
  Music,
  QrCode,
  Search,
  Send,
  Sparkles,
  Store,
  Ticket,
  UserRound,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react'
import { api, request, type Event as PublicEvent } from '@/services/api'
import { buttonClass } from '@/components/ui/Button'
import { Input, Select, Textarea, useToast } from '@/components/ui'
import { useEventCategories } from '@/lib/event-page'
import { useCities } from '@/lib/cities'
import { cn } from '@/lib/utils'
import { EventCard } from '../ExploreEventsPage'
import { VendorCard } from '../marketplace/Cards'
import { Reveal } from './ProductTour'

/** Home page sections from the November 2026 design: search-first hero, live events and vendors, features, steps, contact. */

const Eyebrow: React.FC<{ children: React.ReactNode; light?: boolean; center?: boolean }> = ({ children, light, center }) => (
  <p className={cn('flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em]', light ? 'text-brand-300' : 'text-brand-600', center && 'justify-center')}>
    <span className={cn('h-px w-6', light ? 'bg-brand-300' : 'bg-brand-600')} aria-hidden />
    {children}
  </p>
)

const H2: React.FC<{ children: React.ReactNode; light?: boolean; className?: string }> = ({ children, light, className }) => (
  <h2 className={cn('mt-3 font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-[44px] sm:leading-[1.08]', light ? 'text-white' : 'text-ink-900', className)}>{children}</h2>
)

// Icons for event types by slug; anything else gets a sparkle
const CATEGORY_ICONS: Record<string, React.ElementType> = {
  conference: Users,
  hackathon: Code2,
  concert: Music,
  festival: Sparkles,
  workshop: Wrench,
  sports: Dumbbell,
  meetup: Globe,
  seminar: Mic2,
}
const iconFor = (slug: string) => CATEGORY_ICONS[slug] ?? Sparkles

const useUpcoming = () => useQuery({ queryKey: ['landing', 'events'], queryFn: () => api.getPublicEvents({ when: 'upcoming' }), staleTime: 60_000 })
const useVendors = () => useQuery({ queryKey: ['landing', 'vendors'], queryFn: () => api.getVendors(), staleTime: 60_000 })
const useVendorCategories = () => useQuery({ queryKey: ['marketplaceCategories'], queryFn: api.getCategories, staleTime: 5 * 60_000 })

/* ------------------------------------------------------------------ */
/* Hero: search events or vendors                                       */

export const SearchHero: React.FC = () => {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'events' | 'vendors'>('events')
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('')
  const cities = useCities()
  const eventTypes = useEventCategories()
  const vendorTypes = useVendorCategories().data ?? []
  const upcoming = useUpcoming().data ?? []
  const banners = upcoming.filter((e) => e.banner).slice(0, 4)

  const go = (e: React.FormEvent) => {
    e.preventDefault()
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (city) p.set('city', city)
    if (category) p.set('category', category)
    navigate(`${mode === 'events' ? '/events' : '/marketplace'}${p.size ? `?${p}` : ''}`)
  }
  const types = mode === 'events' ? eventTypes.map((t) => ({ slug: t.slug, name: t.name })) : vendorTypes.map((t) => ({ slug: t.slug, name: t.name }))

  return (
    <section className="relative overflow-hidden bg-[#1c0f17] text-white">
      {/* Real event banners as a dim collage behind the search */}
      <div aria-hidden className="absolute inset-0 grid grid-cols-2 opacity-30 lg:grid-cols-4">
        {banners.map((e) => (
          <img key={e.id} src={e.banner!} alt="" className="h-full w-full object-cover" />
        ))}
      </div>
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-brand-900/80 via-[#1c0f17]/85 to-[#1c0f17]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-14 text-center sm:px-6 sm:pt-20">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm backdrop-blur">
          <MapPin className="h-4 w-4 text-brand-300" aria-hidden />
          Nepal’s event &amp; vendor discovery platform
        </p>
        <h1 className="mx-auto mt-6 max-w-4xl font-display text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-6xl lg:text-7xl">
          Find your next <span className="text-brand-400">event</span>
          <br className="hidden sm:block" /> &amp; the vendors behind it
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-white/75">
          Discover concerts, conferences, hackathons and festivals near you, and book photographers, venues, hosts and decorators for your own.
        </p>

        <div role="radiogroup" aria-label="Search for" className="mt-8 inline-flex gap-2">
          {(['events', 'vendors'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m)
                setCategory('')
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors',
                mode === m ? 'bg-brand-600 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20',
              )}
            >
              {m === 'events' ? <CalendarDays className="h-4 w-4" aria-hidden /> : <Store className="h-4 w-4" aria-hidden />}
              {m === 'events' ? 'Events' : 'Vendors'}
            </button>
          ))}
        </div>

        <form
          onSubmit={go}
          role="search"
          className="mx-auto mt-4 grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-2 rounded-3xl bg-white p-2 text-left text-ink-900 shadow-2xl sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:rounded-full"
        >
          <label className="flex items-center gap-2 rounded-full px-4">
            <Search className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
            <span className="sr-only">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === 'events' ? 'What event are you looking for?' : 'Photographer, venue, decorator…'}
              className="h-12 w-full border-0 bg-transparent text-base placeholder:text-ink-400 focus:outline-none focus:ring-0"
            />
          </label>
          <label className="flex items-center gap-2 rounded-full px-4 sm:border-l sm:border-ink-100">
            <MapPin className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
            <span className="sr-only">City</span>
            <select value={city} onChange={(e) => setCity(e.target.value)} className="h-12 w-full border-0 bg-transparent text-base focus:outline-none focus:ring-0">
              <option value="">Any city</option>
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 rounded-full px-4 sm:border-l sm:border-ink-100">
            <LayoutGrid className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
            <span className="sr-only">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-12 w-full border-0 bg-transparent text-base focus:outline-none focus:ring-0">
              <option value="">All categories</option>
              {types.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-12 rounded-full bg-brand-600 px-8 text-base font-bold text-white transition-colors hover:bg-brand-700">
            Search
          </button>
        </form>

        {eventTypes.length > 0 && (
          <>
            <p className="mt-10 text-base font-medium text-white/80">Or browse popular categories</p>
            <ul className="mx-auto mt-4 grid max-w-5xl grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8 lg:gap-3">
              {[{ slug: '', name: 'All events' }, ...eventTypes.slice(0, 7)].map((t) => {
                const Icon = t.slug ? iconFor(t.slug) : LayoutGrid
                return (
                  <li key={t.slug || 'all'}>
                    <Link
                      to={t.slug ? `/events?category=${t.slug}` : '/events'}
                      className={cn(
                        'flex h-full flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-4 text-sm font-medium transition-colors',
                        t.slug ? 'border-white/15 bg-white/5 text-white/90 hover:bg-white/15' : 'border-brand-500 bg-brand-600 text-white',
                      )}
                    >
                      <Icon className="h-6 w-6" aria-hidden />
                      <span className="line-clamp-1">{t.name}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        {vendorTypes.length > 0 && (
          <p className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-white/70">
            <span>Popular vendors:</span>
            {vendorTypes.slice(0, 5).map((t) => (
              <Link key={t.slug} to={`/marketplace?category=${t.slug}`} className="rounded-full border border-white/20 bg-white/5 px-3 py-1 font-medium text-white hover:bg-white/15">
                {t.name}
              </Link>
            ))}
          </p>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Featured & upcoming events (live data)                               */

export const EventsShowcase: React.FC = () => {
  const { data = [], isLoading } = useUpcoming()
  const eventTypes = useEventCategories()
  const [tab, setTab] = useState<'featured' | 'upcoming'>('featured')
  const [type, setType] = useState('')
  const list = useMemo(() => {
    let l = data
    if (type) l = l.filter((e) => e.category === type)
    if (tab === 'featured') {
      const featured = l.filter((e) => e.is_featured)
      l = featured.length ? [...featured, ...l.filter((e) => !e.is_featured)] : l
    }
    return l.slice(0, 4)
  }, [data, tab, type])
  const usedTypes = eventTypes.filter((t) => data.some((e) => e.category === t.slug))
  if (!isLoading && data.length === 0) return null

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>Event marketplace</Eyebrow>
            <H2>Featured &amp; upcoming events</H2>
          </div>
          <div className="flex items-center gap-2">
            {(['featured', 'upcoming'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={cn('rounded-full px-4 py-2 text-sm font-semibold', tab === t ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}
              >
                {t === 'featured' ? 'Featured' : 'Upcoming'}
              </button>
            ))}
            <Link to="/events" className={buttonClass('secondary', 'md', 'rounded-full')}>
              View all <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
        {usedTypes.length > 1 && (
          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Event type">
            {[{ slug: '', name: 'All events' }, ...usedTypes].map((t) => (
              <button
                key={t.slug || 'all'}
                type="button"
                aria-pressed={type === t.slug}
                onClick={() => setType(t.slug)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium',
                  type === t.slug ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 text-ink-700 hover:border-ink-300',
                )}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((e) => (
            <EventCard key={e.id} event={e} past={false} />
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Featured vendors (live data)                                         */

export const VendorsShowcase: React.FC = () => {
  const { data = [], isLoading } = useVendors()
  const categories = useVendorCategories().data ?? []
  const [cat, setCat] = useState('')
  const used = categories.filter((c) => data.some((v) => v.category_slug === c.slug))
  const list = (cat ? data.filter((v) => v.category_slug === cat) : data).slice(0, 4)
  if (!isLoading && data.length === 0) return null

  return (
    <section className="bg-brand-50/60 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Eyebrow>Vendor marketplace</Eyebrow>
            <H2>Featured vendors</H2>
          </div>
          <Link to="/marketplace" className={buttonClass('primary', 'lg', 'rounded-full')}>
            Explore all vendors <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {used.length > 1 && (
          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Vendor type">
            {[{ slug: '', name: 'All' }, ...used].map((c) => (
              <button
                key={c.slug || 'all'}
                type="button"
                aria-pressed={cat === c.slug}
                onClick={() => setCat(c.slug)}
                className={cn('rounded-full px-4 py-1.5 text-sm font-medium', cat === c.slug ? 'bg-ink-900 text-white' : 'bg-white text-ink-700 hover:bg-ink-50')}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((v) => (
            <VendorCard key={v.id} vendor={v} to={`/marketplace/vendors/${v.id}`} />
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Everything Eventlaya does                                            */

const FEATURES: { icon: React.ElementType; title: string; body: string; accent?: boolean }[] = [
  { icon: LayoutGrid, title: 'Management system', body: 'One dashboard for events, teams, tickets and money.', accent: true },
  { icon: UserRound, title: 'Registration', body: 'Custom forms, approvals and instant confirmations.' },
  { icon: Ticket, title: 'Ticketing', body: 'Free or paid QR tickets with tiers and promo codes.' },
  { icon: CheckSquare, title: 'Voting', body: 'Live public voting and judges’ scores for contests and pageants.' },
  { icon: Users, title: 'Vendor marketplace', body: 'Find and book verified photographers, venues and hosts.' },
  { icon: Wifi, title: 'Online / offline check-in', body: 'QR scanning that keeps working without internet.', accent: true },
  { icon: CalendarDays, title: 'Event management', body: 'Schedules, speakers, staff, gates and attendance.' },
  { icon: ClipboardCheck, title: 'Event planning', body: 'Crew tasks and checklists for the whole team.' },
]

export const FeaturesEight: React.FC = () => (
  <section id="features" className="scroll-mt-20 bg-white py-20 sm:py-24">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <Reveal className="text-center">
        <Eyebrow center>Features</Eyebrow>
        <H2>Everything Eventlaya does for your event</H2>
      </Reveal>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <li
            key={f.title}
            className={cn(
              'rounded-3xl border p-6 shadow-sm',
              f.accent ? 'border-transparent bg-gradient-to-br from-brand-600 to-brand-800 text-white' : 'border-ink-100 bg-white',
            )}
          >
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', f.accent ? 'bg-white/15' : 'bg-brand-50 text-brand-700')}>
              <f.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className={cn('mt-5 text-lg font-bold', f.accent ? 'text-white' : 'text-ink-900')}>{f.title}</h3>
            <p className={cn('mt-1.5 text-sm leading-relaxed', f.accent ? 'text-white/80' : 'text-ink-600')}>{f.body}</p>
          </li>
        ))}
      </ul>
    </div>
  </section>
)

/* ------------------------------------------------------------------ */
/* Events powered by Eventlaya (real past events with a banner)         */

export const PoweredBy: React.FC = () => {
  const { data = [] } = useQuery({ queryKey: ['landing', 'past'], queryFn: () => api.getPublicEvents({ when: 'past' }), staleTime: 5 * 60_000 })
  const shown = data.filter((e: PublicEvent) => e.banner).slice(0, 5)
  if (shown.length < 3) return null
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="text-center">
          <Eyebrow center>Portfolio</Eyebrow>
          <H2>Events powered by Eventlaya</H2>
        </Reveal>
        <ul className="mt-12 grid auto-rows-[200px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((e, i) => (
            <li key={e.id} className={cn('relative overflow-hidden rounded-3xl bg-ink-900', i === 0 && 'sm:col-span-2 sm:row-span-2')}>
              <Link to={`/e/${e.slug}`} className="group block h-full">
                <img src={e.banner!} alt="" loading="lazy" className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105" />
                <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" aria-hidden />
                <span className="absolute bottom-4 left-5 right-5 text-white">
                  <span className="block text-lg font-bold">{e.title}</span>
                  {e.registered_count > 0 && <span className="text-sm text-white/80">{e.registered_count.toLocaleString('en-IN')} attendees</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Get started in four steps (attendee / organizer / vendor)            */

const STEPS: Record<'user' | 'business' | 'vendor', { label: string; icon: React.ElementType; steps: { icon: React.ElementType; title: string; body: string }[]; cta: { label: string; to: string } }> = {
  user: {
    label: 'Attendee',
    icon: UserRound,
    cta: { label: 'Browse events', to: '/events' },
    steps: [
      { icon: UserRound, title: 'Create an account', body: 'Sign up with Google or email in under a minute.' },
      { icon: Search, title: 'Find an event', body: 'Search or browse by category and city.' },
      { icon: Ticket, title: 'Register or buy', body: 'Fill in the form, pay if it’s paid, get your QR pass.' },
      { icon: QrCode, title: 'Scan and enjoy', body: 'Show the QR at the gate and join live voting.' },
    ],
  },
  business: {
    label: 'Organizer',
    icon: CalendarDays,
    cta: { label: 'Create your event', to: '/signup' },
    steps: [
      { icon: UserRound, title: 'Sign up as an organizer', body: 'Free for club-sized events.' },
      { icon: CalendarDays, title: 'Create your event', body: 'Pick tickets, free registration or a pageant: four short steps.' },
      { icon: Send, title: 'Share the link', body: 'On Facebook, WhatsApp or your college group.' },
      { icon: BarChart3, title: 'Check in and track', body: 'Scan at the gate and watch sales and check-ins live.' },
    ],
  },
  vendor: {
    label: 'Vendor',
    icon: Store,
    cta: { label: 'List your business', to: '/signup' },
    steps: [
      { icon: Store, title: 'Create a vendor profile', body: 'Photographer, venue, sound, decor or host.' },
      { icon: Camera, title: 'Build your portfolio', body: 'Photos, packages and prices.' },
      { icon: CheckSquare, title: 'Get verified', body: 'Our team checks your business for the blue tick.' },
      { icon: Mail, title: 'Receive inquiries', body: 'Customers ask for dates; you reply and take bookings.' },
    ],
  },
}

export const StepsTabs: React.FC = () => {
  const [who, setWho] = useState<keyof typeof STEPS>('user')
  const s = STEPS[who]
  return (
    <section className="bg-gradient-to-b from-brand-50/70 to-white py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="text-center">
          <Eyebrow center>How it works</Eyebrow>
          <H2>Get started in four simple steps</H2>
        </Reveal>
        <div role="tablist" aria-label="I am" className="mx-auto mt-8 flex w-fit gap-1 rounded-full border border-ink-200 bg-white p-1">
          {(Object.keys(STEPS) as (keyof typeof STEPS)[]).map((k) => {
            const T = STEPS[k]
            return (
              <button
                key={k}
                role="tab"
                aria-selected={who === k}
                onClick={() => setWho(k)}
                className={cn('inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold sm:px-5', who === k ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900')}
              >
                <T.icon className="h-4 w-4" aria-hidden />
                {T.label}
              </button>
            )
          })}
        </div>
        <ol role="tabpanel" className="mt-8 grid gap-8 rounded-3xl border border-ink-100 bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-10 lg:grid-cols-4">
          {s.steps.map((st, i) => (
            <li key={st.title}>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md">
                <st.icon className="h-6 w-6" aria-hidden />
              </span>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-brand-600">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-bold text-ink-900">{st.title}</h3>
              <p className="mt-1 text-sm text-ink-600">{st.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-center">
          <Link to={s.cta.to} className={buttonClass('primary', 'lg', 'rounded-full')}>
            {s.cta.label} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Contact                                                              */

export const ContactSection: React.FC = () => {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'user', message: '' })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const send = useMutation({
    mutationFn: () => request('/platform/contact/', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      toast.success('Message sent', 'Thanks! The Eventlaya team will reply by email.')
      setForm({ name: '', email: '', phone: '', role: 'user', message: '' })
    },
    onError: (e: Error) => toast.error('Couldn’t send your message', e.message),
  })
  return (
    <section id="contact" className="scroll-mt-20 bg-white py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <H2>Let’s plan your next event together</H2>
          <p className="mt-4 max-w-md text-lg text-ink-600">Questions about tickets, check-in or vendors? Send us a message and the Eventlaya team will reply by email.</p>
          <ul className="mt-8 space-y-5">
            <li className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Mail className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold text-ink-900">Email</span>
                <a href="mailto:support@eventlaya.com" className="text-ink-600 hover:text-brand-700">
                  support@eventlaya.com
                </a>
              </span>
            </li>
            <li className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <MapPin className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold text-ink-900">Location</span>
                <span className="text-ink-600">Dharan · Itahari · Biratnagar, Nepal</span>
              </span>
            </li>
          </ul>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send.mutate()
          }}
          className="space-y-4 rounded-3xl border border-ink-100 bg-white p-6 shadow-lg sm:p-8"
        >
          <h3 className="text-xl font-bold text-ink-900">Send us a message</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" required value={form.name} onChange={set('name')} placeholder="Your name" />
            <Input label="Email" type="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" />
            <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="98XXXXXXXX" hint="Optional" />
            <Select label="I am" value={form.role} onChange={set('role')}>
              <option value="user">Attending events</option>
              <option value="business">Organizing events</option>
              <option value="vendor">A vendor or venue</option>
            </Select>
          </div>
          <Textarea label="Message" required rows={4} value={form.message} onChange={set('message')} placeholder="Tell us about your event…" maxLength={3000} />
          <button type="submit" disabled={send.isPending} className={buttonClass('primary', 'lg', 'w-full rounded-full')}>
            <Send className="h-4 w-4" aria-hidden />
            {send.isPending ? 'Sending…' : 'Send message'}
          </button>
        </form>
      </div>
    </section>
  )
}
