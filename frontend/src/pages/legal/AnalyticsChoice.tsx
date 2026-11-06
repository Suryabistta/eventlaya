import React from 'react'
import { useAnalyticsChoice } from '@/lib/analytics'

/**
 * "Analytics in this browser: on/off" on /privacy#analytics (linked from the footers). Stored in localStorage;
 * off also deletes the _ga cookies and stops Google Analytics at once (lib/analytics.ts).
 */
export const AnalyticsChoice: React.FC = () => {
  const { block, set } = useAnalyticsChoice()
  // The prerendered copy shows what a normal visitor sees; the live page replaces it
  const effective = block === 'prerender' ? null : block
  const browserSaysNo = effective === 'do-not-track' || effective === 'global-privacy-control'
  const on = effective === null

  return (
    <div className="not-prose my-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.95rem] text-ink-800">
          Analytics in this browser: <strong className={on ? 'text-emerald-700' : 'text-ink-900'}>{on ? 'On' : 'Off'}</strong>
        </p>
        {!browserSaysNo && effective !== 'tenant' && (
          <button
            type="button"
            onClick={() => set(on ? 'off' : 'on')}
            className="rounded-[10px] border border-ink-200 bg-white px-3.5 py-2 text-sm font-semibold text-ink-800 hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            {on ? 'Turn analytics off' : 'Turn analytics on'}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-sm text-ink-500">
        {browserSaysNo
          ? `Your browser sends a “${effective === 'do-not-track' ? 'Do Not Track' : 'Global Privacy Control'}” signal, so we don’t load Google Analytics at all.`
          : on
            ? 'Turning it off is remembered in this browser and deletes the Google Analytics cookies.'
            : 'We don’t load Google Analytics in this browser.'}
      </p>
    </div>
  )
}
