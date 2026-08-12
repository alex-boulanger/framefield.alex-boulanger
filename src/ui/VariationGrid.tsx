import { useCallback, useEffect, useState } from 'react'
import { useLab } from '#/app/store'
import { remixRecipe } from '#/renderer/recipe'
import { RecipeThumbnail } from './RecipeThumbnail'
import { Lock, LockOpen, RefreshCw } from 'lucide-react'
import type { Recipe } from '#/renderer/types'

/**
 * Candidate remixes of the current recipe, rendered live.
 *
 * Remix on its own is a coin flip: one result at a time, no way to compare, no
 * way to steer. Seeing several at once turns it into a choice — and adopting
 * one immediately reseeds the grid from *that* recipe, so the loop is "pick the
 * closest, look again" rather than "reroll and hope".
 *
 * Four rather than six. Each tile is a full render of the stack, and the
 * viewport is already competing for the same cores; six of a `flow` stack is
 * measurably worse than four for no extra reach.
 */
const VARIATION_COUNT = 4

export function VariationGrid() {
  const recipe = useLab((state) => state.recipe)
  const setRecipe = useLab((state) => state.setRecipe)
  const paletteLocked = useLab((state) => state.paletteLocked)
  const togglePaletteLock = useLab((state) => state.togglePaletteLock)

  const [variations, setVariations] = useState<Array<Recipe>>([])

  /**
   * Deliberately not derived from `recipe` on every change.
   *
   * Regenerating on each slider tick would re-render four stacks per frame and
   * make the grid a flickering distraction. It refreshes when the user asks,
   * and when they adopt a tile — the two moments they are actually looking at
   * it.
   */
  const reroll = useCallback(
    (from: Recipe) => {
      setVariations(
        Array.from({ length: VARIATION_COUNT }, () =>
          remixRecipe(from, { lockPalette: paletteLocked }),
        ),
      )
    },
    [paletteLocked],
  )

  // Generated after mount, never during render: the app is prerendered and
  // random recipes in the first client render would not match the static HTML.
  useEffect(() => {
    reroll(useLab.getState().recipe)
  }, [reroll])

  const adopt = (variation: Recipe) => {
    setRecipe(variation)
    reroll(variation)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="ff-label">Variations</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="ff-btn ff-btn-icon"
            onClick={togglePaletteLock}
            aria-pressed={paletteLocked}
            title={
              paletteLocked
                ? 'Palette locked — variations keep this colourway'
                : 'Lock the palette across variations'
            }
            style={paletteLocked ? { color: 'var(--color-signal)' } : undefined}
          >
            {paletteLocked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <button
            type="button"
            className="ff-btn ff-btn-icon"
            onClick={() => reroll(recipe)}
            title="New variations"
            aria-label="New variations"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {variations.map((variation, index) => (
          <RecipeThumbnail
            // Index rather than a recipe id: a reroll replaces the whole set,
            // and keying on content would remount all four every time.
            key={index}
            name={`Variation ${index + 1}`}
            recipe={variation}
            onApply={() => adopt(variation)}
          />
        ))}
      </div>
    </div>
  )
}
