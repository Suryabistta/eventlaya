import React, { useState } from 'react'
import { formatDate } from '@/lib/dates'
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Badge, Button, Modal, Textarea, useToast } from '@/components/ui'
import { platformApi, STATS_KEY, type ListingKind, type PlatformStats, type ReviewStatus } from './api'
import { cn } from '@/lib/utils'

export const PAGE = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'

/* ------------------------------------------------------------------ */
/* Formatting                                                           */

export const fmtDate = (iso: string | null | undefined) => (iso ? formatDate(iso, 'medium') : 'Never')

export const fmtNum = (n: number) => n.toLocaleString()

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return d === 1 ? 'Yesterday' : `${d} days ago`
  return fmtDate(iso)
}

const reviewTone: Record<ReviewStatus | 'revoked', { label: string; tone: 'warning' | 'success' | 'danger' | 'neutral'; icon: React.ElementType }> = {
  pending: { label: 'Waiting for review', tone: 'warning', icon: Clock },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle },
  revoked: { label: 'Revoked', tone: 'neutral', icon: XCircle },
}

export const ReviewBadge: React.FC<{ status: ReviewStatus | 'revoked'; short?: boolean }> = ({ status, short }) => {
  const t = reviewTone[status]
  return (
    <Badge tone={t.tone}>
      <t.icon className="h-3.5 w-3.5" aria-hidden />
      {short && status === 'pending' ? 'Pending' : t.label}
    </Badge>
  )
}

/** Segmented control used for tabs and filters. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-ink-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 ' +
            (value === o.value ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Approve / reject                                                     */

export type ApprovalKind = 'white_label' | 'marketplace' | 'listing'

export interface ReviewTarget {
  kind: ApprovalKind
  id: string
  /** Only for listings */
  listingKind?: ListingKind
  /** Shown in toasts, e.g. "Royal Palace" */
  name: string
}

export const listKey = (kind: ApprovalKind, status: ReviewStatus | 'all'): QueryKey => ['platform', kind, status]

const pendingField: Record<ApprovalKind, keyof PlatformStats['pending']> = {
  white_label: 'white_label',
  marketplace: 'marketplace_access',
  listing: 'listings',
}

const kindLabel: Record<ApprovalKind, string> = {
  white_label: 'White-label',
  marketplace: 'Marketplace access',
  listing: 'Listing',
}

function call(t: ReviewTarget, decision: 'approve' | 'reject', note: string) {
  if (t.kind === 'white_label') return decision === 'approve' ? platformApi.approveWhiteLabel(t.id, note) : platformApi.rejectWhiteLabel(t.id, note)
  if (t.kind === 'marketplace') return decision === 'approve' ? platformApi.approveMarketplace(t.id, note) : platformApi.rejectMarketplace(t.id, note)
  const lk = t.listingKind ?? 'venue'
  return decision === 'approve' ? platformApi.approveListing(lk, t.id, note) : platformApi.rejectListing(lk, t.id, note)
}

/**
 * Approve/reject with optimistic removal from the pending lists and the pending counts.
 * Rolls back and shows the server's message if the call fails.
 */
export function useReview() {
  const qc = useQueryClient()
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: ({ target, decision, note }: { target: ReviewTarget; decision: 'approve' | 'reject'; note: string }) =>
      call(target, decision, note),
    onMutate: async ({ target, decision }) => {
      const key = listKey(target.kind, 'pending')
      await qc.cancelQueries({ queryKey: key })
      await qc.cancelQueries({ queryKey: STATS_KEY })
      const prevList = qc.getQueryData<{ id: string }[]>(key)
      const prevStats = qc.getQueryData<PlatformStats>(STATS_KEY)
      qc.setQueryData<{ id: string }[]>(key, (old) => old?.filter((x) => x.id !== target.id))
      // Lists that show every status: flip the item's status in place
      const allKey = listKey(target.kind, 'all')
      const prevAll = qc.getQueryData<Record<string, unknown>[]>(allKey)
      const field = target.kind === 'listing' ? 'listing_status' : 'status'
      const next = decision === 'approve' ? 'approved' : 'rejected'
      qc.setQueryData<Record<string, unknown>[]>(allKey, (old) => old?.map((x) => (x.id === target.id ? { ...x, [field]: next } : x)))
      if (prevStats?.pending) {
        const f = pendingField[target.kind]
        qc.setQueryData<PlatformStats>(STATS_KEY, {
          ...prevStats,
          pending: { ...prevStats.pending, [f]: Math.max(0, prevStats.pending[f] - 1) },
        })
      }
      return { key, prevList, prevStats, allKey, prevAll }
    },
    onSuccess: (_res, { target, decision }) => {
      if (decision === 'approve') {
        toast.success(`${kindLabel[target.kind]} approved`, `${target.name} can use it right away.`)
      } else {
        toast.success(`${kindLabel[target.kind]} rejected`, `${target.name} will see your reason.`)
      }
    },
    onError: (err: Error, { target, decision }, ctx) => {
      if (ctx?.prevList) qc.setQueryData(ctx.key, ctx.prevList)
      if (ctx?.prevAll) qc.setQueryData(ctx.allKey, ctx.prevAll)
      if (ctx?.prevStats) qc.setQueryData(STATS_KEY, ctx.prevStats)
      toast.error(`Couldn’t ${decision} ${target.name}`, err.message)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['platform'] })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    },
  })

  return {
    approve: (target: ReviewTarget) => mutation.mutate({ target, decision: 'approve', note: '' }),
    reject: (target: ReviewTarget, note: string) => mutation.mutateAsync({ target, decision: 'reject', note }),
    busyId: mutation.isPending ? mutation.variables?.target.id : undefined,
  }
}

