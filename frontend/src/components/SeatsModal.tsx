import React, { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Search } from 'lucide-react'
import { api, type Ticket } from '@/services/api'
import { Button, Modal, useToast } from '@/components/ui'

type Errors = Awaited<ReturnType<typeof api.assignSeats>>['errors']

/** Minimal CSV reader: commas, quoted fields with "" escapes, CRLF. Enough for spreadsheet exports. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) rows.push([...row, cell])
  return rows.filter((r) => r.some((v) => v.trim()))
}

/** Rows {ticket, seat} from a CSV with a header row naming a ticket (or email) column and a seat column. */
function seatsFromCsv(text: string): { rows: { ticket: string; seat: string }[]; error?: string } {
  const [header, ...body] = parseCsv(text)
  if (!header) return { rows: [], error: 'The file is empty.' }
  const cols = header.map((h) => h.trim().toLowerCase())
  const ticketCol = cols.findIndex((c) => c.includes('ticket'))
  const emailCol = cols.findIndex((c) => c.includes('email'))
  const seatCol = cols.findIndex((c) => c.includes('seat'))
  const refCol = ticketCol >= 0 ? ticketCol : emailCol
  if (refCol < 0 || seatCol < 0) return { rows: [], error: 'Use a header row with a “Ticket” (or “Email”) column and a “Seat” column.' }
  return { rows: body.map((r) => ({ ticket: (r[refCol] ?? '').trim(), seat: (r[seatCol] ?? '').trim() })).filter((r) => r.ticket) }
}

/** Organizer: assign seat numbers one by one or import a CSV (module `seat_numbers`). */
export const SeatsModal: React.FC<{ open: boolean; onClose: () => void; eventId: string; tickets: Ticket[] }> = ({ open, onClose, eventId, tickets }) => {
  const toast = useToast()
  const qc = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Errors>([])

  const active = useMemo(() => tickets.filter((t) => t.status !== 'cancelled'), [tickets])
  const q = search.trim().toLowerCase()
  const shown = active.filter((t) => !q || `${t.attendee_name} ${t.attendee_email} ${t.ticket_number} ${t.seat_number ?? ''}`.toLowerCase().includes(q))
  const changed = Object.entries(edits).filter(([id, seat]) => seat !== (active.find((t) => t.id === id)?.seat_number ?? ''))

  const send = async (rows: { ticket: string; seat: string }[]) => {
    setSaving(true)
    try {
      const res = await api.assignSeats(eventId, rows)
      setErrors(res.errors)
      void qc.invalidateQueries({ queryKey: ['tickets', eventId] })
      if (res.updated) toast.success(`${res.updated} seat${res.updated === 1 ? '' : 's'} saved`)
      if (!res.errors.length) {
        setEdits({})
        return true
      }
    } catch (e) {
      toast.error('Couldn’t save seats', (e as Error).message)
    } finally {
      setSaving(false)
    }
    return false
  }

  const saveEdits = async () => {
    const rows = changed.map(([id, seat]) => ({ ticket: active.find((t) => t.id === id)!.ticket_number, seat: seat.trim() }))
    if (await send(rows)) onClose()
  }

  const importCsv = async (f: File | undefined) => {
    if (!f) return
    const { rows, error } = seatsFromCsv(await f.text())
    if (file.current) file.current.value = ''
    if (error || !rows.length) {
      toast.error('Couldn’t read the file', error ?? 'No rows with a ticket and seat.')
      return
    }
    await send(rows)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Seat numbers"
      description="Type seats one by one, or import a CSV with a Ticket (or Email) column and a Seat column. Leave a seat empty to clear it."
      footer={
        <>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void importCsv(e.target.files?.[0])} />
          <Button variant="secondary" icon={<FileUp className="h-4 w-4" />} disabled={saving} onClick={() => file.current?.click()}>
            Import CSV
          </Button>
          <Button loading={saving} disabled={!changed.length} onClick={() => void saveEdits()}>
            Save {changed.length || ''} {changed.length === 1 ? 'seat' : 'seats'}
          </Button>
        </>
      }
    >
      {errors.length > 0 && (
        <div role="alert" className="mb-4 max-h-40 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">{errors.length} not saved</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                {e.row ? `Row ${e.row}: ` : ''}
                {e.ticket}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="relative mb-3 block">
        <span className="sr-only">Search attendees</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, email, ticket or seat"
          className="h-9 w-full rounded-[10px] border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </label>
      <ul className="max-h-[50vh] divide-y divide-ink-100 overflow-auto rounded-lg border border-ink-200">
        {shown.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium text-ink-900">{t.attendee_name}</p>
              <p className="truncate font-mono text-xs text-ink-500">{t.ticket_number}</p>
            </div>
            <input
              aria-label={`Seat for ${t.attendee_name}`}
              value={edits[t.id] ?? t.seat_number ?? ''}
              maxLength={20}
              placeholder="Seat"
              onChange={(e) => setEdits((s) => ({ ...s, [t.id]: e.target.value }))}
              className="h-9 w-28 rounded-lg border border-ink-200 px-2.5 text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </li>
        ))}
        {!shown.length && <li className="px-3 py-6 text-center text-sm text-ink-500">No attendees match.</li>}
      </ul>
    </Modal>
  )
}
