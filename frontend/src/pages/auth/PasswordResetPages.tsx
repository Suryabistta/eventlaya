import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { MailCheck, KeyRound, LinkIcon } from 'lucide-react'
import { api } from '@/services/api'
import { Button, Input, Skeleton, useToast } from '@/components/ui'
import { AuthShell, PasswordInput, PasswordStrength, passwordChecks } from './shared'

const backToSignIn = (
  <>
    Remembered it?{' '}
    <Link to="/login" className="font-semibold text-brand-700 hover:underline">
      Back to sign in
    </Link>
  </>
)

/** Step 1: ask for the email and send a reset link. */
export const ForgotPasswordPage: React.FC = () => {
  const toast = useToast()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter the email you sign in with.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await api.requestPasswordReset(email.trim())
      setSentTo(email.trim())
      toast.success('Check your email', 'If an account exists, a reset link is on its way.')
    } catch (err) {
      const msg = (err as Error).message
      toast.error('Couldn’t send the reset link', /429|throttled/i.test(msg) ? 'Too many attempts. Try again in an hour.' : msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle={backToSignIn}>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
          <MailCheck className="h-7 w-7 text-emerald-700" aria-hidden />
          <p className="mt-3 text-ink-800">
            If an account exists for <span className="font-semibold">{sentTo}</span>, we’ve sent a link to reset its password.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-600">
            <li>The link works once and expires in 3 days.</li>
            <li>Can’t find it? Check spam or promotions.</li>
          </ul>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
          <Button variant="ghost" loading={submitting} onClick={(e) => submit(e as unknown as React.FormEvent)}>
            Send it again
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password" subtitle={backToSignIn}>
      <p className="-mt-4 mb-6 text-sm text-ink-600">Enter the email you sign in with and we’ll send you a link to choose a new password.</p>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Input
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus
          className="h-11"
          value={email}
          error={error || undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  )
}

/** Step 2: the link from the email lands here to set the new password. */
export const ResetPasswordPage: React.FC = () => {
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const uid = params.get('uid') ?? ''
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const link = useQuery({
    queryKey: ['password-reset-link', uid, token],
    queryFn: () => api.checkPasswordResetLink(uid, token),
    enabled: Boolean(uid && token),
    retry: false,
  })

  if (!uid || !token || link.isError) {
    return (
      <AuthShell title="This link has expired" subtitle={backToSignIn}>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <LinkIcon className="h-7 w-7 text-red-600" aria-hidden />
          <p className="mt-3 text-ink-800">Reset links work once and expire after 3 days. Ask for a new one and use the latest email.</p>
        </div>
        <Link to="/forgot-password" className="mt-6 inline-flex">
          <Button size="lg">Send a new link</Button>
        </Link>
      </AuthShell>
    )
  }

  if (link.isLoading) {
    return (
      <AuthShell title="Choose a new password" subtitle={backToSignIn}>
        <div className="space-y-4">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-12" />
        </div>
      </AuthShell>
    )
  }

  const strong = passwordChecks(password).every((c) => c.ok)
  const errors = {
    password: !password ? 'Enter a new password.' : password.length < 8 ? 'Use at least 8 characters.' : '',
    confirm: confirm !== password ? 'The passwords don’t match.' : '',
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (errors.password || errors.confirm) {
      toast.error('Check the highlighted fields')
      return
    }
    setServerError('')
    setSubmitting(true)
    try {
      await api.confirmPasswordReset(uid, token, password)
      toast.success('Password changed', 'Sign in with your new password.')
      navigate(`/login?email=${encodeURIComponent(link.data?.email ?? '')}`, { replace: true })
    } catch (err) {
      const msg = (err as Error).message
      setServerError(msg)
      toast.error('Couldn’t change the password', msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle={<>For {link.data?.email}</>}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            error={touched ? errors.password || undefined : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password && <PasswordStrength password={password} />}
        </div>
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          required
          value={confirm}
          error={touched || confirm.length >= password.length ? errors.confirm || undefined : undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {serverError && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {serverError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={submitting} icon={<KeyRound className="h-4 w-4" aria-hidden />}>
          Save new password
        </Button>
        {!strong && password.length >= 8 && (
          <p className="text-center text-xs text-ink-500">Tip: a longer password with numbers and mixed case is harder to guess.</p>
        )}
      </form>
    </AuthShell>
  )
}
