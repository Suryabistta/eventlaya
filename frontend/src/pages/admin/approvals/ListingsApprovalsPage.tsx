import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, EyeOff, MapPin, Search } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@/components/ui'
import { platformApi, type ListingKind, type ListingReview, type ReviewStatus } from '../api'
import { PAGE, ReasonDialog, RejectDialog, Segmented, countLabel, usePlatformAction, useReview, type ReviewTarget } from '../shared'
import { ListingCard, listingTarget, useListingReviews } from './cards'

type StatusView = ReviewStatus | 'all'

export const ListingsApprovalsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const status = (['pending', 'approved', 'rejected', 'all'].includes(params.get('status') ?? '') ? params.get('status') : 'pending') as StatusView
  const kind = (params.get('kind') as ListingKind | null) ?? 'all'
  const city = params.get('city') ?? ''
  const [search, setSearch] = useState('')
  const { data, isLoading, isError, error, refetch } = useListingReviews('all')
  const review = useReview()
  const run = usePlatformAction()
  const [rejecting, setRejecting] = useState<ReviewTarget | null>(null)
  const [unpublishing, setUnpublishing] = useState<ListingReview | null>(null)
  const [unpublishTo, setUnpublishTo] = useState<'pending' | 'rejected'>('pending')

  const setParam = (key: string, value: string, fallback: string) => {
    const p = new URLSearchParams(params)
    if (!value || value === fallback) p.delete(key)
    else p.set(key, value)
    setParams(p, { replace: true })
  }

  const cities = useMemo(() => [...new Set((data ?? []).map((l) => l.city).filter(Boolean))].sort(), [data])
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data ?? []).filter(
      (l) =>
        (kind === 'all' || l.kind === kind) &&
        (!city || l.city === city) &&
        (!q || [l.name, l.owner_name, l.owner_email, l.subtitle].some((v) => v?.toLowerCase().includes(q))),
    )
  }, [data, kind, city, search])
  const counts = useMemo(() => {
    const c: Record<StatusView, number> = { pending: 0, approved: 0, rejected: 0, all: base.length }
    base.forEach((l) => c[l.listing_status]++)
    return c
  }, [base])
  const rows = status === 'all' ? base : base.filter((l) => l.listing_status === status)

  return (
    <div className={PAGE}>
      <PageHeader
        title="Listings"
        description="Venues and service profiles on the public marketplace. New ones wait here until you approve them."
      />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <Segmented
          label="Status"
          value={status}
          onChange={(v) => setParam('status', v, 'pending')}
          options={[
            { value: 'pending', label: countLabel('Waiting for review', data && counts.pending) },
            { value: 'approved', label: countLabel('Live', data && counts.approved) },
            { value: 'rejected', label: countLabel('Rejected', data && counts.rejected) },
            { value: 'all', label: countLabel('All', data && counts.all) },
          ]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:w-[640px]">
          <div className="space-y-1.5">
            <label htmlFor="listing-search" className="block text-sm font-medium text-ink-800">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                id="listing-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or owner"
                className="block w-full rounded-[10px] border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm text-ink-900 placeholder:text-ink-400 shadow-2xs hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>
          <Select label="Type" value={kind} onChange={(e) => setParam('kind', e.target.value, 'all')}>
            <option value="all">Venues and services</option>
            <option value="venue">Venues</option>
            <option value="vendor">Service profiles</option>
          </Select>
          <Select label="City" value={city} onChange={(e) => setParam('city', e.target.value, '')}>
            <option value="">Any city</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            title={status === 'pending' && !search && !city && kind === 'all' ? 'You’re all caught up' : 'No listings match'}
            description={
              status === 'pending' && !search && !city && kind === 'all'
                ? 'New venues and service profiles wait here until you approve them.'
                : 'Try another status, type or city.'
            }
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3" aria-label="Listings">
          {rows.map((l) => (
            <ListingCard
              key={`${l.kind}-${l.id}`}
              l={l}
              busy={review.busyId === l.id}
              onApprove={() => review.approve(listingTarget(l))}
              onReject={() => setRejecting(listingTarget(l))}
              footer={
                l.listing_status === 'approved' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<EyeOff className="h-4 w-4" />}
                    onClick={() => {
                      setUnpublishTo('pending')
                      setUnpublishing(l)
                    }}
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button size="sm" icon={<Check className="h-4 w-4" />} loading={review.busyId === l.id} onClick={() => review.approve(listingTarget(l))}>
                    Approve now
                  </Button>
                )
              }
            />
          ))}
        </ul>
      )}

      <RejectDialog target={rejecting} onClose={() => setRejecting(null)} onReject={review.reject} />
      <ReasonDialog
        open={!!unpublishing}
        onClose={() => setUnpublishing(null)}
        title={`Unpublish ${unpublishing?.name ?? ''}?`}
        description="It disappears from the public marketplace straight away. The owner sees your reason."
        confirmLabel="Unpublish listing"
        placeholder="For example: the photos are of a different venue."
        onConfirm={(note) =>
          unpublishing
            ? run(
                () => platformApi.unpublishListing(unpublishing.kind, unpublishing.id, note, unpublishTo),
                ['Listing unpublished', unpublishTo === 'pending' ? `${unpublishing.name} is back in review.` : `${unpublishing.name} is marked as rejected.`],
                'Couldn’t unpublish the listing',
              )
            : undefined
        }
      >
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">Then</legend>
          <div className="mt-2 space-y-2">
            {(
              [
                ['pending', 'Send it back to review', 'The owner can fix it and you approve it again.'],
                ['rejected', 'Reject it', 'It stays off the marketplace until they change it.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-ink-200 px-3 py-2.5 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                <input
                  type="radio"
                  name="unpublish-to"
                  value={value}
                  checked={unpublishTo === value}
                  onChange={() => setUnpublishTo(value)}
                  className="mt-1 h-4 w-4 accent-brand-600"
                />
                <span>
                  <span className="block text-sm font-medium text-ink-900">{label}</span>
                  <span className="block text-xs text-ink-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </ReasonDialog>
    </div>
  )
}

export default ListingsApprovalsPage
