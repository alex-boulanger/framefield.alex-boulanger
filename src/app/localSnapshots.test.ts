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

  it('drops snapshots with invalid recipes', () => {
    localStorage.setItem(
      'framefield.localSnapshots.v1',
      JSON.stringify([{ id: 'bad', name: 'Bad', recipe: { version: 99 } }]),
    )

    expect(loadLocalSnapshots()).toEqual([])
  })
})
