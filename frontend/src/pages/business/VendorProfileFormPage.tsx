import React, { useRef, useState } from 'react'
import { useCities } from '@/lib/cities'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Store } from 'lucide-react'
import { PackagesManager } from '../marketplace/Packages'
import { api } from '@/services/api'
import { useAuth } from '@/lib/auth'
import {
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ImageGalleryUpload,
  ImageUpload,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '@/components/ui'
import { BackLink, mobileBarClass, useErrorToast } from '../marketplace/shared'
import { businessApi, isUuid, type OwnedVendorProfile, type VendorProfileInput } from './api'
import { PAGE } from './ListingsPage'
import { ListingStatusNotice } from './status'

const FORM_ID = 'vendor-profile-form'

const Section: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <Card>
    <CardHeader title={title} description={description} />
    <div className="space-y-4 p-5">{children}</div>
  </Card>
)

const VendorProfileForm: React.FC<{ existing?: OwnedVendorProfile }> = ({ existing }) => {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const lastInvalidToast = useRef(0)
  const editing = Boolean(existing)

  const categories = useQuery({ queryKey: ['categories'], queryFn: api.getCategories })
  useErrorToast(categories.isError, categories.error, 'Couldn’t load the service categories')

  const [form, setForm] = useState<VendorProfileInput>(() => ({
    business_name: existing?.business_name ?? user?.organization_name ?? '',
    category: existing?.category ?? '',
    city: existing?.city ?? 'Itahari',
    address: existing?.address ?? '',
    phone: existing?.phone ?? user?.phone ?? '',
    email: existing?.email ?? user?.email ?? '',
    description: existing?.description ?? '',
    starting_price: existing ? String(Number(existing.starting_price)) : '',
    portfolio_images: existing?.portfolio_images ?? [],
    logo: existing?.logo ?? '',
    featured_image: existing?.featured_image ?? '',
  }))
  const cities = useCities()
  const [submitting, setSubmitting] = useState(false)
  const set = <K extends keyof VendorProfileInput>(key: K, value: VendorProfileInput[K]) => setForm((f) => ({ ...f, [key]: value }))

  // Venues have their own listing form; keep the venue category out of service profiles.
  const serviceCategories = (categories.data ?? []).filter((c) => c.slug !== 'venues' || c.id === form.category)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const body: VendorProfileInput = {
      ...form,
      business_name: form.business_name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      description: form.description.trim(),
      starting_price: String(Number(form.starting_price) || 0),
    }
    try {
      const saved = existing ? await businessApi.updateVendorProfile(existing.id, body) : await businessApi.createVendorProfile(body)
      await queryClient.invalidateQueries({ queryKey: ['my-listings'] })
      await queryClient.invalidateQueries({ queryKey: ['vendor-profile', saved.id] })
      if (!editing) toast.success('Profile sent for review', `We’ll check ${saved.business_name} and put it live in the marketplace once it’s approved.`)
      else if (saved.listing_status === 'pending') toast.success('Changes saved', `${saved.business_name} is waiting for review.`)
      else toast.success('Changes saved', `${saved.business_name} is up to date.`)
      navigate('/app/listings')
    } catch (err) {
      toast.error(editing ? 'Couldn’t save your changes' : 'Couldn’t create your profile', err instanceof Error ? err.message : 'Check the details and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const onInvalid = () => {
    if (Date.now() - lastInvalidToast.current < 1000) return
    lastInvalidToast.current = Date.now()
    toast.error('Some details are missing', 'Fill in the highlighted fields, then save again.')
  }

  const actions = (
    <>
      <ButtonLink to="/app/listings" variant="secondary" className="flex-1 lg:flex-none">
        Cancel
      </ButtonLink>
      <Button type="submit" form={FORM_ID} loading={submitting} className="flex-1 lg:flex-none">
        {editing ? 'Save changes' : 'Submit for review'}
      </Button>
    </>
  )

  return (
    <div className={`${PAGE} pb-28 lg:pb-8`}>
      <BackLink to="/app/listings" label="Your listings" />
      <PageHeader
        title={editing ? `Edit ${existing!.business_name}` : 'Add a service profile'}
        description={
          editing
            ? 'Update what organizers see when they look for your service.'
            : 'For sound and stage, decoration, photo and video, catering and other event services. New profiles go live after a quick review.'
        }
      />
      {existing && <ListingStatusNotice status={existing.listing_status} note={existing.review_note} />}

      <form id={FORM_ID} onSubmit={submit} onInvalidCapture={onInvalid} className="max-w-3xl space-y-6">
        <Section title="Your service">
          <Input label="Business name" required value={form.business_name} onChange={(e) => set('business_name', e.target.value)} placeholder="Himalayan Waves Sound and Light" />
          <ImageUpload
            label="Logo"
            kind="logo"
            shape="square"
            className="max-w-[200px]"
            hint="Optional. Shown next to your name in the marketplace."
            value={form.logo || null}
            onChange={(url) => set('logo', url ?? '')}
          />
          {categories.isError ? (
            <ErrorState message="We couldn’t load the service categories." onRetry={categories.refetch} />
          ) : (
            <Select label="Category" required value={form.category} disabled={categories.isLoading} onChange={(e) => set('category', e.target.value)}>
              <option value="" disabled>
                {categories.isLoading ? 'Loading categories…' : 'Choose a category'}
              </option>
              {serviceCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Textarea
            label="Description"
            required
            rows={5}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What you offer, the gear or menu you bring, the events you usually work on."
          />
          <Input
            label="Starting price (Rs)"
            type="number"
            min={0}
            step={500}
            inputMode="numeric"
            hint="The lowest price you usually quote. Leave 0 to show “Ask for a quote”."
            value={form.starting_price}
            onChange={(e) => set('starting_price', e.target.value)}
            containerClassName="sm:max-w-xs"
          />
        </Section>

        <Section title="Portfolio" description="Photos of your recent work. The first one is the cover photo.">
          <ImageUpload
            label="Cover photo"
            kind="vendor"
            hint="Optional. Shown on your marketplace card and at the top of your page. Without one, the first portfolio photo is used."
            value={form.featured_image || null}
            onChange={(url) => set('featured_image', url ?? '')}
          />
          <ImageGalleryUpload label="Portfolio photos" kind="vendor" max={20} value={form.portfolio_images} onChange={(urls) => set('portfolio_images', urls)} />
        </Section>

        <Section title="Contact and location" description="Shown on your profile so organizers can reach you.">
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <Select label="City" value={form.city} onChange={(e) => set('city', e.target.value)}>
              {[...new Set([...cities, form.city])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Input label="Address" hint="Optional" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Koshi Highway, Itahari-6" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone" type="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="98XXXXXXXX" />
            <Input label="Email" type="email" hint="Quote requests are sent here" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="bookings@business.com" />
          </div>
        </Section>

        <div className="hidden justify-end gap-2 lg:flex">{actions}</div>
      </form>
      {existing && (
        <div className="mt-6 max-w-3xl">
          <PackagesManager listing={{ vendor: existing.id }} />
        </div>
      )}
      <div className={mobileBarClass(true)}>
        <div className="flex gap-2">{actions}</div>
      </div>
    </div>
  )
}

/** /app/listings/vendor/new */
export const NewVendorProfilePage: React.FC = () => <VendorProfileForm />

/** /app/listings/vendor/:id/edit */
export const EditVendorProfilePage: React.FC = () => {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['vendor-profile', id],
    queryFn: () => businessApi.getVendorProfile(id),
    enabled: isUuid(id),
    retry: false,
  })
  const notFound = !isUuid(id) || (query.isError && /not found|404/i.test(query.error.message))
  useErrorToast(query.isError && !notFound, query.error, 'Couldn’t load this profile')

  const profile = query.data
  const notOwner = Boolean(profile && user && profile.user !== user.id && user.role !== 'superadmin')

  if (query.isError && !notFound) {
    return (
      <div className={PAGE}>
        <BackLink to="/app/listings" label="Your listings" />
        <ErrorState message={query.error.message} onRetry={query.refetch} />
      </div>
    )
  }
  if (query.isLoading && !notFound) {
    return (
      <div className={PAGE}>
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-96 max-w-3xl rounded-2xl" />
      </div>
    )
  }
  if (!profile || notOwner) {
    return (
      <div className={PAGE}>
        <BackLink to="/app/listings" label="Your listings" />
        <Card>
          <EmptyState
            icon={<Store className="h-6 w-6" />}
            title={profile ? 'Only the owner can edit this profile' : 'We couldn’t find that profile'}
            description={profile ? 'Ask the business that listed it to make changes.' : 'It may have been removed, or the link is wrong.'}
            action={<ButtonLink to="/app/listings">Go to your listings</ButtonLink>}
          />
        </Card>
      </div>
    )
  }
  return <VendorProfileForm key={profile.id} existing={profile} />
}
