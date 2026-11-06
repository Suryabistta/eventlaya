import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Save, Undo2 } from 'lucide-react'
import { request } from '@/services/api'
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui'
import { cn } from '@/lib/utils'

interface RolePermission {
  role: string
  can_view: boolean
  can_create: boolean
  can_edit: boolean
  can_delete: boolean
  is_enabled: boolean
}

interface ModuleData {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  is_globally_enabled: boolean
  order: number
  role_permissions: RolePermission[]
}

interface RbacResponse {
  roles: string[]
  modules: ModuleData[]
}

type PermKey = Exclude<keyof RolePermission, 'role'>

const permColumns: { key: PermKey; label: string }[] = [
  { key: 'is_enabled', label: 'Access' },
  { key: 'can_view', label: 'View' },
  { key: 'can_create', label: 'Create' },
  { key: 'can_edit', label: 'Edit' },
  { key: 'can_delete', label: 'Delete' },
]

const roleLabels: Record<string, string> = {
  superadmin: 'Platform admin',
  organizer: 'Organizer',
  staff: 'Gate staff',
  attendee: 'Attendee',
  vendor: 'Vendor',
}

const rbacApi = {
  get: () => request<RbacResponse>('/auth/rbac/'),
  toggle: (slug: string, is_enabled: boolean) =>
    request<{ message: string; is_globally_enabled: boolean }>('/auth/rbac/toggle/', {
      method: 'POST',
      body: JSON.stringify({ slug, is_enabled }),
    }),
  save: (m: ModuleData) =>
    request<{ message: string }>('/auth/rbac/', {
      method: 'POST',
      body: JSON.stringify({
        module_id: m.id,
        is_globally_enabled: m.is_globally_enabled,
        role_permissions: m.role_permissions,
      }),
    }),
}

const Switch: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
}> = ({ checked, onChange, label, disabled, size = 'md' }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 disabled:opacity-50',
      size === 'md' ? 'h-6 w-11' : 'h-5 w-9',
      checked ? 'bg-brand-600' : 'bg-ink-300',
    )}
  >
    <span
      aria-hidden
      className={cn(
        'inline-block rounded-full bg-white shadow-xs transition-transform',
        size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
        checked ? (size === 'md' ? 'translate-x-[22px]' : 'translate-x-[18px]') : 'translate-x-0.5',
      )}
    />
  </button>
)

