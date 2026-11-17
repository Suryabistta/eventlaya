import React, { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Star } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, controlClass, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'
import { platformApi, type FeaturedListingRow } from './api'
import { PAGE, Segmented } from './shared'

/** Superadmin → Featured listings: featured venues and vendors come first in the marketplace and fill the home page's
 *  featured band. Same idea as Featured events. */
export const FeaturedListingsPage: React.FC = () => {
  const toast = useToast()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [show, setShow] = useState<'all' | 'featured'>('all')
  const [kind, setKind] = useState<'' | 'venue' | 'vendor'>('')
  const q = useDeferredValue(search.trim())
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-featured-listings', q, show, kind],
    queryFn: () => platformApi.featuredListings(q, show === 'featured', kind),
    placeholderData: (prev) => prev,
  })
  // What the home page's Featured vendors band shows right now (same order: venue, vendor, venue…, 3 at most)
  // Same queries as the home page, so this always matches what visitors see
  const homeVenues = useQuery({ queryKey: ['featured-market', 'venues'], queryFn: () => api.getVenues({ featured: true }), staleTime: 60_000 })
  const homeVendors = useQuery({ queryKey: ['featured-market', 'vendors'], queryFn: () => api.getVendors({ featured: true }), staleTime: 60_000 })
  const a = (homeVenues.data ?? []).map((v) => v.name)
  const b = (homeVendors.data ?? []).map((v) => v.business_name)
  const onHome: string[] = []
  for (let i = 0; onHome.length < 3 && (i < a.length || i < b.length); i++) {
    if (i < a.length) onHome.push(a[i])
    if (onHome.length < 3 && i < b.length) onHome.push(b[i])
  }
  const featuredCount = a.length + b.length
  const toggle = useMutation({
    mutationFn: (x: FeaturedListingRow) => platformApi.featureListing(x.kind, x.id, !x.is_featured),
    onSuccess: (x) => {
      void qc.invalidateQueries({ queryKey: ['admin-featured-listings'] })
      void qc.invalidateQueries({ queryKey: ['featured-market'] })
      toast.success(x.is_featured ? `Featured ${x.name}` : `${x.name} is no longer featured`)
    },
    onError: (err: Error) => toast.error('Couldn’t update the listing', err.message),
  })

  return (
    <div className={PAGE}>
      <PageHeader title="Featured listings" description="Featured venues and vendors appear in the home page’s featured band and first in Find vendors, with a Featured badge." />
      <Card className="border-marigold-200 bg-marigold-50 p-4 text-sm text-ink-700">
        <p className="font-semibold text-ink-900">
          <Star className="mr-1.5 inline h-4 w-4 fill-current text-marigold-500" aria-hidden />
          On the home page now ({onHome.length} of 3)
        </p>
        {onHome.length ? (
          <p className="mt-1">{onHome.join(' · ')}</p>
        ) : (
          <p className="mt-1">Nothing yet. Press Feature on a venue or vendor below and it shows on the home page straight away.</p>
        )}
        {featuredCount > onHome.length && (
          <p className="mt-1 text-ink-500">{featuredCount - onHome.length} more featured: they show first in Find vendors but not on the home page. Remove one above to make room.</p>
        )}
        <p className="mt-1 text-ink-500">Tip: you can also press “Feature on home page” on any vendor or venue page.</p>
      </Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <Segmented label="Show" value={show} onChange={(v) => setShow(v as 'all' | 'featured')} options={[{ value: 'all', label: 'All' }, { value: 'featured', label: 'Featured' }]} />
          <Segmented label="Kind" value={kind || 'all'} onChange={(v) => setKind(v === 'all' ? '' : (v as 'venue' | 'vendor'))} options={[{ value: 'all', label: 'Both' }, { value: 'venue', label: 'Venues' }, { value: 'vendor', label: 'Vendors' }]} />
        </div>
        <label className="relative block sm:w-72">
          <span className="sr-only">Search listings</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or city" className={cn(controlClass, 'pl-9')} />
        </label>
      </div>

      {isLoading ? (
        <Card className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load listings." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={<Star className="h-6 w-6" />}
          title={show === 'featured' ? 'Nothing featured yet' : 'No listings found'}
          description={show === 'featured' ? 'Switch to All and press Feature on the venues and vendors to promote.' : 'Only approved listings can be featured.'}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {data.map((x) => (
              <li key={`${x.kind}-${x.id}`} className="flex items-center gap-4 px-5 py-3">
                <span className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-100">{x.image && <img src={x.image} alt="" className="h-full w-full object-cover" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-900">
                    <Link to={x.kind === 'vendor' ? `/marketplace/vendors/${x.id}` : `/marketplace`} target="_blank" className="truncate hover:text-brand-700 hover:underline">{x.name}</Link>
                    <Badge tone="neutral">{x.kind === 'venue' ? 'Venue' : 'Vendor'}</Badge>
                    {x.is_featured && <Badge tone="warning">Featured</Badge>}
                  </p>
                  <p className="truncate text-sm text-ink-500">{[x.type, x.city, x.owner].filter(Boolean).join(' · ')}</p>
                </div>
                <Button size="sm" variant={x.is_featured ? 'secondary' : 'primary'} icon={<Star className={cn('h-4 w-4', x.is_featured && 'fill-current text-marigold-500')} aria-hidden />} disabled={toggle.isPending} onClick={() => toggle.mutate(x)} aria-label={`${x.is_featured ? 'Remove from featured' : 'Feature'} ${x.name}`}>
                  {x.is_featured ? 'Remove' : 'Feature'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default FeaturedListingsPage
