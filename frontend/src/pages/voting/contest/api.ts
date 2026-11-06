/** Contest / pageant API (backend: apps/voting contest_views, judge_views, public_contest_views). See docs/voting.md. */
import { request, tokenStore } from '@/services/api'
import { TENANT_HOST } from '@/lib/tenant-host'
import type { PollStatus } from '../api'
import type { Checkout, ProviderInfo, PublicIntent } from '@/lib/payments'

export type ContestVoteMode = 'ticket' | 'contact' | 'open' | 'account' | 'email_otp' | 'sms_otp'
export type Visibility = 'live' | 'after_close' | 'hidden_to_public' | 'ranks_only' | 'top_n'
export type ContestantStatus = 'active' | 'eliminated' | 'withdrawn' | 'winner'
export type RoundStatus = 'upcoming' | 'open' | 'closed'
export type CategorySelection = 'public_vote' | 'judges' | 'manual'
export type PresetKey = 'pageant' | 'talent' | 'awards' | 'quick'

export interface Preset {
  key: PresetKey
  name: string
  description: string
  kind: 'poll' | 'contest'
  rounds: string[]
  categories: string[]
}

export interface Criterion {
  id?: string
  name: string
  description: string
  max_points: string | number
  weight: string | number
  order?: number
}

export interface ContestRound {
  id?: string
  name: string
  order?: number
  status: RoundStatus
  computed_status?: RoundStatus
  opens_at: string | null
  closes_at: string | null
  public_vote_enabled: boolean
  judging_enabled: boolean
  judge_weight: number
  public_weight: number
  public_normalization: 'top' | 'share'
  judge_aggregation: 'average' | 'drop_high_low' | 'median'
  advance_count: number | null
  advance_mode: 'auto' | 'manual'
  carry_over_votes: boolean
  tie_breakers: string[]
  results_visibility: Visibility | ''
  results_top_n: number | null
  finalized_at?: string | null
  criteria: Criterion[]
  contestants?: { contestant_id: string; status: string; rank: number | null; score: number | null }[]
}

export interface ContestCategory {
  id?: string
  name: string
  slug?: string
  description: string
  order?: number
  selection: CategorySelection
  nominees: string[]
  votes_per_voter: number | null
  votes_per_day: number | null
  results_visibility: Visibility | ''
  round?: string | null
  criterion?: string | null
  round_name?: string | null
  criterion_name?: string | null
  /** write-only: round id or name; criterion id or name */
  round_ref?: string | null
  criterion_ref?: string | null
  winner: string | null
}

export interface ProfileField {
  id?: string
  key?: string
  label: string
  field_type: 'text' | 'number' | 'select' | 'date'
  options: string[]
  is_public: boolean
  required: boolean
  order?: number
}

export interface VotePack {
  id?: string
  label: string
  votes: number
  bonus_votes: number
  price: string
  is_active: boolean
  order?: number
}

export interface Contest {
  id: string
  event: string
  event_title: string
  event_slug: string
  kind: 'contest'
  preset: string
  title: string
  description: string
  slug: string
  cover_url: string
  status: PollStatus
  opens_at: string | null
  closes_at: string | null
  vote_mode: ContestVoteMode
  require_checked_in: boolean
  results_visibility: Visibility
  results_top_n: number
  show_on_public_page: boolean
  number_prefix: string
  number_padding: number
  main_vote_enabled: boolean
  free_votes_enabled: boolean
  votes_per_voter: number | null
  votes_per_day: number | null
  votes_per_round: number | null
  votes_per_contestant: number | null
  contestant_cap_period: 'contest' | 'day' | 'round'
  allow_split: boolean
  max_votes_per_submit: number
  paid_votes_enabled: boolean
  price_per_vote: string | null
  currency: string
  max_packs_per_day: number
  buy_and_vote: boolean
  captcha_enabled: boolean
  ip_votes_per_minute: number
  device_votes_per_minute: number
  flag_ip_burst: number
  flag_subnet_burst: number
  flag_device_voters: number
  transparency_note: string
  show_transparency: boolean
  judges_see_others: boolean
  show_judge_breakdown: boolean
  placement_titles: string[]
  rounds: ContestRound[]
  categories: ContestCategory[]
  profile_fields: ProfileField[]
  vote_packs: VotePack[]
  stats: { contestants: number; active_contestants: number; votes: number; voters: number; flagged: number; void: number; paid_votes: number; revenue: string }
  /** Can this contest sell votes now (superadmin modules, providers, verification) */
  payments: { available: boolean; reason: PaidUnavailableReason | null; message: string | null; providers: ProviderInfo[] }
  /** Organizer's colours when their white-label is approved, else null (use Eventlaya's brand) */
  brand: { primary_color: string; accent_color: string; brand_name: string; brand_logo: string } | null
  judges: { id: string; name: string; email: string; is_active: boolean }[]
  has_votes: boolean
  captcha_available: boolean
  sms_provider: 'console' | 'aakash' | 'sparrow'
  created_at: string
  updated_at: string
}

