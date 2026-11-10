import React, { useId, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, Minus, Store, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Badge, Button, ButtonLink, Card, PageHeader, useToast } from '@/components/ui'
import { SmsCreditsSection } from '@/pages/billing/SmsCredits'
import { MyPlanSection, RequestUpgradeDialog, planCodes, useMyBilling } from '@/pages/billing/MyPlan'
import type { Cycle, PlanCode } from '@/pages/admin/billing/api'
import { cn } from '@/lib/utils'
import { usePlans, planCodeByName } from '@/lib/plans'

type Billing = 'monthly' | 'annual'
type Audience = 'organizers' | 'providers'

interface OrganizerPlan {
  name: string
  audience: string
  priceMonthly: number | null // null = custom quote
  priceAnnual: number | null
  description: string
  features: string[]
  limitations: string[]
  cta: string
  recommended?: boolean
}

const organizerPlans: OrganizerPlan[] = [
  {
    name: 'Free',
    audience: 'Community and student clubs',
    priceMonthly: 0,
    priceAnnual: 0,
    description: 'For local meetups, college clubs and free community gatherings.',
    features: [
      'Online registration form',
      'QR code passes for every attendee',
      'Web scanner on any phone camera',
      'Attendee list and CSV export',
      'One admin account',
      'Up to 150 attendees per event',
    ],
    limitations: ['Custom form fields', 'Custom domain', 'Live voting'],
    cta: 'Start free',
  },
  {
    name: 'Event Pro',
    audience: 'Conferences and festivals',
    priceMonthly: 1499,
    priceAnnual: 14390,
    description: 'For conferences, festivals, sports tournaments and professional summits.',
    features: [
      'Everything in Free',
      'Unlimited attendees',
      'Registration form builder with 10 field types',
      'Gate in and gate out analytics',
      'Gate staff assignments and scanner accounts',
      'Duplicate pass alerts at the gate',
      'Your logo and colours on passes',
    ],
    limitations: ['Custom domain (eventlaya.com subdomain only)'],
    cta: 'Choose Event Pro',
    recommended: true,
  },
  {
    name: 'Business',
    audience: 'Agencies and institutions',
    priceMonthly: 3999,
    priceAnnual: 38390,
    description: 'For event management companies and academic institutions.',
    features: [
      'Everything in Event Pro',
      'Several events running at once',
      'Live audience voting and polls',
      'Budget and expense tracking',
      'Crew task board',
      'Push announcements to gate staff',
      'Priority phone and WhatsApp support in Eastern Nepal',
    ],
    limitations: [],
    cta: 'Choose Business',
  },
  {
    name: 'Enterprise',
    audience: 'White-label platforms',
    priceMonthly: null,
    priceAnnual: null,
    description: 'Run Eventlaya under your own name and domain.',
    features: [
      'Everything in Business',
      'Custom domain (events.yourdomain.com)',
      'Remove “Powered by Eventlaya”',
      'Module permissions for your admins',
      'Automatic CNAME setup and free SSL',
      'Android scanner app',
      'SLA and on-site gate support in Koshi Province',
    ],
    limitations: [],
    cta: 'Contact us',
  },
]

interface ProviderPlan {
  name: string
  price: number
  description: string
  features: string[]
  cta: string
  recommended?: boolean
}

const providerPlans: ProviderPlan[] = [
  {
    name: 'Basic listing',
    price: 0,
    description: 'Get found in the Eastern Nepal vendor directory.',
    features: [
      'Business name, phone and address',
      'Listed under Itahari, Dharan or Biratnagar',
      'Standard search visibility',
      'Direct phone inquiries from customers',
    ],
    cta: 'List for free',
  },
  {
    name: 'Verified provider',
    price: 500,
    description: 'Build trust with organizers and get structured quote requests.',
    features: [
      'Verified badge on your profile',
      'Photo portfolio, up to 12 images',
      'Quote requests from organizers',
      'Organizer ratings and reviews',
      'WhatsApp inquiry link',
    ],
    cta: 'Get verified',
    recommended: true,
  },
  {
    name: 'Premium partner',
    price: 1500,
    description: 'Top placement and lead analytics for busy vendors.',
    features: [
      'Featured placement on the marketplace',
      'Highlighted spot in your category',
      'Lead views and click analytics',
      'Unlimited portfolio images and video links',
      'Zero commission on direct bookings',
    ],
    cta: 'Become a premium partner',
  },
]

const faqs = [
  {
    q: 'How do I pay?',
    a: 'Checkout with eSewa and Khalti is coming soon. Fonepay QR and bank transfer with a VAT invoice will also be available.',
  },
  {
    q: 'Do colleges and student clubs get a discount?',
    a: 'Yes. Non-profit clubs and IT student associations in Dharan, Itahari and Biratnagar can apply for a subsidised Event Pro plan.',
  },
  {
    q: 'Do you help at the gate on the day?',
    a: 'For Enterprise and large events, our crew can set up scanners on site and support your gate supervisors.',
  },
  {
    q: 'Can I switch or cancel my plan?',
    a: 'Yes. Upgrade, downgrade or pause at the end of any billing cycle with no cancellation fee.',
  },
]


