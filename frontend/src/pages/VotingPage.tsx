import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, CalendarDays, Copy, Crown, Lock, MonitorPlay, Pencil, Play, Plus, Trash2, Trophy, Vote as VoteIcon } from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import { Button, ButtonLink, Card, EmptyState, ErrorState, IconButton, PageHeader, Skeleton, useToast } from '@/components/ui'
import { useModuleEnabled } from '@/lib/modules'
import { votingApi, type VotingPoll } from './voting/api'
import { PollStatusBadge, scheduleText, voteModeLabel } from './voting/shared'

const wrapClass = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'

export const VotingPage: React.FC = () => {
  const contestsOn = useModuleEnabled('contests')
  const { currentEvent, isLoading: eventsLoading, isError: eventsError, error: eventsErr, refetch: refetchEvents } = useCurrentEvent()

  const { data: polls = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['voting-polls', currentEvent?.id],
    queryFn: () => votingApi.list(currentEvent!.id),
    enabled: Boolean(currentEvent?.id),
    refetchInterval: 10000,
  })

  if (eventsError) {
    return (
      <div className={wrapClass}>
        <ErrorState message={eventsErr?.message} onRetry={refetchEvents} />
      </div>
    )
  }

  if (!eventsLoading && !currentEvent) {
    return (
      <div className={wrapClass}>
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="Create an event first"
            description="Polls belong to an event. Once you have one, you can run live votes for it here."
            action={<ButtonLink to="/app/events/new">Create event</ButtonLink>}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className={wrapClass}>
      <PageHeader
        title="Live voting"
        description={currentEvent ? `Audience polls and contests for ${currentEvent.title}. Counts refresh on their own.` : 'Audience polls and contests for your event.'}
        actions={
          <>
            {contestsOn && (
              <ButtonLink to="/app/voting/contests/new" variant="secondary" icon={<Crown className="h-4 w-4" />}>
                New contest
              </ButtonLink>
            )}
            <ButtonLink to="/app/voting/new" icon={<Plus className="h-4 w-4" />}>
              New poll
            </ButtonLink>
          </>
        }
      />

      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : eventsLoading || isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : polls.length === 0 ? (
        <Card>
          <EmptyState
            icon={<VoteIcon className="h-6 w-6" />}
            title="No polls for this event yet"
            description="Run a quick audience question, or a full contest: pageants, talent shows and awards with rounds, judges and SMS-verified voting."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink to="/app/voting/new" icon={<Plus className="h-4 w-4" />}>
                  New poll
                </ButtonLink>
                {contestsOn && (
                  <ButtonLink to="/app/voting/contests/new" variant="secondary" icon={<Crown className="h-4 w-4" />}>
                    New contest
                  </ButtonLink>
                )}
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {polls.filter((p) => contestsOn || p.kind !== 'contest').map((p) => (p.kind === 'contest' ? <ContestCard key={p.id} poll={p} /> : <PollCard key={p.id} poll={p} />))}
        </div>
      )}
    </div>
  )
}

/** Contests get their own dashboard; the card links there. */
const ContestCard: React.FC<{ poll: VotingPoll }> = ({ poll }) => (
  <Card className="flex flex-col">
    <div className="space-y-1 border-b border-ink-100 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-bold text-ink-900">
          <Link to={`/app/voting/contests/${poll.id}`} className="hover:underline">
            {poll.title}
          </Link>
        </h2>
        <PollStatusBadge status={poll.status} className="shrink-0" />
      </div>
      <p className="flex items-center gap-1.5 text-sm text-ink-500">
        <Crown className="h-3.5 w-3.5 text-marigold-600" aria-hidden /> Contest · {poll.candidates.length} contestants
      </p>
    </div>
    <dl className="grid flex-1 grid-cols-2 divide-x divide-ink-100 border-b border-ink-100">
      <div className="px-4 py-3 sm:px-5">
        <dt className="text-xs text-ink-500">Votes</dt>
        <dd className="mt-0.5 font-display text-xl font-bold text-ink-900 tabular">{poll.total_votes.toLocaleString()}</dd>
      </div>
      <div className="px-4 py-3 sm:px-5">
        <dt className="text-xs text-ink-500">Voters</dt>
        <dd className="mt-0.5 font-display text-xl font-bold text-ink-900 tabular">{poll.voters.toLocaleString()}</dd>
      </div>
    </dl>
    <div className="flex flex-wrap items-center gap-2 px-5 py-3">
      <ButtonLink to={`/app/voting/contests/${poll.id}`} size="sm" icon={<BarChart3 className="h-4 w-4" />}>
        Dashboard
      </ButtonLink>
      <ButtonLink to={`/app/voting/contests/${poll.id}/edit`} size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />}>
        Set up
      </ButtonLink>
      <ButtonLink to={`/app/voting/contests/${poll.id}/present`} size="sm" variant="secondary" icon={<MonitorPlay className="h-4 w-4" />}>
        Present
      </ButtonLink>
    </div>
  </Card>
)