export type ContestInput = Partial<Omit<Contest, 'id' | 'stats' | 'judges' | 'has_votes' | 'captcha_available' | 'sms_provider' | 'payments' | 'brand'>>

export type SocialKey = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'website'

export interface Contestant {
  id: string
  poll: string
  name: string
  subtitle: string
  description: string
  photo_url: string
  gallery: string[]
  social_links: Partial<Record<SocialKey, string>>
  profile: Record<string, string>
  number: number | null
  display_number: string
  slug: string
  status: ContestantStatus
  order: number
  votes: number
  categories: string[]
  rounds: { round_id: string; status: string; rank: number | null }[]
}

export type ContestantInput = Partial<Omit<Contestant, 'id' | 'poll' | 'display_number' | 'votes' | 'categories' | 'rounds'>>

export interface StandingRow {
  contestant_id: string
  name: string
  number: number | null
  display_number: string
  slug: string
  photo_url: string
  subtitle?: string
  status: ContestantStatus
  entry_status?: string | null
  votes: number
  last_vote_at?: string | null
  public_score: number
  judge_score: number | null
  judges_scored: number
  criteria: Record<string, number | null>
  judges?: { judge_id: string; name: string; percent: number; comment: string; scores: Record<string, number> }[]
  final: number
  rank: number
  tied: boolean
}

export interface RoundBrief {
  id: string
  name: string
  order: number
  status: RoundStatus
  opens_at: string | null
  closes_at: string | null
  public_vote_enabled: boolean
  judging_enabled: boolean
  advance_count: number | null
  advance_mode: 'auto' | 'manual'
  finalized_at: string | null
}

export interface Standings {
  round: RoundBrief | null
  weights: { judges: number; public: number }
  public_normalization: string
  judge_aggregation: string
  tie_breakers: string[]
  criteria: { id: string; name: string; max_points: number; weight: number }[]
  total_votes: number
  advance_count: number | null
  tie_at_cutoff: boolean
  rows: StandingRow[]
}

export interface CategoryResult {
  category: { id: string; name: string; selection: CategorySelection; winner_id: string | null }
  total_votes: number
  rows: { contestant_id: string; name: string; number: number | null; display_number: string; slug: string; photo_url: string; status: string; votes: number; score: number; rank: number | null; tied: boolean }[]
}

export interface ContestResults {
  overall: Standings | null
  rounds: Standings[]
  categories: CategoryResult[]
  placement_titles: string[]
}

export interface JudgeProgress {
  round_id: string
  name: string
  expected: number
  submitted: number
  drafts: number
}

export interface ContestJudge {
  id: string
  user_id: string
  name: string
  email: string
  is_active: boolean
  excluded_contestants: string[]
  invited_at: string
  last_login: string | null
  progress: JudgeProgress[]
  temporary_password?: string | null
  created?: boolean
  message?: string
}

export interface Dashboard {
  totals: { votes: number; voters: number; today: number; flagged: number; void: number; by_source: Record<string, number> }
  hourly: { t: string; count: number }[]
  daily: { date: string; count: number }[]
  per_contestant: { contestant_id: string; name: string; display_number: string; votes: number }[]
  per_round: { round_id: string | null; name: string; votes: number }[]
  per_category: { category_id: string; name: string; votes: number }[]
  judges: ContestJudge[]
  paid: PaidSummary
}

