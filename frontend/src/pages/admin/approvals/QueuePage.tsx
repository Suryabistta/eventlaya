import React from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Globe, MapPin, MessageSquareText, Store } from 'lucide-react'
import { Card, CardHeader, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { platformApi, STATS_KEY } from '../api'
import { PAGE } from '../shared'
import { PendingQueue, approvalPaths } from './PendingQueue'

const legacyTabs: Record<string, string> = {
  'white-label': approvalPaths.white_label,
  marketplace: approvalPaths.marketplace,
  listings: approvalPaths.listing,
}

/** /admin/approvals: one queue of everything waiting for a decision. */
export const ApprovalsQueuePage: React.FC = () => {
  const [params] = useSearchParams()
  const { data: stats } = useQuery({ queryKey: STATS_KEY, queryFn: platformApi.stats })

  // Old deep links: /admin/approvals?tab=listings
  const tab = params.get('tab')
  if (tab && legacyTabs[tab]) return <Navigate to={legacyTabs[tab]} replace />

  const summary = [
    { label: 'White-label', icon: Globe, count: stats?.pending.white_label, to: approvalPaths.white_label, hint: 'Custom domains and branding' },
    { label: 'Marketplace access', icon: Store, count: stats?.pending.marketplace_access, to: approvalPaths.marketplace, hint: 'Event companies opening a business portal' },
    { label: 'Listings', icon: MapPin, count: stats?.pending.listings, to: approvalPaths.listing, hint: 'Venues and service profiles' },
    { label: 'SMS credits', icon: MessageSquareText, count: stats?.pending.sms_credits ?? 0, to: '/admin/approvals/sms', hint: 'Top-ups organizers asked for' },
  ]

  return (
    <div className={PAGE}>
      <PageHeader
        title="Needs your attention"
        description="Everything waiting for a decision, newest first. Nothing goes live until you approve it."
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4" aria-label="Pending by type">
        {summary.map((s) => (
          <li key={s.label} className="min-w-0">
            <Link
              to={s.to}
              className={cn(
                'group flex items-center gap-3 rounded-2xl border bg-white p-4 transition-colors hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                s.count ? 'border-marigold-300' : 'border-ink-200',
              )}
            >
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', s.count ? 'bg-marigold-50 text-marigold-700' : 'bg-ink-100 text-ink-500')}>
                <s.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-500">{s.label}</span>
                {stats ? (
                  <span className="block font-display text-2xl font-bold text-ink-900 tabular">
                    {s.count} <span className="font-sans text-sm font-medium text-ink-500">pending</span>
                  </span>
                ) : (
                  <Skeleton className="mt-1 h-7 w-20" />
                )}
                <span className="block truncate text-xs text-ink-500">{s.hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-400 group-hover:text-ink-700" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <Card className="min-w-0">
        <CardHeader title="Waiting for review" description="Approve straight from here, or open a type to see details and past decisions." />
        <PendingQueue />
      </Card>
    </div>
  )
}

export default ApprovalsQueuePage
