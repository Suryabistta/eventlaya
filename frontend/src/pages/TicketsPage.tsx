import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Check,
  DoorOpen,
  ExternalLink,
  EyeOff,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Tag,
  Ticket as TicketIcon,
  Trash2,
  Users,
  Wand2,
} from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import { useModuleEnabled } from '@/lib/modules'
import { EventPaymentOptions } from '@/pages/payments/EventPaymentOptions'
import { eventPhase } from '@/lib/phase'
import { PhaseNotice } from '@/components/PhaseBadge'
import { gatesApi, type EventGate } from '@/lib/gates'
import {
  PRESETS,
  fieldErrorsOf,
  fmtDateTime,
  fmtShortDate,
  generateCode,
  money,
  presetPrice,
  priceText,
  promoLabel,
  ticketKeys,
  ticketsApi,
  type DiscountType,
  type PresetId,
  type PromoCode,
  type PromoCodeInput,
  type TicketType,
  type TicketTypeInput,
} from '@/lib/tickets'
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { api, type Event } from '@/services/api'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

/** ISO timestamp → value for <input type="datetime-local"> in the browser's timezone */
function toLocalInput(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

export const TicketsPage: React.FC = () => {
  const { currentEvent, setCurrentEventId, isLoading: eventsLoading, isError: eventsError, error, refetch } = useCurrentEvent()
  const [params, setParams] = useSearchParams()
  const eventId = currentEvent?.id
  const paymentsOn = useModuleEnabled('payments')

  // /app/tickets?event=<id> (from the event form) selects that event in the shared switcher
  const wanted = params.get('event')
  useEffect(() => {
    if (!wanted) return
    setCurrentEventId(wanted)
    setParams(
      (p) => {
        p.delete('event')
        return p
      },
      { replace: true },
    )
  }, [wanted, setCurrentEventId, setParams])

  const typesQuery = useQuery({ queryKey: ticketKeys.types(eventId ?? ''), queryFn: () => ticketsApi.list(eventId!), enabled: Boolean(eventId) })
  const promosQuery = useQuery({ queryKey: ticketKeys.promos(eventId ?? ''), queryFn: () => ticketsApi.promos(eventId!), enabled: Boolean(eventId) })
  const gatesQuery = useQuery({ queryKey: ['gates', eventId], queryFn: () => gatesApi.list(eventId!), enabled: Boolean(eventId) })

  const [editing, setEditing] = useState<TicketType | 'new' | null>(null)
  const [editingPromo, setEditingPromo] = useState<PromoCode | 'new' | null>(null)

  const wrap = (children: React.ReactNode) => <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>

  if (eventsError) return wrap(<ErrorState message={error?.message} onRetry={refetch} />)
  if (eventsLoading) {
    return wrap(
      <>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </>,
    )
  }
  if (!currentEvent) {
    return wrap(
      <>
        <PageHeader title="Tickets" />
        <Card>
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" aria-hidden />}
            title="Create an event first"
            description="Ticket types and promo codes belong to an event. Once you have one, set up its tickets here."
            action={<ButtonLink to="/app/events/new">Create an event</ButtonLink>}
          />
        </Card>
      </>,
    )
  }

  const types = typesQuery.data ?? []
  const gates = gatesQuery.data ?? []
  const promos = promosQuery.data ?? []
  const basePrice = (() => {
    const general = types.find((t) => t.is_active && /general/i.test(t.name) && Number(t.price) > 0)
    if (general) return Number(general.price)
    return Number(currentEvent.ticket_price) > 0 ? Number(currentEvent.ticket_price) : 0
  })()

  return wrap(
    <>
      <PageHeader
        title="Tickets"
        description={`Ticket types, payment options and promo codes for ${currentEvent.title}.`}
        actions={
          <>
            <a
              href={`/e/${currentEvent.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-ink-700 hover:bg-ink-100"
            >
              View event page
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>
              Add ticket type
            </Button>
          </>
        }
      />

      <PhaseNotice event={currentEvent} context="tickets" />

      {typesQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : typesQuery.isError ? (
        <ErrorState message={(typesQuery.error as Error).message} onRetry={() => void typesQuery.refetch()} />
      ) : (
        <>
          <QuickSetup
            key={eventId}
            eventId={currentEvent.id}
            types={types}
            gates={gates}
            defaultBase={basePrice}
            startCollapsed={types.length > 1 || types.some((t) => t.sold > 0) || ['ended', 'cancelled'].includes(eventPhase(currentEvent))}
          />
          <OrderSettings key={`order-${eventId}`} event={currentEvent} />
          {paymentsOn && <EventPaymentOptions key={`pay-${eventId}`} eventId={currentEvent.id} />}
          <TypeList eventId={currentEvent.id} types={types} onAdd={() => setEditing('new')} onEdit={setEditing} />
          <PromoSection
            eventId={currentEvent.id}
            types={types}
            promos={promos}
            loading={promosQuery.isLoading}
            error={promosQuery.isError ? (promosQuery.error as Error) : null}
            onRetry={() => void promosQuery.refetch()}
            onAdd={() => setEditingPromo('new')}
            onEdit={setEditingPromo}
          />
        </>
      )}

      <TicketTypeModal eventId={currentEvent.id} editing={editing} gates={gates} count={types.length} onClose={() => setEditing(null)} />
      <PromoModal eventId={currentEvent.id} editing={editingPromo} types={types} existing={promos} onClose={() => setEditingPromo(null)} />
    </>,
  )
}

/* ------------------------------------------------------------------ */

function useInvalidateTickets(eventId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ticketKeys.types(eventId) })
    void qc.invalidateQueries({ queryKey: ticketKeys.promos(eventId) })
    void qc.invalidateQueries({ queryKey: ['events'] })
    void qc.invalidateQueries({ queryKey: ['analytics', eventId] })
    void qc.invalidateQueries({ queryKey: ['publicEvent'] })
  }
}

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; hint?: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  hint,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="flex w-full items-start gap-3 rounded-lg py-1 text-left text-sm text-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
  >
    <span aria-hidden className={cn('relative mt-0.5 block h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-ink-200')}>
      <span className={cn('absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white shadow-xs transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
    </span>
    <span className="min-w-0">
      <span className="block font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
    </span>
  </button>
)

/** Segmented control */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid w-full gap-1 rounded-[10px] bg-ink-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-white text-brand-700 shadow-xs' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Quick setup ---------- */

const QuickSetup: React.FC<{ eventId: string; types: TicketType[]; gates: EventGate[]; defaultBase: number; startCollapsed: boolean }> = ({
  eventId,
  types,
  gates,
  defaultBase,
  startCollapsed,
}) => {
  const toast = useToast()
  const invalidate = useInvalidateTickets(eventId)
  const [open, setOpen] = useState(!startCollapsed)
  const [preset, setPreset] = useState<PresetId>(defaultBase > 0 ? 'general' : 'free')
  const [base, setBase] = useState(defaultBase > 0 ? String(defaultBase) : '')
  const [baseError, setBaseError] = useState<string>()
  const chosen = PRESETS.find((p) => p.id === preset)!
  const baseNum = Number(base)
  const needsPrice = preset !== 'free'
  const hasVipGate = gates.some((g) => g.is_vip && g.is_active)

  const apply = useMutation({
    mutationFn: () => ticketsApi.applyPreset(eventId, preset, needsPrice ? baseNum : undefined),
    onSuccess: (res) => {
      const names = res.ticket_types.filter((t) => t.is_active).map((t) => t.name)
      toast.success(
        `Tickets set up: ${names.join(', ')}`,
        res.kept_inactive.length ? `${res.kept_inactive.join(', ')} already had registrations, so ${res.kept_inactive.length === 1 ? 'it was' : 'they were'} kept and turned off.` : 'They’re live on your event page now.',
      )
      invalidate()
      setOpen(false)
    },
    onError: (e) => toast.error("Couldn't apply the preset", errText(e)),
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (needsPrice && (!base || Number.isNaN(baseNum) || baseNum <= 0)) {
      setBaseError('Enter the normal ticket price, e.g. 500.')
      return
    }
    setBaseError(undefined)
    if (types.length) {
      const sold = types.filter((t) => t.sold > 0)
      const ok = await toast.confirm({
        title: `Use “${chosen.title}”?`,
        description:
          'This replaces ticket types that have no registrations.' +
          (sold.length ? ` ${sold.map((t) => t.name).join(', ')} already ${sold.length === 1 ? 'has' : 'have'} registrations, so ${sold.length === 1 ? 'it stays' : 'they stay'} for those passes but stop selling.` : ''),
        confirmLabel: 'Replace ticket types',
      })
      if (!ok) return
    }
    apply.mutate()
  }

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Wand2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">Quick setup</p>
            <p className="text-sm text-ink-500">Start again from a ready-made set of tickets, priced from one number.</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>
          Use a preset
        </Button>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-brand-600" aria-hidden />
            Quick setup
          </span>
        }
        description="Pick what fits your event and enter your normal price. We create the ticket types for you. You can tweak each one afterwards."
        actions={
          startCollapsed || types.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : undefined
        }
      />
      <form onSubmit={submit} noValidate className="space-y-5 p-4 sm:p-5">
        <div role="radiogroup" aria-label="Ticket preset" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {PRESETS.map((p) => {
            const selected = p.id === preset
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreset(p.id)}
                className={cn(
                  'relative flex flex-col items-start rounded-xl border p-3.5 text-left transition-colors',
                  selected ? 'border-brand-600 bg-brand-50/60 ring-2 ring-brand-500/20' : 'border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50',
                )}
              >
                <span className="pr-6 text-sm font-semibold text-ink-900">{p.title}</span>
                <span className="mt-0.5 text-xs text-ink-500">{p.description}</span>
                {selected && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          {needsPrice ? (
            <Input
              label="Normal ticket price (Rs)"
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              placeholder="500"
              value={base}
              error={baseError}
              hint="Other tickets are priced from this."
              onChange={(e) => {
                setBase(e.target.value)
                setBaseError(undefined)
              }}
            />
          ) : (
            <p className="rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">No price needed. Everyone registers for free.</p>
          )}

          <div className="rounded-xl border border-ink-200">
            <p className="border-b border-ink-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500">You'll get</p>
            <ul className="divide-y divide-ink-100">
              {chosen.rows.map((r) => (
                <li key={r.name} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-ink-900">{r.name}</span>
                    {r.note && <span className="block text-xs text-ink-500">{r.note}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular text-ink-900">
                    {r.factor === 0 ? 'Free' : baseNum > 0 ? `Rs ${money(presetPrice(baseNum, r.factor))}` : r.factor === 1 ? 'Your price' : `${Math.round(r.factor * 100)}% of price`}
                  </span>
                </li>
              ))}
            </ul>
            {(preset === 'vip' || preset === 'full') && !hasVipGate && (
              <p className="border-t border-ink-100 px-4 py-2.5 text-xs text-marigold-800">
                You don't have a VIP gate yet, so VIP tickets will work at every gate.{' '}
                <Link to="/app/gates" className="font-medium underline underline-offset-2">
                  Mark a gate as VIP
                </Link>{' '}
                first if VIPs have their own entrance.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {types.length > 0 && <p className="text-xs text-ink-500">Replaces your current ticket types that have no registrations.</p>}
          <Button type="submit" loading={apply.isPending} icon={<Sparkles className="h-4 w-4" aria-hidden />}>
            {types.length ? 'Apply preset' : 'Create these tickets'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ---------- Order limit and spots ---------- */

const ORDER_MIN = 1
const ORDER_MAX = 50

/** How many tickets one registration can get, and whether attendees see how many are left. Saved on the event. */
const OrderSettings: React.FC<{ event: Event }> = ({ event }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const value = event.max_tickets_per_order ?? 10
  const showSpots = event.show_spots_left ?? true
  const [input, setInput] = useState(String(value))
  const [err, setErr] = useState<string>()
  useEffect(() => setInput(String(value)), [value])
  const num = Number(input)
  const dirty = input.trim() !== '' && num !== value

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['events'] })
    void qc.invalidateQueries({ queryKey: ['publicEvent'] })
  }
  const save = useMutation({
    mutationFn: (n: number) => api.updateEvent(event.id, { max_tickets_per_order: n }),
    onSuccess: (ev) => {
      const n = ev.max_tickets_per_order ?? num
      toast.success(n === 1 ? 'One ticket per order' : `Up to ${n} tickets per order`, 'Attendees see the new limit on the registration page.')
      refresh()
    },
    onError: (e) => setErr(fieldErrorsOf(e, ['max_tickets_per_order']).message),
  })
  const toggleSpots = useMutation({
    mutationFn: (show: boolean) => api.updateEvent(event.id, { show_spots_left: show }),
    onSuccess: (ev) => {
      toast.success(ev.show_spots_left === false ? 'Spots left are hidden' : 'Spots left are shown', ev.show_spots_left === false ? 'Attendees still see Fully booked and Sold out.' : 'Attendees see how many spots and tickets are left.')
      refresh()
    },
    onError: (e) => toast.error("Couldn't save that", errText(e)),
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!Number.isInteger(num) || num < ORDER_MIN || num > ORDER_MAX) return setErr(`Enter a whole number from ${ORDER_MIN} to ${ORDER_MAX}.`)
    setErr(undefined)
    save.mutate(num)
  }

  return (
    <Card className="divide-y divide-ink-100">
      <form onSubmit={submit} noValidate className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4 sm:px-5">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink-900">Order limit</p>
            <p className="text-sm text-ink-500">The most tickets one person can get in a single registration. Each ticket is its own pass with its own QR code.</p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Input
            label="Max tickets per order"
            type="number"
            inputMode="numeric"
            min={ORDER_MIN}
            max={ORDER_MAX}
            step={1}
            containerClassName="w-44"
            value={input}
            error={err}
            hint={err ? undefined : `From ${ORDER_MIN} to ${ORDER_MAX}`}
            onChange={(e) => {
              setInput(e.target.value)
              setErr(undefined)
            }}
          />
          <Button type="submit" variant="secondary" className="mt-[26px]" loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
        </div>
      </form>
      <div className="p-4 sm:px-5 sm:pl-[68px]">
        <Switch
          checked={toggleSpots.isPending ? !showSpots : showSpots}
          disabled={toggleSpots.isPending}
          onChange={(v) => toggleSpots.mutate(v)}
          label="Show how many spots are left"
          hint="Attendees still see Fully booked / Sold out."
        />
      </div>
    </Card>
  )
}

/* ---------- Ticket type list ---------- */

function availabilityBadge(t: TicketType): { tone: 'success' | 'info' | 'neutral' | 'danger' | 'warning'; label: string } {
  switch (t.availability) {
    case 'on_sale':
      return { tone: 'success', label: 'On sale' }
    case 'not_started':
      return { tone: 'info', label: t.sales_start ? `Starts ${fmtShortDate(t.sales_start)}` : 'Not started' }
    case 'ended':
      return { tone: 'neutral', label: 'Ended' }
    case 'sold_out':
      return { tone: 'danger', label: 'Sold out' }
    default:
      return { tone: 'warning', label: 'Off' }
  }
}

function salesWindow(t: TicketType) {
  if (t.sales_start && t.sales_end) return `Sales ${fmtDateTime(t.sales_start)} to ${fmtDateTime(t.sales_end)}`
  if (t.sales_start) return `Sales open ${fmtDateTime(t.sales_start)}`
  if (t.sales_end) return `Sales end ${fmtDateTime(t.sales_end)}`
  return null
}

const TypeList: React.FC<{ eventId: string; types: TicketType[]; onAdd: () => void; onEdit: (t: TicketType) => void }> = ({ eventId, types, onAdd, onEdit }) => {
  if (types.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<TicketIcon className="h-6 w-6" aria-hidden />}
          title="No ticket types yet"
          description="The quickest way is Quick setup above: pick a preset like “Student + General”, enter your normal price, and we create the tickets. Or add one ticket type by hand."
          action={
            <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onAdd}>
              Add ticket type
            </Button>
          }
        />
      </Card>
    )
  }
  const onSale = types.filter((t) => t.availability === 'on_sale' && !t.is_hidden).length
  return (
    <Card>
      <CardHeader
        title="Ticket types"
        description={`${types.length} type${types.length === 1 ? '' : 's'}, ${onSale} on sale on your event page. Attendees pick one when they register.`}
        actions={
          <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onAdd}>
            Add
          </Button>
        }
      />
      <ul className="divide-y divide-ink-100" aria-label="Ticket types">
        {types.map((t, i) => (
          <TypeRow key={t.id} eventId={eventId} type={t} types={types} index={i} onEdit={() => onEdit(t)} />
        ))}
      </ul>
    </Card>
  )
}

const TypeRow: React.FC<{ eventId: string; type: TicketType; types: TicketType[]; index: number; onEdit: () => void }> = ({ eventId, type: t, types, index, onEdit }) => {
  const toast = useToast()
  const invalidate = useInvalidateTickets(eventId)
  const badge = availabilityBadge(t)
  const salesText = salesWindow(t)
  const pct = t.quantity ? Math.min(100, Math.round((t.sold / t.quantity) * 100)) : 0

  const toggle = useMutation({
    mutationFn: () => ticketsApi.update(eventId, t.id, { is_active: !t.is_active }),
    onSuccess: (res) => {
      toast.success(res.is_active ? `${t.name} turned on` : `${t.name} turned off`, res.is_active ? undefined : 'It no longer sells. Existing passes still work.')
      invalidate()
    },
    onError: (e) => toast.error("Couldn't update the ticket type", errText(e)),
  })

  const remove = useMutation({
    mutationFn: () => ticketsApi.remove(eventId, t.id),
    onSuccess: (res) => {
      if (res.deactivated) toast.info(`${t.name} turned off instead`, res.message)
      else toast.success(res.message || `${t.name} deleted`)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't delete the ticket type", errText(e)),
  })

  const move = useMutation({
    mutationFn: async (dir: -1 | 1) => {
      const next = [...types]
      const [x] = next.splice(index, 1)
      next.splice(index + dir, 0, x)
      await Promise.all(next.map((y, i) => (y.order !== i + 1 ? ticketsApi.update(eventId, y.id, { order: i + 1 }) : null)))
    },
    onSuccess: () => invalidate(),
    onError: (e) => toast.error("Couldn't reorder ticket types", errText(e)),
  })

  const confirmDelete = async () => {
    const ok = await toast.confirm({
      title: `Delete ${t.name}?`,
      description: t.sold
        ? `${t.sold} ${t.sold === 1 ? 'person has' : 'people have'} this ticket, so it will be turned off instead and their passes keep working.`
        : 'It disappears from your event page. This can’t be undone.',
      confirmLabel: t.sold ? 'Turn off' : 'Delete',
      danger: true,
    })
    if (ok) remove.mutate()
  }

  const busy = toggle.isPending || remove.isPending

  return (
    <li className={cn('flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-start', !t.is_active && 'bg-ink-50')}>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('font-semibold', t.is_active ? 'text-ink-900' : 'text-ink-500')}>{t.name}</p>
          <Badge tone={badge.tone} dot>
            {badge.label}
          </Badge>
          {t.is_hidden && (
            <Badge tone="brand">
              <EyeOff className="h-3 w-3" aria-hidden />
              Hidden
            </Badge>
          )}
          {t.online_only && <Badge tone="info">Online payment only</Badge>}
        </div>
        {t.description && <p className="text-sm text-ink-600">{t.description}</p>}

        <div className="max-w-md">
          <p className="flex items-baseline justify-between gap-3 text-xs text-ink-500 tabular">
            <span>
              <span className="font-semibold text-ink-800">{t.sold.toLocaleString()}</span> registered
              {t.quantity !== null && <> of {t.quantity.toLocaleString()}</>}
            </span>
            {t.remaining !== null && <span>{t.remaining.toLocaleString()} left</span>}
            {t.quantity === null && <span>No limit</span>}
          </p>
          {t.quantity !== null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100" role="meter" aria-label={`${t.name} sold`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-red-500' : 'bg-brand-600')} style={{ width: `${Math.max(pct, t.sold ? 2 : 0)}%` }} />
            </div>
          )}
        </div>

        {(salesText || t.gate_note || t.allowed_gate_names.length > 0) && (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {salesText && <li className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-ink-600">{salesText}</li>}
            {t.gate_note && (
              <li className="rounded-lg border border-marigold-200 bg-marigold-50 px-2 py-1 text-marigold-900">
                Gate note: <span className="font-medium">{t.gate_note}</span>
              </li>
            )}
            {t.allowed_gate_names.length > 0 && (
              <li className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-ink-600">
                <DoorOpen className="h-3.5 w-3.5 text-ink-400" aria-hidden />
                Only at {t.allowed_gate_names.join(', ')}
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 lg:flex-col lg:items-end">
        <p className="font-display text-2xl font-bold tabular text-ink-900">{priceText(t.price)}</p>
        <div className="flex flex-wrap items-center gap-0.5">
          <IconButton label={`Move ${t.name} up`} disabled={index === 0 || move.isPending} onClick={() => move.mutate(-1)} className="h-8 w-8 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Move ${t.name} down`} disabled={index === types.length - 1 || move.isPending} onClick={() => move.mutate(1)} className="h-8 w-8 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" aria-hidden />
          </IconButton>
          <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={onEdit} disabled={busy} aria-label={`Edit ${t.name}`}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Power className="h-4 w-4" aria-hidden />}
            onClick={() => toggle.mutate()}
            loading={toggle.isPending}
            disabled={busy}
            aria-label={`${t.is_active ? 'Turn off' : 'Turn on'} ${t.name}`}
          >
            {t.is_active ? 'Turn off' : 'Turn on'}
          </Button>
          <IconButton label={`Delete ${t.name}`} onClick={confirmDelete} disabled={busy} className="h-8 w-8 hover:bg-red-50 hover:text-red-700">
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>
    </li>
  )
}

/* ---------- Add / edit ticket type ---------- */

const TYPE_FIELDS = ['name', 'description', 'price', 'quantity', 'sales_start', 'sales_end', 'gate_note', 'allowed_gates', 'is_hidden']
type TypeErrors = Partial<Record<string, string>>

const blankType = { name: '', price: '', description: '', limit: false, quantity: '', start: '', end: '', gate_note: '', gates: [] as string[], hidden: false, onlineOnly: false }

const TicketTypeModal: React.FC<{ eventId: string; editing: TicketType | 'new' | null; gates: EventGate[]; count: number; onClose: () => void }> = ({
  eventId,
  editing,
  gates,
  count,
  onClose,
}) => {
  const toast = useToast()
  const invalidate = useInvalidateTickets(eventId)
  const paymentsOn = useModuleEnabled('payments')
  const existing = editing && editing !== 'new' ? editing : null
  const [form, setForm] = useState(blankType)
  const [errors, setErrors] = useState<TypeErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) return
    setErrors({})
    setFormError(null)
    if (editing === 'new') setForm(blankType)
    else
      setForm({
        name: editing.name,
        price: String(Number(editing.price)),
        description: editing.description,
        limit: editing.quantity !== null,
        quantity: editing.quantity !== null ? String(editing.quantity) : '',
        start: toLocalInput(editing.sales_start),
        end: toLocalInput(editing.sales_end),
        gate_note: editing.gate_note,
        gates: editing.allowed_gates,
        hidden: editing.is_hidden,
        onlineOnly: Boolean(editing.online_only),
      })
  }, [editing])

  const set = <K extends keyof typeof blankType>(k: K, v: (typeof blankType)[K], errKey: string = k) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [errKey]: undefined }))
  }

  const save = useMutation({
    mutationFn: () => {
      const body: TicketTypeInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price || 0).toFixed(2),
        quantity: form.limit ? Number(form.quantity) : null,
        sales_start: fromLocalInput(form.start),
        sales_end: fromLocalInput(form.end),
        gate_note: form.gate_note.trim(),
        is_hidden: form.hidden,
        allowed_gates: form.gates,
        ...(paymentsOn ? { online_only: form.onlineOnly && Number(form.price || 0) > 0 } : {}),
      }
      if (existing) return ticketsApi.update(eventId, existing.id, body)
      return ticketsApi.create(eventId, { ...body, order: count + 1 })
    },
    onSuccess: (res) => {
      toast.success(existing ? `${res.name} saved` : `${res.name} added`, res.is_hidden ? 'It’s hidden. Create a promo code that unlocks it.' : undefined)
      invalidate()
      onClose()
    },
    onError: (e) => {
      const { fields, message } = fieldErrorsOf(e, TYPE_FIELDS)
      const key = Object.keys(fields)[0]
      const map: Record<string, string> = { sales_start: 'start', sales_end: 'end', allowed_gates: 'gates', is_hidden: 'hidden' }
      if (key) setErrors({ [map[key] ?? key]: fields[key] })
      else setFormError(message)
      toast.error("Couldn't save the ticket type", message)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: TypeErrors = {}
    if (!form.name.trim()) next.name = 'Give the ticket a name, e.g. General or Student.'
    const price = Number(form.price || 0)
    if (Number.isNaN(price) || price < 0) next.price = 'Enter 0 for free, or a price like 500.'
    if (form.limit) {
      const q = Number(form.quantity)
      if (!form.quantity || !Number.isInteger(q) || q < 1) next.quantity = 'Enter a whole number, e.g. 100.'
      else if (existing && q < existing.sold) next.quantity = `${existing.sold} already registered with this ticket. Set at least that many.`
    }
    if (form.start && form.end && form.end <= form.start) next.end = 'Sales must end after they start.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length === 0) save.mutate()
  }

  const selectableGates = gates.filter((g) => g.is_active || form.gates.includes(g.id))

  return (
    <Modal
      open={Boolean(editing)}
      onClose={onClose}
      size="lg"
      title={existing ? `Edit ${existing.name}` : 'Add ticket type'}
      description={existing?.sold ? `${existing.sold} registered with this ticket. Price changes only apply to new registrations.` : 'Attendees choose a ticket type when they register.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ticket-type-form" loading={save.isPending}>
            {existing ? 'Save changes' : 'Add ticket type'}
          </Button>
        </>
      }
    >
      <form id="ticket-type-form" onSubmit={submit} noValidate className="space-y-5">
        {formError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{formError}</p>}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <Input
            label="Name"
            required
            autoFocus
            maxLength={80}
            placeholder="e.g. Student"
            value={form.name}
            error={errors.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <Input
            label="Price (Rs)"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="0"
            value={form.price}
            error={errors.price}
            hint={Number(form.price || 0) > 0 ? (paymentsOn ? 'Paid online or at the venue (see Payment options)' : 'Paid at the venue') : 'Leave 0 for free'}
            onChange={(e) => set('price', e.target.value)}
          />
        </div>
        <Input
          label="Description"
          maxLength={255}
          placeholder="Optional, e.g. Valid student ID required at entry"
          value={form.description}
          error={errors.description}
          onChange={(e) => set('description', e.target.value)}
        />

        <div className="space-y-3 rounded-xl border border-ink-200 p-4">
          <Switch
            checked={form.limit}
            onChange={(v) => set('limit', v, 'quantity')}
            label="Limit how many can be sold"
            hint={form.limit ? undefined : 'Off: no limit for this ticket (the event capacity still applies).'}
          />
          {form.limit && (
            <Input
              label="Number of tickets"
              type="number"
              inputMode="numeric"
              min={existing?.sold || 1}
              placeholder="100"
              containerClassName="sm:max-w-[200px]"
              value={form.quantity}
              error={errors.quantity}
              onChange={(e) => set('quantity', e.target.value)}
            />
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-ink-200 p-4">
          <div>
            <p className="text-sm font-medium text-ink-800">Sales window</p>
            <p className="text-xs text-ink-500">Optional. Leave blank to sell until registration closes.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Sales start" type="datetime-local" value={form.start} error={errors.start} onChange={(e) => set('start', e.target.value)} />
            <Input label="Sales end" type="datetime-local" value={form.end} error={errors.end} onChange={(e) => set('end', e.target.value)} />
          </div>
        </div>

        <Input
          label="Gate staff note"
          maxLength={120}
          placeholder="e.g. Check student ID"
          hint="Shown to gate staff in big letters when they scan this ticket."
          value={form.gate_note}
          error={errors.gate_note}
          onChange={(e) => set('gate_note', e.target.value)}
        />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-800">Only at these gates</legend>
          {selectableGates.length === 0 ? (
            <p className="text-xs text-ink-500">
              This event has no gates yet, so this ticket works everywhere.{' '}
              <Link to="/app/gates" className="font-medium text-brand-700 hover:underline">
                Add gates
              </Link>
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {selectableGates.map((g) => {
                  const checked = form.gates.includes(g.id)
                  return (
                    <label
                      key={g.id}
                      className={cn(
                        'inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
                        checked ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-800 hover:border-ink-300',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600"
                        checked={checked}
                        onChange={(e) => set('gates', e.target.checked ? [...form.gates, g.id] : form.gates.filter((x) => x !== g.id))}
                      />
                      {g.name}
                      {g.is_vip && <Badge tone="brand">VIP</Badge>}
                    </label>
                  )
                })}
              </div>
              <p className={cn('text-xs', errors.gates ? 'font-medium text-red-600' : 'text-ink-500')}>
                {errors.gates ?? (form.gates.length ? 'Staff at other gates will be told to send these attendees elsewhere.' : 'None selected: works at every gate.')}
              </p>
            </>
          )}
        </fieldset>

        <div className="rounded-xl border border-ink-200 p-4">
          <Switch
            checked={form.hidden}
            onChange={(v) => set('hidden', v)}
            label="Hidden — only with a promo code"
            hint="Not shown on your event page. Make a promo code that unlocks it, e.g. for sponsors or guests."
          />
        </div>
        {paymentsOn && Number(form.price || 0) > 0 && (
          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              checked={form.onlineOnly}
              onChange={(v) => set('onlineOnly', v)}
              label="Online payment only"
              hint="Buyers must pay with Khalti or eSewa; pay at the venue isn't offered for this ticket. Needs online payment turned on under Payment options."
            />
          </div>
        )}
      </form>
    </Modal>
  )
}

/* ---------- Promo codes ---------- */

function promoState(p: PromoCode): { tone: 'success' | 'neutral' | 'warning' | 'danger' | 'info'; label: string } {
  if (!p.is_active) return { tone: 'warning', label: 'Off' }
  if (p.valid_until && new Date(p.valid_until) < new Date()) return { tone: 'neutral', label: 'Expired' }
  if (p.max_uses !== null && p.used >= p.max_uses) return { tone: 'danger', label: 'Used up' }
  if (p.valid_from && new Date(p.valid_from) > new Date()) return { tone: 'info', label: `Starts ${fmtShortDate(p.valid_from)}` }
  return { tone: 'success', label: 'Active' }
}

const PromoSection: React.FC<{
  eventId: string
  types: TicketType[]
  promos: PromoCode[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  onAdd: () => void
  onEdit: (p: PromoCode) => void
}> = ({ eventId, types, promos, loading, error, onRetry, onAdd, onEdit }) => (
  <Card>
    <CardHeader
      title={
        <span className="inline-flex items-center gap-2">
          <Tag className="h-4 w-4 text-brand-600" aria-hidden />
          Promo codes
        </span>
      }
      description="Codes attendees type when they register, for a discount or to unlock hidden tickets."
      actions={
        promos.length > 0 && (
          <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onAdd}>
            Add
          </Button>
        )
      }
    />
    {loading ? (
      <div className="p-5">
        <Skeleton className="h-16 rounded-xl" />
      </div>
    ) : error ? (
      <div className="p-5">
        <ErrorState message={error.message} onRetry={onRetry} />
      </div>
    ) : promos.length === 0 ? (
      <EmptyState
        icon={<Tag className="h-6 w-6" aria-hidden />}
        title="No promo codes"
        description="For example, FRIENDS10 for 10% off, or a code that unlocks a hidden Sponsor ticket. The “Have a promo code?” box only appears on registration once you add one."
        action={
          <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onAdd}>
            Add promo code
          </Button>
        }
      />
    ) : (
      <ul className="divide-y divide-ink-100" aria-label="Promo codes">
        {promos.map((p) => (
          <PromoRow key={p.id} eventId={eventId} promo={p} types={types} onEdit={() => onEdit(p)} />
        ))}
      </ul>
    )}
  </Card>
)

const PromoRow: React.FC<{ eventId: string; promo: PromoCode; types: TicketType[]; onEdit: () => void }> = ({ eventId, promo: p, types, onEdit }) => {
  const toast = useToast()
  const invalidate = useInvalidateTickets(eventId)
  const st = promoState(p)

  const toggle = useMutation({
    mutationFn: () => ticketsApi.updatePromo(eventId, p.id, { is_active: !p.is_active }),
    onSuccess: (res) => {
      toast.success(res.is_active ? `${p.code} turned on` : `${p.code} turned off`)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't update the code", errText(e)),
  })
  const remove = useMutation({
    mutationFn: () => ticketsApi.removePromo(eventId, p.id),
    onSuccess: (res) => {
      if (res.deactivated) toast.info(`${p.code} turned off instead`, res.message)
      else toast.success(res.message || `${p.code} deleted`)
      invalidate()
    },
    onError: (e) => toast.error("Couldn't delete the code", errText(e)),
  })
  const confirmDelete = async () => {
    const ok = await toast.confirm({
      title: `Delete ${p.code}?`,
      description: p.used ? 'It has been used, so it will be turned off instead and kept on those passes.' : 'Attendees won’t be able to use it any more.',
      confirmLabel: p.used ? 'Turn off' : 'Delete',
      danger: true,
    })
    if (ok) remove.mutate()
  }
  const busy = toggle.isPending || remove.isPending

  return (
    <li className={cn('flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5', !p.is_active && 'bg-ink-50')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[15px] font-bold tracking-wide text-ink-900">{p.code}</p>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-ink-600">{promoLabel(p, types)}</p>
        <p className="mt-0.5 text-xs text-ink-500 tabular">
          Used {p.used.toLocaleString()}
          {p.max_uses !== null ? ` of ${p.max_uses.toLocaleString()}` : p.used === 1 ? ' time' : ' times'}
          {p.valid_until && ` · Valid until ${fmtDateTime(p.valid_until)}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5">
        <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={onEdit} disabled={busy} aria-label={`Edit ${p.code}`}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Power className="h-4 w-4" aria-hidden />}
          onClick={() => toggle.mutate()}
          loading={toggle.isPending}
          disabled={busy}
          aria-label={`${p.is_active ? 'Turn off' : 'Turn on'} ${p.code}`}
        >
          {p.is_active ? 'Turn off' : 'Turn on'}
        </Button>
        <IconButton label={`Delete ${p.code}`} onClick={confirmDelete} disabled={busy} className="h-8 w-8 hover:bg-red-50 hover:text-red-700">
          <Trash2 className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
    </li>
  )
}

const PROMO_FIELDS = ['code', 'discount_type', 'discount_value', 'ticket_types', 'max_uses', 'valid_from', 'valid_until']
const blankPromo = { code: '', type: 'percent' as DiscountType, value: '10', types: [] as string[], limit: false, max: '', until: '' }

const PromoModal: React.FC<{ eventId: string; editing: PromoCode | 'new' | null; types: TicketType[]; existing: PromoCode[]; onClose: () => void }> = ({
  eventId,
  editing,
  types,
  existing,
  onClose,
}) => {
  const toast = useToast()
  const invalidate = useInvalidateTickets(eventId)
  const current = editing && editing !== 'new' ? editing : null
  const [form, setForm] = useState(blankPromo)
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) return
    setErrors({})
    setFormError(null)
    if (editing === 'new') setForm({ ...blankPromo, types: [] })
    else
      setForm({
        code: editing.code,
        type: editing.discount_type,
        value: String(Number(editing.discount_value)),
        types: editing.ticket_types,
        limit: editing.max_uses !== null,
        max: editing.max_uses !== null ? String(editing.max_uses) : '',
        until: toLocalInput(editing.valid_until),
      })
  }, [editing])

  const set = <K extends keyof typeof blankPromo>(k: K, v: (typeof blankPromo)[K], errKey: string = k) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [errKey]: undefined }))
  }

  const hiddenTypes = types.filter((t) => t.is_hidden)
  const unlocksHidden = form.types.some((id) => hiddenTypes.some((t) => t.id === id))

  const preview = useMemo(() => {
    const v = Number(form.value)
    const applies = form.types.length ? types.filter((t) => form.types.includes(t.id)) : types.filter((t) => !t.is_hidden)
    return applies
      .filter((t) => Number(t.price) > 0 || form.type === 'none')
      .slice(0, 4)
      .map((t) => {
        const price = Number(t.price)
        const after = form.type === 'percent' ? price * (1 - Math.min(100, v || 0) / 100) : form.type === 'amount' ? Math.max(0, price - (v || 0)) : price
        return { name: t.name, price, after: Math.round(after * 100) / 100 }
      })
  }, [form.type, form.value, form.types, types])

  const save = useMutation({
    mutationFn: () => {
      const body: PromoCodeInput = {
        code: form.code.trim().toUpperCase(),
        discount_type: form.type,
        discount_value: form.type === 'none' ? '0' : Number(form.value).toFixed(2),
        ticket_types: form.types,
        max_uses: form.limit ? Number(form.max) : null,
        valid_until: fromLocalInput(form.until),
      }
      return current ? ticketsApi.updatePromo(eventId, current.id, body) : ticketsApi.createPromo(eventId, body)
    },
    onSuccess: (res) => {
      toast.success(current ? `${res.code} saved` : `${res.code} created`, current ? undefined : 'Share it with the people it’s for.')
      invalidate()
      onClose()
    },
    onError: (e) => {
      const { fields, message } = fieldErrorsOf(e, PROMO_FIELDS)
      const key = Object.keys(fields)[0]
      const map: Record<string, string> = { discount_value: 'value', ticket_types: 'types', max_uses: 'max', valid_until: 'until', discount_type: 'value' }
      if (key) setErrors({ [map[key] ?? key]: fields[key] })
      else setFormError(message)
      toast.error("Couldn't save the promo code", message)
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: Partial<Record<string, string>> = {}
    const code = form.code.trim().toUpperCase()
    if (!code) next.code = 'Enter a code, or press Generate.'
    else if (!/^[A-Z0-9_-]+$/.test(code)) next.code = 'Use only letters, numbers, - and _ (no spaces).'
    else if (existing.some((p) => p.code === code && p.id !== current?.id)) next.code = `There's already a code called ${code}.`
    const v = Number(form.value)
    if (form.type === 'percent' && (!form.value || Number.isNaN(v) || v <= 0 || v > 100)) next.value = 'Enter a percentage from 1 to 100.'
    if (form.type === 'amount' && (!form.value || Number.isNaN(v) || v <= 0)) next.value = 'Enter an amount greater than 0.'
    if (form.type === 'none' && !unlocksHidden) next.types = 'An unlock-only code needs at least one hidden ticket type ticked.'
    if (form.limit) {
      const m = Number(form.max)
      if (!form.max || !Number.isInteger(m) || m < 1) next.max = 'Enter a whole number, e.g. 50.'
    }
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length === 0) save.mutate()
  }

  return (
    <Modal
      open={Boolean(editing)}
      onClose={onClose}
      size="lg"
      title={current ? `Edit ${current.code}` : 'Add promo code'}
      description={current?.used ? `Used ${current.used} time${current.used === 1 ? '' : 's'}. Changes apply to new registrations.` : 'Attendees enter it on the registration page.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="promo-form" loading={save.isPending}>
            {current ? 'Save changes' : 'Create code'}
          </Button>
        </>
      }
    >
      <form id="promo-form" onSubmit={submit} noValidate className="space-y-5">
        {formError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{formError}</p>}
        <div className="flex items-start gap-2">
          <Input
            label="Code"
            required
            autoFocus
            maxLength={40}
            placeholder="e.g. FRIENDS10"
            containerClassName="min-w-0 flex-1"
            className="font-mono uppercase tracking-wide"
            value={form.code}
            error={errors.code}
            hint="Letters, numbers, - and _. Not case-sensitive."
            onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))}
          />
          <Button type="button" variant="secondary" className="mt-[26px] shrink-0" icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={() => set('code', generateCode())}>
            Generate
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink-800">What it does</p>
          <Segmented
            label="Discount type"
            value={form.type}
            onChange={(v) => set('type', v, 'value')}
            options={[
              { value: 'percent', label: '% off' },
              { value: 'amount', label: 'Rs off' },
              { value: 'none', label: 'Unlock only' },
            ]}
          />
          {form.type !== 'none' ? (
            <Input
              label={form.type === 'percent' ? 'Percent off' : 'Amount off (Rs)'}
              type="number"
              inputMode="decimal"
              min={0}
              max={form.type === 'percent' ? 100 : undefined}
              step="any"
              containerClassName="sm:max-w-[200px] pt-1"
              value={form.value}
              error={errors.value}
              onChange={(e) => set('value', e.target.value)}
            />
          ) : (
            <p className="text-xs text-ink-500">No discount. The code reveals the hidden ticket types you tick below, at their normal price.</p>
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-800">Applies to</legend>
          {types.length === 0 ? (
            <p className="text-xs text-ink-500">Add ticket types first.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((t) => {
                const checked = form.types.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
                      checked ? 'border-brand-600 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-brand-600"
                      checked={checked}
                      onChange={(e) => set('types', e.target.checked ? [...form.types, t.id] : form.types.filter((x) => x !== t.id), 'types')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-ink-900">{t.name}</span>
                        <span className="text-xs text-ink-500 tabular">{priceText(t.price)}</span>
                      </span>
                      {t.is_hidden && <span className="block text-xs text-brand-700">Hidden: this code unlocks it</span>}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          <p className={cn('text-xs', errors.types ? 'font-medium text-red-600' : 'text-ink-500')}>
            {errors.types ?? (form.types.length ? `Only the ticked ticket type${form.types.length === 1 ? '' : 's'}.` : 'None ticked: works on every visible ticket type.')}
          </p>
        </fieldset>

        {form.type !== 'none' && preview.length > 0 && Number(form.value) > 0 && (
          <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm">
            <p className="text-xs font-medium text-ink-500">With this code</p>
            <ul className="mt-1 space-y-0.5">
              {preview.map((r) => (
                <li key={r.name} className="flex justify-between gap-3 tabular">
                  <span className="text-ink-700">{r.name}</span>
                  <span>
                    <s className="text-ink-400">{priceText(r.price)}</s> <span className="font-semibold text-ink-900">{priceText(r.after)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Switch checked={form.limit} onChange={(v) => set('limit', v, 'max')} label="Limit uses" hint={form.limit ? undefined : 'Off: unlimited.'} />
            {form.limit && (
              <Input label="Max uses" type="number" inputMode="numeric" min={1} placeholder="50" value={form.max} error={errors.max} onChange={(e) => set('max', e.target.value)} />
            )}
          </div>
          <Input
            label="Valid until"
            type="datetime-local"
            hint="Optional. Leave blank to keep it valid."
            value={form.until}
            error={errors.until}
            onChange={(e) => set('until', e.target.value)}
          />
        </div>
      </form>
    </Modal>
  )
}
