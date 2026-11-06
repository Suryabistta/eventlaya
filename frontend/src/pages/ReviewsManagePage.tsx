import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, MessageSquareReply, Pencil, Star, Trash2 } from 'lucide-react'
import { api, isModuleDisabled } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { useModuleEnabled } from '@/lib/modules'
import { REVIEW_MAX, kindLabel, reviewsApi, targetHref, type Review, type ReviewKind } from '@/lib/reviews'
import { ReviewCard, Stars } from '@/components/reviews'
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, useToast } from '@/components/ui'
import { hasBusinessPortal } from './business/guards'

const PAGE = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'

type Hidden = '' | '0' | '1'

/**
 * Reviews of what the signed-in user owns: their events (organizers), vendor profiles and venues
 * (business portal). Organizers hide/unhide event reviews; every owner can reply.
 */
export const ReviewsManagePage: React.FC = () => {
  const enabled = useModuleEnabled('reviews')
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const isOrganizer = user?.role === 'organizer' || user?.role === 'superadmin'
  const business = hasBusinessPortal(user)
  const kinds: ReviewKind[] = [...(isOrganizer ? (['event'] as const) : []), ...(business ? (['venue', 'vendor'] as const) : [])]

  const kind = (kinds.includes(params.get('kind') as ReviewKind) ? params.get('kind') : '') as ReviewKind | ''
  const event = params.get('event') ?? ''
  const hidden = (['0', '1'].includes(params.get('hidden') ?? '') ? params.get('hidden') : '') as Hidden
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k === 'kind' && v !== 'event') next.delete('event')
    setParams(next, { replace: true })
  }

  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: api.getEvents, enabled: isOrganizer && enabled })

  const query = useInfiniteQuery({
    queryKey: ['reviews', 'manage', kind, event, hidden],
    queryFn: ({ pageParam }) => reviewsApi.manage({ kind: event ? 'event' : kind, event, hidden, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    enabled,
    retry: (n, e) => !isModuleDisabled(e) && n < 1,
  })
  const reviews = query.data?.pages.flatMap((p) => p.results) ?? []
  const total = query.data?.pages[0]?.count ?? 0

  if (!enabled || isModuleDisabled(query.error)) {
    return (
      <div className={PAGE}>
        <PageHeader title="Reviews" />
        <Card>
          <EmptyState icon={<Star className="h-6 w-6" />} title="Reviews are turned off" description="The reviews feature isn’t available for your account right now." />
        </Card>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="Reviews"
        description={
          isOrganizer && !business
            ? 'What attendees say about your events. Reply publicly, or hide reviews that break the rules.'
            : 'What people say about your events and listings. Reply publicly to thank them or answer concerns.'
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {kinds.length > 1 && (
          <Select label="Type" value={kind} onChange={(e) => setParam('kind', e.target.value)} containerClassName="sm:w-44">
            <option value="">Everything</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k === 'event' ? 'Events' : k === 'venue' ? 'Venues' : 'Services'}
              </option>
            ))}
          </Select>
        )}
        {isOrganizer && events.length > 0 && (kind === '' || kind === 'event') && (
          <Select label="Event" value={event} onChange={(e) => setParam('event', e.target.value)} containerClassName="sm:w-72">
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </Select>
        )}
        <Select label="Visibility" value={hidden} onChange={(e) => setParam('hidden', e.target.value)} containerClassName="sm:w-44">
          <option value="">All reviews</option>
          <option value="0">Public</option>
          <option value="1">Hidden</option>
        </Select>
        {!query.isLoading && (
          <p className="text-sm text-ink-500 sm:ml-auto sm:pb-2.5">
            {total} review{total === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {query.isError ? (
        <ErrorState message={query.error?.message} onRetry={query.refetch} />
      ) : query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      ) : reviews.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Star className="h-6 w-6" />}
            title={params.toString() ? 'No reviews match these filters' : 'No reviews yet'}
            description={
              params.toString()
                ? 'Try another filter.'
                : 'Attendees can review an event once their pass is scanned. People who contacted your listings can review them too.'
            }
          />
        </Card>
      ) : (
        <>
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id}>
                <ManagedReview review={r} canHide={user?.role === 'superadmin' || (r.kind === 'event' && isOrganizer)} />
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
              Show more
            </Button>
          )}
        </>
      )}
    </div>
  )
}

