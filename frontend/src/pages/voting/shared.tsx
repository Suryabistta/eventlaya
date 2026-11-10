import React, { useEffect, useRef, useState } from 'react'
import { formatDateTime } from '@/lib/dates'
import { motion, useReducedMotion } from 'framer-motion'
import { ModernQrCanvas } from '@/components/ModernQr'
import { CalendarClock, Copy, Download, ExternalLink, Lock, Trophy } from 'lucide-react'
import { Badge, Button, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { PollStatus, ResultsVisibility, VoteMode } from './api'

export const statusMeta: Record<PollStatus, { label: string; tone: 'neutral' | 'warning' | 'success'; icon?: React.ReactNode }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'warning', icon: <CalendarClock className="h-3 w-3" aria-hidden /> },
  open: { label: 'Open', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral', icon: <Lock className="h-3 w-3" aria-hidden /> },
}

export const PollStatusBadge: React.FC<{ status: PollStatus; className?: string }> = ({ status, className }) => {
  const m = statusMeta[status]
  return (
    <Badge tone={m.tone} dot={status === 'open'} className={className}>
      {m.icon}
      {m.label}
    </Badge>
  )
}

export const voteModeLabel: Record<VoteMode, string> = {
  ticket: 'One vote per ticket',
  contact: 'One vote per phone or email',
  open: 'Open to anyone (one per device)',
}

export const visibilityLabel: Record<ResultsVisibility, string> = {
  live: 'Public sees live results',
  after_close: 'Public sees results after voting closes',
  hidden_to_public: 'Results only visible to you',
}

