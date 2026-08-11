import { useEffect, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import { PRESETS, recipeFromPreset } from '#/renderer/presets'
import type { Preset } from '#/renderer/presets'
import { renderRecipe } from '#/renderer/renderRecipe'
import { toImageData } from '#/renderer/buffer'

/**
 * Curated starting points, rendered live.
 *
 * Thumbnails are produced by the real pipeline rather than shipped as images:
 * they cannot drift out of sync with the effects, they cost nothing to add,
 * and at this size the whole strip is cheaper than one preview frame.
 */

// Three per row in the 208px content column. Smaller than this and the
// fine-screen presets (halftone, blue-noise dither) read as flat grey.
const THUMB_WIDTH = 64
const THUMB_HEIGHT = 80

function PresetButton({
  preset,
  onApply,
}: {
  preset: Preset
  onApply: (preset: Preset) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Deferred to idle: eight thumbnails at first paint would compete with the
    // main preview, which is the thing the user is actually waiting for.
    const schedule =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (fn: () => void) => setTimeout(fn, 60)

    const handle = schedule(() => {
      try {
        /**
         * Rendered as a true miniature: full canvas size, scaled down.
         *
         * Building the recipe at thumbnail dimensions instead would leave
         * spatial params at export scale — a 12px pixelate cell is a quarter
         * of a 52px thumbnail, which flattened the Low-res preset to a single
         * solid colour. Going through `scale` is exactly what the
         * export-space param convention exists for.
         */
        const exportSize = { width: 1080, height: 1350 }
        const recipe = recipeFromPreset(preset, exportSize)
        const image = toImageData(
          renderRecipe({ recipe, scale: THUMB_WIDTH / exportSize.width }),
        )
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext('2d')?.putImageData(image, 0, 0)
      } catch {
        setFailed(true)
      }
    })

    return () => {
      if (
        typeof cancelIdleCallback === 'function' &&
        typeof handle === 'number'
      ) {
        cancelIdleCallback(handle)
      }
    }
  }, [preset])

  return (
    <button
      type="button"
      onClick={() => onApply(preset)}
      title={preset.name}
      aria-label={`Apply ${preset.name} preset`}
      className="group flex min-w-0 cursor-pointer flex-col gap-1"
    >
      <canvas
        ref={canvasRef}
        width={THUMB_WIDTH}
        height={THUMB_HEIGHT}
        className="block w-full border transition-colors"
        style={{
          borderColor: 'var(--color-line)',
          background: 'var(--color-void)',
          aspectRatio: `${THUMB_WIDTH} / ${THUMB_HEIGHT}`,
          height: 'auto',
          imageRendering: 'pixelated',
        }}
      />
      <span
        className="ff-label text-center transition-colors group-hover:text-[var(--color-signal)]"
        style={{ fontSize: 9 }}
      >
        {failed ? '—' : preset.name}
      </span>
    </button>
  )
}

export function PresetStrip() {
  const recipe = useLab((state) => state.recipe)
  const setRecipe = useLab((state) => state.setRecipe)

  const apply = (preset: Preset) => {
    // Keep the canvas the user chose; a preset is a look, not a format.
    setRecipe(recipeFromPreset(preset, recipe.canvas))
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="ff-label">Presets</span>
      {/* A fixed 3-column grid rather than wrapping flex: nine presets read as
          a 3x3 block, and the tiles stretch to the column instead of leaving a
          ragged gap when one does not fit. */}
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((preset) => (
          <PresetButton key={preset.id} preset={preset} onApply={apply} />
        ))}
      </div>
    </div>
  )
}
