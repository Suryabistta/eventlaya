import React, { useEffect, useId, useState } from 'react'
import { formatDate } from '@/lib/dates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Clock, CreditCard, Receipt, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Modal, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { billingApi, npr, statusMeta, type Cycle, type MyBilling, type PlanCode } from '@/pages/admin/billing/api'

export const MY_BILLING_KEY = ['myBilling'] as const

export const useMyBilling = (enabled = true) => useQuery({ queryKey: MY_BILLING_KEY, queryFn: billingApi.mine, enabled })

const fmt = (iso: string | null) => formatDate(iso, 'long')

/** Current plan, renewal date, pending plan change and payment history for the signed-in organization. */
export const MyPlanSection: React.FC<{ data: MyBilling | undefined; isLoading: boolean; error: Error | null; onRetry: () => void }> = ({
  data,
  isLoading,
  error,
  onRetry,
}) => {
  if (error) return <ErrorState message={error.message} onRetry={onRetry} />
  if (isLoading || !data)
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl xl:col-span-2" />
      </div>
    )

  const { subscription: s, plan, payments, requests } = data
  const pending = requests.find((r) => r.status === 'pending')
  const lastDeclined = !pending && requests[0]?.status === 'declined' ? requests[0] : null
  const meta = statusMeta[s.status]
  const days = s.days_left

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="min-w-0">
        <CardHeader title="Your plan" actions={<Badge tone={meta.tone}>{meta.label}</Badge>} />
        <div className="space-y-4 p-5">
          <div>
            <p className="font-display text-3xl font-bold text-ink-900">{plan.name}</p>
            <p className="mt-0.5 text-sm text-ink-500">
              {plan.code === 'free'
                ? `Up to ${plan.attendee_limit ?? 150} attendees per event`
                : `${s.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly'} billing${s.monthly_value ? `, ${npr(s.monthly_value)} a month` : ''}`}
            </p>
          </div>
          {s.current_period_end && plan.code !== 'free' && (
            <p
              className={cn(
                'flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm',
                days !== null && days < 0 ? 'bg-red-50 text-red-800' : days !== null && days <= 7 ? 'bg-marigold-50 text-marigold-900' : 'bg-ink-50 text-ink-700',
              )}
            >
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {days !== null && days < 0
                  ? `Your plan ended on ${fmt(s.current_period_end)}. Pay to keep paid features.`
                  : `${s.status === 'trial' ? 'Trial ends' : s.status === 'cancelled' ? 'Access ends' : 'Renews'} on ${fmt(s.current_period_end)}${days !== null ? `, in ${days} ${days === 1 ? 'day' : 'days'}` : ''}.`}
              </span>
            </p>
          )}
          {pending && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-marigold-50 px-3 py-2.5 text-sm text-marigold-900">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                You asked to move to <strong>{pending.requested_plan_name}</strong> ({pending.billing_cycle}). Our team will call you to arrange payment.
              </span>
            </p>
          )}
          {lastDeclined && (
            <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Your request for {lastDeclined.requested_plan_name} wasn’t approved{lastDeclined.review_note ? `: ${lastDeclined.review_note}` : '.'}
              </span>
            </p>
          )}
          <p className="text-xs text-ink-500">Pay by eSewa, Khalti, Fonepay QR or bank transfer. Our team records your payment and your plan updates straight away.</p>
        </div>
      </Card>

      <Card className="min-w-0 xl:col-span-2">
        <CardHeader title="Payment history" description="Payments we’ve recorded for your organization" />
        {payments.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="No payments yet" description="When you pay for a plan, the receipt shows up here." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-ink-50 text-xs text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">For</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Paid with</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-700">{fmt(p.paid_at)}</td>
                    <td className="px-3 py-3 text-ink-700">
                      {p.plan_name}, {p.months_covered} {p.months_covered === 1 ? 'month' : 'months'}
                    </td>
                    <td className="px-3 py-3 text-ink-700">
                      {p.method_display}
                      {p.reference && <span className="block font-mono text-xs text-ink-500">{p.reference}</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={cn('font-semibold tabular', p.status === 'refunded' ? 'text-ink-500 line-through' : 'text-ink-900')}>{npr(p.amount)}</span>
                      {p.status === 'refunded' && <span className="block text-xs text-red-700">Refunded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

export const planCodes: Record<string, PlanCode> = { Free: 'free', 'Event Pro': 'event_pro', Business: 'business', Enterprise: 'enterprise' }

/** Ask the platform team for a plan change. No payment happens here. */
export const RequestUpgradeDialog: React.FC<{
  target: { plan: PlanCode; cycle: Cycle } | null
  data: MyBilling | undefined
  onClose: () => void
}> = ({ target, data, onClose }) => {
  const formId = useId()
  const toast = useToast()
  const qc = useQueryClient()
  const [plan, setPlan] = useState<PlanCode>('event_pro')
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (target) {
      setPlan(target.plan)
      setCycle(target.cycle)
      setNote('')
    }
  }, [target])

  const send = useMutation({
    mutationFn: () => billingApi.requestUpgrade(plan, cycle, note.trim()),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: MY_BILLING_KEY })
      toast.success('Request sent', `We’ll contact you about moving to ${r.requested_plan_name}, usually within one working day.`)
      onClose()
    },
    onError: (err: Error) => toast.error('Couldn’t send your request', err.message),
  })

  const selected = data?.plans.find((p) => p.code === plan)
  const price =
    selected?.monthly_price == null
      ? 'Custom quote'
      : selected.monthly_price === 0
        ? 'Free'
        : cycle === 'yearly' && selected.yearly_price != null
          ? `${npr(selected.yearly_price)} a year`
          : `${npr(selected.monthly_price)} a month`

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      size="sm"
      title={plan === 'free' ? 'Move to the Free plan' : `Request ${selected?.name ?? 'a plan'}`}
      description="Our team confirms the change and arranges payment by eSewa, Khalti, Fonepay or bank transfer."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={formId} loading={send.isPending} icon={<CreditCard className="h-4 w-4" />}>
            Send request
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          send.mutate()
        }}
        className="space-y-4"
      >
        <Select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
          {data?.plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
        {plan !== 'free' && plan !== 'enterprise' && (
          <Select label="Billing" value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly, save about 20%</option>
          </Select>
        )}
        <p className="rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
          Price: <span className="font-semibold text-ink-900">{price}</span>
        </p>
        <Textarea
          label="Anything we should know?"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="For example: our fest is on 12 December, and we expect about 800 attendees."
        />
      </form>
    </Modal>
  )
}
