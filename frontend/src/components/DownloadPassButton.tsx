import React, { useRef, useState } from 'react'
import { passPaymentLine } from '@/lib/payments'
import { ModernQrCanvas } from './ModernQr'
import { Download } from 'lucide-react'
import type { Ticket } from '@/services/api'
import { Button } from '@/components/ui'

interface PassMeta {
  ticket: Ticket
  eventTitle?: string
  eventLocation?: string
  eventDate?: string
}

interface Props extends PassMeta {
  /** Button text, default "Download pass" */
  label?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary'
  className?: string
}

// Pass image: white ticket body on the left, brand stub with the QR on the right (matches TicketPass).
const W = 1200
const H = 600
const STUB = 400
const BRAND = '#C2215A'
const INK = '#1C1724'
const MUTED = '#6B6275'
const FONT = 'Poppins, system-ui, sans-serif'
const DISPLAY = '"Bricolage Grotesque", Poppins, system-ui, sans-serif'

/** Draws text into at most `maxLines` lines of `width`, ending with an ellipsis if it doesn't fit. Returns the y after it. */
function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= width || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines) {
    let last = shown[maxLines - 1]
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1)
    shown[maxLines - 1] = `${last}…`
  }
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight))
  return y + shown.length * lineHeight
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'))
}

async function renderPass(qr: HTMLCanvasElement, p: PassMeta): Promise<Blob> {
  await document.fonts?.ready
  return p.ticket.pass_layout === 'landscape' ? renderLandscape(qr, p) : renderVertical(qr, p)
}

/** Phone-shaped pass (1080 × 1920): body on top, tear line, QR stub below. Fits a lock screen or a story. */
async function renderVertical(qr: HTMLCanvasElement, p: PassMeta): Promise<Blob> {
  const VW = 1080
  const VH = 1920
  const M = 60 // outer margin
  const SPLIT = 1090 // y of the tear line
  const canvas = document.createElement('canvas')
  canvas.width = VW
  canvas.height = VH
  const ctx = canvas.getContext('2d')!
  const t = p.ticket

  ctx.fillStyle = '#F7F5F9'
  ctx.fillRect(0, 0, VW, VH)
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, M, M, VW - 2 * M, SPLIT - M, 40)
  ctx.fillStyle = BRAND
  roundRect(ctx, M, SPLIT, VW - 2 * M, VH - M - SPLIT, 40)
  ctx.fillRect(M, SPLIT, VW - 2 * M, 40) // square the stub's top corners
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(M, SPLIT - 40, VW - 2 * M, 40) // and the body's bottom corners
  ctx.fillStyle = '#F7F5F9'
  for (const x of [M, VW - M]) {
    ctx.beginPath()
    ctx.arc(x, SPLIT, 26, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 4
  ctx.setLineDash([14, 14])
  ctx.beginPath()
  ctx.moveTo(M + 50, SPLIT + 2)
  ctx.lineTo(VW - M - 50, SPLIT + 2)
  ctx.stroke()
  ctx.setLineDash([])

  const left = M + 64
  const width = VW - 2 * M - 128
  let y = M + 110
  ctx.textBaseline = 'alphabetic'
  if (t.ticket_type_name) {
    ctx.font = `700 30px ${FONT}`
    const label = t.ticket_type_name.toUpperCase()
    const bw = ctx.measureText(label).width + 44
    ctx.fillStyle = INK
    roundRect(ctx, left, y - 42, bw, 58, 14)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(label, left + 22, y)
    y += 80
  }
  if (p.eventTitle) {
    ctx.fillStyle = BRAND
    ctx.font = `600 38px ${FONT}`
    y = drawWrapped(ctx, p.eventTitle, left, y, width, 48, 2)
  }
  ctx.fillStyle = INK
  ctx.font = `800 76px ${DISPLAY}`
  y = drawWrapped(ctx, t.attendee_name, left, y + 70, width, 84, 2) + 20

  const field = (label: string, value: string, top: number, big = false, mono = false) => {
    ctx.fillStyle = MUTED
    ctx.font = `400 28px ${FONT}`
    ctx.fillText(label, left, top)
    ctx.fillStyle = INK
    ctx.font = big ? `800 56px ${DISPLAY}` : mono ? `600 34px ui-monospace, "JetBrains Mono", monospace` : `600 36px ${FONT}`
    return drawWrapped(ctx, value, left, top + (big ? 62 : 46), width, 44, 1)
  }
  if (t.seat_number) y = field('Seat', t.seat_number, y + 16, true) + 10
  if (p.eventDate) y = field('Date', p.eventDate, y + 16) + 10
  if (p.eventLocation) y = field('Venue', p.eventLocation, y + 16) + 10
  if (y < SPLIT - 160) field('Ticket', t.ticket_number, y + 16, false, true)

  const line = passPaymentLine(t)
  if (line) {
    const text = line.text + (t.promo_code ? ` · code ${t.promo_code}` : '')
    ctx.font = `600 30px ${FONT}`
    ctx.fillStyle = line.paid ? '#ECFDF5' : '#FFF7E6'
    roundRect(ctx, left, SPLIT - 120, Math.min(width, ctx.measureText(text).width + 48), 70, 16)
    ctx.fillStyle = line.paid ? '#065F46' : '#7A4E00'
    ctx.fillText(text, left + 24, SPLIT - 74)
  }

  const tile = 560
  const tx = (VW - tile) / 2
  const ty = SPLIT + 70
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, tx, ty, tile, tile, 32)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(qr, tx + 30, ty + 30, tile - 60, tile - 60)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#FDF2F6'
  ctx.font = `500 34px ${FONT}`
  ctx.fillText('Show this at the gate', VW / 2, ty + tile + 66)
  ctx.font = `500 26px ui-monospace, "JetBrains Mono", monospace`
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillText(t.ticket_number, VW / 2, VH - M - 36)
  ctx.textAlign = 'start'

  return toPng(canvas)
}

