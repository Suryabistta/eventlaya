import React, { useEffect, useState } from 'react'
import { track } from '@/lib/analytics'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Phone } from 'lucide-react'
import { isApiError, request, type ServicePackage, type Vendor } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { personName } from '@/lib/account'
import { apiErrorText, fmtDay, slotTime, slotsApi, type PublicSlot } from '@/lib/availability'
import { BookingSlotBox } from '@/components/BookingSlot'
import { Button, Card, Input, Select, Textarea, buttonClass, useToast } from '@/components/ui'
import { availabilityKey } from './AvailabilitySection'
import { useCalendarSystem } from '@/lib/calendar'
import { formatRs } from './shared'

const EVENT_TYPES = ['Wedding or reception', 'Conference or seminar', 'College fest', 'Concert or show', 'Sports event', 'Other']
const BUDGETS = ['Under Rs 25,000', 'Rs 25,000 – 50,000', 'Rs 50,000 – 1,00,000', 'Over Rs 1,00,000']

const today = () => new Date().toISOString().split('T')[0]

interface VendorInquiryInput {
  sender_name: string
  sender_email: string
  sender_phone: string
  event_type: string
  event_date: string | null
  budget_range: string
  message: string
  package?: string | null
}

const sendVendorInquiry = (vendorId: string, body: VendorInquiryInput) =>
  request<VendorInquiryInput & { id: string }>(`/marketplace/vendors/${vendorId}/inquiries/`, { method: 'POST', body: JSON.stringify(body) })

