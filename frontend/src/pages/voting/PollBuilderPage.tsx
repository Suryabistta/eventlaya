import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Eye, Trash2, UserPlus } from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ImageUpload,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { votingApi, type PollInput, type PollStatus, type ResultsVisibility, type VoteMode, type VotingPoll } from './api'
import { BallotOption } from './ballot'
import { PollStatusBadge, voteModeLabel, votesLabel } from './shared'

const wrapClass = 'w-full space-y-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-8 lg:pt-8 2xl:px-10'

type StartChoice = 'draft' | 'now' | 'scheduled' | 'closed'

interface CandidateDraft {
  key: string
  id?: string
  name: string
  subtitle: string
  description: string
  photo_url: string
  votes: number
}

interface PollDraft {
  title: string
  description: string
  start: StartChoice
  opens_at: string // datetime-local
  endsAt: boolean
  closes_at: string // datetime-local
  vote_mode: VoteMode
  require_checked_in: boolean
  allow_multiple: boolean
  max_choices: string
  results_visibility: ResultsVisibility
  show_on_public_page: boolean
  candidates: CandidateDraft[]
}

let keySeq = 0
const newKey = () => `c${++keySeq}`
const blankCandidate = (): CandidateDraft => ({ key: newKey(), name: '', subtitle: '', description: '', photo_url: '', votes: 0 })

const emptyDraft = (): PollDraft => ({
  title: '',
  description: '',
  start: 'draft',
  opens_at: '',
  endsAt: false,
  closes_at: '',
  vote_mode: 'ticket',
  require_checked_in: false,
  allow_multiple: false,
  max_choices: '2',
  results_visibility: 'live',
  show_on_public_page: true,
  candidates: [blankCandidate(), blankCandidate()],
})

function toLocalInput(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const startFromStatus: Record<PollStatus, StartChoice> = { draft: 'draft', open: 'now', scheduled: 'scheduled', closed: 'closed' }
const statusFromStart: Record<StartChoice, PollStatus> = { draft: 'draft', now: 'open', scheduled: 'scheduled', closed: 'closed' }

function fromPoll(p: VotingPoll): PollDraft {
  return {
    title: p.title,
    description: p.description,
    start: startFromStatus[p.status],
    opens_at: toLocalInput(p.opens_at),
    endsAt: Boolean(p.closes_at),
    closes_at: toLocalInput(p.closes_at),
    vote_mode: p.vote_mode,
    require_checked_in: p.require_checked_in,
    allow_multiple: p.allow_multiple,
    max_choices: String(p.allow_multiple ? p.max_choices : 2),
    results_visibility: p.results_visibility,
    show_on_public_page: p.show_on_public_page,
    candidates: p.candidates.map((c) => ({
      key: c.id ?? newKey(),
      id: c.id,
      name: c.name,
      subtitle: c.subtitle,
      description: c.description,
      photo_url: c.photo_url,
      votes: c.votes ?? 0,
    })),
  }
}

type Errors = Partial<Record<'title' | 'opens_at' | 'closes_at' | 'max_choices' | 'candidates', string>> & { names?: Record<string, string> }

function validate(d: PollDraft): Errors {
  const e: Errors = {}
  if (!d.title.trim()) e.title = 'Give the poll a title.'
  if (d.start === 'scheduled' && !d.opens_at) e.opens_at = 'Pick when voting should open.'
  if (d.start === 'scheduled' && d.opens_at && new Date(d.opens_at) <= new Date()) e.opens_at = 'Pick a time in the future, or choose “Open now”.'
  if (d.endsAt && !d.closes_at) e.closes_at = 'Pick when voting should close.'
  if (d.endsAt && d.closes_at) {
    const opens = d.start === 'scheduled' && d.opens_at ? new Date(d.opens_at) : new Date()
    if (new Date(d.closes_at) <= opens) e.closes_at = 'Voting must close after it opens.'
  }
  const named = d.candidates.filter((c) => c.name.trim())
  const names: Record<string, string> = {}
  d.candidates.forEach((c) => {
    if (!c.name.trim() && (c.subtitle || c.description || c.photo_url || d.candidates.length <= 2)) names[c.key] = 'Add a name, or remove this candidate.'
  })
  if (Object.keys(names).length) e.names = names
  if (d.start !== 'draft' && named.length < 2) e.candidates = 'Add at least 2 candidates before voting opens.'
  if (d.allow_multiple) {
    const n = Number(d.max_choices)
    if (!Number.isInteger(n) || n < 2) e.max_choices = 'Allow at least 2 picks, or turn off multiple choice.'
    else if (named.length && n > named.length) e.max_choices = `There are only ${named.length} candidates on the ballot.`
  }
  return e
}

const errorCount = (e: Errors) => Object.keys(e).filter((k) => k !== 'names').length + Object.keys(e.names ?? {}).length

export const PollBuilderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const { currentEvent, isLoading: eventsLoading } = useCurrentEvent()
  const { data: poll, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['voting-poll', id],
    queryFn: () => votingApi.get(id!),
    enabled: Boolean(id),
  })

  if (id) {
    if (isError) return <div className={wrapClass}><ErrorState message={error?.message} onRetry={refetch} /></div>
    if (isLoading || !poll) return <div className={wrapClass}><Skeleton className="h-10 w-72" /><Skeleton className="h-96 rounded-2xl" /></div>
    return <PollForm key={poll.id} poll={poll} eventId={poll.event} eventTitle={poll.event_title} />
  }
  if (eventsLoading) return <div className={wrapClass}><Skeleton className="h-96 rounded-2xl" /></div>
  if (!currentEvent) {
    return (
      <div className={wrapClass}>
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Create an event first"
            description="Polls belong to an event."
            action={<ButtonLink to="/app/events/new">Create event</ButtonLink>}
          />
        </Card>
      </div>
    )
  }
  return <PollForm key={currentEvent.id} eventId={currentEvent.id} eventTitle={currentEvent.title} />
}

