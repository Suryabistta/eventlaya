import { useQuery } from '@tanstack/react-query'
import { request } from '@/services/api'

/** Eventlaya's own logo, set by the superadmin (Admin → Site logo). Blank fields mean the built-in logo. */
export interface SiteBranding {
  logo: string
  logo_white: string
}

export const siteBrandingApi = {
  get: () => request<SiteBranding>('/platform/site-branding/'),
  save: (b: Partial<SiteBranding>) => request<SiteBranding>('/platform/site-branding/', { method: 'PATCH', body: JSON.stringify(b) }),
}

export const useSiteBranding = () =>
  useQuery({ queryKey: ['site-branding'], queryFn: siteBrandingApi.get, staleTime: 10 * 60_000, retry: false })
