/** "Event controls": one place to see and switch what is open on an event: the event itself (published or not),
 *  applications, voting (contests) and tickets / registration. Uses the existing endpoints: event PATCH and the
 *  contest status / update endpoints (the contest dashboard keeps its own Open / Close button too). */
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, ClipboardList, Plus, Ticket, Vote } from 'lucide-react'
import { api, type Event } from '@/services/api'
import { Button, ButtonLink, Card, CardHeader, Input, Modal, useToast } from '@/components/ui'
import { useModuleEnabled } from '@/lib/modules'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { confirmPublish } from '@/lib/publish-check'
import { useNavigate } from 'react-router-dom'
import { contestApi, type Contest } from '@/pages/voting/contest/api'

type Tone = 'open' | 'soon' | 'off' | 'closed'
const pill: Record<Tone, string> = {
  open: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  soon: 'bg-sky-50 text-sky-700 ring-sky-200',
  off: 'bg-ink-50 text-ink-600 ring-ink-200',
  closed: 'bg-ink-100 text-ink-700 ring-ink-200',
}
const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1', pill[tone])}>
    <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'open' ? 'bg-emerald-500' : tone === 'soon' ? 'bg-sky-500' : 'bg-ink-400')} aria-hidden />
    {children}
  </span>
)

const fmt = (iso?: string | null) => (iso ? formatDateTime(iso, 'short') : '')
const toLocal = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

