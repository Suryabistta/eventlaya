import React, { useEffect, useState } from 'react'
import { track } from '@/lib/analytics'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, CalendarClock, ChevronRight, Lock, Vote as VoteIcon } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Input, Modal, Skeleton, useToast } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { votingApi, type BallotInput, type PublicPoll } from './api'
import { BallotOption } from './ballot'
import { PollStatusBadge, ResultBars, fmtCountdown, fmtDateTime, useCountdown, votesLabel } from './shared'
import { ContestPublicPage, ContestantPage } from './contest/ContestPublicPage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VOTED_KEY = (pollId: string) => `eventlaya:voted:${pollId}`
const DEVICE_KEY = 'eventlaya:device-id'
const TICKET_KEY = (slug: string) => `eventlaya:ticket-code:${slug}`

interface VotedRecord {
  at: string
  candidate_ids: string[]
}

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode) */
  }
}
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

const wrap = 'mx-auto w-full max-w-2xl space-y-5 px-4 pb-32 pt-6 sm:px-6 sm:pt-10'

/**
 * /e/:slug/vote (all public polls), /e/:slug/vote/:pollId (one ballot, or a contest by id or slug)
 * and /e/:slug/vote/:pollId/c/:cref (a contestant's profile).
 */
export const PublicVotePage: React.FC = () => {
  const { slug, pollId, cref } = useParams<{ slug: string; pollId?: string; cref?: string }>()
  if (pollId && cref) return <ContestantPage slug={slug!} contestRef={pollId} contestantRef={cref} />
  if (pollId && !UUID_RE.test(pollId)) return <ContestPublicPage slug={slug!} contestRef={pollId} />
  return pollId ? <BallotPage slug={slug!} pollId={pollId} /> : <PollPicker slug={slug!} />
}