async function renderLandscape(qr: HTMLCanvasElement, p: PassMeta): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const t = p.ticket

  // Background, ticket body and stub
  ctx.fillStyle = '#F7F5F9'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, 24, 24, W - 48 - STUB, H - 48, 28)
  ctx.fillStyle = BRAND
  roundRect(ctx, W - 24 - STUB, 24, STUB, H - 48, 28)
  // Perforation notches and dashed tear line
  ctx.fillStyle = '#F7F5F9'
  for (const y of [24, H - 24]) {
    ctx.beginPath()
    ctx.arc(W - 24 - STUB, y, 18, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 3
  ctx.setLineDash([10, 10])
  ctx.beginPath()
  ctx.moveTo(W - 24 - STUB + 2, 60)
  ctx.lineTo(W - 24 - STUB + 2, H - 60)
  ctx.stroke()
  ctx.setLineDash([])

  // Body text
  const left = 72
  const width = W - 48 - STUB - 96
  let y = 96
  ctx.textBaseline = 'alphabetic'
  if (t.ticket_type_name) {
    ctx.font = `700 22px ${FONT}`
    const label = t.ticket_type_name.toUpperCase()
    const bw = ctx.measureText(label).width + 32
    ctx.fillStyle = INK
    roundRect(ctx, left + width - bw, y - 30, bw, 42, 10)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(label, left + width - bw + 16, y)
  }
  if (p.eventTitle) {
    ctx.fillStyle = BRAND
    ctx.font = `600 26px ${FONT}`
    y = drawWrapped(ctx, p.eventTitle, left, y, width - (t.ticket_type_name ? 200 : 0), 34, 2)
  }
  ctx.fillStyle = INK
  ctx.font = `800 50px ${DISPLAY}`
  y = drawWrapped(ctx, t.attendee_name, left, y + 44, width, 56, 2) + 8

  const field = (label: string, value: string, x: number, top: number, w: number, mono = false) => {
    ctx.fillStyle = MUTED
    ctx.font = `400 20px ${FONT}`
    ctx.fillText(label, x, top)
    ctx.fillStyle = INK
    ctx.font = mono ? `600 24px ui-monospace, "JetBrains Mono", monospace` : `600 24px ${FONT}`
    return drawWrapped(ctx, value, x, top + 32, w, 30, 1)
  }
  if (p.eventDate) y = field('Date', p.eventDate, left, y + 12, width) + 6
  if (p.eventLocation) y = field('Venue', p.eventLocation, left, y + 12, width) + 6
  if (t.seat_number) {
    field('Ticket', t.ticket_number, left, y + 12, width / 2 - 12)
    field('Seat', t.seat_number, left + width / 2, y + 12, width / 2)
  } else field('Ticket', t.ticket_number, left, y + 12, width)

  const line = passPaymentLine(t)
  if (line) {
    const due = !line.paid
    const text = line.text + (t.promo_code ? ` · code ${t.promo_code}` : '')
    ctx.font = `600 22px ${FONT}`
    ctx.fillStyle = due ? '#FFF7E6' : '#ECFDF5'
    roundRect(ctx, left, H - 24 - 40 - 52, Math.min(width, ctx.measureText(text).width + 36), 52, 12)
    ctx.fillStyle = due ? '#7A4E00' : '#065F46'
    ctx.fillText(text, left + 18, H - 24 - 40 - 18)
  }

  // QR on a white tile
  const tile = 300
  const tx = W - 24 - STUB + (STUB - tile) / 2
  const ty = 90
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, tx, ty, tile, tile, 22)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(qr, tx + 18, ty + 18, tile - 36, tile - 36)
  ctx.fillStyle = '#FDF2F6'
  ctx.font = `500 22px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('Show this at the gate', W - 24 - STUB / 2, ty + tile + 48)
  ctx.font = `600 18px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText('eventlaya.com', W - 24 - STUB / 2, H - 60)
  ctx.textAlign = 'start'

  return toPng(canvas)
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/**
 * Saves the pass image. On phones the share sheet comes first ("Save image" puts it in Photos / Gallery);
 * elsewhere, or if sharing is unavailable or cancelled, it downloads as a file.
 */
async function savePass(qr: HTMLCanvasElement, p: PassMeta, share = true) {
  const blob = await renderPass(qr, p)
  const name = `eventlaya-pass-${p.ticket.ticket_number}.png`
  if (share && isPhone()) {
    const file = new File([blob], name, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: p.eventTitle ?? 'Entry pass' })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return // they closed the sheet on purpose
      }
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Saves the pass (with its QR code) as a PNG image the attendee can keep in their photos. Vertical or landscape per event. */
export const DownloadPassButton: React.FC<Props> = (props) => {
  const qrWrap = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  const download = async () => {
    const qr = qrWrap.current?.querySelector('canvas')
    if (!qr) return
    setBusy(true)
    try {
      await savePass(qr, props)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* High-resolution QR used only for the image */}
      <div ref={qrWrap} className="hidden" aria-hidden>
        <ModernQrCanvas value={props.ticket.qr_token} size={528} level="H" color={INK} margin={0} />
      </div>
      <Button
        variant={props.variant ?? 'secondary'}
        size={props.size ?? 'md'}
        className={props.className}
        loading={busy}
        icon={<Download className={props.size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />}
        onClick={download}
      >
        {props.label ?? (isPhone() ? 'Save to photos' : 'Download pass')}
      </Button>
    </>
  )
}

/** Downloads every pass as its own PNG, one after another. */
export const DownloadAllPassesButton: React.FC<Omit<Props, 'ticket' | 'label'> & { tickets: Ticket[] }> = ({ tickets, ...meta }) => {
  const qrWrap = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState<number | null>(null)

  const download = async () => {
    const canvases = Array.from(qrWrap.current?.querySelectorAll('canvas') ?? [])
    if (canvases.length !== tickets.length) return
    try {
      for (let i = 0; i < tickets.length; i++) {
        setDone(i)
        // One share sheet per pass would be tiring: several passes always download as files
        await savePass(canvases[i], { ...meta, ticket: tickets[i] }, false)
        // A short gap so the browser treats each as its own download
        if (i < tickets.length - 1) await new Promise((r) => setTimeout(r, 400))
      }
    } finally {
      setDone(null)
    }
  }

  return (
    <>
      <div ref={qrWrap} className="hidden" aria-hidden>
        {tickets.map((t) => (
          <ModernQrCanvas key={t.id} value={t.qr_token} size={528} level="H" color={INK} margin={0} />
        ))}
      </div>
      <Button
        variant={meta.variant ?? 'secondary'}
        size={meta.size ?? 'md'}
        className={meta.className}
        loading={done !== null}
        icon={<Download className={meta.size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />}
        onClick={download}
      >
        {done !== null ? `Downloading ${done + 1} of ${tickets.length}` : `Download all ${tickets.length} passes`}
      </Button>
    </>
  )
}
