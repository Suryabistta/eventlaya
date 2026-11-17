/** Public /voting page: every live, upcoming and past contest (pageants, talent shows...) across organizers. */
import React, { useDeferredValue, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bell, Clock, Search, SquareCheckBig, Trophy, Users } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { FilterSelect } from '../marketplace/shared'
import { contestApi, type PublicContestCard } from './contest/api'
import { fmtCountdown, publicVotePath, useCountdown } from './shared'
import { ContestCover, CountdownBoxes } from './stage'
import { NotifyMeModal } from './NotifyMe'

type When = 'live' | 'upcoming' | 'past'
const TABS: { key: When; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
]
const PAGE = 9

export const VotingListPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const when = (TABS.some((t) => t.key === params.get('when')) ? params.get('when') : 'live') as When
  const city = params.get('city') ?? ''
  const category = params.get('type') ?? ''
  const set = (key: string, v: string) =>
    setParams((p) => {
      if (v) p.set(key, v)
      else p.delete(key)
      return p
    }, { replace: true })
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const q = useDeferredValue(search.trim())
  const [shown, setShown] = useState(PAGE)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public-contests', when, city, q],
    queryFn: () => contestApi.publicContests({ when, city, search: q }),
    placeholderData: (prev) => prev,
  })
  const all = data?.results ?? []
  const types = useMemo(() => {
    const m = new Map<string, string>()
    all.forEach((c) => m.set(c.event.category, c.event.category_label))
    return [...m.entries()]
  }, [all])
  const list = category ? all.filter((c) => c.event.category === category) : all
  const live = data?.counts.live ?? 0

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50/70 to-white">
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-8 sm:px-6 sm:pt-10">
          <nav aria-label="Breadcrumb" className="text-xs text-ink-500">
            <Link to="/" className="hover:text-ink-800">Home</Link> <span aria-hidden>/</span>{' '}
            <span className="font-medium text-brand-700">Voting</span>
          </nav>
          <h1 className="mt-3 font-display text-3xl font-bold text-ink-900 sm:text-4xl">Voting</h1>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-600">Browse live contests and vote for your favourite contestants.</p>
            {data && (
              <p className="flex items-center gap-1.5 text-xs text-ink-600">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-600" aria-hidden />
                <b className="text-ink-900">{live} {live === 1 ? 'contest' : 'contests'}</b> open for voting
              </p>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-b border-ink-200 pb-5 md:flex-row">
            <div role="radiogroup" aria-label="Show" className="inline-flex shrink-0 self-start rounded-xl bg-ink-100 p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="radio"
                  aria-checked={when === t.key}
                  onClick={() => { set('when', t.key === 'live' ? '' : t.key); setShown(PAGE) }}
                  className={cn(
                    'h-9 rounded-lg px-4 text-sm font-semibold transition-colors',
                    when === t.key ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <FilterSelect
              id="contest-city"
              label="City"
              value={city}
              onChange={(v) => set('city', v)}
              options={[{ value: '', label: 'All cities' }, ...(data?.cities ?? []).map((c) => ({ value: c, label: c }))]}
              className="md:w-56"
            />
            <label className="relative block flex-1">
              <span className="sr-only">Search contests or contestants</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search contests or contestants"
                className="h-11 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
          </div>

          {types.length > 1 && (
            <div role="radiogroup" aria-label="Contest type" className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
              {[['', 'All contests'] as const, ...types].map(([slug, name]) => (
                <button
                  key={slug || 'all'}
                  role="radio"
                  aria-checked={category === slug}
                  onClick={() => set('type', slug)}
                  className={cn(
                    'h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors',
                    category === slug ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {isError ? (
          <ErrorState message={error?.message} onRetry={refetch} />
        ) : isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[440px] rounded-2xl" />)}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Trophy className="h-6 w-6" />}
            title={when === 'live' ? 'No contests open for voting' : when === 'upcoming' ? 'No upcoming contests' : 'No past contests'}
            description={q || city || category ? 'Try another search or filter.' : 'Check back soon.'}
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-500">{list.length} {list.length === 1 ? 'contest' : 'contests'}</p>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {list.slice(0, shown).map((c) => <ContestCard key={c.id} c={c} />)}
            </div>
            {list.length > shown && (
              <div className="mt-10 text-center">
                <button
                  onClick={() => setShown((n) => n + PAGE)}
                  className="h-11 rounded-full border border-ink-200 bg-white px-7 text-sm font-semibold text-ink-800 hover:border-ink-400"
                >
                  Load more contests
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** `compact` (home page): one-line "Ends in 2d 4h" instead of the countdown boxes. */
export const ContestCard: React.FC<{ c: PublicContestCard; compact?: boolean }> = ({ c, compact }) => {
  const to = publicVotePath(c.event.slug, c.slug || c.id)
  const live = c.status === 'open'
  const upcoming = c.status === 'scheduled'
  const target = live ? c.closes_at : upcoming ? c.opens_at : null
  const left = useCountdown(target)
  const [notify, setNotify] = useState(false)
  const dayIso = upcoming ? c.opens_at : c.closes_at
  const day = dayIso ? new Date(dayIso) : null

  return (
    <article className={cn('flex flex-col overflow-hidden', compact ? 'rounded-lg border border-ink-200 bg-white shadow-none transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-[0_8px_24px_rgba(28,23,36,0.08)]' : 'rounded-2xl border border-ink-100 bg-white shadow-sm transition-shadow hover:shadow-md')}>
      <Link to={to} className={cn('relative block', compact ? 'aspect-[16/9]' : 'aspect-[16/10]')} tabIndex={-1} aria-hidden>
        <ContestCover src={c.cover_url || c.event.banner} seed={c.id} />
        <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          {c.event.category_label}
        </span>
        <span
          className={cn(
            'absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
            live ? 'bg-brand-600 text-white' : 'bg-white text-ink-800',
          )}
        >
          {live && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          {live ? 'LIVE' : upcoming ? 'Opens soon' : 'Voting ended'}
        </span>
        {day && (
          <span className="absolute -bottom-5 left-4 w-12 overflow-hidden rounded-lg border border-ink-100 bg-white text-center shadow-sm">
            <span className="block bg-brand-600 py-0.5 text-[10px] font-bold text-white">{day.toLocaleString('en', { month: 'short' })}</span>
            <span className="block text-lg font-bold leading-tight text-ink-900">{String(day.getDate()).padStart(2, '0')}</span>
            <span className="block pb-0.5 text-[10px] text-ink-500">{day.toLocaleString('en', { weekday: 'short' })}</span>
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-5 pt-8">
        {c.organizer_name && <p className="text-sm text-brand-700">{c.organizer_name}</p>}
        <h2 className="mt-0.5 font-display text-xl font-bold text-ink-900">
          <Link to={to} className="hover:text-brand-700">{c.title}</Link>
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-600">
          <li className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-500" aria-hidden />{c.contestants} {c.contestants === 1 ? 'contestant' : 'contestants'}</li>
          {(upcoming || c.total_votes != null) && (
            <li className="flex items-center gap-2">
              <SquareCheckBig className="h-4 w-4 text-brand-500" aria-hidden />
              {upcoming ? 'Voting not started' : `${c.total_votes!.toLocaleString()} votes`}
            </li>
          )}
        </ul>
        <div className="mt-auto pt-4">
          {left != null && (live || upcoming) && compact && (
            <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink-700">
              <Clock className="h-4 w-4 text-brand-500" aria-hidden />
              {live ? 'Ends in' : 'Opens in'} {fmtCountdown(left)}
            </p>
          )}
          {left != null && (live || upcoming) && !compact && (
            <>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{live ? 'Voting ends in' : 'Voting opens in'}</p>
              <CountdownBoxes ms={left} className="mb-4" />
            </>
          )}
          {live ? (
            <Link to={to} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
              <SquareCheckBig className="h-4 w-4" aria-hidden /> Vote now
            </Link>
          ) : upcoming ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setNotify(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-brand-600 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                <Bell className="h-4 w-4" aria-hidden /> Notify me
              </button>
              <Link to={to} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ink-100 text-sm font-semibold text-ink-700 hover:bg-ink-200">
                <Clock className="h-4 w-4" aria-hidden /> Contestants
              </Link>
            </div>
          ) : (
            <Link to={to} className="flex h-11 items-center justify-center rounded-xl bg-ink-100 text-sm font-semibold text-ink-700 hover:bg-ink-200">
              Voting closed · View results
            </Link>
          )}
          {notify && <NotifyMeModal open onClose={() => setNotify(false)} slug={c.event.slug} contestRef={c.slug || c.id} title={c.title} />}
        </div>
      </div>
    </article>
  )
}
