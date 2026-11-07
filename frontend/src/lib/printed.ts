import { request, tokenStore } from '@/services/api'

/** Printed tickets for physical sales (module offline_tickets; backend apps/events/batches.py). */
export type BatchTemplate = 'classic' | 'bold' | 'minimal' | 'custom'

export interface BatchDesign {
  layout: 'landscape' | 'vertical'
  template: BatchTemplate
  color: string
  background: string
  qr_x: number
  qr_y: number
  qr_size: number
  ticket_type: string
  price: string
}

export interface TicketBatch extends BatchDesign {
  id: string
  name: string
  quantity: number
  ticket_type_name: string
  /** Tickets of this batch already scanned in */
  used: number
  voided_at: string | null
  created_at: string
  /** PDFs come in parts of 500 */
  parts: number
}

export const PART_SIZE = 500

const base = (eventId: string) => `/events/${eventId}/ticket-batches/`

/** GET a file with the signed-in user's token and save it under the server's file name. */
async function download(url: string, fallback: string) {
  const token = tokenStore.access
  const res = await fetch(`/api${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Download failed (${res.status})`)
  }
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? fallback
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}

export const printedApi = {
  list: (eventId: string) => request<TicketBatch[]>(base(eventId)),
  create: (eventId: string, body: BatchDesign & { name: string; quantity: number }) =>
    request<TicketBatch>(base(eventId), { method: 'POST', body: JSON.stringify(body) }),
  /** PNG of a sample ticket in this design (object URL; revoke it when replaced). */
  preview: async (eventId: string, design: Partial<BatchDesign>, signal?: AbortSignal) => {
    const token = tokenStore.access
    const res = await fetch(`/api${base(eventId)}preview/`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(design),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.background?.[0] ?? 'Preview unavailable')
    return URL.createObjectURL(await res.blob())
  },
  pdf: (eventId: string, batchId: string, part: number, perPage: 'sheet' | 'single') =>
    download(`${base(eventId)}${batchId}/pdf/?part=${part}&per_page=${perPage}`, 'printed-tickets.pdf'),
  csv: (eventId: string, batchId: string) => download(`${base(eventId)}${batchId}/csv/`, 'printed-tickets.csv'),
  void: (eventId: string, batchId: string, range?: { from: number; to: number }) =>
    request<{ voided: number }>(`${base(eventId)}${batchId}/void/`, { method: 'POST', body: JSON.stringify(range ?? {}) }),
}
