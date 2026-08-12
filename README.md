# Framefield

A local image lab for generating and damaging abstract visuals. Start from a
generated noise field or an imported photo, stack destructive effects, export a
PNG sized for social. Nothing is uploaded — all processing happens in the tab.

## Running

```bash
bun install
bun run dev      # http://localhost:3000
bun run build    # -> dist/
bun run test     # vitest, node only — no browser, no jsdom
bun run lint
bun run format
```

## Architecture

The document is a **recipe**: a serializable description of a source, a canvas
size, and an ordered stack of effect layers. It holds no pixels, which is what
makes URL sharing, history, and deterministic remixing possible.

```
src/
  app/          store (zustand) + URL sync — UI state only
  renderer/     pure pixel code, no React
    buffer.ts   Float32 linear-light PixelBuffer, sRGB transfer, blur
    noise.ts    gradient noise, fBm, ridged, domain warp, curl, LIC
    masks.ts    Bayer + void-and-cluster blue-noise threshold masks
    glyphAtlas.ts  rasterizes a ramp and measures each glyph's ink
    presets.ts  curated recipes, rendered live as thumbnails
    generators/ field source (fBm / warp / ridge / flow / cells / moiré /
                ramp + SDF shapes), with pan and rotate placement
    effects/    levels, posterize, gradient-map, pixelate, dither, halftone,
                ascii, pixel-sort, contour, focus, transform, displace,
                channel-drift, bloom, grain
  ui/           the instrument shell
scripts/        static bundle assembly for deploy
```

Three rules keep this maintainable:

- **React owns UI state, the renderer owns pixels.** Nothing in the store is a
  buffer or a canvas. `renderRecipe()` is a pure function of its inputs and can
  move into a worker without touching a component.
- **Effect params are authored in export-space pixels.** Every spatial value is
  multiplied by the render scale, so a 54% preview is a faithful miniature of
  the export rather than a differently-quantized image.
- **Pixels live in Float32 linear light between the source and the encode.**
  Light adds linearly and sRGB values do not, so blur, opacity crossfades, and
  dither thresholds are all wrong in 8-bit sRGB — the last of those visibly so.
  Blend modes and posterize levels hop into perceptual space deliberately,
  because those are borrowed controls with borrowed expectations.

Canvas is touched in exactly two places — decoding an imported bitmap, and
rasterizing glyphs for ASCII. Everything else is procedural (analytic SDFs, no
rasterization), so the renderer is testable in node and resolution-independent
by construction.

## ASCII ramps

The ramp is ordered by **measured** ink coverage, not by how the string was
typed. That is not pedantry: in the default monospace stack, `-` measures
lighter than `:` and `%` lighter than `#`, both the reverse of the conventional
` .:-=+*#%@`. Rasterizing each glyph at the current cell size and sorting by
coverage means the ordering is right for the font actually in use — and it
means an arbitrary custom ramp works without the user having to sort it.

Premade: classic, blocks, shades, minimal, dots, binary, and a 68-character
terminal ramp. Custom accepts any string of two or more characters, including
multi-byte ones (block and braille glyphs count correctly — `[...str]`, not
`.length`).

Edge awareness substitutes `- / | \` where the local gradient is strong, which
is what gives shapes contours instead of an even wash of tone.

Each effect declares its params as a spec list; the controls panel, the
defaults, and the URL sanitizer all read from that one declaration.

Layers composite: a pass runs on the buffer it receives, then the result is
blended back over that input at the layer's opacity and blend mode. `opacity:
0.9` on a dither layer means 90% dithered, not 90% opaque.

## Tone masks

Every layer carries a `mask` — a luma band with a soft edge — that restricts
where it applies. "Dither the shadows, leave the highlights clean" is not
something opacity can express, since opacity is uniform across the frame.

The band is measured on the layer's **input**, not its output, so masks compose
down the stack: each one reads whatever the layers beneath it produced. The
identity is `{ low: 0, high: 1, softness: 0 }`, which short-circuits to the
unmasked fast path, and recipes written before the field existed decode to it.

## Deploying

Cloudflare Pages, static:

- Build command: `bun run build`
- Output directory: `dist`
- Pages project: `framefield`
- Production URL: `https://framefield.pages.dev`
- Custom domain: `https://framefield.alex-boulanger.dev`

