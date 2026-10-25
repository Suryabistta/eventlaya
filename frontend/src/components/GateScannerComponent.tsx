import React, { useState, useEffect, useRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import {
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  LogIn,
  Search,
  Sparkles,
  RefreshCw,
  Volume2,
  VolumeX
} from 'lucide-react'
import { api, type ScanResult } from '@/services/api'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
  onScanComplete?: () => void
}

export const GateScannerComponent: React.FC<Props> = ({ eventId, onScanComplete }) => {
  const [scanType, setScanType] = useState<'gate_in' | 'gate_out'>('gate_in')
  const [gateName, setGateName] = useState('Main Gate 1')
  const [isScanning, setIsScanning] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [lastResult, setLastResult] = useState<ScanResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerId = 'html5-qrcode-viewfinder'

  // Beep sound generator using Web Audio API
  const playFeedbackSound = (type: 'success' | 'warning' | 'error') => {
    if (!soundEnabled) return
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      if (type === 'success') {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime) // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1) // A5
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25)
        osc.start()
        osc.stop(ctx.currentTime + 0.25)
      } else if (type === 'warning') {
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
      // Audio context might be restricted before interaction
    }
  }

  const handleProcessToken = async (token: string) => {
    if (isProcessing || !token.trim()) return
    setIsProcessing(true)

    try {
      const res = await api.scanTicket(eventId, {
        qr_token: token.trim(),
        scan_type: scanType,
        gate_name: gateName,
      })

      setLastResult(res)

      if (res.result === 'success') {
        playFeedbackSound('success')
      } else if (res.result === 'duplicate') {
        playFeedbackSound('warning')
      } else {
        playFeedbackSound('error')
      }

      onScanComplete?.()
    } catch (err: unknown) {
      playFeedbackSound('error')
      setLastResult({
        result: 'invalid',
        message: err instanceof Error ? err.message : 'Invalid ticket or scan error.',
      })
    } finally {
      setIsProcessing(false)
      setManualToken('')
    }
  }

  // Camera start / stop
  const startCamera = async () => {
    try {
      const html5QrCode = new Html5Qrcode(containerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      scannerRef.current = html5QrCode

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          handleProcessToken(decodedText)
        },
        () => {
          // ignore scan frame errors
        }
      )
      setIsScanning(true)
    } catch (err) {
      console.warn('Unable to access camera:', err)
      setIsScanning(false)
    }
  }

  const stopCamera = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      } catch (e) {
        console.error(e)
      }
    }
    setIsScanning(false)
  }

  useEffect(() => {
    return () => {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Top Controls */}
      <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4">
        {/* Gate Mode Toggle */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-xl">
          <button
            type="button"
            onClick={() => setScanType('gate_in')}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-xs',
              scanType === 'gate_in'
                ? 'bg-emerald-600 text-white shadow-emerald-600/25'
                : 'text-slate-600 hover:text-slate-900 bg-transparent'
            )}
          >
            <LogIn className="w-3.5 h-3.5" />
            Gate In (Entry)
          </button>
          <button
            type="button"
            onClick={() => setScanType('gate_out')}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-xs',
              scanType === 'gate_out'
                ? 'bg-amber-600 text-white shadow-amber-600/25'
                : 'text-slate-600 hover:text-slate-900 bg-transparent'
            )}
          >
            <LogOut className="w-3.5 h-3.5" />
            Gate Out (Exit)
          </button>
        </div>

        {/* Gate Name Selector & Sound Toggle */}
        <div className="flex items-center gap-2">
          <select
            value={gateName}
            onChange={(e) => setGateName(e.target.value)}
            className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="Main Gate 1">Main Gate 1</option>
            <option value="North Entrance">North Entrance</option>
            <option value="VIP Gate">VIP Gate</option>
            <option value="Auditorium Gate B">Auditorium Gate B</option>
          </select>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={cn(
              'p-2 rounded-lg border text-xs font-medium transition',
              soundEnabled
                ? 'bg-brand-50 text-brand-600 border-brand-200'
                : 'bg-slate-100 text-slate-400 border-slate-200'
            )}
            title={soundEnabled ? 'Audio Chime Enabled' : 'Muted'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Scanner Section */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Camera Viewfinder */}
        <div className="flex flex-col items-center">
          <div className="relative w-full max-w-sm aspect-square bg-slate-950 rounded-2xl overflow-hidden shadow-inner flex flex-col items-center justify-center border-2 border-slate-800">
            <div id={containerId} className="w-full h-full" />

            {!isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-900 text-white">
                <Camera className="w-12 h-12 text-slate-500 mb-3" />
                <p className="font-semibold text-sm">Scanner Camera Offline</p>
                <p className="text-xs text-slate-400 mt-1 max-w-[200px]">
                  Click below to activate your camera or use manual token search.
                </p>
              </div>
            )}

            {isScanning && (
              <div className="absolute top-3 left-3 bg-red-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                LIVE CAMERA
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2 w-full max-w-sm">
            {!isScanning ? (
              <button
                type="button"
                onClick={startCamera}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-md shadow-brand-600/20 transition"
              >
                <Camera className="w-4 h-4" />
                Start Scanner Camera
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition"
              >
                <CameraOff className="w-4 h-4" />
                Stop Camera
              </button>
            )}
          </div>
        </div>

        {/* Scan Status & Result Feedback */}
        <div className="space-y-4">
          {/* Manual Input Fallback */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Manual Token / Ticket Code Lookup
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleProcessToken(manualToken)
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                placeholder="Paste token or TKT-ETF26-0001..."
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 bg-white"
              />
              <button
                type="submit"
                disabled={isProcessing || !manualToken.trim()}
                className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                Scan
              </button>
            </form>
          </div>

          {/* Real-time Result Card */}
          {lastResult ? (
            <div
              className={cn(
                'p-5 rounded-2xl border transition-all animate-in fade-in zoom-in-95 duration-150',
                lastResult.result === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-900',
                lastResult.result === 'duplicate' && 'bg-amber-50 border-amber-300 text-amber-900 shadow-md',
                lastResult.result === 'not_in' && 'bg-blue-50 border-blue-200 text-blue-900',
                (lastResult.result === 'wrong_event' || lastResult.result === 'early_date') && 'bg-purple-50 border-purple-300 text-purple-900 shadow-md',
                (lastResult.result === 'cancelled' || lastResult.result === 'expired') && 'bg-red-50 border-red-300 text-red-900 shadow-md',
                lastResult.result === 'invalid' && 'bg-rose-50 border-rose-200 text-rose-900'
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {lastResult.result === 'success' && <CheckCircle2 className="w-6 h-6 text-emerald-600" />}
                  {lastResult.result === 'duplicate' && <AlertTriangle className="w-6 h-6 text-amber-600 animate-bounce" />}
                  {lastResult.result === 'not_in' && <LogOut className="w-6 h-6 text-blue-600" />}
                  {(lastResult.result === 'wrong_event' || lastResult.result === 'early_date') && <AlertTriangle className="w-6 h-6 text-purple-600" />}
                  {(lastResult.result === 'cancelled' || lastResult.result === 'expired') && <AlertTriangle className="w-6 h-6 text-red-600" />}
                  {lastResult.result === 'invalid' && <AlertTriangle className="w-6 h-6 text-rose-600" />}
                </div>

                <div className="flex-1">
                  <span className="text-[10px] font-black tracking-wider uppercase px-2 py-0.5 rounded-full inline-block mb-1.5 bg-white/70">
                    {lastResult.result.replace('_', ' ').toUpperCase()}
                  </span>
                  <h4 className="font-bold text-sm leading-tight">{lastResult.message}</h4>

                  {lastResult.ticket && (
                    <div className="mt-3 pt-3 border-t border-slate-200/60 text-xs space-y-1">
                      <p>
                        <span className="opacity-70">Attendee:</span> <strong>{lastResult.ticket.attendee_name}</strong>
                      </p>
                      <p>
                        <span className="opacity-70">Ticket:</span> <span className="font-mono">{lastResult.ticket.ticket_number}</span>
                      </p>
                      <p>
                        <span className="opacity-70">Email:</span> {lastResult.ticket.attendee_email}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl border border-dashed border-slate-200 text-center text-slate-400">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-xs font-semibold">Ready for Gate Scans</p>
              <p className="text-[11px] mt-0.5">Scanned attendee details and gate verification alerts will display here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
