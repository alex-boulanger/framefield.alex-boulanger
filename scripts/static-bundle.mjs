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

/**
 * Deliberately no `/* -> /index.html 200` catch-all.
 *
 * It reads as harmless future-proofing for client-side routing, but it also
 * matches `/assets/<hashed>.js`. When a chunk is momentarily unavailable — a
 * deploy still propagating is enough — the fallback answers that URL with the
 * shell and a **200**, so the browser caches HTML under the script's name and
 * then refuses to execute it, reporting a MIME type error that names nothing
 * relevant. A plain 404 is never cached that way, which is why the same URL
 * loads fine in a private window.
 *
 * Cloudflare Pages cannot express the narrow fix: `_redirects` supports only
 * 200 rewrites and 3xx redirects, so `/assets/* -> 404` is not available. With
 * one route today the catch-all buys nothing, so it goes.
 *
 * Reintroducing client-side routing: scope the rule to the route prefixes that
 * exist (`/lab/*  /index.html  200`) rather than `/*`, so it can never shadow
 * a static asset.
 */

/**
 * The shell and the assets it names want opposite caching, and getting this
 * wrong has a nasty failure mode.
 *
 * Asset filenames carry a content hash, so a deploy renames every file that
 * changed and the old names stop existing. A browser holding a cached shell
 * therefore asks for chunks that are gone — and because the SPA fallback above
 * matches *any* unmatched path, the server answers those with `index.html` and
 * a 200. The browser then refuses to execute HTML as a module and reports a
 * MIME type error, which says nothing about the actual cause.
 *
 * So: the shell must be revalidated every time (it is the thing that names the
 * chunks), and the hashed assets can be kept forever (their name changes when
 * their content does). `no-cache` still stores the shell — it just forces a
 * conditional request, so the usual answer is a cheap 304.
 *
 * `immutable` on the assets is only sound because no rewrite can answer an
 * asset URL with something that is not that asset — see the note above about
 * the removed catch-all. Restoring a `/*` fallback would turn this line into a
 * year-long cache of the wrong bytes.
 */
await writeFile(
  resolve(target, '_headers'),
  [
    '/',
    '  Cache-Control: no-cache',
    '',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
)

console.log(`[static-bundle] dist ready → ${target}`)
