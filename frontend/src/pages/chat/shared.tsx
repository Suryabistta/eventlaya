import React, { useState } from 'react'
import { formatDate } from '@/lib/dates'
import { UsersRound } from 'lucide-react'
import { mediaUrl } from '@/lib/account'
import type { ChatMessage, ChatUser, Conversation } from '@/lib/chat/api'
import { cn } from '@/lib/utils'

const PALETTE = ['bg-brand-100 text-brand-800', 'bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800', 'bg-marigold-100 text-marigold-900', 'bg-rose-100 text-rose-800', 'bg-violet-100 text-violet-800']

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export const initialsOf = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

export const PersonAvatar: React.FC<{ user: Pick<ChatUser, 'id' | 'name' | 'avatar'>; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }> = ({ user, size = 'md', className }) => {
  const [failed, setFailed] = useState(false)
  const px = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' }[size]
  const src = mediaUrl(user.avatar)
  if (src && !failed) return <img src={src} alt="" onError={() => setFailed(true)} className={cn('shrink-0 rounded-full object-cover', px, className)} />
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full font-bold', px, PALETTE[hash(user.id) % PALETTE.length], className)} aria-hidden>
      {initialsOf(user.name)}
    </span>
  )
}

export const ConversationAvatar: React.FC<{ conversation: Conversation; size?: 'sm' | 'md' | 'lg' }> = ({ conversation: c, size = 'md' }) => {
  if (c.kind === 'direct' && c.other_member) return <PersonAvatar user={c.other_member} size={size} />
  const px = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' }[size]
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full', c.is_event_crew ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-200 text-ink-600', px)} aria-hidden>
      <UsersRound className={size === 'lg' ? 'h-6 w-6' : 'h-[18px] w-[18px]'} />
    </span>
  )
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Conversation list timestamp: time today, weekday this week, else date. */
export function listTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 6) return d.toLocaleDateString([], { weekday: 'short' })
  return formatDate(d, 'short')
}

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Day separator label: Today / Yesterday / Monday, 3 March */
export function dayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return 'Today'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

export const dayKey = (iso: string) => new Date(iso).toDateString()

/** One-line preview of a message for the list and reply chips. */
export function preview(m: Pick<ChatMessage, 'body' | 'attachment' | 'is_deleted'> | null | undefined) {
  if (!m) return ''
  if (m.is_deleted) return 'Message deleted'
  if (m.body) return m.body
  return m.attachment ? 'Photo' : ''
}

export const roleLabel = (role: string) => ({ organizer: 'Organizer', staff: 'Gate staff', superadmin: 'Admin' })[role] ?? role

export const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