export const votesLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'vote' : 'votes'}`

export const fmtDateTime = (iso: string) => formatDateTime(iso, 'weekday')

/** "Opens Thu 12 Nov, 10:00" / "Closes in 2 h" style schedule line. */
export function scheduleText(p: { status: PollStatus; opens_at: string | null; closes_at: string | null }) {
  if (p.status === 'scheduled' && p.opens_at) return `Opens ${fmtDateTime(p.opens_at)}`
  if (p.status === 'open') return p.closes_at ? `Closes ${fmtDateTime(p.closes_at)}` : 'Open until you close it'
  if (p.status === 'closed') return p.closes_at ? `Closed ${fmtDateTime(p.closes_at)}` : 'Closed'
  return 'Not open yet'
}

export const publicVotePath = (slug: string, pollId?: string) => `/e/${slug}/vote${pollId ? `/${pollId}` : ''}`
export const publicVoteUrl = (slug: string, pollId?: string) => `${window.location.origin}${publicVotePath(slug, pollId)}`
export const shortVoteLink = (slug: string, pollId?: string) => `${window.location.host}${publicVotePath(slug, pollId)}`

/** Milliseconds until `target` (updates every second); null when there's no target. */
export function useCountdown(target: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!target) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [target])
  if (!target) return null
  return Math.max(0, new Date(target).getTime() - now)
}

export function fmtCountdown(ms: number) {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const CandidateAvatar: React.FC<{ name: string; photo?: string; className?: string }> = ({ name, photo, className }) => {
  const [broken, setBroken] = useState(false)
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  if (photo && !broken) {
    return <img src={photo} alt="" onError={() => setBroken(true)} className={cn('shrink-0 rounded-xl bg-ink-100 object-cover', className)} />
  }
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-xl bg-brand-50 font-display font-bold text-brand-700', className)}>
      {initials || '?'}
    </span>
  )
}

export interface BarItem {
  id: string
  name: string
  subtitle?: string
  photo_url?: string
  votes: number
  percentage: number
}

/** Animated horizontal results, sorted by votes. The leader is marked with an icon and text, not only colour. */
export const ResultBars: React.FC<{ items: BarItem[]; leaderIds: string[]; size?: 'md' | 'xl'; showVotes?: boolean }> = ({
  items,
  leaderIds,
  size = 'md',
  showVotes = true,
}) => {
  const reduce = useReducedMotion()
  const sorted = [...items].sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name))
  const tied = leaderIds.length > 1
  const max = Math.max(1, ...sorted.map((i) => i.votes))
  const xl = size === 'xl'
  return (
    <ol className={cn(xl ? 'space-y-5' : 'space-y-4')}>
      {sorted.map((c) => {
        const leader = leaderIds.includes(c.id)
        return (
          <motion.li key={c.id} layout={!reduce} transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="flex items-center gap-3 sm:gap-4">
            <CandidateAvatar name={c.name} photo={c.photo_url} className={xl ? 'h-16 w-16 text-xl lg:h-20 lg:w-20 lg:text-2xl' : 'h-10 w-10 text-sm'} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className={cn('flex min-w-0 items-center gap-2 font-semibold text-ink-900', xl ? 'text-2xl lg:text-3xl' : 'text-sm')}>
                  <span className="truncate">{c.name}</span>
                  {leader && (
                    <Badge tone="warning" className={cn('shrink-0', xl && 'px-3 py-1 text-base')}>
                      <Trophy className={xl ? 'h-4 w-4' : 'h-3 w-3'} aria-hidden />
                      {tied ? 'Tied for lead' : 'Leading'}
                    </Badge>
                  )}
                </p>
                {showVotes && (
                  <p className={cn('shrink-0 tabular text-ink-500', xl ? 'text-2xl lg:text-3xl' : 'text-sm')}>
                    <span className="font-semibold text-ink-900">{c.votes.toLocaleString()}</span>
                    <span className={xl ? 'ml-2 text-xl lg:text-2xl' : 'ml-1'}>({c.percentage}%)</span>
                  </p>
                )}
              </div>
              {c.subtitle && <p className={cn('truncate text-ink-500', xl ? 'text-lg' : 'text-xs')}>{c.subtitle}</p>}
              <div className={cn('mt-1.5 overflow-hidden rounded-full bg-ink-100', xl ? 'h-6 lg:h-8' : 'h-2.5')} aria-hidden>
                <motion.div
                  className={cn('h-full rounded-full', leader ? 'bg-brand-600' : 'bg-ink-300')}
                  initial={false}
                  animate={{ width: `${(c.votes / max) * 100}%` }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 22 }}
                />
              </div>
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}

/** Public voting link + QR code to show on screen or print. */
export const SharePanel: React.FC<{ slug: string; pollId: string; title: string; compact?: boolean }> = ({ slug, pollId, title, compact }) => {
  const toast = useToast()
  const canvasWrap = useRef<HTMLDivElement>(null)
  const url = publicVoteUrl(slug, pollId)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Voting link copied', url)
    } catch {
      toast.error('Couldn’t copy the link', 'Select the link and copy it manually.')
    }
  }

  const downloadQr = () => {
    const canvas = canvasWrap.current?.querySelector('canvas')
    if (!canvas) {
      toast.error('Couldn’t create the QR image', 'Reload the page and try again.')
      return
    }
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-voting-qr.png`
    a.click()
    toast.success('QR code downloaded', 'Print it or put it on a slide so people can scan to vote.')
  }

  return (
    <div className={cn('flex gap-4', compact ? 'items-center' : 'flex-col items-center text-center sm:flex-row sm:text-left')}>
      <div ref={canvasWrap} className="shrink-0 rounded-xl border border-ink-200 bg-white p-2">
        <ModernQrCanvas value={url} size={compact ? 96 : 144} margin={compact ? 1 : 4} brackets={!compact} color="#1C1724" aria-label={`QR code for ${url}`} role="img" />
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-sm text-ink-600">Scan the code or open the link to vote.</p>
        <p className="break-all font-mono text-xs text-ink-700">{shortVoteLink(slug, pollId)}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={copy}>
            Copy link
          </Button>
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={downloadQr}>
            Download QR
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            Open ballot
          </a>
        </div>
      </div>
    </div>
  )
}
