import { useEffect } from 'react'
import { useLab } from '#/app/store'
import { useRecipeUrl } from '#/app/useRecipeUrl'
import { CanvasViewport } from './CanvasViewport'
import { SourcePanel } from './SourcePanel'
import { EffectStack } from './EffectStack'
import { EffectControls } from './EffectControls'
import { ExportPanel } from './ExportPanel'
import { Shuffle, SplitSquareHorizontal } from 'lucide-react'

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
  const setComparing = useLab((state) => state.setComparing)
  const comparing = useLab((state) => state.comparing)

  // Hold to compare. Space is the obvious key for a momentary action, and
  // keyup releasing it means the user never gets stuck in compare mode.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)

    const down = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        setComparing(true)
      }
      if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) {
        remix()
      }
    }

    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setComparing(false)
    }

    // Releasing outside the window would otherwise latch compare mode on.
    const blur = () => setComparing(false)

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [remix, setComparing])

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
            <SourcePanel />
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

      {/* Compare is a press-and-hold control, so it is a button with pointer
          handlers rather than a toggle — matching the Space key behaviour. */}
      <div className="pointer-events-none fixed right-4 bottom-16 z-10 lg:bottom-14">
        <button
          type="button"
          className="ff-btn pointer-events-auto"
          data-active={comparing}
          style={{
            color: comparing ? 'var(--color-signal)' : undefined,
            borderColor: comparing ? 'var(--color-signal)' : undefined,
          }}
          onPointerDown={() => setComparing(true)}
          onPointerUp={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
        >
          <SplitSquareHorizontal size={13} />
          Compare
        </button>
      </div>
    </div>
  )
}

function Header() {
  const remix = useLab((state) => state.remix)

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
          className="font-mono text-[13px] tracking-[0.2em] uppercase"
          style={{ color: 'var(--color-ink)' }}
        >
          Framefield
        </span>
        <span className="ff-value hidden sm:inline" style={{ fontSize: 10 }}>
          local image lab
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span
          className="ff-value mr-1 hidden md:inline"
          style={{ fontSize: 10 }}
        >
          space · compare
        </span>
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
