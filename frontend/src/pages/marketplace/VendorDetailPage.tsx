import React, { useEffect, useState } from 'react'
import { track } from '@/lib/analytics'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Pencil, Store } from 'lucide-react'
import { Badge, ButtonLink, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { ListingStatusNotice } from '../business/status'
import { cn } from '@/lib/utils'
import { BackLink, DETAIL_ASIDE, DETAIL_GRID, DETAIL_MAIN, DetailShell, Fact, MobileActionBar, NotFound, NotTakingRequests, Photo, Rating, Verified, fetchVendor, formatRs, useErrorToast, useMarketplaceBase } from './shared'
import { VendorQuoteForm } from './VendorQuoteForm'
import { AvailabilitySection } from './AvailabilitySection'
import type { PublicSlot } from '@/lib/availability'
import { ReviewsSection } from '@/components/reviews'

const FORM_ID = 'vendor-quote'

export const VendorDetailPage: React.FC = () => {
  const { id = '' } = useParams()
  const { inApp, base } = useMarketplaceBase()
  const { user } = useAuth()
  const [slot, setSlot] = useState<PublicSlot | null>(null)

  const { data: vendor, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vendor', id],
    queryFn: () => fetchVendor(id),
  })
  useErrorToast(isError, error, 'Couldn’t load this vendor')

  useEffect(() => {
    setSlot(null)
    if (vendor) document.title = `${vendor.business_name} | Eventlaya`
  }, [vendor])
  useEffect(() => { if (vendor?.id) track('select_content', { content_type: 'vendor', item_id: vendor.id }) }, [vendor?.id])

  if (isLoading) {
    return (
      <DetailShell inApp={inApp}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <div className={DETAIL_GRID}>
          <Skeleton className="h-72 rounded-2xl xl:col-span-8" />
          <Skeleton className="hidden h-[440px] rounded-2xl lg:block xl:col-span-4" />
        </div>
      </DetailShell>
    )
  }

  if (isError) {
    return (
      <DetailShell inApp={inApp}>
        <BackLink to={base} />
        <ErrorState message={error?.message} onRetry={refetch} />
      </DetailShell>
    )
  }

  if (!vendor) {
    return (
      <DetailShell inApp={inApp}>
        <BackLink to={base} />
        <NotFound what="vendor" base={base} />
      </DetailShell>
    )
  }

  const location = [vendor.address, vendor.city].filter(Boolean).join(', ')
  const photos = vendor.portfolio_images?.filter(Boolean) ?? []
  const isOwner = Boolean(user && (user.id === vendor.user || user.role === 'superadmin'))
  const paused = Boolean(vendor.is_paused)

  return (
    <DetailShell inApp={inApp}>
      <BackLink to={base} />
      {isOwner && <ListingStatusNotice status={vendor.listing_status} note={vendor.review_note} />}

      <header className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{vendor.category_name}</Badge>
          {vendor.is_featured && <Badge tone="warning">Featured</Badge>}
        </div>
        <h1 className={cn('font-bold text-ink-900', inApp ? 'text-2xl sm:text-[28px] sm:leading-tight' : 'font-display text-3xl tracking-tight sm:text-4xl')}>
          {vendor.business_name}
          {vendor.is_verified && <Verified label="Verified business" />}
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4 text-ink-400" aria-hidden />
              {location}
            </span>
            <Rating value={vendor.review_average ?? vendor.rating} count={vendor.review_total || undefined} />
          </div>
          {isOwner && (
            <ButtonLink to={`/app/listings/vendor/${vendor.id}/edit`} variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />}>
              Edit profile
            </ButtonLink>
          )}
        </div>
      </header>

      <div className={DETAIL_GRID}>
        <div className={DETAIL_MAIN}>
          <Card>
            <CardHeader title="About" />
            <div className="space-y-4 p-5">
              {vendor.description && <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{vendor.description}</p>}
              <dl className="divide-y divide-ink-100 border-t border-ink-100">
                <Fact label="Service">{vendor.category_name}</Fact>
                <Fact label="Starting price">
                  <span className="font-semibold tabular">{formatRs(vendor.starting_price)}</span>
                </Fact>
                <Fact label="Based in">{location}</Fact>
                {vendor.phone && (
                  <Fact label="Phone">
                    <a href={`tel:${vendor.phone}`} className="text-brand-700 underline-offset-2 hover:underline">
                      {vendor.phone}
                    </a>
                  </Fact>
                )}
                {vendor.email && (
                  <Fact label="Email">
                    <a href={`mailto:${vendor.email}`} className="break-all text-brand-700 underline-offset-2 hover:underline">
                      {vendor.email}
                    </a>
                  </Fact>
                )}
              </dl>
            </div>
          </Card>

          {!paused && <AvailabilitySection kind="vendor" listingId={vendor.id} selectedId={slot?.id} onSelect={setSlot} formId={FORM_ID} />}

          <Card>
            <CardHeader title="Portfolio" />
            {photos.length ? (
              <ul className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
                {photos.map((src, i) => (
                  <li key={src}>
                    <Photo src={src} alt={`${vendor.business_name} portfolio photo ${i + 1}`} icon={Store} className="aspect-[4/3] w-full rounded-xl" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-ink-500">{vendor.business_name} hasn’t added portfolio photos yet. Ask for samples in your quote request.</p>
            )}
          </Card>

          <ReviewsSection kind="vendor" targetKey={vendor.id} targetName={vendor.business_name} isOwner={Boolean(user && user.id === vendor.user)} id="reviews" />
        </div>

        <aside aria-label="Request a quote" className={DETAIL_ASIDE}>
          {paused ? (
            <NotTakingRequests name={vendor.business_name} isOwner={isOwner} />
          ) : (
            <VendorQuoteForm vendor={vendor} id={FORM_ID} slot={slot} onClearSlot={() => setSlot(null)} />
          )}
        </aside>
      </div>

      {!paused && <MobileActionBar
        targetId={FORM_ID}
        label={slot ? 'Request this slot' : 'Request a quote'}
        summary={
          <>
            From <span className="font-semibold text-ink-900 tabular">{formatRs(vendor.starting_price)}</span>
          </>
        }
      />}
    </DetailShell>
  )
}

export default VendorDetailPage
