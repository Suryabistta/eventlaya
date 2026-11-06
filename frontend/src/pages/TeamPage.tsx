import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DoorOpen, KeyRound, Pencil, Search, Trash2, UserCheck, UserPlus, UserX, UsersRound } from 'lucide-react'
import { TEAM_KEY, teamApi, type TeamMember, type TeamMemberUpdate } from '@/lib/team'
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import { StaffCredentialsModal, type StaffCredentials } from '@/components/StaffCredentialsModal'
import { cn } from '@/lib/utils'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const displayName = (m: TeamMember) => m.name?.trim() || [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email

const initials = (m: TeamMember) => {
  const parts = [m.first_name, m.last_name].filter(Boolean)
  if (parts.length) return parts.map((p) => p[0]).join('').slice(0, 2).toUpperCase()
  return m.email.slice(0, 2).toUpperCase()
}

const lastSignIn = (iso: string | null) => {
  if (!iso) return 'Never signed in'
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days < 1) return `Signed in today, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  if (days === 1) return 'Signed in yesterday'
  if (days < 7) return `Signed in ${days} days ago`
  return `Last signed in ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export const TeamPage: React.FC = () => {
  const toast = useToast()
  const { data: team = [], isLoading, isError, error, refetch } = useQuery({ queryKey: TEAM_KEY, queryFn: teamApi.list })
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [credentials, setCredentials] = useState<StaffCredentials | null>(null)

  useEffect(() => {
    if (isError) toast.error('Couldn’t load your team', (error as Error)?.message)
  }, [isError, error, toast])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return team
    return team.filter((m) => displayName(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
  }, [team, query])

  const activeCount = team.filter((m) => m.is_active).length

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Team"
        description={
          team.length
            ? `${activeCount} active staff member${activeCount === 1 ? '' : 's'}. Add people here, then put them on a gate in Gates & staff.`
            : 'The people who scan tickets at your gates.'
        }
        actions={
          <Button icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add staff member
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : team.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UsersRound className="h-6 w-6" aria-hidden />}
            title="No staff yet"
            description={
              <>
                Add the people who will scan tickets. Each gets a sign-in for the Eventlaya Scanner app. Then assign them to a gate on{' '}
                <Link to="/app/gates" className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800">
                  Gates & staff
                </Link>{' '}
                so they can start scanning.
              </>
            }
            action={
              <Button icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
                Add staff member
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <label htmlFor="team-search" className="sr-only">
              Search staff
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                id="team-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email"
                className="block h-[38px] w-full rounded-[10px] border border-ink-200 bg-white pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-2xs hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </Card>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Search className="h-6 w-6" aria-hidden />}
                title="No one matches"
                description={`No staff member's name or email contains “${query.trim()}”.`}
                action={
                  <Button variant="secondary" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-ink-100" aria-label="Staff members">
                {filtered.map((m) => (
                  <MemberRow key={m.id} member={m} onEdit={() => setEditing(m)} onCredentials={setCredentials} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <AddMemberModal
        open={adding}
        onClose={() => setAdding(false)}
        existing={team}
        onCreated={(c) => {
          setAdding(false)
          if (c) setCredentials(c)
        }}
      />
      <EditMemberModal member={editing} onClose={() => setEditing(null)} />
      <StaffCredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

const MemberRow: React.FC<{ member: TeamMember; onEdit: () => void; onCredentials: (c: StaffCredentials) => void }> = ({
  member: m,
  onEdit,
  onCredentials,
}) => {
  const toast = useToast()
  const qc = useQueryClient()
  const name = displayName(m)
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: TEAM_KEY })
    void qc.invalidateQueries({ queryKey: ['staffAssignments'] })
    void qc.invalidateQueries({ queryKey: ['gates'] })
  }

  const update = useMutation({
    mutationFn: (body: TeamMemberUpdate) => teamApi.update(m.id, body),
    onSuccess: (res, body) => {
      if (body.reset_password && res.temporary_password) {
        onCredentials({ email: res.email, password: res.temporary_password, name, reason: 'reset' })
      } else if ('is_active' in body) {
        toast.success(body.is_active ? `${name} reactivated` : `${name} deactivated`, body.is_active ? 'They can sign in and scan again.' : 'They can no longer sign in or scan.')
      }
      invalidate()
    },
    onError: (e) => toast.error("Couldn't update this staff member", errText(e)),
  })

  const remove = useMutation({
    mutationFn: () => teamApi.remove(m.id),
    onSuccess: (res) => {
      toast.success(res.message || `${name} removed from your team`)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't remove this staff member", errText(e)),
  })

  const confirmDeactivate = async () => {
    if (m.is_active) {
      const ok = await toast.confirm({
        title: `Deactivate ${name}?`,
        description: 'They won’t be able to sign in or scan tickets until you reactivate them. Their gate assignments are kept.',
        confirmLabel: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    update.mutate({ is_active: !m.is_active })
  }

  const confirmReset = async () => {
    const ok = await toast.confirm({
      title: `Reset ${name}'s password?`,
      description: 'Their current password stops working right away. You’ll get a new temporary password to give them.',
      confirmLabel: 'Reset password',
    })
    if (ok) update.mutate({ reset_password: true })
  }

  const confirmRemove = async () => {
    const ok = await toast.confirm({
      title: `Remove ${name} from your team?`,
      description: m.assignments.length
        ? `They'll also be taken off ${m.assignments.length === 1 ? 'their gate' : `all ${m.assignments.length} of their gates`} and can't scan for your events.`
        : 'They won’t be able to scan for your events.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const busy = update.isPending || remove.isPending

  return (
    <li className={cn('flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-start', !m.is_active && 'bg-ink-50')}>
      <div className="flex min-w-0 flex-1 gap-3">
        <div
          aria-hidden
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            m.is_active ? 'bg-brand-50 text-brand-700' : 'bg-ink-200 text-ink-500',
          )}
        >
          {initials(m)}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-ink-900">{name}</p>
              {m.is_active ? (
                <Badge tone="success" dot>
                  Active
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  Deactivated
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-ink-500">
              {m.email}
              {m.phone && <span className="text-ink-400"> · {m.phone}</span>}
            </p>
          </div>

          {m.assignments.length === 0 ? (
            <p className="text-sm text-ink-500">
              Not assigned to a gate yet.{' '}
              <Link to="/app/gates" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                Assign on Gates & staff
              </Link>
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label={`Where ${name} is assigned`}>
              {m.assignments.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    'inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                    a.is_active && a.gate_id ? 'border-ink-200 bg-white text-ink-700' : 'border-dashed border-ink-300 bg-ink-50 text-ink-500',
                  )}
                >
                  <DoorOpen className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
                  <span className="truncate">
                    <span className="font-medium text-ink-800">{a.event_title}</span> · {a.gate_id ? a.gate_name : 'No gate'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-ink-500">{lastSignIn(m.last_login)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 pl-[52px] lg:shrink-0 lg:pl-0">
        <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={onEdit} disabled={busy} aria-label={`Edit ${name}`}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<KeyRound className="h-4 w-4" aria-hidden />}
          onClick={confirmReset}
          loading={update.isPending && update.variables?.reset_password === true}
          disabled={busy || !m.is_active}
          title={m.is_active ? undefined : 'Reactivate them first'}
          aria-label={`Reset password for ${name}`}
        >
          Reset password
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={m.is_active ? <UserX className="h-4 w-4" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
          onClick={confirmDeactivate}
          loading={update.isPending && update.variables !== undefined && 'is_active' in update.variables}
          disabled={busy}
          aria-label={`${m.is_active ? 'Deactivate' : 'Reactivate'} ${name}`}
        >
          {m.is_active ? 'Deactivate' : 'Reactivate'}
        </Button>
        <IconButton label={`Remove ${name}`} onClick={confirmRemove} disabled={busy} className="h-8 w-8 hover:bg-red-50 hover:text-red-700">
          <Trash2 className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */

type FormErrors = Partial<Record<'email' | 'password' | 'first_name', string>>

const AddMemberModal: React.FC<{
  open: boolean
  onClose: () => void
  existing: TeamMember[]
  onCreated: (credentials: StaffCredentials | null) => void
}> = ({ open, onClose, existing, onCreated }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const blank = { first_name: '', last_name: '', email: '', phone: '', password: '' }
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<FormErrors>({})

  useEffect(() => {
    if (open) {
      setForm(blank)
      setErrors({})
    }
  }, [open])

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setErrors((er) => ({ ...er, [k]: undefined }))
  }

  const create = useMutation({
    mutationFn: () =>
      teamApi.create({
        email: form.email.trim(),
        first_name: form.first_name.trim() || undefined,
        last_name: form.last_name.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password: form.password || undefined,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: TEAM_KEY })
      const name = displayName(res)
      if (res.temporary_password) {
        onCreated({ email: res.email, password: res.temporary_password, name, reason: 'created' })
      } else {
        toast.success(
          res.message || `${name} added to your team`,
          res.created ? 'They can sign in with the password you set.' : 'They already had a staff account, so they keep their current password.',
        )
        onCreated(null)
      }
    },
    onError: (e) => {
      const msg = errText(e)
      if (/email/i.test(msg)) setErrors({ email: msg })
      else if (/password/i.test(msg)) setErrors({ password: msg })
      toast.error("Couldn't add staff member", msg)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const email = form.email.trim()
    const next: FormErrors = {}
    if (!EMAIL_RE.test(email)) next.email = 'Enter an email like name@example.com.'
    else if (existing.some((m) => m.email.toLowerCase() === email.toLowerCase())) next.email = 'This person is already on your team.'
    if (form.password && form.password.length < 8) next.password = 'Use at least 8 characters, or leave it blank.'
    setErrors(next)
    if (Object.keys(next).length === 0) create.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add staff member"
      description="They’ll sign in to the Eventlaya Scanner app with this email."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-staff-form" loading={create.isPending} icon={<UserPlus className="h-4 w-4" aria-hidden />}>
            Add staff member
          </Button>
        </>
      }
    >
      <form id="add-staff-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={form.first_name} onChange={set('first_name')} autoComplete="off" maxLength={150} autoFocus />
          <Input label="Last name" value={form.last_name} onChange={set('last_name')} autoComplete="off" maxLength={150} />
        </div>
        <Input
          label="Email"
          type="email"
          required
          placeholder="name@example.com"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
          autoComplete="off"
        />
        <Input label="Phone" type="tel" placeholder="Optional" value={form.phone} onChange={set('phone')} autoComplete="off" maxLength={20} />
        <Input
          label="Password"
          type="text"
          placeholder="Leave blank to generate one"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="Leave blank and we'll create a temporary password you can share with them."
          autoComplete="new-password"
        />
      </form>
    </Modal>
  )
}

const EditMemberModal: React.FC<{ member: TeamMember | null; onClose: () => void }> = ({ member, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '' })

  useEffect(() => {
    if (member) setForm({ first_name: member.first_name, last_name: member.last_name, phone: member.phone })
  }, [member])

  const save = useMutation({
    mutationFn: () =>
      teamApi.update(member!.id, { first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim() }),
    onSuccess: (res) => {
      toast.success(`${displayName(res)} updated`)
      void qc.invalidateQueries({ queryKey: TEAM_KEY })
      void qc.invalidateQueries({ queryKey: ['staffAssignments'] })
      onClose()
    },
    onError: (e) => toast.error("Couldn't save changes", errText(e)),
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      title={member ? `Edit ${displayName(member)}` : 'Edit staff member'}
      description={member?.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-staff-form" loading={save.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="edit-staff-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={form.first_name} onChange={set('first_name')} maxLength={150} autoFocus />
          <Input label="Last name" value={form.last_name} onChange={set('last_name')} maxLength={150} />
        </div>
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} maxLength={20} />
        <p className="text-xs text-ink-500">
          Their email can't be changed here. Gate assignments are managed on{' '}
          <Link to="/app/gates" className="font-medium text-brand-700 underline-offset-2 hover:underline">
            Gates & staff
          </Link>
          .
        </p>
      </form>
    </Modal>
  )
}
