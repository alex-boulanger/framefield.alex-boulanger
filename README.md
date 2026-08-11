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
    generators/ field source (fBm / warp / ridge / flow / ramp + SDF shapes)
    effects/    levels, posterize, pixelate, dither, halftone, ascii,
                pixel-sort, displace, channel-drift, bloom, grain
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

`bun run test` — 370 tests, node only. No browser, no jsdom, no canvas mock: the
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

## Status

Milestones 1–2 are done: generated source, recipe model, layer stack with
reorder/toggle/duplicate/delete, posterize + dither + channel drift, image
import, PNG export at size presets, and recipe URLs. The generator and the
colour pipeline have since been rebuilt around continuous-tone fields in linear
light.

Generator cost, measured at preview (580×725) and export (1080×1350):

| field | preview | export |
| ----- | ------- | ------ |
| ramp  | 34ms    | 101ms  |
| fBm   | 88ms    | 299ms  |
| ridge | 88ms    | 314ms  |
| warp  | 230ms   | 865ms  |
| flow  | 494ms   | 1692ms |

The source is memoized, so these are paid on source edits and first paint, not
on effect-slider drags (~40ms). Three optimizations got flow down from 6.2s /
22s: baking the curl field onto a grid instead of evaluating four `fbm` per
step, a gradient lookup table instead of `cos`/`sin` per lattice corner, and
reduced octaves on the warp displacement lookups.

Dither cost at export (1080×1350): Bayer 55ms, blue 52ms, Floyd–Steinberg 83ms,
Jarvis/Stucki ~115ms, Atkinson 127ms. The blue-noise mask takes 46ms to build,
once per session.

Not yet built: ASCII, remix preset strip, history, halftone, pixel sort, and the
Web Worker render path. Rendering is currently synchronous — the preview is
capped to a pixel budget (`PREVIEW_PIXEL_BUDGET` in `ui/CanvasViewport.tsx`) to
keep slider drags responsive, and that cap is what the worker will lift.
