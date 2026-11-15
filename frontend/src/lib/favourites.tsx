/** Saved events ("favourites") for signed-in people. Module `favourites`; the API is /api/me/favourites/. */
import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Heart } from 'lucide-react'
import { request, type Event } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { useModuleEnabled } from '@/lib/modules'
import { useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

const KEY = ['favourites'] as const

export function useFavourites() {
  const { status } = useAuth()
  const on = useModuleEnabled('favourites')
  const signedIn = status === 'authenticated'
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => request<{ ids: string[]; events: Event[] }>('/me/favourites/'),
    enabled: on && signedIn,
    staleTime: 60_000,
  })
  return { on, signedIn, ids: new Set(query.data?.ids ?? []), events: query.data?.events ?? [], query }
}

/** Heart toggle. Signed out: sends people to sign in and back here. */
export const FavouriteButton: React.FC<{ eventId: string; eventSlug: string; className?: string; size?: 'sm' | 'md' }> = ({ eventId, eventSlug, className, size = 'sm' }) => {
  const { on, signedIn, ids } = useFavourites()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const saved = ids.has(eventId)
  const toggle = useMutation({
    mutationFn: () => (saved
      ? request<null>(`/me/favourites/${eventId}/`, { method: 'DELETE' })
      : request<{ id: string }>('/me/favourites/', { method: 'POST', body: JSON.stringify({ event: eventSlug }) })),
    onMutate: () => {
      // Flip at once; the list refetches after
      qc.setQueryData<{ ids: string[]; events: Event[] }>(KEY, (d) => d && ({ ...d, ids: saved ? d.ids.filter((x) => x !== eventId) : [eventId, ...d.ids] }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
    onSuccess: () => toast.success(saved ? 'Removed from saved events' : 'Saved', saved ? undefined : 'Find it again under Saved events.'),
    onError: (e: Error) => toast.error('Couldn’t update saved events', e.message),
  })
  if (!on) return null
  const label = saved ? 'Remove from saved events' : 'Save this event'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={saved}
      title={label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!signedIn) navigate('/login', { state: { from: location.pathname } })
        else toggle.mutate()
      }}
      className={cn(
        'relative z-10 inline-flex items-center justify-center rounded-full bg-white/95 shadow-xs ring-1 ring-ink-200 transition-colors hover:bg-white',
        size === 'sm' ? 'h-9 w-9' : 'h-10 w-10',
        className,
      )}
    >
      <Heart className={cn('h-[18px] w-[18px]', saved ? 'fill-brand-600 text-brand-600' : 'text-ink-600')} aria-hidden />
    </button>
  )
}
