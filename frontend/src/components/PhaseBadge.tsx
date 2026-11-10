import React from 'react'
import { formatDate } from '@/lib/dates'
import type { Event } from '@/services/api'
import { Badge } from '@/components/ui'
import { Ban, CalendarCheck2, CalendarClock } from 'lucide-react'
import { daysUntil, eventPhase, phaseMeta, startsInText } from '@/lib/phase'
import { cn } from '@/lib/utils'

/** Upcoming / Happening now / Ended / Cancelled / Draft */
export const PhaseBadge: React.FC<{ event: Parameters<typeof eventPhase>[0] & Partial<Pick<Event, 'id'>>; className?: string }> = ({ event, className }) => {
  const phase = eventPhase(event)
  const m = phaseMeta[phase]
  return (
    <Badge tone={m.tone} dot={phase === 'live'} className={className}>
      {m.label}
    </Badge>
  )
}

type NoticeContext = 'scanner' | 'tickets' | 'analytics'

/**
 * A short heads-up when the event's phase changes what a page is for:
 * scans refused before/after the event, prices pointless after it.
 */
export const PhaseNotice: React.FC<{ event: Parameters<typeof eventPhase>[0] & Pick<Event, 'title'>; context: NoticeContext; className?: string }> = ({
  event,
  context,
  className,
}) => {
  const phase = eventPhase(event)
  const day = formatDate(new Date(`${event.start_date}T00:00:00`), 'full', false)
  let tone: 'danger' | 'neutral' | 'info' = 'neutral'
  let title = ''
  let body = ''
  if (phase === 'cancelled') {
    tone = 'danger'
    title = 'This event was cancelled'
    body =
      context === 'scanner'
        ? 'Every scan will be refused. Tell gate staff not to let anyone in on these passes.'
        : context === 'tickets'
          ? 'Nobody can register, so ticket changes have no effect. Reopen the event from Edit event if this was a mistake.'
          : 'These numbers are final unless you reopen the event.'
  } else if (phase === 'ended') {
    title = 'This event has ended'
    body =
      context === 'scanner'
        ? 'Scans will be refused now. You can still look up attendees and see the scan history below.'
        : context === 'tickets'
          ? 'Registration is closed, so changing prices or codes won’t affect anyone. Ticket totals stay here for your records.'
          : 'These are the final numbers for this event.'
  } else if (phase === 'draft' && context === 'scanner') {
    title = 'This event is a draft'
    body = 'Publish it before the event day so passes can be issued and scanned.'
  } else if (phase === 'upcoming' && context === 'scanner' && daysUntil(event) >= 1) {
    tone = 'info'
    title = `Scanning opens on ${day}`
    body = `${startsInText(event)}. Scans before the event day are refused, so use this time to test the camera and assign staff to gates.`
  } else {
    return null
  }
  const styles = {
    danger: 'border-red-200 bg-red-50 text-red-900',
    neutral: 'border-ink-200 bg-ink-100/70 text-ink-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  }[tone]
  const Icon = tone === 'danger' ? Ban : tone === 'info' ? CalendarClock : CalendarCheck2
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-2xl border p-4', styles, className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90">{body}</p>
      </div>
    </div>
  )
}
