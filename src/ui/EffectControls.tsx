import { useLab } from '#/app/store'
import { EFFECTS } from '#/renderer/effects'
import { ParamControl } from './ParamControl'
import { Segmented, Slider } from './controls'
import { BLEND_MODES, isFullRange } from '#/renderer/types'
import type { BlendMode } from '#/renderer/types'
import { RotateCcw } from 'lucide-react'

/**
 * Parameters for the selected layer.
 *
 * Opacity and blend mode sit above the effect's own params because they are
 * compositing controls, not effect controls — they govern how the pass is
 * blended back over its input rather than what the pass does.
 */
export function EffectControls() {
  const layers = useLab((state) => state.recipe.layers)
  const selectedId = useLab((state) => state.selectedLayerId)
  const setLayerParam = useLab((state) => state.setLayerParam)
  const setLayerOpacity = useLab((state) => state.setLayerOpacity)
  const setLayerBlendMode = useLab((state) => state.setLayerBlendMode)
  const setLayerMask = useLab((state) => state.setLayerMask)
  const resetLayer = useLab((state) => state.resetLayer)

  const layer = layers.find((entry) => entry.id === selectedId)

  if (!layer) {
    return (
      <div className="flex flex-col gap-2">
        <span className="ff-label">Parameters</span>
        <p className="ff-value py-3">Select a layer</p>
      </div>
    )
  }

  const definition = EFFECTS[layer.type]
  const masked = !isFullRange(layer.mask) || layer.mask.softness > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="ff-label">{definition.label}</span>
        <button
          type="button"
          className="ff-btn ff-btn-icon"
          title="Reset layer"
          aria-label="Reset layer"
          onClick={() => resetLayer(layer.id)}
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <p className="ff-value leading-relaxed" style={{ fontSize: 10 }}>
        {definition.hint}
      </p>

      <div className="flex flex-col gap-3.5">
        <Slider
          label="Opacity"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setLayerOpacity(layer.id, value)}
        />
        <Segmented
          label="Blend"
          value={layer.blendMode}
          options={BLEND_MODES.map((mode) => ({
            value: mode,
            label: mode.slice(0, 4),
          }))}
          onChange={(value) => setLayerBlendMode(layer.id, value as BlendMode)}
        />
      </div>

      {/* Tone mask: restrict the layer to a band of what it sits over. Grouped
          with opacity and blend because all three govern how the pass is
          composited, not what it does. */}
      <div
        className="flex flex-col gap-3.5 border-t pt-4"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="ff-label">Tone mask</span>
          {masked && (
            <button
              type="button"
              className="ff-value cursor-pointer bg-transparent"
              style={{ color: 'var(--color-signal)' }}
              onClick={() =>
                setLayerMask(layer.id, { low: 0, high: 1, softness: 0 })
              }
            >
              clear
            </button>
          )}
        </div>
        <Slider
          label="From"
          value={layer.mask.low}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setLayerMask(layer.id, { low: value })}
        />
        <Slider
          label="To"
          value={layer.mask.high}
          min={0}
          max={1}
          step={0.01}
          onChange={(value) => setLayerMask(layer.id, { high: value })}
        />
        <Slider
          label="Feather"
          value={layer.mask.softness}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(value) => setLayerMask(layer.id, { softness: value })}
        />
      </div>

      <div
        className="border-t pt-4"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <div className="flex flex-col gap-3.5">
          {definition.params.map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={layer.params[spec.key]}
              onChange={(value) => setLayerParam(layer.id, spec.key, value)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
