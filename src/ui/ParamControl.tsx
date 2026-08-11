import { PaletteEditor, Segmented, Slider, TextInput, Toggle } from './controls'
import { randomSeed } from '#/renderer/rng'
import type { ParamSpec } from '#/renderer/params'
import type { ParamValue } from '#/renderer/types'
import { Dices } from 'lucide-react'

/**
 * Renders one param from its spec. Every effect's control panel is built from
 * this, so a new param is a one-line addition to an effect's spec list.
 */
export function ParamControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec
  value: ParamValue | undefined
  onChange: (value: ParamValue) => void
}) {
  switch (spec.kind) {
    case 'slider':
      return (
        <Slider
          label={spec.label}
          value={typeof value === 'number' ? value : spec.default}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          unit={spec.unit}
          onChange={onChange}
        />
      )

    case 'toggle':
      return (
        <Toggle
          label={spec.label}
          checked={typeof value === 'boolean' ? value : spec.default}
          onChange={onChange}
        />
      )

    case 'select':
      return (
        <Segmented
          label={spec.label}
          value={typeof value === 'string' ? value : spec.default}
          options={spec.options}
          onChange={onChange}
        />
      )

    case 'palette':
      return (
        <PaletteEditor
          label={spec.label}
          colors={Array.isArray(value) ? value : spec.default}
          onChange={onChange}
        />
      )

    case 'seed':
      return (
        <TextInput
          label={spec.label}
          value={typeof value === 'string' ? value : spec.default}
          onChange={onChange}
          action={
            <button
              type="button"
              className="ff-btn ff-btn-icon"
              title="Randomize seed"
              aria-label="Randomize seed"
              onClick={() => onChange(randomSeed())}
            >
              <Dices size={13} />
            </button>
          }
        />
      )
  }
}
