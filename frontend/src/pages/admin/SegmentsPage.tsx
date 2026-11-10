import React from 'react'
import { formatDate } from '@/lib/dates'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar } from 'react-chartjs-2'
import type { ChartOptions } from 'chart.js'
import { ChevronRight, PieChart } from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { chartColors, hBarOptions, lineOptions } from '@/pages/analytics/charts'
import { ChartCard, Legend } from '@/pages/analytics/shared'
import { platformApi, type Segments } from './api'
import { PAGE, Segmented, fmtNum } from './shared'
import { npr } from './billing/api'

type By = 'type' | 'city' | 'plan'

/** Fixed categorical order (see analytics/charts.ts). */
const SERIES = [chartColors.brand, chartColors.marigold, chartColors.emerald, chartColors.ink400]

const weekLabel = (iso: string) => formatDate(new Date(`${iso}T00:00`), 'short')

const stacked: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: { ...hBarOptions().plugins?.tooltip, callbacks: {} } },
  scales: {
    x: { stacked: true, grid: { display: false }, border: { color: chartColors.grid }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: chartColors.grid }, border: { display: false } },
  },
}

/** Value with a proportional bar behind it, so a table reads like a chart. */
const BarCell: React.FC<{ value: number; max: number; label?: string; color?: string }> = ({ value, max, label, color = 'bg-brand-600' }) => (
  <div className="min-w-[110px]">
    <div className="flex items-baseline justify-end gap-1 tabular text-ink-900">{label ?? fmtNum(value)}</div>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
      <div className={cn('h-full rounded-full', color)} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  </div>
)

interface Column<T> {
  key: string
  label: string
  value: (r: T) => number
  format?: (r: T) => string
  bar?: boolean
}

function SegmentTable<T>({
  caption,
  rows,
  name,
  columns,
  onOpen,
}: {
  caption: string
  rows: T[]
  name: (r: T) => string
  columns: Column<T>[]
  onOpen?: (r: T) => string | null
}) {
  const navigate = useNavigate()
  const maxes = Object.fromEntries(columns.map((c) => [c.key, Math.max(0, ...rows.map(c.value))]))
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ink-50 text-xs text-ink-500">
          <tr>
            <th scope="col" className="px-5 py-2.5 font-medium">
              Segment
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-3 py-2.5 text-right font-medium">
                {c.label}
              </th>
            ))}
            <th scope="col" className="w-8 px-3">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r) => {
            const to = onOpen?.(r) ?? null
            return (
              <tr
                key={name(r)}
                onClick={to ? () => navigate(to) : undefined}
                className={cn(to && 'cursor-pointer hover:bg-ink-50/70')}
              >
                <th scope="row" className="px-5 py-3 text-left font-semibold text-ink-900">
                  {to ? (
                    <a
                      href={to}
                      onClick={(e) => {
                        e.preventDefault()
                        navigate(to)
                      }}
                      className="hover:text-brand-700 hover:underline"
                    >
                      {name(r)}
                    </a>
                  ) : (
                    name(r)
                  )}
                </th>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-3 text-right">
                    {c.bar ? (
                      <BarCell value={c.value(r)} max={maxes[c.key]} label={c.format?.(r)} />
                    ) : (
                      <span className="tabular text-ink-700">{c.format ? c.format(r) : fmtNum(c.value(r))}</span>
                    )}
                  </td>
                ))}
                <td className="px-3 py-3 text-ink-400">{to && <ChevronRight className="h-4 w-4" aria-hidden />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export const SegmentsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const by = (['type', 'city', 'plan'].includes(params.get('by') ?? '') ? params.get('by') : 'type') as By
  const range = [30, 90, 365].includes(Number(params.get('range'))) ? Number(params.get('range')) : 30
  const set = (k: string, v: string, fallback: string) => {
    const p = new URLSearchParams(params)
    if (v === fallback) p.delete(k)
    else p.set(k, v)
    setParams(p, { replace: true })
  }
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform', 'segments', range],
    queryFn: () => platformApi.segments(range),
    placeholderData: (prev) => prev,
  })
  const rangeText = range === 365 ? 'last 12 months' : `last ${range} days`

  return (
    <div className={PAGE}>
      <PageHeader title="Segments" description="Compare the platform by account type, city and plan. Select a row to see those organizations." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Group by"
          value={by}
          onChange={(v) => set('by', v, 'type')}
          options={[
            { value: 'type', label: 'Account type' },
            { value: 'city', label: 'City' },
            { value: 'plan', label: 'Plan' },
          ]}
        />
        <Segmented
          label="Time range"
          value={String(range)}
          onChange={(v) => set('range', v, '30')}
          options={[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '12 months' },
          ]}
        />
      </div>

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : (
        <>
          {by === 'type' && <ByType data={data} rangeText={rangeText} />}
          {by === 'city' && <ByCity data={data} rangeText={rangeText} />}
          {by === 'plan' && <ByPlan data={data} rangeText={rangeText} />}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Engagement data={data} rangeText={rangeText} />
            <Marketplace data={data} rangeText={rangeText} />
          </div>
        </>
      )}
    </div>
  )
}

