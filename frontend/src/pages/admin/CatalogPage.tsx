import React, { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, MapPin, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import type { City, VendorCategory } from '@/services/api'
import type { EventCategoryItem } from '@/lib/event-page'
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import { platformApi } from './api'
import { PAGE, Segmented, Switch } from './shared'

type Kind = 'cities' | 'categories' | 'event-types'

/** One row of either list, with the fields the form edits. */
interface Item {
  id?: string
  name: string
  order: number
  is_active: boolean
  /** Cities: province. Categories: Lucide icon name. */
  extra: string
  /** Vendor categories: live vendors using it. Event types: events using it (blocks delete). */
  used?: number
}

const toItem = (kind: Kind, x: City | VendorCategory | EventCategoryItem): Item => {
  const base = { id: x.id, name: x.name, order: x.order, is_active: x.is_active }
  if (kind === 'cities') return { ...base, extra: (x as City).province }
  if (kind === 'event-types') return { ...base, extra: '', used: (x as EventCategoryItem).events_count ?? 0 }
  return { ...base, extra: (x as VendorCategory).icon, used: (x as VendorCategory).vendors_count }
}

const fromItem = (kind: Kind, i: Partial<Item>) => {
  const { extra, used: _used, ...rest } = i
  if (kind === 'event-types') return rest
  return kind === 'cities' ? { ...rest, province: extra } : { ...rest, icon: extra }
}

const API = {
  cities: { list: platformApi.cities, save: platformApi.saveCity, remove: platformApi.deleteCity },
  categories: { list: platformApi.categories, save: platformApi.saveCategory, remove: platformApi.deleteCategory },
  'event-types': { list: platformApi.eventTypes, save: platformApi.saveEventType, remove: platformApi.deleteEventType },
} as const

const COPY = {
  cities: {
    noun: 'city',
    extraLabel: 'Province',
    extraHint: 'Optional, e.g. Koshi',
    empty: 'Cities appear in the event, vendor and venue filters and in sign-up.',
    // Public lists that read this data
    invalidate: ['cities'],
  },
  categories: {
    noun: 'category',
    extraLabel: 'Icon',
    extraHint: 'Optional Lucide icon name, e.g. camera',
    empty: 'Vendors pick one of these when they list their business.',
    invalidate: ['marketplaceCategories'],
  },
  'event-types': {
    noun: 'event type',
    extraLabel: '',
    extraHint: '',
    empty: 'Organizers pick one of these when they create an event; visitors filter the events page by them.',
    invalidate: ['event-categories'],
  },
} as const

const usedText = (kind: Kind, n: number) =>
  kind === 'event-types' ? `${n} event${n === 1 ? '' : 's'}` : `${n} live vendor${n === 1 ? '' : 's'}`

/** Superadmin → Cities & categories: the lists behind every city and vendor-category picker. */
export const CatalogPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab')
  const kind: Kind = tab === 'categories' || tab === 'event-types' ? tab : 'cities'
  const copy = COPY[kind]
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Item | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-catalog', kind],
    queryFn: async () => (await API[kind].list()).map((x: City | VendorCategory | EventCategoryItem) => toItem(kind, x)),
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-catalog', kind] })
    void qc.invalidateQueries({ queryKey: copy.invalidate })
  }

  const save = useMutation({
    mutationFn: (i: Partial<Item>): Promise<unknown> =>
      (API[kind].save as (b: object) => Promise<unknown>)(fromItem(kind, i)),
    onSuccess: (_r, i) => {
      refresh()
      setEditing(null)
      if (i.name !== undefined) toast.success(i.id ? 'Saved' : `Added ${i.name}`)
    },
    onError: (err: Error) => toast.error(`Couldn’t save the ${copy.noun}`, err.message),
  })

  const remove = useMutation({
    mutationFn: (i: Item) => API[kind].remove(i.id!),
    onSuccess: (_r, i) => {
      refresh()
      toast.success(`Deleted ${i.name}`)
    },
    onError: (err: Error) => toast.error(`Couldn’t delete the ${copy.noun}`, err.message),
  })

  const nextOrder = (data ?? []).reduce((m, i) => Math.max(m, i.order + 1), 0)
  const addButton = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ name: '', order: nextOrder, is_active: true, extra: '' })}>
      Add {copy.noun}
    </Button>
  )

  return (
    <div className={PAGE}>
      <PageHeader
        title="Cities & categories"
        description="Inactive entries are hidden from public pickers and filters but kept on existing listings."
        actions={addButton}
      />
      <Segmented
        label="List"
        value={kind}
        onChange={(v) => setParams(v === 'cities' ? {} : { tab: v })}
        options={[
          { value: 'cities', label: 'Cities' },
          { value: 'categories', label: 'Vendor categories' },
          { value: 'event-types', label: 'Event types' },
        ]}
      />

      {isLoading ? (
        <Card className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load the list." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={kind === 'cities' ? <MapPin className="h-6 w-6" /> : kind === 'event-types' ? <CalendarDays className="h-6 w-6" /> : <Tags className="h-6 w-6" />}
          title={`No ${kind === 'cities' ? 'cities' : kind === 'event-types' ? 'event types' : 'categories'} yet`}
          description={copy.empty}
          action={addButton}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-ink-100">
            {data.map((i) => (
              <li key={i.id} className="flex items-center gap-4 px-5 py-3">
                <span className="tabular w-8 shrink-0 text-sm text-ink-400" title="Sort order">
                  {i.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-900">
                    {i.name} {!i.is_active && <Badge tone="neutral">Hidden</Badge>}
                  </p>
                  <p className="truncate text-sm text-ink-500">
                    {[i.extra, i.used !== undefined && usedText(kind, i.used)].filter(Boolean).join(' · ') || ' '}
                  </p>
                </div>
                <Switch
                  size="sm"
                  checked={i.is_active}
                  label={`Show ${i.name} publicly`}
                  disabled={save.isPending}
                  onChange={(is_active) => save.mutate({ id: i.id, is_active })}
                />
                <IconButton label={`Edit ${i.name}`} onClick={() => setEditing(i)}>
                  <Pencil className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={`Delete ${i.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${i.name}? Existing listings keep their value; hiding it is usually enough.`)) remove.mutate(i)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <ItemForm
          key={editing.id ?? 'new'}
          item={editing}
          kind={kind}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(i) => save.mutate(i)}
        />
      )}
    </div>
  )
}

const ItemForm: React.FC<{ item: Item; kind: Kind; saving: boolean; onClose: () => void; onSave: (i: Item) => void }> = ({
  item,
  kind,
  saving,
  onClose,
  onSave,
}) => {
  const copy = COPY[kind]
  const [form, setForm] = useState(item)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ ...form, name: form.name.trim() })
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={item.id ? `Edit ${item.name}` : `Add ${copy.noun}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="catalog-item-form" loading={saving} disabled={!form.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="catalog-item-form" onSubmit={submit} className="space-y-4">
        <Input label="Name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        {copy.extraLabel && (
          <Input label={copy.extraLabel} hint={copy.extraHint} value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} />
        )}
        <Input
          label="Sort order"
          hint="Lower numbers come first"
          type="number"
          min={0}
          value={form.order}
          onChange={(e) => setForm({ ...form, order: Math.max(0, Number(e.target.value) || 0) })}
        />
      </form>
    </Modal>
  )
}

export default CatalogPage
