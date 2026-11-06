import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarPlus, DoorOpen, Plus, ScanLine, Trash2, UserPlus, X } from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import { gateKindLabel, gatesApi, type EventGate, type GateKind, type GateStaff } from '@/lib/gates'
import { TEAM_KEY, teamApi } from '@/lib/team'
import { StaffCredentialsModal, type StaffCredentials } from '@/components/StaffCredentialsModal'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, IconButton, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

const KINDS: GateKind[] = ['both', 'entry', 'exit']

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

export const GatesPage: React.FC = () => {
  const { currentEvent, isLoading: eventsLoading, isError: eventsError, error, refetch } = useCurrentEvent()
  const eventId = currentEvent?.id

  const gatesQuery = useQuery({
    queryKey: ['gates', eventId],
    queryFn: () => gatesApi.list(eventId!),
    enabled: Boolean(eventId),
    refetchInterval: 30000,
  })
  const assignmentsQuery = useQuery({
    queryKey: ['staffAssignments', eventId],
    queryFn: () => gatesApi.assignments(eventId!),
    enabled: Boolean(eventId),
  })
  const [credentials, setCredentials] = useState<StaffCredentials | null>(null)

  const wrap = (children: React.ReactNode) => <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>

  if (eventsError) return wrap(<ErrorState message={error?.message} onRetry={refetch} />)
  if (eventsLoading) {
    return wrap(
      <>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </>,
    )
  }
  if (!currentEvent) {
    return wrap(
      <>
        <PageHeader title="Gates and staff" />
        <Card>
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" aria-hidden />}
            title="Create an event first"
            description="Gates belong to an event. Once you have one, add its entrances and exits here."
            action={<ButtonLink to="/app/events/new">Create an event</ButtonLink>}
          />
        </Card>
      </>,
    )
  }

  const gates = gatesQuery.data ?? []
  const allStaff = assignmentsQuery.data ?? []
  const withoutGate = allStaff.filter((a) => !a.gate_id)

  return wrap(
    <>
      <PageHeader
        title="Gates and staff"
        description={`The entrances and exits at ${currentEvent.location}, and who scans at each one.`}
        actions={
          <ButtonLink to="/app/scanner" variant="secondary" size="sm" icon={<ScanLine className="h-4 w-4" aria-hidden />}>
            Open scanner
          </ButtonLink>
        }
      />

      <AddGateForm eventId={currentEvent.id} existing={gates} />

      {gatesQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : gatesQuery.isError ? (
        <ErrorState message={(gatesQuery.error as Error).message} onRetry={() => void gatesQuery.refetch()} />
      ) : gates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<DoorOpen className="h-6 w-6" aria-hidden />}
            title="No gates yet"
            description="Add your first gate above, for example Main gate. Staff can only scan once they're assigned to a gate."
          />
        </Card>
      ) : (
        <ol className="grid gap-4 xl:grid-cols-2" aria-label="Gates">
          {gates.map((g, i) => (
            <li key={g.id}>
              <GateCard eventId={currentEvent.id} gate={g} gates={gates} index={i} knownStaff={allStaff} onCredentials={setCredentials} />
            </li>
          ))}
        </ol>
      )}

      {withoutGate.length > 0 && (
        <Card>
          <CardHeader title="Staff without a gate" description="Their gate was removed. Assign them to a gate so they can scan again." />
          <ul className="divide-y divide-ink-100">
            {withoutGate.map((a) => (
              <UnplacedStaffRow key={a.id} eventId={currentEvent.id} assignment={a} gates={gates.filter((g) => g.is_active)} onCredentials={setCredentials} />
            ))}
          </ul>
        </Card>
      )}

      <StaffCredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
    </>,
  )
}

/* ------------------------------------------------------------------ */

function useInvalidateGates(eventId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['gates', eventId] })
    void qc.invalidateQueries({ queryKey: ['staffAssignments', eventId] })
    void qc.invalidateQueries({ queryKey: TEAM_KEY })
  }
}

