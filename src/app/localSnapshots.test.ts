import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createLocalSnapshot,
  loadLocalSnapshots,
  saveLocalSnapshots,
} from './localSnapshots'
import { createDefaultRecipe } from '#/renderer/recipe'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('local snapshots', () => {
  const original = globalThis.localStorage

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      configurable: true,
    })
  })

  it('saves and loads recipe snapshots', () => {
    const recipe = createDefaultRecipe()
    const snapshot = createLocalSnapshot(recipe, '  My preset  ')

    saveLocalSnapshots([snapshot])

    expect(loadLocalSnapshots()).toEqual([
      {
        ...snapshot,
        name: 'My preset',
      },
    ])
  })

  it('reports failure instead of losing the save quietly', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        ...new MemoryStorage(),
        setItem() {
          throw new DOMException('quota', 'QuotaExceededError')
        },
      },
      configurable: true,
    })

    const snapshot = createLocalSnapshot(createDefaultRecipe(), 'Doomed')
    expect(saveLocalSnapshots([snapshot])).toBeNull()
  })

  it('reports the truncated list when over the cap', () => {
    const recipe = createDefaultRecipe()
    const many = Array.from({ length: 60 }, (_, index) =>
      createLocalSnapshot(recipe, `Preset ${index}`),
    )

    const stored = saveLocalSnapshots(many)

    // The caller has to be able to see that eleven were dropped, otherwise it
    // keeps rendering presets that are not on disk.
    expect(stored).toHaveLength(48)
    expect(loadLocalSnapshots()).toHaveLength(48)
    expect(stored?.[0].name).toBe('Preset 0')
  })

  it('drops snapshots with invalid recipes', () => {
    localStorage.setItem(
      'framefield.localSnapshots.v1',
      JSON.stringify([{ id: 'bad', name: 'Bad', recipe: { version: 99 } }]),
    )

    expect(loadLocalSnapshots()).toEqual([])
  })
})
