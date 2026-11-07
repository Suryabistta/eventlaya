import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Download, FileSpreadsheet, Plus, Printer } from 'lucide-react'
import { useCurrentEvent } from '@/lib/event-context'
import { ticketsApi } from '@/lib/tickets'
import { PART_SIZE, printedApi, type BatchDesign, type BatchTemplate, type TicketBatch } from '@/lib/printed'
import { Badge, Button, Card, EmptyState, ErrorState, ImageUpload, Input, Modal, PageHeader, Select, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

const PAGE = 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10'
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const rs = (v: string | number) => (Number(v) ? `Rs ${Number(v).toLocaleString('en-IN')}` : 'Free')

/** Organizer → Printed tickets: bulk tickets with QR codes for shop, counter and door sales (module offline_tickets). */
export const PrintedTicketsPage: React.FC = () => {
  const { currentEvent, isLoading: eventsLoading } = useCurrentEvent()
  const eventId = currentEvent?.id
  const [creating, setCreating] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ticket-batches', eventId],
    queryFn: () => printedApi.list(eventId!),
    enabled: Boolean(eventId),
  })

  const newButton = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} disabled={!eventId}>
      New batch
    </Button>
  )

  return (
    <div className={PAGE}>
      <PageHeader
        title="Printed tickets"
        description="Bulk tickets with QR codes to sell at shops, counters and the door. Each one scans at the gate like an online pass, also offline."
        actions={newButton}
      />
      {eventsLoading || (eventId && isLoading) ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </Card>
      ) : !currentEvent ? (
        <EmptyState icon={<Printer className="h-6 w-6" />} title="Create an event first" description="Printed tickets belong to an event." />
      ) : isError ? (
        <ErrorState message="Couldn’t load printed tickets." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={<Printer className="h-6 w-6" />}
          title="No printed tickets yet"
          description={`Make a batch for each place that sells tickets for ${currentEvent.title}, for example “Bhatbhateni Dharan × 200” or “Door × 100”.`}
          action={newButton}
        />
      ) : (
        <div className="space-y-3">
          {data.map((b) => (
            <BatchRow key={b.id} eventId={currentEvent.id} batch={b} />
          ))}
        </div>
      )}
      {creating && eventId && <NewBatchModal eventId={eventId} onClose={() => setCreating(false)} />}
    </div>
  )
}

