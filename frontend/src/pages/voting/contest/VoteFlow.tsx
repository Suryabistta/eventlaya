import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { track } from '@/lib/analytics'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, Minus, Plus, ShieldCheck } from 'lucide-react'
import { Button, Input, Modal, useToast } from '@/components/ui'
import { ApiError } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { contestApi, type Allowance, type ContestVoteInput, type ContestVoteResult, type PublicContest } from './api'
import { ContestantPhoto, NumberTag, deviceId, readStore, writeStore } from './shared'
import { SharePanel } from './SharePanel'

export interface VoteTarget {
  id: string
  name: string
  display_number: string
  number: number | null
  slug: string
  photo_url?: string
}

export interface VoteCategory {
  id: string
  name: string
}

export interface StoredToken {
  token: string
  destination: string
  expires: number
}

const TOKEN_KEY = (contestId: string) => `eventlaya:contest-token:${contestId}`
const TICKET_KEY = (slug: string) => `eventlaya:ticket-code:${slug}`
const CONTACT_KEY = 'eventlaya:contest-contact'

/** Shared with the vote-pack purchase flow: one verification covers voting and buying. */
export function saveVoterToken(contestId: string, stored: StoredToken | null) {
  writeStore(TOKEN_KEY(contestId), stored)
}

export function readVoterToken(contestId: string): StoredToken | null {
  const t = readStore<StoredToken>(TOKEN_KEY(contestId))
  if (!t || !t.token || t.expires < Date.now() + 60_000) return null
  return t
}

/* ------------------------------------------------------------------ */
/* Cloudflare Turnstile                                                */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let turnstileLoading: Promise<void> | null = null
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!turnstileLoading) {
    turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        turnstileLoading = null
        reject(new Error('Could not load the robot check'))
      }
      document.head.appendChild(s)
    })
  }
  return turnstileLoading
}

/** "I'm not a robot" check. Tokens are single use: bump `resetKey` after each request that used one. */
export const Turnstile: React.FC<{ siteKey: string; onToken: (t: string | null) => void; resetKey: number }> = ({ siteKey, onToken, resetKey }) => {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          callback: (t: string) => cb.current(t),
          'expired-callback': () => cb.current(null),
          'error-callback': () => cb.current(null),
        })
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current)
      cb.current(null)
    }
  }, [resetKey])

  if (failed) return <p className="text-sm text-red-600">The robot check didn’t load. Check your connection and reopen this window.</p>
  return <div ref={box} className="min-h-[65px]" />
}

/* ------------------------------------------------------------------ */
/* Vote flow                                                           */

interface VoteFlowProps {
  open: boolean
  onClose: () => void
  contest: PublicContest
  slug: string
  contestRef: string
  contestant: VoteTarget | null
  category?: VoteCategory | null
  onVoted?: (res: ContestVoteResult) => void
}

/** Modal that verifies the voter (per the contest's method), picks how many votes, and casts them. */
export const VoteFlow: React.FC<VoteFlowProps> = (props) => {
  // Remount per target so state (quantity, errors, success) starts fresh each time
  const key = `${props.contestant?.id}-${props.category?.id ?? 'main'}-${props.open}`
  return <VoteFlowInner key={key} {...props} />
}

