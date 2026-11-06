import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Clock, Loader2, RotateCcw, ShieldCheck, Store, XCircle } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/utils'
import { isOpenIntent, paymentsApi, PROVIDER_BRAND, type IntentStatus, type PaymentInfo, type ProviderInfo, type PublicIntent } from '@/lib/payments'
import type { Ticket } from '@/services/api'

/** Brand tile for a payment method (wordmark in the provider's colour; we don't ship their logo files). */
export const ProviderMark: React.FC<{ id: string; size?: 'sm' | 'md' }> = ({ id, size = 'md' }) => {
  const b = PROVIDER_BRAND[id] ?? PROVIDER_BRAND.venue
  if (id === 'venue') {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-700', size === 'sm' ? 'h-7 w-7' : 'h-10 w-10')} aria-hidden>
        <Store className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
    )
  }
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl font-display font-extrabold tracking-tight', size === 'sm' ? 'h-7 min-w-7 px-1.5 text-[11px]' : 'h-10 min-w-[64px] px-2.5 text-sm')}
      style={{ background: b.bg, color: b.fg }}
      aria-hidden
    >
      {b.name === 'Test payment' ? 'TEST' : b.name}
    </span>
  )
}

export type PayChoice = 'venue' | string

/** Pay online (one card per provider) or at the venue. */
export const PaymentChoice: React.FC<{
  providers: ProviderInfo[]
  venueAllowed: boolean
  venueBlockedReason?: string | null
  value: PayChoice | null
  onChange: (v: PayChoice) => void
  total: number
  holdMinutes: number | null
  error?: string
  /** Replaces the default note under the options (which talks about passes and ticket holds), e.g. for vote packs */
  note?: React.ReactNode
}> = ({ providers, venueAllowed, venueBlockedReason, value, onChange, total, holdMinutes, error, note }) => {
  const options: { id: PayChoice; title: string; hint: string; disabled?: string }[] = [
    ...providers.map((p) => ({
      id: p.id,
      title: p.id === 'test' ? 'Test payment (local only)' : `Pay with ${p.name}`,
      hint: p.id === 'khalti' ? 'Khalti wallet, mobile banking, cards' : p.id === 'esewa' ? 'eSewa wallet' : 'Fake checkout for development',
      disabled: p.id === 'khalti' && total < 10 ? 'Khalti takes Rs 10 or more' : undefined,
    })),
    ...(venueAllowed ? [{ id: 'venue', title: 'Pay at the venue', hint: 'Pay in cash when you arrive' }] : []),
  ]
  return (
    <fieldset className="space-y-2.5" data-invalid={error ? 'true' : undefined} aria-describedby="pay-hint">
      <legend className="mb-1 text-sm font-semibold text-ink-900">How do you want to pay?</legend>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {options.map((o) => {
          const checked = value === o.id
          return (
            <label
              key={o.id}
              className={cn(
                'relative flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
                o.disabled ? 'cursor-not-allowed border-dashed border-ink-200 bg-ink-50 opacity-70' : checked ? 'border-brand-600 ring-1 ring-brand-600' : 'border-ink-200 hover:border-ink-300',
                error && !checked && 'border-red-300',
              )}
            >
              <input
                type="radio"
                name="pay-with"
                value={o.id}
                checked={checked}
                disabled={Boolean(o.disabled)}
                onChange={() => onChange(o.id)}
                className="sr-only"
              />
              <ProviderMark id={o.id} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{o.title}</span>
                <span className="block text-xs text-ink-500">{o.disabled ?? o.hint}</span>
              </span>
              <span
                aria-hidden
                className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', checked ? 'border-brand-600' : 'border-ink-300')}
              >
                {checked && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
              </span>
            </label>
          )
        })}
      </div>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <p id="pay-hint" className="flex items-start gap-1.5 text-xs text-ink-500">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
        <span>
          {note ?? (
            <>
          {value && value !== 'venue'
            ? `You'll finish paying on the ${PROVIDER_BRAND[value]?.name ?? 'payment'} page, then come back here for your passes. Your tickets are held for ${holdMinutes ?? 15} minutes.`
            : 'Online payments are verified with the provider before your passes are issued.'}
          {!venueAllowed && venueBlockedReason ? ` ${venueBlockedReason}` : ''}
            </>
          )}
        </span>
      </p>
    </fieldset>
  )
}

export interface TicketOrderResult {
  type: 'ticket_order'
  order: { id: string; reference: string; ticket_count: number; total: string; payment: PaymentInfo }
  event: { slug: string; title: string }
  tickets: Ticket[]
  needs_attention: string | null
}

const MAX_POLL_MS = 90_000

/**
 * After the provider sends the buyer back: poll the payment until it settles, then hand the passes over.
 * The server verifies with Khalti/eSewa on every poll; the URL's ?status= is only a first guess.
 */
export const PaymentReturn: React.FC<{
  paymentId: string
  onPaid: (intent: PublicIntent<TicketOrderResult>) => void
  onRetry: () => void
  onVenue?: () => void
  headingRef?: React.RefObject<HTMLHeadingElement | null>
}> = ({ paymentId, onPaid, onRetry, onVenue, headingRef }) => {
  const started = useRef(Date.now())
  const [gaveUp, setGaveUp] = useState(false)
  const handed = useRef(false)
  const { data, isError, refetch, isFetching } = useQuery({
    queryKey: ['payment-intent', paymentId],
    queryFn: () => paymentsApi.intent<TicketOrderResult>(paymentId),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      const waiting = !s || isOpenIntent(s) || (s === 'paid' && !q.state.data?.fulfilled)
      if (!waiting) return false
      if (Date.now() - started.current > MAX_POLL_MS) return false
      return 2500
    },
    retry: 2,
  })
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), MAX_POLL_MS)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (data?.status === 'paid' && data.result?.tickets.length && !handed.current) {
      handed.current = true
      onPaid(data)
    }
  }, [data, onPaid])

  const status: IntentStatus | undefined = data?.status
  const provider = data?.provider_name ?? 'the provider'

  if (isError && !data) {
    return (
      <Shell icon={<AlertCircle className="h-7 w-7 text-red-600" aria-hidden />} title="We couldn't check your payment" headingRef={headingRef}>
        <p className="text-ink-600">Check your connection. If you paid, your passes are safe: they're also emailed to you once the payment is confirmed.</p>
        <Button className="mt-4" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => void refetch()}>
          Check again
        </Button>
      </Shell>
    )
  }

  if (!data || isOpenIntent(data.status) || (status === 'paid' && (!data.fulfilled || !data.result?.tickets.length) && !data.result?.needs_attention)) {
    const slow = gaveUp
    return (
      <Shell
        icon={slow ? <Clock className="h-7 w-7 text-marigold-600" aria-hidden /> : <Loader2 className="h-7 w-7 animate-spin text-brand-600" aria-hidden />}
        title={slow ? `Still waiting for ${provider}` : 'Confirming your payment'}
        headingRef={headingRef}
      >
        <p className="text-ink-600">
          {slow
            ? `${provider} hasn't confirmed the payment yet. If money left your account, your passes will be emailed as soon as it's confirmed. Your tickets stay held until ${data?.expires_at ? new Date(data.expires_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'the hold runs out'}.`
            : `We're checking with ${provider}. This takes a few seconds. Please don't close this page.`}
        </p>
        {data && (
          <p className="mt-2 text-sm text-ink-500">
            Rs {Number(data.amount).toLocaleString('en-IN')} · {data.description}
          </p>
        )}
        {slow && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              loading={isFetching}
              icon={<RotateCcw className="h-4 w-4" aria-hidden />}
              onClick={() => {
                started.current = Date.now()
                setGaveUp(false)
                void refetch()
              }}
            >
              Check again
            </Button>
          </div>
        )}
      </Shell>
    )
  }

  if (status === 'paid' && data.result?.needs_attention) {
    return (
      <Shell icon={<AlertCircle className="h-7 w-7 text-marigold-600" aria-hidden />} title="Payment received, but the tickets are gone" headingRef={headingRef}>
        <p className="text-ink-600">
          Your payment of Rs {Number(data.amount).toLocaleString('en-IN')} arrived after your ticket hold ran out, and the tickets sold out in the meantime. The
          organizer has been told and will refund you. Order <span className="font-mono font-semibold">{data.result.order.reference}</span>, payment reference{' '}
          <span className="font-mono">{data.provider_txn_id ?? '-'}</span>.
        </p>
      </Shell>
    )
  }

  if (status === 'paid') {
    return (
      <Shell icon={<CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden />} title="Payment received" headingRef={headingRef}>
        <p className="text-ink-600">Getting your passes…</p>
      </Shell>
    )
  }

  const title = status === 'cancelled' ? 'Payment cancelled' : status === 'expired' ? 'Payment timed out' : status === 'refunded' ? 'Payment refunded' : "Payment didn't go through"
  return (
    <Shell icon={<XCircle className="h-7 w-7 text-red-600" aria-hidden />} title={title} headingRef={headingRef}>
      <p className="text-ink-600">
        {status === 'cancelled'
          ? `You cancelled on ${provider}, so nothing was charged.`
          : status === 'expired'
            ? `The payment wasn't finished within the time we hold tickets.`
            : `${provider} didn't complete the payment.`}{' '}
        Your tickets were released. You can try again; your details are still filled in.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
        {onVenue && (
          <Button variant="secondary" icon={<Store className="h-4 w-4" aria-hidden />} onClick={onVenue}>
            Pay at the venue instead
          </Button>
        )}
      </div>
    </Shell>
  )
}

const Shell: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode; headingRef?: React.RefObject<HTMLHeadingElement | null> }> = ({
  icon,
  title,
  children,
  headingRef,
}) => (
  <Card className="p-5 sm:p-7" role="status" aria-live="polite">
    <div className="flex items-start gap-3">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-ink-900 outline-none">
          {title}
        </h2>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  </Card>
)
