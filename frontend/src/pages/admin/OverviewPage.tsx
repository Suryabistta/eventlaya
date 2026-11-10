import React from 'react'
import { formatDate } from '@/lib/dates'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, Line } from 'react-chartjs-2'
import type { ChartOptions } from 'chart.js'
import { ArrowRight, Building2, CalendarCheck, DoorOpen, ShieldCheck, Store, Ticket } from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { chartColors, hBarOptions, lineOptions } from '@/pages/analytics/charts'
import { ChartCard, Legend } from '@/pages/analytics/shared'
import { platformApi, STATS_KEY } from './api'
import { ActivityList, useActivity } from './ActivityPage'
import { PendingQueue } from './approvals/PendingQueue'
import { PAGE, fmtNum } from './shared'

const dayLabel = (iso: string) => formatDate(new Date(`${iso}T00:00`), 'short')

const stackedBarOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: { ...hBarOptions().plugins?.tooltip, callbacks: {} } },
  scales: {
    x: { stacked: true, grid: { display: false }, border: { color: chartColors.grid }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: chartColors.grid }, border: { display: false } },
  },
}

const regLineOptions: ChartOptions<'line'> = {
  ...lineOptions,
  scales: {
    ...lineOptions.scales,
    x: { ...lineOptions.scales?.x, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
  },
}

/* ------------------------------------------------------------------ */

const Kpi: React.FC<{
  to: string
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon: React.ElementType
  tone?: 'brand' | 'success' | 'warning' | 'neutral'
  highlight?: boolean
}> = ({ to, label, value, hint, icon: Icon, tone = 'neutral', highlight }) => (
  <Link
    to={to}
    className={cn(
      'group flex items-start justify-between gap-3 rounded-2xl border bg-white p-4 transition-colors hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 sm:p-5',
      highlight ? 'border-marigold-300 bg-marigold-50/40' : 'border-ink-200',
    )}
  >
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-ink-900 tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
    <span
      className={cn(
        'hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex',
        {
          brand: 'bg-brand-50 text-brand-600',
          success: 'bg-emerald-50 text-emerald-600',
          warning: 'bg-marigold-50 text-marigold-600',
          neutral: 'bg-ink-100 text-ink-600',
        }[tone],
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  </Link>
)

export const OverviewPage: React.FC = () => {
  const stats = useQuery({ queryKey: STATS_KEY, queryFn: platformApi.stats })
  const activity = useActivity()

  const s = stats.data
  const pendingTotal = s ? s.pending.white_label + s.pending.marketplace_access + s.pending.listings : 0
  const regs30 = s?.registrations_by_day.reduce((a, d) => a + d.count, 0) ?? 0
  const signups30 = s?.signups_by_day.reduce((a, d) => a + d.organizers + d.vendors, 0) ?? 0

  return (
    <div className={PAGE}>
      <PageHeader
        title="Platform overview"
        description="How Eventlaya is doing across every event company and vendor, and what needs a decision from you."
      />

      {stats.isError ? (
        <ErrorState message={(stats.error as Error)?.message} onRetry={() => void stats.refetch()} />
      ) : (
        <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 2xl:grid-cols-6">
          {!s ? (
            [0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[108px] rounded-2xl" />)
          ) : (
            <>
              <Kpi
                to="/admin/approvals"
                label="Pending approvals"
                value={fmtNum(pendingTotal)}
                hint={pendingTotal ? `${s.pending.white_label} white-label, ${s.pending.marketplace_access} access, ${s.pending.listings} listings` : 'Nothing waiting'}
                icon={ShieldCheck}
                tone="warning"
                highlight={pendingTotal > 0}
              />
              <Kpi
                to="/admin/organizations?type=organizer"
                label="Event companies"
                value={fmtNum(s.organizations)}
                hint={`${signups30} new accounts in 30 days`}
                icon={Building2}
                tone="brand"
              />
              <Kpi to="/admin/organizations?type=vendor" label="Vendors" value={fmtNum(s.vendors)} hint="Marketplace-only accounts" icon={Store} />
              <Kpi
                to="/admin/activity?type=events"
                label="Events published"
                value={fmtNum(s.events_published)}
                hint={`${s.events_upcoming} upcoming, ${s.events_total} in total`}
                icon={CalendarCheck}
                tone="brand"
              />
              <Kpi
                to="/admin/organizations?sort=registrations"
                label="Registrations"
                value={fmtNum(s.registrations_total)}
                hint={`${regs30} in the last 30 days`}
                icon={Ticket}
              />
              <Kpi
                to="/admin/organizations?sort=registrations"
                label="Check-ins"
                value={fmtNum(s.checkins_total)}
                hint={s.registrations_total ? `${Math.round((s.checkins_total / s.registrations_total) * 100)}% of registrations` : 'No registrations yet'}
                icon={DoorOpen}
                tone="success"
              />
            </>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="min-w-0 xl:col-span-7">
          <CardHeader
            title="Needs your attention"
            description="Newest requests first"
            actions={
              <Link to="/admin/approvals" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                All approvals <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <PendingQueue limit={6} />
        </Card>

        <Card className="min-w-0 xl:col-span-5">
          <CardHeader
            title="Recent activity"
            actions={
              <Link to="/admin/activity" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                See all <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          {activity.isError ? (
            <div className="p-5">
              <ErrorState message={(activity.error as Error)?.message} onRetry={() => void activity.refetch()} />
            </div>
          ) : activity.isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !activity.data?.length ? (
            <EmptyState title="No activity yet" description="Sign-ups and new events will appear here." />
          ) : (
            <ActivityList items={activity.data.slice(0, 7)} compact />
          )}
        </Card>
      </div>

      {s && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          <ChartCard
            title="New accounts"
            description="Last 30 days"
            summary={`${signups30} new accounts in the last 30 days`}
            actions={
              <Legend
                items={[
                  { label: 'Event companies', color: chartColors.brand },
                  { label: 'Vendors', color: chartColors.marigold },
                ]}
              />
            }
          >
            <Bar
              options={stackedBarOptions}
              data={{
                labels: s.signups_by_day.map((d) => dayLabel(d.date)),
                datasets: [
                  { label: 'Event companies', data: s.signups_by_day.map((d) => d.organizers), backgroundColor: chartColors.brand, borderRadius: 3, maxBarThickness: 18 },
                  { label: 'Vendors', data: s.signups_by_day.map((d) => d.vendors), backgroundColor: chartColors.marigold, borderRadius: 3, maxBarThickness: 18 },
                ],
              }}
            />
          </ChartCard>

          <ChartCard title="Registrations" description="Passes issued per day, last 30 days" summary={`${regs30} registrations in the last 30 days`}>
            <Line
              options={regLineOptions}
              data={{
                labels: s.registrations_by_day.map((d) => dayLabel(d.date)),
                datasets: [
                  {
                    label: 'Registrations',
                    data: s.registrations_by_day.map((d) => d.count),
                    borderColor: chartColors.brand,
                    backgroundColor: 'rgba(194, 33, 90, 0.08)',
                    fill: 'origin',
                    pointBackgroundColor: chartColors.brand,
                  },
                ],
              }}
            />
          </ChartCard>

          <Card className="lg:col-span-2 2xl:col-span-1">
            <CardHeader
              title="Top event companies"
              description="By registrations"
              actions={
                <Link to="/admin/organizations?sort=registrations" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                  All <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
            />
            {s.top_organizations.length === 0 ? (
              <EmptyState icon={<Building2 className="h-6 w-6" />} title="No event companies yet" description="They’ll be ranked here once they sign up." />
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-50 text-xs text-ink-500">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Company
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Events
                    </th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">
                      Registrations
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {s.top_organizations.map((o) => (
                    <tr key={o.id}>
                      <td className="max-w-0 px-5 py-3">
                        <Link to={`/admin/organizations/${o.id}`} className="block truncate font-medium text-ink-900 hover:text-brand-700 hover:underline">
                          {o.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-700">{fmtNum(o.events)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular text-ink-900">{fmtNum(o.registrations)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

    </div>
  )
}

export default OverviewPage