const rs = (n: number) => `Rs ${n.toLocaleString('en-IN')}`

/* ------------------------------------------------------------------ */

/** Radio-group based segmented control: arrow keys and screen readers work natively. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
}) {
  const name = useId()
  return (
    <fieldset className="inline-flex rounded-xl bg-ink-100 p-1">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 sm:px-4',
            value === o.value ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

const FeatureList: React.FC<{ features: string[]; limitations?: string[] }> = ({ features, limitations = [] }) => (
  <ul className="space-y-2.5 text-sm">
    {features.map((f) => (
      <li key={f} className="flex items-start gap-2.5 text-ink-700">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <span>{f}</span>
      </li>
    ))}
    {limitations.map((f) => (
      <li key={f} className="flex items-start gap-2.5 text-ink-400">
        <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <span className="sr-only">Not included: </span>
          {f}
        </span>
      </li>
    ))}
  </ul>
)

const PlanCard: React.FC<{
  name: string
  audience?: string
  description: string
  price: React.ReactNode
  priceNote?: React.ReactNode
  recommended?: boolean
  current?: boolean
  cta: React.ReactNode
  children: React.ReactNode
}> = ({ name, audience, description, price, priceNote, recommended, current, cta, children }) => (
  <Card className={cn('flex flex-col p-6', recommended && 'border-2 border-brand-600')}>
    <div className="flex min-h-6 flex-wrap items-center gap-2">
      <h3 className="text-lg font-bold text-ink-900">{name}</h3>
      {recommended && <Badge tone="brand">Recommended</Badge>}
      {current && <Badge tone="success" dot>Current plan</Badge>}
    </div>
    {audience && <p className="mt-0.5 text-sm text-ink-500">{audience}</p>}
    <div className="mt-5">
      <p className="font-display text-3xl font-bold text-ink-900 tabular">{price}</p>
      <p className="mt-1 min-h-5 text-xs text-ink-500">{priceNote}</p>
    </div>
    <p className="mt-4 text-sm text-ink-600">{description}</p>
    <div className="mt-5">{cta}</div>
    <div className="mt-6 border-t border-ink-100 pt-5">{children}</div>
  </Card>
)

/* ------------------------------------------------------------------ */

