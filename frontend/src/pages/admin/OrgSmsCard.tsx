import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, Skeleton, useToast } from '@/components/ui'
import { formatDate } from '@/lib/dates'
import { fmtCredits, smsApi } from '@/lib/sms'
import { cn } from '@/lib/utils'

/** Superadmin, on an organization: SMS credit balance, add or take back credits, recent history. */
export const OrgSmsCard: React.FC<{ orgId: string }> = ({ orgId }) => {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['platform', 'org-sms', orgId]
  const { data } = useQuery({ queryKey: key, queryFn: () => smsApi.org(orgId) })
  const [credits, setCredits] = useState('')
  const [note, setNote] = useState('')
  const add = useMutation({
    mutationFn: () => smsApi.addToOrg(orgId, Number(credits), note.trim()),
    onSuccess: (d) => {
      qc.setQueryData(key, d)
      setCredits('')
      setNote('')
      toast.success('SMS credits updated', `Balance is now ${fmtCredits(d.balance)}.`)
    },
    onError: (e: Error) => toast.error('Couldn’t update credits', e.message),
  })
  return (
    <Card>
      <CardHeader
        title="SMS credits"
        description={data ? `${fmtCredits(data.balance)} left · ${data.plan_name} includes ${fmtCredits(data.plan_monthly)} a paid month` : undefined}
      />
      {!data ? (
        <Skeleton className="m-5 h-20" />
      ) : (
        <div className="space-y-4 p-5">
          <form
            className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              add.mutate()
            }}
          >
            <Input label="Credits" type="number" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="500 or -50" />
            <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid by bank transfer" />
            <Button type="submit" size="sm" loading={add.isPending} disabled={!Number(credits)}>
              {Number(credits) < 0 ? 'Take back' : 'Add'}
            </Button>
          </form>
          {data.history.length > 0 && (
            <ul className="divide-y divide-ink-100 text-sm">
              {data.history.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-ink-700">
                    {e.kind_display}
                    {e.note ? ` · ${e.note}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-ink-500">{formatDate(e.created_at, 'medium')}</span>
                  <span className={cn('w-14 shrink-0 text-right font-semibold tabular', e.credits > 0 ? 'text-emerald-700' : 'text-ink-700')}>
                    {e.credits > 0 ? '+' : ''}
                    {fmtCredits(e.credits)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
