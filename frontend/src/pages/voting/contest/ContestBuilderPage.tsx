import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowDown, ArrowUp, Award, BarChart3, CalendarDays, Check, ChevronRight, Crown, ExternalLink, Gavel, Layers, ListChecks,
  Mic2, Plus, Settings2, ShieldCheck, Sparkles, Trash2, Trophy, Users, Vote as VoteIcon,
} from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, ImageUpload, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PollStatusBadge } from '../shared'
import {
  contestApi, contestPath, contestRef, type CategorySelection, type Contest, type ContestCategory, type ContestInput, type ContestRound,
  type ContestVoteMode, type Criterion, type PresetKey, type ProfileField, type Visibility, type VotePack,
} from './api'
import { ContestantsManager } from './ContestantsManager'
import { JudgesManager } from './JudgesManager'
import { ChoiceGroup, LimitField, ModuleOff, Note, Section, Toggle, fromLocalInput, isModuleOff, toLocalInput } from './kit'
import { useModuleEnabled } from '@/lib/modules'
import { allowanceText, visibilityInfo, voteModeInfo } from './shared'

const wrapClass = 'w-full space-y-6 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8 2xl:px-10'

const presetIcon: Record<string, React.ReactNode> = {
  pageant: <Crown className="h-6 w-6" aria-hidden />,
  talent: <Mic2 className="h-6 w-6" aria-hidden />,
  awards: <Award className="h-6 w-6" aria-hidden />,
  quick: <VoteIcon className="h-6 w-6" aria-hidden />,
}

/* ------------------------------------------------------------------ */
/* New contest: pick a preset                                          */

export const ContestCreatePage: React.FC = () => {
  const navigate = useNavigate()
  const toast = useToast()
  const { currentEvent, isLoading: eventsLoading } = useCurrentEvent()
  const contestsOn = useModuleEnabled('contests')
  const presets = useQuery({ queryKey: ['contest-presets'], queryFn: contestApi.presets, enabled: contestsOn })
  const [preset, setPreset] = useState<PresetKey>('pageant')
  const [title, setTitle] = useState('')
  const create = useMutation({
    mutationFn: () => contestApi.create({ event: currentEvent!.id, title: title.trim(), preset }),
    onSuccess: (c) => {
      toast.success('Contest created', 'Now add your contestants. Everything else is already filled in from the preset.')
      navigate(`/app/voting/contests/${c.id}/edit#contestants`)
    },
    onError: (e: Error) => toast.error('Couldn’t create the contest', e.message),
  })

  if (!contestsOn) {
    return (
      <div className={wrapClass}>
        <ModuleOff title="Contests are turned off" description="Pageants and contests aren’t available on your account. You can still run quick polls." action={<ButtonLink to="/app/voting/new">New quick poll</ButtonLink>} />
      </div>
    )
  }
  if (eventsLoading) return <div className={wrapClass}><Skeleton className="h-96 rounded-2xl" /></div>
  if (!currentEvent) {
    return (
      <div className={wrapClass}>
        <Card><EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Create an event first" description="Contests belong to an event." action={<ButtonLink to="/app/events/new">Create event</ButtonLink>} /></Card>
      </div>
    )
  }

  return (
    <div className={wrapClass}>
      <Breadcrumb current="New contest" />
      <PageHeader title="New contest" description={`Pageants, talent shows and awards for ${currentEvent.title}. Pick a starting point; you can change every setting afterwards.`} />
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (preset === 'quick') {
            navigate('/app/voting/new')
            return
          }
          if (!title.trim()) {
            toast.error('Give the contest a name')
            return
          }
          create.mutate()
        }}
      >
        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink-800">Start from</legend>
          {presets.isError ? (
            <ErrorState message={presets.error?.message} onRetry={presets.refetch} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(presets.data ?? []).map((p) => (
                <label
                  key={p.key}
                  className={cn(
                    'flex cursor-pointer gap-4 rounded-2xl border bg-white p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
                    preset === p.key ? 'border-brand-500 ring-1 ring-brand-500' : 'border-ink-200 hover:border-ink-300',
                  )}
                >
                  <input type="radio" name="preset" value={p.key} checked={preset === p.key} onChange={() => setPreset(p.key)} className="sr-only" />
                  <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', preset === p.key ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700')}>
                    {presetIcon[p.key]}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink-900">{p.name}</span>
                    <span className="mt-0.5 block text-sm text-ink-600">{p.description}</span>
                    {(p.rounds.length > 0 || p.categories.length > 0) && (
                      <span className="mt-2 block text-xs text-ink-500">
                        {p.rounds.length > 0 && <>Rounds: {p.rounds.join(' → ')}</>}
                        {p.rounds.length > 0 && p.categories.length > 0 && <br />}
                        {p.categories.length > 0 && <>Awards: {p.categories.join(', ')}</>}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {preset !== 'quick' && (
          <Card className="space-y-4 p-5 sm:p-6">
            <Input label="Contest name" required autoFocus placeholder="Miss Dharan 2026" value={title} onChange={(e) => setTitle(e.target.value)} containerClassName="max-w-xl" />
          </Card>
        )}
        <div className="flex gap-2">
          <ButtonLink variant="secondary" to="/app/voting">Cancel</ButtonLink>
          <Button type="submit" loading={create.isPending} icon={preset === 'quick' ? undefined : <Sparkles className="h-4 w-4" />}>
            {preset === 'quick' ? 'Continue to quick poll' : 'Create contest'}
          </Button>
        </div>
      </form>
    </div>
  )
}

const Breadcrumb: React.FC<{ current: string; contest?: Contest }> = ({ current, contest }) => (
  <nav aria-label="Breadcrumb">
    <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
      <li><Link to="/app/voting" className="font-medium hover:text-ink-900 hover:underline">Live voting</Link></li>
      {contest && (
        <>
          <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
          <li><Link to={`/app/voting/contests/${contest.id}`} className="font-medium hover:text-ink-900 hover:underline">{contest.title}</Link></li>
        </>
      )}
      <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
      <li aria-current="page" className="truncate text-ink-700">{current}</li>
    </ol>
  </nav>
)

/* ------------------------------------------------------------------ */
/* Builder                                                             */

type Draft = Pick<
  Contest,
  | 'title' | 'description' | 'slug' | 'cover_url' | 'status' | 'opens_at' | 'closes_at' | 'vote_mode' | 'require_checked_in'
  | 'results_visibility' | 'results_top_n' | 'show_on_public_page' | 'number_prefix' | 'number_padding' | 'main_vote_enabled'
  | 'free_votes_enabled' | 'votes_per_voter' | 'votes_per_day' | 'votes_per_round' | 'votes_per_contestant' | 'contestant_cap_period'
  | 'allow_split' | 'max_votes_per_submit' | 'paid_votes_enabled' | 'price_per_vote' | 'max_packs_per_day' | 'buy_and_vote' | 'captcha_enabled' | 'ip_votes_per_minute'
  | 'device_votes_per_minute' | 'flag_ip_burst' | 'flag_subnet_burst' | 'flag_device_voters' | 'transparency_note' | 'show_transparency'
  | 'judges_see_others' | 'show_judge_breakdown' | 'placement_titles' | 'rounds' | 'profile_fields' | 'vote_packs' | 'contestant_notify'
> & { categories: (ContestCategory & { round_ref: string; criterion_ref: string })[] }

const DRAFT_KEYS: (keyof Draft)[] = [
  'title', 'description', 'slug', 'cover_url', 'status', 'opens_at', 'closes_at', 'vote_mode', 'require_checked_in', 'results_visibility',
  'results_top_n', 'show_on_public_page', 'number_prefix', 'number_padding', 'main_vote_enabled', 'free_votes_enabled', 'votes_per_voter',
  'votes_per_day', 'votes_per_round', 'votes_per_contestant', 'contestant_cap_period', 'allow_split', 'max_votes_per_submit',
  'paid_votes_enabled', 'price_per_vote', 'max_packs_per_day', 'buy_and_vote', 'captcha_enabled', 'ip_votes_per_minute', 'device_votes_per_minute', 'flag_ip_burst',
  'flag_subnet_burst', 'flag_device_voters', 'transparency_note', 'show_transparency', 'judges_see_others', 'show_judge_breakdown',
  'placement_titles', 'rounds', 'profile_fields', 'vote_packs', 'categories', 'contestant_notify',
]

function toDraft(c: Contest): Draft {
  const d = {} as Record<string, unknown>
  for (const k of DRAFT_KEYS) d[k] = structuredClone(c[k as keyof Contest])
  d.categories = c.categories.map((x) => ({ ...x, round_ref: x.round_name ?? '', criterion_ref: x.criterion_name ?? '' }))
  return d as Draft
}

const SECTIONS = [
  { id: 'basics', label: 'Basics', icon: Settings2 },
  { id: 'contestants', label: 'Contestants', icon: Users },
  { id: 'categories', label: 'Categories', icon: Award },
  { id: 'rounds', label: 'Rounds', icon: Layers },
  { id: 'judges', label: 'Judges & criteria', icon: Gavel },
  { id: 'rules', label: 'Voting rules', icon: ShieldCheck },
  { id: 'results', label: 'Results & display', icon: BarChart3 },
  { id: 'review', label: 'Review', icon: ListChecks },
] as const

export const ContestBuilderPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['contest', id], queryFn: () => contestApi.get(id!), retry: (n, e) => !isModuleOff(e) && n < 1 })
  if (isError && isModuleOff(error)) return <div className={wrapClass}><ModuleOff title="Contests are turned off" description="This contest is kept, but contests aren’t available on your account right now." action={<ButtonLink to="/app/voting" variant="secondary">Back to voting</ButtonLink>} /></div>
  if (isError) return <div className={wrapClass}><ErrorState message={error?.message} onRetry={refetch} /></div>
  if (isLoading || !data) return <div className={wrapClass}><Skeleton className="h-10 w-72" /><Skeleton className="h-96 rounded-2xl" /></div>
  return <Builder key={data.id} contest={data} />
}

