import React, { useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Ticket as TicketIcon, Calendar, MapPin, Printer, X, CheckCircle, ShieldCheck } from 'lucide-react'
import type { Ticket } from '@/services/api'

interface Props {
  ticket: Ticket
  eventTitle?: string
  eventLocation?: string
  eventDate?: string
  onClose: () => void
}

export const TicketPassModal: React.FC<Props> = ({
  ticket,
  eventTitle = 'Eastern Tech Fest & Hackathon 2026',
  eventLocation = 'Purwanchal Campus Auditorium, Dharan',
  eventDate = 'Oct 27 - 28, 2026',
  onClose,
}) => {
  const cardRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Printable Ticket Card */}
        <div ref={cardRef} className="p-6">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-brand-600 to-indigo-700 -m-6 mb-6 p-6 text-white text-center">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-white text-xs font-semibold uppercase tracking-wider mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified Digital Pass
            </div>
            <h3 className="font-extrabold text-xl leading-snug">{eventTitle}</h3>
            <p className="text-brand-100 text-xs mt-1">Official Gate In / Out Entry Ticket</p>
          </div>

          {/* QR Code Container */}
          <div className="flex flex-col items-center justify-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 my-4">
            <div className="p-3 bg-white rounded-xl shadow-xs border border-slate-100">
              <QRCodeSVG
                value={ticket.qr_token}
                size={168}
                level="H"
                includeMargin={false}
              />
            </div>
            <p className="font-mono text-xs font-bold text-slate-800 tracking-wider mt-3">
              {ticket.ticket_number}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Scan at gate camera for entry</p>
          </div>

          {/* Attendee Details */}
          <div className="space-y-3 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 text-xs">Attendee:</span>
              <span className="font-bold text-slate-900">{ticket.attendee_name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 text-xs">Email:</span>
              <span className="font-medium text-slate-700 text-xs">{ticket.attendee_email}</span>
            </div>
            {ticket.attendee_phone && (
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-xs">Phone:</span>
                <span className="font-medium text-slate-700 text-xs">{ticket.attendee_phone}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-slate-500 text-xs">Date:</span>
              <span className="flex items-center gap-1 text-slate-700 text-xs font-medium">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {eventDate}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 text-xs">Venue:</span>
              <span className="flex items-center gap-1 text-slate-700 text-xs font-medium">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                {eventLocation}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 text-xs">Gate Status:</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <CheckCircle className="w-3 h-3" />
                {ticket.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition"
          >
            <Printer className="w-4 h-4" />
            Print / Save PDF
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