`vite build` emits the prerendered SPA shell into `.output/public`;
`scripts/static-bundle.mjs` lifts it into `dist` and adds the SPA `_redirects`
fallback. Nitro's own static presets (`static`, `cloudflare-pages-static`) are
the natural home for this, but in the current nitro 3 beta they still attempt a
server bundle and fail on Start's SPA html input — collapse the script into a
preset once that lands.

Deploys run from GitHub Actions on pushes to `main`. The `prod` GitHub
environment must define `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
The workflow owns the Pages project and deployment; the custom domain
association is configured in Cloudflare Pages, not in this repo.

## Tests

`bun run test` — 419 tests, node only. No browser, no jsdom, no canvas mock: the
renderer is pure functions over `Float32Array`, and `src/test/setup.ts` provides
a small `ImageData` stand-in for the two conversion functions that need it.
`renderRecipe` accepts a pre-rendered source, so even the full layer pipeline is
testable without a canvas.

Several of these exist because they caught real bugs:

- **`bayerMatrix` is a permutation of 0..n²-1.** The original recursive
  construction wrote two of four expanded cells to the same index — 27 of 64
  entries were `undefined`. It shipped, typechecked, and linted; only the
  visible vertical banding gave it away.
- **Channel offsets scale with sign.** `scaled()` floors to `min`, which turned
  every negative offset into 0, so the default `blueX: -12` did nothing.
  Signed values now use `scaledOffset`.
- **Params never hold `-0`.** `Number((-0.001).toFixed(2))` is `-0`, and
  `JSON.stringify(-0)` is `"0"` — so a remixed recipe failed to round-trip about
  one run in four. `roundParam` normalizes it.
- **Bayer thresholds sit at cell centres.** With a threshold of exactly 0 in the
  matrix, one cell per tile stayed unlit even for pure white, so a solid white
  area came out at 98.4%.
- **LIC samples its texture at pixel scale.** It used to sample in field units,
  where the whole image spans a couple of units — a dozen enormous blocks, and
  step count made no difference to the output at all.
- **Blue noise clumps less than white noise.** The first implementation
  high-passed white noise and ranked the residual, which sounds right and does
  essentially nothing: local density variance came out within 2% of plain white
  noise. Void-and-cluster replaced it.
- **Every preset renders to something worth looking at.** Not blank, not blown
  out, and with real tonal range. This caught two things at once: presets
  silently losing their palette to the effect defaults, and Low-res collapsing
  to a single flat colour at thumbnail size because a 12px pixelate cell is a
  quarter of a 52px thumbnail. Thumbnails now render as true miniatures — full
  canvas, scaled down — which is what the export-space param convention is for.

The scale-fidelity block in `renderRecipe.test.ts` pins the decision the param
model rests on, and includes a sensitivity check that fails if scaling ever
stops being applied.

One earned its place by _not_ catching a bug:

- **Pixel sort defaults to sorting downward.** The direction default moved from
  `'0'` to `'90'`, and six tests that built their params from
  `defaultParams(PIXEL_SORT_PARAMS)` and then asserted on rows kept asserting
  against single-row buffers — where a vertical sort is a no-op. They did not
  fail loudly at first; they became vacant. The lesson is that a test inheriting
  a default is only testing whatever that default happens to be, so tests now
  state the axis they need and one test pins the default itself. The spec
  default and the runtime fallback are the same constant for the same reason —
  they were two literals, and only one of them followed the change.

## Status

Milestones 1–2 are done, and the model has been rebuilt twice since: the
generator and colour pipeline around continuous-tone fields in linear light, and
the document around a unified layer stack where generators, imports, and effects
are peers rather than a privileged source followed by effects
(`.scratch/unified-layer-stack-v2/spec.md`).

Shipped: fifteen effects — levels, posterize, gradient map, pixelate, dither,
halftone, ASCII, pixel sort, contour, blur/sharpen, transform, displace,
channel drift, bloom, grain — plus per-layer opacity, blend modes, **tone and
shape masks**, layer locks, drag-to-reorder, image import, a live variation
grid, curated and saved presets, undo/redo, remix and randomize-FX, share URLs,
PNG export at size presets, and the Web Worker render path.

Two masks per layer, and they multiply. The tone mask asks _which tones_; the
shape mask asks _which part of the frame_, as a linear or radial field banded
by the same `low`/`high`/`softness` controls — so a band in the middle of a
linear field is a soft stripe, and one at the top of a radial field is a ring.
"Dither the shadows, but only along the bottom edge" needs both.

### Rendering

Rendering happens in a worker. The preview climbs a ladder of four geometric
resolutions rather than jumping to the final one, so a cold stack shows a blurry
picture in tens of milliseconds instead of a blank canvas for seconds — about
four percent more total work for a first frame roughly an order of magnitude
sooner. Two budgets in `ui/previewScale.ts` set the ends of that ladder:
`SYNC_PREVIEW_PIXEL_BUDGET` (420k) for the main-thread fallback and
`WORKER_PREVIEW_PIXEL_BUDGET` (4M) for the worker.

Two workers, for one reason: rendering is synchronous, so terminating a worker
is the only way to abandon a pass the user has already invalidated. A persistent
worker owns the cheap rungs and keeps its checkpoint cache warm through a drag;
a disposable one takes the expensive rungs and is thrown away mid-render when
the recipe changes.

The checkpoint cache resumes from the deepest unchanged layer, so editing the
top of a stack skips the generators _and_ the effects below it.

### Cost

Measured in node on an M-series laptop, warmed, single-threaded — the worker
moves this work off the main thread but does not make it faster.

Generator, by field:

| field | preview 580×725 | export 1080×1350 |
| ----- | --------------- | ---------------- |
| ramp  | 51ms            | 170ms            |
| fBm   | 117ms           | 310ms            |
| ridge | 116ms           | 293ms            |
| warp  | 212ms           | 766ms            |
| flow  | 114ms           | 349ms            |

Flow used to be by far the most expensive field at 494ms / 1692ms. Halving the
LIC plane (`FLOW_PLANE_SCALE`) is an eightfold saving — a quarter of the pixels
and half the steps across each — and it now costs about what fBm does. Three
earlier optimizations had already brought it down from 6.2s / 22s: baking the
curl field onto a grid instead of evaluating four `fbm` per step, a gradient
lookup table instead of `cos`/`sin` per lattice corner, and reduced octaves on
the warp displacement lookups.

Whole presets, cold, at preview scale: Terminal 79ms, Engrave 103ms, Shred
117ms, Silk 183ms, Newsprint 244ms, Low-res 258ms, Marble 304ms, Riso 317ms,
Drip 366ms.

Sources are memoized behind the checkpoint cache, so these are paid on source
edits and first paint, not on effect-slider drags.

> `bench.test.ts` at the repo root is **not** run by `bun run test` — the vitest
> include is `src/**/*.test.ts` — and it does not measure what its labels claim:
> `withLayers()` replaces the layer list wholesale, so its "source only" stacks
> contain no generator, and its per-effect timings resume from a checkpoint that
> already covers the whole stack. The numbers above were measured directly
> against `renderField` and `renderRecipe`. Fix or delete it before trusting it.

### Next

`.scratch/post-mvp-depth/spec.md` records the reviewed plan: generator range
(cellular and interference fields, symmetry), effect range (a Transform effect,
gradient map, contour), and instrument UX (variation grid, locks, zoom, share
link).
