import { POSTERIZE_PARAMS, applyPosterize } from './posterize'
import { PIXELATE_PARAMS, applyPixelate } from './pixelate'
import { DITHER_PARAMS, applyDither } from './dither'
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
  posterize: {
    type: 'posterize',
    label: 'Posterize',
    hint: 'Reduce tones and map them onto a palette.',
    params: POSTERIZE_PARAMS,
    apply: applyPosterize,
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
  'channel-drift': {
    type: 'channel-drift',
    label: 'Channel Drift',
    hint: 'Offset RGB channels for controlled misregistration.',
    params: CHANNEL_DRIFT_PARAMS,
    apply: applyChannelDrift,
  },
}

export const EFFECT_ORDER: Array<EffectType> = [
  'posterize',
  'pixelate',
  'dither',
  'channel-drift',
]

export function effectDefaults(type: EffectType): Params {
  return defaultParams(EFFECTS[type].params)
}