const ManagedReview: React.FC<{ review: Review; canHide: boolean }> = ({ review: r, canHide }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [hiding, setHiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['reviews'] })

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(success)
      await refresh()
      return true
    } catch (e) {
      toast.error('Couldn’t save that', e instanceof Error ? e.message : undefined)
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!replyText.trim()) return
    if (await run(() => reviewsApi.reply(r.id, replyText.trim()), r.reply ? 'Reply updated' : 'Reply posted')) setReplying(false)
  }

  const deleteReply = async () => {
    if (!(await toast.confirm({ title: 'Delete your reply?', confirmLabel: 'Delete', danger: true }))) return
    await run(() => reviewsApi.deleteReply(r.id), 'Reply deleted')
  }

  const hide = async (e: React.FormEvent) => {
    e.preventDefault()
    if (await run(() => reviewsApi.hide(r.id, true, reason.trim()), 'Review hidden')) {
      setHiding(false)
      setReason('')
    }
  }

  return (
    <Card className={r.is_hidden ? 'border-marigold-200 bg-marigold-50/20 p-4 sm:p-5' : 'p-4 sm:p-5'}>
      <ReviewCard
        review={r}
        showTarget={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge className="px-2 py-0 text-[11px]">{kindLabel[r.kind]}</Badge>
            <Link to={targetHref(r)} className="font-semibold text-ink-800 hover:text-brand-700 hover:underline">
              {r.target.name}
            </Link>
          </span>
        }
        actions={
          canHide &&
          (r.is_hidden ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => reviewsApi.hide(r.id, false), 'Review is public again')}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Unhide
            </button>
          ) : (
            <button type="button" onClick={() => setHiding(true)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900">
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
              Hide
            </button>
          ))
        }
        footer={
          replying ? (
            <form onSubmit={saveReply} className="space-y-2 sm:ml-12">
              <label htmlFor={`reply-${r.id}`} className="block text-sm font-medium text-ink-800">
                {r.reply ? 'Edit your reply' : 'Your public reply'}
              </label>
              <textarea
                id={`reply-${r.id}`}
                rows={3}
                maxLength={REVIEW_MAX}
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Thank them, or explain what you’re changing."
                className="block w-full rounded-[10px] border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 shadow-2xs placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy} disabled={!replyText.trim()}>
                  {r.reply ? 'Save reply' : 'Post reply'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-1 sm:ml-12">
              {r.reply ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
                    onClick={() => {
                      setReplyText(r.reply!.text)
                      setReplying(true)
                    }}
                  >
                    Edit reply
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={deleteReply} disabled={busy}>
                    Delete reply
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<MessageSquareReply className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    setReplyText('')
                    setReplying(true)
                  }}
                >
                  Reply
                </Button>
              )}
            </div>
          )
        }
      />
      <Modal
        open={hiding}
        onClose={() => setHiding(false)}
        title="Hide this review?"
        description="It disappears from your public event page and ratings. The author still sees it, with your reason."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setHiding(false)}>
              Cancel
            </Button>
            <Button type="submit" form={`hide-${r.id}`} loading={busy} icon={<EyeOff className="h-4 w-4" aria-hidden />}>
              Hide review
            </Button>
          </>
        }
      >
        <form id={`hide-${r.id}`} onSubmit={hide} className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-ink-600">
            <Stars value={r.rating} /> by {r.author.name}
          </div>
          <Input label="Reason" hint="Optional. Shown to the author." maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Contains personal information" />
        </form>
      </Modal>
    </Card>
  )
}

export default ReviewsManagePage
