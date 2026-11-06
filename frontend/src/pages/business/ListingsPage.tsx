import React from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ExternalLink, Inbox, MapPin, Pause, Pencil, Play, Plus, Store } from 'lucide-react'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui'
import { Photo, formatRs, spaceCountLabel, useErrorToast } from '../marketplace/shared'
import { businessApi, type OwnedVendorProfile, type OwnedVenue } from './api'
import { ListingStatusBadge } from './status'

export const PAGE = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'

export const useMyListings = () => {
  const query = useQuery({ queryKey: ['my-listings'], queryFn: businessApi.myListings })
  useErrorToast(query.isError, query.error, 'Couldn’t load your listings')
  return query
}

const ReviewNote: React.FC<{ status?: string; note?: string }> = ({ status, note }) =>
  status === 'rejected' ? (
    <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
      <span className="font-semibold">What to change: </span>
      {note || 'Update the details and save to send it for review again.'}
    </p>
  ) : status === 'pending' ? (
    <p className="text-sm text-ink-500">Not public yet. We usually review new listings within a working day.</p>
  ) : null

/** Owner switch: a paused listing leaves the directory and stops taking new requests. */
const PauseToggle: React.FC<{ kind: 'venue' | 'vendor'; id: string; paused: boolean }> = ({ kind, id, paused }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const mutation = useMutation({
    mutationFn: () => businessApi.setListingPaused(kind, id, !paused),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-listings'] })
      toast.success(
        paused ? 'Listing resumed' : 'Listing paused',
        paused ? 'It’s back in the marketplace and taking requests.' : 'It’s hidden from the marketplace and won’t get new requests.',
      )
    },
    onError: (err) => toast.error(paused ? 'Couldn’t resume this listing' : 'Couldn’t pause this listing', err.message),
  })
  return (
    <Button
      variant="ghost"
      size="sm"
      className="flex-1 sm:flex-none"
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
      icon={paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
    >
      {paused ? 'Resume' : 'Pause'}
    </Button>
  )
}

const PausedNote: React.FC = () => (
  <p className="text-sm text-ink-500">Paused: hidden from the marketplace and not taking new requests. Existing requests still work.</p>
)

const ListingRow: React.FC<{
  kind: 'venue' | 'vendor'
  id: string
  paused: boolean
  image?: string
  title: string
  subtitle: string
  meta: React.ReactNode
  status?: OwnedVenue['listing_status']
  note?: string
  editTo: string
  publicTo: string
  editLabel: string
}> = ({ kind, id, paused, image, title, subtitle, meta, status, note, editTo, publicTo, editLabel }) => (
  <li className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
    <Photo src={image} alt="" className="h-40 w-full shrink-0 rounded-xl sm:h-24 sm:w-36 [&>span]:hidden" />
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold text-ink-900">
          <Link to={editTo} className="hover:text-brand-700">
            {title}
          </Link>
        </h3>
        <ListingStatusBadge status={status} />
        {paused && (
          <Badge tone="neutral">
            <Pause className="h-3.5 w-3.5" aria-hidden />
            Paused
          </Badge>
        )}
      </div>
      <p className="text-sm text-ink-600">{subtitle}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">{meta}</div>
      <ReviewNote status={status} note={note} />
      {paused && <PausedNote />}
    </div>
    <div className="flex shrink-0 flex-wrap gap-2 sm:w-44 sm:flex-col sm:flex-nowrap">
      <ButtonLink to={editTo} variant="secondary" size="sm" className="flex-1 sm:flex-none" icon={<Pencil className="h-4 w-4" aria-hidden />}>
        {editLabel}
      </ButtonLink>
      <ButtonLink to={publicTo} variant="ghost" size="sm" className="flex-1 sm:flex-none" icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
        {status === 'approved' ? 'View public page' : 'Preview'}
      </ButtonLink>
      <PauseToggle kind={kind} id={id} paused={paused} />
    </div>
  </li>
)

