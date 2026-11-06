import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Mail, MailCheck, Ticket } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { accountApi } from '@/lib/account'
import { ApiError } from '@/services/api'
import { Button, ButtonLink, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { AuthShell, FeatureList } from '../auth/shared'

/** Only same-app paths are allowed as the place to go afterwards. */
const safeNext = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/app')

/** Seconds left until `until` (epoch ms), ticking every second. */
function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/**
 * The 6-digit email code: ask for a code (or use the one sent at sign-up), type it, done.
 * Used on /verify-email and inside the profile page.
 */
export const VerifyEmailForm: React.FC<{
  /** The server already sent a code (straight after sign-up), so start on the code input. */
  codeAlreadySent?: boolean
  onVerified: (linked: number) => void
}> = ({ codeAlreadySent, onVerified }) => {
  const { user, updateUser } = useAuth()
  const toast = useToast()
  const [sent, setSent] = useState(Boolean(codeAlreadySent))
  const [resendAt, setResendAt] = useState(() => (codeAlreadySent ? Date.now() + 60_000 : 0))
  const wait = useCountdown(resendAt)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (sent) inputRef.current?.focus()
  }, [sent])

  const send = async () => {
    setSending(true)
    setError('')
    try {
      const res = await accountApi.sendCode()
      setSent(true)
      setCode('')
      setResendAt(Date.now() + Math.max(res.resend_available_in || 60, 1) * 1000)
      toast.success('Code sent', res.message)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_verified' && user) {
        updateUser({ ...user, email_verified: true })
        onVerified(0)
        return
      }
      if (e instanceof ApiError && e.status === 429) {
        const retry = Number((e.data as { retry_after?: number })?.retry_after) || 60
        setResendAt(Date.now() + retry * 1000)
        setSent(true)
      }
      setError(e instanceof Error ? e.message : 'Couldn’t send the code. Try again.')
    } finally {
      setSending(false)
    }
  }

  const verify = async (value = code) => {
    if (value.length !== 6 || verifying) return
    setVerifying(true)
    setError('')
    try {
      const res = await accountApi.verify(value)
      updateUser(res.user)
      onVerified(res.linked_tickets)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code didn’t work. Try again.')
      if (e instanceof ApiError && (e.code === 'code_expired' || e.code === 'too_many_attempts')) setCode('')
      inputRef.current?.select()
    } finally {
      setVerifying(false)
    }
  }

  if (!sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          We’ll email a 6-digit code to <span className="font-semibold text-ink-900">{user?.email}</span>.
        </p>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button size="lg" className="w-full" loading={sending} onClick={send} icon={<Mail className="h-4 w-4" aria-hidden />}>
          Email me a code
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void verify()
      }}
      className="space-y-4"
      noValidate
    >
      <p className="text-sm text-ink-600">
        Enter the code we sent to <span className="font-semibold text-ink-900">{user?.email}</span>. It expires after 15 minutes.
      </p>
      <div>
        <label htmlFor="verify-code" className="block text-sm font-medium text-ink-800">
          6-digit code
        </label>
        <input
          ref={inputRef}
          id="verify-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'verify-error' : undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(v)
            if (error) setError('')
            if (v.length === 6) void verify(v)
          }}
          className={cn(
            'mt-1.5 block h-14 w-full rounded-xl border bg-white text-center font-mono text-2xl font-semibold tracking-[0.5em] text-ink-900 shadow-2xs placeholder:text-ink-300 focus:outline-none focus:ring-2',
            error ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20' : 'border-ink-200 focus:border-brand-500 focus:ring-brand-500/20',
          )}
          placeholder="••••••"
        />
        {error && (
          <p id="verify-error" role="alert" className="mt-1.5 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full" loading={verifying} disabled={code.length !== 6}>
        Verify email
      </Button>
      <p className="text-center text-sm text-ink-600" aria-live="polite">
        Didn’t get it? Check spam, or{' '}
        {wait > 0 ? (
          <span className="text-ink-500 tabular">send a new code in {wait}s</span>
        ) : (
          <button type="button" onClick={send} disabled={sending} className="font-semibold text-brand-700 hover:underline disabled:opacity-50">
            {sending ? 'sending…' : 'send a new code'}
          </button>
        )}
        .
      </p>
    </form>
  )
}

export const VerifyEmailPage: React.FC = () => {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const [linked, setLinked] = useState<number | null>(user?.email_verified ? 0 : null)
  // Straight after sign-up the server has already emailed a code.
  const fresh = params.get('sent') === '1'

  return (
    <AuthShell
      title={linked !== null ? 'Email verified' : 'Verify your email'}
      subtitle={linked !== null ? 'Your account is all set.' : 'One quick step so your passes and reviews stay with you.'}
      aside={
        <>
          <h2 className="font-display text-[34px] font-bold leading-[1.1] text-ink-900">Why we ask</h2>
          <FeatureList
            items={[
              { icon: Ticket, text: 'Passes you registered with this email join your account' },
              { icon: MailCheck, text: 'Only you can sign in with this address' },
            ]}
          />
        </>
      }
    >
      {linked !== null ? (
        <div className="space-y-5" role="status">
          <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="font-semibold text-emerald-900">{user?.email} is confirmed</p>
              <p className="mt-0.5 text-sm text-emerald-800">
                {linked > 0
                  ? `${linked} pass${linked === 1 ? '' : 'es'} linked to your account.`
                  : 'Passes you register for with this email will show up in My tickets.'}
              </p>
            </div>
          </div>
          <Button size="lg" className="w-full" onClick={() => navigate(next, { replace: true })}>
            Continue
          </Button>
          {linked > 0 && next !== '/app/my/tickets' && (
            <ButtonLink to="/app/my/tickets" variant="secondary" size="lg" className="w-full">
              See my tickets
            </ButtonLink>
          )}
        </div>
      ) : (
        <>
          <VerifyEmailForm codeAlreadySent={fresh} onVerified={setLinked} />
          <p className="mt-8 text-center text-sm">
            <Link to={next} replace className="font-medium text-ink-500 hover:text-ink-900">
              Skip for now
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}

export default VerifyEmailPage
