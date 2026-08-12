Status: draft — not started, sequencing not yet agreed

# Post-MVP Depth: Effects, Generator, and Instrument UX

## Problem Statement

The MVP is done and the foundations are unusually good. The recipe model, the
export-space param convention, the linear-light pipeline, the unified layer
stack, and the worker render ladder are all decisions that will still be right
in a year. Nothing in this spec proposes changing them.

What the MVP has run out of is **range** — the number of distinct, good images a
user can reach — and **grip** — how directly they can steer toward one. Three
symptoms:

- **The generator has one structural vocabulary.** Four of its five fields
  (`fbm`, `warp`, `ridged`, `flow`) are the same gradient-noise primitive under
  different post-processing, so they share a family resemblance: soft, cloudy,
  isotropic. The fifth is a linear ramp. There is no cellular structure, no
  periodic structure, no symmetry. Two fields that look genuinely unrelated is
  worth more than four that look like siblings.
- **The effect registry is 11 deep but narrow in one axis.** Every effect is a
  per-pixel or per-cell _tone_ operation. Not one of them moves geometry
  globally — no rotation, mirror, tile, or kaleidoscope. That absence caps
  composition harder than any missing filter, because it is the only class of
  operation that changes what the picture _is_ rather than how it is rendered.
- **Discovery is a slot machine.** Remix rerolls the whole stack, blind, one
  result at a time, with no way to keep the part that worked. The user's only
  tools for converging on a good image are undo and luck.

There is also a small pile of concrete defects, listed below, that should be
cleared before anything is built on top.

## What I verified

Measured against the repo at `4b36045`, not assumed:

- **`bun run test`: 6 failing, 407 passing.** All six are in
  `pixelSort.test.ts`. Commit `389cff1` ("feat: improve perfs") changed the
  pixel-sort `rotation` default from `'0'` to `'90'`; the tests build params
  from `defaultParams(PIXEL_SORT_PARAMS)` and then assert horizontal behaviour
  on single-row buffers, where a vertical sort is a no-op by construction. The
  _code_ is right and the _product default_ is a deliberate change — the tests
  are stale. `applyPixelSort` still falls back to `'0'` internally
  (`str(params, 'rotation', '0')`), which now disagrees with its own spec
  default; that divergence is what let this land quietly.
- **A single slider drag can erase the entire undo history.** `setLayerParam`
  calls `pushHistory` unconditionally (`store.ts:295`), the range input fires on
  every `input` event (`controls.tsx:57`), and `HISTORY_LIMIT` is 80
  (`store.ts:79`). Dragging one 0..1 slider at `step: 0.01` emits up to 100
  entries, evicting everything before it. Undo after a drag steps back one
  hundredth of a slider at a time, and the state the user actually wants is
  gone.
- **Saving a preset can fail silently.** `saveLocalSnapshots` swallows the
  quota exception by design (`localSnapshots.ts:69`) and returns void, so
  `PresetStrip` clears the name field and renders the snapshot from React state
  as though it persisted. It is gone on reload with nothing having said so.
- **Share URLs get long.** Base64url of the raw JSON, no compression
  (`recipe.ts:426`). Measured: 3 layers → 1.5 KB, 8 layers → 3.8 KB, 14 layers
  → 6.5 KB. Past ~2 KB, links start getting truncated or rejected by messaging
  apps and link unfurlers. `CompressionStream('deflate-raw')` is available in
  every browser that can run this app and would cut it roughly fourfold.
- **`.ff-label` fails WCAG AA.** `--color-faint` `#5a5a5a` on `--color-shell`
  `#0d0d0d` is **2.8:1** at 10px. It is the most-repeated text in the UI — every
  section heading and every control label. (`.ff-value`, `#8a8a8a`, is 5.6:1 and
  fine. This is one token, not a palette-wide problem.)
- **The README's Status section is stale.** It lists ASCII, halftone, pixel
  sort, the remix preset strip, history, and the Web Worker path as "not yet
  built". All six shipped.

## Solution

Four workstreams. **W0 first and alone** — it is small, and the rest is easier
to trust on a green suite. W1 and W2 are independent of each other and can be
built in either order or in parallel. **W3 carries the most user-visible value
per unit of work** and should not be sequenced last by default just because it
is listed last.

Sizes are relative (S / M / L) and reflect how much already exists in the repo,
not clock time.

---

### W0 — Clear the defects

