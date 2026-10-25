import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  QrCode,
  Users,
  UserCheck,
  LogOut,
  Search,
  Sparkles,
  Ticket as TicketIcon,
  RefreshCw,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import { api, type Ticket } from '@/services/api'
import { GateScannerComponent } from '@/components/GateScannerComponent'
import { TicketPassModal } from '@/components/TicketPassModal'
import { cn } from '@/lib/utils'

export const GateScannerPage: React.FC = () => {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)

  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: api.getEvents,
  })

  const currentEvent = events[0]

  const { data: gateStats, refetch: refetchStats } = useQuery({
    queryKey: ['gateStats', currentEvent?.id],
    queryFn: () => (currentEvent ? api.getGateStats(currentEvent.id) : null),
    enabled: Boolean(currentEvent?.id),
    refetchInterval: 4000,
  })

  const { data: tickets = [], refetch: refetchTickets } = useQuery({
    queryKey: ['tickets', currentEvent?.id, searchQuery],
    queryFn: () => (currentEvent ? api.getEventTickets(currentEvent.id, searchQuery) : []),
    enabled: Boolean(currentEvent?.id),
  })

  const manualCheckInMutation = useMutation({
    mutationFn: ({ qr_token, scan_type }: { qr_token: string; scan_type: 'gate_in' | 'gate_out' }) =>
      api.scanTicket(currentEvent!.id, { qr_token, scan_type, gate_name: 'Manual Terminal' }),
    onSuccess: () => {
      refetchStats()
      refetchTickets()
    },
  })

  const handleRefreshAll = () => {
    refetchStats()
    refetchTickets()
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Top Banner / Event Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-slate-900 text-white rounded-3xl shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center text-white shadow-lg shadow-brand-600/30">
            <QrCode className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Gate Scanner Terminal
              </span>
              <span className="text-xs text-slate-400">• Online</span>
            </div>
            <h1 className="text-xl font-extrabold tracking-tight mt-0.5">
              {currentEvent?.title || 'Loading Event...'}
            </h1>
            <p className="text-xs text-slate-400">{currentEvent?.location}</p>
          </div>
        </div>

        <button
          onClick={handleRefreshAll}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition backdrop-blur-xs"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Stats
        </button>
      </div>

      {/* Live Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200/80 shadow-2xs">
          <p className="text-[10px] uppercase font-bold text-slate-400">Total Registered</p>
          <p className="text-2xl font-black text-slate-900 mt-0.5">{gateStats?.total_registered ?? 0}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Verified participants</p>
        </div>
        <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-200 shadow-2xs">
          <p className="text-[10px] uppercase font-bold text-emerald-800">Currently Inside</p>
          <p className="text-2xl font-black text-emerald-600 mt-0.5">{gateStats?.currently_inside ?? 0}</p>
          <p className="text-[11px] text-emerald-700 mt-0.5">Checked in at gate</p>
        </div>
        <div className="p-4 bg-amber-50/70 rounded-2xl border border-amber-200 shadow-2xs">
          <p className="text-[10px] uppercase font-bold text-amber-800">Checked Out</p>
          <p className="text-2xl font-black text-amber-600 mt-0.5">{gateStats?.total_checked_out ?? 0}</p>
          <p className="text-[11px] text-amber-700 mt-0.5">Exited through gate</p>
        </div>
        <div className="p-4 bg-indigo-50/70 rounded-2xl border border-indigo-200 shadow-2xs">
          <p className="text-[10px] uppercase font-bold text-indigo-800">Capacity Occupancy</p>
          <p className="text-2xl font-black text-indigo-600 mt-0.5">
            {gateStats?.capacity && gateStats.capacity > 0
              ? `${Math.round(((gateStats.currently_inside || 0) / gateStats.capacity) * 100)}%`
              : 'N/A'}
          </p>
          <p className="text-[11px] text-indigo-700 mt-0.5">Max: {gateStats?.capacity || 'Unlimited'}</p>
        </div>
      </div>

      {/* Camera Scanner View */}
      {currentEvent && (
        <GateScannerComponent
          eventId={currentEvent.id}
          onScanComplete={handleRefreshAll}
        />
      )}

      {/* Manual Search & Attendee Fallback Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Attendee Roster & Manual Gate Override</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Quickly look up participants by name, email, or ticket code to check them in or view their pass.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search attendee or ticket..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-9 pr-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-100">
              <tr>
                <th className="px-5 py-3">Attendee</th>
                <th className="px-4 py-3">Ticket #</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">First Entry</th>
                <th className="px-5 py-3 text-right">Gate Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-5 py-3.5">
                    <p className="font-bold text-slate-900">{t.attendee_name}</p>
                    <p className="text-slate-400 text-[11px]">{t.attendee_email}</p>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-slate-700 font-semibold">{t.ticket_number}</td>
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
                    {t.first_check_in ? new Date(t.first_check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}
                  </td>
                  <td className="px-5 py-3.5 text-right space-x-1.5">
                    {t.status !== 'checked_in' ? (
                      <button
                        onClick={() => manualCheckInMutation.mutate({ qr_token: t.qr_token, scan_type: 'gate_in' })}
                        disabled={manualCheckInMutation.isPending}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-xs"
                      >
                        Check In
                      </button>
                    ) : (
                      <button
                        onClick={() => manualCheckInMutation.mutate({ qr_token: t.qr_token, scan_type: 'gate_out' })}
                        disabled={manualCheckInMutation.isPending}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition shadow-xs"
                      >
                        Check Out
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedTicket(t)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition"
                    >
                      Pass
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ticket Pass Modal */}
      {selectedTicket && (
        <TicketPassModal
          ticket={selectedTicket}
          eventTitle={currentEvent?.title}
          eventLocation={currentEvent?.location}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  )
}
