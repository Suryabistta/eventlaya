import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'

// Shown until the list loads, or if it fails; matches the cities seeded on the server
const FALLBACK = ['Dharan', 'Itahari', 'Biratnagar', 'Damak', 'Kathmandu']

/** Active city names, managed by the superadmin (Admin → Cities & categories). */
export function useCities(): string[] {
  const { data } = useQuery({ queryKey: ['cities'], queryFn: api.getCities, staleTime: 10 * 60_000 })
  return data?.length ? data.map((c) => c.name) : FALLBACK
}
