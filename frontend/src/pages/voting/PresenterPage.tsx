import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Clock, Maximize, Minimize } from 'lucide-react'
import { ErrorState, Logo, Skeleton } from '@/components/ui'
import { votingApi } from './api'
import { ResultBars, fmtCountdown, publicVoteUrl, shortVoteLink, useCountdown, votesLabel } from './shared'

/** Big-screen view for projectors and LED walls. Lives outside the app shell. */
export const PresenterPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement))

  const pollQ = useQuery({ queryKey: ['voting-poll', id], queryFn: () => votingApi.get(id!), refetchInterval: 10000 })
  const resultsQ = useQuery({ queryKey: ['voting-results', id], queryFn: () => votingApi.results(id!), refetchInterval: 2500 })
  const poll = pollQ.data
  const results = resultsQ.data
  const status = results?.poll.status ?? poll?.status
  const countdown = useCountdown(status === 'open' ? poll?.closes_at : status === 'scheduled' ? poll?.opens_at : null)

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (e.key === 'Escape' && !document.fullscreenElement) {
        navigate(`/app/voting/${id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, navigate])

  // Keep the screen awake while presenting, where the browser allows it
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined)
    return () => void lock?.release().catch(() => undefined)
  }, [])

  if (pollQ.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
        <div className="max-w-md space-y-4">
          <ErrorState message={pollQ.error?.message} onRetry={() => pollQ.refetch()} />
          <Link to="/app/voting" className="text-sm font-semibold text-brand-700 underline">Back to live voting</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-brand-50/60 text-ink-900">
      <header className="flex items-center justify-between gap-4 px-6 pt-5 lg:px-12 lg:pt-8">
        <div className="flex min-w-0 items-center gap-4">
          <Logo className="shrink-0" />
          {poll && <p className="hidden truncate text-lg text-ink-500 md:block lg:text-xl">{poll.event_title}</p>}
        </div>
        <div className="flex items-center gap-2 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <button onClick={toggleFullscreen} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ink-700 hover:bg-white">
            {fullscreen ? <Minimize className="h-4 w-4" aria-hidden /> : <Maximize className="h-4 w-4" aria-hidden />}
            {fullscreen ? 'Exit full screen' : 'Full screen'} <kbd className="rounded border border-ink-200 bg-white px-1.5 text-xs">F</kbd>
          </button>
          <Link to={`/app/voting/${id}`} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ink-700 hover:bg-white">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Exit <kbd className="rounded border border-ink-200 bg-white px-1.5 text-xs">Esc</kbd>
          </Link>
        </div>
      </header>

      {!poll || !results ? (
        <div className="flex-1 space-y-6 p-12">
          <Skeleton className="h-20 w-2/3" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : (
        <main className="grid flex-1 gap-8 px-6 pb-8 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,26vw)] lg:gap-12 lg:px-12 lg:pb-12">
          <section className="flex min-w-0 flex-col" aria-live="polite">
            <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl xl:text-6xl 2xl:text-7xl">{poll.title}</h1>
            <AnimatePresence mode="wait">
              <motion.p key={status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-xl text-ink-600 lg:text-2xl">
                {status === 'open' && (
                  <>
                    <span className="mr-2 inline-block h-3 w-3 rounded-full bg-emerald-500 align-middle" aria-hidden />
                    Voting is open. <span className="font-semibold text-ink-900 tabular">{votesLabel(results.total_votes)}</span> so far
                  </>
                )}
                {status === 'closed' && <span className="font-semibold text-ink-900">Voting has closed. These are the final results.</span>}
                {status === 'scheduled' && 'Voting hasn’t opened yet.'}
                {status === 'draft' && 'This poll is still a draft. Open it to start voting.'}
              </motion.p>
            </AnimatePresence>
            <div className="mt-8 flex-1 lg:mt-12">
              {poll.results_visibility === 'hidden_to_public' && status !== 'closed' ? (
                <p className="rounded-3xl border border-ink-200 bg-white p-10 text-center text-3xl text-ink-600">
                  Results are hidden until the winner is announced.
                  <span className="mt-3 block text-xl text-ink-500 tabular">{votesLabel(results.total_votes)} cast</span>
                </p>
              ) : results.candidates.length === 0 ? (
                <p className="text-2xl text-ink-500">No candidates yet.</p>
              ) : (
                <ResultBars items={results.candidates} leaderIds={results.leader_ids} size="xl" />
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-6">
            {status !== 'closed' && status !== 'draft' && (
              <div className="rounded-3xl border border-ink-200 bg-white p-6 text-center shadow-sm lg:p-8">
                <p className="text-2xl font-semibold lg:text-3xl">Scan to vote</p>
                <div className="mx-auto mt-5 w-full max-w-[320px]">
                  <QRCodeSVG value={publicVoteUrl(poll.event_slug, poll.id)} size={320} marginSize={1} fgColor="#1C1724" className="h-auto w-full" aria-label="QR code to vote" role="img" />
                </div>
                <p className="mt-4 break-all font-mono text-base text-ink-700 lg:text-lg">{poll.show_on_public_page ? shortVoteLink(poll.event_slug) : shortVoteLink(poll.event_slug, poll.id)}</p>
              </div>
            )}
            {countdown !== null && countdown > 0 && (
              <div className="rounded-3xl border border-brand-200 bg-brand-50 p-6 text-center">
                <p className="flex items-center justify-center gap-2 text-xl text-brand-800 lg:text-2xl">
                  <Clock className="h-6 w-6" aria-hidden />
                  {status === 'open' ? 'Voting closes in' : 'Voting opens in'}
                </p>
                <p className="mt-1 font-display text-6xl font-bold text-brand-700 tabular lg:text-7xl">{fmtCountdown(countdown)}</p>
              </div>
            )}
          </aside>
        </main>
      )}
    </div>
  )
}