/** Quote request to a vendor (POST /api/marketplace/vendors/<id>/inquiries/). Signed-in senders see it under My inquiries. */
export const VendorQuoteForm: React.FC<{
  vendor: Vendor
  id: string
  /** An availability slot picked on the page: the request is for that slot (the date comes from it). */
  slot?: PublicSlot | null
  onClearSlot?: () => void
  /** A package picked on the page: sent with the request so the vendor knows what it's about */
  pkg?: ServicePackage | null
  onClearPackage?: () => void
}> = ({ vendor, id, slot = null, onClearSlot, pkg = null, onClearPackage }) => {
  const toast = useToast()
  useCalendarSystem() // slot dates follow the viewer's BS / AD choice
  const qc = useQueryClient()
  const { user } = useAuth()
  const [sent, setSent] = useState(false)
  const [sentSlot, setSentSlot] = useState<PublicSlot | null>(null)
  const [sending, setSending] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', eventType: EVENT_TYPES[0], date: '', budget: '', message: '' })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  // Prefill from the signed-in account without overwriting what was typed.
  useEffect(() => {
    if (!user) return
    setForm((f) => ({
      ...f,
      name: f.name || personName(user),
      email: f.email || user.email || '',
      phone: f.phone || user.phone || '',
    }))
  }, [user])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    // The owner paused the listing meanwhile: say so and reload the page into its paused state.
    const showPaused = (err: unknown) => {
      toast.error('Not taking requests right now', apiErrorText(err))
      void qc.invalidateQueries({ queryKey: ['vendor', vendor.id] })
    }
    if (slot) {
      try {
        await slotsApi.requestSlot('vendor', vendor.id, {
          slot_id: slot.id,
          sender_name: form.name.trim(),
          sender_email: form.email.trim(),
          sender_phone: form.phone.trim(),
          event_type: form.eventType,
          budget_range: form.budget,
          message: form.message.trim(),
          package: pkg?.id ?? null,
        })
        setSentSlot(slot)
        setSent(true)
        track('generate_lead', { lead_type: 'vendor_booking', item_id: vendor.id })
        void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
        void qc.invalidateQueries({ queryKey: ['reviews', 'vendor', vendor.id] })
        toast.success('Request sent', `${vendor.business_name} is holding ${fmtDay(slot.date)} for you until they reply.`)
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch (err) {
        if (isApiError(err, 'listing_paused')) {
          showPaused(err)
        } else if (isApiError(err, 'slot_unavailable')) {
          toast.error('Someone just requested that slot', 'Pick another one. The list is up to date now.')
          onClearSlot?.()
          document.getElementById('availability')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else if (isApiError(err) && err.data && typeof err.data === 'object' && 'slot_id' in err.data) {
          toast.error('That slot can’t be requested', apiErrorText(err))
          onClearSlot?.()
        } else {
          toast.error('Couldn’t send your request', apiErrorText(err, 'Check your details and try again.'))
        }
      } finally {
        void qc.invalidateQueries({ queryKey: availabilityKey('vendor', vendor.id) })
        setSending(false)
      }
      return
    }
    try {
      await sendVendorInquiry(vendor.id, {
        sender_name: form.name.trim(),
        sender_email: form.email.trim(),
        sender_phone: form.phone.trim(),
        event_type: form.eventType,
        event_date: form.date || null,
        budget_range: form.budget,
        message: form.message.trim(),
        package: pkg?.id ?? null,
      })
      setSentSlot(null)
      setSent(true)
      track('generate_lead', { lead_type: 'vendor_inquiry', item_id: vendor.id })
      void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
      void qc.invalidateQueries({ queryKey: ['reviews', 'vendor', vendor.id] })
      toast.success('Request sent', `${vendor.business_name} will reply to ${form.email.trim()}.`)
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (err) {
      if (isApiError(err, 'listing_paused')) return showPaused(err)
      toast.error('Couldn’t send your request', err instanceof Error ? err.message : 'Check your details and try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <Card id={id} className="scroll-mt-24 p-5 sm:p-6" role="status">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-ink-900">{sentSlot ? 'Slot requested' : 'Request sent'}</h2>
        <p className="mt-1 text-sm text-ink-600">
          {sentSlot ? (
            <>
              {vendor.business_name} has your request for <span className="font-medium text-ink-900">{fmtDay(sentSlot.date, true)}</span>,{' '}
              {slotTime(sentSlot).toLowerCase()}. The slot is held for you until they confirm or decline, and you get an email either way.
            </>
          ) : (
            <>
              {vendor.business_name} has your request{form.date ? ` for ${new Date(`${form.date}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}. They usually reply by phone or email with a price.
            </>
          )}
        </p>
        {user && <p className="mt-2 text-sm text-ink-600">You can follow it in My inquiries.</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {vendor.phone && (
            <a href={`tel:${vendor.phone}`} className={buttonClass('secondary', 'sm')}>
              <Phone className="h-4 w-4" aria-hidden />
              Call {vendor.phone}
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSent(false)
              setSentSlot(null)
              set('message', '')
              onClearSlot?.()
            }}
          >
            Send another request
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card id={id} className="scroll-mt-24">
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="text-base font-bold text-ink-900">{slot ? 'Request this slot' : 'Request a quote'}</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          {slot ? `Free to ask. The slot is held for you until ${vendor.business_name} confirms.` : `Free to ask. ${vendor.business_name} replies directly to you.`}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4 p-5">
        {pkg && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm">
            <div className="min-w-0">
              <p className="text-xs font-medium text-brand-700">Package</p>
              <p className="font-semibold text-ink-900">
                {pkg.name} · {formatRs(pkg.price)} {pkg.price_unit_display}
              </p>
            </div>
            {onClearPackage && (
              <button type="button" onClick={onClearPackage} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline">
                Remove
              </button>
            )}
          </div>
        )}
        {slot && (
          <BookingSlotBox slot={slot} label="Your slot">
            {onClearSlot && (
              <button type="button" onClick={onClearSlot} className="mt-1 text-xs font-semibold text-brand-700 hover:underline">
                Change slot or ask without one
              </button>
            )}
          </BookingSlotBox>
        )}
        <Select label="Type of event" value={form.eventType} onChange={(e) => set('eventType', e.target.value)}>
          {EVENT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <div className={slot ? '' : 'grid grid-cols-2 gap-3'}>
          {!slot && <Input label="Event date" type="date" min={today()} value={form.date} onChange={(e) => set('date', e.target.value)} hint="Optional" />}
          <Select label="Budget" value={form.budget} onChange={(e) => set('budget', e.target.value)}>
            <option value="">Not sure yet</option>
            {BUDGETS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        </div>
        <Textarea
          label="What do you need?"
          required
          rows={4}
          value={form.message}
          onChange={(e) => set('message', e.target.value)}
          placeholder="Two-day college fest. Need sound, stage lights and live coverage with three cameras."
        />
        <div className="space-y-4 border-t border-ink-100 pt-4">
          <Input label="Your name or organization" required autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Koshi Tech Festival" />
          <Input label="Email" type="email" required autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" />
          <Input label="Phone" type="tel" required autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98XXXXXXXX" />
        </div>
        <Button type="submit" loading={sending} className="w-full">
          {slot ? 'Request this slot' : 'Send request'}
        </Button>
        {vendor.phone && (
          <a href={`tel:${vendor.phone}`} className={buttonClass('secondary', 'md', 'w-full')}>
            <Phone className="h-4 w-4" aria-hidden />
            Call {vendor.phone}
          </a>
        )}
      </form>
    </Card>
  )
}
