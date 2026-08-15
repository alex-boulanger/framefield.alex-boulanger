import { EFFECTS } from './effects'
import { renderField } from './generators/field'
import { placeImage } from './layers/image'
import { renderTextLayer } from './layers/text'
import { compositeInto } from './blend'
import {
  cloneBuffer,
  createBuffer,
  fromImageData,
  srgbToLinear,
  toImageData,
} from './buffer'
import { hexToRgb } from './palettes'
import type { PixelBuffer } from './buffer'
import type { Layer, Recipe, RenderEnv } from './types'

/**
 * The pipeline. Pure with respect to React (ADR Decision 4): it takes a recipe
 * plus optional decoded bitmaps and produces pixels. No component state, no
 * store access, no DOM beyond the canvas it is handed.
 *
 * One linear stack, bottom to top, over an accumulator. Layers that make their
 * own pixels composite into it by their coverage; effect layers read what is
 * beneath them, transform it, and composite the result back. There is no
 * privileged source — that is the whole point of the model.
 *
 * Everything between the ground and the final encode is Float32 linear light
 * (see `buffer.ts`), so passes compose without requantizing and tone maths is
 * physically meaningful. Canvas is touched in exactly one place — drawing a
 * decoded bitmap — which leaves the generator and every effect testable in
 * plain node.
 */

/** Decoded bitmaps by asset handle. Never enters the recipe. */
export type RenderAssets = Record<
  string,
  ImageBitmap | HTMLImageElement | null | undefined
>

/**
 * The accumulator part-way up the stack, so an edit high in the stack does not
 * re-run the generators beneath it.
 *
 * `index` is the number of layers already folded in, so a checkpoint is only
 * reusable for a recipe whose first `index` layers are unchanged. The caller
 * owns that comparison (see `stackKeys`), because only it knows whether the
 * assets behind an image layer also held still.
 */
export interface Checkpoint {
  index: number
  buffer: PixelBuffer
}

export interface RenderRequest {
  recipe: Recipe
  assets?: RenderAssets
  /**
   * 1 = export resolution. Previews render smaller; every spatial param is
   * multiplied by this so the result stays a faithful miniature.
   */
  scale?: number
  /** Resume from here instead of rendering the stack from the ground up. */
  resume?: Checkpoint | null
  /** Snapshot the accumulator before this layer index, for the next render. */
  captureAt?: number
}

export interface StackResult {
  buffer: PixelBuffer
  /** Present only when `captureAt` was reachable in this render. */
  captured: Checkpoint | null
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: AnyCanvas): AnyCtx {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas context unavailable')
  return ctx
}

function envFor(recipe: Recipe, scale: number): RenderEnv {
  return {
    scale,
    width: Math.max(1, Math.round(recipe.canvas.width * scale)),
    height: Math.max(1, Math.round(recipe.canvas.height * scale)),
  }
}

/**
 * The ground the stack is built on: opaque, canvas-sized, recipe-coloured.
 *
 * Opaque matters more than the colour. Every effect transforms RGB and ignores
 * alpha, so a transparent ground would have them treating empty space as black
 * — dither in the margins, haloes around anything that does not fill the
 * frame. Source layers still blend by their own alpha, so compositing stays
 * honest; only the bottom of the stack is guaranteed solid.
 */
function groundBuffer(recipe: Recipe, env: RenderEnv): PixelBuffer {
  const buffer = createBuffer(env.width, env.height)
  const { r, g, b } = hexToRgb(recipe.background)
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)
  const data = buffer.data

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lr
    data[i + 1] = lg
    data[i + 2] = lb
    data[i + 3] = 1
  }

  return buffer
}

/**
 * A source layer's own pixels, at accumulator size.
 *
 * `null` means "nothing to composite" rather than "transparent": an image
 * layer whose asset never arrived is a missing source, and skipping it leaves
 * the layers beneath it visible instead of punching a hole through them.
 */
function renderSourceLayer(
  layer: Layer,
  env: RenderEnv,
  assets: RenderAssets,
): PixelBuffer | null {
  if (layer.kind === 'generator') {
    return renderField(layer.params, env)
  }

  if (layer.kind === 'image') {
    const bitmap = assets[layer.asset]
    if (!bitmap) return null

    const canvas = createCanvas(env.width, env.height)
    const ctx = context2d(canvas)
    const box = placeImage(layer.params, bitmap.width, bitmap.height, env)

    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bitmap, box.x, box.y, box.width, box.height)
    return fromImageData(ctx.getImageData(0, 0, env.width, env.height))
  }

  if (layer.kind === 'text') {
    return renderTextLayer(layer.params, env)
  }

  return null
}

