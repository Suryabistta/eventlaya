import React from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-[10px] transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none'

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-xs',
  secondary: 'bg-white text-ink-800 border border-ink-200 hover:border-ink-300 hover:bg-ink-50 shadow-2xs',
  ghost: 'text-ink-600 hover:text-ink-900 hover:bg-ink-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-xs',
  dark: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className)
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

interface ButtonLinkProps extends LinkProps {
  variant?: Variant
  size?: Size
  icon?: React.ReactNode
}

export const ButtonLink: React.FC<ButtonLinkProps> = ({ variant = 'primary', size = 'md', icon, className, children, ...props }) => (
  <Link className={buttonClass(variant, size, className as string)} {...props}>
    {icon}
    {children}
  </Link>
)

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

export const IconButton: React.FC<IconButtonProps> = ({ label, className, children, type = 'button', ...props }) => (
  <button
    type={type}
    aria-label={label}
    title={label}
    className={cn(
      'inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900',
      className,
    )}
    {...props}
  >
    {children}
  </button>
)
