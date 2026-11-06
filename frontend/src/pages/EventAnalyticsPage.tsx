import React, { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, CalendarDays, ClipboardList, Download, ScanLine, Wallet } from 'lucide-react'
import { api, tokenStore } from '@/services/api'
import { useCurrentEvent } from '@/lib/event-context'
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PhaseNotice } from '@/components/PhaseBadge'
import { AttendanceSection } from './analytics/AttendanceSection'
import { FundingSection } from './analytics/FundingSection'
import { TasksSection } from './analytics/TasksSection'
import { TicketTypesSection } from './analytics/TicketTypesSection'

const tabs = [
  {
    id: 'attendance',
    label: 'Registrations and attendance',
    short: 'Attendance',
    icon: BarChart3,
  },
  {
    id: 'budget',
    label: 'Budget and sponsorship',
    short: 'Budget',
    icon: Wallet,
  },
  { id: 'crew', label: 'Crew tasks', short: 'Crew tasks', icon: ClipboardList },
] as const

type TabId = (typeof tabs)[number]['id']

const PageSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-28 rounded-2xl" />
      ))}
    </div>
    <div className="grid gap-6 lg:grid-cols-3">
      <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  </div>
)

export default function EventAnalyticsPage() {
  const { id: routeEventId } = useParams<{ id?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    currentEvent,
    setCurrentEventId,
    isLoading: eventsLoading,
    isError: eventsError,
    error: eventsErr,
    refetch: refetchEvents,
  } = useCurrentEvent()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  // /app/events/:id/analytics selects that event in the shared switcher
  useEffect(() => {
    if (routeEventId) setCurrentEventId(routeEventId)
  }, [routeEventId, setCurrentEventId])

  const requested = searchParams.get('tab')
  const activeTab: TabId = tabs.some((t) => t.id === requested) ? (requested as TabId) : 'attendance'
  const selectTab = (id: TabId) =>
    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (id === 'attendance') next.delete('tab')
        else next.set('tab', id)
        return next
      },
      { replace: true },
    )

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    selectTab(tabs[next].id)
    tabRefs.current[next]?.focus()
  }

  const eventId = currentEvent?.id
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    error: analyticsErr,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: ['analytics', eventId],
    queryFn: () => api.getEventAnalytics(eventId!),
    enabled: Boolean(eventId),
    refetchInterval: 30000,
  })

  useEffect(() => {
    if (analyticsError) toast.error('Couldn’t load analytics', (analyticsErr as Error)?.message)
  }, [analyticsError, analyticsErr, toast])

  useEffect(() => {
    if (eventsError) toast.error('Couldn’t load your events', eventsErr?.message)
  }, [eventsError, eventsErr, toast])

  const exportCsv = async () => {
    if (!currentEvent) return
    setExporting(true)
    try {
      const token = tokenStore.access
      const res = await fetch(`/api/events/${currentEvent.id}/export-attendees/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`The server responded with ${res.status}.`)
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `eventlaya_attendees_${currentEvent.slug}.csv`
      link.click()
      URL.revokeObjectURL(url)
      toast.success('Attendee list downloaded', link.download)
    } catch (err) {
      toast.error('Couldn’t export attendees', `${(err as Error).message} Try again in a moment.`)
    } finally {
      setExporting(false)
    }
  }

  if (eventsError) {
    return (
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8 2xl:px-10">
        <ErrorState message={eventsErr?.message} onRetry={refetchEvents} />
      </div>
    )
  }

  if (!eventsLoading && !currentEvent) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <PageHeader title="Analytics and crew" />
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Create an event to see analytics"
            description="Registrations, gate traffic, budget and crew tasks are tracked per event."
            action={<ButtonLink to="/app/events">Create an event</ButtonLink>}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Analytics and crew"
        description={
          currentEvent ? (
            currentEvent.title
          ) : (
            <span className="inline-block h-5 w-64 animate-pulse rounded-lg bg-ink-100 align-middle" aria-hidden />
          )
        }
        actions={
          eventId && (
            <>
              <Button variant="secondary" icon={<Download className="h-4 w-4 text-ink-400" />} loading={exporting} onClick={exportCsv}>
                Export attendees (CSV)
              </Button>
              <ButtonLink to="/app/scanner" variant="secondary" icon={<ScanLine className="h-4 w-4" />}>
                Open gate scanner
              </ButtonLink>
            </>
          )
        }
      />

      {currentEvent && <PhaseNotice event={currentEvent} context="analytics" />}

      <div role="tablist" aria-label="Analytics sections" className="flex gap-1 overflow-x-auto border-b border-ink-200">
        {tabs.map((t, i) => {
          const selected = t.id === activeTab
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              className={cn(
                '-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:rounded-t-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30',
                selected ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800',
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden />
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'crew' && eventId ? (
          <TasksSection eventId={eventId} />
        ) : analyticsError ? (
          <ErrorState message={(analyticsErr as Error)?.message} onRetry={() => void refetchAnalytics()} />
        ) : eventsLoading || analyticsLoading || !analytics || !eventId ? (
          <PageSkeleton />
        ) : activeTab === 'budget' ? (
          <FundingSection eventId={eventId} analytics={analytics} />
        ) : (
          <>
            <AttendanceSection analytics={analytics} />
            <TicketTypesSection analytics={analytics} />
          </>
        )}
      </div>
    </div>
  )
}
