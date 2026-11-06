/** Paid votes: pack list, purchase modal (pack → verify → pay with Khalti / eSewa) and the "back from payment" panel. */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { trackOnce } from '@/lib/analytics'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Clock, Coins, Loader2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import { Badge, Button, Card, Input, Modal } from '@/components/ui'
import { PaymentChoice } from '@/components/payments'
import { goToCheckout, isOpenIntent, paymentsApi } from '@/lib/payments'
import { ApiError } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { contestApi, type BuyVotesInput, type PublicContest, type PublicPack, type VotePackResult } from './api'
import { NumberTag, deviceId, readStore } from './shared'
import { Turnstile, readVoterToken, saveVoterToken, type StoredToken, type VoteTarget } from './VoteFlow'

const rs = (v: string | number) => `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const TICKET_KEY = (slug: string) => `eventlaya:ticket-code:${slug}`

export type BuyChoice = { pack: string } | { votes: number }

/* ------------------------------------------------------------------ */
/* Pack list                                                           */

export const PacksSection: React.FC<{
  contest: PublicContest
  contestant?: VoteTarget | null
  onBuy: (choice: BuyChoice) => void
  className?: string
}> = ({ contest, contestant, onBuy, className }) => {
  const paid = contest.paid
  const [custom, setCustom] = useState('10')
  if (!paid.enabled || (!paid.packs.length && !paid.custom_votes)) return null
  const can = paid.payments_available
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900">
          <Coins className="h-5 w-5 text-marigold-600" aria-hidden /> Get more votes
        </h2>
        {!can && <Badge tone="neutral">Unavailable</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-600">
        {can
          ? contestant && paid.buy_and_vote
            ? `Votes you buy here go straight to ${contestant.display_number} ${contestant.name} once the payment is confirmed.`
            : 'Extra votes on top of your free ones. They stay in your balance until you use them.'
          : paid.unavailable_message ?? 'Vote packs can’t be bought right now.'}
        {can && paid.max_packs_per_day > 0 && ` Up to ${paid.max_packs_per_day} purchases a day.`}
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {paid.packs.map((p) => (
          <li key={p.id} className={cn('flex flex-col rounded-xl border border-ink-200 p-4', !can && 'opacity-70')}>
            <p className="font-display text-2xl font-bold text-ink-900 tabular">{p.total_votes} votes</p>
            {p.bonus_votes > 0 && <p className="text-xs font-semibold text-emerald-700">includes {p.bonus_votes} bonus</p>}
            <p className="mt-1 text-sm text-ink-600">{p.label || `${p.votes} votes`}</p>
            <p className="mt-2 font-semibold text-ink-900">{rs(p.price)}</p>
            <Button size="sm" className="mt-3 w-full" disabled={!can} onClick={() => onBuy({ pack: p.id })}>
              Buy
            </Button>
          </li>
        ))}
      </ul>
      {paid.custom_votes && paid.price_per_vote && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-ink-50 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Math.floor(Number(custom))
            if (n >= 1) onBuy({ votes: Math.min(n, paid.max_custom_votes) })
          }}
        >
          <Input label={`Any number of votes (${rs(paid.price_per_vote)} each)`} type="number" min={1} max={paid.max_custom_votes} inputMode="numeric"
            value={custom} onChange={(e) => setCustom(e.target.value)} containerClassName="w-48" />
          <Button type="submit" variant="secondary" disabled={!can || !(Number(custom) >= 1)}>
            Buy for {rs(Math.max(0, Math.floor(Number(custom) || 0)) * Number(paid.price_per_vote))}
          </Button>
        </form>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Purchase modal                                                      */

export const BuyVotesFlow: React.FC<{
  open: boolean
  onClose: () => void
  contest: PublicContest
  slug: string
  contestRef: string
  contestant?: VoteTarget | null
  choice: BuyChoice | null
}> = (props) => (props.open && props.choice ? <BuyInner key={JSON.stringify(props.choice)} {...props} choice={props.choice} /> : null)

const BuyInner: React.FC<{
  onClose: () => void
  contest: PublicContest
  slug: string
  contestRef: string
  contestant?: VoteTarget | null
  choice: BuyChoice
}> = ({ onClose, contest, slug, contestRef, contestant, choice }) => {
  const { user } = useAuth()
  const location = useLocation()
  const paid = contest.paid
  const mode = contest.vote_mode
  const otp = mode === 'sms_otp' || mode === 'email_otp'
  const siteKey = contest.verification.captcha_site_key
  const channelWord = mode === 'sms_otp' ? 'mobile number' : 'email'

  const offer = useMemo(() => {
    if ('pack' in choice) {
      const p = paid.packs.find((x) => x.id === choice.pack) as PublicPack | undefined
      return p ? { label: p.label || `${p.total_votes} votes`, total: p.total_votes, bonus: p.bonus_votes, price: Number(p.price) } : null
    }
    return { label: `${choice.votes} votes`, total: choice.votes, bonus: 0, price: choice.votes * Number(paid.price_per_vote ?? 0) }
  }, [choice, paid])

  const [token, setToken] = useState<StoredToken | null>(() => (otp ? readVoterToken(contest.id) : null))
  const [destination, setDestination] = useState('')
  const [verifiedRaw, setVerifiedRaw] = useState('')
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [ticketCode, setTicketCode] = useState(() => readStore<string>(TICKET_KEY(slug)) ?? '')
  const [useAccountTicket, setUseAccountTicket] = useState(Boolean(user))
  const [provider, setProvider] = useState<string | null>(() => {
    const list = paid.providers.filter((p) => p.id !== 'khalti' || (offer?.price ?? 0) >= 10)
    return list.length === 1 ? list[0].id : null
  })
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const [busy, setBusy] = useState<'send' | 'verify' | 'pay' | null>(null)
  const [error, setError] = useState<string>()
  const codeInput = useRef<HTMLInputElement>(null)

  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    if (e instanceof ApiError && e.code === 'verification_required') {
      saveVoterToken(contest.id, null)
      setToken(null)
    }
    if (siteKey) setCaptchaReset((n) => n + 1)
  }

  const sendCode = async () => {
    setError(undefined)
    if (!destination.trim()) return setError(`Enter your ${channelWord}.`)
    if (siteKey && !captcha) return setError('Complete the “I’m not a robot” check first.')
    setBusy('send')
    try {
      const res = await contestApi.sendOtp(slug, contestRef, destination.trim(), captcha ?? undefined)
      setCodeSentTo(res.destination)
      setCode('')
      requestAnimationFrame(() => codeInput.current?.focus())
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
      if (siteKey) setCaptchaReset((n) => n + 1)
    }
  }

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(undefined)
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.')
    setBusy('verify')
    try {
      const res = await contestApi.verifyOtp(slug, contestRef, destination.trim(), code)
      const stored = { token: res.voter_token, destination: res.destination, expires: Date.now() + res.expires_in * 1000 }
      saveVoterToken(contest.id, stored)
      setToken(stored)
      setVerifiedRaw(destination.trim())
      setCodeSentTo(null)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const identity = (): Partial<BuyVotesInput> | null => {
    if (otp) return token ? { voter_token: token.token } : null
    if (mode === 'ticket') return user && useAccountTicket ? {} : ticketCode.trim() ? { ticket_code: ticketCode.trim() } : null
    if (mode === 'account') return user ? {} : null
    return null
  }
  const ident = identity()

  const pay = async () => {
    setError(undefined)
    if (!ident) return setError(otp ? `Verify your ${channelWord} first.` : mode === 'ticket' ? 'Enter the ticket code from your pass.' : 'Sign in first.')
    if (!provider) return setError('Choose how to pay.')
    if (siteKey && !captcha) return setError('Complete the “I’m not a robot” check first.')
    setBusy('pay')
    try {
      const res = await contestApi.buy(slug, contestRef, {
        ...('pack' in choice ? { pack: choice.pack } : { votes: choice.votes }),
        ...ident,
        provider,
        device_id: deviceId(),
        ...(contestant ? { contestant: contestant.id } : {}),
        return_url: `${window.location.origin}${location.pathname}`,
        ...(verifiedRaw ? (mode === 'sms_otp' ? { payer_phone: verifiedRaw } : { payer_email: verifiedRaw }) : {}),
        ...(captcha ? { captcha_token: captcha } : {}),
      })
      goToCheckout(res.checkout)
    } catch (e) {
      fail(e)
      setBusy(null)
    }
  }

  if (!offer) return null
  const nextUrl = `/login?next=${encodeURIComponent(location.pathname)}`
  return (
    <Modal
      open
      onClose={onClose}
      title={`Buy ${offer.total} votes`}
      description={`${contest.title} · ${rs(offer.price)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={pay} loading={busy === 'pay'} disabled={!ident || !provider}>Pay {rs(offer.price)}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-ink-50 p-3 text-sm text-ink-700">
          <p className="font-semibold text-ink-900">
            {offer.label}
            {offer.bonus > 0 && <span className="ml-2 text-xs font-semibold text-emerald-700">includes {offer.bonus} bonus</span>}
          </p>
          {contestant && paid.buy_and_vote ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              Cast automatically for <NumberTag value={contestant.display_number} className="text-xs" /> <span className="font-semibold">{contestant.name}</span> when the payment is confirmed.
            </p>
          ) : (
            <p className="mt-1">The votes go to your balance; you choose who to vote for.</p>
          )}
        </div>

        {/* 1. Who is buying (credits land on this voter) */}
        <section aria-label="Your identity" className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-900">1. {otp ? `Verify your ${channelWord}` : mode === 'ticket' ? 'Your ticket' : 'Your account'}</h3>
          {otp && token && (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">Votes go to <span className="font-semibold">{token.destination}</span></p>
              <button type="button" className="shrink-0 text-xs font-semibold underline underline-offset-2" onClick={() => { saveVoterToken(contest.id, null); setToken(null) }}>
                Change
              </button>
            </div>
          )}
          {otp && !token && (codeSentTo ? (
            <form onSubmit={verify} className="space-y-3" noValidate>
              <p className="text-sm text-ink-600">We sent a 6-digit code to <span className="font-semibold text-ink-900">{codeSentTo}</span>.</p>
              <Input ref={codeInput} label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="text-center font-mono text-xl tracking-[0.4em]" />
              <div className="flex gap-2">
                <Button type="submit" loading={busy === 'verify'} disabled={code.length !== 6}>Verify</Button>
                <Button variant="ghost" size="sm" onClick={() => setCodeSentTo(null)}>Wrong {channelWord}?</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <Input label={mode === 'sms_otp' ? 'Your mobile number' : 'Your email'} type={mode === 'sms_otp' ? 'tel' : 'email'}
                inputMode={mode === 'sms_otp' ? 'tel' : 'email'} autoComplete={mode === 'sms_otp' ? 'tel' : 'email'}
                placeholder={mode === 'sms_otp' ? '98XXXXXXXX' : 'you@example.com'} value={destination} onChange={(e) => setDestination(e.target.value)}
                hint="The votes you buy are tied to this number, the same one you vote with." />
              <Button variant="dark" className="w-full" loading={busy === 'send'} onClick={sendCode}>Send code</Button>
            </div>
          ))}
          {mode === 'ticket' && (user && useAccountTicket ? (
            <p className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
              Using the ticket on your account ({user.email}).{' '}
              <button type="button" className="font-semibold underline" onClick={() => setUseAccountTicket(false)}>Use a ticket code</button>
            </p>
          ) : (
            <Input label="Ticket code" placeholder="TKT-0C4B62-0001" value={ticketCode} onChange={(e) => setTicketCode(e.target.value)} autoCapitalize="characters" />
          ))}
          {mode === 'account' && (user ? (
            <p className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">Buying as {user.email}.</p>
          ) : (
            <p className="text-sm text-ink-600">
              <Link to={nextUrl} className="font-semibold text-brand-700 underline">Sign in</Link> to buy votes; they go to your account.
            </p>
          ))}
        </section>

        {/* 2. How to pay */}
        <section aria-label="Payment" className={cn('space-y-3', !ident && 'pointer-events-none opacity-50')} aria-disabled={!ident}>
          <h3 className="text-sm font-semibold text-ink-900">2. Pay</h3>
          <PaymentChoice
            providers={paid.providers}
            venueAllowed={false}
            value={provider}
            onChange={setProvider}
            total={offer.price}
            holdMinutes={null}
            note={provider ? `You’ll pay on the ${paid.providers.find((p) => p.id === provider)?.name ?? 'payment'} page, then come back here. Your votes are added as soon as the payment is confirmed.` : 'Payments are verified with the provider before any votes are added.'}
          />
        </section>
        {siteKey && <Turnstile siteKey={siteKey} onToken={setCaptcha} resetKey={captchaReset} />}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Back from the payment page                                          */

