import { useEffect, useMemo, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import {
  createLocalSnapshot,
  loadLocalSnapshots,
  saveLocalSnapshots,
} from '#/app/localSnapshots'
import { PRESETS, recipeFromPreset } from '#/renderer/presets'
import type { Preset } from '#/renderer/presets'
import { renderRecipe } from '#/renderer/renderRecipe'
import { toImageData } from '#/renderer/buffer'
import { BookmarkPlus, Trash2 } from 'lucide-react'
import type { Recipe } from '#/renderer/types'
import type { LocalSnapshot } from '#/app/localSnapshots'

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
const CURATED_THUMB_SIZE = { width: 1080, height: 1350 }

function RecipeButton({
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
        const scale = Math.min(
          THUMB_WIDTH / recipe.canvas.width,
          THUMB_HEIGHT / recipe.canvas.height,
        )
        setFailed(false)
        const image = toImageData(
          renderRecipe({
            recipe,
            scale,
          }),
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
  }, [recipe])

  return (
    <div className="group relative flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={onApply}
        title={name}
        aria-label={`Apply ${name} preset`}
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

function CuratedPresetButton({
  preset,
  onApply,
}: {
  preset: Preset
  onApply: (preset: Preset) => void
}) {
  const recipe = useMemo(
    () => recipeFromPreset(preset, CURATED_THUMB_SIZE),
    [preset],
  )
  return (
    <RecipeButton
      name={preset.name}
      recipe={recipe}
      onApply={() => onApply(preset)}
    />
  )
}

export function PresetStrip() {
  const recipe = useLab((state) => state.recipe)
  const setRecipe = useLab((state) => state.setRecipe)
  const [snapshots, setSnapshots] = useState<Array<LocalSnapshot>>([])
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    setSnapshots(loadLocalSnapshots())
  }, [])

  const persistSnapshots = (next: Array<LocalSnapshot>) => {
    setSnapshots(next)
    saveLocalSnapshots(next)
  }

  const apply = (preset: Preset) => {
    // Keep the canvas the user chose; a preset is a look, not a format.
    setRecipe(recipeFromPreset(preset, recipe.canvas))
  }

  const saveCurrent = () => {
    const snapshot = createLocalSnapshot(
      recipe,
      nameDraft || `Preset ${snapshots.length + 1}`,
    )
    persistSnapshots([snapshot, ...snapshots])
    setNameDraft('')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="ff-label">My Presets</span>
          <span className="ff-value">{snapshots.length}</span>
        </div>
        <div className="flex gap-1.5">
          <input
            className="ff-input"
            value={nameDraft}
            placeholder={`Preset ${snapshots.length + 1}`}
            maxLength={64}
            aria-label="Preset name"
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveCurrent()
            }}
          />
          <button
            type="button"
            className="ff-btn ff-btn-icon"
            title="Save local preset"
            aria-label="Save local preset"
            onClick={saveCurrent}
          >
            <BookmarkPlus size={13} />
          </button>
        </div>
        {snapshots.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {snapshots.map((snapshot) => (
              <RecipeButton
                key={snapshot.id}
                name={snapshot.name}
                recipe={snapshot.recipe}
                onApply={() => setRecipe(snapshot.recipe)}
                onDelete={() =>
                  persistSnapshots(
                    snapshots.filter((entry) => entry.id !== snapshot.id),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="ff-label">Generic Presets</span>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => (
            <CuratedPresetButton
              key={preset.id}
              preset={preset}
              onApply={apply}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
