import React, { useMemo, useState } from 'react'
import { formatDate, formatDateTime } from '@/lib/dates'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarPlus, CheckCircle2, Download, Info, Search, Undo2, Wallet } from 'lucide-react'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, StatTile, Textarea, useToast } from '@/components/ui'
import { ProviderMark } from '@/components/payments'
import { useCurrentEvent } from '@/lib/event-context'
import { useModuleEnabled } from '@/lib/modules'
import { downloadCsv, PAYMENT_STATUS_META, paymentsApi, rs, type OrderFilters, type OrderRow } from '@/lib/payments'
import { cn } from '@/lib/utils'

const fmtDateTime = (iso: string) => formatDateTime(iso)

const STATUS_OPTIONS = [
  { value: '', label: 'Any (not released)' },
  { value: 'paid', label: 'Paid' },
  { value: 'due', label: 'To pay at the venue' },
  { value: 'pending', label: 'Awaiting online payment' },
  { value: 'failed', label: 'Not paid (released)' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'free', label: 'Free' },
]

/** Organizer: every order of the current event with how it's paid (online / at the venue), plus online totals. */
export const PaymentsPage: React.FC = () => {
  const { currentEvent, isLoading, isError, error, refetch } = useCurrentEvent()
  const paymentsOn = useModuleEnabled('payments')
  const wrap = (children: React.ReactNode) => <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>
  if (isError) return wrap(<ErrorState message={error?.message} onRetry={refetch} />)
  if (isLoading) return wrap(<Skeleton className="h-64 rounded-2xl" />)
  if (!currentEvent) {
    return wrap(
      <>
        <PageHeader title="Payments" />
        <Card>
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" aria-hidden />}
            title="Create an event first"
            description="Orders and payments belong to an event."
            action={<ButtonLink to="/app/events/new">Create an event</ButtonLink>}
          />
        </Card>
      </>,
    )
  }
  return wrap(
    <>
      <EventOrders key={currentEvent.id} eventId={currentEvent.id} eventTitle={currentEvent.title} eventSlug={currentEvent.slug} />
      {paymentsOn && <OnlineSummary />}
    </>,
  )
}

