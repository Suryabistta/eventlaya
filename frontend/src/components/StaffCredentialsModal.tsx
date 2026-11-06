import React, { useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Button, Modal, useToast } from '@/components/ui'

export interface StaffCredentials {
  email: string
  password: string
  /** Who they are, used in the title, e.g. "Aayush Shrestha". Falls back to the email. */
  name?: string
  /** 'created' for a new account, 'reset' after a password reset. */
  reason?: 'created' | 'reset'
}

/** Shows a staff member's sign-in details once, with a copy button. */
export const StaffCredentialsModal: React.FC<{ credentials: StaffCredentials | null; onClose: () => void }> = ({ credentials, onClose }) => {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const close = () => {
    setCopied(false)
    onClose()
  }

  const copy = async () => {
    if (!credentials) return
    try {
      await navigator.clipboard.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`)
      setCopied(true)
      toast.success('Sign-in details copied')
    } catch {
      toast.error('Couldn’t copy', 'Select the password and copy it by hand.')
    }
  }

  const who = credentials?.name || credentials?.email
  return (
    <Modal
      open={Boolean(credentials)}
      onClose={close}
      size="sm"
      title={credentials?.reason === 'reset' ? `New password for ${who}` : `${who} can sign in now`}
      description="Share these details with them privately."
      footer={
        <>
          <Button variant="secondary" onClick={copy} icon={copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
          <Button onClick={close}>Done</Button>
        </>
      }
    >
      {credentials && (
        <div className="space-y-4">
          <dl className="space-y-3 rounded-xl border border-ink-200 bg-ink-50 p-4">
            <div>
              <dt className="text-xs font-medium text-ink-500">Email</dt>
              <dd className="mt-0.5 break-all text-sm font-medium text-ink-900">{credentials.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-500">Temporary password</dt>
              <dd className="mt-0.5 select-all break-all font-mono text-base font-semibold tracking-wide text-ink-900">{credentials.password}</dd>
            </div>
          </dl>
          <p className="flex gap-2 text-sm text-ink-600">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-marigold-600" aria-hidden />
            <span>
              This password is only shown once. They sign in with it in the Eventlaya Scanner app or the web scanner. If it gets lost, reset it from the Team page.
            </span>
          </p>
        </div>
      )}
    </Modal>
  )
}
