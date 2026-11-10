import React, { useEffect, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Download,
  LogIn,
  LogOut,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  Ticket as TicketIcon,
  Users,
  CalendarPlus,
  DoorOpen,
  Settings2,
} from 'lucide-react'
import { api, request, type GateStats, type Ticket } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { useCurrentEvent } from '@/lib/event-context'
import { gatesApi, type EventGate } from '@/lib/gates'
import { GateScannerComponent, describeScan, postScan, type ScanType } from '@/components/GateScannerComponent'
import { TicketPassModal } from '@/components/TicketPassModal'
import { PhaseNotice } from '@/components/PhaseBadge'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'

const ticketStatus: Record<Ticket['status'], { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  valid: { label: 'Not arrived', tone: 'neutral' },
  checked_in: { label: 'Inside', tone: 'success' },
  checked_out: { label: 'Left', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  reserved: { label: 'Awaiting payment', tone: 'warning' },
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const passDate = (d: string, t?: string) => {
  const date = new Date(`${d}T${t || '00:00:00'}`)
  const day = formatDate(date, 'weekday')
  return t ? `${day}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const GateScannerPage: React.FC = () => {
  const toast = useToast()
  const { user } = useAuth()
  const canManage = user?.role === 'organizer' || user?.role === 'superadmin'
  const { currentEvent, events, setCurrentEventId, isLoading: eventsLoading, isError: eventsError, error, refetch } = useCurrentEvent()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search.trim())
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [activeGate, setActiveGate] = useState<EventGate | undefined>()

  const eventId = currentEvent?.id
  const isStaff = !canManage

  // Staff: which gate (if any) the organizer assigned them to at this event
  const assignmentQuery = useQuery({
    queryKey: ['myAssignment', eventId],
    queryFn: () => gatesApi.myAssignment(eventId).catch((e: Error) => (/no active gate/i.test(e.message) ? null : Promise.reject(e))),
    enabled: Boolean(eventId) && isStaff,
  })
  const assignment = assignmentQuery.data
  const otherAssignmentQuery = useQuery({
    queryKey: ['myAssignment', 'any'],
    queryFn: () => gatesApi.myAssignment().catch((e: Error) => (/no active gate/i.test(e.message) ? null : Promise.reject(e))),
    enabled: isStaff && assignment === null,
  })
  const hasAccess = canManage || Boolean(assignment)

  const gatesQuery = useQuery({
    queryKey: ['gates', eventId],
    queryFn: () => gatesApi.list(eventId!),
    enabled: Boolean(eventId) && hasAccess,
    refetchInterval: 30000,
  })
  const openGates = (gatesQuery.data ?? []).filter((g) => g.is_active)
  const lockedGate = isStaff && assignment?.gate ? ((gatesQuery.data ?? []).find((g) => g.id === assignment.gate!.id) ?? assignment.gate) : null

  const statsQuery = useQuery({
    queryKey: ['gateStats', eventId],
    queryFn: () => api.getGateStats(eventId!),
    enabled: Boolean(eventId) && hasAccess,
    refetchInterval: 4000,
  })

  const ticketsQuery = useQuery({
    queryKey: ['tickets', eventId, debouncedSearch],
    queryFn: () => api.getEventTickets(eventId!, debouncedSearch),
    enabled: Boolean(eventId) && hasAccess,
  })

  const manualScan = useMutation({
    mutationFn: ({ ticket, scan_type }: { ticket: Ticket; scan_type: ScanType }) =>
      postScan(eventId!, {
        qr_token: ticket.qr_token,
        scan_type,
        ...(activeGate ? { gate_id: activeGate.id } : { gate_name: 'Manual Terminal' }),
      }),
    onSuccess: (res, { ticket, scan_type }) => {
      const d = describeScan(res, scan_type)
      const text = `${ticket.attendee_name}: ${d.title.toLowerCase()}`
      if (d.tone === 'success')
        toast.success(
          scan_type === 'gate_in' ? `${ticket.attendee_name} checked in` : `${ticket.attendee_name} checked out`,
          [res.ticket?.ticket_type_name, res.ticket?.gate_note].filter(Boolean).join(' · ') || undefined,
        )
      else toast.error(`${text}. ${d.detail}`)
      refreshAll()
    },
    onError: (err: Error, { ticket }) => toast.error(`Couldn't update ${ticket.attendee_name}. ${err.message}`),
  })

  const refreshAll = () => {
    void statsQuery.refetch()
    void ticketsQuery.refetch()
    if (canManage) void gatesQuery.refetch()
  }

  if (eventsError) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <ErrorState message={error?.message} onRetry={refetch} />
      </div>
    )
  }

  if (eventsLoading) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    )
  }

  if (!currentEvent) {
    return (
      <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
        <PageHeader title="Gate scanner" />
        <Card>
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" aria-hidden />}
            title="No event to scan for"
            description={
              canManage
                ? 'Create an event first. Its attendees can then be checked in here.'
                : "You haven't been assigned to an event yet. Ask your organizer to add you to a gate."
            }
            action={canManage ? <ButtonLink to="/app/events">Create an event</ButtonLink> : undefined}
          />
        </Card>
      </div>
    )
  }

  const shell = (body: React.ReactNode) => (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader title="Gate scanner" description={`${currentEvent.title}, ${currentEvent.location}`} />
      {body}
    </div>
  )

  if ((isStaff && assignmentQuery.isLoading) || (hasAccess && gatesQuery.isLoading)) {
    return shell(<Skeleton className="h-[520px] rounded-2xl" />)
  }
  if (assignmentQuery.isError || gatesQuery.isError) {
    const err = (assignmentQuery.error || gatesQuery.error) as Error
    return shell(
      <ErrorState
        message={err?.message}
        onRetry={() => {
          void assignmentQuery.refetch()
          void gatesQuery.refetch()
        }}
      />,
    )
  }

  if (isStaff && (!assignment || !assignment.gate)) {
    const other = otherAssignmentQuery.data
    const otherEvent = other && other.event.id !== currentEvent.id ? events.find((e) => e.id === other.event.id) : undefined
    return shell(
      <Card>
        <EmptyState
          icon={<DoorOpen className="h-6 w-6" aria-hidden />}
          title={otherEvent ? "You're not scanning at this event" : 'Ask your organizer to assign you a gate'}
          description={
            otherEvent
              ? `Your organizer assigned you to ${other!.gate_name} at ${otherEvent.title}.`
              : `You need a gate at ${currentEvent.title} before you can scan passes here.`
          }
          action={otherEvent ? <Button onClick={() => setCurrentEventId(otherEvent.id)}>Switch to {otherEvent.title}</Button> : undefined}
        />
      </Card>,
    )
  }

  if (lockedGate && !lockedGate.is_active) {
    return shell(
      <Card>
        <EmptyState
          icon={<DoorOpen className="h-6 w-6" aria-hidden />}
          title={`${lockedGate.name} is closed`}
          description="Your organizer closed this gate. Ask them to reopen it or move you to another gate."
        />
      </Card>,
    )
  }

  if (canManage && openGates.length === 0) {
    return shell(
      <Card>
        <EmptyState
          icon={<DoorOpen className="h-6 w-6" aria-hidden />}
          title="Set up your gates first"
          description={`Add the entrances and exits at ${currentEvent.location} and choose who scans at each one.`}
          action={<ButtonLink to="/app/gates">Set up gates</ButtonLink>}
        />
      </Card>,
    )
  }

  const tickets = ticketsQuery.data ?? []

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Gate scanner"
        description={`${currentEvent.title}, ${currentEvent.location}`}
        actions={
          canManage ? (
            <>
              <ButtonLink to="/app/gates" variant="secondary" size="sm" icon={<Settings2 className="h-4 w-4" aria-hidden />}>
                Manage gates and staff
              </ButtonLink>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download className="h-4 w-4" aria-hidden />}
                onClick={() => window.open(`/api/events/${currentEvent.id}/export-attendees/`, '_blank')}
              >
                Export CSV
              </Button>
            </>
          ) : undefined
        }
      />

      <PhaseNotice event={currentEvent} context="scanner" />

      <LiveCounts stats={statsQuery.data} isLoading={statsQuery.isLoading} isError={statsQuery.isError} onRetry={refreshAll} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <GateScannerComponent
          key={currentEvent.id}
          eventId={currentEvent.id}
          gates={openGates}
          lockedGate={lockedGate}
          onGateChange={setActiveGate}
          onScanComplete={refreshAll}
        />

        <aside className="order-3 space-y-6 lg:order-2">
          <RecentScans stats={statsQuery.data} isLoading={statsQuery.isLoading} />
          {canManage && (
            <Card>
              <CardHeader title="Gates today" description="Successful scans at each open gate." />
              <ul className="divide-y divide-ink-100">
                {openGates.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">
                        {g.name}
                        {g.is_vip && <Badge tone="brand" className="ml-2 align-middle">VIP</Badge>}
                      </p>
                      <p className="text-xs text-ink-500">
                        {(g.staff ?? []).length === 0 ? 'No staff' : `${g.staff!.length} staff`}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs text-ink-600 tabular">
                      {g.scans_in_today} in, {g.scans_out_today} out
                    </p>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-2 border-t border-ink-100 px-5 py-4">
                <ButtonLink to="/app/gates" variant="secondary" size="sm">
                  Manage gates
                </ButtonLink>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Megaphone className="h-4 w-4" aria-hidden />}
                  onClick={() => setShowBroadcastModal(true)}
                >
                  Send alert
                </Button>
              </div>
            </Card>
          )}
        </aside>

        {/* Attendee lookup: right after the scanner on phones */}
        <Card className="order-2 lg:order-3 lg:col-span-2">
          <CardHeader
            title="Find an attendee"
            description="Check someone in by hand or show their pass."
            actions={
              <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" aria-hidden />} onClick={refreshAll}>
                Refresh
              </Button>
            }
          />
          <div className="border-b border-ink-100 px-5 py-4">
            <div className="relative">
              <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-ink-400" aria-hidden />
              <Input
                label="Search by name, email or ticket number"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-9"
              />
            </div>
          </div>

          {ticketsQuery.isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : ticketsQuery.isError ? (
            <div className="p-5">
              <ErrorState message={(ticketsQuery.error as Error).message} onRetry={() => void ticketsQuery.refetch()} />
            </div>
          ) : tickets.length === 0 ? (
            <EmptyState
              icon={<Users className="h-6 w-6" aria-hidden />}
              title={debouncedSearch ? `No one matches "${debouncedSearch}"` : 'No attendees yet'}
              description={
                debouncedSearch
                  ? 'Check the spelling, or search by ticket number instead.'
                  : `People who register at /e/${currentEvent.slug} show up here.`
              }
              action={
                debouncedSearch ? (
                  <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {tickets.slice(0, 50).map((t) => {
                const st = ticketStatus[t.status] ?? {
                  label: t.status,
                  tone: 'neutral' as const,
                }
                const inside = t.status === 'checked_in'
                const pending = manualScan.isPending && manualScan.variables?.ticket.id === t.id
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-ink-900">{t.attendee_name}</span>
                        {t.ticket_type_name && <Badge tone="brand">{t.ticket_type_name}</Badge>}
                        {Boolean(t.guest_number) && <Badge>Guest</Badge>}
                      </p>
                      <p className="truncate text-xs text-ink-500">
                        {t.ticket_number && <span className="font-mono">{t.ticket_number}</span>}
                        <span className={cn(t.ticket_number && 'hidden sm:inline')}>
                          {t.ticket_number ? ', ' : ''}
                          {t.attendee_email}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                      {t.first_check_in && (
                        <span className="hidden text-xs text-ink-500 md:inline">First in {fmtTime(t.first_check_in)}</span>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {t.status !== 'cancelled' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={pending}
                          disabled={manualScan.isPending}
                          icon={
                            inside ? (
                              <LogOut className="h-4 w-4 text-marigold-600" aria-hidden />
                            ) : (
                              <LogIn className="h-4 w-4 text-emerald-600" aria-hidden />
                            )
                          }
                          onClick={() =>
                            manualScan.mutate({
                              ticket: t,
                              scan_type: inside ? 'gate_out' : 'gate_in',
                            })
                          }
                        >
                          {inside ? 'Check out' : 'Check in'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<TicketIcon className="h-4 w-4" aria-hidden />}
                        onClick={() => setSelectedTicket(t)}
                      >
                        Pass
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {tickets.length > 50 && (
            <p className="border-t border-ink-100 px-5 py-3 text-sm text-ink-500">
              Showing the first 50 of {tickets.length}. Search to narrow it down.
            </p>
          )}
        </Card>
      </div>

      {selectedTicket && (
        <TicketPassModal
          ticket={selectedTicket}
          eventTitle={currentEvent.title}
          eventLocation={currentEvent.location}
          eventDate={passDate(currentEvent.start_date, currentEvent.start_time)}
          onClose={() => setSelectedTicket(null)}
        />
      )}

      {canManage && (
        <>
          <BroadcastModal
            open={showBroadcastModal}
            eventId={currentEvent.id}
            eventTitle={currentEvent.title}
            onClose={() => setShowBroadcastModal(false)}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const LiveCounts: React.FC<{
  stats?: GateStats
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}> = ({ stats, isLoading, isError, onRetry }) => {
  if (isError && !stats) return <ErrorState message="Live counts aren't updating." onRetry={onRetry} />
  if (isLoading || !stats) return <Skeleton className="h-[104px] rounded-2xl" />

  const inside = stats.currently_inside ?? 0
  const cap = stats.capacity ?? 0
  const pct = cap > 0 ? Math.min(100, Math.round((inside / cap) * 100)) : 0
  return (
    <Card className="p-4 sm:p-5" aria-live="polite">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-sm font-medium text-ink-500">Inside now</p>
          <p className="font-display text-4xl font-bold leading-none text-ink-900 tabular">
            {inside}
            <span className="text-xl font-medium text-ink-400"> / {cap > 0 ? cap : 'no limit'}</span>
          </p>
        </div>
        <dl className="flex gap-6 text-right sm:gap-8">
          <div>
            <dt className="text-sm text-ink-500">Registered</dt>
            <dd className="text-xl font-bold text-ink-900 tabular">{stats.total_registered}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-500">Left</dt>
            <dd className="text-xl font-bold text-ink-900 tabular">{stats.total_checked_out}</dd>
          </div>
        </dl>
      </div>
      {cap > 0 && (
        <div className="mt-3">
          <div
            className="h-2 overflow-hidden rounded-full bg-ink-100"
            role="meter"
            aria-label="Venue capacity used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className={cn('h-full rounded-full', pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-marigold-500' : 'bg-emerald-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            {pct}% of capacity{pct >= 90 ? ', nearly full' : ''}
          </p>
        </div>
      )}
    </Card>
  )
}

const RecentScans: React.FC<{ stats?: GateStats; isLoading: boolean }> = ({ stats, isLoading }) => {
  const scans = stats?.recent_scans?.slice(0, 6) ?? []
  return (
    <Card>
      <CardHeader title="Recent scans" />
      {isLoading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : scans.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-500">No scans yet. Scans from every gate show up here.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {scans.map((s) => {
            const ok = s.result === 'success'
            const label = ok
              ? s.scan_type === 'gate_in'
                ? 'In'
                : 'Out'
              : s.result === 'duplicate'
                ? 'Duplicate'
                : s.result === 'not_in'
                  ? 'Not inside'
                  : 'Denied'
            const tone = ok ? (s.scan_type === 'gate_in' ? 'success' : 'warning') : s.result === 'not_in' ? 'warning' : 'danger'
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{s.attendee_name}</p>
                  <p className="truncate text-xs text-ink-500">
                    {s.gate_name}, {fmtTime(s.scanned_at)}
                  </p>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const BroadcastModal: React.FC<{
  open: boolean
  eventId: string
  eventTitle: string
  onClose: () => void
}> = ({ open, eventId, eventTitle, onClose }) => {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setSending(true)
    try {
      const res = await request<{ receivers_notified?: number }>(`/events/${eventId}/broadcast/`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim() || `Alert: ${eventTitle}`,
          message: body.trim(),
        }),
      })
      const n = res.receivers_notified
      toast.success(typeof n === 'number' ? `Alert sent to ${n} staff ${n === 1 ? 'device' : 'devices'}` : 'Alert sent')
      setTitle('')
      setBody('')
      onClose()
    } catch (err) {
      toast.error(`Couldn't send the alert. ${err instanceof Error ? err.message : ''}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send an alert to gate staff"
      description="Sends a push notification to everyone assigned to this event's gates."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="broadcast-form" loading={sending} icon={<Send className="h-4 w-4" aria-hidden />}>
            Send alert
          </Button>
        </>
      }
    >
      <form id="broadcast-form" onSubmit={submit} className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Alert: ${eventTitle}`} />
        <Textarea
          label="Message"
          required
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Gate 1 is crowded. Send new arrivals to the North entrance."
        />
      </form>
    </Modal>
  )
}
