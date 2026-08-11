import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import { putBuffer, renderRecipe, renderSource } from '#/renderer/renderRecipe'
import {
  previewRequestScales,
  SETTLED_PREVIEW_DELAY_MS,
} from './previewScale'
import type { PixelBuffer } from '#/renderer/buffer'
import type { Recipe } from '#/renderer/types'
import { ImageOff } from 'lucide-react'

/**
 * The preview surface.
 *
 * Rendering is deliberately outside React's control flow: the component never
 * puts pixels in state, it just asks the renderer to paint into a canvas it
 * owns. Work is coalesced into one animation frame so a slider drag emitting
 * dozens of updates still renders once per frame (ADR Decision 5's stopgap
 * until the pass moves into a worker).
 */

/** Decode the imported file once and keep the bitmap out of the store. */
function useSourceBitmap(imageUrl: string | null, enabled: boolean) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)

  useEffect(() => {
    if (!enabled || !imageUrl) {
      setBitmap(null)
      return
    }

    let cancelled = false
    let created: ImageBitmap | null = null

    fetch(imageUrl)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .then((result) => {
        if (cancelled) {
          result.close()
          return
        }
        created = result
        setBitmap(result)
      })
      .catch(() => setBitmap(null))

    return () => {
      cancelled = true
      created?.close()
    }
  }, [enabled, imageUrl])

  return bitmap
}

