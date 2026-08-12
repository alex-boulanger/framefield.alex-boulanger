import { describe, expect, it } from 'vitest'
import { SHORTCUTS, matches, shortcutHint } from './shortcuts'
import type { Shortcut } from './shortcuts'

/** A KeyboardEvent stand-in — `matches` only reads these four fields. */
function key(
  k: string,
  modifiers: { mod?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  return {
    key: k,
    metaKey: modifiers.mod ?? false,
    ctrlKey: false,
    shiftKey: modifiers.shift ?? false,
  } as KeyboardEvent
}

describe('matches', () => {
  it('fires a plain letter binding', () => {
    expect(matches(key('r'), SHORTCUTS.remix)).toBe(true)
    expect(matches(key('R'), SHORTCUTS.remix)).toBe(true)
  })

  /**
   * The reason `mod` is checked in both directions. Without it ⌘R would remix
   * *and* reload the page, which loses the work being remixed.
   */
  it('does not fire a plain binding when a modifier is held', () => {
    expect(matches(key('r', { mod: true }), SHORTCUTS.remix)).toBe(false)
    expect(matches(key('s', { mod: true }), SHORTCUTS.solo)).toBe(false)
    expect(matches(key('e', { mod: true }), SHORTCUTS.exportPng)).toBe(false)
  })

  it('does not fire a modified binding without the modifier', () => {
    expect(matches(key('z'), SHORTCUTS.undo)).toBe(false)
    expect(matches(key('z', { mod: true }), SHORTCUTS.undo)).toBe(true)
  })

  it('separates undo from redo by shift', () => {
    expect(matches(key('z', { mod: true }), SHORTCUTS.redo)).toBe(false)
    expect(matches(key('z', { mod: true, shift: true }), SHORTCUTS.redo)).toBe(
      true,
    )
    expect(matches(key('z', { mod: true, shift: true }), SHORTCUTS.undo)).toBe(
      false,
    )
  })

  /**
   * `?` can only be typed with shift on most layouts, so it is the one binding
   * that must not reject a shifted event.
   */
  it('fires help on a shifted question mark', () => {
    expect(matches(key('?', { shift: true }), SHORTCUTS.help)).toBe(true)
    expect(matches(key('?'), SHORTCUTS.help)).toBe(true)
  })

  it('does not let a shifted letter fire an unshifted binding', () => {
    expect(matches(key('R', { shift: true }), SHORTCUTS.remix)).toBe(false)
  })

  /**
   * Every binding must be reachable without ambiguity: no two shortcuts may
   * answer to the same event, or one of them silently never runs.
   */
  it('has no two bindings answering the same event', () => {
    const all = Object.values(SHORTCUTS) as Array<Shortcut>
    for (const shortcut of all) {
      const event = key(shortcut.key, {
        mod: shortcut.mod,
        shift: shortcut.shift ?? shortcut.key === '?',
      })
      const hits = all.filter((other) => matches(event, other))
      expect(hits, `${shortcut.label} is ambiguous`).toHaveLength(1)
    }
  })
})

describe('shortcutHint', () => {
  it('renders every binding as non-empty text', () => {
    for (const shortcut of Object.values(SHORTCUTS) as Array<Shortcut>) {
      expect(shortcutHint(shortcut).length).toBeGreaterThan(0)
    }
  })

  it('marks a held binding', () => {
    expect(shortcutHint(SHORTCUTS.compare)).toContain('hold')
  })
})