const PollCard: React.FC<{ poll: VotingPoll }> = ({ poll }) => {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['voting-polls'] })

  const sorted = [...poll.candidates].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
  const top = sorted[0]?.votes ?? 0
  const leaders = top > 0 ? sorted.filter((c) => c.votes === top) : []
  const turnout = poll.registered ? Math.round((poll.voters / poll.registered) * 100) : 0

  const toggle = useMutation({
    mutationFn: () => (poll.status === 'open' ? votingApi.close(poll.id) : votingApi.open(poll.id)),
    onSuccess: (p) => {
      refresh()
      toast.success(p.status === 'open' ? 'Voting is open' : 'Voting closed', p.status === 'open' ? 'Share the link or QR code so people can vote.' : `${poll.title} no longer accepts votes.`)
    },
    onError: (e: Error) => toast.error(poll.status === 'open' ? 'Couldn’t close voting' : 'Couldn’t open voting', e.message),
  })

  const duplicate = useMutation({
    mutationFn: () => votingApi.duplicate(poll.id),
    onSuccess: (p) => {
      refresh()
      toast.success('Poll duplicated', `“${p.title}” was saved as a draft with the same candidates.`)
    },
    onError: (e: Error) => toast.error('Couldn’t duplicate the poll', e.message),
  })

  const remove = useMutation({
    mutationFn: () => votingApi.remove(poll.id),
    onSuccess: () => {
      refresh()
      toast.success('Poll deleted', poll.title)
    },
    onError: (e: Error) => toast.error('Couldn’t delete the poll', e.message),
  })

  const confirmDelete = async () => {
    const ok = await toast.confirm({
      title: `Delete “${poll.title}”?`,
      description:
        poll.total_votes > 0
          ? `Its ${poll.total_votes.toLocaleString()} votes will be deleted too. This can’t be undone.`
          : 'The poll and its candidates will be deleted. This can’t be undone.',
      confirmLabel: 'Delete poll',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const confirmToggle = async () => {
    if (poll.status === 'open') {
      const ok = await toast.confirm({
        title: 'Close voting now?',
        description: 'People won’t be able to vote any more. You can open it again later.',
        confirmLabel: 'Close voting',
      })
      if (!ok) return
    }
    toggle.mutate()
  }

  return (
    <Card className="flex flex-col">
      <div className="space-y-1 border-b border-ink-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-bold text-ink-900">
            <Link to={`/app/voting/${poll.id}`} className="hover:underline">
              {poll.title}
            </Link>
          </h2>
          <PollStatusBadge status={poll.status} className="shrink-0" />
        </div>
        <p className="text-sm text-ink-500">{scheduleText(poll)}</p>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-ink-100 border-b border-ink-100">
        <div className="px-4 py-3 sm:px-5">
          <dt className="text-xs text-ink-500">Votes</dt>
          <dd className="mt-0.5 font-display text-xl font-bold text-ink-900 tabular">{poll.total_votes.toLocaleString()}</dd>
        </div>
        {poll.vote_mode === 'ticket' ? (
          <div className="px-4 py-3 sm:px-5">
            <dt className="text-xs text-ink-500">Turnout</dt>
            <dd className="mt-0.5 font-display text-xl font-bold text-ink-900 tabular">{turnout}%</dd>
            <dd className="text-xs text-ink-500 tabular">
              {poll.voters} of {poll.registered} tickets
            </dd>
          </div>
        ) : (
          <div className="px-4 py-3 sm:px-5">
            <dt className="text-xs text-ink-500">Voters</dt>
            <dd className="mt-0.5 font-display text-xl font-bold text-ink-900 tabular">{poll.voters.toLocaleString()}</dd>
            <dd className="text-xs text-ink-500">Anyone with the link</dd>
          </div>
        )}
        <div className="min-w-0 px-4 py-3 sm:px-5">
          <dt className="text-xs text-ink-500">{leaders.length > 1 ? 'Tied for lead' : 'Leading'}</dt>
          <dd className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink-900">
            {leaders.length ? (
              <>
                <Trophy className="h-4 w-4 shrink-0 text-marigold-600" aria-hidden />
                <span className="truncate">{leaders.map((l) => l.name).join(', ')}</span>
              </>
            ) : (
              <span className="font-normal text-ink-500">No votes yet</span>
            )}
          </dd>
        </div>
      </dl>

      <p className="flex-1 px-5 py-3 text-sm text-ink-600">
        {poll.candidates.length} candidates. {voteModeLabel[poll.vote_mode]}
        {poll.allow_multiple ? `, pick up to ${poll.max_choices}` : ''}.
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-5 py-3">
        <Button
          size="sm"
          variant={poll.status === 'open' ? 'secondary' : 'primary'}
          icon={poll.status === 'open' ? <Lock className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          loading={toggle.isPending}
          onClick={confirmToggle}
        >
          {poll.status === 'open' ? 'Close voting' : poll.status === 'closed' ? 'Reopen' : 'Open voting'}
        </Button>
        <ButtonLink to={`/app/voting/${poll.id}`} size="sm" variant="secondary" icon={<BarChart3 className="h-4 w-4" />}>
          Results
        </ButtonLink>
        <ButtonLink to={`/app/voting/${poll.id}/present`} size="sm" variant="secondary" icon={<MonitorPlay className="h-4 w-4" />}>
          Present
        </ButtonLink>
        <div className="ml-auto flex items-center">
          <IconButton label={`Edit ${poll.title}`} onClick={() => navigate(`/app/voting/${poll.id}/edit`)}>
            <Pencil className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Duplicate ${poll.title}`} onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
            <Copy className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Delete ${poll.title}`} onClick={confirmDelete} disabled={remove.isPending} className="hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>
    </Card>
  )
}
