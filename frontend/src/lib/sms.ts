import { request } from '@/services/api'

/** SMS credits (module `sms`, backend apps.platform.sms_views). */
export interface SmsEntry {
  id: string
  kind: 'plan' | 'top_up' | 'adjustment' | 'usage'
  kind_display: string
  credits: number
  note: string
  created_at: string
}

export interface SmsRequest {
  id: string
  organization_id: string
  organization_name: string
  organization_email: string
  credits: number
  granted: number | null
  note: string
  status: 'pending' | 'approved' | 'declined'
  review_note: string
  created_at: string
  reviewed_at: string | null
  balance: number
}

export interface SmsSummary {
  balance: number
  plan_name: string
  plan_monthly: number
  history: SmsEntry[]
}

export interface MySms extends SmsSummary {
  requests: SmsRequest[]
  packs: number[]
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) })

export const smsApi = {
  mine: () => request<MySms>('/platform/sms/mine/'),
  ask: (credits: number, note: string) => request<SmsRequest>('/platform/sms/requests/', json('POST', { credits, note })),
  requests: (status: string) => request<SmsRequest[]>(`/platform/sms/requests/?status=${status}`),
  approve: (id: string, credits: number, note: string) => request<SmsRequest>(`/platform/sms/requests/${id}/approve/`, json('POST', { credits, note })),
  decline: (id: string, note: string) => request<SmsRequest>(`/platform/sms/requests/${id}/decline/`, json('POST', { note })),
  org: (orgId: string) => request<SmsSummary>(`/platform/sms/orgs/${orgId}/`),
  addToOrg: (orgId: string, credits: number, note: string) => request<SmsSummary>(`/platform/sms/orgs/${orgId}/`, json('POST', { credits, note })),
  setPlanSms: (code: string, sms_credits: number) => request<{ code: string; sms_credits: number }>(`/platform/billing/plans/${code}/sms/`, json('PATCH', { sms_credits })),
}

export const fmtCredits = (n: number) => n.toLocaleString('en-IN')