const PollForm: React.FC<{ poll?: VotingPoll; eventId: string; eventTitle: string }> = ({ poll, eventId, eventTitle }) => {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEdit = Boolean(poll)
  const initial = useMemo(() => (poll ? fromPoll(poll) : emptyDraft()), [poll])
  const [draft, setDraft] = useState<PollDraft>(initial)
  const [submitted, setSubmitted] = useState(false)
  const errors = submitted ? validate(draft) : {}
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const lastAdded = useRef<string | null>(null)

  const set = <K extends keyof PollDraft>(k: K, v: PollDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setCand = (key: string, patch: Partial<CandidateDraft>) =>
    setDraft((d) => ({ ...d, candidates: d.candidates.map((c) => (c.key === key ? { ...c, ...patch } : c)) }))

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  useEffect(() => {
    if (!lastAdded.current) return
    document.querySelector<HTMLInputElement>(`[data-cand="${lastAdded.current}"] input`)?.focus()
    lastAdded.current = null
  }, [draft.candidates.length])

  const addCandidate = () => {
    const c = blankCandidate()
    lastAdded.current = c.key
    setDraft((d) => ({ ...d, candidates: [...d.candidates, c] }))
  }

  const moveCandidate = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.candidates]
      const j = i + dir
      if (j < 0 || j >= next.length) return d
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...d, candidates: next }
    })

  const removeCandidate = async (c: CandidateDraft) => {
    if (c.votes > 0) {
      const ok = await toast.confirm({
        title: `Remove ${c.name || 'this candidate'}?`,
        description: `Their ${votesLabel(c.votes)} will be deleted when you save.`,
        confirmLabel: 'Remove candidate',
        danger: true,
      })
      if (!ok) return
    }
    setDraft((d) => ({ ...d, candidates: d.candidates.filter((x) => x.key !== c.key) }))
  }

  const save = useMutation({
    mutationFn: (body: PollInput) => (poll ? votingApi.update(poll.id, body) : votingApi.create(body)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['voting-polls'] })
      queryClient.setQueryData(['voting-poll', saved.id], saved)
      toast.success(isEdit ? 'Changes saved' : 'Poll created', saved.status === 'open' ? 'Voting is open. Share the link or QR code.' : saved.title)
      navigate(isEdit ? '/app/voting' : `/app/voting/${saved.id}`)
    },
    onError: (e: Error) => toast.error(isEdit ? 'Couldn’t save the poll' : 'Couldn’t create the poll', e.message),
  })

  const leave = async () => {
    if (dirty && !save.isPending) {
      const ok = await toast.confirm({
        title: 'Discard your changes?',
        description: isEdit ? 'Your edits to this poll haven’t been saved.' : 'This poll hasn’t been created yet.',
        confirmLabel: 'Discard changes',
        danger: true,
      })
      if (!ok) return
    }
    navigate('/app/voting')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    const found = validate(draft)
    const n = errorCount(found)
    if (n) {
      toast.error(n === 1 ? 'Fix 1 problem before saving' : `Fix ${n} problems before saving`, Object.values(found).filter((v) => typeof v === 'string').join(' ') || 'Some candidates need a name.')
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-error="true"]')
        el?.focus()
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
      return
    }
    const status = statusFromStart[draft.start]
    save.mutate({
      event: eventId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      status,
      opens_at: draft.start === 'scheduled' && draft.opens_at ? new Date(draft.opens_at).toISOString() : (poll && draft.start !== 'draft' ? poll.opens_at : null),
      closes_at: draft.endsAt && draft.closes_at ? new Date(draft.closes_at).toISOString() : null,
      vote_mode: draft.vote_mode,
      require_checked_in: draft.vote_mode === 'ticket' && draft.require_checked_in,
      allow_multiple: draft.allow_multiple,
      max_choices: draft.allow_multiple ? Number(draft.max_choices) : 1,
      results_visibility: draft.results_visibility,
      show_on_public_page: draft.show_on_public_page,
      candidates: draft.candidates
        .filter((c) => c.name.trim())
        .map((c) => ({ ...(c.id ? { id: c.id } : {}), name: c.name.trim(), subtitle: c.subtitle.trim(), description: c.description.trim(), photo_url: c.photo_url })),
    })
  }

  const startOptions: { value: StartChoice; label: string; hint: string }[] = [
    { value: 'draft', label: 'Keep as draft', hint: 'Nobody can see or vote yet.' },
    { value: 'now', label: poll?.status === 'open' ? 'Open' : 'Open now', hint: 'People can vote as soon as you save.' },
    { value: 'scheduled', label: 'Open at a set time', hint: 'Voting opens on its own.' },
    ...(poll?.status === 'closed' ? [{ value: 'closed' as const, label: 'Keep closed', hint: 'Results stay final.' }] : []),
  ]
  const submitLabel = isEdit ? 'Save changes' : draft.start === 'now' ? 'Create and open voting' : 'Create poll'

  return (
    <div className={wrapClass}>
      <div className="space-y-2">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
            <li>
              <Link to="/app/voting" onClick={(e) => { e.preventDefault(); leave() }} className="font-medium hover:text-ink-900 hover:underline">
                Live voting
              </Link>
            </li>
            <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
            <li aria-current="page" className="truncate text-ink-700">{isEdit ? poll!.title : 'New poll'}</li>
          </ol>
        </nav>
        <PageHeader
          title={isEdit ? 'Edit poll' : 'New poll'}
          description={`For ${eventTitle}.`}
          actions={poll && <PollStatusBadge status={poll.status} />}
        />
      </div>

      <form id="poll-form" onSubmit={submit} noValidate className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Section title="Basics">
            <Input label="Poll title" required placeholder="Best hackathon project" value={draft.title} onChange={(e) => set('title', e.target.value)} error={errors.title} autoFocus={!isEdit} />
            <Textarea label="Description" rows={3} hint="Optional. Shown at the top of the ballot." placeholder="Pick the team whose build impressed you most." value={draft.description} onChange={(e) => set('description', e.target.value)} />
          </Section>

          <Section title="Schedule" description="Scheduled polls open and close on their own, even if nobody is watching.">
            <ChoiceGroup legend="When should voting open?" name="start" value={draft.start} options={startOptions} onChange={(v) => set('start', v as StartChoice)} />
            {draft.start === 'scheduled' && (
              <Input label="Opens at" type="datetime-local" required value={draft.opens_at} onChange={(e) => set('opens_at', e.target.value)} error={errors.opens_at} containerClassName="sm:max-w-xs" />
            )}
            <Toggle label="Close voting at a set time" hint="Otherwise it stays open until you close it." checked={draft.endsAt} onChange={(v) => set('endsAt', v)} />
            {draft.endsAt && (
              <Input label="Closes at" type="datetime-local" required value={draft.closes_at} onChange={(e) => set('closes_at', e.target.value)} error={errors.closes_at} containerClassName="sm:max-w-xs" />
            )}
          </Section>

          <Section title="Rules">
            <ChoiceGroup
              legend="Who can vote?"
              name="vote_mode"
              value={draft.vote_mode}
              onChange={(v) => set('vote_mode', v as VoteMode)}
              options={[
                { value: 'ticket', label: voteModeLabel.ticket, hint: 'Voters enter the code from their pass. Best for awards.' },
                { value: 'contact', label: voteModeLabel.contact, hint: 'Anyone can vote once with a phone number or email.' },
                { value: 'open', label: voteModeLabel.open, hint: 'Quickest for live audience questions. Easier to game.' },
              ]}
            />
            {draft.vote_mode === 'ticket' && (
              <Toggle label="Only checked-in attendees" hint="Tickets must have been scanned at the gate before they can vote." checked={draft.require_checked_in} onChange={(v) => set('require_checked_in', v)} />
            )}
            <Toggle label="Let voters pick more than one" checked={draft.allow_multiple} onChange={(v) => set('allow_multiple', v)} />
            {draft.allow_multiple && (
              <Input label="Most picks per voter" type="number" min={2} inputMode="numeric" value={draft.max_choices} onChange={(e) => set('max_choices', e.target.value)} error={errors.max_choices} containerClassName="sm:max-w-[200px]" />
            )}
            <Select label="Who sees the results?" value={draft.results_visibility} onChange={(e) => set('results_visibility', e.target.value as ResultsVisibility)} containerClassName="sm:max-w-md">
              <option value="live">Everyone, live while voting</option>
              <option value="after_close">Everyone, after voting closes</option>
              <option value="hidden_to_public">Only you (announce them yourself)</option>
            </Select>
            <Toggle label="Show on the event page" hint="Off: only people with the direct link or QR code can find it." checked={draft.show_on_public_page} onChange={(v) => set('show_on_public_page', v)} />
          </Section>

          <Section title="Candidates" description="Teams, people or options. Drag isn’t needed: use the arrows to set the ballot order.">
            {errors.candidates && (
              <p data-error="true" tabIndex={-1} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{errors.candidates}</p>
            )}
            <ol className="space-y-4">
              {draft.candidates.map((c, i) => (
                <li key={c.key} className="rounded-2xl border border-ink-200 bg-ink-50/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-700">
                      Candidate {i + 1}
                      {c.votes > 0 && <span className="ml-2 font-normal text-ink-500">{votesLabel(c.votes)}</span>}
                    </p>
                    <div className="flex items-center">
                      <IconButton label={`Move candidate ${i + 1} up`} disabled={i === 0} onClick={() => moveCandidate(i, -1)} className="disabled:opacity-30">
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </IconButton>
                      <IconButton label={`Move candidate ${i + 1} down`} disabled={i === draft.candidates.length - 1} onClick={() => moveCandidate(i, 1)} className="disabled:opacity-30">
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </IconButton>
                      <IconButton label={`Remove candidate ${i + 1}`} onClick={() => removeCandidate(c)} className="hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <ImageUpload label="Photo" kind="avatar" shape="square" value={c.photo_url || null} onChange={(url) => setCand(c.key, { photo_url: url ?? '' })} hint="Optional" />
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div data-cand={c.key}>
                        <Input label="Name" required placeholder="Team Sagarmatha" value={c.name} onChange={(e) => setCand(c.key, { name: e.target.value })} error={errors.names?.[c.key]} />
                        </div>
                        <Input label="Team or subtitle" placeholder="Purwanchal Campus" value={c.subtitle} onChange={(e) => setCand(c.key, { subtitle: e.target.value })} />
                      </div>
                      <Textarea label="Description" rows={2} placeholder="One or two lines about the project or person" value={c.description} onChange={(e) => setCand(c.key, { description: e.target.value })} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <Button variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={addCandidate}>
              Add candidate
            </Button>
          </Section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <BallotPreview draft={draft} />
          <div className="hidden gap-2 lg:flex">
            <Button variant="secondary" className="flex-1" onClick={leave}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={save.isPending}>{submitLabel}</Button>
          </div>
        </aside>
      </form>

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="flex gap-2 px-4 py-3 sm:px-6">
          <Button variant="secondary" className="flex-1" onClick={leave}>Cancel</Button>
          <Button type="submit" form="poll-form" className="flex-1" loading={save.isPending}>{isEdit ? 'Save changes' : 'Create poll'}</Button>
        </div>
      </div>
    </div>
  )
}

const Section: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <Card>
    <section className="space-y-4 p-5 sm:p-6" aria-label={title}>
      <div>
        <h2 className="text-base font-bold text-ink-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      </div>
      {children}
    </section>
  </Card>
)

const Toggle: React.FC<{ label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, hint, checked, onChange }) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-3 hover:bg-ink-50">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30" />
    <span>
      <span className="block text-sm font-medium text-ink-900">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
    </span>
  </label>
)

