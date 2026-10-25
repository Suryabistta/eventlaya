import React, { useState } from 'react'
import {
  Check,
  Sparkles,
  Shield,
  Zap,
  Building,
  Store,
  HelpCircle,
  ArrowRight,
  CreditCard,
  QrCode,
  Users
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [pricingMode, setPricingMode] = useState<'organizers' | 'providers'>('organizers')
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [showCheckoutModal, setShowCheckoutModal] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'esewa' | 'khalti' | 'fonepay' | 'bank'>('esewa')
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [activePlan, setActivePlan] = useState('Free')

  // Section 4: Organizer SaaS Plans from Proposal Document
  const organizerPlans = [
    {
      name: 'Free',
      badge: 'Community & Student Clubs',
      priceMonthly: 0,
      priceAnnual: 0,
      description: 'Perfect for local meetups, college clubs, and free community gatherings.',
      features: [
        'Standard Online Registration Form',
        'Automated QR Code Digital Ticket Passes',
        'Mobile Camera Web Scanner Terminal',
        'Basic Attendee List & CSV Export',
        'Single Admin Account',
        'Up to 150 Attendees per Event',
      ],
      limitations: [
        'No Custom Dynamic Form Fields',
        'No White-label Custom Domain',
        'No Live Cryptographic Voting Module',
      ],
      cta: 'Current Plan',
      popular: false,
    },
    {
      name: 'Event Pro',
      badge: 'Most Popular',
      priceMonthly: 1499,
      priceAnnual: 14390,
      description: 'Ideal for conferences, festivals, sports tournaments, and professional summits.',
      features: [
        'Everything in Free Plan',
        'Unlimited Attendees & Capacity',
        'Dynamic Registration Form Builder (10 field types)',
        'Gate In & Gate Out Attendance Velocity Analytics',
        'Crew Gate Staff Assignments & Terminal Accounts',
        'Real-time Duplicate Fraud Detection Alerts',
        'Custom Brand Logo & Ticket Header Colors',
      ],
      limitations: [
        'No Custom Domain (Subdomain only)',
      ],
      cta: 'Upgrade to Event Pro',
      popular: true,
    },
    {
      name: 'Business',
      badge: 'Agencies & Institutions',
      priceMonthly: 3999,
      priceAnnual: 38390,
      description: 'Full-suite operations for event management companies and academic institutions.',
      features: [
        'Everything in Event Pro',
        'Multiple Concurrent Events',
        'Live Audience Voting & Polls System',
        'Budget & Financial Expense Ledger Tracker',
        'Crew Work Distribution Kanban Board',
        'Push Notification Announcements to Gate Staff',
        'Priority Phone & WhatsApp Support in Eastern Nepal',
      ],
      limitations: [],
      cta: 'Get Business Plan',
      popular: false,
    },
    {
      name: 'Enterprise',
      badge: 'Multi-Tenant SaaS',
      priceMonthly: 'Custom',
      priceAnnual: 'Custom',
      description: 'Complete white-label solution with custom domain for enterprise vendors.',
      features: [
        'Everything in Business Plan',
        'White-Label Custom Domain (events.yourdomain.com)',
        'Removal of "Powered by Eventlaya" Watermark',
        'Superadmin RBAC Module Control Killswitches',
        'Automated CNAME & Free SSL Certificate Provisioning',
        'Native Android Scanner Terminal App APK Support',
        'Dedicated SLA & On-Site Gate Support in Province 1',
      ],
      limitations: [],
      cta: 'Contact Enterprise',
      popular: false,
    },
  ]

  // Section 5: Marketplace Service Provider Listing Plans
  const providerPlans = [
    {
      name: 'Basic Listing',
      price: 'Free',
      description: 'List your service in the Eastern Nepal vendor directory.',
      features: [
        'Business Profile Name, Phone & Address',
        'Categorized in Itahari, Dharan, or Biratnagar',
        'Standard Search Visibility',
        'Receive Direct Customer Phone Inquiries',
      ],
      cta: 'List for Free',
      popular: false,
    },
    {
      name: 'Verified Provider',
      price: 'Rs. 500 / month',
      description: 'Build trust with organizers and receive structured quotation leads.',
      features: [
        'Verified Trust Badge on Profile',
        'Photo Portfolio Gallery (Up to 12 images)',
        'Receive Request for Quotation (RFQ) Direct Inquiries',
        'Organizer Ratings & Customer Reviews Display',
        'Direct WhatsApp Inquiry Link',
      ],
      cta: 'Get Verified',
      popular: true,
    },
    {
      name: 'Premium Partner',
      price: 'Rs. 1,500 / month',
      description: 'Featured top placement and lead analytics for high-volume vendors.',
      features: [
        'Featured Top Placement on Marketplace Homepage',
        'Highlighted Category Hero Spot',
        'Lead Views & Click-Through Analytics',
        'Unlimited Portfolio Images & Video Links',
        'Zero Commission on Direct Client Bookings',
      ],
      cta: 'Become Premium Partner',
      popular: false,
    },
  ]

  const handleSelectPlan = (planName: string) => {
    setSelectedPlan(planName)
    setShowCheckoutModal(true)
  }

  const handleSimulatePayment = () => {
    setIsUpgrading(true)
    setTimeout(() => {
      setIsUpgrading(false)
      setActivePlan(selectedPlan || 'Event Pro')
      setShowCheckoutModal(false)
      alert(`Dhanyabaad! Your account has been upgraded to the ${selectedPlan} tier.`)
    }, 1200)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-12">
      {/* Hero Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          Transparent SaaS Pricing for Eastern Nepal
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Flexible Plans Tailored for Your Event Scale
        </h1>
        <p className="text-slate-500 text-sm sm:text-base leading-relaxed">
          From free community tech meetups in Dharan to multi-thousand attendee conferences across Province 1. No hidden surcharges.
        </p>

        {/* Audience Toggle (Organizers vs Vendors) */}
        <div className="inline-flex p-1 bg-slate-100 rounded-2xl border border-slate-200 mt-4">
          <button
            onClick={() => setPricingMode('organizers')}
            className={cn(
              'px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2',
              pricingMode === 'organizers'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Users className="w-4 h-4" />
            <span>Event Organizers & Clubs</span>
          </button>
          <button
            onClick={() => setPricingMode('providers')}
            className={cn(
              'px-5 py-2 rounded-xl text-xs sm:text-sm font-bold transition flex items-center gap-2',
              pricingMode === 'providers'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Store className="w-4 h-4" />
            <span>Vendors & Venues Marketplace</span>
          </button>
        </div>
      </div>

      {/* ORGANIZER SAAS TIERS */}
      {pricingMode === 'organizers' && (
        <div className="space-y-8">
          {/* Monthly / Annual Switcher */}
          <div className="flex items-center justify-center gap-3 text-xs font-semibold">
            <span className={cn(billingPeriod === 'monthly' ? 'text-slate-900' : 'text-slate-500')}>
              Monthly Billing
            </span>
            <button
              onClick={() => setBillingPeriod(billingPeriod === 'monthly' ? 'annual' : 'monthly')}
              className="w-12 h-6 bg-slate-200 rounded-full p-0.5 transition-colors duration-200 ease-in-out relative"
            >
              <div
                className={cn(
                  'w-5 h-5 rounded-full bg-indigo-600 transition-transform duration-200 ease-in-out',
                  billingPeriod === 'annual' ? 'transform translate-x-6' : ''
                )}
              />
            </button>
            <span className={cn(billingPeriod === 'annual' ? 'text-slate-900' : 'text-slate-500', 'flex items-center gap-1.5')}>
              Annual Billing
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                Save 20%
              </span>
            </span>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {organizerPlans.map((plan) => {
              const isCurrent = activePlan === plan.name
              return (
                <div
                  key={plan.name}
                  className={cn(
                    'bg-white rounded-3xl p-6 border flex flex-col justify-between transition-all duration-200 relative',
                    plan.popular
                      ? 'border-indigo-600 ring-2 ring-indigo-600/20 shadow-xl'
                      : 'border-slate-200 shadow-sm hover:shadow-md'
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm">
                      {plan.badge}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{plan.description}</p>
                    </div>

                    <div className="py-2">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900">
                          {typeof plan.priceMonthly === 'number'
                            ? `Rs. ${billingPeriod === 'monthly' ? plan.priceMonthly.toLocaleString() : (typeof plan.priceAnnual === 'number' ? (plan.priceAnnual / 12).toFixed(0) : plan.priceAnnual)}`
                            : plan.priceMonthly}
                        </span>
                        {typeof plan.priceMonthly === 'number' && (
                          <span className="text-xs text-slate-400 font-medium">/ month</span>
                        )}
                      </div>
                      {billingPeriod === 'annual' && typeof plan.priceAnnual === 'number' && plan.priceAnnual > 0 && (
                        <span className="text-[11px] text-slate-400">Billed Rs. {plan.priceAnnual.toLocaleString()} annually</span>
                      )}
                    </div>

                    <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                      <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wider block">
                        Included Features:
                      </span>
                      {plan.features.map((f, i) => (
                        <div key={i} className="flex items-start gap-2 text-slate-600">
                          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-6 mt-6 border-t border-slate-100">
                    <button
                      onClick={() => handleSelectPlan(plan.name)}
                      disabled={isCurrent}
                      className={cn(
                        'w-full py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm',
                        isCurrent
                          ? 'bg-slate-100 text-slate-400 cursor-default'
                          : plan.popular
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                      )}
                    >
                      <span>{isCurrent ? 'Current Active Tier' : plan.cta}</span>
                      {!isCurrent && <ArrowRight className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* VENDOR & VENUE MARKETPLACE TIERS */}
      {pricingMode === 'providers' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {providerPlans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                'bg-white rounded-3xl p-6 border flex flex-col justify-between transition relative',
                plan.popular
                  ? 'border-emerald-600 ring-2 ring-emerald-600/20 shadow-xl'
                  : 'border-slate-200 shadow-sm'
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm">
                  Recommended for Vendors
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{plan.description}</p>
                </div>

                <div className="py-2">
                  <span className="text-3xl font-black text-slate-900">{plan.price}</span>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-slate-600">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-100">
                <button
                  onClick={() => handleSelectPlan(plan.name)}
                  className={cn(
                    'w-full py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm',
                    plan.popular
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  )}
                >
                  <span>{plan.cta}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Frequently Asked Questions */}
      <div className="bg-slate-50 rounded-3xl p-8 border border-slate-200 max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-slate-900">Frequently Asked Questions</h2>
          <p className="text-xs text-slate-500">Everything you need to know about Eventlaya billing in Nepal</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-1">
            <h4 className="font-bold text-slate-900">Which payment gateways are supported in Nepal?</h4>
            <p className="text-slate-600 leading-relaxed">
              We support direct digital payments via eSewa, Khalti, Fonepay QR, and direct corporate bank transfers with official VAT invoices.
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-1">
            <h4 className="font-bold text-slate-900">Can colleges and student clubs get discounts?</h4>
            <p className="text-slate-600 leading-relaxed">
              Yes! Non-profit community clubs and IT student associations in Dharan, Itahari, and Biratnagar can apply for subsidized Event Pro licenses.
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-1">
            <h4 className="font-bold text-slate-900">Do you provide on-site gate check-in support?</h4>
            <p className="text-slate-600 leading-relaxed">
              For Enterprise and large symposiums, our technical field crew provides on-ground QR barcode terminal setup and gate supervisor support.
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-1">
            <h4 className="font-bold text-slate-900">Can I switch or cancel plans at any time?</h4>
            <p className="text-slate-600 leading-relaxed">
              Yes, you can upgrade, downgrade, or pause your subscription at any billing cycle without cancellation penalties.
            </p>
          </div>
        </div>
      </div>

      {/* Checkout / Upgrade Modal */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Subscribe to {selectedPlan}</h3>
                <p className="text-slate-500 text-[11px]">Instant activation for your organizer account</p>
              </div>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 mt-4">
              {/* Payment Methods */}
              <div>
                <label className="block font-semibold text-slate-700 mb-2">Select Payment Method (Nepal):</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'esewa', label: 'eSewa Mobile Wallet', color: 'text-emerald-700 bg-emerald-50 border-emerald-300' },
                    { id: 'khalti', label: 'Khalti Digital Wallet', color: 'text-purple-700 bg-purple-50 border-purple-300' },
                    { id: 'fonepay', label: 'Fonepay Interbank QR', color: 'text-red-700 bg-red-50 border-red-300' },
                    { id: 'bank', label: 'Direct Bank Transfer', color: 'text-blue-700 bg-blue-50 border-blue-300' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMethod(m.id as any)}
                      className={cn(
                        'p-3 rounded-xl border text-left font-bold transition flex items-center gap-2',
                        paymentMethod === m.id ? m.color : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      <CreditCard className="w-4 h-4 shrink-0" />
                      <span className="text-[11px] leading-tight">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Selected Plan:</span>
                  <span className="font-bold text-slate-800">{selectedPlan}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Billing Cycle:</span>
                  <span className="font-semibold text-slate-700 capitalize">{billingPeriod}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200 text-slate-900 font-bold">
                  <span>Total Due:</span>
                  <span className="text-indigo-600">
                    {selectedPlan === 'Event Pro' ? 'Rs. 1,499' : selectedPlan === 'Business' ? 'Rs. 3,999' : 'Quote'}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCheckoutModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSimulatePayment}
                  disabled={isUpgrading}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isUpgrading ? 'Processing...' : 'Confirm Subscription'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