const KindControl: React.FC<{ value: GateKind; onChange: (k: GateKind) => void; disabled?: boolean; label: string }> = ({
  value,
  onChange,
  disabled,
  label,
}) => (
  <div role="radiogroup" aria-label={label} className="inline-grid w-full grid-cols-3 gap-1 rounded-[10px] bg-ink-100 p-1 sm:w-auto">
    {KINDS.map((k) => (
      <button
        key={k}
        type="button"
        role="radio"
        aria-checked={value === k}
        disabled={disabled}
        onClick={() => onChange(k)}
        className={cn(
          'h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors disabled:opacity-50',
          value === k ? 'bg-white text-brand-700 shadow-xs' : 'text-ink-600 hover:text-ink-900',
        )}
      >
        {gateKindLabel[k]}
      </button>
    ))}
  </div>
)

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="inline-flex shrink-0 items-center gap-2 rounded-lg py-1 text-sm text-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
  >
    <span aria-hidden className={cn('relative block h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-ink-200')}>
      <span
        className={cn(
          'absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white shadow-xs transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </span>
    <span>{label}</span>
  </button>
)

const AddGateForm: React.FC<{ eventId: string; existing: EventGate[] }> = ({ eventId, existing }) => {
  const toast = useToast()
  const invalidate = useInvalidateGates(eventId)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GateKind>('both')
  const [vip, setVip] = useState(false)
  const [nameError, setNameError] = useState<string>()

  const create = useMutation({
    mutationFn: () => gatesApi.create(eventId, { name: name.trim(), kind, is_vip: vip }),
    onSuccess: (g) => {
      toast.success(`${g.name} added`, 'Assign staff to it below.')
      setName('')
      setKind('both')
      setVip(false)
      invalidate()
    },
    onError: (e) => {
      setNameError(errText(e).replace(/^name: /, ''))
      toast.error("Couldn't add the gate", errText(e).replace(/^name: /, ''))
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setNameError('Give the gate a name, for example Main gate.')
    if (existing.some((g) => g.name.toLowerCase() === n.toLowerCase())) return setNameError(`There's already a gate called ${n}.`)
    setNameError(undefined)
    create.mutate()
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4 p-4 sm:p-5" noValidate>
        <h2 className="text-base font-bold text-ink-900">Add a gate</h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-start">
          <Input
            label="Gate name"
            placeholder="e.g. North entrance"
            value={name}
            error={nameError}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(undefined)
            }}
            maxLength={100}
          />
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink-800" id="new-gate-kind">
              Used for
            </p>
            <KindControl value={kind} onChange={setKind} label="New gate is used for" />
          </div>
          <div className="flex h-full items-center lg:pt-[26px]">
            <Switch checked={vip} onChange={setVip} label="VIP gate" />
          </div>
          <div className="lg:pt-[26px]">
            <Button type="submit" loading={create.isPending} icon={<Plus className="h-4 w-4" aria-hidden />} className="w-full lg:w-auto">
              Add gate
            </Button>
          </div>
        </div>
      </form>
    </Card>
  )
}

type OnCredentials = (c: StaffCredentials) => void

const GateCard: React.FC<{ eventId: string; gate: EventGate; gates: EventGate[]; index: number; knownStaff: GateStaff[]; onCredentials: OnCredentials }> = ({
  eventId,
  gate,
  gates,
  index,
  knownStaff,
  onCredentials,
}) => {
  const toast = useToast()
  const invalidate = useInvalidateGates(eventId)
  const [name, setName] = useState(gate.name)
  const [assigning, setAssigning] = useState(false)

  const update = useMutation({
    mutationFn: (body: Parameters<typeof gatesApi.update>[2]) => gatesApi.update(eventId, gate.id, body),
    onSuccess: (_g, body) => {
      if ('name' in body) toast.success('Gate renamed')
      else if ('is_active' in body) toast.success(body.is_active ? `${gate.name} reopened` : `${gate.name} closed`, body.is_active ? undefined : 'Staff at this gate can no longer scan.')
      else if ('kind' in body) toast.success(`${gate.name} is now ${gateKindLabel[body.kind!].toLowerCase()}`)
      else if ('is_vip' in body) toast.success(body.is_vip ? `${gate.name} marked as VIP` : `${gate.name} is no longer VIP`)
      invalidate()
    },
    onError: (e) => {
      setName(gate.name)
      toast.error("Couldn't update the gate", errText(e).replace(/^name: /, ''))
    },
  })

  const move = useMutation({
    mutationFn: async (dir: -1 | 1) => {
      const next = [...gates]
      const [g] = next.splice(index, 1)
      next.splice(index + dir, 0, g)
      await Promise.all(next.map((x, i) => (x.order !== i ? gatesApi.update(eventId, x.id, { order: i }) : null)))
    },
    onSuccess: () => invalidate(),
    onError: (e) => toast.error("Couldn't reorder gates", errText(e)),
  })

  const remove = useMutation({
    mutationFn: () => gatesApi.remove(eventId, gate.id),
    onSuccess: (res) => {
      if (res.deactivated) toast.info(`${gate.name} closed instead`, res.message)
      else toast.success(res.message)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't delete the gate", errText(e)),
  })

  const unassign = useMutation({
    mutationFn: (a: GateStaff) => gatesApi.unassign(a.id),
    onSuccess: (_r, a) => {
      toast.success(`${a.staff_name || a.staff_email} removed from ${gate.name}`)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't remove staff", errText(e)),
  })

  const saveName = () => {
    const n = name.trim()
    if (!n) return setName(gate.name)
    if (n !== gate.name) update.mutate({ name: n })
  }

  const confirmDelete = async () => {
    const staffCount = gate.staff?.length ?? 0
    const ok = await toast.confirm({
      title: `Delete ${gate.name}?`,
      description:
        (gate.scans_in_today + gate.scans_out_today > 0 ? 'This gate has scans, so it will be closed instead and its history kept. ' : '') +
        (staffCount ? `${staffCount} staff will need a new gate.` : 'This can’t be undone.'),
      confirmLabel: 'Delete gate',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const staff = gate.staff ?? []

  return (
    <Card className={cn('flex h-full flex-col', !gate.is_active && 'bg-ink-50')}>
      <div className="flex items-start gap-2 border-b border-ink-100 px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <label htmlFor={`gate-name-${gate.id}`} className="sr-only">
            Name of gate {index + 1}
          </label>
          <input
            id={`gate-name-${gate.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setName(gate.name)
            }}
            maxLength={100}
            className="-ml-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-lg font-bold text-ink-900 hover:border-ink-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {!gate.is_active && <Badge tone="warning">Closed</Badge>}
            {gate.is_vip && <Badge tone="brand">VIP</Badge>}
            <span className="text-xs text-ink-500 tabular">
              Today: {gate.scans_in_today} in, {gate.scans_out_today} out
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={`Move ${gate.name} up`} disabled={index === 0 || move.isPending} onClick={() => move.mutate(-1)} className="disabled:opacity-30">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton
            label={`Move ${gate.name} down`}
            disabled={index === gates.length - 1 || move.isPending}
            onClick={() => move.mutate(1)}
            className="disabled:opacity-30"
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Delete ${gate.name}`} onClick={confirmDelete} disabled={remove.isPending} className="hover:bg-red-50 hover:text-red-700">
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ink-100 px-4 py-3 sm:px-5">
        <KindControl value={gate.kind} onChange={(k) => k !== gate.kind && update.mutate({ kind: k })} disabled={update.isPending} label={`${gate.name} is used for`} />
        <Switch checked={gate.is_vip} onChange={(v) => update.mutate({ is_vip: v })} label="VIP" disabled={update.isPending} />
        <Switch checked={gate.is_active} onChange={(v) => update.mutate({ is_active: v })} label="Open" disabled={update.isPending} />
      </div>

      <div className="flex-1 px-4 py-3 sm:px-5">
        <h3 className="text-sm font-medium text-ink-500">Staff at this gate</h3>
        {staff.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No one yet. Staff only see this event once they're assigned.</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink-100">
            {staff.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{a.staff_name || a.staff_email}</p>
                  <p className="truncate text-xs text-ink-500">{a.staff_email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={unassign.isPending && unassign.variables?.id === a.id}
                  onClick={() => unassign.mutate(a)}
                  aria-label={`Remove ${a.staff_email} from ${gate.name}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {assigning ? (
          <AssignStaffPanel eventId={eventId} gate={gate} knownStaff={knownStaff} onCredentials={onCredentials} onDone={() => setAssigning(false)} />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            icon={<UserPlus className="h-4 w-4" aria-hidden />}
            onClick={() => setAssigning(true)}
            disabled={!gate.is_active}
            title={gate.is_active ? undefined : 'Reopen the gate to assign staff'}
          >
            Assign staff
          </Button>
        )}
      </div>
    </Card>
  )
}

const AssignStaffPanel: React.FC<{ eventId: string; gate: EventGate; knownStaff: GateStaff[]; onCredentials: OnCredentials; onDone: () => void }> = ({
  eventId,
  gate,
  knownStaff,
  onCredentials,
  onDone,
}) => {
  const toast = useToast()
  const invalidate = useInvalidateGates(eventId)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string>()
  const listId = `staff-emails-${gate.id}`
  const elsewhere = knownStaff.filter((a) => a.gate_id !== gate.id)
  const { data: team = [] } = useQuery({ queryKey: TEAM_KEY, queryFn: teamApi.list })
  const inEvent = new Set(knownStaff.map((a) => a.staff_email.toLowerCase()))
  const teamSuggestions = team.filter((m) => m.is_active && !inEvent.has(m.email.toLowerCase()))

  const assign = useMutation({
    mutationFn: () => gatesApi.assign(eventId, gate.id, email.trim()),
    onSuccess: (res) => {
      if (res.staff_created && res.temporary_password) {
        onCredentials({ email: res.staff_email, password: res.temporary_password, name: res.staff_name || undefined, reason: 'created' })
        toast.success(`Staff account created for ${res.staff_email}`, `Assigned to ${gate.name}.`)
      } else toast.success(res.message)
      invalidate()
      onDone()
    },
    onError: (e) => {
      setEmailError(errText(e))
      toast.error("Couldn't assign staff", errText(e))
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setEmailError('Enter an email like name@example.com.')
    setEmailError(undefined)
    assign.mutate()
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3 sm:p-4" aria-label={`Assign staff to ${gate.name}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-900">Assign staff to {gate.name}</p>
        <IconButton label="Cancel" onClick={onDone} className="-mr-1 -mt-1 h-8 w-8">
          <X className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
      <Input
        label="Staff email"
        type="email"
        list={listId}
        autoFocus
        placeholder="name@example.com"
        value={email}
        error={emailError}
        onChange={(e) => {
          setEmail(e.target.value)
          setEmailError(undefined)
        }}
        hint={
          elsewhere.length || teamSuggestions.length
            ? 'Pick someone from your team or another gate, or enter a new email to create a staff account.'
            : "If there's no account for this email yet, we'll create a staff account."
        }
      />
      <datalist id={listId}>
        {elsewhere.map((a) => (
          <option key={a.id} value={a.staff_email}>
            {a.staff_name ? `${a.staff_name}, ` : ''}now at {a.gate_name}
          </option>
        ))}
        {teamSuggestions.map((m) => (
          <option key={m.id} value={m.email}>
            {m.name ? `${m.name}, ` : ''}on your team
          </option>
        ))}
      </datalist>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="sm" loading={assign.isPending}>
          Assign to {gate.name}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const UnplacedStaffRow: React.FC<{ eventId: string; assignment: GateStaff; gates: EventGate[]; onCredentials: OnCredentials }> = ({
  eventId,
  assignment,
  gates,
  onCredentials,
}) => {
  const toast = useToast()
  const invalidate = useInvalidateGates(eventId)
  const [gateId, setGateId] = useState(gates[0]?.id ?? '')
  const assign = useMutation({
    mutationFn: () => gatesApi.assign(eventId, gateId, assignment.staff_email),
    onSuccess: (res) => {
      toast.success(res.message)
      if (res.temporary_password) onCredentials({ email: res.staff_email, password: res.temporary_password, name: res.staff_name || undefined, reason: 'created' })
      invalidate()
    },
    onError: (e) => toast.error("Couldn't assign staff", errText(e)),
  })
  const unassign = useMutation({
    mutationFn: () => gatesApi.unassign(assignment.id),
    onSuccess: () => {
      toast.success(`${assignment.staff_email} removed from this event`)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't remove staff", errText(e)),
  })
  return (
    <li className="flex flex-wrap items-end gap-3 px-5 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-ink-900">{assignment.staff_name || assignment.staff_email}</p>
        <p className="truncate text-xs text-ink-500">{assignment.staff_email}</p>
      </div>
      {gates.length > 0 && (
        <Select label={`Gate for ${assignment.staff_email}`} value={gateId} onChange={(e) => setGateId(e.target.value)} containerClassName="w-48 [&_label]:sr-only">
          {gates.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      )}
      <Button size="sm" variant="secondary" disabled={!gateId} loading={assign.isPending} onClick={() => assign.mutate()}>
        Assign
      </Button>
      <Button size="sm" variant="ghost" loading={unassign.isPending} onClick={() => unassign.mutate()}>
        Remove
      </Button>
    </li>
  )
}