export default SegmentsPage

/* ------------------------------------------------------------------ */

const ByType: React.FC<{ data: Segments; rangeText: string }> = ({ data, rangeText }) => {
  const series = [
    { key: 'organizer' as const, label: 'Event companies' },
    { key: 'both' as const, label: 'Events and marketplace' },
    { key: 'vendor' as const, label: 'Vendors' },
  ]
  const total = data.growth.reduce((a, w) => a + w.organizer + w.both + w.vendor, 0)
  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
      <Card className="min-w-0 2xl:col-span-3">
        <CardHeader title="By account type" description={`Activity in the ${rangeText}`} />
        <SegmentTable
          caption="Accounts by type"
          rows={data.by_type}
          name={(r) => r.label}
          onOpen={(r) => (r.linkable ? `/admin/organizations?type=${r.key}` : null)}
          columns={[
            { key: 'accounts', label: 'Accounts', value: (r) => r.accounts, bar: true },
            { key: 'new', label: 'New', value: (r) => r.new_in_range },
            { key: 'events', label: 'Events', value: (r) => r.events, bar: true },
            { key: 'regs', label: 'Registrations', value: (r) => r.registrations, bar: true },
            { key: 'listings', label: 'Listings', value: (r) => r.listings },
          ]}
        />
      </Card>
      <Card className="min-w-0 2xl:col-span-2">
        <CardHeader title="New accounts per week" description={`${total} sign-ups in the ${rangeText}`} />
        <div className="space-y-3 p-4 sm:p-5">
          <Legend items={series.map((s, i) => ({ label: s.label, color: SERIES[i] }))} />
          <div
            role="img"
            aria-label={data.growth.map((w) => `Week of ${weekLabel(w.week_start)}: ${w.organizer} event companies, ${w.both} with marketplace, ${w.vendor} vendors`).join('; ')}
            className="relative h-64"
          >
            <Bar
              options={stacked}
              data={{
                labels: data.growth.map((w) => weekLabel(w.week_start)),
                datasets: series.map((s, i) => ({
                  label: s.label,
                  data: data.growth.map((w) => w[s.key]),
                  backgroundColor: SERIES[i],
                  hoverBackgroundColor: SERIES[i],
                  borderRadius: 3,
                  maxBarThickness: 22,
                })),
              }}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

const ByCity: React.FC<{ data: Segments; rangeText: string }> = ({ data, rangeText }) => {
  if (!data.by_city.length)
    return (
      <Card>
        <EmptyState icon={<PieChart className="h-6 w-6" />} title="No cities yet" description="Cities come from event locations and marketplace listings." />
      </Card>
    )
  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
      <Card className="min-w-0 2xl:col-span-3">
        <CardHeader title="By city" description={`Organizations active in each city, with events and registrations in the ${rangeText}`} />
        <SegmentTable
          caption="Platform by city"
          rows={data.by_city}
          name={(r) => r.city}
          onOpen={(r) => (r.other ? null : `/admin/organizations?city=${encodeURIComponent(r.city)}`)}
          columns={[
            { key: 'orgs', label: 'Organizations', value: (r) => r.orgs, bar: true },
            { key: 'events', label: 'Events', value: (r) => r.events },
            { key: 'regs', label: 'Registrations', value: (r) => r.registrations, bar: true },
            { key: 'listings', label: 'Listings', value: (r) => r.listings },
          ]}
        />
      </Card>
      <ChartCard
        className="min-w-0 2xl:col-span-2"
        title="Registrations by city"
        description={rangeText.charAt(0).toUpperCase() + rangeText.slice(1)}
        summary={data.by_city.map((c) => `${c.city}: ${c.registrations}`).join('; ')}
        height="h-72"
      >
        <Bar
          options={hBarOptions()}
          data={{
            labels: data.by_city.map((c) => c.city),
            datasets: [{ data: data.by_city.map((c) => c.registrations), backgroundColor: chartColors.brand, hoverBackgroundColor: chartColors.brand, borderRadius: 4, maxBarThickness: 22 }],
          }}
        />
      </ChartCard>
    </div>
  )
}