export const ModulesPage: React.FC = () => {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [role, setRole] = useState('organizer')
  // Unsaved permission edits, keyed by module id
  const [drafts, setDrafts] = useState<Record<string, RolePermission[]>>({})

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rbac'],
    queryFn: rbacApi.get,
  })

  useEffect(() => {
    if (isError) toast.error('Couldn’t load modules', (error as Error)?.message)
  }, [isError, error, toast])

  const modules = useMemo(
    () => (data?.modules ?? []).map((m) => (drafts[m.id] ? { ...m, role_permissions: drafts[m.id] } : m)),
    [data, drafts],
  )
  const roles = data?.roles?.length ? data.roles : ['superadmin', 'organizer', 'staff', 'attendee']
  const dirtyIds = Object.keys(drafts)

  const toggleGlobal = useMutation({
    mutationFn: ({ slug, enabled }: { slug: string; enabled: boolean }) => rbacApi.toggle(slug, enabled),
    onMutate: async ({ slug, enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['rbac'] })
      const previous = queryClient.getQueryData<RbacResponse>(['rbac'])
      queryClient.setQueryData<RbacResponse>(
        ['rbac'],
        (old) =>
          old && {
            ...old,
            modules: old.modules.map((m) => (m.slug === slug ? { ...m, is_globally_enabled: enabled } : m)),
          },
      )
      return { previous }
    },
    onSuccess: (_res, { slug, enabled }) => {
      const name = data?.modules.find((m) => m.slug === slug)?.name ?? slug
      toast.success(
        enabled ? `${name} turned on` : `${name} turned off`,
        enabled ? 'It’s available again for permitted roles.' : 'Hidden for every role until you turn it back on.',
      )
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['rbac'], ctx.previous)
      toast.error('Couldn’t change the module', err.message)
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      for (const m of modules.filter((m) => drafts[m.id])) await rbacApi.save(m)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] })
      setDrafts({})
      toast.success('Permissions saved')
    },
    onError: (err: Error) => {
      toast.error('Couldn’t save all permissions', `${err.message} Reload the page to see what was saved.`)
      void refetch()
    },
  })

  const togglePerm = (mod: ModuleData, key: PermKey) => {
    const next = mod.role_permissions.map((rp) => (rp.role === role ? { ...rp, [key]: !rp[key] } : rp))
    const original = data?.modules.find((m) => m.id === mod.id)?.role_permissions
    setDrafts((d) => {
      const copy = { ...d }
      if (JSON.stringify(original) === JSON.stringify(next)) delete copy[mod.id]
      else copy[mod.id] = next
      return copy
    })
  }

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 2xl:px-10">
      <PageHeader
        title="Modules and permissions"
        description="Turn platform modules on or off for everyone, and choose what each role can do in them."
        actions={
          dirtyIds.length > 0 && (
            <>
              <Button
                variant="secondary"
                icon={<Undo2 className="h-4 w-4" />}
                onClick={() => {
                  setDrafts({})
                  toast.info('Unsaved changes discarded')
                }}
                disabled={save.isPending}
              >
                Discard
              </Button>
              <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>
                Save changes
              </Button>
            </>
          )
        }
      />

      {isError ? (
        <ErrorState message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title="Platform modules"
            description="Module switches apply immediately. Permission changes apply when you save."
            actions={
              dirtyIds.length > 0 ? (
                <Badge tone="warning" dot>
                  {dirtyIds.length} unsaved
                </Badge>
              ) : undefined
            }
          />

          <div className="border-b border-ink-100 px-5 py-3">
            <div
              role="group"
              aria-label="Show permissions for role"
              className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-ink-100 p-1"
            >
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                    role === r ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900',
                  )}
                >
                  {roleLabels[r] ?? r}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : modules.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-6 w-6" />}
              title="No modules registered"
              description="Modules are created by the backend seed command. Run it, then reload this page."
              action={
                <Button variant="secondary" onClick={() => void refetch()}>
                  Reload
                </Button>
              }
            />
          ) : (
            <>
              <ul className="divide-y divide-ink-100 md:hidden">
                {modules.map((mod) => {
                  const rp = mod.role_permissions.find((p) => p.role === role)
                  const roleName = roleLabels[role] ?? role
                  return (
                    <li key={mod.id} className={cn('space-y-3 px-5 py-4', drafts[mod.id] && 'bg-marigold-50/40')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={cn('font-semibold', mod.is_globally_enabled ? 'text-ink-900' : 'text-ink-500')}>{mod.name}</p>
                          <p className="mt-0.5 text-xs text-ink-500">{mod.description}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs font-medium text-ink-600">{mod.is_globally_enabled ? 'On' : 'Off'}</span>
                          <Switch
                            checked={mod.is_globally_enabled}
                            label={`${mod.name} on for everyone`}
                            disabled={toggleGlobal.isPending && toggleGlobal.variables?.slug === mod.slug}
                            onChange={(v) =>
                              toggleGlobal.mutate({
                                slug: mod.slug,
                                enabled: v,
                              })
                            }
                          />
                        </div>
                      </div>
                      {rp && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
                          <span className="inline-flex items-center gap-2">
                            <Switch
                              size="sm"
                              checked={rp.is_enabled}
                              label={`${roleName} can access ${mod.name}`}
                              onChange={() => togglePerm(mod, 'is_enabled')}
                            />
                            Access
                          </span>
                          {permColumns
                            .filter((c) => c.key !== 'is_enabled')
                            .map((c) => (
                              <label key={c.key} className={cn('inline-flex items-center gap-1.5', !rp.is_enabled && 'opacity-50')}>
                                <input
                                  type="checkbox"
                                  checked={rp[c.key]}
                                  disabled={!rp.is_enabled}
                                  onChange={() => togglePerm(mod, c.key)}
                                  className="h-4 w-4 rounded border-ink-300 accent-brand-600"
                                />
                                {c.label}
                              </label>
                            ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="relative hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-ink-50 text-xs font-medium text-ink-500">
                    <tr>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Module
                      </th>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        On for everyone
                      </th>
                      {permColumns.map((c) => (
                        <th key={c.key} scope="col" className="px-3 py-2.5 text-center font-medium">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {modules.map((mod) => {
                      const rp = mod.role_permissions.find((p) => p.role === role)
                      const roleName = (roleLabels[role] ?? role).toLowerCase()
                      return (
                        <tr key={mod.id} className={cn(drafts[mod.id] && 'bg-marigold-50/40')}>
                          <td className="max-w-[320px] px-5 py-3.5 align-top">
                            <p className={cn('font-semibold', mod.is_globally_enabled ? 'text-ink-900' : 'text-ink-500')}>{mod.name}</p>
                            <p className="mt-0.5 text-xs text-ink-500">{mod.description}</p>
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={mod.is_globally_enabled}
                                label={`${mod.name} on for everyone`}
                                disabled={toggleGlobal.isPending && toggleGlobal.variables?.slug === mod.slug}
                                onChange={(v) =>
                                  toggleGlobal.mutate({
                                    slug: mod.slug,
                                    enabled: v,
                                  })
                                }
                              />
                              <span className={cn('text-xs font-medium', mod.is_globally_enabled ? 'text-ink-700' : 'text-ink-500')}>
                                {mod.is_globally_enabled ? 'On' : 'Off'}
                              </span>
                            </div>
                          </td>
                          {permColumns.map((c) =>
                            rp ? (
                              <td key={c.key} className="px-3 py-3.5 text-center align-top">
                                {c.key === 'is_enabled' ? (
                                  <Switch
                                    size="sm"
                                    checked={rp.is_enabled}
                                    label={`${roleLabels[role] ?? role} can access ${mod.name}`}
                                    onChange={() => togglePerm(mod, c.key)}
                                  />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={rp[c.key]}
                                    disabled={!rp.is_enabled}
                                    onChange={() => togglePerm(mod, c.key)}
                                    aria-label={`${c.label} ${mod.name} (${roleName})`}
                                    className="h-4 w-4 cursor-pointer rounded border-ink-300 text-brand-600 accent-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
                                  />
                                )}
                              </td>
                            ) : (
                              <td key={c.key} className="px-3 py-3.5 text-center text-xs text-ink-400">
                                –
                              </td>
                            ),
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      <p className="text-sm text-ink-500">
        Turning a module off hides it from web navigation and the mobile scanner app for every role, and its API stops accepting requests.
        Role permissions fine-tune access while a module is on, for example letting gate staff view scanner stats without editing tickets.
      </p>
    </div>
  )
}

export default ModulesPage
