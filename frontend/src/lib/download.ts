import { tokenStore } from '@/services/api'

/** GET an API file (PDF, CSV) with the signed-in user's token and save it under the server's file name. */
export async function downloadApiFile(path: string, fallbackName: string) {
  const token = tokenStore.access
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Download failed (${res.status})`)
  }
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href
  a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}
