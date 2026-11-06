import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import type { AuthUser } from '@/services/api'

/** Vendors, organizers whose marketplace access was approved, and platform admins. */
export const hasBusinessPortal = (user: AuthUser | null) =>
  Boolean(user && (user.role === 'vendor' || user.role === 'superadmin' || user.marketplace_access === 'approved'))

/** Business portal routes (/app/business, /app/listings, /app/inquiries). Used inside <RequireAuth>. */
export const RequireBusiness: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  if (hasBusinessPortal(user)) return <>{children}</>
  return <Navigate to={user?.role === 'organizer' ? '/app/marketplace-access' : '/app'} replace />
}

/** /app index: vendors land on their business home, attendees on their tickets, everyone else on the event overview. */
export const AppHome: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  if (user?.role === 'vendor') return <Navigate to="/app/business" replace />
  if (user?.role === 'attendee') return <Navigate to="/app/my/tickets" replace />
  return <>{children}</>
}

/**
 * Old in-app marketplace URLs. Browsing moved to the public /marketplace pages;
 * the venue forms moved to /app/listings.
 */
export const LegacyMarketplaceRedirect: React.FC = () => {
  const { pathname, search } = useLocation()
  const rest = pathname.replace(/^\/app\/marketplace/, '')
  const venueForm = rest.match(/^\/venues\/(new|[^/]+\/edit)\/?$/)
  const to = venueForm ? `/app/listings/venues/${venueForm[1]}` : `/marketplace${rest}${search}`
  return <Navigate to={to} replace />
}
