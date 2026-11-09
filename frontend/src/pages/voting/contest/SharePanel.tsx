import React, { useRef, useState } from 'react'
import { shareClickTracker } from '@/lib/analytics'
import { ModernQrCanvas } from '@/components/ModernQr'
import { Copy, Download, Facebook, MessageCircle, Send, Share2 } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { contestantPath, shareUrl } from './api'

interface ShareTarget {
  eventSlug: string
  eventTitle: string
  contestRef: string
  contestTitle: string
  /** Omit to share the contest page itself */
  contestant?: { number: number | null; slug: string; name: string; display_number: string; photo_url?: string }
}

const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** Share links (Facebook, Messenger, WhatsApp, Viber, copy, native share) + a downloadable share card. */
export const SharePanel: React.FC<ShareTarget & { className?: string; compact?: boolean }> = ({ className, compact, ...t }) => {
  const toast = useToast()
  const url = shareUrl(t.eventSlug, t.contestRef, t.contestant)
  const text = t.contestant
    ? `Vote for ${t.contestant.display_number} ${t.contestant.name} in ${t.contestTitle}!`.replace(/\s+/g, ' ')
    : `Vote in ${t.contestTitle}!`
  const enc = encodeURIComponent

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied', 'Paste it in a chat or post.')
    } catch {
      toast.error('Couldn’t copy the link', url)
    }
  }

  const nativeShare = async () => {
    try {
      await navigator.share({ title: t.contestTitle, text, url })
    } catch {
      /* cancelled */
    }
  }

  const messenger = () => {
    if (isMobile()) window.location.href = `fb-messenger://share?link=${enc(url)}`
    // Desktop: Messenger's send dialog needs a Facebook app id, so fall back to the Facebook share dialog
    else window.open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, '_blank', 'noopener')
  }

  const linkClass =
    'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-800 transition-colors hover:border-ink-300 hover:bg-ink-50'

  return (
    <div className={cn('space-y-3', className)} onClickCapture={shareClickTracker(t.contestant ? 'contestant' : 'contest', t.contestant ? `${t.contestRef}#${t.contestant.number ?? ''}` : t.contestRef)}>
      {!compact && <p className="text-sm font-semibold text-ink-900">{t.contestant ? `Ask friends to vote for ${t.contestant.name}` : 'Share this contest'}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <a className={linkClass} href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`} target="_blank" rel="noreferrer">
          <Facebook className="h-4 w-4 text-[#1877F2]" aria-hidden />
          Facebook
        </a>
        <button type="button" className={linkClass} onClick={messenger}>
          <MessageCircle className="h-4 w-4 text-[#0084FF]" aria-hidden />
          Messenger
        </button>
        <a className={linkClass} href={`https://wa.me/?text=${enc(`${text} ${url}`)}`} target="_blank" rel="noreferrer">
          <Send className="h-4 w-4 text-[#25D366]" aria-hidden />
          WhatsApp
        </a>
        <a className={linkClass} href={`viber://forward?text=${enc(`${text} ${url}`)}`}>
          <Send className="h-4 w-4 text-[#7360F2]" aria-hidden />
          Viber
        </a>
        <button type="button" className={linkClass} onClick={copy}>
          <Copy className="h-4 w-4" aria-hidden />
          Copy link
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button type="button" className={linkClass} onClick={nativeShare}>
            <Share2 className="h-4 w-4" aria-hidden />
            More…
          </button>
        )}
      </div>
      {t.contestant && <ShareCardButton {...t} contestant={t.contestant} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Share card (PNG, 1080×1350 — a portrait post for Facebook/Instagram) */

const W = 1080
const H = 1350
const BRAND = '#C2215A'
const INK = '#1C1724'
const FONT = 'Poppins, system-ui, sans-serif'
const DISPLAY = '"Bricolage Grotesque", Poppins, system-ui, sans-serif'

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lh: number, max: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width <= width || !line) line = next
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  const shown = lines.slice(0, max)
  if (lines.length > max) {
    let last = shown[max - 1]
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1)
    shown[max - 1] = `${last}…`
  }
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lh))
  return y + shown.length * lh
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function brandColor() {
  // White-label sites override --brand-600 ("r g b")
  const v = getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim()
  return v && /^\d+\s+\d+\s+\d+$/.test(v) ? `rgb(${v.split(/\s+/).join(',')})` : BRAND
}

