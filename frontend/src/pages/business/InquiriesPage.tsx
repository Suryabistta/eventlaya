import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarDays, CalendarX, Inbox, Mail, MessageSquareText, Phone, Users, Wallet } from 'lucide-react'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, buttonClass, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { apiErrorText, type InquirySlot } from '@/lib/availability'
import { BookingSlotBox, slotSummaryText } from '@/components/BookingSlot'
import { useErrorToast } from '../marketplace/shared'
import { businessApi, type BusinessInquiry, type VendorBusinessInquiry } from './api'
import { DecisionModal, type Decision, type DecisionTarget } from './DecisionModal'
import { PAGE } from './ListingsPage'
import { INQUIRY_STATUS, InquiryStatusBadge, OWNER_SETTABLE_STATUSES, type InquiryStatus } from './status'

type Filter = 'all' | InquiryStatus
const FILTERS: Filter[] = ['all', 'pending', 'contacted', 'booked', 'rejected', 'cancelled']
const filterLabel = (f: Filter) => (f === 'all' ? 'All' : INQUIRY_STATUS[f].label)

export const fmtDate = (iso: string, withYear = true) =>
  new Date(iso.length === 10 ? `${iso}T00:00` : iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })

/** "2 hours ago", "3 days ago" */
export const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : fmtDate(iso)
}

export const useMyInquiries = (bookingsOnly = false, enabled = true) => {
  const query = useQuery({ queryKey: ['my-inquiries', ...(bookingsOnly ? ['bookings'] : [])], queryFn: () => businessApi.myInquiries(bookingsOnly), enabled })
  useErrorToast(query.isError, query.error, 'Couldn’t load your inquiries')
  return query
}

/** Venue and service inquiries in one shape for the cards. */
interface InboxItem {
  id: string
  kind: 'venue' | 'vendor'
  targetId: string
  targetName: string
  spaceName?: string | null
  sender_name: string
  sender_email: string
  sender_phone: string
  event_type: string
  event_date: string | null
  guest_count: number | null
  budget_range?: string
  message: string
  status: InquiryStatus
  slot: InquirySlot | null
  owner_note: string
  created_at: string
}

const fromVenue = (i: BusinessInquiry): InboxItem => ({
  id: i.id,
  kind: 'venue',
  targetId: i.venue,
  targetName: i.venue_name,
  spaceName: i.space_name,
  sender_name: i.sender_name,
  sender_email: i.sender_email,
  sender_phone: i.sender_phone,
  event_type: i.event_type,
  event_date: i.event_date || null,
  guest_count: i.guest_count,
  budget_range: i.budget_range,
  message: i.message,
  status: i.status,
  slot: i.slot ?? null,
  owner_note: i.owner_note ?? '',
  created_at: i.created_at,
})

const fromVendor = (i: VendorBusinessInquiry): InboxItem => ({
  id: i.id,
  kind: 'vendor',
  targetId: i.vendor,
  targetName: i.vendor_name,
  sender_name: i.sender_name,
  sender_email: i.sender_email,
  sender_phone: i.sender_phone,
  event_type: i.event_type,
  event_date: i.event_date,
  guest_count: null,
  budget_range: i.budget_range,
  message: i.message,
  status: i.status,
  slot: i.slot ?? null,
  owner_note: i.owner_note ?? '',
  created_at: i.created_at,
})

export const useMyVendorInquiries = (bookingsOnly = false, enabled = true) => {
  const query = useQuery({
    queryKey: ['my-vendor-inquiries', ...(bookingsOnly ? ['bookings'] : [])],
    queryFn: () => businessApi.myVendorInquiries(bookingsOnly),
    enabled,
  })
  useErrorToast(query.isError, query.error, 'Couldn’t load your service inquiries')
  return query
}

const ACTIVE: InquiryStatus[] = ['pending', 'contacted']

