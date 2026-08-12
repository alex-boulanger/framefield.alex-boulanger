import { useCallback, useEffect, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import { useRecipeUrl } from '#/app/useRecipeUrl'
import { buildShareUrl, copyText } from '#/app/shareLink'
import {
  DEFAULT_PANEL_LAYOUT,
  loadPanelLayout,
  savePanelLayout,
} from '#/app/panelLayout'
import { CanvasViewport } from './CanvasViewport'
import { PresetStrip } from './PresetStrip'
import { LayerStack } from './LayerStack'
import { LayerInspector } from './LayerInspector'
import { ExportPanel } from './ExportPanel'
import { PanelResizer } from './PanelResizer'
import {
  SHORTCUTS,
  isTypingTarget,
  matches,
  useShortcutHint,
} from './shortcuts'
import type { Shortcut } from './shortcuts'
import {
  FilePlus,
  Keyboard,
  Link2,
  Redo2,
  Shuffle,
  Undo2,
  X,
} from 'lucide-react'

/**
 * App shell.
 *
 * Layout follows the PRD: canvas centre, source and export left, stack and
 * parameters right. On narrow screens the columns stack below the canvas so the
 * tool stays usable down to a phone — the canvas keeps the top of the viewport
 * and the controls scroll under it.
 */
export function Lab() {
  useRecipeUrl()

  const remix = useLab((state) => state.remix)
  const newArtwork = useLab((state) => state.newArtwork)
  const randomizeFxStack = useLab((state) => state.randomizeFxStack)
  const undo = useLab((state) => state.undo)
  const redo = useLab((state) => state.redo)
  const setComparing = useLab((state) => state.setComparing)
  const toggleSolo = useLab((state) => state.toggleSolo)
  const selectedLayerId = useLab((state) => state.selectedLayerId)

  const [helpOpen, setHelpOpen] = useState(false)

  /**
   * Side panel widths.
   *
   * Seeded with the defaults and read from storage in an effect, never during
   * render — the app is prerendered, so a stored width applied on the first
   * client render would disagree with the static HTML.
   */
  const [layout, setLayout] = useState(DEFAULT_PANEL_LAYOUT)
  useEffect(() => setLayout(loadPanelLayout()), [])

  // The commit callback stays stable across a drag, so it reads the current
  // widths through a ref rather than being rebuilt on every pointer move.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Called when a gesture ends rather than on every pointer move, so one drag
  // is one write. The resized side is overridden with the width the handle
  // reports, because a discrete change (arrow key, double-click) commits in the
  // same tick it changes and the ref has not caught up yet. The save result is
  // ignored on purpose: see `savePanelLayout`.
  const persistLayout = useCallback((side: 'left' | 'right', width: number) => {
    savePanelLayout({ ...layoutRef.current, [side]: width })
  }, [])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      if (matches(event, SHORTCUTS.redo) || matches(event, SHORTCUTS.undo)) {
        // Checked together and redo first: both are ⌘Z, and the shifted one is
        // the more specific match.
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }

      if (matches(event, SHORTCUTS.help)) {
        event.preventDefault()
        setHelpOpen((open) => !open)
        return
      }
      if (event.key === 'Escape') {
        setHelpOpen(false)
        return
      }
      if (matches(event, SHORTCUTS.remix)) {
        remix()
        return
      }
      if (matches(event, SHORTCUTS.newArtwork)) {
        newArtwork()
        return
      }
      if (matches(event, SHORTCUTS.randomizeFx)) {
        randomizeFxStack()
        return
      }
      if (matches(event, SHORTCUTS.solo)) {
        toggleSolo(selectedLayerId)
        return
      }
      if (matches(event, SHORTCUTS.compare)) {
        // `repeat` guard: holding a key autorepeats, and re-setting the flag on
        // every repeat would churn the store sixty times a second.
        if (!event.repeat) setComparing(true)
      }
    }

    const up = (event: KeyboardEvent) => {
      if (matches(event, SHORTCUTS.compare)) setComparing(false)
    }

    /**
     * Compare is held, so it needs an escape hatch for the case where the
     * keyup never arrives — switching tabs or windows mid-hold swallows it,
     * and the app would be left showing the bare source with no way back.
     */
    const release = () => setComparing(false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  }, [
    newArtwork,
    redo,
    remix,
    randomizeFxStack,
    selectedLayerId,
    setComparing,
    toggleSolo,
    undo,
  ])

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={{ background: 'var(--color-void)' }}
    >
      <Header onOpenHelp={() => setHelpOpen(true)} />

      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
        // The widths are only *read* above `lg` — see `.ff-side-*`. Publishing
        // them at every size keeps one component tree across the breakpoint.
        style={
          {
            '--panel-left': `${layout.left}px`,
            '--panel-right': `${layout.right}px`,
          } as React.CSSProperties
        }
      >
        <aside
          className="ff-side-left order-2 w-full shrink-0 border-t p-4 lg:order-1 lg:overflow-y-auto lg:border-t-0 lg:border-r"
          style={{
            borderColor: 'var(--color-line)',
            background: 'var(--color-shell)',
          }}
        >
          <div className="flex flex-col gap-5">
            {/* First thing read: the fastest route to a good image. Layer
                editing lives on the right, with the stack it edits. */}
            <PresetStrip />
            <div
              className="border-t pt-5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <ExportPanel />
            </div>
          </div>
        </aside>

        <PanelResizer
          side="left"
          width={layout.left}
          onChange={(left) => setLayout((current) => ({ ...current, left }))}
          onCommit={(left) => persistLayout('left', left)}
        />

        <main className="order-1 flex min-h-[45vh] min-w-0 flex-1 lg:order-3 lg:min-h-0">
          <CanvasViewport />
        </main>

        <PanelResizer
          side="right"
          width={layout.right}
          onChange={(right) => setLayout((current) => ({ ...current, right }))}
          onCommit={(right) => persistLayout('right', right)}
        />

        <aside
          className="ff-side-right order-3 w-full shrink-0 border-t p-4 lg:order-5 lg:overflow-y-auto lg:border-t-0 lg:border-l"
          style={{
            borderColor: 'var(--color-line)',
            background: 'var(--color-shell)',
          }}
        >
          <div className="flex flex-col gap-5">
            <LayerStack />
            <div
              className="border-t pt-5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <LayerInspector />
            </div>
          </div>
        </aside>
      </div>

      {helpOpen && <ShortcutOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

/**
 * Copy the current recipe as a link.
 *
 * The `?r=` mirror has existed since the first milestone with nothing in the UI
 * to reveal it, which made the entire share model invisible. The confirmation
 * matters as much as the copy: without it there is no evidence anything
 * happened.
 */
function ShareButton() {
  const hint = useShortcutHint()
  const recipe = useLab((state) => state.recipe)
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const share = useCallback(async () => {
    const result = await copyText(await buildShareUrl(recipe))
    setState(result)
  }, [recipe])

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (!matches(event, SHORTCUTS.copyLink)) return
      event.preventDefault()
      void share()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [share])

  return (
    <button
      type="button"
      className="ff-btn"
      onClick={() => void share()}
      title={`Copy a link to this recipe (${hint(SHORTCUTS.copyLink)})`}
      style={state === 'copied' ? { color: 'var(--color-signal)' } : undefined}
    >
      <Link2 size={13} />
      {state === 'idle' ? 'Share' : state === 'copied' ? 'Copied' : 'Failed'}
    </button>
  )
}

