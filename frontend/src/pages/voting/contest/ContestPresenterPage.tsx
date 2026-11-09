/**
 * Big-screen show tools for a contest (/app/voting/contests/:id/present): leaderboard, organizer-controlled winner
 * reveal, countdown and a vote QR. Lives outside the app shell; themed with the organizer's white-label colours.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ModernQr } from '@/components/ModernQr'
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Crown, ListOrdered, Maximize, Minimize, QrCode, Sparkles, Trophy } from 'lucide-react'
import { ErrorState, Logo, Skeleton } from '@/components/ui'
import { brandPalette, hexToRgb } from '@/lib/tenant'
import { cn } from '@/lib/utils'
import { fmtCountdown, useCountdown } from '../shared'
import { contestApi, contestPath, type Contest, type ContestResults, type Standings } from './api'
import { ContestantPhoto, NumberTag, fmtScore } from './shared'

type Mode = 'leaderboard' | 'reveal' | 'countdown' | 'qr'
const MODES: { key: Mode; label: string; icon: React.ReactNode }[] = [
  { key: 'leaderboard', label: 'Leaderboard', icon: <ListOrdered className="h-4 w-4" aria-hidden /> },
  { key: 'reveal', label: 'Reveal', icon: <Crown className="h-4 w-4" aria-hidden /> },
  { key: 'countdown', label: 'Countdown', icon: <Clock className="h-4 w-4" aria-hidden /> },
  { key: 'qr', label: 'Vote QR', icon: <QrCode className="h-4 w-4" aria-hidden /> },
]

interface RevealSlot {
  title: string
  name: string
  displayNumber: string
  photo: string
  tied?: boolean
}

/** Organizer's colours when their white-label is approved (contest.brand), else Eventlaya's brand tokens. */
function useBrandStyle(brand: Contest['brand'] | undefined): React.CSSProperties | undefined {
  return useMemo(() => {
    if (!brand?.primary_color) return undefined
    const palette = brandPalette(brand.primary_color)
    if (!palette) return undefined
    const style: Record<string, string> = {}
    for (const [k, rgb] of Object.entries(palette)) style[`--brand-${k}`] = rgb.join(' ')
    const accent = hexToRgb(brand.accent_color || '')
    if (accent) style['--tenant-accent'] = accent.join(' ')
    return style as React.CSSProperties
  }, [brand])
}

