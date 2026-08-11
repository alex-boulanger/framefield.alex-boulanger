import { useId } from 'react'

/**
 * Control primitives. Native elements wherever they suffice (range, checkbox,
 * color) so keyboard support comes for free — Radix only earns its place when
 * a native control cannot do the job, and none of these need it yet.
 */

export function Field({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="ff-label">{label}</span>
        {value !== undefined && <span className="ff-value">{value}</span>}
      </div>
      {children}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (value: number) => void
}) {
  const display = Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)

  return (
    <Field label={label} value={`${display}${unit ?? ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()

  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <label htmlFor={id} className="ff-label cursor-pointer">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-4 w-8 shrink-0 cursor-pointer border transition-colors"
        style={{
          borderColor: checked
            ? 'var(--color-signal-dim)'
            : 'var(--color-line)',
          background: checked ? 'var(--color-raised)' : 'var(--color-void)',
        }}
      >
        <span
          className="absolute top-0.5 h-2.5 w-2.5 transition-all"
          style={{
            left: checked ? '18px' : '2px',
            background: checked ? 'var(--color-signal)' : 'var(--color-faint)',
          }}
        />
      </button>
    </div>
  )
}

export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label?: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const control = (
    <div className="ff-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-active={option.value === value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="ff-seg-item"
        >
          {option.label}
        </button>
      ))}
    </div>
  )

  return label ? <Field label={label}>{control}</Field> : control
}

/**
 * Palette editor. Colours are swatches that open the native picker; the ramp
 * strip above shows how the palette actually reads as a gradient, which is what
 * the effects sample.
 */
export function PaletteEditor({
  label,
  colors,
  onChange,
}: {
  label: string
  colors: Array<string>
  onChange: (colors: Array<string>) => void
}) {
  const update = (index: number, color: string) => {
    const next = [...colors]
    next[index] = color
    onChange(next)
  }

  return (
    <Field label={label}>
      <div className="flex flex-col gap-1.5">
        <div
          className="h-1.5 w-full"
          style={{
            background:
              colors.length > 1
                ? `linear-gradient(to right, ${colors.join(', ')})`
                : colors[0],
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          {colors.map((color, index) => (
            <label
              key={`${color}-${index}`}
              className="relative h-6 w-6 cursor-pointer border"
              style={{ background: color, borderColor: 'var(--color-line)' }}
              title={color}
            >
              <input
                type="color"
                value={color}
                aria-label={`${label} colour ${index + 1}`}
                onChange={(event) => update(index, event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          ))}
          {colors.length > 2 && (
            <button
              type="button"
              className="ff-btn ff-btn-icon"
              style={{ height: 24, width: 24 }}
              title="Remove last colour"
              aria-label="Remove last colour"
              onClick={() => onChange(colors.slice(0, -1))}
            >
              −
            </button>
          )}
          {colors.length < 6 && (
            <button
              type="button"
              className="ff-btn ff-btn-icon"
              style={{ height: 24, width: 24 }}
              title="Add colour"
              aria-label="Add colour"
              onClick={() => onChange([...colors, '#ffffff'])}
            >
              +
            </button>
          )}
        </div>
      </div>
    </Field>
  )
}

export function TextInput({
  label,
  value,
  onChange,
  action,
  placeholder,
  maxLength,
  mono,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  action?: React.ReactNode
  placeholder?: string
  maxLength?: number
  mono?: boolean
}) {
  return (
    <Field label={label}>
      <div className="flex gap-1.5">
        <input
          className="ff-input"
          value={value}
          aria-label={label}
          placeholder={placeholder}
          maxLength={maxLength}
          spellCheck={false}
          autoComplete="off"
          // Ramps are read as a sequence of glyphs, so they need to be shown
          // in the same kind of face they will be rendered in.
          style={mono ? { letterSpacing: '0.08em' } : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {action}
      </div>
    </Field>
  )
}
