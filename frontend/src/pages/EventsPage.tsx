import React, { useMemo, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Check, ClipboardList, ExternalLink, Link2, MapPin, Pencil, Plus, LayoutTemplate, QrCode } from 'lucide-react'
import { RegistrationQrModal } from '@/components/RegistrationQrModal'
import { api, type Event } from '@/services/api'
import { useCurrentEvent } from '@/lib/event-context'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { taskApi } from './tasks/api'
import { PhaseBadge } from '@/components/PhaseBadge'
import { eventPhase, sortByPhase } from '@/lib/phase'

const fmtDate = (d: string) => formatDate(d, 'medium')

function dateRange(ev: Event) {
  const start = fmtDate(ev.start_date)
  if (!ev.end_date || ev.end_date === ev.start_date) return ev.start_time ? `${start}, ${ev.start_time.slice(0, 5)}` : start
  return `${start} to ${fmtDate(ev.end_date)}`
}

export const EventsPage: React.FC = () => {
  const toast = useToast()
  const navigate = useNavigate()
  const { events, currentEvent, setCurrentEventId, isLoading, isError, error, refetch } = useCurrentEvent()

  // Live first, then upcoming (soonest at the top), drafts, then ended and cancelled (most recent first)
  const sorted = useMemo(() => sortByPhase(events), [events])
  const [qrEvent, setQrEvent] = useState<Event | null>(null)

  // Open crew tasks per event, shown on each row
  const { data: tasks } = useQuery({ queryKey: ['tasks', 'all'], queryFn: taskApi.list })
  const openTasks = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks ?? []) if (t.event && t.status !== 'completed') counts[t.event] = (counts[t.event] ?? 0) + 1
    return counts
  }, [tasks])

  const openEvent = (ev: Event) => {
    setCurrentEventId(ev.id)
    navigate('/app')
  }

  const copyLink = async (ev: Event) => {
    const url = `${window.location.origin}/e/${ev.slug}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Registration link copied', url)
    } catch {
      toast.error('Couldn’t copy the link', url)
    }
  }

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Events"
        description="Everything you’re running. Open an event to manage registrations, the gate and voting."
        actions={
          <ButtonLink to="/app/events/new" icon={<Plus className="h-4 w-4" />}>
            Create event
          </ButtonLink>
        }
      />

      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <Card className="divide-y divide-ink-100">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-64 max-w-full" />
                <Skeleton className="h-4 w-48 max-w-full" />
              </div>
              <Skeleton className="hidden h-8 w-40 sm:block" />
            </div>
          ))}
        </Card>
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="No events yet"
            description="Create an event to get a registration link, QR passes and a gate scanner."
            action={
              <ButtonLink to="/app/events/new" icon={<Plus className="h-4 w-4" />}>
                Create event
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-ink-100">
            {sorted.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                isCurrent={ev.id === currentEvent?.id}
                openTasks={tasks ? (openTasks[ev.id] ?? 0) : undefined}
                onOpen={() => openEvent(ev)}
                onCopy={() => copyLink(ev)}
                onEdit={() => navigate(`/app/events/${ev.id}/edit`)}
                onEditPage={() => navigate(`/app/events/${ev.id}/edit?step=page`)}
                onQr={() => setQrEvent(ev)}
              />
            ))}
          </ul>
        </Card>
      )}
      {qrEvent && (
        <RegistrationQrModal open onClose={() => setQrEvent(null)} url={`${window.location.origin}/e/${qrEvent.slug}`} title={qrEvent.title} />
      )}
    </div>
  )
}

const EventRow: React.FC<{
  event: Event
  isCurrent: boolean
  openTasks?: number
  onOpen: () => void
  onCopy: () => void
  onEdit: () => void
  onEditPage: () => void
  onQr: () => void
}> = ({ event: ev, isCurrent, openTasks, onOpen, onCopy, onEdit, onEditPage, onQr }) => {
  const over = ['ended', 'cancelled'].includes(eventPhase(ev))
  const pct = ev.capacity ? Math.min(100, Math.round((ev.registered_count / ev.capacity) * 100)) : 0
  const full = ev.capacity > 0 && ev.registered_count >= ev.capacity

  return (
    <li className={cn('flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center', over && 'bg-ink-50/60', isCurrent && 'bg-brand-50/40')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 text-base font-bold text-ink-900 sm:truncate">{ev.title}</h3>
          {ev.parent_title && <Badge tone="neutral">Part of {ev.parent_title}</Badge>}
          <PhaseBadge event={ev} />
          {isCurrent && (
            <Badge tone="brand">
              <Check className="h-3 w-3" aria-hidden />
              Current
            </Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-ink-400" aria-hidden />
            {dateRange(ev)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <span className="truncate">{ev.location}</span>
          </span>
          {openTasks !== undefined && (
            <Link
              to={`/app/tasks?event=${ev.id}`}
              className="inline-flex items-center gap-1.5 font-medium text-ink-600 hover:text-brand-700 hover:underline"
            >
              <ClipboardList className="h-4 w-4 text-ink-400" aria-hidden />
              {openTasks === 0 ? 'No open tasks' : `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'}`}
            </Link>
          )}
        </p>
      </div>

      <div className="w-full sm:w-44">
        <p className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink-900 tabular">
            {ev.registered_count}
            <span className="font-normal text-ink-500">{ev.capacity ? ` / ${ev.capacity}` : ''} registered</span>
          </span>
          {full && <span className="text-xs font-semibold text-marigold-800">Full</span>}
        </p>
        {ev.capacity > 0 ? (
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100"
            role="meter"
            aria-label={`${ev.title} registrations`}
            aria-valuemin={0}
            aria-valuemax={ev.capacity}
            aria-valuenow={ev.registered_count}
          >
            <div className={cn('h-full rounded-full', full ? 'bg-marigold-500' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-ink-500">No capacity limit</p>
        )}
      </div>

      <div className="flex items-center gap-1 sm:justify-end">
        <Button size="sm" variant="secondary" onClick={onOpen} className="mr-1">
          Open
        </Button>
        <IconButton label={`Edit ${ev.title}`} onClick={onEdit}>
          <Pencil className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={`Edit event page for ${ev.title}`} onClick={onEditPage}>
          <LayoutTemplate className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={`QR code for ${ev.title}`} onClick={onQr}>
          <QrCode className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={`Copy registration link for ${ev.title}`} onClick={onCopy}>
          <Link2 className="h-4 w-4" aria-hidden />
        </IconButton>
        <a
          href={`/e/${ev.slug}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`View public page for ${ev.title} (opens in a new tab)`}
          title="View public page"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      </div>
    </li>
  )
}
