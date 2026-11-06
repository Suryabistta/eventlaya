import React, { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, Modal, Select, Textarea } from '@/components/ui'
import { billingApi, methodLabels, npr, type Cycle, type PaymentMethod, type Plan, type PlanCode, type SubscriptionRow } from './api'

export const usePlans = () => useQuery({ queryKey: ['platform', 'billing', 'plans'], queryFn: billingApi.plans, staleTime: 5 * 60_000 })

const priceFor = (plan: Plan | undefined, cycle: Cycle, months: number) => {
  if (!plan) return 0
  if (cycle === 'yearly' && plan.yearly_price != null) return Math.round((plan.yearly_price * months) / 12)
  return (plan.monthly_price ?? 0) * months
}

/** Record a payment received outside the app (eSewa, bank deposit, cash…). Extends the subscription. */
export const RecordPaymentDialog: React.FC<{
  sub: SubscriptionRow | null
  onClose: () => void
  onSubmit: (sub: SubscriptionRow, body: Parameters<typeof billingApi.recordPayment>[1]) => Promise<unknown>
}> = ({ sub, onClose, onSubmit }) => {
  const formId = useId()
  const { data: plans = [] } = usePlans()
  const paid = plans.filter((p) => p.code !== 'free')
  const [plan, setPlan] = useState<PlanCode>('event_pro')
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('esewa')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sub) return
    setPlan(sub.plan === 'free' ? 'event_pro' : sub.plan)
    setCycle(sub.billing_cycle)
    setMonths(sub.billing_cycle === 'yearly' ? 12 : 1)
    setAmountTouched(false)
    setMethod('esewa')
    setReference('')
    setNote('')
    setError('')
  }, [sub])

  const selected = plans.find((p) => p.code === plan)
  const suggested = priceFor(selected, cycle, months)
  useEffect(() => {
    if (!amountTouched) setAmount(suggested ? String(suggested) : '')
  }, [suggested, amountTouched])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sub) return
    const n = Number(amount)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter the amount received in NPR, as a whole number.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(sub, { plan, billing_cycle: cycle, months, amount: n, method, reference, note })
      onClose()
    } catch {
      /* toast shown by caller */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!sub}
      onClose={onClose}
      title={`Record payment from ${sub?.organization_name ?? ''}`}
      description="For money received by eSewa, Khalti, bank deposit or cash. Their plan is extended straight away."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={formId} loading={busy}>
            Record payment
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
          {paid.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          label="Billing"
          value={cycle}
          onChange={(e) => {
            const c = e.target.value as Cycle
            setCycle(c)
            setMonths(c === 'yearly' ? 12 : 1)
          }}
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </Select>
        <Input
          label="Months covered"
          type="number"
          min={1}
          max={36}
          value={months}
          onChange={(e) => setMonths(Math.max(1, Math.min(36, Number(e.target.value) || 1)))}
        />
        <Input
          label="Amount received (NPR)"
          type="number"
          inputMode="numeric"
          min={1}
          required
          value={amount}
          error={error || undefined}
          hint={suggested ? `List price: ${npr(suggested)}` : 'Custom quote: enter the agreed amount'}
          onChange={(e) => {
            setAmountTouched(true)
            setAmount(e.target.value)
            if (error) setError('')
          }}
        />
        <Select label="Paid with" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {Object.entries(methodLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction or receipt number" className="font-mono" />
        <Textarea label="Internal note" containerClassName="sm:col-span-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} hint="Only platform admins see this." />
      </form>
    </Modal>
  )
}

export const ChangePlanDialog: React.FC<{
  sub: SubscriptionRow | null
  onClose: () => void
  onSubmit: (sub: SubscriptionRow, plan: PlanCode, cycle: Cycle) => Promise<unknown>
}> = ({ sub, onClose, onSubmit }) => {
  const formId = useId()
  const { data: plans = [] } = usePlans()
  const [plan, setPlan] = useState<PlanCode>('free')
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (sub) {
      setPlan(sub.plan)
      setCycle(sub.billing_cycle)
    }
  }, [sub])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sub) return
    setBusy(true)
    try {
      await onSubmit(sub, plan, cycle)
      onClose()
    } catch {
      /* toast shown */
    } finally {
      setBusy(false)
    }
  }

  const live = sub && plan === sub.plan && sub.status === 'active' && sub.days_left !== null && sub.days_left >= 0

  return (
    <Modal
      open={!!sub}
      onClose={onClose}
      size="sm"
      title={`Change plan for ${sub?.organization_name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={formId} loading={busy} disabled={!!sub && plan === sub.plan && cycle === sub.billing_cycle}>
            Change plan
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Select label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanCode)}>
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
        {plan !== 'free' && (
          <Select label="Billing" value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
        )}
        <p className="text-sm text-ink-500">
          {plan === 'free'
            ? 'They move to Free straight away and their paid period ends.'
            : live
              ? 'Their current paid period stays the same. Record a payment to extend it.'
              : 'No payment is recorded, so they get a 14-day trial of this plan. Record a payment to activate it.'}
        </p>
      </form>
    </Modal>
  )
}
