import React from 'react'
import { Line } from 'react-chartjs-2'
import { Users, DoorOpen, LogOut, ScanLine, UserPlus, CheckCircle2, XCircle, Copy, Ban } from 'lucide-react'
import type { EventAnalytics } from '@/services/api'
import { ButtonLink, Card, CardHeader, EmptyState, StatTile } from '@/components/ui'
import { cn } from '@/lib/utils'
import { chartColors, lineOptions } from './charts'
import { ChartCard, Legend } from './shared'

const scanResults: {
  key: string
  label: string
  icon: React.ElementType
  className: string
}[] = [
  {
    key: 'success',
    label: 'Accepted',
    icon: CheckCircle2,
    className: 'text-emerald-700',
  },
  {
    key: 'duplicate',
    label: 'Already inside (duplicate)',
    icon: Copy,
    className: 'text-marigold-700',
  },
  {
    key: 'not_in',
    label: 'Exit without entry',
    icon: Ban,
    className: 'text-marigold-700',
  },
  {
    key: 'invalid',
    label: 'Invalid pass',
    icon: XCircle,
    className: 'text-red-700',
  },
]

export const AttendanceSection: React.FC<{ analytics: EventAnalytics }> = ({ analytics }) => {
  const { attendance, velocity_chart, gate_distribution_chart, registration_growth_chart, scan_audit } = analytics
  const totalScans = Object.values(scan_audit).reduce((a, b) => a + b, 0)
  const capacity = attendance.capacity
  const occupancy = capacity ? Math.min(100, Math.round((attendance.currently_inside / capacity) * 100)) : 0

  const noScans = (
    <EmptyState
      icon={<ScanLine className="h-6 w-6" />}
      title="No gate scans yet"
      description="Charts fill in once your crew starts scanning passes at the gates."
      action={
        <ButtonLink to="/app/scanner" variant="secondary" size="sm" icon={<ScanLine className="h-4 w-4" />}>
          Open gate scanner
        </ButtonLink>
      }
    />
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label="Registered"
          value={attendance.total_registered}
          hint={capacity ? `${Math.max(capacity - attendance.total_registered, 0)} of ${capacity} spots left` : 'No capacity limit'}
          icon={<Users className="h-5 w-5" />}
          tone="brand"
        />
        <StatTile
          label="Checked in"
          value={attendance.checked_in}
          hint={`${attendance.checkin_rate_pct}% of registrations`}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
        />
        <Card className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink-500">Inside now</p>
              <p className="mt-1 font-display text-3xl font-bold tabular text-emerald-700">{attendance.currently_inside}</p>
            </div>
            <div className="hidden h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex">
              <DoorOpen className="h-5 w-5" aria-hidden />
            </div>
          </div>
          {capacity > 0 ? (
            <div className="mt-2">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-ink-100"
                role="meter"
                aria-valuenow={occupancy}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Venue occupancy"
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500',
                    occupancy >= 90 ? 'bg-red-500' : occupancy >= 70 ? 'bg-marigold-500' : 'bg-emerald-500',
                  )}
                  style={{ width: `${occupancy}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-ink-500">{occupancy}% of capacity</p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-ink-500">No capacity limit</p>
          )}
        </Card>
        <StatTile
          label="Left the venue"
          value={attendance.checked_out}
          hint="Scanned out at a gate"
          icon={<LogOut className="h-5 w-5" />}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Gate traffic by hour"
          description="Scans in and out across all gates"
          actions={
            totalScans > 0 ? (
              <Legend
                items={[
                  { label: 'Checked in', color: chartColors.emerald },
                  { label: 'Checked out', color: chartColors.marigold },
                ]}
              />
            ) : undefined
          }
          summary={`Hourly gate scans. ${velocity_chart.labels
            .map((l, i) => `${l}: ${velocity_chart.gate_in[i] ?? 0} in, ${velocity_chart.gate_out[i] ?? 0} out`)
            .join('; ')}`}
          height="h-72"
          empty={totalScans === 0 ? noScans : undefined}
        >
          <Line
            options={lineOptions}
            data={{
              labels: velocity_chart.labels,
              datasets: [
                {
                  label: 'Checked in',
                  data: velocity_chart.gate_in,
                  borderColor: chartColors.emerald,
                  backgroundColor: 'rgba(21, 128, 61, 0.08)',
                  pointBackgroundColor: chartColors.emerald,
                  fill: true,
                },
                {
                  label: 'Checked out',
                  data: velocity_chart.gate_out,
                  borderColor: chartColors.marigold,
                  pointBackgroundColor: chartColors.marigold,
                  fill: false,
                },
              ],
            }}
          />
        </ChartCard>

        <Card>
          <CardHeader title="Entries by gate" description="Accepted check-ins at each gate" />
          {totalScans === 0 ? (
            noScans
          ) : (
            <ul className="space-y-4 p-5">
              {gate_distribution_chart.labels.map((gate, i) => {
                const count = gate_distribution_chart.counts[i] ?? 0
                const max = Math.max(...gate_distribution_chart.counts, 1)
                return (
                  <li key={gate}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium text-ink-700">{gate}</span>
                      <span className="font-semibold tabular text-ink-900">
                        {count.toLocaleString()}
                        {analytics.gate_checkin?.[i] && <span className="ml-1.5 font-normal text-ink-500">({analytics.gate_checkin[i].rate_pct}% of registered)</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Registrations per day"
          description="New passes issued each day"
          summary={registration_growth_chart.labels.map((l, i) => `${l}: ${registration_growth_chart.counts[i] ?? 0}`).join('; ')}
          empty={
            attendance.total_registered === 0 ? (
              <EmptyState
                icon={<UserPlus className="h-6 w-6" />}
                title="No registrations yet"
                description="Share the registration link from the dashboard. Sign-ups show up here by day."
                action={
                  <ButtonLink to="/app" variant="secondary" size="sm">
                    Go to dashboard
                  </ButtonLink>
                }
              />
            ) : undefined
          }
        >
          <Line
            options={lineOptions}
            data={{
              labels: registration_growth_chart.labels,
              datasets: [
                {
                  label: 'Registrations',
                  data: registration_growth_chart.counts,
                  borderColor: chartColors.brand,
                  backgroundColor: 'rgba(194, 33, 90, 0.08)',
                  pointBackgroundColor: chartColors.brand,
                  fill: true,
                },
              ],
            }}
          />
        </ChartCard>

        <Card>
          <CardHeader title="Scan results" description={`${totalScans.toLocaleString()} scans in total`} />
          <ul className="divide-y divide-ink-100">
            {scanResults.map(({ key, label, icon: Icon, className }) => (
              <li key={key} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="inline-flex items-center gap-2 text-ink-700">
                  <Icon className={cn('h-4 w-4', className)} aria-hidden />
                  {label}
                </span>
                <span className="font-semibold tabular text-ink-900">{(scan_audit[key] ?? 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
