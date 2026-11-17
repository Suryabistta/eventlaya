import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { isSuperadmin, useAuth } from '@/lib/auth'
import { platformApi } from '@/pages/admin/api'

/** Superadmin only: one-click "Feature on home page" on an event, vendor or venue page. Hidden for everyone else. */
export const FeatureToggle: React.FC<{ kind: 'event' | 'vendor' | 'venue'; id: string; featured: boolean; className?: string }> = ({ kind, id, featured, className }) => {
  const { user } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [on, setOn] = useState(featured)
  useEffect(() => setOn(featured), [featured])

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (kind === 'event') await platformApi.featureEvent(id, next)
      else await platformApi.featureListing(kind, id, next)
    },
    onSuccess: (_, next) => {
      setOn(next)
      // Home page, lists and admin pages pick up the change straight away
      for (const key of ['featured-market', 'landing', 'admin-featured-listings', 'admin-featured-events', 'publicEvent', 'venue', 'vendor']) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
      toast.success(next ? 'Featured: it now shows on the home page' : 'Removed from featured')
    },
    onError: (err: Error) => toast.error('Couldn’t update featured', err.message),
  })

  if (!isSuperadmin(user)) return null
  return (
    <Button
      variant={on ? 'secondary' : 'primary'}
      size="sm"
      className={className}
      icon={<Star className={on ? 'h-4 w-4 fill-current text-marigold-500' : 'h-4 w-4'} aria-hidden />}
      loading={toggle.isPending}
      onClick={() => toggle.mutate(!on)}
    >
      {on ? 'Remove from featured' : 'Feature on home page'}
    </Button>
  )
}