/** ?payment=<id> on the contest / contestant page after Khalti / eSewa. */
export function usePaymentReturn() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const id = params.get('payment')
  return {
    paymentId: id,
    dismiss: () => navigate({ pathname: location.pathname, search: '' }, { replace: true }),
  }
}

const MAX_POLL_MS = 90_000

export const PurchaseReturn: React.FC<{
  paymentId: string
  contest: PublicContest
  onVoteNow: (contestantId: string | null) => void
  onRetry: (choice: BuyChoice | null) => void
  onDismiss: () => void
}> = ({ paymentId, contest, onVoteNow, onRetry, onDismiss }) => {
  const qc = useQueryClient()
  const started = useRef(Date.now())
  const [slow, setSlow] = useState(false)
  const { data, refetch, isFetching, isError } = useQuery({
    queryKey: ['payment-intent', paymentId],
    queryFn: () => paymentsApi.intent<VotePackResult>(paymentId),
    refetchInterval: (q) => {
      const d = q.state.data
      const waiting = !d || isOpenIntent(d.status) || (d.status === 'paid' && !d.fulfilled)
      return waiting && Date.now() - started.current < MAX_POLL_MS ? 2500 : false
    },
    retry: 2,
  })
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), MAX_POLL_MS)
    return () => clearTimeout(t)
  }, [])
  const settledPaid = data?.status === 'paid' && data.fulfilled
  useEffect(() => { if (settledPaid && data?.result?.type === 'vote_pack') trackOnce(`votes:${data.id}`, 'vote_pack_purchase', { transaction_id: data.reference || data.id, value: Number(data.amount), currency: 'NPR', contest_id: contest.id, votes: data.result.purchase.total_votes, payment_type: data.provider ?? 'online' }) }, [settledPaid, data, contest.id])
  useEffect(() => {
    if (settledPaid) {
      qc.invalidateQueries({ queryKey: ['contest-allowance', contest.id] })
      qc.invalidateQueries({ queryKey: ['public-contest'] })
      qc.invalidateQueries({ queryKey: ['public-contestant'] })
    }
  }, [settledPaid, qc, contest.id])

  const r = data?.result?.type === 'vote_pack' ? data.result : null
  const p = r?.purchase
  const wrap = (tone: string, icon: React.ReactNode, title: string, body: React.ReactNode, actions?: React.ReactNode) => (
    <Card className={cn('p-5', tone)} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-ink-900">{title}</h2>
          <div className="mt-1 text-sm text-ink-700">{body}</div>
          {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </Card>
  )

  if (isError && !data) {
    return wrap('border-red-200', <AlertCircle className="h-6 w-6 text-red-600" aria-hidden />, 'We couldn’t check your payment',
      'Check your connection. If you paid, the votes are added as soon as the payment is confirmed.',
      <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void refetch()}>Check again</Button>)
  }
  if (!data || isOpenIntent(data.status) || (data.status === 'paid' && !data.fulfilled)) {
    return wrap('', slow ? <Clock className="h-6 w-6 text-marigold-600" aria-hidden /> : <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />,
      slow ? `Still waiting for ${data?.provider_name ?? 'the payment provider'}` : 'Confirming your payment',
      slow ? 'It hasn’t confirmed the payment yet. If money left your account, the votes are added as soon as it does.' : 'This takes a few seconds. Please don’t close this page.',
      slow ? <Button size="sm" loading={isFetching} icon={<RotateCcw className="h-4 w-4" />} onClick={() => { started.current = Date.now(); setSlow(false); void refetch() }}>Check again</Button> : undefined)
  }
  if (data.status === 'paid' && p) {
    const all = p.auto_voted >= p.total_votes
    return wrap('border-emerald-200 bg-emerald-50/50', <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden />,
      p.auto_voted ? `${p.auto_voted} votes cast for ${p.contestant?.display_number ?? ''} ${p.contestant?.name ?? ''}`.replace(/\s+/g, ' ') : `${p.total_votes} votes added`,
      <>
        <p>
          Payment of {rs(data.amount)} received{data.provider_name ? ` via ${data.provider_name}` : ''}.{' '}
          {p.auto_vote_note || (!all && `You have ${r?.credits ?? p.total_votes} paid ${r?.credits === 1 ? 'vote' : 'votes'} to use.`)}
        </p>
        {data.provider_txn_id && <p className="mt-1 text-xs text-ink-500">Reference {data.provider_txn_id}</p>}
      </>,
      <>
        {!all && contest.voting_open && <Button size="sm" onClick={() => onVoteNow(p.contestant?.id ?? null)}>Vote now</Button>}
        <Button size="sm" variant="secondary" onClick={onDismiss}>Done</Button>
      </>)
  }
  const title = data.status === 'cancelled' ? 'Payment cancelled' : data.status === 'expired' ? 'Payment timed out' : data.status === 'refunded' ? 'Payment refunded' : 'Payment didn’t go through'
  return wrap('border-red-200', <XCircle className="h-6 w-6 text-red-600" aria-hidden />, title,
    data.status === 'refunded' ? 'The money was returned and the unused votes were removed.' : 'Nothing was charged and no votes were added. You can try again.',
    <>
      {data.status !== 'refunded' && <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onRetry(p ? (p.pack_id ? { pack: p.pack_id } : { votes: p.votes }) : null)}>Try again</Button>}
      <Button size="sm" variant="secondary" onClick={onDismiss}>Close</Button>
    </>)
}
