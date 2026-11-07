import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Package, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { api, type ServicePackage } from '@/services/api'
import { useModuleEnabled } from '@/lib/modules'
import { Badge, Button, Card, CardHeader, IconButton, ImageUpload, Input, Modal, Select, Textarea, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatRs } from './shared'

type Listing = { vendor: string } | { venue: string }

const key = (l: Listing, mine = false) => ['packages', 'vendor' in l ? `vendor:${l.vendor}` : `venue:${l.venue}`, mine ? 'mine' : 'public']

/** Public: a listing's packages, each with "Ask about this package" (module `packages`). Hidden when there are none. */
export const PackagesSection: React.FC<{ listing: Listing; selectedId?: string; onSelect?: (p: ServicePackage) => void; className?: string }> = ({
  listing,
  selectedId,
  onSelect,
  className,
}) => {
  const on = useModuleEnabled('packages')
  const { data = [] } = useQuery({ queryKey: key(listing), queryFn: () => api.getPackages(listing), enabled: on, retry: false })
  if (!on || !data.length) return null
  return (
    <Card className={className}>
      <CardHeader title="Packages" description="Pick one to ask about it. Final prices are confirmed by the business." />
      <ul className="grid gap-4 p-5 sm:grid-cols-2">
        {data.map((p) => {
          const selected = p.id === selectedId
          return (
            <li key={p.id} className={cn('flex flex-col overflow-hidden rounded-xl border', selected ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-ink-200')}>
              {p.image && <img src={p.image} alt="" loading="lazy" className="h-32 w-full object-cover" />}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-ink-900">{p.name}</h3>
                  {p.max_guests ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-500">
                      <Users className="h-3.5 w-3.5" aria-hidden />
                      Up to {p.max_guests}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm">
                  <span className="text-lg font-bold text-ink-900 tabular">{formatRs(p.price)}</span>{' '}
                  <span className="text-ink-500">{p.price_unit_display}</span>
                </p>
                {p.description && <p className="text-sm text-ink-600">{p.description}</p>}
                {p.inclusions.length > 0 && (
                  <ul className="space-y-1 text-sm text-ink-700">
                    {p.inclusions.map((line) => (
                      <li key={line} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
                {onSelect && (
                  <Button className="mt-auto" variant={selected ? 'primary' : 'secondary'} size="sm" onClick={() => onSelect(p)}>
                    {selected ? 'Selected' : 'Ask about this package'}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

type Draft = Omit<ServicePackage, 'id' | 'price_unit_display' | 'vendor' | 'venue'> & { id?: string }

const UNITS: { value: ServicePackage['price_unit']; label: string }[] = [
  { value: 'event', label: 'per event' },
  { value: 'day', label: 'per day' },
  { value: 'plate', label: 'per plate' },
  { value: 'person', label: 'per person' },
  { value: 'hour', label: 'per hour' },
]

/** Owner: create, edit, hide and delete the packages of one vendor profile or venue. */
export const PackagesManager: React.FC<{ listing: Listing }> = ({ listing }) => {
  const on = useModuleEnabled('packages')
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Draft | null>(null)
  const { data = [], isLoading } = useQuery({
    queryKey: key(listing, true),
    queryFn: async () => (await api.getPackages({ mine: true })).filter((p) => ('vendor' in listing ? p.vendor === listing.vendor : p.venue === listing.venue)),
    enabled: on,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['packages'] })
  const save = useMutation({
    mutationFn: (d: Partial<ServicePackage>) => api.savePackage({ ...d, ...listing }),
    onSuccess: (_r, d) => {
      void refresh()
      setEditing(null)
      if (d.name !== undefined) toast.success('Package saved')
    },
    onError: (err: Error) => toast.error('Couldn’t save the package', err.message),
  })
  const remove = useMutation({
    mutationFn: api.deletePackage,
    onSuccess: () => {
      void refresh()
      toast.success('Package deleted')
    },
    onError: (err: Error) => toast.error('Couldn’t delete the package', err.message),
  })
  if (!on) return null

  const add = () =>
    setEditing({ name: '', price: '', price_unit: 'event', description: '', inclusions: [], max_guests: null, image: '', is_active: true, order: data.length })

  return (
    <Card>
      <CardHeader
        title="Packages"
        description="Priced bundles customers can ask about, for example “Wedding gold: stage, lights and DJ”."
        actions={
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={add}>
            Add package
          </Button>
        }
      />
      {isLoading ? null : !data.length ? (
        <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-ink-500">
          <Package className="h-6 w-6 text-ink-400" aria-hidden />
          No packages yet.
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-ink-900">
                  {p.name} {!p.is_active && <Badge tone="neutral">Hidden</Badge>}
                </p>
                <p className="text-ink-500">
                  {formatRs(p.price)} {p.price_unit_display}
                  {p.inclusions.length > 0 && ` · ${p.inclusions.length} included`}
                </p>
              </div>
              <IconButton label={`Edit ${p.name}`} onClick={() => setEditing({ ...p, price: String(Number(p.price)) })}>
                <Pencil className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={`Delete ${p.name}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${p.name}?`)) remove.mutate(p.id)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {editing && <PackageForm key={editing.id ?? 'new'} draft={editing} saving={save.isPending} onClose={() => setEditing(null)} onSave={(d) => save.mutate(d)} />}
    </Card>
  )
}

const PackageForm: React.FC<{ draft: Draft; saving: boolean; onClose: () => void; onSave: (d: Partial<ServicePackage>) => void }> = ({
  draft,
  saving,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState({ ...draft, inclusionsText: draft.inclusions.join('\n') })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const price = Number(form.price)
  const valid = form.name.trim() && form.price !== '' && price >= 0
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={draft.id ? `Edit ${draft.name}` : 'Add package'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="package-form" loading={saving} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="package-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const { inclusionsText, ...rest } = form
          onSave({
            ...rest,
            name: form.name.trim(),
            price: price.toFixed(2),
            description: form.description.trim(),
            inclusions: inclusionsText.split('\n').map((l) => l.trim()).filter(Boolean),
          })
        }}
      >
        <Input label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Wedding gold" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Price (Rs)" required type="number" min={0} value={form.price} onChange={(e) => set('price', e.target.value)} />
          <Select label="Per" value={form.price_unit} onChange={(e) => set('price_unit', e.target.value as Draft['price_unit'])}>
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
          <Input
            label="Max guests"
            hint="Optional"
            type="number"
            min={1}
            value={form.max_guests ?? ''}
            onChange={(e) => set('max_guests', e.target.value ? Math.max(1, Number(e.target.value)) : null)}
          />
        </div>
        <Textarea label="Description" hint="Optional" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        <Textarea
          label="What’s included"
          hint="One item per line, e.g. Stage 24×16 ft"
          rows={4}
          value={form.inclusionsText}
          onChange={(e) => set('inclusionsText', e.target.value)}
        />
        <ImageUpload label="Photo" kind="vendor" hint="Optional" value={form.image || null} onChange={(url) => set('image', url ?? '')} />
        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Show this package on my page
        </label>
      </form>
    </Modal>
  )
}
