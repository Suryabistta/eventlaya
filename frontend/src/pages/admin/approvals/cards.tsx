import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, ExternalLink, Globe, MapPin, Phone, Store, X } from 'lucide-react'
import { Badge, Button, Card } from '@/components/ui'
import { cn } from '@/lib/utils'
import {
  platformApi,
  type ListingReview,
  type MarketplaceAccessRequest,
  type ReviewStatus,
  type WhiteLabelRequest,
} from '../api'
import { ReviewBadge, fmtDate, listKey, timeAgo, type ReviewTarget } from '../shared'

export type StatusFilter = ReviewStatus | 'all'

/* ------------------------------------------------------------------ */
/* Data hooks (shared with the overview page)                           */

export const useWhiteLabelRequests = (status: StatusFilter = 'pending', enabled = true) =>
  useQuery({ queryKey: listKey('white_label', status), queryFn: () => platformApi.whiteLabelRequests(status), enabled })

export const useMarketplaceRequests = (status: StatusFilter = 'pending', enabled = true) =>
  useQuery({ queryKey: listKey('marketplace', status), queryFn: () => platformApi.marketplaceRequests(status), enabled })

export const useListingReviews = (status: StatusFilter = 'pending', enabled = true) =>
  useQuery({ queryKey: listKey('listing', status), queryFn: () => platformApi.listings(status, 'all'), enabled })

export const wlTarget = (r: WhiteLabelRequest): ReviewTarget => ({ kind: 'white_label', id: r.id, name: r.organizer_name })
export const marTarget = (r: MarketplaceAccessRequest): ReviewTarget => ({
  kind: 'marketplace',
  id: r.id,
  name: r.business_name || r.organization_name || r.user_email,
})
export const listingTarget = (l: ListingReview): ReviewTarget => ({ kind: 'listing', id: l.id, listingKind: l.kind, name: l.name })

/* ------------------------------------------------------------------ */
/* Cards                                                                */

interface CardShellProps {
  title: React.ReactNode
  subtitle: React.ReactNode
  status: ReviewStatus | 'revoked'
  createdAt: string
  reviewNote?: string
  reviewedAt?: string | null
  media?: React.ReactNode
  note?: string
  busy: boolean
  onApprove?: () => void
  onReject?: () => void
  /** Actions for decided items (reopen, unpublish …) */
  footer?: React.ReactNode
  children: React.ReactNode
}

const CardShell: React.FC<CardShellProps> = ({
  title,
  subtitle,
  status,
  createdAt,
  reviewNote,
  reviewedAt,
  media,
  note,
  busy,
  onApprove,
  onReject,
  footer,
  children,
}) => (
  <li className="min-w-0">
    <Card className="flex h-full min-w-0 flex-col">
      <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
        {media}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="truncate text-base font-bold text-ink-900">{title}</h2>
            <ReviewBadge status={status} short />
          </div>
          <p className="mt-0.5 truncate text-sm text-ink-500">{subtitle}</p>
        </div>
        <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()} className="shrink-0 text-xs text-ink-500">
          {timeAgo(createdAt)}
        </time>
      </div>
      <div className="flex-1 space-y-4 px-5 py-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{children}</dl>
        {note && (
          <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-700">
            <p className="text-xs font-medium text-ink-500">Their note</p>
            <p className="mt-0.5 whitespace-pre-line">{note}</p>
          </div>
        )}
        {status !== 'pending' && (
          <p className="text-sm text-ink-600">
            {{ approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked', pending: '' }[status]}
            {reviewedAt ? ` on ${fmtDate(reviewedAt)}` : ''}
            {reviewNote ? `: “${reviewNote}”` : '.'}
          </p>
        )}
      </div>
      {status !== 'pending' && footer && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">{footer}</div>
      )}
      {status === 'pending' && onApprove && onReject && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
          <Button variant="secondary" size="sm" icon={<X className="h-4 w-4" />} onClick={onReject} disabled={busy}>
            Reject
          </Button>
          <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={onApprove} loading={busy}>
            Approve
          </Button>
        </div>
      )}
    </Card>
  </li>
)

const Item: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={cn('min-w-0', className)}>
    <dt className="text-xs font-medium text-ink-500">{label}</dt>
    <dd className="mt-0.5 break-words text-ink-900">{children}</dd>
  </div>
)

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-4 w-4 rounded border border-ink-200" style={{ backgroundColor: color }} aria-hidden />
    <span className="font-mono text-xs">{color}</span>
    <span className="sr-only">{label}</span>
  </span>
)

