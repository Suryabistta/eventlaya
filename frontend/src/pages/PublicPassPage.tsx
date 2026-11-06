import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Ban, CalendarDays, ExternalLink, MapPin, Printer, Ticket as TicketIcon } from 'lucide-react'
import { TicketPass, PrintablePass } from '@/components/TicketPassModal'
import { DownloadPassButton } from '@/components/DownloadPassButton'
import { Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { eventWhen, getPublicPass } from '@/lib/event-page'
import { ApiError } from '@/services/api'

const isNotFound = (err: unknown) => (err instanceof ApiError && err.status === 404) || (err instanceof Error && /not found|\(404\)/i.test(err.message))

/** /ticket/:token: the pass linked from the confirmation email. Public: the token is the secret. */
export const PublicPassPage: React.FC = () => {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['publicPass', token],
    queryFn: () => getPublicPass(token!),
    enabled: Boolean(token),
    retry: (count, err) => !isNotFound(err) && count < 1,
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-72 rounded-2xl" />
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
  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Card>
          <EmptyState
            icon={<AlertCircle className="h-6 w-6" aria-hidden />}
            title="We couldn't find this pass"
            description="The link may be incomplete. Open it again from your confirmation email, or sign in to see your tickets."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to="/app/my/tickets" variant="secondary">
                  My tickets
                </ButtonLink>
                <ButtonLink to="/events" variant="ghost">
                  Find events
                </ButtonLink>
              </div>
            }
          />
        </Card>
      </div>
    )
  }

  const { ticket, event } = data
  const when = eventWhen({ start_date: event.start_date, start_time: event.start_time ?? undefined, end_date: event.end_date ?? undefined, end_time: event.end_time ?? undefined })
  const meta = { eventTitle: event.title, eventLocation: event.location, eventDate: when.shortDate }
  const cancelled = ticket.status === 'cancelled' || event.phase === 'cancelled'
  const ended = event.phase === 'ended'

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <p className="text-sm font-medium text-brand-700">{ticket.guest_number ? `Guest pass · Ticket ${ticket.guest_number + 1}` : 'Entry pass'}</p>
        <h1 className="mt-1 font-display text-2xl font-bold leading-tight text-ink-900 sm:text-3xl">
          <Link to={`/e/${event.slug}`} className="hover:text-brand-700">
            {event.title}
          </Link>
        </h1>
        <ul className="mt-2 space-y-1 text-sm text-ink-600">
          <li className="flex items-start gap-1.5">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {when.shortDate}
          </li>
          {event.location && (
            <li className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0">{event.location}</span>
            </li>
          )}
        </ul>
        {ticket.order_reference && (
          <p className="mt-2 text-sm text-ink-500">
            Order <span className="font-mono font-semibold text-ink-800">{ticket.order_reference}</span>
          </p>
        )}
      </div>

      {cancelled ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {event.phase === 'cancelled' ? 'This event was cancelled. This pass no longer works at the gate.' : 'This pass was cancelled and no longer works at the gate.'}
        </p>
      ) : ended ? (
        <p className="rounded-xl bg-ink-100 px-4 py-3 text-sm text-ink-700">This event has ended. Keep the pass as a record.</p>
      ) : (
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <TicketIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          Show the QR code at the gate. Each pass is scanned once, so every guest needs their own.
        </p>
      )}

      <TicketPass ticket={ticket} {...meta} />
      <PrintablePass ticket={ticket} {...meta} />

      <div className="grid gap-2 sm:grid-cols-2">
        <DownloadPassButton ticket={ticket} {...meta} size="lg" variant="primary" />
        <Button variant="secondary" size="lg" icon={<Printer className="h-5 w-5" aria-hidden />} onClick={() => window.print()}>
          Save or print pass
        </Button>
      </div>
      <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-500">
        <span>Take a screenshot too, in case you have no signal at the venue.</span>
        <Link to={`/e/${event.slug}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          Event page
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </p>
    </div>
  )
}

export default PublicPassPage
