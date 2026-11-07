import React, { useEffect, useId, useMemo, useState } from 'react'
import { track } from '@/lib/analytics'
import { useTenant } from '@/lib/tenant'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Ban,
  Radio,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  Mic2,
  Phone,
  Share2,
  Ticket as TicketIcon,
  Users,
} from 'lucide-react'
import { VerifiedBadge } from '@/components/VerifiedBadge'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui'
import {
  categoryLabel,
  downloadIcs,
  eventPageApi,
  eventWhen,
  fmtClock,
  fmtShortDay,
  getStoredPass,
  getStoredPasses,
  hasPaidTickets,
  initials,
  priceLabel,
  registrationState,
  shareOrCopy,
  spotsInfo,
  toDate,
  type AgendaItem,
  type PublicEvent,
  type Speaker,
  bookLabel,
} from '@/lib/event-page'
import { paymentNote, type PaymentOptions } from '@/lib/payments'
import { availabilityText, fmtShortDate, money, priceText, type PublicTicketType } from '@/lib/tickets'
import { startsInText } from '@/lib/phase'
import { cn } from '@/lib/utils'
import { ReviewsSection } from '@/components/reviews'

const isNotFound = (err: unknown) => err instanceof Error && /no event matches|not found|\(404\)/i.test(err.message)

export const PublicEventPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>()
  const tenantHome = useTenant() ? 'See all events' : 'Go to Eventlaya home'
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['publicEvent', slug],
    queryFn: () => eventPageApi.publicDetail(slug!),
    enabled: Boolean(slug),
    retry: (count, err) => !isNotFound(err) && count < 1,
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10" aria-busy="true">
        <Skeleton className="aspect-[16/7] w-full rounded-2xl" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (isError && !isNotFound(error)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <ErrorState message={`${(error as Error).message} Check your connection and try again.`} onRetry={() => void refetch()} />
      </div>
    )
  }

  if (!data?.event) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Card>
          <EmptyState
            icon={<AlertCircle className="h-6 w-6" aria-hidden />}
            title="We couldn't find this event"
            description="The link may be mistyped, or the organizer hasn't published the event yet. Check the link with the organizer."
            action={
              <ButtonLink to="/" variant="secondary">
                {tenantHome}
              </ButtonLink>
            }
          />
        </Card>
      </div>
    )
  }

  return <EventLanding event={data.event} />
}

/* ------------------------------------------------------------------ */

type SectionId = 'about' | 'sessions' | 'tickets' | 'schedule' | 'speakers' | 'venue' | 'faqs'
const SECTION_LABEL: Record<SectionId, string> = { about: 'About', sessions: 'Sub-events', tickets: 'Tickets', schedule: 'Schedule', speakers: 'Speakers', venue: 'Venue', faqs: 'FAQs' }

