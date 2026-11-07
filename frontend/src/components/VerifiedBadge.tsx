import React from 'react'
import { BadgeCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Blue tick next to a name: an organization, vendor or venue checked by Eventlaya. */
export const VerifiedBadge: React.FC<{ label?: string; className?: string }> = ({ label = 'Verified by Eventlaya', className }) => (
  <span className={cn('ml-1.5 inline-flex items-center align-[-3px] text-sky-600', className)} title={label}>
    <BadgeCheck className="h-[18px] w-[18px]" aria-hidden />
    <span className="sr-only">{label}</span>
  </span>
)
