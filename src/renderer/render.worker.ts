import { toImageData } from './buffer'
import {
  commonPrefix,
  renderStack,
  renderToPngBlob,
  stackKeys,
} from './renderRecipe'
import type { Checkpoint, RenderAssets } from './renderRecipe'
import type { Recipe } from './types'

/** Object URLs by asset handle. The worker decodes them itself. */
type AssetUrls = Record<string, string>

interface PreviewRequest {
  kind: 'preview'
  id: number
  recipe: Recipe
  scale: number
  assets?: AssetUrls
}

interface ExportRequest {
  kind: 'export'
  id: number
  recipe: Recipe
  assets?: AssetUrls
}

type RenderWorkerRequest = PreviewRequest | ExportRequest

type RenderWorkerResponse =
  | {
      kind: 'preview'
      id: number
      scale: number
      image: ImageData
      renderMs: number
    }
  | {
      kind: 'export'
      id: number
      blob: Blob
      renderMs: number
    }
  | {
      kind: 'error'
      id: number
      error: string
    }

const bitmaps = new Map<string, ImageBitmap>()

/**
 * Decode each asset once and keep it.
 *
 * Keyed by URL rather than handle so re-importing the same file under a new
 * handle still costs one decode, and a handle pointed at new bytes is never
 * served the old ones.
 */
async function decodeAssets(urls: AssetUrls): Promise<RenderAssets> {
  const assets: RenderAssets = {}

  await Promise.all(
    Object.entries(urls).map(async ([handle, url]) => {
      let bitmap = bitmaps.get(url)
      if (!bitmap) {
        const blob = await fetch(url).then((response) => response.blob())
        bitmap = await createImageBitmap(blob)
        bitmaps.set(url, bitmap)
      }
      assets[handle] = bitmap
    }),
  )

  return assets
}

/**
 * The accumulator part-way up the stack, kept between renders.
 *
 * This is what the old source cache became. Editing one layer's params only
 * invalidates that layer and everything above it, so a slider drag high in the
 * stack never re-runs the generators underneath — which is the difference
 * between a responsive preview and a 300ms one.
 */
let cache: { keys: Array<string>; checkpoint: Checkpoint } | null = null

self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  const request = event.data

  try {
    const start = performance.now()
    const assets = await decodeAssets(request.assets ?? {})

    if (request.kind === 'export') {
      const blob = await renderToPngBlob({ recipe: request.recipe, assets })
      self.postMessage({
        kind: 'export',
        id: request.id,
        blob,
        renderMs: performance.now() - start,
      } satisfies RenderWorkerResponse)
      return
    }

    // Asset identity has to be part of the key: swapping the file behind a
    // handle changes the pixels without changing the recipe.
    const keys = stackKeys(request.recipe, request.assets ?? {})
    const unchanged = cache ? commonPrefix(cache.keys, keys) : 0
    const resume =
      cache && cache.checkpoint.index <= unchanged ? cache.checkpoint : null

    const result = renderStack({
      recipe: request.recipe,
      assets,
      scale: request.scale,
      resume,
      captureAt: unchanged,
    })

    if (result.captured) cache = { keys, checkpoint: result.captured }

    self.postMessage({
      kind: 'preview',
      id: request.id,
      scale: request.scale,
      image: toImageData(result.buffer),
      renderMs: performance.now() - start,
    } satisfies RenderWorkerResponse)
  } catch (error) {
    self.postMessage({
      kind: 'error',
      id: request.id,
      error: error instanceof Error ? error.message : 'Render failed',
    } satisfies RenderWorkerResponse)
  }
}