const ByPlan: React.FC<{ data: Segments; rangeText: string }> = ({ data, rangeText }) => (
  <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
    <Card className="min-w-0 2xl:col-span-3">
      <CardHeader title="By plan" description={`Revenue share now, activity per organization in the ${rangeText}`} />
      <SegmentTable
        caption="Platform by plan"
        rows={data.by_plan}
        name={(r) => r.name}
        onOpen={(r) => `/admin/organizations?plan=${r.plan}`}
        columns={[
          { key: 'orgs', label: 'Organizations', value: (r) => r.orgs, bar: true },
          { key: 'mrr', label: 'Monthly revenue', value: (r) => r.mrr, format: (r) => npr(r.mrr) },
          { key: 'share', label: 'Share of revenue', value: (r) => r.mrr_share, format: (r) => `${r.mrr_share}%`, bar: true },
          { key: 'avg_e', label: 'Events per org', value: (r) => r.avg_events, format: (r) => String(r.avg_events) },
          { key: 'avg_r', label: 'Registrations per org', value: (r) => r.avg_registrations, format: (r) => String(r.avg_registrations) },
        ]}
      />
    </Card>
    <ChartCard
      className="min-w-0 2xl:col-span-2"
      title="Registrations per organization"
      description={`Average by plan, ${rangeText}`}
      summary={data.by_plan.map((p) => `${p.name}: ${p.avg_registrations}`).join('; ')}
      height="h-72"
    >
      <Bar
        options={{ ...lineOptions, plugins: { legend: { display: false }, tooltip: hBarOptions().plugins?.tooltip } } as ChartOptions<'bar'>}
        data={{
          labels: data.by_plan.map((p) => p.name),
          datasets: [{ data: data.by_plan.map((p) => p.avg_registrations), backgroundColor: chartColors.brand, hoverBackgroundColor: chartColors.brand, borderRadius: 4, maxBarThickness: 48 }],
        }}
      />
    </ChartCard>
  </div>
)

const Engagement: React.FC<{ data: Segments; rangeText: string }> = ({ data, rangeText }) => {
  const e = data.engagement
  return (
    <Card className="min-w-0">
      <CardHeader title="Engagement" description={`Event companies with an event in the ${rangeText}`} />
      <div className="space-y-4 p-5">
        <p className="font-display text-4xl font-bold text-ink-900 tabular">
          {e.active_pct}%<span className="ml-2 font-sans text-sm font-medium text-ink-500">active</span>
        </p>
        <div className="flex h-3 overflow-hidden rounded-full bg-ink-100" aria-hidden>
          <div className="bg-emerald-600" style={{ width: `${e.total ? (e.active / e.total) * 100 : 0}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <dt className="text-emerald-800">Active</dt>
            <dd className="text-lg font-semibold text-emerald-900 tabular">{e.active}</dd>
          </div>
          <div className="rounded-xl bg-ink-50 px-3 py-2">
            <dt className="text-ink-600">Dormant</dt>
            <dd className="text-lg font-semibold text-ink-900 tabular">{e.dormant}</dd>
          </div>
        </dl>
        <p className="text-xs text-ink-500">Dormant companies haven’t created or run an event in this period. A good list for a check-in call.</p>
      </div>
    </Card>
  )
}

const Marketplace: React.FC<{ data: Segments; rangeText: string }> = ({ data, rangeText }) => {
  const cats = data.marketplace.listings_by_category
  const max = Math.max(1, ...cats.map((c) => c.approved + c.pending + c.rejected))
  return (
    <Card className="min-w-0 xl:col-span-2">
      <CardHeader title="Marketplace" description="Listings by category, and venue inquiries by city" />
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {cats.length === 0 ? (
          <p className="text-sm text-ink-500">No listings yet.</p>
        ) : (
          <div className="space-y-3">
          <Legend
            items={[
              { label: 'Live', color: chartColors.emerald },
              { label: 'Waiting', color: chartColors.marigold },
              { label: 'Rejected', color: '#B91C1C' },
            ]}
          />
          <ul className="space-y-3" aria-label="Listings by category">
            {cats.map((c) => {
              const total = c.approved + c.pending + c.rejected
              return (
                <li key={`${c.kind}-${c.label}`} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-ink-800">
                      {c.label} <span className="text-xs text-ink-500">{c.kind === 'venue' ? 'venue' : 'service'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-600 tabular">
                      {c.approved} live{c.pending ? `, ${c.pending} waiting` : ''}
                      {c.rejected ? `, ${c.rejected} rejected` : ''}
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-ink-100" style={{ width: `${(total / max) * 100}%` }} aria-hidden>
                    <div className="bg-emerald-700" style={{ width: `${(c.approved / total) * 100}%` }} />
                    <div className="bg-marigold-600" style={{ width: `${(c.pending / total) * 100}%` }} />
                    <div className="bg-red-700" style={{ width: `${(c.rejected / total) * 100}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
          </div>
        )}
        <div>
          <h3 className="text-sm font-semibold text-ink-900">Inquiries by city</h3>
          <p className="text-xs text-ink-500">{rangeText.charAt(0).toUpperCase() + rangeText.slice(1)}</p>
          {data.marketplace.inquiries_by_city.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">No venue inquiries in this period.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-100 text-sm">
              {data.marketplace.inquiries_by_city.map((c) => (
                <li key={c.city} className="flex justify-between py-2">
                  <span className="text-ink-800">{c.city}</span>
                  <span className="font-semibold tabular text-ink-900">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
