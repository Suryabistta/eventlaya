import React from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CalendarCheck, CheckCircle2, Clock, Inbox, Store } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatTile } from '@/components/ui'
import { AddListingActions, PAGE, useMyListings } from './ListingsPage'
import { fmtDate, timeAgo, useMyInquiries } from './InquiriesPage'
import { InquiryStatusBadge, ListingStatusBadge } from './status'

export const BusinessHomePage: React.FC = () => {
  const { user } = useAuth()
  const listings = useMyListings()
  const inquiries = useMyInquiries()

  const all = [
    ...(listings.data?.venues ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      kind: v.venue_type_display || 'Venue',
      status: v.listing_status,
      note: v.review_note,
      to: `/app/listings/venues/${v.slug}/edit`,
    })),
    ...(listings.data?.vendor_profiles ?? []).map((p) => ({
      id: p.id,
      name: p.business_name,
      kind: p.category_name,
      status: p.listing_status,
      note: p.review_note,
      to: `/app/listings/vendor/${p.id}/edit`,
    })),
  ]
  const count = (s: string) => all.filter((l) => l.status === s).length
  const rejected = all.filter((l) => l.status === 'rejected')
  const inbox = inquiries.data ?? []
  const fresh = inbox.filter((i) => i.status === 'pending')
  const booked = inbox.filter((i) => i.status === 'booked').length

  const loading = listings.isLoading || inquiries.isLoading

  return (
    <div className={PAGE}>
      <PageHeader
        title={user?.organization_name || 'Business home'}
        description="Your marketplace listings and the booking inquiries they bring in."
        actions={<AddListingActions />}
      />

      {listings.isError || inquiries.isError ? (
        <ErrorState
          message={(listings.error || inquiries.error)?.message}
          onRetry={() => {
            listings.refetch()
            inquiries.refetch()
          }}
        />
      ) : loading ? (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </>
      ) : (
        <>
          {rejected.length > 0 && (
            <div role="status" className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">{rejected.length === 1 ? `${rejected[0].name} needs changes` : `${rejected.length} listings need changes`}</span>{' '}
                  before {rejected.length === 1 ? 'it goes' : 'they go'} live. {rejected.length === 1 && rejected[0].note}
                </span>
              </p>
              <ButtonLink to={rejected.length === 1 ? rejected[0].to : '/app/listings'} variant="secondary" size="sm" className="shrink-0">
                {rejected.length === 1 ? 'Fix listing' : 'Review listings'}
              </ButtonLink>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile label="Live listings" value={count('approved')} hint="Visible in the marketplace" icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} tone="success" />
            <StatTile label="Waiting for review" value={count('pending')} hint="Usually within a working day" icon={<Clock className="h-5 w-5" aria-hidden />} tone="warning" />
            <StatTile label="New inquiries" value={fresh.length} hint="Not followed up yet" icon={<Inbox className="h-5 w-5" aria-hidden />} tone="brand" />
            <StatTile label="Bookings" value={booked} hint="Inquiries marked booked" icon={<CalendarCheck className="h-5 w-5" aria-hidden />} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <Card className="xl:col-span-7">
              <CardHeader
                title="Latest inquiries"
                description={fresh.length ? `${fresh.length} waiting for your reply` : 'You’re all caught up'}
                actions={
                  inbox.length > 0 && (
                    <Link to="/app/inquiries" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                      Open inbox
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )
                }
              />
              {inbox.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-6 w-6" />}
                  title="No inquiries yet"
                  description="Organizers’ booking requests for your venues will appear here."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {inbox.slice(0, 5).map((i) => (
                    <li key={i.id}>
                      <Link to={`/app/inquiries${i.status === 'pending' ? '?status=pending' : ''}`} className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-ink-50">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-900">{i.sender_name}</p>
                          <p className="truncate text-sm text-ink-500">
                            {i.event_type} on {fmtDate(i.event_date, false)}, {i.guest_count.toLocaleString()} guests
                          </p>
                          <p className="truncate text-xs text-ink-500">
                            {i.space_name || i.venue_name}, {timeAgo(i.created_at)}
                          </p>
                        </div>
                        <InquiryStatusBadge status={i.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="xl:col-span-5">
              <CardHeader
                title="Your listings"
                actions={
                  all.length > 0 && (
                    <Link to="/app/listings" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                      Manage
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  )
                }
              />
              {all.length === 0 ? (
                <EmptyState
                  icon={<Store className="h-6 w-6" />}
                  title="Add your first listing"
                  description="List a venue with its halls, or a service profile, so organizers can find you."
                  action={<ButtonLink to="/app/listings/venues/new" size="sm">Add venue</ButtonLink>}
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {all.map((l) => (
                    <li key={l.id}>
                      <Link to={l.to} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-ink-50">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-900">{l.name}</p>
                          <p className="truncate text-sm text-ink-500">{l.kind}</p>
                        </div>
                        <ListingStatusBadge status={l.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

export default BusinessHomePage
