/** Small form building blocks shared by the contest builder and dashboard. */
import React, { useId } from 'react'
import { Info } from 'lucide-react'
import { Card, controlClass } from '@/components/ui'
import { cn } from '@/lib/utils'

export const Section: React.FC<{ id?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }> = ({
  id,
  title,
  description,
  actions,
  children,
}) => (
  <Card id={id} className="scroll-mt-24">
    <section className="space-y-4 p-5 sm:p-6" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  </Card>
)

export const Toggle: React.FC<{ label: string; hint?: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({
  label,
  hint,
  checked,
  onChange,
  disabled,
}) => (
  <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-3 hover:bg-ink-50', disabled && 'cursor-not-allowed opacity-60')}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500/30"
    />
    <span className="min-w-0">
      <span className="block text-sm font-medium text-ink-900">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
    </span>
  </label>
)

export const ChoiceGroup: React.FC<{
  legend: string
  name: string
  value: string
  options: { value: string; label: string; hint?: React.ReactNode }[]
  onChange: (v: string) => void
  columns?: string
}> = ({ legend, name, value, options, onChange, columns = 'md:grid-cols-2 2xl:grid-cols-3' }) => (
  <fieldset>
    <legend className="mb-2 text-sm font-medium text-ink-800">{legend}</legend>
    <div className={cn('grid gap-2', columns)}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
            value === o.value ? 'border-brand-500 bg-brand-50/60' : 'border-ink-200 bg-white hover:bg-ink-50',
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-0.5 h-4 w-4 shrink-0 border-ink-300 text-brand-600 focus:ring-brand-500/30"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-900">{o.label}</span>
            {o.hint && <span className="mt-0.5 block text-xs text-ink-500">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
)

/** Optional whole number: empty = "no limit" (null). */
export const LimitField: React.FC<{
  label: string
  hint?: string
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  min?: number
  className?: string
}> = ({ label, hint, value, onChange, placeholder = 'No limit', min = 1, className }) => {
  const id = useId()
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(min, Math.floor(Number(e.target.value))))}
        className={controlClass}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

export const Note: React.FC<{ tone?: 'info' | 'warning'; children: React.ReactNode; className?: string }> = ({ tone = 'info', children, className }) => (
  <div
    className={cn(
      'flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm',
      tone === 'info' ? 'bg-sky-50 text-sky-900' : 'bg-marigold-50 text-marigold-900',
      className,
    )}
  >
    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <div className="min-w-0">{children}</div>
  </div>
)

export function toLocalInput(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

/** Shown when the superadmin switched a module off (API answered 403 module_disabled). */
export const ModuleOff: React.FC<{ title: string; description: string; action?: React.ReactNode }> = ({ title, description, action }) => (
  <Card className="flex flex-col items-center px-6 py-12 text-center">
    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
      <Info className="h-6 w-6" aria-hidden />
    </div>
    <p className="font-semibold text-ink-900">{title}</p>
    <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </Card>
)

export const isModuleOff = (e: unknown) => (e as { code?: string } | null)?.code === 'module_disabled'
