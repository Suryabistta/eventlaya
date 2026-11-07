import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { Camera, CameraOff, CheckCircle2, XOctagon, AlertTriangle, LogIn, LogOut, ScanLine, Volume2, VolumeX, Lock } from 'lucide-react'
import { tokenStore, type ScanResult, type Ticket } from '@/services/api'
import { Badge, Button, Card, IconButton, Input, Select } from '@/components/ui'
import { gateAllows, gateKindLabel, type EventGate } from '@/lib/gates'
import { cn } from '@/lib/utils'

export type ScanType = 'gate_in' | 'gate_out'

export type ScanResponse = Omit<ScanResult, 'result'> & {
  result: ScanResult['result'] | 'capacity_full' | 'unpaid'
  status?: string
  expected_event?: string
  scanned_at?: string
  gate_name?: string
}

type Tone = 'success' | 'danger' | 'warning'

/** Strip the emoji/label prefix the API puts on messages ("⚠️ Duplicate Scan: ..."). */
const cleanMessage = (msg = '') => {
  const s = msg.replace(/^[^\p{L}\p{N}]+/u, '')
  const colon = s.indexOf(': ')
  return colon > -1 && colon < 30 ? s.slice(colon + 2) : s
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Turn an API scan response into what gate staff need to see. */
export function describeScan(res: ScanResponse, scanType: ScanType): { tone: Tone; title: string; detail: string } {
  switch (res.result) {
    case 'success':
      if (scanType === 'gate_out') return { tone: 'success', title: 'Checked out', detail: 'They can come back in with the same pass.' }
      if (res.status === 're_entry') return { tone: 'success', title: 'Welcome back', detail: 'Re-entry allowed.' }
      // Pay-at-venue tickets: remind staff to collect the money
      if (res.ticket?.payment?.status === 'due' && Number(res.ticket.price) > 0)
        return { tone: 'success', title: 'Let them in', detail: `Pass is valid. Collect Rs ${Number(res.ticket.price).toLocaleString('en-IN')} (pay at the venue).` }
      return { tone: 'success', title: 'Let them in', detail: 'Pass is valid. First entry.' }
    case 'duplicate':
      return {
        tone: 'danger',
        title: 'Already inside',
        detail: res.ticket?.first_check_in
          ? `This pass was used at ${fmtTime(res.ticket.first_check_in)}. Don't let a second person in on it.`
          : cleanMessage(res.message),
      }
    case 'capacity_full':
      return { tone: 'danger', title: 'Venue is full', detail: `${cleanMessage(res.message)} Check someone out before letting more in.` }
    case 'not_in':
      return { tone: 'warning', title: 'Not checked in', detail: "This person isn't marked as inside, so there's nothing to check out." }
    case 'wrong_event':
      return {
        tone: 'danger',
        title: 'Wrong event',
        detail: res.expected_event ? `This pass is for ${res.expected_event}.` : cleanMessage(res.message),
      }
    case 'cancelled':
      return {
        tone: 'danger',
        title: 'Entry denied',
        detail: res.ticket ? 'This ticket was cancelled.' : 'This event was cancelled by the organizer.',
      }
    case 'unpaid':
      return {
        tone: 'danger',
        title: 'Not paid',
        detail: `${cleanMessage(res.message)} Don't let them in on this pass.`,
      }
    case 'wrong_ticket_gate':
      return { tone: 'warning', title: 'Wrong gate', detail: `${cleanMessage(res.message)} Don't let them in here.` }
    case 'early_date':
      return { tone: 'danger', title: 'Too early', detail: cleanMessage(res.message) }
    case 'expired':
      return { tone: 'danger', title: 'Event has ended', detail: cleanMessage(res.message) }
    default:
      return {
        tone: 'danger',
        title: 'Ticket not found',
        detail: res.message && !res.message.includes('QR token')
          ? cleanMessage(res.message)
          : 'No ticket matches this code. Check the number, or send them to the help desk.',
      }
  }
}

/** Gate scan that keeps the response body on 4xx, so denied scans still show who it was. */
export class ScanRequestError extends Error {
  /** HTTP status, or 0 when the request never reached the server */
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function postScan(
  eventId: string,
  body: { qr_token: string; scan_type: ScanType; gate_id?: string; gate_name?: string },
): Promise<ScanResponse> {
  const token = tokenStore.access
  let res: Response
  try {
    res = await fetch(`/api/events/${eventId}/gate/scan/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    })
  } catch {
    throw new ScanRequestError("Couldn't reach the server. Check your connection and scan again.", 0)
  }
  const data = await res.json().catch(() => null)
  if (data && typeof data.result === 'string') return data as ScanResponse
  throw new ScanRequestError(data?.error || data?.detail || `The server responded with ${res.status}. Try again.`, res.status)
}

const REPEAT_COOLDOWN_MS = 3000

interface LastScan {
  seq: number
  tone: Tone
  title: string
  detail: string
  ticket?: Ticket
  at: Date
  gate: string
}

interface Props {
  eventId: string
  /** The event's open gates */
  gates: EventGate[]
  /** Staff: the gate their organizer assigned them to. They can't switch. */
  lockedGate?: EventGate | null
  onGateChange?: (gate: EventGate | undefined) => void
  onScanComplete?: () => void
}

export const GateScannerComponent: React.FC<Props> = ({ eventId, gates, lockedGate, onGateChange, onScanComplete }) => {
  const modeAllowed = (mode: ScanType) =>
    lockedGate ? gateAllows(lockedGate.kind, mode) : gates.some((g) => gateAllows(g.kind, mode))
  const [scanType, setScanType] = useState<ScanType>(() => (modeAllowed('gate_in') ? 'gate_in' : 'gate_out'))
  const compatible = lockedGate ? [lockedGate] : gates.filter((g) => gateAllows(g.kind, scanType))
  const [chosenId, setChosenId] = useState<string | undefined>(lockedGate?.id)
  // Fall back to the first gate that allows the current mode
  const gate = compatible.find((g) => g.id === chosenId) ?? compatible[0]
  const gateName = gate?.name ?? ''
  const gateId = gate?.id
  useEffect(() => {
    onGateChange?.(gate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId])
  const [isScanning, setIsScanning] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [manualToken, setManualToken] = useState('')
  const [last, setLast] = useState<LastScan | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  // The camera callback is registered once, so it reads current settings through refs
  const settings = useRef({ scanType, gateName, gateId, soundEnabled, eventId })
  settings.current = { scanType, gateName, gateId, soundEnabled, eventId }
  const busy = useRef(false)
  const lastToken = useRef<{ token: string; at: number } | null>(null)
  const seq = useRef(0)
  const containerId = 'gate-qr-viewfinder'
  const resultRef = useRef<HTMLDivElement>(null)

  // Keep the latest result on screen on phones, where it sits below the camera
  useEffect(() => {
    if (last) resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [last])

  const feedback = (tone: Tone) => {
    try {
      navigator.vibrate?.(tone === 'success' ? 80 : [200, 100, 200])
    } catch {
      /* not supported */
    }
    if (!settings.current.soundEnabled) return
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      if (tone === 'success') {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime)
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25)
        osc.start()
        osc.stop(ctx.currentTime + 0.25)
      } else if (tone === 'warning') {
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(220, ctx.currentTime)
        osc.frequency.setValueAtTime(180, ctx.currentTime + 0.15)
        gain.gain.setValueAtTime(0.4, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4)
        osc.start()
        osc.stop(ctx.currentTime + 0.4)
      } else {
        osc.type = 'square'
        osc.frequency.setValueAtTime(150, ctx.currentTime)
        gain.gain.setValueAtTime(0.4, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
        osc.start()
        osc.stop(ctx.currentTime + 0.3)
      }
    } catch {
      // Audio can be blocked until the user interacts with the page
    }
  }

  const processToken = async (raw: string, fromCamera = false) => {
    const token = raw.trim()
    if (!token || busy.current) return
    // The camera sees the same pass many times a second: only act on it once
    const now = Date.now()
    if (fromCamera && lastToken.current?.token === token && now - lastToken.current.at < REPEAT_COOLDOWN_MS) return
    lastToken.current = { token, at: now }

    busy.current = true
    setIsProcessing(true)
    const { scanType: type, gateName: gate, gateId: gId, eventId: id } = settings.current
    try {
      if (!gId) throw new ScanRequestError('Pick a gate before scanning.', 400)
      const res = await postScan(id, { qr_token: token, scan_type: type, gate_id: gId })
      const d = describeScan(res, type)
      feedback(d.tone)
      setLast({ seq: ++seq.current, ...d, ticket: res.ticket ?? undefined, at: new Date(), gate })
      onScanComplete?.()
    } catch (err) {
      feedback('danger')
      setLast({
        seq: ++seq.current,
        tone: 'danger',
        title: err instanceof ScanRequestError && err.status >= 400 && err.status < 500 ? "Can't scan here" : "Couldn't check this pass",
        detail: err instanceof Error ? err.message : "Couldn't reach the server. Check your connection and scan again.",
        at: new Date(),
        gate,
      })
    } finally {
      busy.current = false
      setIsProcessing(false)
      if (!fromCamera) setManualToken('')
    }
  }

  const startCamera = async () => {
    setCameraError(null)
    try {
      const qr = new Html5Qrcode(containerId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false })
      scannerRef.current = qr
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s } }, aspectRatio: 1.0 },
        (decoded) => void processToken(decoded, true),
        () => {},
      )
      setIsScanning(true)
    } catch (err) {
      console.warn('Unable to access camera:', err)
      setIsScanning(false)
      setCameraError("Couldn't start the camera. Allow camera access for this site in your browser settings, or type the ticket number below.")
    }
  }

  const stopCamera = async () => {
    const qr = scannerRef.current
    if (qr?.isScanning) {
      try {
        await qr.stop()
        qr.clear()
      } catch (e) {
        console.error(e)
      }
    }
    setIsScanning(false)
  }

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) scannerRef.current.stop().catch(() => {})
    }
  }, [])

  const isIn = scanType === 'gate_in'

  return (
    <Card className="overflow-hidden">
      {/* Mode + gate */}
      <div className="space-y-3 border-b border-ink-100 p-4 sm:p-5">
        <div role="group" aria-label="Scan mode" className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1">
          <button
            type="button"
            aria-pressed={isIn}
            disabled={!modeAllowed('gate_in')}
            title={modeAllowed('gate_in') ? undefined : 'No open gate allows this here'}
            onClick={() => setScanType('gate_in')}
            className={cn(
              'flex h-12 items-center justify-center gap-2 rounded-lg text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              isIn ? 'bg-emerald-600 text-white shadow-xs' : 'text-ink-600 hover:bg-white/60 hover:text-ink-900',
            )}
          >
            <LogIn className="h-5 w-5" aria-hidden />
            Gate in
          </button>
          <button
            type="button"
            aria-pressed={!isIn}
            disabled={!modeAllowed('gate_out')}
            title={modeAllowed('gate_out') ? undefined : 'No open gate allows this here'}
            onClick={() => setScanType('gate_out')}
            className={cn(
              'flex h-12 items-center justify-center gap-2 rounded-lg text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              !isIn ? 'bg-marigold-500 text-ink-900 shadow-xs' : 'text-ink-600 hover:bg-white/60 hover:text-ink-900',
            )}
          >
            <LogOut className="h-5 w-5" aria-hidden />
            Gate out
          </button>
        </div>
        <div className="flex items-start gap-2">
          {lockedGate ? (
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-medium text-ink-800">Gate</p>
              <div className="flex h-[38px] items-center gap-2 rounded-[10px] border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900">
                <Lock className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <span className="truncate font-medium">{lockedGate.name}</span>
                {lockedGate.is_vip && <Badge tone="brand">VIP</Badge>}
                <span className="ml-auto hidden shrink-0 text-xs text-ink-500 sm:inline">{gateKindLabel[lockedGate.kind]}</span>
              </div>
              <p className="text-xs text-ink-500">Assigned by your organizer</p>
            </div>
          ) : (
            <Select
              label="Gate"
              value={gateId ?? ''}
              onChange={(e) => setChosenId(e.target.value)}
              containerClassName="min-w-0 flex-1"
              hint={gate ? `${gateKindLabel[gate.kind]}${gate.is_vip ? ', VIP' : ''}` : undefined}
            >
              {compatible.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.is_vip ? ' (VIP)' : ''}
                </option>
              ))}
            </Select>
          )}
          <IconButton
            label={soundEnabled ? 'Mute scan sounds' : 'Turn on scan sounds'}
            aria-pressed={soundEnabled}
            onClick={() => setSoundEnabled((v) => !v)}
            className="mt-[26px] h-[38px] w-[38px] shrink-0 border border-ink-200 bg-white"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
          </IconButton>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-2">
        {/* Camera */}
        <div className="space-y-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-ink-200 bg-ink-100 md:aspect-square">
            <div id={containerId} className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-ink-900">
                <Camera className="h-10 w-10 text-brand-600" aria-hidden />
                <p className="font-semibold">Camera is off</p>
                <p className="max-w-[240px] text-sm text-ink-600">Start the camera, then hold a pass about a hand's length away.</p>
              </div>
            )}
            {isScanning && (
              <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-ink-900 shadow-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
                Camera on, {isIn ? 'gate in' : 'gate out'}
              </span>
            )}
          </div>
          {isScanning ? (
            <Button variant="secondary" size="lg" className="w-full" icon={<CameraOff className="h-5 w-5" aria-hidden />} onClick={stopCamera}>
              Stop camera
            </Button>
          ) : (
            <Button size="lg" className="w-full" icon={<Camera className="h-5 w-5" aria-hidden />} onClick={startCamera}>
              Start camera
            </Button>
          )}
          {cameraError && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              {cameraError}
            </p>
          )}
        </div>

        {/* Result + manual entry */}
        <div className="space-y-4">
          <div ref={resultRef} aria-live="assertive" aria-atomic="true" className="scroll-mb-4">
            {last ? <ScanResultPanel key={last.seq} scan={last} /> : (
              <div className="flex min-h-[176px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-200 p-6 text-center">
                <ScanLine className="h-8 w-8 text-ink-400" aria-hidden />
                <p className="mt-2 font-semibold text-ink-900">Ready to scan</p>
                <p className="mt-1 text-sm text-ink-500">The result shows here in large text after each scan.</p>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void processToken(manualToken)
            }}
            className="space-y-2"
          >
            <Input
              label="Ticket number or code"
              hint="For passes the camera can't read, e.g. TKT-EAST-0012"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="h-12 font-mono text-base"
            />
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              className="w-full"
              loading={isProcessing}
              disabled={!manualToken.trim()}
              icon={isIn ? <LogIn className="h-5 w-5" aria-hidden /> : <LogOut className="h-5 w-5" aria-hidden />}
            >
              {isIn ? 'Check in' : 'Check out'}
            </Button>
          </form>
        </div>
      </div>
    </Card>
  )
}

const toneStyles: Record<Tone, { box: string; icon: React.ReactNode; sub: string }> = {
  success: { box: 'bg-emerald-600 text-white', icon: <CheckCircle2 className="h-10 w-10" aria-hidden />, sub: 'text-emerald-50' },
  danger: { box: 'bg-red-600 text-white', icon: <XOctagon className="h-10 w-10" aria-hidden />, sub: 'text-red-50' },
  warning: { box: 'bg-marigold-400 text-ink-900', icon: <AlertTriangle className="h-10 w-10" aria-hidden />, sub: 'text-ink-800' },
}

const ScanResultPanel: React.FC<{ scan: LastScan }> = ({ scan }) => {
  const s = toneStyles[scan.tone]
  return (
    <div className={cn('animate-result-flash rounded-2xl p-5', s.box)}>
      <div className="flex items-start gap-3">
        <div className="shrink-0">{s.icon}</div>
        <div className="min-w-0">
          <p className="font-display text-3xl font-bold leading-tight">{scan.title}</p>
          <p className={cn('mt-1 text-sm', s.sub)}>{scan.detail}</p>
        </div>
      </div>
      {scan.ticket && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: scan.tone === 'warning' ? 'rgb(28 23 36 / 0.2)' : 'rgb(255 255 255 / 0.25)' }}>
          {(scan.ticket.ticket_type_name || scan.ticket.seat_number) && <TicketTypeStrip ticket={scan.ticket} />}
          <p className="break-words text-2xl font-bold leading-tight">{scan.ticket.attendee_name}</p>
          {Boolean(scan.ticket.guest_number) && (
            <p className={cn('mt-0.5 break-all text-sm font-semibold', s.sub)}>
              Guest pass{scan.ticket.attendee_email ? `, booked by ${scan.ticket.attendee_email}` : ''}
            </p>
          )}
          <p className="mt-1 font-mono text-lg font-medium">{scan.ticket.ticket_number}</p>
          {scan.ticket.price !== undefined && Number(scan.ticket.price) > 0 && (
            <p className={cn('mt-1 text-sm font-semibold', s.sub)}>
              Collect Rs {Number(scan.ticket.price).toLocaleString('en-IN')}
              {scan.ticket.promo_code ? ` (code ${scan.ticket.promo_code})` : ''}
            </p>
          )}
        </div>
      )}
      <p className={cn('mt-3 text-xs', s.sub)}>
        {scan.gate}, {scan.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
    </div>
  )
}

/** Ticket type, seat and the organizer's note for gate staff, e.g. "STUDENT · SEAT A-12 · Check student ID". */
export const TicketTypeStrip: React.FC<{ ticket: Ticket; className?: string }> = ({ ticket, className }) => (
  <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>
    {ticket.ticket_type_name && (
      <span className="rounded-md bg-ink-950 px-2.5 py-1 text-sm font-bold uppercase tracking-wider text-white ring-1 ring-white/30">{ticket.ticket_type_name}</span>
    )}
    {ticket.seat_number && (
      <span className="rounded-md bg-ink-950 px-2.5 py-1 text-sm font-bold uppercase tracking-wider text-white ring-1 ring-white/30">Seat {ticket.seat_number}</span>
    )}
    {ticket.gate_note && <span className="rounded-md bg-white px-2.5 py-1 text-base font-bold text-ink-900 shadow-xs">{ticket.gate_note}</span>}
  </div>
)
