import { useLab } from '#/app/store'
import { EFFECTS, EFFECT_ORDER } from '#/renderer/effects'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { EffectType, Layer } from '#/renderer/types'
import type { DragEndEvent } from '@dnd-kit/core'

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
  const moveLayerTo = useLab((state) => state.moveLayerTo)
  const setLayerName = useLab((state) => state.setLayerName)
  const addLayer = useLab((state) => state.addLayer)
  const randomizeFxStack = useLab((state) => state.randomizeFxStack)

  const [adding, setAdding] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const dragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const targetIndex = layers.findIndex((layer) => layer.id === over.id)
    if (targetIndex !== -1) moveLayerTo(String(active.id), targetIndex)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="ff-label">Stack</span>
        <span className="ff-value">{layers.length}</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={dragEnd}
      >
        <SortableContext
          items={layers.map((layer) => layer.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col">
            {layers.map((layer) => (
              <StackRow
                key={layer.id}
                layer={layer}
                selected={layer.id === selectedId}
                onSelect={() => selectLayer(layer.id)}
                onToggle={() => toggleLayer(layer.id)}
                onDuplicate={() => duplicateLayer(layer.id)}
                onRemove={() => removeLayer(layer.id)}
                onRename={(name) => setLayerName(layer.id, name)}
              />
            ))}

            {layers.length === 0 && (
              <p className="ff-value py-3 text-center">No effects</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <button type="button" className="ff-btn" onClick={randomizeFxStack}>
        <Shuffle size={13} />
        Randomize FX
      </button>

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

function StackRow({
  layer,
  selected,
  onSelect,
  onToggle,
  onDuplicate,
  onRemove,
  onRename,
}: {
  layer: Layer
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onDuplicate: () => void
  onRemove: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(layer.name ?? '')
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: layer.id })
  const label = layer.name ?? EFFECTS[layer.type].label

  const commitName = () => {
    onRename(draft)
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      className="group flex items-center gap-1 border-t px-1 py-1 first:border-t-0"
      style={{
        borderColor: 'var(--color-line)',
        background: selected ? 'var(--color-raised)' : 'transparent',
        opacity: isDragging ? 0.55 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center border-none bg-transparent active:cursor-grabbing"
        style={{ color: 'var(--color-faint)' }}
        title="Drag to reorder"
        aria-label={`Drag ${EFFECTS[layer.type].label} layer`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </button>

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
        onClick={onToggle}
      >
        {layer.enabled ? (
          <Eye size={13} color="var(--color-signal)" />
        ) : (
          <EyeOff size={13} color="var(--color-faint)" />
        )}
      </button>

      {editing ? (
        <input
          className="ff-input h-6 min-w-0 flex-1"
          value={draft}
          autoFocus
          maxLength={48}
          aria-label="Layer name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraft(layer.name ?? '')
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 bg-transparent px-1 text-left"
        >
          <span
            className="truncate font-mono text-[11px] tracking-wide"
            title={label}
            style={{
              color: layer.enabled ? 'var(--color-ink)' : 'var(--color-faint)',
            }}
          >
            {label}
          </span>
          {layer.name && (
            <span className="ff-value shrink-0" style={{ fontSize: 9 }}>
              {EFFECTS[layer.type].label}
            </span>
          )}
          {layer.opacity < 1 && (
            <span className="ff-value shrink-0" style={{ fontSize: 10 }}>
              {Math.round(layer.opacity * 100)}%
            </span>
          )}
        </button>
      )}

      {/* Row actions stay hidden until hover or selection so the stack reads as
          a list rather than a toolbar grid. */}
      <div
        className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        style={{ opacity: selected || editing ? 1 : undefined }}
      >
        {!editing && (
          <StackAction
            title="Rename"
            onClick={() => {
              setDraft(layer.name ?? '')
              setEditing(true)
            }}
          >
            <Pencil size={12} />
          </StackAction>
        )}
        <StackAction title="Duplicate" onClick={onDuplicate}>
          <Copy size={12} />
        </StackAction>
        <StackAction title="Delete" onClick={onRemove}>
          <Trash2 size={12} />
        </StackAction>
      </div>
    </div>
  )
}

function StackAction({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-6 w-6 cursor-pointer items-center justify-center border-none bg-transparent"
      style={{ color: 'var(--color-faint)' }}
    >
      {children}
    </button>
  )
}
