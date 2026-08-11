import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import { putBuffer, renderRecipe, renderSource } from '#/renderer/renderRecipe'
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
function useSourceBitmap(imageUrl: string | null) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)

  useEffect(() => {
    if (!imageUrl) {
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
  }, [imageUrl])

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

/**
 * Preview resolution.
 *
 * Capped by total pixels rather than by a fixed scale so a Story export
 * (1080x1920) and a Landscape one (1200x630) cost roughly the same to preview.
 * Never upscales past 1 — rendering above export resolution would be waste.
 *
 * The budget is what keeps slider drags responsive while the pipeline is still
 * synchronous: every pass is O(pixels), so this is the one number that trades
 * preview sharpness against frame cost. Raise it once rendering moves into a
 * worker (ADR Decision 5).
 */
const PREVIEW_PIXEL_BUDGET = 420_000

function previewScale(recipe: Recipe, boxWidth: number, boxHeight: number) {
  if (boxWidth <= 0 || boxHeight <= 0) return 0.5

  const fit = Math.min(
    boxWidth / recipe.canvas.width,
    boxHeight / recipe.canvas.height,
  )
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const budget = Math.sqrt(
    PREVIEW_PIXEL_BUDGET / (recipe.canvas.width * recipe.canvas.height),
  )

  return Math.max(0.08, Math.min(1, fit * dpr, budget))
}

export function CanvasViewport() {
  const recipe = useLab((state) => state.recipe)
  const imageUrl = useLab((state) => state.imageUrl)
  const comparing = useLab((state) => state.comparing)
  const bitmap = useSourceBitmap(imageUrl)

  const [boxRef, box] = useElementSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [renderMs, setRenderMs] = useState(0)

  const missingSource = recipe.source.type === 'image' && !bitmap && !imageUrl

  const scale = previewScale(recipe, box.width, box.height)

  /**
   * Source cache. Effect params change constantly while dragging, but none of
   * them affect the source — so the generator pass is memoized against the
   * things that actually do change it. The cache lives here rather than in the
   * renderer so the renderer stays a pure function of its inputs.
   */
  const sourceKey = `${JSON.stringify(recipe.source)}|${recipe.canvas.width}x${recipe.canvas.height}|${scale.toFixed(4)}|${bitmap ? 'bmp' : 'none'}`
  const sourceRef = useRef<{ key: string; image: PixelBuffer } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || box.width === 0) return

    // Coalesce: only the most recent request survives to the next frame.
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const start = performance.now()

      if (sourceRef.current?.key !== sourceKey) {
        sourceRef.current = {
          key: sourceKey,
          image: renderSource({ recipe, bitmap, scale }),
        }
      }
      const sourceImage = sourceRef.current.image

      const image = comparing
        ? sourceImage
        : renderRecipe({ recipe, bitmap, scale, sourceImage })
      putBuffer(canvas, image)

      setRenderMs(performance.now() - start)
    })

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [recipe, bitmap, comparing, box.width, scale, sourceKey])

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
              // Nearest-neighbour: dither and pixel structure must not be
              // smoothed away by the browser's downscale.
              imageRendering: 'pixelated',
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

          {comparing && (
            <div
              className="absolute top-2 left-2 px-1.5 py-1"
              style={{ background: 'var(--color-void)' }}
            >
              <span
                className="ff-label"
                style={{ color: 'var(--color-signal)' }}
              >
                Source
              </span>
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
          <span className="ff-value">{Math.round(scale * 100)}% preview</span>
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