const Builder: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [saved, setSaved] = useState(() => toDraft(contest))
  const [draft, setDraft] = useState<Draft>(saved)
  const [active, setActive] = useState<string>(() => window.location.hash.slice(1) || params.get('step') || 'basics')
  const judgingOn = useModuleEnabled('judging')
  const paidOn = useModuleEnabled('paid_votes')
  const sections = SECTIONS.filter((x) => judgingOn || x.id !== 'judges')
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  // Keep the draft in step when other screens change the contest (judges, contestants) and nothing is unsaved here
  useEffect(() => {
    if (!dirty) {
      const fresh = toDraft(contest)
      setSaved(fresh)
      setDraft(fresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contest.updated_at])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  useEffect(() => {
    const el = document.getElementById(active)
    if (el && window.location.hash.slice(1) === active) el.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useMutation({
    mutationFn: () => {
      const body: ContestInput = { ...draft } as ContestInput
      body.categories = draft.categories.map(({ round_ref, criterion_ref, ...c }) => ({
        ...c,
        round_ref: c.selection === 'judges' ? round_ref || null : null,
        criterion_ref: c.selection === 'judges' ? criterion_ref || null : null,
        winner: c.selection === 'manual' ? c.winner : null,
      }))
      return contestApi.update(contest.id, body)
    },
    onSuccess: (c) => {
      qc.setQueryData(['contest', c.id], c)
      const fresh = toDraft(c)
      setSaved(fresh)
      setDraft(fresh)
      toast.success('Contest saved')
    },
    onError: (e: Error) => {
      const data = (e as { data?: Record<string, unknown> }).data
      const detail = data && typeof data === 'object' ? flattenErrors(data).slice(0, 3).join(' ') : ''
      toast.error('Couldn’t save', detail || e.message)
    },
  })

  const go = (sid: string) => {
    setActive(sid)
    window.history.replaceState(null, '', `#${sid}`)
    document.getElementById(sid)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={wrapClass}>
      <div className="space-y-2">
        <Breadcrumb contest={contest} current="Set up" />
        <PageHeader
          title={contest.title}
          description={`Contest setup for ${contest.event_title}. Contestants and judges save as you go; other sections save with “Save changes”.`}
          actions={
            <>
              <PollStatusBadge status={contest.status} />
              <ButtonLink variant="secondary" to={`/app/voting/contests/${contest.id}`} icon={<BarChart3 className="h-4 w-4" />}>Dashboard</ButtonLink>
            </>
          }
        />
      </div>

      <nav aria-label="Setup sections" className="-mx-4 overflow-x-auto px-4 lg:hidden">
        <ol className="flex w-max gap-1.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <button onClick={() => go(s.id)} className={cn('whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold', active === s.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-600')}>
                {i + 1}. {s.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Setup sections" className="sticky top-20 hidden lg:block">
          <ol className="space-y-0.5">
            {sections.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => go(s.id)}
                  aria-current={active === s.id ? 'step' : undefined}
                  className={cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium', active === s.id ? 'bg-brand-50 text-brand-800' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900')}
                >
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold', active === s.id ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600')}>{i + 1}</span>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-4 space-y-2 border-t border-ink-200 pt-4">
            <Button className="w-full" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{dirty ? 'Save changes' : 'All saved'}</Button>
            {dirty && <Button variant="ghost" className="w-full" onClick={() => setDraft(saved)}>Discard changes</Button>}
          </div>
        </nav>

        <div className="min-w-0 space-y-6">
          <BasicsSection draft={draft} set={set} contest={contest} />
          <Section id="contestants" title="2. Contestants" description="Numbers are given automatically (you can change them). Drag or use the arrows to set the order shown to voters. Saved immediately.">
            <ContestantsManager contest={contest} />
            <ProfileFieldsEditor fields={draft.profile_fields} onChange={(v) => set('profile_fields', v)} />
          </Section>
          <CategoriesSection draft={draft} set={set} contest={contest} judgingOn={judgingOn} />
          <RoundsSection draft={draft} set={set} contest={contest} judgingOn={judgingOn} />
          {judgingOn && <JudgingSection draft={draft} set={set} contest={contest} />}
          <RulesSection draft={draft} set={set} contest={contest} paidOn={paidOn} />
          <ResultsSection draft={draft} set={set} />
          <ReviewSection draft={draft} contest={contest} dirty={dirty} onSave={() => save.mutate()} saving={save.isPending} />
        </div>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2 px-4 py-3">
            <p className="mr-auto text-sm font-medium text-ink-700">Unsaved changes</p>
            <Button variant="secondary" size="sm" onClick={() => setDraft(saved)}>Discard</Button>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function flattenErrors(data: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'string' ? out.push(x) : x && typeof x === 'object' && out.push(...flattenErrors(x as Record<string, unknown>, `${k} ${i + 1}`))))
    else if (v && typeof v === 'object') out.push(...flattenErrors(v as Record<string, unknown>, k))
  }
  return prefix ? out.map((m) => m) : out
}

