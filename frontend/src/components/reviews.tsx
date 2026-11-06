import React, { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, MessageSquareReply, Pencil, Star, Trash2 } from 'lucide-react'
import { isModuleDisabled } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { useModuleEnabled } from '@/lib/modules'
import { REVIEW_MAX, fmtReviewDate, reviewsApi, type Review, type ReviewKind, type ReviewSummary, type TargetReviews } from '@/lib/reviews'
import { mediaUrl } from '@/lib/account'
import { Button, ButtonLink, Card, Modal, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Stars                                                                */

export const Stars: React.FC<{ value: number; size?: 'sm' | 'md' | 'lg'; className?: string; label?: boolean }> = ({ value, size = 'sm', className, label = true }) => {
  const px = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4'
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} role={label ? 'img' : undefined} aria-label={label ? `${value.toFixed(1).replace(/\.0$/, '')} out of 5 stars` : undefined}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)))
        return (
          <span key={i} className={cn('relative inline-block', px)} aria-hidden>
            <Star className={cn('absolute inset-0 text-ink-200', px)} fill="currentColor" strokeWidth={0} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={cn('text-marigold-400', px)} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

const STAR_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

/** Five radio buttons styled as stars (arrow keys work like any radio group). */
export const StarInput: React.FC<{ value: number; onChange: (v: number) => void; error?: string }> = ({ value, onChange, error }) => {
  const name = useId()
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-800">
        Your rating<span className="ml-0.5 text-brand-600" aria-hidden>*</span>
      </legend>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((i) => (
            <label key={i} className="cursor-pointer p-0.5 has-[:focus-visible]:rounded-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500" onMouseEnter={() => setHover(i)}>
              <input type="radio" name={name} value={i} checked={value === i} onChange={() => onChange(i)} className="sr-only" aria-label={`${i} star${i === 1 ? '' : 's'}, ${STAR_WORDS[i]}`} />
              <Star className={cn('h-8 w-8 transition-colors', i <= shown ? 'text-marigold-400' : 'text-ink-200')} fill="currentColor" strokeWidth={0} aria-hidden />
            </label>
          ))}
        </div>
        <span className="text-sm font-medium text-ink-600" aria-hidden>
          {STAR_WORDS[shown]}
        </span>
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </fieldset>
  )
}

/* ------------------------------------------------------------------ */
/* Write / edit                                                         */

