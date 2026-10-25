import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Users,
  UserCheck,
  Calendar,
  QrCode,
  ArrowRight,
  TrendingUp,
  FileSpreadsheet,
  Vote,
  Sparkles,
  Ticket as TicketIcon
} from 'lucide-react'
import { api, type Ticket } from '@/services/api'
import { TicketPassModal } from '@/components/TicketPassModal'
import { cn } from '@/lib/utils'

export const DashboardPage: React.FC = () => {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['events'],
    queryFn: api.getEvents,
  })

  // Grab primary event (first event or tech fest)
  const primaryEvent = events[0]

  const { data: gateStats } = useQuery({
    queryKey: ['gateStats', primaryEvent?.id],
    queryFn: () => (primaryEvent ? api.getGateStats(primaryEvent.id) : null),
    enabled: Boolean(primaryEvent?.id),
    refetchInterval: 5000, // Live poll every 5s
  })

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets', primaryEvent?.id],
    queryFn: () => (primaryEvent ? api.getEventTickets(primaryEvent.id) : []),
    enabled: Boolean(primaryEvent?.id),
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-brand-950 text-white p-6 sm:p-8 shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 text-xs font-semibold backdrop-blur-xs border border-brand-500/30">
            <Sparkles className="w-3.5 h-3.5 text-brand-400" />
            Eastern Nepal Event Management SaaS
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Eventlaya Organizer Command Center
          </h1>
          <p className="text-slate-300 text-sm leading-relaxed">
            Real-time control over attendee registrations, QR ticketing passes, Gate In / Gate Out entry logs, and interactive voting.
          </p>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/scanner"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-600/30 transition"
            >
              <QrCode className="w-4 h-4" />
              Open Gate Scanner Terminal
            </Link>
            <Link
              to="/forms"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-xs transition"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Manage Dynamic Forms
            </Link>
            <Link
              to="/e/eastern-tech-fest-2026"
              target="_blank"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-xs transition"
            >
              Preview Public Landing →
            </Link>
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Registered</p>
            <p className="text-2xl font-black text-slate-900 mt-1">
              {gateStats?.total_registered ?? primaryEvent?.registered_count ?? 0}
            </p>
            <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3" /> Live attendee roster
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Inside Venue</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">
              {gateStats?.currently_inside ?? primaryEvent?.checked_in_count ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 font-medium mt-1">
              Capacity: {primaryEvent?.capacity || 'Unlimited'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Checked Out</p>
            <p className="text-2xl font-black text-amber-600 mt-1">
              {gateStats?.total_checked_out ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 font-medium mt-1">Logged gate exits</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <QrCode className="w-6 h-6" />
          </div>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Published Events</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{events.length}</p>
            <p className="text-[11px] text-brand-600 font-medium mt-1">All active & published</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <Calendar className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Grid: Real-time Gate Audit Stream & Registered Attendees */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Registered Attendee Passes (2 Cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Registered Attendees & Digital Passes</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any attendee to inspect and print their verified QR entry pass.
              </p>
            </div>
            <Link to="/events" className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1">
              View All <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3">Attendee</th>
                  <th className="px-4 py-3">Ticket #</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Check-In Time</th>
                  <th className="px-5 py-3 text-right">Pass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5">
                      <p className="font-bold text-slate-900">{t.attendee_name}</p>
                      <p className="text-slate-400 text-[11px]">{t.attendee_email}</p>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-600">{t.ticket_number}</td>
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                          t.status === 'checked_in' && 'bg-emerald-100 text-emerald-800',
                          t.status === 'checked_out' && 'bg-amber-100 text-amber-800',
                          t.status === 'valid' && 'bg-indigo-50 text-indigo-700'
                        )}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-500">
                      {t.first_check_in ? new Date(t.first_check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedTicket(t)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition"
                      >
                        <TicketIcon className="w-3.5 h-3.5 text-brand-600" />
                        View Pass
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Real-time Gate Audit Stream (1 Col) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 className="text-base font-bold text-slate-900">Live Gate Scans</h2>
              <p className="text-xs text-slate-500 mt-0.5">Real-time entry & exit audit log</p>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          </div>

          <div className="p-4 divide-y divide-slate-100 overflow-y-auto max-h-[420px]">
            {gateStats?.recent_scans && gateStats.recent_scans.length > 0 ? (
              gateStats.recent_scans.map((scan) => (
                <div key={scan.id} className="py-2.5 flex items-start justify-between gap-2 text-xs">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider',
                          scan.scan_type === 'gate_in' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {scan.scan_type === 'gate_in' ? 'IN' : 'OUT'}
                      </span>
                      <span className="font-bold text-slate-900">{scan.attendee_name}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{scan.ticket_number} • {scan.gate_name}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {new Date(scan.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-slate-400 text-xs">
                No scans recorded yet. Use the Gate Scanner to check in attendees.
              </div>
            )}
          </div>

          <div className="p-3 border-t border-slate-100 bg-slate-50/50 mt-auto">
            <Link
              to="/scanner"
              className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition"
            >
              <QrCode className="w-3.5 h-3.5" /> Launch Gate Scanner Terminal
            </Link>
          </div>
        </div>
      </div>

      {/* Ticket Pass Modal */}
      {selectedTicket && (
        <TicketPassModal
          ticket={selectedTicket}
          eventTitle={primaryEvent?.title}
          eventLocation={primaryEvent?.location}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  )
}
