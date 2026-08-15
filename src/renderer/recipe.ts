import { EFFECTS, EFFECT_ORDER, effectDefaults } from './effects'
import {
  FIELD_PARAMS,
  FIELD_DEFAULTS,
  randomizeField,
} from './generators/field'
import { IMAGE_DEFAULTS, IMAGE_PARAMS } from './layers/image'
import { TEXT_DEFAULTS, TEXT_PARAMS } from './layers/text'
import { PALETTES } from './palettes'
import { createRng, randomSeed } from './rng'
import { roundParam, sanitizeParams } from './params'
import { BLEND_MODES, NO_MASK, NO_SHAPE, isSourceLayer } from './types'
import type {
  BlendMode,
  CanvasSize,
  EffectLayer,
  EffectType,
  GeneratorLayer,
  ImageLayer,
  Layer,
  LayerBase,
  Recipe,
  ShapeMask,
  ToneMask,
  TextLayer,
} from './types'

export interface SizePreset {
  id: string
  label: string
  aspect: string
  width: number
  height: number
}

export const SIZE_PRESETS: Array<SizePreset> = [
  { id: 'square', label: 'Square', aspect: '1:1', width: 1080, height: 1080 },
  {
    id: 'portrait',
    label: 'Portrait',
    aspect: '4:5',
    width: 1080,
    height: 1350,
  },
  { id: 'story', label: 'Story', aspect: '9:16', width: 1080, height: 1920 },
  { id: 'wide', label: 'Wide', aspect: '16:9', width: 1920, height: 1080 },
  { id: 'social', label: 'Social', aspect: '1.91:1', width: 1200, height: 630 },
]

let layerCounter = 0

export function createLayerId(): string {
  layerCounter += 1
  return `layer_${Date.now().toString(36)}${layerCounter.toString(36)}`
}

/** The controls every layer carries, whatever it renders. */
function layerBase(): Omit<LayerBase, 'params'> {
  return {
    id: createLayerId(),
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    mask: { ...NO_MASK },
    shape: { ...NO_SHAPE },
  }
}

export function createEffectLayer(type: EffectType): EffectLayer {
  return { ...layerBase(), kind: 'effect', type, params: effectDefaults(type) }
}

export function createGeneratorLayer(seed = randomSeed()): GeneratorLayer {
  return {
    ...layerBase(),
    kind: 'generator',
    generator: 'field',
    params: { ...FIELD_DEFAULTS(), seed },
  }
}

export function createImageLayer(asset: string, name: string): ImageLayer {
  return {
    ...layerBase(),
    kind: 'image',
    asset,
    name: name.trim().slice(0, 48) || undefined,
    params: IMAGE_DEFAULTS(),
  }
}

export function createTextLayer(): TextLayer {
  return {
    ...layerBase(),
    kind: 'text',
    name: '2D Text',
    params: TEXT_DEFAULTS(),
  }
}

/* -------------------------------------------------------------------------
 * Layer names
 * ---------------------------------------------------------------------- */

/** What the layer *is*, ignoring any name the user gave it. */
export function layerTypeLabel(layer: Layer): string {
  if (layer.kind === 'effect') return EFFECTS[layer.type].label
  if (layer.kind === 'image') return 'Image'
  if (layer.kind === 'text') return '2D Text'
  return 'Field'
}

/**
 * A name with any trailing counter removed: `Dither 2` → `Dither`.
 *
 * Duplicating a duplicate has to count up, not nest. Without this,
 * `Dither` → `Dither 2` → `Dither 2 2` → `Dither 2 2 2`, which is how a
 * three-deep stack ends up unreadable.
 */
export function baseLayerName(name: string): string {
  return name.replace(/ \d+$/, '')
}

/**
 * `base`, or `base 2`, `base 3`… until it is not already taken.
 *
 * Terminates because `taken` is finite: some suffix is always free.
 */
