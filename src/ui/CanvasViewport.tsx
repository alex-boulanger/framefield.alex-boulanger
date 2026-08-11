import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import {
  commonPrefix,
  putBuffer,
  renderStack,
  stackKeys,
} from '#/renderer/renderRecipe'
import {
  previewRequestScales,
  SETTLED_PREVIEW_DELAY_MS,
} from './previewScale'
import type { Checkpoint, RenderAssets } from '#/renderer/renderRecipe'
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

/**
 * Decode imported files once and keep the bitmaps out of the store.
 *
 * Only used by the no-worker fallback path — when a worker is available it
 * does its own decoding, and shipping bitmaps across the boundary on every
 * frame would cost more than the decode.
 */
function useAssetBitmaps(assets: Record<string, string>, enabled: boolean) {
  const [bitmaps, setBitmaps] = useState<RenderAssets>({})
  const key = Object.entries(assets).sort().join('|')

  useEffect(() => {
    if (!enabled) {
      setBitmaps({})
      return
    }

    let cancelled = false
    const created: Array<ImageBitmap> = []

    Promise.all(
      Object.entries(assets).map(async ([handle, url]) => {
        const blob = await fetch(url).then((response) => response.blob())
        const bitmap = await createImageBitmap(blob)
        created.push(bitmap)
        return [handle, bitmap] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setBitmaps(Object.fromEntries(entries))
      })
      .catch(() => setBitmaps({}))

    return () => {
      cancelled = true
      for (const bitmap of created) bitmap.close()
    }
    // `key` stands in for the asset map: a new object identity every render
    // would re-decode every bitmap on every frame.
  }, [enabled, key])

  return bitmaps
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

export function CanvasViewport() {
  const recipe = useLab((state) => state.recipe)
  const assets = useLab((state) => state.assets)

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
  const bitmaps = useAssetBitmaps(assets, !workerReady)

  // Per layer now, not per document: a stack can be half-rendered, with one
  // import missing and everything else composing normally.
  const missingSource = useMemo(
    () =>
      recipe.layers.some(
        (layer) =>
          layer.kind === 'image' && layer.enabled && !assets[layer.asset],
      ),
    [recipe.layers, assets],
  )

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
   * Checkpoint cache for the fallback path. Dragging a slider only invalidates
   * that layer and the ones above it, so the generators underneath are not
   * re-run on every frame. Lives here rather than in the renderer so the
   * renderer stays a pure function of its inputs.
   */
  const cacheRef = useRef<{
    keys: Array<string>
    checkpoint: Checkpoint
  } | null>(null)

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
          assets,
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
              assets,
            })
          }, SETTLED_PREVIEW_DELAY_MS)
        }
        return
      }

      const start = performance.now()

      const keys = stackKeys(recipe, assets)
      const cached = cacheRef.current
      const unchanged = cached ? commonPrefix(cached.keys, keys) : 0

      const result = renderStack({
        recipe,
        assets: bitmaps,
        scale: interactiveScale,
        resume:
          cached && cached.checkpoint.index <= unchanged
            ? cached.checkpoint
            : null,
        captureAt: unchanged,
      })

      if (result.captured) {
        cacheRef.current = { keys, checkpoint: result.captured }
      }
      putBuffer(canvas, result.buffer)

      setPaintedScale(interactiveScale)
      setRenderMs(performance.now() - start)
    })

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      cancelSettledPreview()
    }
  }, [
    recipe,
    bitmaps,
    box.width,
    box.height,
    interactiveScale,
    settledScale,
    workerReady,
    assets,
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
              <p className="ff-label">Image layer missing its file</p>
              <p className="ff-value max-w-[24ch] leading-relaxed">
                Imported pixels stay out of the recipe, so a shared or reloaded
                stack keeps the layer and loses the file. Re-import it to
                restore the composition.
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
