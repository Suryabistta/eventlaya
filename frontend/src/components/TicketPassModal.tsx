import React from 'react'
import { createPortal } from 'react-dom'
import { ModernQr } from './ModernQr'
import { Printer } from 'lucide-react'
import type { Ticket } from '@/services/api'
import { Button, Modal } from '@/components/ui'
import { DownloadPassButton } from '@/components/DownloadPassButton'
import { passPaymentLine } from '@/lib/payments'
import { cn } from '@/lib/utils'

interface PassProps {
  ticket: Ticket
  eventTitle?: string
  eventLocation?: string
  eventDate?: string
  className?: string
}

const statusLabel: Record<Ticket['status'], string> = {
  valid: 'Valid',
  checked_in: 'Inside',
  checked_out: 'Left the venue',
  cancelled: 'Cancelled',
  reserved: 'Awaiting payment',
}

/*
 * Pass layout lives in a small stylesheet so the stub can switch between a
 * stacked layout (narrow screens: bigger QR) and the side-by-side stub
 * (wide screens and print) with a container query, and so print can show
 * only the pass.
 */
const passCss = `
.el-pass { container-type: inline-size; }
.el-pass.is-vertical { max-width: 380px; margin-inline: auto; }
.el-pass.is-vertical .el-pass-qr { width: 208px; height: 208px; }
.el-pass-inner { display: flex; flex-direction: column; }
.el-pass-body {
  -webkit-mask: radial-gradient(circle 12px at 0 100%, transparent 98%, #000) left / 51% 100% no-repeat,
                radial-gradient(circle 12px at 100% 100%, transparent 98%, #000) right / 51% 100% no-repeat;
          mask: radial-gradient(circle 12px at 0 100%, transparent 98%, #000) left / 51% 100% no-repeat,
                radial-gradient(circle 12px at 100% 100%, transparent 98%, #000) right / 51% 100% no-repeat;
}
.el-pass-stub {
  -webkit-mask: radial-gradient(circle 12px at 0 0, transparent 98%, #000) left / 51% 100% no-repeat,
                radial-gradient(circle 12px at 100% 0, transparent 98%, #000) right / 51% 100% no-repeat;
          mask: radial-gradient(circle 12px at 0 0, transparent 98%, #000) left / 51% 100% no-repeat,
                radial-gradient(circle 12px at 100% 0, transparent 98%, #000) right / 51% 100% no-repeat;
}
.el-pass-body { border-radius: 16px 16px 0 0; }
.el-pass-stub { position: relative; border-radius: 0 0 16px 16px; }
.el-pass-stub::before {
  content: ''; position: absolute; top: 0; left: 18px; right: 18px;
  border-top: 2px dashed rgb(255 255 255 / 0.22);
}
.el-pass-qr { width: 168px; height: 168px; }
/* Landscape passes put the stub beside the body once there is room; vertical passes always stack */
@container (min-width: 440px) {
  .el-pass:not(.is-vertical) .el-pass-inner { flex-direction: row; }
  .el-pass:not(.is-vertical) .el-pass-body {
    -webkit-mask: radial-gradient(circle 12px at 100% 0, transparent 98%, #000) top / 100% 51% no-repeat,
                  radial-gradient(circle 12px at 100% 100%, transparent 98%, #000) bottom / 100% 51% no-repeat;
            mask: radial-gradient(circle 12px at 100% 0, transparent 98%, #000) top / 100% 51% no-repeat,
                  radial-gradient(circle 12px at 100% 100%, transparent 98%, #000) bottom / 100% 51% no-repeat;
  }
  .el-pass:not(.is-vertical) .el-pass-stub {
    width: 176px; flex-shrink: 0;
    -webkit-mask: radial-gradient(circle 12px at 0 0, transparent 98%, #000) top / 100% 51% no-repeat,
                  radial-gradient(circle 12px at 0 100%, transparent 98%, #000) bottom / 100% 51% no-repeat;
            mask: radial-gradient(circle 12px at 0 0, transparent 98%, #000) top / 100% 51% no-repeat,
                  radial-gradient(circle 12px at 0 100%, transparent 98%, #000) bottom / 100% 51% no-repeat;
  }
  .el-pass:not(.is-vertical) .el-pass-body { border-radius: 16px 0 0 16px; }
  .el-pass:not(.is-vertical) .el-pass-stub { border-radius: 0 16px 16px 0; }
  .el-pass:not(.is-vertical) .el-pass-stub::before { top: 18px; bottom: 18px; left: 0; right: auto; border-top: 0; border-left: 2px dashed rgb(255 255 255 / 0.22); }
  .el-pass:not(.is-vertical) .el-pass-qr { width: 132px; height: 132px; }
}
.el-print-pass { display: none; }
@media print {
  @page { margin: 12mm; }
  html, body { background: #fff !important; }
  body > *:not(.el-print-pass) { display: none !important; }
  .el-print-pass { display: block !important; width: 640px; max-width: 100%; }
  .el-print-pass * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .el-print-page { break-inside: avoid; page-break-inside: avoid; }
  .el-print-page + .el-print-page { break-before: page; page-break-before: always; }
  .el-print-label { font: 600 12px/1.4 Poppins, system-ui, sans-serif; color: #6B6275; margin: 0 0 8px; }
}
`