const InquiryCard: React.FC<{
  inquiry: InboxItem
  onStatus: (s: InquiryStatus) => void
  onDecide: (d: Decision) => void
  saving: boolean
}> = ({ inquiry, onStatus, onDecide, saving }) => {
  const cancelled = inquiry.status === 'cancelled'
  const canConfirm = ACTIVE.includes(inquiry.status)
  const canDecline = ACTIVE.includes(inquiry.status) || inquiry.status === 'booked'
  return (
    <Card className={cn('p-4 sm:p-5', cancelled && 'bg-ink-50/40')}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-ink-900">{inquiry.sender_name}</h3>
              <InquiryStatusBadge status={inquiry.status} />
              {inquiry.slot && <Badge tone="info">Booking request</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-ink-600">
              {inquiry.event_type || 'Inquiry'} {inquiry.kind === 'venue' ? 'at' : 'for'}{' '}
              <span className="font-medium text-ink-800">{inquiry.spaceName || inquiry.targetName}</span>
              {inquiry.spaceName && <span className="text-ink-500">, {inquiry.targetName}</span>}
            </p>
            <p className="text-xs text-ink-500">Received {timeAgo(inquiry.created_at)}</p>
          </div>
          {inquiry.slot && <BookingSlotBox slot={inquiry.slot} className="max-w-md" />}
          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-700">
            {!inquiry.slot && (
              <div className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-ink-400" aria-hidden />
                <dt className="sr-only">Event date</dt>
                <dd>{inquiry.event_date ? fmtDate(inquiry.event_date) : 'Date not set'}</dd>
              </div>
            )}
            {inquiry.guest_count !== null && (
              <div className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-ink-400" aria-hidden />
                <dt className="sr-only">Guests</dt>
                <dd>{inquiry.guest_count.toLocaleString()} guests</dd>
              </div>
            )}
            {inquiry.budget_range && (
              <div className="inline-flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-ink-400" aria-hidden />
                <dt className="sr-only">Budget</dt>
                <dd>{inquiry.budget_range}</dd>
              </div>
            )}
          </dl>
          {inquiry.message && <p className="max-w-3xl whitespace-pre-line rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm leading-relaxed text-ink-700">{inquiry.message}</p>}
          {inquiry.owner_note && (
            <p className="flex max-w-3xl gap-2 text-sm text-ink-600">
              <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              <span>
                <span className="font-medium text-ink-800">Your note: </span>
                {inquiry.owner_note}
              </span>
            </p>
          )}
          {cancelled && (
            <p className="text-sm text-ink-500">
              The customer cancelled this request{inquiry.slot ? ', so the slot is open for others again' : ''}.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 lg:w-56">
          {(canConfirm || canDecline) && (
            <div className="grid grid-cols-2 gap-2">
              {canConfirm && (
                <Button size="sm" disabled={saving} onClick={() => onDecide('confirm')} icon={<CalendarCheck className="h-4 w-4" aria-hidden />}>
                  Confirm
                </Button>
              )}
              {canDecline && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => onDecide('decline')}
                  className={cn(!canConfirm && 'col-span-2')}
                  icon={<CalendarX className="h-4 w-4" aria-hidden />}
                >
                  {inquiry.status === 'booked' ? 'Cancel booking' : 'Decline'}
                </Button>
              )}
            </div>
          )}
          <Select
            label="Status"
            value={inquiry.status}
            disabled={saving || cancelled}
            onChange={(e) => onStatus(e.target.value as InquiryStatus)}
            hint={cancelled ? 'Closed by the customer' : undefined}
          >
            {(cancelled ? (['cancelled'] as InquiryStatus[]) : OWNER_SETTABLE_STATUSES).map((s) => (
              <option key={s} value={s}>
                {INQUIRY_STATUS[s].label}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <a href={`tel:${inquiry.sender_phone}`} className={buttonClass('secondary', 'sm')}>
              <Phone className="h-4 w-4" aria-hidden />
              Call
              <span className="sr-only"> {inquiry.sender_name}</span>
            </a>
            <a
              href={`mailto:${inquiry.sender_email}?subject=${encodeURIComponent(`Your inquiry for ${inquiry.targetName}`)}`}
              className={buttonClass('secondary', 'sm')}
            >
              <Mail className="h-4 w-4" aria-hidden />
              Email
              <span className="sr-only"> {inquiry.sender_name}</span>
            </a>
          </div>
          <p className="truncate text-xs text-ink-500" title={`${inquiry.sender_phone}, ${inquiry.sender_email}`}>
            {inquiry.sender_phone}
            <br />
            {inquiry.sender_email}
          </p>
        </div>
      </div>
    </Card>
  )
}

type Kind = 'venue' | 'vendor'

export const InquiriesPage: React.FC = () => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.includes(params.get('status') as Filter) ? params.get('status') : 'all') as Filter
  const [target, setTarget] = useState('all')
  const [deciding, setDeciding] = useState<{ target: DecisionTarget; decision: Decision } | null>(null)
  const bookingsOnly = params.get('bookings') === '1'
  // Full lists drive the tabs and their "new" badges; the bookings-only lists (?has_slot=1) the cards.
  const venueAll = useMyInquiries()
  const vendorAll = useMyVendorInquiries()
  const venueBookings = useMyInquiries(true, bookingsOnly)
  const vendorBookings = useMyVendorInquiries(true, bookingsOnly)
  const venueQ = bookingsOnly ? venueBookings : venueAll
  const vendorQ = bookingsOnly ? vendorBookings : vendorAll
  const venueItems = useMemo(() => (venueAll.data ?? []).map(fromVenue), [venueAll.data])
  const vendorItems = useMemo(() => (vendorAll.data ?? []).map(fromVendor), [vendorAll.data])
  const venueShown = useMemo(() => (venueQ.data ?? []).map(fromVenue), [venueQ.data])
  const vendorShown = useMemo(() => (vendorQ.data ?? []).map(fromVendor), [vendorQ.data])

  // Default tab: venues, unless only services have inquiries
  const requestedKind = params.get('kind')
  const kind: Kind =
    requestedKind === 'vendor' || requestedKind === 'venue' ? requestedKind : venueItems.length === 0 && vendorItems.length > 0 ? 'vendor' : 'venue'
  const active = kind === 'venue' ? venueQ : vendorQ
  const allOfKind = kind === 'venue' ? venueItems : vendorItems
  const data = kind === 'venue' ? venueShown : vendorShown
  const isLoading = venueAll.isLoading || vendorAll.isLoading || venueQ.isLoading || vendorQ.isLoading

  const mutation = useMutation({
    mutationFn: ({ item, status }: { item: InboxItem; status: InquiryStatus }): Promise<{ id: string; status: InquiryStatus; sender_name: string }> =>
      item.kind === 'venue' ? businessApi.setInquiryStatus(item.id, status) : businessApi.setVendorInquiryStatus(item.id, status),
    onSuccess: (saved, { item }) => {
      if (item.kind === 'venue') {
        queryClient.setQueriesData<BusinessInquiry[]>({ queryKey: ['my-inquiries'] }, (old) => old?.map((i) => (i.id === saved.id ? { ...i, ...saved } : i)))
      } else {
        queryClient.setQueriesData<VendorBusinessInquiry[]>({ queryKey: ['my-vendor-inquiries'] }, (old) => old?.map((i) => (i.id === saved.id ? { ...i, ...saved } : i)))
      }
      if (item.slot) void queryClient.invalidateQueries({ queryKey: ['my-slots'] })
      toast.success(`Marked as ${INQUIRY_STATUS[saved.status].label.toLowerCase()}`, `${saved.sender_name}’s inquiry is updated.`)
    },
    onError: (err) => {
      toast.error('Couldn’t update the inquiry', apiErrorText(err))
      void queryClient.invalidateQueries({ queryKey: ['my-inquiries'] })
      void queryClient.invalidateQueries({ queryKey: ['my-vendor-inquiries'] })
    },
  })

  const targets = useMemo(() => Array.from(new Map(data.map((i) => [i.targetId, i.targetName])).entries()), [data])
  const inTarget = target === 'all' ? data : data.filter((i) => i.targetId === target)
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: inTarget.length, pending: 0, contacted: 0, booked: 0, rejected: 0, cancelled: 0 }
    inTarget.forEach((i) => (c[i.status] += 1))
    return c
  }, [inTarget])
  const shown = filter === 'all' ? inTarget : inTarget.filter((i) => i.status === filter)

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params)
    if (f === 'all') next.delete('status')
    else next.set('status', f)
    setParams(next, { replace: true })
  }
  const setBookingsOnly = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('bookings', '1')
    else next.delete('bookings')
    setParams(next, { replace: true })
  }
  const setKind = (k: Kind) => {
    const next = new URLSearchParams(params)
    next.set('kind', k)
    next.delete('status')
    setTarget('all')
    setParams(next, { replace: true })
  }
  const pending = (items: InboxItem[]) => items.filter((i) => i.status === 'pending').length

  return (
    <div className={PAGE}>
      <PageHeader
        title="Inquiries"
        description="Booking and quote requests for your venues and services. Confirm or decline slot requests, and update the status as you follow up."
        actions={
          <ButtonLink to="/app/availability" variant="secondary" size="sm" icon={<CalendarDays className="h-4 w-4" aria-hidden />}>
            Availability calendar
          </ButtonLink>
        }
      />

      <div role="tablist" aria-label="Inquiry type" className="inline-flex rounded-xl bg-ink-100 p-1">
        {(
          [
            ['venue', 'Venues', venueItems],
            ['vendor', 'Services', vendorItems],
          ] as const
        ).map(([k, label, items]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors',
              kind === k ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {label}
            {pending(items) > 0 && (
              <span className="h-5 min-w-5 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white tabular">
                {pending(items)}
                <span className="sr-only"> new</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {active.isError ? (
        <ErrorState message={active.error?.message} onRetry={active.refetch} />
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-96 max-w-full" />
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      ) : allOfKind.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={kind === 'venue' ? 'No venue inquiries yet' : 'No service inquiries yet'}
            description={
              kind === 'venue'
                ? 'When organizers ask about your venues, their requests show up here. Venues with photos and hall details get more inquiries.'
                : 'Quote requests sent from your service profile show up here. Profiles with portfolio photos and a starting price get more requests.'
            }
            action={<ButtonLink to="/app/listings">Review your listings</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div role="tablist" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  role="tab"
                  type="button"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    filter === f ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                  )}
                >
                  {filterLabel(f)}
                  <span className={cn('tabular text-xs', filter === f ? 'text-brand-600' : 'text-ink-500')}>{counts[f]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 text-sm font-medium text-ink-700 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
              <input type="checkbox" checked={bookingsOnly} onChange={(e) => setBookingsOnly(e.target.checked)} className="h-4 w-4 rounded border-ink-300 accent-brand-600" />
              Bookings only
            </label>
            {targets.length > 1 && (
              <Select label={kind === 'venue' ? 'Venue' : 'Profile'} value={target} onChange={(e) => setTarget(e.target.value)} containerClassName="sm:w-64">
                <option value="all">{kind === 'venue' ? 'All venues' : 'All profiles'}</option>
                {targets.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
            </div>
          </div>

          {shown.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title={bookingsOnly ? `No ${filter === 'all' ? '' : `${filterLabel(filter).toLowerCase()} `}slot bookings` : `No ${filterLabel(filter).toLowerCase()} inquiries`}
                description={bookingsOnly ? 'Booking requests come from customers picking one of your open slots.' : 'Try another status to see the rest.'}
                action={
                  <button
                    type="button"
                    onClick={() => {
                      const next = new URLSearchParams(params)
                      next.delete('status')
                      next.delete('bookings')
                      setParams(next, { replace: true })
                    }}
                    className={buttonClass('secondary', 'sm')}
                  >
                    Show all inquiries
                  </button>
                }
              />
            </Card>
          ) : (
            <ul className="space-y-4">
              {shown.map((i) => (
                <li key={i.id}>
                  <InquiryCard
                    inquiry={i}
                    saving={mutation.isPending && mutation.variables?.item.id === i.id}
                    onStatus={(status) => mutation.mutate({ item: i, status })}
                    onDecide={(decision) =>
                      setDeciding({
                        decision,
                        target: { kind: i.kind, id: i.id, customer: i.sender_name, summary: i.slot ? slotSummaryText(i.slot) : i.targetName },
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <DecisionModal target={deciding?.target ?? null} decision={deciding?.decision ?? 'confirm'} onClose={() => setDeciding(null)} />
    </div>
  )
}

export default InquiriesPage