export const EventControls: React.FC<{ event: Event; className?: string }> = ({ event, className }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const contestsOn = useModuleEnabled('contests')
  const applicationsOn = useModuleEnabled('applications')
  const scheduleOn = useModuleEnabled('stage_schedule')
  const [dates, setDates] = useState<null | { kind: 'applications' | 'tickets' | 'opens' } | { kind: 'contest'; contest: Contest }>(null)

  const { data: contests = [] } = useQuery({
    queryKey: ['contests', event.id],
    queryFn: () => contestApi.list(event.id),
    enabled: contestsOn,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['events'] })
    qc.invalidateQueries({ queryKey: ['event', event.id] })
    qc.invalidateQueries({ queryKey: ['contests'] })
    qc.invalidateQueries({ queryKey: ['contest'] })
  }
  const patch = useMutation({
    mutationFn: (body: Partial<Event>) => api.updateEvent(event.id, body),
    onSuccess: () => { refresh(); toast.success('Saved') },
    onError: (e) => toast.error('Couldn’t save', errMsg(e)),
  })
  const contestStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'open' | 'close' }) => contestApi.setStatus(id, action),
    onSuccess: (c) => { refresh(); toast.success(c.status === 'open' ? 'Voting is open' : 'Voting closed') },
    onError: (e) => toast.error('Couldn’t change voting', errMsg(e)),
  })
  const contestUpdate = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Contest> }) => contestApi.update(id, body),
    onSuccess: () => { refresh(); toast.success('Voting scheduled') },
    onError: (e) => toast.error('Couldn’t schedule voting', errMsg(e)),
  })
  const busy = patch.isPending || contestStatus.isPending || contestUpdate.isPending

  const now = Date.now()
  const published = event.status !== 'draft'
  const over = event.status === 'completed' || event.status === 'cancelled'
  const formOnly = event.registration_mode === 'form'
  const ticketWord = formOnly ? 'Registration' : 'Tickets'

  // Applications
  const appsClose = event.applications_close ? new Date(event.applications_close).getTime() : null
  // The server's own reason (what visitors see) decides; dates alone could say "open" when it isn't
  const appsNoForm = Boolean(event.applications_enabled) && !event.application_form
  const appsReason = event.applications_closed_reason ?? null
  const appsOpen = Boolean(event.applications_enabled) && !appsReason
  // Tickets / registration
  const deadline = event.registration_deadline ? new Date(event.registration_deadline).getTime() : null
  const ticketsOn = event.tickets_enabled !== false
  const salesReason = event.registration_closed_reason ?? null
  const salesOpen = ticketsOn && !salesReason
  // Registration set to open by itself (module stage_schedule); "linked" = it opens the moment applications close
  const opensAt = scheduleOn && event.registration_opens ? new Date(event.registration_opens).getTime() : null
  const scheduled = opensAt !== null && opensAt > now
  const linked = scheduled && appsClose !== null && Math.abs(opensAt! - appsClose) < 60_000

  const warnings: string[] = []
  if (!published && (appsOpen || salesOpen || contests.some((c) => c.status === 'open'))) {
    warnings.push('The event is still a draft, so the public can’t see anything that’s open. Publish it to go live.')
  }
  if (appsNoForm) warnings.push('Applications can’t open yet: this event has no application form. Add one in Dynamic forms.')
  contests.filter((c) => c.status === 'open' && !c.stats?.contestants).forEach((c) => warnings.push(`“${c.title}” is open for voting but has no contestants.`))

  const canAddApps = applicationsOn && !event.applications_enabled
  // Voting belongs to pageants only; ticketing and registration events never get it
  const canAddVoting = contestsOn && contests.length === 0 && event.event_kind === 'pageant'
  const canAddTickets = !ticketsOn && !scheduled

  return (
    <Card className={className}>
      <CardHeader
        title="Event controls"
        description="Open or close each part of your event from here."
        actions={
          <div className="flex items-center gap-2">
            <Pill tone={published ? (over ? 'closed' : 'open') : 'off'}>
              {event.status === 'draft' ? 'Draft' : event.status === 'ongoing' ? 'Happening now' : event.status === 'completed' ? 'Completed' : event.status === 'cancelled' ? 'Cancelled' : 'Published'}
            </Pill>
            {!over && (
              <Button size="sm" variant={published ? 'secondary' : 'primary'} disabled={busy}
                onClick={async () => {
                  if (published && !(await toast.confirm({ title: 'Unpublish this event?', description: 'Its page goes offline and nobody can sign up, apply or vote until you publish it again.', confirmLabel: 'Unpublish', danger: true }))) return
                  if (!published && !(await confirmPublish(event, toast.confirm, () => navigate(`/app/events/${event.id}/edit?step=basics`)))) return
                  patch.mutate({ status: published ? 'draft' : 'published' })
                }}>
                {published ? 'Unpublish' : 'Publish'}
              </Button>
            )}
          </div>
        }
      />
      <ul className="divide-y divide-ink-100">
        {applicationsOn && event.applications_enabled && (
          <Row
            icon={<ClipboardList className="h-4 w-4" />}
            title="Applications"
            pill={<Pill tone={appsOpen ? 'open' : 'closed'}>{appsOpen ? 'Open' : 'Closed'}</Pill>}
            detail={appsOpen ? (appsClose ? `Closes ${fmt(event.applications_close)}` : 'No closing date') : `Visitors see: “${appsReason}”`}
            actions={
              <>
                {appsNoForm ? (
                  <ButtonLink size="sm" to="/app/forms">Add application form</ButtonLink>
                ) : appsOpen ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                    if (await toast.confirm({ title: 'Close applications now?', description: linked ? `Nobody can apply after this, and ${ticketWord.toLowerCase()} opens now instead of on its scheduled time.` : 'Nobody can apply after this. You can reopen by picking a new closing date.', confirmLabel: 'Close now', danger: true }))
                      patch.mutate(linked
                        ? ({ applications_close: new Date().toISOString(), tickets_enabled: true, allow_registration: true } as Partial<Event>)
                        : { applications_close: new Date().toISOString() })
                  }}>Close now</Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => setDates({ kind: 'applications' })}>Reopen…</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDates({ kind: 'applications' })}>Edit date</Button>
              </>
            }
          />
        )}

        {contestsOn && contests.map((c) => {
          const tone: Tone = c.status === 'open' ? 'open' : c.status === 'scheduled' ? 'soon' : c.status === 'closed' ? 'closed' : 'off'
          const label = { open: 'Open', scheduled: 'Scheduled', closed: 'Closed', draft: 'Not open yet' }[c.status] ?? c.status
          const detail = c.status === 'open' ? (c.closes_at ? `Closes ${fmt(c.closes_at)}` : 'No closing time')
            : c.status === 'scheduled' ? `Opens ${fmt(c.opens_at)}${c.closes_at ? ` · closes ${fmt(c.closes_at)}` : ''}`
            : c.status === 'closed' ? (c.closes_at ? `Closed ${fmt(c.closes_at)}` : 'Closed') : `${c.stats?.contestants ?? 0} contestants added`
          return (
            <Row
              key={c.id}
              icon={<Vote className="h-4 w-4" />}
              title={contests.length > 1 ? `Voting: ${c.title}` : 'Voting'}
              pill={<Pill tone={tone}>{label}</Pill>}
              detail={detail}
              href={`/app/voting/contests/${c.id}`}
              actions={
                <>
                  {c.status === 'open' ? (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                      if (await toast.confirm({ title: 'Close voting now?', description: 'Nobody can vote until you open it again.', confirmLabel: 'Close voting', danger: true }))
                        contestStatus.mutate({ id: c.id, action: 'close' })
                    }}>Close now</Button>
                  ) : (
                    !c.stats?.contestants ? (
                      <ButtonLink size="sm" variant="secondary" to={`/app/voting/contests/${c.id}/edit#contestants`}>Add contestants first</ButtonLink>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => contestStatus.mutate({ id: c.id, action: 'open' })}>
                        {c.status === 'closed' ? 'Reopen' : 'Open now'}
                      </Button>
                    )
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDates({ kind: 'contest', contest: c })}>Schedule</Button>
                </>
              }
            />
          )
        })}

        {scheduled && (
          <Row
            icon={<Ticket className="h-4 w-4" />}
            title={ticketWord}
            pill={<Pill tone="soon">Scheduled</Pill>}
            detail={`Opens by itself ${fmt(event.registration_opens)}${linked ? ' (when applications close)' : ''}`}
            actions={
              <>
                <Button size="sm" disabled={busy} onClick={() => patch.mutate({ tickets_enabled: true, allow_registration: true })}>Open now</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => patch.mutate({ registration_opens: null })}>Cancel schedule</Button>
                <Button size="sm" variant="ghost" onClick={() => setDates({ kind: 'opens' })}>Change time</Button>
              </>
            }
          />
        )}

        {ticketsOn && !scheduled && (
          <Row
            icon={<Ticket className="h-4 w-4" />}
            title={ticketWord}
            pill={<Pill tone={salesOpen ? 'open' : 'closed'}>{salesOpen ? 'Open' : 'Closed'}</Pill>}
            detail={salesOpen ? (deadline ? `Until ${fmt(event.registration_deadline)}` : 'Open until the event') : `Visitors see: “${salesReason}”`}
            actions={
              <>
                {salesOpen ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => patch.mutate({ allow_registration: false })}>Close now</Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() =>
                    deadline && deadline < now ? setDates({ kind: 'tickets' }) : patch.mutate({ allow_registration: true })
                  }>Open now</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDates({ kind: 'tickets' })}>Deadline</Button>
                {!salesOpen && scheduleOn && !over && (
                  <Button size="sm" variant="ghost" onClick={() => setDates({ kind: 'opens' })}>Schedule</Button>
                )}
              </>
            }
          />
        )}
      </ul>

      {warnings.length > 0 && (
        <ul className="space-y-1.5 border-t border-ink-100 px-5 py-3">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-marigold-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}

      {(canAddApps || canAddVoting || canAddTickets) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-3 text-sm">
          <span className="text-ink-500">Add a stage:</span>
          {canAddApps && (
            <AddLink onClick={() => setDates({ kind: 'applications' })}>Applications</AddLink>
          )}
          {canAddVoting && (
            <AddLink disabled={busy} onClick={async () => {
              try {
                await contestApi.create({ event: event.id, title: event.title, preset: 'simple' })
                refresh(); toast.success('Voting added', 'Add contestants, then open voting.')
              } catch (e) { toast.error('Couldn’t add voting', errMsg(e)) }
            }}>Voting</AddLink>
          )}
          {canAddTickets && (
            <AddLink disabled={busy} onClick={() => patch.mutate({ tickets_enabled: true, allow_registration: true })}>{formOnly ? 'Registration' : 'Tickets'}</AddLink>
          )}
          {canAddTickets && scheduleOn && !event.date_tba && (
            <AddLink onClick={() => setDates({ kind: 'opens' })}>{formOnly ? 'Registration' : 'Tickets'} later (scheduled)</AddLink>
          )}
        </div>
      )}

      {dates && (
        <DatesModal
          key={dates.kind === 'contest' ? dates.contest.id : dates.kind}
          state={dates}
          event={event}
          busy={busy}
          onClose={() => setDates(null)}
          onSave={(a, b) => {
            const d = dates
            // Linked schedule: moving the applications deadline moves the registration opening with it
            if (d.kind === 'applications') patch.mutate({ applications_enabled: true, applications_close: a, ...(linked ? { registration_opens: a } : {}) } as Partial<Event>)
            else if (d.kind === 'opens') patch.mutate({ registration_opens: a } as Partial<Event>)
            else if (d.kind === 'tickets') patch.mutate({ registration_deadline: a, allow_registration: true } as Partial<Event>)
            else if (d.kind === 'contest') contestUpdate.mutate({ id: d.contest.id, body: { status: 'scheduled', opens_at: a, closes_at: b } as Partial<Contest> })
            setDates(null)
          }}
        />
      )}
    </Card>
  )
}