export const ContestPresenterPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))
  const [mode, setMode] = useState<Mode>('leaderboard')
  const [roundId, setRoundId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [topN, setTopN] = useState(10)
  const [showBreakdown, setShowBreakdown] = useState(true)
  const [step, setStep] = useState(0)

  const contestQ = useQuery({ queryKey: ['contest', id], queryFn: () => contestApi.get(id!), refetchInterval: 10000 })
  const resultsQ = useQuery({ queryKey: ['contest-results', id], queryFn: () => contestApi.results(id!), refetchInterval: 3000 })
  const contest = contestQ.data
  const brandStyle = useBrandStyle(contest?.brand)
  const results = resultsQ.data

  // Default round: the open one, else the last that has started, else the last
  const defaultRound = useMemo(() => {
    const rs = contest?.rounds ?? []
    const open = rs.find((r) => (r.computed_status ?? r.status) === 'open')
    const started = [...rs].reverse().find((r) => (r.computed_status ?? r.status) !== 'upcoming')
    return open?.id ?? started?.id ?? rs[rs.length - 1]?.id ?? ''
  }, [contest?.rounds])
  const activeRound = roundId || defaultRound
  const standings: Standings | null = useMemo(() => {
    if (!results) return null
    if (!activeRound) return results.overall
    return results.rounds.find((r) => r.round?.id === activeRound) ?? results.overall
  }, [results, activeRound])

  const slots = useMemo(() => buildSlots(contest, results, standings, categoryId), [contest, results, standings, categoryId])
  useEffect(() => setStep(0), [categoryId, activeRound])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const next = useCallback(() => setStep((s) => Math.min(s + 1, slots.length)), [slots.length])
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      if (k === 'f' || k === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (k === 'Escape' && !document.fullscreenElement) {
        navigate(`/app/voting/contests/${id}`)
      } else if (['1', '2', '3', '4'].includes(k)) {
        setMode(MODES[Number(k) - 1].key)
      } else if (mode === 'reveal' && (k === ' ' || k === 'ArrowRight' || k === 'PageDown' || k === 'Enter')) {
        e.preventDefault()
        next()
      } else if (mode === 'reveal' && (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace')) {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, navigate, mode, next, back])

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined)
    return () => void lock?.release().catch(() => undefined)
  }, [])

  if (contestQ.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <div className="max-w-md space-y-4">
          <ErrorState message={contestQ.error?.message} onRetry={() => contestQ.refetch()} />
          <Link to="/app/voting" className="text-sm font-semibold text-brand-700 underline">Back to voting</Link>
        </div>
      </div>
    )
  }

  const voteUrl = contest ? `${window.location.origin}${contestPath(contest.event_slug, contest.slug || contest.id)}` : ''
  const openRound = contest?.rounds.find((r) => (r.computed_status ?? r.status) === 'open')
  const countdownTarget = openRound?.closes_at ?? (contest?.status === 'open' ? contest.closes_at : contest?.status === 'scheduled' ? contest.opens_at : null)

  return (
    <div style={brandStyle} className="flex min-h-screen flex-col bg-gradient-to-b from-white to-brand-50/70 text-ink-900">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 lg:px-12 lg:pt-8">
        <div className="flex min-w-0 items-center gap-4">
          <Logo className="shrink-0" />
          {contest && <p className="hidden truncate text-lg text-ink-500 md:block lg:text-xl">{contest.event_title}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <div role="tablist" aria-label="Presenter mode" className="flex rounded-xl bg-white/80 p-1 shadow-xs">
            {MODES.map((m, i) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => setMode(m.key)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold',
                  mode === m.key ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100',
                )}
              >
                {m.icon}
                <span className="hidden sm:inline">{m.label}</span>
                <kbd className={cn('hidden rounded px-1 text-[11px] lg:inline', mode === m.key ? 'bg-white/20' : 'border border-ink-200')}>{i + 1}</kbd>
              </button>
            ))}
          </div>
          {contest && contest.rounds.length > 0 && (
            <select
              aria-label="Round"
              value={activeRound}
              onChange={(e) => setRoundId(e.target.value)}
              className="h-10 rounded-xl border border-ink-200 bg-white px-2 text-sm font-semibold"
            >
              {contest.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <button onClick={toggleFullscreen} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ink-700 hover:bg-white">
            {fullscreen ? <Minimize className="h-4 w-4" aria-hidden /> : <Maximize className="h-4 w-4" aria-hidden />}
            <span className="hidden md:inline">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
          </button>
          <Link to={`/app/voting/contests/${id}`} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ink-700 hover:bg-white">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Exit <kbd className="hidden rounded border border-ink-200 bg-white px-1.5 text-xs md:inline">Esc</kbd>
          </Link>
        </div>
      </header>

      {!contest || !results ? (
        <div className="flex-1 space-y-6 p-12">
          <Skeleton className="h-20 w-2/3" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : (
        <main className="flex flex-1 flex-col px-6 pb-8 pt-6 lg:px-12 lg:pb-12">
          <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl xl:text-6xl">{contest.title}</h1>
          {standings?.round && <p className="mt-2 text-xl text-ink-600 lg:text-2xl">{standings.round.name}</p>}
          <div className="mt-8 flex flex-1 flex-col lg:mt-10">
            {mode === 'leaderboard' && (
              <Leaderboard
                standings={standings}
                topN={topN}
                setTopN={setTopN}
                showBreakdown={showBreakdown}
                setShowBreakdown={setShowBreakdown}
              />
            )}
            {mode === 'reveal' && (
              <Reveal
                contest={contest}
                slots={slots}
                step={step}
                onNext={next}
                onBack={back}
                categoryId={categoryId}
                setCategoryId={setCategoryId}
              />
            )}
            {mode === 'countdown' && <Countdown target={countdownTarget ?? null} label={openRound ? `${openRound.name} voting closes in` : 'Voting closes in'} voteUrl={voteUrl} contest={contest} />}
            {mode === 'qr' && <VoteQr voteUrl={voteUrl} contest={contest} roundName={openRound?.name} />}
          </div>
        </main>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function buildSlots(contest: Contest | undefined, results: ContestResults | undefined, standings: Standings | null, categoryId: string): RevealSlot[] {
  if (!contest || !results) return []
  const titles = contest.placement_titles?.length ? contest.placement_titles : ['Winner', '1st runner-up', '2nd runner-up']
  if (categoryId) {
    const cat = results.categories.find((c) => c.category.id === categoryId)
    if (!cat) return []
    const winner = cat.category.winner_id ? cat.rows.find((r) => r.contestant_id === cat.category.winner_id) : cat.rows.find((r) => r.rank === 1)
    if (!winner) return []
    return [{ title: cat.category.name, name: winner.name, displayNumber: winner.display_number, photo: winner.photo_url, tied: winner.tied }]
  }
  if (!standings) return []
  const rows = standings.rows.filter((r) => r.status !== 'withdrawn')
  // rank 1 = titles[0] (Winner), revealed last
  return titles
    .map((title, i): RevealSlot | null => {
      const r = rows[i]
      return r ? { title, name: r.name, displayNumber: r.display_number, photo: r.photo_url, tied: r.tied } : null
    })
    .filter((s): s is RevealSlot => s !== null)
    .reverse()
}

const Leaderboard: React.FC<{
  standings: Standings | null
  topN: number
  setTopN: (n: number) => void
  showBreakdown: boolean
  setShowBreakdown: (v: boolean) => void
}> = ({ standings, topN, setTopN, showBreakdown, setShowBreakdown }) => {
  const reduce = useReducedMotion()
  if (!standings || standings.rows.length === 0) return <p className="text-2xl text-ink-500">No contestants in this round yet.</p>
  const rows = standings.rows.filter((r) => r.status !== 'withdrawn').slice(0, Math.max(1, topN))
  const max = Math.max(1, ...rows.map((r) => r.final))
  const mixed = standings.weights.judges > 0 && standings.weights.public > 0
  return (
    <section aria-live="polite" className="flex flex-1 flex-col">
      <div className="mb-5 flex flex-wrap items-center gap-4 text-sm text-ink-600 opacity-70 hover:opacity-100 focus-within:opacity-100">
        <label className="flex items-center gap-2">
          Show top
          <input type="number" min={1} max={100} value={topN} onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))} className="h-9 w-16 rounded-lg border border-ink-200 bg-white px-2 text-center" />
        </label>
        {mixed && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showBreakdown} onChange={(e) => setShowBreakdown(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
            Judges / public breakdown
          </label>
        )}
        <span>Judges {standings.weights.judges}% · Public {standings.weights.public}%</span>
      </div>
      <ol className="space-y-3 lg:space-y-4">
        {rows.map((r) => (
          <motion.li
            key={r.contestant_id}
            layout={!reduce}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className={cn('flex items-center gap-4 rounded-3xl border bg-white p-3 lg:gap-6 lg:p-4', r.rank === 1 ? 'border-brand-300 shadow-md' : 'border-ink-200')}
          >
            <span className={cn('w-12 shrink-0 text-center font-display text-3xl font-bold tabular lg:w-16 lg:text-5xl', r.rank === 1 ? 'text-brand-600' : 'text-ink-400')}>
              {r.rank}
            </span>
            <ContestantPhoto name={r.name} photo={r.photo_url} className="h-16 w-16 shrink-0 text-2xl lg:h-20 lg:w-20" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-3 text-2xl font-semibold lg:text-3xl">
                <NumberTag value={r.display_number} className="text-base lg:text-lg" />
                <span className="truncate">{r.name}</span>
                {r.tied && <span className="shrink-0 rounded-full bg-marigold-50 px-2.5 py-0.5 text-sm font-semibold text-marigold-800">Tied</span>}
              </p>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink-100 lg:h-4" aria-hidden>
                <motion.div
                  className={cn('h-full rounded-full', r.rank === 1 ? 'bg-brand-600' : 'bg-ink-300')}
                  initial={false}
                  animate={{ width: `${(r.final / max) * 100}%` }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 22 }}
                />
              </div>
              {mixed && showBreakdown && (
                <p className="mt-1.5 text-base text-ink-500 tabular lg:text-lg">
                  Judges {fmtScore(r.judge_score)} · Public {fmtScore(r.public_score)}
                </p>
              )}
            </div>
            <span className="shrink-0 text-right font-display text-3xl font-bold tabular lg:text-5xl">{fmtScore(r.final)}</span>
          </motion.li>
        ))}
      </ol>
    </section>
  )
}

const BURST = Array.from({ length: 24 }, (_, i) => i)

const Reveal: React.FC<{
  contest: Contest
  slots: RevealSlot[]
  step: number
  onNext: () => void
  onBack: () => void
  categoryId: string
  setCategoryId: (v: string) => void
}> = ({ contest, slots, step, onNext, onBack, categoryId, setCategoryId }) => {
  const reduce = useReducedMotion()
  const shown = step > 0 ? slots[step - 1] : null
  const isWinner = Boolean(shown) && step === slots.length && !categoryId
  const upcoming = step < slots.length ? slots[step] : null
  return (
    <section className="flex flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-600 opacity-70 hover:opacity-100 focus-within:opacity-100">
        <label className="flex items-center gap-2">
          Reveal
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 rounded-lg border border-ink-200 bg-white px-2">
            <option value="">Final placements (round ranking)</option>
            {contest.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <span>Space / → next · ← back</span>
        <span className="tabular">{step}/{slots.length}</span>
      </div>

      <div className="relative flex flex-1 items-center justify-center" aria-live="assertive">
        <AnimatePresence mode="wait">
          {!shown ? (
            <motion.div key="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <Sparkles className="mx-auto h-16 w-16 text-brand-500" aria-hidden />
              <p className="mt-6 font-display text-4xl font-bold lg:text-6xl">{slots.length ? 'And the results are…' : 'Nothing to reveal yet'}</p>
              {slots.length > 0 && upcoming && <p className="mt-4 text-2xl text-ink-500">Next: {upcoming.title}</p>}
            </motion.div>
          ) : (
            <motion.div
              key={`slot-${step}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotateX: 25 }}
              animate={{ opacity: 1, scale: 1, rotateX: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.05, y: -30 }}
              transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 140, damping: 16 }}
              className="relative w-full max-w-3xl text-center"
            >
              {isWinner && !reduce && (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  {BURST.map((i) => {
                    const angle = (i / BURST.length) * Math.PI * 2
                    const dist = 260 + (i % 4) * 60
                    return (
                      <motion.span
                        key={i}
                        className={cn('absolute left-1/2 top-1/3 h-3 w-3 rounded-sm', i % 3 === 0 ? 'bg-brand-500' : i % 3 === 1 ? 'bg-marigold-400' : 'bg-emerald-400')}
                        initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                        animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, rotate: 360 }}
                        transition={{ duration: 1.8, ease: 'easeOut', delay: 0.25 }}
                      />
                    )
                  })}
                </div>
              )}
              <p className={cn('font-display font-bold uppercase tracking-wide', isWinner ? 'text-4xl text-brand-600 lg:text-6xl' : 'text-3xl text-ink-600 lg:text-5xl')}>
                {isWinner && <Trophy className="mr-3 inline h-10 w-10 align-[-0.15em] lg:h-14 lg:w-14" aria-hidden />}
                {shown.title}
              </p>
              <ContestantPhoto
                name={shown.name}
                photo={shown.photo}
                className={cn('mx-auto mt-8 aspect-[4/5] object-cover text-7xl shadow-xl', isWinner ? 'w-72 ring-8 ring-marigold-300 lg:w-96' : 'w-56 lg:w-72')}
                rounded="rounded-[2rem]"
              />
              <p className="mt-6 flex items-center justify-center gap-4 font-display text-4xl font-bold lg:text-6xl">
                <NumberTag value={shown.displayNumber} className="px-3 py-1 text-2xl lg:text-3xl" />
                {shown.name}
              </p>
              {shown.tied && <p className="mt-3 text-xl text-marigold-700">Tied — check the tie-break before announcing.</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 flex justify-center gap-3 opacity-60 hover:opacity-100 focus-within:opacity-100">
        <button onClick={onBack} disabled={step === 0} className="inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 font-semibold disabled:opacity-40">
          <ChevronLeft className="h-5 w-5" aria-hidden /> Back
        </button>
        <button onClick={onNext} disabled={step >= slots.length} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 font-semibold text-white disabled:opacity-40">
          {upcoming ? `Reveal ${upcoming.title}` : 'Done'} <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </section>
  )
}

const Countdown: React.FC<{ target: string | null; label: string; voteUrl: string; contest: Contest }> = ({ target, label, voteUrl, contest }) => {
  const left = useCountdown(target)
  return (
    <section className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,26vw)]">
      <div className="text-center lg:text-left" aria-live="polite">
        {left === null ? (
          <p className="text-3xl text-ink-600 lg:text-4xl">{contest.status === 'open' ? 'Voting is open until the organizers close it.' : 'No closing time is set.'}</p>
        ) : left > 0 ? (
          <>
            <p className="flex items-center justify-center gap-3 text-3xl text-brand-800 lg:justify-start lg:text-4xl">
              <Clock className="h-9 w-9" aria-hidden />
              {contest.status === 'scheduled' ? 'Voting opens in' : label}
            </p>
            <p className="mt-4 font-display text-[22vw] font-bold leading-none text-brand-700 tabular lg:text-[13vw]">{fmtCountdown(left)}</p>
          </>
        ) : (
          <p className="font-display text-6xl font-bold text-ink-900 lg:text-8xl">Voting has closed</p>
        )}
      </div>
      <QrCard voteUrl={voteUrl} />
    </section>
  )
}

const VoteQr: React.FC<{ voteUrl: string; contest: Contest; roundName?: string }> = ({ voteUrl, contest, roundName }) => (
  <section className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
    <div className="text-center lg:text-left">
      <p className="font-display text-5xl font-bold lg:text-7xl">Scan to vote</p>
      <p className="mt-4 text-2xl text-ink-600 lg:text-3xl">
        {contest.status === 'open' ? (roundName ? `${roundName} voting is open` : 'Voting is open') : contest.status === 'closed' ? 'Voting has closed' : 'Voting opens soon'}
      </p>
      <p className="mt-6 break-all font-mono text-2xl text-ink-800 lg:text-3xl">{voteUrl.replace(/^https?:\/\//, '')}</p>
    </div>
    <QrCard voteUrl={voteUrl} large />
  </section>
)

const QrCard: React.FC<{ voteUrl: string; large?: boolean }> = ({ voteUrl, large }) => (
  <div className="rounded-3xl border border-ink-200 bg-white p-6 text-center shadow-sm lg:p-8">
    <div className={cn('mx-auto w-full', large ? 'max-w-[440px]' : 'max-w-[300px]')}>
      <ModernQr value={voteUrl} size={440} margin={4} brackets color="#1C1724" className="h-auto w-full" aria-label="QR code to vote" />
    </div>
    {!large && <p className="mt-4 break-all font-mono text-base text-ink-700">{voteUrl.replace(/^https?:\/\//, '')}</p>}
  </div>
)
