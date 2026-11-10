import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Circle } from 'lucide-react'
import { ButtonLink, Card, CardHeader } from '@/components/ui'
import { eventPageApi } from '@/lib/event-page'
import { request, type Event } from '@/services/api'
import { cn } from '@/lib/utils'

/** Dashboard: applications at a glance; reviewing them happens on the Applications page. */
export const ApplicationsSummary: React.FC<{ eventId: string }> = ({ eventId }) => {
  // Same query as the Applications page and the sidebar badge
  const { data = [] } = useQuery({
    queryKey: ['applications', eventId],
    queryFn: () => request<{ review_status: string }[]>(`/forms/events/${eventId}/applications/`),
  })
  const count = (s: string) => data.filter((a) => a.review_status === s).length
  const tiles = [
    { label: 'Received', value: data.length },
    { label: 'To review', value: count('pending'), strong: count('pending') > 0 },
    { label: 'Accepted', value: count('accepted') },
    { label: 'Not selected', value: count('rejected') },
  ]
  return (
    <Card>
      <CardHeader
        title="Applications"
        description="Read each one and accept or decline. Accepted applicants can become contestants."
        actions={
          <ButtonLink to="/app/applications" size="sm" icon={<ArrowRight className="h-4 w-4" />}>
            {count('pending') ? `Review ${count('pending')}` : 'Open applications'}
          </ButtonLink>
        }
      />
      <dl className="grid grid-cols-2 divide-ink-100 sm:grid-cols-4 sm:divide-x">
        {tiles.map((t) => (
          <div key={t.label} className="px-5 py-4">
            <dt className="text-sm text-ink-500">{t.label}</dt>
            <dd className={cn('font-display text-2xl font-bold tabular', t.strong ? 'text-brand-700' : 'text-ink-900')}>{t.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

/** Dashboard: what's still missing on the public event page, each with a link to fill it in. Hidden once complete. */
export const PageChecklist: React.FC<{ event: Event }> = ({ event }) => {
  const { data: page } = useQuery({ queryKey: ['eventPage', event.id], queryFn: () => eventPageApi.get(event.id) })
  if (!page) return null
  const edit = (step: string) => `/app/events/${event.id}/edit?step=${step}`
  const items = [
    { label: 'Banner image', done: Boolean(event.banner), to: edit('basics') },
    { label: 'Description', done: Boolean(event.description?.trim()), to: edit('basics') },
    { label: 'Highlights', done: page.highlights.length > 0, to: edit('page') },
    { label: 'Schedule', done: page.agenda.length > 0, to: edit('schedule') },
    { label: page.speakers_label?.trim() || 'Speakers', done: page.speakers.length > 0, to: edit('speakers') },
    { label: 'FAQs', done: page.faqs.length > 0, to: edit('faqs') },
    { label: 'Terms & conditions', done: Boolean(page.terms?.trim()), to: edit('faqs') },
  ]
  const left = items.filter((i) => !i.done).length
  if (!left) return null
  return (
    <Card>
      <CardHeader title="Make your event page better" description={`${items.length - left} of ${items.length} done. Pages with a banner, schedule and FAQs get more sign-ups.`} />
      <ul className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <li key={i.label}>
            {i.done ? (
              <span className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-500">
                <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                {i.label}
              </span>
            ) : (
              <Link to={i.to} className="flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2 text-sm font-medium text-ink-800 hover:border-brand-300 hover:bg-brand-50/50">
                <Circle className="h-4 w-4 text-ink-300" aria-hidden />
                Add {i.label.toLowerCase()}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