export function uniqueLayerName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base

  let n = 2
  while (used.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/**
 * Give every unnamed layer a unique, type-derived name.
 *
 * Every layer carries a name from the moment it exists, which does two things.
 * Three dithers in a stack stop being three identical rows. And because the
 * stack row prints the *type* underneath the name, a layer that always has a
 * name always has something in that second line — which is what turns it from
 * blank reserved space into the row's subtitle.
 *
 * Layers that already have a name are left exactly as they are: this runs over
 * recipes that may contain the user's own labels.
 */
export function withGeneratedNames(layers: Array<Layer>): Array<Layer> {
  const taken = new Set(
    layers.flatMap((layer) => (layer.name ? [layer.name] : [])),
  )

  return layers.map((layer) => {
    if (layer.name) return layer
    const name = uniqueLayerName(layerTypeLabel(layer), taken)
    taken.add(name)
    return { ...layer, name }
  })
}

/** Fresh defaults for a layer, without disturbing what it renders. */
export function layerDefaults(layer: Layer): Layer['params'] {
  if (layer.kind === 'effect') return effectDefaults(layer.type)
  if (layer.kind === 'image') return IMAGE_DEFAULTS()
  if (layer.kind === 'text') return TEXT_DEFAULTS()
  // The seed is the layer's identity, not a setting — resetting the controls
  // should not silently reroll the image underneath them.
  return { ...FIELD_DEFAULTS(), seed: layer.params.seed }
}

/** Clamp an untrusted mask into a usable band. */
export function sanitizeMask(input: unknown): ToneMask {
  if (typeof input !== 'object' || input === null) return { ...NO_MASK }
  const raw = input as Record<string, unknown>

  const clamp = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : fallback

  const low = clamp(raw.low, 0)
  const high = clamp(raw.high, 1)

  return {
    // Swap rather than reject: a reversed band is a slip, not an attack.
    low: Math.min(low, high),
    high: Math.max(low, high),
    softness: clamp(raw.softness, 0),
  }
}

/** Clamp an untrusted shape mask. Anything unrecognized decodes to the identity. */
export function sanitizeShapeMask(input: unknown): ShapeMask {
  if (typeof input !== 'object' || input === null) return { ...NO_SHAPE }
  const raw = input as Record<string, unknown>

  const shape =
    raw.shape === 'linear' || raw.shape === 'radial' ? raw.shape : 'none'
  const clamp = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : fallback

  const low = clamp(raw.low, 0, 0, 1)
  const high = clamp(raw.high, 1, 0, 1)

  return {
    shape,
    // Wrapped rather than clamped: an angle is cyclic, so 400° is 40°.
    angle: ((clamp(raw.angle, 0, -3600, 3600) % 360) + 360) % 360,
    centerX: clamp(raw.centerX, 0, -0.5, 0.5),
    centerY: clamp(raw.centerY, 0, -0.5, 0.5),
    low: Math.min(low, high),
    high: Math.max(low, high),
    softness: clamp(raw.softness, 0, 0, 1),
  }
}

export const DEFAULT_CANVAS: CanvasSize = { width: 1080, height: 1350 }

/**
 * The seed the default document opens with.
 *
 * Fixed, not random, because this recipe is built at module scope and the app
 * is prerendered — a random seed here renders one value into the static HTML
 * and a different one on the client, which is a hydration mismatch. The seed is
 * visible in the inspector, so the mismatch is real and not theoretical.
 *
 * Randomness on open is applied after mount instead (`useRecipeUrl`), where it
 * cannot disagree with the prerendered markup.
 */
const DEFAULT_SEED = 'framefield'

/**
 * The document the app is built around before anything has opened.
 *
 * A real composition rather than a bare generator: the quality bar says first
 * load must show an interesting image with no input, and this is what the
 * static HTML is prerendered from.
 */
export function createDefaultRecipe(): Recipe {
  return {
    version: 2,
    canvas: { ...DEFAULT_CANVAS },
    background: DEFAULT_BACKGROUND,
    layers: withGeneratedNames([
      createGeneratorLayer(DEFAULT_SEED),
      createTextLayer(),
      {
        ...createEffectLayer('pixel-sort'),
        opacity: 0.85,
        params: {
          ...effectDefaults('pixel-sort'),
          rotation: '90',
          low: 0.02,
          high: 0.95,
          sortBy: 'saturation',
          maxRun: 240,
        },
      },
      { ...createEffectLayer('posterize'), opacity: 1 },
      {
        ...createEffectLayer('channel-drift'),
        opacity: 0.9,
        params: {
          ...effectDefaults('channel-drift'),
          redX: 28,
          redY: -3,
          blueX: -32,
          blueY: 4,
          jitter: 22,
          jitterBands: 34,
          seed: DEFAULT_SEED,
        },
      },
    ]),
  }
}

/**
 * An empty document — the ground and nothing on it.
 *
 * Genuinely empty rather than "one bare generator": the stack panel has a
 * first-class empty state and an Add layer button right beneath it, so a blank
 * canvas is a place to start composing rather than a broken-looking one. The
 * canvas size carries over, because starting a new piece is not a reason to
 * forget the format the user chose.
 */
export function createBlankRecipe(canvas: CanvasSize = DEFAULT_CANVAS): Recipe {
  return {
    version: 2,
    canvas: { ...canvas },
    background: DEFAULT_BACKGROUND,
    layers: [],
  }
}

/**
 * A fresh random artwork, for opening the app on something worth looking at.
 *
 * Deliberately the same path the Remix button takes, so the two cannot drift
 * into producing different qualities of result — the conservative ranges in
 * `randomizeField` and `randomizeFxStack` are what keep both usable rather than
 * merely different.
 */
export function createRandomRecipe(
  canvas: CanvasSize = DEFAULT_CANVAS,
): Recipe {
  return remixRecipe({ ...createDefaultRecipe(), canvas: { ...canvas } })
}

export const DEFAULT_BACKGROUND = '#000000'

const FALLBACK_PALETTE = ['#050505', '#f5f5f5', '#0057ff']

/** The stack's colourway: the lowest generator's palette wins. */
export function paletteFromRecipe(recipe: Recipe): Array<string> {
  for (const layer of recipe.layers) {
    if (layer.kind !== 'generator') continue
    if (Array.isArray(layer.params.palette)) return layer.params.palette
  }
  return FALLBACK_PALETTE
}

/**
 * Pick a fresh but coherent stack. Ranges stay conservative on purpose — every
 * random stack should be usable, not merely different.
 */
export function randomizeFxStack(current: Recipe): Recipe {
  const seed = randomSeed()
  const rng = createRng(`${seed}:remix`)
  const palette = paletteFromRecipe(current)
  const hasText = current.layers.some((layer) => layer.kind === 'text')

  if (hasText) {
    const textFx: Array<EffectLayer> = []
    const sort = createEffectLayer('pixel-sort')
    sort.opacity = roundParam(rng.range(0.3, 0.6))
    sort.params = {
      ...sort.params,
      rotation: rng.pick(['0', '90', '180', '270']),
      low: 0,
      high: 1,
      sortBy: rng.pick(['luma', 'hue', 'saturation', 'red']),
      maxRun: rng.int(36, 150),
      reverse: rng.bool(0.45),
    }
    textFx.push(sort)

    const drift = createEffectLayer('channel-drift')
    drift.opacity = roundParam(rng.range(0.45, 0.75))
    drift.params = {
      ...drift.params,
      redX: rng.int(-28, 28),
      redY: rng.int(-7, 7),
      blueX: rng.int(-28, 28),
      blueY: rng.int(-7, 7),
      jitter: rng.int(4, 18),
      jitterBands: rng.int(8, 30),
      scanlines: rng.bool(0.35) ? roundParam(rng.range(0.05, 0.18)) : 0,
      seed,
    }
    textFx.push(drift)

    if (rng.bool(0.6)) {
      const bloom = createEffectLayer('bloom')
      bloom.opacity = roundParam(rng.range(0.22, 0.45))
      bloom.blendMode = rng.bool(0.65) ? 'screen' : 'normal'
      bloom.params = {
        ...bloom.params,
        threshold: roundParam(rng.range(0.45, 0.72)),
        amount: roundParam(rng.range(0.2, 0.65)),
        radius: rng.int(6, 24),
        palette: [rng.pick(palette)],
        tint: roundParam(rng.range(0.2, 0.75)),
      }
      textFx.push(bloom)
    }

    const kept = current.layers.filter(
      (layer) => isSourceLayer(layer) || layer.locked,
    )
    return { ...current, layers: withGeneratedNames([...kept, ...textFx]) }
  }

  const layers: Array<EffectLayer> = []

  // Posterize almost always, since it establishes the palette.
  if (rng.bool(0.85)) {
    const layer = createEffectLayer('posterize')
    layer.params = {
      ...layer.params,
      mode: rng.bool(0.75) ? 'duotone' : 'rgb',
      levels: rng.int(2, 8),
      gamma: roundParam(rng.range(0.6, 1.8)),
      contrast: roundParam(rng.range(-0.2, 0.5)),
      invert: rng.bool(0.2),
      palette: [...palette],
    }
    layers.push(layer)
  }

  /*
   * Gradient map as an alternative to posterize, not an addition: both map the
   * palette onto tone, and stacking them just re-quantizes a recolour.
   */
  if (layers.length === 0 && rng.bool(0.5)) {
    const layer = createEffectLayer('gradient-map')
    layer.params = {
      ...layer.params,
      amount: 1,
      gamma: roundParam(rng.range(0.7, 1.6)),
      contrast: roundParam(rng.range(-0.1, 0.4)),
      invert: rng.bool(0.2),
      palette: [...palette],
    }
    layers.push(layer)
  }

  /*
   * Contour turns the picture into line work, which is a whole-image decision
   * rather than a treatment — so it is rare, and never stacked on a quantizer
   * that has already flattened the tone it needs to trace.
   */
  if (layers.length === 0 && rng.bool(0.18)) {
    const layer = createEffectLayer('contour')
    layer.params = {
      ...layer.params,
      mode: rng.bool(0.8) ? 'contour' : 'edges',
      levels: rng.int(6, 22),
      thickness: roundParam(rng.range(1, 2.4), 1),
      gain: roundParam(rng.range(1.1, 2.4), 1),
      invert: rng.bool(0.35),
      palette: [...palette],
    }
    layers.push(layer)
  }

  // Pixelate occasionally, and always before the dither so the dither has
  // flat cells to work across rather than the other way round.
  if (rng.bool(0.25)) {
    const layer = createEffectLayer('pixelate')
    layer.params = {
      ...layer.params,
      size: rng.int(3, 16),
      sampling: rng.bool(0.8) ? 'average' : 'nearest',
      aspect: rng.bool(0.8) ? 1 : roundParam(rng.range(0.5, 2)),
    }
    layers.push(layer)
  }

  if (rng.bool(0.7)) {
    const layer = createEffectLayer('dither')
    layer.opacity = roundParam(rng.range(0.7, 1))
    layer.params = {
      ...layer.params,
      // Weighted toward blue noise and Floyd-Steinberg: they are the two that
      // look good across the widest range of sources.
      algorithm: rng.pick([
        'blue',
        'blue',
        'floyd-steinberg',
        'floyd-steinberg',
        'bayer',
        'atkinson',
        'jarvis',
        'stucki',
      ]),
      matrixSize: rng.pick(['2', '4', '8']),
      levels: rng.bool(0.7) ? 2 : rng.int(3, 5),
      bias: roundParam(rng.range(-0.1, 0.1)),
      mode: rng.pick(['duotone', 'duotone', 'mono', 'palette', 'source']),
      palette: [...palette],
      serpentine: rng.bool(0.85),
      invert: rng.bool(0.15),
    }
    layers.push(layer)
  }

  // ASCII and dither both quantize tone, so stacking them muddies each other.
  // Offer ASCII only when the dither did not land.
  if (layers.every((entry) => entry.type !== 'dither') && rng.bool(0.5)) {
    const layer = createEffectLayer('ascii')
    layer.params = {
      ...layer.params,
      ramp: rng.pick(['classic', 'blocks', 'shades', 'minimal', 'dots']),
      cellSize: rng.int(5, 14),
      aspect: roundParam(rng.range(1.6, 2.2)),
      contrast: roundParam(rng.range(-0.1, 0.4)),
      edges: rng.bool(0.6) ? roundParam(rng.range(0.2, 0.6)) : 0,
      mode: rng.pick(['duotone', 'duotone', 'mono', 'source']),
      palette: [...palette],
      invert: rng.bool(0.2),
    }
    layers.push(layer)
  }

  /**
   * Transform, sparingly and gently.
   *
   * Geometry is the one thing here that can make a stack unrecognisable rather
   * than merely different, and remix output is now what the app opens on. So:
   * a low probability, symmetry and kaleidoscope favoured over zoom and offset
   * (they compose rather than crop), and no offset at all — pushing the subject
   * off-frame is the failure mode a random transform reaches for first.
   */
  if (rng.bool(0.22)) {
    const layer = createEffectLayer('transform')
    const kaleido = rng.bool(0.45) ? rng.pick([3, 4, 6, 8]) : 0
    layer.params = {
      ...layer.params,
      symmetry: kaleido > 0 ? 'none' : rng.pick(['x', 'y', 'quad']),
      kaleido,
      rotate: rng.bool(0.3) ? rng.pick([90, 180, 270]) : 0,
      zoom: roundParam(rng.range(0.9, 1.6)),
      tile: rng.bool(0.2) ? rng.int(2, 3) : 1,
      offsetX: 0,
      offsetY: 0,
      flipX: false,
      flipY: false,
      wrap: true,
    }
    layers.push(layer)
  }

  if (rng.bool(0.45)) {
    const layer = createEffectLayer('channel-drift')
    layer.opacity = roundParam(rng.range(0.5, 1))
    layer.blendMode = rng.bool(0.7) ? 'normal' : rng.pick(BLEND_MODES)
    layer.params = {
      ...layer.params,
      redX: rng.int(-40, 40),
      redY: rng.int(-10, 10),
      blueX: rng.int(-40, 40),
      blueY: rng.int(-10, 10),
      jitter: rng.bool(0.4) ? rng.int(4, 30) : 0,
      jitterBands: rng.int(6, 60),
      scanlines: rng.bool(0.3) ? roundParam(rng.range(0.1, 0.5)) : 0,
      scanlineSize: rng.int(2, 8),
      seed,
    }
    layers.push(layer)
  }

  // A light sharpen after the quantizers, occasionally: it puts an edge back
  // on a dithered image without changing what the image is.
  if (rng.bool(0.18)) {
    const layer = createEffectLayer('focus')
    layer.params = {
      ...layer.params,
      mode: rng.bool(0.65) ? 'sharpen' : 'blur',
      radius: rng.int(2, 10),
      amount: roundParam(rng.range(0.3, 1)),
    }
    layers.push(layer)
  }

  // Never hand back an empty stack.
  if (layers.length === 0) layers.push(createEffectLayer('posterize'))

  /**
   * Source layers are the composition; only the treatment is rerolled. Locked
   * effects survive too, which is the whole point of a lock — "keep this
   * dither, reroll everything else".
   *
   * Kept layers hold their relative order and the new effects go on top, which
   * is where a stack built by hand would have put them. A locked layer that was
   * on top therefore ends up underneath the reroll; that is a deliberate
   * simplification, since the alternative is guessing at an interleaving.
   */
  const kept = current.layers.filter(
    (layer) => isSourceLayer(layer) || layer.locked,
  )
  return { ...current, layers: withGeneratedNames([...kept, ...layers]) }
}

/**
 * Remix: reseed the generators and pick a fresh but coherent stack.
 */
export interface RemixOptions {
  /** Keep the stack's current colourway instead of picking a new one. */
  lockPalette?: boolean
}

export function remixRecipe(
  current: Recipe,
  options: RemixOptions = {},
): Recipe {
  const seed = randomSeed()
  const rng = createRng(`${seed}:remix`)
  const palette = options.lockPalette
    ? paletteFromRecipe(current)
    : rng.pick(PALETTES).colors

  const sources = current.layers.filter(isSourceLayer)
  const generators = sources.filter((layer) => layer.kind === 'generator')

  const reseeded = sources.map((layer, index) =>
    // A locked source keeps its seed and its parameters untouched. Its palette
    // is left alone too: rerolling the colourway of a layer the user pinned
    // would defeat the lock in the most visible way possible.
    layer.kind === 'generator' && !layer.locked
      ? {
          ...layer,
          // Distinct seeds per generator, so stacked fields do not come out as
          // the same image twice; one shared palette, so they read as one work.
          params: randomizeField(`${seed}:${index}`, palette),
        }
      : layer,
  )

  // A recipe with nothing to treat gets a generator, so remix always produces
  // an image rather than a bare background.
  const layers =
    generators.length === 0 && sources.length === 0
      ? [
          {
            ...createGeneratorLayer(seed),
            params: randomizeField(seed, palette),
          },
        ]
      : reseeded

  return randomizeFxStack({
    ...current,
    layers: [...layers, ...current.layers.filter((l) => !isSourceLayer(l))],
  })
}

/**
 * Ingest an untrusted recipe (share URL, pasted JSON). Anything unrecognized is
 * dropped rather than trusted — a malformed link should open a valid document,
 * not crash the app.
 */
export function sanitizeRecipe(input: unknown): Recipe | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (raw.version !== 1 && raw.version !== 2) return null

  const canvas = (raw.canvas ?? {}) as Record<string, unknown>
  const width = typeof canvas.width === 'number' ? canvas.width : 1080
  const height = typeof canvas.height === 'number' ? canvas.height : 1350

  /**
   * A missing `layers` array is a malformed payload, not an empty document.
   *
   * The distinction matters because the two are indistinguishable downstream
   * and have opposite consequences. `JSON.stringify` always emits the array, so
   * anything without one did not come from this app intact — and coercing it to
   * `[]` used to hand back a *valid, empty* recipe, which `hydrateRecipe`
   * would then use to replace the user's stack with nothing.
   *
   * That path got sharper when share links became compressed: a truncated
   * base64 payload of plain JSON simply fails to parse, but a truncated
   * deflate stream can inflate into something that parses and is missing
   * fields. Rejecting here means a mangled link opens the default document
   * instead of silently wiping the work already on screen.
   *
   * An explicitly empty `layers: []` is still honoured — deleting every layer
   * is a legitimate thing to have done.
   */
  if (raw.version === 2 && !Array.isArray(raw.layers)) return null

  const rawLayers = Array.isArray(raw.layers) ? raw.layers : []
  const layers = rawLayers.flatMap((entry) => {
    const layer = sanitizeLayer(entry)
    return layer ? [layer] : []
  })

  // A v1 recipe's source becomes the bottom layer. Everything above it already
  // sanitizes as an effect layer, because v1 layers were effect layers.
  if (raw.version === 1) layers.unshift(migrateSource(raw.source))

  return {
    version: 2,
    canvas: {
      width: Math.max(16, Math.min(8192, Math.round(width))),
      height: Math.max(16, Math.min(8192, Math.round(height))),
    },
    background: isHexColor(raw.background)
      ? raw.background
      : DEFAULT_BACKGROUND,
    layers,
  }
}

