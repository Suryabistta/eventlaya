import React, { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import type { City, VendorCategory } from '@/services/api'
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, Input, Modal, PageHeader, Skeleton, useToast } from '@/components/ui'
import { platformApi } from './api'
import { PAGE, Segmented, Switch } from './shared'

type Kind = 'cities' | 'categories'

/** One row of either list, with the fields the form edits. */
interface Item {
  id?: string
  name: string
  order: number
  is_active: boolean
  /** Cities: province. Categories: Lucide icon name. */
  extra: string
  /** Categories only: vendors using it (blocks delete). */
  used?: number
}

const toItem = (kind: Kind, x: City | VendorCategory): Item =>
  kind === 'cities'
    ? { id: x.id, name: x.name, order: x.order, is_active: x.is_active, extra: (x as City).province }
    : { id: x.id, name: x.name, order: x.order, is_active: x.is_active, extra: (x as VendorCategory).icon, used: (x as VendorCategory).vendors_count }

const fromItem = (kind: Kind, i: Partial<Item>) => {
  const { extra, used: _used, ...rest } = i
  return kind === 'cities' ? { ...rest, province: extra } : { ...rest, icon: extra }
}

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
} as const

/** Superadmin → Cities & categories: the lists behind every city and vendor-category picker. */
export const CatalogPage: React.FC = () => {
  const [params, setParams] = useSearchParams()
  const kind: Kind = params.get('tab') === 'categories' ? 'categories' : 'cities'
  const copy = COPY[kind]
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Item | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-catalog', kind],
    queryFn: async () => (kind === 'cities' ? await platformApi.cities() : await platformApi.categories()).map((x) => toItem(kind, x)),
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-catalog', kind] })
    void qc.invalidateQueries({ queryKey: copy.invalidate })
  }

  const save = useMutation({
    mutationFn: (i: Partial<Item>): Promise<unknown> =>
      kind === 'cities' ? platformApi.saveCity(fromItem(kind, i)) : platformApi.saveCategory(fromItem(kind, i)),
    onSuccess: (_r, i) => {
      refresh()
      setEditing(null)
      if (i.name !== undefined) toast.success(i.id ? 'Saved' : `Added ${i.name}`)
    },
    onError: (err: Error) => toast.error(`Couldn’t save the ${copy.noun}`, err.message),
  })

  const remove = useMutation({
    mutationFn: (i: Item) => (kind === 'cities' ? platformApi.deleteCity(i.id!) : platformApi.deleteCategory(i.id!)),
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
          icon={kind === 'cities' ? <MapPin className="h-6 w-6" /> : <Tags className="h-6 w-6" />}
          title={`No ${kind === 'cities' ? 'cities' : 'categories'} yet`}
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
                    {[i.extra, i.used !== undefined && `${i.used} live vendor${i.used === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || ' '}
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
        <Input label={copy.extraLabel} hint={copy.extraHint} value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} />
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