const PollPicker: React.FC<{ slug: string }> = ({ slug }) => {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public-polls', slug],
    queryFn: () => votingApi.publicPolls(slug),
    refetchInterval: 15000,
  })

  if (isLoading) return <div className={wrap}><Skeleton className="h-10 w-2/3" /><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /></div>
  if (isError) return <div className={wrap}><ErrorState message={error?.message} onRetry={refetch} /></div>
  const polls = data!.polls
  // One poll: go straight to the ballot
  if (polls.length === 1) {
    const only = polls[0]
    return only.kind === 'contest' ? <ContestPublicPage slug={slug} contestRef={only.slug || only.id} /> : <BallotPage slug={slug} pollId={only.id} />
  }

  return (
    <div className={wrap}>
      <BackToEvent slug={slug} title={data!.event.title} />
      <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Vote</h1>
      {polls.length === 0 ? (
        <Card>
          <EmptyState icon={<VoteIcon className="h-6 w-6" />} title="No voting right now" description="There aren’t any polls for this event yet. Check back during the event." action={<Link className="text-sm font-semibold text-brand-700 underline" to={`/e/${slug}`}>Back to the event</Link>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {polls.map((p) => (
            <li key={p.id}>
              <Link to={`/e/${slug}/vote/${p.kind === 'contest' ? p.slug || p.id : p.id}`} className="flex items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 hover:border-ink-300 hover:bg-ink-50">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-900">{p.title}</span>
                    {p.kind === 'contest' && <span className="rounded-full bg-marigold-50 px-2.5 py-0.5 text-xs font-semibold text-marigold-800">Contest</span>}
                    <PollStatusBadge status={p.status} />
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-500">
                    {p.kind === 'contest'
                      ? p.status === 'open' ? 'Voting is open. See the contestants' : p.status === 'scheduled' && p.opens_at ? `Opens ${fmtDateTime(p.opens_at)}` : 'See the contestants and results'
                      : p.status === 'open' ? (p.viewer?.has_voted || readJson<VotedRecord>(VOTED_KEY(p.id)) ? 'You’ve voted' : `${p.candidates.length} candidates`) : p.status === 'scheduled' && p.opens_at ? `Opens ${fmtDateTime(p.opens_at)}` : p.results_visible ? 'See the results' : 'Voting has closed'}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const BackToEvent: React.FC<{ slug: string; title: string }> = ({ slug, title }) => (
  <Link to={`/e/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900">
    <ArrowLeft className="h-4 w-4" aria-hidden />
    {title}
  </Link>
)

const BallotPage: React.FC<{ slug: string; pollId: string }> = ({ slug, pollId }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [voted, setVoted] = useState<VotedRecord | null>(() => readJson<VotedRecord>(VOTED_KEY(pollId)))
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [identity, setIdentity] = useState('')
  const [identityError, setIdentityError] = useState<string>()
  const { user } = useAuth()
  const [useCode, setUseCode] = useState(false)

  const { data: poll, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public-poll', slug, pollId],
    queryFn: () => votingApi.publicPoll(slug, pollId),
    refetchInterval: (q) => (q.state.data?.status === 'open' || q.state.data?.status === 'scheduled' ? 5000 : 30000),
  })
  const countdown = useCountdown(poll?.status === 'scheduled' ? poll.opens_at : poll?.status === 'open' ? poll.closes_at : null)

  useEffect(() => {
    if (poll?.vote_mode === 'ticket') setIdentity((v) => v || readJson<string>(TICKET_KEY(slug)) || '')
  }, [poll?.vote_mode, slug])

  const vote = useMutation({
    mutationFn: (body: BallotInput) => votingApi.vote(slug, pollId, body),
    onSuccess: (res) => {
      const rec = { at: new Date().toISOString(), candidate_ids: res.candidate_ids }
      write(VOTED_KEY(pollId), JSON.stringify(rec))
      if (poll?.vote_mode === 'ticket') write(TICKET_KEY(slug), JSON.stringify(identity.trim()))
      queryClient.setQueryData(['public-poll', slug, pollId], res.poll)
      setVoted(rec)
      setConfirming(false)
      track('vote_cast', { vote_type: 'poll', poll_id: pollId, event_slug: slug, choices: res.candidate_ids?.length ?? 1 })
      toast.success('Vote submitted', res.message)
    },
    onError: (e: Error) => {
      setIdentityError(e.message)
      toast.error('Vote not counted', e.message)
      if (/already voted/i.test(e.message)) {
        const rec = { at: new Date().toISOString(), candidate_ids: [] }
        write(VOTED_KEY(pollId), JSON.stringify(rec))
        setVoted(rec)
        setConfirming(false)
      }
    },
  })

  if (isLoading) return <div className={wrap}><Skeleton className="h-8 w-1/2" /><Skeleton className="h-10 w-3/4" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  if (poll?.kind === 'contest') return <ContestPublicPage slug={slug} contestRef={pollId} />
  if (isError || !poll) {
    return (
      <div className={wrap}>
        <Card>
          <EmptyState icon={<VoteIcon className="h-6 w-6" />} title="We couldn’t find this poll" description={error?.message || 'The link may be old, or the poll was removed.'} action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>} />
        </Card>
      </div>
    )
  }

  // Signed in with a ticket (or verified email) for this event: vote without typing a code.
  const accountVote = Boolean(user && poll.viewer?.can_vote_with_account && !useCode)
  const serverVoted = poll.viewer?.has_voted ? { at: '', candidate_ids: poll.viewer.candidate_ids } : null
  const ballot = voted ?? serverVoted

  const max = poll.max_choices
  const multi = poll.allow_multiple && max > 1
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : multi ? (p.length < max ? [...p, id] : p) : [id]))
  const pickedNames = poll.candidates.filter((c) => picked.includes(c.id)).map((c) => c.name)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = identity.trim()
    if (accountVote) {
      setIdentityError(undefined)
      vote.mutate({ candidate_ids: picked })
      return
    }
    if (poll.vote_mode !== 'open' && !v) {
      const msg = poll.vote_mode === 'ticket' ? 'Enter the ticket code from your pass.' : 'Enter your phone number or email.'
      setIdentityError(msg)
      toast.error('Vote not counted', msg)
      return
    }
    setIdentityError(undefined)
    vote.mutate({
      candidate_ids: picked,
      ...(poll.vote_mode === 'ticket' ? { ticket_code: v } : poll.vote_mode === 'contact' ? { contact: v } : { device_id: deviceId() }),
    })
  }

  const header = (
    <div className="space-y-2">
      <BackToEvent slug={slug} title={poll.event.title} />
      <div className="flex flex-wrap items-center gap-2">
        <PollStatusBadge status={poll.status} />
        {countdown !== null && countdown > 0 && (
          <span className="text-sm text-ink-600 tabular">
            {poll.status === 'open' ? 'Closes in' : 'Opens in'} {fmtCountdown(countdown)}
          </span>
        )}
      </div>
      <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">{poll.title}</h1>
      {poll.description && <p className="text-ink-600">{poll.description}</p>}
    </div>
  )

  const standings = poll.results_visible && poll.candidates.some((c) => c.votes !== undefined) && (
    <Card className="p-5">
      <p className="mb-4 text-sm font-medium text-ink-500">
        {poll.status === 'closed' ? 'Final results' : 'Current standings'}, {votesLabel(poll.total_votes ?? 0)}
      </p>
      <ResultBars
        items={poll.candidates.map((c) => ({ id: c.id, name: c.name, subtitle: c.subtitle, photo_url: c.photo_url, votes: c.votes ?? 0, percentage: c.percentage ?? 0 }))}
        leaderIds={leaderIds(poll)}
      />
    </Card>
  )

  if (ballot) {
    const mine = poll.candidates.filter((c) => ballot.candidate_ids.includes(c.id)).map((c) => c.name)
    return (
      <div className={wrap}>
        {header}
        <Card className="flex flex-col items-center px-6 py-8 text-center">
          <SuccessCheck />
          <h2 className="mt-4 text-xl font-bold text-ink-900">Your vote is in</h2>
          <p className="mt-1 text-sm text-ink-600">
            {mine.length ? `You voted for ${mine.join(', ')}.` : 'You’ve already voted in this poll.'} Each person gets one ballot.
          </p>
          {!poll.results_visible && <p className="mt-3 text-sm text-ink-500">Results will be announced by the organizers.</p>}
        </Card>
        {standings}
      </div>
    )
  }

  if (poll.status !== 'open') {
    return (
      <div className={wrap}>
        {header}
        <Card className="flex items-start gap-3 p-5">
          {poll.status === 'scheduled' ? <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-marigold-600" aria-hidden /> : <Lock className="mt-0.5 h-5 w-5 shrink-0 text-ink-500" aria-hidden />}
          <div>
            <p className="font-semibold text-ink-900">{poll.status === 'scheduled' ? 'Voting hasn’t opened yet' : 'Voting has closed'}</p>
            <p className="mt-0.5 text-sm text-ink-600">
              {poll.status === 'scheduled'
                ? poll.opens_at ? `It opens ${fmtDateTime(poll.opens_at)}. This page updates on its own.` : 'Check back during the event.'
                : poll.results_visible ? 'Thanks to everyone who voted. Here are the results.' : 'Results will be announced by the organizers.'}
            </p>
          </div>
        </Card>
        {poll.status === 'closed' ? standings : (
          <ul className="space-y-2" aria-label="Candidates">
            {poll.candidates.map((c) => (
              <li key={c.id}>
                <BallotOption candidate={c} name="ballot" multi={multi} selected={false} disabled onToggle={() => undefined} />
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className={wrap}>
      {header}
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-ink-600">
          {multi ? `Pick up to ${max}.` : 'Pick one.'}{' '}
          {multi && <span className="font-semibold text-ink-900 tabular" aria-live="polite">{picked.length} of {max} selected</span>}
        </legend>
        <div className="space-y-2">
          {poll.candidates.map((c) => (
            <BallotOption key={c.id} candidate={c} name="ballot" multi={multi} selected={picked.includes(c.id)} disabled={multi && picked.length >= max} onToggle={() => toggle(c.id)} />
          ))}
        </div>
      </fieldset>
      {poll.results_visible && <details className="text-sm text-ink-600"><summary className="cursor-pointer font-medium">See current standings</summary><div className="mt-3">{standings}</div></details>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <p className="min-w-0 flex-1 truncate text-sm text-ink-600">{picked.length ? pickedNames.join(', ') : 'Nothing selected yet'}</p>
          <Button disabled={!picked.length} onClick={() => { setIdentityError(undefined); setConfirming(true) }}>
            Review vote
          </Button>
        </div>
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm your vote"
        description="You can’t change it after you submit."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Change picks</Button>
            <Button type="submit" form="ballot-confirm" loading={vote.isPending}>Submit vote</Button>
          </>
        }
      >
        <form id="ballot-confirm" onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <p className="text-sm font-medium text-ink-500">Your {picked.length > 1 ? 'picks' : 'pick'}</p>
            <ul className="mt-1 space-y-0.5">
              {pickedNames.map((n) => <li key={n} className="font-semibold text-ink-900">{n}</li>)}
            </ul>
          </div>
          {accountVote && (
            <div className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
              <p className="font-semibold">Voting as {user?.email}</p>
              <p className="mt-0.5 text-emerald-800">
                {poll.vote_mode === 'ticket' ? 'Your pass for this event is on your account, so you don’t need a ticket code.' : 'Your verified email counts as your one ballot.'}
              </p>
              {identityError && <p className="mt-2 font-medium text-red-700">{identityError}</p>}
              {poll.vote_mode === 'ticket' && (
                <button type="button" onClick={() => setUseCode(true)} className="mt-2 text-xs font-semibold text-emerald-800 underline underline-offset-2">
                  Use a different ticket code
                </button>
              )}
            </div>
          )}
          {!accountVote && poll.vote_mode === 'ticket' && (
            <>
              <Input label="Ticket code" required autoFocus placeholder="TKT-0C4B62-0001" autoCapitalize="characters" autoComplete="off" value={identity} onChange={(e) => setIdentity(e.target.value)} error={identityError} hint={poll.require_checked_in ? 'Your ticket must have been scanned at the gate.' : undefined} />
              <details className="text-sm text-ink-600">
                <summary className="cursor-pointer font-medium text-brand-700">Find my code</summary>
                <p className="mt-1">It’s printed under the QR code on your pass, like TKT-0C4B62-0001. Your pass is in the email we sent when you registered.</p>
              </details>
            </>
          )}
          {!accountVote && poll.vote_mode === 'contact' && (
            <Input label="Phone or email" required autoFocus inputMode="email" autoComplete="email" placeholder="98XXXXXXXX or you@example.com" value={identity} onChange={(e) => setIdentity(e.target.value)} error={identityError} hint="Used only to make sure each person votes once. It isn’t shown to anyone." />
          )}
          {poll.vote_mode === 'open' && identityError && <p className="text-sm font-medium text-red-600">{identityError}</p>}
        </form>
      </Modal>
    </div>
  )
}

function leaderIds(poll: PublicPoll) {
  const top = Math.max(0, ...poll.candidates.map((c) => c.votes ?? 0))
  return top ? poll.candidates.filter((c) => c.votes === top).map((c) => c.id) : []
}

const SuccessCheck: React.FC = () => {
  const reduce = useReducedMotion()
  return (
    <motion.svg viewBox="0 0 64 64" className="h-20 w-20" aria-hidden initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
      <circle cx="32" cy="32" r="30" className="fill-emerald-50 stroke-emerald-600" strokeWidth="3" />
      <motion.path d="M20 33 l8 8 l16 -18" fill="none" className="stroke-emerald-600" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.45, ease: 'easeOut' }} />
    </motion.svg>
  )
}
