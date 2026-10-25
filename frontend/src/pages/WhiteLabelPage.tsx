import React, { useEffect, useState } from 'react'
import {
  Globe,
  Palette,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Sparkles,
  Save,
  QrCode,
  Layers,
  ArrowRight
} from 'lucide-react'
import { api, TenantBranding } from '../services/api'

export default function WhiteLabelPage() {
  const [branding, setBranding] = useState<TenantBranding>({
    subdomain: 'eastern-summit',
    custom_domain: 'events.easternsummit.org.np',
    cname_target: 'cname.eventlaya.com',
    is_domain_verified: false,
    ssl_active: false,
    brand_name: 'Eastern Youth Summit',
    brand_logo: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=300',
    primary_color: '#4F46E5',
    accent_color: '#06B6D4',
    support_email: 'support@easternsummit.org.np',
    footer_text: 'Organized by Eastern Youth Summit • Dharan, Nepal',
    remove_watermark: true,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadBranding()
  }, [])

  const loadBranding = async () => {
    try {
      const data = await api.getTenantBranding()
      if (data) {
        setBranding(data)
      }
    } catch (err) {
      console.error('Failed to load branding:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateTenantBranding(branding)
      setBranding(updated)
      setMessage({ type: 'success', text: 'White-label SaaS branding saved successfully!' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save branding settings' })
    } finally {
      setSaving(false)
    }
  }

  const handleVerifyDomain = async () => {
    setVerifying(true)
    setMessage(null)
    try {
      const res = await api.verifyTenantDomain()
      setBranding(prev => ({
        ...prev,
        is_domain_verified: res.is_domain_verified,
        ssl_active: res.ssl_active,
      }))
      setMessage({ type: 'success', text: res.message })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Domain DNS verification failed' })
    } finally {
      setVerifying(false)
    }
  }

  const copyCNAME = () => {
    navigator.clipboard.writeText(branding.cname_target || 'cname.eventlaya.com')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-100 text-cyan-800 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Enterprise Multi-Tenant SaaS
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            White-Label & Custom Domain Engine
          </h1>
          <p className="text-sm text-slate-500">
            Host events on your own domain with full branding isolation, custom color schemes, and zero watermark.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition shadow-sm disabled:opacity-50 text-sm"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving Changes...' : 'Save Settings'}</span>
        </button>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm flex items-center gap-3 border ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Main Grid: Settings & Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Form: Configuration */}
        <div className="lg:col-span-7 space-y-6">
          {/* Section 1: Domain Routing */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              <Globe className="w-5 h-5 text-indigo-600" />
              <span>Domain & Hostname Settings</span>
            </div>

            {/* Subdomain */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Platform Subdomain
              </label>
              <div className="flex rounded-xl shadow-sm">
                <input
                  type="text"
                  value={branding.subdomain}
                  onChange={(e) => setBranding({ ...branding, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-l-xl text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="your-org"
                />
                <span className="inline-flex items-center px-4 rounded-r-xl border border-l-0 border-slate-300 bg-slate-100 text-slate-500 text-sm font-mono">
                  .eventlaya.com
                </span>
              </div>
            </div>

            {/* Custom Domain */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Custom Enterprise Domain (FQDN)
                </label>
                {branding.is_domain_verified ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verified & SSL Active
                  </span>
                ) : (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    DNS Pending Verification
                  </span>
                )}
              </div>
              <input
                type="text"
                value={branding.custom_domain || ''}
                onChange={(e) => setBranding({ ...branding, custom_domain: e.target.value.toLowerCase() })}
                placeholder="events.yourorganization.com"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* DNS Instructions Box */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
              <span className="font-bold text-slate-700 flex items-center gap-1">
                DNS Configuration Instructions
              </span>
              <p className="text-slate-500">
                To route your custom domain to Eventlaya, add a CNAME DNS record in your DNS provider (Cloudflare, GoDaddy, Route53):
              </p>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono text-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-slate-400">CNAME → </span>
                  <span className="font-semibold text-indigo-600">{branding.cname_target || 'cname.eventlaya.com'}</span>
                </div>
                <button
                  type="button"
                  onClick={copyCNAME}
                  className="text-slate-500 hover:text-indigo-600 transition flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleVerifyDomain}
                  disabled={verifying || !branding.custom_domain}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold text-xs transition disabled:opacity-50"
                >
                  {verifying ? 'Verifying DNS...' : 'Verify DNS & SSL'}
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Visual Branding & Theming */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              <Palette className="w-5 h-5 text-indigo-600" />
              <span>Theme, Logo & White-Label Customization</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Brand / Organization Name
                </label>
                <input
                  type="text"
                  value={branding.brand_name}
                  onChange={(e) => setBranding({ ...branding, brand_name: e.target.value })}
                  placeholder="e.g. Eastern Youth Summit"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Support Email
                </label>
                <input
                  type="email"
                  value={branding.support_email}
                  onChange={(e) => setBranding({ ...branding, support_email: e.target.value })}
                  placeholder="support@yourdomain.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Brand Logo URL
              </label>
              <input
                type="url"
                value={branding.brand_logo}
                onChange={(e) => setBranding({ ...branding, brand_logo: e.target.value })}
                placeholder="https://yourdomain.com/logo.png"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
              />
            </div>

            {/* Color Pickers */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Theme Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-slate-300 cursor-pointer p-0.5 bg-white"
                  />
                  <input
                    type="text"
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Secondary / Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={branding.accent_color}
                    onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-slate-300 cursor-pointer p-0.5 bg-white"
                  />
                  <input
                    type="text"
                    value={branding.accent_color}
                    onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Custom Footer Notice
              </label>
              <input
                type="text"
                value={branding.footer_text}
                onChange={(e) => setBranding({ ...branding, footer_text: e.target.value })}
                placeholder="e.g. Powered by Eastern Youth Summit • Dharan, Nepal"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm"
              />
            </div>

            {/* Remove Watermark Toggle */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-slate-900 block">
                  Remove "Powered by Eventlaya" Watermark
                </span>
                <span className="text-xs text-slate-500">
                  Completely replace platform badges with your exclusive organizational branding.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={branding.remove_watermark}
                  onChange={(e) => setBranding({ ...branding, remove_watermark: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Live Mockup Canvas */}
        <div className="lg:col-span-5 space-y-6">
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                Live White-Label Preview
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {branding.custom_domain || `${branding.subdomain}.eventlaya.com`}
              </span>
            </div>

            {/* Simulated Browser Frame */}
            <div className="bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-800">
              {/* Browser Address Bar */}
              <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-2 border-b border-slate-700/60">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
                </div>
                <div className="flex-1 bg-slate-900/90 rounded-lg px-3 py-1 text-[11px] font-mono text-slate-300 flex items-center gap-2 border border-slate-700/50">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="truncate">
                    https://{branding.custom_domain || `${branding.subdomain}.eventlaya.com`}
                  </span>
                </div>
              </div>

              {/* Mockup Body with Dynamic Branding */}
              <div className="bg-slate-50 p-5 space-y-4 text-slate-800">
                {/* Header Navbar */}
                <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {branding.brand_logo ? (
                      <img
                        src={branding.brand_logo}
                        alt="Logo"
                        className="w-7 h-7 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: branding.primary_color }}
                      >
                        {branding.brand_name.charAt(0)}
                      </div>
                    )}
                    <span className="font-bold text-sm text-slate-900">{branding.brand_name}</span>
                  </div>

                  <span
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg text-white"
                    style={{ backgroundColor: branding.primary_color }}
                  >
                    Register Now
                  </span>
                </div>

                {/* Hero Banner Mockup */}
                <div
                  className="rounded-xl p-5 text-white shadow-sm relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${branding.primary_color} 0%, ${branding.accent_color} 100%)`,
                  }}
                >
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-white/20 backdrop-blur-sm inline-block mb-2">
                    Official Event Portal
                  </span>
                  <h4 className="text-base font-extrabold mb-1">
                    Annual Technology & Innovation Summit 2026
                  </h4>
                  <p className="text-xs opacity-90 mb-3">
                    Dharan Chamber of Commerce Auditorium • March 28
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-3 py-1 rounded-lg bg-white text-slate-900 shadow-sm">
                      Get Pass
                    </span>
                    <span className="text-xs text-white/90">500 Seats Available</span>
                  </div>
                </div>

                {/* Branded Ticket Pass Mockup */}
                <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-dashed border-slate-200">
                    <div>
                      <span className="text-[10px] uppercase text-slate-400 font-bold block">
                        Verified Attendee Pass
                      </span>
                      <span className="text-xs font-extrabold text-slate-900">Subash Dahal</span>
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: branding.primary_color }}
                    >
                      VIP Delegate
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div className="text-[11px] text-slate-600 space-y-0.5">
                      <div>Pass ID: <span className="font-mono font-bold text-slate-800">TKT-EAST-0042</span></div>
                      <div>Gate Access: <span className="font-medium">North & VIP Lounge</span></div>
                    </div>
                    <div className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                      <QrCode className="w-10 h-10 text-slate-900" />
                    </div>
                  </div>
                </div>

                {/* Footer Watermark Simulation */}
                <div className="pt-2 text-center text-[10px] text-slate-400">
                  {branding.footer_text && <p className="mb-0.5">{branding.footer_text}</p>}
                  {!branding.remove_watermark && (
                    <p className="text-slate-400">Powered by Eventlaya Platform</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
