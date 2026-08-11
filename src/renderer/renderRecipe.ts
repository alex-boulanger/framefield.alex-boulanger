import { EFFECTS } from './effects'
import { renderField } from './generators/field'
import { compositeInto } from './blend'
import { cloneBuffer, createBuffer, fromImageData, toImageData } from './buffer'
import type { PixelBuffer } from './buffer'
import type { Recipe, RenderEnv } from './types'

/**
 * The pipeline. Pure with respect to React (ADR Decision 4): it takes a recipe
 * plus an optional source bitmap and produces pixels. No component state, no
 * store access, no DOM beyond the canvas it is handed.
 *
 * Everything between the source and the final encode is Float32 linear light
 * (see `buffer.ts`), so passes compose without requantizing and tone maths is
 * physically meaningful. Canvas is now touched in exactly one place — decoding
 * an imported bitmap — which leaves the generator and every effect testable in
 * plain node.
 */

export interface RenderRequest {
  recipe: Recipe
  /** Decoded bitmap for image sources. Ignored for generator sources. */
  bitmap?: ImageBitmap | HTMLImageElement | null
  /**
   * 1 = export resolution. Previews render smaller; every spatial param is
   * multiplied by this so the result stays a faithful miniature.
   */
  scale?: number
  /**
   * Pre-rendered source to start from, skipping the generator pass. Tweaking an
   * effect param does not change the source, and regenerating a field on every
   * slider tick is the most wasteful thing the pipeline can do. Ignored if its
   * dimensions do not match the request.
   */
  sourceImage?: PixelBuffer | null
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

/** Cover-fit, matching CSS `object-fit: cover`, so imports never distort. */
function drawCover(
  ctx: AnyCtx,
  bitmap: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
) {
  const scale = Math.max(width / bitmap.width, height / bitmap.height)
  const drawWidth = bitmap.width * scale
  const drawHeight = bitmap.height * scale

  ctx.drawImage(
    bitmap,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
}

/** Render just the source, before any effects — used by the compare view. */
export function renderSource(request: RenderRequest): PixelBuffer {
  const { recipe, bitmap } = request
  const env = envFor(recipe, request.scale ?? 1)

  if (recipe.source.type === 'image') {
    if (!bitmap) {
      // Missing-source state: a shared recipe that referenced an import.
      return createBuffer(env.width, env.height)
    }
    const canvas = createCanvas(env.width, env.height)
    const ctx = context2d(canvas)
    drawCover(ctx, bitmap, env.width, env.height)
    return fromImageData(ctx.getImageData(0, 0, env.width, env.height))
  }

  return renderField({ ...recipe.source.params, seed: recipe.source.seed }, env)
}

/** Full render: source, then each enabled layer composited over its input. */
export function renderRecipe(request: RenderRequest): PixelBuffer {
  const { recipe } = request
  const env = envFor(recipe, request.scale ?? 1)

  const cached = request.sourceImage
  const buffer =
    cached && cached.width === env.width && cached.height === env.height
      ? cloneBuffer(cached)
      : renderSource(request)

  for (const layer of recipe.layers) {
    if (!layer.enabled) continue
    const definition = EFFECTS[layer.type]

    // The pass gets its own copy so the original survives as the blend base.
    const output = definition.apply(cloneBuffer(buffer), layer.params, env)
    compositeInto(buffer, output, layer.opacity, layer.blendMode)
  }

  return buffer
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
  request: Omit<RenderRequest, 'scale' | 'sourceImage'>,
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
