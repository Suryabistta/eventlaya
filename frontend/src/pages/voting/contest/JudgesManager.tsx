import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Mail, ShieldOff, Trash2, UserPlus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, IconButton, Input, Modal, Skeleton, useToast } from '@/components/ui'
import { contestApi, type Contest, type ContestJudge } from './api'
import { contestantsKey } from './ContestantsManager'

export const judgesKey = (id: string) => ['contest-judges', id]

/** Invite judges by email, see their progress, set conflicts of interest. Saves immediately. */
export const JudgesManager: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: judges, isLoading, isError, error, refetch } = useQuery({ queryKey: judgesKey(contest.id), queryFn: () => contestApi.judges(contest.id) })
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)
  const [conflicts, setConflicts] = useState<ContestJudge | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: judgesKey(contest.id) })
    qc.invalidateQueries({ queryKey: ['contest', contest.id] })
  }

  const invite = useMutation({
    mutationFn: () => contestApi.inviteJudge(contest.id, { email: email.trim(), name: name.trim() }),
    onSuccess: (j) => {
      toast.success('Judge added', j.created ? 'A new account was created. Share the temporary password with them.' : `${j.email} can sign in with their existing account.`)
      if (j.temporary_password) setCredentials({ email: j.email, password: j.temporary_password })
      setEmail('')
      setName('')
      refresh()
    },
    onError: (e: Error) => toast.error('Couldn’t add the judge', e.message),
  })

  const resetPassword = async (j: ContestJudge) => {
    const ok = await toast.confirm({ title: `New password for ${j.name}?`, description: 'Their old password stops working.', confirmLabel: 'Reset password' })
    if (!ok) return
    try {
      const res = await contestApi.updateJudge(contest.id, j.id, { reset_password: true })
      if (res.temporary_password) setCredentials({ email: j.email, password: res.temporary_password })
    } catch (e) {
      toast.error('Couldn’t reset the password', (e as Error).message)
    }
  }

  const remove = async (j: ContestJudge) => {
    const ok = await toast.confirm({
      title: `Remove ${j.name}?`,
      description: 'If they already submitted scores, they are switched off instead and their scores stop counting.',
      confirmLabel: 'Remove judge',
      danger: true,
    })
    if (!ok) return
    try {
      await contestApi.removeJudge(contest.id, j.id)
      refresh()
    } catch (e) {
      toast.error('Couldn’t remove the judge', (e as Error).message)
    }
  }

  const toggleActive = async (j: ContestJudge) => {
    try {
      await contestApi.updateJudge(contest.id, j.id, { is_active: !j.is_active })
      refresh()
    } catch (e) {
      toast.error('Couldn’t update the judge', (e as Error).message)
    }
  }

  const link = `${window.location.origin}/judge`

  return (
    <div className="space-y-4">
      <form
        className="grid grid-cols-1 gap-3 rounded-2xl border border-ink-200 bg-ink-50/50 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (!email.includes('@')) {
            toast.error('Enter the judge’s email address')
            return
          }
          invite.mutate()
        }}
      >
        <Input label="Judge’s email" type="email" required placeholder="judge@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Name shown to you" placeholder="Rina Thapa" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon={<UserPlus className="h-4 w-4" />} loading={invite.isPending}>Add judge</Button>
      </form>
      <p className="text-xs text-ink-500">
        Judges sign in and score at <span className="font-mono">{link}</span>. New judges get an Eventlaya account with a temporary password (shown once); people
        who already have an account use it. They only see this contest’s scoring sheet.
      </p>

      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : !judges?.length ? (
        <EmptyState icon={<UserPlus className="h-6 w-6" />} title="No judges yet" description="Add judges if any round is scored by a jury." />
      ) : (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white">
          {judges.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                  {j.name}
                  {!j.is_active && <Badge>Switched off</Badge>}
                  {j.excluded_contestants.length > 0 && <Badge tone="warning">{j.excluded_contestants.length} conflict{j.excluded_contestants.length === 1 ? '' : 's'}</Badge>}
                </p>
                <p className="truncate text-xs text-ink-500">
                  {j.email} · {j.last_login ? `last signed in ${new Date(j.last_login).toLocaleDateString()}` : 'hasn’t signed in yet'}
                </p>
                {j.progress.length > 0 && (
                  <p className="mt-1 text-xs text-ink-600">
                    {j.progress.map((p) => `${p.name}: ${p.submitted}/${p.expected} scored`).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex items-center">
                <Button size="sm" variant="ghost" onClick={() => setConflicts(j)}>Conflicts</Button>
                <Button size="sm" variant="ghost" onClick={() => toggleActive(j)}>{j.is_active ? 'Switch off' : 'Switch on'}</Button>
                <IconButton label={`Reset ${j.name}’s password`} onClick={() => resetPassword(j)}><KeyRound className="h-4 w-4" aria-hidden /></IconButton>
                <IconButton label={`Remove ${j.name}`} onClick={() => remove(j)} className="hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(credentials)}
        onClose={() => setCredentials(null)}
        title="Share these sign-in details"
        description="The password is shown only now. The judge should change it after signing in."
        footer={<Button onClick={() => setCredentials(null)}>Done</Button>}
      >
        {credentials && (
          <div className="space-y-3">
            <dl className="space-y-2 rounded-xl bg-ink-50 p-4 text-sm">
              <div><dt className="text-ink-500">Sign in at</dt><dd className="font-mono">{link}</dd></div>
              <div><dt className="text-ink-500">Email</dt><dd className="font-mono">{credentials.email}</dd></div>
              <div><dt className="text-ink-500">Temporary password</dt><dd className="font-mono text-lg font-bold">{credentials.password}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => {
                void navigator.clipboard?.writeText(`Judge sign-in for ${contest.title}\n${link}\nEmail: ${credentials.email}\nPassword: ${credentials.password}`)
                toast.success('Copied')
              }}>Copy</Button>
              <a className="inline-flex h-8 items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold text-ink-700 hover:bg-ink-100" href={`mailto:${credentials.email}?subject=${encodeURIComponent(`Judging ${contest.title}`)}&body=${encodeURIComponent(`Sign in at ${link}\nEmail: ${credentials.email}\nTemporary password: ${credentials.password}`)}`}>
                <Mail className="h-4 w-4" aria-hidden /> Email it
              </a>
            </div>
          </div>
        )}
      </Modal>

      {conflicts && <ConflictsModal contest={contest} judge={conflicts} onClose={() => setConflicts(null)} onSaved={refresh} />}
    </div>
  )
}

const ConflictsModal: React.FC<{ contest: Contest; judge: ContestJudge; onClose: () => void; onSaved: () => void }> = ({ contest, judge, onClose, onSaved }) => {
  const toast = useToast()
  const { data: contestants = [] } = useQuery({ queryKey: contestantsKey(contest.id), queryFn: () => contestApi.contestants(contest.id) })
  const [picked, setPicked] = useState<string[]>(judge.excluded_contestants)
  const save = useMutation({
    mutationFn: () => contestApi.updateJudge(contest.id, judge.id, { excluded_contestants: picked }),
    onSuccess: () => {
      toast.success('Conflicts saved', picked.length ? `${judge.name} won’t score ${picked.length} contestant${picked.length === 1 ? '' : 's'}.` : undefined)
      onSaved()
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })
  return (
    <Modal
      open
      onClose={onClose}
      title={`Conflicts of interest: ${judge.name}`}
      description="Tick contestants this judge must not score (relatives, students, clients…). Their results use the other judges’ scores."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()} icon={<ShieldOff className="h-4 w-4" />}>Save</Button></>}
    >
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
        {contestants.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-50">
              <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
              <span className="font-mono text-xs text-ink-500">{c.display_number}</span>
              <span className="text-sm text-ink-900">{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
