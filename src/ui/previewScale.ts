import type { Recipe } from '#/renderer/types'

const SYNC_PREVIEW_PIXEL_BUDGET = 420_000
const WORKER_PREVIEW_PIXEL_BUDGET = 4_000_000
export const SETTLED_PREVIEW_DELAY_MS = 450
const MIN_PREVIEW_SCALE = 0.08

/** How many resolutions the preview climbs before it reaches the settled one. */
export const PREVIEW_RUNGS = 4

/**
 * A render is only fast enough to skip the coarse rungs if it lands inside a
 * couple of frames. Above this the stack is expensive enough that a blurry
 * picture now beats a sharp one much later.
 */
export const FAST_RENDER_MS = 120

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

/**
 * The resolutions the preview climbs, coarsest first, ending at `settled`.
 *
 * Geometric on purpose. Render cost goes as the square of the scale, so each
 * rung costs a quarter of the one above it and *every* rung below the top adds
 * only about a third to the final render — measured at 1.35x the cost of the
 * top rung alone, against the 1.30x the previous two-pass preview already paid
 * for its discarded first frame. Four rungs therefore buy a first picture
 * roughly an order of magnitude sooner for about four percent more work.
 *
 * A linear ladder would be the trap: rungs bunched near the top are each nearly
 * as expensive as the final render, and the total runs past 2x.
 */
export function previewLadder(settled: number): Array<number> {
  const rungs = Array.from({ length: PREVIEW_RUNGS }, (_, index) =>
    Math.max(MIN_PREVIEW_SCALE, settled / 2 ** (PREVIEW_RUNGS - 1 - index)),
  )
  // A small canvas can push several rungs onto the floor at once.
  return [...new Set(rungs)]
}

/**
 * The highest rung the persistent worker owns.
 *
 * Everything at or below it is cheap enough to run to completion on a worker
 * that is never terminated, which is what keeps its checkpoint cache warm
 * through a drag. Rungs above it can block for seconds, so they belong on a
 * worker that can be thrown away mid-render — terminating is the only way to
 * cancel a pass, since rendering is synchronous.
 */
export function interactiveRung(
  ladder: ReadonlyArray<number>,
  interactive: number,
): number {
  let rung = 0
  for (let index = 0; index < ladder.length; index++) {
    if (ladder[index] <= interactive) rung = index
  }
  return rung
}
