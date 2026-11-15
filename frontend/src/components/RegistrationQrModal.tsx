import React, { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { ModernQr } from './ModernQr'
import { Copy, Download, Printer } from 'lucide-react'
import { Button, Modal, useToast } from '@/components/ui'

const SIZE = 1024 // exported PNG width: sharp on A4 posters and roll-up banners
const FONT = 'Poppins, system-ui, sans-serif'

const fileName = (title: string, ext: string) => `${title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}-registration-qr.${ext}`

function download(href: string, name: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
}

/** Modern-style QR code (dots, rounded corners, scan brackets) that opens the event's registration page, for posters and flyers. */
/** Where an event page can be opened: Eventlaya itself, plus the organizer's white-label subdomain and custom
 *  domain once they are live (each gets its own QR). */
export function useEventLinks(path: string) {
  const { data } = useQuery({ queryKey: ['tenant-branding'], queryFn: api.getTenantBranding, retry: false, staleTime: 300_000 })
  const st = data?.status
  const on = Boolean(data?.approved && st?.active && st?.module_enabled)
  const links = [{ key: 'platform', label: 'Eventlaya', url: `${window.location.origin}${path}` }]
  if (on && st?.subdomain.live && st.subdomain.url) links.push({ key: 'subdomain', label: 'Your subdomain', url: `${st.subdomain.url.replace(/\/$/, '')}${path}` })
  if (on && st?.custom_domain?.live) links.push({ key: 'custom', label: 'Your domain', url: `${st.custom_domain.url.replace(/\/$/, '')}${path}` })
  return links
}

export const RegistrationQrModal: React.FC<{
  open: boolean
  onClose: () => void
  path: string
  title: string
  /** Defaults to the registration wording */
  heading?: string
  description?: string
  /** Text printed under the QR on the poster */
  scanText?: string
  /** Shown above the QR, e.g. "not open yet" */
  notice?: React.ReactNode
}> = ({ open, onClose, path, title, heading = 'Registration QR code', description = 'Put it on posters, flyers and banners. Scanning it opens the registration page.', scanText = 'Scan to register', notice }) => {
  const toast = useToast()
  const links = useEventLinks(path)
  const [pick, setPick] = useState<string | null>(null)
  // Default to the organizer's own domain when there is one
  const chosen = links.find((l) => l.key === pick) ?? links[links.length - 1]
  const url = chosen.url
  const svgHolder = useRef<HTMLDivElement>(null)
  const svgText = () => {
    const svg = svgHolder.current?.querySelector('svg')
    return svg ? new XMLSerializer().serializeToString(svg) : null
  }

  /** PNG with the QR, the event name and the link underneath, on white. */
  const savePng = async () => {
    const text = svgText()
    if (!text) return
    const qr = new Image()
    qr.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
    await qr.decode()
    const pad = 64
    const textH = 150
    const out = document.createElement('canvas')
    out.width = SIZE + pad * 2
    out.height = SIZE + pad * 2 + textH
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(qr, pad, pad, SIZE, SIZE)
    ctx.fillStyle = '#000000'
    ctx.textAlign = 'center'
    ctx.font = `700 48px ${FONT}`
    let line = title
    while (ctx.measureText(line).width > out.width - pad * 2 && line.length > 4) line = `${line.slice(0, -2)}…`
    ctx.fillText(line, out.width / 2, SIZE + pad + 70)
    ctx.font = `400 30px ${FONT}`
    ctx.fillText(url.replace(/^https?:\/\//, ''), out.width / 2, SIZE + pad + 120)
    download(out.toDataURL('image/png'), fileName(`${title}-${chosen.key}`, 'png'))
  }

  const saveSvg = () => {
    const text = svgText()
    if (!text) return
    const blob = new Blob([text], { type: 'image/svg+xml' })
    const href = URL.createObjectURL(blob)
    download(href, fileName(`${title}-${chosen.key}`, 'svg'))
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  const print = () => {
    const svg = svgHolder.current?.innerHTML
    const w = window.open('', '_blank', 'width=700,height=900')
    if (!svg || !w) return
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{margin:0;display:flex;min-height:100vh;flex-direction:column;align-items:center;justify-content:center;font-family:${FONT};text-align:center}
      svg{width:12cm;height:12cm}h1{font-size:26pt;margin:1cm 1cm .2cm}p{font-size:13pt;margin:0}</style></head>
      <body>${svg}<h1>${esc(title)}</h1><p>${esc(scanText)} · ${esc(url.replace(/^https?:\/\//, ''))}</p></body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={heading}
      description={description}
      footer={
        <>
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={print}>
            Print
          </Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={saveSvg}>
            SVG
          </Button>
          <Button icon={<Download className="h-4 w-4" />} onClick={savePng}>
            Download PNG
          </Button>
        </>
      }
    >
      {notice}
      {links.length > 1 && (
        <div role="radiogroup" aria-label="Link" className="mb-4 flex flex-wrap justify-center gap-2">
          {links.map((l) => (
            <button key={l.key} type="button" role="radio" aria-checked={chosen.key === l.key} onClick={() => setPick(l.key)}
              className={cn('h-8 rounded-full border px-3.5 text-xs font-semibold',
                chosen.key === l.key ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400')}>
              {l.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-xl border border-ink-200 bg-white p-2">
          <ModernQr value={url} size={240} margin={5} brackets />
        </div>
        <p className="font-semibold text-ink-900">{title}</p>
        <div className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 p-1.5 pl-3">
          <span className="min-w-0 flex-1 truncate text-left text-sm text-ink-700">{url}</span>
          <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              toast.success('Link copied', url)
            } catch {
              toast.error('Couldn’t copy the link', url)
            }
          }}>Copy</Button>
        </div>
      </div>
      {/* Full-size copies used for the downloads */}
      <div className="hidden" aria-hidden>
        <div ref={svgHolder}>
          <ModernQr value={url} size={SIZE} margin={5} brackets />
        </div>
      </div>
    </Modal>
  )
}