/** Small modal that asks for a reason before a negative action (reject, revoke, unpublish, refund…). */
export const ReasonDialog: React.FC<{
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  placeholder?: string
  onClose: () => void
  /** Resolve to close; throw to keep it open (the caller shows the toast). */
  onConfirm: (note: string) => Promise<unknown> | void
  children?: React.ReactNode
}> = ({ open, title, description, confirmLabel, placeholder, onClose, onConfirm, children }) => {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const formId = React.useId()

  React.useEffect(() => {
    if (open) {
      setNote('')
      setError('')
      setBusy(false)
    }
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!note.trim()) {
      setError('Add a reason so they know what happened and what to change.')
      return
    }
    setBusy(true)
    try {
      await onConfirm(note.trim())
      onClose()
    } catch {
      /* the caller already showed an error toast; keep the dialog open */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" type="submit" form={formId} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {children}
        <Textarea
          label="Reason"
          required
          autoFocus
          value={note}
          error={error || undefined}
          onChange={(e) => {
            setNote(e.target.value)
            if (error) setError('')
          }}
          placeholder={placeholder}
        />
      </form>
    </Modal>
  )
}

/** Reject a pending request. The item disappears optimistically, so the dialog closes straight away. */
export const RejectDialog: React.FC<{
  target: ReviewTarget | null
  onClose: () => void
  onReject: (target: ReviewTarget, note: string) => Promise<unknown>
}> = ({ target, onClose, onReject }) => (
  <ReasonDialog
    open={!!target}
    onClose={onClose}
    title={`Reject ${target?.name ?? ''}`}
    description="They’ll see this reason and can send a new request."
    confirmLabel="Reject request"
    placeholder="For example: we couldn’t confirm you own this domain. Use a domain registered to your organization."
    onConfirm={(note) => {
      if (target) void onReject(target, note).catch(() => undefined)
    }}
  />
)

/** Run a follow-up action (revoke, reopen, unpublish…) with toasts and a refresh of platform data. */
export function usePlatformAction() {
  const qc = useQueryClient()
  const toast = useToast()
  return async function run<T>(fn: () => Promise<T>, success: [string, string?], failure: string): Promise<T> {
    try {
      const res = await fn()
      toast.success(...success)
      return res
    } catch (err) {
      toast.error(failure, err instanceof Error ? err.message : 'Try again in a moment.')
      throw err
    } finally {
      void qc.invalidateQueries({ queryKey: ['platform'] })
      void qc.invalidateQueries({ queryKey: STATS_KEY })
    }
  }
}

/** Status filter with counts, e.g. Pending (2). */
export const countLabel = (label: string, n?: number) => (
  <>
    {label}
    {n !== undefined && <span className="text-xs font-semibold text-ink-500 tabular">{n}</span>}
  </>
)

/** Accessible on/off switch. */
export const Switch: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
}> = ({ checked, onChange, label, disabled, size = 'md' }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 disabled:opacity-50',
      size === 'md' ? 'h-6 w-11' : 'h-5 w-9',
      checked ? 'bg-brand-600' : 'bg-ink-300',
    )}
  >
    <span
      aria-hidden
      className={cn(
        'inline-block rounded-full bg-white shadow-xs transition-transform',
        size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
        checked ? (size === 'md' ? 'translate-x-[22px]' : 'translate-x-[18px]') : 'translate-x-0.5',
      )}
    />
  </button>
)
