import React from 'react'
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import type { ListingStatus } from '@/services/api'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'brand' | 'info'

export const LISTING_STATUS: Record<ListingStatus, { label: string; tone: Tone; icon: React.ElementType }> = {
  approved: { label: 'Live', tone: 'success', icon: CheckCircle2 },
  pending: { label: 'Waiting for review', tone: 'warning', icon: Clock },
  rejected: { label: 'Changes needed', tone: 'danger', icon: AlertCircle },
}

export const ListingStatusBadge: React.FC<{ status?: ListingStatus }> = ({ status = 'approved' }) => {
  const meta = LISTING_STATUS[status]
  const Icon = meta.icon
  return (
    <Badge tone={meta.tone}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {meta.label}
    </Badge>
  )
}

/** Explains why a listing isn't public yet. Renders nothing for live listings. */
export const ListingStatusNotice: React.FC<{ status?: ListingStatus; note?: string; className?: string }> = ({ status, note, className }) => {
  if (!status || status === 'approved') return null
  const rejected = status === 'rejected'
  const Icon = rejected ? AlertCircle : Clock
  return (
    <div
      role="status"
      className={cn(
        'flex gap-3 rounded-2xl border px-4 py-3 text-sm',
        rejected ? 'border-red-200 bg-red-50 text-red-800' : 'border-marigold-200 bg-marigold-50 text-marigold-900',
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{rejected ? 'Changes needed before this goes live' : 'Waiting for review'}</p>
        <p className="mt-0.5">
          {rejected
            ? note || 'Our team asked for changes. Update the listing and save to send it for review again.'
            : 'It isn’t public yet. We usually review new listings within a working day.'}
        </p>
        {rejected && note && <p className="mt-1 text-red-700">Save your changes to send it for review again.</p>}
      </div>
    </div>
  )
}

export type InquiryStatus = 'pending' | 'contacted' | 'booked' | 'rejected' | 'cancelled'

export const INQUIRY_STATUS: Record<InquiryStatus, { label: string; tone: Tone }> = {
  pending: { label: 'New', tone: 'brand' },
  contacted: { label: 'Contacted', tone: 'warning' },
  booked: { label: 'Booked', tone: 'success' },
  rejected: { label: 'Declined', tone: 'neutral' },
  cancelled: { label: 'Cancelled by customer', tone: 'neutral' },
}

/** Statuses an owner can pick by hand (a cancellation only comes from the customer). */
export const OWNER_SETTABLE_STATUSES: InquiryStatus[] = ['pending', 'contacted', 'booked', 'rejected']

/** Wording for the customer's own view (My inquiries). */
export const SENT_INQUIRY_STATUS: Record<InquiryStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for reply', tone: 'warning' },
  contacted: { label: 'In discussion', tone: 'info' },
  booked: { label: 'Confirmed', tone: 'success' },
  rejected: { label: 'Declined', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const InquiryStatusBadge: React.FC<{ status?: string; sender?: boolean }> = ({ status = 'pending', sender }) => {
  const map = sender ? SENT_INQUIRY_STATUS : INQUIRY_STATUS
  const meta = map[status as InquiryStatus] ?? map.pending
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  )
}
