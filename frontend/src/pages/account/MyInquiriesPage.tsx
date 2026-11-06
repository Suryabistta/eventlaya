import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CalendarDays, Inbox, MessageSquareText, Star, Store, Users, Wallet, XCircle } from 'lucide-react'
import { isApiError, isModuleDisabled } from '@/services/api'
import { accountApi, type MySentInquiry } from '@/lib/account'
import { apiErrorText, slotsApi } from '@/lib/availability'
import { useModuleEnabled } from '@/lib/modules'
import { reviewsApi, type Review } from '@/lib/reviews'
import { ReviewFormModal } from '@/components/reviews'
import { BookingSlotBox, slotSummaryText } from '@/components/BookingSlot'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import { InquiryStatusBadge } from '../business/status'
import { fmtDate, timeAgo } from '../business/InquiriesPage'
import { ACCOUNT_PAGE } from './MyTicketsPage'

/** Requests the signed-in user sent to venues and vendors on the marketplace. */
export const MyInquiriesPage: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['me-inquiries'], queryFn: accountApi.myInquiries, retry: (n, e) => !isModuleDisabled(e) && n < 1 })
  const items = data?.results ?? []

  return (
    <div className={ACCOUNT_PAGE}>
      <PageHeader
        title="My inquiries"
        description="Booking and quote requests you sent to venues and vendors. They confirm or reply by phone or email, and you can cancel a request here."
        actions={
          <ButtonLink to="/marketplace" variant="secondary" icon={<Store className="h-4 w-4" aria-hidden />}>
            Browse the marketplace
          </ButtonLink>
        }
      />
      {isModuleDisabled(error) ? (
        <Card>
          <EmptyState icon={<Store className="h-6 w-6" />} title="The marketplace is turned off" description="Your inquiries aren’t available right now." />
        </Card>
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="No inquiries yet"
            description="Ask a venue about your date or request a quote from a vendor while signed in, and you can follow it here."
            action={<ButtonLink to="/marketplace">Find venues and vendors</ButtonLink>}
          />
        </Card>
      ) : (
        <ul className="space-y-4">
          {items.map((i) => (
            <li key={i.id}>
              <SentInquiryCard inquiry={i} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const SentInquiryCard: React.FC<{ inquiry: MySentInquiry }> = ({ inquiry: i }) => {
  const reviewsOn = useModuleEnabled('reviews')
  const toast = useToast()
  const [reviewing, setReviewing] = useState(false)
  const [existing, setExisting] = useState<Review | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const href = i.kind === 'venue' ? `/marketplace/venues/${i.target.slug}` : `/marketplace/vendors/${i.target.id}`
  const Icon = i.kind === 'venue' ? Building2 : Store

  const editReview = async () => {
    if (!i.my_review_id) return
    try {
      setExisting(await reviewsApi.get(i.my_review_id))
    } catch (err) {
      toast.error('Couldn’t open your review', err instanceof Error ? err.message : undefined)
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-ink-100 text-ink-400">
          {i.target.image ? <img src={i.target.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Icon className="h-6 w-6" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-ink-900">
              <Link to={href} className="hover:text-brand-700">
                {i.target.name}
              </Link>
            </h3>
            <InquiryStatusBadge status={i.status} sender />
            <Badge>{i.kind === 'venue' ? 'Venue' : i.target.category || 'Service'}</Badge>
          </div>
          <p className="text-sm text-ink-600">
            {i.event_type || 'Inquiry'}
            {i.space && <span>, {i.space.name}</span>}
            {i.target.city && <span className="text-ink-500"> · {i.target.city}</span>}
          </p>
          {i.slot && (
            <BookingSlotBox slot={i.slot} label={i.status === 'booked' ? 'Booked slot' : 'Requested slot'} className="max-w-md">
              {(i.status === 'pending' || i.status === 'contacted') && (
                <p className="mt-0.5 text-xs text-ink-500">Held for you until {i.kind === 'venue' ? 'the venue' : 'the vendor'} confirms or declines.</p>
              )}
            </BookingSlotBox>
          )}
          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-700">
            {!i.slot && (
              <div className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-ink-400" aria-hidden />
                <dt className="sr-only">Event date</dt>
                <dd>{i.event_date ? fmtDate(i.event_date) : 'Date not set'}</dd>
              </div>
            )}
            {i.guest_count !== null && (
              <div className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-ink-400" aria-hidden />
                <dt className="sr-only">Guests</dt>
                <dd>{i.guest_count.toLocaleString()} guests</dd>
              </div>
            )}
            {i.budget_range && (
              <div className="inline-flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-ink-400" aria-hidden />
                <dt className="sr-only">Budget</dt>
                <dd>{i.budget_range}</dd>
              </div>
            )}
          </dl>
          {i.message && <p className="line-clamp-3 whitespace-pre-line rounded-xl bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">{i.message}</p>}
          {i.owner_note && (
            <div className="flex gap-2.5 rounded-xl border border-ink-200 px-3.5 py-2.5 text-sm">
              <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold text-ink-900">Note from {i.target.name}</p>
                <p className="whitespace-pre-line text-ink-700">{i.owner_note}</p>
              </div>
            </div>
          )}
          {i.status === 'rejected' && i.slot && (
            <p className="text-sm text-ink-500">
              This slot wasn’t confirmed.{' '}
              <Link to={href} className="font-medium text-brand-700 hover:underline">
                Pick another date
              </Link>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="mr-auto text-xs text-ink-500">Sent {timeAgo(i.created_at)}</span>
            {i.can_cancel && (
              <Button size="sm" variant="ghost" onClick={() => setCancelling(true)} icon={<XCircle className="h-4 w-4" aria-hidden />}>
                Cancel request
              </Button>
            )}
            {reviewsOn && i.can_review && (
              <Button size="sm" variant="dark" onClick={() => setReviewing(true)} icon={<Star className="h-4 w-4" aria-hidden />}>
                Write a review
              </Button>
            )}
            {reviewsOn && i.my_review_id && (
              <Button size="sm" variant="secondary" onClick={editReview} icon={<Star className="h-4 w-4 fill-marigold-400 text-marigold-400" aria-hidden />}>
                Edit your review
              </Button>
            )}
          </div>
        </div>
      </div>
      <CancelRequestModal inquiry={i} open={cancelling} onClose={() => setCancelling(false)} />
      {reviewsOn && (
        <>
          <ReviewFormModal open={reviewing} onClose={() => setReviewing(false)} kind={i.kind} targetKey={i.target.id} targetName={i.target.name} />
          <ReviewFormModal open={Boolean(existing)} onClose={() => setExisting(null)} kind={i.kind} targetName={i.target.name} existing={existing} />
        </>
      )}
    </Card>
  )
}

const CancelRequestModal: React.FC<{ inquiry: MySentInquiry; open: boolean; onClose: () => void }> = ({ inquiry: i, open, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const booked = i.status === 'booked'

  const cancel = async () => {
    setSaving(true)
    try {
      const saved = await slotsApi.cancelMine<MySentInquiry>(i.kind, i.id)
      qc.setQueryData<{ count: number; results: MySentInquiry[] }>(['me-inquiries'], (old) =>
        old ? { ...old, results: old.results.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)) } : old,
      )
      toast.success('Request cancelled', `${i.target.name} has been told.${i.slot ? ' The slot is free for others now.' : ''}`)
      onClose()
    } catch (err) {
      toast.error('Couldn’t cancel this request', apiErrorText(err))
      if (isApiError(err, 'cannot_cancel')) {
        void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={booked ? 'Cancel this booking?' : 'Cancel this request?'}
      description={[i.target.name, i.slot ? slotSummaryText(i.slot) : null].filter(Boolean).join(' · ')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Keep it
          </Button>
          <Button variant="danger" onClick={cancel} loading={saving}>
            {booked ? 'Cancel booking' : 'Cancel request'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">
        {i.target.name} is told right away{i.slot ? ' and the slot opens for other customers' : ''}. You can’t undo this; to go ahead later, send a new request.
        {booked && ' Any advance you paid is settled directly with them.'}
      </p>
    </Modal>
  )
}

export default MyInquiriesPage