const ChoiceGroup: React.FC<{
  legend: string
  name: string
  value: string
  options: { value: string; label: string; hint?: string }[]
  onChange: (v: string) => void
}> = ({ legend, name, value, options, onChange }) => (
  <fieldset>
    <legend className="mb-2 text-sm font-medium text-ink-800">{legend}</legend>
    <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
            value === o.value ? 'border-brand-500 bg-brand-50/60' : 'border-ink-200 bg-white hover:bg-ink-50',
          )}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 h-4 w-4 shrink-0 border-ink-300 text-brand-600 focus:ring-brand-500/30" />
          <span>
            <span className="block text-sm font-medium text-ink-900">{o.label}</span>
            {o.hint && <span className="mt-0.5 block text-xs text-ink-500">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
)

const BallotPreview: React.FC<{ draft: PollDraft }> = ({ draft }) => {
  const [picked, setPicked] = useState<string[]>([])
  const max = draft.allow_multiple ? Math.max(2, Number(draft.max_choices) || 2) : 1
  const cands = draft.candidates.filter((c) => c.name.trim() || c.photo_url)
  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : max === 1 ? [key] : p.length < max ? [...p, key] : p))
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 text-sm font-medium text-ink-500">
        <Eye className="h-4 w-4" aria-hidden />
        Ballot preview
      </div>
      <div className="max-h-[calc(100dvh-14rem)] space-y-3 overflow-y-auto bg-ink-50/60 p-4">
        <div>
          <p className="font-display text-lg font-bold text-ink-900">{draft.title.trim() || 'Untitled poll'}</p>
          {draft.description.trim() && <p className="mt-0.5 text-sm text-ink-600">{draft.description}</p>}
          <p className="mt-1 text-xs text-ink-500">
            {max === 1 ? 'Pick one.' : `Pick up to ${max}. ${picked.length} of ${max} selected.`}
          </p>
        </div>
        {cands.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 bg-white px-4 py-6 text-center text-sm text-ink-500">
            Candidates appear here as you add them.
          </p>
        ) : (
          <div className="space-y-2" role="group" aria-label="Preview candidates">
            {cands.map((c) => (
              <BallotOption
                key={c.key}
                name="preview"
                multi={max > 1}
                candidate={{ id: c.key, name: c.name || 'Unnamed', subtitle: c.subtitle, description: c.description, photo_url: c.photo_url }}
                selected={picked.includes(c.key)}
                disabled={max > 1 && picked.length >= max}
                onToggle={() => toggle(c.key)}
              />
            ))}
          </div>
        )}
        <Button className="w-full" disabled>
          Review my vote
        </Button>
        <p className="text-center text-xs text-ink-500">Preview only.</p>
      </div>
    </Card>
  )
}
