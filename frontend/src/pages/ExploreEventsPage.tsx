import React, { useDeferredValue, useState } from 'react'
import { useTrackSearch } from '@/lib/analytics'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Search, Clock, Users, CalendarX2 } from 'lucide-react'
import { api, type Event } from '@/services/api'
import { buttonClass } from '@/components/ui/Button'
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { eventPhase } from '@/lib/phase'
import { spotsInfo } from '@/lib/event-page'
import { cn } from '@/lib/utils'

type PublicEvent = Event & { organizer_name?: string }

const cities = ['All cities', 'Dharan', 'Itahari', 'Biratnagar', 'Kathmandu']

export const ExploreEventsPage: React.FC = () => {
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming')
  const [city, setCity] = useState('All cities')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  useTrackSearch(deferredSearch, 'events')

  const { data: events = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['public-events', when, city, deferredSearch],
    queryFn: () =>
      api.getPublicEvents({ when, search: deferredSearch || undefined, city: city === 'All cities' ? undefined : city }),
    placeholderData: (prev) => prev,
  })

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
      <div className="max-w-2xl">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-ink-900 sm:text-5xl">
          Events in Eastern Nepal
        </h1>
        <p className="mt-3 text-lg text-ink-600">
          Fests, hackathons, concerts and conferences run on Eventlaya. Register in a minute and get your pass straight away.
        </p>
      </div>

      {/* Filters */}
      <div className="mt-10 flex flex-col gap-4 border-b border-ink-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div role="radiogroup" aria-label="Show" className="inline-flex shrink-0 self-start rounded-[10px] bg-ink-100 p-1">
            {(['upcoming', 'past'] as const).map((w) => (
              <button
                key={w}
                role="radio"
                aria-checked={when === w}
                onClick={() => setWhen(w)}
                className={cn(
                  'h-8 rounded-lg px-3.5 text-sm font-semibold transition-colors',
                  when === w ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {w === 'upcoming' ? 'Upcoming' : 'Past'}
              </button>
            ))}
          </div>
          {/* Wraps instead of scrolling sideways, so no city is cut off at the screen edge */}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="City">
            {cities.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={city === c}
                onClick={() => setCity(c)}
                className={cn(
                  'h-8 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors',
                  city === c ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <label className="relative block lg:w-72">
          <span className="sr-only">Search events</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events or venues"
            className="h-10 w-full rounded-[10px] border border-ink-200 bg-white pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>
      </div>

      {/* Results */}
      <div className="mt-6">
        {isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[23rem] rounded-2xl" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<CalendarX2 className="h-6 w-6" />}
            title={deferredSearch || city !== 'All cities' ? 'No events match those filters' : when === 'upcoming' ? 'No upcoming events yet' : 'No past events'}
            description={
              deferredSearch || city !== 'All cities'
                ? 'Try another city or a shorter search.'
                : 'Organizing something? Publish it on Eventlaya and it shows up here.'
            }
            action={
              <Link to="/signup" className={buttonClass('secondary', 'md')}>
                Publish an event
              </Link>
            }
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-500" aria-live="polite">
              {events.length} {events.length === 1 ? 'event' : 'events'}
            </p>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e) => (
                <EventCard key={e.id} event={e} past={when === 'past'} />
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-16 flex flex-col gap-4 rounded-2xl border border-ink-200 bg-ink-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="text-xl font-bold text-ink-900">Running an event?</h2>
          <p className="mt-1 text-ink-600">Put it on Eventlaya: registration form, QR passes and gate scanning. Free up to 150 attendees.</p>
        </div>
        <Link to="/signup" className={buttonClass('primary', 'lg', 'shrink-0')}>
          Start free
        </Link>
      </div>
    </div>
  )
}

/** Vertical event card: banner with the tear-off date, details, then the call to action. */
export const EventCard: React.FC<{ event: PublicEvent; past: boolean }> = ({ event: e, past }) => {
  const [bannerFailed, setBannerFailed] = useState(false)
  const start = new Date(`${e.start_date}T${e.start_time || '00:00'}`)
  // Hidden counts come back as capacity 0: use is_full, never "0 spots left"
  const { capacity, left: spotsLeft, full, hidden } = spotsInfo(e)
  const pct = capacity ? Math.min(100, Math.round((e.registered_count / capacity) * 100)) : 0
  const phase = eventPhase(e)
  const over = past || phase === 'ended' || phase === 'cancelled'
  const open = !over && (e.registration_open ?? (e.allow_registration && !full))

  return (
    <li
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-[0_8px_24px_rgba(28,23,36,0.08)]',
        over && 'bg-ink-50/60 [&_img]:grayscale-[60%]',
      )}
    >
      {/* Banner with the tear-off date */}
      <div className="relative aspect-[16/9] bg-gradient-to-br from-brand-100 via-brand-50 to-marigold-50">
        {e.banner && !bannerFailed && (
          <img
            src={e.banner}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={() => setBannerFailed(true)}
          />
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {phase === 'live' && (
            <Badge tone="success" dot>
              Happening now
            </Badge>
          )}
          {phase === 'ended' && <Badge tone="neutral">Ended</Badge>}
          {phase === 'cancelled' && <Badge tone="danger">Cancelled</Badge>}
        </div>
        <div
          className="absolute -bottom-7 left-4 flex w-[64px] flex-col overflow-hidden rounded-xl border border-ink-200 bg-white text-center shadow-sm"
          aria-hidden
        >
          <span className="bg-brand-600 py-0.5 text-[11px] font-semibold text-white">{start.toLocaleDateString(undefined, { month: 'short' })}</span>
          <span className="pt-1 font-display text-2xl font-bold leading-none text-ink-900">{start.getDate()}</span>
          <span className="pb-1 text-[11px] text-ink-500">{start.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-9">
        {e.organizer_name && <p className="truncate text-sm font-medium text-brand-700">{e.organizer_name}</p>}
        <h2 className="mt-0.5 line-clamp-2 text-lg font-bold leading-snug text-ink-900">
          <Link to={`/e/${e.slug}`} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">
            {e.title}
          </Link>
        </h2>
        <div className="mt-3 space-y-1.5 text-sm text-ink-600">
          <p className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <time dateTime={e.start_date} className="truncate">
              {start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              {e.start_time && `, ${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
            </time>
          </p>
          <p className="flex min-w-0 items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <span className="truncate">{e.location}</span>
          </p>
        </div>
        {hidden && full && !over && (
          <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-600">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Fully booked
          </p>
        )}
        {capacity !== null && !over && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100" aria-hidden>
              <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-600">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {full ? 'Fully booked' : `${spotsLeft} spots left`}
            </span>
          </div>
        )}

        <div className="relative z-[1] mt-auto pt-5">
          {open ? (
            <Link to={`/e/${e.slug}`} className={buttonClass('primary', 'md', 'w-full')}>
              Register
            </Link>
          ) : (
            <span className="inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-ink-100 px-4 text-sm font-semibold text-ink-600">
              {phase === 'cancelled' ? 'Cancelled' : over ? 'Ended' : full ? 'Fully booked' : 'Registration closed'}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

export default ExploreEventsPage
