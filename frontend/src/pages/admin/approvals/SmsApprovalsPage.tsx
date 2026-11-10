import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Inbox, X } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, Textarea, useToast } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { fmtCredits, smsApi, type SmsRequest } from '@/lib/sms'
import { billingApi } from '../billing/api'
import { STATS_KEY } from '../api'
import { PAGE, ReasonDialog, Segmented, countLabel } from '../shared'

type View = 'pending' | 'approved' | 'declined'

/** Superadmin: SMS credit top-up requests (add once paid, or decline), and the SMS each plan includes per month. */
export const SmsApprovalsPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const view = (['approved', 'declined'].includes(params.get('status') ?? '') ? params.get('status') : 'pending') as View
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['platform', 'sms-requests', view], queryFn: () => smsApi.requests(view) })
  const pendingCount = useQuery({ queryKey: ['platform', 'sms-requests', 'pending'], queryFn: () => smsApi.requests('pending') }).data?.length
  const [approving, setApproving] = useState<SmsRequest | null>(null)
  const [declining, setDeclining] = useState<SmsRequest | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'sms-requests'] })
    void qc.invalidateQueries({ queryKey: STATS_KEY })
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="SMS credits"
        description="Organizers ask for SMS credits here. Confirm their payment, then add the credits. Each SMS their events send uses one credit."
      />
      <Segmented
        label="Show"
        value={view}
        onChange={(v) => setParams(v === 'pending' ? {} : { status: v }, { replace: true })}
        options={[
          { value: 'pending', label: countLabel('Waiting for review', pendingCount) },
          { value: 'approved', label: 'Added' },
          { value: 'declined', label: 'Declined' },
        ]}
      />
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title={view === 'pending' ? 'You’re all caught up' : 'Nothing here yet'}
            description="When an organizer asks for SMS credits, the request shows up here."
          />
        </Card>
      ) : (
        <Card className="min-w-0">
          <ul className="divide-y divide-ink-100">
            {list.data.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/organizations/${r.organization_id}`} className="font-semibold text-ink-900 hover:text-brand-700 hover:underline">
                    {r.organization_name}
                  </Link>
                  <p className="text-sm text-ink-500">
                    Asked for <span className="font-semibold text-ink-800">{fmtCredits(r.credits)}</span> · has {fmtCredits(r.balance)} now · {formatDate(r.created_at, 'medium')}
                  </p>
                  {r.note && <p className="mt-1 text-sm text-ink-700">“{r.note}”</p>}
                  {r.status !== 'pending' && (
                    <p className="mt-1 text-sm text-ink-500">
                      {r.status === 'approved' ? `Added ${fmtCredits(r.granted ?? r.credits)}` : 'Declined'}
                      {r.review_note ? `: ${r.review_note}` : ''}
                    </p>
                  )}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setDeclining(r)}>
                      Decline
                    </Button>
                    <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setApproving(r)}>
                      Add credits
                    </Button>
                  </div>
                ) : (
                  <Badge tone={r.status === 'approved' ? 'success' : 'danger'}>{r.status === 'approved' ? 'Added' : 'Declined'}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <PlanSmsCard />
      <ApproveDialog request={approving} onClose={() => setApproving(null)} onDone={refresh} />
      <ReasonDialog
        open={!!declining}
        onClose={() => setDeclining(null)}
        title={`Decline ${declining?.organization_name ?? ''}’s request?`}
        description="They see the reason on their Plan & billing page."
        confirmLabel="Decline"
        placeholder="For example: we haven’t received the payment yet."
        onConfirm={async (note) => {
          try {
            await smsApi.decline(declining!.id, note)
            toast.success('Request declined')
            refresh()
          } catch (e) {
            toast.error('Couldn’t decline', (e as Error).message)
            throw e
          }
        }}
      />
    </div>
  )
}

export default SmsApprovalsPage

const ApproveDialog: React.FC<{ request: SmsRequest | null; onClose: () => void; onDone: () => void }> = ({ request, onClose, onDone }) => {
  const toast = useToast()
  const [credits, setCredits] = useState('')
  const [note, setNote] = useState('')
  React.useEffect(() => {
    if (request) {
      setCredits(String(request.credits))
      setNote('')
    }
  }, [request])
  const go = useMutation({
    mutationFn: () => smsApi.approve(request!.id, Number(credits), note.trim()),
    onSuccess: () => {
      toast.success('Credits added', `${request!.organization_name} now has ${fmtCredits(request!.balance + Number(credits))} SMS credits.`)
      onDone()
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t add credits', e.message),
  })
  return (
    <Modal
      open={!!request}
      onClose={onClose}
      size="sm"
      title={`Add SMS credits for ${request?.organization_name ?? ''}`}
      description="Add them once you’ve received the payment."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={go.isPending} disabled={!(Number(credits) > 0)} onClick={() => go.mutate()}>
            Add {Number(credits) > 0 ? fmtCredits(Number(credits)) : ''} credits
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Credits to add" type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} />
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: eSewa ref 12345, Rs 1,000" />
      </div>
    </Modal>
  )
}

/** SMS each plan includes per paid month (added when a plan payment is recorded). */
const PlanSmsCard: React.FC = () => {
  const qc = useQueryClient()
  const toast = useToast()
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: billingApi.plans })
  const [edit, setEdit] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: ({ code, n }: { code: string; n: number }) => smsApi.setPlanSms(code, n),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['public-plans'] })
      setEdit((e) => ({ ...e, [p.code]: '' }))
      toast.success('Saved', `${fmtCredits(p.sms_credits)} SMS per paid month.`)
    },
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })
  return (
    <Card className="min-w-0">
      <CardHeader title="SMS included with plans" description="Added for every paid month when you record a plan payment in Billing." />
      <ul className="divide-y divide-ink-100">
        {(plans.data ?? []).map((p) => {
          const value = edit[p.code] || String(p.sms_credits ?? 0)
          return (
            <li key={p.code} className="flex items-end gap-3 px-5 py-3">
              <span className="flex-1 pb-2 text-sm font-medium text-ink-900">{p.name}</span>
              <div className="w-56">
                <Input label={`SMS per month on ${p.name}`} type="number" min={0} value={value} onChange={(e) => setEdit((x) => ({ ...x, [p.code]: e.target.value }))} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!edit[p.code] || Number(edit[p.code]) === p.sms_credits}
                onClick={() => save.mutate({ code: p.code, n: Number(edit[p.code]) })}
              >
                Save
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