export const Thumb: React.FC<{ src?: string | null; fallback: string; color?: string; large?: boolean; alt?: string }> = ({ src, fallback, color, large, alt = '' }) => {
  const [broken, setBroken] = useState(false)
  const size = large ? 'h-16 w-16' : 'h-11 w-11'
  if (src && !broken)
    return <img src={src} alt={alt} onError={() => setBroken(true)} className={cn(size, 'shrink-0 rounded-xl border border-ink-200 bg-white object-contain')} />
  return (
    <span
      aria-hidden
      className={cn(size, 'flex shrink-0 items-center justify-center rounded-xl bg-brand-50 text-base font-bold text-brand-700')}
      style={color ? { backgroundColor: color, color: '#fff' } : undefined}
    >
      {fallback.charAt(0).toUpperCase()}
    </span>
  )
}

const OrgLink: React.FC<{ id: string; name: string; email: string }> = ({ id, name, email }) => (
  <>
    <Link to={`/admin/organizations/${id}`} className="font-medium text-brand-700 hover:underline">
      {name}
    </Link>
    <span className="block truncate text-xs text-ink-500">{email}</span>
  </>
)

type CardProps<T> = { busy: boolean; onApprove?: () => void; onReject?: () => void; footer?: React.ReactNode } & T

export const WhiteLabelCard: React.FC<CardProps<{ r: WhiteLabelRequest }>> = ({ r, ...actions }) => (
  <CardShell
    title={r.brand_name}
    subtitle={`White-label for ${r.organizer_name}`}
    status={r.status}
    createdAt={r.created_at}
    reviewedAt={r.reviewed_at}
    reviewNote={r.review_note}
    note={r.note}
    media={<Thumb src={r.logo_url} fallback={r.brand_name} color={r.primary_color} large alt={`${r.brand_name} logo`} />}
    {...actions}
  >
    <Item label="Custom domain">
      {r.requested_domain ? (
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px]">
          <Globe className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
          {r.requested_domain}
        </span>
      ) : (
        <span className="text-ink-500">None requested</span>
      )}
    </Item>
    <Item label="Organization">
      <OrgLink id={r.organizer} name={r.organizer_name} email={r.organizer_email} />
    </Item>
    <Item label="Colours">
      <span className="flex flex-wrap gap-3">
        <Swatch color={r.primary_color} label="primary" />
        <Swatch color={r.accent_color} label="accent" />
      </span>
    </Item>
    <Item label="Hide “Powered by Eventlaya”">{r.remove_watermark ? 'Yes' : 'No'}</Item>
  </CardShell>
)

export const MarketplaceCard: React.FC<CardProps<{ r: MarketplaceAccessRequest }>> = ({ r, ...actions }) => (
  <CardShell
    title={r.business_name}
    subtitle={`${r.business_type_display || r.business_type} in ${r.city || 'an unknown city'}`}
    status={r.status}
    createdAt={r.created_at}
    reviewedAt={r.reviewed_at}
    reviewNote={r.review_note}
    note={r.note}
    media={<Thumb fallback={r.business_name || 'B'} />}
    {...actions}
  >
    <Item label="Requested by">
      <OrgLink id={r.user} name={r.organization_name || r.user_name} email={r.user_email} />
    </Item>
    <Item label="Phone">
      {r.phone ? (
        <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
          <Phone className="h-4 w-4 text-ink-400" aria-hidden />
          {r.phone}
        </a>
      ) : (
        <span className="text-ink-500">Not given</span>
      )}
    </Item>
    <Item label="Business type">{r.business_type_display || r.business_type}</Item>
    <Item label="City">{r.city || '–'}</Item>
  </CardShell>
)

export const ListingCard: React.FC<CardProps<{ l: ListingReview }>> = ({ l, ...actions }) => (
  <CardShell
    title={l.name}
    subtitle={l.subtitle}
    status={l.listing_status}
    createdAt={l.created_at}
    reviewedAt={null}
    reviewNote={l.review_note}
    media={<Thumb src={l.image} fallback={l.name} />}
    {...actions}
  >
    <Item label="Type">
      <Badge tone={l.kind === 'venue' ? 'brand' : 'neutral'}>
        {l.kind === 'venue' ? <MapPin className="h-3.5 w-3.5" aria-hidden /> : <Store className="h-3.5 w-3.5" aria-hidden />}
        {l.kind === 'venue' ? 'Venue' : 'Service profile'}
      </Badge>
    </Item>
    <Item label="Owner">
      <OrgLink id={l.owner_id} name={l.owner_name} email={l.owner_email} />
    </Item>
    <Item label="City">{l.city || '–'}</Item>
    <Item label="Phone">{l.phone || <span className="text-ink-500">Not given</span>}</Item>
    {l.description && (
      <Item label="Description" className="sm:col-span-2">
        <span className="line-clamp-3 text-ink-700">{l.description}</span>
      </Item>
    )}
    <Item label="Listing page" className="sm:col-span-2">
      <a
        href={l.public_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
      >
        Preview listing <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Item>
  </CardShell>
)