/** Track the available box so the preview can size itself to it. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: box.width, height: box.height })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}

type PreviewMessage = {
  kind: 'preview'
  id: number
  scale: number
  image: ImageData
  renderMs: number
}

type WorkerMessage =
  | PreviewMessage
  | { kind: 'export'; id: number; blob: Blob; renderMs: number }
  | { kind: 'error'; id: number; error: string }

function sourceKeyFor(recipe: Recipe, scale: number, imageUrl: string | null) {
  return `${JSON.stringify(recipe.source)}|${recipe.canvas.width}x${recipe.canvas.height}|${scale.toFixed(4)}|${imageUrl ?? 'none'}`
}

export function CanvasViewport() {
  const recipe = useLab((state) => state.recipe)
  const imageUrl = useLab((state) => state.imageUrl)

  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const settledWorkerRef = useRef<Worker | null>(null)
  const settledTimerRef = useRef<number | null>(null)
  const latestWorkerIdRef = useRef(0)
  const [workerReady, setWorkerReady] = useState(false)
  const [renderMs, setRenderMs] = useState(0)
  const [paintedScale, setPaintedScale] = useState(0)
  const bitmap = useSourceBitmap(imageUrl, !workerReady)

  const missingSource = recipe.source.type === 'image' && !bitmap && !imageUrl

  const { interactive: interactiveScale, settled: settledScale } =
    previewRequestScales(recipe, box.width, box.height, workerReady)

  const paintPreview = (message: PreviewMessage) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (
      canvas.width !== message.image.width ||
      canvas.height !== message.image.height
    ) {
      canvas.width = message.image.width
      canvas.height = message.image.height
    }
    canvas.getContext('2d')?.putImageData(message.image, 0, 0)
    setPaintedScale(message.scale)
    setRenderMs(message.renderMs)
  }

  const cancelSettledPreview = () => {
    if (settledTimerRef.current !== null) {
      window.clearTimeout(settledTimerRef.current)
      settledTimerRef.current = null
    }
    settledWorkerRef.current?.terminate()
    settledWorkerRef.current = null
  }

  useEffect(() => {
    if (typeof Worker === 'undefined') return

    const worker = new Worker(
      new URL('../renderer/render.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    setWorkerReady(true)

    worker.onmessage = (
      event: MessageEvent<WorkerMessage>,
    ) => {
      const message = event.data
      if (message.id !== latestWorkerIdRef.current) return

      if (message.kind === 'error') {
        worker.terminate()
        workerRef.current = null
        setWorkerReady(false)
        return
      }
      if (message.kind !== 'preview') return

      paintPreview(message)
    }

    return () => {
      cancelSettledPreview()
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  /**
   * Source cache. Effect params change constantly while dragging, but none of
   * them affect the source — so the generator pass is memoized against the
   * things that actually do change it. The cache lives here rather than in the
   * renderer so the renderer stays a pure function of its inputs.
   */
  const sourceRef = useRef<{ key: string; image: PixelBuffer } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || box.width === 0) return

    // Coalesce: only the most recent request survives to the next frame.
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null

      if (workerReady && workerRef.current) {
        latestWorkerIdRef.current += 1
        const id = latestWorkerIdRef.current
        workerRef.current.postMessage({
          kind: 'preview',
          id,
          recipe,
          scale: interactiveScale,
          sourceKey: sourceKeyFor(recipe, interactiveScale, imageUrl),
          imageUrl,
        })

        if (settledScale > interactiveScale + 0.001) {
          settledTimerRef.current = window.setTimeout(() => {
            settledWorkerRef.current?.terminate()
            const settledWorker = new Worker(
              new URL('../renderer/render.worker.ts', import.meta.url),
              { type: 'module' },
            )
            settledWorkerRef.current = settledWorker
            latestWorkerIdRef.current += 1
            const settledId = latestWorkerIdRef.current

            settledWorker.onmessage = (event: MessageEvent<WorkerMessage>) => {
              const message = event.data
              if (message.id !== latestWorkerIdRef.current) return
              if (message.kind === 'preview') paintPreview(message)
              settledWorker.terminate()
              if (settledWorkerRef.current === settledWorker) {
                settledWorkerRef.current = null
              }
            }
            settledWorker.onerror = () => {
              settledWorker.terminate()
              if (settledWorkerRef.current === settledWorker) {
                settledWorkerRef.current = null
              }
            }
            settledWorker.postMessage({
              kind: 'preview',
              id: settledId,
              recipe,
              scale: settledScale,
              sourceKey: sourceKeyFor(recipe, settledScale, imageUrl),
              imageUrl,
            })
          }, SETTLED_PREVIEW_DELAY_MS)
        }
        return
      }

      const start = performance.now()
      const sourceKey = sourceKeyFor(recipe, interactiveScale, imageUrl)

      if (sourceRef.current?.key !== sourceKey) {
        sourceRef.current = {
          key: sourceKey,
          image: renderSource({ recipe, bitmap, scale: interactiveScale }),
        }
      }
      const sourceImage = sourceRef.current.image

      const image = renderRecipe({
        recipe,
        bitmap,
        scale: interactiveScale,
        sourceImage,
      })
      putBuffer(canvas, image)

      setPaintedScale(interactiveScale)
      setRenderMs(performance.now() - start)
    })

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      cancelSettledPreview()
    }
  }, [
    recipe,
    bitmap,
    box.width,
    box.height,
    interactiveScale,
    settledScale,
    workerReady,
    imageUrl,
  ])

  const aspect = recipe.canvas.width / recipe.canvas.height

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={boxRef}
        className="relative flex min-h-0 flex-1 items-center justify-center p-6"
      >
        <div
          className="relative max-h-full max-w-full"
          style={{
            aspectRatio: aspect,
            width: aspect >= 1 ? '100%' : 'auto',
            height: aspect >= 1 ? 'auto' : '100%',
          }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full object-contain"
            style={{
              // Worker previews render high enough to be downsampled like the
              // exported PNG in an image viewer. The fallback path keeps
              // nearest-neighbour display because it renders fewer pixels.
              imageRendering:
                workerReady && paintedScale >= 0.9 ? 'auto' : 'pixelated',
              boxShadow: '0 0 0 1px var(--color-line), 0 24px 60px -20px #000',
            }}
          />

          {missingSource && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <ImageOff size={20} color="var(--color-faint)" />
              <p className="ff-label">Source image missing</p>
              <p className="ff-value max-w-[24ch] leading-relaxed">
                This recipe was shared with an imported image. Import one to
                apply the stack.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Status strip: resolution, preview scale, and frame cost. Cheap
          performance feedback right where the work happens. */}
      <div
        className="flex shrink-0 items-center justify-between gap-4 border-t px-4 py-2"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <span className="ff-value">
          {recipe.canvas.width} × {recipe.canvas.height}
        </span>
        <div className="flex items-center gap-4">
          <span className="ff-value">
            {Math.round((paintedScale || interactiveScale) * 100)}% preview
          </span>
          <span
            className="ff-value"
            style={{ color: renderMs > 16 ? 'var(--color-signal)' : undefined }}
          >
            {renderMs.toFixed(1)} ms
          </span>
        </div>
      </div>
    </div>
  )
}
