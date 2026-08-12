import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_MIN,
  clampPanelWidth,
  loadPanelLayout,
  savePanelLayout,
} from './panelLayout'

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

describe('panel layout', () => {
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

  it('round-trips a layout', () => {
    expect(savePanelLayout({ left: 300, right: 220 })).toBe(true)
    expect(loadPanelLayout()).toEqual({ left: 300, right: 220 })
  })

  it('defaults when nothing is stored', () => {
    expect(loadPanelLayout()).toEqual(DEFAULT_PANEL_LAYOUT)
  })

  /**
   * The stored value is user-editable and survives across releases, so a width
   * from a wider window — or a hand-edited one — must not be able to squeeze
   * the canvas out of existence.
   */
  it('clamps stored widths into range', () => {
    savePanelLayout({ left: 5000, right: 1 })
    expect(loadPanelLayout()).toEqual({ left: PANEL_MAX, right: PANEL_MIN })
  })

  it('falls back per side on a malformed entry', () => {
    localStorage.setItem(
      'framefield.panelLayout.v1',
      JSON.stringify({ left: 320, right: 'wide' }),
    )
    expect(loadPanelLayout()).toEqual({ left: 320, right: PANEL_DEFAULT })
  })

  it('survives junk rather than throwing', () => {
    for (const junk of ['', 'not json', '[]', 'null', '42']) {
      localStorage.setItem('framefield.panelLayout.v1', junk)
      expect(() => loadPanelLayout()).not.toThrow()
      expect(loadPanelLayout()).toEqual(DEFAULT_PANEL_LAYOUT)
    }
  })

  it('reports a failed write instead of pretending', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        ...new MemoryStorage(),
        setItem() {
          throw new DOMException('quota', 'QuotaExceededError')
        },
      },
      configurable: true,
    })
    expect(savePanelLayout({ left: 300, right: 300 })).toBe(false)
  })

  describe('clampPanelWidth', () => {
    it('holds the range and rounds to whole pixels', () => {
      expect(clampPanelWidth(PANEL_MIN - 50)).toBe(PANEL_MIN)
      expect(clampPanelWidth(PANEL_MAX + 50)).toBe(PANEL_MAX)
      expect(clampPanelWidth(300.4)).toBe(300)
    })

    it('rejects non-finite values', () => {
      expect(clampPanelWidth(Number.NaN)).toBe(PANEL_DEFAULT)
      expect(clampPanelWidth(Number.POSITIVE_INFINITY)).toBe(PANEL_DEFAULT)
    })
  })
})