export default function PricingPage() {
  const inApp = useLocation().pathname.startsWith('/app')
  const { status } = useAuth()
  const signedIn = status === 'authenticated'
  const toast = useToast()

  const [billing, setBilling] = useState<Billing>('monthly')
  const [audience, setAudience] = useState<Audience>('organizers')
  // Prices, features and limits come from the platform's plan settings; copy stays here
  const { data: apiPlans } = usePlans()
  const livePlans = organizerPlans.map((plan) => {
    const live = apiPlans?.find((p) => p.code === planCodeByName[plan.name])
    if (!live) return plan
    return {
      ...plan,
      priceMonthly: plan.priceMonthly === null && !live.monthly_price ? null : live.monthly_price,
      priceAnnual: plan.priceAnnual === null && !live.yearly_price ? null : live.yearly_price,
      features: live.features?.length ? live.features : plan.features,
    }
  })
  const isOrgAccount = inApp && signedIn
  const mine = useMyBilling(isOrgAccount)
  const activePlan = mine.data?.plan.name ?? 'Free'
  const pendingPlan = mine.data?.requests.find((r) => r.status === 'pending')?.requested_plan_name
  const [upgrade, setUpgrade] = useState<{ plan: PlanCode; cycle: Cycle } | null>(null)

  const organizerCta = (plan: OrganizerPlan) => {
    const variant = plan.recommended ? 'primary' : 'secondary'
    if (!inApp) {
      return (
        <ButtonLink to={signedIn ? '/app/billing' : '/signup'} variant={variant} className="w-full">
          {plan.cta}
        </ButtonLink>
      )
    }
    if (plan.name === activePlan) {
      return (
        <Button variant="secondary" className="w-full" disabled>
          Current plan
        </Button>
      )
    }
    if (plan.name === pendingPlan) {
      return (
        <Button variant="secondary" className="w-full" disabled>
          Request sent
        </Button>
      )
    }
    return (
      <Button
        variant={plan.priceMonthly === 0 ? 'secondary' : variant}
        className="w-full"
        disabled={!mine.data || !!pendingPlan}
        onClick={() => setUpgrade({ plan: planCodes[plan.name], cycle: billing === 'annual' ? 'yearly' : 'monthly' })}
      >
        {plan.priceMonthly === 0 ? 'Move to Free' : plan.priceMonthly === null ? 'Ask for a quote' : 'Request upgrade'}
      </Button>
    )
  }

  const providerCta = (plan: ProviderPlan) => {
    const variant = plan.recommended ? 'primary' : 'secondary'
    if (!inApp) {
      return (
        <ButtonLink to={signedIn ? '/app/listings' : '/signup?type=vendor'} variant={variant} className="w-full">
          {plan.cta}
        </ButtonLink>
      )
    }
    if (plan.price === 0) {
      return (
        <ButtonLink to="/app/listings" variant={variant} className="w-full">
          {plan.cta}
        </ButtonLink>
      )
    }
    return (
      <Button
        variant={variant}
        className="w-full"
        onClick={() => toast.info('Our team sets up listing upgrades', 'Reply to your welcome email or ask in your next inquiry, and we’ll arrange payment.')}
      >
        {plan.cta}
      </Button>
    )
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented
        label="Pricing for"
        value={audience}
        onChange={setAudience}
        options={[
          { value: 'organizers', label: <><Users className="h-4 w-4" aria-hidden />Organizers</> },
          { value: 'providers', label: <><Store className="h-4 w-4" aria-hidden />Vendors and venues</> },
        ]}
      />
      {audience === 'organizers' && (
        <Segmented
          label="Billing period"
          value={billing}
          onChange={setBilling}
          options={[
            { value: 'monthly', label: 'Monthly' },
            {
              value: 'annual',
              label: (
                <>
                  Yearly <span className="text-xs font-semibold text-emerald-700">Save 20%</span>
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  )

  return (
    <div className={inApp ? 'w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10' : 'mx-auto max-w-6xl space-y-10 px-4 py-12 sm:px-6'}>
      {inApp ? (
        <>
          <PageHeader title="Plan and billing" description={`You’re on the ${activePlan} plan. Compare plans and ask for an upgrade when you need more.`} />
          <MyPlanSection data={mine.data} isLoading={mine.isLoading} error={mine.error} onRetry={() => void mine.refetch()} />
          <SmsCreditsSection />
          <h2 className="pt-2 text-lg font-bold text-ink-900">Compare plans</h2>
        </>
      ) : (
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">Pricing</h1>
          <p className="mt-3 text-lg text-ink-600">
            Free for club-sized events. Upgrade when you need bigger crowds, custom form fields, voting or your own domain.
          </p>
        </div>
      )}

      {controls}

      {audience === 'organizers' ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {livePlans.map((plan) => {
            const monthly = plan.priceMonthly
            const annual = plan.priceAnnual
            let price: React.ReactNode = 'Custom'
            let note: React.ReactNode = 'Priced for your organization'
            if (monthly === 0) {
              price = 'Free'
              note = 'No card needed'
            } else if (monthly !== null && annual !== null) {
              const perMonth = billing === 'monthly' ? monthly : Math.round(annual / 12)
              price = (
                <>
                  {rs(perMonth)}
                  <span className="ml-1 font-sans text-sm font-medium text-ink-500">/ month</span>
                </>
              )
              note = billing === 'annual' ? `${rs(annual)} billed yearly` : 'Billed monthly'
            }
            return (
              <PlanCard
                key={plan.name}
                name={plan.name}
                audience={plan.audience}
                description={plan.description}
                price={price}
                priceNote={note}
                recommended={plan.recommended}
                current={inApp && plan.name === activePlan}
                cta={organizerCta(plan)}
              >
                <FeatureList features={plan.features} limitations={plan.limitations} />
              </PlanCard>
            )
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="max-w-2xl text-ink-600">Listing plans for photographers, sound and stage, decorators, caterers and venue owners.</p>
          <div className="grid gap-5 md:grid-cols-3">
            {providerPlans.map((plan) => (
              <PlanCard
                key={plan.name}
                name={plan.name}
                description={plan.description}
                price={
                  plan.price === 0 ? (
                    'Free'
                  ) : (
                    <>
                      {rs(plan.price)}
                      <span className="ml-1 font-sans text-sm font-medium text-ink-500">/ month</span>
                    </>
                  )
                }
                priceNote={plan.price === 0 ? 'Always free' : 'Billed monthly'}
                recommended={plan.recommended}
                cta={providerCta(plan)}
              >
                <FeatureList features={plan.features} />
              </PlanCard>
            ))}
          </div>
        </div>
      )}

      <section aria-labelledby="pricing-faq" className={inApp ? 'pt-4' : 'pt-8'}>
        <h2 id="pricing-faq" className={cn('font-bold text-ink-900', inApp ? 'text-lg' : 'font-display text-2xl sm:text-3xl')}>
          Questions about plans
        </h2>
        <dl className="mt-4 grid gap-x-10 sm:grid-cols-2">
          {(inApp
            ? faqs.map((f) =>
                f.q === 'How do I pay?'
                  ? { ...f, a: 'Pay by eSewa, Khalti, Fonepay QR or bank transfer. Our team records the payment and your plan updates straight away.' }
                  : f,
              )
            : faqs
          ).map((f) => (
            <div key={f.q} className="border-t border-ink-200 py-5">
              <dt className="font-semibold text-ink-900">{f.q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {inApp && <RequestUpgradeDialog target={upgrade} data={mine.data} onClose={() => setUpgrade(null)} />}
    </div>
  )
}
