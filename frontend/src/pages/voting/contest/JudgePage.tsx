/**
 * Judges' scoring screens (/judge and /judge/:judgeId). Standalone, no app shell: judges use a tablet or phone at
 * the venue. One contestant at a time, a slider + number box per criterion, autosaved drafts, submit locks the sheet.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gavel,
  LayoutGrid,
  Lock,
  LogOut,
  Save,
  Users,
} from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, Logo, Modal, Skeleton, Textarea, useToast } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { contestApi, type JudgeRoundInfo, type JudgeSheetData } from './api'
import { ContestantPhoto, NumberTag } from './shared'

type Contestant = JudgeSheetData['contestants'][number]
type Criteria = JudgeRoundInfo['criteria']

/** Σ(points × weight) / Σ(max × weight) × 100 — same formula as the server (scoring.sheet_percent). */
export function sheetPercent(scores: Record<string, number | string | undefined>, criteria: Criteria) {
  let num = 0
  let den = 0
  for (const c of criteria) {
    const raw = Number(scores[c.id])
    const pts = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), c.max_points) : 0
    num += pts * c.weight
    den += c.max_points * c.weight
  }
  return den ? (num * 100) / den : 0
}

const roundStatusLabel = (r: JudgeRoundInfo) =>
  r.finalized ? 'Decided' : r.status === 'upcoming' ? 'Not started' : r.status === 'open' ? 'Open' : 'Closed'

const Shell: React.FC<{ children: React.ReactNode; header?: React.ReactNode }> = ({ children, header }) => (
  <div className="flex min-h-dvh flex-col bg-ink-50">
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">{header}</div>
    </header>
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
      {children}
    </main>
  </div>
)

/* ------------------------------------------------------------------ */
/* /judge                                                               */

