import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, Award, ChevronLeft, ChevronRight, Clock, Crown, Facebook, Globe, HelpCircle, Info, Instagram, Lock, Search,
  Bell, ShieldCheck, Sparkles, Share2, ChevronDown, Users, CalendarClock, Tag, BookOpen, SquareCheckBig, Trophy, Vote as VoteIcon, X, Youtube,
} from 'lucide-react'
import { Badge, Button, Card, EmptyState, Modal, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PollStatusBadge, fmtDateTime, useCountdown } from '../shared'
import {
  contestApi, contestantPath, contestPath, type PublicContest, type PublicContestant, type PublicStandings, type SocialKey,
} from './api'
import { ContestantPhoto, ContestantStatusBadge, NumberTag, allowanceText } from './shared'
import { SharePanel } from './SharePanel'
import { isModuleOff } from './kit'
import { VoteFlow, type VoteCategory, type VoteTarget } from './VoteFlow'
import { ContestCover, CountdownBoxes } from '../stage'
import { NotifyMeModal } from '../NotifyMe'
import { BuyVotesFlow, PacksSection, PurchaseReturn, usePaymentReturn, type BuyChoice } from './BuyVotes'

const wrap = 'mx-auto w-full max-w-6xl space-y-6 px-4 pb-32 pt-6 sm:px-6 sm:pt-8'

type StatusFilter = 'all' | 'in' | 'out'

const canReceiveVotes = (contest: PublicContest, c: PublicContestant) =>
  contest.voting_open && c.in_current_round !== false && (c.status === 'active' || c.status === 'winner')

const toTarget = (c: PublicContestant): VoteTarget => ({
  id: c.id, name: c.name, display_number: c.display_number, number: c.number, slug: c.slug, photo_url: c.photo_url,
})

/** Contestants a category's public vote can go to (empty nominee list = every active contestant). */
function nomineesOf(contest: PublicContest, cat: PublicContest['categories'][number], all: PublicContestant[]) {
  if (cat.nominees.length) return all.filter((c) => cat.nominees.includes(c.id) && c.status !== 'withdrawn')
  return all.filter((c) => c.status === 'active' || c.status === 'winner')
}

function useVoteTarget() {
  const [target, setTarget] = useState<{ contestant: VoteTarget; category: VoteCategory | null } | null>(null)
  return {
    target,
    open: (contestant: VoteTarget, category: VoteCategory | null = null) => setTarget({ contestant, category }),
    close: () => setTarget(null),
  }
}

/* ------------------------------------------------------------------ */
/* Contest page                                                        */

