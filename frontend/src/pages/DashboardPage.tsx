import React, { useMemo, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, Line } from 'react-chartjs-2'
import type { ChartOptions } from 'chart.js'
import {
  Users,
  DoorOpen,
  ScanLine,
  Download,
  Ticket as TicketIcon,
  Search,
  Link2,
  CalendarDays,
  MapPin,
  UserCheck,
  Wallet,
  ListChecks,
  ArrowRight,
  Circle,
  CheckCircle2,
  Copy,
  QrCode,
  Armchair,
  FileText,
  Send,
  UserCog,
} from 'lucide-react'
import { api, request, tokenStore, type Event, type Ticket, type EventTask } from '@/services/api'
import { eventPhase, startsInText } from '@/lib/phase'
import { useAuth } from '@/lib/auth'
import { useCurrentEvent } from '@/lib/event-context'
import { TicketPassModal } from '@/components/TicketPassModal'
import { RegistrationQrModal } from '@/components/RegistrationQrModal'
import { AnswerValue, ApplicationsCard, type Answer } from '@/components/ApplicationsCard'
import { ArrivalsCard, GuestEditModal, MessageGuestsModal, type GuestTicket } from '@/components/GuestTools'
import { SeatsModal } from '@/components/SeatsModal'
import { useModuleEnabled } from '@/lib/modules'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, Modal, Skeleton, useToast } from '@/components/ui'
import { chartColors, fmtNpr, lineOptions } from '@/pages/analytics/charts'
import { ChartCard, Legend } from '@/pages/analytics/shared'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Helpers                                                              */

const ticketStatus: Record<Ticket['status'], { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  valid: { label: 'Not arrived', tone: 'neutral' },
  checked_in: { label: 'Inside', tone: 'success' },
  checked_out: { label: 'Left', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  reserved: { label: 'Awaiting payment', tone: 'warning' },
}

type StatusFilter = 'all' | Ticket['status']

const fmtTime = (iso: string, seconds = false) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** "Starts in 3 days", "Happening now", "Ended 2 days ago" */
/** Phase badge for the header, from the server's phase (dates as a fallback). */
function eventTiming(e: Event) {
  const phase = eventPhase(e)
  if (phase === 'live') return { label: 'Happening now', tone: 'success' as const }
  if (phase === 'upcoming') return { label: startsInText(e), tone: 'brand' as const }
  if (phase === 'cancelled') return { label: 'Cancelled', tone: 'danger' as const }
  if (phase === 'draft') return { label: 'Draft', tone: 'neutral' as const }
  const end = new Date(`${e.end_date || e.start_date}T23:59`)
  const ago = Math.floor((Date.now() - end.getTime()) / 86_400_000)
  return { label: ago < 1 ? 'Ended today' : `Ended ${ago} day${ago === 1 ? '' : 's'} ago`, tone: 'neutral' as const }
}

const sparkOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  elements: { point: { radius: 0 }, line: { borderWidth: 2, cubicInterpolationMode: 'monotone' } },
  scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
}

const trafficOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: chartColors.ink900, padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true },
  },
  scales: {
    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: chartColors.grid }, border: { display: false } },
    x: { grid: { display: false }, border: { color: chartColors.grid } },
  },
}

/* ------------------------------------------------------------------ */

