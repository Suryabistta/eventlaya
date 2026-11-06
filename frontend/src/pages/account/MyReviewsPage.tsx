import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Star, Trash2 } from 'lucide-react'
import { isModuleDisabled } from '@/services/api'
import { kindLabel, reviewsApi, targetHref, type Review } from '@/lib/reviews'
import { useModuleEnabled } from '@/lib/modules'
import { ReviewCard, ReviewFormModal } from '@/components/reviews'
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui'
import { ACCOUNT_PAGE } from './MyTicketsPage'

export const MyReviewsPage: React.FC = () => {
  const enabled = useModuleEnabled('reviews')
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Review | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['reviews', 'mine'],
    queryFn: ({ pageParam }) => reviewsApi.mine(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    enabled,
    retry: (n, e) => !isModuleDisabled(e) && n < 1,
  })
  const reviews = query.data?.pages.flatMap((p) => p.results) ?? []
  const total = query.data?.pages[0]?.count ?? 0

  const remove = async (r: Review) => {
    if (!(await toast.confirm({ title: 'Delete this review?', description: `Your review of ${r.target.name} will be removed for good.`, confirmLabel: 'Delete', danger: true }))) return
    try {
      await reviewsApi.remove(r.id)
      toast.success('Review deleted')
      void qc.invalidateQueries({ queryKey: ['reviews'] })
      void qc.invalidateQueries({ queryKey: ['my-tickets'] })
      void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
    } catch (e) {
      toast.error('Couldn’t delete the review', e instanceof Error ? e.message : undefined)
    }
  }

  return (
    <div className={ACCOUNT_PAGE}>
      <PageHeader title="My reviews" description={total ? `${total} review${total === 1 ? '' : 's'} of events, venues and vendors.` : 'Reviews you write for events, venues and vendors.'} />
      {!enabled || isModuleDisabled(query.error) ? (
        <Card>
          <EmptyState icon={<Star className="h-6 w-6" />} title="Reviews are turned off" description="Reviews aren’t available for your account right now." />
        </Card>
      ) : query.isError ? (
        <ErrorState message={query.error?.message} onRetry={query.refetch} />
      ) : query.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : reviews.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Star className="h-6 w-6" />}
            title="No reviews yet"
            description="After your pass is scanned at an event, or after you contact a venue or vendor, you can rate them from My tickets or My inquiries."
            action={<ButtonLink to="/app/my/tickets?when=past">See past events</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id}>
                <Card className="p-4 sm:p-5">
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
                      <>
                        <button type="button" onClick={() => setEditing(r)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900">
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(r)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          Delete
                        </button>
                      </>
                    }
                  />
                </Card>
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
      <ReviewFormModal open={Boolean(editing)} onClose={() => setEditing(null)} kind={editing?.kind ?? 'event'} targetName={editing?.target.name ?? ''} existing={editing} />
    </div>
  )
}

export default MyReviewsPage
