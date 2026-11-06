import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Building2, Plus, Trash2 } from 'lucide-react'
import { marketplaceApi, type VenueListing, type VenueSpace, type VenueSpaceInput, type VenueWithSpaces } from '@/services/api'
import { useAuth } from '@/lib/auth'
import { Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, IconButton, ImageGalleryUpload, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { BackLink, CITIES, DETAIL_ASIDE, DETAIL_GRID, DETAIL_MAIN, SPACE_TYPES, mobileBarClass, VENUE_TYPES, useErrorToast } from './shared'
import { VenueCard } from './Cards'
import { ListingStatusNotice } from '../business/status'

const COMMON_AMENITIES = ['Parking', 'Power backup', 'AC hall', 'Sound system', 'Stage', 'In-house catering', 'Green rooms', 'Wi-Fi', 'Wheelchair access', 'Guest rooms']

const splitList = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean)

/* ------------------------------------------------------------ Types */

interface VenueForm {
  name: string
  venueType: VenueListing['venue_type']
  description: string
  rules: string
  city: string
  address: string
  minCap: number
  maxCap: number
  price: number
  amenities: string[]
  otherAmenities: string
  photos: string[]
  contactPerson: string
  contactPhone: string
  contactEmail: string
}

interface SpaceDraft {
  key: string
  id?: string // set for spaces already saved on the server
  name: string
  space_type: VenueSpace['space_type']
  capacity_seated: string
  capacity_standing: string
  price_per_day: string
  area_sqft: string
  amenities: string
  images: string[]
  description: string
  is_active: boolean
}

let draftCounter = 0
const newDraft = (): SpaceDraft => ({
  key: `new-${++draftCounter}`,
  name: '',
  space_type: 'hall',
  capacity_seated: '',
  capacity_standing: '',
  price_per_day: '',
  area_sqft: '',
  amenities: '',
  images: [],
  description: '',
  is_active: true,
})

const draftFromSpace = (s: VenueSpace): SpaceDraft => ({
  key: s.id,
  id: s.id,
  name: s.name,
  space_type: s.space_type,
  capacity_seated: s.capacity_seated ? String(s.capacity_seated) : '',
  capacity_standing: s.capacity_standing ? String(s.capacity_standing) : '',
  price_per_day: String(Number(s.price_per_day)),
  area_sqft: s.area_sqft ? String(s.area_sqft) : '',
  amenities: s.amenities.join(', '),
  images: s.images,
  description: s.description,
  is_active: s.is_active,
})

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

const spaceInput = (d: SpaceDraft, order: number): VenueSpaceInput => ({
  name: d.name.trim(),
  space_type: d.space_type,
  capacity_seated: Number(d.capacity_seated) || 0,
  capacity_standing: numOrNull(d.capacity_standing),
  price_per_day: Number(d.price_per_day) || 0,
  area_sqft: numOrNull(d.area_sqft),
  amenities: splitList(d.amenities, /,/),
  images: d.images,
  description: d.description.trim(),
  is_active: d.is_active,
  order,
})

const formFromVenue = (v: VenueWithSpaces): VenueForm => {
  const known = v.amenities.filter((a) => COMMON_AMENITIES.includes(a))
  return {
    name: v.name,
    venueType: v.venue_type,
    description: v.description,
    rules: v.rules_policy || '',
    city: v.city,
    address: v.address,
    minCap: v.capacity_min,
    maxCap: v.capacity_max,
    price: Number(v.price_per_day),
    amenities: known,
    otherAmenities: v.amenities.filter((a) => !COMMON_AMENITIES.includes(a)).join(', '),
    photos: v.images,
    contactPerson: v.contact_person,
    contactPhone: v.contact_phone,
    contactEmail: v.contact_email || '',
  }
}

/* ---------------------------------------------------------- Pieces */

const Section: React.FC<{ title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, description, actions, children }) => (
  <Card>
    <CardHeader title={title} description={description} actions={actions} />
    <div className="space-y-4 p-5">{children}</div>
  </Card>
)

