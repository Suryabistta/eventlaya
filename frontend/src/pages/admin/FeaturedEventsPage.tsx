import React, { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Star } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, Textarea, controlClass, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { platformApi, type FeaturedEventRow } from './api'
import { PAGE, Segmented, fmtDate } from './shared'

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

  // The home page's Events section opens on the Featured tab: upcoming featured events, 3 at a time
  // Same query as the home page, so this always matches what visitors see
  const upcoming = useQuery({ queryKey: ['landing', 'events'], queryFn: () => api.getPublicEvents({ when: 'upcoming' }), staleTime: 60_000 })
  const live = (upcoming.data ?? []).filter((e) => e.is_featured)
  const onHome = live.slice(0, 3)
  const toggle = useMutation({
    mutationFn: (e: FeaturedEventRow) => platformApi.featureEvent(e.id, !e.is_featured),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['admin-featured-events'] })
      void qc.invalidateQueries({ queryKey: ['public-events'] })
      void qc.invalidateQueries({ queryKey: ['landing'] })
      toast.success(e.is_featured ? `Featured ${e.title}` : `${e.title} is no longer featured`)
    },
    onError: (err: Error) => toast.error('Couldn’t update the event', err.message),
  })

  const hide = useMutation({
    mutationFn: ({ e, hidden, reason }: { e: FeaturedEventRow; hidden: boolean; reason?: string }) => platformApi.hideEvent(e.id, hidden, reason),
    onSuccess: (e) => {
      void qc.invalidateQueries({ queryKey: ['admin-featured-events'] })
      void qc.invalidateQueries({ queryKey: ['public-events'] })
      void qc.invalidateQueries({ queryKey: ['landing'] })
      toast.success(e.hidden_by_admin ? `${e.title} is hidden from the public` : `${e.title} is public again`)
      setHiding(null)
    },
    onError: (err: Error) => toast.error('Couldn’t update the event', err.message),
  })
  const [hiding, setHiding] = useState<FeaturedEventRow | null>(null)
  const [reason, setReason] = useState('')

  return (
    <div className={PAGE}>
      <Modal
        open={Boolean(hiding)}
        onClose={() => setHiding(null)}
        title={hiding ? `Hide “${hiding.title}”?` : ''}
        description="It disappears from every public page and list and takes no sign-ups. The organizer sees your reason on their dashboard."
        footer={<><Button variant="secondary" onClick={() => setHiding(null)}>Cancel</Button><Button variant="danger" loading={hide.isPending} disabled={!reason.trim()} onClick={() => hiding && hide.mutate({ e: hiding, hidden: true, reason: reason.trim() })}>Hide event</Button></>}
      >
        <Textarea label="Reason (the organizer sees this)" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Misleading ticket information. Fix it and contact us." />
      </Modal>
      <PageHeader title="Featured & hidden events" description="Featured events are listed first on the events page and in the app. Hidden events disappear from every public page and take no sign-ups; the organizer sees your reason." />
      <Card className="border-marigold-200 bg-marigold-50 p-4 text-sm text-ink-700">
        <p className="font-semibold text-ink-900">
          <Star className="mr-1.5 inline h-4 w-4 fill-current text-marigold-500" aria-hidden />
          On the home page now ({onHome.length} of 3)
        </p>
        {onHome.length ? (
          <p className="mt-1">{onHome.map((e) => e.title).join(' · ')}</p>
        ) : (
          <p className="mt-1">Nothing yet. Press Feature on an upcoming event below and it shows on the home page straight away.</p>
        )}
        {live.length > onHome.length && (
          <p className="mt-1 text-ink-500">{live.length - onHome.length} more featured: they show first on the events page but not on the home page. Remove one above to make room.</p>
        )}
        <p className="mt-1 text-ink-500">Ended events don’t show on the home page. Tip: you can also press “Feature on home page” on any event page.</p>
      </Card>
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
          description={show === 'featured' ? 'Switch to All events and press Feature on the ones to promote.' : 'Only published events can be featured.'}
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
                    {e.hidden_by_admin && <Badge tone="danger">Hidden</Badge>}
                  </p>
                  <p className="truncate text-sm text-ink-500">{[e.organizer, fmtDate(e.start_date), e.location].filter(Boolean).join(' · ')}</p>
                </div>
                {e.hidden_by_admin ? (
                  <Button size="sm" variant="secondary" loading={hide.isPending} onClick={() => hide.mutate({ e, hidden: false })}>Show again</Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => { setReason(''); setHiding(e) }}>Hide</Button>
                )}
                <Button size="sm" variant={e.is_featured ? 'secondary' : 'primary'} icon={<Star className={cn('h-4 w-4', e.is_featured && 'fill-current text-marigold-500')} aria-hidden />} disabled={toggle.isPending || e.hidden_by_admin} onClick={() => toggle.mutate(e)} aria-label={`${e.is_featured ? 'Remove from featured' : 'Feature'} ${e.title}`}>
                  {e.is_featured ? 'Remove' : 'Feature'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default FeaturedEventsPage
