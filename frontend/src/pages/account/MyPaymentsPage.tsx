import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, Receipt, Ticket, Vote } from 'lucide-react'
import { isModuleDisabled } from '@/services/api'
import { PROVIDER_BRAND, paymentsApi, rs, type PayerPayment } from '@/lib/payments'
import { Badge, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { ACCOUNT_PAGE } from './MyTicketsPage'

const STATUS: Record<PayerPayment['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  paid: { label: 'Paid', tone: 'success' },
  pending: { label: 'Awaiting payment', tone: 'warning' },
  created: { label: 'Not started', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'info' },
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Online payments the signed-in user made (tickets, vote packs), on any device. */
export const MyPaymentsPage: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['me-payments'],
    queryFn: () => paymentsApi.mine(),
    retry: (n, e) => !isModuleDisabled(e) && n < 1,
  })
  const items = data?.results ?? []

  return (
    <div className={ACCOUNT_PAGE}>
      <PageHeader
        title="My payments"
        description="Tickets and vote packs you paid for online with Khalti or eSewa. Refunds are handled by the organizer."
      />
      {isModuleDisabled(error) ? (
        <Card>
          <EmptyState icon={<CreditCard className="h-6 w-6" />} title="Online payments are turned off" description="Your payments aren’t available right now." />
        </Card>
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Receipt className="h-6 w-6" />}
            title="No payments yet"
            description="When you pay for tickets or vote packs online while signed in, they show here."
            action={<ButtonLink to="/events">Find events</ButtonLink>}
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id}>
              <PaymentRow payment={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const PaymentRow: React.FC<{ payment: PayerPayment }> = ({ payment: p }) => {
  const brand = PROVIDER_BRAND[p.provider ?? 'venue'] ?? PROVIDER_BRAND.venue
  const st = STATUS[p.status] ?? { label: p.status, tone: 'neutral' as const }
  const s = p.summary
  const detail =
    s?.type === 'ticket_order' && 'ticket_count' in s
      ? `${s.ticket_count ?? ''} ${s.ticket_count === 1 ? 'ticket' : 'tickets'}${s.order_reference ? ` · Order ${s.order_reference}` : ''}`
      : s?.type === 'vote_pack' && 'votes' in s
        ? `${s.votes ?? ''} votes${s.contest ? ` · ${s.contest.title}` : ''}${s.credited ? ' · added to your balance' : ''}`
        : p.purpose_label
  const link =
    s?.type === 'vote_pack' && 'contest' in s && s.contest
      ? `/e/${s.contest.event_slug}/vote/${s.contest.slug}`
      : s?.type === 'ticket_order' && p.status === 'paid'
        ? '/app/my/tickets'
        : p.event
          ? `/e/${p.event.slug}`
          : null
  const Icon = s?.type === 'vote_pack' ? Vote : Ticket
  return (
    <Card className="flex items-start gap-3 p-4">
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-bold"
        style={{ background: brand.bg, color: brand.fg }}
      >
        {brand.mark}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 truncate font-semibold text-ink-900">{p.description || p.purpose_label}</p>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-600">
          <Icon className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          <span className="truncate">{detail}</span>
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {when(p.created_at)}
          {p.provider_name ? ` · ${p.provider_name}` : ''}
          {p.provider_txn_id ? ` · ref ${p.provider_txn_id}` : ''}
        </p>
        {p.failure_reason && p.status !== 'paid' && <p className="mt-1 text-xs text-ink-500">{p.failure_reason}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="font-display text-lg font-bold text-ink-900 tabular">{rs(p.amount)}</p>
        {link && (
          <Link to={link} className="text-sm font-semibold text-brand-700 underline underline-offset-2">
            {s?.type === 'vote_pack' ? 'Vote' : p.status === 'paid' ? 'Passes' : 'Event'}
          </Link>
        )}
      </div>
    </Card>
  )
}
