import { FONTS } from './fonts'
import type { Params, ParamValue } from './types'

/**
 * Params are declared, not hand-wired. Each effect ships a spec list; the
 * controls panel renders from it and defaults come from it. Adding a param to
 * an effect means touching one file, not three.
 */

interface BaseSpec {
  key: string
  label: string
  /**
   * Section this param belongs to in the inspector.
   *
   * An effect has six or eight params and reads fine as a flat list. A text
   * layer has forty, and a flat list of forty is a wall the user scrolls past
   * rather than a panel they work in. Ungrouped params stay at the top, which
   * is what keeps every existing spec list rendering exactly as before.
   */
  group?: string
}

export interface SliderSpec extends BaseSpec {
  kind: 'slider'
  min: number
  max: number
  step: number
  default: number
  /**
   * True when the value is a length in export-space pixels and must be
   * multiplied by the render scale. Purely informational for the UI (it shows
   * `px`); the effect itself does the scaling via `scaled()`.
   */
  spatial?: boolean
  unit?: string
}

export interface ToggleSpec extends BaseSpec {
  kind: 'toggle'
  default: boolean
}

export interface SelectSpec extends BaseSpec {
  kind: 'select'
  options: Array<{ value: string; label: string }>
  default: string
}

export interface PaletteSpec extends BaseSpec {
  kind: 'palette'
  default: Array<string>
}

export interface SeedSpec extends BaseSpec {
  kind: 'seed'
  default: string
}

/** Free text. Unlike `seed` it carries no randomize affordance. */
export interface TextSpec extends BaseSpec {
  kind: 'text'
  default: string
  placeholder?: string
  maxLength?: number
  multiline?: boolean
}

export interface ColorSpec extends BaseSpec {
  kind: 'color'
  default: string
}

/**
 * A bundled typeface, by id.
 *
 * Its own kind rather than a `select` because the only useful preview of a
 * typeface is the typeface: the picker draws each name in its own face, which
 * a generic option list has no way to know it should do.
 */
export interface FontSpec extends BaseSpec {
  kind: 'font'
  default: string
}

export type ParamSpec =
  | SliderSpec
  | ToggleSpec
  | SelectSpec
  | PaletteSpec
  | SeedSpec
  | TextSpec
  | ColorSpec
  | FontSpec

/**
 * Round a generated param to a stable, serializable value.
 *
 * The trailing `+ 0` normalizes negative zero. `Number((-0.001).toFixed(2))` is
 * `-0`, and `JSON.stringify(-0)` is `"0"` — so a recipe carrying `-0` decodes
 * as `+0` and no longer round-trips. Invisible in the render, but it breaks the
 * guarantee that a shared URL reproduces the document exactly.
 */
export function roundParam(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor + 0
}

export function defaultParams(specs: ReadonlyArray<ParamSpec>): Params {
  const params: Params = {}
  for (const spec of specs) {
    params[spec.key] = Array.isArray(spec.default)
      ? [...spec.default]
      : spec.default
  }
  return params
}

/**
 * Typed readers. Params arrive from URLs and stored recipes, so a missing or
 * wrong-typed value must fall back rather than throw — a malformed share link
 * should still open something.
 */

export function num(params: Params, key: string, fallback: number): number {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function bool(params: Params, key: string, fallback: boolean): boolean {
  const value = params[key]
  return typeof value === 'boolean' ? value : fallback
}

export function str(params: Params, key: string, fallback: string): string {
  const value = params[key]
  return typeof value === 'string' ? value : fallback
}

export function list(
  params: Params,
  key: string,
  fallback: Array<string>,
): Array<string> {
  const value = params[key]
  return Array.isArray(value) && value.length > 0 ? value : fallback
}

/** Drop unknown keys and coerce known ones — used when ingesting a share URL. */
export function sanitizeParams(
  specs: ReadonlyArray<ParamSpec>,
  input: unknown,
): Params {
  const source = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, ParamValue>
  const params: Params = {}

  for (const spec of specs) {
    const value = source[spec.key]
    switch (spec.kind) {
      case 'slider':
        params[spec.key] =
          typeof value === 'number' && Number.isFinite(value)
            ? Math.max(spec.min, Math.min(spec.max, value))
            : spec.default
        break
      case 'toggle':
        params[spec.key] = typeof value === 'boolean' ? value : spec.default
        break
      case 'select':
        params[spec.key] =
          typeof value === 'string' &&
          spec.options.some((option) => option.value === value)
            ? value
            : spec.default
        break
      case 'palette':
        params[spec.key] =
          Array.isArray(value) &&
          value.length > 0 &&
          value.every(
            (c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c),
          )
            ? value
            : [...spec.default]
        break
      case 'seed':
        params[spec.key] =
          typeof value === 'string' && value.length > 0 ? value : spec.default
        break
      case 'text':
        // Length-capped: this arrives from a URL, and an unbounded string in a
        // shared recipe is both a rendering hazard and a payload.
        params[spec.key] =
          typeof value === 'string' && value.length > 0
            ? value.slice(0, spec.maxLength ?? 256)
            : spec.default
        break
      case 'color':
        params[spec.key] =
          typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)
            ? value
            : spec.default
        break
      case 'font':
        // A recipe naming a face this build does not carry falls back rather
        // than rendering in the browser's default — which is the one outcome
        // bundling the faces exists to prevent.
        params[spec.key] =
          typeof value === 'string' && FONTS.some((font) => font.id === value)
            ? value
            : spec.default
        break
    }
  }

  return params
}
