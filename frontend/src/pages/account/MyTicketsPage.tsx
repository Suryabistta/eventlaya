import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ExternalLink, MapPin, Printer, QrCode, Star, Ticket as TicketIcon, Users } from 'lucide-react'
import { VerifiedBadge } from '@/components/VerifiedBadge'
import type { Ticket } from '@/services/api'
import { accountApi, mediaUrl, type MyTicket } from '@/lib/account'
import { eventWhen, sortPasses } from '@/lib/event-page'
import { phaseMeta } from '@/lib/phase'
import { useModuleEnabled } from '@/lib/modules'
import { reviewsApi, type Review } from '@/lib/reviews'
import { PrintablePasses, TicketPassModal } from '@/components/TicketPassModal'
import { ReviewFormModal } from '@/components/reviews'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

export const ACCOUNT_PAGE = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'

type When = 'upcoming' | 'past'

const whenOf = (e: MyTicket['event']) =>
  eventWhen({ start_date: e.start_date, start_time: e.start_time ?? undefined, end_date: e.end_date ?? undefined, end_time: e.end_time ?? undefined })

const STATUS: Record<Ticket['status'], { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }> = {
  valid: { label: 'Pass ready', tone: 'info' },
  checked_in: { label: 'Checked in', tone: 'success' },
  checked_out: { label: 'Attended', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  reserved: { label: 'Awaiting payment', tone: 'info' },
}

/** Passes bought together (same order) share one card; older passes without an order stand alone. */
function groupByOrder(list: MyTicket[]): MyTicket[][] {
  const groups = new Map<string, MyTicket[]>()
  for (const t of list) {
    const key = t.order_reference ? `${t.event.id}:${t.order_reference}` : t.id
    const g = groups.get(key)
    if (g) g.push(t)
    else groups.set(key, [t])
  }
  return [...groups.values()].map((g) => sortPasses(g))
}

/** "Your pass" for the buyer, "Guest 2" etc. for the passes they got for others. */
const passRole = (t: Pick<Ticket, 'guest_number'>) => (t.guest_number ? `Guest ${t.guest_number + 1}` : 'Your pass')

/** The attendee's tabs (upcoming/past) of events they hold passes for. */
export const MyTicketsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const when: When = params.get('when') === 'past' ? 'past' : 'upcoming'
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-tickets', when],
    queryFn: () => accountApi.myTickets(when),
  })
  const [pass, setPass] = useState<MyTicket | null>(null)
  const [printing, setPrinting] = useState<MyTicket[] | null>(null)
  // Print a whole order: render its passes for print, then open the print dialog
  useEffect(() => {
    if (!printing) return
    const id = requestAnimationFrame(() => {
      window.print()
      setPrinting(null)
    })
    return () => cancelAnimationFrame(id)
  }, [printing])

  const setWhen = (w: When) => setParams(w === 'upcoming' ? {} : { when: w }, { replace: true })
  const tickets = data?.results ?? []
  const groups = groupByOrder(tickets)

  return (
    <div className={ACCOUNT_PAGE}>
      <PageHeader
        title="My tickets"
        description="Your registrations and passes. For events with a pass, show its QR code at the gate."
        actions={
          <ButtonLink to="/events" variant="secondary" icon={<CalendarDays className="h-4 w-4" aria-hidden />}>
            Find events
          </ButtonLink>
        }
      />

      <div role="tablist" aria-label="Which events" className="inline-flex rounded-xl bg-ink-100 p-1">
        {(['upcoming', 'past'] as const).map((w) => (
          <button
            key={w}
            role="tab"
            type="button"
            aria-selected={when === w}
            onClick={() => setWhen(w)}
            className={cn('h-9 rounded-lg px-4 text-sm font-semibold transition-colors', when === w ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900')}
          >
            {w === 'upcoming' ? 'Upcoming' : 'Past'}
          </button>
        ))}
      </div>

      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TicketIcon className="h-6 w-6" />}
            title={when === 'upcoming' ? 'No upcoming events' : 'No past events yet'}
            description={
              when === 'upcoming'
                ? 'When you register for an event while signed in, your pass appears here.'
                : 'Events you’ve been to show up here, so you can find your passes and review them.'
            }
            action={when === 'upcoming' ? <ButtonLink to="/events">Browse events</ButtonLink> : undefined}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {groups.map((g) => (
            <li key={g[0].id}>
              <TicketCard tickets={g} onShowPass={setPass} onPrintAll={() => setPrinting(g.filter((t) => t.status !== 'cancelled'))} />
            </li>
          ))}
        </ul>
      )}

      {printing && !pass && (
        <PrintablePasses
          tickets={printing.map((t) => ({ ...t, ticket_type: t.ticket_type?.id ?? null }) as Ticket)}
          eventTitle={printing[0].event.title}
          eventLocation={printing[0].event.location}
          eventDate={whenOf(printing[0].event).shortDate}
        />
      )}
      {pass && (
        <TicketPassModal
          ticket={{ ...pass, ticket_type: pass.ticket_type?.id ?? null } as Ticket}
          eventTitle={pass.event.title}
          eventLocation={pass.event.location}
          eventDate={whenOf(pass.event).shortDate}
          onClose={() => setPass(null)}
        />
      )}
    </div>
  )
}

