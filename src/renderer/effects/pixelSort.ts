import { luma } from '../buffer'
import type { PixelBuffer } from '../buffer'
import { bool, num, str } from '../params'
import type { ParamSpec } from '../params'
import type { Params, RenderEnv } from '../types'
import { scaled } from '../types'

/**
 * Pixel sort — reorder contiguous runs of pixels along a line.
 *
 * The effect lives entirely in the *selection*, not the sort. Sorting a whole
 * row gives a boring gradient; what makes it read as damage is choosing spans
 * by a tone band, so sorted streaks start and stop at features in the image and
 * the untouched pixels keep the composition legible.
 *
 * Runs are capped in length for the same reason: an uncapped sort on a smooth
 * source produces a single span across the whole image and destroys it.
 */

/**
 * The default travel direction, named once.
 *
 * Both the spec default and the runtime fallback read it. They were written as
 * two literals, and when the default moved from `'0'` to `'90'` only one of
 * them followed — leaving `applyPixelSort` disagreeing with its own declared
 * default whenever `rotation` was absent, and the tests silently sorting
 * single-row buffers vertically, which is a no-op.
 */
const DEFAULT_ROTATION = '90'

export const PIXEL_SORT_PARAMS: Array<ParamSpec> = [
  {
    kind: 'select',
    key: 'rotation',
    label: 'Direction',
    default: DEFAULT_ROTATION,
    options: [
      { value: '0', label: '→' },
      { value: '90', label: '↓' },
      { value: '180', label: '←' },
      { value: '270', label: '↑' },
    ],
  },
  {
    kind: 'slider',
    key: 'low',
    label: 'Low',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.05,
  },
  {
    kind: 'slider',
    key: 'high',
    label: 'High',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.6,
  },
  {
    kind: 'select',
    key: 'sortBy',
    label: 'Sort by',
    default: 'luma',
    options: [
      { value: 'luma', label: 'Luma' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Sat' },
      { value: 'red', label: 'Red' },
    ],
  },
  {
    kind: 'slider',
    key: 'maxRun',
    label: 'Max run',
    min: 8,
    max: 600,
    step: 1,
    default: 180,
    spatial: true,
    unit: 'px',
  },
  { kind: 'toggle', key: 'reverse', label: 'Reverse', default: false },
]

/** Sort keys, all cheap and all monotone in something visible. */
function keyOf(r: number, g: number, b: number, mode: string): number {
  switch (mode) {
    case 'red':
      return r
    case 'saturation': {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      return max <= 0 ? 0 : (max - min) / max
    }
    case 'hue': {
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const delta = max - min
      if (delta <= 0) return 0
      let hue: number
      if (max === r) hue = ((g - b) / delta) % 6
      else if (max === g) hue = (b - r) / delta + 2
      else hue = (r - g) / delta + 4
      return (hue / 6 + 1) % 1
    }
    default:
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
}

export function applyPixelSort(
  buffer: PixelBuffer,
  params: Params,
  env: RenderEnv,
): PixelBuffer {
  const { width, height, data } = buffer

  /**
   * Four traversal directions rather than two axes.
   *
   * Which *end* of a line the sorted pixels pile up at is the whole character
   * of the effect: 90° drips downward, 270° climbs. Axis plus a reverse flag
   * cannot express that — reversing the sort order swaps light for dark, which
   * is a different control.
   */
  const rotation = str(params, 'rotation', DEFAULT_ROTATION)
  const vertical = rotation === '90' || rotation === '270'
  const flipped = rotation === '180' || rotation === '270'
  const sortBy = str(params, 'sortBy', 'luma')
  const reverse = bool(params, 'reverse', false)
  const maxRun = scaled(num(params, 'maxRun', 180), env, 2)

  let low = num(params, 'low', 0.05)
  let high = num(params, 'high', 0.6)
  if (low > high) [low, high] = [high, low]

  const lineCount = vertical ? width : height
  const lineLength = vertical ? height : width

  // Index of the n-th pixel along a line, so one loop serves all four
  // directions. `flipped` walks the line backwards, which is what turns a
  // downward drip into an upward climb.
  const indexAt = (line: number, position: number) => {
    const p = flipped ? lineLength - 1 - position : position
    return (vertical ? p * width + line : line * width + p) * 4
  }

  const keys = new Float32Array(lineLength)
  const inBand = new Uint8Array(lineLength)
  const order: Array<number> = []
  const scratch = new Float32Array(lineLength * 4)

  for (let line = 0; line < lineCount; line++) {
    for (let position = 0; position < lineLength; position++) {
      const i = indexAt(line, position)
      const tone = luma(buffer, i)
      inBand[position] = tone >= low && tone <= high ? 1 : 0
      keys[position] = keyOf(data[i], data[i + 1], data[i + 2], sortBy)
    }

    let start = 0
    while (start < lineLength) {
      if (!inBand[start]) {
        start++
        continue
      }

      let end = start
      while (end < lineLength && inBand[end] && end - start < maxRun) end++

      const length = end - start
      if (length > 1) {
        order.length = 0
        for (let k = 0; k < length; k++) order.push(k)
        order.sort((a, b) => keys[start + a] - keys[start + b])
        if (reverse) order.reverse()

        for (let k = 0; k < length; k++) {
          const from = indexAt(line, start + order[k])
          scratch[k * 4] = data[from]
          scratch[k * 4 + 1] = data[from + 1]
          scratch[k * 4 + 2] = data[from + 2]
          scratch[k * 4 + 3] = data[from + 3]
        }
        for (let k = 0; k < length; k++) {
          const to = indexAt(line, start + k)
          data[to] = scratch[k * 4]
          data[to + 1] = scratch[k * 4 + 1]
          data[to + 2] = scratch[k * 4 + 2]
          data[to + 3] = scratch[k * 4 + 3]
        }
      }

      start = end
    }
  }

  return buffer
}
