import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, Link, Outlet, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, RequireAuth } from './lib/auth'
import { ToastProvider } from './components/ui/Toast'
import { Logo } from './components/ui/Logo'
import { MarketingLayout } from './layouts/MarketingLayout'
import { AppLayout } from './layouts/AppLayout'
import { AppHome, LegacyMarketplaceRedirect, RequireBusiness } from './pages/business/guards'
import { TENANT_HOST } from './lib/tenant-host'
import { LegalFooter } from './components/LegalFooter'
import { SeoHead } from './lib/seo'
import { AnalyticsTracker } from './lib/analytics'

/** Route-level code splitting: each page downloads only when it's first opened. */
function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return React.lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })))
}

// White-label site (event.dharanfilmfestival.org, <name>.eventlaya.com, or ?tenant= in development)
const TenantApp = lazyPage(() => import('./tenant/TenantApp'), 'TenantApp')
const LandingPage = lazyPage(() => import('./pages/LandingPage'), 'LandingPage')
const LoginPage = lazyPage(() => import('./pages/AuthPages'), 'LoginPage')
const SignupPage = lazyPage(() => import('./pages/AuthPages'), 'SignupPage')
const ForgotPasswordPage = lazyPage(() => import('./pages/auth/PasswordResetPages'), 'ForgotPasswordPage')
const ResetPasswordPage = lazyPage(() => import('./pages/auth/PasswordResetPages'), 'ResetPasswordPage')
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage')
const EventsPage = lazyPage(() => import('./pages/EventsPage'), 'EventsPage')
const ApplicationsPage = lazyPage(() => import('./pages/ApplicationsPage'), 'ApplicationsPage')
const TicketingEventsPage = lazyPage(() => import('./pages/EventsPage'), 'TicketingEventsPage')
const RegistrationEventsPage = lazyPage(() => import('./pages/EventsPage'), 'RegistrationEventsPage')
const PageantEventsPage = lazyPage(() => import('./pages/EventsPage'), 'PageantEventsPage')
const EventFormPage = lazyPage(() => import('./pages/EventFormPage'), 'EventFormPage')
const FormBuilderPage = lazyPage(() => import('./pages/FormBuilderPage'), 'FormBuilderPage')
const GateScannerPage = lazyPage(() => import('./pages/GateScannerPage'), 'GateScannerPage')
const GatesPage = lazyPage(() => import('./pages/GatesPage'), 'GatesPage')
const TicketsPage = lazyPage(() => import('./pages/TicketsPage'), 'TicketsPage')
const PrintedTicketsPage = lazyPage(() => import('./pages/PrintedTicketsPage'), 'PrintedTicketsPage')
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage')
const VotingPage = lazyPage(() => import('./pages/VotingPage'), 'VotingPage')
const PollBuilderPage = lazyPage(() => import('./pages/voting/PollBuilderPage'), 'PollBuilderPage')
const PollResultsPage = lazyPage(() => import('./pages/voting/PollResultsPage'), 'PollResultsPage')
const PresenterPage = lazyPage(() => import('./pages/voting/PresenterPage'), 'PresenterPage')
const PublicVotePage = lazyPage(() => import('./pages/voting/PublicVotePage'), 'PublicVotePage')
// Contests / pageants (pages/voting/contest, docs/voting.md)
const ContestCreatePage = lazyPage(() => import('./pages/voting/contest/ContestBuilderPage'), 'ContestCreatePage')
const ContestBuilderPage = lazyPage(() => import('./pages/voting/contest/ContestBuilderPage'), 'ContestBuilderPage')
const ContestDashboardPage = lazyPage(() => import('./pages/voting/contest/ContestDashboardPage'), 'ContestDashboardPage')
const ContestPresenterPage = lazyPage(() => import('./pages/voting/contest/ContestPresenterPage'), 'ContestPresenterPage')
const JudgeHomePage = lazyPage(() => import('./pages/voting/contest/JudgePage'), 'JudgeHomePage')
const JudgeScoringPage = lazyPage(() => import('./pages/voting/contest/JudgePage'), 'JudgeScoringPage')
const MarketplacePage = lazyPage(() => import('./pages/MarketplacePage'), 'MarketplacePage')
const VenueDetailPage = lazyPage(() => import('./pages/marketplace/VenueDetailPage'), 'VenueDetailPage')
const VendorDetailPage = lazyPage(() => import('./pages/marketplace/VendorDetailPage'), 'VendorDetailPage')
const ListVenuePage = lazyPage(() => import('./pages/marketplace/ListVenuePage'), 'ListVenuePage')
const EditVenuePage = lazyPage(() => import('./pages/marketplace/ListVenuePage'), 'EditVenuePage')
const BusinessHomePage = lazyPage(() => import('./pages/business/BusinessHomePage'), 'BusinessHomePage')
const ListingsPage = lazyPage(() => import('./pages/business/ListingsPage'), 'ListingsPage')
const InquiriesPage = lazyPage(() => import('./pages/business/InquiriesPage'), 'InquiriesPage')
const BookingsPage = lazyPage(() => import('./pages/business/BookingsPage'), 'BookingsPage')
const AvailabilityPage = lazyPage(() => import('./pages/business/availability/AvailabilityPage'), 'AvailabilityPage')
const NewVendorProfilePage = lazyPage(() => import('./pages/business/VendorProfileFormPage'), 'NewVendorProfilePage')
const EditVendorProfilePage = lazyPage(() => import('./pages/business/VendorProfileFormPage'), 'EditVendorProfilePage')
const MarketplaceAccessPage = lazyPage(() => import('./pages/business/MarketplaceAccessPage'), 'MarketplaceAccessPage')
const PublicEventPage = lazyPage(() => import('./pages/PublicEventPage'), 'PublicEventPage')
const EventRegisterPage = lazyPage(() => import('./pages/EventRegisterPage'), 'EventRegisterPage')
const ApplyPage = lazyPage(() => import('./pages/ApplyPage'), 'ApplyPage')
const PublicPassPage = lazyPage(() => import('./pages/PublicPassPage'), 'PublicPassPage')
const ExploreEventsPage = lazyPage(() => import('./pages/ExploreEventsPage'), 'ExploreEventsPage')
const AdminOverviewPage = lazyPage(() => import('./pages/admin/OverviewPage'), 'OverviewPage')
const OrganizationsPage = lazyPage(() => import('./pages/admin/OrganizationsPage'), 'OrganizationsPage')
const OrganizationDetailPage = lazyPage(() => import('./pages/admin/OrganizationDetailPage'), 'OrganizationDetailPage')
const ApprovalsQueuePage = lazyPage(() => import('./pages/admin/approvals/QueuePage'), 'ApprovalsQueuePage')
const WhiteLabelApprovalsPage = lazyPage(() => import('./pages/admin/approvals/WhiteLabelApprovalsPage'), 'WhiteLabelApprovalsPage')
const MarketplaceApprovalsPage = lazyPage(() => import('./pages/admin/approvals/MarketplaceApprovalsPage'), 'MarketplaceApprovalsPage')
const ContactMessagesPage = lazyPage(() => import('./pages/admin/ContactMessagesPage'), 'ContactMessagesPage')
const SmsApprovalsPage = lazyPage(() => import('./pages/admin/approvals/SmsApprovalsPage'), 'SmsApprovalsPage')
const ListingsApprovalsPage = lazyPage(() => import('./pages/admin/approvals/ListingsApprovalsPage'), 'ListingsApprovalsPage')
const AdminBillingPage = lazyPage(() => import('./pages/admin/billing/BillingPage'), 'BillingPage')
const SegmentsPage = lazyPage(() => import('./pages/admin/SegmentsPage'), 'SegmentsPage')
const ModulesPage = lazyPage(() => import('./pages/admin/ModulesPage'), 'ModulesPage')
const CatalogPage = lazyPage(() => import('./pages/admin/CatalogPage'), 'CatalogPage')
const BannersPage = lazyPage(() => import('./pages/admin/BannersPage'), 'BannersPage')
const FeaturedEventsPage = lazyPage(() => import('./pages/admin/FeaturedEventsPage'), 'FeaturedEventsPage')
const SiteLogoPage = lazyPage(() => import('./pages/admin/SiteLogoPage'), 'SiteLogoPage')
const ActivityPage = lazyPage(() => import('./pages/admin/ActivityPage'), 'ActivityPage')
const PaymentsPage = lazyPage(() => import('./pages/payments/PaymentsPage'), 'PaymentsPage')
const PaymentsAdminPage = lazyPage(() => import('./pages/admin/PaymentsAdminPage'), 'PaymentsAdminPage')
const EventAnalyticsPage = lazyPage(() => import('./pages/EventAnalyticsPage'), 'default')
const TasksPage = lazyPage(() => import('./pages/tasks/TasksPage'), 'TasksPage')
const TaskFormPage = lazyPage(() => import('./pages/tasks/TaskFormPage'), 'TaskFormPage')
const WhiteLabelPage = lazyPage(() => import('./pages/WhiteLabelPage'), 'default')
const PricingPage = lazyPage(() => import('./pages/PricingPage'), 'default')
const VerifyEmailPage = lazyPage(() => import('./pages/account/VerifyEmailPage'), 'VerifyEmailPage')
const MyTicketsPage = lazyPage(() => import('./pages/account/MyTicketsPage'), 'MyTicketsPage')
const MyInquiriesPage = lazyPage(() => import('./pages/account/MyInquiriesPage'), 'MyInquiriesPage')
const MyPaymentsPage = lazyPage(() => import('./pages/account/MyPaymentsPage'), 'MyPaymentsPage')
const MyReviewsPage = lazyPage(() => import('./pages/account/MyReviewsPage'), 'MyReviewsPage')
const ProfilePage = lazyPage(() => import('./pages/account/ProfilePage'), 'ProfilePage')
const ReviewsManagePage = lazyPage(() => import('./pages/ReviewsManagePage'), 'ReviewsManagePage')
const MessagesPage = lazyPage(() => import('./pages/chat/MessagesPage'), 'MessagesPage')
// Legal pages: always reachable (not a superadmin module), linked from footers, sign-up and the mobile app
const PrivacyPage = lazyPage(() => import('./pages/legal/PrivacyPage'), 'PrivacyPage')
const TermsPage = lazyPage(() => import('./pages/legal/TermsPage'), 'TermsPage')
const CommunityGuidelinesPage = lazyPage(() => import('./pages/legal/CommunityGuidelinesPage'), 'CommunityGuidelinesPage')
const DeleteAccountPage = lazyPage(() => import('./pages/legal/DeleteAccountPage'), 'DeleteAccountPage')
const ContactPage = lazyPage(() => import('./pages/legal/ContactPage'), 'ContactPage')
// Blog (superadmin module `blog`): public guides + the editor in the platform admin
const BlogListPage = lazyPage(() => import('./pages/blog/BlogListPage'), 'BlogListPage')
const BlogPostPage = lazyPage(() => import('./pages/blog/BlogPostPage'), 'BlogPostPage')
const BlogAdminPage = lazyPage(() => import('./pages/admin/blog/BlogAdminPage'), 'BlogAdminPage')
const BlogEditorPage = lazyPage(() => import('./pages/admin/blog/BlogEditorPage'), 'BlogEditorPage')
// Google Analytics / search-engine verification settings (not named Analytics…: ad blockers block such chunks)
const MeasurementPage = lazyPage(() => import('./pages/admin/MeasurementPage'), 'MeasurementPage')


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
})

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation()
  React.useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/** Attendee-facing pages: just the brand, no organizer chrome. */
