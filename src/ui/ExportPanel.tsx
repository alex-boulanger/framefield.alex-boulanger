import { useEffect, useState } from 'react'
import { useLab } from '#/app/store'
import { SIZE_PRESETS } from '#/renderer/recipe'
import { renderToPngBlob } from '#/renderer/renderRecipe'
import { Download, Loader2 } from 'lucide-react'

/**
 * Export renders the recipe again at scale 1 rather than upscaling the preview,
 * which is the whole point of keeping params in export-space units: what the
 * user tuned at 40% is what lands in the PNG.
 */
export function ExportPanel() {
  const recipe = useLab((state) => state.recipe)
  const imageUrl = useLab((state) => state.imageUrl)
  const setCanvasSize = useLab((state) => state.setCanvasSize)

  const [busy, setBusy] = useState(false)
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)

  // Export needs its own decode: the viewport's bitmap is local to that
  // component, and export must not depend on the preview having rendered.
  useEffect(() => {
    if (!imageUrl) {
      setBitmap(null)
      return
    }
    let cancelled = false
    fetch(imageUrl)
      .then((response) => response.blob())
      .then(createImageBitmap)
      .then((result) => {
        if (cancelled) result.close()
        else setBitmap(result)
      })
      .catch(() => setBitmap(null))
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  const activePreset = SIZE_PRESETS.find(
    (preset) =>
      preset.width === recipe.canvas.width &&
      preset.height === recipe.canvas.height,
  )

  const exportPng = async () => {
    setBusy(true)
    try {
      const blob = await renderToPngBlob({ recipe, bitmap })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const seed =
        recipe.source.type === 'generator' ? recipe.source.seed : 'image'
      link.href = url
      link.download = `framefield-${seed}-${recipe.canvas.width}x${recipe.canvas.height}.png`
      link.click()
      // Revoking in the same tick can cancel the download before the browser
      // has read the blob — Chrome tolerates it, Safari and Firefox do not.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } finally {
      setBusy(false)
    }
  }

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
              onClick={() => setCanvasSize(preset.width, preset.height)}
              aria-pressed={active}
              className="flex cursor-pointer flex-col items-start gap-0.5 border px-2 py-1.5 transition-colors"
              style={{
                borderColor: active
                  ? 'var(--color-signal-dim)'
                  : 'var(--color-line)',
                background: active ? '#241209' : 'var(--color-void)',
              }}
            >
              <span
                className="font-mono text-[10px] tracking-widest uppercase"
                style={{
                  color: active ? 'var(--color-signal)' : 'var(--color-muted)',
                }}
              >
                {preset.label}
              </span>
              <span className="ff-value" style={{ fontSize: 10 }}>
                {preset.width}×{preset.height}
              </span>
            </button>
          )
        })}
      </div>

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
      >
        {busy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Download size={13} />
        )}
        {busy ? 'Rendering' : 'Export PNG'}
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
