import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DoorOpen, Send } from 'lucide-react'
import { request, type Ticket } from '@/services/api'
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { useModuleEnabled } from '@/lib/modules'
import { cn } from '@/lib/utils'

/** Guest management on the dashboard (module `guest_management`, backend apps/events/guests.py). */
export const GUEST_TAGS = ['VIP', 'Speaker', 'Press', 'Sponsor', 'Performer', 'Staff guest']

export type GuestTicket = Ticket & { guest_tags?: string[]; host_note?: string }

/** Tags and a host note for one guest. */
export const GuestEditModal: React.FC<{ eventId: string; ticket: GuestTicket; onClose: () => void }> = ({ eventId, ticket, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [tags, setTags] = useState<string[]>(ticket.guest_tags ?? [])
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState(ticket.host_note ?? '')
  const save = useMutation({
    mutationFn: () => request(`/events/${eventId}/guests/${ticket.id}/`, { method: 'PATCH', body: JSON.stringify({ tags, note }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets', eventId] })
      toast.success('Guest updated')
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })
  const toggle = (t: string) => setTags((cur) => (cur.some((x) => x.toLowerCase() === t.toLowerCase()) ? cur.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...cur, t]))
  const addCustom = () => {
    const t = custom.trim()
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t])
    setCustom('')
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={ticket.attendee_name}
      description={`${ticket.attendee_email}${ticket.attendee_phone ? ` · ${ticket.attendee_phone}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="text-sm font-medium text-ink-800">Tags</p>
          <p className="text-xs text-ink-500">Tagged guests trigger an arrival alert. Gate staff see tags after the scan.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...GUEST_TAGS, ...tags.filter((t) => !GUEST_TAGS.some((g) => g.toLowerCase() === t.toLowerCase()))].map((t) => {
              const on = tags.some((x) => x.toLowerCase() === t.toLowerCase())
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(t)}
                  className={cn('h-8 rounded-full border px-3 text-sm font-semibold', on ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-ink-700 hover:border-ink-400')}
                >
                  {t}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <Input label="Other tag" className="flex-1" placeholder="e.g. Table 4" maxLength={30} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())} />
            <Button variant="secondary" className="self-end" onClick={addCustom} disabled={!custom.trim()}>
              Add
            </Button>
          </div>
        </div>
        <Textarea label="Note for you and your staff" rows={3} maxLength={1000} placeholder="Reserved front row · pays at the door" hint="Guests never see this." value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}

const TEMPLATES: { label: string; subject: string; body: string }[] = [
  { label: 'Reminder', subject: 'See you soon', body: 'A quick reminder: the event is coming up. Keep your pass ready on your phone, and arrive a little early to skip the queue.' },
  { label: 'Venue or time change', subject: 'Important change', body: 'Please note a change: [write the new venue or time here]. Everything else stays the same. Sorry for any trouble.' },
  { label: 'Doors open', subject: 'Doors are open', body: 'The doors are open! Have your QR pass ready at the gate.' },
  { label: 'Thank you', subject: 'Thank you for coming', body: 'Thank you for joining us. We hope you enjoyed it. See you at the next one!' },
]

interface SentMessage {
  id: string
  subject: string
  body: string
  audience: string
  recipients: number
  sms_recipients?: number
  sent_by: string
  created_at: string
}

const audienceLabel = (a: string) =>
  a === 'all' ? 'Everyone' : a === 'not_arrived' ? 'Not arrived yet' : a === 'inside' ? 'Inside now' : a.startsWith('tag:') ? `Tagged ${a.slice(4)}` : a.startsWith('type:') ? 'One ticket type' : a

/** Compose an email (+ app push) to guests, and the log of what was sent. */
export const MessageGuestsModal: React.FC<{ eventId: string; tags: string[]; ticketTypes: { id: string; name: string }[]; onClose: () => void }> = ({ eventId, tags, ticketTypes, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [audience, setAudience] = useState('all')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [count, setCount] = useState<number | null>(null)
  // "Also send as SMS": paid from the organizer's SMS credits (module sms)
  const smsOn = useModuleEnabled('sms')
  const [sms, setSms] = useState(false)
  const [smsQuote, setSmsQuote] = useState<{ phones: number; credits: number; balance: number; ready: boolean } | null>(null)
  const { data: sent = [], isLoading } = useQuery({ queryKey: ['guest-messages', eventId], queryFn: () => request<SentMessage[]>(`/events/${eventId}/guest-messages/`) })

  // How many people the chosen audience reaches (one per email)
  useEffect(() => {
    let live = true
    setCount(null)
    setSmsQuote(null)
    // The SMS cost depends on the text length, so wait for typing to pause
    const timer = setTimeout(() => {
      request<{ recipients: number; sms_recipients?: number; sms_credits?: number; sms_balance?: number; sms_ready?: boolean }>(`/events/${eventId}/guest-messages/`, {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim() || 'x', body: body.trim() || 'x', audience, dry_run: true, sms }),
      })
        .then((r) => {
          if (!live) return
          setCount(r.recipients)
          if (sms) setSmsQuote({ phones: r.sms_recipients ?? 0, credits: r.sms_credits ?? 0, balance: r.sms_balance ?? 0, ready: r.sms_ready !== false })
        })
        .catch(() => live && setCount(0))
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [eventId, audience, sms, subject, body])
  const smsShort = sms && !!smsQuote && (!smsQuote.ready || smsQuote.credits > smsQuote.balance)

  const send = useMutation({
    mutationFn: () => request<{ recipients: number }>(`/events/${eventId}/guest-messages/`, { method: 'POST', body: JSON.stringify({ subject: subject.trim(), body: body.trim(), audience, sms }) }),
    onSuccess: (r: { recipients: number; sms_recipients?: number }) => {
      void qc.invalidateQueries({ queryKey: ['guest-messages', eventId] })
      void qc.invalidateQueries({ queryKey: ['mySms'] })
      toast.success(`Sent to ${r.recipients} ${r.recipients === 1 ? 'guest' : 'guests'}`, r.sms_recipients ? `Texting ${r.sms_recipients} phones too.` : undefined)
      setSubject('')
      setBody('')
    },
    onError: (e: Error) => toast.error('Couldn’t send', e.message),
  })

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Message guests"
      description="An email to each guest (once per email address), plus a notification for guests who use the app."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button icon={<Send className="h-4 w-4" />} loading={send.isPending} disabled={!subject.trim() || !body.trim() || !count || smsShort} onClick={() => send.mutate()}>
            {count ? `Send to ${count}` : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Who gets it" value={audience} onChange={(e) => setAudience(e.target.value)} hint={count === null ? 'Counting…' : `${count} ${count === 1 ? 'person' : 'people'}`}>
            <option value="all">Everyone registered</option>
            <option value="not_arrived">Not arrived yet</option>
            <option value="inside">Inside now</option>
            {tags.map((t) => (
              <option key={t} value={`tag:${t}`}>
                Tagged {t}
              </option>
            ))}
            {ticketTypes.map((t) => (
              <option key={t.id} value={`type:${t.id}`}>
                {t.name} ticket holders
              </option>
            ))}
          </Select>
          <Select
            label="Start from"
            value=""
            onChange={(e) => {
              const t = TEMPLATES.find((x) => x.label === e.target.value)
              if (t) {
                setSubject(t.subject)
                setBody(t.body)
              }
            }}
          >
            <option value="">Write my own</option>
            {TEMPLATES.map((t) => (
              <option key={t.label}>{t.label}</option>
            ))}
          </Select>
        </div>
        <Input label="Subject" required maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Textarea label="Message" required rows={5} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} hint="Guests see “Namaste <name>,” above it and the event link below." />
        {smsOn && (
          <Checkbox
            label="Also send as SMS"
            hint={
              !sms
                ? 'The subject and message as one text to each guest’s phone, using your SMS credits.'
                : !smsQuote
                  ? 'Counting…'
                  : !smsQuote.ready
                    ? 'SMS sending isn’t connected yet. Send by email for now.'
                    : smsShort
                      ? `Needs ${smsQuote.credits.toLocaleString('en-IN')} credits for ${smsQuote.phones} phones, but you have ${smsQuote.balance.toLocaleString('en-IN')}. Request more in Plan & billing.`
                      : `${smsQuote.phones} ${smsQuote.phones === 1 ? 'phone' : 'phones'} · uses ${smsQuote.credits.toLocaleString('en-IN')} of your ${smsQuote.balance.toLocaleString('en-IN')} credits`
            }
            checked={sms}
            onChange={setSms}
          />
        )}
        <div className="border-t border-ink-100 pt-4">
          <p className="text-sm font-semibold text-ink-900">Sent messages</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-10" />
          ) : sent.length === 0 ? (
            <p className="mt-1 text-sm text-ink-500">Nothing sent yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100 text-sm">
              {sent.map((m) => (
                <li key={m.id} className="py-2">
                  <p className="font-medium text-ink-900">{m.subject}</p>
                  <p className="text-xs text-ink-500">
                    {audienceLabel(m.audience)} · {m.recipients} people{m.sms_recipients ? ` · ${m.sms_recipients} SMS` : ''} · {new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    {m.sent_by && ` · ${m.sent_by}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

interface Arrival {
  id: string
  name: string
  ticket_type: string
  tags: string[]
  note: string
  at: string
  inside: boolean
}

/** Live feed of the latest check-ins (refreshes every 10 seconds); tagged guests stand out. */
export const ArrivalsCard: React.FC<{ eventId: string }> = ({ eventId }) => {
  const { data = [], isLoading } = useQuery({
    queryKey: ['arrivals', eventId],
    queryFn: () => request<Arrival[]>(`/events/${eventId}/arrivals/`),
    refetchInterval: 10_000,
  })
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader title="Arrivals" description="Latest guests in, live" />
      {isLoading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon={<DoorOpen className="h-6 w-6" />} title="No one has arrived yet" description="Guests show up here as they’re scanned in." />
      ) : (
        <ul className="max-h-80 divide-y divide-ink-100 overflow-auto">
          {data.map((a) => (
            <li key={a.id} className={cn('flex items-start gap-3 px-5 py-2.5', a.tags.length > 0 && 'bg-marigold-50/50')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">
                  {a.name}
                  {a.tags.map((t) => (
                    <Badge key={t} tone="warning" className="ml-1.5">
                      {t}
                    </Badge>
                  ))}
                </p>
                {a.note && <p className="truncate text-xs text-ink-600">{a.note}</p>}
              </div>
              <span className="shrink-0 text-xs tabular text-ink-500">
                {new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {!a.inside && ' · left'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const Checkbox: React.FC<{ label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, hint, checked, onChange }) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3 hover:bg-ink-50">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
    />
    <span>
      <span className="block text-sm font-medium text-ink-900">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
    </span>
  </label>
)
