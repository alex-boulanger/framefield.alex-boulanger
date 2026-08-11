import type { Recipe } from '#/renderer/types'

const SYNC_PREVIEW_PIXEL_BUDGET = 420_000
const WORKER_PREVIEW_PIXEL_BUDGET = 4_000_000
export const SETTLED_PREVIEW_DELAY_MS = 450

function budgetedScale(
  recipe: Recipe,
  boxWidth: number,
  boxHeight: number,
  pixelBudget: number,
  fullScale: boolean,
) {
  if (boxWidth <= 0 || boxHeight <= 0) return 0.5

  const fit = Math.min(
    boxWidth / recipe.canvas.width,
    boxHeight / recipe.canvas.height,
  )
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2)
  const budget = Math.sqrt(
    pixelBudget / (recipe.canvas.width * recipe.canvas.height),
  )

  return Math.max(0.08, Math.min(1, fullScale ? 1 : fit * dpr, budget))
}

export function previewRequestScales(
  recipe: Recipe,
  boxWidth: number,
  boxHeight: number,
  workerReady: boolean,
) {
  const interactive = budgetedScale(
    recipe,
    boxWidth,
    boxHeight,
    SYNC_PREVIEW_PIXEL_BUDGET,
    false,
  )
  const settled = workerReady
    ? budgetedScale(
        recipe,
        boxWidth,
        boxHeight,
        WORKER_PREVIEW_PIXEL_BUDGET,
        true,
      )
    : interactive

  return {
    interactive,
    settled,
  }
}
