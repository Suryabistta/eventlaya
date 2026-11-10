import React, { useMemo, useState } from 'react'
import { formatDateTime } from '@/lib/dates'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, BarChart3, ChevronDown, ChevronRight, Copy, Download, ExternalLink, Flag, Gift, Lock, MonitorPlay, Pencil, Play,
  RotateCcw, ShieldAlert, Square, Trophy, Undo2, Unlock, Users, Vote as VoteIcon,
} from 'lucide-react'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, StatTile, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PollStatusBadge } from '../shared'
import {
  contestApi, contestPath, contestRef, downloadContestExport, shareUrl, type Contest, type ContestRound, type Dashboard, type Standings,
  type StandingRow, type VoteRow,
} from './api'
import { ModuleOff, Note, isModuleOff } from './kit'
import { useModuleEnabled } from '@/lib/modules'
import { ContestantPhoto, ContestantStatusBadge, NumberTag, fmtScore, visibilityInfo, voteModeInfo } from './shared'

const wrapClass = 'w-full space-y-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8 2xl:px-10'
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'results', label: 'Results & rounds' },
  { id: 'scores', label: 'Judges’ scores' },
  { id: 'fraud', label: 'Votes & fraud' },
  { id: 'paid', label: 'Paid votes' },
  { id: 'exports', label: 'Exports & log' },
] as const
type Tab = (typeof TABS)[number]['id']

export const ContestDashboardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const toast = useToast()
  const qc = useQueryClient()
  const { data: contest, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['contest', id], queryFn: () => contestApi.get(id!), refetchInterval: 15000, retry: (n, e) => !isModuleOff(e) && n < 1,
  })
  const judgingOn = useModuleEnabled('judging')

  const setStatus = useMutation({
    mutationFn: (action: 'open' | 'close') => contestApi.setStatus(id!, action),
    onSuccess: (c) => {
      qc.setQueryData(['contest', id], c)
      toast.success(c.status === 'open' ? 'Voting is open' : 'Voting closed')
    },
    onError: (e: Error) => toast.error('Couldn’t change the status', e.message),
  })

  if (isError && isModuleOff(error)) return <div className={wrapClass}><ModuleOff title="Contests are turned off" description="This contest is kept, but contests aren’t available on your account right now." action={<ButtonLink to="/app/voting" variant="secondary">Back to voting</ButtonLink>} /></div>
  if (isError) return <div className={wrapClass}><ErrorState message={error?.message} onRetry={refetch} /></div>
  if (isLoading || !contest) return <div className={wrapClass}><Skeleton className="h-10 w-72" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>

  const publicPath = contestPath(contest.event_slug, contestRef(contest))
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(contest.event_slug, contestRef(contest)))
      toast.success('Share link copied', 'It shows a preview with your cover image on Facebook, Messenger and Viber.')
    } catch {
      toast.error('Couldn’t copy the link')
    }
  }

  return (
    <div className={wrapClass}>
      <div className="space-y-2">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
            <li><Link to="/app/voting" className="font-medium hover:text-ink-900 hover:underline">Live voting</Link></li>
            <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
            <li aria-current="page" className="truncate text-ink-700">{contest.title}</li>
          </ol>
        </nav>
        <PageHeader
          title={<span className="flex flex-wrap items-center gap-3">{contest.title}<PollStatusBadge status={contest.status} /></span>}
          description={`${contest.event_title} · ${voteModeInfo[contest.vote_mode].label} · ${visibilityInfo[contest.results_visibility]}`}
          actions={
            <>
              {contest.status === 'open' ? (
                <Button variant="secondary" icon={<Square className="h-4 w-4" />} loading={setStatus.isPending} onClick={async () => {
                  if (await toast.confirm({ title: 'Close voting for the whole contest?', description: 'Nobody can vote in any round until you open it again.', confirmLabel: 'Close voting', danger: true })) setStatus.mutate('close')
                }}>Close voting</Button>
              ) : (
                <Button icon={<Play className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('open')}>Open voting</Button>
              )}
              <ButtonLink variant="secondary" to={`/app/voting/contests/${contest.id}/edit`} icon={<Pencil className="h-4 w-4" />}>Set up</ButtonLink>
              <ButtonLink variant="secondary" to={`/app/voting/contests/${contest.id}/present`} icon={<MonitorPlay className="h-4 w-4" />}>Present</ButtonLink>
              <Button variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={copyLink}>Share link</Button>
              <a href={publicPath} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-ink-600 hover:bg-ink-100"><ExternalLink className="h-4 w-4" aria-hidden />Public page</a>
            </>
          }
        />
      </div>

      <div role="tablist" aria-label="Contest dashboard" className="-mx-4 flex gap-1 overflow-x-auto border-b border-ink-200 px-4">
        {TABS.filter((t) => (t.id !== 'scores' || judgingOn) && (t.id !== 'paid' || contest.paid_votes_enabled || Number(contest.stats.revenue) > 0)).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams((p) => { p.set('tab', t.id); return p }, { replace: true })}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold', tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900')}
          >
            {t.label}
            {t.id === 'fraud' && contest.stats.flagged > 0 && <Badge tone="warning" className="ml-1.5">{contest.stats.flagged}</Badge>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab contest={contest} />}
      {tab === 'results' && <ResultsTab contest={contest} />}
      {tab === 'scores' && <ScoresTab contest={contest} />}
      {tab === 'fraud' && <FraudTab contest={contest} />}
      {tab === 'exports' && <ExportsTab contest={contest} />}
      {tab === 'paid' && <PaidTab contest={contest} />}
    </div>
  )
}

/* ---------- Overview ---------- */

