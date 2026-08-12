import { useEffect, useMemo, useState } from 'react'
import { useLab } from '#/app/store'
import {
  createLocalSnapshot,
  loadLocalSnapshots,
  saveLocalSnapshots,
} from '#/app/localSnapshots'
import { PRESETS, recipeFromPreset } from '#/renderer/presets'
import type { Preset } from '#/renderer/presets'
import { RecipeThumbnail } from './RecipeThumbnail'
import { BookmarkPlus } from 'lucide-react'
import type { LocalSnapshot } from '#/app/localSnapshots'

/**
 * Curated starting points, rendered live.
 *
 * Thumbnails are produced by the real pipeline rather than shipped as images:
 * they cannot drift out of sync with the effects, they cost nothing to add,
 * and at this size the whole strip is cheaper than one preview frame.
 */

const CURATED_THUMB_SIZE = { width: 1080, height: 1350 }

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
    <RecipeThumbnail
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSnapshots(loadLocalSnapshots())
  }, [])

  /**
   * Adopt what was stored, not what was asked for.
   *
   * On failure the list is left alone deliberately: showing a preset that is
   * not on disk is worse than not appearing to save, because the user finds out
   * on reload with the recipe long gone.
   */
  const persistSnapshots = (next: Array<LocalSnapshot>) => {
    const stored = saveLocalSnapshots(next)
    if (!stored) {
      setError('Could not save — browser storage is full or unavailable')
      return false
    }
    setSnapshots(stored)
    setError(null)
    return true
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
    if (persistSnapshots([snapshot, ...snapshots])) setNameDraft('')
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
        {error && (
          <span
            className="ff-value leading-relaxed"
            role="status"
            style={{ fontSize: 10, color: 'var(--color-signal)' }}
          >
            {error}
          </span>
        )}
        {snapshots.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {snapshots.map((snapshot) => (
              <RecipeThumbnail
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
