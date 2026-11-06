import React from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Store, Users } from 'lucide-react'
import type { Vendor, VenueWithSpaces } from '@/services/api'
import { Badge, ButtonLink, Card } from '@/components/ui'
import { Photo, Rating, Verified, formatRs, spaceCountLabel } from './shared'

// The title link stretches over the whole card (after:inset-0); the button sits above it.
const stretchedLink = 'after:absolute after:inset-0 after:rounded-2xl after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand-500'

export const VenueCard: React.FC<{ venue: VenueWithSpaces; to: string }> = ({ venue, to }) => {
  const spaces = venue.spaces ?? []
  return (
  <Card className="relative flex flex-col overflow-hidden transition-shadow hover:shadow-md">
    <div className="relative h-48 shrink-0 sm:h-60">
      <Photo src={venue.images?.[0]} className="h-full w-full" />
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
          {spaces.length > 0 && <p className="text-xs text-ink-500 sm:text-right">from</p>}
          <p className="font-display text-lg font-bold text-ink-900 tabular">{formatRs(venue.price_from ?? venue.price_per_day)}</p>
          <p className="text-xs text-ink-500">per day</p>
        </div>
      </div>

      <p className="line-clamp-2 text-sm leading-relaxed text-ink-600">{venue.description}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-700">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4 text-ink-400" aria-hidden />
          {spaces.length > 0 && <span className="font-medium text-ink-900">{spaceCountLabel(spaces)},</span>}
          {venue.capacity_min.toLocaleString()}–{venue.capacity_max.toLocaleString()} guests
        </span>
        <Rating value={venue.review_average ?? venue.rating} count={venue.review_total || venue.review_count} />
      </div>

      {venue.amenities?.length > 0 && (
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
        {venue.contact_person && (
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

export const VendorCard: React.FC<{ vendor: Vendor; to: string }> = ({ vendor, to }) => (
  <Card className="relative flex flex-col transition-shadow hover:shadow-md">
    <div className="flex flex-1 flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <Badge>{vendor.category_name}</Badge>
        <Rating value={vendor.review_average ?? vendor.rating} count={vendor.review_total || undefined} />
      </div>
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
      <p className="line-clamp-3 text-sm leading-relaxed text-ink-600">{vendor.description}</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3">
      <p className="text-sm text-ink-500">
        From <span className="font-semibold text-ink-900 tabular">{formatRs(vendor.starting_price)}</span>
      </p>
      <ButtonLink to={to} size="sm" variant="secondary" className="relative z-10" tabIndex={-1} aria-hidden icon={<Store className="h-4 w-4" aria-hidden />}>
        View vendor
      </ButtonLink>
    </div>
  </Card>
)
