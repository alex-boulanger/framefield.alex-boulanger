import { EFFECTS, EFFECT_ORDER, effectDefaults } from './effects'
import {
  FIELD_PARAMS,
  FIELD_DEFAULTS,
  randomizeField,
} from './generators/field'
import { PALETTES } from './palettes'
import { createRng, randomSeed } from './rng'
import { roundParam, sanitizeParams } from './params'
import { BLEND_MODES } from './types'
import type { BlendMode, EffectType, Layer, Recipe } from './types'

export interface SizePreset {
  id: string
  label: string
  width: number
  height: number
}

export const SIZE_PRESETS: Array<SizePreset> = [
  { id: 'square', label: 'Square', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait', width: 1080, height: 1350 },
  { id: 'story', label: 'Story', width: 1080, height: 1920 },
  { id: 'landscape', label: 'Landscape', width: 1200, height: 630 },
]

let layerCounter = 0

export function createLayerId(): string {
  layerCounter += 1
  return `layer_${Date.now().toString(36)}${layerCounter.toString(36)}`
}

export function createLayer(type: EffectType): Layer {
  return {
    id: createLayerId(),
    type,
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    params: effectDefaults(type),
  }
}

/**
 * The first thing anyone sees. The quality bar says first load must show an
 * interesting image with no input, so the default recipe is a real composition
 * rather than a bare generator.
 */
export function createDefaultRecipe(): Recipe {
  const seed = randomSeed()
  return {
    version: 1,
    source: {
      type: 'generator',
      generator: 'field',
      seed,
      params: FIELD_DEFAULTS(),
    },
    canvas: { width: 1080, height: 1350 },
    layers: [
      { ...createLayer('posterize'), opacity: 1 },
      { ...createLayer('dither'), opacity: 0.9 },
    ],
  }
}

/**
 * Remix: reseed the source and pick a fresh but coherent stack. Ranges stay
 * conservative on purpose — every remix should be usable, not merely different.
 */
export function remixRecipe(current: Recipe): Recipe {
  const seed = randomSeed()
  const rng = createRng(`${seed}:remix`)
  const palette = rng.pick(PALETTES).colors

  const layers: Array<Layer> = []

  // Posterize almost always, since it establishes the palette.
  if (rng.bool(0.85)) {
    const layer = createLayer('posterize')
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
    const layer = createLayer('pixelate')
    layer.params = {
      ...layer.params,
      size: rng.int(3, 16),
      sampling: rng.bool(0.8) ? 'average' : 'nearest',
      aspect: rng.bool(0.8) ? 1 : roundParam(rng.range(0.5, 2)),
    }
    layers.push(layer)
  }

  if (rng.bool(0.7)) {
    const layer = createLayer('dither')
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

  if (rng.bool(0.45)) {
    const layer = createLayer('channel-drift')
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
  if (layers.length === 0) layers.push(createLayer('posterize'))

  return {
    ...current,
    source:
      current.source.type === 'image'
        ? current.source
        : {
            type: 'generator',
            generator: 'field',
            seed,
            params: randomizeField(seed, palette),
          },
    layers,
  }
}

/**
 * Ingest an untrusted recipe (share URL, pasted JSON). Anything unrecognized is
 * dropped rather than trusted — a malformed link should open a valid document,
 * not crash the app.
 */
export function sanitizeRecipe(input: unknown): Recipe | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (raw.version !== 1) return null

  const canvas = (raw.canvas ?? {}) as Record<string, unknown>
  const width = typeof canvas.width === 'number' ? canvas.width : 1080
  const height = typeof canvas.height === 'number' ? canvas.height : 1350

  const rawSource = (raw.source ?? {}) as Record<string, unknown>
  const source: Recipe['source'] =
    rawSource.type === 'image'
      ? {
          type: 'image',
          name: typeof rawSource.name === 'string' ? rawSource.name : 'image',
        }
      : {
          type: 'generator',
          generator: 'field',
          seed:
            typeof rawSource.seed === 'string' ? rawSource.seed : randomSeed(),
          params: sanitizeParams(FIELD_PARAMS, rawSource.params),
        }

  const rawLayers = Array.isArray(raw.layers) ? raw.layers : []
  const layers: Array<Layer> = []

  for (const entry of rawLayers) {
    if (typeof entry !== 'object' || entry === null) continue
    const layer = entry as Record<string, unknown>
    const type = layer.type as EffectType
    if (!EFFECT_ORDER.includes(type)) continue

    layers.push({
      id: typeof layer.id === 'string' ? layer.id : createLayerId(),
      type,
      enabled: layer.enabled !== false,
      opacity:
        typeof layer.opacity === 'number'
          ? Math.max(0, Math.min(1, layer.opacity))
          : 1,
      blendMode: BLEND_MODES.includes(layer.blendMode as BlendMode)
        ? (layer.blendMode as BlendMode)
        : 'normal',
      params: sanitizeParams(EFFECTS[type].params, layer.params),
    })
  }

  return {
    version: 1,
    source,
    canvas: {
      width: Math.max(16, Math.min(8192, Math.round(width))),
      height: Math.max(16, Math.min(8192, Math.round(height))),
    },
    layers,
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
