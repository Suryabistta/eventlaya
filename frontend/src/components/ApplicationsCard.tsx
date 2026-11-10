import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileText, Search, X } from 'lucide-react'
import { request } from '@/services/api'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Modal, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

/** Open calls (registration_mode apply): the organizer screens every application. Backend: apps.dynamic_forms. */
type Review = 'pending' | 'accepted' | 'rejected'

interface Answer {
  id: string
  field_label: string
  field_type: string
  value: unknown
}

interface Application {
  id: string
  ticket_number: string | null
  submitter_name: string
  submitter_email: string
  submitter_phone: string
  review_status: Review
  rejection_note: string
  submitted_at: string
  answers: Answer[]
}

const REVIEW: Record<Review, { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  pending: { label: 'To review', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Not selected', tone: 'danger' },
}

const FILTERS: { key: 'all' | Review; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'To review' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Not selected' },
]

/** Answer values: text, a list (checkboxes) or an uploaded file / link. */
const AnswerValue: React.FC<{ value: unknown }> = ({ value }) => {
  const v = value && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? (value as { value: unknown }).value : value
  if (Array.isArray(v)) return <>{v.join(', ') || '–'}</>
  const text = v == null ? '' : String(v)
  if (/^(https?:\/\/|\/media\/)/.test(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-brand-700 hover:underline">
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        {text.startsWith('/media/') ? 'Open file' : text}
      </a>
    )
  }
  return <span className="whitespace-pre-line">{text || '–'}</span>
}

export const ApplicationsCard: React.FC<{ className?: string; eventId: string; onExport: () => void; exporting: boolean }> = ({
  className,
  eventId,
  onExport,
  exporting,
}) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | Review>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Application | null>(null)
  const [note, setNote] = useState('')
  const key = ['applications', eventId]
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => request<Application[]>(`/forms/events/${eventId}/submissions/`),
  })

  const review = useMutation({
    mutationFn: (v: { id: string; status: Review; note?: string }) =>
      request<Application>(`/forms/responses/${v.id}/review/`, { method: 'POST', body: JSON.stringify({ status: v.status, note: v.note ?? '' }) }),
    onSuccess: (a) => {
      qc.setQueryData<Application[]>(key, (list) => list?.map((x) => (x.id === a.id ? { ...x, ...a } : x)))
      setOpen(null)
      toast.success(a.review_status === 'accepted' ? `Accepted ${a.submitter_name}` : a.review_status === 'rejected' ? `${a.submitter_name} not selected` : 'Moved back to review', a.review_status === 'pending' ? undefined : 'They’ve been emailed.')
    },
    onError: (e: Error) => toast.error('Couldn’t save the review', e.message),
  })

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(
      (a) => (filter === 'all' || a.review_status === filter) && (!q || a.submitter_name.toLowerCase().includes(q) || a.submitter_email.toLowerCase().includes(q)),
    )
  }, [data, filter, search])

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader
        title="Applications"
        description={`${data.length} received, ${data.filter((a) => a.review_status === 'pending').length} to review. Open one to read it and accept or decline.`}
        actions={
          <Button variant="secondary" size="sm" loading={exporting} icon={<Download className="h-4 w-4" />} onClick={onExport}>
            Export CSV
          </Button>
        }
      />
      {data.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div role="radiogroup" aria-label="Filter by review" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium', filter === f.key ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100')}
              >
                {f.label}
                <span className={cn('rounded-md px-1.5 text-xs tabular', filter === f.key ? 'bg-white/15' : 'bg-ink-100 text-ink-600')}>
                  {f.key === 'all' ? data.length : data.filter((a) => a.review_status === f.key).length}
                </span>
              </button>
            ))}
          </div>
          <label className="relative block md:w-64">
            <span className="sr-only">Search applications</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
              className="h-9 w-full rounded-[10px] border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
            />
          </label>
        </div>
      )}
      {isLoading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load applications." onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="No applications yet" description="Share the event link. Each application shows up here for you to review." />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing here" description="Try another filter or search." />
      ) : (
        <ul className="max-h-[560px] divide-y divide-ink-100 overflow-auto">
          {shown.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(a)
                  setNote(a.rejection_note)
                }}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-ink-50/70"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-900">{a.submitter_name}</p>
                  <p className="truncate text-xs text-ink-500">
                    {a.submitter_email} · {new Date(a.submitted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <Badge tone={REVIEW[a.review_status].tone} dot>
                  {REVIEW[a.review_status].label}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Modal
          open
          onClose={() => setOpen(null)}
          size="lg"
          title={open.submitter_name}
          description={`${open.submitter_email}${open.submitter_phone ? ` · ${open.submitter_phone}` : ''}${open.ticket_number ? ` · No. ${open.ticket_number}` : ''}`}
          footer={
            <>
              {open.review_status !== 'pending' && (
                <Button variant="ghost" disabled={review.isPending} onClick={() => review.mutate({ id: open.id, status: 'pending' })}>
                  Back to review
                </Button>
              )}
              <Button variant="secondary" icon={<X className="h-4 w-4" />} loading={review.isPending} onClick={() => review.mutate({ id: open.id, status: 'rejected', note })}>
                Not selected
              </Button>
              <Button icon={<Check className="h-4 w-4" />} loading={review.isPending} onClick={() => review.mutate({ id: open.id, status: 'accepted' })}>
                Accept
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Badge tone={REVIEW[open.review_status].tone} dot>
              {REVIEW[open.review_status].label}
            </Badge>
            <dl className="divide-y divide-ink-100 rounded-xl border border-ink-200">
              {open.answers.length === 0 && <p className="p-4 text-sm text-ink-500">No answers to the form questions.</p>}
              {open.answers.map((ans) => (
                <div key={ans.id} className="grid gap-1 p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <dt className="text-sm text-ink-500">{ans.field_label}</dt>
                  <dd className="text-sm text-ink-900">
                    <AnswerValue value={ans.value} />
                  </dd>
                </div>
              ))}
            </dl>
            <Textarea
              label="Note if not selected"
              rows={3}
              hint="Optional. Included in the email when you choose Not selected."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </Card>
  )
}
