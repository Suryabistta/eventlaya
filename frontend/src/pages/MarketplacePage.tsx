import React, { useDeferredValue, useState } from 'react'
import { useTrackSearch } from '@/lib/analytics'
import { useQuery } from '@tanstack/react-query'
import { Building2, Plus, Search, Store } from 'lucide-react'
import { api } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, controlClass } from '@/components/ui'
import { cn } from '@/lib/utils'
import { CITIES, FilterChips, VENUE_TYPES, useErrorToast, useMarketplaceBase, vendorPath, venuePath } from './marketplace/shared'
import { VenueCard, VendorCard } from './marketplace/Cards'

type Tab = 'venues' | 'vendors'

const cityOptions = [{ value: '', label: 'All cities' }, ...CITIES.map((c) => ({ value: c, label: c }))]

export const MarketplacePage: React.FC = () => {
  const { inApp, base } = useMarketplaceBase()
  const { status } = useAuth()
  const signedIn = status === 'authenticated'

  const [tab, setTab] = useState<Tab>('venues')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('')
  const [venueType, setVenueType] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  useTrackSearch(deferredSearch, 'marketplace')


  const { data: categories = [] } = useQuery({
    queryKey: ['marketplaceCategories'],
    queryFn: api.getCategories,
  })

  const vendorsQuery = useQuery({
    queryKey: ['vendors', category, city],
    queryFn: () => api.getVendors({ category: category || undefined, city: city || undefined }),
  })

  const venuesQuery = useQuery({
    queryKey: ['venues', city, venueType, deferredSearch],
    queryFn: () => api.getVenues({ city: city || undefined, type: venueType || undefined, search: deferredSearch || undefined }),
  })

  const filtersActive = Boolean(city || (tab === 'vendors' ? category : venueType || deferredSearch))
  const clearFilters = () => {
    setCity('')
    setCategory('')
    setVenueType('')
    setSearch('')
  }

  useErrorToast(venuesQuery.isError, venuesQuery.error, 'Couldn’t load venues')
  useErrorToast(vendorsQuery.isError, vendorsQuery.error, 'Couldn’t load vendors')

  const listVenueAction = (
    <ButtonLink
      to={signedIn ? '/app/listings/venues/new' : '/signup?type=vendor'}
      variant={inApp ? 'primary' : 'secondary'}
      icon={<Plus className="h-4 w-4" aria-hidden />}
    >
      List your venue
    </ButtonLink>
  )

  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'venues', label: 'Venues', icon: Building2, count: venuesQuery.data?.length },
    { id: 'vendors', label: 'Vendors', icon: Store, count: vendorsQuery.data?.length },
  ]

  return (
    <div className={inApp ? 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10' : 'mx-auto max-w-6xl space-y-8 px-4 py-12 sm:px-6'}>
      {inApp ? (
        <PageHeader
          title="Vendors and venues"
          description="Find halls, photographers, sound, decoration and catering in Eastern Nepal."
          actions={listVenueAction}
        />
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h1 className="font-display text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">Vendors and venues</h1>
            <p className="mt-3 text-lg text-ink-600">
              Halls, photographers, sound and stage, decoration and catering in Dharan, Itahari, Biratnagar and beyond. Compare
              prices and ask about your date directly.
            </p>
          </div>
          {listVenueAction}
        </div>
      )}

      <div className="space-y-4">
        <div role="tablist" aria-label="Browse" className="inline-flex rounded-xl bg-ink-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors',
                tab === t.id ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              <t.icon className="h-4 w-4" aria-hidden />
              {t.label}
              {t.count !== undefined && <span className="tabular text-ink-500">{t.count}</span>}
            </button>
          ))}
        </div>

        {tab === 'venues' ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div className="relative">
              <label htmlFor="venue-search" className="sr-only">
                Search venues by name
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                id="venue-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search venues by name"
                className={cn(controlClass, 'pl-9')}
              />
            </div>
            <div>
              <label htmlFor="venue-type" className="sr-only">
                Venue type
              </label>
              <select id="venue-type" value={venueType} onChange={(e) => setVenueType(e.target.value)} className={cn(controlClass, 'pr-8')}>
                <option value="">All venue types</option>
                {VENUE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <FilterChips
            label="Category"
            value={category}
            onChange={setCategory}
            options={[{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.slug, label: c.name }))]}
          />
        )}

        <FilterChips label="City" value={city} onChange={setCity} options={cityOptions} />
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'venues' ? (
          <Results
            query={venuesQuery}
            gridClass={inApp ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'grid gap-5 md:grid-cols-2'}
            skeletonClass="h-[440px]"
            empty={
              <EmptyState
                icon={<Building2 className="h-6 w-6" />}
                title={filtersActive ? 'No venues match these filters' : 'No venues listed yet'}
                description={filtersActive ? 'Try another city or venue type.' : 'Own a hall, lawn or auditorium? List it and start getting inquiries.'}
                action={filtersActive ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : listVenueAction}
              />
            }
            render={(v) => <VenueCard key={v.id} venue={v} to={venuePath(base, v)} />}
          />
        ) : (
          <Results
            query={vendorsQuery}
            gridClass={inApp ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3'}
            skeletonClass="h-60"
            empty={
              <EmptyState
                icon={<Store className="h-6 w-6" />}
                title={filtersActive ? 'No vendors match these filters' : 'No vendors listed yet'}
                description={filtersActive ? 'Try another city or category.' : 'Check back soon. New vendors are added every week.'}
                action={filtersActive ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined}
              />
            }
            render={(v) => <VendorCard key={v.id} vendor={v} to={vendorPath(base, v)} />}
          />
        )}
      </div>

    </div>
  )
}

interface ResultsProps<T> {
  query: { data?: T[]; isLoading: boolean; isError: boolean; error: Error | null; refetch: () => unknown }
  gridClass: string
  skeletonClass: string
  empty: React.ReactNode
  render: (item: T) => React.ReactNode
}

function Results<T>({ query, gridClass, skeletonClass, empty, render }: ResultsProps<T>) {
  if (query.isError) return <ErrorState message={query.error?.message} onRetry={() => query.refetch()} />
  if (query.isLoading) {
    return (
      <div className={gridClass}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn('rounded-2xl', skeletonClass)} />
        ))}
      </div>
    )
  }
  if (!query.data?.length) return <Card>{empty}</Card>
  return <div className={gridClass}>{query.data.map(render)}</div>
}
