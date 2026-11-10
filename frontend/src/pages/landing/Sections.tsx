import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { animate, motion, useInView, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import {
  FileText,
  QrCode,
  ScanLine,
  Vote,
  ClipboardList,
  Globe,
  WifiOff,
  Download,
  DoorOpen,
  Camera,
  Speaker,
  Flower2,
  Building2,
  Store,
  UtensilsCrossed,
  Plus,
  ArrowRight,
  Check,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { buttonClass } from '@/components/ui/Button'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { Reveal } from './ProductTour'
import { usePublicNumbers } from './data'
import { usePlans, planCodeByName } from '@/lib/plans'
import { CONTACT_EMAIL } from '@/lib/legal'

const ease = [0.22, 1, 0.36, 1] as const

/* ------------------------------------------------------------------ */

const eventKinds = ['College fests', 'Hackathons', 'Concerts', 'Conferences', 'Sports meets', 'Weddings and receptions', 'Workshops', 'Award nights', 'Trade fairs', 'Alumni meets']

export const EventKindsStrip: React.FC = () => {
  const reduce = useReducedMotion()
  const row = [...eventKinds, ...eventKinds]
  return (
    <section aria-label="Kinds of events run on Eventlaya" className="overflow-hidden border-b border-ink-100 bg-white py-6">
      <motion.ul
        className="flex w-max gap-3 px-3"
        animate={reduce ? undefined : { x: ['0%', '-50%'] }}
        transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
      >
        {row.map((k, i) => (
          <li key={`${k}-${i}`} aria-hidden={i >= eventKinds.length} className="flex items-center gap-3 whitespace-nowrap text-lg font-medium text-ink-500">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-300" aria-hidden />
            {k}
          </li>
        ))}
      </motion.ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */

const steps = [
  { icon: FileText, title: 'Publish a registration form', body: 'Name, college, T-shirt size, team members: ask what you need, then share one link.' },
  { icon: QrCode, title: 'Attendees get a pass instantly', body: 'Every sign-up receives a QR pass by email that works on any phone or as a printout.' },
  { icon: DoorOpen, title: 'Set up gates and staff', body: 'Add your entrances and exits, mark VIP or exit-only, and assign a volunteer to each.' },
  { icon: ScanLine, title: 'Scan people in and out', body: 'Duplicates are stopped at the gate and you always know how many people are inside.' },
]

export const HowItWorks: React.FC = () => {
  const ref = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 55%'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="font-display text-3xl font-bold text-ink-900 sm:text-[44px] sm:leading-[1.05]">How gate day works</h2>
          <p className="mt-4 max-w-sm text-lg text-ink-600">Four steps, set up the evening before. Your crew needs nothing but their phones.</p>
          <Link to="/signup" className={buttonClass('secondary', 'lg', 'mt-8')}>
            Set up your first event
          </Link>
        </Reveal>

        <ol ref={ref} className="relative space-y-6 pl-14">
          <span className="absolute bottom-6 left-[19px] top-6 w-0.5 rounded-full bg-ink-200" aria-hidden />
          <motion.span style={{ scaleY: progress }} className="absolute bottom-6 left-[19px] top-6 w-0.5 origin-top rounded-full bg-brand-600" aria-hidden />
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.05}>
              <li className="relative rounded-2xl border border-ink-200 bg-white p-6 transition-shadow hover:shadow-pop">
                <span className="absolute -left-14 top-6 flex h-10 w-10 items-center justify-center rounded-full border-4 border-white bg-brand-600 font-display text-sm font-bold text-white shadow-xs">
                  {i + 1}
                </span>
                <s.icon className="h-6 w-6 text-brand-600" aria-hidden />
                <h3 className="mt-3 text-xl font-bold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 leading-relaxed text-ink-600">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

export const FeatureGrid: React.FC = () => (
  <section className="bg-ink-50 py-20 sm:py-28">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <Reveal className="max-w-2xl">
        <h2 className="font-display text-3xl font-bold text-ink-900 sm:text-[44px] sm:leading-[1.05]">The rest of the event, handled</h2>
        <p className="mt-4 text-lg text-ink-600">The jobs that used to live in a Google Sheet, a WhatsApp group and someone's notebook.</p>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-6">
        <Tile className="md:col-span-4" icon={Vote} title="Live audience voting" body="Best band, best project, crowd favourite. One vote per pass, results on the big screen as they come in.">
          <VotingBars />
        </Tile>
        <Tile className="md:col-span-2" icon={WifiOff} title="Scans offline" body="The Android app queues check-ins when the network drops and syncs later.">
          <OfflineSync />
        </Tile>
        <Tile className="md:col-span-2" icon={ClipboardList} title="Crew tasks" body="Stage, gate and hospitality jobs, assigned and tracked on the day." />
        <Tile className="md:col-span-2" icon={Globe} title="Your own domain" body="Registration on tickets.yourcollege.edu.np with your logo and colours." />
        <Tile className="md:col-span-2" icon={Download} title="Your data, exportable" body="Attendees and check-ins as CSV whenever you need them." />
      </div>
    </div>
  </section>
)

const Tile: React.FC<{ icon: React.ElementType; title: string; body: string; className?: string; children?: React.ReactNode }> = ({ icon: Icon, title, body, className, children }) => (
  <motion.div
    initial={{ opacity: 0, y: 24 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.3 }}
    whileHover={{ y: -4 }}
    transition={{ duration: 0.5, ease }}
    className={cn('group flex flex-col justify-between gap-6 rounded-2xl border border-ink-200 bg-white p-6 transition-shadow hover:shadow-pop', className)}
  >
    <div>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-lg font-bold text-ink-900">{title}</h3>
      <p className="mt-1.5 leading-relaxed text-ink-600">{body}</p>
    </div>
    {children}
  </motion.div>
)

const VotingBars: React.FC = () => {
  const options = [
    { name: 'VoltGrid IoT', pct: 46 },
    { name: 'KrishiBot', pct: 31 },
    { name: 'PahadPay', pct: 23 },
  ]
  return (
    <ul className="space-y-2.5" aria-hidden>
      {options.map((o, i) => (
        <li key={o.name}>
          <div className="flex justify-between text-sm">
            <span className="font-medium text-ink-800">
              {o.name}
              {i === 0 && <span className="ml-2 text-xs font-semibold text-brand-700">Leading</span>}
            </span>
            <span className="tabular text-ink-600">{o.pct}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
            <motion.div
              className={cn('h-full rounded-full', i === 0 ? 'bg-brand-600' : 'bg-brand-300')}
              initial={{ width: 0 }}
              whileInView={{ width: `${o.pct}%` }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.12, duration: 0.9, ease }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

const OfflineSync: React.FC = () => (
  <div className="flex items-center gap-2" aria-hidden>
    {[0, 1, 2, 3, 4].map((i) => (
      <motion.span
        key={i}
        className="h-8 flex-1 rounded-lg bg-ink-100"
        initial={{ backgroundColor: '#F3F0F5' }}
        whileInView={{ backgroundColor: '#ECFDF5' }}
        viewport={{ once: true }}
        transition={{ delay: 0.4 + i * 0.25, duration: 0.3 }}
      />
    ))}
    <motion.span
      initial={{ scale: 0 }}
      whileInView={{ scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay: 1.8, type: 'spring', stiffness: 400, damping: 18 }}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white"
    >
      <Check className="h-4 w-4" />
    </motion.span>
  </div>
)

/* ------------------------------------------------------------------ */

const CountUp: React.FC<{ value: number | null }> = ({ value }) => {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!inView || value === null) return
    if (reduce) return setShown(value)
    const controls = animate(0, value, { duration: 1.4, ease, onUpdate: (v) => setShown(Math.round(v)) })
    return () => controls.stop()
  }, [inView, value, reduce])
  return <span ref={ref}>{value === null ? '–' : shown.toLocaleString()}</span>
}

export const NumbersBand: React.FC = () => {
  const n = usePublicNumbers()
  const items = [
    { label: 'Upcoming events', value: n.upcomingEvents },
    { label: 'People registered for them', value: n.registrations },
    { label: 'Vendors and venues listed', value: n.listings },
    { label: 'Cities covered', value: n.cities },
  ]
  return (
    <section className="py-16 sm:py-20" aria-label="Eventlaya in numbers">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-ink-200 bg-ink-200 lg:grid-cols-4">
          {items.map((i) => (
            <div key={i.label} className="bg-white p-6 sm:p-8">
              <dd className="font-display text-4xl font-bold tabular text-ink-900 sm:text-5xl">
                <CountUp value={i.value} />
              </dd>
              <dt className="mt-2 text-sm text-ink-600">{i.label}</dt>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-500">Live numbers from public listings on Eventlaya.</p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

// Shown until the categories load (and in prerendered pages); venues first, like the marketplace chips
const vendorKinds: { icon: React.ElementType; label: string; note: string; to: string }[] = [
  { icon: Building2, label: 'Halls and venues', note: 'Banquets, auditoriums, lawns', to: '/marketplace?show=venues' },
  { icon: Speaker, label: 'Sound and stage', note: 'PA, lights, LED walls', to: '/marketplace' },
  { icon: Camera, label: 'Photo and video', note: 'Coverage and livestreams', to: '/marketplace' },
  { icon: Flower2, label: 'Decoration', note: 'Stage, mandap, florals', to: '/marketplace' },
  { icon: UtensilsCrossed, label: 'Catering', note: 'Buffets and snacks', to: '/marketplace' },
]
const KIND_ICONS: Record<string, React.ElementType> = { Camera, Flower2, Speaker, Music: Speaker, Utensils: UtensilsCrossed, UtensilsCrossed, Sparkles: Flower2 }

/** Venues plus the superadmin's vendor categories (the same list as the marketplace chips), each linking to its filter. */
function useKinds() {
  const { data: categories } = useQuery({ queryKey: ['marketplaceCategories'], queryFn: api.getCategories, staleTime: 10 * 60_000 })
  if (!categories?.length) return vendorKinds
  return [
    vendorKinds[0],
    ...categories.slice(0, 5).map((c) => ({
      icon: KIND_ICONS[c.icon] ?? Store,
      label: c.name,
      note: c.vendors_count ? `${c.vendors_count} listed` : 'Coming soon',
      to: `/marketplace?category=${c.slug}`,
    })),
  ]
}

export const MarketplaceBand: React.FC = () => {
  const kinds = useKinds()
  return (
  <section className="bg-brand-50 py-20 sm:py-28">
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
      <Reveal className="max-w-lg">
        <h2 className="font-display text-3xl font-bold text-ink-900 sm:text-[44px] sm:leading-[1.05]">Book the hall, the sound and the photographer</h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-700">
          Verified vendors and venues in Dharan, Itahari and Biratnagar. Pick a hall, compare prices and send an inquiry in a minute.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/marketplace" className={buttonClass('primary', 'lg')}>
            Browse vendors and venues
          </Link>
          <Link to="/signup" className={buttonClass('secondary', 'lg')}>
            List your business
          </Link>
        </div>
      </Reveal>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kinds.map((v, i) => (
          <motion.li
            key={v.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            whileHover={{ y: -4 }}
            transition={{ duration: 0.5, delay: i * 0.06, ease }}
            className={cn('rounded-2xl border border-brand-100 bg-white p-5 shadow-2xs', i === 0 && 'sm:col-span-2')}
          >
            <Link to={v.to} className="block">
              <v.icon className="h-6 w-6 text-brand-600" aria-hidden />
              <p className="mt-3 font-semibold text-ink-900">{v.label}</p>
              <p className="text-sm text-ink-500">{v.note}</p>
            </Link>
          </motion.li>
        ))}
      </ul>
    </div>
  </section>
  )
}

/* ------------------------------------------------------------------ */

const plans = [
  { name: 'Free', price: 'Rs 0', note: 'Up to 150 attendees per event', points: ['Registration form', 'QR passes and web scanner', 'CSV export'] },
  { name: 'Event Pro', price: 'Rs 1,499', note: 'per month', points: ['Unlimited attendees', 'Custom form fields', 'Gates, staff and analytics'], recommended: true },
  { name: 'Business', price: 'Rs 3,999', note: 'per month', points: ['Several events at once', 'Live voting', 'Budget and crew tasks'] },
]

export const PricingTeaser: React.FC = () => {
  const { data: apiPlans } = usePlans()
  // Live prices from the platform's plan settings; fall back to the defaults above while loading
  const shown = plans.map((p) => {
    const live = apiPlans?.find((x) => x.code === planCodeByName[p.name])
    if (!live) return p
    return {
      ...p,
      price: `Rs ${(live.monthly_price ?? 0).toLocaleString()}`,
      note: live.monthly_price ? 'per month' : live.attendee_limit ? `Up to ${live.attendee_limit} attendees per event` : p.note,
    }
  })
  return (
  <section className="py-20 sm:py-28">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <Reveal className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="font-display text-3xl font-bold text-ink-900 sm:text-[44px] sm:leading-[1.05]">Free for club-sized events</h2>
          <p className="mt-4 text-lg text-ink-600">Pay only when you run bigger or more events.</p>
        </div>
        <Link to="/pricing" className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline">
          Compare all plans <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Reveal>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {shown.map((p, i) => (
          <motion.div
            key={p.name}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: i * 0.08, ease }}
            className={cn('rounded-2xl border bg-white p-6', p.recommended ? 'border-2 border-brand-600' : 'border-ink-200')}
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink-900">{p.name}</p>
              {p.recommended && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">Recommended</span>}
            </div>
            <p className="mt-4 font-display text-4xl font-bold text-ink-900">{p.price}</p>
            <p className="text-sm text-ink-500">{p.note}</p>
            <ul className="mt-5 space-y-2">
              {p.points.map((pt) => (
                <li key={pt} className="flex items-center gap-2 text-sm text-ink-700">
                  <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                  {pt}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
)
}

/* ------------------------------------------------------------------ */

const faqs = [
  { q: 'Do attendees need to install an app?', a: 'No. They register on a web page and get their pass on screen and by email. Only your gate crew can optionally use the Android scanner app; any phone browser works too.' },
  { q: 'What happens if the internet drops at the gate?', a: 'The Android scanner keeps scanning and queues check-ins on the phone, then syncs them when the signal returns.' },
  { q: 'Can the same pass be used twice?', a: 'No. A second gate-in with the same pass is flagged as a duplicate straight away, on every gate.' },
  { q: 'How do I pay?', a: 'Plans are billed monthly or yearly in Nepali rupees. eSewa and Khalti checkout is coming soon; bank transfer works today.' },
  { q: 'Can we use our own domain and logo?', a: 'Yes. Request white-label from Branding and domain; once approved, registration runs on your domain with your colours.' },
]

export const Faq: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="bg-ink-50 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <h2 className="font-display text-3xl font-bold text-ink-900 sm:text-[44px] sm:leading-[1.05]">Questions organizers ask</h2>
          <p className="mt-4 text-lg text-ink-600">Something else? Write to {CONTACT_EMAIL}.</p>
        </Reveal>
        <ul className="divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white">
          {faqs.map((f, i) => {
            const isOpen = open === i
            return (
              <li key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
                >
                  <span className="font-semibold text-ink-900">{f.q}</span>
                  <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-brand-600">
                    <Plus className="h-5 w-5" aria-hidden />
                  </motion.span>
                </button>
                <motion.div
                  id={`faq-${i}`}
                  initial={false}
                  animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease }}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-5 leading-relaxed text-ink-600 sm:px-6">{f.a}</p>
                </motion.div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

export const FinalCta: React.FC = () => (
  <section className="py-20 sm:py-28">
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <Reveal>
        <div className="relative overflow-hidden rounded-[32px] bg-brand-600 px-6 py-14 text-center text-white sm:px-12 sm:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]"
          />
          <h2 className="relative mx-auto max-w-2xl font-display text-3xl font-bold sm:text-5xl sm:leading-[1.05]">Run your next event on Eventlaya</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-brand-50">Set up registration tonight. Scan people in tomorrow.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className="inline-flex h-12 items-center rounded-[10px] bg-white px-6 text-[15px] font-semibold text-brand-700 shadow-xs transition-transform hover:-translate-y-0.5">
              Start free
            </Link>
            <Link to="/events" className="inline-flex h-12 items-center rounded-[10px] border border-white/40 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">
              See live events
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
)
