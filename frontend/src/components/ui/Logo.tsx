import React from 'react'
import { cn } from '@/lib/utils'

export const LogoMark: React.FC<{ className?: string }> = ({ className }) => (
  <img src="/icon-192.png" alt="" aria-hidden width={192} height={192} className={cn('h-9 w-9 select-none', className)} draggable={false} />
)

/** Eventlaya wordmark (इभेन्टलय). `tagline` adds "Every Event, Every Voice"; `inverted` is for dark backgrounds. */
export const Logo: React.FC<{ className?: string; inverted?: boolean; compact?: boolean; tagline?: boolean }> = ({
  className,
  inverted,
  compact,
  tagline,
}) => {
  if (compact) return <LogoMark className={className} />
  const file = `logo${tagline ? '-tagline' : ''}${inverted ? '-white' : ''}.png`
  return (
    <span className={cn('inline-flex items-center', className)}>
      {/* width/height: intrinsic size so the browser reserves the space (CSS sets the shown size) */}
      <img src={`/brand/${file}`} alt="Eventlaya" width={tagline ? 985 : 836} height={tagline ? 320 : 240} className={cn('w-auto select-none', tagline ? 'h-12' : 'h-9')} draggable={false} />
    </span>
  )
}