const EventLanding: React.FC<{ event: PublicEvent }> = ({ event }) => {
  const toast = useToast()
  const when = eventWhen(event)
  const state = registrationState(event)
  const storedPass = getStoredPass(event.slug)
  const price = priceLabel(event)

  const sections = useMemo(() => {
    const s: SectionId[] = []
    if (event.description || event.highlights?.length) s.push('about')
    if (event.sub_events?.length) s.push('sessions')
    const tt = event.ticket_types ?? []
    if (tt.length > 1 || tt.some((t) => Number(t.price) > 0 || t.remaining !== null || t.description)) s.push('tickets')
    if (event.agenda?.length) s.push('schedule')
    if (event.speakers?.length) s.push('speakers')
    s.push('venue')
    if (event.faqs?.length) s.push('faqs')
    return s
  }, [event])
  const active = useActiveSection(sections)

  const share = async () => {
    const result = await shareOrCopy({ title: event.title, text: event.tagline || undefined, url: `${window.location.origin}/e/${event.slug}` })
    if (result === 'shared' || result === 'copied') track('share', { method: result === 'shared' ? 'native' : 'copy_link', content_type: 'event', item_id: event.slug })
    if (result === 'copied') toast.success('Link copied', 'Paste it anywhere to share this event.')
    else if (result === 'failed') toast.error("Couldn't share", 'Copy the address from your browser bar instead.')
  }
  const addToCalendar = () => {
    downloadIcs(event, storedPass ?? undefined)
    toast.success('Calendar file downloaded', 'Open it to add the event to your calendar.')
  }

  const registerHref = `/e/${event.slug}/register`
  /** Ended or cancelled: keep the page readable, drop the call to action */
  const over = state.phase === 'ended' || state.phase === 'cancelled'
  const showCta = !over || Boolean(storedPass)

  return (
    <div className="pb-28 lg:pb-12">
      {/* Hero */}
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-8">
        <PhaseBanner event={event} state={state} hasPass={Boolean(storedPass)} />
        <div className={cn(over && 'opacity-80 grayscale-[70%]')}>
          <Banner event={event} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {event.category && event.category !== 'other' && <Badge tone="brand">{categoryLabel[event.category]}</Badge>}
              {state.phase === 'upcoming' && <Badge tone="info">{startsInText(event)}</Badge>}
              {state.phase === 'ended' && <Badge tone="neutral">Ended</Badge>}
              {state.phase === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
              {!state.open && !over && <Badge tone="warning">{state.label}</Badge>}
            </div>
            {event.parent && (
              <p className="mt-3 text-sm font-medium text-ink-600">
                Part of{' '}
                <Link to={`/e/${event.parent.slug}`} className="font-semibold text-brand-700 hover:underline">
                  {event.parent.title}
                </Link>
              </p>
            )}
            <h1 className="mt-3 text-3xl font-bold leading-[1.1] text-ink-900 sm:text-5xl">{event.title}</h1>
            {event.tagline && <p className="mt-3 max-w-3xl text-lg text-ink-600 sm:text-xl">{event.tagline}</p>}
            <OrganizerLine event={event} className="mt-4" />
          </div>
          <div className="hidden flex-wrap gap-2 lg:flex">
            <Button variant="secondary" icon={<CalendarPlus className="h-4 w-4" aria-hidden />} onClick={addToCalendar}>
              Add to calendar
            </Button>
            <Button variant="secondary" icon={<Share2 className="h-4 w-4" aria-hidden />} onClick={share}>
              Share
            </Button>
          </div>
        </div>

        {/* Key facts */}
        <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={<CalendarDays className="h-5 w-5" aria-hidden />} label="Date">
            <span className="font-semibold text-ink-900">{when.range}</span>
            {event.start_time && (
              <span className="block text-ink-500">
                {fmtClock(event.start_time)}
                {event.end_time ? ` to ${fmtClock(event.end_time)}` : ''}
              </span>
            )}
          </Fact>
          <Fact icon={<MapPin className="h-5 w-5" aria-hidden />} label="Venue">
            <a href="#venue" className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
              {event.location}
            </a>
          </Fact>
          <Fact icon={<Users className="h-5 w-5" aria-hidden />} label="Spots">
            <SpotsMeter event={event} />
          </Fact>
          <Fact icon={<TicketIcon className="h-5 w-5" aria-hidden />} label="Price">
            <span className="font-semibold text-ink-900">{price}</span>
            {hasPaidTickets(event) && <span className="block text-ink-500">{event.payment_options?.online ? paymentNote(event.payment_options).replace(/\.$/, '') : 'Pay at the venue'}</span>}
          </Fact>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2 lg:hidden">
          <Button variant="secondary" size="sm" icon={<CalendarPlus className="h-4 w-4" aria-hidden />} onClick={addToCalendar}>
            Add to calendar
          </Button>
          <Button variant="secondary" size="sm" icon={<Share2 className="h-4 w-4" aria-hidden />} onClick={share}>
            Share
          </Button>
        </div>
      </div>

      {/* Section nav */}
      <nav aria-label="Event sections" className="sticky top-0 z-20 mt-8 border-y border-ink-200 bg-white/95 backdrop-blur">
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
          {sections.map((id) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active === id ? 'true' : undefined}
                className={cn(
                  'inline-flex h-12 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                  active === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-600 hover:text-ink-900',
                )}
              >
                {SECTION_LABEL[id]}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-14">
          {sections.includes('about') && (
            <Section id="about" title="About this event">
              {event.description && <p className="whitespace-pre-line text-base leading-relaxed text-ink-700">{event.description}</p>}
              {event.highlights?.length > 0 && (
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {event.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-3 rounded-xl border border-ink-200 bg-white p-4 text-sm text-ink-800">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      {h}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {sections.includes('sessions') && (
            <Section id="sessions" title="Sub-events">
              <ul className="grid gap-3 sm:grid-cols-2">
                {event.sub_events!.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 rounded-xl border border-ink-200 bg-white p-4">
                    <Link to={`/e/${s.slug}`} className="font-bold text-ink-900 hover:text-brand-700 hover:underline">
                      {s.title}
                    </Link>
                    {s.tagline && <p className="text-sm text-ink-600">{s.tagline}</p>}
                    <p className="text-sm text-ink-500">
                      {fmtShortDate(s.start_date)}
                      {s.start_time && `, ${fmtClock(s.start_time)}`}
                      {s.location && ` · ${s.location}`}
                    </p>
                    <div className="mt-auto pt-1">
                      {s.registration_open ? (
                        <ButtonLink to={`/e/${s.slug}/register`} size="sm">
                          Book a spot
                        </ButtonLink>
                      ) : (
                        <Badge tone="neutral">{s.allow_registration ? (s.registration_closed_reason ?? 'Bookings closed') : 'No registration needed'}</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {sections.includes('tickets') && (
            <Section id="tickets" title="Tickets">
              <TicketList types={event.ticket_types ?? []} canRegister={state.open} registerHref={registerHref} payment={event.payment_options} />
            </Section>
          )}

          {sections.includes('schedule') && (
            <Section id="schedule" title="Schedule">
              <Schedule event={event} />
            </Section>
          )}

          {sections.includes('speakers') && (
            <Section id="speakers" title="Speakers">
              <ul className="grid gap-4 sm:grid-cols-2">
                {event.speakers.map((s) => (
                  <SpeakerCard key={s.id ?? s.name} speaker={s} />
                ))}
              </ul>
            </Section>
          )}

          <Section id="venue" title="Venue">
            <Venue event={event} />
          </Section>

          {sections.includes('faqs') && (
            <Section id="faqs" title="Frequently asked questions">
              <div className="divide-y divide-ink-200 overflow-hidden rounded-2xl border border-ink-200 bg-white">
                {event.faqs.map((f) => (
                  <details key={f.id ?? f.question} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left font-medium text-ink-900 hover:bg-ink-50 [&::-webkit-details-marker]:hidden">
                      {f.question}
                      <ChevronDown className="h-5 w-5 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="whitespace-pre-line px-5 pb-5 text-sm leading-relaxed text-ink-600">{f.answer}</p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {(state.phase === 'ended' || state.phase === 'live') && (
            <Section id="reviews" title="Reviews">
              <ReviewsSection kind="event" targetKey={event.slug} targetName={event.title} variant="plain" />
            </Section>
          )}

          <OrganizerCard event={event} className="lg:hidden" />
        </div>

        {/* Desktop registration card */}
        <aside className="hidden lg:sticky lg:top-16 lg:block">
          <div className="space-y-4">
            <RegistrationCard event={event} state={state} price={price} hasPass={Boolean(storedPass)} registerHref={registerHref} over={over} />
            <OrganizerCard event={event} />
          </div>
        </aside>
      </div>

      {/* Mobile register bar */}
      {showCta && (
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold leading-tight text-ink-900">{price}</p>
            <p className="truncate text-xs text-ink-500">{state.open ? spotsText(event) : state.reason}</p>
          </div>
          <CtaButtons label={bookLabel(event)} state={state} hasPass={Boolean(storedPass)} registerHref={registerHref} slug={event.slug} compact />
        </div>
      </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    if (!els.length) return
    // The current section is the last one whose top has passed just below the sticky nav
    const update = () => {
      let current = ids[0]
      for (const el of els) if (el.getBoundingClientRect().top <= 140) current = el.id
      setActive(current)
    }
    update()
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    const obs = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(onScroll, { rootMargin: '-64px 0px -40% 0px' }) : null
    els.forEach((el) => obs?.observe(el))
    return () => {
      window.removeEventListener('scroll', onScroll)
      obs?.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [ids.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  return active
}

const spotsText = (e: PublicEvent) => {
  const s = spotsInfo(e)
  if (s.full) return 'Fully booked'
  if (s.hidden) return 'Spots available'
  if (s.capacity === null || s.left === null) return 'Open to everyone'
  return `${s.left.toLocaleString()} of ${s.capacity.toLocaleString()} spots left`
}

const Banner: React.FC<{ event: PublicEvent }> = ({ event }) => {
  const [failed, setFailed] = useState(false)
  if (event.banner && !failed) {
    return (
      <img
        src={event.banner}
        alt=""
        onError={() => setFailed(true)}
        className="aspect-[16/9] w-full rounded-2xl border border-ink-200 bg-ink-100 object-cover sm:aspect-[16/6]"
      />
    )
  }
  // Fallback: a quiet brand pattern, not a gradient wash
  return (
    <div
      aria-hidden
      className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-ink-200 bg-brand-50 sm:aspect-[16/6]"
      style={{ backgroundImage: 'radial-gradient(circle, rgb(194 33 90 / 0.18) 1.5px, transparent 1.6px)', backgroundSize: '22px 22px' }}
    >
      <div className="absolute -right-10 -top-16 h-64 w-64 rounded-full bg-brand-100" />
      <div className="absolute bottom-[-30%] left-[12%] h-48 w-48 rounded-full border-[14px] border-marigold-300" />
      <div className="absolute right-[18%] top-[30%] h-10 w-40 rounded-full bg-white" />
    </div>
  )
}

const OrganizerLine: React.FC<{ event: PublicEvent; className?: string; large?: boolean }> = ({ event, className, large }) => {
  const name = event.organizer_info?.name || event.organizer_name || 'Organizer'
  const logo = event.organizer_info?.logo
  const [logoFailed, setLogoFailed] = useState(false)
  const [managedLogoFailed, setManagedLogoFailed] = useState(false)
  const managed = event.managed_by_info
  const size = large ? 'h-12 w-12' : 'h-9 w-9'
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {logo && !logoFailed ? (
        <img src={logo} alt="" onError={() => setLogoFailed(true)} className={cn(size, 'rounded-full border border-ink-200 bg-white object-cover')} />
      ) : (
        <span aria-hidden className={cn(size, 'flex items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700')}>
          {initials(name)}
        </span>
      )}
      <p className="text-sm text-ink-600">
        {large ? '' : 'Organised by '}
        <span className="font-semibold text-ink-900">{name}</span>
        {event.organizer_info?.verified && <VerifiedBadge />}
        {managed && (
          <span className="mt-0.5 flex items-center gap-1.5">
            {managed.logo && !managedLogoFailed && (
              <img src={managed.logo} alt="" onError={() => setManagedLogoFailed(true)} className="h-5 w-5 rounded border border-ink-200 bg-white object-contain" />
            )}
            <span>
              Managed by <span className="font-semibold text-ink-900">{managed.name}</span>
            </span>
          </span>
        )}
      </p>
    </div>
  )
}

/** Big, unmissable notice for live, ended and cancelled events. */
const PhaseBanner: React.FC<{ event: PublicEvent; state: ReturnType<typeof registrationState>; hasPass: boolean }> = ({ event, state, hasPass }) => {
  if (state.phase === 'cancelled') {
    return (
      <div role="alert" className="mb-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 sm:p-5">
        <Ban className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
        <div>
          <p className="text-lg font-bold">This event was cancelled</p>
          <p className="mt-0.5 text-sm">
            {state.reason} {hasPass ? 'Your pass will not be accepted.' : ''} Contact the organizer if you have questions.
          </p>
        </div>
      </div>
    )
  }
  if (state.phase === 'ended') {
    return (
      <div className="mb-4 flex gap-3 rounded-2xl border border-ink-200 bg-ink-100/70 p-4 text-ink-800 sm:p-5">
        <CalendarDays className="mt-0.5 h-6 w-6 shrink-0 text-ink-500" aria-hidden />
        <div>
          <p className="text-lg font-bold text-ink-900">This event has ended</p>
          <p className="mt-0.5 text-sm">It took place on {eventWhen(event).range}. Registration is closed.</p>
        </div>
      </div>
    )
  }
  if (state.phase === 'live') {
    return (
      <div className="mb-4 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 sm:p-5">
        <Radio className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <p className="text-lg font-bold">Happening now</p>
          <p className="mt-0.5 text-sm">{state.open ? 'You can still register and get your pass, then head to the gate.' : state.reason}</p>
        </div>
      </div>
    )
  }
  return null
}

const Fact: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex gap-3 rounded-xl border border-ink-200 bg-white p-4">
    <span className="mt-0.5 text-brand-600">{icon}</span>
    <div className="min-w-0 flex-1 text-sm">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  </div>
)

const SpotsMeter: React.FC<{ event: PublicEvent }> = ({ event }) => {
  const s = spotsInfo(event)
  // Organizer hides the numbers: only say whether there's room
  if (s.hidden) return <span className="font-semibold text-ink-900">{s.full ? 'Fully booked' : 'Spots available'}</span>
  if (s.capacity === null || s.left === null) return <span className="font-semibold text-ink-900">Open to everyone</span>
  const left = s.left
  const pct = Math.min(100, Math.round(((s.capacity - left) / s.capacity) * 100))
  return (
    <>
      <span className="font-semibold text-ink-900">{left === 0 ? 'Fully booked' : `${left.toLocaleString()} left`}</span>
      <span className="text-ink-500"> of {s.capacity.toLocaleString()}</span>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="meter" aria-label="Spots taken" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-red-500' : 'bg-brand-600')} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </>
  )
}

const TicketList: React.FC<{ types: PublicTicketType[]; canRegister: boolean; registerHref: string; payment?: PaymentOptions }> = ({ types, canRegister, registerHref, payment }) => {
  const anyPaid = types.some((t) => Number(t.price) > 0)
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {types.map((t) => {
          const unavailable = availabilityText(t)
          const open = t.availability === 'on_sale'
          const extras: string[] = []
          if (open && t.remaining !== null) extras.push(t.remaining <= 20 ? `Only ${t.remaining} left` : `${t.remaining.toLocaleString()} left`)
          if (open && t.sales_end) extras.push(`Ends ${fmtShortDate(t.sales_end)}`)
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className={cn('font-semibold', open ? 'text-ink-900' : 'text-ink-500')}>{t.name}</p>
                <p className={cn('shrink-0 font-display text-xl font-bold tabular', open ? 'text-ink-900' : 'text-ink-400')}>
                  {Number(t.price) > 0 ? `Rs ${money(t.price)}` : 'Free'}
                </p>
              </div>
              {t.description && <p className={cn('mt-1 text-sm', open ? 'text-ink-600' : 'text-ink-400')}>{t.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                {unavailable ? (
                  <Badge tone={t.availability === 'not_started' ? 'info' : 'neutral'}>{unavailable}</Badge>
                ) : (
                  <Badge tone="success" dot>
                    On sale
                  </Badge>
                )}
                {extras.map((x) => (
                  <span key={x} className={cn('rounded-full px-2 py-0.5 font-medium', /Only/.test(x) ? 'bg-red-50 text-red-700' : 'bg-ink-100 text-ink-700')}>
                    {x}
                  </span>
                ))}
              </div>
            </>
          )
          return (
            <li key={t.id}>
              {open && canRegister ? (
                <Link
                  to={`${registerHref}?ticket=${t.id}`}
                  aria-label={`Register with a ${t.name} ticket, ${priceText(t.price)}`}
                  className="block h-full rounded-2xl border border-ink-200 bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/30 sm:p-5"
                >
                  {body}
                </Link>
              ) : (
                <div className={cn('h-full rounded-2xl border p-4 sm:p-5', open ? 'border-ink-200 bg-white' : 'border-dashed border-ink-200 bg-ink-50')}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
      {anyPaid && (
        <p className="mt-3 text-sm text-ink-500">
          {payment?.online
            ? `Pick a ticket when you register. ${paymentNote(payment)}`
            : 'Pick a ticket when you register, then pay at the venue. No online payment.'}
        </p>
      )}
    </>
  )
}

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
    <h2 id={`${id}-heading`} className="mb-5 text-2xl font-bold text-ink-900">
      {title}
    </h2>
    {children}
  </section>
)

/** Who runs the event, with contact links. Under the registration card on desktop, at the end of the page on phones. */
const OrganizerCard: React.FC<{ event: PublicEvent; className?: string }> = ({ event, className }) => {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn('rounded-2xl border border-ink-200 bg-white p-5 sm:p-6', className)}>
      <h2 id={headingId} className="text-lg font-bold text-ink-900">
        Organizer
      </h2>
      <OrganizerLine event={event} className="mt-3" large />
      {(event.contact_email || event.contact_phone) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {event.contact_email && (
            <a href={`mailto:${event.contact_email}`} className="inline-flex items-center gap-2 rounded-[10px] border border-ink-200 px-3 py-2 text-sm text-ink-800 hover:bg-ink-50">
              <Mail className="h-4 w-4 text-ink-400" aria-hidden />
              {event.contact_email}
            </a>
          )}
          {event.contact_phone && (
            <a href={`tel:${event.contact_phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-2 rounded-[10px] border border-ink-200 px-3 py-2 text-sm text-ink-800 hover:bg-ink-50">
              <Phone className="h-4 w-4 text-ink-400" aria-hidden />
              {event.contact_phone}
            </a>
          )}
        </div>
      )}
    </section>
  )
}

const Schedule: React.FC<{ event: PublicEvent }> = ({ event }) => {
  const days = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const item of event.agenda) {
      const key = item.day || event.start_date
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, items]) => [day, items.sort((a, b) => a.start_time.localeCompare(b.start_time))] as const)
  }, [event])
  const [dayIdx, setDayIdx] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [, dayItems] = days[Math.min(dayIdx, days.length - 1)]
  const PREVIEW = 3
  const hidden = Math.max(0, dayItems.length - PREVIEW)
  const items = expanded ? dayItems : dayItems.slice(0, PREVIEW)

  return (
    <div>
      {days.length > 1 && (
        <div role="tablist" aria-label="Event days" className="mb-5 inline-flex gap-1 rounded-xl bg-ink-100 p-1">
          {days.map(([day], i) => (
            <button
              key={day}
              role="tab"
              id={`day-tab-${i}`}
              aria-selected={i === dayIdx}
              aria-controls="day-panel"
              onClick={() => {
                setDayIdx(i)
                setExpanded(false)
              }}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                i === dayIdx ? 'bg-white text-brand-700 shadow-xs' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              Day {i + 1}
              <span className="ml-1.5 hidden font-normal text-ink-500 sm:inline">{fmtShortDay(toDate(day))}</span>
            </button>
          ))}
        </div>
      )}
      <ol id="day-panel" role={days.length > 1 ? 'tabpanel' : undefined} aria-labelledby={days.length > 1 ? `day-tab-${dayIdx}` : undefined} className="relative space-y-3">
        {items.map((it) => (
          <li key={it.id ?? `${it.start_time}-${it.title}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 sm:grid-cols-[96px_minmax(0,1fr)]">
            <div className="pt-4 text-right">
              <p className="text-sm font-semibold text-ink-900 tabular">{fmtClock(it.start_time)}</p>
              {it.end_time && <p className="text-xs text-ink-500 tabular">{fmtClock(it.end_time)}</p>}
            </div>
            <div className="rounded-xl border border-ink-200 bg-white p-4">
              <p className="font-semibold text-ink-900">{it.title}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">
                {it.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {it.location}
                  </span>
                )}
                {it.speaker_names && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mic2 className="h-3.5 w-3.5" aria-hidden />
                    {it.speaker_names}
                  </span>
                )}
              </p>
              {it.description && <p className="mt-2 text-sm text-ink-600">{it.description}</p>}
            </div>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="day-panel"
          className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          {expanded ? 'Show less' : `See full schedule (${hidden} more)`}
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
        </button>
      )}
    </div>
  )
}

const SpeakerCard: React.FC<{ speaker: Speaker }> = ({ speaker: s }) => {
  const [open, setOpen] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const bioId = `bio-${(s.id ?? s.name).replace(/\W/g, '')}`
  return (
    <li className="flex gap-4 rounded-2xl border border-ink-200 bg-white p-4">
      {s.photo_url && !imgFailed ? (
        <img src={s.photo_url} alt="" onError={() => setImgFailed(true)} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
      ) : (
        <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-brand-50 font-display text-xl font-bold text-brand-700">
          {initials(s.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink-900">{s.name}</p>
        {(s.role || s.organization) && <p className="text-sm text-ink-500">{[s.role, s.organization].filter(Boolean).join(', ')}</p>}
        {s.bio && (
          <>
            <p id={bioId} className={cn('mt-2 text-sm text-ink-600', !open && 'line-clamp-2')}>
              {s.bio}
            </p>
            {s.bio.length > 90 && (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={bioId}
                onClick={() => setOpen((v) => !v)}
                className="mt-1 text-sm font-medium text-brand-700 hover:underline"
              >
                {open ? 'Show less' : 'Read more'}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}

const Venue: React.FC<{ event: PublicEvent }> = ({ event }) => {
  const q = event.map_query || event.location
  const [loadMap, setLoadMap] = useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  // Only load the map iframe when the section comes near the viewport
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setLoadMap(true)
    const obs = new IntersectionObserver(([en]) => en.isIntersecting && (setLoadMap(true), obs.disconnect()), { rootMargin: '300px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="flex gap-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div>
            <p className="font-semibold text-ink-900">{event.location}</p>
            {event.map_query && event.map_query !== event.location && <p className="text-sm text-ink-500">{event.map_query}</p>}
          </div>
        </div>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          Open in Maps
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <div ref={ref} className="aspect-[16/9] w-full border-t border-ink-200 bg-ink-100 sm:aspect-[16/7]">
        {loadMap && (
          <iframe
            title={`Map of ${event.location}`}
            src={`https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  )
}

function useCountdown(iso?: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!iso) return
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [iso])
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return null
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d} ${d === 1 ? 'day' : 'days'} ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`
}

const CtaButtons: React.FC<{ label: string; state: ReturnType<typeof registrationState>; hasPass: boolean; registerHref: string; slug: string; compact?: boolean }> = ({
  state,
  hasPass,
  registerHref,
  slug,
  compact,
  label,
}) => {
  if (hasPass) {
    return (
      <ButtonLink to={`/e/${slug}/register?view=pass`} size={compact ? 'md' : 'lg'} className={compact ? '' : 'w-full'} icon={<TicketIcon className="h-4 w-4" aria-hidden />}>
        {getStoredPasses(slug).length > 1 ? 'View my passes' : 'View my pass'}
      </ButtonLink>
    )
  }
  if (!state.open) {
    return (
      <Button size={compact ? 'md' : 'lg'} disabled className={compact ? '' : 'w-full'} aria-describedby="reg-closed-reason">
        {state.label}
      </Button>
    )
  }
  return (
    <ButtonLink to={registerHref} size={compact ? 'md' : 'lg'} className={compact ? 'px-6' : 'w-full'}>
      {label}
    </ButtonLink>
  )
}

const RegistrationCard: React.FC<{ event: PublicEvent; state: ReturnType<typeof registrationState>; price: string; hasPass: boolean; registerHref: string; over: boolean }> = ({
  event,
  state,
  price,
  hasPass,
  registerHref,
  over,
}) => {
  const countdown = useCountdown(state.open ? event.registration_deadline : null)
  if (over) {
    return (
      <Card className={cn('p-5', state.phase === 'cancelled' && 'border-red-200')}>
        <h2 className="text-base font-bold text-ink-900">{state.phase === 'cancelled' ? 'This event was cancelled' : 'This event has ended'}</h2>
        <p className="mt-2 text-sm text-ink-600">{state.reason}</p>
        {hasPass && (
          <div className="mt-4">
            <CtaButtons label={bookLabel(event)} state={state} hasPass registerHref={registerHref} slug={event.slug} />
          </div>
        )}
        <Link to="/events" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Find other events
        </Link>
      </Card>
    )
  }
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-ink-900">Registration</h2>
      <p className="mt-3 font-display text-3xl font-bold text-ink-900">{price}</p>
      {hasPaidTickets(event) && <p className="text-sm text-ink-500">{paymentNote(event.payment_options)}</p>}
      <div className="mt-4 text-sm">
        <SpotsMeter event={event} />
      </div>
      {countdown && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-marigold-50 px-3 py-2 text-sm text-marigold-900">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          Registration closes in {countdown}
        </p>
      )}
      <div className="mt-5">
        <CtaButtons label={bookLabel(event)} state={state} hasPass={hasPass} registerHref={registerHref} slug={event.slug} />
      </div>
      {!state.open && !hasPass && (
        <p id="reg-closed-reason" className="mt-2 text-sm text-ink-500">
          {state.reason}
        </p>
      )}
      {hasPass ? (
        <p className="mt-3 text-center text-sm text-ink-500">
          You're registered on this device.{' '}
          {state.open && (
            <Link to={registerHref} className="font-medium text-brand-700 hover:underline">
              Register someone else
            </Link>
          )}
        </p>
      ) : (
        state.open && <p className="mt-3 text-center text-xs text-ink-500">Takes about a minute. Your QR pass appears right away.</p>
      )}
    </Card>
  )
}