export interface PaidSummary {
  enabled: boolean
  revenue: string
  purchases: number
  votes_sold: number
  pending: number
  refunded: string
  refunded_count: number
  unspent_credits: number
  flagged_purchases: number
  per_contestant: { contestant_id: string; name: string; display_number: string; paid_votes: number; revenue: string; purchases: number }[]
  per_pack: { pack_id: string | null; label: string; sold: number; revenue: string }[]
}

export interface PurchaseRow {
  id: string
  created_at: string
  paid_at: string | null
  refunded_at: string | null
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  label: string
  votes: number
  bonus_votes: number
  amount: string
  voter_ref: string
  method: string
  contestant: { id: string; name: string; display_number: string } | null
  auto_vote: boolean
  auto_voted: number
  auto_vote_note: string
  payment_id: string | null
  provider: string | null
  provider_txn_id: string
  payment_status: string | null
  ip_ref: string
  device_ref: string
  flags: string[]
}

export interface VoteRow {
  id: string
  voted_at: string
  contestant_id: string
  contestant: string
  display_number: string
  category: string | null
  round: string | null
  quantity: number
  source: string
  method: string
  voter_ref: string
  ip_ref: string
  device_ref: string
  flags: string[]
  is_void: boolean
  void_reason: string
  voided_at: string | null
  payment_ref: string
}

export interface FlagReport {
  labels: Record<string, string>
  counts: Record<string, number>
  groups: { kind: 'ip' | 'device'; label: string; ref: string; hash: string; votes: number; rows: number; voters: number }[]
  votes: VoteRow[]
}

export interface Sheet {
  id: string
  round_id: string
  judge_id: string
  judge: string
  contestant_id: string
  contestant: string
  display_number: string
  scores: Record<string, number>
  comment: string
  status: 'draft' | 'submitted'
  submitted_at: string | null
  percent: number
}

export interface AuditEntry {
  id: string
  action: string
  summary: string
  detail: Record<string, unknown>
  actor: string | null
  created_at: string
}

/* ---------- Public ---------- */

export type PaidUnavailableReason = 'off' | 'payments_off' | 'paid_votes_off' | 'unverified_mode' | 'no_provider' | 'closed'

export interface PublicPack {
  id: string
  label: string
  votes: number
  bonus_votes: number
  total_votes: number
  price: string
  currency: string
  /** false below Rs 10 (Khalti's minimum) */
  khalti_ok: boolean
}

export interface PublicPaid {
  /** Show the packs at all (organizer offers paid votes and the superadmin modules are on) */
  enabled: boolean
  /** They can be bought right now */
  payments_available: boolean
  unavailable_reason: PaidUnavailableReason | null
  unavailable_message: string | null
  providers: ProviderInfo[]
  currency: string
  price_per_vote: string | null
  /** Buy any number of votes at price_per_vote */
  custom_votes: boolean
  max_custom_votes: number
  /** 0 = no limit */
  max_packs_per_day: number
  /** Votes bought from a contestant's page are cast for them as soon as the payment is confirmed */
  buy_and_vote: boolean
  packs: PublicPack[]
}

export interface PurchaseInfo {
  id: string
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  label: string
  /** null for "N votes at the per-vote price" */
  pack_id: string | null
  votes: number
  bonus_votes: number
  total_votes: number
  amount: string
  currency: string
  contestant: { id: string; name: string; number: number | null; display_number: string; slug: string } | null
  auto_vote: boolean
  auto_voted: number
  auto_vote_note: string
}

/** `result` of GET /api/payments/intents/<id>/ for a vote-pack payment */
export interface VotePackResult {
  type: 'vote_pack'
  purchase: PurchaseInfo
  contest: { id: string; slug: string; title: string; event_slug: string; event_title: string }
  credited: boolean
  credits: number | null
}

export interface BuyVotesInput {
  pack?: string
  votes?: number
  provider: string
  contestant?: string
  return_url?: string
  voter_token?: string
  ticket_code?: string
  device_id?: string
  payer_name?: string
  payer_phone?: string
  payer_email?: string
  captcha_token?: string
}

