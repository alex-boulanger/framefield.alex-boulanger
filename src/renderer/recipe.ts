import { EFFECTS, EFFECT_ORDER, effectDefaults } from './effects'
import {
  FIELD_PARAMS,
  FIELD_DEFAULTS,
  randomizeField,
} from './generators/field'
import { IMAGE_DEFAULTS, IMAGE_PARAMS } from './layers/image'
import { PALETTES } from './palettes'
import { createRng, randomSeed } from './rng'
import { roundParam, sanitizeParams } from './params'
import { BLEND_MODES, NO_MASK, isSourceLayer } from './types'
import type {
  BlendMode,
  EffectLayer,
  EffectType,
  GeneratorLayer,
  ImageLayer,
  Layer,
  LayerBase,
  Recipe,
  ToneMask,
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

/** Fresh defaults for a layer, without disturbing what it renders. */
export function layerDefaults(layer: Layer): Layer['params'] {
  if (layer.kind === 'effect') return effectDefaults(layer.type)
  if (layer.kind === 'image') return IMAGE_DEFAULTS()
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

/**
 * The first thing anyone sees. The quality bar says first load must show an
 * interesting image with no input, so the default recipe is a real composition
 * rather than a bare generator.
 */
export function createDefaultRecipe(): Recipe {
  return {
    version: 2,
    canvas: { width: 1080, height: 1350 },
    background: DEFAULT_BACKGROUND,
    layers: [
      createGeneratorLayer(),
      { ...createEffectLayer('posterize'), opacity: 1 },
      { ...createEffectLayer('dither'), opacity: 0.9 },
    ],
  }
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

  // Never hand back an empty stack.
  if (layers.length === 0) layers.push(createEffectLayer('posterize'))

  // Source layers are the composition; only the treatment is rerolled. Their
  // order is preserved and the new effects go on top, which is where a stack
  // built by hand would have put them.
  return { ...current, layers: [...current.layers.filter(isSourceLayer), ...layers] }
}

/**
 * Remix: reseed the generators and pick a fresh but coherent stack.
 */
export function remixRecipe(current: Recipe): Recipe {
  const seed = randomSeed()
  const rng = createRng(`${seed}:remix`)
  const palette = rng.pick(PALETTES).colors

  const sources = current.layers.filter(isSourceLayer)
  const generators = sources.filter((layer) => layer.kind === 'generator')

  const reseeded = sources.map((layer, index) =>
    layer.kind === 'generator'
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
      ? [{ ...createGeneratorLayer(seed), params: randomizeField(seed, palette) }]
      : reseeded

  return randomizeFxStack({ ...current, layers })
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
    raw.kind === 'generator' || raw.kind === 'image' || raw.kind === 'effect'
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
  }

  if (kind === 'effect') {
    return { ...base, kind, type, params: sanitizeParams(EFFECTS[type].params, raw.params) }
  }

  if (kind === 'image') {
    return {
      ...base,
      kind,
      asset: typeof raw.asset === 'string' ? raw.asset : IMPORTED_ASSET,
      params: sanitizeParams(IMAGE_PARAMS, raw.params),
    }
  }

  return {
    ...base,
    kind,
    generator: 'field',
    params: sanitizeParams(FIELD_PARAMS, raw.params),
  }
}

/**
 * URL encoding. Base64url of the JSON — no compression yet; recipes are small
 * and keeping it readable in devtools is worth more than a few hundred bytes.
 */
export function encodeRecipe(recipe: Recipe): string {
  const json = JSON.stringify(recipe)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRecipe(encoded: string): Recipe | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return sanitizeRecipe(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}
