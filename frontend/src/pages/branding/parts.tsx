import React, { useEffect, useId, useState } from 'react'
import { controlClass } from '@/components/ui'
import { cn } from '@/lib/utils'

export const HEX = /^#[0-9a-fA-F]{6}$/

export const ColorField: React.FC<{ label: string; hint: string; value: string; onChange: (v: string) => void }> = ({ label, hint, value, onChange }) => {
  const id = useId()
  const valid = HEX.test(value)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-10 shrink-0 cursor-pointer rounded-[10px] border border-ink-200 bg-white p-1"
        />
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!valid || undefined}
          aria-describedby={`${id}-hint`}
          maxLength={7}
          className={cn(controlClass, 'font-mono uppercase', !valid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20')}
        />
      </div>
      <p id={`${id}-hint`} className={cn('text-xs', valid ? 'text-ink-500' : 'font-medium text-red-600')}>
        {valid ? hint : 'Use a 6-digit hex code like #C2215A'}
      </p>
    </div>
  )
}

export const LogoThumb: React.FC<{ src: string; name: string; color: string; className?: string }> = ({ src, name, color, className }) => {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (src && !broken) {
    return <img src={src} alt="" onError={() => setBroken(true)} className={cn('shrink-0 rounded-lg border border-ink-200 object-cover', className)} />
  }
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white', className)}
      style={{ backgroundColor: HEX.test(color) ? color : '#C2215A' }}
    >
      {(name || 'E').charAt(0).toUpperCase()}
    </span>
  )
}

export const Switch: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  labelledBy: string
  disabled?: boolean
}> = ({ checked, onChange, labelledBy, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={labelledBy}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
      checked ? 'bg-brand-600' : 'bg-ink-300',
    )}
  >
    <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow-xs transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
  </button>
)
