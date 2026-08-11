import { useCallback, useRef, useState } from 'react'
import { useLab } from '#/app/store'
import { ParamControl } from './ParamControl'
import { Segmented, TextInput } from './controls'
import { FIELD_PARAMS } from '#/renderer/generators/field'
import { PALETTES } from '#/renderer/palettes'
import { randomSeed } from '#/renderer/rng'
import { Dices, Upload, X } from 'lucide-react'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export function SourcePanel() {
  const recipe = useLab((state) => state.recipe)
  const setSeed = useLab((state) => state.setSeed)
  const setSourceParam = useLab((state) => state.setSourceParam)
  const randomizeSource = useLab((state) => state.randomizeSource)
  const setImage = useLab((state) => state.setImage)
  const clearImage = useLab((state) => state.clearImage)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const source = recipe.source

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!ACCEPTED.includes(file.type)) {
        setError('JPG, PNG, or WebP only')
        return
      }
      setError(null)
      // Object URL, not a data URL: no base64 inflation, and it never touches
      // the recipe. Nothing leaves the machine (ADR Decision 7).
      setImage(URL.createObjectURL(file), file.name)
    },
    [setImage],
  )

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        value={source.type}
        options={[
          { value: 'generator', label: 'Generate' },
          { value: 'image', label: 'Import' },
        ]}
        onChange={(value) => {
          if (value === 'generator') clearImage()
          else inputRef.current?.click()
        }}
      />

      {source.type === 'generator' ? (
        <>
          <TextInput
            label="Seed"
            value={source.seed}
            onChange={setSeed}
            action={
              <button
                type="button"
                className="ff-btn ff-btn-icon"
                title="New seed"
                aria-label="New seed"
                onClick={() => setSeed(randomSeed())}
              >
                <Dices size={13} />
              </button>
            }
          />

          <div className="flex flex-col gap-3.5">
            {FIELD_PARAMS.map((spec) => (
              <ParamControl
                key={spec.key}
                spec={spec}
                value={source.params[spec.key]}
                onChange={(value) => setSourceParam(spec.key, value)}
              />
            ))}
          </div>

          {/* Curated palettes double as the randomizer's source set, which is
              what keeps remix output coherent. */}
          <div className="flex flex-col gap-1.5">
            <span className="ff-label">Presets</span>
            <div className="flex flex-wrap gap-1">
              {PALETTES.map((palette) => (
                <button
                  key={palette.id}
                  type="button"
                  title={palette.name}
                  aria-label={`Apply ${palette.name} palette`}
                  onClick={() => setSourceParam('palette', [...palette.colors])}
                  className="flex h-5 w-9 border"
                  style={{ borderColor: 'var(--color-line)' }}
                >
                  {palette.colors.map((color) => (
                    <span
                      key={color}
                      className="flex-1"
                      style={{ background: color }}
                    />
                  ))}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="ff-btn" onClick={randomizeSource}>
            <Dices size={13} />
            Randomize source
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className="ff-value truncate"
              style={{ color: 'var(--color-ink)' }}
              title={source.name}
            >
              {source.name}
            </span>
            <button
              type="button"
              className="ff-btn ff-btn-icon"
              title="Remove image"
              aria-label="Remove image"
              onClick={() => clearImage()}
            >
              <X size={13} />
            </button>
          </div>
          <button
            type="button"
            className="ff-btn"
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={13} />
            Replace image
          </button>
        </div>
      )}

      {/* Drop target stays live in both modes so a drag can switch sources. */}
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          accept(event.dataTransfer.files[0])
        }}
        className="flex flex-col items-center justify-center gap-1 border border-dashed px-3 py-4 text-center transition-colors"
        style={{
          borderColor: dragging ? 'var(--color-signal)' : 'var(--color-line)',
          background: dragging ? '#241209' : 'transparent',
        }}
      >
        <Upload size={14} color="var(--color-faint)" />
        <span className="ff-label">Drop image</span>
        <span className="ff-value" style={{ fontSize: 10 }}>
          {error ?? 'JPG · PNG · WebP · stays local'}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(event) => {
          accept(event.target.files?.[0])
          // Reset so re-picking the same file still fires a change.
          event.target.value = ''
        }}
      />
    </div>
  )
}