interface SectionProps {
  draft: Draft
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void
  contest: Contest
  /** superadmin modules */
  judgingOn?: boolean
  paidOn?: boolean
}

/* ---------- 1. Basics ---------- */

const BasicsSection: React.FC<SectionProps> = ({ draft, set, contest }) => {
  const start = draft.status === 'scheduled' ? 'scheduled' : draft.status
  return (
    <Section id="basics" title="1. Basics">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Input label="Contest name" required value={draft.title} onChange={(e) => set('title', e.target.value)} />
          <Textarea label="Description" rows={3} placeholder="What the contest is, who’s organising it, what the winner gets." value={draft.description} onChange={(e) => set('description', e.target.value)} />
          <Input
            label="Link name"
            value={draft.slug}
            onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
            hint={`${window.location.host}${contestPath(contest.event_slug, draft.slug || contest.id)}`}
            className="min-w-0"
          />
        </div>
        <ImageUpload label="Cover image" kind="banner" value={draft.cover_url || null} onChange={(url) => set('cover_url', url ?? '')} hint="Shown at the top of the contest page and in link previews" />
      </div>
      <ChoiceGroup
        legend="Voting"
        name="start"
        value={start}
        onChange={(v) => set('status', v as Contest['status'])}
        options={[
          { value: 'draft', label: 'Draft', hint: 'Only you can see it.' },
          { value: 'open', label: 'Open', hint: 'Public. Votes are taken in whichever round is open.' },
          { value: 'scheduled', label: 'Opens at a set time', hint: 'Becomes public on its own.' },
          { value: 'closed', label: 'Closed', hint: 'Results stay; no more votes.' },
        ]}
        columns="sm:grid-cols-2 2xl:grid-cols-4"
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Opens at" type="datetime-local" value={toLocalInput(draft.opens_at)} onChange={(e) => set('opens_at', fromLocalInput(e.target.value))} hint={draft.status === 'scheduled' ? 'Required for a scheduled start' : 'Optional'} />
        <Input label="Closes at" type="datetime-local" value={toLocalInput(draft.closes_at)} onChange={(e) => set('closes_at', fromLocalInput(e.target.value))} hint="Optional. Rounds can also have their own times." />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input label="Number prefix" maxLength={5} value={draft.number_prefix} onChange={(e) => set('number_prefix', e.target.value)} hint="e.g. # or M-" />
        <Input label="Digits" type="number" min={0} max={5} value={draft.number_padding} onChange={(e) => set('number_padding', Number(e.target.value))} hint={`Contestant 7 shows as ${draft.number_prefix}${'7'.padStart(draft.number_padding || 1, '0')}`} />
      </div>
      <Toggle label="Show on the event page" hint="Off: only people with the link or QR code find it." checked={draft.show_on_public_page} onChange={(v) => set('show_on_public_page', v)} />
    </Section>
  )
}

const ProfileFieldsEditor: React.FC<{ fields: ProfileField[]; onChange: (v: ProfileField[]) => void }> = ({ fields, onChange }) => {
  const update = (i: number, patch: Partial<ProfileField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div className="space-y-3 border-t border-ink-100 pt-4">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Profile fields</h3>
        <p className="text-sm text-ink-500">Extra details for each contestant, like Age, Height or District. Private fields are only for you. Saved with “Save changes”.</p>
      </div>
      {fields.map((f, i) => (
        <div key={f.id ?? `new-${i}`} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_auto]">
          <Input label="Label" value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
          <Select label="Type" value={f.field_type} onChange={(e) => update(i, { field_type: e.target.value as ProfileField['field_type'] })}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Choice</option>
            <option value="date">Date</option>
          </Select>
          {f.field_type === 'select' ? (
            <Input label="Choices (comma separated)" value={f.options.join(', ')} onChange={(e) => update(i, { options: e.target.value.split(',').map((s) => s.trim()) })} />
          ) : <span className="hidden sm:block" />}
          <div className="flex items-center gap-3 pb-1">
            <label className="flex items-center gap-1.5 text-xs text-ink-700"><input type="checkbox" checked={f.is_public} onChange={(e) => update(i, { is_public: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-brand-600" />Public</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-700"><input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-brand-600" />Required</label>
            <IconButton label={`Remove ${f.label || 'field'}`} onClick={() => onChange(fields.filter((_, j) => j !== i))} className="hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
          </div>
        </div>
      ))}
      <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...fields, { label: '', field_type: 'text', options: [], is_public: true, required: false }])}>Add field</Button>
    </div>
  )
}

