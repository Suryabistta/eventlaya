import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Globe, Inbox, MapPin, Store, X } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { RejectDialog, timeAgo, useReview, type ReviewTarget } from '../shared'
import { listingTarget, marTarget, useListingReviews, useMarketplaceRequests, useWhiteLabelRequests, wlTarget } from './cards'

export const approvalPaths = {
  white_label: '/admin/approvals/white-label',
  marketplace: '/admin/approvals/marketplace',
  listing: '/admin/approvals/listings',
} as const

interface Row {
  target: ReviewTarget
  icon: React.ElementType
  kindLabel: string
  title: string
  detail: string
  image?: string | null
  createdAt: string
  to: string
}

/** Everything pending across white-label, marketplace access and listings, newest first, with inline decisions. */
export const PendingQueue: React.FC<{ limit?: number }> = ({ limit }) => {
  const wl = useWhiteLabelRequests()
  const mar = useMarketplaceRequests()
  const lst = useListingReviews()
  const review = useReview()
  const [rejecting, setRejecting] = useState<ReviewTarget | null>(null)

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...(wl.data ?? []).map((r) => ({
        target: wlTarget(r),
        icon: Globe,
        kindLabel: 'White-label',
        title: r.organizer_name,
        detail: r.requested_domain ? `Wants ${r.requested_domain} as ${r.brand_name}` : `Branding as ${r.brand_name}`,
        image: r.logo_url,
        createdAt: r.created_at,
        to: approvalPaths.white_label,
      })),
      ...(mar.data ?? []).map((r) => ({
        target: marTarget(r),
        icon: Store,
        kindLabel: 'Marketplace access',
        title: r.business_name,
        detail: `${r.business_type_display || r.business_type} in ${r.city}, from ${r.organization_name || r.user_email}`,
        createdAt: r.created_at,
        to: approvalPaths.marketplace,
      })),
      ...(lst.data ?? []).map((l) => ({
        target: listingTarget(l),
        icon: MapPin,
        kindLabel: l.kind === 'venue' ? 'Venue listing' : 'Service profile',
        title: l.name,
        detail: `${l.subtitle} in ${l.city}, by ${l.owner_name}`,
        image: l.image,
        createdAt: l.created_at,
        to: approvalPaths.listing,
      })),
    ]
    return all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }, [wl.data, mar.data, lst.data])

  if (wl.isLoading || mar.isLoading || lst.isLoading)
    return (
      <div className="space-y-3 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    )

  if (wl.isError && mar.isError && lst.isError)
    return (
      <div className="p-5">
        <ErrorState message="Couldn’t load pending requests." onRetry={() => [wl, mar, lst].forEach((q) => void q.refetch())} />
      </div>
    )

  if (rows.length === 0)
    return (
      <EmptyState
        icon={<Inbox className="h-6 w-6" />}
        title="You’re all caught up"
        description="White-label requests, marketplace access requests and new listings will show up here."
      />
    )

  const shown = limit ? rows.slice(0, limit) : rows

  return (
    <>
      <ul className="divide-y divide-ink-100">
        {shown.map((row) => (
          <li key={`${row.target.kind}-${row.target.id}`} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {row.image ? (
                <img src={row.image} alt="" className="h-9 w-9 shrink-0 rounded-xl border border-ink-200 bg-white object-cover" />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-marigold-50 text-marigold-700">
                  <row.icon className="h-4 w-4" aria-hidden />
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Link to={row.to} className="text-sm font-semibold text-ink-900 hover:underline">
                    {row.title}
                  </Link>
                  <Badge tone="neutral">{row.kindLabel}</Badge>
                </div>
                <p className="truncate text-sm text-ink-500">{row.detail}</p>
                <p className="text-xs text-ink-500">Sent {timeAgo(row.createdAt).toLowerCase()}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 pl-12 sm:pl-0">
              <Button
                variant="secondary"
                size="sm"
                icon={<X className="h-4 w-4" />}
                onClick={() => setRejecting(row.target)}
                disabled={review.busyId === row.target.id}
                aria-label={`Reject ${row.kindLabel.toLowerCase()} for ${row.title}`}
              >
                Reject
              </Button>
              <Button
                size="sm"
                icon={<Check className="h-4 w-4" />}
                onClick={() => review.approve(row.target)}
                loading={review.busyId === row.target.id}
                aria-label={`Approve ${row.kindLabel.toLowerCase()} for ${row.title}`}
              >
                Approve
              </Button>
            </div>
          </li>
        ))}
        {limit && rows.length > limit && (
          <li className="px-5 py-3 text-sm">
            <Link to="/admin/approvals" className="font-semibold text-brand-700 hover:underline">
              See {rows.length - limit} more
            </Link>
          </li>
        )}
      </ul>
      <RejectDialog target={rejecting} onClose={() => setRejecting(null)} onReject={review.reject} />
    </>
  )
}
