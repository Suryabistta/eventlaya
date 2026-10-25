import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import {
  Calendar,
  MapPin,
  Users,
  CheckCircle,
  Sparkles,
  Ticket as TicketIcon,
  ShieldCheck,
  Printer,
  AlertCircle,
  Clock,
  ArrowRight
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { api, type Ticket } from '@/services/api'
import { cn } from '@/lib/utils'

export const PublicEventPage: React.FC = () => {
  const { slug = 'eastern-tech-fest-2026' } = useParams<{ slug: string }>()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [issuedTicket, setIssuedTicket] = useState<Ticket | null>(null)
  const [isExistingRegistration, setIsExistingRegistration] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['publicEvent', slug],
    queryFn: () => api.getPublicEvent(slug),
  })

  const registerMutation = useMutation({
    mutationFn: (body: { name: string; email: string; phone?: string; answers?: Record<string, unknown> }) =>
      api.registerForEvent(slug, body),
    onSuccess: (res: any) => {
      setIssuedTicket(res.ticket)
      setIsExistingRegistration(Boolean(res.already_registered))
      setErrorMessage(null)
      // Confetti celebration!
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      })
    },
    onError: (err: Error) => {
      setErrorMessage(err.message)
    },
  })

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    registerMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      answers,
    })
  }

  const handlePrint = () => {
    window.print()
  }

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-500">Loading Event Registration...</p>
        </div>
      </div>
    )
  }

  if (isError || !data?.event) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Event Not Found</h2>
        <p className="text-xs text-slate-500">The event link you followed may be expired or unpublished.</p>
        <Link to="/" className="inline-block px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
          Go to Eventlaya Home
        </Link>
      </div>
    )
  }

  const { event, form } = data

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Event Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-tr from-slate-950 via-slate-900 to-indigo-950 text-white p-6 sm:p-10 shadow-2xl border border-slate-800">
        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 text-xs font-semibold backdrop-blur-xs border border-brand-500/30">
              <Sparkles className="w-3.5 h-3.5" />
              Verified Eventlaya Pass
            </span>
            <span className="text-xs text-slate-400">• Eastern Nepal</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            {event.title}
          </h1>

          <p className="text-slate-300 text-sm leading-relaxed max-w-2xl">
            {event.description}
          </p>

          <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-300">
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-xl backdrop-blur-xs">
              <Calendar className="w-4 h-4 text-brand-400" />
              <span>{event.start_date} {event.start_time && `at ${event.start_time}`}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-xl backdrop-blur-xs">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>{event.location}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-xl backdrop-blur-xs">
              <Users className="w-4 h-4 text-indigo-400" />
              <span>{event.registered_count} Registered</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Container: Registration Form OR Issued Ticket */}
      {!issuedTicket ? (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">
              {form ? form.title : 'Attendee Registration'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {form?.description || 'Fill in the information below to receive your instant digital entry QR ticket.'}
            </p>
          </div>

          {errorMessage && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4 text-xs">
            {/* Standard Profile Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Bhattarai"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="ramesh@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Mobile Phone Number</label>
              <input
                type="text"
                placeholder="+977-98XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {/* Custom Dynamic Form Fields */}
            {form?.fields?.map((f) => {
              const fieldId = f.id || f.label
              return (
                <div key={fieldId} className="space-y-1 pt-1">
                  <label className="block font-bold text-slate-700">
                    {f.label} {f.required && <span className="text-rose-500">*</span>}
                  </label>

                  {f.field_type === 'select' ? (
                    <select
                      required={f.required}
                      value={(answers[fieldId] as string) || ''}
                      onChange={(e) => setAnswers({ ...answers, [fieldId]: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    >
                      <option value="">Select an option...</option>
                      {f.options?.map((opt, i) => (
                        <option key={i} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.field_type === 'radio' ? (
                    <div className="flex flex-wrap gap-4 pt-1">
                      {f.options?.map((opt, i) => (
                        <label key={i} className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                          <input
                            type="radio"
                            name={`field-${fieldId}`}
                            value={opt}
                            required={f.required}
                            checked={answers[fieldId] === opt}
                            onChange={(e) => setAnswers({ ...answers, [fieldId]: e.target.value })}
                            className="rounded-full text-brand-600 focus:ring-brand-500/20"
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      type={f.field_type === 'number' ? 'number' : 'text'}
                      required={f.required}
                      placeholder={f.placeholder || `Enter ${f.label.toLowerCase()}...`}
                      value={(answers[fieldId] as string) || ''}
                      onChange={(e) => setAnswers({ ...answers, [fieldId]: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  )}
                </div>
              )
            })}

            <div className="pt-4">
              <button
                type="submit"
                disabled={registerMutation.isPending}
                className="w-full py-3.5 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white font-extrabold text-sm shadow-lg shadow-brand-600/30 transition flex items-center justify-center gap-2"
              >
                <TicketIcon className="w-4 h-4" />
                {registerMutation.isPending ? 'Issuing Ticket...' : 'Complete Registration & Get Ticket'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Instant Issued Ticket View */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden max-w-lg mx-auto animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white text-center space-y-2">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-1">
              <CheckCircle className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-xl font-extrabold">
              {isExistingRegistration ? 'Welcome Back!' : 'You are Registered!'}
            </h2>
            <p className="text-emerald-100 text-xs">
              {isExistingRegistration
                ? `You were already registered for this event. Here is your official entry pass.`
                : `Here is your official digital entry pass for ${event.title}.`}
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* QR Ticket Pass Box */}
            <div className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
              <div className="p-3 bg-white rounded-2xl shadow-xs border border-slate-100">
                <QRCodeSVG value={issuedTicket.qr_token} size={180} level="H" />
              </div>
              <p className="font-mono text-sm font-bold text-slate-800 tracking-wider mt-3">
                {issuedTicket.ticket_number}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Show this QR code at the gate entrance</p>
            </div>

            {/* Attendee Info */}
            <div className="space-y-2 text-xs divide-y divide-slate-100">
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400 font-medium">Attendee Name</span>
                <span className="font-bold text-slate-800">{issuedTicket.attendee_name}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400 font-medium">Registered Email</span>
                <span className="font-medium text-slate-700">{issuedTicket.attendee_email}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400 font-medium">Venue</span>
                <span className="font-medium text-slate-700">{event.location}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400 font-medium">Date & Time</span>
                <span className="font-medium text-slate-700">{event.start_date}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handlePrint}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition"
              >
                <Printer className="w-4 h-4" />
                Print / Save Pass
              </button>
              <button
                onClick={() => setIssuedTicket(null)}
                className="px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs transition"
              >
                Register Another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
