import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CreditCard, Info } from 'lucide-react'
import { Button, Card, Skeleton, useToast } from '@/components/ui'
import { ProviderMark } from '@/components/payments'
import { cn } from '@/lib/utils'
import { paymentsApi, type PaymentOptions, type ProviderId } from '@/lib/payments'

const MODES: { value: PaymentOptions['mode']; title: string; hint: string }[] = [
  { value: 'venue', title: 'Pay at the venue', hint: 'Attendees pay in cash when they arrive' },
  { value: 'both', title: 'Online or at the venue', hint: 'Attendees choose at checkout' },
  { value: 'online', title: 'Online only', hint: 'Khalti / eSewa before they get a pass' },
]

/** Organizer: per event, how attendees pay for paid tickets (Tickets page). */
export const EventPaymentOptions: React.FC<{ eventId: string }> = ({ eventId }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['event-payment-settings', eventId], queryFn: () => paymentsApi.eventSettings(eventId) })
  const [mode, setMode] = useState<PaymentOptions['mode']>('venue')
  const [providers, setProviders] = useState<ProviderId[]>([])
  useEffect(() => {
    if (!query.data) return
    setMode(query.data.payment_mode)
    setProviders(query.data.online_providers)
  }, [query.data])

  const save = useMutation({
    mutationFn: () => paymentsApi.saveEventSettings(eventId, { payment_mode: mode, online_providers: providers }),
    onSuccess: (res) => {
      qc.setQueryData(['event-payment-settings', eventId], res)
      void qc.invalidateQueries({ queryKey: ['publicEvent'] })
      toast.success('Payment options saved', res.effective.online ? `Attendees can pay online with ${res.effective.providers.map((p) => p.name).join(' or ')}.` : 'Attendees pay at the venue.')
    },
    onError: (e: Error) => toast.error("Couldn't save payment options", e.message),
  })

  if (query.isLoading) return <Skeleton className="h-48 rounded-2xl" />
  if (query.isError || !query.data) return null
  const s = query.data
  const dirty = mode !== s.payment_mode || providers.slice().sort().join() !== s.online_providers.slice().sort().join()
  const online = mode !== 'venue'
  const realProviders = s.available_providers.filter((p) => p.id !== 'test')
  const fee = Number(s.platform_fee_percent)
  const toggle = (id: ProviderId) =>
    setProviders((cur) => {
      // Empty means "all": start from everything when narrowing
      const base = cur.length ? cur : realProviders.map((p) => p.id)
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
      return next.length === realProviders.length ? [] : next
    })
  const isOn = (id: ProviderId) => !providers.length || providers.includes(id)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <CreditCard className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink-900">Payment options</h2>
            <p className="mt-0.5 text-sm text-ink-500">How attendees pay for paid tickets. Free tickets never ask for payment.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Save
        </Button>
      </div>
      <div className="space-y-4 p-5">
        <div role="radiogroup" aria-label="How attendees pay" className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                mode === m.value ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600' : 'border-ink-200 hover:border-ink-300',
              )}
            >
              <span className="block text-sm font-semibold text-ink-900">{m.title}</span>
              <span className="mt-0.5 block text-xs text-ink-500">{m.hint}</span>
            </button>
          ))}
        </div>

        {online && (
          <>
            {realProviders.length > 0 ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-ink-800">Accept</legend>
                <div className="flex flex-wrap gap-2">
                  {realProviders.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
                        isOn(p.id) ? 'border-brand-600 bg-white' : 'border-ink-200 bg-ink-50 text-ink-500',
                      )}
                    >
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isOn(p.id)} onChange={() => toggle(p.id)} />
                      <ProviderMark id={p.id} size="sm" />
                      {p.name}
                      {p.sandbox && <span className="rounded-full bg-marigold-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-marigold-800">Sandbox</span>}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  Mark single ticket types as <span className="font-medium">online only</span> in the ticket type editor. Tickets are held for {s.effective.hold_minutes ?? 15} minutes while
                  someone pays.
                </p>
              </fieldset>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-marigold-50 px-3.5 py-2.5 text-sm text-marigold-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Online payment isn't set up on Eventlaya yet, so attendees will pay at the venue until it is.
              </p>
            )}
            {!s.effective.online && s.payment_mode !== 'venue' && !dirty && realProviders.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-marigold-50 px-3.5 py-2.5 text-sm text-marigold-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Online payment is switched off for your account right now. Attendees can still pay at the venue.
              </p>
            )}
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-sm text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                <span className="font-semibold">Where the money goes:</span> online payments are collected by Eventlaya's Khalti and eSewa merchant accounts, then paid
                out to you by bank transfer{fee > 0 ? `, minus a ${fee}% platform fee` : ''}. Track what was collected and paid out on{' '}
                <Link to="/app/payments" className="font-semibold underline underline-offset-2">
                  Payments
                </Link>
                . Refunds are made by hand: mark an order refunded there with a note.
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
