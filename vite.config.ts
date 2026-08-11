import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    // Nitro's own static presets (`static`, `cloudflare-pages-static`) still
    // try to build a server bundle in this beta and fail on Start's SPA html
    // input, so the default preset stays and `scripts/static-bundle.mjs`
    // assembles the deployable `dist` from the prerendered output instead.
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
    }),
    tailwindcss(),
    // ADR Decision 7: no backend. SPA mode prerenders one shell document and
    // everything after that runs client-side; the router stays for recipe URLs.
    tanstackStart({
      spa: { enabled: true, prerender: { outputPath: '/index.html' } },
    }),
    viteReact(),
  ],
})

export default config
