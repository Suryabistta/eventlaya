import { useQuery } from '@tanstack/react-query'
import { request } from '@/services/api'
import { useAuth } from './auth'

/** Platform modules the superadmin can switch off globally or per role (backend: apps/accounts/modules.py). */
export type ModuleSlug =
  | 'events'
  | 'gate_scanner'
  | 'dynamic_forms'
  | 'voting'
  | 'marketplace'
  | 'staff_management'
  | 'chat'
  | 'reviews'
  | 'white_label'
  | 'payments'
  | 'blog'
  // Voting sub-modules (each requires its parent: contests → voting; judging → contests; paid_votes → contests + payments)
  | 'contests'
  | 'judging'
  | 'paid_votes'
  // November 2026 batch
  | 'banners'
  | 'seat_numbers'
  | 'packages'
  | 'sub_events'
  | 'offline_tickets'
  | 'applications'

interface ModulesResponse {
  role: string
  is_superadmin: boolean
  modules: { slug: string }[]
}

export const MODULES_KEY = ['auth-modules'] as const

/**
 * Modules switched on for the signed-in user. `enabled(slug)` is true while loading, when the lookup fails
 * and for signed-out visitors: the server enforces the switch anyway (403 module_disabled), so the UI only
 * hides things once it knows for sure.
 */
export function useModules() {
  const { user, status } = useAuth()
  const query = useQuery({
    queryKey: [...MODULES_KEY, user?.id],
    queryFn: () => request<ModulesResponse>('/auth/modules/'),
    enabled: status === 'authenticated',
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  })
  const slugs = query.data ? new Set(query.data.modules.map((m) => m.slug)) : null
  return {
    loaded: Boolean(query.data),
    enabled: (slug: ModuleSlug) => (slugs ? slugs.has(slug) : true),
    /** Only true once the list has loaded and contains the module (for things that connect or poll). */
    confirmed: (slug: ModuleSlug) => Boolean(slugs?.has(slug)),
  }
}

export function useModuleEnabled(slug: ModuleSlug) {
  return useModules().enabled(slug)
}