/** The handle a v1 import migrates onto — there was only ever one. */
export const IMPORTED_ASSET = 'imported'

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)
}

function migrateSource(input: unknown): Layer {
  const raw = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>

  if (raw.type === 'image') {
    const name = typeof raw.name === 'string' ? raw.name : 'image'
    // v1 drew every import cover-fit and centred, which is exactly what the
    // default placement params describe — so the migration is not an
    // approximation, it renders the same pixels.
    return { ...createImageLayer(IMPORTED_ASSET, name), name }
  }

  const layer = createGeneratorLayer()
  return {
    ...layer,
    name: 'Field',
    // v1 kept the seed beside the params; v2 keeps it in them.
    params: sanitizeParams(FIELD_PARAMS, {
      ...(typeof raw.params === 'object' && raw.params !== null
        ? raw.params
        : {}),
      seed: typeof raw.seed === 'string' ? raw.seed : layer.params.seed,
    }),
  }
}

/**
 * One untrusted stack entry.
 *
 * `kind` is inferred when absent so a v1 layer — which had a `type` and no
 * kind — sanitizes through the same path as a v2 one.
 */
function sanitizeLayer(input: unknown): Layer | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>

  const type = raw.type as EffectType
  const kind =
    raw.kind === 'generator' ||
    raw.kind === 'image' ||
    raw.kind === 'text' ||
    raw.kind === 'effect'
      ? raw.kind
      : EFFECT_ORDER.includes(type)
        ? 'effect'
        : null
  if (!kind) return null
  if (kind === 'effect' && !EFFECT_ORDER.includes(type)) return null

  const base: Omit<LayerBase, 'params'> = {
    id: typeof raw.id === 'string' ? raw.id : createLayerId(),
    name:
      typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name.trim().slice(0, 48)
        : undefined,
    enabled: raw.enabled !== false,
    opacity:
      typeof raw.opacity === 'number'
        ? Math.max(0, Math.min(1, raw.opacity))
        : 1,
    blendMode: BLEND_MODES.includes(raw.blendMode as BlendMode)
      ? (raw.blendMode as BlendMode)
      : 'normal',
    mask: sanitizeMask(raw.mask),
    shape: sanitizeShapeMask(raw.shape),
    locked: raw.locked === true ? true : undefined,
  }

  if (kind === 'effect') {
    return {
      ...base,
      kind,
      type,
      params: sanitizeParams(EFFECTS[type].params, raw.params),
    }
  }

  if (kind === 'image') {
    return {
      ...base,
      kind,
      asset: typeof raw.asset === 'string' ? raw.asset : IMPORTED_ASSET,
      params: sanitizeParams(IMAGE_PARAMS, raw.params),
    }
  }

  if (kind === 'text') {
    return {
      ...base,
      kind,
      params: sanitizeParams(TEXT_PARAMS, raw.params),
    }
  }

  return {
    ...base,
    kind,
    generator: 'field',
    params: sanitizeParams(FIELD_PARAMS, raw.params),
  }
}

