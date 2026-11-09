import React, { useRef } from 'react'
import { ModernQr } from './ModernQr'
import { Download, Printer } from 'lucide-react'
import { Button, Modal } from '@/components/ui'

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
export const RegistrationQrModal: React.FC<{ open: boolean; onClose: () => void; url: string; title: string }> = ({ open, onClose, url, title }) => {
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
    download(out.toDataURL('image/png'), fileName(title, 'png'))
  }

  const saveSvg = () => {
    const text = svgText()
    if (!text) return
    const blob = new Blob([text], { type: 'image/svg+xml' })
    const href = URL.createObjectURL(blob)
    download(href, fileName(title, 'svg'))
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
      <body>${svg}<h1>${esc(title)}</h1><p>Scan to register · ${esc(url.replace(/^https?:\/\//, ''))}</p></body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registration QR code"
      description="Put it on posters, flyers and banners. Scanning it opens the registration page."
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
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="rounded-xl border border-ink-200 bg-white p-2">
          <ModernQr value={url} size={240} />
        </div>
        <p className="font-semibold text-ink-900">{title}</p>
        <p className="break-all text-sm text-ink-500">{url}</p>
      </div>
      {/* Full-size copies used for the downloads */}
      <div className="hidden" aria-hidden>
        <div ref={svgHolder}>
          <ModernQr value={url} size={SIZE} />
        </div>
      </div>
    </Modal>
  )
}
