import { sanitizeRecipe } from '#/renderer/recipe'
import type { Recipe } from '#/renderer/types'

const STORAGE_KEY = 'framefield.localSnapshots.v1'
const MAX_SNAPSHOTS = 48

export interface LocalSnapshot {
  id: string
  name: string
  createdAt: number
  recipe: Recipe
}

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function snapshotId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `snapshot_${Date.now().toString(36)}`
}

function cleanName(input: string) {
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'Untitled'
}

export function loadLocalSnapshots(): Array<LocalSnapshot> {
  const store = storage()
  if (!store) return []

  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((entry): Array<LocalSnapshot> => {
      if (typeof entry !== 'object' || entry === null) return []
      const raw = entry as Record<string, unknown>
      const recipe = sanitizeRecipe(raw.recipe)
      if (!recipe) return []

      return [
        {
          id: typeof raw.id === 'string' ? raw.id : snapshotId(),
          name: cleanName(typeof raw.name === 'string' ? raw.name : ''),
          createdAt:
            typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
              ? raw.createdAt
              : Date.now(),
          recipe,
        },
      ]
    })
  } catch {
    return []
  }
}

/**
 * Persist the list, and report back what is *actually* stored.
 *
 * Returns the persisted list, or `null` if nothing could be written.
 *
 * Both halves of that signature exist because the previous `void` version let
 * the UI tell two lies. Storage can be full or disabled, and the exception was
 * swallowed — so a save that never happened still cleared the name field and
 * rendered the new preset from React state, until a reload took it away. And
 * the list is capped at `MAX_SNAPSHOTS`, so a caller holding 49 in state kept
 * showing one that was never written. Returning the stored list makes the
 * caller's state answerable to what survived rather than to what it asked for.
 */
export function saveLocalSnapshots(
  snapshots: Array<LocalSnapshot>,
): Array<LocalSnapshot> | null {
  const store = storage()
  if (!store) return null

  const kept = snapshots.slice(0, MAX_SNAPSHOTS)
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(kept))
    return kept
  } catch {
    return null
  }
}

export function createLocalSnapshot(
  recipe: Recipe,
  name: string,
): LocalSnapshot {
  return {
    id: snapshotId(),
    name: cleanName(name),
    createdAt: Date.now(),
    recipe: JSON.parse(JSON.stringify(recipe)) as Recipe,
  }
}
