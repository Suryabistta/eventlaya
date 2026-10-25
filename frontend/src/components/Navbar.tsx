import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Calendar,
  LayoutDashboard,
  QrCode,
  Vote,
  Store,
  FileSpreadsheet,
  ExternalLink,
  Sparkles,
  Shield,
  TrendingUp,
  Globe,
  CreditCard
} from 'lucide-react'
import { cn } from '@/lib/utils'

export const Navbar: React.FC = () => {
  const location = useLocation()

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Events', path: '/events', icon: Calendar },
    { label: 'Analytics & Tasks', path: '/analytics', icon: TrendingUp },
    { label: 'Gate Scanner', path: '/scanner', icon: QrCode },
    { label: 'Form Builder', path: '/forms', icon: FileSpreadsheet },
    { label: 'Live Voting', path: '/voting', icon: Vote },
    { label: 'Marketplace', path: '/marketplace', icon: Store },
    { label: 'White-Label', path: '/white-label', icon: Globe },
    { label: 'Pricing & Plans', path: '/pricing', icon: CreditCard },
    { label: 'Superadmin', path: '/superadmin', icon: Shield },
  ]

  // Don't show full dashboard navbar on public event page
  const isPublicPage = location.pathname.startsWith('/e/')

  if (isPublicPage) {
    return (
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="font-extrabold text-xl tracking-tight text-slate-900">
              event<span className="text-brand-600">laya</span>
            </span>
          </Link>
          <Link
            to="/"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 px-3 py-1.5 rounded-lg transition"
          >
            ← Back to Organizer Portal
          </Link>
        </div>
      </header>
    )
  }

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-brand-500/25">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="font-extrabold text-xl tracking-tight text-slate-900">
              event<span className="text-brand-600">laya</span>
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                  )}
                >
                  <Icon className={cn('w-3.5 h-3.5', isActive ? 'text-brand-600' : 'text-slate-400')} />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/e/eastern-tech-fest-2026"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition"
          >
            Public Event Page
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </Link>

          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center">
              ET
            </div>
            <div className="hidden xl:block text-left text-xs">
              <p className="font-semibold text-slate-900 leading-none">Eastern Tech Club</p>
              <p className="text-slate-400 text-[10px] leading-tight">Organizer</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
