import React from 'react'
import { cn } from '@/lib/utils'
import { useSiteBranding } from '@/lib/site-branding'

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
  const { data: brand } = useSiteBranding()
  if (compact) return <LogoMark className={className} />
  // Uploaded by the superadmin: on dark backgrounds prefer the light version, else the main logo
  const custom = (inverted && brand?.logo_white) || brand?.logo
  if (custom) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <img src={custom} alt="Eventlaya" className={cn('w-auto max-w-[220px] select-none object-contain', tagline ? 'h-12' : 'h-9')} draggable={false} />
      </span>
    )
  }
  const file = `logo${tagline ? '-tagline' : ''}${inverted ? '-white' : ''}.png`
  return (
    <span className={cn('inline-flex items-center', className)}>
      {/* width/height: intrinsic size so the browser reserves the space (CSS sets the shown size) */}
      <img src={`/brand/${file}`} alt="Eventlaya" width={tagline ? 985 : 836} height={tagline ? 320 : 240} className={cn('w-auto select-none', tagline ? 'h-12' : 'h-9')} draggable={false} />
    </span>
  )
}