const Row: React.FC<{ icon: React.ReactNode; title: string; pill: React.ReactNode; detail: string; actions: React.ReactNode; href?: string }> = ({ icon, title, pill: p, detail, actions, href }) => (
  <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
          {href ? <Link to={href} className="hover:underline">{title}</Link> : title} {p}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500"><CalendarClock className="h-3.5 w-3.5" aria-hidden /> {detail}</p>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
  </li>
)

const AddLink: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ onClick, disabled, children }) => (
  <button type="button" disabled={disabled} onClick={onClick}
    className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-ink-300 px-3 font-medium text-ink-700 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50">
    <Plus className="h-3.5 w-3.5" aria-hidden /> {children}
  </button>
)

const DatesModal: React.FC<{
  state: { kind: 'applications' | 'tickets' | 'opens' } | { kind: 'contest'; contest: Contest }
  event: Event
  busy: boolean
  onClose: () => void
  onSave: (a: string | null, b: string | null) => void
}> = ({ state, event, busy, onClose, onSave }) => {
  const contest = state.kind === 'contest' ? state.contest : null
  const [a, setA] = useState(() =>
    toLocal(contest ? contest.opens_at : state.kind === 'applications' ? event.applications_close : state.kind === 'opens' ? (event.registration_opens ?? event.applications_close) : event.registration_deadline))
  const [b, setB] = useState(() => toLocal(contest?.closes_at))
  const future = (v: string) => !v || new Date(v).getTime() > Date.now()
  const err = contest
    ? !a ? 'Pick when voting opens.' : !future(a) ? 'Pick a time in the future, or use Open now.' : b && new Date(b) <= new Date(a) ? 'Closing must be after opening.' : ''
    : state.kind === 'applications' && !a ? 'Pick when applications close.'
    : state.kind === 'opens' && !a ? 'Pick when registration opens.'
    : !future(a) ? 'Pick a time in the future.'
    : state.kind === 'opens' && event.registration_deadline && new Date(a) >= new Date(event.registration_deadline) ? 'Registration must open before its deadline.' : ''
  const title = contest ? 'Schedule voting' : state.kind === 'applications' ? 'Applications closing date' : state.kind === 'opens' ? 'Open registration later' : 'Sign-up deadline'
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={Boolean(err) || busy} onClick={() => onSave(fromLocal(a), fromLocal(b))}>Save</Button></>}>
      <div className="space-y-4">
        <Input type="datetime-local" label={contest ? 'Voting opens' : state.kind === 'applications' ? 'Applications close' : state.kind === 'opens' ? 'Registration opens' : 'Sign-ups close'} value={a} onChange={(e) => setA(e.target.value)}
          hint={state.kind === 'tickets' ? 'Leave empty to keep sign-ups open until the event.' : state.kind === 'opens' ? 'Registration stays closed until then and opens by itself. The event page shows the opening time.' : undefined} />
        {contest && <Input type="datetime-local" label="Voting closes (optional)" value={b} onChange={(e) => setB(e.target.value)} />}
        {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      </div>
    </Modal>
  )
}
