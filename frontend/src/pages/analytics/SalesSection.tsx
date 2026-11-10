import React from 'react'
import { Line } from 'react-chartjs-2'
import { Wallet } from 'lucide-react'
import type { EventAnalytics } from '@/services/api'
import { EmptyState, StatTile } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { chartColors, lineOptions } from './charts'
import { ChartCard } from './shared'

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`

/** Ticket sales over time: what was received and what is still due at the venue, per day (BS dates). */
export const SalesSection: React.FC<{ analytics: EventAnalytics }> = ({ analytics }) => {
  const s = analytics.sales_chart
  if (!s) return null
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const labels = s.labels.map((d) => formatDate(d, 'short'))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Ticket sales" value={rs(s.total)} />
        <StatTile label="Received" value={rs(sum(s.received))} tone="success" />
        <StatTile label="Due at the venue" value={rs(sum(s.due))} tone="warning" />
        <StatTile label="Paid online" value={rs(sum(s.online))} />
      </div>
      <ChartCard
        title="Ticket sales per day"
        description="Orders by the day they were placed. Released and refunded orders are left out."
        summary={labels.map((l, i) => `${l}: ${rs((s.received[i] ?? 0) + (s.due[i] ?? 0))}`).join('; ')}
        empty={s.total === 0 ? <EmptyState icon={<Wallet className="h-6 w-6" />} title="No ticket sales yet" description="Paid and pay-at-the-venue orders show up here by day." /> : undefined}
      >
        <Line
          options={lineOptions}
          data={{
            labels,
            datasets: [
              { label: 'Received', data: s.received, borderColor: chartColors.brand, backgroundColor: 'rgba(194, 33, 90, 0.08)', fill: true },
              { label: 'Due at the venue', data: s.due, borderColor: '#d97706', backgroundColor: 'rgba(217, 119, 6, 0.06)', fill: true },
            ],
          }}
        />
      </ChartCard>
    </div>
  )
}