/**
 * Walk the stack, optionally resuming from and capturing a checkpoint.
 *
 * Most callers want `renderRecipe`; this is the form the preview path uses to
 * keep a slider drag from re-running the generators underneath it.
 */
export function renderStack(request: RenderRequest): StackResult {
  const { recipe } = request
  const env = envFor(recipe, request.scale ?? 1)
  const assets = request.assets ?? {}
  const layers = recipe.layers
  const captureAt = request.captureAt

  // A checkpoint is only usable if it fits the current render *and* stops at
  // or before the first layer this render is allowed to change.
  const resume = request.resume
  const resumable =
    resume &&
    resume.index >= 0 &&
    resume.index <= layers.length &&
    resume.buffer.width === env.width &&
    resume.buffer.height === env.height &&
    (captureAt === undefined || resume.index <= captureAt)
      ? resume
      : null

  const buffer = resumable
    ? cloneBuffer(resumable.buffer)
    : groundBuffer(recipe, env)
  let captured: Checkpoint | null = null

  for (let index = resumable ? resumable.index : 0; index < layers.length; index++) {
    if (index === captureAt) captured = { index, buffer: cloneBuffer(buffer) }

    const layer = layers[index]
    if (!layer.enabled) continue

    if (layer.kind === 'effect') {
      const definition = EFFECTS[layer.type]
      // The pass gets its own copy so the original survives as the blend base.
      const output = definition.apply(cloneBuffer(buffer), layer.params, env)
      compositeInto(
        buffer,
        output,
        layer.opacity,
        layer.blendMode,
        layer.mask,
        'full',
        layer.shape,
      )
      continue
    }

    const pixels = renderSourceLayer(layer, env, assets)
    if (!pixels) continue
    compositeInto(
      buffer,
      pixels,
      layer.opacity,
      layer.blendMode,
      layer.mask,
      'alpha',
      layer.shape,
    )
  }

  // A capture point past the last layer is still a valid checkpoint: it is the
  // finished image, reusable the moment a layer is appended.
  if (captureAt === layers.length) {
    captured = { index: layers.length, buffer: cloneBuffer(buffer) }
  }

  return { buffer, captured }
}

/** Full render of the stack, ground up. */
export function renderRecipe(request: RenderRequest): PixelBuffer {
  return renderStack(request).buffer
}

/**
 * Per-layer identity for the checkpoint cache.
 *
 * An image layer's pixels live outside the recipe, so its key has to include
 * whatever the caller uses to identify the asset — without it, swapping the
 * file behind a handle would reuse a stale checkpoint.
 */
export function stackKeys(
  recipe: Recipe,
  assetKeys: Record<string, string> = {},
): Array<string> {
  return recipe.layers.map((layer) =>
    layer.kind === 'image'
      ? `${JSON.stringify(layer)}|${assetKeys[layer.asset] ?? 'missing'}`
      : JSON.stringify(layer),
  )
}

/** How many leading layers are untouched between two renders. */
export function commonPrefix(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number {
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a[index] === b[index]) index++
  return index
}

/** Put a rendered buffer onto a canvas, resizing it to match. */
export function putBuffer(
  canvas: HTMLCanvasElement,
  buffer: PixelBuffer,
): void {
  const image = toImageData(buffer)
  if (canvas.width !== image.width || canvas.height !== image.height) {
    canvas.width = image.width
    canvas.height = image.height
  }
  context2d(canvas).putImageData(image, 0, 0)
}

/** Full-resolution render encoded as a PNG blob. */
export async function renderToPngBlob(
  request: Omit<RenderRequest, 'scale' | 'resume' | 'captureAt'>,
): Promise<Blob> {
  const image = toImageData(renderRecipe({ ...request, scale: 1 }))
  const canvas = createCanvas(image.width, image.height)
  context2d(canvas).putImageData(image, 0, 0)

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' })
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG encoding failed'))
    }, 'image/png')
  })
}
