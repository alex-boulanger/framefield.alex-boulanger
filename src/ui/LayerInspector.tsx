import { useState } from 'react'
import { useLab } from '#/app/store'
import { PALETTES } from '#/renderer/palettes'
import { ParamControl } from './ParamControl'
import { Section, Segmented, Slider } from './controls'
import { layerHint, layerSpecs, layerTypeLabel } from './layerMeta'
import {
  BLEND_MODES,
  NO_SHAPE,
  isFullRange,
  isShapeless,
} from '#/renderer/types'
import type { ParamSpec } from '#/renderer/params'
import type {
  BlendMode,
  Layer,
  ParamValue,
  ShapeMask,
} from '#/renderer/types'
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
  const setLayerShape = useLab((state) => state.setLayerShape)
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
  const shaped = !isShapeless(layer.shape)
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

      {/* Shape mask: *where* in the frame the layer applies, as opposed to the
          tone mask's *which tones*. The two multiply, so "dither the shadows,
          but only along the bottom edge" is expressible with both set. */}
      <div
        className="flex flex-col gap-3.5 border-t pt-4"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="ff-label">Shape mask</span>
          {shaped && (
            <button
              type="button"
              className="ff-value cursor-pointer bg-transparent"
              style={{ color: 'var(--color-signal)' }}
              onClick={() => setLayerShape(layer.id, { ...NO_SHAPE })}
            >
              clear
            </button>
          )}
        </div>
        <Segmented
          label="Shape"
          value={layer.shape.shape}
          options={[
            { value: 'none', label: 'Off' },
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
          ]}
          onChange={(value) =>
            setLayerShape(layer.id, {
              shape: value as ShapeMask['shape'],
              // Opening the mask with a full band would show no change at all
              // and read as broken, so the first use lands on half the frame.
              ...(value !== 'none' && isShapeless(layer.shape)
                ? { low: 0, high: 0.5, softness: 0.15 }
                : {}),
            })
          }
        />

        {layer.shape.shape !== 'none' && (
          <>
            {layer.shape.shape === 'linear' ? (
              <Slider
                label="Angle"
                value={layer.shape.angle}
                min={0}
                max={359}
                step={1}
                unit="°"
                onChange={(value) => setLayerShape(layer.id, { angle: value })}
              />
            ) : (
              <>
                <Slider
                  label="Centre X"
                  value={layer.shape.centerX}
                  min={-0.5}
                  max={0.5}
                  step={0.01}
                  onChange={(value) =>
                    setLayerShape(layer.id, { centerX: value })
                  }
                />
                <Slider
                  label="Centre Y"
                  value={layer.shape.centerY}
                  min={-0.5}
                  max={0.5}
                  step={0.01}
                  onChange={(value) =>
                    setLayerShape(layer.id, { centerY: value })
                  }
                />
              </>
            )}
            <Slider
              label="From"
              value={layer.shape.low}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setLayerShape(layer.id, { low: value })}
            />
            <Slider
              label="To"
              value={layer.shape.high}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setLayerShape(layer.id, { high: value })}
            />
            <Slider
              label="Feather"
              value={layer.shape.softness}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(value) => setLayerShape(layer.id, { softness: value })}
            />
          </>
        )}
      </div>

      <div
        className="border-t pt-4"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <LayerParams
          // Remounting per layer is the point: which sections are expanded is
          // a property of the layer being worked on, not of the panel.
          key={layer.id}
          layer={layer}
          onChange={(key, value) => setLayerParam(layer.id, key, value)}
        />
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
 * A layer's own params, sectioned by the groups its spec list declares.
 *
 * Params without a group stay loose at the top — that is every effect and the
 * field generator, which read fine as a flat list and should not grow a
 * heading just because text layers needed them. A text layer declares eight
 * groups and only the first opens, so the panel starts as a short menu of what
 * can be changed rather than a wall of forty controls.
 */
function LayerParams({
  layer,
  onChange,
}: {
  layer: Layer
  onChange: (key: string, value: ParamValue) => void
}) {
  const specs = layerSpecs(layer)
  const loose = specs.filter((spec) => !spec.group)
  const groups: Array<{ name: string; specs: Array<ParamSpec> }> = []

  for (const spec of specs) {
    if (!spec.group) continue
    const existing = groups.find((group) => group.name === spec.group)
    if (existing) existing.specs.push(spec)
    else groups.push({ name: spec.group, specs: [spec] })
  }

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    groups.length > 0 ? { [groups[0].name]: true } : {},
  )

  const control = (spec: ParamSpec) => (
    <ParamControl
      key={spec.key}
      spec={spec}
      value={layer.params[spec.key]}
      onChange={(value) => onChange(spec.key, value)}
    />
  )

  return (
    <div className="flex flex-col gap-3.5">
      {loose.map(control)}
      {groups.map((group) => (
        <Section
          key={group.name}
          label={group.name}
          open={open[group.name] ?? false}
          onToggle={() =>
            setOpen((current) => ({
              ...current,
              [group.name]: !current[group.name],
            }))
          }
        >
          {group.specs.map(control)}
        </Section>
      ))}
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
  )
}