export const JudgeHomePage: React.FC = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['my-judging'], queryFn: contestApi.myJudging })

  const header = (
    <>
      <Link to="/" aria-label="Eventlaya home" className="mr-auto">
        <Logo className="origin-left scale-90" />
      </Link>
      <span className="hidden truncate text-sm text-ink-500 sm:inline">{user?.email}</span>
      <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={() => { logout(); navigate('/login') }}>
        Sign out
      </Button>
    </>
  )

  return (
    <Shell header={header}>
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Gavel className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Judging</h1>
          <p className="text-sm text-ink-500">Contests you’ve been invited to score.</p>
        </div>
      </div>
      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Gavel className="h-6 w-6" />}
            title="You aren’t judging any contest"
            description="When an organizer adds you as a judge, the contest shows up here. Check you’re signed in with the email they invited."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => { logout(); navigate('/login') }}>Sign in with another account</Button>
                <Link to="/" className="inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-semibold text-ink-600 hover:bg-ink-100">Back to Eventlaya</Link>
              </div>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((a) => {
            const expected = a.progress.reduce((s, p) => s + p.expected, 0)
            const done = a.progress.reduce((s, p) => s + p.submitted, 0)
            return (
              <li key={a.id}>
                <Card className="flex h-full flex-col overflow-hidden">
                  {a.cover_url && <img src={a.cover_url} alt="" className="h-28 w-full object-cover" />}
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <p className="text-sm text-ink-500">{a.event}</p>
                      <h2 className="text-lg font-bold text-ink-900">{a.contest}</h2>
                    </div>
                    {a.progress.length === 0 ? (
                      <p className="text-sm text-ink-500">No judged rounds are set up yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {a.progress.map((p) => (
                          <li key={p.round_id}>
                            <div className="flex justify-between text-sm">
                              <span className="font-medium text-ink-800">{p.name}</span>
                              <span className="tabular text-ink-500">{p.submitted}/{p.expected} submitted</span>
                            </div>
                            <ProgressBar value={p.submitted} max={p.expected} label={`${p.name} progress`} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                      {a.scoring_open ? <Badge tone="success" dot>Scoring open</Badge> : <Badge>Not open for scoring</Badge>}
                      <Button onClick={() => navigate(`/judge/${a.id}`)} icon={<ClipboardList className="h-4 w-4" />}>
                        {done === 0 ? 'Start scoring' : done >= expected && expected > 0 ? 'Review scores' : 'Continue scoring'}
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </Shell>
  )
}

const ProgressBar: React.FC<{ value: number; max: number; label: string; className?: string }> = ({ value, max, label, className }) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={value}
    className={cn('mt-1 h-2 overflow-hidden rounded-full bg-ink-100', className)}
  >
    <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
  </div>
)

/* ------------------------------------------------------------------ */
/* /judge/:judgeId                                                      */

export const JudgeScoringPage: React.FC = () => {
  const { judgeId } = useParams<{ judgeId: string }>()
  const [params, setParams] = useSearchParams()
  const roundParam = params.get('round') || undefined
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['judge-sheet', judgeId, roundParam ?? null],
    queryFn: () => contestApi.judgeSheet(judgeId!, roundParam),
    refetchInterval: 20000,
  })
  const [index, setIndex] = useState(0)
  const [showGrid, setShowGrid] = useState(false)

  const contestants = data?.contestants ?? []
  const round = data?.round ?? null
  const submitted = contestants.filter((c) => c.sheet?.status === 'submitted').length

  // Start on the first contestant still to score
  const roundKey = round?.id
  const started = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!roundKey || started.current === roundKey) return
    started.current = roundKey
    const first = contestants.findIndex((c) => c.sheet?.status !== 'submitted')
    setIndex(first >= 0 ? first : 0)
  }, [roundKey, contestants])

  const header = (
    <>
      <Link to="/judge" className="inline-flex h-9 items-center gap-1 rounded-[10px] px-2 text-sm font-semibold text-ink-600 hover:bg-ink-100" aria-label="All contests">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Contests</span>
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-ink-500">{data?.contest.event ?? ' '}</p>
        <p className="truncate font-bold text-ink-900">{data?.contest.title ?? 'Loading…'}</p>
      </div>
      {data && data.rounds.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Round</span>
          <select
            value={round?.id ?? ''}
            onChange={(e) => setParams({ round: e.target.value })}
            className="h-9 max-w-[11rem] rounded-[10px] border border-ink-200 bg-white px-2 text-sm font-semibold text-ink-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {data.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {roundStatusLabel(r)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )

  if (isError) {
    return (
      <Shell header={header}>
        <ErrorState message={error?.message || 'You may not be a judge of this contest, or the organizer removed you.'} onRetry={refetch} />
      </Shell>
    )
  }
  if (isLoading || !data) {
    return (
      <Shell header={header}>
        <Skeleton className="mb-4 h-10 rounded-xl" />
        <Skeleton className="h-[28rem] rounded-2xl" />
      </Shell>
    )
  }
  if (!round) {
    return (
      <Shell header={header}>
        <Card><EmptyState icon={<Gavel className="h-6 w-6" />} title="No judged rounds yet" description="The organizer hasn’t set up a round with judges’ scoring. Check back later." /></Card>
      </Shell>
    )
  }

  const current = contestants[Math.min(index, Math.max(0, contestants.length - 1))]
  const go = (i: number) => {
    setIndex(Math.max(0, Math.min(contestants.length - 1, i)))
    setShowGrid(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <Shell header={header}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-[12rem] flex-1">
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-ink-800">{round.name}</span>
              <span className="tabular text-ink-500" aria-live="polite">{submitted} of {contestants.length} submitted</span>
            </div>
            <ProgressBar value={submitted} max={contestants.length} label={`${round.name}: sheets submitted`} />
          </div>
          <Button variant="secondary" size="sm" icon={<LayoutGrid className="h-4 w-4" />} onClick={() => setShowGrid((v) => !v)} aria-expanded={showGrid}>
            All contestants
          </Button>
        </div>

        <RoundNotice round={round} excluded={data.contest.excluded_count ?? 0} />

        {showGrid && (
          <Card className="p-3">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {contestants.map((c, i) => (
                <li key={c.id}>
                  <button
                    onClick={() => go(i)}
                    aria-current={i === index ? 'true' : undefined}
                    className={cn(
                      'relative flex w-full flex-col items-center gap-1 rounded-xl border p-2 text-center transition-colors',
                      i === index ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:bg-ink-50',
                    )}
                  >
                    <ContestantPhoto name={c.name} photo={c.photo_url} className="h-14 w-14" rounded="rounded-xl" />
                    <span className="w-full truncate text-xs font-semibold text-ink-800">{c.display_number || c.name}</span>
                    {c.sheet?.status === 'submitted' ? (
                      <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 text-emerald-600" aria-label="Submitted" />
                    ) : c.sheet ? (
                      <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-marigold-500" aria-label="Draft" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {contestants.length === 0 ? (
          <Card>
            <EmptyState icon={<Users className="h-6 w-6" />} title="Nobody to score in this round" description="The organizer hasn’t added contestants to this round yet." />
          </Card>
        ) : current ? (
          <ScoreCard
            key={`${round.id}:${current.id}`}
            judgeId={judgeId!}
            round={round}
            contestant={current}
            showOthers={Boolean(data.contest.judges_see_others)}
            position={`${index + 1} of ${contestants.length}`}
            onNext={index < contestants.length - 1 ? () => go(index + 1) : undefined}
          />
        ) : null}
      </div>

      {contestants.length > 1 && (
        <nav aria-label="Contestants" className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
            <Button variant="secondary" disabled={index === 0} onClick={() => go(index - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <p className="min-w-0 flex-1 truncate text-center text-sm text-ink-600">
              {current && <><span className="font-semibold text-ink-900">{current.display_number} {current.name}</span> · {index + 1}/{contestants.length}</>}
            </p>
            <Button variant="secondary" disabled={index >= contestants.length - 1} onClick={() => go(index + 1)}>
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      )}
    </Shell>
  )
}

const RoundNotice: React.FC<{ round: JudgeRoundInfo; excluded: number }> = ({ round, excluded }) => {
  const notes: { tone: 'warn' | 'info' | 'lock'; text: string }[] = []
  if (round.finalized) notes.push({ tone: 'lock', text: `${round.name} has been decided. Scores are final.` })
  else if (round.status === 'upcoming') notes.push({ tone: 'warn', text: `${round.name} hasn’t started yet. You can look around; scoring opens when the organizer starts the round.` })
  if (excluded > 0) notes.push({ tone: 'info', text: `You’ve been excused from ${excluded} contestant${excluded === 1 ? '' : 's'} (conflict of interest), so they aren’t listed.` })
  if (!notes.length) return null
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <p
          key={n.text}
          className={cn(
            'flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm',
            n.tone === 'warn' && 'bg-marigold-50 text-marigold-900',
            n.tone === 'info' && 'bg-sky-50 text-sky-900',
            n.tone === 'lock' && 'bg-ink-100 text-ink-800',
          )}
        >
          {n.tone === 'lock' && <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {n.text}
        </p>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* One contestant's sheet                                               */

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const ScoreCard: React.FC<{
  judgeId: string
  round: JudgeRoundInfo
  contestant: Contestant
  showOthers: boolean
  position: string
  onNext?: () => void
}> = ({ judgeId, round, contestant: c, showOthers, position, onNext }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const sheet = c.sheet
  const locked = sheet?.status === 'submitted' || !round.can_score
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(round.criteria.map((cr) => [cr.id, sheet?.scores?.[cr.id] !== undefined ? String(sheet.scores[cr.id]) : ''])),
  )
  const [comment, setComment] = useState(sheet?.comment ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [confirming, setConfirming] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const numeric = useMemo(() => Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v === '' ? undefined : Number(v)])), [scores])
  const total = sheetPercent(numeric, round.criteria)
  const missing = round.criteria.filter((cr) => scores[cr.id] === '' || !Number.isFinite(Number(scores[cr.id])))

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['judge-sheet', judgeId] })
    queryClient.invalidateQueries({ queryKey: ['my-judging'] })
  }

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      contestApi.saveSheet(judgeId, {
        round: round.id,
        contestant: c.id,
        scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== '')),
        comment,
        submit,
      }),
    onMutate: () => setSaveState('saving'),
    onSuccess: (res, submit) => {
      setSaveState('saved')
      setErrors({})
      invalidate()
      if (submit) {
        setConfirming(false)
        toast.success('Scores submitted', `${c.display_number} ${c.name}: ${res.percent.toFixed(1)}%`)
        onNext?.()
      }
    },
    onError: (e: Error & { data?: unknown }, submit) => {
      setSaveState('error')
      const fields = (e.data as { fields?: Record<string, string> } | undefined)?.fields
      if (fields) setErrors(fields)
      if (submit) setConfirming(false)
      toast.error(submit ? 'Scores not submitted' : 'Draft not saved', e.message)
    },
  })

  // Autosave drafts ~1 s after the last change
  const dirtyTick = useRef(0)
  useEffect(() => {
    if (saveState !== 'dirty' || locked) return
    const tick = ++dirtyTick.current
    const t = setTimeout(() => {
      if (tick === dirtyTick.current) save.mutate(false)
    }, 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, comment, saveState, locked])

  const setScore = (id: string, value: string) => {
    setScores((s) => ({ ...s, [id]: value }))
    setErrors((e) => ({ ...e, [id]: '' }))
    setSaveState('dirty')
  }

  const statusText =
    sheet?.status === 'submitted'
      ? 'Submitted'
      : saveState === 'saving'
        ? 'Saving…'
        : saveState === 'saved'
          ? 'Draft saved'
          : saveState === 'dirty'
            ? 'Unsaved changes'
            : saveState === 'error'
              ? 'Not saved'
              : sheet
                ? 'Draft'
                : 'Not scored yet'

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="relative bg-ink-100">
          <ContestantPhoto name={c.name} photo={c.photo_url} className="aspect-[4/5] w-full max-md:max-h-[42vh] text-6xl" rounded="rounded-none" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 text-white">
            <NumberTag value={c.display_number} className="bg-white text-ink-900" />
            <h2 className="mt-1.5 text-2xl font-bold leading-tight">{c.name}</h2>
            {c.subtitle && <p className="text-sm text-white/80">{c.subtitle}</p>}
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-500">{position}</p>
            <span
              aria-live="polite"
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-medium',
                sheet?.status === 'submitted' ? 'text-emerald-700' : saveState === 'error' ? 'text-red-600' : 'text-ink-500',
              )}
            >
              {sheet?.status === 'submitted' ? <Lock className="h-4 w-4" aria-hidden /> : saveState === 'saved' ? <Check className="h-4 w-4" aria-hidden /> : null}
              {statusText}
            </span>
          </div>

          {sheet?.status === 'submitted' && (
            <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              You submitted these scores. Ask the organizer to unlock the sheet if you need to change them.
            </p>
          )}

          <fieldset disabled={locked} className="space-y-5">
            <legend className="sr-only">Scores for {c.name}</legend>
            {round.criteria.map((cr) => (
              <CriterionInput key={cr.id} criterion={cr} value={scores[cr.id] ?? ''} error={errors[cr.id]} onChange={(v) => setScore(cr.id, v)} />
            ))}
            <Textarea
              label="Comment"
              rows={3}
              placeholder="Optional. Only the organizer sees it."
              value={comment}
              onChange={(e) => { setComment(e.target.value); setSaveState('dirty') }}
            />
          </fieldset>

          <div className="flex items-center justify-between rounded-2xl bg-ink-900 px-4 py-3 text-white">
            <span className="text-sm text-white/70">Total</span>
            <span className="font-display text-3xl font-bold tabular" aria-live="polite" aria-label={`Total ${total.toFixed(1)} percent`}>
              {total.toFixed(1)}<span className="text-lg text-white/60">%</span>
            </span>
          </div>

          {showOthers && c.others && c.others.length > 0 && (
            <details className="group rounded-xl border border-ink-200 bg-white">
              <summary className="flex cursor-pointer items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-ink-700">
                Other judges ({c.others.length})
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="divide-y divide-ink-100 border-t border-ink-100">
                {c.others.map((o) => (
                  <li key={o.judge} className="flex justify-between px-3.5 py-2 text-sm">
                    <span className="text-ink-700">{o.judge}</span>
                    <span className="font-semibold tabular text-ink-900">{o.percent.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!locked && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="sm:flex-1" icon={<Save className="h-4 w-4" />} loading={save.isPending && !confirming} onClick={() => save.mutate(false)}>
                Save draft
              </Button>
              <Button
                className="sm:flex-1"
                icon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => {
                  if (missing.length) {
                    const errs = Object.fromEntries(missing.map((m) => [m.id, `Score ${m.name} before submitting.`]))
                    setErrors(errs)
                    toast.error('Score every criterion first', missing.map((m) => m.name).join(', '))
                    return
                  }
                  setConfirming(true)
                }}
              >
                Submit scores
              </Button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Submit scores for ${c.display_number} ${c.name}?`}
        description="You can’t change them after submitting unless the organizer unlocks the sheet."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Keep editing</Button>
            <Button loading={save.isPending} onClick={() => save.mutate(true)}>Submit {total.toFixed(1)}%</Button>
          </>
        }
      >
        <ul className="space-y-1 text-sm">
          {round.criteria.map((cr) => (
            <li key={cr.id} className="flex justify-between">
              <span className="text-ink-600">{cr.name}</span>
              <span className="font-semibold tabular text-ink-900">{scores[cr.id]} / {cr.max_points}</span>
            </li>
          ))}
        </ul>
        {comment.trim() && <p className="mt-3 rounded-lg bg-ink-50 p-2.5 text-sm text-ink-700">“{comment.trim()}”</p>}
      </Modal>
    </Card>
  )
}

const CriterionInput: React.FC<{
  criterion: Criteria[number]
  value: string
  error?: string
  onChange: (v: string) => void
}> = ({ criterion: cr, value, error, onChange }) => {
  const id = `crit-${cr.id}`
  const num = value === '' ? 0 : Number(value)
  const clamp = (v: string) => {
    if (v === '') return ''
    const n = Number(v)
    if (!Number.isFinite(n)) return value
    return String(Math.min(Math.max(n, 0), cr.max_points))
  }
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="min-w-0">
          <span className="block font-semibold text-ink-900">{cr.name}</span>
          {cr.description && <span className="block text-xs text-ink-500">{cr.description}</span>}
          {cr.weight !== 1 && <span className="block text-xs text-ink-500">Weight ×{cr.weight}</span>}
        </label>
        <div className="flex shrink-0 items-baseline gap-1">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            max={cr.max_points}
            step={0.5}
            value={value}
            placeholder="–"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => onChange(clamp(e.target.value))}
            className="h-12 w-20 rounded-xl border border-ink-200 bg-white text-center font-display text-2xl font-bold tabular text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50"
          />
          <span className="text-sm text-ink-500">/{cr.max_points}</span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={cr.max_points}
        step={0.5}
        value={num}
        aria-label={`${cr.name} slider, 0 to ${cr.max_points}`}
        onChange={(e) => onChange(e.target.value)}
        className="mt-3 h-8 w-full cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
      />
      {error && <p id={`${id}-err`} className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
