import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { renderRecipe, renderSource } from './src/renderer/renderRecipe'
import { createDefaultRecipe, createLayer } from './src/renderer/recipe'
import { PRESETS, recipeFromPreset } from './src/renderer/presets'
import type { EffectType, Layer, Params, Recipe } from './src/renderer/types'

/** Temporary benchmark harness. Deleted after measuring. */

const CANVAS = { width: 1080, height: 1350 }
// Matches the app's 420k pixel budget at this aspect.
const PREVIEW_SCALE = 0.537

function layer(type: EffectType, params: Params = {}): Layer {
  const created = createLayer(type)
  return { ...created, params: { ...created.params, ...params } }
}

function withLayers(layers: Array<Layer>): Recipe {
  const base = createDefaultRecipe()
  return { ...base, canvas: CANVAS, layers }
}

function time(label: string, run: () => void, warm = true): string {
  if (warm) run()
  const start = performance.now()
  run()
  return `${label.padEnd(34)} ${(performance.now() - start).toFixed(0)}ms`
}

it('bench', () => {
  const lines: Array<string> = []

  const defaultRecipe = withLayers([layer('posterize'), layer('dither')])
  const heavy = withLayers([
    layer('levels', { black: 0.1, gamma: 1.2 }),
    layer('displace', { amount: 30 }),
    layer('dither', { algorithm: 'floyd-steinberg' }),
    layer('bloom', { amount: 1 }),
    layer('grain', { amount: 0.2 }),
  ])

  lines.push('--- preview (scale 0.537, ~420k px) ---')

  // Source alone, which the viewport memoizes.
  const source = renderSource({ recipe: defaultRecipe, scale: PREVIEW_SCALE })
  lines.push(
    time('source only (warp)', () =>
      renderSource({ recipe: defaultRecipe, scale: PREVIEW_SCALE }),
    ),
  )

  // Effects only — the path a slider drag actually takes.
  lines.push(
    time('default stack, cached source', () =>
      renderRecipe({
        recipe: defaultRecipe,
        scale: PREVIEW_SCALE,
        sourceImage: source,
      }),
    ),
  )

  const heavySource = renderSource({ recipe: heavy, scale: PREVIEW_SCALE })
  lines.push(
    time('heavy stack, cached source', () =>
      renderRecipe({
        recipe: heavy,
        scale: PREVIEW_SCALE,
        sourceImage: heavySource,
      }),
    ),
  )

  lines.push(
    time('default stack, cold (first paint)', () =>
      renderRecipe({ recipe: defaultRecipe, scale: PREVIEW_SCALE }),
    ),
  )

  lines.push('')
  lines.push('--- per-effect, preview, cached source ---')
  for (const type of [
    'levels',
    'posterize',
    'pixelate',
    'dither',
    'halftone',
    'ascii',
    'pixel-sort',
    'displace',
    'channel-drift',
    'bloom',
    'grain',
  ] as Array<EffectType>) {
    const recipe = withLayers([layer(type)])
    lines.push(
      time(`  ${type}`, () =>
        renderRecipe({ recipe, scale: PREVIEW_SCALE, sourceImage: source }),
      ),
    )
  }

  lines.push('')
  lines.push('--- presets, preview, cold ---')
  for (const preset of PRESETS) {
    const recipe = recipeFromPreset(preset, CANVAS)
    lines.push(
      time(`  ${preset.name}`, () =>
        renderRecipe({ recipe, scale: PREVIEW_SCALE }),
      ),
    )
  }

  lines.push('')
  lines.push('--- export (1080x1350) ---')
  lines.push(
    time('default stack', () => renderRecipe({ recipe: defaultRecipe, scale: 1 })),
  )
  lines.push(time('heavy stack', () => renderRecipe({ recipe: heavy, scale: 1 })))

  writeFileSync('/tmp/bench-resp.txt', lines.join('\n'))
}, 900_000)
