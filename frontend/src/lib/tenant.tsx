import React, { createContext, useContext } from 'react'
import type { ResolvedTenant } from '@/services/api'

/** The live white-label site this page is running as, or null on eventlaya.com. */
const TenantContext = createContext<ResolvedTenant | null>(null)

export const TenantProvider: React.FC<{ tenant: ResolvedTenant | null; children: React.ReactNode }> = ({ tenant, children }) => (
  <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
)

export const useTenant = () => useContext(TenantContext)

/* ------------------------------------------------------------------ */
/* Theme: the organizer's primary colour becomes the brand palette     */

type RGB = [number, number, number]

const HEX = /^#?([0-9a-f]{6})$/i

export function hexToRgb(hex: string): RGB | null {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB

function luminance([r, g, b]: RGB) {
  const c = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

const contrastWithWhite = (c: RGB) => 1.05 / (luminance(c) + 0.05)

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

/** 50…950 palette with `base` as 600, darkened if needed so white text on it stays readable (WCAG AA). */
export function brandPalette(hex: string): Record<string, RGB> | null {
  let base = hexToRgb(hex)
  if (!base) return null
  for (let i = 0; i < 20 && contrastWithWhite(base) < 4.5; i++) base = mix(base, BLACK, 0.08)
  return {
    50: mix(base, WHITE, 0.94),
    100: mix(base, WHITE, 0.88),
    200: mix(base, WHITE, 0.75),
    300: mix(base, WHITE, 0.55),
    400: mix(base, WHITE, 0.32),
    500: mix(base, WHITE, 0.14),
    600: base,
    700: mix(base, BLACK, 0.16),
    800: mix(base, BLACK, 0.32),
    900: mix(base, BLACK, 0.45),
    950: mix(base, BLACK, 0.65),
  }
}

function setFavicon(href: string) {
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove())
  for (const rel of ['icon', 'apple-touch-icon']) {
    const link = document.createElement('link')
    link.rel = rel
    link.href = href
    document.head.appendChild(link)
  }
}

/** Recolour the app, set the tab title / icon, and add the organizer's custom CSS. */
export function applyTenantTheme(t: ResolvedTenant) {
  const root = document.documentElement
  const palette = brandPalette(t.primary_color || '')
  if (palette) for (const [k, rgb] of Object.entries(palette)) root.style.setProperty(`--brand-${k}`, rgb.join(' '))
  const accent = hexToRgb(t.accent_color || '')
  if (accent) root.style.setProperty('--tenant-accent', accent.join(' '))
  root.dataset.tenant = t.host

  const name = t.brand_name || t.organizer_name || 'Events'
  document.title = name
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette ? `rgb(${palette[600].join(',')})` : '#C2215A')
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name)
  document.querySelector('meta[name="description"]')?.setAttribute('content', `Events by ${name}: registration and passes.`)
  document.querySelector('link[rel="manifest"]')?.remove() // the Eventlaya PWA manifest would install "Eventlaya"
  if (t.brand_logo) setFavicon(t.brand_logo)

  if (t.custom_css) {
    const style = document.createElement('style')
    style.id = 'tenant-css'
    style.textContent = t.custom_css // the API refuses "<", so it can't close the tag
    document.head.appendChild(style)
  }
}

/** The organizer's logo (or initial) and name, for headers on the white-label site. */
export const TenantMark: React.FC<{ tenant: ResolvedTenant; className?: string; large?: boolean }> = ({ tenant, className, large }) => {
  const [failed, setFailed] = React.useState(false)
  const name = tenant.brand_name || tenant.organizer_name || 'Events'
  const size = large ? 'h-16 w-16 rounded-2xl text-2xl' : 'h-9 w-9 rounded-xl text-base'
  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className ?? ''}`}>
      {tenant.brand_logo && !failed ? (
        <img src={tenant.brand_logo} alt="" className={`${size} shrink-0 bg-white object-contain`} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden className={`${size} inline-flex shrink-0 items-center justify-center bg-brand-600 font-display font-bold text-white`}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      {!large && <span className="truncate font-display text-lg font-bold text-ink-900">{name}</span>}
    </span>
  )
}