/** The attendee pass: white ticket body, perforation, QR on a white tile on the brand stub. */
export const TicketPass: React.FC<PassProps> = ({ ticket, eventTitle, eventLocation, eventDate, className }) => <PassBody ticket={ticket} eventTitle={eventTitle} eventLocation={eventLocation} eventDate={eventDate} className={className} payLine={passPaymentLine(ticket)} />

const PassBody: React.FC<PassProps & { payLine: ReturnType<typeof passPaymentLine> }> = ({ ticket, eventTitle, eventLocation, eventDate, className, payLine }) => (
  <div className={className}>
    <style>{passCss}</style>
    <div className={cn('el-pass', ticket.pass_layout !== 'landscape' && 'is-vertical')} role="group" aria-label={`Entry pass for ${ticket.attendee_name}`}>
      <div className="el-pass-inner drop-shadow-[0_10px_24px_rgba(28,23,36,0.16)]">
        <div className="el-pass-body min-w-0 flex-1 bg-white p-5 text-ink-900 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            {eventTitle && <p className="min-w-0 text-sm font-semibold text-brand-700">{eventTitle}</p>}
            {ticket.ticket_type_name && (
              <span className="shrink-0 rounded-md bg-ink-900 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">{ticket.ticket_type_name}</span>
            )}
          </div>
          <p className="mt-2 break-words font-display text-2xl font-bold leading-tight">{ticket.attendee_name}</p>
          <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 text-sm">
            {eventDate && (
              <div className="col-span-2 min-w-0">
                <dt className="text-xs text-ink-500">Date</dt>
                <dd className="font-semibold">{eventDate}</dd>
              </div>
            )}
            {eventLocation && (
              <div className="col-span-2 min-w-0">
                <dt className="text-xs text-ink-500">Venue</dt>
                <dd className="font-semibold">{eventLocation}</dd>
              </div>
            )}
            <div className="min-w-0">
              <dt className="text-xs text-ink-500">Ticket</dt>
              <dd className="break-all font-mono text-[13px] font-medium">{ticket.ticket_number}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-ink-500">Status</dt>
              <dd className="font-semibold">{statusLabel[ticket.status] ?? ticket.status}</dd>
            </div>
            {ticket.bib_number && (
              <div className="col-span-2 min-w-0">
                <dt className="text-xs text-ink-500">Bib</dt>
                <dd className="font-display text-3xl font-bold tabular">{ticket.bib_number}</dd>
              </div>
            )}
            {ticket.seat_number && (
              <div className="col-span-2 min-w-0">
                <dt className="text-xs text-ink-500">Seat</dt>
                <dd className="font-display text-xl font-bold">{ticket.seat_number}</dd>
              </div>
            )}
          </dl>
          {payLine && (
            <p
              className={
                !payLine.paid
                  ? 'mt-4 rounded-lg bg-marigold-50 px-3 py-2 text-sm font-semibold text-marigold-900'
                  : 'mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800'
              }
            >
              {payLine.text}
              {ticket.promo_code && <span className="font-normal"> · code {ticket.promo_code}</span>}
            </p>
          )}
        </div>

        <div className="el-pass-stub flex flex-col items-center justify-center gap-2 bg-brand-600 p-5 text-white">
          <div className="rounded-xl bg-white p-2.5">
            <ModernQr
              value={ticket.qr_token}
              size={168}
              level="H"
              margin={0}
              color="#1C1724"
              className="el-pass-qr"
              aria-label={`QR code for ticket ${ticket.ticket_number}`}
            />
          </div>
          <p className="text-xs font-medium text-brand-50">Show this at the gate</p>
        </div>
      </div>
    </div>
  </div>
)

/** Renders a copy of the pass straight under <body>, visible only when printing. */
export const PrintablePass: React.FC<PassProps> = (props) =>
  createPortal(
    <div className="el-print-pass">
      <TicketPass {...props} />
    </div>,
    document.body,
  )

/** Several passes for printing, one per page. Render only one of these (or one PrintablePass) at a time. */
export const PrintablePasses: React.FC<Omit<PassProps, 'ticket' | 'className'> & { tickets: Ticket[] }> = ({ tickets, ...meta }) =>
  createPortal(
    <div className="el-print-pass">
      {tickets.map((t, i) => (
        <div key={t.id} className="el-print-page">
          {tickets.length > 1 && (
            <p className="el-print-label">
              Pass {i + 1} of {tickets.length}
              {t.order_reference ? ` · ${t.order_reference}` : ''}
            </p>
          )}
          <TicketPass ticket={t} {...meta} />
        </div>
      ))}
    </div>,
    document.body,
  )

interface Props extends Omit<PassProps, 'className'> {
  onClose: () => void
}

export const TicketPassModal: React.FC<Props> = ({ ticket, eventTitle, eventLocation, eventDate, onClose }) => (
  <Modal
    open
    onClose={onClose}
    title="Entry pass"
    description={ticket.attendee_email}
    footer={
      <>
        <Button variant="secondary" size="md" onClick={onClose}>
          Done
        </Button>
        <DownloadPassButton ticket={ticket} eventTitle={eventTitle} eventLocation={eventLocation} eventDate={eventDate} />
        <Button size="md" icon={<Printer className="h-4 w-4" aria-hidden />} onClick={() => window.print()}>
          Save or print pass
        </Button>
      </>
    }
  >
    <TicketPass ticket={ticket} eventTitle={eventTitle} eventLocation={eventLocation} eventDate={eventDate} />
    <PrintablePass ticket={ticket} eventTitle={eventTitle} eventLocation={eventLocation} eventDate={eventDate} />
  </Modal>
)