const EventOrders: React.FC<{ eventId: string; eventTitle: string; eventSlug: string }> = ({ eventId, eventTitle, eventSlug }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [filters, setFilters] = useState<OrderFilters>({})
  const [search, setSearch] = useState('')
  const [refunding, setRefunding] = useState<OrderRow | null>(null)
  const applied = useMemo(() => ({ ...filters, search: search.trim() || undefined }), [filters, search])
  const query = useQuery({ queryKey: ['event-orders', eventId, applied], queryFn: () => paymentsApi.orders(eventId, applied), placeholderData: keepPreviousData })

  const act = useMutation({
    mutationFn: ({ order, action, note }: { order: OrderRow; action: 'mark-paid' | 'mark-unpaid' | 'refund'; note?: string }) =>
      paymentsApi.orderAction(eventId, order.id, action, note),
    onSuccess: (row, v) => {
      void qc.invalidateQueries({ queryKey: ['event-orders', eventId] })
      void qc.invalidateQueries({ queryKey: ['payments-summary'] })
      setRefunding(null)
      toast.success(
        v.action === 'mark-paid' ? `${row.reference} marked paid` : v.action === 'refund' ? `${row.reference} marked refunded` : `${row.reference} back to "pay at the venue"`,
        v.action === 'refund' ? 'Its passes no longer work at the gate.' : undefined,
      )
    },
    onError: (e: Error) => toast.error("Couldn't update the order", e.message),
  })

  const data = query.data
  const t = data?.totals
  const online = data?.settings.effective.online

  return (
    <>
      <PageHeader
        title="Payments"
        description={`Orders for ${eventTitle}: who paid online, who pays at the venue, and refunds.`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="h-4 w-4" aria-hidden />}
            onClick={() => downloadCsv(paymentsApi.ordersCsvPath(eventId, applied), `eventlaya_orders_${eventSlug}.csv`).catch((e: Error) => toast.error('Export failed', e.message))}
          >
            Export CSV
          </Button>
        }
      />

      <div className="flex items-start gap-2.5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">How the money flows.</span> Online payments (Khalti, eSewa) are collected by Eventlaya's merchant accounts and paid out to you by bank
          transfer; the totals below show what's owed. Cash at the venue goes straight to you: mark those orders paid when you collect. Refunds are always made by hand —
          marking an order refunded only records it and cancels its passes.{' '}
          <Link to="/app/tickets" className="font-semibold underline underline-offset-2">
            Payment options
          </Link>
        </p>
      </div>

      {query.isError ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
      ) : !data || !t ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Collected online" value={rs(t.online_collected)} hint={`${t.online_orders} order${t.online_orders === 1 ? '' : 's'}${online ? '' : ' · online is off'}`} tone="success" icon={<Wallet className="h-5 w-5" aria-hidden />} />
            <StatTile label="Paid at the venue" value={rs(t.venue_collected)} hint={`${t.venue_paid_orders} marked paid`} tone="brand" />
            <StatTile label="Still to collect at the venue" value={rs(t.venue_due)} hint={`${t.venue_due_orders} order${t.venue_due_orders === 1 ? '' : 's'}`} tone="warning" />
            <StatTile
              label="Refunded"
              value={rs(t.refunded)}
              hint={`${t.refunded_orders} refunded · ${t.pending_orders} paying now · ${t.released_orders} released`}
              tone="neutral"
            />
          </div>

          {t.needs_attention > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-marigold-200 bg-marigold-50 px-4 py-3 text-sm text-marigold-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{t.needs_attention} order{t.needs_attention === 1 ? ' needs' : 's need'} your attention</span> (paid after the ticket hold ran out, with no
                tickets left). Refund the buyer and mark it refunded.{' '}
                <button type="button" className="font-semibold underline" onClick={() => setFilters((f) => ({ ...f, attention: true }))}>
                  Show
                </button>
              </span>
            </p>
          )}

          <Card>
            <CardHeader title="Orders" description={`${data.count} order${data.count === 1 ? '' : 's'}${applied.status || applied.method || applied.search || applied.attention ? ' match' : ''}`} />
            <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] sm:px-5">
              <div className="relative">
                <Input label="Search" placeholder="Name, email, order, reference" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Search className="pointer-events-none absolute right-3 top-[38px] h-4 w-4 text-ink-400" aria-hidden />
              </div>
              <Select label="Payment" value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined, attention: undefined }))}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select label="Method" value={filters.method ?? ''} onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value || undefined }))}>
                <option value="">Any method</option>
                <option value="online">Online</option>
                <option value="venue">At the venue</option>
                <option value="free">Free</option>
              </Select>
              <Input label="From" type="date" value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} />
              <Input label="To" type="date" value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} />
            </div>
            {data.results.length === 0 ? (
              <EmptyState icon={<Wallet className="h-6 w-6" aria-hidden />} title="No orders here" description="Orders show up as soon as someone registers." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.results.map((o) => (
                  <OrderItem
                    key={o.id}
                    order={o}
                    busy={act.isPending && act.variables?.order.id === o.id}
                    onMarkPaid={() => act.mutate({ order: o, action: 'mark-paid' })}
                    onUndo={() => act.mutate({ order: o, action: 'mark-unpaid' })}
                    onRefund={() => setRefunding(o)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <RefundModal
        order={refunding}
        loading={act.isPending}
        onClose={() => setRefunding(null)}
        onConfirm={(note) => refunding && act.mutate({ order: refunding, action: 'refund', note })}
      />
    </>
  )
}

const OrderItem: React.FC<{ order: OrderRow; busy: boolean; onMarkPaid: () => void; onUndo: () => void; onRefund: () => void }> = ({ order: o, busy, onMarkPaid, onUndo, onRefund }) => {
  const meta = PAYMENT_STATUS_META[o.payment.status]
  const provider = o.payment.provider && o.payment.provider !== 'venue' ? o.payment.provider : o.payment.status === 'paid' ? 'venue' : null
  const types = Object.entries(o.tickets.reduce<Record<string, number>>((m, t) => ((m[t.ticket_type_name || 'Ticket'] = (m[t.ticket_type_name || 'Ticket'] ?? 0) + 1), m), {}))
  return (
    <li className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_12rem] lg:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-sm font-semibold text-ink-900">{o.reference}</span>
          <span className="text-xs text-ink-500">{fmtDateTime(o.created_at)}</span>
        </p>
        <p className="truncate text-sm font-medium text-ink-900">{o.buyer_name}</p>
        <p className="truncate text-xs text-ink-500">
          {o.buyer_email}
          {o.buyer_phone ? ` · ${o.buyer_phone}` : ''}
        </p>
      </div>
      <div className="min-w-0 text-sm text-ink-700">
        <p className="font-semibold tabular text-ink-900">{Number(o.total) > 0 ? rs(o.total) : 'Free'}</p>
        <p className="text-xs text-ink-500">{types.map(([name, n]) => `${n} × ${name}`).join(', ')}</p>
        {o.promo_code && <p className="text-xs text-ink-500">Code {o.promo_code}</p>}
      </div>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          {provider && <ProviderMark id={provider} size="sm" />}
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </p>
        <p className="mt-1 break-words text-xs text-ink-600">{o.payment.label}</p>
        {o.needs_attention && (
          <p className="mt-1 flex items-start gap-1 text-xs font-medium text-marigold-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {o.needs_attention}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {o.payment.status === 'due' && (
          <Button size="sm" variant="secondary" loading={busy} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} onClick={onMarkPaid}>
            Mark paid at venue
          </Button>
        )}
        {o.payment.status === 'paid' && o.payment.provider === 'venue' && (
          <Button size="sm" variant="ghost" loading={busy} icon={<Undo2 className="h-4 w-4" aria-hidden />} onClick={onUndo}>
            Undo
          </Button>
        )}
        {o.payment.status === 'paid' && (
          <Button size="sm" variant="ghost" onClick={onRefund} className={cn(o.needs_attention && 'text-marigold-800')}>
            Mark refunded
          </Button>
        )}
      </div>
    </li>
  )
}

const RefundModal: React.FC<{ order: OrderRow | null; loading: boolean; onClose: () => void; onConfirm: (note: string) => void }> = ({ order, loading, onClose, onConfirm }) => {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const online = order && order.payment.provider !== 'venue'
  return (
    <Modal
      open={Boolean(order)}
      onClose={() => {
        setNote('')
        setError(undefined)
        onClose()
      }}
      title={order ? `Mark ${order.reference} refunded` : 'Mark refunded'}
      description={order ? `${order.buyer_name} · ${rs(order.total)}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => {
              if (!note.trim()) return setError('Say how and when the money went back, e.g. "Refunded to Khalti wallet on 28 Oct".')
              onConfirm(note.trim())
              setNote('')
            }}
          >
            Mark refunded
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-marigold-50 px-3.5 py-2.5 text-sm text-marigold-900">
          This only records the refund and cancels the order's passes. It doesn't move money.{' '}
          {online
            ? 'For online payments, the refund is made from the Khalti / eSewa merchant dashboard by Eventlaya (contact support), or deducted from your payout.'
            : 'Give the cash back yourself.'}
        </p>
        <Textarea label="Note" required rows={3} value={note} error={error} onChange={(e) => setNote(e.target.value)} placeholder="Refunded to Khalti wallet 98XXXXXXXX on 28 Oct" />
      </div>
    </Modal>
  )
}

/** Online money across all the organizer's events: collected, platform fee, paid out, still owed. */
const OnlineSummary: React.FC = () => {
  const query = useQuery({ queryKey: ['payments-summary'], queryFn: paymentsApi.organizerSummary })
  const toast = useToast()
  if (query.isLoading) return <Skeleton className="h-40 rounded-2xl" />
  if (query.isError || !query.data) return null
  const s = query.data
  return (
    <Card>
      <CardHeader
        title="Online payments, all events"
        description={`Collected by Eventlaya for you${Number(s.platform_fee_percent) > 0 ? `, ${s.platform_fee_percent}% platform fee` : ''}. Payouts are made by bank transfer.`}
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Download className="h-4 w-4" aria-hidden />}
            onClick={() => downloadCsv(paymentsApi.organizerCsvPath(), 'eventlaya_online_payments.csv').catch((e: Error) => toast.error('Export failed', e.message))}
          >
            All online payments (CSV)
          </Button>
        }
      />
      <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-4 sm:px-5">
        {[
          ['Collected', s.totals.collected],
          ['Platform fee', s.totals.platform_fee],
          ['Paid out to you', s.totals.paid_out],
          ['Owed to you', s.totals.owed],
        ].map(([label, v]) => (
          <div key={label}>
            <p className="text-xs text-ink-500">{label}</p>
            <p className="text-lg font-bold tabular text-ink-900">{rs(v)}</p>
          </div>
        ))}
      </div>
      {s.events.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">No online payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-500">
                <th className="px-5 py-2 font-medium">Event</th>
                <th className="px-3 py-2 text-right font-medium">Payments</th>
                <th className="px-3 py-2 text-right font-medium">Collected</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 text-right font-medium">Paid out</th>
                <th className="px-5 py-2 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {s.events.map((e, i) => (
                <tr key={e.event?.id ?? i}>
                  <td className="px-5 py-2.5 font-medium text-ink-900">{e.event?.title ?? 'Not tied to an event'}</td>
                  <td className="px-3 py-2.5 text-right tabular">{e.payments}</td>
                  <td className="px-3 py-2.5 text-right tabular">{rs(e.collected)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-500">{rs(e.platform_fee)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{rs(e.paid_out)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular">{rs(e.owed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.payouts.length > 0 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-ink-900">Payouts received</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-700">
            {s.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {formatDate(new Date(p.paid_on), 'medium')} · {p.method_label}
                  {p.reference ? ` · ${p.reference}` : ''}
                  {p.event ? ` · ${p.event.title}` : ''}
                </span>
                <span className="font-semibold tabular">{rs(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
