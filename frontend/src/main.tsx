import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './fonts.css'
import './index.css'

const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

const container = document.getElementById('root')!

if (!container.hasAttribute('data-prerendered')) {
  ReactDOM.createRoot(container).render(app)
} else {
  // Prerendered page (scripts/prerender.mjs): the static HTML is already on screen. Build the live app next to it,
  // invisibly, and swap once it has loaded its route and data — no spinner flash, no layout jump.
  const live = document.createElement('div')
  live.style.cssText = 'position:absolute;top:0;left:0;width:100%;visibility:hidden;pointer-events:none'
  container.after(live)
  ReactDOM.createRoot(live).render(app)
  swapWhenSettled(container, live)
}

function swapWhenSettled(staticRoot: HTMLElement, live: HTMLElement) {
  const started = performance.now()
  const swap = () => {
    staticRoot.remove()
    live.removeAttribute('style')
    live.id = 'root'
  }
  const settled = () =>
    live.childElementCount > 0 &&
    !live.querySelector('[role="status"], .animate-pulse') &&
    document.documentElement.dataset.seoPath === window.location.pathname
  const tick = () => {
    const waited = performance.now() - started
    if (settled() || waited > 6000) {
      // Let entrance animations of the live page finish first so nothing visibly replays.
      const running = document
        .getAnimations()
        .filter((a) => live.contains((a.effect as KeyframeEffect | null)?.target as Node) && a.effect?.getTiming().iterations !== Infinity)
      Promise.race([Promise.all(running.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2500))]).then(() =>
        requestAnimationFrame(swap),
      )
      return
    }
    setTimeout(tick, 50)
  }
  tick()
}
