/**
 * The recipe is the document (ADR Decision 6). It is fully serializable: no
 * image buffers, no canvas handles, no React state. Everything the renderer
 * needs to reproduce an image lives here, which is what makes local saves,
 * history, and share URLs possible later.
 */

export type BlendMode =
  'normal' | 'multiply' | 'screen' | 'overlay' | 'difference'

export const BLEND_MODES: Array<BlendMode> = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'difference',
]

export type ParamValue = number | string | boolean | Array<string>

export type Params = Record<string, ParamValue>

export type EffectType =
  | 'levels'
  | 'posterize'
  | 'pixelate'
  | 'dither'
  | 'halftone'
  | 'ascii'
  | 'pixel-sort'
  | 'displace'
  | 'channel-drift'
  | 'bloom'
  | 'grain'

/**
 * Restricts a layer to a band of the tone it is applied over.
 *
 * "Dither the shadows, leave the highlights clean" is not expressible with
 * opacity, which is uniform across the frame. Because the band is measured on
 * the layer's *input*, masks compose down the stack: each one reads whatever
 * the layers beneath it produced.
 *
 * `low: 0, high: 1, softness: 0` is the identity and the default.
 */
export interface ToneMask {
  low: number
  high: number
  /** Width of the fade at each edge of the band, in tone units. */
  softness: number
}

export const NO_MASK: ToneMask = { low: 0, high: 1, softness: 0 }

export function isFullRange(mask: ToneMask): boolean {
  return mask.low <= 0 && mask.high >= 1
}

export interface Layer {
  id: string
  type: EffectType
  name?: string
  enabled: boolean
  opacity: number
  blendMode: BlendMode
  mask: ToneMask
  params: Params
}

export interface GeneratorSource {
  type: 'generator'
  generator: 'field'
  seed: string
  params: Params
}

export interface ImageSource {
  type: 'image'
  /**
   * Imported bitmaps deliberately never enter the recipe (ADR Decision 6): a
   * shared recipe reopens with a missing source rather than carrying pixels.
   * This is only a display name for the UI.
   */
  name: string
}

export type Source = GeneratorSource | ImageSource

export interface CanvasSize {
  width: number
  height: number
}

export interface Recipe {
  version: 1
  source: Source
  canvas: CanvasSize
  layers: Array<Layer>
}

/**
 * Rendering context handed to every pass.
 *
 * `scale` is the crux of the preview-fidelity decision: params are authored in
 * export-space pixels, and any dimensional param is multiplied by `scale` so a
 * half-size preview is a faithful miniature rather than a differently-quantized
 * image. Effects must never read raw canvas dimensions to size their features.
 */
export interface RenderEnv {
  scale: number
  width: number
  height: number
}

/**
 * Scale a *size* authored in export pixels into the current render space —
 * a dither cell, a scanline band, a blur radius.
 *
 * The `min` floor keeps a feature from collapsing to nothing at small preview
 * scales. Only use this for non-negative magnitudes: the floor would clamp a
 * negative value up to `min`, which silently discards direction.
 */
export function scaled(value: number, env: RenderEnv, min = 1): number {
  return Math.max(min, Math.round(value * env.scale))
}

/**
 * Scale a *signed offset* authored in export pixels — a channel displacement.
 *
 * Separate from `scaled` because offsets carry direction and are legitimately
 * zero, so they must not be floored. Collapsing this into `scaled` is what
 * silently dropped every negative channel offset.
 */
export function scaledOffset(value: number, env: RenderEnv): number {
  return Math.round(value * env.scale)
}
