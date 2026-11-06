import React, { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, CalendarCheck, CheckCircle2, Globe, MapPin, Store, UserPlus, XCircle } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { platformApi, type ActivityItem } from './api'
import { PAGE, Segmented, timeAgo } from './shared'

type Filter = 'all' | 'signups' | 'events' | 'approvals' | 'listings'

const filterOf = (kind: string): Filter =>
  kind === 'signup'
    ? 'signups'
    : kind === 'event_published'
      ? 'events'
      : kind === 'listing_created'
        ? 'listings'
        : 'approvals'

function iconFor(kind: string): { icon: React.ElementType; className: string; label: string } {
  if (kind === 'signup') return { icon: UserPlus, className: 'bg-brand-50 text-brand-600', label: 'Sign-up' }
  if (kind === 'event_published') return { icon: CalendarCheck, className: 'bg-emerald-50 text-emerald-700', label: 'Event' }
  if (kind === 'listing_created') return { icon: MapPin, className: 'bg-marigold-50 text-marigold-700', label: 'Listing' }
  if (kind.endsWith('_approved')) return { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700', label: 'Approved' }
  if (kind.endsWith('_rejected')) return { icon: XCircle, className: 'bg-red-50 text-red-700', label: 'Rejected' }
  if (kind.startsWith('marketplace')) return { icon: Store, className: 'bg-ink-100 text-ink-600', label: 'Request' }
  return { icon: Globe, className: 'bg-ink-100 text-ink-600', label: 'Request' }
}

export const useActivity = () => useQuery({ queryKey: ['platform', 'activity'], queryFn: platformApi.activity })

export const ActivityList: React.FC<{ items: ActivityItem[]; compact?: boolean }> = ({ items, compact }) => (
  <ol className="divide-y divide-ink-100">
    {items.map((item, i) => {
      const { icon: Icon, className, label } = iconFor(item.kind)
      const external = item.link.startsWith('/e/') || item.link.startsWith('/marketplace')
      const body = (
        <>
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', className)}>
            <Icon className="h-4 w-4" aria-hidden />
            <span className="sr-only">{label}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">{item.title}</span>
            {item.description && !compact && <span className="mt-0.5 block truncate text-sm text-ink-500">{item.description}</span>}
          </span>
          <time dateTime={item.at} title={new Date(item.at).toLocaleString()} className="shrink-0 text-xs text-ink-500">
            {timeAgo(item.at)}
          </time>
        </>
      )
      const rowClass = cn('flex items-start gap-3 px-5', compact ? 'py-3' : 'py-3.5')
      return (
        <li key={`${item.kind}-${item.at}-${i}`}>
          {item.link ? (
            external ? (
              <a href={item.link} target="_blank" rel="noreferrer" className={cn(rowClass, 'hover:bg-ink-50')}>
                {body}
              </a>
            ) : (
              <Link to={item.link} className={cn(rowClass, 'hover:bg-ink-50')}>
                {body}
              </Link>
            )
          ) : (
            <div className={rowClass}>{body}</div>
          )}
        </li>
      )
    })}
  </ol>
)

export const ActivityPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const filter = (params.get('type') as Filter) || 'all'
  const { data, isLoading, isError, error, refetch } = useActivity()
  const items = useMemo(() => (data ?? []).filter((i) => filter === 'all' || filterOf(i.kind) === filter), [data, filter])

  return (
    <div className={PAGE}>
      <PageHeader title="Activity" description="The latest sign-ups, published events, listings and approval decisions across the platform." />

      <Segmented
        label="Show"
        value={filter}
        onChange={(f) => setParams(f === 'all' ? {} : { type: f }, { replace: true })}
        options={[
          { value: 'all', label: 'Everything' },
          { value: 'signups', label: 'Sign-ups' },
          { value: 'events', label: 'Events' },
          { value: 'approvals', label: 'Requests and decisions' },
          { value: 'listings', label: 'Listings' },
        ]}
      />

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No activity yet"
              description="Sign-ups, new events and approval decisions will appear here as they happen."
            />
          ) : (
            <ActivityList items={items} />
          )}
        </Card>
      )}
      <p className="text-sm text-ink-500">Showing the 50 most recent platform events.</p>
    </div>
  )
}

export default ActivityPage
