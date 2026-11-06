import React, { useEffect, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Wallet, PiggyBank, Receipt, Scale, Pencil, TrendingUp, TrendingDown } from 'lucide-react'
import { api, type EventAnalytics, type EventFundingData } from '@/services/api'
import { Button, Card, CardHeader, EmptyState, Input, StatTile, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { barDataset, chartColors, fmtNpr, hBarOptions } from './charts'
import { ChartCard } from './shared'

type FundingKey = Exclude<keyof EventFundingData, 'id' | 'event' | 'total_funding' | 'total_expenses' | 'net_balance'>

const incomeFields: { key: FundingKey; label: string }[] = [
  { key: 'target_budget', label: 'Target budget' },
  { key: 'sponsorship_raised', label: 'Sponsorship raised' },
  { key: 'ticket_sales_revenue', label: 'Ticket sales' },
  { key: 'grants_donations', label: 'Grants and donations' },
]

const expenseFields: { key: FundingKey; label: string }[] = [
  { key: 'expense_venue', label: 'Venue and hall' },
  { key: 'expense_catering', label: 'Catering and food' },
  { key: 'expense_production', label: 'Stage, sound and lights' },
  { key: 'expense_marketing', label: 'Marketing and ads' },
  { key: 'expense_prizes_gifts', label: 'Prizes and mementos' },
  { key: 'expense_logistics', label: 'Logistics and travel' },
]

const allFields = [...incomeFields, ...expenseFields]

type FormState = Record<FundingKey, string>

// Keys of analytics.funding.expenses_breakdown, used when the funding record itself hasn't loaded
const breakdownLabels: Partial<Record<FundingKey, string>> = {
  expense_venue: 'Venue & Hall',
  expense_catering: 'Catering & Food',
  expense_production: 'Stage, Sound & Lights',
  expense_marketing: 'Marketing & Ads',
  expense_prizes_gifts: 'Prizes & Mementos',
  expense_logistics: 'Logistics & Travel',
}

function toForm(funding: EventFundingData | null | undefined, summary: EventAnalytics['funding']): FormState {
  return Object.fromEntries(
    allFields.map(({ key }) => {
      const label = breakdownLabels[key]
      const fallback = label ? summary.expenses_breakdown[label] : (summary as unknown as Record<string, number>)[key]
      const value = Number(funding ? funding[key] : fallback) || 0
      return [key, value ? String(value) : '']
    }),
  ) as FormState
}

const fmtAmount = (n: number) => Math.round(n).toLocaleString()

const Meter: React.FC<{
  label: string
  value: number
  target: number
  tone: 'brand' | 'marigold'
}> = ({ label, value, target, tone }) => {
  const pct = target > 0 ? Math.round((value / target) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink-700">{label}</span>
        <span className="tabular text-ink-500">
          {fmtNpr(value)} ({pct}%)
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100"
        role="meter"
        aria-label={`${label}, share of target budget`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full', tone === 'brand' ? 'bg-brand-600' : 'bg-marigold-500')}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

export const FundingSection: React.FC<{
  eventId: string
  analytics: EventAnalytics
}> = ({ eventId, analytics }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState>(() => toForm(null, analytics.funding))

  const {
    data: funding,
    isLoading: fundingLoading,
    isError: fundingError,
    error: fundingErr,
  } = useQuery({
    queryKey: ['funding', eventId],
    queryFn: () => api.getEventFunding(eventId),
  })

  // The overview comes from analytics; if the detailed record fails, editing falls back to those totals
  useEffect(() => {
    if (fundingError)
      toast.error('Couldn’t load the budget details', `${(fundingErr as Error)?.message ?? ''} You can still edit using the totals shown.`)
  }, [fundingError, fundingErr, toast])

  const save = useMutation({
    mutationFn: (body: Partial<EventFundingData>) => api.updateEventFunding(eventId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funding', eventId] })
      queryClient.invalidateQueries({ queryKey: ['analytics', eventId] })
      setEditing(false)
      toast.success('Budget saved')
    },
    onError: (err: Error) => toast.error('Couldn’t save the budget', err.message),
  })

  const openEditor = () => {
    // Never open with blank fields: saving would overwrite the real figures with zeros
    setForm(toForm(funding, analytics.funding))
    setEditing(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    save.mutate(Object.fromEntries(allFields.map(({ key }) => [key, parseFloat(form[key]) || 0])))
  }

  const f = analytics.funding
  const hasData = f.target_budget > 0 || f.total_funding > 0 || f.total_expenses > 0
  const expenseLabels = Object.keys(f.expenses_breakdown)
  const expenseValues = Object.values(f.expenses_breakdown)
  const positive = f.net_balance >= 0

  const editButton = (
    <Button variant="secondary" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={openEditor} disabled={fundingLoading}>
      Edit budget
    </Button>
  )

  if (editing) {
    return (
      <Card>
        <CardHeader title="Edit budget" description="All amounts in NPR. Leave a field empty for zero." />
        <form onSubmit={submit}>
          <div className="space-y-6 p-5">
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-ink-900">Budget and income</legend>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {incomeFields.map(({ key, label }) => (
                  <Input
                    key={key}
                    label={label}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    placeholder="0"
                    value={form[key]}
                    onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))}
                  />
                ))}
              </div>
            </fieldset>
            <div className="border-t border-ink-100 pt-5">
              <fieldset>
                <legend className="mb-3 text-sm font-semibold text-ink-900">Expenses</legend>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {expenseFields.map(({ key, label }) => (
                    <Input
                      key={key}
                      label={label}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      placeholder="0"
                      value={form[key]}
                      onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save budget
            </Button>
          </div>
        </form>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {!hasData ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="Set up the event budget"
            description="Add your target budget, sponsorship and expected costs to track money in and out."
            action={
              <Button icon={<Pencil className="h-4 w-4" />} onClick={openEditor}>
                Add budget
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-600">Money raised and spent for this event.</p>
            {editButton}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile label="Target budget (NPR)" value={fmtAmount(f.target_budget)} icon={<Scale className="h-5 w-5" />} />
            <StatTile
              label="Raised (NPR)"
              value={fmtAmount(f.total_funding)}
              hint="Sponsors, tickets and grants"
              icon={<PiggyBank className="h-5 w-5" />}
              tone="brand"
            />
            <StatTile
              label="Spent (NPR)"
              value={fmtAmount(f.total_expenses)}
              hint="All expense categories"
              icon={<Receipt className="h-5 w-5" />}
              tone="warning"
            />
            <Card className="p-4 sm:p-5">
              <p className="text-sm font-medium text-ink-500">Balance (NPR)</p>
              <p className={cn('mt-1 font-display text-3xl font-bold tabular', positive ? 'text-emerald-700' : 'text-red-700')}>
                {fmtAmount(f.net_balance)}
              </p>
              <p className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium', positive ? 'text-emerald-700' : 'text-red-700')}>
                {positive ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                {positive ? 'Surplus' : 'Deficit'}
              </p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader title="Against target" description="How much of the target budget is raised and spent" />
              <div className="space-y-5 p-5">
                {f.target_budget > 0 ? (
                  <>
                    <Meter label="Raised" value={f.total_funding} target={f.target_budget} tone="brand" />
                    <Meter label="Spent" value={f.total_expenses} target={f.target_budget} tone="marigold" />
                  </>
                ) : (
                  <p className="text-sm text-ink-500">Add a target budget to compare against.</p>
                )}
                <dl className="space-y-2 border-t border-ink-100 pt-4 text-sm">
                  {[
                    ['Sponsorship', f.sponsorship_raised],
                    ['Ticket sales', f.ticket_sales_revenue],
                    ['Grants and donations', f.grants_donations],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-ink-600">{label}</dt>
                      <dd className="font-medium tabular text-ink-900">{fmtNpr(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Card>

            <ChartCard
              className="lg:col-span-3"
              title="Spending by category"
              description="Costs recorded for each area"
              summary={expenseLabels.map((l, i) => `${l}: ${fmtNpr(expenseValues[i])}`).join('; ')}
              height="h-72"
            >
              <Bar
                options={hBarOptions(true)}
                data={{
                  labels: expenseLabels,
                  datasets: [
                    {
                      label: 'Spent',
                      ...barDataset(expenseValues, chartColors.marigold),
                    },
                  ],
                }}
              />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}
