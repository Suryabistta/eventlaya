import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { Plugin } from 'vite'

/** Preload the self-hosted body font (Poppins 400, latin) so text renders in the right font on first paint. */
function preloadMainFont(): Plugin {
  return {
    name: 'eventlaya-preload-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((f) => /poppins-400-latin-(?!ext-)[\w-]+\.woff2$/.test(f))
        if (!font) return html
        return html.replace('</title>', `</title>\n    <link rel="preload" href="/${font}" as="font" type="font/woff2" crossorigin>`)
      },
    },
  }
}

// Django backend for the dev proxy; override when port 8000 is taken, e.g. API_PORT=8010 npm run dev
const api = `127.0.0.1:${process.env.API_PORT || 8000}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preloadMainFont()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://${api}`,
        changeOrigin: true,
      },
      '/media': {
        target: `http://${api}`,
        changeOrigin: true,
      },
      // Team chat websocket (needs the ASGI server: `uvicorn config.asgi:application`; runserver doesn't serve it)
      '/ws': {
        target: `ws://${api}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