const PublicLayout: React.FC = () => (
  <div className="min-h-screen bg-ink-50">
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
        <Link to="/" aria-label="Eventlaya home">
          <Logo className="scale-90 origin-left" />
        </Link>
      </div>
    </header>
    <main id="main">
      <React.Suspense fallback={<PageLoading />}>
        <Outlet />
      </React.Suspense>
    </main>
    <LegalFooter />
  </div>
)

const ORGANIZER = ['organizer', 'superadmin'] as const

const organizer = (el: React.ReactNode) => <RequireAuth roles={[...ORGANIZER]}>{el}</RequireAuth>
/** Marketplace business portal: vendors, organizers with approved access, platform admins. */
const business = (el: React.ReactNode) => <RequireBusiness>{el}</RequireBusiness>

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <ToastProvider>
            <React.Suspense fallback={<PageLoading />}>
            {TENANT_HOST ? (
              <TenantApp />
            ) : (
            <Routes>
              {/* Marketing site */}
              <Route element={<MarketingLayout />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/events" element={<ExploreEventsPage />} />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/marketplace" element={<MarketplacePage />} />
                <Route path="/marketplace/venues/:slug" element={<VenueDetailPage />} />
                <Route path="/marketplace/vendors/:id" element={<VendorDetailPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/community-guidelines" element={<CommunityGuidelinesPage />} />
                <Route path="/delete-account" element={<DeleteAccountPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/blog" element={<BlogListPage />} />
                <Route path="/blog/:slug" element={<BlogPostPage />} />
              </Route>

              {/* Attendee pages */}
              <Route element={<PublicLayout />}>
                <Route path="/e/:slug" element={<PublicEventPage />} />
                <Route path="/e/:slug/register" element={<EventRegisterPage />} />
                <Route path="/e/:slug/apply" element={<ApplyPage />} />
                <Route path="/e/:slug/vote" element={<PublicVotePage />} />
                <Route path="/e/:slug/vote/:pollId" element={<PublicVotePage />} />
                <Route path="/e/:slug/vote/:pollId/c/:cref" element={<PublicVotePage />} />
                <Route path="/ticket/:token" element={<PublicPassPage />} />
              </Route>

              {/* Auth */}
              {/* Big-screen presenter: full screen, outside the app shell */}
              <Route path="/app/voting/:id/present" element={organizer(<PresenterPage />)} />
              <Route path="/app/voting/contests/:id/present" element={organizer(<ContestPresenterPage />)} />
              {/* Contest judges (any signed-in account assigned as a judge): full screen, tablet/phone friendly */}
              <Route path="/judge" element={<RequireAuth><JudgeHomePage /></RequireAuth>} />
              <Route path="/judge/:judgeId" element={<RequireAuth><JudgeScoringPage /></RequireAuth>} />

              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/verify-email" element={<RequireAuth><VerifyEmailPage /></RequireAuth>} />

              {/* Organizer app */}
              <Route
                path="/app"
                element={
                  <RequireAuth roles={['organizer', 'staff', 'superadmin', 'vendor', 'attendee']}>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<AppHome><DashboardPage /></AppHome>} />
                <Route path="events" element={organizer(<EventsPage />)} />
                <Route path="events/ticketing" element={organizer(<TicketingEventsPage />)} />
                <Route path="events/registration" element={organizer(<RegistrationEventsPage />)} />
                <Route path="events/pageants" element={organizer(<PageantEventsPage />)} />
                <Route path="forms" element={organizer(<FormBuilderPage />)} />
                <Route path="scanner" element={<RequireAuth roles={['organizer', 'staff', 'superadmin']}><GateScannerPage /></RequireAuth>} />
                <Route path="gates" element={organizer(<GatesPage />)} />
                <Route path="tickets" element={organizer(<TicketsPage />)} />
                <Route path="printed-tickets" element={organizer(<PrintedTicketsPage />)} />
                <Route path="payments" element={organizer(<PaymentsPage />)} />
                <Route path="team" element={organizer(<TeamPage />)} />
                <Route path="voting" element={organizer(<VotingPage />)} />
                <Route path="voting/new" element={organizer(<PollBuilderPage />)} />
                <Route path="voting/contests/new" element={organizer(<ContestCreatePage />)} />
                <Route path="voting/contests/:id" element={organizer(<ContestDashboardPage />)} />
                <Route path="voting/contests/:id/edit" element={organizer(<ContestBuilderPage />)} />
                <Route path="voting/:id" element={organizer(<PollResultsPage />)} />
                <Route path="voting/:id/edit" element={organizer(<PollBuilderPage />)} />
                <Route path="analytics" element={organizer(<EventAnalyticsPage />)} />
                <Route path="applications" element={organizer(<ApplicationsPage />)} />
                <Route path="events/new" element={organizer(<EventFormPage />)} />
                <Route path="events/:id/edit" element={organizer(<EventFormPage />)} />
                <Route path="events/:id/analytics" element={organizer(<EventAnalyticsPage />)} />
                <Route path="tasks" element={organizer(<TasksPage />)} />
                <Route path="tasks/new" element={organizer(<TaskFormPage />)} />
                <Route path="tasks/:id/edit" element={organizer(<TaskFormPage />)} />
                {/* Marketplace business portal */}
                <Route path="business" element={business(<BusinessHomePage />)} />
                <Route path="listings" element={business(<ListingsPage />)} />
                <Route path="listings/venues/new" element={business(<ListVenuePage />)} />
                <Route path="listings/venues/:slug/edit" element={business(<EditVenuePage />)} />
                <Route path="listings/vendor/new" element={business(<NewVendorProfilePage />)} />
                <Route path="listings/vendor/:id/edit" element={business(<EditVendorProfilePage />)} />
                <Route path="inquiries" element={business(<InquiriesPage />)} />
                <Route path="availability" element={business(<AvailabilityPage />)} />
                <Route path="bookings" element={business(<BookingsPage />)} />
                <Route path="marketplace-access" element={<RequireAuth roles={['organizer', 'vendor']}><MarketplaceAccessPage /></RequireAuth>} />
                <Route path="marketplace/*" element={<LegacyMarketplaceRedirect />} />
                <Route path="branding" element={organizer(<WhiteLabelPage />)} />
                <Route path="billing" element={<RequireAuth roles={['organizer', 'superadmin', 'vendor']}><PricingPage /></RequireAuth>} />
                {/* Your own account: attendees, and organizers who attend events too */}
                <Route path="my/tickets" element={<MyTicketsPage />} />
                <Route path="my/inquiries" element={<MyInquiriesPage />} />
                <Route path="my/payments" element={<MyPaymentsPage />} />
                <Route path="my/reviews" element={<MyReviewsPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="reviews" element={<RequireAuth roles={['organizer', 'superadmin', 'vendor']}><ReviewsManagePage /></RequireAuth>} />
                <Route path="messages" element={<RequireAuth roles={['organizer', 'staff']}><MessagesPage /></RequireAuth>} />
                <Route path="messages/:id" element={<RequireAuth roles={['organizer', 'staff']}><MessagesPage /></RequireAuth>} />
              </Route>

              {/* Platform admin */}
              <Route
                path="/admin"
                element={
                  <RequireAuth roles={['superadmin']}>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<AdminOverviewPage />} />
                <Route path="organizations" element={<OrganizationsPage />} />
                <Route path="organizations/:id" element={<OrganizationDetailPage />} />
                <Route path="approvals" element={<ApprovalsQueuePage />} />
                <Route path="approvals/white-label" element={<WhiteLabelApprovalsPage />} />
                <Route path="approvals/marketplace" element={<MarketplaceApprovalsPage />} />
                <Route path="approvals/listings" element={<ListingsApprovalsPage />} />
                <Route path="approvals/sms" element={<SmsApprovalsPage />} />
                <Route path="contact-messages" element={<ContactMessagesPage />} />
                <Route path="billing" element={<AdminBillingPage />} />
                <Route path="segments" element={<SegmentsPage />} />
                <Route path="modules" element={<ModulesPage />} />
                <Route path="catalog" element={<CatalogPage />} />
                <Route path="banners" element={<BannersPage />} />
                <Route path="site-logo" element={<SiteLogoPage />} />
                <Route path="featured-events" element={<FeaturedEventsPage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="blog" element={<BlogAdminPage />} />
                <Route path="blog/new" element={<BlogEditorPage />} />
                <Route path="blog/:id" element={<BlogEditorPage />} />
                <Route path="payments" element={<PaymentsAdminPage />} />
                <Route path="analytics" element={<MeasurementPage />} />
              </Route>

              {/* Old URLs */}
              <Route path="/forms" element={<Navigate to="/app/forms" replace />} />
              <Route path="/scanner" element={<Navigate to="/app/scanner" replace />} />
              <Route path="/voting" element={<Navigate to="/app/voting" replace />} />
              <Route path="/analytics" element={<Navigate to="/app/analytics" replace />} />
              <Route path="/white-label" element={<Navigate to="/app/branding" replace />} />
              <Route path="/superadmin" element={<Navigate to="/admin" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            )}
            </React.Suspense>
            {/* Title, description, canonical, Open Graph and JSON-LD for the current page (lib/seo.tsx) */}
            <SeoHead />
            {/* Google Analytics page views with sanitized URLs (lib/analytics.ts); off on white-label sites */}
            <AnalyticsTracker />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

const PageLoading: React.FC = () => (
  <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
    <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
  </div>
)

const NotFound: React.FC = () => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4 text-center">
    <Logo />
    <h1 className="mt-10 font-display text-4xl font-bold text-ink-900">This page doesn’t exist</h1>
    <p className="mt-2 text-ink-600">The link may be old, or the event may have been unpublished.</p>
    <div className="mt-6 flex gap-3">
      <Link to="/" className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
        Go to the homepage
      </Link>
      <Link to="/app" className="rounded-[10px] border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-50">
        Open dashboard
      </Link>
    </div>
  </div>
)

export default App