| #   | Item                                                                                                                                                                                                                                                             | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0.1 | Update `pixelSort.test.ts` to pass `rotation: '0'` explicitly where it asserts horizontal behaviour; keep the four-rotation tests as they are. Align the internal fallback in `applyPixelSort` with the spec default so the two cannot drift again.              | S    |
| 0.2 | Coalesce history. See design note below.                                                                                                                                                                                                                         | S    |
| 0.3 | Make `saveLocalSnapshots` return a boolean and surface a failure in `PresetStrip` instead of clearing the field.                                                                                                                                                 | S    |
| 0.4 | Rewrite the README Status section.                                                                                                                                                                                                                               | S    |
| 0.5 | Lift `--color-faint` until `.ff-label` clears 4.5:1 on `--color-shell` (around `#7a7a7a`). Check it does not flatten the `--color-muted` / `--color-faint` distinction; if it does, keep faint for non-text uses (icons, rules) and give labels their own token. | S    |

**Design note — history coalescing.** The rule that matches intent: consecutive
edits to _the same layer and the same param key_ within a short window collapse
into one entry. Keep a `lastEdit: { id, key, at } | null` on the store; in
`setLayerParam`, skip `pushHistory` when the incoming edit matches the last one
and is within ~500 ms, and clear `lastEdit` on every other action so a drag
followed by anything else is a clean boundary. This lives entirely in the store
and needs no component changes, which is why it is preferred to a
commit-on-pointer-up in `controls.tsx` — that would have to be repeated in every
control and would miss keyboard-driven slider changes.

---

### W1 — Generator range

The goal is fields that are _structurally_ unrelated, not more knobs on the
existing one.

**1.1 — Cellular / Worley field (L, highest value).** The single biggest gap.
Gradient noise gives blobs; cellular noise gives cells, plates, cracks, and
shatter — an entirely different image family from the same slider. Worth
exposing three distance metrics as one `cellMode` select, because they look
nothing alike: `F1` (cell interiors, stone), `F2 - F1` (cracked edges, the
classic Voronoi look), and `F1` on a Chebyshev metric (rectilinear plates).
Implement in `noise.ts` alongside `fbm`/`ridged` with the same
`(x, y, seed, options)` shape, so it inherits octave stacking for free. Cost is
the same order as `fbm` if the point lookup is a hashed 3×3 neighbourhood.

**1.2 — Interference / moiré field (M).** Sums of two or three rotated sine
gratings. Cheap — no lattice, no octaves, a handful of trig ops per pixel — and
it is the one field that produces _hard periodic_ structure, which is exactly
what the halftone, dither, and pixelate effects react most interestingly to. It
is also the strongest print-adjacent look the generator cannot currently reach.

**1.3 — Symmetry, as a generator param (M).** `mirrorX`, `mirrorY`, and a
`kaleido` segment count, applied by folding the sample coordinate before the
field is evaluated. Under 20 lines, applies to _every_ field including the two
new ones, and turns noise into composition. This is the highest
value-per-line item in W1.

**1.4 — Ramp gets a shape and an angle (S).** The `gradient` field is currently
one hard-coded diagonal (`field.ts:518`). Add `rampShape`
(`linear` / `radial` / `conic`) and `rampAngle`. Radial and conic ramps under a
posterize are a strong, immediately legible look, and the field is the cheapest
one in the generator.

**1.5 — Palette stop positions (M).** `buildRamp` (`field.ts:216`) spaces stops
evenly and always interpolates smoothly. Two additions change the output
dramatically: a per-stop position (so the accent can sit at 0.8 instead of the
midpoint) and a `hardStops` toggle (nearest-stop instead of interpolated, which
gives flat poster bands straight out of the generator). This touches the
`palette` param shape, so it needs a sanitizer path that decodes today's plain
`Array<string>` into evenly-spaced stops — the same migration pattern
`sanitizeRecipe` already uses for v1.

