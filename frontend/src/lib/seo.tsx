/**
 * Search, social and AI-crawler metadata for the current page.
 *
 * The backend is the single source of truth (apps/seo/pages.py): <SeoHead /> asks GET /api/seo/meta/?path=… on
 * every navigation and writes <title>, description, robots, canonical, Open Graph, Twitter and JSON-LD into <head>
 * (all marked data-seo). The build-time prerender (scripts/prerender.mjs) captures the result into static HTML, and
 * Django injects the same tags into /e/…, /blog/… and marketplace pages, so crawlers see them without JavaScript.
 */
import React, { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { isModuleDisabled, request } from '@/services/api'
import { TENANT_HOST } from './tenant-host'

export interface PageMeta {
  title: string
  description: string
  canonical: string | null
  robots: string
  status: number
  og_type: string
  image: string
  image_alt: string
  image_width: number | null
  image_height: number | null
  image_type: string | null
  /** og:title / twitter:title (e.g. just the event name) */
  og_title: string
  site_name: string
  jsonld: Record<string, unknown>[]
  published: string | null
  modified: string | null
  /** <html lang> and og:locale of the page (Nepali blog posts: 'ne' / 'ne_NP'); English when missing */
  lang?: string
  locale?: string
  /** Language versions of the page (hreflang), this page included, plus x-default */
  alternates?: { hreflang: string; href: string; locale: string }[]
}

/**
 * App screens that are never indexed (no metadata request for them). Subset of PRIVATE in apps/seo/pages.py:
 * /e/<slug>/… sub-pages always ask the server, because other apps can register indexable pages there.
 */
const PRIVATE = /^\/(app|admin|login|forgot-password|reset-password|verify-email|ticket|my|superadmin)(\/|$)/

function normalize(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export const seoMetaKey = (path: string) => ['seo-meta', TENANT_HOST, path] as const

export function fetchPageMeta(path: string) {
  return request<PageMeta>(`/seo/meta/?path=${encodeURIComponent(path)}`)
}

function setTag(tag: 'meta' | 'link', key: string, keyValue: string, attrs: Record<string, string>) {
  const el = document.createElement(tag)
  el.setAttribute(key, keyValue)
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
  el.setAttribute('data-seo', '')
  document.head.appendChild(el)
}

export function applyPageMeta(meta: PageMeta) {
  document.title = meta.title
  document.head.querySelectorAll('[data-seo]').forEach((el) => el.remove())
  setTag('meta', 'name', 'description', { content: meta.description })
  setTag('meta', 'name', 'robots', { content: meta.robots })
  if (meta.canonical) setTag('link', 'rel', 'canonical', { href: meta.canonical })
  const alternates = meta.alternates ?? []
  alternates.forEach((a) => setTag('link', 'rel', 'alternate', { hreflang: a.hreflang, href: a.href }))
  document.documentElement.lang = meta.lang || 'en'
  const locale = meta.locale || 'en_US'
  const ogTitle = meta.og_title || meta.title
  const og: [string, string | null | undefined][] = [
    ['og:type', meta.og_type],
    ['og:site_name', meta.site_name],
    ['og:title', ogTitle],
    ['og:description', meta.description],
    ['og:url', meta.canonical],
    ['og:image', meta.image],
    ['og:image:type', meta.image_type],
    ['og:image:width', meta.image_width ? String(meta.image_width) : null],
    ['og:image:height', meta.image_height ? String(meta.image_height) : null],
    ['og:image:alt', meta.image_alt || ogTitle],
    ['og:locale', locale],
    ...alternates.filter((a) => a.locale && a.locale !== locale).map((a): [string, string] => ['og:locale:alternate', a.locale]),
  ]
  if (meta.og_type === 'article') og.push(['article:published_time', meta.published], ['article:modified_time', meta.modified])
  og.forEach(([k, v]) => v && setTag('meta', 'property', k, { content: v }))
  ;[
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', ogTitle],
    ['twitter:description', meta.description],
    ['twitter:image', meta.image],
    ['twitter:image:alt', meta.image_alt || ogTitle],
  ].forEach(([k, v]) => v && setTag('meta', 'name', k, { content: v }))
  meta.jsonld.forEach((node) => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute('data-seo', '')
    script.textContent = JSON.stringify(node)
    document.head.appendChild(script)
  })
}

/** Keeps <head> in step with the route. Mount once, after the routes. */
export const SeoHead: React.FC = () => {
  const { pathname } = useLocation()
  const path = normalize(pathname)
  const isPrivate = PRIVATE.test(path)
  const { data, isError } = useQuery({
    queryKey: seoMetaKey(path),
    queryFn: () => fetchPageMeta(path),
    enabled: !isPrivate,
    staleTime: 5 * 60_000,
    retry: 0,
  })

  useEffect(() => {
    if (isPrivate) {
      document.head.querySelectorAll('[data-seo]').forEach((el) => el.remove())
      document.documentElement.lang = 'en'
      setTag('meta', 'name', 'robots', { content: 'noindex,nofollow' })
    } else if (data) {
      applyPageMeta(data)
    } else if (!isError) {
      return
    }
    // Tells the prerender (and the prerendered-page swap in main.tsx) that this page's head is final
    document.documentElement.dataset.seoPath = pathname
  }, [data, isError, isPrivate, pathname])

  return null
}

/** Whether the blog module is on (and this is eventlaya.com, not a white-label site). True while unknown. */
export function useBlogEnabled() {
  const { data, error } = useQuery({
    queryKey: ['blog-status'],
    queryFn: () => request<{ enabled: boolean; posts: number }>('/blog/status/'),
    enabled: !TENANT_HOST,
    staleTime: 5 * 60_000,
    retry: 0,
  })
  if (TENANT_HOST) return false
  if (error) return !isModuleDisabled(error)
  return data ? data.enabled : true
}
