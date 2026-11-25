import React from 'react'
import { Link } from 'react-router-dom'
import { Building2, MapPin, Star, Store } from 'lucide-react'
import type { Vendor, VenueWithSpaces } from '@/services/api'
import { Badge, ButtonLink, Card } from '@/components/ui'
import { BusinessLogo, Photo, Verified, formatRs, priceHidden } from './shared'
import { mediaUrl } from '@/lib/account'
import { cn } from '@/lib/utils'

// The title link stretches over the whole card (after:inset-0); the button sits above it.
const stretchedLink = 'after:absolute after:inset-0 after:rounded-2xl after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500'

/** `compact`: 16:9 photo and the event-card look, no amenities or host line (home page). */
export const VenueCard: React.FC<{ venue: VenueWithSpaces; to: string; compact?: boolean }> = ({ venue, to, compact }) => {
  return (
  <Card className={cn('relative flex flex-col overflow-hidden', compact ? 'rounded-lg border border-ink-200 bg-white shadow-none transition-[border-color,box-shadow] hover:border-ink-300 hover:shadow-[0_8px_24px_rgba(28,23,36,0.08)]' : 'transition-shadow hover:shadow-md')}>
    <div className={cn('relative shrink-0', compact ? 'aspect-[16/9]' : 'h-48 sm:h-60')}>
      <Photo src={venue.featured_image || venue.images?.[0]} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex gap-1.5">
        <Badge className="bg-white/95 text-ink-800 shadow-2xs">{venue.venue_type_display || venue.venue_type}</Badge>
        {venue.is_featured && <Badge tone="warning" className="shadow-2xs">Featured</Badge>}
      </div>
      {Number(venue.review_average ?? venue.rating) > 0 && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-bold text-ink-900 shadow-2xs">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
          {Number(venue.review_average ?? venue.rating).toFixed(1)}
        </span>
      )}
    </div>

    {/* Same body and footer as the vendor card: name, place, rating; price on the left, button on the right */}
    <div className="flex flex-1 flex-col gap-2 p-5">
      <h3 className="text-base font-bold leading-snug text-ink-900">
        <Link to={to} className={`hover:text-brand-700 ${stretchedLink}`}>
          {venue.name}
        </Link>
        {venue.is_verified && <Verified label="Verified venue" />}
      </h3>
      <p className="flex items-center gap-1 text-sm text-ink-500">
        <MapPin className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
        <span className="truncate">{venue.city || venue.address}</span>
      </p>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3">
      <p className="text-sm text-ink-500">
        {priceHidden(venue.price_from ?? venue.price_per_day) ? (
          <span className="font-semibold text-ink-700">Price on request</span>
        ) : (
          <>
            From <span className="font-semibold text-ink-900 tabular">{formatRs(venue.price_from ?? venue.price_per_day)}</span>
            <span className="text-ink-400"> /day</span>
          </>
        )}
      </p>
      <ButtonLink to={to} size="sm" variant="secondary" className="relative z-10" tabIndex={-1} aria-hidden icon={<Building2 className="h-4 w-4" aria-hidden />}>
        View venue
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
      {Number(vendor.review_average ?? vendor.rating) > 0 && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-bold text-ink-900 shadow-2xs">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
          {Number(vendor.review_average ?? vendor.rating).toFixed(1)}
        </span>
      )}
    </div>
    <div className="flex flex-1 flex-col gap-2 p-5">
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
