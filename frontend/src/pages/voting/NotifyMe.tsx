/** "Notify me" on an upcoming contest: a phone number or email gets one message when voting opens. */
import React, { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bell, CheckCircle2 } from 'lucide-react'
import { Button, Input, Modal } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { contestApi } from './contest/api'

export const NotifyMeModal: React.FC<{ open: boolean; onClose: () => void; slug: string; contestRef: string; title: string }> = ({ open, onClose, slug, contestRef, title }) => {
  const { user } = useAuth()
  const [value, setValue] = useState(() => user?.phone || user?.email || '')
  const save = useMutation({ mutationFn: () => contestApi.remind(slug, contestRef, value.trim()) })
  const done = save.isSuccess
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={done ? 'We’ll let you know' : 'Get a message when voting opens'}
      description={done ? undefined : title}
      footer={done ? <Button onClick={onClose}>Done</Button> : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon={<Bell className="h-4 w-4" />} loading={save.isPending} disabled={!value.trim()} onClick={() => save.mutate()}>Notify me</Button>
        </>
      )}
    >
      {done ? (
        <p className="flex items-start gap-2 text-ink-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          You’ll get one {save.data?.channel === 'sms' ? 'SMS' : 'email'} when voting opens. We don’t keep your contact after that.
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) save.mutate() }} className="space-y-2">
          <Input
            label="Mobile number or email"
            autoFocus
            inputMode="email"
            placeholder="98XXXXXXXX or you@example.com"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={save.error?.message}
          />
          <p className="text-xs text-ink-500">Only used for this one message.</p>
        </form>
      )}
    </Modal>
  )
}