const BatchRow: React.FC<{ eventId: string; batch: TicketBatch }> = ({ eventId, batch: b }) => {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [perPage, setPerPage] = useState<'sheet' | 'single'>('sheet')
  const [voiding, setVoiding] = useState(false)

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      toast.error('Download failed', errText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900">
            {b.name} {b.voided_at && <Badge tone="danger">Voided</Badge>}
          </p>
          <p className="text-sm text-ink-500">
            {b.quantity.toLocaleString()} × {b.ticket_type_name || 'ticket'} · {rs(b.price)} · {b.layout === 'vertical' ? 'Vertical' : 'Landscape'} ·{' '}
            {new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            <span className="font-semibold tabular">{b.used.toLocaleString()}</span> of {b.quantity.toLocaleString()} scanned in
          </p>
        </div>
        {!b.voided_at && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`pp-${b.id}`}>
              Print layout
            </label>
            <select
              id={`pp-${b.id}`}
              value={perPage}
              onChange={(e) => setPerPage(e.target.value as 'sheet' | 'single')}
              className="h-9 rounded-[10px] border border-ink-200 bg-white px-2.5 text-sm"
            >
              <option value="sheet">Several per A4 sheet</option>
              <option value="single">One per page</option>
            </select>
            {Array.from({ length: b.parts }, (_, i) => i + 1).map((part) => (
              <Button
                key={part}
                size="sm"
                icon={<Download className="h-4 w-4" />}
                loading={busy === `pdf${part}`}
                disabled={busy !== null}
                onClick={() => void run(`pdf${part}`, () => printedApi.pdf(eventId, b.id, part, perPage))}
              >
                {b.parts > 1 ? `PDF ${(part - 1) * PART_SIZE + 1}–${Math.min(part * PART_SIZE, b.quantity)}` : 'Download PDF'}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              loading={busy === 'csv'}
              disabled={busy !== null}
              onClick={() => void run('csv', () => printedApi.csv(eventId, b.id))}
            >
              CSV
            </Button>
            <Button size="sm" variant="secondary" className="text-red-700" icon={<Ban className="h-4 w-4" />} onClick={() => setVoiding(true)}>
              Void
            </Button>
          </div>
        )}
      </div>
      {voiding && <VoidModal eventId={eventId} batch={b} onClose={() => setVoiding(false)} />}
    </Card>
  )
}

/** Unsold or lost tickets stop working: a returned run of numbers, or the whole batch. Used tickets are kept. */
const VoidModal: React.FC<{ eventId: string; batch: TicketBatch; onClose: () => void }> = ({ eventId, batch, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const [whole, setWhole] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const lo = Number(from)
  const hi = Number(to)
  const rangeOk = lo >= 1 && hi >= lo && hi <= batch.quantity
  const mutation = useMutation({
    mutationFn: () => printedApi.void(eventId, batch.id, whole ? undefined : { from: lo, to: hi }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['ticket-batches', eventId] })
      toast.success(`${r.voided} ticket${r.voided === 1 ? '' : 's'} voided`, 'They no longer get in at the gate.')
      onClose()
    },
    onError: (e) => toast.error('Couldn’t void tickets', errText(e)),
  })
  return (
    <Modal
      open
      onClose={onClose}
      title={`Void tickets from ${batch.name}`}
      description="Voided tickets are refused at the gate. Tickets already scanned in are never affected."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button className="bg-red-600 hover:bg-red-700" loading={mutation.isPending} disabled={!whole && !rangeOk} onClick={() => mutation.mutate()}>
            Void
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" checked={!whole} onChange={() => setWhole(false)} className="mt-1 accent-brand-600" />
          <span>
            <span className="font-medium text-ink-900">A run of numbers</span>
            <span className="block text-ink-500">For example 401 to 500, returned unsold by a shop.</span>
          </span>
        </label>
        {!whole && (
          <div className="grid grid-cols-2 gap-3 pl-6">
            <Input label="From" type="number" min={1} max={batch.quantity} value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="number" min={1} max={batch.quantity} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" checked={whole} onChange={() => setWhole(true)} className="mt-1 accent-brand-600" />
          <span>
            <span className="font-medium text-ink-900">The whole batch</span>
            <span className="block text-ink-500">Every ticket in it not yet used, for example if the print run was lost.</span>
          </span>
        </label>
      </div>
    </Modal>
  )
}

const TEMPLATES: { id: BatchTemplate; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'bold', label: 'Bold' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'custom', label: 'Own artwork' },
]

const NewBatchModal: React.FC<{ eventId: string; onClose: () => void }> = ({ eventId, onClose }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: types = [] } = useQuery({ queryKey: ['ticket-types', eventId], queryFn: () => ticketsApi.list(eventId) })
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('100')
  const [design, setDesign] = useState<BatchDesign>({
    layout: 'landscape',
    template: 'classic',
    color: '#C2215A',
    background: '',
    qr_x: 80,
    qr_y: 50,
    qr_size: 28,
    ticket_type: '',
    price: '',
  })
  const set = <K extends keyof BatchDesign>(k: K, v: BatchDesign[K]) => setDesign((d) => ({ ...d, [k]: v }))
  const [preview, setPreview] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')

  // First active ticket type and its price
  useEffect(() => {
    if (design.ticket_type || !types.length) return
    const t = types.find((x) => x.is_active) ?? types[0]
    setDesign((d) => ({ ...d, ticket_type: t.id, price: String(Number(t.price)) }))
  }, [types, design.ticket_type])

  // Live preview from the server (same renderer as the PDF), a moment after the last change
  useEffect(() => {
    if (design.template === 'custom' && !design.background) {
      setPreview(null)
      setPreviewError('Upload your artwork to see the preview.')
      return
    }
    const ctrl = new AbortController()
    const t = window.setTimeout(() => {
      printedApi
        .preview(eventId, { ...design, ticket_type: design.ticket_type || undefined, price: design.price || undefined }, ctrl.signal)
        .then((url) => {
          setPreview((old) => {
            if (old) URL.revokeObjectURL(old)
            return url
          })
          setPreviewError('')
        })
        .catch((e) => (e as Error).name !== 'AbortError' && setPreviewError(errText(e)))
    }, 350)
    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [eventId, design])

  const qty = Number(quantity)
  const valid = name.trim() && qty >= 1 && qty <= 2000 && design.ticket_type && (design.template !== 'custom' || design.background)
  const create = useMutation({
    mutationFn: () => printedApi.create(eventId, { ...design, name: name.trim(), quantity: qty, price: design.price || '0' }),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['ticket-batches', eventId] })
      toast.success(`${b.quantity} tickets ready`, 'Download the PDF and send it to print.')
      onClose()
    },
    onError: (e) => toast.error('Couldn’t create the tickets', errText(e)),
  })

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="New batch of printed tickets"
      description="Every ticket gets its own QR code. Print as many as you plan to sell at this place."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Create {qty > 0 ? qty.toLocaleString() : ''} tickets
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Input label="Sold at" required placeholder="Bhatbhateni Dharan, Door, Counter 1" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Ticket type"
              value={design.ticket_type}
              onChange={(e) => {
                const t = types.find((x) => x.id === e.target.value)
                setDesign((d) => ({ ...d, ticket_type: e.target.value, price: t ? String(Number(t.price)) : d.price }))
              }}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Input label="How many" type="number" min={1} max={2000} hint="Up to 2,000 per batch" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <Input label="Printed price (Rs)" type="number" min={0} hint="Paid at the shop or counter; nothing is collected at the gate" value={design.price} onChange={(e) => set('price', e.target.value)} />
          <Select label="Shape" value={design.layout} onChange={(e) => set('layout', e.target.value as BatchDesign['layout'])}>
            <option value="landscape">Landscape (3 per A4)</option>
            <option value="vertical">Vertical (6 per A4)</option>
          </Select>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-800">Design</legend>
            <div className="grid grid-cols-4 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={design.template === t.id}
                  onClick={() => set('template', t.id)}
                  className={cn(
                    'h-10 rounded-lg border text-sm font-medium',
                    design.template === t.id ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:bg-ink-50',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>
          {design.template === 'custom' ? (
            <>
              <ImageUpload
                label="Your artwork"
                kind="banner"
                hint={design.layout === 'vertical' ? 'Tall image, about 1:2 (e.g. 800 × 1600)' : 'Wide image, about 5:2 (e.g. 2000 × 800)'}
                value={design.background || null}
                onChange={(url) => set('background', url ?? '')}
              />
              {(
                [
                  ['qr_x', 'QR across', 0, 100],
                  ['qr_y', 'QR down', 0, 100],
                  ['qr_size', 'QR size', 10, 60],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key} className="block text-sm">
                  <span className="flex justify-between font-medium text-ink-800">
                    {label} <span className="tabular text-ink-500">{design[key]}%</span>
                  </span>
                  <input type="range" min={min} max={max} value={design[key]} onChange={(e) => set(key, Number(e.target.value))} className="w-full accent-brand-600" />
                </label>
              ))}
            </>
          ) : (
            <label className="flex items-center gap-3 text-sm font-medium text-ink-800">
              Colour
              <input type="color" value={design.color} onChange={(e) => set('color', e.target.value.toUpperCase())} className="h-9 w-14 cursor-pointer rounded border border-ink-200" />
            </label>
          )}
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl bg-ink-100 p-4">
          {preview ? (
            <img src={preview} alt="Preview of a printed ticket" className={cn('rounded shadow-md', design.layout === 'vertical' ? 'max-h-[460px]' : 'w-full')} />
          ) : (
            <p className="p-8 text-center text-sm text-ink-500">{previewError || 'Loading preview…'}</p>
          )}
          <p className="mt-3 text-center text-xs text-ink-500">Sample ticket. Each printed ticket gets its own number and QR code.</p>
        </div>
      </div>
    </Modal>
  )
}

export default PrintedTicketsPage
