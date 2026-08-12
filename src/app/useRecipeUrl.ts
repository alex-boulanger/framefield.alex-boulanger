import { useEffect, useRef } from 'react'
import { useLab } from './store'
import {
  createRandomRecipe,
  decodeRecipeAny,
  encodeRecipeCompressed,
} from '#/renderer/recipe'

/**
 * Mirrors the recipe into `?r=` so a URL is a shareable document.
 *
 * Written with `history.replaceState` rather than a router navigation: recipe
 * edits are continuous (slider drags), and each one must not become a history
 * entry the back button has to walk through.
 *
 * Imported images are deliberately not encoded (ADR Decision 6) — a shared
 * image-source recipe reopens in the missing-source state.
 */
export function useRecipeUrl(): void {
  const recipe = useLab((state) => state.recipe)
  const hydrateRecipe = useLab((state) => state.hydrateRecipe)
  const hydrated = useRef(false)

  /**
   * Decide what document the app opens with, once, on mount.
   *
   * A link in the URL always wins — that is the whole point of the share
   * model, and reloading after an edit has to give the work back rather than
   * throw it away. Only a bare URL gets a fresh random artwork.
   *
   * It happens here, after mount, rather than in `createDefaultRecipe`,
   * because the app is prerendered: randomizing at module scope renders one
   * document into the static HTML and a different one on the client, and the
   * difference is visible (seed, layer names, param values), so React would
   * treat it as a hydration mismatch.
   */
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get('r')
    if (!encoded) {
      hydrateRecipe(createRandomRecipe(useLab.getState().recipe.canvas))
      hydrated.current = true
      return
    }

    let cancelled = false
    decodeRecipeAny(encoded)
      .then((parsed) => {
        // Only adopt the link if nothing has been edited while it decoded.
        // Inflation is a tick or two, but "a keystroke silently reverted" is a
        // bad enough failure to be worth the guard.
        if (!cancelled && parsed) hydrateRecipe(parsed)
      })
      .finally(() => {
        hydrated.current = true
      })

    return () => {
      cancelled = true
    }
  }, [hydrateRecipe])

  // Write back, debounced so dragging a slider does not thrash the URL.
  useEffect(() => {
    if (!hydrated.current) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void encodeRecipeCompressed(recipe).then((encoded) => {
        // A later edit already scheduled its own write; that one is current.
        if (cancelled) return
        const url = new URL(window.location.href)
        url.searchParams.set('r', encoded)
        window.history.replaceState(null, '', url)
      })
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [recipe])
}
