import { LEVELS_PARAMS, applyLevels } from './levels'
import { POSTERIZE_PARAMS, applyPosterize } from './posterize'
import { GRADIENT_MAP_PARAMS, applyGradientMap } from './gradientMap'
import { CONTOUR_PARAMS, applyContour } from './contour'
import { FOCUS_PARAMS, applyFocus } from './focus'
import { PIXELATE_PARAMS, applyPixelate } from './pixelate'
import { DITHER_PARAMS, applyDither } from './dither'
import { ASCII_PARAMS, applyAscii } from './ascii'
import { HALFTONE_PARAMS, applyHalftone } from './halftone'
import { PIXEL_SORT_PARAMS, applyPixelSort } from './pixelSort'
import { TRANSFORM_PARAMS, applyTransform } from './transform'
import { DISPLACE_PARAMS, applyDisplace } from './displace'
import { BLOOM_PARAMS, applyBloom } from './bloom'
import { GRAIN_PARAMS, applyGrain } from './grain'
import { CHANNEL_DRIFT_PARAMS, applyChannelDrift } from './channelDrift'
import { defaultParams } from '../params'
import type { ParamSpec } from '../params'
import type { PixelBuffer } from '../buffer'
import type { EffectType, Params, RenderEnv } from '../types'

/**
 * The effect registry. Adding an effect means adding one entry here — the
 * stack UI, the controls panel, defaults, and the pipeline all read from it.
 */

export interface EffectDefinition {
  type: EffectType
  label: string
  /** One-line description shown when the layer is selected. */
  hint: string
  params: Array<ParamSpec>
  /** Mutates and returns `buffer`. Must not read outside its inputs. */
  apply: (buffer: PixelBuffer, params: Params, env: RenderEnv) => PixelBuffer
}

export const EFFECTS: Record<EffectType, EffectDefinition> = {
  levels: {
    type: 'levels',
    label: 'Levels',
    hint: 'Shape tone before the quantizing effects read it.',
    params: LEVELS_PARAMS,
    apply: applyLevels,
  },
  posterize: {
    type: 'posterize',
    label: 'Posterize',
    hint: 'Reduce tones and map them onto a palette.',
    params: POSTERIZE_PARAMS,
    apply: applyPosterize,
  },
  'gradient-map': {
    type: 'gradient-map',
    label: 'Gradient Map',
    hint: 'Recolour by tone, smoothly — a palette without quantizing.',
    params: GRADIENT_MAP_PARAMS,
    apply: applyGradientMap,
  },
  contour: {
    type: 'contour',
    label: 'Contour',
    hint: 'Iso-lines and edges — structure drawn rather than filtered.',
    params: CONTOUR_PARAMS,
    apply: applyContour,
  },
  focus: {
    type: 'focus',
    label: 'Blur / Sharpen',
    hint: 'Soften or bite, through the layer masks.',
    params: FOCUS_PARAMS,
    apply: applyFocus,
  },
  pixelate: {
    type: 'pixelate',
    label: 'Pixelate',
    hint: 'Collapse the image into uniform cells.',
    params: PIXELATE_PARAMS,
    apply: applyPixelate,
  },
  dither: {
    type: 'dither',
    label: 'Dither',
    hint: 'Ordered masks or per-pixel error diffusion.',
    params: DITHER_PARAMS,
    apply: applyDither,
  },
  ascii: {
    type: 'ascii',
    label: 'ASCII',
    hint: 'Map tone onto characters, ordered by measured ink.',
    params: ASCII_PARAMS,
    apply: applyAscii,
  },
  halftone: {
    type: 'halftone',
    label: 'Halftone',
    hint: 'Rotated print screens, with a four-plate CMYK mode.',
    params: HALFTONE_PARAMS,
    apply: applyHalftone,
  },
  'pixel-sort': {
    type: 'pixel-sort',
    label: 'Pixel Sort',
    hint: 'Reorder runs of pixels selected by a tone band.',
    params: PIXEL_SORT_PARAMS,
    apply: applyPixelSort,
  },
  transform: {
    type: 'transform',
    label: 'Transform',
    hint: 'Mirror, rotate, tile, and kaleidoscope the frame.',
    params: TRANSFORM_PARAMS,
    apply: applyTransform,
  },
  displace: {
    type: 'displace',
    label: 'Displace',
    hint: 'Push pixels around by a noise or flow field.',
    params: DISPLACE_PARAMS,
    apply: applyDisplace,
  },
  bloom: {
    type: 'bloom',
    label: 'Bloom',
    hint: 'Bleed the highlights, in linear light.',
    params: BLOOM_PARAMS,
    apply: applyBloom,
  },
  grain: {
    type: 'grain',
    label: 'Grain',
    hint: 'Film grain and paper texture.',
    params: GRAIN_PARAMS,
    apply: applyGrain,
  },
  'channel-drift': {
    type: 'channel-drift',
    label: 'Channel Drift',
    hint: 'Offset RGB channels for controlled misregistration.',
    params: CHANNEL_DRIFT_PARAMS,
    apply: applyChannelDrift,
  },
}

export const EFFECT_ORDER: Array<EffectType> = [
  'levels',
  'posterize',
  'gradient-map',
  'pixelate',
  'dither',
  'halftone',
  'ascii',
  'pixel-sort',
  'contour',
  'focus',
  'transform',
  'displace',
  'channel-drift',
  'bloom',
  'grain',
]

export function effectDefaults(type: EffectType): Params {
  return defaultParams(EFFECTS[type].params)
}
