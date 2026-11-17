import React from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Store, Users } from 'lucide-react'
import type { Vendor, VenueWithSpaces } from '@/services/api'
import { Badge, ButtonLink, Card } from '@/components/ui'
import { BusinessLogo, Photo, Rating, Verified, formatRs, priceHidden, spaceCountLabel } from './shared'
import { mediaUrl } from '@/lib/account'
import { cn } from '@/lib/utils'

// The title link stretches over the whole card (after:inset-0); the button sits above it.
const stretchedLink = 'after:absolute after:inset-0 after:rounded-2xl after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500'

/** `compact`: 16:9 photo and the event-card look, no amenities or host line (home page). */
export const VenueCard: React.FC<{ venue: VenueWithSpaces; to: string; compact?: boolean }> = ({ venue, to, compact }) => {
  const spaces = venue.spaces ?? []
  return (
  <Card className={cn('relative flex flex-col overflow-hidden', compact ? 'rounded-lg border border-ink-200 bg-white shadow-none transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-[0_8px_24px_rgba(28,23,36,0.08)]' : 'transition-shadow hover:shadow-md')}>
    <div className={cn('relative shrink-0', compact ? 'aspect-[16/9]' : 'h-48 sm:h-60')}>
      <Photo src={venue.featured_image || venue.images?.[0]} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex gap-1.5">
        <Badge className="bg-white/95 text-ink-800 shadow-2xs">{venue.venue_type_display || venue.venue_type}</Badge>
        {venue.is_featured && <Badge tone="warning" className="shadow-2xs">Featured</Badge>}
      </div>
    </div>

    <div className="flex flex-1 flex-col gap-3 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-snug text-ink-900">
            <Link to={to} className={`hover:text-brand-700 ${stretchedLink}`}>
              {venue.name}
            </Link>
            {venue.is_verified && <Verified label="Verified venue" />}
          </h3>
          <p className="mt-0.5 flex items-start gap-1 text-sm text-ink-500">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            <span>
              {venue.address ? `${venue.address}, ` : ''}
              {venue.city}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-1 sm:block sm:text-right">
          {priceHidden(venue.price_from ?? venue.price_per_day) ? (
            <p className="text-sm font-semibold text-ink-700">Price on request</p>
          ) : (
            <>
              {spaces.length > 0 && <p className="text-xs text-ink-500 sm:text-right">from</p>}
              <p className="font-display text-lg font-bold text-ink-900 tabular">{formatRs(venue.price_from ?? venue.price_per_day)}</p>
              <p className="text-xs text-ink-500">per day</p>
            </>
          )}
        </div>
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-700">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-4 w-4 text-ink-400" aria-hidden />
            {spaces.length > 0 && <span className="font-medium text-ink-900">{spaceCountLabel(spaces)},</span>}
            {venue.capacity_min.toLocaleString()}–{venue.capacity_max.toLocaleString()} guests
          </span>
          <Rating value={venue.review_average ?? venue.rating} count={venue.review_total || venue.review_count} />
        </div>
      )}

      {!compact && venue.amenities?.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Amenities">
          {venue.amenities.slice(0, 4).map((a) => (
            <li key={a} className="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
              {a}
            </li>
          ))}
          {venue.amenities.length > 4 && <li className="px-1 py-0.5 text-xs text-ink-500">+{venue.amenities.length - 4} more</li>}
        </ul>
      )}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3">
      <p className="min-w-0 text-sm text-ink-500">
        {!compact && venue.contact_person && venue.show_host !== false && (
          <>
            Hosted by <span className="font-medium text-ink-700">{venue.contact_person}</span>
          </>
        )}
      </p>
      <ButtonLink to={to} size="sm" className="relative z-10" tabIndex={-1} aria-hidden>
        Check availability
      </ButtonLink>
    </div>
  </Card>
  )
}

export const VendorCard: React.FC<{ vendor: Vendor; to: string; compact?: boolean }> = ({ vendor, to, compact }) => (
  <Card className={cn('relative flex flex-col overflow-hidden', compact ? 'rounded-lg border border-ink-200 bg-white shadow-none transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-[0_8px_24px_rgba(28,23,36,0.08)]' : 'transition-shadow hover:shadow-md')}>
    {/* Same photo area as venue cards, with the vendor type on the top left */}
    <div className={cn('relative shrink-0', compact ? 'aspect-[16/9]' : 'h-48 sm:h-60')}>
      <Photo src={vendor.featured_image || vendor.portfolio_images?.[0]} icon={Store} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex gap-1.5">
        {vendor.category_name && <Badge className="bg-white/95 text-ink-800 shadow-2xs">{vendor.category_name}</Badge>}
        {vendor.is_featured && <Badge tone="warning" className="shadow-2xs">Featured</Badge>}
      </div>
    </div>
    <div className="flex flex-1 flex-col gap-3 p-5">
      {!compact && (
        <div className="flex justify-end">
          <Rating value={vendor.review_average ?? vendor.rating} count={vendor.review_total || undefined} />
        </div>
      )}
      <div className="flex min-w-0 items-center gap-3">
        <BusinessLogo src={mediaUrl(vendor.logo) ?? undefined} />
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-snug text-ink-900">
            <Link to={to} className={`hover:text-brand-700 ${stretchedLink}`}>
              {vendor.business_name}
            </Link>
            {vendor.is_verified && <Verified label="Verified business" />}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-500">
            <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {vendor.city}
          </p>
        </div>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3">
      <p className="text-sm text-ink-500">
        {priceHidden(vendor.starting_price) ? <span className="font-semibold text-ink-700">Price on request</span> : <>From <span className="font-semibold text-ink-900 tabular">{formatRs(vendor.starting_price)}</span></>}
      </p>
      <ButtonLink to={to} size="sm" variant="secondary" className="relative z-10" tabIndex={-1} aria-hidden icon={<Store className="h-4 w-4" aria-hidden />}>
        View vendor
      </ButtonLink>
    </div>
  </Card>
)
