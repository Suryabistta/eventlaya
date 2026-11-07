import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Mail } from 'lucide-react'
import { ApiError } from '@/services/api'
import { useCities } from '@/lib/cities'
import { Button, Input, Modal, Select, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { platformApi, type NewOrganization } from './api'
import { Switch } from './shared'

/** Read-only value with a copy button: a temporary password or a set-password link, shown once. */
const CopyValue: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => {
  const toast = useToast()
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-ink-800">{label}</p>
      <div className="flex items-center gap-2 rounded-[10px] border border-ink-200 bg-ink-50 p-2 pl-3">
        <span className={cn('min-w-0 flex-1 break-all text-sm text-ink-900', mono && 'font-mono text-base tracking-wide')}>{value}</span>
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy className="h-3.5 w-3.5" />}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => toast.success('Copied'))
          }}
        >
          Copy
        </Button>
      </div>
    </div>
  )
}

const LinkFallback: React.FC<{ link: string }> = ({ link }) => (
  <div className="space-y-3">
    <p className="text-sm text-ink-700">
      The email couldn’t be sent. Share this link with them directly (WhatsApp, SMS). It works once and expires in 3 days.
    </p>
    <CopyValue label="Set-password link" value={link} />
  </div>
)

const EMPTY: NewOrganization = { organization_name: '', email: '', role: 'organizer', phone: '', city: '', is_verified: false }

/** Superadmin → Organizations → Add organization. The organization sets its own password from the welcome email. */
export const AddOrganizationModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const cities = useCities()
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof NewOrganization, string>>>({})
  const [fallback, setFallback] = useState<{ id: string; link: string } | null>(null)
  const set = <K extends keyof NewOrganization>(k: K, v: NewOrganization[K]) => setForm((f) => ({ ...f, [k]: v }))

  const close = () => {
    setForm(EMPTY)
    setErrors({})
    setFallback(null)
    onClose()
  }

  const create = useMutation({
    mutationFn: () => platformApi.createOrganization({ ...form, organization_name: form.organization_name.trim(), email: form.email.trim() }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['platform', 'organizations'] })
      if (res.set_password_link) {
        setFallback({ id: res.id, link: res.set_password_link })
        return
      }
      toast.success(`${res.name} added`, `Welcome email sent to ${res.email}`)
      close()
      navigate(`/admin/organizations/${res.id}`)
    },
    onError: (err: Error) => {
      const data = err instanceof ApiError ? (err.data as Record<string, string[] | undefined>) : {}
      const fieldErrors = { organization_name: data?.organization_name?.[0], email: data?.email?.[0], role: data?.role?.[0] }
      setErrors(fieldErrors)
      if (!Object.values(fieldErrors).some(Boolean)) toast.error('Couldn’t add the organization', err.message)
    },
  })

  if (fallback)
    return (
      <Modal
        open={open}
        onClose={close}
        title="Organization added"
        footer={
          <Button
            onClick={() => {
              const id = fallback.id
              close()
              navigate(`/admin/organizations/${id}`)
            }}
          >
            Open organization
          </Button>
        }
      >
        <LinkFallback link={fallback.link} />
      </Modal>
    )

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add organization"
      description="They get an email with a link to set their password. Starts on the Free plan."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="add-org-form" loading={create.isPending}>
            Add and send email
          </Button>
        </>
      }
    >
      <form
        id="add-org-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const errs: typeof errors = {}
          if (!form.organization_name.trim()) errs.organization_name = 'Enter the organization name.'
          if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email address.'
          setErrors(errs)
          if (!Object.keys(errs).length) create.mutate()
        }}
      >
        <Input label="Organization name" required autoFocus value={form.organization_name} error={errors.organization_name} onChange={(e) => set('organization_name', e.target.value)} />
        <Input label="Email" type="email" required value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} hint="They sign in with this" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" value={form.role} error={errors.role} onChange={(e) => set('role', e.target.value as NewOrganization['role'])}>
            <option value="organizer">Event company</option>
            <option value="vendor">Vendor / venue</option>
          </Select>
          <Select label="City" value={form.city} onChange={(e) => set('city', e.target.value)}>
            <option value="">Not set</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <Input label="Phone" type="tel" hint="Optional" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        <label className="flex items-center justify-between gap-4 rounded-[10px] border border-ink-200 p-3">
          <span className="text-sm">
            <span className="block font-medium text-ink-900">Verified</span>
            <span className="text-ink-500">Shows the blue tick next to their name</span>
          </span>
          <Switch checked={!!form.is_verified} label="Verified" onChange={(v) => set('is_verified', v)} />
        </label>
      </form>
    </Modal>
  )
}

type Result = { kind: 'temporary'; password: string } | { kind: 'email'; link?: string; email: string }

/** Superadmin → organization → Reset password. Both options sign the organization out everywhere. */
export const ResetPasswordModal: React.FC<{ open: boolean; onClose: () => void; org: { id: string; name: string; email: string } }> = ({
  open,
  onClose,
  org,
}) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'email' | 'temporary'>('email')
  const [result, setResult] = useState<Result | null>(null)

  const close = () => {
    setMode('email')
    setResult(null)
    onClose()
  }

  const reset = useMutation({
    mutationFn: () => platformApi.resetPassword(org.id, mode),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['platform', 'organization', org.id] })
      if (res.temporary_password) setResult({ kind: 'temporary', password: res.temporary_password })
      else if (res.set_password_link) setResult({ kind: 'email', link: res.set_password_link, email: org.email })
      else {
        toast.success('Reset link sent', `${org.name} was signed out and can choose a new password from the email.`)
        close()
      }
    },
    onError: (err: Error) => toast.error('Couldn’t reset the password', err.message),
  })

  if (result)
    return (
      <Modal open={open} onClose={close} title="Password reset" footer={<Button onClick={close}>Done</Button>}>
        {result.kind === 'temporary' ? (
          <div className="space-y-3">
            <CopyValue label="Temporary password" value={result.password} mono />
            <p className="text-sm text-ink-700">
              Give this to {org.name} privately. It’s shown only once. They’ll be asked to choose their own password when they sign in.
            </p>
          </div>
        ) : (
          <LinkFallback link={result.link!} />
        )}
      </Modal>
    )

  const option = (value: typeof mode, icon: React.ReactNode, title: string, text: string) => (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-[10px] border p-3 transition-colors',
        mode === value ? 'border-brand-500 bg-brand-50/50' : 'border-ink-200 hover:border-ink-300',
      )}
    >
      <input type="radio" name="reset-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-brand-600" />
      <span className="text-sm">
        <span className="flex items-center gap-1.5 font-medium text-ink-900">
          {icon}
          {title}
        </span>
        <span className="text-ink-600">{text}</span>
      </span>
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Reset password for ${org.name}?`}
      description="They’ll be signed out on every device. Their current password stops working."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button loading={reset.isPending} onClick={() => reset.mutate()}>
            Reset password
          </Button>
        </>
      }
    >
      <fieldset className="space-y-3">
        <legend className="sr-only">How should they get a new password?</legend>
        {option('email', <Mail className="h-4 w-4 text-ink-500" aria-hidden />, 'Email a reset link', `Sent to ${org.email}. They choose the new password.`)}
        {option(
          'temporary',
          <KeyRound className="h-4 w-4 text-ink-500" aria-hidden />,
          'Set a temporary password',
          'You see it once and pass it on. They must change it at their next sign-in.',
        )}
      </fieldset>
    </Modal>
  )
}
