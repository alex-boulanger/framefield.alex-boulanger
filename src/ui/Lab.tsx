import { useEffect } from 'react'
import { useLab } from '#/app/store'
import { useRecipeUrl } from '#/app/useRecipeUrl'
import { CanvasViewport } from './CanvasViewport'
import { SourcePanel } from './SourcePanel'
import { PresetStrip } from './PresetStrip'
import { EffectStack } from './EffectStack'
import { EffectControls } from './EffectControls'
import { ExportPanel } from './ExportPanel'
import { Redo2, Shuffle, Undo2 } from 'lucide-react'

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
  const undo = useLab((state) => state.undo)
  const redo = useLab((state) => state.redo)

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)

    const down = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      const mod = event.metaKey || event.ctrlKey

      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mod && key === 'y') {
        event.preventDefault()
        redo()
        return
      }

      if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) {
        remix()
      }
    }

    window.addEventListener('keydown', down)
    return () => {
      window.removeEventListener('keydown', down)
    }
  }, [redo, remix, undo])

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={{ background: 'var(--color-void)' }}
    >
      <Header />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          className="order-2 w-full shrink-0 border-t p-4 lg:order-1 lg:w-64 lg:overflow-y-auto lg:border-t-0 lg:border-r"
          style={{
            borderColor: 'var(--color-line)',
            background: 'var(--color-shell)',
          }}
        >
          <div className="flex flex-col gap-5">
            {/* Above the source controls on purpose: this is the fastest route
                to a good image, so it should be the first thing read. */}
            <PresetStrip />
            <div
              className="border-t pt-5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <SourcePanel />
            </div>
            <div
              className="border-t pt-5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <ExportPanel />
            </div>
          </div>
        </aside>

        <main className="order-1 flex min-h-[45vh] min-w-0 flex-1 lg:order-2 lg:min-h-0">
          <CanvasViewport />
        </main>

        <aside
          className="order-3 w-full shrink-0 border-t p-4 lg:w-64 lg:overflow-y-auto lg:border-t-0 lg:border-l"
          style={{
            borderColor: 'var(--color-line)',
            background: 'var(--color-shell)',
          }}
        >
          <div className="flex flex-col gap-5">
            <EffectStack />
            <div
              className="border-t pt-5"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <EffectControls />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Header() {
  const remix = useLab((state) => state.remix)
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
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
          aria-label="Undo"
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="ff-btn ff-btn-icon"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
          aria-label="Redo"
        >
          <Redo2 size={13} />
        </button>
        <button
          type="button"
          className="ff-btn"
          onClick={remix}
          title="Remix (R)"
        >
          <Shuffle size={13} />
          Remix
        </button>
      </div>
    </header>
  )
}
