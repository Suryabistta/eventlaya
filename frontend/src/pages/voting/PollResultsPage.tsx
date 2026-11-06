import React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Line } from 'react-chartjs-2'
import { ChevronRight, Download, Lock, MonitorPlay, Pencil, Play, RotateCcw, Trophy, Users, Vote as VoteIcon, Percent } from 'lucide-react'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatTile, useToast } from '@/components/ui'
import { chartColors, lineOptions } from '../analytics/charts'
import { ChartCard } from '../analytics/shared'
import { downloadExport, votingApi } from './api'
import { PollStatusBadge, ResultBars, SharePanel, fmtCountdown, scheduleText, useCountdown, visibilityLabel, voteModeLabel, votesLabel } from './shared'

const wrapClass = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const PollResultsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const pollQ = useQuery({ queryKey: ['voting-poll', id], queryFn: () => votingApi.get(id!), refetchInterval: 15000 })
  const resultsQ = useQuery({
    queryKey: ['voting-results', id],
    queryFn: () => votingApi.results(id!),
    refetchInterval: (q) => (q.state.data?.poll.status === 'open' ? 3000 : 15000),
  })
  const poll = pollQ.data
  const results = resultsQ.data
  const countdown = useCountdown(poll?.status === 'open' ? poll.closes_at : poll?.status === 'scheduled' ? poll.opens_at : null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['voting-poll', id] })
    queryClient.invalidateQueries({ queryKey: ['voting-results', id] })
    queryClient.invalidateQueries({ queryKey: ['voting-polls'] })
  }

  const toggle = useMutation({
    mutationFn: () => (poll!.status === 'open' ? votingApi.close(id!) : votingApi.open(id!)),
    onSuccess: (p) => {
      refresh()
      toast.success(p.status === 'open' ? 'Voting is open' : 'Voting closed', p.status === 'open' ? 'Share the link or QR code so people can vote.' : 'Results are final until you reopen it.')
    },
    onError: (e: Error) => toast.error('Couldn’t change the poll', e.message),
  })

  const reset = useMutation({
    mutationFn: () => votingApi.reset(id!),
    onSuccess: (r) => {
      refresh()
      toast.success('Votes cleared', `${r.deleted.toLocaleString()} votes were deleted.`)
    },
    onError: (e: Error) => toast.error('Couldn’t clear the votes', e.message),
  })

  const doExport = async (kind: 'results' | 'votes') => {
    try {
      await downloadExport(poll!, kind)
      toast.success(kind === 'results' ? 'Results exported' : 'Votes exported', 'The CSV file is in your downloads.')
    } catch (e) {
      toast.error('Couldn’t export', (e as Error).message)
    }
  }

  const confirmToggle = async () => {
    if (poll!.status === 'open') {
      const ok = await toast.confirm({ title: 'Close voting now?', description: 'People won’t be able to vote any more. You can reopen it later.', confirmLabel: 'Close voting' })
      if (!ok) return
    }
    toggle.mutate()
  }

  const confirmReset = async () => {
    const ok = await toast.confirm({
      title: 'Delete every vote in this poll?',
      description: `All ${results?.total_votes.toLocaleString() ?? ''} votes will be permanently deleted and everyone can vote again. Use this after a test run.`,
      confirmLabel: 'Delete all votes',
      danger: true,
    })
    if (ok) reset.mutate()
  }

  if (pollQ.isError) {
    return (
      <div className={wrapClass}>
        <ErrorState message={pollQ.error?.message} onRetry={() => pollQ.refetch()} />
        <ButtonLink to="/app/voting" variant="secondary">Back to live voting</ButtonLink>
      </div>
    )
  }
  if (!poll) {
    return (
      <div className={wrapClass}>
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    )
  }

  const leaders = results ? results.candidates.filter((c) => results.leader_ids.includes(c.id)) : []
  const points = results?.timeline?.points ?? []
  const hasTimelineVotes = points.some((p) => p.count > 0)

  return (
    <div className={wrapClass}>
      <div className="space-y-2">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-500">
            <li><Link to="/app/voting" className="font-medium hover:text-ink-900 hover:underline">Live voting</Link></li>
            <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
            <li aria-current="page" className="truncate text-ink-700">{poll.title}</li>
          </ol>
        </nav>
        <PageHeader
          title={poll.title}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <PollStatusBadge status={poll.status} />
              <span>{scheduleText(poll)}</span>
              {countdown !== null && countdown > 0 && (
                <span className="font-medium text-ink-700 tabular">
                  {poll.status === 'open' ? 'Closes in' : 'Opens in'} {fmtCountdown(countdown)}
                </span>
              )}
            </span>
          }
          actions={
            <>
              <Button
                variant={poll.status === 'open' ? 'secondary' : 'primary'}
                icon={poll.status === 'open' ? <Lock className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                loading={toggle.isPending}
                onClick={confirmToggle}
              >
                {poll.status === 'open' ? 'Close voting' : poll.status === 'closed' ? 'Reopen voting' : 'Open voting'}
              </Button>
              <ButtonLink to={`/app/voting/${poll.id}/present`} variant="secondary" icon={<MonitorPlay className="h-4 w-4" />}>Present</ButtonLink>
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => navigate(`/app/voting/${poll.id}/edit`)}>Edit</Button>
            </>
          }
        />
      </div>

      {resultsQ.isError ? (
        <ErrorState message={resultsQ.error?.message} onRetry={() => resultsQ.refetch()} />
      ) : !results ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatTile label="Votes" value={results.total_votes.toLocaleString()} hint={poll.allow_multiple ? `Up to ${poll.max_choices} per voter` : 'One per voter'} icon={<VoteIcon className="h-5 w-5" />} tone="brand" />
            <StatTile label="Voters" value={results.voters.toLocaleString()} hint={`${results.turnout.checked_in} checked in at the gate`} icon={<Users className="h-5 w-5" />} />
            {poll.vote_mode === 'ticket' ? (
              <StatTile label="Turnout" value={`${results.turnout.pct_of_registered}%`} hint={`of ${results.turnout.registered} registered tickets`} icon={<Percent className="h-5 w-5" />} tone="success" />
            ) : (
              <StatTile label="Registered" value={results.turnout.registered.toLocaleString()} hint="Voting isn’t limited to ticket holders" icon={<Percent className="h-5 w-5" />} tone="success" />
            )}
            <StatTile
              label={leaders.length > 1 ? 'Tied for lead' : 'Leading'}
              value={<span className="block truncate text-lg sm:text-xl" title={leaders.map((l) => l.name).join(', ')}>{leaders.length ? leaders.map((l) => l.name).join(', ') : 'No votes yet'}</span>}
              hint={leaders.length ? `${votesLabel(leaders[0].votes)} (${leaders[0].percentage}%)` : undefined}
              icon={<Trophy className="h-5 w-5" />}
              tone="warning"
            />
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              <Card>
                <CardHeader
                  title="Standings"
                  description={poll.status === 'open' ? 'Updates every few seconds while voting is open.' : 'Final unless you reopen voting.'}
                  actions={<Badge tone="neutral">Updated {fmtTime(results.updated_at)}</Badge>}
                />
                <div className="p-5">
                  {results.candidates.length === 0 ? (
                    <EmptyState title="No candidates yet" description="Add candidates so people have something to vote for." action={<ButtonLink to={`/app/voting/${poll.id}/edit`}>Add candidates</ButtonLink>} />
                  ) : (
                    <ResultBars items={results.candidates} leaderIds={results.leader_ids} />
                  )}
                </div>
              </Card>

              <ChartCard
                title="Votes over time"
                description={`Votes per ${results.timeline?.bucket_minutes ?? 5} minutes, last 3 hours`}
                summary={`${votesLabel(points.reduce((n, p) => n + p.count, 0))} in the last 3 hours`}
                empty={
                  hasTimelineVotes ? undefined : (
                    <p className="px-5 py-10 text-center text-sm text-ink-500">No votes in the last 3 hours. The chart fills in as people vote.</p>
                  )
                }
              >
                <Line
                  options={lineOptions}
                  data={{
                    labels: points.map((p) => fmtTime(p.t)),
                    datasets: [
                      {
                        label: 'Votes',
                        data: points.map((p) => p.count),
                        borderColor: chartColors.brand,
                        backgroundColor: 'rgba(194, 33, 90, 0.12)',
                        fill: true,
                      },
                    ],
                  }}
                />
              </ChartCard>
            </div>

            <div className="space-y-6 xl:sticky xl:top-20">
              <Card>
                <CardHeader title="Share the ballot" description={poll.show_on_public_page ? 'Also listed on the event page.' : 'Not listed on the event page; share this link.'} />
                <div className="p-5">
                  <SharePanel slug={poll.event_slug} pollId={poll.id} title={poll.title} />
                </div>
              </Card>
              <Card>
                <CardHeader title="Rules" />
                <ul className="space-y-1.5 px-5 py-4 text-sm text-ink-600">
                  <li>{voteModeLabel[poll.vote_mode]}{poll.require_checked_in ? ', checked-in only' : ''}</li>
                  <li>{poll.allow_multiple ? `Voters pick up to ${poll.max_choices}` : 'Voters pick one'}</li>
                  <li>{visibilityLabel[poll.results_visibility]}</li>
                </ul>
              </Card>
              <Card>
                <CardHeader title="Data" />
                <div className="flex flex-wrap gap-2 px-5 py-4">
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => doExport('results')}>Export results</Button>
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => doExport('votes')}>Export votes</Button>
                  <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={confirmReset} loading={reset.isPending} className="text-red-700 hover:bg-red-50 hover:text-red-800">
                    Delete all votes
                  </Button>
                </div>
                <p className="px-5 pb-4 text-xs text-ink-500">The votes export has times and choices only, never phone numbers, emails or ticket codes.</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
