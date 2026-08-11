import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Assembles the deployable static bundle.
 *
 * SPA mode prerenders one shell document and emits it plus the client assets
 * into `.output/public`. Nitro's own static presets would place this in `dist`
 * directly, but in the current nitro beta they still attempt a server bundle
 * and fail on the SPA html input — so the default preset builds, and this step
 * lifts the static half out of it.
 *
 * Revisit once nitro 3 is stable: this whole file should collapse into
 * `preset: 'cloudflare-pages-static'`.
 */

const root = process.cwd()
const source = resolve(root, '.output/public')
const target = resolve(root, 'dist')

try {
  await access(source)
} catch {
  console.error(
    `[static-bundle] ${source} is missing — run \`vite build\` before this step.`,
  )
  process.exit(1)
}

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

// SPA fallback: every path serves the shell, which then routes client-side.
// Harmless today (the app is one route) and correct the moment a second exists.
await writeFile(resolve(target, '_redirects'), '/*    /index.html   200\n')

console.log(`[static-bundle] dist ready → ${target}`)
