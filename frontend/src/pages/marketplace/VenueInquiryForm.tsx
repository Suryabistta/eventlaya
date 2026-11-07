import React, { useEffect, useState } from 'react'
import { track } from '@/lib/analytics'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Phone } from 'lucide-react'
import { isApiError, marketplaceApi, type ServicePackage, type VenueWithSpaces } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { apiErrorText, fmtDay, slotTime, slotsApi, type PublicSlot } from '@/lib/availability'
import { BookingSlotBox } from '@/components/BookingSlot'
import { Button, Card, Input, Select, Textarea, buttonClass, useToast } from '@/components/ui'
import { formatRs, spaceCapacity } from './shared'
import { availabilityKey } from './AvailabilitySection'
import { useCalendarSystem } from '@/lib/calendar'

const EVENT_TYPES = ['Wedding or reception', 'Conference or seminar', 'College fest', 'Concert or show', 'Sports event', 'Other']
const BUDGETS = ['Under Rs 25,000', 'Rs 25,000 – 50,000', 'Rs 50,000 – 1,00,000', 'Over Rs 1,00,000']

const today = () => new Date().toISOString().split('T')[0]

export const VenueInquiryForm: React.FC<{
  venue: VenueWithSpaces
  id: string
  spaceId: string
  onSpaceChange: (id: string) => void
  /** An availability slot picked on the page: the request is for that slot (date and space come from it). */
  slot?: PublicSlot | null
  onClearSlot?: () => void
  /** A package picked on the page: sent with the request so the venue knows what it's about */
  pkg?: ServicePackage | null
  onClearPackage?: () => void
}> = ({ venue, id, spaceId, onSpaceChange, slot = null, onClearSlot, pkg = null, onClearPackage }) => {
  const spaces = venue.spaces ?? []
  useCalendarSystem() // slot dates follow the viewer's BS / AD choice
  const space = spaces.find((s) => s.id === (slot ? slot.space : spaceId))
  const toast = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [sent, setSent] = useState(false)
  const [sentSlot, setSentSlot] = useState<PublicSlot | null>(null)
  const [sending, setSending] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    eventType: EVENT_TYPES[0],
    date: '',
    guests: Math.min(Math.max(250, venue.capacity_min), venue.capacity_max),
    budget: '',
    message: '',
  })

  // Prefill contact details from the signed-in account (don't overwrite what was typed).
  useEffect(() => {
    if (!user) return
    setForm((f) => ({
      ...f,
      name: f.name || user.organization_name || user.username || '',
      email: f.email || user.email || '',
      phone: f.phone || user.phone || '',
    }))
  }, [user])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    // The owner paused the listing meanwhile: say so and reload the page into its paused state.
    const showPaused = (err: unknown) => {
      toast.error('Not taking requests right now', apiErrorText(err))
      void qc.invalidateQueries({ queryKey: ['venue', venue.slug] })
    }
    if (slot) {
      try {
        await slotsApi.requestSlot('venue', venue.id, {
          slot_id: slot.id,
          sender_name: form.name.trim(),
          sender_email: form.email.trim(),
          sender_phone: form.phone.trim(),
          event_type: form.eventType,
          guest_count: form.guests,
          budget_range: form.budget,
          message: form.message.trim(),
          package: pkg?.id ?? null,
        })
        setSentSlot(slot)
        setSent(true)
        track('generate_lead', { lead_type: 'venue_booking', item_id: venue.slug })
        void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
        void qc.invalidateQueries({ queryKey: ['reviews', 'venue', venue.id] })
        toast.success('Request sent', `${slot.space_name ? `${slot.space_name}, ` : ''}${venue.name} is holding ${fmtDay(slot.date)} for you until they reply.`)
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
        void qc.invalidateQueries({ queryKey: availabilityKey('venue', venue.id) })
        setSending(false)
      }
      return
    }
    try {
      await marketplaceApi.sendInquiry(venue.id, {
        space: spaceId || null,
        sender_name: form.name.trim(),
        sender_email: form.email.trim(),
        sender_phone: form.phone.trim(),
        event_type: form.eventType,
        event_date: form.date,
        guest_count: form.guests,
        budget_range: form.budget,
        message: form.message.trim(),
        package: pkg?.id ?? null,
      })
      setSentSlot(null)
      setSent(true)
      track('generate_lead', { lead_type: 'venue_inquiry', item_id: venue.slug })
      // Signed-in senders: shows under My inquiries and makes them eligible to review the venue
      void qc.invalidateQueries({ queryKey: ['me-inquiries'] })
      void qc.invalidateQueries({ queryKey: ['reviews', 'venue', venue.id] })
      toast.success('Inquiry sent', `${space ? `${space.name}, ` : ''}${venue.name} will reply to ${form.email.trim()}.`)
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (err) {
      if (isApiError(err, 'listing_paused')) return showPaused(err)
      toast.error('Couldn’t send your inquiry', err instanceof Error ? err.message : 'Check your details and try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent && sentSlot) {
    return (
      <Card id={id} className="scroll-mt-24 p-5 sm:p-6" role="status">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-ink-900">Slot requested</h2>
        <p className="mt-1 text-sm text-ink-600">
          {venue.name} has your request for{sentSlot.space_name ? ` ${sentSlot.space_name} on` : ''}{' '}
          <span className="font-medium text-ink-900">{fmtDay(sentSlot.date, true)}</span>, {slotTime(sentSlot).toLowerCase()}, for{' '}
          {form.guests.toLocaleString()} guests.
        </p>
        <h3 className="mt-5 text-sm font-semibold text-ink-900">What happens next</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-600">
          <li>The slot is held for you, so nobody else can request it meanwhile.</li>
          <li>
            {venue.contact_person || 'The venue'} confirms or declines. You get an email at <span className="font-medium text-ink-900">{form.email}</span>.
          </li>
          {user && <li>Follow it, or cancel it, under My inquiries.</li>}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          {venue.contact_phone && (
            <a href={`tel:${venue.contact_phone}`} className={buttonClass('secondary', 'sm')}>
              <Phone className="h-4 w-4" aria-hidden />
              Call {venue.contact_phone}
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
            Request another slot
          </Button>
        </div>
      </Card>
    )
  }

  if (sent) {
    return (
      <Card id={id} className="scroll-mt-24 p-5 sm:p-6" role="status">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
        <h2 className="mt-3 text-lg font-bold text-ink-900">Inquiry sent</h2>
        <p className="mt-1 text-sm text-ink-600">
          {venue.name} has your request{space ? ` for ${space.name}` : ''} on{' '}
          <span className="font-medium text-ink-900">
            {new Date(`${form.date}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>{' '}
          for {form.guests.toLocaleString()} guests.
        </p>
        <h3 className="mt-5 text-sm font-semibold text-ink-900">What happens next</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-600">
          <li>
            {venue.contact_person || 'The venue'} checks availability for your date.
          </li>
          <li>
            They reply to <span className="font-medium text-ink-900">{form.email}</span> or call {form.phone} with a price.
          </li>
          <li>Your date is only held once the venue confirms the booking with you.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          {venue.contact_phone && (
            <a href={`tel:${venue.contact_phone}`} className={buttonClass('secondary', 'sm')}>
              <Phone className="h-4 w-4" aria-hidden />
              Call {venue.contact_phone}
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSent(false)
              set('message', '')
            }}
          >
            Send another inquiry
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card id={id} className="scroll-mt-24">
      <div className="border-b border-ink-100 px-5 py-4">
        <h2 className="text-base font-bold text-ink-900">{slot ? 'Request this slot' : 'Check availability'}</h2>
        <p className="mt-0.5 text-sm text-ink-500">
          {slot ? 'Free to ask. The slot is held for you until the venue confirms.' : 'Free to ask. The venue replies directly to you.'}
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
                Change slot or ask about another date
              </button>
            )}
          </BookingSlotBox>
        )}
        {!slot && spaces.length > 0 && (
          <Select
            label="Space"
            value={spaceId}
            onChange={(e) => onSpaceChange(e.target.value)}
            hint={space ? `${spaceCapacity(space)}, ${formatRs(space.price_per_day)} per day` : 'The venue suggests a space for your guest count'}
          >
            <option value="">Any space / not sure</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
        <Select label="Type of event" value={form.eventType} onChange={(e) => set('eventType', e.target.value)}>
          {EVENT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <div className={slot ? '' : 'grid grid-cols-2 gap-3'}>
          {!slot && <Input label="Event date" type="date" required min={today()} value={form.date} onChange={(e) => set('date', e.target.value)} />}
          <Input
            label="Guests"
            type="number"
            required
            min={1}
            value={form.guests}
            onChange={(e) => set('guests', Number(e.target.value))}
            hint={space ? `Up to ${Math.max(space.capacity_seated, space.capacity_standing ?? 0)}` : `Fits ${venue.capacity_min}–${venue.capacity_max}`}
          />
        </div>
        <Select label="Budget" value={form.budget} onChange={(e) => set('budget', e.target.value)}>
          <option value="">Not sure yet</option>
          {BUDGETS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </Select>
        <Textarea
          label="What do you need?"
          required
          rows={3}
          value={form.message}
          onChange={(e) => set('message', e.target.value)}
          placeholder="Full-day reception with stage, sound and catering."
        />
        <div className="space-y-4 border-t border-ink-100 pt-4">
          <Input label="Your name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ramesh Shrestha" autoComplete="name" />
          <Input label="Email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="you@example.com" autoComplete="email" />
          <Input label="Phone" type="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98XXXXXXXX" autoComplete="tel" />
        </div>
        <Button type="submit" loading={sending} className="w-full">
          {slot ? 'Request this slot' : 'Send inquiry'}
        </Button>
      </form>
    </Card>
  )
}
