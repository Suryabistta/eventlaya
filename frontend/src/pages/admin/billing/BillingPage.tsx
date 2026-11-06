import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar } from 'react-chartjs-2'
import type { ChartOptions } from 'chart.js'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, CreditCard, Download, Hourglass, Inbox, Receipt, Search, TrendingUp, Wallet, X } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, StatTile, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { chartColors, hBarOptions } from '@/pages/analytics/charts'
import { ChartCard } from '@/pages/analytics/shared'
import { PAGE, ReasonDialog, Segmented, countLabel, fmtDate, timeAgo } from '../shared'
import {
  BILLING_KEY,
  billingApi,
  methodLabels,
  npr,
  statusMeta,
  type PaymentRow,
  type SubscriptionRow,
  type UpgradeRequest,
} from './api'
import { ChangePlanDialog, RecordPaymentDialog } from './dialogs'

type Tab = 'subscriptions' | 'payments' | 'upgrades'

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })

const revenueOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { ...hBarOptions(true).plugins?.tooltip },
  },
  scales: {
    x: { grid: { display: false }, border: { color: chartColors.grid }, ticks: { maxRotation: 0, autoSkip: true } },
    y: {
      beginAtZero: true,
      grid: { color: chartColors.grid },
      border: { display: false },
      ticks: { callback: (v) => (Number(v) >= 1000 ? `${Number(v) / 1000}k` : Number(v).toLocaleString()) },
    },
  },
}

export const BillingPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const tab = (['subscriptions', 'payments', 'upgrades'].includes(params.get('tab') ?? '') ? params.get('tab') : 'subscriptions') as Tab
  const summary = useQuery({ queryKey: [...BILLING_KEY, 'summary'], queryFn: billingApi.summary })
  const s = summary.data
  const delta = s ? s.revenue_this_month - s.revenue_last_month : 0
  const deltaPct = s && s.revenue_last_month ? Math.round((delta / s.revenue_last_month) * 100) : null

  return (
    <div className={PAGE}>
      <PageHeader
        title="Billing and recharges"
        description="Plans, renewals and payments for every event company and vendor. Record payments received by eSewa, Khalti, bank or cash."
      />

      {summary.isError ? (
        <ErrorState message={(summary.error as Error)?.message} onRetry={() => void summary.refetch()} />
      ) : (
        <section aria-label="Billing numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-7">
          {!s ? (
            Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[108px] rounded-2xl" />)
          ) : (
            <>
              <StatTile label="Monthly recurring revenue" value={npr(s.mrr)} hint="Active paid plans, yearly spread per month" icon={<TrendingUp className="h-5 w-5" />} tone="brand" />
              <StatTile label="Annual run rate" value={npr(s.arr)} hint="MRR × 12" icon={<Wallet className="h-5 w-5" />} />
              <StatTile label="Paying organizations" value={s.active_paid} icon={<CreditCard className="h-5 w-5" />} tone="success" />
              <StatTile label="On trial" value={s.trials} icon={<Hourglass className="h-5 w-5" />} />
              <FilterTile to="?tab=subscriptions&status=past_due" label="Past due" value={s.past_due} hint="Period ended without a payment" warn={s.past_due > 0} />
              <FilterTile to="?tab=subscriptions&expiring=7" label="Renewing in 7 days" value={s.expiring_7d} hint={`${s.expiring_30d} in the next 30 days`} warn={s.expiring_7d > 0} />
              <Card className="p-4 sm:p-5">
                <p className="text-sm font-medium text-ink-500">Collected this month</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink-900 tabular sm:text-3xl">{npr(s.revenue_this_month)}</p>
                <p className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium', delta >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
                  {deltaPct === null ? `${npr(Math.abs(delta))} vs last month` : `${delta >= 0 ? 'Up' : 'Down'} ${Math.abs(deltaPct)}% vs last month`}
                </p>
              </Card>
            </>
          )}
        </section>
      )}

      {s && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ChartCard
            className="min-w-0 xl:col-span-2"
            title="Revenue by month"
            description="Payments recorded, last 12 months, refunds excluded"
            summary={s.revenue_by_month.map((m) => `${monthLabel(m.month)}: ${npr(m.amount)}`).join('; ')}
          >
            <Bar
              options={revenueOptions}
              data={{
                labels: s.revenue_by_month.map((m) => monthLabel(m.month)),
                datasets: [{ label: 'Revenue', data: s.revenue_by_month.map((m) => m.amount), backgroundColor: chartColors.brand, hoverBackgroundColor: chartColors.brand, borderRadius: 4, maxBarThickness: 36 }],
              }}
            />
          </ChartCard>
          <Card className="min-w-0">
            <CardHeader title="Plan mix" description="Organizations on each plan" />
            <ul className="space-y-4 p-5">
              {s.plan_mix.map((p) => {
                const total = s.plan_mix.reduce((a, x) => a + x.count, 0) || 1
                return (
                  <li key={p.plan}>
                    <Link to={`?tab=subscriptions&plan=${p.plan}`} className="group block">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium text-ink-800 group-hover:text-brand-700 group-hover:underline">{p.name}</span>
                        <span className="tabular text-ink-600">
                          {p.count} <span className="text-xs text-ink-500">({Math.round((p.count / total) * 100)}%)</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                        <div className={cn('h-full rounded-full', p.plan === 'free' ? 'bg-ink-400' : 'bg-brand-600')} style={{ width: `${(p.count / total) * 100}%` }} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      )}

      <Segmented
        label="Billing records"
        value={tab}
        onChange={(t) => setParams(t === 'subscriptions' ? {} : { tab: t }, { replace: true })}
        options={[
          { value: 'subscriptions', label: 'Subscriptions' },
          { value: 'payments', label: 'Payments' },
          {
            value: 'upgrades',
            label: (
              <>
                Upgrade requests
                {!!s?.pending_upgrades && <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold leading-5 text-white">{s.pending_upgrades}</span>}
              </>
            ),
          },
        ]}
      />

      {tab === 'subscriptions' && <SubscriptionsTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'upgrades' && <UpgradesTab />}
    </div>
  )
}

export default BillingPage

const FilterTile: React.FC<{ to: string; label: string; value: number; hint: string; warn: boolean }> = ({ to, label, value, hint, warn }) => (
  <Link
    to={to}
    className={cn(
      'flex items-start justify-between gap-3 rounded-2xl border bg-white p-4 transition-colors hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-5',
      warn ? 'border-marigold-300 bg-marigold-50/40' : 'border-ink-200',
    )}
  >
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-ink-900 tabular">{value}</p>
      <p className="mt-1 text-xs text-ink-500">{hint}</p>
    </div>
    {warn && <AlertTriangle className="hidden h-5 w-5 shrink-0 text-marigold-600 sm:block" aria-label="Needs attention" />}
  </Link>
)

/* ------------------------------------------------------------------ */
/* Subscriptions                                                        */

function useBillingMutation<V, R>(fn: (v: V) => Promise<R>, success: (v: V, r: R) => [string, string?], failure: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => toast.success(...success(v, r)),
    onError: (err: Error) => toast.error(failure, err.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: BILLING_KEY }),
  })
}

