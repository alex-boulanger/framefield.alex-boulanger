import { useEffect, useState } from 'react'
import { useLab } from '#/app/store'
import { SIZE_PRESETS } from '#/renderer/recipe'
import { renderToPngBlob } from '#/renderer/renderRecipe'
import { Segmented } from './controls'
import {
  SHORTCUTS,
  isTypingTarget,
  matches,
  useShortcutHint,
} from './shortcuts'
import { Download, Loader2 } from 'lucide-react'
import type { Recipe } from '#/renderer/types'

function renderExportInWorker(recipe: Recipe, assets: Record<string, string>) {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Worker unavailable'))
  }

  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(
      new URL('../renderer/render.worker.ts', import.meta.url),
      { type: 'module' },
    )
    const id = 1

    worker.onmessage = (
      event: MessageEvent<
        | { kind: 'preview'; id: number; image: ImageData; renderMs: number }
        | { kind: 'export'; id: number; blob: Blob; renderMs: number }
        | { kind: 'error'; id: number; error: string }
      >,
    ) => {
      const message = event.data
      if (message.id !== id) return
      worker.terminate()

      if (message.kind === 'export') {
        resolve(message.blob)
        return
      }
      reject(
        new Error(message.kind === 'error' ? message.error : 'Export failed'),
      )
    }

    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Worker export failed'))
    }

    worker.postMessage({ kind: 'export', id, recipe, assets })
  })
}

async function decodeAssets(assets: Record<string, string>) {
  const entries = await Promise.all(
    Object.entries(assets).map(async ([handle, url]) => {
      const blob = await fetch(url).then((response) => response.blob())
      return [handle, await createImageBitmap(blob)] as const
    }),
  )
  return Object.fromEntries(entries)
}

function downloadBlob(blob: Blob, recipe: Recipe) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  // Name the file after the lowest generator's seed: it is the closest thing
  // a stack has to an identity, and it makes exports of the same artwork sort
  // together.
  const generator = recipe.layers.find((layer) => layer.kind === 'generator')
  const seed =
    typeof generator?.params.seed === 'string' ? generator.params.seed : 'stack'
  link.href = url
  link.download = `framefield-${seed}-${recipe.canvas.width}x${recipe.canvas.height}.png`
  link.click()
  // Revoking in the same tick can cancel the download before the browser has
  // read the blob — Chrome tolerates it, Safari and Firefox do not.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Export renders the recipe again at scale 1 rather than upscaling the preview,
 * which is the whole point of keeping params in export-space units: what the
 * user tuned at 40% is what lands in the PNG.
 */
export function ExportPanel() {
  const hint = useShortcutHint()
  const recipe = useLab((state) => state.recipe)
  const assets = useLab((state) => state.assets)
  const setCanvasSize = useLab((state) => state.setCanvasSize)

  const [busy, setBusy] = useState(false)

  const scaledSize = (
    preset: (typeof SIZE_PRESETS)[number],
    scale: number,
  ) => ({
    width: preset.width * scale,
    height: preset.height * scale,
  })

  const activePreset = SIZE_PRESETS.find((preset) =>
    [1, 2].some((scale) => {
      const size = scaledSize(preset, scale)
      return (
        size.width === recipe.canvas.width &&
        size.height === recipe.canvas.height
      )
    }),
  )
  const activeScale =
    activePreset &&
    [1, 2].find((scale) => {
      const size = scaledSize(activePreset, scale)
      return (
        size.width === recipe.canvas.width &&
        size.height === recipe.canvas.height
      )
    })

  const exportPng = async () => {
    setBusy(true)
    try {
      let blob: Blob
      try {
        blob = await renderExportInWorker(recipe, assets)
      } catch {
        const bitmaps = await decodeAssets(assets)
        try {
          blob = await renderToPngBlob({ recipe, assets: bitmaps })
        } finally {
          for (const bitmap of Object.values(bitmaps)) bitmap.close()
        }
      }
      downloadBlob(blob, recipe)
    } finally {
      setBusy(false)
    }
  }

  /**
   * The export shortcut lives here rather than in `Lab`'s listener so the
   * handler sits with the state it guards on — `busy` stops a second render
   * being kicked off while the first is still going. No dependency array: the
   * listener is re-registered each render so it always closes over the current
   * `busy` and recipe, and add/remove of one listener is far cheaper than the
   * render that just happened.
   */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (!matches(event, SHORTCUTS.exportPng)) return
      event.preventDefault()
      if (!busy) void exportPng()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  })

  return (
    <div className="flex flex-col gap-3">
      <span className="ff-label">Export</span>

      <div className="grid grid-cols-2 gap-1">
        {SIZE_PRESETS.map((preset) => {
          const active = activePreset?.id === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                const size = scaledSize(preset, activeScale || 1)
                setCanvasSize(size.width, size.height)
              }}
              aria-pressed={active}
              className="flex cursor-pointer flex-col items-start gap-0.5 border px-2 py-1.5 transition-colors"
              style={{
                borderColor: active
                  ? 'var(--color-signal-dim)'
                  : 'var(--color-line)',
                background: active
                  ? 'var(--color-raised)'
                  : 'var(--color-void)',
              }}
            >
              <span
                className="font-mono text-[10px] tracking-widest"
                style={{
                  color: active ? 'var(--color-signal)' : 'var(--color-muted)',
                }}
              >
                {preset.aspect}
              </span>
              <span className="ff-value" style={{ fontSize: 10 }}>
                {preset.label}
              </span>
            </button>
          )
        })}
      </div>

      <Segmented
        label="Scale"
        value={`${activeScale || 1}x`}
        options={[
          { value: '1x', label: '1x' },
          { value: '2x', label: '2x' },
        ]}
        onChange={(value) => {
          const scale = value === '2x' ? 2 : 1
          const preset = activePreset ?? SIZE_PRESETS[1]
          const size = scaledSize(preset, scale)
          setCanvasSize(size.width, size.height)
        }}
      />

      <div className="flex items-center gap-1.5">
        <NumberInput
          label="W"
          value={recipe.canvas.width}
          onChange={(value) => setCanvasSize(value, recipe.canvas.height)}
        />
        <NumberInput
          label="H"
          value={recipe.canvas.height}
          onChange={(value) => setCanvasSize(recipe.canvas.width, value)}
        />
      </div>

      <button
        type="button"
        className="ff-btn ff-btn-accent"
        onClick={exportPng}
        disabled={busy}
        title={`Export PNG (${hint(SHORTCUTS.exportPng)})`}
      >
        {busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Download size={13} />
        )}
        {busy
          ? 'Rendering'
          : `Export PNG · ${recipe.canvas.width}×${recipe.canvas.height}`}
      </button>
    </div>
  )
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  // Follow external changes (preset clicks) without fighting typing.
  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isFinite(parsed)) {
      onChange(Math.max(16, Math.min(8192, parsed)))
    } else {
      setDraft(String(value))
    }
  }

  return (
    <label className="flex flex-1 items-center gap-1.5">
      <span className="ff-label">{label}</span>
      <input
        className="ff-input"
        inputMode="numeric"
        value={draft}
        aria-label={label === 'W' ? 'Export width' : 'Export height'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}
