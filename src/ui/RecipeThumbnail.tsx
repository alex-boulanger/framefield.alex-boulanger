import { useEffect, useRef, useState } from 'react'
import { renderRecipe } from '#/renderer/renderRecipe'
import { toImageData } from '#/renderer/buffer'
import { ensureFonts } from '#/renderer/fonts'
import { Trash2 } from 'lucide-react'
import type { Recipe } from '#/renderer/types'

/**
 * A recipe rendered small enough to choose from.
 *
 * Produced by the real pipeline rather than shipped as an image: it cannot
 * drift out of sync with the effects, and it costs nothing to point at a new
 * recipe. Shared by the preset strip and the variation grid so there is one
 * answer to how a thumbnail is rendered and deferred.
 */

// Three per row in a 208px content column, and two per row in the variation
// grid. Smaller than this and the fine-screen recipes (halftone, blue-noise
// dither) read as flat grey.
export const THUMB_WIDTH = 64
export const THUMB_HEIGHT = 80

export function RecipeThumbnail({
  name,
  recipe,
  onApply,
  onDelete,
}: {
  name: string
  recipe: Recipe
  onApply: () => void
  onDelete?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Deferred to idle: a dozen thumbnails at first paint would compete with
    // the main preview, which is the thing the user is actually waiting for.
    const schedule =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (fn: () => void) => setTimeout(fn, 60)

    let cancelled = false

    const handle = schedule(async () => {
      // A thumbnail of a text recipe drawn in the fallback face is a thumbnail
      // of a different recipe, so the faces are worth the extra tick.
      await ensureFonts()
      if (cancelled) return

      try {
        /**
         * Rendered as a true miniature: full canvas size, scaled down.
         *
         * Building the recipe at thumbnail dimensions instead would leave
         * spatial params at export scale — a 12px pixelate cell is a quarter
         * of a 52px thumbnail, which flattened the Low-res preset to a single
         * solid colour. Going through `scale` is exactly what the export-space
         * param convention exists for.
         */
        const scale = Math.min(
          THUMB_WIDTH / recipe.canvas.width,
          THUMB_HEIGHT / recipe.canvas.height,
        )
        setFailed(false)
        const image = toImageData(renderRecipe({ recipe, scale }))
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext('2d')?.putImageData(image, 0, 0)
      } catch {
        setFailed(true)
      }
    })

    return () => {
      cancelled = true
      if (
        typeof cancelIdleCallback === 'function' &&
        typeof handle === 'number'
      ) {
        cancelIdleCallback(handle)
      }
    }
  }, [recipe])

  return (
    <div className="group relative flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={onApply}
        title={name}
        aria-label={`Apply ${name}`}
        className="flex min-w-0 cursor-pointer flex-col gap-1"
      >
        <canvas
          ref={canvasRef}
          width={THUMB_WIDTH}
          height={THUMB_HEIGHT}
          className="block w-full border transition-colors"
          style={{
            borderColor: 'var(--color-line)',
            background: 'var(--color-void)',
            height: 'auto',
            imageRendering: 'pixelated',
          }}
        />
        <span
          className="ff-label truncate text-center transition-colors group-hover:text-[var(--color-signal)]"
          style={{ fontSize: 9 }}
        >
          {failed ? '-' : name}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          title="Delete preset"
          aria-label={`Delete ${name}`}
          onClick={onDelete}
          className="absolute top-1 right-1 flex h-5 w-5 cursor-pointer items-center justify-center border opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          style={{
            color: 'var(--color-faint)',
            borderColor: 'var(--color-line)',
            background: 'var(--color-shell)',
          }}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}
