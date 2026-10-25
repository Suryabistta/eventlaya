import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navbar } from './components/Navbar'
import { DashboardPage } from './pages/DashboardPage'
import { EventsPage } from './pages/EventsPage'
import { FormBuilderPage } from './pages/FormBuilderPage'
import { GateScannerPage } from './pages/GateScannerPage'
import { VotingPage } from './pages/VotingPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { PublicEventPage } from './pages/PublicEventPage'
import { SuperadminPage } from './pages/SuperadminPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
})

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
          <Navbar />
          <main className="flex-1 pb-16">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/forms" element={<FormBuilderPage />} />
              <Route path="/scanner" element={<GateScannerPage />} />
              <Route path="/voting" element={<VotingPage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/superadmin" element={<SuperadminPage />} />
              <Route path="/e/:slug" element={<PublicEventPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>

          <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
            <p className="font-semibold text-slate-700">
              Eventlaya — Event Management SaaS + Services Marketplace
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Designed for Clubs, Colleges, Conferences & Gate Security in Eastern Nepal (Dharan • Itahari • Biratnagar)
            </p>
          </footer>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
