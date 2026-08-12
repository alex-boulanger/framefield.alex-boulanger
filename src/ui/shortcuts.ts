/**
 * The keyboard map, declared once.
 *
 * Handlers live where their action lives — export in `ExportPanel`, the rest in
 * `Lab` — but every key literal is written here and nowhere else, and the help
 * overlay renders from this same table. A shortcut that works but is not listed,
 * or listed but does not work, is the pixel-sort default failure again: two
 * spellings of one fact, free to drift.
 */

import { useEffect, useState } from 'react'

export interface Shortcut {
  /** `event.key`, lowercased. */
  key: string
  label: string
  /** Requires cmd/ctrl. */
  mod?: boolean
  shift?: boolean
  /** Active only while held, rather than toggled on press. */
  hold?: boolean
}

export const SHORTCUTS = {
  undo: { key: 'z', mod: true, label: 'Undo' },
  redo: { key: 'z', mod: true, shift: true, label: 'Redo' },
  newArtwork: { key: 'n', label: 'New blank artwork' },
  remix: { key: 'r', label: 'Remix the stack' },
  randomizeFx: { key: 'f', label: 'Randomize effects only' },
  compare: { key: 'c', hold: true, label: 'Compare with untreated source' },
  solo: { key: 's', label: 'Solo the selected layer' },
  exportPng: { key: 'e', label: 'Export PNG' },
  copyLink: { key: 'l', label: 'Copy share link' },
  help: { key: '?', label: 'Show this list' },
} satisfies Record<string, Shortcut>

export type ShortcutName = keyof typeof SHORTCUTS

/**
 * Whether an event fires a shortcut.
 *
 * `mod`/`shift` are checked in both directions: without that, plain `R` would
 * also fire on `Cmd+R` and steal the browser's reload.
 */
export function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const mod = event.metaKey || event.ctrlKey
  if (Boolean(shortcut.mod) !== mod) return false
  // `?` is a shifted character, so its own shift state is whatever the layout
  // needed to type it — only constrain shift when the binding cares.
  if (shortcut.shift !== undefined && shortcut.shift !== event.shiftKey) {
    return false
  }
  if (shortcut.shift === undefined && shortcut.key !== '?' && event.shiftKey) {
    return false
  }
  return event.key.toLowerCase() === shortcut.key
}

/** True while the user is typing, when shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  )
}

/**
 * Printable form for the overlay and button tooltips.
 *
 * `apple` is a parameter rather than a module constant read from `navigator`,
 * and that is not a style preference — the app is prerendered. A module-level
 * `navigator.platform` check renders `Ctrl+Z` on the server and `⌘Z` on the
 * client, and React treats the difference as a hydration mismatch. It then
 * discards the prerendered tree and rebuilds it, which detaches the nodes the
 * *already-attached* refs point at. The visible symptom was nowhere near here:
 * the preview's `ResizeObserver` stayed bound to an orphaned element, reported
 * a width of 0 forever, and the canvas never rendered at all.
 *
 * Use `useShortcutHint` in components so the platform is applied after mount.
 */
export function shortcutHint(shortcut: Shortcut, apple = false): string {
  const parts: Array<string> = []
  if (shortcut.mod) parts.push(apple ? '⌘' : 'Ctrl')
  if (shortcut.shift) parts.push(apple ? '⇧' : 'Shift')
  parts.push(shortcut.key === '?' ? '?' : shortcut.key.toUpperCase())
  const combo = parts.join(apple ? '' : '+')
  return shortcut.hold ? `${combo} (hold)` : combo
}

/**
 * Format shortcuts for the current platform, safely across hydration.
 *
 * Starts non-Apple so the first client render matches the prerendered HTML
 * exactly, then upgrades in an effect. The upgrade is an ordinary post-mount
 * update, which React is happy with; it is only a *mismatch during hydration*
 * that is destructive.
 */
export function useShortcutHint(): (shortcut: Shortcut) => string {
  const [apple, setApple] = useState(false)

  useEffect(() => {
    setApple(/Mac|iPhone|iPad/.test(navigator.platform))
  }, [])

  return (shortcut: Shortcut) => shortcutHint(shortcut, apple)
}
