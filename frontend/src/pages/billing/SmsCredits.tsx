import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText, Send } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ErrorState, Input, Skeleton, Textarea, useToast } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { useModuleEnabled } from '@/lib/modules'
import { fmtCredits, smsApi } from '@/lib/sms'
import { cn } from '@/lib/utils'

const KEY = ['mySms'] as const

/** Organizer: SMS credit balance, what the plan includes, top-up requests and the credit history. */
export const SmsCreditsSection: React.FC = () => {
  const on = useModuleEnabled('sms')
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({ queryKey: KEY, queryFn: smsApi.mine, enabled: on })
  const [credits, setCredits] = useState('1000')
  const [note, setNote] = useState('')
  const ask = useMutation({
    mutationFn: () => smsApi.ask(Number(credits), note.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      setNote('')
      toast.success('Request sent', 'We’ll confirm payment with you and add the credits, usually within one working day.')
    },
    onError: (e: Error) => toast.error('Couldn’t send your request', e.message),
  })
  if (!on) return null
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
  if (isLoading || !data) return <Skeleton className="h-56 rounded-2xl" />

  const pending = data.requests.find((r) => r.status === 'pending')
  const lastDeclined = !pending && data.requests[0]?.status === 'declined' ? data.requests[0] : null
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="min-w-0">
        <CardHeader title="SMS credits" description="Used for text messages to contestants and guests" />
        <div className="space-y-4 p-5">
          <div>
            <p className={cn('font-display text-3xl font-bold tabular', data.balance > 0 ? 'text-ink-900' : 'text-red-700')}>{fmtCredits(data.balance)}</p>
            <p className="text-sm text-ink-500">credits left · 1 credit = 1 SMS (160 letters, or 70 in Nepali)</p>
          </div>
          <p className="rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
            {data.plan_monthly > 0
              ? `${data.plan_name} includes ${fmtCredits(data.plan_monthly)} SMS for every paid month.`
              : `${data.plan_name} doesn’t include SMS. Request credits below, or upgrade your plan.`}
          </p>
          {pending ? (
            <p className="rounded-xl bg-marigold-50 px-3 py-2.5 text-sm text-marigold-900">
              You asked for {fmtCredits(pending.credits)} credits on {formatDate(pending.created_at, 'medium')}. We’ll add them once confirmed.
            </p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                ask.mutate()
              }}
            >
              <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a pack">
                {data.packs.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCredits(String(p))}
                    aria-pressed={credits === String(p)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-semibold tabular',
                      credits === String(p) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:bg-ink-50',
                    )}
                  >
                    {fmtCredits(p)}
                  </button>
                ))}
              </div>
              <Input label="Credits" type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} />
              <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: paid by eSewa, ref 12345" />
              {lastDeclined && (
                <p className="text-sm text-red-700">
                  Your last request wasn’t approved{lastDeclined.review_note ? `: ${lastDeclined.review_note}` : '.'}
                </p>
              )}
              <Button type="submit" size="sm" loading={ask.isPending} disabled={!(Number(credits) > 0)} icon={<Send className="h-4 w-4" />}>
                Request credits
              </Button>
            </form>
          )}
        </div>
      </Card>
      <Card className="min-w-0 xl:col-span-2">
        <CardHeader title="SMS history" description="Credits added and SMS sent" />
        {data.history.length === 0 ? (
          <div className="flex items-center gap-3 p-5 text-sm text-ink-500">
            <MessageSquareText className="h-5 w-5 text-ink-400" aria-hidden />
            Nothing yet. Credits you get and SMS your events send show here.
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.history.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Badge tone={e.credits > 0 ? 'success' : 'neutral'}>{e.kind_display}</Badge>
                <span className="min-w-0 flex-1 truncate text-ink-700">{e.note}</span>
                <span className="shrink-0 text-xs text-ink-500">{formatDate(e.created_at, 'medium')}</span>
                <span className={cn('w-16 shrink-0 text-right font-semibold tabular', e.credits > 0 ? 'text-emerald-700' : 'text-ink-700')}>
                  {e.credits > 0 ? '+' : ''}
                  {fmtCredits(e.credits)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
