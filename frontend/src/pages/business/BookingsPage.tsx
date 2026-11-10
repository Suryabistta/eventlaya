import React, { useDeferredValue, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, FileDown, Plus, Search, Trash2 } from 'lucide-react'
import { request } from '@/services/api'
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, StatTile, Textarea, useToast } from '@/components/ui'
import { CalendarToggle } from '@/components/CalendarToggle'
import { fmtDay, fmtPrice, slotTime } from '@/lib/availability'
import { useCalendarSystem } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { businessApi } from './api'
import { downloadApiFile } from '@/lib/download'

/**
 * Business portal → Bookings: confirmed requests and bookings the owner added, with the agreed amount, payments received
 * outside Eventlaya (records only) and the balance. Backend: apps/marketplace/bookings.py.
 */
type Filter = 'upcoming' | 'unpaid' | 'past' | 'completed' | 'cancelled' | 'all'

interface Booking {
  id: string
  kind: 'venue' | 'vendor'
  source: 'request' | 'manual'
  state: 'upcoming' | 'past' | 'completed' | 'cancelled'
  payment_state: 'unpaid' | 'part_paid' | 'paid'
  listing: string
  space: string | null
  date: string | null
  start_time: string | null
  end_time: string | null
  customer: { name: string; email: string; phone: string }
  event_type: string
  agreed_amount: string | null
  paid: string
  balance: string | null
  owner_note: string
  completed_at: string | null
  message?: string
  guest_count?: number | null
  payments?: { id: string; amount: string; method: string; method_label: string; received_on: string; note: string }[]
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'unpaid', label: 'Money due' },
  { key: 'past', label: 'Past' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
]

