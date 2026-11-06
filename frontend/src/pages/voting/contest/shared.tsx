import React, { useState } from 'react'
import { Crown } from 'lucide-react'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ContestantStatus, ContestVoteMode, Visibility } from './api'

export const voteModeInfo: Record<ContestVoteMode, { label: string; hint: string }> = {
  sms_otp: { label: 'SMS code (phone number)', hint: 'Voters get a 6-digit code by SMS. Best for public online voting in Nepal.' },
  email_otp: { label: 'Email code', hint: 'Voters get a 6-digit code by email. Free, a little slower for voters.' },
  account: { label: 'Eventlaya account', hint: 'Voters sign in (Google, Facebook or email).' },
  ticket: { label: 'Event ticket', hint: 'Only ticket holders, with the code on their pass. Best for live audiences.' },
  contact: { label: 'Phone or email (not verified)', hint: 'Quick, but anyone can type someone else’s number.' },
  open: { label: 'No verification (one device)', hint: 'Fastest, easiest to game. For fun polls only.' },
}

export const visibilityInfo: Record<Visibility, string> = {
  live: 'Live: counts and ranks while voting',
  after_close: 'After voting closes',
  ranks_only: 'Ranks only, no vote counts',
  top_n: 'Top N only, no counts',
  hidden_to_public: 'Hidden (announce yourself)',
}

export const contestantStatusMeta: Record<ContestantStatus, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' }> = {
  active: { label: 'Active', tone: 'success' },
  eliminated: { label: 'Eliminated', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'danger' },
  winner: { label: 'Winner', tone: 'warning' },
}

export const ContestantStatusBadge: React.FC<{ status: ContestantStatus; className?: string }> = ({ status, className }) => {
  const m = contestantStatusMeta[status]
  return (
    <Badge tone={m.tone} className={className}>
      {status === 'winner' && <Crown className="h-3 w-3" aria-hidden />}
      {m.label}
    </Badge>
  )
}

/** Contestant photo (portrait), falling back to initials. */
export const ContestantPhoto: React.FC<{ name: string; photo?: string; className?: string; rounded?: string }> = ({ name, photo, className, rounded = 'rounded-2xl' }) => {
  const [broken, setBroken] = useState(false)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
  if (photo && !broken) {
    return <img src={photo} alt="" loading="lazy" onError={() => setBroken(true)} className={cn('bg-ink-100 object-cover', rounded, className)} />
  }
  return (
    <span aria-hidden className={cn('flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 font-display font-bold text-brand-700', rounded, className)}>
      {initials || '?'}
    </span>
  )
}

/** "#07" pill. */
export const NumberTag: React.FC<{ value: string; className?: string }> = ({ value, className }) =>
  value ? (
    <span className={cn('inline-flex items-center rounded-lg bg-ink-900 px-2 py-0.5 font-display text-sm font-bold tabular text-white', className)}>{value}</span>
  ) : null

export const fmtScore = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '–' : n.toFixed(digits))

const DEVICE_KEY = 'eventlaya:device-id'
/** Stable per-browser id (same key as quick polls use). */
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

export function readStore<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : null
  } catch {
    return null
  }
}

export function writeStore(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode */
  }
}

/** Plain-language summary of the free vote allowance, e.g. "5 free votes a day". */
export function allowanceText(r: {
  free_votes_enabled: boolean
  votes_per_voter: number | null
  votes_per_day: number | null
  votes_per_round: number | null
}) {
  if (!r.free_votes_enabled) return 'Votes come from vote packs'
  const parts: string[] = []
  const v = (n: number) => `${n} free ${n === 1 ? 'vote' : 'votes'}`
  if (r.votes_per_day) parts.push(`${v(r.votes_per_day)} a day`)
  if (r.votes_per_round) parts.push(`${v(r.votes_per_round)} per round`)
  if (r.votes_per_voter) parts.push(r.votes_per_day || r.votes_per_round ? `up to ${r.votes_per_voter} in total` : v(r.votes_per_voter))
  return parts.join(', ') || 'Unlimited free votes'
}