/* ---------- 3. Categories ---------- */

const CategoriesSection: React.FC<SectionProps> = ({ draft, set, contest, judgingOn = true }) => {
  const { data: contestants = [] } = useQuery({ queryKey: ['contest-contestants', contest.id], queryFn: () => contestApi.contestants(contest.id) })
  const cats = draft.categories
  const update = (i: number, patch: Partial<Draft['categories'][number]>) => set('categories', cats.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const judgingRounds = draft.rounds.filter((r) => r.judging_enabled)
  return (
    <Section
      id="categories"
      title="3. Categories (sub-awards)"
      description="Extra awards inside the contest, such as People’s Choice or Miss Photogenic. Each has its own way of choosing the winner."
      actions={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set('categories', [...cats, { name: '', description: '', selection: 'public_vote', nominees: [], votes_per_voter: null, votes_per_day: null, results_visibility: '', winner: null, round_ref: '', criterion_ref: '' }])}>Add category</Button>}
    >
      {!draft.main_vote_enabled && <Note>The main contest vote is off (Voting rules), so voters only vote in these categories.</Note>}
      {cats.length === 0 && <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500">No categories. The contest has one overall result.</p>}
      {cats.map((c, i) => (
        <div key={c.id ?? `new-${i}`} className="space-y-3 rounded-2xl border border-ink-200 bg-ink-50/40 p-4">
          <div className="flex items-start gap-2">
            <Input label="Award name" containerClassName="flex-1" placeholder="People’s Choice" value={c.name} onChange={(e) => update(i, { name: e.target.value })} />
            <div className="flex pt-6">
              <IconButton label="Move up" disabled={i === 0} onClick={() => { const n = [...cats]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set('categories', n) }} className="disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden /></IconButton>
              <IconButton label={`Remove ${c.name || 'category'}`} onClick={() => set('categories', cats.filter((_, j) => j !== i))} className="hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
            </div>
          </div>
          <ChoiceGroup
            legend="Who decides"
            name={`sel-${i}`}
            value={c.selection}
            onChange={(v) => update(i, { selection: v as CategorySelection })}
            columns="sm:grid-cols-3"
            options={[
              { value: 'public_vote', label: 'Public vote', hint: 'Its own ballot and tally' },
              ...(judgingOn || c.selection === 'judges' ? [{ value: 'judges', label: 'Judges’ scores', hint: judgingOn ? 'Highest score on a criterion' : 'Judging is turned off: no result' }] : []),
              { value: 'manual', label: 'You pick', hint: 'Announce the winner yourself' },
            ]}
          />
          {c.selection === 'public_vote' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LimitField label="Votes per voter" value={c.votes_per_voter} onChange={(v) => update(i, { votes_per_voter: v })} placeholder={`Contest: ${draft.votes_per_voter ?? 'no limit'}`} />
              <LimitField label="Votes per day" value={c.votes_per_day} onChange={(v) => update(i, { votes_per_day: v })} placeholder={`Contest: ${draft.votes_per_day ?? 'no limit'}`} />
              <Select label="Results" value={c.results_visibility} onChange={(e) => update(i, { results_visibility: e.target.value as Visibility | '' })}>
                <option value="">Same as the contest</option>
                {Object.entries(visibilityInfo).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          )}
          {c.selection === 'judges' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Round" value={c.round_ref} onChange={(e) => update(i, { round_ref: e.target.value, criterion_ref: '' })}>
                <option value="">Last judged round</option>
                {judgingRounds.map((r) => <option key={r.id ?? r.name} value={r.name}>{r.name}</option>)}
              </Select>
              <Select label="Criterion" value={c.criterion_ref} onChange={(e) => update(i, { criterion_ref: e.target.value })}>
                <option value="">Judges’ total</option>
                {[...new Set((c.round_ref ? judgingRounds.filter((r) => r.name === c.round_ref) : judgingRounds).flatMap((r) => r.criteria.map((x) => x.name)))].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
          )}
          {c.selection === 'manual' && (
            <Select label="Winner" value={c.winner ?? ''} onChange={(e) => update(i, { winner: e.target.value || null })} hint="Leave empty until you announce it.">
              <option value="">Not announced yet</option>
              {contestants.map((x) => <option key={x.id} value={x.id}>{x.display_number} {x.name}</option>)}
            </Select>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-ink-700">Nominees: {c.nominees.length ? `${c.nominees.length} picked` : 'everyone still in the contest'}</summary>
            <div className="mt-2 grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
              {contestants.map((x) => (
                <label key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white">
                  <input type="checkbox" checked={c.nominees.includes(x.id)} onChange={(e) => update(i, { nominees: e.target.checked ? [...c.nominees, x.id] : c.nominees.filter((n) => n !== x.id) })} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                  <span className="font-mono text-xs text-ink-500">{x.display_number}</span> {x.name}
                </label>
              ))}
            </div>
          </details>
        </div>
      ))}
    </Section>
  )
}

/* ---------- 4. Rounds ---------- */

const blankRound = (order: number): ContestRound => ({
  name: '', order, status: 'upcoming', opens_at: null, closes_at: null, public_vote_enabled: true, judging_enabled: false, judge_weight: 0,
  public_weight: 100, public_normalization: 'top', judge_aggregation: 'average', advance_count: null, advance_mode: 'auto', carry_over_votes: false,
  tie_breakers: ['judges', 'public', 'earliest'], results_visibility: '', results_top_n: null, criteria: [],
})

const TB_LABEL: Record<string, string> = { judges: 'Higher judges’ score', public: 'More public votes', earliest: 'Reached their votes first', number: 'Lower contestant number' }

const RoundsSection: React.FC<SectionProps> = ({ draft, set, judgingOn = true }) => {
  const rounds = draft.rounds
  const update = (i: number, patch: Partial<ContestRound>) => set('rounds', rounds.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= rounds.length) return
    const n = [...rounds]
    ;[n[i], n[j]] = [n[j], n[i]]
    set('rounds', n)
  }
  return (
    <Section
      id="rounds"
      title="4. Rounds & eliminations"
      description="Rounds run in order (e.g. Audition → Top 20 → Finale). Each has its own schedule, scoring and how many go through. With no rounds, the contest is one public vote."
      actions={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set('rounds', [...rounds, blankRound(rounds.length)])}>Add round</Button>}
    >
      {rounds.length === 0 && <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500">No rounds: one public vote decides.</p>}
      <ol className="space-y-4">
        {rounds.map((r, i) => {
          const both = judgingOn && r.judging_enabled && r.public_vote_enabled
          const locked = Boolean(r.finalized_at)
          return (
            <li key={r.id ?? `new-${i}`} className="space-y-4 rounded-2xl border border-ink-200 bg-ink-50/40 p-4">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-7 flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white">{i + 1}</span>
                <Input label="Round name" containerClassName="min-w-[12rem] flex-1" placeholder="Top 10" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                <div className="flex items-center gap-1 pt-6">
                  {locked && <Badge tone="success"><Check className="h-3 w-3" aria-hidden />Decided</Badge>}
                  <IconButton label="Move round up" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="h-4 w-4" aria-hidden /></IconButton>
                  <IconButton label="Move round down" disabled={i === rounds.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="h-4 w-4" aria-hidden /></IconButton>
                  <IconButton label={`Remove ${r.name || 'round'}`} onClick={() => set('rounds', rounds.filter((_, j) => j !== i))} className="hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select label="Status" value={r.status} onChange={(e) => update(i, { status: e.target.value as ContestRound['status'] })} hint="Upcoming rounds open on their own at “Opens”.">
                  <option value="upcoming">Upcoming</option>
                  <option value="open">Open now</option>
                  <option value="closed">Closed</option>
                </Select>
                <Input label="Opens" type="datetime-local" value={toLocalInput(r.opens_at)} onChange={(e) => update(i, { opens_at: fromLocalInput(e.target.value) })} />
                <Input label="Closes" type="datetime-local" value={toLocalInput(r.closes_at)} onChange={(e) => update(i, { closes_at: fromLocalInput(e.target.value) })} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Toggle label="Public votes count" checked={r.public_vote_enabled} onChange={(v) => update(i, { public_vote_enabled: v, ...(v && r.judging_enabled ? { public_weight: 100 - r.judge_weight } : {}) })} />
                {judgingOn && <Toggle label="Judges score this round" hint="Set criteria in “Judges & criteria”." checked={r.judging_enabled} onChange={(v) => update(i, { judging_enabled: v, ...(v ? { judge_weight: r.public_vote_enabled ? 50 : 100, public_weight: r.public_vote_enabled ? 50 : 0 } : { judge_weight: 0, public_weight: 100 }) })} />}
              </div>
              {both && (
                <div className="space-y-2 rounded-xl bg-white p-3">
                  <label htmlFor={`w-${i}`} className="flex justify-between text-sm font-medium text-ink-800">
                    <span>Judges {r.judge_weight}%</span>
                    <span>Public {r.public_weight}%</span>
                  </label>
                  <input id={`w-${i}`} type="range" min={0} max={100} step={5} value={r.judge_weight} onChange={(e) => update(i, { judge_weight: Number(e.target.value), public_weight: 100 - Number(e.target.value) })} className="w-full accent-brand-600" aria-valuetext={`Judges ${r.judge_weight} percent, public ${r.public_weight} percent`} />
                  <p className="text-xs text-ink-500">Final score = {r.judge_weight}% of the judges’ score + {r.public_weight}% of the public score (both out of 100).</p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {r.public_vote_enabled && (
                  <Select label="Public score" value={r.public_normalization} onChange={(e) => update(i, { public_normalization: e.target.value as ContestRound['public_normalization'] })} hint={r.public_normalization === 'top' ? 'Most-voted = 100, others in proportion' : 'Share of all votes in the round'}>
                    <option value="top">Relative to the top contestant</option>
                    <option value="share">Percentage share of votes</option>
                  </Select>
                )}
                <LimitField label="How many go through" value={r.advance_count} onChange={(v) => update(i, { advance_count: v })} placeholder={i === rounds.length - 1 ? 'Final round' : 'Not set'} hint={i === rounds.length - 1 ? 'Last round: the ranking is the final result.' : undefined} />
                <Select label="Who goes through" value={r.advance_mode} onChange={(e) => update(i, { advance_mode: e.target.value as ContestRound['advance_mode'] })}>
                  <option value="auto">Top N by score (you confirm)</option>
                  <option value="manual">You pick</option>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {i > 0 && <Toggle label="Votes from earlier rounds carry over" checked={r.carry_over_votes} onChange={(v) => update(i, { carry_over_votes: v })} />}
                <Select label="Results in this round" value={r.results_visibility} onChange={(e) => update(i, { results_visibility: e.target.value as Visibility | '' })}>
                  <option value="">Same as the contest</option>
                  {Object.entries(visibilityInfo).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <TieBreakers round={r} onChange={(tb) => update(i, { tie_breakers: tb })} />
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

const TieBreakers: React.FC<{ round: ContestRound; onChange: (v: string[]) => void }> = ({ round, onChange }) => {
  const options = [
    ...Object.keys(TB_LABEL),
    ...round.criteria.filter((c) => c.id).map((c) => `criterion:${c.id}`),
  ]
  const label = (k: string) => TB_LABEL[k] ?? `Higher ${round.criteria.find((c) => `criterion:${c.id}` === k)?.name ?? 'criterion'} score`
  const unused = options.filter((o) => !round.tie_breakers.includes(o))
  return (
    <div>
      <p className="text-sm font-medium text-ink-800">If two contestants tie, decide by</p>
      <ol className="mt-2 space-y-1">
        {round.tie_breakers.map((t, j) => (
          <li key={t} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-sm">
            <span className="w-5 text-xs font-bold text-ink-500">{j + 1}.</span>
            <span className="flex-1">{label(t)}</span>
            <IconButton label="Earlier" disabled={j === 0} onClick={() => { const n = [...round.tie_breakers]; [n[j - 1], n[j]] = [n[j], n[j - 1]]; onChange(n) }} className="h-7 w-7 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></IconButton>
            <IconButton label="Remove" onClick={() => onChange(round.tie_breakers.filter((x) => x !== t))} className="h-7 w-7"><Trash2 className="h-3.5 w-3.5" aria-hidden /></IconButton>
          </li>
        ))}
      </ol>
      {unused.length > 0 && (
        <select aria-label="Add a tie-breaker" value="" onChange={(e) => e.target.value && onChange([...round.tie_breakers, e.target.value])} className="mt-2 rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm text-ink-700">
          <option value="">+ Add tie-breaker</option>
          {unused.map((o) => <option key={o} value={o}>{label(o)}</option>)}
        </select>
      )}
      <p className="mt-1 text-xs text-ink-500">Still tied after these? They share the place and you choose when deciding the round.</p>
    </div>
  )
}

/* ---------- 5. Judges & criteria ---------- */

const JudgingSection: React.FC<SectionProps> = ({ draft, set, contest }) => {
  const judged = draft.rounds.map((r, i) => ({ r, i })).filter(({ r }) => r.judging_enabled)
  const updateCriteria = (i: number, criteria: Criterion[]) => set('rounds', draft.rounds.map((r, j) => (j === i ? { ...r, criteria } : r)))
  const copyFrom = (i: number, from: number) => updateCriteria(i, draft.rounds[from].criteria.map(({ id: _id, ...c }) => ({ ...c })))
  return (
    <Section id="judges" title="5. Judges & criteria" description="Judges score each contestant on a tablet or phone. Scores are hidden from other judges unless you allow it.">
      <JudgesManager contest={contest} />
      <div className="space-y-4 border-t border-ink-100 pt-4">
        <h3 className="text-sm font-bold text-ink-900">Criteria per round</h3>
        {judged.length === 0 && <Note>No round is judged yet. Turn on “Judges score this round” in Rounds.</Note>}
        {judged.map(({ r, i }) => {
          const total = r.criteria.reduce((s, c) => s + Number(c.max_points || 0), 0)
          return (
            <div key={r.id ?? `new-${i}`} className="space-y-3 rounded-2xl border border-ink-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink-900">{r.name || `Round ${i + 1}`}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-500">Total {total} points</span>
                  {judged.filter((x) => x.i !== i && x.r.criteria.length).length > 0 && (
                    <select aria-label="Copy criteria from another round" value="" onChange={(e) => e.target.value && copyFrom(i, Number(e.target.value))} className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs">
                      <option value="">Copy from…</option>
                      {judged.filter((x) => x.i !== i && x.r.criteria.length).map((x) => <option key={x.i} value={x.i}>{x.r.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
              {r.criteria.map((c, k) => (
                <div key={c.id ?? `n-${k}`} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
                  <Input label="Criterion" placeholder="Talent" value={c.name} onChange={(e) => updateCriteria(i, r.criteria.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))} />
                  <Input label="Max points" type="number" min={1} value={c.max_points} onChange={(e) => updateCriteria(i, r.criteria.map((x, j) => (j === k ? { ...x, max_points: e.target.value } : x)))} />
                  <Input label="Weight" type="number" min={0} step={0.5} value={c.weight} onChange={(e) => updateCriteria(i, r.criteria.map((x, j) => (j === k ? { ...x, weight: e.target.value } : x)))} />
                  <IconButton label={`Remove ${c.name || 'criterion'}`} onClick={() => updateCriteria(i, r.criteria.filter((_, j) => j !== k))} className="mb-0.5 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
                </div>
              ))}
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => updateCriteria(i, [...r.criteria, { name: '', description: '', max_points: 10, weight: 1 }])}>Add criterion</Button>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select label="Combine judges by" value={r.judge_aggregation} onChange={(e) => set('rounds', draft.rounds.map((x, j) => (j === i ? { ...x, judge_aggregation: e.target.value as ContestRound['judge_aggregation'] } : x)))}>
                  <option value="average">Average of all judges</option>
                  <option value="drop_high_low">Drop highest and lowest, then average (3+ judges)</option>
                  <option value="median">Median</option>
                </Select>
              </div>
              <p className="text-xs text-ink-500">A judge’s score = Σ(points × weight) ÷ Σ(max × weight) × 100. Weight 1 everywhere means plain points.</p>
            </div>
          )
        })}
        <Toggle label="Judges can see each other’s submitted scores" hint="Off is usual for pageants: judges score independently." checked={draft.judges_see_others} onChange={(v) => set('judges_see_others', v)} />
      </div>
    </Section>
  )
}

/* ---------- 6. Voting rules ---------- */

const RulesSection: React.FC<SectionProps> = ({ draft, set, contest, paidOn = true }) => {
  const packs = draft.vote_packs
  const updatePack = (i: number, patch: Partial<VotePack>) => set('vote_packs', packs.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  return (
    <Section id="rules" title="6. Voting rules" description="Who can vote, how many times, and protection against cheating.">
      <ChoiceGroup
        legend="How voters prove who they are"
        name="vote_mode"
        value={draft.vote_mode}
        onChange={(v) => set('vote_mode', v as ContestVoteMode)}
        options={(['sms_otp', 'email_otp', 'account', 'ticket', 'contact', 'open'] as ContestVoteMode[]).map((m) => ({ value: m, label: voteModeInfo[m].label, hint: voteModeInfo[m].hint }))}
      />
      {draft.vote_mode === 'sms_otp' && (
        <Note tone={contest.sms_provider === 'console' ? 'warning' : 'info'}>
          {contest.sms_provider === 'console'
            ? 'SMS isn’t connected on this server yet (development mode: codes are written to the server log). Set SMS_PROVIDER=aakash and AAKASH_SMS_TOKEN to send real texts.'
            : `Codes are sent with ${contest.sms_provider === 'aakash' ? 'Aakash SMS' : 'Sparrow SMS'}. Each code costs one SMS credit.`}
        </Note>
      )}
      {draft.vote_mode === 'ticket' && <Toggle label="Only checked-in attendees" hint="Tickets must have been scanned at the gate." checked={draft.require_checked_in} onChange={(v) => set('require_checked_in', v)} />}

      <div className="space-y-3 border-t border-ink-100 pt-4">
        <h3 className="text-sm font-bold text-ink-900">Free votes</h3>
        <Toggle label="Free votes" hint="Off: votes only come from vote packs (needs online payments)." checked={draft.free_votes_enabled} onChange={(v) => set('free_votes_enabled', v)} />
        {draft.free_votes_enabled && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LimitField label="Per voter, whole contest" value={draft.votes_per_voter} onChange={(v) => set('votes_per_voter', v)} />
              <LimitField label="Per voter, per day" value={draft.votes_per_day} onChange={(v) => set('votes_per_day', v)} hint="Resets at midnight, Nepal time" />
              <LimitField label="Per voter, per round" value={draft.votes_per_round} onChange={(v) => set('votes_per_round', v)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LimitField label="Most to one contestant" value={draft.votes_per_contestant} onChange={(v) => set('votes_per_contestant', v)} />
              <Select label="…counted" value={draft.contestant_cap_period} onChange={(e) => set('contestant_cap_period', e.target.value as Contest['contestant_cap_period'])}>
                <option value="contest">Over the whole contest</option>
                <option value="day">Per day</option>
                <option value="round">Per round</option>
              </Select>
              <LimitField label="Votes in one go" value={draft.max_votes_per_submit} onChange={(v) => set('max_votes_per_submit', v ?? 1)} placeholder="1" hint="Lets voters give several votes at once" />
            </div>
            <p className="text-sm text-ink-600">Voters see: <span className="font-semibold">{allowanceText(draft)}</span>.</p>
          </>
        )}
        <Toggle label="Voters may split votes between contestants" hint="Off: all of a voter’s votes in a round go to one contestant." checked={draft.allow_split} onChange={(v) => set('allow_split', v)} />
        <Toggle label="Public votes for the overall contest" hint="Off: people only vote in award categories." checked={draft.main_vote_enabled} onChange={(v) => set('main_vote_enabled', v)} />
      </div>

      {paidOn && <div className="space-y-3 border-t border-ink-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-ink-900">Paid votes</h3>
          {contest.paid_votes_enabled && (contest.payments.available
            ? <Badge tone="success">On sale: {contest.payments.providers.filter((p) => p.id !== 'test').map((p) => p.name).join(', ') || 'test payments'}</Badge>
            : <Badge tone="warning">Not on sale</Badge>)}
        </div>
        <p className="text-sm text-ink-600">
          Voters buy packs with Khalti or eSewa. Eventlaya collects the money and pays you out (see Payments). Votes are added to
          the buyer’s verified phone, email, account or ticket once the payment is confirmed.
        </p>
        {contest.paid_votes_enabled && !contest.payments.available && contest.payments.message && <Note tone="warning">{contest.payments.message}</Note>}
        {!['sms_otp', 'email_otp', 'account', 'ticket'].includes(draft.vote_mode) && (
          <Note tone="warning">Paid votes need verified voters: choose SMS code, email code, account or ticket above.</Note>
        )}
        <Toggle label="Offer paid vote packs" checked={draft.paid_votes_enabled} onChange={(v) => set('paid_votes_enabled', v)} />
        {draft.paid_votes_enabled && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LimitField label="Purchases per voter per day" min={0} value={draft.max_packs_per_day} onChange={(v) => set('max_packs_per_day', v ?? 0)} placeholder="0 = no limit" hint="Resets at midnight, Nepal time" />
            </div>
            <Toggle
              label="Buy and vote"
              hint="Votes bought on a contestant’s page are cast for them as soon as the payment is confirmed. Off (recommended): bought votes go to the voter’s balance and they vote themselves, so a late payment never lands in a closed round."
              checked={draft.buy_and_vote}
              onChange={(v) => set('buy_and_vote', v)}
            />
            <Input label="Price per single vote (Rs)" type="number" min={0} step="0.01" value={draft.price_per_vote ?? ''} onChange={(e) => set('price_per_vote', e.target.value || null)} containerClassName="max-w-xs" hint="Optional" />
            {packs.map((p, i) => (
              <div key={p.id ?? `p-${i}`} className="grid grid-cols-1 items-end gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-[minmax(0,1fr)_90px_90px_110px_auto]">
                <Input label="Pack name" placeholder="Fan pack" value={p.label} onChange={(e) => updatePack(i, { label: e.target.value })} />
                <Input label="Votes" type="number" min={1} value={p.votes} onChange={(e) => updatePack(i, { votes: Number(e.target.value) })} />
                <Input label="Bonus" type="number" min={0} value={p.bonus_votes} onChange={(e) => updatePack(i, { bonus_votes: Number(e.target.value) })} />
                <Input label="Price (Rs)" type="number" min={0} step="0.01" value={p.price} onChange={(e) => updatePack(i, { price: e.target.value })} />
                <IconButton label="Remove pack" onClick={() => set('vote_packs', packs.filter((_, j) => j !== i))} className="mb-0.5 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
              </div>
            ))}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set('vote_packs', [...packs, { label: '', votes: 10, bonus_votes: 0, price: '100', is_active: true }])}>Add pack</Button>
            <p className="text-xs text-ink-500">Khalti takes payments of Rs 10 or more; cheaper packs can only be paid with eSewa.</p>
          </>
        )}
      </div>}

      <div className="space-y-3 border-t border-ink-100 pt-4">
        <h3 className="text-sm font-bold text-ink-900">Protection against cheating</h3>
        <Toggle
          label="“I’m not a robot” check (Cloudflare Turnstile)"
          hint={contest.captcha_available ? 'Asked before sending codes and before each vote.' : 'Not configured on this server (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY), so it stays off.'}
          checked={draft.captcha_enabled}
          onChange={(v) => set('captcha_enabled', v)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LimitField label="Votes per minute from one network" min={0} value={draft.ip_votes_per_minute} onChange={(v) => set('ip_votes_per_minute', v ?? 0)} placeholder="0 = no limit" hint="Keep it high for college Wi-Fi and live venues" />
          <LimitField label="Votes per minute from one phone" min={0} value={draft.device_votes_per_minute} onChange={(v) => set('device_votes_per_minute', v ?? 0)} placeholder="0 = no limit" />
        </div>
        <p className="text-sm text-ink-600">Flag for review (votes still count until you void them):</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LimitField label="Votes from one IP in 10 min" min={0} value={draft.flag_ip_burst} onChange={(v) => set('flag_ip_burst', v ?? 0)} placeholder="0 = off" />
          <LimitField label="From one network range in 10 min" min={0} value={draft.flag_subnet_burst} onChange={(v) => set('flag_subnet_burst', v ?? 0)} placeholder="0 = off" />
          <LimitField label="Voters on one phone" min={0} value={draft.flag_device_voters} onChange={(v) => set('flag_device_voters', v ?? 0)} placeholder="0 = off" />
        </div>
        <Toggle label="Show a transparency note on the contest page" checked={draft.show_transparency} onChange={(v) => set('show_transparency', v)} />
        {draft.show_transparency && (
          <Textarea label="Transparency note" rows={3} placeholder="Votes are verified by SMS. Suspicious votes are reviewed and may be voided; the final tally is audited by…" value={draft.transparency_note} onChange={(e) => set('transparency_note', e.target.value)} />
        )}
      </div>
    </Section>
  )
}

/* ---------- 7. Results ---------- */

const ResultsSection: React.FC<Omit<SectionProps, 'contest'>> = ({ draft, set }) => (
  <Section id="results" title="7. Results & display" description="What the public sees. Rounds can override this. You always see everything.">
    <ChoiceGroup
      legend="Public results"
      name="visibility"
      value={draft.results_visibility}
      onChange={(v) => set('results_visibility', v as Visibility)}
      options={Object.entries(visibilityInfo).map(([value, label]) => ({ value, label }))}
    />
    {draft.results_visibility === 'top_n' && <LimitField label="How many to show" value={draft.results_top_n} onChange={(v) => set('results_top_n', v ?? 3)} className="max-w-xs" />}
    <Select
      label="Notify contestants"
      hint="When they're added, when a round is decided and when winners are announced. Uses the email and phone from their application. SMS needs an Aakash SMS account on the server."
      value={draft.contestant_notify ?? 'email'}
      onChange={(e) => set('contestant_notify', e.target.value as Draft['contestant_notify'])}
      containerClassName="max-w-md"
    >
      <option value="off">Off</option>
      <option value="email">Email</option>
      <option value="sms">SMS</option>
      <option value="both">Email and SMS</option>
    </Select>
    <Toggle label="Show the judges / public split in public results" hint="Only when vote counts are shown." checked={draft.show_judge_breakdown} onChange={(v) => set('show_judge_breakdown', v)} />
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-800">Placement titles (for the winner reveal)</p>
      {draft.placement_titles.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-sm font-bold text-ink-500">{i + 1}.</span>
          <input aria-label={`Title for place ${i + 1}`} value={t} onChange={(e) => set('placement_titles', draft.placement_titles.map((x, j) => (j === i ? e.target.value : x)))} className="block w-full max-w-xs rounded-[10px] border border-ink-200 px-3 py-2 text-sm" />
          <IconButton label="Remove title" onClick={() => set('placement_titles', draft.placement_titles.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></IconButton>
        </div>
      ))}
      <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => set('placement_titles', [...draft.placement_titles, `${ordinal(draft.placement_titles.length)} runner-up`])}>Add place</Button>
    </div>
  </Section>
)

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

/* ---------- 8. Review ---------- */

const ReviewSection: React.FC<{ draft: Draft; contest: Contest; dirty: boolean; onSave: () => void; saving: boolean }> = ({ draft, contest, dirty, onSave, saving }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const checks = useMemo(() => {
    const out: { ok: boolean; text: string; warn?: boolean }[] = []
    out.push({ ok: contest.stats.contestants > 0, text: contest.stats.contestants ? `${contest.stats.contestants} contestants` : 'Add contestants' })
    if (draft.rounds.length) {
      out.push({ ok: true, text: `${draft.rounds.length} rounds: ${draft.rounds.map((r) => r.name).join(' → ')}` })
      const noCriteria = draft.rounds.filter((r) => r.judging_enabled && !r.criteria.length)
      if (noCriteria.length) out.push({ ok: false, text: `Add judging criteria for ${noCriteria.map((r) => r.name).join(', ')}` })
      if (draft.rounds.some((r) => r.judging_enabled) && contest.judges.length === 0) out.push({ ok: false, text: 'Add judges (some rounds are judged)' })
      if (!draft.rounds.some((r) => r.status === 'open' || r.opens_at)) out.push({ ok: false, warn: true, text: 'No round is open or scheduled: voters can’t vote until you open one' })
    } else out.push({ ok: true, text: 'One public vote (no rounds)' })
    out.push({ ok: true, text: `Verification: ${voteModeInfo[draft.vote_mode].label}` })
    if (draft.vote_mode === 'sms_otp' && contest.sms_provider === 'console') out.push({ ok: false, warn: true, text: 'SMS isn’t connected on this server (codes go to the log)' })
    if (['open', 'contact'].includes(draft.vote_mode)) out.push({ ok: false, warn: true, text: 'This verification is easy to cheat; use SMS or email codes for public voting' })
    out.push({ ok: true, text: `Votes: ${allowanceText(draft)}${draft.allow_split ? '' : ', all to one contestant'}` })
    out.push({ ok: true, text: `Public results: ${visibilityInfo[draft.results_visibility]}` })
    if (draft.paid_votes_enabled) {
      out.push(contest.payments.available
        ? { ok: true, text: `Paid votes on sale (${draft.vote_packs.length} pack${draft.vote_packs.length === 1 ? '' : 's'}${draft.buy_and_vote ? ', buy and vote' : ''})` }
        : { ok: false, warn: true, text: `Paid votes not on sale: ${contest.payments.message ?? 'save first'}` })
    }
    return out
  }, [draft, contest])

  const open = useMutation({
    mutationFn: () => contestApi.setStatus(contest.id, 'open'),
    onSuccess: (c) => {
      qc.setQueryData(['contest', c.id], c)
      toast.success('Contest is public', 'Voting happens in whichever round is open.')
    },
    onError: (e: Error) => toast.error('Couldn’t open voting', e.message),
  })

  return (
    <Section id="review" title="8. Review">
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.text} className="flex items-start gap-2 text-sm">
            {c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', c.warn ? 'text-marigold-600' : 'text-red-600')} aria-hidden />}
            <span className={c.ok ? 'text-ink-700' : 'font-medium text-ink-900'}>{c.text}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {dirty && <Button loading={saving} onClick={onSave}>Save changes</Button>}
        {contest.status !== 'open' && !dirty && <Button icon={<Trophy className="h-4 w-4" />} loading={open.isPending} onClick={() => open.mutate()}>Make public and open voting</Button>}
        <ButtonLink variant="secondary" to={`/app/voting/contests/${contest.id}`} icon={<BarChart3 className="h-4 w-4" />}>Go to dashboard</ButtonLink>
        <a href={contestPath(contest.event_slug, contestRef(contest))} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold text-ink-600 hover:bg-ink-100">
          <ExternalLink className="h-4 w-4" aria-hidden /> Public page
        </a>
      </div>
    </Section>
  )
}
