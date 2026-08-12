/**
 * Widths of the two side panels, in CSS pixels.
 *
 * Persisted, because panel width is a working preference rather than part of
 * the artwork — it belongs beside the editor's other local state, not in the
 * recipe or the share URL.
 */

const STORAGE_KEY = 'framefield.panelLayout.v1'

export const PANEL_MIN = 200
export const PANEL_MAX = 480
/** Matches the `lg:w-64` the layout used before the panels could be resized. */
export const PANEL_DEFAULT = 256

export interface PanelLayout {
  left: number
  right: number
}

export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  left: PANEL_DEFAULT,
  right: PANEL_DEFAULT,
}

export function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return PANEL_DEFAULT
  return Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, value)))
}

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage
}

/**
 * Read the stored layout, falling back to the default for anything missing or
 * out of range.
 *
 * Must be called from an effect, never during render: the app is prerendered,
 * and a width that differs between the static HTML and the client is a
 * hydration mismatch.
 */
export function loadPanelLayout(): PanelLayout {
  const store = storage()
  if (!store) return { ...DEFAULT_PANEL_LAYOUT }

  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_PANEL_LAYOUT }
    }
    const raw = parsed as Record<string, unknown>
    const read = (value: unknown) =>
      typeof value === 'number' ? clampPanelWidth(value) : PANEL_DEFAULT

    return { left: read(raw.left), right: read(raw.right) }
  } catch {
    return { ...DEFAULT_PANEL_LAYOUT }
  }
}

/**
 * Persist the layout. Returns whether it was written.
 *
 * The caller ignores the result on purpose, unlike saved presets: a panel width
 * that fails to store costs the user a drag next session and is obvious the
 * moment they look at it, where a preset that fails to store loses work
 * silently. The boolean exists so that decision is made at the call site rather
 * than hidden in here.
 */
export function savePanelLayout(layout: PanelLayout): boolean {
  const store = storage()
  if (!store) return false

  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        left: clampPanelWidth(layout.left),
        right: clampPanelWidth(layout.right),
      }),
    )
    return true
  } catch {
    return false
  }
}