const OverviewTab: React.FC<{ contest: Contest }> = ({ contest }) => {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['contest-dashboard', contest.id], queryFn: () => contestApi.dashboard(contest.id), refetchInterval: 10000 })
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  if (isLoading || !data) return <Skeleton className="h-80 rounded-2xl" />
  const paid = (data.totals.by_source.paid ?? 0) + (data.totals.by_source.bonus ?? 0)
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Votes counted" value={data.totals.votes.toLocaleString()} hint={paid ? `${paid.toLocaleString()} paid${Number(data.paid.revenue) > 0 ? ` · Rs ${Number(data.paid.revenue).toLocaleString('en-IN')} revenue` : ''}` : 'All free votes'} icon={<VoteIcon className="h-5 w-5" />} tone="brand" />
        <StatTile label="Voters" value={data.totals.voters.toLocaleString()} hint="Distinct verified voters" icon={<Users className="h-5 w-5" />} />
        <StatTile label="Today (Nepal time)" value={data.totals.today.toLocaleString()} icon={<BarChart3 className="h-5 w-5" />} tone="success" />
        <StatTile label="Flagged / voided" value={`${data.totals.flagged} / ${data.totals.void}`} hint="Rows to review / removed" icon={<Flag className="h-5 w-5" />} tone={data.totals.flagged ? 'warning' : 'neutral'} />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Votes per hour" description="Last 48 hours, Nepal time" />
          <div className="p-5"><HourlyBars points={data.hourly} /></div>
        </Card>
        <Card>
          <CardHeader title="Votes by contestant" description="Main contest, all rounds" />
          <div className="p-5"><ContestantBars rows={data.per_contestant} /></div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="By round and category" />
          <dl className="divide-y divide-ink-100 px-5">
            {[...data.per_round.map((r) => ({ k: `r-${r.round_id}`, name: r.name, votes: r.votes })), ...data.per_category.map((c) => ({ k: `c-${c.category_id}`, name: `Award: ${c.name}`, votes: c.votes }))].map((r) => (
              <div key={r.k} className="flex justify-between py-2.5 text-sm"><dt className="text-ink-700">{r.name}</dt><dd className="font-semibold tabular text-ink-900">{r.votes.toLocaleString()}</dd></div>
            ))}
            {!data.per_round.length && !data.per_category.length && <p className="py-6 text-center text-sm text-ink-500">No votes yet.</p>}
          </dl>
        </Card>
        <JudgesProgress data={data} />
      </div>
    </div>
  )
}

