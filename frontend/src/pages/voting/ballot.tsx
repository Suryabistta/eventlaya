import React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CandidateAvatar } from './shared'

export interface BallotCandidate {
  id: string
  name: string
  subtitle?: string
  description?: string
  photo_url?: string
}

/** One choice on the attendee ballot. Rendered as a real checkbox/radio so it works with keyboard and screen readers. */
export const BallotOption: React.FC<{
  candidate: BallotCandidate
  name: string
  multi: boolean
  selected: boolean
  disabled?: boolean
  onToggle: () => void
}> = ({ candidate: c, name, multi, selected, disabled, onToggle }) => (
  <label
    className={cn(
      'flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40 sm:p-4',
      selected ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-ink-200 hover:border-ink-300',
      disabled && !selected && 'cursor-not-allowed opacity-60',
    )}
  >
    <input
      type={multi ? 'checkbox' : 'radio'}
      name={name}
      value={c.id}
      checked={selected}
      disabled={disabled && !selected}
      onChange={onToggle}
      className="sr-only"
    />
    <CandidateAvatar name={c.name} photo={c.photo_url} className="h-16 w-16 text-lg sm:h-20 sm:w-20 sm:text-xl" />
    <span className="min-w-0 flex-1">
      <span className="block font-semibold text-ink-900">{c.name}</span>
      {c.subtitle && <span className="block text-sm text-ink-500">{c.subtitle}</span>}
      {c.description && <span className="mt-1 block text-sm text-ink-600 line-clamp-3">{c.description}</span>}
    </span>
    <span
      aria-hidden
      className={cn(
        'mt-1 flex h-6 w-6 shrink-0 items-center justify-center border-2 transition-colors',
        multi ? 'rounded-md' : 'rounded-full',
        selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300 bg-white',
      )}
    >
      {selected && <Check className="h-4 w-4" strokeWidth={3} />}
    </span>
  </label>
)
