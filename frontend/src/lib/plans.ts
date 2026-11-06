import { useQuery } from '@tanstack/react-query'
import { request } from '@/services/api'

export interface PublicPlan {
  code: 'free' | 'event_pro' | 'business' | 'enterprise' | string
  name: string
  monthly_price: number | null
  yearly_price: number | null
  attendee_limit: number | null
  features: string[]
}

/** Live plan prices and features, managed by the platform admin (public endpoint). */
export function usePlans() {
  return useQuery({
    queryKey: ['public-plans'],
    queryFn: () => request<PublicPlan[]>('/platform/billing/plans/'),
    staleTime: 5 * 60_000,
  })
}

export const planCodeByName: Record<string, string> = {
  Free: 'free',
  'Event Pro': 'event_pro',
  Business: 'business',
  Enterprise: 'enterprise',
}
