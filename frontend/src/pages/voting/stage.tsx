/** Visual pieces of the public voting pages (/voting list and the contest page): stage art and countdown boxes. */
import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'

/** Fallback art when a contest has no cover: a dark stage with a spotlight and drifting sparkles. */
export const StageArt: React.FC<{ seed?: string; className?: string }> = ({ seed = '', className }) => {
  const dots = useMemo(() => {
    let h = 0
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000
    return Array.from({ length: 22 }, () => ({ x: rnd() * 400, y: rnd() * 220, r: 0.8 + rnd() * 2.2, o: 0.35 + rnd() * 0.6 }))
  }, [seed])
  const id = `st${seed.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
  return (
    <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" className={cn('h-full w-full', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b0a1f" />
          <stop offset="1" stopColor="#7a1a3c" />
        </linearGradient>
        <linearGradient id={`${id}beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9f1" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd1e0" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill={`url(#${id}bg)`} />
      <polygon points="20,0 70,0 150,220 -40,220" fill="#ffffff" opacity="0.04" />
      <polygon points="330,0 380,0 440,220 250,220" fill="#ffffff" opacity="0.04" />
      <polygon points="180,0 220,0 330,200 70,200" fill={`url(#${id}beam)`} />
      <ellipse cx="200" cy="200" rx="125" ry="12" fill="#1a0510" opacity="0.75" />
      <ellipse cx="200" cy="198" rx="118" ry="9" fill="none" stroke="#e8507f" strokeOpacity="0.5" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#f6c97a" opacity={d.o} />
      ))}
    </svg>
  )
}

/** A cover image when there is one, otherwise the stage art. */
export const ContestCover: React.FC<{ src?: string | null; seed: string; alt?: string; className?: string }> = ({ src, seed, alt = '', className }) =>
  src ? <img src={src} alt={alt} className={cn('h-full w-full object-cover', className)} loading="lazy" /> : <StageArt seed={seed} className={className} />

const pad = (n: number) => String(n).padStart(2, '0')

export function splitMs(ms: number) {
  const s = Math.floor(ms / 1000)
  return [
    [Math.floor(s / 86400), 'Days'],
    [Math.floor((s % 86400) / 3600), 'Hrs'],
    [Math.floor((s % 3600) / 60), 'Min'],
    [s % 60, 'Sec'],
  ] as const
}

/** DD : HH : MM : SS boxes. `dark` for use on the stage banner. */
export const CountdownBoxes: React.FC<{ ms: number; dark?: boolean; className?: string }> = ({ ms, dark, className }) => (
  <div className={cn('flex items-center gap-1.5', className)} role="timer" aria-label={splitMs(ms).map(([v, l]) => `${v} ${l}`).join(' ')}>
    {splitMs(ms).map(([v, l], i) => (
      <React.Fragment key={l}>
        {i > 0 && !dark && <span className="text-ink-300" aria-hidden>:</span>}
        <div
          className={cn(
            'flex min-w-[2.75rem] flex-1 flex-col items-center rounded-lg py-1.5',
            dark ? 'border border-white/25 bg-white/10 text-white backdrop-blur-sm' : 'bg-ink-50 text-ink-900',
          )}
          aria-hidden
        >
          <span className="text-lg font-bold tabular-nums leading-tight">{pad(v)}</span>
          <span className={cn('text-[9px] font-semibold uppercase tracking-wider', dark ? 'text-white/70' : 'text-ink-400')}>{l}</span>
        </div>
      </React.Fragment>
    ))}
  </div>
)