const VoteFlowInner: React.FC<VoteFlowProps> = ({ open, onClose, contest, slug, contestRef, contestant, category, onVoted }) => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion()
  const mode = contest.vote_mode
  const otp = mode === 'sms_otp' || mode === 'email_otp'
  const siteKey = contest.verification.captcha_site_key

  const [token, setToken] = useState<StoredToken | null>(() => (otp ? readVoterToken(contest.id) : null))
  const [destination, setDestination] = useState(() => (otp ? '' : readStore<string>(CONTACT_KEY) ?? ''))
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [ticketCode, setTicketCode] = useState(() => readStore<string>(TICKET_KEY(slug)) ?? '')
  const [useAccountTicket, setUseAccountTicket] = useState(Boolean(user))
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<'send' | 'verify' | 'vote' | null>(null)
  const [done, setDone] = useState<ContestVoteResult | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const qtyId = useId()

  useEffect(() => {
    if (resendAt <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [resendAt])

  const channelWord = mode === 'sms_otp' ? 'phone number' : 'email'

  /** Identity fields for vote/allowance requests, or null when the voter still has to identify. */
  const identity = useCallback((): Omit<ContestVoteInput, 'contestant'> | null => {
    const base = { device_id: deviceId() }
    if (otp) return token ? { ...base, voter_token: token.token } : null
    if (mode === 'ticket') {
      if (user && useAccountTicket) return base
      return ticketCode.trim() ? { ...base, ticket_code: ticketCode.trim() } : null
    }
    if (mode === 'contact') return destination.trim() ? { ...base, contact: destination.trim() } : null
    if (mode === 'account') return user ? base : null
    return base
  }, [otp, token, mode, user, useAccountTicket, ticketCode, destination])

  const ident = identity()
  // Remaining votes, once we know who's voting (contact/ticket are only checked on submit to avoid lookups per keystroke)
  const canAskAllowance = open && !done && (otp ? Boolean(token) : mode === 'open' || mode === 'account' ? Boolean(ident) : mode === 'ticket' && user && useAccountTicket)
  const allowanceQ = useQuery({
    queryKey: ['contest-allowance', contest.id, otp ? token?.token : mode === 'open' ? 'device' : user?.id, contestant?.id],
    queryFn: () => contestApi.allowance(slug, contestRef, { ...ident!, ...(contestant ? { contestant: contestant.id } : {}) }),
    enabled: Boolean(canAskAllowance && ident),
    retry: false,
    staleTime: 5000,
  })
  const allowance: Allowance | undefined = category ? allowanceQ.data?.categories[category.id] : allowanceQ.data?.main

  const maxPerSubmit = Math.max(1, contest.rules.max_votes_per_submit)
  // Free votes this contestant can still get (per-contestant cap included), else the voter's free votes; credits go beyond
  const freeHere = allowance ? (allowance.contestant_free_remaining ?? allowance.free_remaining) : null
  const available = allowance ? (freeHere === null ? Infinity : freeHere) + allowance.credits : Infinity
  const maxQ = Math.max(1, Math.min(maxPerSubmit, available))
  useEffect(() => setQuantity((q) => Math.min(q, maxQ)), [maxQ])
  const outOfVotes = allowance !== undefined && available <= 0
  // Out of votes for this contestant only (per-contestant cap), others can still get some
  const capReached = outOfVotes && allowance?.contestant_free_remaining === 0 && (allowance.free_remaining === null || allowance.free_remaining > 0)

  const handleError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.'
    setError(msg)
    if (e instanceof ApiError && e.code === 'verification_required') {
      writeStore(TOKEN_KEY(contest.id), null)
      setToken(null)
    }
    if (siteKey) setCaptchaReset((n) => n + 1)
  }

  const sendCode = async () => {
    setError(undefined)
    if (!destination.trim()) {
      setError(mode === 'sms_otp' ? 'Enter your mobile number.' : 'Enter your email address.')
      return
    }
    if (siteKey && !captcha) {
      setError('Complete the “I’m not a robot” check first.')
      return
    }
    setBusy('send')
    try {
      const res = await contestApi.sendOtp(slug, contestRef, destination.trim(), captcha ?? undefined)
      setCodeSentTo(res.destination)
      setResendAt(Date.now() + res.resend_in * 1000)
      setNow(Date.now())
      setCode('')
      requestAnimationFrame(() => codeInput.current?.focus())
    } catch (e) {
      handleError(e)
      const retry = e instanceof ApiError ? (e.data as { retry_after?: number } | null)?.retry_after : undefined
      if (retry) setResendAt(Date.now() + retry * 1000)
    } finally {
      setBusy(null)
      if (siteKey) setCaptchaReset((n) => n + 1)
    }
  }

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(undefined)
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code.')
      return
    }
    setBusy('verify')
    try {
      const res = await contestApi.verifyOtp(slug, contestRef, destination.trim(), code.trim())
      const stored = { token: res.voter_token, destination: res.destination, expires: Date.now() + res.expires_in * 1000 }
      writeStore(TOKEN_KEY(contest.id), stored)
      setToken(stored)
      setCodeSentTo(null)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    if (!contestant) return
    setError(undefined)
    const id = identity()
    if (!id) {
      setError(
        mode === 'ticket' ? 'Enter the ticket code from your pass.' : mode === 'contact' ? 'Enter your phone number or email.' : `Verify your ${channelWord} first.`,
      )
      return
    }
    if (siteKey && !captcha) {
      setError('Complete the “I’m not a robot” check first.')
      return
    }
    setBusy('vote')
    try {
      const res = await contestApi.vote(slug, contestRef, {
        ...id,
        contestant: contestant.id,
        ...(category ? { category: category.id } : {}),
        quantity,
        ...(captcha ? { captcha_token: captcha } : {}),
      })
      if (mode === 'ticket' && id.ticket_code) writeStore(TICKET_KEY(slug), id.ticket_code)
      if (mode === 'contact') writeStore(CONTACT_KEY, destination.trim())
      setDone(res)
      onVoted?.(res)
      track('vote_cast', { vote_type: 'contest', contest_id: contest.id, event_slug: slug, votes: quantity, category_id: category?.id })
      queryClient.invalidateQueries({ queryKey: ['public-contest', slug] })
      queryClient.invalidateQueries({ queryKey: ['public-contestant', slug] })
      queryClient.setQueryData(['contest-allowance', contest.id, otp ? token?.token : mode === 'open' ? 'device' : user?.id, contestant?.id], (old: { main: Allowance; categories: Record<string, Allowance> } | undefined) =>
        old ? (category ? { ...old, categories: { ...old.categories, [category.id]: res.allowance } } : { ...old, main: res.allowance }) : old,
      )
    } catch (e) {
      handleError(e)
      toast.error('Vote not counted', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(null)
      if (siteKey) setCaptchaReset((n) => n + 1)
    }
  }

  if (!contestant) return null
  const title = done ? 'Thank you for voting!' : `Vote for ${contestant.display_number} ${contestant.name}`.replace(/\s+/g, ' ')
  const needsIdentity = !ident
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))

  /* ---------- Success ---------- */
  if (done) {
    const a = done.allowance
    return (
      <Modal open={open} onClose={onClose} title={title} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-5">
          <div className="flex flex-col items-center text-center" aria-live="polite">
            <motion.div initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
              <CheckCircle2 className="h-16 w-16 text-emerald-600" aria-hidden />
            </motion.div>
            <p className="mt-3 font-semibold text-ink-900">{done.message}</p>
            <p className="mt-1 text-sm text-ink-600">
              {a.free_remaining === null
                ? 'You can vote again any time while voting is open.'
                : a.free_remaining > 0
                  ? `You have ${a.free_remaining} free ${a.free_remaining === 1 ? 'vote' : 'votes'} left${a.resets_daily ? ' today' : ''}.`
                  : a.resets_daily
                    ? 'You’ve used today’s free votes. They reset at midnight, Nepal time.'
                    : 'You’ve used all your free votes.'}
              {a.credits > 0 && ` Plus ${a.credits} from vote packs.`}
            </p>
          </div>
          <div className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4">
            <SharePanel eventSlug={slug} eventTitle={contest.event.title} contestRef={contestRef} contestTitle={contest.title} contestant={contestant} />
          </div>
        </div>
      </Modal>
    )
  }

  /* ---------- Vote form ---------- */
  const voteDisabled = needsIdentity || outOfVotes || (siteKey ? !captcha : false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={category ? `In ${category.name}` : contest.current_round ? `${contest.current_round.name} · ${contest.title}` : contest.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy === 'vote'} disabled={voteDisabled && busy !== 'vote'}>
            {quantity > 1 ? `Give ${quantity} votes` : 'Vote'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <ContestantPhoto name={contestant.name} photo={contestant.photo_url} className="h-16 w-14 shrink-0" rounded="rounded-xl" />
          <div className="min-w-0">
            <NumberTag value={contestant.display_number} />
            <p className="mt-1 truncate font-semibold text-ink-900">{contestant.name}</p>
          </div>
        </div>

        {/* Who is voting */}
        {otp && (
          token ? (
            <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                Verified as <span className="font-semibold">{token.destination}</span>
              </p>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold underline underline-offset-2"
                onClick={() => {
                  writeStore(TOKEN_KEY(contest.id), null)
                  setToken(null)
                }}
              >
                Change
              </button>
            </div>
          ) : codeSentTo ? (
            <form onSubmit={verify} className="space-y-3" noValidate>
              <p className="text-sm text-ink-600">
                We sent a 6-digit code to <span className="font-semibold text-ink-900">{codeSentTo}</span>. It works for 5 minutes.
              </p>
              <Input
                ref={codeInput}
                label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center font-mono text-xl tracking-[0.4em]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={busy === 'verify'} disabled={code.length !== 6}>Verify</Button>
                <Button variant="ghost" size="sm" disabled={resendIn > 0 || busy === 'send'} onClick={sendCode}>
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
                </Button>
                <button type="button" className="text-xs font-semibold text-ink-500 underline underline-offset-2" onClick={() => setCodeSentTo(null)}>
                  Wrong {channelWord}?
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <Input
                label={mode === 'sms_otp' ? 'Your mobile number' : 'Your email'}
                type={mode === 'sms_otp' ? 'tel' : 'email'}
                inputMode={mode === 'sms_otp' ? 'tel' : 'email'}
                autoComplete={mode === 'sms_otp' ? 'tel' : 'email'}
                placeholder={mode === 'sms_otp' ? '98XXXXXXXX' : 'you@example.com'}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), sendCode())}
                hint={`We send a one-time code to check it’s you. Your ${channelWord} is never shown to anyone.`}
              />
              {siteKey && <Turnstile siteKey={siteKey} onToken={setCaptcha} resetKey={captchaReset} />}
              <Button variant="dark" className="w-full" loading={busy === 'send'} disabled={resendIn > 0} onClick={sendCode}>
                {resendIn > 0 ? `Send code (wait ${resendIn}s)` : 'Send code'}
              </Button>
            </div>
          )
        )}

        {mode === 'ticket' && (
          user && useAccountTicket ? (
            <div className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900">
              <p className="font-semibold">Voting with the ticket on your account</p>
              <p className="mt-0.5 text-emerald-800">{user.email}</p>
              <button type="button" onClick={() => setUseAccountTicket(false)} className="mt-1.5 text-xs font-semibold underline underline-offset-2">
                Use a ticket code instead
              </button>
            </div>
          ) : (
            <Input
              label="Ticket code"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="TKT-0C4B62-0001"
              value={ticketCode}
              onChange={(e) => setTicketCode(e.target.value)}
              hint={contest.require_checked_in ? 'It’s under the QR on your pass. Your ticket must have been scanned at the gate.' : 'It’s printed under the QR code on your pass.'}
            />
          )
        )}

        {mode === 'contact' && (
          <Input
            label="Phone or email"
            inputMode="email"
            autoComplete="email"
            placeholder="98XXXXXXXX or you@example.com"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            hint="Used only to count each person’s votes. It isn’t shown to anyone."
          />
        )}

        {mode === 'account' && !user && (
          <div className="rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-3 text-sm text-ink-700">
            <p className="font-semibold text-ink-900">Sign in to vote</p>
            <p className="mt-0.5">Each Eventlaya account counts as one voter.</p>
            <Link to="/login" state={{ from: location.pathname }} className="mt-2 inline-flex font-semibold text-brand-700 underline underline-offset-2">
              Sign in or create an account
            </Link>
          </div>
        )}
        {mode === 'account' && user && <p className="text-sm text-ink-600">Voting as <span className="font-semibold text-ink-900">{user.email}</span></p>}

        {/* How many votes */}
        {!needsIdentity && maxPerSubmit > 1 && !outOfVotes && (
          <div>
            <p id={qtyId} className="text-sm font-medium text-ink-800">How many votes?</p>
            <div className="mt-2 flex items-center gap-3" role="group" aria-labelledby={qtyId}>
              <button
                type="button"
                aria-label="One vote fewer"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 disabled:opacity-40"
              >
                <Minus className="h-5 w-5" aria-hidden />
              </button>
              <output className="min-w-[3ch] text-center font-display text-3xl font-bold tabular text-ink-900" aria-live="polite">{quantity}</output>
              <button
                type="button"
                aria-label="One vote more"
                disabled={quantity >= maxQ}
                onClick={() => setQuantity((q) => Math.min(maxQ, q + 1))}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 disabled:opacity-40"
              >
                <Plus className="h-5 w-5" aria-hidden />
              </button>
              {maxQ > 2 && (
                <button type="button" onClick={() => setQuantity(maxQ)} className="ml-1 text-sm font-semibold text-brand-700 underline underline-offset-2">
                  All {maxQ}
                </button>
              )}
            </div>
          </div>
        )}

        {allowance && (
          <p className={cn('rounded-xl px-3.5 py-2.5 text-sm', outOfVotes ? 'bg-marigold-50 text-marigold-800' : 'bg-ink-50 text-ink-700')} aria-live="polite">
            {capReached
              ? `You’ve given ${contestant?.name ?? 'this contestant'} the most free votes allowed${allowance.contestant_cap_period === 'day' ? ' today (it resets at midnight, Nepal time)' : allowance.contestant_cap_period === 'round' ? ' in this round' : ''}. You can still vote for others.`
              : outOfVotes
              ? allowance.resets_daily
                ? 'You’ve used today’s free votes. They reset at midnight, Nepal time.'
                : 'You’ve used all your votes in this contest.'
              : allowance.free_remaining === null
                ? 'You can vote as often as you like while voting is open.'
                : `${allowance.free_remaining} free ${allowance.free_remaining === 1 ? 'vote' : 'votes'} left${allowance.resets_daily ? ' today' : ''}${allowance.credits ? `, plus ${allowance.credits} from vote packs` : ''}.`}
          </p>
        )}

        {/* Robot check for the vote itself (OTP voters already passed one to get the code, but each request needs a fresh token) */}
        {siteKey && !needsIdentity && <Turnstile siteKey={siteKey} onToken={setCaptcha} resetKey={captchaReset} />}

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