const PAY: Record<Booking['payment_state'], { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  unpaid: { label: 'Unpaid', tone: 'danger' },
  part_paid: { label: 'Part paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
}

const METHODS = [
  ['cash', 'Cash'],
  ['bank', 'Bank transfer'],
  ['wallet', 'eSewa / Khalti (direct)'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
] as const

const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const when = (b: Booking) => [b.date ? fmtDay(b.date) : 'No date', slotTime(b)].join(' · ')

export const BookingsPage: React.FC = () => {
  useCalendarSystem() // re-render when the viewer switches BS / AD
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const [open, setOpen] = useState<Booking | null>(null)
  const [adding, setAdding] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['bookings', filter, q],
    queryFn: () => request<{ results: Booking[]; totals: { count: number; booked_value: string; received: string; due: string } }>(
      `/marketplace/my/bookings/?${new URLSearchParams({ filter, q })}`,
    ),
    placeholderData: (prev) => prev,
  })
  const rows = data?.results ?? []

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Bookings"
        description="Confirmed requests and bookings you added. Record payments you receive to keep track of what’s due."
        actions={
          <div className="flex items-center gap-2">
            <CalendarToggle />
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              Add booking
            </Button>
          </div>
        }
      />
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Booked value" value={fmtPrice(data.totals.booked_value)} />
          <StatTile label="Received" value={fmtPrice(data.totals.received)} tone="success" />
          <StatTile label="Due" value={fmtPrice(data.totals.due)} tone="warning" />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-ink-100 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div role="radiogroup" aria-label="Show" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn('h-8 shrink-0 rounded-lg px-3 text-sm font-medium', filter === f.key ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="relative block md:w-72">
            <span className="sr-only">Search bookings</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Customer, phone or listing"
              className="h-9 w-full rounded-[10px] border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
            />
          </label>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : isError ? (
          <ErrorState message="Couldn’t load bookings." onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-6 w-6" />}
            title="No bookings here"
            description="Confirm a request in Inquiries, or add a booking you took by phone or in person."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map((b) => (
              <li key={`${b.kind}-${b.id}`}>
                <button type="button" onClick={() => setOpen(b)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-ink-50/70">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-900">
                      {b.customer.name}
                      {b.source === 'manual' && <span className="ml-2 text-xs font-normal text-ink-500">added by you</span>}
                    </p>
                    <p className="truncate text-sm text-ink-600">
                      {when(b)} · {b.listing}
                      {b.space ? ` · ${b.space}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {b.agreed_amount && (
                      <span className="tabular text-ink-700">
                        {fmtPrice(b.paid)} / {fmtPrice(b.agreed_amount)}
                      </span>
                    )}
                    {b.state === 'cancelled' ? (
                      <Badge tone="neutral">Cancelled</Badge>
                    ) : b.state === 'completed' ? (
                      <Badge tone="success">Completed</Badge>
                    ) : (
                      <Badge tone={PAY[b.payment_state].tone} dot>
                        {PAY[b.payment_state].label}
                      </Badge>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <BookingModal booking={open} onClose={() => setOpen(null)} />}
      {adding && <AddBookingModal onClose={() => setAdding(false)} />}
    </div>
  )
}

/** One booking: customer, slot, agreed amount, payments (add / remove), complete, cancel. */
const BookingModal: React.FC<{ booking: Booking; onClose: () => void }> = ({ booking, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const base = `/marketplace/my/bookings/${booking.kind}/${booking.id}/`
  const { data: b = booking } = useQuery({ queryKey: ['booking', booking.id], queryFn: () => request<Booking>(base) })
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [received, setReceived] = useState(todayIso())
  const [note, setNote] = useState('')
  const [agreed, setAgreed] = useState<string | null>(null)
  const [cancelNote, setCancelNote] = useState<string | null>(null)
  const refresh = (next: Booking) => {
    qc.setQueryData(['booking', booking.id], next)
    void qc.invalidateQueries({ queryKey: ['bookings'] })
  }
  const call = useMutation({
    mutationFn: (v: { path: string; method: string; body?: object }) => request<Booking>(`${base}${v.path}`, { method: v.method, body: v.body ? JSON.stringify(v.body) : undefined }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error('Couldn’t save', e.message),
  })
  const active = b.state !== 'cancelled'
  const canComplete = active && !b.completed_at && b.date !== null && b.date <= todayIso()

  return (
    <Modal open onClose={onClose} size="lg" title={b.customer.name} description={`${when(b)} · ${b.listing}${b.space ? ` · ${b.space}` : ''}`}>
      <div className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="text-ink-500">Phone </span>
            <a href={`tel:${b.customer.phone}`} className="font-medium text-brand-700">
              {b.customer.phone || '–'}
            </a>
          </p>
          <p className="truncate">
            <span className="text-ink-500">Email </span>
            {b.customer.email ? (
              <a href={`mailto:${b.customer.email}`} className="font-medium text-brand-700">
                {b.customer.email}
              </a>
            ) : (
              '–'
            )}
          </p>
          {b.event_type && <p><span className="text-ink-500">For </span>{b.event_type}{b.guest_count ? ` · ${b.guest_count} guests` : ''}</p>}
          {b.date && <p><span className="text-ink-500">Date </span>{fmtDay(b.date, true)}</p>}
        </div>
        {b.message && <p className="whitespace-pre-line rounded-xl bg-ink-50 p-3 text-sm text-ink-700">{b.message}</p>}

        <div className="rounded-xl border border-ink-200 p-4">
          <div className="flex flex-wrap items-end gap-3">
            {agreed === null ? (
              <p className="flex-1 text-sm">
                <span className="text-ink-500">Agreed amount </span>
                <span className="font-semibold text-ink-900">{b.agreed_amount ? fmtPrice(b.agreed_amount) : 'Not set'}</span>
                {active && (
                  <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setAgreed(b.agreed_amount ?? '')}>
                    Change
                  </button>
                )}
              </p>
            ) : (
              <>
                <Input label="Agreed amount (Rs)" type="number" min={0} className="flex-1" value={agreed} onChange={(e) => setAgreed(e.target.value)} />
                <Button size="sm" loading={call.isPending} onClick={() => call.mutate({ path: '', method: 'PATCH', body: { agreed_amount: agreed || null } }, { onSuccess: () => setAgreed(null) })}>
                  Save
                </Button>
              </>
            )}
          </div>
          <p className="mt-2 text-sm">
            <span className="text-ink-500">Received </span>
            <span className="font-semibold text-emerald-700">{fmtPrice(b.paid)}</span>
            {b.balance !== null && (
              <>
                <span className="text-ink-500"> · Due </span>
                <span className="font-semibold text-ink-900">{fmtPrice(Math.max(Number(b.balance), 0))}</span>
              </>
            )}
          </p>
          {(b.payments ?? []).length > 0 && (
            <ul className="mt-3 divide-y divide-ink-100 border-t border-ink-100 text-sm">
              {b.payments!.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium tabular">{fmtPrice(p.amount)}</span> · {p.method_label} · {fmtDay(p.received_on)}
                    {p.note && <span className="text-ink-500"> · {p.note}</span>}
                  </span>
                  <button
                    type="button"
                    className="text-ink-400 hover:text-red-600"
                    aria-label="Remove payment"
                    onClick={() => window.confirm('Remove this payment record?') && call.mutate({ path: `payments/${p.id}/`, method: 'DELETE' })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {active && (
            <div className="mt-3 grid gap-2 border-t border-ink-100 pt-3 sm:grid-cols-[1fr_1fr_1fr]">
              <Input label="Amount received (Rs)" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Select label="How" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <Input label="Received on" type="date" max={todayIso()} value={received} onChange={(e) => setReceived(e.target.value)} />
              <Input label="Note" containerClassName="sm:col-span-2" placeholder="Advance, final payment…" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                className="self-end"
                loading={call.isPending}
                disabled={!(Number(amount) > 0)}
                onClick={() =>
                  call.mutate(
                    { path: 'payments/', method: 'POST', body: { amount, method, received_on: received, note } },
                    {
                      onSuccess: () => {
                        setAmount('')
                        setNote('')
                        toast.success('Payment recorded')
                      },
                    },
                  )
                }
              >
                Record payment
              </Button>
            </div>
          )}
        </div>

        {cancelNote !== null ? (
          <div className="space-y-2 rounded-xl border border-red-200 p-4">
            <Textarea label="Message to the customer (optional)" rows={2} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCancelNote(null)}>
                Keep booking
              </Button>
              <Button variant="danger" size="sm" loading={call.isPending} onClick={() => call.mutate({ path: 'cancel/', method: 'POST', body: { note: cancelNote } }, { onSuccess: () => setCancelNote(null) })}>
                Cancel booking
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              icon={<FileDown className="h-4 w-4" />}
              onClick={() => downloadApiFile(`${base}receipt/`, 'receipt.pdf').catch((e: Error) => toast.error('Couldn’t download', e.message))}
            >
              Receipt (PDF)
            </Button>
            {active && !b.completed_at && (
              <Button variant="ghost" onClick={() => setCancelNote('')}>
                Cancel booking
              </Button>
            )}
            {b.completed_at ? (
              <Button variant="secondary" loading={call.isPending} onClick={() => call.mutate({ path: 'complete/', method: 'POST', body: { undo: true } })}>
                Mark not completed
              </Button>
            ) : (
              canComplete && (
                <Button loading={call.isPending} onClick={() => call.mutate({ path: 'complete/', method: 'POST' })}>
                  Mark completed
                </Button>
              )
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** A booking taken by phone or in person: blocks the date (whole day or a time slot) like a confirmed request. */
const AddBookingModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: listings } = useQuery({ queryKey: ['my-listings'], queryFn: businessApi.myListings })
  const options = useMemo(
    () => [
      ...(listings?.venues ?? []).map((v) => ({ key: `venue:${v.id}`, kind: 'venue' as const, id: v.id, name: v.name, spaces: v.spaces ?? [], presets: v.slot_presets ?? [] })),
      ...(listings?.vendor_profiles ?? []).map((p) => ({ key: `vendor:${p.id}`, kind: 'vendor' as const, id: p.id, name: p.business_name, spaces: [], presets: p.slot_presets ?? [] })),
    ],
    [listings],
  )
  const [key, setKey] = useState('')
  const listing = options.find((o) => o.key === key) ?? options[0]
  const [form, setForm] = useState({ space: '', date: todayIso(), time: 'day', start: '18:00', end: '22:00', name: '', phone: '', email: '', amount: '', event_type: '', note: '' })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const preset = listing?.presets.find((p) => p.name === form.time)
  const save = useMutation({
    mutationFn: () =>
      request('/marketplace/my/bookings/', {
        method: 'POST',
        body: JSON.stringify({
          kind: listing!.kind,
          listing_id: listing!.id,
          space_id: form.space || null,
          date: form.date,
          ...(form.time === 'day' ? {} : preset ? { start_time: preset.start, end_time: preset.end } : { start_time: form.start, end_time: form.end }),
          name: form.name,
          phone: form.phone,
          email: form.email,
          agreed_amount: form.amount || null,
          event_type: form.event_type,
          note: form.note,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bookings'] })
      void qc.invalidateQueries({ queryKey: ['slots'] })
      toast.success('Booking added', 'The date is now blocked on your calendar.')
      onClose()
    },
    onError: (e: Error) => toast.error('Couldn’t add the booking', e.message),
  })
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add booking"
      description="A booking you took by phone or in person. It blocks the date like a confirmed request."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!listing || !form.name.trim() || !form.phone.trim() || !form.date} onClick={() => save.mutate()}>
            Add booking
          </Button>
        </>
      }
    >
      {!listing ? (
        <EmptyState title="No listings yet" description="Create a venue or vendor listing first." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Listing" value={listing.key} onChange={(e) => setKey(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
              </option>
            ))}
          </Select>
          {listing.kind === 'venue' && listing.spaces.length > 0 ? (
            <Select label="Space" value={form.space} onChange={(e) => set('space', e.target.value)}>
              <option value="">Whole venue</option>
              {listing.spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <div />
          )}
          <Input label="Date" type="date" required min={todayIso()} value={form.date} onChange={(e) => set('date', e.target.value)} />
          <Select label="Time" value={form.time} onChange={(e) => set('time', e.target.value)}>
            <option value="day">Whole day</option>
            {listing.presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.start}–{p.end})
              </option>
            ))}
            <option value="custom">Set hours…</option>
          </Select>
          {form.time === 'custom' && (
            <>
              <Input label="Starts" type="time" value={form.start} onChange={(e) => set('start', e.target.value)} />
              <Input label="Ends" type="time" value={form.end} onChange={(e) => set('end', e.target.value)} />
            </>
          )}
          <Input label="Customer name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
          <Input label="Phone" type="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <Input label="Email" type="email" hint="Optional" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <Input label="Agreed amount (Rs)" type="number" min={0} hint="Optional" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
          <Input label="For" placeholder="Wedding, birthday…" value={form.event_type} onChange={(e) => set('event_type', e.target.value)} />
          <Input label="Note" placeholder="Anything to remember" value={form.note} onChange={(e) => set('note', e.target.value)} />
        </div>
      )}
    </Modal>
  )
}

export default BookingsPage