/* -------------------------------------------------------------------------
 * URL encoding
 * ---------------------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/**
 * Marker for a deflated payload.
 *
 * Safe as a discriminator because an uncompressed payload is base64url of JSON
 * that always begins `{"version"`, so it always begins `eyJ2` — no plain recipe
 * can start with `z`. Old links therefore keep decoding untouched, which
 * matters because they are already out in the world and are the only copy of
 * whatever they encode.
 */
const DEFLATE_PREFIX = 'z'

/** Base64url of the raw JSON. Synchronous, and the fallback encoding. */
export function encodeRecipe(recipe: Recipe): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(recipe)))
}

export function decodeRecipe(encoded: string): Recipe | null {
  try {
    const bytes = fromBase64Url(encoded)
    return sanitizeRecipe(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

async function pump(
  bytes: Uint8Array,
  // Not `TransformStream<Uint8Array, Uint8Array>`: these streams accept any
  // `BufferSource` on the writable side, so the narrower type does not fit.
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart])
  const piped = blob.stream().pipeThrough(stream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

/**
 * The encoding actually written to the URL: deflated, then base64url.
 *
 * Recipes are far from small once a stack is deep — measured at 1.5 KB for the
 * default three layers and 6.5 KB at fourteen, and past about 2 KB links start
 * being truncated by messaging apps and link unfurlers. Deflate cuts that
 * roughly fourfold on JSON this repetitive.
 *
 * Async because `CompressionStream` is, which is why `encodeRecipe` stays as
 * the synchronous fallback rather than being replaced: environments without
 * `CompressionStream` still produce a working link, just a longer one.
 */
export async function encodeRecipeCompressed(recipe: Recipe): Promise<string> {
  const plain = encodeRecipe(recipe)
  if (typeof CompressionStream === 'undefined') return plain

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(recipe))
    const deflated = await pump(bytes, new CompressionStream('deflate-raw'))
    const packed = DEFLATE_PREFIX + toBase64Url(deflated)
    // Deflate has overhead, and a tiny recipe can come out longer. Keep
    // whichever is actually shorter — the decoder reads both.
    return packed.length < plain.length ? packed : plain
  } catch {
    return plain
  }
}

/** Decode either encoding. Accepts every link ever produced by this app. */
export async function decodeRecipeAny(encoded: string): Promise<Recipe | null> {
  if (!encoded.startsWith(DEFLATE_PREFIX)) return decodeRecipe(encoded)
  if (typeof DecompressionStream === 'undefined') return null

  try {
    const bytes = fromBase64Url(encoded.slice(DEFLATE_PREFIX.length))
    const raw = await pump(bytes, new DecompressionStream('deflate-raw'))
    return sanitizeRecipe(JSON.parse(new TextDecoder().decode(raw)))
  } catch {
    return null
  }
}
