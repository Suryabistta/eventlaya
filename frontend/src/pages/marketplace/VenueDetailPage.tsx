import React, { useEffect, useState } from 'react'
import { track } from '@/lib/analytics'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, MapPin, Pencil, Ruler, Users } from 'lucide-react'
import type { ServicePackage, VenueSpace } from '@/services/api'
import type { PublicSlot } from '@/lib/availability'
import { useAuth } from '@/lib/auth'
import { Badge, ButtonLink, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { BackLink, DETAIL_ASIDE, DETAIL_GRID, DETAIL_MAIN, DetailShell, Fact, MobileActionBar, NotFound, NotTakingRequests, Photo, Rating, Verified, fetchVenueBySlug, formatRs, spaceCapacity, spaceCountLabel, spaceTypeLabel, useErrorToast, useMarketplaceBase } from './shared'
import { VenueInquiryForm } from './VenueInquiryForm'
import { AvailabilitySection } from './AvailabilitySection'
import { ReviewsSection } from '@/components/reviews'
import { PhotoLightbox, withCover } from '@/components/PhotoLightbox'
import { PackagesSection } from './Packages'
import { ListingStatusNotice } from '../business/status'

const FORM_ID = 'venue-inquiry'

export const VenueDetailPage: React.FC = () => {
  const { slug = '' } = useParams()
  const { inApp, base } = useMarketplaceBase()
  const [photoIndex, setPhotoIndex] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [pkg, setPkg] = useState<ServicePackage | null>(null)
  const [spaceId, setSpaceId] = useState('')
  const [slot, setSlot] = useState<PublicSlot | null>(null)
  const { user } = useAuth()

  const { data: venue, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['venue', slug],
    queryFn: () => fetchVenueBySlug(slug),
  })

  useErrorToast(isError, error, 'Couldn’t load this venue')

  useEffect(() => {
    setPhotoIndex(0)
    setSpaceId('')
    setSlot(null)
    if (venue) document.title = `${venue.name} | Eventlaya`
  }, [venue])
  useEffect(() => { if (venue?.slug) track('select_content', { content_type: 'venue', item_id: venue.slug }) }, [venue?.slug])

  if (isLoading) {
    return (
      <DetailShell inApp={inApp}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <div className={DETAIL_GRID}>
          <Skeleton className="h-80 rounded-2xl sm:h-[420px] xl:col-span-8" />
          <Skeleton className="hidden h-[520px] rounded-2xl lg:block xl:col-span-4" />
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

  if (!venue) {
    return (
      <DetailShell inApp={inApp}>
        <BackLink to={base} />
        <NotFound what="venue" base={base} />
      </DetailShell>
    )
  }

  const photos = withCover(venue.featured_image, venue.images)
  const location = [venue.address, venue.city].filter(Boolean).join(', ')
  const spaces = venue.spaces ?? []
  const isOwner = Boolean(user && (user.id === venue.owner || user.role === 'superadmin'))
  const paused = Boolean(venue.is_paused)

  return (
    <DetailShell inApp={inApp}>
      <BackLink to={base} />
      {isOwner && <ListingStatusNotice status={venue.listing_status} note={venue.review_note} />}

      <header className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{venue.venue_type_display || venue.venue_type}</Badge>
          {venue.is_featured && <Badge tone="warning">Featured</Badge>}
        </div>
        <h1 className={cn('font-bold text-ink-900', inApp ? 'text-2xl sm:text-[28px] sm:leading-tight' : 'font-display text-3xl tracking-tight sm:text-4xl')}>
          {venue.name}
          {venue.is_verified && <Verified label="Verified venue" />}
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4 text-ink-400" aria-hidden />
              {location}
            </span>
            <Rating value={venue.review_average ?? venue.rating} count={venue.review_total || venue.review_count} />
          </div>
          {isOwner && (
            <ButtonLink to={`/app/listings/venues/${venue.slug}/edit`} variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />}>
              Edit venue and spaces
            </ButtonLink>
          )}
        </div>
      </header>

      <div className={DETAIL_GRID}>
        <div className={DETAIL_MAIN}>
          <div className="space-y-3">
            <button
              type="button"
              disabled={!photos.length}
              onClick={() => setLightbox(photoIndex)}
              aria-label={photos.length ? `Open photo ${photoIndex + 1} of ${photos.length} full screen` : undefined}
              className="block w-full cursor-zoom-in rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-default"
            >
              <Photo src={photos[photoIndex]} alt={venue.name} className="h-64 w-full rounded-2xl sm:h-[420px]" />
            </button>
            <PhotoLightbox
              photos={photos}
              index={lightbox}
              alt={venue.name}
              onIndex={(i) => {
                setLightbox(i)
                if (i !== null) setPhotoIndex(i)
              }}
            />
            {photos.length > 1 && (
              <div className="flex gap-2" role="group" aria-label="Photos">
                {photos.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setPhotoIndex(i)}
                    aria-label={`Show photo ${i + 1} of ${photos.length}`}
                    aria-pressed={i === photoIndex}
                    className={cn(
                      'h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors',
                      i === photoIndex ? 'border-brand-600' : 'border-transparent opacity-80 hover:opacity-100',
                    )}
                  >
                    <Photo src={src} className="h-full w-full [&>span]:hidden" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {spaces.length > 0 && (
            <Card>
              <CardHeader
                title="Halls and spaces"
                description={paused ? `${spaceCountLabel(spaces)} you can book separately.` : `${spaceCountLabel(spaces)} you can book separately. Pick one to ask about it.`}
              />
              <SpacePicker spaces={spaces} value={spaceId} onChange={setSpaceId} />
            </Card>
          )}

          {!paused && (
            <PackagesSection
              listing={{ venue: venue.id }}
              selectedId={pkg?.id}
              onSelect={(p) => {
                setPkg(p)
                document.getElementById(FORM_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          )}
          {!paused && (
            <AvailabilitySection
              kind="venue"
              listingId={venue.id}
              spaces={spaces}
              spaceId={spaceId}
              onSpaceChange={setSpaceId}
              selectedId={slot?.id}
              onSelect={setSlot}
              formId={FORM_ID}
            />
          )}

          <Card>
            <CardHeader title="About this venue" />
            <div className="space-y-4 p-5">
              {venue.description && <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">{venue.description}</p>}
              <dl className="divide-y divide-ink-100 border-t border-ink-100">
                <Fact label="Type">{venue.venue_type_display || venue.venue_type}</Fact>
                <Fact label="Capacity">
                  {venue.capacity_min.toLocaleString()} to {venue.capacity_max.toLocaleString()} guests
                  {spaces.length > 0 && <span className="text-ink-500"> across {spaceCountLabel(spaces)}</span>}
                </Fact>
                <Fact label="Price">
                  {spaces.length > 0 && 'From '}
                  <span className="font-semibold tabular">{formatRs(venue.price_from ?? venue.price_per_day)}</span> per day
                </Fact>
                <Fact label="Address">{location}</Fact>
                {venue.contact_person && <Fact label="Contact person">{venue.contact_person}</Fact>}
                {venue.contact_phone && (
                  <Fact label="Phone">
                    <a href={`tel:${venue.contact_phone}`} className="text-brand-700 underline-offset-2 hover:underline">
                      {venue.contact_phone}
                    </a>
                  </Fact>
                )}
                {venue.contact_email && (
                  <Fact label="Email">
                    <a href={`mailto:${venue.contact_email}`} className="break-all text-brand-700 underline-offset-2 hover:underline">
                      {venue.contact_email}
                    </a>
                  </Fact>
                )}
              </dl>
            </div>
          </Card>

          {venue.amenities?.length > 0 && (
            <Card>
              <CardHeader title="Amenities" />
              <ul className="grid gap-x-6 gap-y-2.5 p-5 sm:grid-cols-2">
                {venue.amenities.map((a) => (
                  <li key={a} className="flex items-start gap-2.5 text-sm text-ink-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {venue.rules_policy && (
            <Card>
              <CardHeader title="House rules" />
              <p className="whitespace-pre-line p-5 text-sm leading-relaxed text-ink-700">{venue.rules_policy}</p>
            </Card>
          )}

          <ReviewsSection kind="venue" targetKey={venue.id} targetName={venue.name} isOwner={Boolean(user && user.id === venue.owner)} id="reviews" />
        </div>

        <aside aria-label="Send an inquiry" className={DETAIL_ASIDE}>
          {paused ? (
            <NotTakingRequests name={venue.name} isOwner={isOwner} />
          ) : (
            <VenueInquiryForm venue={venue} id={FORM_ID} spaceId={spaceId} onSpaceChange={setSpaceId} slot={slot} onClearSlot={() => setSlot(null)} pkg={pkg} onClearPackage={() => setPkg(null)} />
          )}
        </aside>
      </div>

      {!paused && <MobileActionBar
        targetId={FORM_ID}
        label={slot ? 'Request this slot' : 'Send inquiry'}
        summary={
          <>
            {spaces.length > 0 && 'From '}
            <span className="font-semibold text-ink-900 tabular">{formatRs(venue.price_from ?? venue.price_per_day)}</span> per day
          </>
        }
      />}
    </DetailShell>
  )
}

const SpacePicker: React.FC<{ spaces: VenueSpace[]; value: string; onChange: (id: string) => void }> = ({ spaces, value, onChange }) => (
  <fieldset className="p-5">
    <legend className="sr-only">Choose a space</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {spaces.map((s) => {
        const selected = s.id === value
        return (
          <label
            key={s.id}
            className={cn(
              'relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
              selected ? 'border-brand-600 ring-1 ring-brand-600' : 'border-ink-200 hover:border-ink-300',
            )}
          >
            <input
              type="radio"
              name="venue-space"
              value={s.id}
              checked={selected}
              onChange={() => onChange(s.id)}
              className="sr-only"
            />
            {s.images?.[0] && <Photo src={s.images[0]} className="h-32 w-full" />}
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">{s.name}</p>
                  <p className="text-sm text-ink-500">{s.space_type_display || spaceTypeLabel(s.space_type)}</p>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300',
                  )}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </div>
              <ul className="space-y-1 text-sm text-ink-700">
                <li className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-ink-400" aria-hidden />
                  {spaceCapacity(s)}
                </li>
                {s.area_sqft ? (
                  <li className="flex items-center gap-1.5">
                    <Ruler className="h-4 w-4 text-ink-400" aria-hidden />
                    {s.area_sqft.toLocaleString()} sq ft
                  </li>
                ) : null}
              </ul>
              {s.amenities?.length > 0 && <p className="text-xs text-ink-500">{s.amenities.slice(0, 4).join(', ')}</p>}
              <p className="mt-auto pt-1 text-sm">
                <span className="font-semibold text-ink-900 tabular">{formatRs(s.price_per_day)}</span>
                <span className="text-ink-500"> per day</span>
              </p>
            </div>
            {selected && <span className="sr-only">Selected</span>}
          </label>
        )
      })}
    </div>
    {value && (
      <button type="button" onClick={() => onChange('')} className="mt-3 text-sm font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline">
        Clear selection
      </button>
    )}
  </fieldset>
)

export default VenueDetailPage
