import { encodeRecipeCompressed } from '#/renderer/recipe'
import type { Recipe } from '#/renderer/types'

/**
 * Build the link for the current recipe.
 *
 * Encoded fresh rather than read off `window.location`: the URL is written on a
 * 400ms debounce, so the address bar can be a beat behind the document, and
 * "copy link" handing someone the previous state is the one failure this
 * feature cannot afford.
 */
export async function buildShareUrl(recipe: Recipe): Promise<string> {
  const url = new URL(window.location.href)
  url.searchParams.set('r', await encodeRecipeCompressed(recipe))
  return url.toString()
}

export type CopyResult = 'copied' | 'failed'

/**
 * Copy text, falling back to a hidden textarea.
 *
 * `navigator.clipboard` needs a secure context, which rules it out on plain
 * http over a LAN — a normal way to look at this app from a phone.
 */
export async function copyText(text: string): Promise<CopyResult> {
  // The DOM types declare `navigator.clipboard` as always present. It is not:
  // outside a secure context the property is genuinely absent, which is the
  // exact case this fallback exists for, so the cast restores the truth rather
  // than working around the checker.
  const clipboard = navigator.clipboard as Clipboard | undefined

  try {
    if (clipboard) {
      await clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    // Fall through to the legacy path rather than giving up: a rejected
    // permission here is recoverable.
  }

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(field)
    return ok ? 'copied' : 'failed'
  } catch {
    return 'failed'
  }
}
