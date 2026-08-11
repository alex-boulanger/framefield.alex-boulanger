import { useEffect, useRef } from 'react'
import { useLab } from './store'
import { decodeRecipe, encodeRecipe } from '#/renderer/recipe'

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

  // Read once on mount.
  useEffect(() => {
    const encoded = new URLSearchParams(window.location.search).get('r')
    if (encoded) {
      const parsed = decodeRecipe(encoded)
      if (parsed) hydrateRecipe(parsed)
    }
    hydrated.current = true
  }, [hydrateRecipe])

  // Write back, debounced so dragging a slider does not thrash the URL.
  useEffect(() => {
    if (!hydrated.current) return

    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('r', encodeRecipe(recipe))
      window.history.replaceState(null, '', url)
    }, 400)

    return () => window.clearTimeout(timer)
  }, [recipe])
}