/** Single series, one hue; hover/focus shows the exact count. */
const HourlyBars: React.FC<{ points: Dashboard['hourly'] }> = ({ points }) => {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((p) => p.count))
  const total = points.reduce((s, p) => s + p.count, 0)
  const label = (t: string) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })
  const shown = hover !== null ? points[hover] : null
  return (
    <div>
      <p className="mb-3 h-5 text-sm text-ink-600" aria-live="polite">
        {shown ? <><span className="font-semibold text-ink-900 tabular">{shown.count.toLocaleString()}</span> votes · {label(shown.t)}</> : <>{total.toLocaleString()} votes in 48 hours</>}
      </p>
      <div className="flex h-40 items-end gap-[2px] border-b border-ink-200" role="img" aria-label={`Votes per hour for the last 48 hours, peak ${max}`}>
        {points.map((p, i) => (
          <button
            key={p.t}
            type="button"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${label(p.t)}: ${p.count} votes`}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <span className={cn('block w-full rounded-t-[4px] transition-colors', p.count ? 'bg-brand-500 group-hover:bg-brand-700' : 'bg-ink-100')} style={{ height: `${Math.max(p.count ? 4 : 2, (p.count / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-ink-500"><span>{label(points[0]?.t ?? '')}</span><span>now</span></div>
    </div>
  )
}

const ContestantBars: React.FC<{ rows: Dashboard['per_contestant'] }> = ({ rows }) => {
  if (!rows.length) return <p className="py-8 text-center text-sm text-ink-500">No votes yet.</p>
  const max = Math.max(1, ...rows.map((r) => r.votes))
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Votes by contestant</caption>
      <tbody>
        {rows.slice(0, 12).map((r) => (
          <tr key={r.contestant_id} title={`${r.display_number} ${r.name}: ${r.votes.toLocaleString()} votes`}>
            <td className="w-12 py-1.5 pr-2 font-mono text-xs text-ink-500">{r.display_number}</td>
            <td className="py-1.5 pr-3">
              <span className="block truncate text-ink-800">{r.name}</span>
              <span className="mt-1 block h-2 rounded-r-[4px] bg-brand-500" style={{ width: `${(r.votes / max) * 100}%` }} aria-hidden />
            </td>
            <td className="w-16 py-1.5 text-right font-semibold tabular text-ink-900">{r.votes.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const JudgesProgress: React.FC<{ data: Dashboard }> = ({ data }) => (
  <Card>
    <CardHeader title="Judges’ progress" />
    <div className="space-y-3 p-5">
      {data.judges.length === 0 && <p className="text-sm text-ink-500">No judges added.</p>}
      {data.judges.map((j) => (
        <div key={j.id}>
          <p className="text-sm font-semibold text-ink-900">{j.name} {!j.is_active && <Badge className="ml-1">Off</Badge>}</p>
          {j.progress.map((p) => (
            <div key={p.round_id} className="mt-1 flex items-center gap-3 text-xs text-ink-600">
              <span className="w-24 truncate">{p.name}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100" aria-hidden><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${p.expected ? (p.submitted / p.expected) * 100 : 0}%` }} /></span>
              <span className="w-14 text-right tabular">{p.submitted}/{p.expected}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Card>
)

/* ---------- Results & rounds ---------- */

const ResultsTab: React.FC<{ contest: Contest }> = ({ contest }) => {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['contest-results', contest.id], queryFn: () => contestApi.results(contest.id), refetchInterval: 5000 })
  const defaultSel = contest.rounds.find((r) => r.computed_status === 'open')?.id ?? contest.rounds.filter((r) => r.computed_status !== 'upcoming').at(-1)?.id ?? contest.rounds[0]?.id ?? 'overall'
  const [sel, setSel] = useState<string>(defaultSel)
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  if (isLoading || !data) return <Skeleton className="h-80 rounded-2xl" />
  const round = contest.rounds.find((r) => r.id === sel)
  const standings = round ? data.rounds.find((s) => s.round?.id === sel) : sel === 'overall' ? data.overall : null
  const category = data.categories.find((c) => c.category.id === sel)

  return (
    <div className="space-y-4">
      <AnnouncePanel contest={contest} />
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex w-max gap-1.5" role="group" aria-label="Show results for">
          {!contest.rounds.length && <Chip active={sel === 'overall'} onClick={() => setSel('overall')}>Overall</Chip>}
          {contest.rounds.map((r) => (
            <Chip key={r.id} active={sel === r.id} onClick={() => setSel(r.id!)}>
              {r.name}
              <span className={cn('ml-1.5 inline-block h-2 w-2 rounded-full', r.finalized_at ? 'bg-emerald-500' : r.computed_status === 'open' ? 'bg-brand-500' : 'bg-ink-300')} aria-hidden />
              <span className="sr-only">{r.finalized_at ? '(decided)' : `(${r.computed_status})`}</span>
            </Chip>
          ))}
          {data.categories.map((c) => <Chip key={c.category.id} active={sel === c.category.id} onClick={() => setSel(c.category.id)}>🏅 {c.category.name}</Chip>)}
        </div>
      </div>
      {standings && <RoundPanel contest={contest} round={round} standings={standings} isLast={round ? contest.rounds.at(-1)?.id === round.id : true} placementTitles={data.placement_titles} />}
      {category && (
        <Card>
          <CardHeader title={category.category.name} description={category.category.selection === 'public_vote' ? `${category.total_votes.toLocaleString()} votes` : category.category.selection === 'judges' ? 'Decided by judges’ scores' : 'You pick the winner (Set up → Categories)'} />
          <ol className="divide-y divide-ink-100">
            {category.rows.map((r) => (
              <li key={r.contestant_id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-6 text-sm font-bold tabular text-ink-500">{r.rank ?? '–'}</span>
                <ContestantPhoto name={r.name} photo={r.photo_url} className="h-10 w-8 text-xs" rounded="rounded-md" />
                <span className="min-w-0 flex-1 truncate text-sm"><span className="font-mono text-xs text-ink-500">{r.display_number}</span> <span className="font-semibold text-ink-900">{r.name}</span></span>
                {category.category.winner_id === r.contestant_id && <Badge tone="warning"><Trophy className="h-3 w-3" aria-hidden />Winner</Badge>}
                <span className="text-sm font-semibold tabular text-ink-900">{category.category.selection === 'public_vote' ? r.votes.toLocaleString() : category.category.selection === 'judges' ? fmtScore(r.score) : ''}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button onClick={onClick} aria-pressed={active} className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold', active ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50')}>{children}</button>
)

const RoundPanel: React.FC<{ contest: Contest; round?: ContestRound; standings: Standings; isLast: boolean; placementTitles: string[] }> = ({ contest, round, standings, isLast, placementTitles }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contest', contest.id] })
    qc.invalidateQueries({ queryKey: ['contest-results', contest.id] })
    qc.invalidateQueries({ queryKey: ['contest-contestants', contest.id] })
  }
  const act = useMutation({
    mutationFn: (action: 'open' | 'close' | 'undo') => contestApi.roundAction(contest.id, round!.id!, action),
    onSuccess: (_, action) => {
      refresh()
      toast.success(action === 'open' ? `${round!.name} is open` : action === 'close' ? `${round!.name} closed` : 'Decision undone')
    },
    onError: (e: Error) => toast.error('That didn’t work', e.message),
  })
  const showJudges = standings.weights.judges > 0
  const status = round?.computed_status

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-bold text-ink-900">
            {round?.name ?? 'Overall'}
            {round && (round.finalized_at ? <Badge tone="success"><Lock className="h-3 w-3" aria-hidden />Decided</Badge> : <Badge tone={status === 'open' ? 'success' : 'neutral'} dot={status === 'open'}>{status === 'open' ? 'Open' : status === 'closed' ? 'Closed' : 'Upcoming'}</Badge>)}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {showJudges ? `Judges ${standings.weights.judges}% + public ${standings.weights.public}%` : 'Public votes only'} · {standings.total_votes.toLocaleString()} votes
            {standings.advance_count ? ` · top ${standings.advance_count} go through` : ''}
          </p>
        </div>
        {round && (
          <div className="flex flex-wrap gap-2">
            {!round.finalized_at && status !== 'open' && <Button size="sm" variant="secondary" icon={<Play className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate('open')}>Open round</Button>}
            {!round.finalized_at && status === 'open' && <Button size="sm" variant="secondary" icon={<Square className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate('close')}>Close round</Button>}
            {!round.finalized_at && <Button size="sm" icon={<Trophy className="h-4 w-4" />} onClick={() => setDeciding(true)} disabled={!standings.rows.length}>{isLast ? 'Decide final result' : 'Advance & eliminate'}</Button>}
            {round.finalized_at && (
              <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} loading={act.isPending} onClick={async () => {
                if (await toast.confirm({ title: `Undo the decision for ${round.name}?`, description: 'Eliminated contestants come back. Only possible before the next round has votes or scores.', confirmLabel: 'Undo decision' })) act.mutate('undo')
              }}>Undo decision</Button>
            )}
          </div>
        )}
      </div>
      {standings.tie_at_cutoff && !round?.finalized_at && <Note tone="warning" className="mx-5 mt-4">There’s a tie at place {standings.advance_count}. When you advance, pick who goes through yourself.</Note>}
      {standings.rows.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="Nobody in this round yet" description={isLast ? 'Contestants join when the previous round is decided.' : 'Add contestants, or decide the previous round.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-2">Rank</th>
                <th scope="col" className="px-2 py-2">Contestant</th>
                <th scope="col" className="px-2 py-2 text-right">Votes</th>
                <th scope="col" className="px-2 py-2 text-right">Public</th>
                {showJudges && <th scope="col" className="px-2 py-2 text-right">Judges</th>}
                {showJudges && standings.criteria.map((c) => <th key={c.id} scope="col" className="hidden px-2 py-2 text-right xl:table-cell">{c.name} <span className="font-normal normal-case">/{c.max_points}</span></th>)}
                <th scope="col" className="px-4 py-2 text-right">Final</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {standings.rows.map((r, i) => {
                const through = standings.advance_count && i < standings.advance_count
                return (
                  <React.Fragment key={r.contestant_id}>
                    <tr className={cn(through && !isLast && 'bg-emerald-50/40')}>
                      <td className="px-4 py-2.5 font-bold tabular text-ink-900">{r.rank}{r.tied && <span className="ml-1 text-xs font-medium text-marigold-700">tie</span>}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <ContestantPhoto name={r.name} photo={r.photo_url} className="h-10 w-8 shrink-0 text-xs" rounded="rounded-md" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5"><NumberTag value={r.display_number} className="text-[11px]" /><span className="truncate font-semibold text-ink-900">{r.name}</span></p>
                            <p className="text-xs text-ink-500">
                              {r.entry_status && r.entry_status !== 'competing' ? r.entry_status : ''}{r.status !== 'active' && <ContestantStatusBadge status={r.status} className="ml-1" />}
                              {showJudges && r.judges && r.judges.length > 0 && (
                                <button className="ml-1 inline-flex items-center font-semibold text-brand-700" onClick={() => setExpanded(expanded === r.contestant_id ? null : r.contestant_id)} aria-expanded={expanded === r.contestant_id}>
                                  {r.judges_scored} judge{r.judges_scored === 1 ? '' : 's'} <ChevronDown className={cn('h-3 w-3 transition-transform', expanded === r.contestant_id && 'rotate-180')} aria-hidden />
                                </button>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular">{r.votes.toLocaleString()}</td>
                      <td className="px-2 py-2.5 text-right tabular">{fmtScore(r.public_score)}</td>
                      {showJudges && <td className="px-2 py-2.5 text-right tabular">{fmtScore(r.judge_score)}</td>}
                      {showJudges && standings.criteria.map((c) => <td key={c.id} className="hidden px-2 py-2.5 text-right tabular text-ink-600 xl:table-cell">{fmtScore(r.criteria[c.id])}</td>)}
                      <td className="px-4 py-2.5 text-right font-bold tabular text-ink-900">{fmtScore(r.final, 2)}</td>
                    </tr>
                    {expanded === r.contestant_id && r.judges && (
                      <tr className="bg-ink-50/60">
                        <td />
                        <td colSpan={4 + (showJudges ? 1 + standings.criteria.length : 0)} className="px-2 py-2">
                          <ul className="space-y-1 text-xs">
                            {r.judges.map((j) => (
                              <li key={j.judge_id} className="flex flex-wrap gap-x-3">
                                <span className="w-28 font-semibold text-ink-800">{j.name}</span>
                                <span className="tabular">{fmtScore(j.percent)}%</span>
                                <span className="text-ink-500">{standings.criteria.map((c) => `${c.name} ${j.scores[c.id] ?? '–'}`).join(' · ')}</span>
                                {j.comment && <span className="italic text-ink-600">“{j.comment}”</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 py-3 text-xs text-ink-500">
        Public score: {standings.public_normalization === 'share' ? 'share of all votes' : 'relative to the most-voted (= 100)'}. Judges: {standings.judge_aggregation === 'drop_high_low' ? 'highest and lowest dropped' : standings.judge_aggregation}. Ties: {standings.tie_breakers.join(' → ') || 'shared place'}.
      </p>
      {deciding && round && <DecideModal contest={contest} round={round} standings={standings} isLast={isLast} placementTitles={placementTitles} onClose={() => setDeciding(false)} onDone={refresh} />}
    </Card>
  )
}

const DecideModal: React.FC<{ contest: Contest; round: ContestRound; standings: Standings; isLast: boolean; placementTitles: string[]; onClose: () => void; onDone: () => void }> = ({ contest, round, standings, isLast, placementTitles, onClose, onDone }) => {
  const toast = useToast()
  const rows = standings.rows.filter((r) => r.status !== 'withdrawn')
  const n = round.advance_count ?? 0
  const manualNeeded = !isLast && (round.advance_mode === 'manual' || !n || standings.tie_at_cutoff)
  const [manual, setManual] = useState(manualNeeded)
  const [picked, setPicked] = useState<string[]>(() => rows.slice(0, n || 0).map((r) => r.contestant_id))
  const finalTie = isLast && rows[0]?.tied
  const [order, setOrder] = useState<string[]>(() => rows.map((r) => r.contestant_id))
  const byId = useMemo(() => new Map(rows.map((r) => [r.contestant_id, r])), [rows])

  const decide = useMutation({
    mutationFn: () => contestApi.roundAction(contest.id, round.id!, 'decide', {
      confirm: true,
      ...(isLast ? (finalTie || manual ? { contestant_ids: order } : {}) : manual ? { contestant_ids: picked } : {}),
    }),
    onSuccess: (res) => {
      toast.success('Decision saved', (res as { message?: string }).message)
      onDone()
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t decide the round', e.message),
  })

  const advancing = manual ? picked : rows.slice(0, n).map((r) => r.contestant_id)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isLast ? `Decide the final result of ${round.name}` : `Advance from ${round.name}`}
      description={isLast ? 'This records the final placements and marks the winner. Contestants and the public see it according to your results settings.' : 'Contestants who go through join the next round; the rest are marked eliminated. You can undo this until the next round has votes or scores.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={decide.isPending} disabled={!isLast && advancing.length === 0} onClick={() => decide.mutate()} icon={<Trophy className="h-4 w-4" />}>{isLast ? 'Confirm final result' : `Advance ${advancing.length}, eliminate ${rows.length - advancing.length}`}</Button></>}
    >
      {isLast ? (
        <div className="space-y-3">
          {finalTie && <Note tone="warning">The top place is tied. Put the contestants in the final order yourself.</Note>}
          <ol className="space-y-1">
            {order.map((id, i) => {
              const r = byId.get(id)!
              return (
                <li key={id} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                  <span className="w-28 shrink-0 text-xs font-semibold text-marigold-800">{placementTitles[i] ?? `${i + 1}th place`}</span>
                  <span className="font-mono text-xs text-ink-500">{r.display_number}</span>
                  <span className="flex-1 truncate font-semibold">{r.name}</span>
                  <span className="tabular text-ink-600">{fmtScore(r.final, 2)}</span>
                  {(finalTie || manual) && (
                    <span className="flex">
                      <button className="px-1 text-ink-500 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${r.name} up`} onClick={() => setOrder((o) => { const n2 = [...o]; [n2[i - 1], n2[i]] = [n2[i], n2[i - 1]]; return n2 })}>▲</button>
                      <button className="px-1 text-ink-500 disabled:opacity-30" disabled={i === order.length - 1} aria-label={`Move ${r.name} down`} onClick={() => setOrder((o) => { const n2 = [...o]; [n2[i + 1], n2[i]] = [n2[i], n2[i + 1]]; return n2 })}>▼</button>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          {!finalTie && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />Change the order myself</label>}
        </div>
      ) : (
        <div className="space-y-3">
          {!manualNeeded && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />Pick who goes through myself (instead of the top {n})</label>}
          {manualNeeded && <Note>{standings.tie_at_cutoff ? `Tie at place ${n}: ` : ''}Tick the contestants who go through.</Note>}
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {rows.map((r) => {
              const on = advancing.includes(r.contestant_id)
              return (
                <li key={r.contestant_id}>
                  <label className={cn('flex items-center gap-3 rounded-lg border px-3 py-2 text-sm', on ? 'border-emerald-300 bg-emerald-50' : 'border-ink-200', manual && 'cursor-pointer')}>
                    <input type="checkbox" disabled={!manual} checked={on} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.contestant_id] : p.filter((x) => x !== r.contestant_id)))} className="h-4 w-4 rounded border-ink-300 text-emerald-600" />
                    <span className="w-6 font-bold tabular text-ink-500">{r.rank}</span>
                    <span className="font-mono text-xs text-ink-500">{r.display_number}</span>
                    <span className="flex-1 truncate font-semibold">{r.name}</span>
                    <span className="tabular text-ink-600">{fmtScore(r.final, 2)}</span>
                    <span className={cn('w-24 text-right text-xs font-semibold', on ? 'text-emerald-700' : 'text-ink-500')}>{on ? 'Goes through' : 'Eliminated'}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}

/* ---------- Judges' scores ---------- */

const ScoresTab: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const judged = contest.rounds.filter((r) => r.judging_enabled)
  const [rid, setRid] = useState(judged.find((r) => r.computed_status === 'open')?.id ?? judged.at(-1)?.id ?? '')
  const { data: sheets, isLoading, isError, error, refetch } = useQuery({ queryKey: ['contest-sheets', contest.id, rid], queryFn: () => contestApi.sheets(contest.id, rid), enabled: Boolean(rid), refetchInterval: 8000 })
  const { data: contestants = [] } = useQuery({ queryKey: ['contest-contestants', contest.id], queryFn: () => contestApi.contestants(contest.id) })
  const round = judged.find((r) => r.id === rid)
  const unlock = useMutation({
    mutationFn: (sid: string) => contestApi.unlockSheet(contest.id, sid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contest-sheets', contest.id, rid] })
      toast.success('Sheet unlocked', 'The judge can change and resubmit it. This is in the audit log.')
    },
    onError: (e: Error) => toast.error('Couldn’t unlock', e.message),
  })
  if (!judged.length) return <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No judged rounds" description="Turn on judging for a round in Set up → Rounds." action={<ButtonLink to={`/app/voting/contests/${contest.id}/edit#rounds`}>Set up rounds</ButtonLink>} /></Card>
  const inRound = new Set(round?.contestants?.map((e) => e.contestant_id) ?? [])
  const people = contestants.filter((c) => inRound.has(c.id))
  const judges = contest.judges
  const sheetOf = (cid: string, jid: string) => sheets?.find((s) => s.contestant_id === cid && s.judge_id === jid)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">{judged.map((r) => <Chip key={r.id} active={rid === r.id} onClick={() => setRid(r.id!)}>{r.name}</Chip>)}</div>
      {isError ? <ErrorState message={error?.message} onRetry={refetch} /> : isLoading ? <Skeleton className="h-60 rounded-2xl" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Scores by judge for {round?.name}</caption>
            <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500">
              <tr><th scope="col" className="px-4 py-2">Contestant</th>{judges.map((j) => <th key={j.id} scope="col" className="px-2 py-2 text-center">{j.name}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {people.map((c) => (
                <tr key={c.id}>
                  <th scope="row" className="px-4 py-2 text-left font-medium"><span className="font-mono text-xs text-ink-500">{c.display_number}</span> {c.name}</th>
                  {judges.map((j) => {
                    const s = sheetOf(c.id, j.id)
                    return (
                      <td key={j.id} className="px-2 py-2 text-center">
                        {!s ? <span className="text-ink-300">–</span> : s.status === 'draft' ? (
                          <span className="text-xs text-ink-500" title="Draft, not submitted">{fmtScore(s.percent)}% draft</span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <span className="font-semibold tabular text-ink-900">{fmtScore(s.percent)}%</span>
                            {!round?.finalized_at && (
                              <button title="Unlock so the judge can change it" aria-label={`Unlock ${j.name}’s sheet for ${c.name}`} onClick={async () => {
                                if (await toast.confirm({ title: `Unlock ${j.name}’s scores for ${c.name}?`, description: 'They can edit and resubmit. Logged in the audit trail.', confirmLabel: 'Unlock' })) unlock.mutate(s.id)
                              }} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800"><Unlock className="h-3.5 w-3.5" aria-hidden /></button>
                            )}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!people.length && <p className="p-6 text-center text-sm text-ink-500">Nobody is in this round yet.</p>}
        </Card>
      )}
    </div>
  )
}

/* ---------- Votes & fraud ---------- */

const FraudTab: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'flagged' | 'all' | 'void'>('flagged')
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['contest-flags', contest.id, mode], queryFn: () => contestApi.flags(contest.id, mode), refetchInterval: 15000 })
  const [voiding, setVoiding] = useState<{ title: string; body: Parameters<typeof contestApi.voidVotes>[1] } | null>(null)
  const restore = useMutation({
    mutationFn: (ids: string[]) => contestApi.voidVotes(contest.id, { vote_ids: ids, undo: true }),
    onSuccess: (r) => { toast.success(r.message); qc.invalidateQueries({ queryKey: ['contest-flags', contest.id] }); qc.invalidateQueries({ queryKey: ['contest', contest.id] }) },
    onError: (e: Error) => toast.error('Couldn’t restore', e.message),
  })
  return (
    <div className="space-y-4">
      <Note>Flagged votes still count until you void them. Voided votes stop counting but are kept (and still use up that voter’s allowance). Every void is in the audit log with your reason.</Note>
      {isError ? <ErrorState message={error?.message} onRetry={refetch} /> : isLoading || !data ? <Skeleton className="h-60 rounded-2xl" /> : (
        <>
          {Object.keys(data.counts).length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Object.entries(data.counts).map(([flag, n]) => (
                <Card key={flag} className="flex items-start justify-between gap-3 p-4">
                  <div><p className="text-sm font-semibold text-ink-900">{data.labels[flag] ?? flag}</p><p className="text-xs text-ink-500">{n} vote rows</p></div>
                  <Button size="sm" variant="secondary" onClick={() => setVoiding({ title: `Void all votes flagged “${data.labels[flag] ?? flag}”`, body: { flag } })}>Void all</Button>
                </Card>
              ))}
            </div>
          )}
          {data.groups.length > 0 && (
            <Card>
              <CardHeader title="Where flagged votes come from" description="Hashed references; the real IP addresses and device ids are never stored." />
              <ul className="divide-y divide-ink-100">
                {data.groups.map((g) => (
                  <li key={g.kind + g.hash} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <ShieldAlert className="h-4 w-4 text-marigold-600" aria-hidden />
                    <span className="font-medium">{g.label}</span>
                    <span className="font-mono text-xs text-ink-500">{g.ref}…</span>
                    <span className="text-ink-600">{g.votes} votes from {g.voters} voter{g.voters === 1 ? '' : 's'}</span>
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setVoiding({ title: `Void every vote from this ${g.kind === 'ip' ? 'IP address' : 'device'}`, body: g.kind === 'ip' ? { ip_hash: g.hash } : { device_hash: g.hash } })}>Void all from here</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex gap-1.5">
            <Chip active={mode === 'flagged'} onClick={() => setMode('flagged')}>Flagged</Chip>
            <Chip active={mode === 'all'} onClick={() => setMode('all')}>Latest 500</Chip>
            <Chip active={mode === 'void'} onClick={() => setMode('void')}>Voided</Chip>
          </div>
          <VotesTable rows={data.votes} labels={data.labels} onVoid={(v) => setVoiding({ title: `Void ${v.quantity} vote${v.quantity === 1 ? '' : 's'} for ${v.contestant}`, body: { vote_ids: [v.id] } })} onRestore={(v) => restore.mutate([v.id])} />
        </>
      )}
      {voiding && <VoidModal contest={contest} title={voiding.title} body={voiding.body} onClose={() => setVoiding(null)} />}
    </div>
  )
}

const FLAG_SHORT: Record<string, string> = { ip_burst: 'IP burst', subnet_burst: 'Network burst', shared_device: 'Shared phone' }

const VotesTable: React.FC<{ rows: VoteRow[]; labels: Record<string, string>; onVoid: (v: VoteRow) => void; onRestore: (v: VoteRow) => void }> = ({ rows, labels, onVoid, onRestore }) => {
  if (!rows.length) return <Card><EmptyState icon={<Flag className="h-6 w-6" />} title="Nothing here" description="No votes match this view." /></Card>
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500">
          <tr><th className="px-4 py-2">Time</th><th className="px-2 py-2">Contestant</th><th className="px-2 py-2 text-right">Votes</th><th className="px-2 py-2">Voter</th><th className="px-2 py-2">IP / device</th><th className="px-2 py-2">Flags</th><th className="px-4 py-2" /></tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((v) => (
            <tr key={v.id} className={cn(v.is_void && 'text-ink-400 line-through decoration-ink-300')}>
              <td className="whitespace-nowrap px-4 py-2 tabular">{new Date(v.voted_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
              <td className="px-2 py-2"><span className="font-mono text-xs">{v.display_number}</span> {v.contestant}{v.category && <span className="text-xs text-ink-500"> · {v.category}</span>}</td>
              <td className="px-2 py-2 text-right tabular">{v.quantity}{v.source !== 'free' && <span className="ml-1 text-xs text-ink-500">{v.source}</span>}</td>
              <td className="px-2 py-2 font-mono text-xs">{v.voter_ref}</td>
              <td className="px-2 py-2 font-mono text-xs">{v.ip_ref || '–'} / {v.device_ref || '–'}</td>
              <td className="px-2 py-2">{v.flags.map((f) => <span key={f} title={labels[f] ?? f}><Badge tone="warning" className="mr-1">{FLAG_SHORT[f] ?? f}</Badge></span>)}{v.is_void && <span className="text-xs no-underline">void: {v.void_reason}</span>}</td>
              <td className="px-4 py-2 text-right">
                {v.is_void ? <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => onRestore(v)}>Restore</Button> : <Button size="sm" variant="ghost" onClick={() => onVoid(v)}>Void</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

const VoidModal: React.FC<{ contest: Contest; title: string; body: Parameters<typeof contestApi.voidVotes>[1]; onClose: () => void }> = ({ contest, title, body, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const run = useMutation({
    mutationFn: () => contestApi.voidVotes(contest.id, { ...body, reason }),
    onSuccess: (r) => {
      if (r.warning) toast.info('Votes voided — consider a refund', r.warning)
      else toast.success('Votes voided', r.message)
      qc.invalidateQueries({ queryKey: ['contest-flags', contest.id] })
      qc.invalidateQueries({ queryKey: ['contest', contest.id] })
      qc.invalidateQueries({ queryKey: ['contest-results', contest.id] })
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t void the votes', e.message),
  })
  return (
    <Modal open onClose={onClose} title={title} description="They stop counting in every result. You can restore them later. Voiding paid votes doesn’t refund the buyer." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} loading={run.isPending} onClick={() => run.mutate()}>Void votes</Button></>}>
      <Textarea label="Reason (kept in the audit log)" required rows={3} autoFocus placeholder="Burst of 300 votes in 2 minutes from one network" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  )
}

/* ---------- Exports & log ---------- */

const ExportsTab: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const { data: log, isLoading } = useQuery({ queryKey: ['contest-audit', contest.id], queryFn: () => contestApi.audit(contest.id) })
  const [phone, setPhone] = useState('')
  const [votes, setVotes] = useState('5')
  const download = async (kind: 'votes' | 'scores' | 'results' | 'purchases') => {
    try {
      await downloadContestExport(contest, kind)
    } catch (e) {
      toast.error('Export failed', (e as Error).message)
    }
  }
  const grant = useMutation({
    mutationFn: () => contestApi.grantCredits(contest.id, { ...(phone.includes('@') ? { email: phone } : { phone }), votes: Number(votes) }),
    onSuccess: (r) => { toast.success(r.message); setPhone('') },
    onError: (e: Error) => toast.error('Couldn’t add votes', e.message),
  })
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Exports" description="CSV files that open in Excel and Google Sheets. Voters appear only as hashed references." />
          <div className="flex flex-wrap gap-2 p-5">
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('results')}>Results (all rounds)</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('votes')}>Every vote</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('scores')}>Judges’ scores</Button>
            {(contest.paid_votes_enabled || Number(contest.stats.revenue) > 0) && (
              <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download('purchases')}>Vote purchases</Button>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Give bonus votes" description="For a sponsor promotion or to fix a problem. The voter uses them like paid votes." />
          <form className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_100px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); grant.mutate() }}>
            <Input label="Voter’s phone or email" placeholder="98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input label="Votes" type="number" min={1} value={votes} onChange={(e) => setVotes(e.target.value)} />
            <Button type="submit" variant="secondary" icon={<Gift className="h-4 w-4" />} loading={grant.isPending} disabled={!phone.trim()}>Add</Button>
          </form>
        </Card>
      </div>
      <Card>
        <CardHeader title="Audit log" description="Every advancement, void, unlock and setting that affects results." />
        {isLoading ? <Skeleton className="m-5 h-40" /> : !log?.length ? <p className="p-6 text-center text-sm text-ink-500">Nothing yet.</p> : (
          <ol className="max-h-[32rem] divide-y divide-ink-100 overflow-y-auto">
            {log.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-sm">
                <p className="text-ink-900">{a.summary}</p>
                <p className="text-xs text-ink-500">{new Date(a.created_at).toLocaleString()} · {a.actor ?? 'system'}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {contest.paid_votes_enabled && <Note tone="warning"><AlertTriangle className="hidden" />Paid vote packs are set up but can’t be bought until online payments are connected.</Note>}
    </div>
  )
}

/* ---------- Paid votes ---------- */

const PURCHASE_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  paid: { label: 'Paid', tone: 'success' },
  pending: { label: 'Awaiting payment', tone: 'info' },
  failed: { label: 'Not paid', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'danger' },
}
const rs = (v: string | number) => `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

const PaidTab: React.FC<{ contest: Contest }> = ({ contest }) => {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['contest-purchases', contest.id], queryFn: () => contestApi.purchases(contest.id), refetchInterval: 15000 })
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  if (isLoading || !data) return <Skeleton className="h-60 rounded-2xl" />
  const s = data.summary
  return (
    <div className="space-y-6">
      {!contest.payments.available && contest.paid_votes_enabled && contest.payments.message && <Note tone="warning">Not on sale right now: {contest.payments.message}</Note>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Revenue" value={rs(s.revenue)} hint={`${s.purchases} purchase${s.purchases === 1 ? '' : 's'}`} icon={<Gift className="h-5 w-5" />} tone="success" />
        <StatTile label="Votes sold" value={s.votes_sold.toLocaleString()} hint={`${s.unspent_credits.toLocaleString()} not used yet`} icon={<VoteIcon className="h-5 w-5" />} tone="brand" />
        <StatTile label="Refunded" value={rs(s.refunded)} hint={`${s.refunded_count} purchase${s.refunded_count === 1 ? '' : 's'}`} icon={<RotateCcw className="h-5 w-5" />} />
        <StatTile label="Flagged purchases" value={s.flagged_purchases} hint={`${s.pending} awaiting payment`} icon={<Flag className="h-5 w-5" />} tone={s.flagged_purchases ? 'warning' : 'neutral'} />
      </div>
      <Note>
        Money is collected by Eventlaya and paid out to you (see <Link to="/app/payments" className="font-semibold underline">Payments</Link>). To refund a buyer,
        return the money from the Khalti / eSewa dashboard, then mark the payment refunded on the Payments page: the votes they haven’t used are removed.
      </Note>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="By contestant" description="Revenue = purchases made on that contestant’s page. Paid votes = paid votes they received." />
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500"><tr><th className="px-5 py-2">Contestant</th><th className="px-2 py-2 text-right">Paid votes</th><th className="px-5 py-2 text-right">Revenue</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {s.per_contestant.map((r) => (
                <tr key={r.contestant_id}><td className="px-5 py-2"><span className="font-mono text-xs text-ink-500">{r.display_number}</span> {r.name}</td><td className="px-2 py-2 text-right tabular">{r.paid_votes.toLocaleString()}</td><td className="px-5 py-2 text-right font-semibold tabular">{rs(r.revenue)}</td></tr>
              ))}
              {!s.per_contestant.length && <tr><td colSpan={3} className="px-5 py-6 text-center text-ink-500">No paid votes yet.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="By pack" />
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500"><tr><th className="px-5 py-2">Pack</th><th className="px-2 py-2 text-right">Sold</th><th className="px-5 py-2 text-right">Revenue</th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {s.per_pack.map((r) => (
                <tr key={r.pack_id ?? r.label}><td className="px-5 py-2">{r.label}</td><td className="px-2 py-2 text-right tabular">{r.sold}</td><td className="px-5 py-2 text-right font-semibold tabular">{rs(r.revenue)}</td></tr>
              ))}
              {!s.per_pack.length && <tr><td colSpan={3} className="px-5 py-6 text-center text-ink-500">Nothing sold yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
      <Card className="overflow-x-auto">
        <CardHeader title="Purchases" description="Latest 500. Unfinished checkouts that timed out are hidden." />
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-ink-50 text-left text-xs font-semibold text-ink-500">
            <tr><th className="px-4 py-2">Time</th><th className="px-2 py-2">Pack</th><th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">For</th><th className="px-2 py-2">Voter</th><th className="px-4 py-2">Payment</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {data.purchases.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-4 py-2 tabular">{new Date(p.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-2 py-2">{p.label}{p.bonus_votes > 0 && <span className="text-xs text-emerald-700"> +{p.bonus_votes}</span>}</td>
                <td className="px-2 py-2 text-right tabular">{rs(p.amount)}</td>
                <td className="px-2 py-2"><Badge tone={PURCHASE_STATUS[p.status]?.tone ?? 'neutral'}>{PURCHASE_STATUS[p.status]?.label ?? p.status}</Badge>{p.flags.length > 0 && <Badge tone="warning" className="ml-1">flagged</Badge>}</td>
                <td className="px-2 py-2">{p.contestant ? <><span className="font-mono text-xs">{p.contestant.display_number}</span> {p.contestant.name}{p.auto_voted > 0 && <span className="text-xs text-ink-500"> · {p.auto_voted} cast</span>}</> : <span className="text-ink-400">–</span>}</td>
                <td className="px-2 py-2 font-mono text-xs">{p.voter_ref}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.provider ?? '–'} · {p.provider_txn_id || p.payment_id?.slice(0, 8)}</td>
              </tr>
            ))}
            {!data.purchases.length && <tr><td colSpan={7} className="px-5 py-6 text-center text-ink-500">No purchases yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

export type { StandingRow }

/** Announce winners: results become public, the event timeline shows Results, placed contestants are notified. */
const AnnouncePanel: React.FC<{ contest: Contest }> = ({ contest }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [text, setText] = useState(contest.announcement ?? '')
  const announce = useMutation({
    mutationFn: (undo: boolean) => contestApi.announce(contest.id, undo ? { undo: true } : { announcement: text }),
    onSuccess: (r, undo) => {
      void qc.invalidateQueries()
      toast.success(undo ? 'Announcement taken back' : `Winners announced${r.winners?.length ? `: ${r.winners.map((w) => w.name).join(', ')}` : ''}`)
    },
    onError: (e: Error) => toast.error('Couldn’t announce', e.message),
  })
  if (contest.winners_announced_at) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-900">
          <span className="font-semibold">Winners announced</span> {formatDateTime(contest.winners_announced_at)}. Results are public and on the event page.
        </p>
        <Button variant="secondary" size="sm" loading={announce.isPending} onClick={() => announce.mutate(true)}>
          Take back
        </Button>
      </Card>
    )
  }
  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-semibold text-ink-900">Announce the winners</p>
      <Textarea label="Message (optional)" rows={2} maxLength={2000} placeholder="Congratulations to Miss Koshi 2083 and the runners-up!" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-500">
          Uses the decided final round (or the current standings). Results become public and placed contestants are notified
          {contest.contestant_notify === 'off' ? ' (notifications are off)' : ''}.
        </p>
        <Button
          loading={announce.isPending}
          onClick={() => window.confirm('Announce the winners now? Everyone will see the results.') && announce.mutate(false)}
        >
          Announce winners
        </Button>
      </div>
    </Card>
  )
}
