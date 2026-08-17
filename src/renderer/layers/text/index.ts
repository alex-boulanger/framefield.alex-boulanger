import { rasterizeBlocks } from './blocks'
import { placeText } from './place'
import { rasterizeText } from './raster'
import { textSettings } from './settings'
import type { PixelBuffer } from '../../buffer'
import type { Params, RenderEnv } from '../../types'

export { TEXT_PARAMS, TEXT_DEFAULTS, DEFAULT_PALETTE } from './params'
export { randomizeText } from './random'
export { layoutText } from './layout'
export { unwarp } from './place'
export { textSettings } from './settings'
export { approximateMeasure } from './blocks'
export type { TextSettings } from './settings'
export type { TextLayout, GlyphPlacement } from './layout'

/**
 * The 2D text layer: a source layer whose pixels happen to be words.
 *
 * Three stages, each of which can be reasoned about alone —
 *
 *   params → settings   read once, scaled once
 *   settings → box      lay the glyphs out, draw them with their treatment
 *   box → frame         rotate, warp, and stencil into place
 *
 * — and nothing downstream knows it was text. That is the point: the pixel
 * sort, the dither and the channel drift above it treat a headline exactly as
 * they treat a noise field, which is where the interesting results come from.
 */
export function renderTextLayer(
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const settings = textSettings(params, env)
  const raster = rasterizeText(settings) ?? rasterizeBlocks(settings)
  return placeText(raster.buffer, settings, env)
}