export interface PublicStandings {
  level: 'full' | 'ranks' | 'top'
  top_n: number | null
  total_votes: number | null
  weights: { judges: number; public: number } | null
  rows: {
    contestant_id: string
    name: string
    display_number: string
    number: number | null
    slug: string
    photo_url: string
    rank: number | null
    tied: boolean
    status: ContestantStatus
    votes?: number
    percentage?: number
    public_score?: number
    judge_score?: number | null
    final?: number
  }[]
}

export interface PublicContestant {
  id: string
  number: number | null
  display_number: string
  slug: string
  name: string
  subtitle: string
  photo_url: string
  status: ContestantStatus
  categories: string[]
  in_current_round: boolean | null
  profile: { key: string; label: string; value: string }[]
  description?: string
  gallery?: string[]
  social_links?: Partial<Record<SocialKey, string>>
}

export interface PublicContest {
  id: string
  kind: 'contest'
  slug: string
  title: string
  description: string
  cover_url: string
  status: PollStatus
  opens_at: string | null
  closes_at: string | null
  event: { title: string; slug: string }
  vote_mode: ContestVoteMode
  require_checked_in: boolean
  verification: { method: ContestVoteMode; channel: 'sms' | 'email' | null; captcha_site_key: string | null }
  rules: {
    free_votes_enabled: boolean
    votes_per_voter: number | null
    votes_per_day: number | null
    votes_per_round: number | null
    votes_per_contestant: number | null
    contestant_cap_period: 'contest' | 'day' | 'round'
    allow_split: boolean
    max_votes_per_submit: number
    main_vote_enabled: boolean
  }
  /** Paid votes. Show packs when `enabled`; they can be bought when `payments_available`. */
  paid: PublicPaid
  number_prefix: string
  number_padding: number
  profile_fields: { key: string; label: string; field_type: string; options: string[] }[]
  rounds: RoundBrief[]
  current_round: RoundBrief | null
  display_round: RoundBrief | null
  voting_open: boolean
  categories: {
    id: string
    slug: string
    name: string
    description: string
    selection: CategorySelection
    nominees: string[]
    voting_open: boolean
    votes_per_voter: number | null
    votes_per_day: number | null
    standings: PublicStandings | null
    winner: string | null
  }[]
  standings: PublicStandings | null
  placement_titles: string[]
  transparency_note: string
  contestants?: PublicContestant[]
}

export interface PublicContestantDetail {
  contest: PublicContest
  contestant: PublicContestant & {
    standing: PublicStandings['rows'][number] | null
    standing_level: 'full' | 'ranks' | 'top' | 'none'
    previous: { id: string; name: string; display_number: string; slug: string; number: number | null } | null
    next: { id: string; name: string; display_number: string; slug: string; number: number | null } | null
  }
}

export interface Allowance {
  free_remaining: number | null
  resets_daily: boolean
  credits: number
  voted_for: string[]
  /** Only when a contestant was asked about (allowance body `contestant`, or the vote response) */
  contestant_id?: string
  contestant_cap?: number | null
  contestant_cap_period?: 'contest' | 'day' | 'round'
  /** Free votes this contestant can still get from this voter (all limits); null = no per-contestant cap */
  contestant_free_remaining?: number | null
  contestant_used?: number | null
}

export interface ContestVoteInput {
  contestant: string
  category?: string
  quantity?: number
  voter_token?: string
  ticket_code?: string
  contact?: string
  device_id?: string
  captcha_token?: string
}

export interface ContestVoteResult {
  message: string
  contestant_id: string
  category_id: string | null
  quantity: number
  allowance: Allowance
}

/* ---------- Judge ---------- */

export interface JudgeAssignment {
  id: string
  contest_id: string
  contest: string
  event: string
  cover_url: string
  progress: JudgeProgress[]
  scoring_open: boolean
}

export interface JudgeRoundInfo {
  id: string
  name: string
  status: RoundStatus
  finalized: boolean
  can_score: boolean
  criteria: { id: string; name: string; description: string; max_points: number; weight: number }[]
}

export interface JudgeSheetData {
  judge: { id: string; name: string }
  contest: { id: string; title: string; event: string; judges_see_others?: boolean; excluded_count?: number }
  rounds: JudgeRoundInfo[]
  round: JudgeRoundInfo | null
  contestants: {
    id: string
    name: string
    number: number | null
    display_number: string
    photo_url: string
    subtitle: string
    sheet: { id: string; scores: Record<string, number>; comment: string; status: 'draft' | 'submitted'; submitted_at: string | null; percent: number } | null
    others: { judge: string; scores: Record<string, number>; percent: number }[] | null
  }[]
}

