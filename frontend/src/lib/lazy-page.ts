import React from 'react'

/** After a deploy the old code files are gone, so a tab that was already open fails to load the next page
 *  ("Failed to fetch dynamically imported module"). Reload once to get the new version; the flag stops a loop
 *  when the page is really broken (then the error shows as usual). */
const KEY = 'eventlaya-reloaded-for-new-version'

export function reloadForNewVersion(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false // storage blocked: don't risk a reload loop
  }
  window.location.reload()
  return true
}

/** Route-level code splitting: each page downloads only when it's first opened. */
export function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return React.lazy(() =>
    load()
      .then((m) => {
        try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
        return { default: m[name] as React.ComponentType }
      })
      .catch((err: unknown) => {
        // Never resolves while the page reloads; otherwise the error reaches the error screen as before
        if (reloadForNewVersion()) return new Promise<never>(() => {})
        throw err
      }),
  )
}
