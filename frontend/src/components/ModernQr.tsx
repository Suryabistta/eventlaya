import React, { forwardRef, useEffect, useMemo, useRef } from 'react'
import qrcode from 'qrcode-generator'

/**
 * Every QR on Eventlaya in one style: round dots, rounded corner squares and, where there's room, scan
 * brackets around the code. Full-size dots (r = 0.5 module) scan as reliably as square modules, even small.
 * `ModernQr` draws SVG (screens, print, SVG download); `ModernQrCanvas` draws a <canvas> for PNG exports.
 */
type Level = 'L' | 'M' | 'Q' | 'H'

interface QrOptions {
  value: string
  /** Error correction; Q by default (dots lose a little contrast) */
  level?: Level
  color?: string
  /** White modules around the code; 0 for a QR placed inside its own white tile */
  margin?: number
  /** Scan brackets in the corners; needs a margin of 3 or more */
  brackets?: boolean
}

interface Geometry {
  box: number
  quiet: number
  dots: [number, number][]
  finders: [number, number][]
  brackets: string[]
}

function geometry({ value, level = 'Q', margin = 4, brackets = false }: QrOptions): Geometry {
  const qr = qrcode(0, level)
  qr.addData(value)
  qr.make()
  const n = qr.getModuleCount()
  const finders: [number, number][] = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]
  const inFinder = (r: number, c: number) => finders.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7)
  const dots: [number, number][] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c) && !inFinder(r, c)) dots.push([r, c])
  const quiet = brackets ? Math.max(margin, 3) : margin
  const box = n + quiet * 2
  const paths: string[] = []
  if (brackets) {
    const b = Math.min(1.2, quiet / 3)
    const len = Math.max(3, n * 0.22)
    const e = box - b
    paths.push(
      `M${b} ${b + len}V${b + 1}Q${b} ${b} ${b + 1} ${b}H${b + len}`,
      `M${e - len} ${b}H${e - 1}Q${e} ${b} ${e} ${b + 1}V${b + len}`,
      `M${b} ${e - len}V${e - 1}Q${b} ${e} ${b + 1} ${e}H${b + len}`,
      `M${e - len} ${e}H${e - 1}Q${e} ${e} ${e} ${e - 1}V${e - len}`,
    )
  }
  return { box, quiet, dots, finders, brackets: paths }
}

export const ModernQr = forwardRef<
  SVGSVGElement,
  QrOptions & { size: number; className?: string; background?: string; 'aria-label'?: string }
>(({ size, className, background = '#ffffff', color = '#111111', 'aria-label': label = 'QR code', ...opts }, ref) => {
  const g = useMemo(() => geometry(opts), [opts.value, opts.level, opts.margin, opts.brackets]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${g.box} ${g.box}`} width={size} height={size} className={className} role="img" aria-label={label}>
      <rect width={g.box} height={g.box} fill={background} />
      {g.brackets.map((d) => (
        <path key={d} d={d} fill="none" stroke={color} strokeWidth={0.45} strokeLinecap="round" />
      ))}
      {g.finders.map(([r, c]) => (
        <g key={`${r}-${c}`}>
          <rect x={c + g.quiet + 0.5} y={r + g.quiet + 0.5} width={6} height={6} rx={1.8} fill="none" stroke={color} strokeWidth={1} />
          <rect x={c + g.quiet + 2} y={r + g.quiet + 2} width={3} height={3} rx={0.9} fill={color} />
        </g>
      ))}
      {g.dots.map(([r, c]) => (
        <circle key={`${r}-${c}`} cx={c + g.quiet + 0.5} cy={r + g.quiet + 0.5} r={0.5} fill={color} />
      ))}
    </svg>
  )
})
ModernQr.displayName = 'ModernQr'

/** Draws the same QR on a 2D canvas at (x, y), `size` pixels square. */
export function drawModernQr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, opts: QrOptions & { background?: string | null }) {
  const g = geometry(opts)
  const u = size / g.box
  const color = opts.color ?? '#111111'
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(u, u)
  if (opts.background !== null) {
    ctx.fillStyle = opts.background ?? '#ffffff'
    ctx.fillRect(0, 0, g.box, g.box)
  }
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = 0.45
  for (const d of g.brackets) ctx.stroke(new Path2D(d))
  ctx.lineWidth = 1
  for (const [r, c] of g.finders) {
    ctx.beginPath()
    ctx.roundRect(c + g.quiet + 0.5, r + g.quiet + 0.5, 6, 6, 1.8)
    ctx.stroke()
    ctx.beginPath()
    ctx.roundRect(c + g.quiet + 2, r + g.quiet + 2, 3, 3, 0.9)
    ctx.fill()
  }
  ctx.beginPath()
  for (const [r, c] of g.dots) {
    ctx.moveTo(c + g.quiet + 1, r + g.quiet + 0.5)
    ctx.arc(c + g.quiet + 0.5, r + g.quiet + 0.5, 0.5, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.restore()
}

/** Canvas version, for code that turns the QR into a PNG (finds it with querySelector('canvas')). */
export const ModernQrCanvas: React.FC<QrOptions & { size: number; className?: string; background?: string; 'aria-label'?: string; role?: string }> = ({
  size,
  className,
  background,
  'aria-label': label,
  role,
  ...opts
}) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size, size)
    drawModernQr(ctx, 0, 0, size, { ...opts, background })
  }, [size, background, opts.value, opts.level, opts.color, opts.margin, opts.brackets]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} width={size} height={size} className={className} aria-label={label} role={role} />
}
