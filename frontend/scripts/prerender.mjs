#!/usr/bin/env node
/**
 * Build-time prerender: opens each public page of the built app (dist/) in headless Chrome and saves the rendered
 * HTML to dist/prerender/<path>/index.html, so search engines and AI crawlers get real content without running
 * JavaScript. Visitors get the same page instantly; src/main.tsx swaps in the live app once it has loaded.
 *
 *   npm run prerender                                  # data from https://eventlaya.com (production API)
 *   PRERENDER_API=http://127.0.0.1:8060 npm run prerender   # data from a local backend
 *
 * Env: PRERENDER_API (origin for /api and /media), DIST (default dist), CHROME (default /usr/bin/google-chrome),
 *      PRERENDER_ROUTES (comma-separated paths instead of the default list), PRERENDER_STRICT=1 (exit 1 on any failure).
 *
 * Nginx serves dist/prerender/* for the static marketing routes on eventlaya.com only (never on white-label hosts; the
 * homepage goes through Django, which adds the search-engine verification tags);
 * blog pages go through Django (apps/seo), which uses the prerendered copy while it is fresh. See docs/seo.md.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, process.env.DIST || 'dist')
const API = (process.env.PRERENDER_API || 'https://eventlaya.com').replace(/\/$/, '')
const CHROME = process.env.CHROME || '/usr/bin/google-chrome'
const STRICT = process.env.PRERENDER_STRICT === '1'
const OUT = join(DIST, 'prerender')

const STATIC_ROUTES = ['/', '/events', '/marketplace', '/pricing', '/privacy', '/terms', '/community-guidelines', '/delete-account', '/contact', '/blog']

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.txt': 'text/plain',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[prerender]', ...a)

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`[prerender] ${DIST}/index.html not found: run "npm run build" first`)
  process.exit(1)
}
rmSync(OUT, { recursive: true, force: true })
const shell = readFileSync(join(DIST, 'index.html'))

/* ---------------- static server for dist/ + proxy for /api and /media ---------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
    try {
      const headers = { ...req.headers }
      delete headers.host
      delete headers['accept-encoding']
      delete headers.connection
      const chunks = []
      for await (const c of req) chunks.push(c)
      const upstream = await fetch(API + req.url, {
        method: req.method,
        headers: { ...headers, 'user-agent': 'EventlayaPrerender/1.0' },
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: 'manual',
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      const out = {}
      upstream.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v
      })
      res.writeHead(upstream.status, out)
      res.end(body)
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end(String(e))
    }
    return
  }
  const file = normalize(join(DIST, decodeURIComponent(url.pathname)))
  if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } else {
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(shell)
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

/* ---------------- routes ---------------- */

async function blogRoutes() {
  const out = []
  for (let page = 1; page < 50; page++) {
    let data
    try {
      const res = await fetch(`${API}/api/blog/posts/?page=${page}`, { headers: { 'user-agent': 'EventlayaPrerender/1.0' } })
      if (!res.ok) {
        log(`blog list: HTTP ${res.status} (blog off or not deployed yet) — skipping posts`)
        return out
      }
      data = await res.json()
    } catch (e) {
      log(`blog list unavailable: ${e.message}`)
      return out
    }
    out.push(...data.results.map((p) => `/blog/${p.slug}`))
    if (page >= data.pages) break
  }
  return out
}

const routes = process.env.PRERENDER_ROUTES
  ? process.env.PRERENDER_ROUTES.split(',').map((r) => r.trim()).filter(Boolean)
  : [...STATIC_ROUTES, ...(await blogRoutes())]

/* ---------------- Chrome via the DevTools protocol ---------------- */

const port = 9400 + Math.floor(Math.random() * 400)
const profile = mkdtempSync(join(tmpdir(), 'eventlaya-prerender-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

let target
for (let i = 0; i < 100 && !target; i++) {
  await sleep(150)
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
  } catch {
    /* not up yet */
  }
}
if (!target) {
  console.error('[prerender] Chrome did not start')
  chrome.kill()
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r, j) => {
  ws.addEventListener('open', r)
  ws.addEventListener('error', j)
})
let seq = 0
const pending = new Map()
const inflight = new Set()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  } else if (m.method === 'Network.requestWillBeSent') inflight.add(m.params.requestId)
  else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight.delete(m.params.requestId)
})
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq
    pending.set(id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'evaluate failed')
  return m.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Network.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 EventlayaPrerender/1.0',
})

const READY = `(() => {
  const root = document.getElementById('root')
  return document.documentElement.dataset.seoPath === location.pathname
    && !!root && root.childElementCount > 0
    && !root.querySelector('[role="status"], .animate-pulse')
})()`

// Final HTML: the live DOM marked as prerendered, without the "head is ready" flag.
const SNAPSHOT = `(() => {
  const html = document.documentElement.cloneNode(true)
  html.removeAttribute('data-seo-path')
  const root = html.querySelector('#root')
  root.setAttribute('data-prerendered', '')
  html.querySelectorAll('[data-sonner-toaster], [aria-live]:empty').forEach((el) => el.remove())
  // Never bake analytics into static pages (the app skips it for this user agent anyway; src/lib/analytics.ts)
  html.querySelectorAll('[data-analytics], script[src*="googletagmanager.com"], script[src*="cloudflareinsights.com"]').forEach((el) => el.remove())
  const robots = html.querySelector('meta[name="robots"]')
  return { html: '<!doctype html>\\n' + html.outerHTML, robots: robots ? robots.content : '', title: document.title,
           h1: (document.querySelector('#root h1') || {}).textContent || '', text: root.textContent.length }
})()`

const results = []
for (const route of routes) {
  const started = Date.now()
  try {
    inflight.clear()
    await send('Page.navigate', { url: ORIGIN + route })
    let ready = false
    for (let i = 0; i < 200; i++) {
      await sleep(100)
      if ((await evaluate(READY)) && inflight.size === 0) {
        ready = true
        break
      }
    }
    if (!ready) throw new Error('timed out waiting for the page and its metadata')
    // Bring every section into view once so entrance animations finish in their final state, then back to the top.
    await evaluate(`(async () => {
      const h = document.documentElement.scrollHeight
      for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)) }
      window.scrollTo(0, 0)
    })()`)
    await sleep(1200)
    const snap = await evaluate(SNAPSHOT)
    if (snap.robots.includes('noindex')) throw new Error(`page is noindex (${snap.title})`)
    if (snap.text < 200) throw new Error('page has almost no text')
    const file = join(OUT, route === '/' ? '' : route, 'index.html')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, snap.html)
    results.push({ route, ok: true })
    log(`${route} → ${file.replace(DIST + '/', '')} (${Math.round(snap.html.length / 1024)} KB, h1 “${snap.h1.trim().slice(0, 60)}”, ${Date.now() - started} ms)`)
  } catch (e) {
    results.push({ route, ok: false, error: e.message })
    log(`${route} FAILED: ${e.message}`)
  }
}

ws.close()
chrome.kill()
server.close()
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  /* Chrome may still hold files */
}
const failed = results.filter((r) => !r.ok)
log(`${results.length - failed.length}/${results.length} pages prerendered from ${API}`)
process.exit(failed.length && STRICT ? 1 : 0)