const TicketCard: React.FC<{ tickets: MyTicket[]; onShowPass: (t: MyTicket) => void; onPrintAll: () => void }> = ({ tickets, onShowPass, onPrintAll }) => {
  const t = tickets[0]
  const many = tickets.length > 1
  const reviewsOn = useModuleEnabled('reviews')
  const toast = useToast()
  const [reviewing, setReviewing] = useState(false)
  const [existing, setExisting] = useState<Review | null>(null)
  const e = t.event
  const when = whenOf(e)
  const phase = phaseMeta[e.phase] ?? phaseMeta.upcoming
  // Registration-only events have no pass: shown as "Registered", nothing to open
  const status = t.registration_only && t.status === 'valid' ? { label: 'Registered', tone: 'success' as const } : (STATUS[t.status] ?? STATUS.valid)
  const banner = mediaUrl(e.banner)
  const usable = t.status !== 'cancelled' && e.phase !== 'cancelled' && !t.registration_only

  const editReview = async () => {
    if (!t.my_review_id) return
    try {
      setExisting(await reviewsApi.get(t.my_review_id))
    } catch (err) {
      toast.error('Couldn’t open your review', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative h-28 shrink-0 bg-gradient-to-br from-brand-600 to-brand-800">
        {banner && <img src={banner} alt="" className="h-full w-full object-cover" loading="lazy" />}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <Badge tone={phase.tone} dot={e.phase === 'live'} className="bg-white/95 shadow-2xs">
            {phase.label}
          </Badge>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-snug text-ink-900">
            <Link to={`/e/${e.slug}`} className="hover:text-brand-700">
              {e.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            By {e.organizer_name}
            {e.organizer_verified && <VerifiedBadge className="ml-1 [&_svg]:h-3.5 [&_svg]:w-3.5" />}
          </p>
        </div>
        <ul className="space-y-1 text-sm text-ink-700">
          <li className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {when.shortDate}
          </li>
          {e.location && (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0">{e.location}</span>
            </li>
          )}
        </ul>
        {many ? (
          <div className="rounded-xl border border-ink-200">
            <p className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink-900">
                <Users className="h-3.5 w-3.5 text-ink-400" aria-hidden />
                {tickets.length} passes
              </span>
              {t.order_reference && <span className="font-mono text-ink-500">{t.order_reference}</span>}
            </p>
            <ul className="divide-y divide-ink-100">
              {tickets.map((p) => {
                const st = STATUS[p.status] ?? STATUS.valid
                const ok = p.status !== 'cancelled' && e.phase !== 'cancelled'
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{p.attendee_name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                        <span>{passRole(p)}</span>
                        {p.ticket_type_name && <span>· {p.ticket_type_name}</span>}
                        {p.status !== 'valid' && <Badge tone={st.tone}>{st.label}</Badge>}
                      </p>
                    </div>
                    {ok && (
                      <Button size="sm" variant="secondary" onClick={() => onShowPass(p)} icon={<QrCode className="h-4 w-4" aria-hidden />} aria-label={`Show pass for ${p.attendee_name}`}>
                        Pass
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={status.tone}>{status.label}</Badge>
            {t.ticket_type_name && <Badge>{t.ticket_type_name}</Badge>}
            {t.guest_number ? <Badge>{passRole(t)}</Badge> : null}
            <span className="font-mono text-ink-500">{t.ticket_number}</span>
          </div>
        )}
        {t.payment && t.payment.status !== 'free' && (
          <p
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-xs font-semibold',
              t.payment.status === 'paid' ? 'bg-emerald-50 text-emerald-800' : t.payment.status === 'due' ? 'bg-marigold-50 text-marigold-900' : 'bg-ink-100 text-ink-700',
            )}
          >
            {t.payment.label}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-100 pt-3">
          {usable && !many && (
            <Button size="sm" onClick={() => onShowPass(t)} icon={<QrCode className="h-4 w-4" aria-hidden />}>
              Show pass
            </Button>
          )}
          {usable && many && (
            <Button size="sm" onClick={onPrintAll} icon={<Printer className="h-4 w-4" aria-hidden />}>
              Print all passes
            </Button>
          )}
          {reviewsOn && t.can_review && (
            <Button size="sm" variant="dark" onClick={() => setReviewing(true)} icon={<Star className="h-4 w-4" aria-hidden />}>
              Write a review
            </Button>
          )}
          {reviewsOn && t.my_review_id && (
            <Button size="sm" variant="secondary" onClick={editReview} icon={<Star className="h-4 w-4 fill-marigold-400 text-marigold-400" aria-hidden />}>
              Edit your review
            </Button>
          )}
          <ButtonLink to={`/e/${e.slug}`} size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
            Event page
          </ButtonLink>
        </div>
      </div>
      {reviewsOn && (
        <>
          <ReviewFormModal open={reviewing} onClose={() => setReviewing(false)} kind="event" targetKey={e.slug} targetName={e.title} />
          <ReviewFormModal open={Boolean(existing)} onClose={() => setExisting(null)} kind="event" targetName={e.title} existing={existing} />
        </>
      )}
    </Card>
  )
}

export default MyTicketsPage
