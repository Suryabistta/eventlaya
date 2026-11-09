import React, { useDeferredValue, useState } from 'react'
import { useTrackSearch } from '@/lib/analytics'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useCities } from '@/lib/cities'
import { Building2, Camera, Flower2, LayoutGrid, Mic2, Music, Palette, Plus, Search, Shirt, Sparkles, Store, Truck, Utensils, Video } from 'lucide-react'
import { api } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, controlClass } from '@/components/ui'
import { cn } from '@/lib/utils'
import { FilterSelect, VENUE_TYPES, useErrorToast, useMarketplaceBase, vendorPath, venuePath } from './marketplace/shared'
import { VenueCard, VendorCard } from './marketplace/Cards'
import { BannerSlider } from '@/components/BannerSlider'

/** Category icons are lucide names set in Admin → Catalog; unknown names fall back to a shop. */
const CATEGORY_ICONS: Record<string, React.ElementType> = { Building2, Camera, Flower2, Mic2, Music, Palette, Shirt, Sparkles, Truck, Utensils, Video }

export const MarketplacePage: React.FC = () => {
  const { inApp, base } = useMarketplaceBase()
  const { status } = useAuth()
  const signedIn = status === 'authenticated'

  // City and category live in the URL so a filtered list can be shared
  const [params, setParams] = useSearchParams()
  const city = params.get('city') ?? ''
  const category = params.get('category') ?? ''
  const setParam = (key: string, value: string) =>
    setParams((p) => {
      if (value) p.set(key, value)
      else p.delete(key)
      return p
    }, { replace: true })
  const setCity = (v: string) => setParam('city', v)
  // One chip row: All · Venues · each vendor category (show=venues, or category=<slug>)
  const showVenues = params.get('show') === 'venues'
  const chip = showVenues ? 'venues' : category ? `c:${category}` : 'all'
  const pickChip = (value: string) => {
    setVenueType('') // venue type only shows under Venues
    setParams((p) => {
      p.delete('show')
      p.delete('category')
      if (value === 'venues') p.set('show', 'venues')
      else if (value.startsWith('c:')) p.set('category', value.slice(2))
      return p
    }, { replace: true })
  }
  const cityOptions = [{ value: '', label: 'All cities' }, ...useCities().map((c) => ({ value: c, label: c }))]
  const [venueType, setVenueType] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  useTrackSearch(deferredSearch, 'marketplace')


  const { data: categories = [] } = useQuery({
    queryKey: ['marketplaceCategories'],
    queryFn: api.getCategories,
  })

  const vendorsQuery = useQuery({
    queryKey: ['vendors', city],
    queryFn: () => api.getVendors({ city: city || undefined }),
  })

  const venuesQuery = useQuery({
    queryKey: ['venues', city, venueType, deferredSearch],
    queryFn: () => api.getVenues({ city: city || undefined, type: venueType || undefined, search: deferredSearch || undefined }),
  })

  const filtersActive = Boolean(city || chip !== 'all' || venueType || deferredSearch)
  const clearFilters = () => {
    setParams({}, { replace: true })
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

  // Vendors come in once per city; the category chip and the search filter them here
  const q = deferredSearch.toLowerCase()
  const allVendors = vendorsQuery.data ?? []
  const vendors = allVendors.filter((v) => (!category || v.category_slug === category) && (!q || v.business_name.toLowerCase().includes(q)))
  const vendorsResult = { ...vendorsQuery, data: vendorsQuery.data && vendors }
  const showVenueList = chip === 'all' || chip === 'venues'
  const showVendorList = chip !== 'venues'
  const chips: { value: string; label: string; icon: React.ElementType; count?: number }[] = [
    { value: 'all', label: 'All', icon: LayoutGrid },
    { value: 'venues', label: 'Venues', icon: Building2, count: venuesQuery.data?.length },
    ...categories.map((c) => ({
      value: `c:${c.slug}`,
      label: c.name,
      icon: CATEGORY_ICONS[c.icon] ?? Store,
      count: vendorsQuery.data ? allVendors.filter((v) => v.category_slug === c.slug).length : undefined,
    })),
  ]

  return (
    <div className={inApp ? 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10' : 'mx-auto max-w-6xl space-y-8 px-4 py-12 sm:px-6'}>
      {inApp ? (
        <PageHeader title="Vendors and venues" actions={listVenueAction} />
      ) : (
        // The banner replaces the intro text; the heading stays for screen readers and search engines
        <h1 className="sr-only">Vendors and venues in Eastern Nepal</h1>
      )}
      <BannerSlider placement="marketplace" />

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {/* Quick categories: one row, swiped sideways on phones */}
          <div
            role="tablist"
            aria-label="Browse by category"
            className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {chips.map((c) => (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={chip === c.value}
                onClick={() => pickChip(c.value)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors',
                  chip === c.value ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
                )}
              >
                <c.icon className="h-4 w-4" aria-hidden />
                {c.label}
                {c.count !== undefined && <span className={cn('tabular', chip === c.value ? 'text-white/70' : 'text-ink-400')}>{c.count}</span>}
              </button>
            ))}
          </div>
          {!inApp && <div className="hidden shrink-0 sm:block">{listVenueAction}</div>}
        </div>

        <div className={cn('grid gap-3', chip === 'venues' ? 'sm:grid-cols-[1fr_200px_200px]' : 'sm:grid-cols-[1fr_200px]')}>
          <div className="relative">
            <label htmlFor="market-search" className="sr-only">
              Search by name
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              id="market-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={chip === 'venues' ? 'Search venues by name' : chip === 'all' ? 'Search venues and vendors' : 'Search vendors by name'}
              className={cn(controlClass, 'pl-9')}
            />
          </div>
          {chip === 'venues' && (
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
          )}
          <FilterSelect id="market-city" label="City" value={city} onChange={setCity} options={cityOptions} />
        </div>
        {!inApp && <div className="sm:hidden">{listVenueAction}</div>}
      </div>

      {showVenueList && (
        <section aria-label="Venues" className="space-y-4">
          {chip === 'all' && <h2 className="font-display text-lg font-bold text-ink-900">Venues</h2>}
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
        </section>
      )}

      {showVendorList && (
        <section aria-label="Vendors" className="space-y-4">
          {chip === 'all' && <h2 className="font-display text-lg font-bold text-ink-900">Vendors</h2>}
          <Results
            query={vendorsResult}
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
        </section>
      )}
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