**1.6 — Shape kind control (S).** Shapes currently pick from
`['circle', 'box', 'ring', 'bar']` at random with no user control
(`field.ts:404`). Add a `shapeKind` select with the four kinds plus `mixed`
(today's behaviour, and the default, so nothing changes for existing recipes).

**Deliberately not in W1:** more octave/lacunarity/gain knobs. They expand the
parameter space without expanding the _image_ space, and they make remix worse
by widening the volume of mediocre results it samples from.

---

### W2 — Effect range

Ordered by value per unit of work. The first four are all small because the
renderer already contains the hard part.

**2.1 — Transform (M, highest value).** The missing class. One effect with
`mirrorX` / `mirrorY` / `rotate` (90° steps, free-angle later) / `tile` (an
integer grid repeat) / `kaleido` (wedge count). Every one of these is a
coordinate remap plus a bilinear sample, which `displace.ts` already does. This
is the only item in the whole spec that changes what compositions are reachable
rather than how they are rendered, and it composes with the tone mask, so
"kaleidoscope the shadows only" falls out for free.

**2.2 — Gradient map (S).** Tone → palette ramp, continuous. Posterize can map
to a palette but always quantizes, and its `levels` caps at 16
(`posterize.ts:33`), so a smooth palette remap is currently unreachable.
`rampAt` in `posterize.ts:74` is already the whole implementation; this is that
function without the quantization step, plus `blend` and `preserveLuma`
controls. Smallest real feature in the spec.

**2.3 — Blur / Sharpen (S).** `blur()` already exists in `buffer.ts:353` and is
used by the generator and by bloom, but there is no user-facing blur layer.
Unsharp mask is the same call with one subtract. With the tone mask this gives
selective softening, which is a genuine compositional tool and not just a
filter.

**2.4 — Contour / edge (M).** Sobel magnitude, thresholded into iso-lines. This
is the most on-brand effect Framefield does not have: continuous-tone fields
plus contour extraction is a topographic map, and it reads as _drawn_ rather
than filtered, which nothing else in the registry does. ASCII already computes a
local gradient for its edge substitution, so the sampling pattern is proven.
Controls: `mode` (contour bands / edge magnitude), `levels`, `thickness`,
`palette`.

**2.5 — Warp modes on the existing Displace effect (S).** `displace` offers
`noise` / `flow` / `radial` (`displace.ts:24`). Adding `wave`, `twist`, and
`polar` to that same select is three more branches in one switch and no new
effect, no new UI, no new registry entry. Best ratio in W2.

**2.6 — Directional streak (M).** Blur along the curl field rather than
isotropically — smear, drag, motion. `buildFlowField` and the LIC walk already
exist in `noise.ts` and are already tuned for cost; this is largely reassembly
of proven parts.

**2.7 — Border / vignette (S).** A paper margin, an inset rule, or a tonal
vignette. Trivial, and it matters more than it sounds for a tool whose output
is a social-sized PNG — a margin is what makes an image read as a _print_
rather than a screenshot of a texture.

**Deliberately not in W2:** a slice/datamosh glitch effect. It overlaps heavily
with what channel-drift's jitter bands and pixel-sort already produce together,
and the marginal look is small next to Transform or Contour.

---

### W3 — Instrument UX

Highest user-visible value per unit of work of the four workstreams.

**3.1 — Variation grid (L, highest value).** Replace blind remix with six
candidate thumbnails rendered from the current recipe. Pick one to apply, or
reroll the sheet. This is _the_ discovery interaction for generative tools: it
turns a slot machine into a choice, and it makes every improvement in W1 and W2
legible instead of hypothetical. `PresetStrip` already proves the machinery —
live thumbnails from the real pipeline, deferred to idle. The one design
decision to settle first: render the sheet on the persistent worker or on the
main thread at idle? The main thread is what `PresetStrip` does today and is
simpler; six thumbnails of a `flow` stack may argue for the worker.

**3.2 — Locks (M).** Per-layer and per-palette lock toggles that remix and
randomize honour. Currently `randomizeFxStack` discards every effect layer
(`recipe.ts:258`), so there is no way to keep the one pass that was working and
reroll the rest. Locks are what turn remix from a coin flip into convergence,
and they pair directly with 3.1 — a locked layer means every tile in the
variation grid keeps it.

**3.3 — Share link (S).** The recipe is already mirrored into `?r=`
(`useRecipeUrl.ts`) and there is **no UI anywhere that says so**. The entire
share model is invisible. A "Copy link" button in the header with a copied
confirmation is nearly free. Bundle the `deflate-raw` compression from the
findings above into this item — same feature, and it is what keeps the link
usable at 14 layers.

**3.4 — Zoom and 1:1 (M).** The viewport is fit-to-box only. For an app whose
entire value is dither stipple, halftone rosettes, and ASCII cells, being unable
to inspect actual pixels is a real limitation — the user cannot see the thing
they are tuning. Scroll-to-zoom, drag-to-pan, `1` for 100%, `0` to fit. Note the
interaction with the preview ladder: at >100% zoom the settled scale should be
driven by the _visible region_, not the whole canvas.

**3.5 — Compare (S).** Hold a key to show the bare source with the effect stack
bypassed. The stack already supports per-layer toggling, so this is a transient
render flag, not a new render path.

**3.6 — Export upgrades (M).** In rough value order: copy-to-clipboard; JPEG
and WebP with a quality slider; export-all-sizes (one click, every
`SIZE_PRESETS` entry, as a zip or sequential downloads); and progress plus
cancel during the render — the worker already reports `renderMs`, so a progress
channel is a message shape, not an architecture change.

**3.7 — Solo a layer (S).** View one layer's contribution in isolation.
Complements the existing eye toggle and costs almost nothing.

**3.8 — Keyboard map and a `?` overlay (S).** Today only `R`, `Cmd+Z`, and
`Cmd+Shift+Z` exist, and nothing announces them. Add export, compare, solo,
zoom, and variation-grid bindings, and one overlay that lists them.

**3.9 — Preset import / export (S).** Local snapshots are localStorage-only,
which means they do not survive a cleared browser and cannot be moved between
machines or shared. Download-as-JSON and drop-to-import, reusing
`sanitizeRecipe` for ingest.

---

## User Stories

1. As an artist, I want the test suite green, so that a regression is visible
   when it lands rather than six commits later.
2. As an artist, I want one slider drag to be one undo step, so that undo takes
   me back to the image I had rather than a hundredth of a slider.
3. As an artist, I want to know when a preset failed to save, so that I do not
   discover it on reload.
4. As an artist, I want a cellular field, so that I can make cracked, plated,
   and shattered structure and not only clouds.
5. As an artist, I want an interference field, so that the halftone and dither
   effects have hard periodic structure to react to.
6. As an artist, I want mirror and kaleidoscope symmetry on any field, so that
   noise becomes composition.
7. As an artist, I want radial and conic ramps at an angle I choose, so that the
   cheapest field is not limited to one fixed diagonal.
8. As an artist, I want to place palette stops and make them hard, so that the
   colourway is a design choice rather than an even blend.
9. As an artist, I want to transform the image — mirror, rotate, tile,
   kaleidoscope — so that I can change the composition and not only its surface.
10. As an artist, I want a continuous gradient map, so that I can recolour
    without being forced to posterize.
11. As an artist, I want blur and sharpen as layers, so that I can soften or
    bite selectively through a tone mask.
12. As an artist, I want contour lines, so that a field can read as a drawn
    topographic map.
13. As an artist, I want wave, twist, and polar warps, so that displacement is
    not limited to noise and radial.
14. As an artist, I want a border or vignette, so that the export reads as a
    print rather than a crop of a texture.
15. As an artist, I want to see six variations at once, so that I can choose
    instead of rerolling blind.
16. As an artist, I want to lock a layer or a palette before remixing, so that I
    can converge on an image rather than restart every time.
17. As an artist, I want a copy-link button, so that I can discover that sharing
    exists at all.
18. As an artist, I want links that stay short with a deep stack, so that they
    survive being pasted into a message.
19. As an artist, I want to zoom to 100%, so that I can see the stipple I am
    tuning.
20. As an artist, I want to compare against the untreated source, so that I can
    judge what the stack is actually doing.
21. As an artist, I want to solo a layer, so that I can see one pass in
    isolation.
22. As an artist, I want clipboard copy and multiple formats, so that export
    fits how the image is actually used.
23. As an artist, I want export progress and a cancel, so that a slow render is
    not an unresponsive button.
24. As an artist, I want to export and import my presets, so that they survive a
    cleared browser and can move between machines.
25. As an artist, I want a keyboard map, so that the shortcuts that exist are
    findable.
26. As a low-vision user, I want control labels to meet contrast minimums, so
    that the most-repeated text in the UI is legible.

## Non-Goals

- **No change to the recipe model, the layer stack, the export-space param
  convention, or the linear-light pipeline.** They are right. Everything here
  is additive within them.
- **No GPU renderer.** WebGL or WebGPU would beat the 1.7 s `flow` export, but
  it would cost the node-testable pure-function property that the entire test
  suite rests on, and it would fork the renderer in two. Not a fair trade at
  this stage.
- **No multi-worker tiled rendering.** `renderField` is trivially bandable and
  it is a tempting 4× on generator cost, but the preview ladder already hides
  most of that latency, and effects with sequential dependencies (error
  diffusion, pixel sort) cannot be banded — so it would speed up one stage while
  complicating the scheduler for all of them. Revisit if generator cost becomes
  the top complaint after W1 adds two more fields.
- **No text layers.** Already scoped and deferred in
  `unified-layer-stack-v2/spec.md`; the font-in-worker problem recorded there is
  unchanged.
- **No accounts, no cloud, no server-side render.** Nothing leaves the tab.

## Risks

- **W1 grows remix's mediocre volume.** Every field added is more space for the
  randomizer to sample badly, and `randomizeField` (`field.ts:578`) keeps ranges
  conservative precisely to avoid this. Two new fields need their own tuned
  ranges in the randomizer, and the "every preset renders to something worth
  looking at" test in `presets.test.ts` should be extended to cover randomized
  output for the new fields — not just curated presets. **This is the risk most
  likely to be forgotten**, because the new fields will be evaluated by hand at
  good settings, not at the settings remix will actually pick.
- **Transform breaks the effect contract's cheapest assumption.** Every effect
  in the registry today maps a pixel to itself or to a nearby neighbourhood.
  Transform samples arbitrarily far away, so it needs a source copy rather than
  in-place mutation, and `EffectDefinition.apply`'s "mutates and returns
  `buffer`" comment (`effects/index.ts:28`) will need to be honest about that.
  Check that the checkpoint cache in `CanvasViewport` still holds — it should,
  since it keys on layer identity, not on locality.
- **Palette stop positions are a param-shape migration.** Today's `palette` is
  `Array<string>` and it appears in six effects plus the generator, in every
  preset, and in every share URL and saved snapshot in the wild. The decode path
  must accept the plain array form indefinitely. Getting this wrong silently
  recolours saved work, which is the same class of failure as the preset-palette
  bug already recorded in the README.
- **The variation grid is a render-cost cliff.** Six `flow` stacks at thumbnail
  size, re-rendered on every reroll, against a preview ladder already competing
  for the same cores. Measure before committing to six tiles; four may be the
  honest number, and the worker may be mandatory rather than optional.
- **Zoom interacts with the preview ladder.** `previewRequestScales` budgets
  against the whole canvas. At 400% zoom the correct behaviour is to spend the
  budget on the visible region only, which means the ladder needs a viewport
  rect, not just a box size. This is the one W3 item that reaches into rendering
  rather than sitting on top of it.
- **`deflate-raw` needs a fallback.** `CompressionStream` is async, and
  `encodeRecipe` is synchronous and called from a debounced effect. Either make
  the URL write async or keep the uncompressed form as a decodable fallback —
  the decoder must handle both encodings regardless, since links already in
  existence are uncompressed.

## Suggested sequencing

1. **W0** — small, unblocks trust in everything after it.
2. **W3.3 (share link + compression), W3.5 (compare), W3.7 (solo), W3.8
   (shortcuts)** — the cheap UX wins. Days of work, disproportionate effect on
   how finished the tool feels.
3. **W2.2, W2.3, W2.5, W2.7** — the four small effects, all mostly assembly of
   existing renderer code.
4. **W2.1 (Transform)** — the one that changes what is reachable.
5. **W1.3 (symmetry), W1.4 (ramp), W1.6 (shape kind)** — small generator wins.
6. **W3.1 + W3.2 (variation grid + locks)** — build together; each is worth
   much less alone, and by this point there is real range for them to explore.
7. **W1.1 (cellular), W1.2 (interference)** — the large generator work, best
   done once the variation grid exists to evaluate them at scale.
8. **W2.4 (contour), W2.6 (streak), W1.5 (palette stops), W3.4 (zoom), W3.6
   (export), W3.9 (preset I/O)** — the remainder, reorderable by taste.

## Open questions

1. **Variation grid: worker or main-thread idle?** Depends on measured cost of
   six thumbnails against a warm preview. Measure before building 3.1.
2. **How many variation tiles?** Six is the conventional answer; four may be
   what the render budget actually supports.
3. **Should locks live on the layer (`Layer.locked`) or in UI state?** On the
   layer means locks travel in share links and saved presets, which seems right
   but is a recipe schema addition — cheap now, awkward later.
4. **Does Transform belong in the effect registry at all,** or is it a distinct
   layer kind? Registry is simpler and gets the tone mask for free; the
   arbitrary-sampling contract break is the argument against.
