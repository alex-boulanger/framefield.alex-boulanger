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

export function saveLocalSnapshots(snapshots: Array<LocalSnapshot>): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS)),
    )
  } catch {
    // Local storage can be disabled or full. Saving is best-effort; the recipe
    // itself remains active in the editor either way.
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
