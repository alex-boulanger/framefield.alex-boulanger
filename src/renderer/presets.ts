import { effectDefaults } from './effects'
import { FIELD_DEFAULTS } from './generators/field'
import { DEFAULT_BACKGROUND, withGeneratedNames } from './recipe'
import { NO_MASK } from './types'
import type { EffectType, Layer, Params, Recipe, ToneMask } from './types'

/**
 * Curated starting points.
 *
 * Remix explores the parameter space randomly, which is good for surprise and
 * bad for a first impression — most of that space is mediocre. These are
 * hand-tuned, and they exist so the first thirty seconds show what the tool can
 * do at its best rather than at its average. They double as documentation:
 * each one demonstrates a different combination worth knowing about.
 *
 * Presets carry only the deltas they care about; everything else comes from
 * the effect defaults, so adding a param to an effect does not require
 * revisiting every preset.
 */

export interface Preset {
  id: string
  name: string
  seed: string
  source: Params
  layers: Array<{
    type: EffectType
    params?: Params
    opacity?: number
    mask?: ToneMask
  }>
}

export const PRESETS: Array<Preset> = [
  {
    id: 'marble',
    name: 'Marble',
    seed: 'marble01',
    source: {
      field: 'warp',
      scale: 2.2,
      warp: 2.1,
      octaves: 5,
      shapes: 0,
      grain: 0.03,
      contrast: 0.2,
      palette: ['#050505', '#f5f5f5', '#0057ff'],
    },
    layers: [
      // Levels first: the dither maps from luma, so widening the range before
      // it runs is what gives the stipple somewhere to live.
      { type: 'levels', params: { black: 0.08, white: 0.92, gamma: 1.1 } },
      { type: 'dither', params: { algorithm: 'blue', mode: 'duotone' } },
    ],
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    seed: 'press42',
    source: {
      field: 'fbm',
      scale: 1.8,
      octaves: 6,
      shapes: 3,
      shapeScale: 0.6,
      contrast: 0.3,
      grain: 0,
      palette: ['#1a1a1a', '#fff1e5', '#ff4a3d'],
    },
    layers: [
      {
        type: 'halftone',
        params: { mode: 'cmyk', cellSize: 6, gain: 1.1, shape: 'dot' },
      },
      { type: 'grain', params: { amount: 0.12, size: 1, shadows: 0.2 } },
    ],
  },
  {
    id: 'terminal',
    name: 'Terminal',
    seed: 'tty0090',
    source: {
      field: 'ridged',
      scale: 3.1,
      octaves: 4,
      shapes: 2,
      contrast: 0.35,
      grain: 0,
      palette: ['#020402', '#8fffbe', '#00c2a8'],
    },
    layers: [
      {
        type: 'ascii',
        params: {
          ramp: 'terminal',
          cellSize: 7,
          contrast: 0.2,
          edges: 0.45,
          mode: 'duotone',
          palette: ['#020402', '#8fffbe'],
        },
      },
    ],
  },
  {
    id: 'silk',
    name: 'Silk',
    seed: 'silk7731',
    source: {
      field: 'flow',
      scale: 2.6,
      flow: 22,
      octaves: 4,
      shapes: 0,
      grain: 0,
      contrast: 0.1,
      palette: ['#04070f', '#dce6ff', '#2b4bff'],
    },
    layers: [
      { type: 'posterize', params: { levels: 6, mode: 'duotone' } },
      {
        type: 'bloom',
        params: { threshold: 0.55, amount: 0.9, radius: 40, knee: 0.5 },
      },
    ],
  },
  {
    id: 'riso',
    name: 'Riso',
    seed: 'riso5150',
    source: {
      field: 'warp',
      scale: 1.6,
      warp: 1.2,
      shapes: 5,
      shapeScale: 0.7,
      softness: 0.5,
      grain: 0.05,
      palette: ['#1a1a1a', '#fff1e5', '#ff4a3d'],
    },
    layers: [
      { type: 'posterize', params: { levels: 3, mode: 'duotone' } },
      {
        type: 'channel-drift',
        params: { redX: 9, blueX: -9, jitter: 0 },
        opacity: 0.85,
      },
      {
        // Masked to the darker half: real paper grain shows in the ink, not
        // in the blank stock.
        type: 'grain',
        params: { amount: 0.22, size: 2, shadows: 0.5 },
        mask: { low: 0, high: 0.6, softness: 0.15 },
      },
    ],
  },
  {
    id: 'shred',
    name: 'Shred',
    seed: 'shred220',
    source: {
      field: 'fbm',
      scale: 3.4,
      octaves: 5,
      shapes: 4,
      contrast: 0.25,
      grain: 0.04,
      palette: ['#0b0f00', '#eaff00', '#00c2a8'],
    },
    layers: [
      {
        type: 'pixel-sort',
        params: { low: 0.05, high: 0.45, maxRun: 220, sortBy: 'luma' },
      },
    ],
  },
  {
    id: 'lowres',
    name: 'Low-res',
    seed: 'lores808',
    source: {
      field: 'warp',
      scale: 2.8,
      warp: 1.8,
      shapes: 3,
      grain: 0,
      contrast: 0.2,
      palette: ['#100604', '#ffd7b0', '#ff5c1a'],
    },
    layers: [
      { type: 'pixelate', params: { size: 12, sampling: 'average' } },
      // Posterize rather than dither: a per-pixel dither inside flat cells
      // stipples them back up and undoes the chunkiness.
      { type: 'posterize', params: { levels: 4, mode: 'duotone' } },
    ],
  },
  {
    id: 'drip',
    name: 'Drip',
    seed: 'drip3040',
    source: {
      field: 'warp',
      scale: 1.9,
      warp: 2.4,
      octaves: 4,
      shapes: 2,
      shapeScale: 0.55,
      contrast: 0.3,
      grain: 0,
      palette: ['#0a0014', '#ffe0f7', '#ff2e9a'],
    },
    layers: [
      {
        // Melt first, then run the paint: displacement gives the sort curved
        // edges to follow instead of straight posterized bands.
        type: 'displace',
        params: { field: 'noise', amount: 26, scale: 2.6, octaves: 3 },
      },
      { type: 'posterize', params: { levels: 5, mode: 'duotone' } },
      {
        // Downward, capped short, so it reads as running paint rather than
        // as the whole image being combed.
        type: 'pixel-sort',
        params: {
          rotation: '90',
          low: 0.1,
          high: 0.55,
          maxRun: 140,
          sortBy: 'luma',
        },
      },
    ],
  },
  {
    id: 'engrave',
    name: 'Engrave',
    seed: 'engr1120',
    source: {
      field: 'ridged',
      scale: 2.4,
      octaves: 6,
      shapes: 0,
      contrast: 0.4,
      grain: 0,
      palette: ['#12100e', '#e8e0d4', '#a4907c'],
    },
    layers: [
      {
        type: 'halftone',
        params: {
          mode: 'duotone',
          shape: 'line',
          cellSize: 5,
          angle: 68,
          // Two swatches on purpose: duotone gives every non-paper entry its
          // own plate, and overprinting the palette's mid-tone accent as a
          // second ink turns a line engraving into mud.
          palette: ['#12100e', '#e8e0d4'],
        },
      },
    ],
  },
]