export const DashboardPage: React.FC = () => {
  const [qrOpen, setQrOpen] = useState(false)
  const toast = useToast()
  const { user } = useAuth()
  const { currentEvent, isLoading: eventsLoading, isError: eventsError, error, refetch } = useCurrentEvent()
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const isOrganizer = user?.role === 'organizer' || user?.role === 'superadmin'
  const formOnly = currentEvent?.registration_mode === 'form'
  const guestsOn = useModuleEnabled('guest_management')

  const eventId = currentEvent?.id
  const { data: gateStats } = useQuery({
    queryKey: ['gateStats', eventId],
    queryFn: () => api.getGateStats(eventId!),
    enabled: Boolean(eventId),
    refetchInterval: 5000,
  })
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', eventId],
    queryFn: () => api.getEventAnalytics(eventId!),
    enabled: Boolean(eventId) && isOrganizer,
    refetchInterval: 30000,
  })
  const { data: tasks = [] } = useQuery({
    queryKey: ['eventTasks', eventId],
    queryFn: () => api.getEventTasks(eventId!),
    enabled: Boolean(eventId) && isOrganizer,
  })
  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets', eventId],
    queryFn: () => api.getEventTickets(eventId!),
    enabled: Boolean(eventId),
    refetchInterval: 10000,
  })

  if (eventsError) {
    return (
      <Page>
        <ErrorState message={error?.message} onRetry={refetch} />
      </Page>
    )
  }

  if (eventsLoading) {
    return (
      <Page>
        <Skeleton className="h-14 w-96 max-w-full" />
        <Skeleton className="h-32 rounded-2xl" />
        <div className="grid gap-6 xl:grid-cols-12">
          <Skeleton className="h-80 rounded-2xl xl:col-span-8" />
          <Skeleton className="h-80 rounded-2xl xl:col-span-4" />
        </div>
      </Page>
    )
  }

  if (!currentEvent) {
    return (
      <Page>
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Create your first event"
            description="Add the date, venue and capacity. You'll get a registration link to share right away."
            action={<ButtonLink to="/app/events/new">Create an event</ButtonLink>}
          />
        </Card>
      </Page>
    )
  }

  const att = analytics?.attendance
  const registered = gateStats?.total_registered ?? att?.total_registered ?? currentEvent.registered_count
  const inside = gateStats?.currently_inside ?? att?.currently_inside ?? currentEvent.checked_in_count
  const left = gateStats?.total_checked_out ?? att?.checked_out ?? 0
  const checkedIn = att?.checked_in ?? inside + left
  const notArrived = tickets.length ? tickets.filter((t) => t.status === 'valid').length : Math.max(registered - checkedIn, 0)
  const capacity = currentEvent.capacity
  const timing = eventTiming(currentEvent)
  const publicUrl = `${window.location.origin}/e/${currentEvent.slug}`
  const name = user?.organization_name || user?.username || ''

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast.success('Registration link copied', publicUrl)
    } catch {
      toast.error('Couldn’t copy the link', publicUrl)
    }
  }

  const growth = analytics?.registration_growth_chart
  const regToday = growth?.counts.at(-1) ?? 0

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {name && (
            <p className="text-sm text-ink-500">
              {greeting()}, {name}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-bold text-ink-900 sm:text-[30px] sm:leading-tight">{currentEvent.title}</h1>
            <Badge tone={timing.tone} dot>
              {timing.label}
            </Badge>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-ink-400" aria-hidden />
              {formatDate(new Date(currentEvent.start_date), 'weekday')}
              {currentEvent.start_time && `, ${currentEvent.start_time.slice(0, 5)}`}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              <span className="truncate">{currentEvent.location}</span>
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={copyLink}>
            Copy registration link
          </Button>
          <Button variant="secondary" icon={<QrCode className="h-4 w-4" />} onClick={() => setQrOpen(true)}>
            Registration QR
          </Button>
          <RegistrationQrModal open={qrOpen} onClose={() => setQrOpen(false)} url={publicUrl} title={currentEvent.title} />
          <ButtonLink to="/app/scanner" icon={<ScanLine className="h-4 w-4" />}>
            Open gate scanner
          </ButtonLink>
        </div>
      </div>

      {/* KPI band (registration-only events have no check-in, so no arrival figures) */}
      <Card className="grid grid-cols-2 divide-ink-100 overflow-hidden md:grid-cols-3 xl:grid-cols-5 xl:divide-x [&>*]:border-ink-100 max-xl:[&>*]:border-b max-md:[&>*:last-child:nth-child(odd)]:col-span-2">
        <Kpi
          icon={<Users className="h-4 w-4" />}
          tone="brand"
          label="Registered"
          value={registered}
          sub={
            regToday > 0 ? (
              <span className="font-semibold text-emerald-700">+{regToday} latest day</span>
            ) : capacity ? (
              `${Math.max(capacity - registered, 0)} spots left`
            ) : (
              'No capacity limit'
            )
          }
          spark={growth && growth.counts.length > 1 ? cumulative(growth.counts) : undefined}
        />
        {!formOnly && (
        <Kpi
          icon={<UserCheck className="h-4 w-4" />}
          tone="success"
          label="Check-in rate"
          value={`${att ? Math.round(att.checkin_rate_pct) : pct(checkedIn, registered)}%`}
          sub={`${checkedIn} of ${registered} arrived`}
          meter={{ value: att ? att.checkin_rate_pct : pct(checkedIn, registered), color: 'bg-emerald-500' }}
        />
        )}
        {!formOnly && (
        <Kpi
          icon={<DoorOpen className="h-4 w-4" />}
          tone="success"
          label="Inside now"
          value={inside}
          sub={capacity ? `${pct(inside, capacity)}% of ${capacity} capacity` : `${left} have left`}
          meter={capacity ? { value: pct(inside, capacity), color: pct(inside, capacity) >= 90 ? 'bg-red-500' : 'bg-emerald-500' } : undefined}
          live
        />
        )}
        {isOrganizer && (
          <Kpi
            icon={<Wallet className="h-4 w-4" />}
            tone="warning"
            label="Budget balance"
            value={analytics ? compactMoney(analytics.funding.net_balance) : '–'}
            sub={
              analytics?.funding.target_budget
                ? `${pct(analytics.funding.total_funding, analytics.funding.target_budget)}% of ${compactMoney(analytics.funding.target_budget)} raised`
                : 'Set a budget in Analytics'
            }
            href="/app/analytics?tab=budget"
          />
        )}
        {isOrganizer && (
          <Kpi
            icon={<ListChecks className="h-4 w-4" />}
            tone="neutral"
            label="Open crew tasks"
            value={tasks.filter((t) => t.status !== 'completed').length}
            sub={
              tasks.some((t) => t.priority === 'urgent' && t.status !== 'completed') ? (
                <span className="font-semibold text-red-700">{tasks.filter((t) => t.priority === 'urgent' && t.status !== 'completed').length} urgent</span>
              ) : (
                `${tasks.filter((t) => t.status === 'completed').length} of ${tasks.length} done`
              )
            }
            href="/app/tasks"
          />
        )}
      </Card>

      {/* Trend + attendance breakdown */}
      {isOrganizer && (
        <div className="grid gap-6 xl:grid-cols-12">
          <ChartCard
            className="xl:col-span-8"
            title="Registrations"
            description="Total sign-ups over time"
            height="h-72"
            summary={growth ? growth.labels.map((l, i) => `${l}: ${growth.counts[i]} new`).join('; ') : 'Loading'}
            actions={
              <Link to="/app/analytics" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                Full analytics <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
            empty={
              analyticsLoading ? (
                <div className="p-5">
                  <Skeleton className="h-72" />
                </div>
              ) : registered === 0 ? (
                <EmptyState
                  icon={<Users className="h-6 w-6" />}
                  title="No registrations yet"
                  description="Share your registration link. Sign-ups appear here day by day."
                  action={<Button variant="secondary" size="sm" icon={<Link2 className="h-4 w-4" />} onClick={copyLink}>Copy registration link</Button>}
                />
              ) : undefined
            }
          >
            {growth && (
              <Line
                options={{
                  ...lineOptions,
                  plugins: {
                    ...lineOptions.plugins,
                    tooltip: {
                      ...(lineOptions.plugins?.tooltip as object),
                      callbacks: {
                        label: (ctx) => ` ${ctx.parsed.y} registered (${growth.counts[ctx.dataIndex]} new that day)`,
                      },
                    },
                  },
                }}
                data={{
                  labels: growth.labels,
                  datasets: [
                    {
                      label: 'Registered',
                      data: cumulative(growth.counts),
                      borderColor: chartColors.brand,
                      backgroundColor: 'rgba(194, 33, 90, 0.08)',
                      fill: 'origin',
                      pointBackgroundColor: chartColors.brand,
                    },
                  ],
                }}
              />
            )}
          </ChartCard>

          {!formOnly && (
          <Card className="xl:col-span-4">
            <CardHeader title="Attendance breakdown" description="Where every registration stands" />
            <div className="space-y-4 p-5">
              <FunnelRow label="Registered" value={registered} of={registered} color="bg-brand-600" />
              <FunnelRow label="Checked in at least once" value={checkedIn} of={registered} color="bg-emerald-600" />
              <FunnelRow label="Inside now" value={inside} of={registered} color="bg-emerald-400" />
              <FunnelRow label="Left the venue" value={left} of={registered} color="bg-marigold-500" />
              <FunnelRow label="Not arrived yet" value={notArrived} of={registered} color="bg-ink-300" />
              {analytics && (
                <div className="flex items-center gap-4 border-t border-ink-100 pt-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-ink-700">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                    {analytics.scan_audit.success ?? 0} accepted scans
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-ink-700">
                    <Copy className="h-4 w-4 text-marigold-600" aria-hidden />
                    {analytics.scan_audit.duplicate ?? 0} duplicates stopped
                  </span>
                </div>
              )}
            </div>
          </Card>
          )}
        </div>
      )}

      {/* Gate traffic + gates + budget */}
      {isOrganizer && analytics && (
        <div className="grid gap-6 xl:grid-cols-12">
          <ChartCard
            className="xl:col-span-5"
            title="Gate traffic"
            description="Scans per hour"
            height="h-64"
            summary={analytics.velocity_chart.labels.map((l, i) => `${l}: ${analytics.velocity_chart.gate_in[i]} in, ${analytics.velocity_chart.gate_out[i]} out`).join('; ')}
            actions={
              <Legend
                items={[
                  { label: 'In', color: chartColors.emerald },
                  { label: 'Out', color: chartColors.marigold },
                ]}
              />
            }
            empty={checkedIn === 0 ? <EmptyState icon={<ScanLine className="h-6 w-6" />} title="No gate scans yet" description="Traffic appears here once your crew starts scanning." /> : undefined}
          >
            <Bar
              options={trafficOptions}
              data={{
                labels: analytics.velocity_chart.labels,
                datasets: [
                  { label: 'In', data: analytics.velocity_chart.gate_in, backgroundColor: chartColors.emerald, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
                  { label: 'Out', data: analytics.velocity_chart.gate_out, backgroundColor: chartColors.marigold, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22 },
                ],
              }}
            />
          </ChartCard>

          <Card className="xl:col-span-3">
            <CardHeader title="Entries by gate" />
            {checkedIn === 0 ? (
              <EmptyState title="No entries yet" description="Each gate's share appears after the first scans." />
            ) : (
              <ul className="space-y-3.5 p-5">
                {analytics.gate_distribution_chart.labels.map((g, i) => {
                  const count = analytics.gate_distribution_chart.counts[i] ?? 0
                  const max = Math.max(...analytics.gate_distribution_chart.counts, 1)
                  return (
                    <li key={g}>
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="truncate text-ink-700">{g}</span>
                        <span className="font-semibold tabular text-ink-900">{count}</span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(pct(count, max), 3)}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card className="xl:col-span-4">
            <CardHeader
              title="Budget"
              description="Raised against target"
              actions={
                <Link to="/app/analytics?tab=budget" className="text-sm font-semibold text-brand-700 hover:underline">
                  Edit
                </Link>
              }
            />
            <BudgetSnapshot funding={analytics.funding} />
          </Card>
        </div>
      )}

      {/* Applications stage: participants to review (module `applications`) */}
      {currentEvent.applications_enabled && <ApplicationsCard eventId={currentEvent.id} />}

      {/* Attendees + activity + tasks */}
      <div className="grid gap-6 xl:grid-cols-12">
        <AttendeesCard
          className="xl:col-span-8"
          eventId={currentEvent.id}
          tickets={tickets}
          loading={ticketsLoading}
          formOnly={formOnly}
          hasForm={Boolean(currentEvent.registration_form)}
          canMessage={isOrganizer}
          ticketTypes={(currentEvent.ticket_types ?? []).map((t) => ({ id: t.id, name: t.name }))}
          onOpen={setSelectedTicket}
          onCopyLink={copyLink}
        />

        <div className="space-y-6 xl:col-span-4">
          {guestsOn && <ArrivalsCard eventId={currentEvent.id} />}
          {isOrganizer && <TasksCard tasks={tasks} />}

          <Card className="flex flex-col overflow-hidden">
            <CardHeader
              title="Gate activity"
              description="Updates every few seconds"
              actions={
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
              }
            />
            <div className="max-h-[360px] overflow-y-auto">
              {gateStats?.recent_scans?.length ? (
                <ul className="divide-y divide-ink-100">
                  {gateStats.recent_scans.map((scan) => (
                    <li key={scan.id} className="flex items-start gap-3 px-5 py-3">
                      <span
                        className={cn(
                          'mt-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold',
                          scan.scan_type === 'gate_in' ? 'bg-emerald-50 text-emerald-700' : 'bg-marigold-50 text-marigold-800',
                        )}
                      >
                        {scan.scan_type === 'gate_in' ? 'In' : 'Out'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">{scan.attendee_name}</p>
                        <p className="truncate text-xs text-ink-500">{scan.gate_name}</p>
                      </div>
                      <time className="shrink-0 text-xs tabular text-ink-500" dateTime={scan.scanned_at}>
                        {fmtTime(scan.scanned_at)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<ScanLine className="h-6 w-6" />} title="No scans yet" description="Check-ins and exits appear here as your crew scans passes." />
              )}
            </div>
          </Card>
        </div>
      </div>

      {selectedTicket && (
        <TicketPassModal
          ticket={selectedTicket}
          eventTitle={currentEvent.title}
          eventLocation={currentEvent.location}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </Page>
  )
}

/* ------------------------------------------------------------------ */
/* Pieces                                                               */

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>
)

const cumulative = (counts: number[]) => counts.reduce<number[]>((acc, n) => [...acc, (acc.at(-1) ?? 0) + n], [])

const compactMoney = (n: number) => {
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (abs >= 100000) return `${sign}Rs ${(abs / 100000).toLocaleString(undefined, { maximumFractionDigits: 2 })}L`
  if (abs >= 1000) return `${sign}Rs ${(abs / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  return `${sign}Rs ${abs.toLocaleString()}`
}

const kpiTones = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-marigold-50 text-marigold-700',
  neutral: 'bg-ink-100 text-ink-600',
}

interface KpiProps {
  icon: React.ReactNode
  tone: keyof typeof kpiTones
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  spark?: number[]
  meter?: { value: number; color: string }
  live?: boolean
  href?: string
}

const Kpi: React.FC<KpiProps> = ({ icon, tone, label, value, sub, spark, meter, live, href }) => {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', kpiTones[tone])}>{icon}</span>
        <span className="text-sm font-medium text-ink-600">{label}</span>
        {live && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" title="Live" aria-hidden />}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="font-display text-[28px] font-bold leading-none tabular text-ink-900">{value}</p>
        {spark && (
          <div className="h-9 w-20" aria-hidden>
            <Line options={sparkOptions} data={{ labels: spark.map((_, i) => i), datasets: [{ data: spark, borderColor: chartColors.brand }] }} />
          </div>
        )}
      </div>
      {meter && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
          <div className={cn('h-full rounded-full transition-[width] duration-500', meter.color)} style={{ width: `${Math.max(Math.min(meter.value, 100), 2)}%` }} />
        </div>
      )}
      {sub && <p className="mt-2 text-xs text-ink-500">{sub}</p>}
    </>
  )
  const cls = 'block min-w-0 p-4 sm:p-5'
  return href ? (
    <Link to={href} className={cn(cls, 'transition-colors hover:bg-ink-50')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

const FunnelRow: React.FC<{ label: string; value: number; of: number; color: string }> = ({ label, value, of, color }) => (
  <div>
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-ink-700">{label}</span>
      <span className="tabular">
        <span className="font-semibold text-ink-900">{value}</span>
        <span className="ml-1.5 text-ink-500">{pct(value, of)}%</span>
      </span>
    </div>
    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${value ? Math.max(pct(value, of), 2) : 0}%` }} />
    </div>
  </div>
)

const BudgetSnapshot: React.FC<{ funding: NonNullable<Awaited<ReturnType<typeof api.getEventAnalytics>>>['funding'] }> = ({ funding }) => {
  if (!funding.target_budget && !funding.total_funding && !funding.total_expenses) {
    return <EmptyState icon={<Wallet className="h-6 w-6" />} title="No budget yet" description="Add your target, sponsorships and costs to track the balance." />
  }
  const raisedPct = pct(funding.total_funding, funding.target_budget)
  const top = Object.entries(funding.expenses_breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  return (
    <div className="space-y-4 p-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-2xl font-bold tabular text-ink-900">{fmtNpr(funding.total_funding)}</p>
          <p className="text-sm text-ink-500">of {fmtNpr(funding.target_budget)}</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100" aria-label={`${raisedPct}% of target raised`} role="img">
          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(raisedPct, 100)}%` }} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-ink-50 p-3">
          <dt className="text-ink-500">Spent</dt>
          <dd className="mt-0.5 font-semibold tabular text-ink-900">{fmtNpr(funding.total_expenses)}</dd>
        </div>
        <div className="rounded-xl bg-ink-50 p-3">
          <dt className="text-ink-500">Balance</dt>
          <dd className={cn('mt-0.5 font-semibold tabular', funding.net_balance < 0 ? 'text-red-700' : 'text-emerald-700')}>
            {fmtNpr(funding.net_balance)}
          </dd>
        </div>
      </dl>
      {top.length > 0 && (
        <div>
          <p className="text-xs font-medium text-ink-500">Biggest costs</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {top.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3">
                <span className="truncate text-ink-700">{k}</span>
                <span className="tabular text-ink-900">{fmtNpr(v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const taskStatusMeta: Record<EventTask['status'], { label: string; color: string }> = {
  todo: { label: 'To do', color: 'bg-ink-300' },
  in_progress: { label: 'In progress', color: 'bg-marigold-500' },
  completed: { label: 'Done', color: 'bg-emerald-500' },
}

const priorityTone = { urgent: 'danger', high: 'warning', medium: 'neutral', low: 'neutral' } as const

const TasksCard: React.FC<{ tasks: EventTask[] }> = ({ tasks }) => {
  const open = tasks.filter((t) => t.status !== 'completed')
  const order = { urgent: 0, high: 1, medium: 2, low: 3 }
  const next = [...open].sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 4)
  return (
    <Card>
      <CardHeader
        title="Crew tasks"
        actions={
          <Link to="/app/tasks" className="text-sm font-semibold text-brand-700 hover:underline">
            View board
          </Link>
        }
      />
      {tasks.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-6 w-6" />} title="No tasks yet" description="Assign stage, gate and hospitality jobs to your crew." />
      ) : (
        <div className="p-5">
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={(['todo', 'in_progress', 'completed'] as const).map((s) => `${taskStatusMeta[s].label}: ${tasks.filter((t) => t.status === s).length}`).join(', ')}>
            {(['completed', 'in_progress', 'todo'] as const).map((s) => {
              const n = tasks.filter((t) => t.status === s).length
              return n ? <div key={s} className={taskStatusMeta[s].color} style={{ width: `${pct(n, tasks.length)}%` }} /> : null
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
            {(['completed', 'in_progress', 'todo'] as const).map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', taskStatusMeta[s].color)} aria-hidden />
                {taskStatusMeta[s].label} {tasks.filter((t) => t.status === s).length}
              </li>
            ))}
          </ul>
          {next.length > 0 && (
            <ul className="mt-4 divide-y divide-ink-100 border-t border-ink-100">
              {next.map((t) => (
                <li key={t.id} className="flex items-start gap-3 py-3">
                  <Circle className={cn('mt-0.5 h-4 w-4 shrink-0', t.status === 'in_progress' ? 'text-marigold-500' : 'text-ink-300')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{t.title}</p>
                    <p className="truncate text-xs text-ink-500">{t.assigned_name || 'Unassigned'}</p>
                  </div>
                  {(t.priority === 'urgent' || t.priority === 'high') && (
                    <Badge tone={priorityTone[t.priority]}>{t.priority === 'urgent' ? 'Urgent' : 'High'}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}

const filters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'checked_in', label: 'Inside' },
  { key: 'valid', label: 'Not arrived' },
  { key: 'checked_out', label: 'Left' },
]

const AttendeesCard: React.FC<{
  className?: string
  eventId: string
  tickets: Ticket[]
  loading: boolean
  /** Registration-only event: no passes or check-in, so no pass column or arrival statuses */
  formOnly?: boolean
  /** The event has a registration form: each attendee's answers can be opened */
  hasForm?: boolean
  /** Organizer (not gate staff): may message guests */
  canMessage?: boolean
  ticketTypes?: { id: string; name: string }[]
  onOpen: (t: Ticket) => void
  onCopyLink: () => void
}> = ({ className, eventId, tickets, loading, formOnly, hasForm, canMessage, ticketTypes = [], onOpen, onCopyLink }) => {
  const guestsOn = useModuleEnabled('guest_management')
  const [editing, setEditing] = useState<GuestTicket | null>(null)
  const [messaging, setMessaging] = useState(false)
  const allTags = useMemo(() => [...new Set((tickets as GuestTicket[]).flatMap((t) => t.guest_tags ?? []))], [tickets])
  // Registration form answers per ticket (only the buyer's ticket carries them)
  const { data: responses = [] } = useQuery({
    queryKey: ['registration-answers', eventId],
    queryFn: () => request<{ ticket: string | null; answers: Answer[] }[]>(`/forms/events/${eventId}/submissions/`),
    enabled: Boolean(hasForm),
  })
  const answersByTicket = useMemo(() => new Map(responses.filter((r) => r.ticket).map((r) => [r.ticket!, r.answers])), [responses])
  const [answersOf, setAnswersOf] = useState<Ticket | null>(null)
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [exporting, setExporting] = useState(false)
  const [seatsOpen, setSeatsOpen] = useState(false)
  const seatsOn = useModuleEnabled('seat_numbers')
  const hasSeats = seatsOn && tickets.some((t) => t.seat_number)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter(
      (t) =>
        (status === 'all' || t.status === status) &&
        (!q || t.attendee_name.toLowerCase().includes(q) || t.attendee_email.toLowerCase().includes(q) || t.ticket_number.toLowerCase().includes(q)),
    )
  }, [tickets, search, status])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const token = tokenStore.access
      const res = await fetch(`/api/events/${eventId}/export-attendees/`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'attendees.csv'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Attendee list downloaded')
    } catch (e) {
      toast.error('Couldn’t export attendees', (e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader
        title={formOnly ? 'Registrations' : 'Attendees'}
        description={formOnly ? `${tickets.length} registered.` : `${tickets.length} registered. Open a pass to view or print it.`}
        actions={
          <div className="flex gap-2">
            {seatsOn && tickets.length > 0 && (
              <Button variant="secondary" size="sm" icon={<Armchair className="h-4 w-4" />} onClick={() => setSeatsOpen(true)}>
                Seats
              </Button>
            )}
            {guestsOn && canMessage && tickets.length > 0 && (
              <Button variant="secondary" size="sm" icon={<Send className="h-4 w-4" />} onClick={() => setMessaging(true)}>
                Message guests
              </Button>
            )}
            <Button variant="secondary" size="sm" loading={exporting} icon={<Download className="h-4 w-4" />} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        }
      />
      {seatsOpen && <SeatsModal open onClose={() => setSeatsOpen(false)} eventId={eventId} tickets={tickets} />}
      {tickets.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-3 md:flex-row md:items-center md:justify-between">
          {!formOnly && (
          <div role="radiogroup" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {filters.map((f) => {
              const count = f.key === 'all' ? tickets.length : tickets.filter((t) => t.status === f.key).length
              return (
                <button
                  key={f.key}
                  role="radio"
                  aria-checked={status === f.key}
                  onClick={() => setStatus(f.key)}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                    status === f.key ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100',
                  )}
                >
                  {f.label}
                  <span className={cn('rounded-md px-1.5 text-xs tabular', status === f.key ? 'bg-white/15' : 'bg-ink-100 text-ink-600')}>{count}</span>
                </button>
              )
            })}
          </div>
          )}
          <label className="relative block md:w-72">
            <span className="sr-only">Search attendees</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={formOnly ? 'Name, email or registration no.' : 'Name, email or ticket'}
              className="h-9 w-full rounded-[10px] border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </label>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={<TicketIcon className="h-6 w-6" />}
          title="No one has registered yet"
          description={formOnly ? 'Share the registration link. Each person who registers shows up here.' : 'Share the registration link. Each person who signs up gets a QR pass straight away and shows up here.'}
          action={<Button variant="secondary" icon={<Link2 className="h-4 w-4" />} onClick={onCopyLink}>Copy registration link</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No attendees match" description="Try another status or a shorter search." />
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-ink-50 text-xs text-ink-500">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Attendee</th>
                <th scope="col" className="hidden px-4 py-2.5 font-medium 2xl:table-cell">{formOnly ? 'Registration no.' : 'Ticket'}</th>
                {hasSeats && <th scope="col" className="px-4 py-2.5 font-medium">Seat</th>}
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                {!formOnly && <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 font-medium sm:table-cell">First in</th>}
                <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Registered</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">
                  <span className="sr-only">Answers</span>
                </th>
                {!formOnly && (
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    <span className="sr-only">Pass</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((t) => {
                const s = formOnly && t.status !== 'cancelled' ? { label: 'Registered', tone: 'success' as const } : ticketStatus[t.status]
                return (
                  <tr key={t.id} className="hover:bg-ink-50/70">
                    <td className="max-w-[280px] px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 sm:flex" aria-hidden>
                          {t.attendee_name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')
                            .toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-900">{t.attendee_name}</p>
                          <p className="truncate text-xs text-ink-500">
                            {t.guest_number ? <span className="font-medium text-ink-700">Guest of </span> : null}
                            {t.attendee_email}
                            {t.attendee_phone && ` · ${t.attendee_phone}`}
                          </p>
                          {guestsOn && ((t as GuestTicket).guest_tags?.length || (t as GuestTicket).host_note) ? (
                            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-600">
                              {(t as GuestTicket).guest_tags?.map((g) => (
                                <Badge key={g} tone="warning">
                                  {g}
                                </Badge>
                              ))}
                              {(t as GuestTicket).host_note && <span className="truncate">{(t as GuestTicket).host_note}</span>}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-600 2xl:table-cell">
                      {t.ticket_number}
                      {t.bib_number ? <span className="ml-2 font-sans font-semibold text-ink-900">Bib {t.bib_number}</span> : null}
                    </td>
                    {hasSeats && <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink-800">{t.seat_number || '–'}</td>}
                    <td className="px-4 py-3">
                      <Badge tone={s.tone} dot>
                        {s.label}
                      </Badge>
                    </td>
                    {!formOnly && <td className="hidden whitespace-nowrap px-4 py-3 tabular text-ink-600 sm:table-cell">{t.first_check_in ? fmtTime(t.first_check_in) : '–'}</td>}
                    <td className="hidden whitespace-nowrap px-4 py-3 tabular text-ink-600 md:table-cell">
                      {formatDate(new Date(t.created_at), 'short')}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-right">
                      {guestsOn && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(t as GuestTicket)} aria-label={`Tags and note for ${t.attendee_name}`}>
                          <UserCog className="h-4 w-4 text-ink-500" aria-hidden />
                          <span className="hidden xl:inline">Guest</span>
                        </Button>
                      )}
                      {answersByTicket.get(t.id) && (
                        <Button variant="ghost" size="sm" onClick={() => setAnswersOf(t)} aria-label={`Form answers from ${t.attendee_name}`}>
                          <FileText className="h-4 w-4 text-ink-500" aria-hidden />
                          <span className="hidden sm:inline">Answers</span>
                        </Button>
                      )}
                    </td>
                    {!formOnly && (
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => onOpen(t)} aria-label={`View pass for ${t.attendee_name}`}>
                          <TicketIcon className="h-4 w-4 text-brand-600" aria-hidden />
                          <span className="hidden sm:inline">View pass</span>
                        </Button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GuestEditModal eventId={eventId} ticket={editing} onClose={() => setEditing(null)} />}
      {messaging && <MessageGuestsModal eventId={eventId} tags={allTags} ticketTypes={ticketTypes} onClose={() => setMessaging(false)} />}
      {answersOf && (
        <Modal open onClose={() => setAnswersOf(null)} size="lg" title={answersOf.attendee_name} description={`${answersOf.attendee_email} · ${answersOf.ticket_number}`}>
          <dl className="divide-y divide-ink-100 rounded-xl border border-ink-200">
            {(answersByTicket.get(answersOf.id) ?? []).map((a) => (
              <div key={a.id} className="grid gap-1 p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <dt className="text-sm text-ink-500">{a.field_label}</dt>
                <dd className="text-sm text-ink-900">
                  <AnswerValue value={a.value} />
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </Card>
  )
}