const C = '/voting/contests/'
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const contestApi = {
  presets: () => request<Preset[]>(`${C}presets/`),
  list: (eventId?: string) => request<Contest[]>(`${C}${eventId ? `?event=${eventId}` : ''}`),
  get: (id: string) => request<Contest>(`${C}${id}/`),
  create: (body: { event: string; title: string; preset: PresetKey; description?: string }) => request<Contest>(C, json('POST', body)),
  update: (id: string, body: ContestInput) => request<Contest>(`${C}${id}/`, json('PATCH', body)),
  remove: (id: string) => request<null>(`${C}${id}/`, json('DELETE')),
  applyPreset: (id: string, preset: PresetKey) => request<Contest>(`${C}${id}/preset/`, json('POST', { preset })),
  setStatus: (id: string, action: 'open' | 'close') => request<Contest>(`${C}${id}/status/${action}/`, json('POST')),

  contestants: (id: string) => request<Contestant[]>(`${C}${id}/contestants/`),
  addContestant: (id: string, body: ContestantInput) => request<Contestant>(`${C}${id}/contestants/`, json('POST', body)),
  updateContestant: (id: string, cid: string, body: ContestantInput) => request<Contestant>(`${C}${id}/contestants/${cid}/`, json('PATCH', body)),
  removeContestant: (id: string, cid: string) => request<null>(`${C}${id}/contestants/${cid}/`, json('DELETE')),
  bulkAdd: (id: string, contestants: ContestantInput[]) => request<Contestant[]>(`${C}${id}/contestants/bulk/`, json('POST', { contestants })),
  importCsv: (id: string, csv: string) => request<Contestant[]>(`${C}${id}/contestants/import/`, json('POST', { csv })),
  reorder: (id: string, ids: string[], renumber = false) => request<Contestant[]>(`${C}${id}/contestants/reorder/`, json('POST', { ids, renumber })),

  roundAction: (id: string, rid: string, action: 'open' | 'close' | 'undo' | 'entries' | 'decide', body?: Record<string, unknown>) =>
    request<Contest | { message: string }>(`${C}${id}/rounds/${rid}/${action}/`, json('POST', body ?? {})),

  results: (id: string) => request<ContestResults>(`${C}${id}/results/`),
  roundResults: (id: string, rid: string) => request<Standings>(`${C}${id}/results/?round=${rid}`),
  dashboard: (id: string) => request<Dashboard>(`${C}${id}/dashboard/`),

  judges: (id: string) => request<ContestJudge[]>(`${C}${id}/judges/`),
  inviteJudge: (id: string, body: { email: string; name: string }) => request<ContestJudge>(`${C}${id}/judges/`, json('POST', body)),
  updateJudge: (id: string, jid: string, body: { name?: string; is_active?: boolean; excluded_contestants?: string[]; reset_password?: boolean }) =>
    request<ContestJudge>(`${C}${id}/judges/${jid}/`, json('PATCH', body)),
  removeJudge: (id: string, jid: string) => request<{ message?: string } | null>(`${C}${id}/judges/${jid}/`, json('DELETE')),
  sheets: (id: string, rid?: string) => request<Sheet[]>(`${C}${id}/sheets/${rid ? `?round=${rid}` : ''}`),
  unlockSheet: (id: string, sid: string) => request<{ message: string }>(`${C}${id}/sheets/${sid}/unlock/`, json('POST')),

  flags: (id: string, mode: 'flagged' | 'all' | 'void' = 'flagged') =>
    request<FlagReport>(`${C}${id}/flags/${mode === 'all' ? '?all=1' : mode === 'void' ? '?void=1' : ''}`),
  voidVotes: (id: string, body: { vote_ids?: string[]; ip_hash?: string; device_hash?: string; flag?: string; reason?: string; undo?: boolean }) =>
    request<{ message: string; rows: number; votes: number; paid_votes?: number; warning?: string; payments?: string[] }>(`${C}${id}/votes/void/`, json('POST', body)),
  purchases: (id: string) => request<{ summary: PaidSummary; purchases: PurchaseRow[] }>(`${C}${id}/purchases/`),
  audit: (id: string) => request<AuditEntry[]>(`${C}${id}/audit/`),
  grantCredits: (id: string, body: { phone?: string; email?: string; votes: number; note?: string }) =>
    request<{ message: string }>(`${C}${id}/credits/grant/`, json('POST', body)),

  // Public
  publicContest: (slug: string, ref: string) => request<PublicContest>(`/voting/public/${slug}/contests/${encodeURIComponent(ref)}/`),
  publicContestant: (slug: string, ref: string, cref: string) =>
    request<PublicContestantDetail>(`/voting/public/${slug}/contests/${encodeURIComponent(ref)}/c/${encodeURIComponent(cref)}/`),
  vote: (slug: string, ref: string, body: ContestVoteInput) =>
    request<ContestVoteResult>(`/voting/public/${slug}/contests/${encodeURIComponent(ref)}/vote/`, json('POST', body)),
  buy: (slug: string, ref: string, body: BuyVotesInput) =>
    request<{ purchase: PurchaseInfo; payment: PublicIntent<VotePackResult>; checkout: Checkout }>(
      `/voting/public/${slug}/contests/${encodeURIComponent(ref)}/buy/`, json('POST', body)),
  allowance: (slug: string, ref: string, body: Omit<ContestVoteInput, 'contestant'> & { contestant?: string }) =>
    request<{ main: Allowance; categories: Record<string, Allowance> }>(`/voting/public/${slug}/contests/${encodeURIComponent(ref)}/allowance/`, json('POST', body)),
  sendOtp: (slug: string, ref: string, destination: string, captcha_token?: string) =>
    request<{ expires_in: number; resend_in: number; channel: 'sms' | 'email'; destination: string }>(
      `/voting/public/${slug}/contests/${encodeURIComponent(ref)}/otp/send/`, json('POST', { destination, captcha_token })),
  verifyOtp: (slug: string, ref: string, destination: string, code: string) =>
    request<{ voter_token: string; expires_in: number; destination: string }>(
      `/voting/public/${slug}/contests/${encodeURIComponent(ref)}/otp/verify/`, json('POST', { destination, code })),

  // Judges
  myJudging: () => request<JudgeAssignment[]>('/voting/judge/'),
  judgeSheet: (jid: string, rid?: string) => request<JudgeSheetData>(`/voting/judge/${jid}/${rid ? `?round=${rid}` : ''}`),
  saveSheet: (jid: string, body: { round: string; contestant: string; scores: Record<string, number | string>; comment: string; submit: boolean }) =>
    request<{ id: string; scores: Record<string, number>; comment: string; status: 'draft' | 'submitted'; submitted_at: string | null; percent: number; message: string }>(
      `/voting/judge/${jid}/`, json('PUT', body)),
}