export const ReviewFormModal: React.FC<{
  open: boolean
  onClose: () => void
  kind: ReviewKind
  /** Event slug or vendor/venue id (for new reviews) */
  targetKey?: string
  targetName: string
  existing?: Review | null
  onSaved?: (r: Review) => void
}> = ({ open, onClose, kind, targetKey, targetName, existing, onSaved }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [text, setText] = useState(existing?.text ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setRating(existing?.rating ?? 0)
    setText(existing?.text ?? '')
    setError('')
  }, [open, existing])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rating) {
      setError('Pick a star rating.')
      return
    }
    setSaving(true)
    try {
      const body = { rating, text: text.trim() }
      const saved = existing ? await reviewsApi.update(existing.id, body) : await reviewsApi.create(kind, targetKey!, body)
      toast.success(existing ? 'Review updated' : 'Thanks for your review', existing ? undefined : `Your review of ${targetName} is live.`)
      void qc.invalidateQueries({ queryKey: ['reviews'] })
      void qc.invalidateQueries({ queryKey: ['my-tickets'] })
      void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error('Couldn’t save your review', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit your review' : 'Write a review'}
      description={targetName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="review-form" loading={saving}>
            {existing ? 'Save changes' : 'Post review'}
          </Button>
        </>
      }
    >
      <form id="review-form" onSubmit={submit} className="space-y-5" noValidate>
        <StarInput
          value={rating}
          onChange={(v) => {
            setRating(v)
            setError('')
          }}
          error={error}
        />
        <div>
          <label htmlFor="review-text" className="block text-sm font-medium text-ink-800">
            Tell others about it <span className="font-normal text-ink-500">(optional)</span>
          </label>
          <textarea
            id="review-text"
            rows={5}
            maxLength={REVIEW_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'event' ? 'What was good? What could be better next time?' : 'How was working with them?'}
            className="mt-1.5 block w-full rounded-[10px] border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 shadow-2xs placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <p className="mt-1 text-right text-xs text-ink-500 tabular">
            {text.length} / {REVIEW_MAX}
          </p>
        </div>
        <p className="text-xs text-ink-500">Your first name and last initial are shown with your review. You can edit or delete it any time.</p>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Display                                                              */

const Avatar: React.FC<{ name: string; src: string | null }> = ({ name, src }) => {
  const [failed, setFailed] = useState(false)
  const url = mediaUrl(src)
  if (url && !failed) return <img src={url} alt="" onError={() => setFailed(true)} className="h-9 w-9 shrink-0 rounded-full object-cover" />
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700" aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export const ReviewCard: React.FC<{
  review: Review
  /** Show what was reviewed (lists that mix targets) */
  showTarget?: React.ReactNode
  actions?: React.ReactNode
  /** Owner tools under the reply (e.g. reply editor) */
  footer?: React.ReactNode
  className?: string
}> = ({ review: r, showTarget, actions, footer, className }) => (
  <article className={cn('space-y-3', className)}>
    <div className="flex items-start gap-3">
      <Avatar name={r.author.name} src={r.author.avatar} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-ink-900">
            {r.author.name}
            {r.is_mine && <span className="ml-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">You</span>}
          </p>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          <Stars value={r.rating} />
          <span>{fmtReviewDate(r.created_at)}</span>
          {r.edited_at && <span>· edited</span>}
        </div>
        {showTarget && <div className="mt-1 text-xs text-ink-600">{showTarget}</div>}
      </div>
    </div>
    {r.is_hidden && (
      <p className="flex items-start gap-2 rounded-lg bg-marigold-50 px-3 py-2 text-xs text-marigold-900">
        <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Hidden from the public{r.hidden_reason ? `: ${r.hidden_reason}` : '.'}
        </span>
      </p>
    )}
    {r.text && <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700 [overflow-wrap:anywhere]">{r.text}</p>}
    {r.reply && (
      <div className="ml-4 rounded-xl border-l-2 border-brand-200 bg-ink-50 px-3.5 py-2.5 sm:ml-12">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
          <MessageSquareReply className="h-3.5 w-3.5 text-brand-600" aria-hidden />
          Reply from the {r.kind === 'event' ? 'organizer' : 'owner'}
          <span className="font-normal text-ink-500">· {fmtReviewDate(r.reply.replied_at)}</span>
        </p>
        <p className="mt-1 whitespace-pre-line text-sm text-ink-700 [overflow-wrap:anywhere]">{r.reply.text}</p>
      </div>
    )}
    {footer}
  </article>
)

export const ReviewSummaryBlock: React.FC<{ summary: ReviewSummary; className?: string }> = ({ summary, className }) => {
  const max = Math.max(1, ...Object.values(summary.distribution))
  return (
    <div className={cn('flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8', className)}>
      <div className="shrink-0">
        <p className="font-display text-5xl font-bold leading-none text-ink-900 tabular">{summary.average !== null ? summary.average.toFixed(1) : '–'}</p>
        <Stars value={summary.average ?? 0} size="md" className="mt-2" />
        <p className="mt-1 text-sm text-ink-500">
          {summary.count} review{summary.count === 1 ? '' : 's'}
        </p>
      </div>
      <ul className="w-full max-w-sm flex-1 space-y-1.5" aria-label="Rating breakdown">
        {(['5', '4', '3', '2', '1'] as const).map((k) => {
          const n = summary.distribution[k] ?? 0
          return (
            <li key={k} className="flex items-center gap-2 text-xs text-ink-600">
              <span className="w-3 text-right tabular" aria-hidden>
                {k}
              </span>
              <Star className="h-3 w-3 text-marigold-400" fill="currentColor" strokeWidth={0} aria-hidden />
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                <span className="block h-full rounded-full bg-marigold-400" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="w-6 text-right tabular" aria-hidden>
                {n}
              </span>
              <span className="sr-only">
                {k} stars: {n}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Public section on event / vendor / venue pages                       */

export const ReviewsSection: React.FC<{
  kind: ReviewKind
  /** Event slug, or vendor/venue id */
  targetKey: string
  targetName: string
  /** The signed-in user owns what's reviewed: link to where they reply */
  isOwner?: boolean
  /** Card chrome (marketplace pages) or bare (event page Section) */
  variant?: 'card' | 'plain'
  id?: string
}> = ({ kind, targetKey, targetName, isOwner, variant = 'card', id }) => {
  const enabled = useModuleEnabled('reviews')
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [writing, setWriting] = useState(false)
  const [editing, setEditing] = useState<Review | null>(null)

  const query = useInfiniteQuery({
    queryKey: ['reviews', kind, targetKey, user?.id ?? 'anon'],
    queryFn: ({ pageParam }) => reviewsApi.forTarget(kind, targetKey, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: TargetReviews, pages) => (last.next ? pages.length + 1 : undefined),
    enabled: enabled && Boolean(targetKey),
    retry: (n, e) => !isModuleDisabled(e) && n < 1,
  })

  if (!enabled || isModuleDisabled(query.error)) return null

  const first = query.data?.pages[0]
  const reviews = query.data?.pages.flatMap((p) => p.results) ?? []
  const viewer = first?.viewer ?? null
  const mine = viewer?.my_review ?? null

  const remove = async (r: Review) => {
    if (!(await toast.confirm({ title: 'Delete your review?', description: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return
    try {
      await reviewsApi.remove(r.id)
      toast.success('Review deleted')
      void qc.invalidateQueries({ queryKey: ['reviews'] })
    } catch (e) {
      toast.error('Couldn’t delete the review', e instanceof Error ? e.message : undefined)
    }
  }

  const ownActions = (r: Review) => (
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
  )

  const signInHref = `/login`
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      {variant === 'card' && <h2 className="text-base font-bold text-ink-900">Reviews</h2>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {isOwner && (
          <ButtonLink to="/app/reviews" variant="secondary" size="sm" icon={<MessageSquareReply className="h-4 w-4" aria-hidden />}>
            Reply to reviews
          </ButtonLink>
        )}
        {viewer?.can_review && (
          <Button size="sm" onClick={() => setWriting(true)} icon={<Star className="h-4 w-4" aria-hidden />}>
            Write a review
          </Button>
        )}
      </div>
    </div>
  )

  const body = query.isLoading ? (
    <div className="space-y-4">
      <Skeleton className="h-20 w-64" />
      <Skeleton className="h-16" />
    </div>
  ) : query.isError ? (
    <p className="text-sm text-ink-500">Reviews couldn’t be loaded right now.</p>
  ) : (
    <div className="space-y-6">
      {first && first.summary.count > 0 && <ReviewSummaryBlock summary={first.summary} />}
      {!viewer && !user && (
        <p className="text-sm text-ink-500">
          <Link to={signInHref} state={{ from: window.location.pathname }} className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>{' '}
          to write a review.
        </p>
      )}
      {viewer && !viewer.can_review && !mine && viewer.reason && <p className="text-sm text-ink-500">{viewer.reason}</p>}
      {mine && (
        <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
          <p className="mb-3 text-xs font-semibold text-brand-700">Your review</p>
          <ReviewCard review={mine} actions={ownActions(mine)} />
        </div>
      )}
      {first && first.summary.count === 0 && !mine && (
        <p className="text-sm text-ink-500">No reviews yet.{viewer?.can_review ? ' Be the first to share how it went.' : ''}</p>
      )}
      {reviews.filter((r) => r.id !== mine?.id).length > 0 && (
        <ul className="divide-y divide-ink-100">
          {reviews
            .filter((r) => r.id !== mine?.id)
            .map((r) => (
              <li key={r.id} className="py-4 first:pt-0 last:pb-0">
                <ReviewCard review={r} />
              </li>
            ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button variant="secondary" size="sm" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          Show more reviews
        </Button>
      )}
    </div>
  )

  const modals = (
    <>
      <ReviewFormModal open={writing} onClose={() => setWriting(false)} kind={kind} targetKey={targetKey} targetName={targetName} />
      <ReviewFormModal open={Boolean(editing)} onClose={() => setEditing(null)} kind={kind} targetName={targetName} existing={editing} />
    </>
  )

  if (variant === 'plain') {
    return (
      <div id={id} className="space-y-5">
        {(isOwner || viewer?.can_review) && header}
        <Card className="p-5 sm:p-6">{body}</Card>
        {modals}
      </div>
    )
  }
  return (
    <Card id={id}>
      <div className="border-b border-ink-100 px-5 py-4">{header}</div>
      <div className="p-5">{body}</div>
      {modals}
    </Card>
  )
}
