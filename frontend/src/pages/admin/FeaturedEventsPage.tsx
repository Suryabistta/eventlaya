import React, { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Star } from 'lucide-react'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, controlClass, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { platformApi, type FeaturedEventRow } from './api'
import { PAGE, Segmented, Switch, fmtDate } from './shared'

/** Superadmin → Featured events: featured events come first on the events page, with a badge. */
export const FeaturedEventsPage: React.FC = () => {
  const toast = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<'all' | 'featured'>('all')
  const q = useDeferredValue(search.trim())
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-featured-events', q, show],
    queryFn: () => platformApi.featuredEvents(q, show === 'featured'),
    placeholderData: (prev) => prev,
  })

  const toggle = useMutation({
    mutationFn: (e: FeaturedEventRow) => platformApi.featureEvent(e.id, !e.is_featured),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['admin-featured-events'] })
      void qc.invalidateQueries({ queryKey: ['public-events'] })
      toast.success(e.is_featured ? `Featured ${e.title}` : `${e.title} is no longer featured`)
    },
    onError: (err: Error) => toast.error('Couldn’t update the event', err.message),
  })

  return (
    <div className={PAGE}>
      <PageHeader title="Featured events" description="Featured events are listed first on the events page and in the app, with a Featured badge." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Show"
          value={show}
          onChange={(v) => setShow(v as 'all' | 'featured')}
          options={[
            { value: 'all', label: 'All events' },
            { value: 'featured', label: 'Featured' },
          ]}
        />
        <label className="relative block sm:w-72">
          <span className="sr-only">Search events</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Event, organizer or place" className={cn(controlClass, 'pl-9')} />
        </label>
      </div>

      {isLoading ? (
        <Card className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load events." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={<Star className="h-6 w-6" />}
          title={show === 'featured' ? 'No featured events' : 'No events found'}
          description={show === 'featured' ? 'Switch to All events and turn on Featured for the ones to promote.' : 'Only published events can be featured.'}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {data.map((e) => (
              <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                    <Link to={`/e/${e.slug}`} target="_blank" className="truncate hover:text-brand-700 hover:underline">
                      {e.title}
                    </Link>
                    {e.is_featured && <Badge tone="warning">Featured</Badge>}
                    {e.over && <Badge tone="neutral">Ended</Badge>}
                  </p>
                  <p className="truncate text-sm text-ink-500">{[e.organizer, fmtDate(e.start_date), e.location].filter(Boolean).join(' · ')}</p>
                </div>
                <Switch size="sm" checked={e.is_featured} label={`Feature ${e.title}`} disabled={toggle.isPending} onChange={() => toggle.mutate(e)} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default FeaturedEventsPage
