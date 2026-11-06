import { request, tokenStore } from '@/services/api'
import { post } from '../api'

export type PlanCode = 'free' | 'event_pro' | 'business' | 'enterprise'
export type Cycle = 'monthly' | 'yearly'
export type SubStatus = 'trial' | 'active' | 'past_due' | 'expired' | 'cancelled'
export type PaymentMethod = 'esewa' | 'khalti' | 'fonepay' | 'bank' | 'cash' | 'other'

export interface Plan {
  code: PlanCode
  name: string
  monthly_price: number | null
  yearly_price: number | null
  attendee_limit: number | null
  features: string[]
}

export interface BillingSummary {
  mrr: number
  arr: number
  active_paid: number
  trials: number
  past_due: number
  expiring_7d: number
  expiring_30d: number
  revenue_this_month: number
  revenue_last_month: number
  revenue_by_month: { month: string; amount: number }[]
  plan_mix: { plan: PlanCode; name: string; count: number }[]
  pending_upgrades: number
}

export interface SubscriptionRow {
  organization_id: string
  organization_name: string
  organization_email: string
  role: 'organizer' | 'vendor'
  plan: PlanCode
  plan_name: string
  billing_cycle: Cycle
  status: SubStatus
  current_period_start: string | null
  current_period_end: string | null
  days_left: number | null
  auto_renew: boolean
  monthly_value: number
  last_payment: { amount: number; paid_at: string; method: string } | null
}

export interface PaymentRow {
  id: string
  organization_id: string
  organization_name: string
  organization_email: string
  plan: PlanCode | null
  plan_name: string | null
  billing_cycle: Cycle
  amount: number
  method: PaymentMethod
  method_display: string
  reference: string
  months_covered: number
  paid_at: string
  recorded_by_email?: string | null
  note?: string
  status: 'recorded' | 'refunded'
  refunded_at: string | null
  refund_note: string
}

export interface UpgradeRequest {
  id: string
  organization_id: string
  organization_name: string
  organization_email: string
  current_plan: PlanCode
  requested_plan: PlanCode
  requested_plan_name: string
  billing_cycle: Cycle
  note: string
  status: 'pending' | 'approved' | 'declined'
  review_note: string
  created_at: string
  reviewed_at: string | null
}

export interface MyBilling {
  subscription: SubscriptionRow
  plan: Plan
  payments: PaymentRow[]
  requests: UpgradeRequest[]
  plans: Plan[]
}

export interface RecordPaymentInput {
  plan: PlanCode
  billing_cycle: Cycle
  amount: number
  method: PaymentMethod
  reference: string
  months: number
  note: string
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v && v !== 'all') as [string, string][]).toString()

export const billingApi = {
  plans: () => request<Plan[]>('/platform/billing/plans/'),
  summary: () => request<BillingSummary>('/platform/billing/summary/'),
  subscriptions: (p: { status?: string; plan?: string; expiring?: string; search?: string }) =>
    request<SubscriptionRow[]>(`/platform/billing/subscriptions/?${qs(p)}`),
  recordPayment: (orgId: string, body: RecordPaymentInput) =>
    post<{ subscription: SubscriptionRow; payment: PaymentRow }>(`/platform/billing/subscriptions/${orgId}/record-payment/`, body),
  changePlan: (orgId: string, plan: PlanCode, billing_cycle: Cycle) =>
    post<SubscriptionRow>(`/platform/billing/subscriptions/${orgId}/change-plan/`, { plan, billing_cycle }),
  cancel: (orgId: string) => post<SubscriptionRow>(`/platform/billing/subscriptions/${orgId}/cancel/`),
  payments: (p: { from?: string; to?: string; method?: string; status?: string }) => request<PaymentRow[]>(`/platform/billing/payments/?${qs(p)}`),
  refund: (id: string, note: string) => post<PaymentRow>(`/platform/billing/payments/${id}/refund/`, { note }),
  upgradeRequests: (status = 'pending') => request<UpgradeRequest[]>(`/platform/billing/upgrade-requests/?status=${status}`),
  approveUpgrade: (id: string) => post<UpgradeRequest>(`/platform/billing/upgrade-requests/${id}/approve/`),
  declineUpgrade: (id: string, note: string) => post<UpgradeRequest>(`/platform/billing/upgrade-requests/${id}/decline/`, { note }),
  mine: () => request<MyBilling>('/platform/billing/mine/'),
  requestUpgrade: (plan: PlanCode, billing_cycle: Cycle, note: string) =>
    post<UpgradeRequest>('/platform/billing/upgrade-requests/', { plan, billing_cycle, note }),

  /** Download the payments ledger as CSV (needs the auth header, so it can't be a plain link). */
  async downloadCsv(p: { from?: string; to?: string; method?: string; status?: string }) {
    const res = await fetch(`/api/platform/billing/payments/?${qs({ ...p, format: 'csv' })}`, {
      headers: { Authorization: `Bearer ${tokenStore.access}`, Accept: 'text/csv' },
    })
    if (!res.ok) throw new Error(res.status === 403 ? 'Only platform admins can export payments.' : `Export failed (${res.status})`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eventlaya-payments-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  },
}

export const npr = (n: number) => `NPR ${Math.round(n).toLocaleString('en-IN')}`

export const statusMeta: Record<SubStatus, { label: string; tone: 'success' | 'brand' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  trial: { label: 'Trial', tone: 'brand' },
  past_due: { label: 'Past due', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const methodLabels: Record<PaymentMethod, string> = {
  esewa: 'eSewa',
  khalti: 'Khalti',
  fonepay: 'Fonepay',
  bank: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
}

export const BILLING_KEY = ['platform', 'billing'] as const
