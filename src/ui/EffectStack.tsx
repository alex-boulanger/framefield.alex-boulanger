import { useLab } from '#/app/store'
import { EFFECTS, EFFECT_ORDER } from '#/renderer/effects'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { EffectType } from '#/renderer/types'

/**
 * The layer stack. Ordered top-to-bottom in application order — the first row
 * is the first pass over the source, which matches how the pipeline reads.
 */
export function EffectStack() {
  const layers = useLab((state) => state.recipe.layers)
  const selectedId = useLab((state) => state.selectedLayerId)
  const selectLayer = useLab((state) => state.selectLayer)
  const toggleLayer = useLab((state) => state.toggleLayer)
  const removeLayer = useLab((state) => state.removeLayer)
  const duplicateLayer = useLab((state) => state.duplicateLayer)
  const moveLayer = useLab((state) => state.moveLayer)
  const addLayer = useLab((state) => state.addLayer)

  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="ff-label">Stack</span>
        <span className="ff-value">{layers.length}</span>
      </div>

      <div className="flex flex-col">
        {layers.map((layer, index) => {
          const selected = layer.id === selectedId
          return (
            <div
              key={layer.id}
              className="group flex items-center gap-1 border-t px-1 py-1 first:border-t-0"
              style={{
                borderColor: 'var(--color-line)',
                background: selected ? 'var(--color-raised)' : 'transparent',
              }}
            >
              <button
                type="button"
                className="ff-btn ff-btn-icon shrink-0"
                style={{
                  height: 24,
                  width: 24,
                  background: 'transparent',
                  border: 'none',
                }}
                title={layer.enabled ? 'Disable layer' : 'Enable layer'}
                aria-label={layer.enabled ? 'Disable layer' : 'Enable layer'}
                onClick={() => toggleLayer(layer.id)}
              >
                {layer.enabled ? (
                  <Eye size={13} color="var(--color-signal)" />
                ) : (
                  <EyeOff size={13} color="var(--color-faint)" />
                )}
              </button>

              <button
                type="button"
                onClick={() => selectLayer(layer.id)}
                aria-pressed={selected}
                className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 bg-transparent px-1 text-left"
              >
                <span
                  className="truncate font-mono text-[11px] tracking-wide"
                  style={{
                    color: layer.enabled
                      ? 'var(--color-ink)'
                      : 'var(--color-faint)',
                  }}
                >
                  {EFFECTS[layer.type].label}
                </span>
                {layer.opacity < 1 && (
                  <span className="ff-value shrink-0" style={{ fontSize: 10 }}>
                    {Math.round(layer.opacity * 100)}%
                  </span>
                )}
              </button>

              {/* Row actions stay hidden until hover or selection so the stack
                  reads as a list rather than a toolbar grid. */}
              <div
                className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                style={{ opacity: selected ? 1 : undefined }}
              >
                <StackAction
                  title="Move up"
                  onClick={() => moveLayer(layer.id, -1)}
                  disabled={index === 0}
                >
                  <ChevronUp size={13} />
                </StackAction>
                <StackAction
                  title="Move down"
                  onClick={() => moveLayer(layer.id, 1)}
                  disabled={index === layers.length - 1}
                >
                  <ChevronDown size={13} />
                </StackAction>
                <StackAction
                  title="Duplicate"
                  onClick={() => duplicateLayer(layer.id)}
                >
                  <Copy size={12} />
                </StackAction>
                <StackAction
                  title="Delete"
                  onClick={() => removeLayer(layer.id)}
                >
                  <Trash2 size={12} />
                </StackAction>
              </div>
            </div>
          )
        })}

        {layers.length === 0 && (
          <p className="ff-value py-3 text-center">No effects</p>
        )}
      </div>

      {adding ? (
        <div className="flex flex-col gap-1">
          {EFFECT_ORDER.map((type: EffectType) => (
            <button
              key={type}
              type="button"
              className="ff-btn justify-start"
              onClick={() => {
                addLayer(type)
                setAdding(false)
              }}
            >
              {EFFECTS[type].label}
            </button>
          ))}
          <button
            type="button"
            className="ff-btn"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="ff-btn"
          onClick={() => setAdding(true)}
        >
          <Plus size={13} />
          Add effect
        </button>
      )}
    </div>
  )
}

function StackAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 cursor-pointer items-center justify-center border-none bg-transparent disabled:cursor-not-allowed disabled:opacity-25"
      style={{ color: 'var(--color-faint)' }}
    >
      {children}
    </button>
  )
}