const renewText = (s: SubscriptionRow) => {
  if (s.plan === 'free' || !s.current_period_end) return { text: 'No renewal', className: 'text-ink-500' }
  const d = s.days_left ?? 0
  const verb = s.status === 'cancelled' ? 'Ends' : s.status === 'trial' ? 'Trial ends' : 'Renews'
  if (d < 0) return { text: `Ended ${fmtDate(s.current_period_end)}`, className: 'text-red-700' }
  return {
    text: `${verb} ${fmtDate(s.current_period_end)}`,
    sub: d === 0 ? 'Today' : `${d} ${d === 1 ? 'day' : 'days'} left`,
    className: d <= 7 ? 'text-marigold-800' : 'text-ink-700',
  }
}

const SubscriptionsTab: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const status = params.get('status') ?? 'all'
  const plan = params.get('plan') ?? 'all'
  const expiring = params.get('expiring') ?? ''
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [paying, setPaying] = useState<SubscriptionRow | null>(null)
  const [changing, setChanging] = useState<SubscriptionRow | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const setParam = (k: string, v: string, fallback = 'all') => {
    const p = new URLSearchParams(params)
    if (!v || v === fallback) p.delete(k)
    else p.set(k, v)
    setParams(p, { replace: true })
  }

  const filters = { status, plan, expiring, search: debounced }
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...BILLING_KEY, 'subscriptions', filters],
    queryFn: () => billingApi.subscriptions(filters),
    placeholderData: (prev) => prev,
  })

  const record = useBillingMutation(
    ({ sub, body }: { sub: SubscriptionRow; body: Parameters<typeof billingApi.recordPayment>[1] }) => billingApi.recordPayment(sub.organization_id, body),
    ({ sub }, r) => ['Payment recorded', `${sub.organization_name} is on ${r.subscription.plan_name} until ${fmtDate(r.subscription.current_period_end)}.`],
    'Couldn’t record the payment',
  )
  const change = useBillingMutation(
    ({ sub, plan, cycle }: { sub: SubscriptionRow; plan: SubscriptionRow['plan']; cycle: SubscriptionRow['billing_cycle'] }) => billingApi.changePlan(sub.organization_id, plan, cycle),
    ({ sub }, r) => [`${sub.organization_name} moved to ${r.plan_name}`, r.status === 'trial' ? 'They’re on a 14-day trial until a payment is recorded.' : undefined],
    'Couldn’t change the plan',
  )
  const cancel = useBillingMutation(
    (sub: SubscriptionRow) => billingApi.cancel(sub.organization_id),
    (sub) => ['Subscription cancelled', `${sub.organization_name} won’t renew. They keep access until the period ends.`],
    'Couldn’t cancel the subscription',
  )

  const askCancel = async (sub: SubscriptionRow) => {
    const ok = await toast.confirm({
      title: `Cancel ${sub.organization_name}’s ${sub.plan_name} plan?`,
      description: 'It won’t renew. They keep paid features until the current period ends, then drop to Free.',
      confirmLabel: 'Cancel subscription',
      danger: true,
    })
    if (ok) cancel.mutate(sub)
  }

  const filtered = status !== 'all' || plan !== 'all' || !!expiring || !!debounced

  const actions = (s: SubscriptionRow) => (
    <div className="flex flex-wrap justify-end gap-2 lg:flex-nowrap">
      <Button size="sm" variant="secondary" icon={<Receipt className="h-4 w-4" />} onClick={() => setPaying(s)} aria-label={`Record payment from ${s.organization_name}`}>
        Record payment
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setChanging(s)} aria-label={`Change plan for ${s.organization_name}`}>
        Change plan
      </Button>
      {s.plan !== 'free' && s.status !== 'cancelled' && (
        <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => void askCancel(s)} aria-label={`Cancel ${s.organization_name}’s subscription`}>
          Cancel
        </Button>
      )}
    </div>
  )

  return (
    <Card className="min-w-0">
      <div className="grid gap-3 border-b border-ink-100 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-[minmax(0,1fr)_170px_170px_190px]">
        <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
          <label htmlFor="sub-search" className="block text-sm font-medium text-ink-800">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              id="sub-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Organization or email"
              className="block w-full rounded-[10px] border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-2xs hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>
        <Select label="Status" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="all">Any status</option>
          {Object.entries(statusMeta).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </Select>
        <Select label="Plan" value={plan} onChange={(e) => setParam('plan', e.target.value)}>
          <option value="all">Any plan</option>
          <option value="free">Free</option>
          <option value="event_pro">Event Pro</option>
          <option value="business">Business</option>
          <option value="enterprise">Enterprise</option>
        </Select>
        <Select label="Renewal" value={expiring} onChange={(e) => setParam('expiring', e.target.value, '')}>
          <option value="">Any time</option>
          <option value="7">In the next 7 days</option>
          <option value="30">In the next 30 days</option>
        </Select>
      </div>

      {isError ? (
        <div className="p-5">
          <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" />}
          title={filtered ? 'No subscriptions match' : 'No subscriptions yet'}
          description={filtered ? 'Try different filters.' : 'Every event company and vendor appears here once they sign up.'}
          action={
            filtered ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setParams({}, { replace: true })
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-ink-100 lg:hidden">
            {data.map((s) => {
              const r = renewText(s)
              return (
                <li key={s.organization_id} className="space-y-2 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/admin/organizations/${s.organization_id}`} className="block truncate font-semibold text-ink-900 hover:underline">
                        {s.organization_name}
                      </Link>
                      <p className="text-sm text-ink-500">
                        {s.plan_name}
                        {s.plan !== 'free' && `, ${s.billing_cycle}`}
                      </p>
                    </div>
                    <Badge tone={statusMeta[s.status].tone}>{statusMeta[s.status].label}</Badge>
                  </div>
                  <p className={cn('text-sm', r.className)}>
                    {r.text}
                    {r.sub && <span className="text-ink-500">, {r.sub.toLowerCase()}</span>}
                  </p>
                  {actions(s)}
                </li>
              )
            })}
          </ul>
          <div className="relative hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="bg-ink-50 text-xs text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Organization</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Plan</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Renews or ends</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Last payment</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.map((s) => {
                  const r = renewText(s)
                  return (
                    <tr key={s.organization_id}>
                      <td className="max-w-[240px] px-5 py-3">
                        <Link to={`/admin/organizations/${s.organization_id}`} className="block truncate font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                          {s.organization_name}
                        </Link>
                        <span className="block truncate text-xs text-ink-500">{s.organization_email}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-ink-900">{s.plan_name}</span>
                        {s.plan !== 'free' && (
                          <span className="block text-xs text-ink-500">
                            {s.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly'}, {npr(s.monthly_value)}/mo
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusMeta[s.status].tone}>{statusMeta[s.status].label}</Badge>
                        {!s.auto_renew && s.plan !== 'free' && <span className="mt-1 block text-xs text-ink-500">Won’t renew</span>}
                      </td>
                      <td className={cn('px-3 py-3', r.className)}>
                        {r.text}
                        {r.sub && <span className="block text-xs text-ink-500">{r.sub}</span>}
                      </td>
                      <td className="px-3 py-3 text-ink-700">
                        {s.last_payment ? (
                          <>
                            {npr(s.last_payment.amount)}
                            <span className="block text-xs text-ink-500">
                              {s.last_payment.method}, {timeAgo(s.last_payment.paid_at).toLowerCase()}
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-500">None</span>
                        )}
                      </td>
                      <td className="px-5 py-3">{actions(s)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <RecordPaymentDialog sub={paying} onClose={() => setPaying(null)} onSubmit={(sub, body) => record.mutateAsync({ sub, body })} />
      <ChangePlanDialog sub={changing} onClose={() => setChanging(null)} onSubmit={(sub, plan, cycle) => change.mutateAsync({ sub, plan, cycle })} />
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Payments ledger                                                      */

const PaymentsTab: React.FC = () => {
  const toast = useToast()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [method, setMethod] = useState('all')
  const [status, setStatus] = useState('all')
  const [refunding, setRefunding] = useState<PaymentRow | null>(null)
  const [exporting, setExporting] = useState(false)
  const filters = { from, to, method, status }
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...BILLING_KEY, 'payments', filters],
    queryFn: () => billingApi.payments(filters),
    placeholderData: (prev) => prev,
  })
  const refund = useBillingMutation(
    ({ p, note }: { p: PaymentRow; note: string }) => billingApi.refund(p.id, note),
    ({ p }) => ['Payment marked as refunded', `${npr(p.amount)} from ${p.organization_name}. Their plan period is unchanged.`],
    'Couldn’t refund the payment',
  )
  const total = useMemo(() => (data ?? []).filter((p) => p.status === 'recorded').reduce((a, p) => a + p.amount, 0), [data])

  const exportCsv = async () => {
    setExporting(true)
    try {
      await billingApi.downloadCsv(filters)
      toast.success('Payments exported', 'The CSV is in your downloads.')
    } catch (err) {
      toast.error('Couldn’t export payments', err instanceof Error ? err.message : undefined)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card className="min-w-0">
      <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:p-5 lg:flex-row lg:items-end">
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="all">Any method</option>
            {Object.entries(methodLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Any status</option>
            <option value="recorded">Received</option>
            <option value="refunded">Refunded</option>
          </Select>
        </div>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={() => void exportCsv()} disabled={!data?.length}>
          Export CSV
        </Button>
      </div>

      {isError ? (
        <div className="p-5">
          <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
        </div>
      ) : isLoading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !data?.length ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments found" description="Payments you record from the Subscriptions tab appear here." />
      ) : (
        <>
          <p className="px-5 pt-3 text-sm text-ink-500">
            {data.length} {data.length === 1 ? 'payment' : 'payments'}, {npr(total)} received
          </p>
          <div className="relative overflow-x-auto">
            <table className="mt-2 w-full min-w-[900px] text-left text-sm">
              <thead className="bg-ink-50 text-xs text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Organization</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">For</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Method</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.map((p) => (
                  <tr key={p.id} className={cn(p.status === 'refunded' && 'bg-ink-50/60')}>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-700">{fmtDate(p.paid_at)}</td>
                    <td className="max-w-[220px] px-3 py-3">
                      <Link to={`/admin/organizations/${p.organization_id}`} className="block truncate font-medium text-ink-900 hover:underline">
                        {p.organization_name}
                      </Link>
                      {p.recorded_by_email && <span className="block truncate text-xs text-ink-500">Recorded by {p.recorded_by_email}</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-700">
                      {p.plan_name ?? 'Plan'}, {p.months_covered} {p.months_covered === 1 ? 'month' : 'months'}
                      {p.note && <span className="block max-w-[260px] truncate text-xs text-ink-500" title={p.note}>{p.note}</span>}
                    </td>
                    <td className="px-3 py-3 text-ink-700">
                      {p.method_display}
                      {p.reference && <span className="block font-mono text-xs text-ink-500">{p.reference}</span>}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={cn('font-semibold tabular', p.status === 'refunded' ? 'text-ink-500 line-through' : 'text-ink-900')}>{npr(p.amount)}</span>
                      {p.status === 'refunded' && (
                        <span className="block text-xs text-red-700" title={p.refund_note}>
                          Refunded {fmtDate(p.refunded_at)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.status === 'recorded' && (
                        <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setRefunding(p)} aria-label={`Refund ${npr(p.amount)} to ${p.organization_name}`}>
                          Refund
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ReasonDialog
        open={!!refunding}
        onClose={() => setRefunding(null)}
        title={`Refund ${refunding ? npr(refunding.amount) : ''} to ${refunding?.organization_name ?? ''}?`}
        description="This marks the payment as refunded in the ledger. Send the money back through the original method yourself. Their plan period doesn’t change."
        confirmLabel="Mark as refunded"
        placeholder="For example: paid twice for October."
        onConfirm={(note) => (refunding ? refund.mutateAsync({ p: refunding, note }) : undefined)}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Upgrade requests                                                     */

const UpgradesTab: React.FC = () => {
  const [status, setStatus] = useState<'pending' | 'all'>('pending')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...BILLING_KEY, 'upgrades', status],
    queryFn: () => billingApi.upgradeRequests(status),
  })
  const [declining, setDeclining] = useState<UpgradeRequest | null>(null)
  const approve = useBillingMutation(
    (r: UpgradeRequest) => billingApi.approveUpgrade(r.id),
    (r) => [`${r.organization_name} moved to ${r.requested_plan_name}`, 'They’re on a 14-day trial until you record their payment.'],
    'Couldn’t approve the upgrade',
  )
  const decline = useBillingMutation(
    ({ r, note }: { r: UpgradeRequest; note: string }) => billingApi.declineUpgrade(r.id, note),
    ({ r }) => ['Upgrade declined', `${r.organization_name} will see your reason.`],
    'Couldn’t decline the upgrade',
  )

  return (
    <div className="space-y-4">
      <Segmented
        label="Show"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: countLabel('Waiting', status === 'pending' ? data?.length : undefined) },
          { value: 'all', label: 'All requests' },
        ]}
      />
      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Inbox className="h-6 w-6" />} title="No upgrade requests" description="When an organization asks for a bigger plan from Plan and billing, it shows up here." />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {data.map((r) => (
            <li key={r.id} className="min-w-0">
              <Card className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <div className="min-w-0">
                    <Link to={`/admin/organizations/${r.organization_id}`} className="block truncate text-base font-bold text-ink-900 hover:underline">
                      {r.organization_name}
                    </Link>
                    <p className="text-sm text-ink-500">
                      {planName(r.current_plan)} to <span className="font-semibold text-ink-900">{r.requested_plan_name}</span>, {r.billing_cycle}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {r.status !== 'pending' && <Badge tone={r.status === 'approved' ? 'success' : 'danger'}>{r.status === 'approved' ? 'Approved' : 'Declined'}</Badge>}
                    <p className="mt-1 text-xs text-ink-500">{timeAgo(r.created_at)}</p>
                  </div>
                </div>
                <div className="flex-1 space-y-2 px-5 py-4 text-sm">
                  {r.note ? <p className="whitespace-pre-line text-ink-700">“{r.note}”</p> : <p className="text-ink-500">No note.</p>}
                  {r.review_note && <p className="text-ink-600">Your reply: {r.review_note}</p>}
                </div>
                {r.status === 'pending' && (
                  <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
                    <Button variant="secondary" size="sm" icon={<X className="h-4 w-4" />} onClick={() => setDeclining(r)} disabled={approve.isPending}>
                      Decline
                    </Button>
                    <Button size="sm" icon={<Check className="h-4 w-4" />} loading={approve.isPending && approve.variables?.id === r.id} onClick={() => approve.mutate(r)}>
                      Approve
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog
        open={!!declining}
        onClose={() => setDeclining(null)}
        title={`Decline ${declining?.organization_name ?? ''}’s upgrade?`}
        description="They stay on their current plan and see your reason."
        confirmLabel="Decline upgrade"
        placeholder="For example: Enterprise needs a call first. We’ll phone you this week."
        onConfirm={(note) => (declining ? decline.mutateAsync({ r: declining, note }) : undefined)}
      />
    </div>
  )
}

const planName = (code: string) => ({ free: 'Free', event_pro: 'Event Pro', business: 'Business', enterprise: 'Enterprise' })[code] ?? code