function Header({ onOpenHelp }: { onOpenHelp: () => void }) {
  const hint = useShortcutHint()
  const remix = useLab((state) => state.remix)
  const newArtwork = useLab((state) => state.newArtwork)
  const undo = useLab((state) => state.undo)
  const redo = useLab((state) => state.redo)
  const canUndo = useLab((state) => state.past.length > 0)
  const canRedo = useLab((state) => state.future.length > 0)

  return (
    <header
      className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-2.5"
      style={{
        borderColor: 'var(--color-line)',
        background: 'var(--color-shell)',
      }}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          className="font-mono text-[13px] tracking-[0.2em]"
          style={{ color: 'var(--color-ink)' }}
        >
          Framefield
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="ff-btn ff-btn-icon"
          onClick={onOpenHelp}
          title={`Keyboard shortcuts (${hint(SHORTCUTS.help)})`}
          aria-label="Keyboard shortcuts"
        >
          <Keyboard size={13} />
        </button>
        <ShareButton />
        <button
          type="button"
          className="ff-btn ff-btn-icon"
          onClick={undo}
          disabled={!canUndo}
          title={`Undo (${hint(SHORTCUTS.undo)})`}
          aria-label="Undo"
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="ff-btn ff-btn-icon"
          onClick={redo}
          disabled={!canRedo}
          title={`Redo (${hint(SHORTCUTS.redo)})`}
          aria-label="Redo"
        >
          <Redo2 size={13} />
        </button>
        {/* New sits beside Remix because they are the two ways to start over:
            one from nothing, one from chance. It needs no confirmation — it
            goes through history, so undo brings the stack straight back. */}
        <button
          type="button"
          className="ff-btn"
          onClick={newArtwork}
          title={`New blank artwork (${hint(SHORTCUTS.newArtwork)})`}
        >
          <FilePlus size={13} />
          New
        </button>
        <button
          type="button"
          className="ff-btn"
          onClick={remix}
          title={`Remix (${hint(SHORTCUTS.remix)})`}
        >
          <Shuffle size={13} />
          Remix
        </button>
      </div>
    </header>
  )
}

function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const hint = useShortcutHint()
  const entries = Object.values(SHORTCUTS) as Array<Shortcut>

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: '#000000cc' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-sm flex-col gap-3 border p-5"
        style={{
          borderColor: 'var(--color-line)',
          background: 'var(--color-shell)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="ff-label">Keyboard</span>
          <button
            type="button"
            className="ff-btn ff-btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex flex-col">
          {entries.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-baseline justify-between gap-4 border-t py-1.5 first:border-t-0"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <span className="ff-value">{shortcut.label}</span>
              <span
                className="ff-label shrink-0"
                style={{ color: 'var(--color-ink)' }}
              >
                {hint(shortcut)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
