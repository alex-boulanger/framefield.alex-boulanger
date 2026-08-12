import { useRef } from 'react'
import {
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_MIN,
  clampPanelWidth,
} from '#/app/panelLayout'

/**
 * The drag handle between a side panel and the canvas.
 *
 * Hand-rolled rather than pulled from a panel library, for one specific reason:
 * the shell is a responsive layout that stacks below `lg` and only becomes
 * three columns above it. A `PanelGroup` owns layout with percentage sizing, so
 * supporting both would mean rendering a different tree per breakpoint — and
 * that remounts `CanvasViewport`, which terminates both render workers and
 * throws away the checkpoint cache every time the window crosses 1024px.
 *
 * Here the handle only reports a width. CSS decides whether that width is used
 * at all (see `.ff-side-*` in `styles.css`), so the mobile layout is untouched
 * and nothing remounts.
 */

/** Keyboard nudge, and the coarse step when shift is held. */
const STEP = 16
const COARSE_STEP = 64

export function PanelResizer({
  side,
  width,
  onChange,
  onCommit,
}: {
  /** Which panel this handle resizes. */
  side: 'left' | 'right'
  width: number
  onChange: (width: number) => void
  /**
   * Called when a gesture ends, so the result is persisted once per gesture.
   *
   * Carries the final width rather than letting the caller read its own state:
   * arrow keys and double-click call `onChange` and `onCommit` in the same
   * tick, before React has re-rendered, so anything the caller reads about
   * itself at that moment is one step behind. That is exactly how a
   * double-click reset ended up storing the width it had just discarded.
   */
  onCommit: (width: number) => void
}) {
  const drag = useRef<{
    startX: number
    startWidth: number
    latest: number
  } | null>(null)

  /**
   * Moving the separator right widens a left panel and narrows a right one.
   * Everything below works in separator-space and converts here, so the two
   * handles behave identically under the pointer and under the arrow keys.
   */
  const widthFor = (startWidth: number, deltaX: number) =>
    clampPanelWidth(side === 'left' ? startWidth + deltaX : startWidth - deltaX)

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Ignore secondary buttons — a right-click here should open the context
    // menu, not start a drag that never ends.
    if (event.button !== 0) return
    drag.current = { startX: event.clientX, startWidth: width, latest: width }
    // Capture is an optimisation, not a requirement — the drag still tracks
    // without it, just only while the pointer stays over the handle. Throwing
    // here (which it does for a synthetic or already-released pointer) must not
    // abort the gesture and strand `drag.current`.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Ignored deliberately; see above.
    }
    // The pointer routinely leaves the 5px handle mid-drag; without this the
    // cursor flickers back to the arrow over the canvas.
    document.body.style.cursor = 'col-resize'
  }

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    state.latest = widthFor(state.startWidth, event.clientX - state.startX)
    onChange(state.latest)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    // Clear state and commit *before* releasing capture, so a throw from the
    // release cannot leave the handle mid-drag with the width unsaved.
    drag.current = null
    document.body.style.cursor = ''
    onCommit(state.latest)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Already released, or never captured. Nothing to undo.
    }
  }

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? COARSE_STEP : STEP
    let next: number | null = null

    if (event.key === 'ArrowLeft') next = widthFor(width, -step)
    if (event.key === 'ArrowRight') next = widthFor(width, step)
    if (event.key === 'Home') next = PANEL_MIN
    if (event.key === 'End') next = PANEL_MAX
    if (next === null) return

    event.preventDefault()
    onChange(next)
    onCommit(next)
  }

  const label = `Resize ${side} panel`

  return (
    <div
      // Hidden below `lg`, where the columns stack and there is nothing to
      // resize against. The order slots it between its panel and the canvas;
      // it is carried here rather than by the caller so the two handles cannot
      // be wired into the wrong gaps.
      className={`ff-resizer hidden shrink-0 lg:block ${
        side === 'left' ? 'lg:order-2' : 'lg:order-4'
      }`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      title={`${label} — drag, arrow keys, or double-click to reset`}
      tabIndex={0}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={keyDown}
      onDoubleClick={() => {
        onChange(PANEL_DEFAULT)
        onCommit(PANEL_DEFAULT)
      }}
    />
  )
}
