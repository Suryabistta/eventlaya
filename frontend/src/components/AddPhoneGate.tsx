/** Every account needs a mobile number. People who signed in with Google / Facebook (no phone from them) or older
 *  accounts without one see this once, add their number, and carry on where they were. */
import React, { useState } from 'react'
import { Smartphone } from 'lucide-react'
import { accountApi } from '@/lib/account'
import { useAuth } from '@/lib/auth'
import { Button, Input } from '@/components/ui'

export const AddPhoneGate: React.FC = () => {
  const { user, updateUser, logout } = useAuth()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  if (!user) return null
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const digits = phone.replace(/\D/g, '').length
    if (digits < 7 || digits > 15) {
      setError('Enter a valid mobile number, like 98XXXXXXXX.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      updateUser(await accountApi.updateProfile({ phone: phone.trim() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="add-phone-title">
      <form onSubmit={save} noValidate className="w-full max-w-sm space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600" aria-hidden>
          <Smartphone className="h-6 w-6" />
        </span>
        <div>
          <h2 id="add-phone-title" className="text-xl font-bold text-ink-900">Add your mobile number</h2>
          <p className="mt-1 text-sm text-ink-600">Every Eventlaya account needs one, so organizers and vendors can reach you. It isn’t shown publicly.</p>
        </div>
        <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" autoFocus required placeholder="98XXXXXXXX" value={phone} error={error} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy}>Save and continue</Button>
        <button type="button" onClick={logout} className="block w-full text-center text-sm font-medium text-ink-500 hover:text-ink-800">Sign out</button>
      </form>
    </div>
  )
}
