import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Card, ErrorState, ImageUpload, PageHeader, Skeleton, useToast } from '@/components/ui'
import { Logo } from '@/components/ui/Logo'
import { siteBrandingApi, useSiteBranding, type SiteBranding } from '@/lib/site-branding'
import { PAGE } from './shared'

/** Superadmin → Site logo: the Eventlaya logo on the landing pages and in the app. */
export const SiteLogoPage: React.FC = () => {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useSiteBranding()
  const [form, setForm] = useState<SiteBranding>({ logo: '', logo_white: '' })
  useEffect(() => {
    if (data) setForm({ logo: data.logo, logo_white: data.logo_white })
  }, [data])

  const save = useMutation({
    mutationFn: (b: SiteBranding) => siteBrandingApi.save(b),
    onSuccess: (b) => {
      qc.setQueryData(['site-branding'], b)
      toast.success('Logo saved')
    },
    onError: (err: Error) => toast.error('Couldn’t save the logo', err.message),
  })

  return (
    <div className={PAGE}>
      <PageHeader title="Site logo" description="The Eventlaya logo in the landing-page header and footer and in the app sidebar. Leave empty to use the built-in logo." />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <Card className="max-w-2xl space-y-5 p-5">
          <ImageUpload label="Logo" kind="logo" value={form.logo} onChange={(url) => setForm((f) => ({ ...f, logo: url ?? '' }))} hint="Wide logo, transparent PNG works best. Shown about 36 px tall." />
          <ImageUpload label="Logo on dark backgrounds" kind="logo" value={form.logo_white} onChange={(url) => setForm((f) => ({ ...f, logo_white: url ?? '' }))} hint="Optional light version for the dark footer. Without it the main logo is used." />
          <div className="flex flex-wrap items-center gap-6 rounded-xl border border-ink-200 p-4">
            <span className="text-xs font-semibold uppercase text-ink-500">Now live</span>
            <Logo />
            <span className="rounded-lg bg-ink-900 p-2">
              <Logo inverted />
            </span>
          </div>
          <div className="flex justify-end gap-2">
            {(data?.logo || data?.logo_white) && (
              <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate({ logo: '', logo_white: '' })}>
                Use built-in logo
              </Button>
            )}
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>
              Save
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
