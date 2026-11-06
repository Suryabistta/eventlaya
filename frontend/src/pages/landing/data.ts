import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'

/** Real platform numbers for the landing page (public endpoints only; null while loading). */
export function usePublicNumbers() {
  const events = useQuery({ queryKey: ['landing', 'events'], queryFn: () => api.getPublicEvents({ when: 'upcoming' }), staleTime: 60_000 })
  const vendors = useQuery({ queryKey: ['landing', 'vendors'], queryFn: () => api.getVendors(), staleTime: 60_000 })
  const venues = useQuery({ queryKey: ['landing', 'venues'], queryFn: () => api.getVenues(), staleTime: 60_000 })

  const cities = new Set<string>()
  vendors.data?.forEach((v) => v.city && cities.add(v.city))
  venues.data?.forEach((v) => v.city && cities.add(v.city))

  return {
    upcomingEvents: events.data ? events.data.length : null,
    registrations: events.data ? events.data.reduce((n, e) => n + (e.registered_count || 0), 0) : null,
    listings: vendors.data && venues.data ? vendors.data.length + venues.data.length : null,
    cities: vendors.data && venues.data ? cities.size : null,
  }
}