const SpaceEditor: React.FC<{
  draft: SpaceDraft
  index: number
  total: number
  onChange: (patch: Partial<SpaceDraft>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}> = ({ draft, index, total, onChange, onMove, onRemove }) => {
  const label = draft.name.trim() || `Space ${index + 1}`
  return (
    <li className="rounded-xl border border-ink-200 bg-ink-50/50">
      <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-2">
        <p className="min-w-0 truncate text-sm font-semibold text-ink-900">
          <span className="mr-2 font-normal text-ink-500 tabular">{index + 1}.</span>
          {label}
        </p>
        <div className="flex shrink-0 items-center">
          <IconButton label={`Move ${label} up`} onClick={() => onMove(-1)} disabled={index === 0} className="h-8 w-8 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Move ${label} down`} onClick={() => onMove(1)} disabled={index === total - 1} className="h-8 w-8 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Remove ${label}`} onClick={onRemove} className="h-8 w-8 hover:bg-red-50 hover:text-red-700">
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Input label="Name" required value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Sagarmatha Hall" />
          <Select label="Type" value={draft.space_type} onChange={(e) => onChange({ space_type: e.target.value as VenueSpace['space_type'] })}>
            {SPACE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Input label="Seated" type="number" min={0} inputMode="numeric" value={draft.capacity_seated} onChange={(e) => onChange({ capacity_seated: e.target.value })} placeholder="600" />
          <Input label="Standing" type="number" min={0} inputMode="numeric" value={draft.capacity_standing} onChange={(e) => onChange({ capacity_standing: e.target.value })} placeholder="Optional" />
          <Input label="Price per day (Rs)" type="number" min={0} step={500} required value={draft.price_per_day} onChange={(e) => onChange({ price_per_day: e.target.value })} placeholder="75000" />
          <Input label="Area (sq ft)" type="number" min={0} value={draft.area_sqft} onChange={(e) => onChange({ area_sqft: e.target.value })} placeholder="Optional" />
        </div>
        <Input label="Amenities" hint="Separate with commas" value={draft.amenities} onChange={(e) => onChange({ amenities: e.target.value })} placeholder="Central AC, Stage, Projector" />
        <Textarea label="Description" rows={2} value={draft.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Best for receptions and conventions." />
        <ImageGalleryUpload label="Photos" hint="Optional. Up to 4 photos of this space." kind="space" max={4} value={draft.images} onChange={(images) => onChange({ images })} />
        <label className="flex items-center gap-2.5 text-sm text-ink-800">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => onChange({ is_active: e.target.checked })} className="h-4 w-4 rounded accent-brand-600" />
          Available for booking
          {!draft.is_active && <span className="text-ink-500">(hidden from organizers)</span>}
        </label>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------- Page */

const VenueFormPage: React.FC<{ existing?: VenueWithSpaces; existingSpaces?: VenueSpace[] }> = ({ existing, existingSpaces = [] }) => {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const formId = 'venue-form'
  const lastInvalidToast = useRef(0)
  const editing = Boolean(existing)

  const [form, setForm] = useState<VenueForm>(() =>
    existing
      ? formFromVenue(existing)
      : {
          name: '',
          venueType: 'banquet',
          description: '',
          rules: '',
          city: 'Itahari',
          address: '',
          minCap: 100,
          maxCap: 600,
          price: 45000,
          amenities: ['Parking', 'Power backup'],
          otherAmenities: '',
          photos: [],
          contactPerson: '',
          contactPhone: user?.phone || '',
          contactEmail: user?.email || '',
        },
  )
  const [spaces, setSpaces] = useState<SpaceDraft[]>(() => existingSpaces.map(draftFromSpace))
  const [submitting, setSubmitting] = useState(false)
  const capError = form.maxCap < form.minCap ? 'Must be at least the minimum' : undefined

  const set = <K extends keyof VenueForm>(key: K, value: VenueForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const toggleAmenity = (a: string) => set('amenities', form.amenities.includes(a) ? form.amenities.filter((x) => x !== a) : [...form.amenities, a])

  const updateSpace = (key: string, patch: Partial<SpaceDraft>) => setSpaces((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  const moveSpace = (index: number, dir: -1 | 1) =>
    setSpaces((all) => {
      const next = [...all]
      const [item] = next.splice(index, 1)
      next.splice(index + dir, 0, item)
      return next
    })
  const removeSpace = async (draft: SpaceDraft) => {
    if (draft.id) {
      const ok = await toast.confirm({
        title: `Remove ${draft.name || 'this space'}?`,
        description: 'It will be deleted when you save. Past inquiries keep their details.',
        confirmLabel: 'Remove',
        danger: true,
      })
      if (!ok) return
    }
    setSpaces((all) => all.filter((s) => s.key !== draft.key))
    toast.info(`${draft.name || 'Space'} removed`, draft.id ? 'Save changes to delete it for good.' : undefined)
  }

  const amenities = useMemo(() => [...form.amenities, ...splitList(form.otherAmenities, /,/)], [form.amenities, form.otherAmenities])
  const images = form.photos
  const activeSpaces = spaces.filter((s) => s.is_active)

  const preview: VenueWithSpaces = useMemo(() => {
    const drafts = activeSpaces.map((d, i) => ({ ...spaceInput(d, i), id: d.key }))
    const sizes = drafts.map((d) => Math.max(d.capacity_seated, d.capacity_standing ?? 0))
    const mins = drafts.map((d) => d.capacity_seated || d.capacity_standing || 0)
    return {
      id: 'preview',
      name: form.name || 'Your venue name',
      slug: 'preview',
      venue_type: form.venueType,
      venue_type_display: VENUE_TYPES.find((t) => t.value === form.venueType)?.label,
      city: form.city,
      address: form.address,
      capacity_min: drafts.length ? Math.min(...mins) : form.minCap || 0,
      capacity_max: drafts.length ? Math.max(...sizes) : form.maxCap || 0,
      price_per_day: form.price || 0,
      price_from: drafts.length ? String(Math.min(...drafts.map((d) => Number(d.price_per_day)))) : undefined,
      spaces: drafts,
      amenities,
      images,
      contact_person: form.contactPerson,
      contact_phone: form.contactPhone,
      contact_email: form.contactEmail,
      description: form.description || 'Your description appears here.',
      rules_policy: form.rules,
      is_verified: existing?.is_verified ?? false,
      is_featured: existing?.is_featured ?? false,
      rating: existing?.rating ?? 0,
      review_count: existing?.review_count ?? 0,
    }
  }, [form, amenities, images, activeSpaces, existing])

  /** Create, update, delete and reorder spaces to match the drafts. Returns names that failed. */
  const syncSpaces = async (venueId: string) => {
    const failed: string[] = []
    const keptIds = new Set(spaces.filter((s) => s.id).map((s) => s.id))
    for (const old of existingSpaces) {
      if (!keptIds.has(old.id)) {
        try {
          await marketplaceApi.deleteSpace(venueId, old.id)
        } catch {
          failed.push(`remove ${old.name}`)
        }
      }
    }
    for (const [order, draft] of spaces.entries()) {
      try {
        if (draft.id) await marketplaceApi.updateSpace(venueId, draft.id, spaceInput(draft, order))
        else await marketplaceApi.createSpace(venueId, spaceInput(draft, order))
      } catch (err) {
        failed.push(`${draft.name || `space ${order + 1}`} (${err instanceof Error ? err.message : 'error'})`)
      }
    }
    return failed
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (capError) {
      toast.error('Check the capacity', 'Maximum guests must be at least the minimum.')
      return
    }
    const noCapacity = spaces.find((s) => !Number(s.capacity_seated) && !Number(s.capacity_standing))
    if (noCapacity) {
      toast.error(`Add a capacity for ${noCapacity.name || 'each space'}`, 'Enter a seated or standing number.')
      return
    }
    setSubmitting(true)
    const body: Partial<VenueListing> = {
      name: form.name.trim(),
      venue_type: form.venueType,
      description: form.description.trim(),
      rules_policy: form.rules.trim(),
      city: form.city,
      address: form.address.trim(),
      // With active spaces the API derives the capacity range; keep the stored fallback untouched.
      ...(activeSpaces.length ? {} : { capacity_min: form.minCap, capacity_max: form.maxCap }),
      price_per_day: form.price,
      amenities,
      images,
      contact_person: form.contactPerson.trim(),
      contact_phone: form.contactPhone.trim(),
      contact_email: form.contactEmail.trim(),
    }
    try {
      const saved = existing ? await marketplaceApi.updateVenue(existing.id, body) : await marketplaceApi.createVenue(body)
      const failed = await syncSpaces(saved.id)
      await queryClient.invalidateQueries({ queryKey: ['venues'] })
      await queryClient.invalidateQueries({ queryKey: ['venue'] })
      await queryClient.invalidateQueries({ queryKey: ['venueSpaces'] })
      if (failed.length) {
        toast.error(`Venue saved, but ${failed.length} space change${failed.length > 1 ? 's' : ''} failed`, failed.join('; '))
      } else {
        const status = (saved as VenueWithSpaces & { listing_status?: string }).listing_status
        if (!editing) toast.success('Venue sent for review', `We’ll check ${saved.name} and put it live in the marketplace once it’s approved.`)
        else if (status === 'pending') toast.success('Changes saved', `${saved.name} is waiting for review.`)
        else toast.success('Changes saved', `${saved.name} is up to date.`)
      }
      navigate('/app/listings')
    } catch (err) {
      toast.error(editing ? 'Couldn’t save your changes' : 'Couldn’t list your venue', err instanceof Error ? err.message : 'Check the details and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const onInvalid = () => {
    // Fires once per invalid field; show one toast per submit attempt.
    if (Date.now() - lastInvalidToast.current < 1000) return
    lastInvalidToast.current = Date.now()
    toast.error('Some details are missing', 'Fill in the highlighted fields, then save again.')
  }

  const cancelTo = '/app/listings'
  const submitLabel = editing ? 'Save changes' : 'Submit for review'
  const actions = (
    <>
      <ButtonLink to={cancelTo} variant="secondary" className="flex-1">
        Cancel
      </ButtonLink>
      <Button type="submit" form={formId} loading={submitting} className="flex-1">
        {submitLabel}
      </Button>
    </>
  )

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 pb-28 lg:py-8 lg:pb-8 2xl:px-10">
      <BackLink to="/app/listings" label="Your listings" />
      <PageHeader
        title={editing ? `Edit ${existing!.name}` : 'List your venue'}
        description={
          editing
            ? 'Update the details organizers see and manage the halls they can book.'
            : 'Organizers in Dharan, Itahari, Biratnagar and nearby can find it and send you booking inquiries. New venues go live after a quick review.'
        }
      />
      {existing && <ListingStatusNotice status={existing.listing_status} note={existing.review_note} />}

      <div className={DETAIL_GRID}>
        <form id={formId} onSubmit={submit} onInvalidCapture={onInvalid} className={DETAIL_MAIN}>
          <Section title="Basics">
            <Input label="Venue name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Royal Palace Banquet and Lawns" />
            <Select label="Type" value={form.venueType} onChange={(e) => set('venueType', e.target.value as VenueListing['venue_type'])}>
              {VENUE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Textarea label="Description" required rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Parking, generator backup, catering options." />
            <Textarea label="House rules" hint="Optional. Music cut-off, outside catering, advance payment and similar." rows={3} value={form.rules} onChange={(e) => set('rules', e.target.value)} />
          </Section>

          <Section title="Location">
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <Select label="City" value={form.city} onChange={(e) => set('city', e.target.value)}>
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <Input label="Address" required value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Main Highway Chowk, Itahari-4" />
            </div>
          </Section>

          <Section
            title="Halls and spaces"
            description="Add each hall, auditorium or lawn that can be booked on its own. Leave empty if the venue is booked as a whole."
          >
            {spaces.length === 0 ? (
              <EmptyState
                className="rounded-xl border border-dashed border-ink-200 py-8"
                icon={<Building2 className="h-6 w-6" />}
                title="No separate spaces"
                description="Organizers will book the whole venue."
              />
            ) : (
              <ol className="space-y-4">
                {spaces.map((d, i) => (
                  <SpaceEditor
                    key={d.key}
                    draft={d}
                    index={i}
                    total={spaces.length}
                    onChange={(patch) => updateSpace(d.key, patch)}
                    onMove={(dir) => moveSpace(i, dir)}
                    onRemove={() => removeSpace(d)}
                  />
                ))}
              </ol>
            )}
            <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setSpaces((all) => [...all, newDraft()])}>
              Add a space
            </Button>
          </Section>

          <Section
            title="Capacity and pricing"
            description={spaces.length ? 'Capacity and “from” price are worked out from your spaces. These are used when no spaces are available.' : undefined}
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Input label="Minimum guests" type="number" min={1} required value={form.minCap} onChange={(e) => set('minCap', Number(e.target.value))} />
              <Input label="Maximum guests" type="number" min={1} required value={form.maxCap} error={capError} onChange={(e) => set('maxCap', Number(e.target.value))} />
              <Input
                label="Price per day (Rs)"
                type="number"
                min={0}
                step={500}
                required
                value={form.price}
                onChange={(e) => set('price', Number(e.target.value))}
                containerClassName="col-span-2 sm:col-span-1"
              />
            </div>
          </Section>

          <Section title="Amenities" description="Select everything guests can use.">
            <div role="group" aria-label="Common amenities" className="flex flex-wrap gap-2">
              {COMMON_AMENITIES.map((a) => {
                const on = form.amenities.includes(a)
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAmenity(a)}
                    className={cn(
                      'h-8 rounded-full border px-3.5 text-sm font-medium transition-colors',
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {a}
                  </button>
                )
              })}
            </div>
            <Input label="Other amenities" hint="Separate with commas" value={form.otherAmenities} onChange={(e) => set('otherAmenities', e.target.value)} placeholder="Swimming pool deck, Bridal suite" />
          </Section>

          <Section title="Photos" description="Upload photos of the venue. The first one is the cover photo.">
            <ImageGalleryUpload label="Venue photos" kind="venue" max={8} value={form.photos} onChange={(urls) => set('photos', urls)} />
          </Section>

          <Section title="Contact" description="Shown on your venue page so organizers can reach you.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Contact person" required value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} placeholder="Santosh Shrestha" />
              <Input label="Phone" type="tel" required value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="98XXXXXXXX" />
              <Input
                label="Email"
                type="email"
                hint="Inquiries are sent here"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
                placeholder="bookings@venue.com"
                containerClassName="sm:col-span-2"
              />
            </div>
          </Section>
        </form>

        <aside aria-label="Preview" className={cn(DETAIL_ASIDE, 'hidden space-y-3 lg:block')}>
          <p className="text-sm font-medium text-ink-500">Preview</p>
          <div inert className="pointer-events-none">
            <VenueCard venue={preview} to="#" />
          </div>
          <div className="flex gap-2">{actions}</div>
        </aside>
      </div>

      <div className={mobileBarClass(true)}>
        <div className="flex gap-2">{actions}</div>
      </div>
    </div>
  )
}

/** /app/listings/venues/new */
export const ListVenuePage: React.FC = () => <VenueFormPage />

/** /app/listings/venues/:slug/edit */
export const EditVenuePage: React.FC = () => {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()

  const venueQuery = useQuery({ queryKey: ['venue', slug], queryFn: () => marketplaceApi.getVenueBySlug(slug) })
  const venue = venueQuery.data
  const spacesQuery = useQuery({
    queryKey: ['venueSpaces', venue?.id],
    queryFn: () => marketplaceApi.getSpaces(venue!.id),
    enabled: Boolean(venue?.id),
  })
  useErrorToast(venueQuery.isError, venueQuery.error, 'Couldn’t load this venue')
  useErrorToast(spacesQuery.isError, spacesQuery.error, 'Couldn’t load the spaces')

  const notOwner = Boolean(venue && user && venue.owner !== user.id && user.role !== 'superadmin')
  useEffect(() => {
    if (notOwner) toast.error('You can’t edit this venue', 'Only the owner can change its details and spaces.')
  }, [notOwner, toast])

  const shell = (children: React.ReactNode) => <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">{children}</div>

  if (venueQuery.isError || spacesQuery.isError) {
    return shell(
      <>
        <BackLink to="/app/listings" label="Your listings" />
        <ErrorState
          message={(venueQuery.error || spacesQuery.error)?.message}
          onRetry={() => {
            venueQuery.refetch()
            spacesQuery.refetch()
          }}
        />
      </>,
    )
  }
  if (venueQuery.isLoading || (venue && spacesQuery.isLoading)) {
    return shell(
      <>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 rounded-2xl" />
      </>,
    )
  }
  if (!venue || notOwner) {
    return shell(
      <>
        <BackLink to="/app/listings" label="Your listings" />
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={venue ? 'Only the owner can edit this venue' : 'We couldn’t find that venue'}
            description={venue ? 'Ask the person who listed it to make changes.' : 'It may have been removed, or the link is wrong.'}
            action={<ButtonLink to="/app/listings">Go to your listings</ButtonLink>}
          />
        </Card>
      </>,
    )
  }
  return <VenueFormPage key={venue.id} existing={venue} existingSpaces={spacesQuery.data ?? []} />
}

export default ListVenuePage