async function renderCard(qr: HTMLCanvasElement, t: ShareTarget & { contestant: NonNullable<ShareTarget['contestant']> }): Promise<Blob> {
  await document.fonts?.ready
  const c = t.contestant
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const brand = brandColor()

  // Photo, cover-cropped to the top part
  const photoH = 860
  ctx.fillStyle = '#F1ECF3'
  ctx.fillRect(0, 0, W, H)
  const img = c.photo_url ? await loadImage(c.photo_url) : null
  if (img) {
    const scale = Math.max(W / img.width, photoH / img.height)
    const sw = W / scale
    const sh = photoH / scale
    const sx = (img.width - sw) / 2
    const sy = Math.max(0, (img.height - sh) / 4) // favour faces near the top
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, photoH)
  } else {
    ctx.fillStyle = brand
    ctx.fillRect(0, 0, W, photoH)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = `800 260px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.fillText(c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''), W / 2, photoH / 2 + 90)
    ctx.textAlign = 'start'
  }
  // Fade into the panel
  const g = ctx.createLinearGradient(0, photoH - 260, 0, photoH)
  g.addColorStop(0, 'rgba(28,23,36,0)')
  g.addColorStop(1, 'rgba(28,23,36,0.85)')
  ctx.fillStyle = g
  ctx.fillRect(0, photoH - 260, W, 260)

  // Number badge on the photo
  if (c.display_number) {
    ctx.font = `800 96px ${DISPLAY}`
    const bw = ctx.measureText(c.display_number).width + 64
    ctx.fillStyle = brand
    ctx.beginPath()
    ctx.roundRect(56, photoH - 170, bw, 124, 28)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(c.display_number, 88, photoH - 76)
  }

  // Bottom panel
  ctx.fillStyle = INK
  ctx.fillRect(0, photoH, W, H - photoH)
  const qrSize = 300
  const qrX = W - 56 - qrSize
  const qrY = photoH + 70
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath()
  ctx.roundRect(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40, 24)
  ctx.fill()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(qr, qrX, qrY, qrSize, qrSize)
  ctx.imageSmoothingEnabled = true

  const left = 56
  const width = qrX - 40 - left - 20
  ctx.fillStyle = '#F9A8C9'
  ctx.font = `700 36px ${FONT}`
  ctx.fillText('VOTE FOR', left, photoH + 104)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `800 70px ${DISPLAY}`
  let y = wrap(ctx, c.name, left, photoH + 184, width, 76, 2)
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = `500 32px ${FONT}`
  y = wrap(ctx, t.contestTitle, left, y + 16, width, 40, 2)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `400 26px ${FONT}`
  wrap(ctx, `${t.eventTitle} · Scan to vote`, left, Math.min(y + 12, H - 60), width, 34, 1)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'))
}

const ShareCardButton: React.FC<ShareTarget & { contestant: NonNullable<ShareTarget['contestant']> }> = (t) => {
  const qrWrap = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const pageUrl = `${window.location.origin}${contestantPath(t.eventSlug, t.contestRef, t.contestant)}`

  const download = async () => {
    const qr = qrWrap.current?.querySelector('canvas')
    if (!qr) return
    setBusy(true)
    try {
      const blob = await renderCard(qr, t)
      const file = new File([blob], `vote-${(t.contestant.display_number || t.contestant.slug).replace(/[^a-z0-9]/gi, '')}-${t.contestant.slug || 'card'}.png`, { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.success('Share card saved', 'Post it on Facebook, Instagram or your story.')
    } catch {
      toast.error('Couldn’t make the share card', 'Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div ref={qrWrap} className="hidden" aria-hidden>
        <ModernQrCanvas value={pageUrl} size={600} level="M" color={INK} margin={0} />
      </div>
      <Button variant="secondary" className="w-full" loading={busy} icon={<Download className="h-4 w-4" aria-hidden />} onClick={download}>
        Download share card
      </Button>
    </>
  )
}