let counter = 0

/** Build a full recipe from a preset, at the caller's canvas size. */
export function recipeFromPreset(
  preset: Preset,
  canvas: { width: number; height: number },
): Recipe {
  const sourcePalette = preset.source.palette

  const effects: Array<Layer> = preset.layers.map((entry) => {
    counter += 1
    const defaults = effectDefaults(entry.type)

    /**
     * Inherit the source palette unless the layer names its own.
     *
     * Without this a preset silently loses its colour scheme: the effect's
     * default palette wins, and Riso renders blue, Engrave and Low-res come
     * out black and white. A preset is a look, and the palette is most of it.
     */
    const inherited: Params =
      'palette' in defaults &&
      !entry.params?.palette &&
      Array.isArray(sourcePalette)
        ? { palette: [...sourcePalette] }
        : {}

    return {
      id: `preset_${preset.id}_${counter}`,
      kind: 'effect',
      type: entry.type,
      enabled: true,
      opacity: entry.opacity ?? 1,
      blendMode: 'normal',
      mask: { ...(entry.mask ?? NO_MASK) },
      params: { ...defaults, ...inherited, ...entry.params },
    }
  })

  const generator: Layer = {
    id: `preset_${preset.id}_field`,
    kind: 'generator',
    generator: 'field',
    name: 'Field',
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    mask: { ...NO_MASK },
    params: { ...FIELD_DEFAULTS(), ...preset.source, seed: preset.seed },
  }

  return {
    version: 2,
    canvas: { ...canvas },
    background: DEFAULT_BACKGROUND,
    layers: withGeneratedNames([generator, ...effects]),
  }
}
