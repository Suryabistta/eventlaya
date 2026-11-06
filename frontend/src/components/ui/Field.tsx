import React, { useId } from 'react'
import { cn } from '@/lib/utils'

export const controlClass =
  'block w-full rounded-[10px] border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 shadow-2xs transition-colors hover:border-ink-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-50 disabled:text-ink-500'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode
}

/** Label + control + hint/error, wired together for screen readers. */
export const Field: React.FC<FieldProps> = ({ label, hint, error, required, className, children }) => {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
        {required && <span className="ml-0.5 text-brand-600" aria-hidden>*</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  )
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; containerClassName?: string }

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, required, className, containerClassName, ...props }, ref) => (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {(a11y) => <input ref={ref} required={required} className={cn(controlClass, className)} {...a11y} {...props} />}
    </Field>
  ),
)
Input.displayName = 'Input'

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string; containerClassName?: string }

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, required, className, containerClassName, ...props }, ref) => (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {(a11y) => <textarea ref={ref} required={required} className={cn(controlClass, 'min-h-[88px]', className)} {...a11y} {...props} />}
    </Field>
  ),
)
Textarea.displayName = 'Textarea'

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; containerClassName?: string }

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, required, className, containerClassName, children, ...props }, ref) => (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {(a11y) => (
        <select ref={ref} required={required} className={cn(controlClass, 'pr-8', className)} {...a11y} {...props}>
          {children}
        </select>
      )}
    </Field>
  ),
)
Select.displayName = 'Select'
