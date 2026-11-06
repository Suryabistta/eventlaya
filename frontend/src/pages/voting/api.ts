import { request, tokenStore } from '@/services/api'

export type PollStatus = 'draft' | 'scheduled' | 'open' | 'closed'
export type VoteMode = 'ticket' | 'contact' | 'open'
export type ResultsVisibility = 'live' | 'after_close' | 'hidden_to_public'

export interface PollCandidate {
  id?: string
  name: string
  subtitle: string
  description: string
  photo_url: string
  order?: number
  votes?: number
}

export interface VotingPoll {
  id: string
  /** 'contest' rows are managed on /app/voting/contests/:id */
  kind?: 'poll' | 'contest'
  slug?: string
  event: string
  event_title: string
  event_slug: string
  title: string
  description: string
  status: PollStatus
  opens_at: string | null
  closes_at: string | null
  vote_mode: VoteMode
  require_checked_in: boolean
  allow_multiple: boolean
  max_choices: number
  results_visibility: ResultsVisibility
  show_on_public_page: boolean
  order: number
  candidates: PollCandidate[]
  total_votes: number
  voters: number
  registered: number
  created_at: string
  updated_at: string
}

export type PollInput = Partial<Omit<VotingPoll, 'candidates'>> & { candidates?: PollCandidate[] }

export interface PollResults {
  poll: { id: string; title: string; status: PollStatus; opens_at: string | null; closes_at: string | null }
  total_votes: number
  voters: number
  turnout: { voters: number; registered: number; checked_in: number; pct_of_registered: number }
  leader_ids: string[]
  candidates: { id: string; name: string; subtitle: string; photo_url: string; votes: number; percentage: number; rank: number }[]
  timeline?: { bucket_minutes: number; before: number; points: { t: string; count: number; cumulative: number }[] }
  updated_at: string
}

export interface PublicCandidate {
  id: string
  name: string
  subtitle: string
  description: string
  photo_url: string
  votes?: number
  percentage?: number
}

export interface PublicPoll {
  id: string
  /** 'contest' rows on the event's voting list are contests (open them with ContestPublicPage) */
  kind?: 'poll' | 'contest'
  slug?: string
  title: string
  description: string
  status: PollStatus
  opens_at: string | null
  closes_at: string | null
  vote_mode: VoteMode
  require_checked_in: boolean
  allow_multiple: boolean
  max_choices: number
  results_visible: boolean
  total_votes: number | null
  event: { title: string; slug: string }
  candidates: PublicCandidate[]
  /** Signed-in viewers only. has_voted is null when the server can't tell (open polls). */
  viewer?: { has_voted: boolean | null; candidate_ids: string[]; can_vote_with_account: boolean } | null
}

export interface BallotInput {
  candidate_ids: string[]
  ticket_code?: string
  contact?: string
  device_id?: string
}

const P = '/voting/polls/'

export const votingApi = {
  list: (eventId: string) => request<VotingPoll[]>(`${P}?event=${eventId}`),
  get: (id: string) => request<VotingPoll>(`${P}${id}/`),
  create: (body: PollInput) => request<VotingPoll>(P, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: PollInput) => request<VotingPoll>(`${P}${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => request<null>(`${P}${id}/`, { method: 'DELETE' }),
  open: (id: string) => request<VotingPoll>(`${P}${id}/open/`, { method: 'POST' }),
  close: (id: string) => request<VotingPoll>(`${P}${id}/close/`, { method: 'POST' }),
  reset: (id: string) => request<{ deleted: number }>(`${P}${id}/reset/`, { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  duplicate: (id: string) => request<VotingPoll>(`${P}${id}/duplicate/`, { method: 'POST' }),
  results: (id: string) => request<PollResults>(`${P}${id}/results/`),

  publicPolls: (slug: string) => request<{ event: { title: string; slug: string }; polls: PublicPoll[] }>(`/voting/public/${slug}/`),
  publicPoll: (slug: string, pollId: string) => request<PublicPoll>(`/voting/public/${slug}/${pollId}/`),
  vote: (slug: string, pollId: string, body: BallotInput) =>
    request<{ message: string; candidate_ids: string[]; poll: PublicPoll }>(`/voting/public/${slug}/${pollId}/vote/`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}

/** Downloads a CSV export with the organizer's token (a plain link can't send the Authorization header). */
export async function downloadExport(poll: { id: string; title: string }, kind: 'results' | 'votes') {
  const res = await fetch(`/api${P}${poll.id}/export/?kind=${kind}`, {
    headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {},
  })
  if (!res.ok) throw new Error(res.status === 404 ? 'That poll no longer exists.' : `Export failed (${res.status}). Try again.`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const slug = poll.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'poll'
  a.download = `${slug}-${kind}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
