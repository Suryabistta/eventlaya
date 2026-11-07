import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, BadgeCheck, KeyRound, MailWarning, Trash2, UserRound } from 'lucide-react'
import { ApiError } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { accountApi, mediaUrl } from '@/lib/account'
import { Badge, Button, Card, CardHeader, ImageUpload, Input, Modal, PageHeader, useToast } from '@/components/ui'
import { PasswordInput, PasswordStrength } from '../auth/shared'
import { ACCOUNT_PAGE } from './MyTicketsPage'
import { LEGAL_PATHS } from '@/lib/legal'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', facebook: 'Facebook' }

export const ProfilePage: React.FC = () => {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className={ACCOUNT_PAGE}>
      <PageHeader title="Profile" description="Your details, sign-in and account settings." />
      {user.must_change_password && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-marigold-200 bg-marigold-50 p-4 text-sm text-ink-800">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-marigold-700" aria-hidden />
          <p>
            <span className="font-semibold">Choose your own password to continue.</span> You signed in with a temporary password from
            Eventlaya. Enter it as your current password below.
          </p>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DetailsCard />
        <div className="space-y-6">
          <SignInCard />
          <PasswordCard />
          <DeleteCard />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const DetailsCard: React.FC = () => {
  const { user, updateUser } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', city: '', organization_name: '' })
  const [avatar, setAvatar] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!user) return
    setForm({
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      phone: user.phone ?? '',
      city: user.city ?? '',
      organization_name: user.organization_name ?? '',
    })
    setAvatar(mediaUrl(user.avatar))
  }, [user])

  if (!user) return null
  const showOrg = user.role !== 'attendee'
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      const avatarChanged = avatar !== mediaUrl(user.avatar)
      const saved = await accountApi.updateProfile({
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        city: form.city,
        ...(showOrg ? { organization_name: form.organization_name } : {}),
        ...(avatarChanged ? { avatar_url: avatar ?? '' } : {}),
      })
      updateUser(saved)
      toast.success('Profile saved')
    } catch (err) {
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
        const fieldErrors: Record<string, string> = {}
        Object.entries(err.data as Record<string, unknown>).forEach(([k, v]) => {
          if (Array.isArray(v) && typeof v[0] === 'string') fieldErrors[k] = v[0]
        })
        setErrors(fieldErrors)
      }
      toast.error('Couldn’t save your profile', errText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Your details" description="Used to fill in event registrations and inquiries for you." />
      <form onSubmit={save} className="space-y-5 p-5" noValidate>
        <ImageUpload
          label={user.role === 'organizer' || user.role === 'vendor' ? 'Logo' : 'Photo'}
          kind="avatar"
          shape="square"
          value={avatar}
          onChange={setAvatar}
          hint="Shown in the top bar, chat and next to your name. Square images look best. Up to 5 MB."
        />
        {errors.avatar_url && <p className="text-xs font-medium text-red-600">{errors.avatar_url}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" autoComplete="given-name" value={form.first_name} error={errors.first_name} onChange={(e) => set('first_name', e.target.value)} />
          <Input label="Last name" autoComplete="family-name" value={form.last_name} error={errors.last_name} onChange={(e) => set('last_name', e.target.value)} />
        </div>
        {showOrg && (
          <Input
            label={user.role === 'vendor' ? 'Business name' : 'Organization'}
            autoComplete="organization"
            value={form.organization_name}
            error={errors.organization_name}
            onChange={(e) => set('organization_name', e.target.value)}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} />
          <Input label="City" autoComplete="address-level2" value={form.city} error={errors.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  )
}

const SignInCard: React.FC = () => {
  const { user } = useAuth()
  if (!user) return null
  const providers = user.social_providers ?? []
  return (
    <Card>
      <CardHeader title="Sign-in" />
      <dl className="divide-y divide-ink-100 px-5">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <div className="min-w-0">
            <dt className="text-sm text-ink-500">Email</dt>
            <dd className="break-all text-sm font-medium text-ink-900">{user.email}</dd>
          </div>
          {user.email_verified ? (
            <Badge tone="success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
              Verified
            </Badge>
          ) : (
            <Link to="/verify-email?next=/app/profile" className="inline-flex items-center gap-1.5 rounded-full bg-marigold-50 px-2.5 py-1 text-xs font-semibold text-marigold-800 hover:bg-marigold-100">
              <MailWarning className="h-3.5 w-3.5" aria-hidden />
              Verify email
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <div>
            <dt className="text-sm text-ink-500">Connected accounts</dt>
            <dd className="text-sm font-medium text-ink-900">{providers.length ? providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ') : 'None'}</dd>
          </div>
        </div>
      </dl>
    </Card>
  )
}

const PasswordCard: React.FC = () => {
  const { user, updateUser } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({})
  const [saving, setSaving] = useState(false)
  if (!user) return null
  const hasPassword = user.has_password !== false

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (hasPassword && !current) errs.current = 'Enter your current password.'
    if (next.length < 8) errs.next = 'Use at least 8 characters.'
    if (confirm !== next) errs.confirm = 'The passwords don’t match.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      const res = await accountApi.changePassword({ ...(hasPassword ? { current_password: current } : {}), new_password: next })
      updateUser({ ...user, has_password: true, must_change_password: false })
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success(res.message)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') setErrors({ current: err.message })
      else if (err instanceof ApiError && (err.data as { new_password?: string[] })?.new_password) setErrors({ next: (err.data as { new_password: string[] }).new_password.join(' ') })
      else toast.error('Couldn’t change your password', errText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={hasPassword ? 'Change password' : 'Set a password'}
        description={hasPassword ? undefined : 'You signed up with Google or Facebook. Add a password to also sign in with your email.'}
      />
      <form onSubmit={submit} className="space-y-4 p-5" noValidate>
        {hasPassword && <PasswordInput label="Current password" autoComplete="current-password" value={current} error={errors.current} onChange={(e) => setCurrent(e.target.value)} />}
        <div>
          <PasswordInput label="New password" autoComplete="new-password" value={next} error={errors.next} onChange={(e) => setNext(e.target.value)} />
          <PasswordStrength password={next} />
        </div>
        <PasswordInput label="Confirm new password" autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="flex justify-end">
          <Button type="submit" loading={saving} icon={<KeyRound className="h-4 w-4" aria-hidden />}>
            {hasPassword ? 'Change password' : 'Set password'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

const DeleteCard: React.FC = () => {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState('')
  const [deleting, setDeleting] = useState(false)
  if (!user) return null
  const hasPassword = user.has_password !== false

  const close = () => {
    setOpen(false)
    setPassword('')
    setConfirmed(false)
    setError('')
    setBlocked('')
  }

  const remove = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBlocked('')
    setDeleting(true)
    try {
      await accountApi.deleteAccount(hasPassword ? { password } : { confirm: true })
      close()
      // Leave the app first so the sign-in guard doesn't bounce to /login
      navigate('/', { replace: true })
      logout()
      toast.success('Your account was deleted', 'Thanks for using Eventlaya.')
    } catch (err) {
      // 409 (organizer with registrations, listings with inquiries, billing history) and 403 (admin):
      // the server explains what to do instead.
      if (err instanceof ApiError && (err.status === 409 || err.status === 403)) setBlocked(err.message)
      else setError(errText(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className="border-red-200">
      <CardHeader title="Delete account" description="Removes your account, profile and reviews. Passes you registered stay valid with the organizers." />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
        <Button variant="secondary" className="text-red-600 hover:border-red-300 hover:bg-red-50" onClick={() => setOpen(true)} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
          Delete my account
        </Button>
        <Link to={LEGAL_PATHS.deleteAccount} className="text-sm font-medium text-ink-600 underline underline-offset-2 hover:text-ink-900">
          What gets deleted
        </Link>
      </div>
      <Modal
        open={open}
        onClose={close}
        title="Delete your account?"
        description="This can’t be undone."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep my account
            </Button>
            <Button variant="danger" type="submit" form="delete-account" loading={deleting} disabled={hasPassword ? !password : !confirmed}>
              Delete account
            </Button>
          </>
        }
      >
        <form id="delete-account" onSubmit={remove} className="space-y-4" noValidate>
          {blocked && (
            <div role="alert" className="flex gap-2.5 rounded-xl bg-marigold-50 px-3.5 py-3 text-sm text-marigold-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{blocked}</p>
            </div>
          )}
          <ul className="space-y-1.5 text-sm text-ink-600">
            <li className="flex gap-2">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              Your profile, reviews and sign-in links are deleted.
            </li>
            <li className="flex gap-2">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
              Tickets and inquiries you sent stay with the organizers and businesses.
            </li>
          </ul>
          {hasPassword ? (
            <PasswordInput label="Enter your password to confirm" autoComplete="current-password" value={password} error={error} onChange={(e) => setPassword(e.target.value)} />
          ) : (
            <>
              <label className="flex items-start gap-2.5 text-sm text-ink-800">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-red-600" />
                I understand my account will be deleted permanently.
              </label>
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
            </>
          )}
        </form>
      </Modal>
    </Card>
  )
}

export default ProfilePage
