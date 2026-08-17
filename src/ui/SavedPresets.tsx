import { useEffect, useState } from 'react'
import { useLab } from '#/app/store'
import {
  createLocalSnapshot,
  loadLocalSnapshots,
  saveLocalSnapshots,
} from '#/app/localSnapshots'
import { RecipeThumbnail } from './RecipeThumbnail'
import { BookmarkPlus } from 'lucide-react'
import type { LocalSnapshot } from '#/app/localSnapshots'

/**
 * The user's own saved recipes, rendered live by the real pipeline.
 *
 * This panel used to sit under a strip of a dozen curated presets. They were
 * dropped: the variation grid above answers the same question — "show me
 * somewhere to start" — from the document already on screen rather than from a
 * fixed list, and it cost twelve full stack renders on first paint to offer
 * twelve looks the user had not asked for.
 */

export function SavedPresets() {
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

  const saveCurrent = () => {
    const snapshot = createLocalSnapshot(
      recipe,
      nameDraft || `Preset ${snapshots.length + 1}`,
    )
    if (persistSnapshots([snapshot, ...snapshots])) setNameDraft('')
  }

  return (
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
  )
}
