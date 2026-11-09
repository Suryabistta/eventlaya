import React, { forwardRef, useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * Event QR in the modern style: round dots, rounded corner squares and scan brackets around the code.
 * Error correction Q keeps it readable with dots. For posters and flyers only; tickets keep the plain
 * square QR so gate scanning stays fast in bad light.
 */
export const ModernQr = forwardRef<SVGSVGElement, { value: string; size: number; color?: string; className?: string }>(
  ({ value, size, color = '#111111', className }, ref) => {
    const { n, dots } = useMemo(() => {
      const qr = qrcode(0, 'Q')
      qr.addData(value)
      qr.make()
      const n = qr.getModuleCount()
      const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
      const dots: [number, number][] = []
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c) && !inFinder(r, c)) dots.push([r, c])
      return { n, dots }
    }, [value])

    const quiet = 5 // modules of white around the code; the brackets sit in its outer edge
    const box = n + quiet * 2
    const finder = (r: number, c: number) => {
      const x = c + quiet
      const y = r + quiet
      return (
        <g key={`${r}-${c}`}>
          <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.8} fill="none" stroke={color} strokeWidth={1} />
          <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill={color} />
        </g>
      )
    }
    // Scan brackets in the four corners of the quiet zone
    const b = 1.2
    const len = Math.max(3, n * 0.22)
    const e = box - b
    const brackets = [
      `M${b} ${b + len}V${b + 1}Q${b} ${b} ${b + 1} ${b}H${b + len}`,
      `M${e - len} ${b}H${e - 1}Q${e} ${b} ${e} ${b + 1}V${b + len}`,
      `M${b} ${e - len}V${e - 1}Q${b} ${e} ${b + 1} ${e}H${b + len}`,
      `M${e - len} ${e}H${e - 1}Q${e} ${e} ${e} ${e - 1}V${e - len}`,
    ]
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${box} ${box}`}
        width={size}
        height={size}
        className={className}
        role="img"
        aria-label="QR code"
      >
        <rect width={box} height={box} fill="#ffffff" />
        {brackets.map((d) => (
          <path key={d} d={d} fill="none" stroke={color} strokeWidth={0.45} strokeLinecap="round" />
        ))}
        {finder(0, 0)}
        {finder(0, n - 7)}
        {finder(n - 7, 0)}
        {dots.map(([r, c]) => (
          <circle key={`${r}-${c}`} cx={c + quiet + 0.5} cy={r + quiet + 0.5} r={0.5} fill={color} />
        ))}
      </svg>
    )
  },
)
ModernQr.displayName = 'ModernQr'