export const ContestPublicPage: React.FC<{ slug: string; contestRef: string }> = ({ slug, contestRef }) => {
  const { data: contest, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public-contest', slug, contestRef],
    queryFn: () => contestApi.publicContest(slug, contestRef),
    refetchInterval: 15000,
  })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const vote = useVoteTarget()
  const [buy, setBuy] = useState<BuyChoice | null>(null)
  const [buyFor, setBuyFor] = useState<VoteTarget | null>(null)
  const [sort, setSort] = useState<'number' | 'votes'>('number')
  const payment = usePaymentReturn()

  const contestants = useMemo(() => contest?.contestants ?? [], [contest])
  const filtered = useMemo(() => {
    if (!contest) return []
    const q = query.trim().toLowerCase()
    const cat = contest.categories.find((c) => c.id === categoryFilter)
    const allowed = cat ? new Set(nomineesOf(contest, cat, contestants).map((c) => c.id)) : null
    return contestants.filter((c) => {
      if (allowed && !allowed.has(c.id)) return false
      const out = c.status === 'eliminated' || c.status === 'withdrawn' || c.in_current_round === false
      if (statusFilter === 'in' && out) return false
      if (statusFilter === 'out' && !out) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.display_number.toLowerCase().includes(q) ||
        String(c.number ?? '') === q.replace(/^#?0*/, '') ||
        c.subtitle.toLowerCase().includes(q) ||
        c.profile.some((p) => p.value.toLowerCase().includes(q))
      )
    })
  }, [contest, contestants, query, statusFilter, categoryFilter])

  if (isLoading) {
    return (
      <div className={wrap}>
        <Skeleton className="h-48 rounded-3xl" />
        <Skeleton className="h-8 w-2/3" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />)}
        </div>
      </div>
    )
  }
  if (isError || !contest) {
    return (
      <div className={wrap}>
        <Card>
          <EmptyState
            icon={<VoteIcon className="h-6 w-6" />}
            title={isModuleOff(error) ? 'This contest isn’t available' : 'We couldn’t find this contest'}
            description={isModuleOff(error) ? 'Contests are switched off on Eventlaya right now. Check back later.' : error?.message || 'The link may be old, or the contest isn’t public yet.'}
            action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
          />
        </Card>
      </div>
    )
  }

  const rankOf = new Map((contest.standings?.rows ?? []).map((r) => [r.contestant_id, r]))
  const votesVisible = contest.standings?.level === 'full'
  const sorted = sort === 'votes' && contest.standings && contest.show_ranks
    ? [...filtered].sort((a, b) => (rankOf.get(a.id)?.rank ?? 1e9) - (rankOf.get(b.id)?.rank ?? 1e9))
    : filtered
  const leader = contest.status === 'open' && contest.show_ranks ? (contest.standings?.rows ?? []).find((r) => r.rank === 1 && !r.tied)?.contestant_id : undefined
  const showOutChip = contestants.some((c) => c.status === 'eliminated' || c.status === 'withdrawn' || c.in_current_round === false)

  return (
    <div className={wrap}>
      <ContestHeader contest={contest} slug={slug} />

      {payment.paymentId && (
        <PurchaseReturn
          paymentId={payment.paymentId}
          contest={contest}
          onDismiss={payment.dismiss}
          onRetry={(choice) => { payment.dismiss(); if (choice) setBuy(choice) }}
          onVoteNow={(cid) => {
            payment.dismiss()
            const c = contestants.find((x) => x.id === cid)
            if (c) vote.open(toTarget(c))
            else document.getElementById('contestants')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />
      )}

      {/* Find a contestant */}
      {contestants.length > 0 && (
        <section id="contestants" aria-label="Contestants" className="scroll-mt-20 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink-900">Contestants</h2>
              <p className="mt-1 text-sm text-ink-500" aria-live="polite">
                {contest.voting_open ? (contest.paid.enabled && contest.paid.payments_available ? 'Pick your favourite and vote, or buy extra votes. ' : 'Pick your favourite and vote. ') : ''}
                {filtered.length === contestants.length ? `${contestants.length} contestants` : `${filtered.length} of ${contestants.length}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Sorting by votes reveals the ranking, so only when the organizer shows ranks */}
              {contest.standings && contest.show_ranks && (
                <>
                  <Chip active={sort === 'number'} onClick={() => setSort('number')}>{contest.show_numbers ? 'By number' : 'Default'}</Chip>
                  <Chip active={sort === 'votes'} onClick={() => setSort('votes')}>{votesVisible ? 'Most votes' : 'By rank'}</Chip>
                </>
              )}
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={contest.show_numbers ? "Search name or number" : "Search contestant"}
                  aria-label="Search contestants by name or number"
                  className="block h-9 w-full rounded-full border border-ink-200 bg-white pl-9 pr-8 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
          {(showOutChip || contest.categories.length > 0) && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter contestants">
              {showOutChip && (
                <>
                  <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</Chip>
                  <Chip active={statusFilter === 'in'} onClick={() => setStatusFilter('in')}>Still in</Chip>
                  <Chip active={statusFilter === 'out'} onClick={() => setStatusFilter('out')}>Out</Chip>
                </>
              )}
              {contest.categories.map((cat) => (
                <Chip key={cat.id} active={categoryFilter === cat.id} onClick={() => setCategoryFilter(categoryFilter === cat.id ? '' : cat.id)}>
                  {cat.name}
                </Chip>
              ))}
            </div>
          )}
          {filtered.length === 0 ? (
            <Card>
              <EmptyState icon={<Search className="h-6 w-6" />} title="No one matches" description="Try another name or number, or clear the filters." />
            </Card>
          ) : (
            <ul className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {sorted.map((c) => (
                <li key={c.id}>
                  <ContestantCard
                    contestant={c}
                    contest={contest}
                    href={contestantPath(slug, contestRef, c)}
                    rank={!contest.show_ranks || contest.standings?.total_votes === 0 || rankOf.get(c.id)?.tied ? null : rankOf.get(c.id)?.rank ?? null}
                    votes={votesVisible && contest.show_vote_counts ? rankOf.get(c.id)?.votes ?? 0 : null}
                    leading={leader === c.id}
                    onBuy={(choice) => { setBuyFor(toTarget(c)); setBuy(choice) }}
                    canVote={canReceiveVotes(contest, c) && contest.rules.main_vote_enabled}
                    onVote={() => vote.open(toTarget(c))}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {contest.standings && contest.show_standings !== false && <StandingsCard standings={contest.standings} title={contest.display_round ? `${contest.display_round.name} standings` : 'Standings'} slug={slug} contestRef={contestRef} />}

      {contest.categories.length > 0 && (
        <section aria-label="Awards" className="space-y-4">
          <h2 className="text-xl font-bold text-ink-900">Awards</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {contest.categories.map((cat) => (
              <CategoryCard key={cat.id} contest={contest} category={cat} contestants={contestants} slug={slug} contestRef={contestRef}
                onVote={(c) => vote.open(toTarget(c), { id: cat.id, name: cat.name })} />
            ))}
          </div>
        </section>
      )}

      <PacksSection contest={contest} onBuy={(c) => { setBuyFor(null); setBuy(c) }} />
      <HowVotingWorks contest={contest} />

      <Card className="p-5">
        <SharePanel eventSlug={slug} eventTitle={contest.event.title} contestRef={contestRef} contestTitle={contest.title} />
      </Card>

      <VoteFlow open={Boolean(vote.target)} onClose={vote.close} contest={contest} slug={slug} contestRef={contestRef}
        contestant={vote.target?.contestant ?? null} category={vote.target?.category ?? null}
        onBuy={(choice) => { const t = vote.target?.contestant ?? null; vote.close(); setBuyFor(t); setBuy(choice) }} />
      <BuyVotesFlow open={Boolean(buy)} onClose={() => setBuy(null)} contest={contest} slug={slug} contestRef={contestRef} contestant={buyFor} choice={buy} />
    </div>
  )
}

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      'h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors',
      active ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
    )}
  >
    {children}
  </button>
)

const ContestHeader: React.FC<{ contest: PublicContest; slug: string }> = ({ contest, slug }) => {
  const round = contest.current_round
  const target = contest.status === 'scheduled' ? contest.opens_at : contest.status === 'open' ? round?.closes_at ?? contest.closes_at : null
  const countdown = useCountdown(target)
  const [terms, setTerms] = useState(false)
  const closing = round?.closes_at ?? contest.closes_at
  const price = contest.paid.enabled ? contest.paid.price_per_vote ?? null : null
  const live = contest.status === 'open'
  const share = () => {
    const url = window.location.href
    if (navigator.share) navigator.share({ title: contest.title, url }).catch(() => {})
    else void navigator.clipboard?.writeText(url)
  }
  return (
    <header className="space-y-5">
      {contest.status === 'draft' && (
        <p className="rounded-xl border border-marigold-300 bg-marigold-50 px-4 py-3 text-sm text-marigold-900">
          <b>Preview.</b> Only you can see this page. Open voting from the contest dashboard to make it public.
        </p>
      )}
      <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
        <Link to="/" className="hover:text-ink-800">Home</Link> <span aria-hidden>/</span>{' '}
        <Link to="/voting" className="hover:text-ink-800">Voting</Link> <span aria-hidden>/</span>{' '}
        <Link to={`/e/${slug}`} className="hover:text-ink-800">{contest.event.title}</Link> <span aria-hidden>/</span>{' '}
        <span className="font-medium text-brand-700">{contest.title}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ink-900 sm:text-4xl">{contest.title}</h1>
        <div className="flex items-center gap-2">
          {contest.event.category_label && (
            <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{contest.event.category_label}</span>
          )}
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden /> LIVE
            </span>
          ) : (
            <PollStatusBadge status={contest.status} />
          )}
          {round && <Badge tone="brand">{round.name}</Badge>}
          <button type="button" onClick={share} aria-label="Share this contest" className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 text-ink-700 hover:bg-ink-50">
            <Share2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Stage banner */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-900">
        <div className="aspect-[16/9] sm:aspect-[16/6]">
          <ContestCover src={contest.cover_url} seed={contest.id} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-6">
          {countdown !== null && countdown > 0 ? (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/80">
                {contest.status === 'scheduled' ? 'Voting opens in' : round?.closes_at ? `${round.name} closes in` : 'Voting closes in'}
              </p>
              <CountdownBoxes ms={countdown} dark className="w-64 sm:w-72" />
            </div>
          ) : <span />}
          <div className="flex gap-2">
            <BannerStat label="Contestants" value={String(contest.contestants?.length ?? 0)} />
          </div>
        </div>
      </div>

      {/* Info strip */}
      <div className="grid gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm sm:grid-cols-3 sm:items-center sm:divide-x sm:divide-ink-100">
        {contest.event.organizer_name && <InfoItem icon={<Users className="h-4 w-4" />} label="Organizer" value={contest.event.organizer_name} />}
        {closing && (
          <InfoItem icon={<CalendarClock className="h-4 w-4" />} label={contest.status === 'scheduled' && contest.opens_at ? 'Opens' : 'Closing'}
            value={fmtDateTime(contest.status === 'scheduled' && contest.opens_at ? contest.opens_at : closing)} />
        )}
        <div className="flex items-center justify-between gap-3 sm:pl-4">
          <InfoItem icon={<Tag className="h-4 w-4" />} label="Vote cost"
            value={price ? <>{contest.paid.currency === 'NPR' ? 'Rs.' : contest.paid.currency} {Number(price).toLocaleString()} <span className="font-normal text-ink-500">/ vote</span></>
              : contest.rules.free_votes_enabled ? 'Free' : contest.paid.enabled ? 'Vote packs' : 'Free'} bare />
          {contest.event.terms && (
            <button type="button" onClick={() => setTerms(true)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-100">
              <BookOpen className="h-3.5 w-3.5" aria-hidden /> T&amp;C
            </button>
          )}
        </div>
      </div>
      {contest.event.terms && (
        <Modal open={terms} onClose={() => setTerms(false)} title="Terms & conditions">
          <p className="whitespace-pre-line text-sm text-ink-700">{contest.event.terms}</p>
        </Modal>
      )}

      {contest.winners_announced_at && (
        <div className="rounded-2xl border border-marigold-300 bg-marigold-50 px-5 py-4 text-marigold-950">
          <p className="font-display text-lg font-bold">🏆 Winners announced</p>
          {contest.announcement && <p className="mt-1 whitespace-pre-line">{contest.announcement}</p>}
        </div>
      )}
      {contest.description && <p className="max-w-3xl whitespace-pre-line text-ink-600">{contest.description}</p>}
      <VotingStatusLine contest={contest} />
    </header>
  )
}

const BannerStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-white backdrop-blur-sm">
    <p className="text-[10px] text-white/75">{label}</p>
    <p className="font-display text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
  </div>
)

const InfoItem: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; bare?: boolean }> = ({ icon, label, value, bare }) => (
  <div className={cn('flex min-w-0 items-center gap-3', !bare && 'sm:px-4 sm:first:pl-0')}>
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600" aria-hidden>{icon}</span>
    <div className="min-w-0">
      <p className="text-[11px] text-ink-500">{label}</p>
      <p className="truncate text-sm font-semibold text-ink-900">{value}</p>
    </div>
  </div>
)

/** One line telling voters whether and how they can vote right now. */
const VotingStatusLine: React.FC<{ contest: PublicContest }> = ({ contest }) => {
  const [notify, setNotify] = useState(false)
  const anyCategoryOpen = contest.categories.some((c) => c.voting_open)
  if (contest.status === 'scheduled') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-marigold-600" aria-hidden />
          <div>
            <p className="font-semibold text-ink-900">Voting hasn’t opened yet</p>
            <p className="mt-0.5 text-sm text-ink-600">{contest.opens_at ? `It opens ${fmtDateTime(contest.opens_at)}.` : 'Check back soon.'}</p>
          </div>
        </div>
        <Button variant="secondary" icon={<Bell className="h-4 w-4" />} onClick={() => setNotify(true)}>Notify me</Button>
        {notify && <NotifyMeModal open onClose={() => setNotify(false)} slug={contest.event.slug} contestRef={contest.slug || contest.id} title={contest.title} />}
      </div>
    )
  }
  if (contest.status === 'closed') {
    return (
      <Notice icon={<Lock className="h-5 w-5 text-ink-500" aria-hidden />} title="Voting has closed">
        {contest.standings ? 'Thanks to everyone who voted. See the results below.' : 'Results will be announced by the organizers.'}
      </Notice>
    )
  }
  if (!contest.voting_open && !anyCategoryOpen) {
    const next = contest.rounds.find((r) => r.status === 'upcoming')
    return (
      <Notice icon={<Info className="h-5 w-5 text-sky-600" aria-hidden />} title={contest.current_round ? `${contest.current_round.name} is decided by the judges` : 'No round is open for voting right now'}>
        {next?.opens_at ? `Public voting for ${next.name} opens ${fmtDateTime(next.opens_at)}.` : 'Check back for the next round.'}
      </Notice>
    )
  }
  return (
    <Notice icon={<Sparkles className="h-5 w-5 text-brand-600" aria-hidden />} title="Voting is open">
      {allowanceText(contest.rules)}
      {contest.rules.votes_per_day ? ' (resets at midnight, Nepal time)' : ''}.
      {!contest.rules.allow_split && ' All your votes go to one contestant.'}
    </Notice>
  )
}

const Notice: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="flex items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div>
      <p className="font-semibold text-ink-900">{title}</p>
      <p className="mt-0.5 text-sm text-ink-600">{children}</p>
    </div>
  </div>
)

const ContestantCard: React.FC<{
  contestant: PublicContestant
  contest: PublicContest
  href: string
  rank: number | null
  votes: number | null
  leading: boolean
  canVote: boolean
  onVote: () => void
  onBuy: (choice: BuyChoice) => void
}> = ({ contestant: c, contest, href, rank, votes, leading, canVote, onVote, onBuy }) => {
  const out = c.status === 'eliminated' || c.status === 'withdrawn' || c.in_current_round === false
  const [more, setMore] = useState(false)
  const paid = contest.paid
  const canBuy = canVote && paid.enabled && paid.payments_available && paid.buy_and_vote && (paid.packs.length > 0 || paid.custom_votes)
  const money = (v: string) => `${paid.currency === 'NPR' ? 'Rs.' : paid.currency} ${Number(v).toLocaleString()}`
  return (
    <article className={cn('flex h-full flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm', out && 'opacity-70')}>
      <Link to={href} className="group relative block" aria-label={`${c.display_number} ${c.name}: open profile`}>
        <ContestantPhoto name={c.name} photo={c.photo_url} rounded="rounded-none" className="aspect-[4/5] w-full text-4xl transition-transform duration-300 group-hover:scale-[1.02]" />
        <NumberTag value={c.display_number} className="absolute left-2 top-2 shadow" />
        {c.status === 'winner' ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-marigold-400 px-2 py-0.5 text-xs font-bold text-ink-900">
            <Crown className="h-3 w-3" aria-hidden /> Winner
          </span>
        ) : leading ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
            <Crown className="h-3 w-3" aria-hidden /> Leading
          </span>
        ) : rank !== null ? (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold text-ink-900 tabular">Rank {rank}</span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <Link to={href} className="min-w-0">
          <p className="line-clamp-2 font-bold leading-snug text-ink-900 hover:underline">{c.name}</p>
          {votes != null ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
              <SquareCheckBig className="h-3.5 w-3.5 text-brand-500" aria-hidden />
              <b className="text-ink-800 tabular-nums">{votes.toLocaleString()}</b> {votes === 1 ? 'vote' : 'votes'}
            </p>
          ) : c.subtitle ? <p className="truncate text-xs text-ink-500">{c.subtitle}</p> : null}
        </Link>
        {out && <ContestantStatusBadge status={c.status === 'active' ? 'eliminated' : c.status} className="self-start" />}
        <div className="mt-auto space-y-2 pt-1">
          {canVote ? (
            <Button className="w-full" onClick={onVote} aria-label={`Vote for ${c.display_number} ${c.name}`}>
              <VoteIcon className="h-4 w-4" aria-hidden /> Vote
            </Button>
          ) : (
            <Link to={href} className="flex h-10 w-full items-center justify-center rounded-[10px] border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-50">
              View profile
            </Link>
          )}
          {canBuy && (
            <div className={cn('rounded-[10px] border', more ? 'border-brand-300' : 'border-ink-200')}>
              <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}
                className="flex h-9 w-full items-center justify-between px-3 text-xs font-medium text-ink-700">
                Buy votes
                <ChevronDown className={cn('h-4 w-4 transition-transform', more && 'rotate-180')} aria-hidden />
              </button>
              {more && (
                <ul className="space-y-1 border-t border-ink-100 p-1.5">
                  {paid.packs.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => onBuy({ pack: p.id })} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-ink-50">
                        <span className="font-semibold text-ink-800">{p.total_votes} votes</span>
                        <span className="text-ink-500">{money(String(p.price))}</span>
                      </button>
                    </li>
                  ))}
                  {paid.custom_votes && paid.price_per_vote && (
                    <li>
                      <button type="button" onClick={() => onBuy({ votes: 10 })} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-ink-50">
                        <span className="font-semibold text-ink-800">Choose how many</span>
                        <span className="text-ink-500">{money(paid.price_per_vote)} / vote</span>
                      </button>
                    </li>
                  )}
                  {paid.providers.length > 0 && (
                    <li className="px-2 pt-1 text-[10px] text-ink-400">Pay with {paid.providers.map((p) => p.name).join(', ')}</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** Public standings, trimmed by the server to what the organizer allows (counts only on level "full"). */
const StandingsCard: React.FC<{ standings: PublicStandings; title: string; slug: string; contestRef: string }> = ({ standings, title, slug, contestRef }) => {
  const full = standings.level === 'full'
  const max = Math.max(1, ...standings.rows.map((r) => r.votes ?? 0))
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900">
          <Trophy className="h-5 w-5 text-marigold-500" aria-hidden />
          {title}
        </h2>
        <p className="text-sm text-ink-500">
          {full && standings.total_votes !== null ? `${standings.total_votes.toLocaleString()} votes` : standings.level === 'top' ? `Top ${standings.top_n}` : 'Ranks only'}
        </p>
      </div>
      {standings.weights && (
        <p className="mb-3 text-xs text-ink-500">Score = {standings.weights.judges}% judges + {standings.weights.public}% public vote</p>
      )}
      <ol className="space-y-3" aria-live="polite">
        {standings.rows.map((r) => (
          <li key={r.contestant_id}>
            <Link to={contestantPath(slug, contestRef, r)} className="flex items-center gap-3 rounded-xl p-1 hover:bg-ink-50">
              <span className="w-8 shrink-0 text-center font-display text-lg font-bold text-ink-900 tabular">{r.rank ?? '–'}</span>
              <ContestantPhoto name={r.name} photo={r.photo_url} className="h-11 w-11 shrink-0 text-sm" rounded="rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold text-ink-900">
                    <span className="mr-1.5 text-ink-500 tabular">{r.display_number}</span>
                    {r.name}
                  </span>
                  {full && r.votes !== undefined && (
                    <span className="shrink-0 text-sm text-ink-600 tabular">
                      {r.final !== undefined ? `${r.final.toFixed(1)} pts` : `${r.votes.toLocaleString()} (${r.percentage}%)`}
                    </span>
                  )}
                </span>
                {full && r.votes !== undefined && (
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                    <span className={cn('block h-full rounded-full', r.rank === 1 ? 'bg-brand-600' : 'bg-ink-300')} style={{ width: `${(((r.final ?? r.votes) ?? 0) / (r.final !== undefined ? 100 : max)) * 100}%` }} />
                  </span>
                )}
                {r.tied && <span className="text-xs text-ink-500">Tied</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}

const selectionLabel = { public_vote: 'Public vote', judges: 'Decided by the judges', manual: 'Chosen by the organizers' } as const

const CategoryCard: React.FC<{
  contest: PublicContest
  category: PublicContest['categories'][number]
  contestants: PublicContestant[]
  slug: string
  contestRef: string
  onVote: (c: PublicContestant) => void
}> = ({ contest, category: cat, contestants, slug, contestRef, onVote }) => {
  const [showAll, setShowAll] = useState(false)
  const nominees = nomineesOf(contest, cat, contestants)
  const winner = cat.winner ? contestants.find((c) => c.id === cat.winner) : null
  const shown = showAll ? nominees : nominees.slice(0, 6)
  const voteText = cat.votes_per_day ? `${cat.votes_per_day} free ${cat.votes_per_day === 1 ? 'vote' : 'votes'} a day` : cat.votes_per_voter ? `${cat.votes_per_voter} ${cat.votes_per_voter === 1 ? 'vote' : 'votes'} each` : ''
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-marigold-50 text-marigold-600">
          <Award className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-bold text-ink-900">{cat.name}</h3>
          <p className="text-sm text-ink-500">
            {selectionLabel[cat.selection]}
            {cat.selection === 'public_vote' && voteText && ` · ${voteText}`}
          </p>
        </div>
      </div>
      {cat.description && <p className="mt-2 text-sm text-ink-600">{cat.description}</p>}
      {winner ? (
        <Link to={contestantPath(slug, contestRef, winner)} className="mt-4 flex items-center gap-3 rounded-xl bg-marigold-50 p-3">
          <ContestantPhoto name={winner.name} photo={winner.photo_url} className="h-12 w-12 text-sm" rounded="rounded-xl" />
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-marigold-800">
              <Crown className="h-3.5 w-3.5" aria-hidden />
              Winner
            </span>
            <span className="block truncate font-semibold text-ink-900">{winner.display_number} {winner.name}</span>
          </span>
        </Link>
      ) : cat.standings ? (
        <ol className="mt-4 space-y-2">
          {cat.standings.rows.slice(0, 5).map((r) => (
            <li key={r.contestant_id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-center font-bold tabular">{r.rank ?? '–'}</span>
              <span className="min-w-0 flex-1 truncate">{r.display_number} {r.name}</span>
              {cat.standings!.level === 'full' && r.votes !== undefined && <span className="tabular text-ink-600">{r.votes}</span>}
            </li>
          ))}
        </ol>
      ) : null}
      {cat.voting_open && nominees.length > 0 && (
        <ul className="mt-4 space-y-2">
          {shown.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <Link to={contestantPath(slug, contestRef, c)} className="flex min-w-0 flex-1 items-center gap-3">
                <ContestantPhoto name={c.name} photo={c.photo_url} className="h-11 w-11 shrink-0 text-sm" rounded="rounded-xl" />
                <span className="min-w-0 truncate text-sm font-semibold text-ink-900">
                  <span className="mr-1 text-ink-500 tabular">{c.display_number}</span>
                  {c.name}
                </span>
              </Link>
              <Button size="sm" variant="secondary" onClick={() => onVote(c)} aria-label={`Vote for ${c.name} in ${cat.name}`}>
                Vote
              </Button>
            </li>
          ))}
          {nominees.length > 6 && (
            <li>
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm font-semibold text-brand-700 underline underline-offset-2">
                {showAll ? 'Show fewer' : `Show all ${nominees.length} nominees`}
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}

const methodText: Record<PublicContest['vote_mode'], string> = {
  sms_otp: 'We send a one-time code to your mobile number to check it’s really you. Your number is never shown to anyone and only a scrambled version is stored.',
  email_otp: 'We email you a one-time code to check it’s really you. Your email is never shown to anyone and only a scrambled version is stored.',
  account: 'Sign in with your Eventlaya account. Each account counts as one voter.',
  ticket: 'Use the ticket code printed on your event pass (or the ticket on your account). Each ticket counts as one voter.',
  contact: 'Enter your phone number or email. It is only used to count each person’s votes.',
  open: 'Anyone can vote from this device.',
}

const HowVotingWorks: React.FC<{ contest: PublicContest }> = ({ contest }) => {
  const r = contest.rules
  const judged = contest.rounds.some((x) => x.judging_enabled)
  return (
    <Card className="p-5">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-lg font-bold text-ink-900">
          <HelpCircle className="h-5 w-5 text-ink-500" aria-hidden />
          How voting works
        </summary>
        <ul className="mt-4 space-y-3 text-sm text-ink-700">
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{methodText[contest.vote_mode]}</li>
          <li className="flex gap-2"><VoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            {allowanceText(r)}{r.votes_per_day ? '. Daily votes reset at midnight, Nepal time' : ''}.
            {r.max_votes_per_submit > 1 ? ` You can give up to ${r.max_votes_per_submit} at once.` : ''}
            {r.votes_per_contestant ? ` At most ${r.votes_per_contestant} free votes per contestant${r.contestant_cap_period === 'day' ? ' per day' : r.contestant_cap_period === 'round' ? ' per round' : ''}.` : ''}
            {!r.allow_split ? ' All your votes go to one contestant.' : ''}
          </li>
          {contest.rounds.length > 0 && (
            <li className="flex gap-2"><Trophy className="mt-0.5 h-4 w-4 shrink-0 text-marigold-500" aria-hidden />
              The contest runs in rounds: {contest.rounds.map((x) => x.name).join(' → ')}.
              {judged ? ' In judged rounds, the final score combines the judges’ scores and the public vote.' : ''}
            </li>
          )}
          <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden />
            Votes from bots or suspicious bursts can be removed by the organizers.
          </li>
        </ul>
        {contest.transparency_note && (
          <div className="mt-4 rounded-xl bg-ink-50 p-4 text-sm text-ink-700">
            <p className="font-semibold text-ink-900">From the organizers</p>
            <p className="mt-1 whitespace-pre-line">{contest.transparency_note}</p>
          </div>
        )}
      </details>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Contestant profile                                                  */

const socialMeta: Record<SocialKey, { label: string; icon: React.ReactNode }> = {
  facebook: { label: 'Facebook', icon: <Facebook className="h-4 w-4" aria-hidden /> },
  instagram: { label: 'Instagram', icon: <Instagram className="h-4 w-4" aria-hidden /> },
  tiktok: { label: 'TikTok', icon: <Globe className="h-4 w-4" aria-hidden /> },
  youtube: { label: 'YouTube', icon: <Youtube className="h-4 w-4" aria-hidden /> },
  x: { label: 'X', icon: <Globe className="h-4 w-4" aria-hidden /> },
  website: { label: 'Website', icon: <Globe className="h-4 w-4" aria-hidden /> },
}

export const ContestantPage: React.FC<{ slug: string; contestRef: string; contestantRef: string }> = ({ slug, contestRef, contestantRef }) => {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public-contestant', slug, contestRef, contestantRef],
    queryFn: () => contestApi.publicContestant(slug, contestRef, contestantRef),
    refetchInterval: 20000,
  })
  const vote = useVoteTarget()
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [buy, setBuy] = useState<BuyChoice | null>(null)
  const payment = usePaymentReturn()

  if (isLoading) {
    return (
      <div className={wrap}>
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Skeleton className="aspect-[4/5] rounded-3xl" />
          <div className="space-y-3"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-24" /></div>
        </div>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className={wrap}>
        <Card>
          <EmptyState
            icon={<VoteIcon className="h-6 w-6" />}
            title={isModuleOff(error) ? 'This contest isn’t available' : 'We couldn’t find this contestant'}
            description={isModuleOff(error) ? 'Contests are switched off on Eventlaya right now. Check back later.' : error?.message || 'Check the number in the link.'}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => refetch()}>Try again</Button>
                <Link to={contestPath(slug, contestRef)} className="inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50">See all contestants</Link>
              </div>
            }
          />
        </Card>
      </div>
    )
  }

  const { contest, contestant: c } = data
  const photos = [c.photo_url, ...(c.gallery ?? [])].filter(Boolean) as string[]
  const mainOpen = canReceiveVotes(contest, c) && contest.rules.main_vote_enabled
  const categories = contest.categories.filter((cat) => cat.voting_open && (cat.nominees.length ? cat.nominees.includes(c.id) : c.status === 'active' || c.status === 'winner'))
  const links = Object.entries(c.social_links ?? {}).filter(([, v]) => v) as [SocialKey, string][]
  const label = `${c.display_number} ${c.name}`.trim()
  const s = c.standing

  const closedReason =
    contest.status === 'scheduled' ? 'Voting hasn’t opened yet'
      : contest.status === 'closed' ? 'Voting has closed'
        : c.status === 'withdrawn' ? `${c.name} has withdrawn`
          : c.status === 'eliminated' || c.in_current_round === false ? `${c.name} is no longer in the running`
            : !contest.voting_open ? (contest.current_round ? `${contest.current_round.name} is decided by the judges` : 'No round is open for voting')
              : null

  return (
    <div className={wrap}>
      <Link to={contestPath(slug, contestRef)} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All contestants · {contest.title}
      </Link>

      {payment.paymentId && (
        <PurchaseReturn
          paymentId={payment.paymentId}
          contest={contest}
          onDismiss={payment.dismiss}
          onRetry={(choice) => { payment.dismiss(); if (choice) setBuy(choice) }}
          onVoteNow={() => { payment.dismiss(); vote.open(toTarget(c)) }}
        />
      )}

      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-8">
        {/* Photos */}
        <div className="space-y-3 md:sticky md:top-20">
          <button type="button" className="relative block w-full" onClick={() => photos.length && setLightbox(0)} aria-label={photos.length ? `Enlarge photo of ${c.name}` : undefined} disabled={!photos.length}>
            <ContestantPhoto name={c.name} photo={c.photo_url} rounded="rounded-3xl" className="aspect-[4/5] w-full text-6xl" />
            <NumberTag value={c.display_number} className="absolute left-3 top-3 px-3 py-1 text-xl shadow-lg" />
          </button>
          {photos.length > 1 && (
            <ul className="grid grid-cols-4 gap-2" aria-label="Gallery">
              {photos.map((p, i) => (
                <li key={p + i}>
                  <button type="button" onClick={() => setLightbox(i)} className="block w-full overflow-hidden rounded-xl focus-visible:ring-2 focus-visible:ring-brand-500" aria-label={`Photo ${i + 1} of ${photos.length}`}>
                    <img src={p} alt="" loading="lazy" className="aspect-square w-full bg-ink-100 object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Details */}
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {c.status !== 'active' && <ContestantStatusBadge status={c.status} />}
              {contest.current_round && c.in_current_round && <Badge tone="brand">In {contest.current_round.name}</Badge>}
            </div>
            <h1 className="font-display text-3xl font-bold leading-tight text-ink-900 sm:text-4xl">{c.name}</h1>
            {c.subtitle && <p className="text-lg text-ink-600">{c.subtitle}</p>}
          </div>

          {s && (
            <div className="flex flex-wrap gap-3" aria-live="polite">
              {s.rank !== null && contest.show_ranks && (
                <div className="rounded-2xl bg-ink-900 px-4 py-3 text-white">
                  <p className="text-xs uppercase tracking-wide text-white/70">Rank</p>
                  <p className="font-display text-3xl font-bold tabular">{s.rank}{s.tied ? '=' : ''}</p>
                </div>
              )}
              {c.standing_level === 'full' && s.votes !== undefined && contest.show_vote_counts && (
                <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-ink-500">Votes</p>
                  <p className="font-display text-3xl font-bold text-ink-900 tabular">{s.votes.toLocaleString()}</p>
                </div>
              )}
              {c.standing_level === 'full' && s.final !== undefined && (
                <div className="rounded-2xl border border-ink-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-ink-500">Score</p>
                  <p className="font-display text-3xl font-bold text-ink-900 tabular">{s.final.toFixed(1)}</p>
                </div>
              )}
            </div>
          )}

          {c.description && <p className="whitespace-pre-line text-ink-700">{c.description}</p>}

          {c.profile.length > 0 && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {c.profile.map((p) => (
                <div key={p.key} className="rounded-xl border border-ink-200 bg-white px-3 py-2.5">
                  <dt className="text-xs text-ink-500">{p.label}</dt>
                  <dd className="mt-0.5 break-words font-semibold text-ink-900">{p.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {links.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Social links">
              {links.map(([k, v]) => (
                <li key={k}>
                  <a href={v} target="_blank" rel="noreferrer nofollow" className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700 hover:bg-ink-50">
                    {socialMeta[k]?.icon}
                    {socialMeta[k]?.label ?? k}
                  </a>
                </li>
              ))}
            </ul>
          )}

          {categories.length > 0 && (
            <Card className="p-4">
              <p className="text-sm font-semibold text-ink-900">Also nominated for</p>
              <ul className="mt-2 space-y-2">
                {categories.map((cat) => (
                  <li key={cat.id} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-ink-700">
                      <Award className="h-4 w-4 shrink-0 text-marigold-500" aria-hidden />
                      <span className="truncate">{cat.name}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => vote.open(toTarget(c), { id: cat.id, name: cat.name })}>Vote</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <PacksSection contest={contest} contestant={toTarget(c)} onBuy={setBuy} />

          <Card className="p-5">
            <SharePanel eventSlug={slug} eventTitle={contest.event.title} contestRef={contestRef} contestTitle={contest.title}
              contestant={{ number: c.number, slug: c.slug, name: c.name, display_number: c.display_number, photo_url: c.photo_url }} />
          </Card>

          <nav aria-label="Other contestants" className="flex items-center justify-between gap-3">
            {data.contestant.previous ? (
              <Link to={contestantPath(slug, contestRef, data.contestant.previous)} className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-ink-600 hover:text-ink-900">
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{data.contestant.previous.display_number} {data.contestant.previous.name}</span>
              </Link>
            ) : <span />}
            {data.contestant.next && (
              <Link to={contestantPath(slug, contestRef, data.contestant.next)} className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-ink-600 hover:text-ink-900">
                <span className="truncate">{data.contestant.next.display_number} {data.contestant.next.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      </div>

      {/* Sticky vote bar */}
      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] md:bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
          {mainOpen ? (
            <Button size="lg" className="w-full sm:ml-auto sm:w-auto sm:min-w-[320px]" onClick={() => vote.open(toTarget(c))}>
              <VoteIcon className="h-5 w-5" aria-hidden />
              <span className="truncate">Vote for {label}</span>
            </Button>
          ) : (
            <p className="w-full text-center text-sm font-medium text-ink-600">{closedReason ?? 'Public voting isn’t open for this contestant'}</p>
          )}
        </div>
      </div>

      <Modal open={lightbox !== null} onClose={() => setLightbox(null)} title={`${label} · photo ${(lightbox ?? 0) + 1} of ${photos.length}`} size="xl">
        {lightbox !== null && (
          <div className="space-y-3">
            <img src={photos[lightbox]} alt={`${c.name}, photo ${lightbox + 1}`} className="mx-auto max-h-[70vh] w-auto rounded-2xl object-contain" />
            {photos.length > 1 && (
              <div className="flex justify-between gap-2">
                <Button variant="secondary" onClick={() => setLightbox((i) => ((i ?? 0) - 1 + photos.length) % photos.length)} icon={<ChevronLeft className="h-4 w-4" />}>Previous</Button>
                <Button variant="secondary" onClick={() => setLightbox((i) => ((i ?? 0) + 1) % photos.length)}>Next<ChevronRight className="h-4 w-4" aria-hidden /></Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <VoteFlow open={Boolean(vote.target)} onClose={vote.close} contest={contest} slug={slug} contestRef={contestRef}
        contestant={vote.target?.contestant ?? null} category={vote.target?.category ?? null} />
      <BuyVotesFlow open={Boolean(buy)} onClose={() => setBuy(null)} contest={contest} slug={slug} contestRef={contestRef}
        contestant={toTarget(c)} choice={buy} />
    </div>
  )
}
