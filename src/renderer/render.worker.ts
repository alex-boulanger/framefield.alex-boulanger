import { toImageData } from './buffer'
import { renderRecipe, renderSource, renderToPngBlob } from './renderRecipe'
import type { PixelBuffer } from './buffer'
import type { Recipe } from './types'

interface PreviewRequest {
  kind: 'preview'
  id: number
  recipe: Recipe
  scale: number
  sourceKey: string
  imageUrl: string | null
}

interface ExportRequest {
  kind: 'export'
  id: number
  recipe: Recipe
  imageUrl: string | null
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

let sourceCache: { key: string; image: PixelBuffer } | null = null
let bitmapCache: { url: string; bitmap: ImageBitmap } | null = null

async function bitmapFor(url: string | null): Promise<ImageBitmap | null> {
  if (!url) {
    bitmapCache?.bitmap.close()
    bitmapCache = null
    return null
  }

  if (bitmapCache?.url === url) return bitmapCache.bitmap

  bitmapCache?.bitmap.close()
  const blob = await fetch(url).then((response) => response.blob())
  const bitmap = await createImageBitmap(blob)
  bitmapCache = { url, bitmap }
  return bitmap
}

self.onmessage = async (event: MessageEvent<RenderWorkerRequest>) => {
  const request = event.data

  try {
    const start = performance.now()
    const bitmap = await bitmapFor(request.imageUrl)

    if (request.kind === 'export') {
      const blob = await renderToPngBlob({ recipe: request.recipe, bitmap })
      self.postMessage({
        kind: 'export',
        id: request.id,
        blob,
        renderMs: performance.now() - start,
      } satisfies RenderWorkerResponse)
      return
    }

    if (sourceCache?.key !== request.sourceKey) {
      sourceCache = {
        key: request.sourceKey,
        image: renderSource({
          recipe: request.recipe,
          bitmap,
          scale: request.scale,
        }),
      }
    }

    const image = toImageData(
      renderRecipe({
        recipe: request.recipe,
        bitmap,
        scale: request.scale,
        sourceImage: sourceCache.image,
      }),
    )

    self.postMessage({
      kind: 'preview',
      id: request.id,
      scale: request.scale,
      image,
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