const VenueRow: React.FC<{ venue: OwnedVenue }> = ({ venue }) => {
  const spaces = venue.spaces ?? []
  return (
    <ListingRow
      kind="venue"
      id={venue.id}
      paused={Boolean(venue.is_paused)}
      image={venue.images?.[0]}
      title={venue.name}
      subtitle={venue.venue_type_display || venue.venue_type}
      status={venue.listing_status}
      note={venue.review_note}
      editTo={`/app/listings/venues/${venue.slug}/edit`}
      publicTo={`/marketplace/venues/${venue.slug}`}
      editLabel="Edit venue"
      meta={
        <>
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-4 w-4 text-ink-400" aria-hidden />
            {venue.city}
          </span>
          <span>{spaces.length ? spaceCountLabel(spaces) : 'Booked as a whole'}</span>
          <span>From {formatRs(venue.price_from ?? venue.price_per_day)} a day</span>
          <span className="inline-flex items-center gap-1">
            <Inbox className="h-4 w-4 text-ink-400" aria-hidden />
            {venue.inquiries_count ?? 0} {venue.inquiries_count === 1 ? 'inquiry' : 'inquiries'}
          </span>
        </>
      }
    />
  )
}

const VendorRow: React.FC<{ profile: OwnedVendorProfile }> = ({ profile }) => (
  <ListingRow
    kind="vendor"
    id={profile.id}
    paused={Boolean(profile.is_paused)}
    image={profile.portfolio_images?.[0]}
    title={profile.business_name}
    subtitle={profile.category_name}
    status={profile.listing_status}
    note={profile.review_note}
    editTo={`/app/listings/vendor/${profile.id}/edit`}
    publicTo={`/marketplace/vendors/${profile.id}`}
    editLabel="Edit profile"
    meta={
      <>
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-4 w-4 text-ink-400" aria-hidden />
          {profile.city}
        </span>
        <span>From {formatRs(profile.starting_price)}</span>
      </>
    }
  />
)

export const AddListingActions: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => (
  <>
    <ButtonLink to="/app/listings/vendor/new" variant="secondary" size={size} icon={<Store className="h-4 w-4" aria-hidden />}>
      Add service profile
    </ButtonLink>
    <ButtonLink to="/app/listings/venues/new" size={size} icon={<Plus className="h-4 w-4" aria-hidden />}>
      Add venue
    </ButtonLink>
  </>
)

export const ListingsPage: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useMyListings()
  const venues = data?.venues ?? []
  const profiles = data?.vendor_profiles ?? []

  return (
    <div className={PAGE}>
      <PageHeader
        title="Listings"
        description="Venues and services you offer in the Eventlaya marketplace. New listings and fixes go live after a quick review."
        actions={<AddListingActions />}
      />

      {isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : venues.length + profiles.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="List your first venue or service"
            description="Add a venue with its halls, or a service profile for sound, decoration, photography or catering. Organizers can find it once it’s approved."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <AddListingActions />
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Venues" description={venues.length ? `${venues.length} listed` : undefined} />
            {venues.length ? (
              <ul className="divide-y divide-ink-100">
                {venues.map((v) => (
                  <VenueRow key={v.id} venue={v} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Building2 className="h-6 w-6" />}
                title="No venues yet"
                description="Rent out a hall, lawn or auditorium? List it with each space organizers can book."
                action={<ButtonLink to="/app/listings/venues/new" size="sm">Add venue</ButtonLink>}
              />
            )}
          </Card>
          <Card>
            <CardHeader title="Service profiles" description={profiles.length ? `${profiles.length} listed` : undefined} />
            {profiles.length ? (
              <ul className="divide-y divide-ink-100">
                {profiles.map((p) => (
                  <VendorRow key={p.id} profile={p} />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Store className="h-6 w-6" />}
                title="No service profiles yet"
                description="Offer sound, lights, decoration, photography or catering? Add a profile so organizers can ask for quotes."
                action={<ButtonLink to="/app/listings/vendor/new" size="sm">Add service profile</ButtonLink>}
              />
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default ListingsPage
