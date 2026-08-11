import { useLab } from '#/app/store'
import { PALETTES } from '#/renderer/palettes'
import { ParamControl } from './ParamControl'
import { Segmented, Slider } from './controls'
import { layerHint, layerSpecs, layerTypeLabel } from './layerMeta'
import { BLEND_MODES, isFullRange } from '#/renderer/types'
import type { BlendMode, Layer } from '#/renderer/types'
import { Dices, ImageOff, RotateCcw } from 'lucide-react'

/**
 * Controls for the selected layer, whatever it renders.
 *
 * Opacity, blend mode, and mask sit above the layer's own params because they
 * are compositing controls: they govern how the layer lands on what is beneath
 * it, not what it draws. That split is now the same for a generator as for an
 * effect, which is the whole reason those controls are shared.
 */
export function LayerInspector() {
  const layers = useLab((state) => state.recipe.layers)
  const selectedId = useLab((state) => state.selectedLayerId)
  const assets = useLab((state) => state.assets)
  const setLayerParam = useLab((state) => state.setLayerParam)
  const setLayerOpacity = useLab((state) => state.setLayerOpacity)
  const setLayerBlendMode = useLab((state) => state.setLayerBlendMode)
  const setLayerMask = useLab((state) => state.setLayerMask)
  const resetLayer = useLab((state) => state.resetLayer)
  const reseedLayer = useLab((state) => state.reseedLayer)
  const randomizeLayer = useLab((state) => state.randomizeLayer)

  const layer = layers.find((entry) => entry.id === selectedId)

  if (!layer) {
    return (
      <div className="flex flex-col gap-2">
        <span className="ff-label">Parameters</span>
        <p className="ff-value py-3">Select a layer</p>
      </div>
    )
  }

  const masked = !isFullRange(layer.mask) || layer.mask.softness > 0
  const missingAsset = layer.kind === 'image' && !assets[layer.asset]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="ff-label">{layerTypeLabel(layer)}</span>
        <div className="flex items-center gap-1">
          {layer.kind === 'generator' && (
            <>
              <button
                type="button"
                className="ff-btn ff-btn-icon"
                title="New seed"
                aria-label="New seed"
                onClick={() => reseedLayer(layer.id)}
              >
                <Dices size={12} />
              </button>
              <button
                type="button"
                className="ff-btn"
                title="Randomize this field"
                onClick={() => randomizeLayer(layer.id)}
              >
                Randomize
              </button>
            </>
          )}
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
      </div>

      <p className="ff-value leading-relaxed" style={{ fontSize: 10 }}>
        {layerHint(layer)}
      </p>

      {missingAsset && (
        <div
          className="flex items-start gap-2 border p-2"
          style={{ borderColor: 'var(--color-line)' }}
        >
          <ImageOff size={13} color="var(--color-signal)" />
          <p className="ff-value leading-relaxed" style={{ fontSize: 10 }}>
            No file behind this layer. Its placement is intact — re-import to
            bring the pixels back.
          </p>
        </div>
      )}

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
          {layerSpecs(layer).map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={layer.params[spec.key]}
              onChange={(value) => setLayerParam(layer.id, spec.key, value)}
            />
          ))}
        </div>
      </div>

      {'palette' in layer.params && (
        <PalettePicker
          layer={layer}
          onPick={(colors) => setLayerParam(layer.id, 'palette', colors)}
        />
      )}
    </div>
  )
}

/**
 * Curated palettes, offered on any layer that has one.
 *
 * They double as the randomizer's source set, which is what keeps remix output
 * coherent — and picking one on a generator carries the stack with it, because
 * the store propagates to layers that never had a palette of their own.
 */
function PalettePicker({
  layer,
  onPick,
}: {
  layer: Layer
  onPick: (colors: Array<string>) => void
}) {
  return (
    <div
      className="flex flex-col gap-1.5 border-t pt-4"
      style={{ borderColor: 'var(--color-line)' }}
    >
      <span className="ff-label">Palettes</span>
      <div className="flex flex-wrap gap-1">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            title={palette.name}
            aria-label={`Apply ${palette.name} palette to ${layerTypeLabel(layer)}`}
            onClick={() => onPick([...palette.colors])}
            className="flex h-5 w-9 border"
            style={{ borderColor: 'var(--color-line)' }}
          >
            {palette.colors.map((color) => (
              <span key={color} className="flex-1" style={{ background: color }} />
            ))}
          </button>
        ))}
      </div>
    </div>
  )
}
