import React, { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Search, Trash2, Wallet, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, Select, Skeleton, StatTile, Textarea, useToast } from '@/components/ui'
import { ProviderMark } from '@/components/payments'
import { downloadCsv, paymentsApi, rs, type IntentFilters, type IntentRow, type IntentStatus } from '@/lib/payments'
import { PAGE, fmtDate } from './shared'

const STATUS_TONE: Record<IntentStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  paid: 'success',
  pending: 'info',
  created: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
  refunded: 'warning',
}

/** Superadmin: all online payments, provider health, platform fee + hold time, payouts to organizers. */
export const PaymentsAdminPage: React.FC = () => {
  const toast = useToast()
  const overview = useQuery({ queryKey: ['payments-admin-overview'], queryFn: paymentsApi.adminOverview })
  const [filters, setFilters] = useState<IntentFilters>({})
  const [search, setSearch] = useState('')
  const applied = useMemo(() => ({ ...filters, search: search.trim() || undefined, limit: 100 }), [filters, search])
  const list = useQuery({ queryKey: ['payments-admin-list', applied], queryFn: () => paymentsApi.adminPayments(applied), placeholderData: keepPreviousData })
  const [payoutFor, setPayoutFor] = useState<{ id: string; name: string; owed: string } | null>(null)

  if (overview.isError) return <div className={PAGE}><ErrorState message={(overview.error as Error).message} onRetry={() => void overview.refetch()} /></div>
  const o = overview.data

  return (
    <div className={PAGE}>
      <PageHeader
        title="Online payments"
        description="Khalti and eSewa payments collected with Eventlaya's merchant accounts, what each organizer is owed, and payouts."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="h-4 w-4" aria-hidden />}
            onClick={() => downloadCsv(paymentsApi.adminCsvPath({ ...applied, limit: undefined }), 'eventlaya_all_online_payments.csv').catch((e: Error) => toast.error('Export failed', e.message))}
          >
            Export CSV
          </Button>
        }
      />
      {!o ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <>
          {!o.module_enabled && (
            <p className="flex items-start gap-2 rounded-xl border border-marigold-200 bg-marigold-50 px-4 py-3 text-sm text-marigold-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              The Online payments module is switched off: attendees only see pay at the venue. Payments already started still settle.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Collected" value={rs(o.totals.collected)} hint={`${o.totals.paid_count} payments`} tone="success" icon={<Wallet className="h-5 w-5" aria-hidden />} />
            <StatTile label="Platform fee" value={rs(o.totals.platform_fee)} hint={`${o.settings.platform_fee_percent}% on new payments`} tone="brand" />
            <StatTile label="Owed to organizers" value={rs(o.totals.owed)} hint={`${rs(o.totals.paid_out)} paid out`} tone="warning" />
            <StatTile label="Refunded" value={rs(o.totals.refunded)} hint={`${o.totals.refunded_count} refunds · ${o.totals.pending_count} in progress`} />
          </div>

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardHeader title="Owed per organizer" description="Net = collected minus platform fee. Record a payout after you transfer the money." />
              {o.organizers.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-500">No paid online payments yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500">
                        <th className="px-5 py-2 font-medium">Organizer</th>
                        <th className="px-3 py-2 text-right font-medium">Collected</th>
                        <th className="px-3 py-2 text-right font-medium">Fee</th>
                        <th className="px-3 py-2 text-right font-medium">Paid out</th>
                        <th className="px-3 py-2 text-right font-medium">Owed</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {o.organizers.map((r) => (
                        <tr key={r.organizer.id}>
                          <td className="px-5 py-2.5 font-medium text-ink-900">{r.organizer.name}</td>
                          <td className="px-3 py-2.5 text-right tabular">{rs(r.collected)}</td>
                          <td className="px-3 py-2.5 text-right tabular text-ink-500">{rs(r.platform_fee)}</td>
                          <td className="px-3 py-2.5 text-right tabular">{rs(r.paid_out)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular">{rs(r.owed)}</td>
                          <td className="px-5 py-2.5 text-right">
                            <Button size="sm" variant="secondary" onClick={() => setPayoutFor({ id: r.organizer.id, name: r.organizer.name, owed: r.owed })}>
                              Record payout
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <div className="space-y-6">
              <ProvidersCard providers={o.providers} />
              <SettingsCard fee={o.settings.platform_fee_percent} minutes={o.settings.reservation_minutes} />
            </div>
          </div>

          {o.needs_attention.length > 0 && (
            <Card>
              <CardHeader title="Needs attention" description="Paid but not delivered, paid late, or with a mismatch the server refused. Open a payment to see its full log." />
              <ul className="divide-y divide-ink-100">
                {o.needs_attention.map((i) => (
                  <PaymentItem key={i.id} intent={i} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader title="All payments" description={list.data ? `${list.data.count} payments${list.data.count > 100 ? ' (latest 100 shown; export for all)' : ''}` : undefined} />
        <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] sm:px-5">
          <div className="relative">
            <Input label="Search" placeholder="Payer, reference, transaction id" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Search className="pointer-events-none absolute right-3 top-[38px] h-4 w-4 text-ink-400" aria-hidden />
          </div>
          <Select label="Status" value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}>
            <option value="">Any (not abandoned)</option>
            {(['paid', 'pending', 'failed', 'cancelled', 'expired', 'refunded', 'created'] as IntentStatus[]).map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select label="Provider" value={filters.provider ?? ''} onChange={(e) => setFilters((f) => ({ ...f, provider: e.target.value || undefined }))}>
            <option value="">All providers</option>
            <option value="khalti">Khalti</option>
            <option value="esewa">eSewa</option>
            <option value="test">Test</option>
          </Select>
          <Input label="From" type="date" value={filters.from ?? ''} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} />
          <Input label="To" type="date" value={filters.to ?? ''} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} />
        </div>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : !list.data ? (
          <Skeleton className="m-5 h-32 rounded-xl" />
        ) : list.data.results.length === 0 ? (
          <EmptyState icon={<Wallet className="h-6 w-6" aria-hidden />} title="No payments match" description="Try another filter." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {list.data.results.map((i) => (
              <PaymentItem key={i.id} intent={i} />
            ))}
          </ul>
        )}
      </Card>

      <PayoutsCard />
      <PayoutModal target={payoutFor} onClose={() => setPayoutFor(null)} />
    </div>
  )
}

const PaymentItem: React.FC<{ intent: IntentRow }> = ({ intent: i }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const recheck = useMutation({
    mutationFn: () => paymentsApi.adminRecheck(i.id),
    onSuccess: (r) => {
      toast.success(`Checked with ${r.provider_name ?? 'the provider'}`, `Status: ${r.status}`)
      void qc.invalidateQueries({ queryKey: ['payments-admin-list'] })
      void qc.invalidateQueries({ queryKey: ['payments-admin-overview'] })
    },
    onError: (e: Error) => toast.error("Couldn't re-check", e.message),
  })
  return (
    <li className="grid gap-2 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">{i.description}</p>
        <p className="truncate text-xs text-ink-500">
          {i.organizer?.name ?? '-'} · {i.order_reference ?? i.reference} · {fmtDate(i.created_at)}
        </p>
      </div>
      <div className="min-w-0 text-sm">
        <p className="truncate text-ink-800">{i.payer_name}</p>
        <p className="truncate text-xs text-ink-500">{i.payer_email}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {i.provider && <ProviderMark id={i.provider} size="sm" />}
        <span className="font-semibold tabular text-ink-900">{rs(i.amount)}</span>
        <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
        {(i.provider_txn_id || i.provider_ref) && <span className="w-full truncate font-mono text-[11px] text-ink-500">{i.provider_txn_id || i.provider_ref}</span>}
        {i.failure_reason && <span className="w-full text-xs text-marigold-800">{i.failure_reason}</span>}
      </div>
      <div className="flex justify-end">
        {i.provider && i.provider !== 'test' && ['pending', 'expired', 'created'].includes(i.status) && (
          <Button size="sm" variant="ghost" loading={recheck.isPending} icon={<RefreshCw className="h-4 w-4" aria-hidden />} onClick={() => recheck.mutate()}>
            Re-check
          </Button>
        )}
      </div>
    </li>
  )
}

const ProvidersCard: React.FC<{ providers: { id: string; name: string; enabled: boolean; configured: boolean; available: boolean; sandbox: boolean }[] }> = ({ providers }) => (
  <Card>
    <CardHeader title="Providers" description="Keys come from the server environment (see docs/payments.md)." />
    <ul className="divide-y divide-ink-100">
      {providers.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-5 py-3">
          <ProviderMark id={p.id} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">{p.name}</p>
            <p className="text-xs text-ink-500">
              {!p.enabled ? 'Not in PAYMENTS_ENABLED_PROVIDERS' : !p.configured ? 'Keys missing: not offered' : p.sandbox ? 'Sandbox (test money)' : 'Live'}
            </p>
          </div>
          {p.available ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Available" /> : <XCircle className="h-5 w-5 text-ink-300" aria-label="Unavailable" />}
        </li>
      ))}
    </ul>
  </Card>
)

const SettingsCard: React.FC<{ fee: string; minutes: number }> = ({ fee, minutes }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const [pct, setPct] = useState(fee)
  const [mins, setMins] = useState(String(minutes))
  useEffect(() => {
    setPct(fee)
    setMins(String(minutes))
  }, [fee, minutes])
  const save = useMutation({
    mutationFn: () => paymentsApi.adminSettings({ platform_fee_percent: pct, reservation_minutes: Number(mins) }),
    onSuccess: () => {
      toast.success('Payment settings saved', 'The fee applies to payments made from now on.')
      void qc.invalidateQueries({ queryKey: ['payments-admin-overview'] })
    },
    onError: (e: Error) => toast.error("Couldn't save", e.message),
  })
  return (
    <Card>
      <CardHeader title="Settings" />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <Input label="Platform fee (%)" type="number" min={0} max={50} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} hint="Recorded on each online payment for reports. Nothing is deducted automatically." />
        <Input label="Hold tickets while paying (minutes)" type="number" min={5} max={60} value={mins} onChange={(e) => setMins(e.target.value)} hint="Unpaid online orders release their tickets after this." />
        <Button type="submit" size="sm" loading={save.isPending} disabled={pct === fee && mins === String(minutes)}>
          Save settings
        </Button>
      </form>
    </Card>
  )
}

const PayoutsCard: React.FC = () => {
  const qc = useQueryClient()
  const toast = useToast()
  const query = useQuery({ queryKey: ['payments-admin-payouts'], queryFn: paymentsApi.adminPayouts })
  const remove = useMutation({
    mutationFn: (id: string) => paymentsApi.removePayout(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payments-admin-payouts'] })
      void qc.invalidateQueries({ queryKey: ['payments-admin-overview'] })
      toast.success('Payout removed')
    },
  })
  if (!query.data?.length) return null
  return (
    <Card>
      <CardHeader title="Payouts" description="Money sent to organizers by hand." />
      <ul className="divide-y divide-ink-100">
        {query.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink-900">{p.organizer.name}</span>
              <span className="text-ink-500">
                {' '}
                · {fmtDate(p.paid_on)} · {p.method_label}
                {p.reference ? ` · ${p.reference}` : ''}
                {p.event ? ` · ${p.event.title}` : ''}
              </span>
            </span>
            <span className="font-semibold tabular">{rs(p.amount)}</span>
            <IconButton label={`Remove payout of ${rs(p.amount)}`} onClick={() => remove.mutate(p.id)}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const PayoutModal: React.FC<{ target: { id: string; name: string; owed: string } | null; onClose: () => void }> = ({ target, onClose }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('bank')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  useEffect(() => {
    if (target) setAmount(String(Math.max(0, Number(target.owed))))
  }, [target])
  const save = useMutation({
    mutationFn: () => paymentsApi.addPayout({ organizer: target!.id, amount, method, reference, note, paid_on: paidOn }),
    onSuccess: () => {
      toast.success('Payout recorded', `${rs(amount)} to ${target?.name}`)
      void qc.invalidateQueries({ queryKey: ['payments-admin-overview'] })
      void qc.invalidateQueries({ queryKey: ['payments-admin-payouts'] })
      setReference('')
      setNote('')
      onClose()
    },
    onError: (e: Error) => toast.error("Couldn't record the payout", e.message),
  })
  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`Record a payout${target ? ` to ${target.name}` : ''}`}
      description="After you've transferred the money. This only records it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Record payout
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Amount (Rs)" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Paid on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="bank">Bank transfer</option>
          <option value="esewa">eSewa</option>
          <option value="khalti">Khalti</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </Select>
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank transaction id" />
        <Textarea label="Note" containerClassName="sm:col-span-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}
