import React from 'react'
import { cn } from '@/lib/utils'

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('rounded-2xl border border-ink-200 bg-white', className)} {...props} />
)

interface CardHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, description, actions, className }) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4', className)}>
    <div className="min-w-0">
      <h2 className="text-base font-bold text-ink-900">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
)

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-marigold-50 text-marigold-800',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-sky-50 text-sky-700',
}

export const Badge: React.FC<{ tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  dot,
  className,
  children,
}) => (
  <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
    {children}
  </span>
)

interface PageHeaderProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0 max-w-2xl">
      <h1 className="text-2xl font-bold text-ink-900 sm:text-[28px] sm:leading-tight">{title}</h1>
      {description && <p className="mt-1 text-[15px] text-ink-500">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
)

interface StatTileProps {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ReactNode
  tone?: 'brand' | 'success' | 'warning' | 'neutral'
}

const statTones = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-marigold-50 text-marigold-600',
  neutral: 'bg-ink-100 text-ink-600',
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, hint, icon, tone = 'neutral' }) => (
  <Card className="flex items-start justify-between gap-3 p-4 sm:p-5">
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-ink-900 tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
    {icon && <div className={cn('hidden h-10 w-10 shrink-0 sm:flex items-center justify-center rounded-xl', statTones[tone])}>{icon}</div>}
  </Card>
)

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
    {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">{icon}</div>}
    <p className="font-semibold text-ink-900">{title}</p>
    {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('animate-pulse rounded-lg bg-ink-100', className)} aria-hidden />
)

export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
    <p className="font-semibold">Couldn't load this data.</p>
    <p className="mt-0.5 text-red-700">{message || 'Check that the API server is running, then try again.'}</p>
    {onRetry && (
      <button onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2 hover:text-red-900">
        Try again
      </button>
    )}
  </div>
)