/** CSV export with the organizer's token (a plain link can't send the Authorization header). */
export async function downloadContestExport(contest: { id: string; title: string }, kind: 'votes' | 'scores' | 'results' | 'purchases') {
  const res = await fetch(`/api${C}${contest.id}/export/?kind=${kind}`, {
    headers: {
      ...(tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : {}),
      ...(TENANT_HOST ? { 'X-Tenant-Host': TENANT_HOST } : {}),
    },
  })
  if (!res.ok) throw new Error(`Export failed (${res.status}). Try again.`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const slug = contest.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'contest'
  a.download = `${slug}-${kind}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/* ---------- URLs ---------- */

export const contestRef = (c: { slug?: string; id: string }) => c.slug || c.id
export const contestPath = (eventSlug: string, ref: string) => `/e/${eventSlug}/vote/${ref}`
export const contestantPath = (eventSlug: string, ref: string, c: { number: number | null; slug: string }) =>
  `${contestPath(eventSlug, ref)}/c/${c.number ?? c.slug}`
/** Link-preview page served by the API (Open Graph tags, then redirects people to the web page). */
export const shareUrl = (eventSlug: string, ref: string, c?: { number: number | null; slug: string }) =>
  `${window.location.origin}/api/voting/og/${eventSlug}/${ref}/${c ? `c/${c.number ?? c.slug}/` : ''}`
