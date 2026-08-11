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

/**
 * Everything in the stack is a layer, and every layer carries the same
 * controls. A generator is not a privileged "source" that effects hang off —
 * it is a layer that happens to make its own pixels, which is what lets two
 * generators blend or an effect sit between them.
 */
export interface LayerBase {
  id: string
  name?: string
  enabled: boolean
  opacity: number
  blendMode: BlendMode
  mask: ToneMask
  params: Params
}

export interface GeneratorLayer extends LayerBase {
  kind: 'generator'
  generator: 'field'
}

export interface ImageLayer extends LayerBase {
  kind: 'image'
  /**
   * Key into the session asset registry, never the pixels themselves (ADR
   * Decision 6). A shared recipe reopens with the layer intact and its pixels
   * missing, which is inspectable; an embedded bitmap would be neither small
   * nor safe.
   */
  asset: string
}

export interface EffectLayer extends LayerBase {
  kind: 'effect'
  type: EffectType
}

/**
 * Source layers own their coverage, effect layers inherit it. That distinction
 * is the one thing the compositor cannot infer, so it is carried by `kind`
 * rather than guessed from the pixels (see `compositeInto`).
 */
export type Layer = GeneratorLayer | ImageLayer | EffectLayer

export type LayerKind = Layer['kind']

export function isSourceLayer(layer: Layer): layer is GeneratorLayer | ImageLayer {
  return layer.kind !== 'effect'
}

export interface CanvasSize {
  width: number
  height: number
}

export interface Recipe {
  version: 2
  canvas: CanvasSize
  /**
   * What sits under the bottom layer. The accumulator is opaque from the first
   * pixel on purpose: every effect in the registry transforms RGB and ignores
   * alpha, so a transparent ground would have them quantizing and blurring
   * pixels that are not there — black haloes around glyphs, dither in the
   * empty margins. Compositing stays correct because source layers blend by
   * their own alpha; it is only the *ground* that is never transparent.
   */
  background: string
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
