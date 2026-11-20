/**
 * Theme awareness for the plugin's own chrome.
 *
 * Every surface already inherits the host's `--dsw-alias-*` tokens, which the
 * host re-binds when the appearance switches. Native form chrome (scrollbars,
 * carets, the OS-drawn parts of inputs) does not follow those tokens: it
 * follows CSS `color-scheme`. This module resolves the host's active scheme
 * and the plugin re-publishes it on its own roots, so the light and dark
 * appearances paint the same inside the plugin as outside it.
 *
 * The pure helpers (colour parsing, luminance, scheme choice) are exported for
 * unit tests; the hook only adds the document observers.
 */
import { useEffect, useState } from 'react'

/** The two schemes the plugin supports. */
export type ColorScheme = 'light' | 'dark'

/** RGBA channels in the 0–255 / 0–1 ranges. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parse the colour syntaxes `getComputedStyle` reports plus hex literals. */
export function parseColor(color: string): Rgba | undefined {
  const text = color.trim().toLowerCase()
  if (text === '' || text === 'transparent') return undefined
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex !== null) {
    const digits = hex[1]
    const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16)
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)), g: expand(digits.slice(2, 4)), b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      }
    }
    return undefined
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text)
  if (rgb === null) return undefined
  const parts = rgb[1].split(/[,\s/]+/).filter(part => part !== '')
  if (parts.length < 3) return undefined
  const channel = (part: string): number => {
    const value = part.endsWith('%') ? parseFloat(part) / 100 * 255 : parseFloat(part)
    return Number.isFinite(value) ? Math.round(Math.min(255, Math.max(0, value))) : 0
  }
  const alphaText = parts.length > 3 ? parts[3] : '1'
  const alpha = alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText)
  return {
    r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]),
    a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
  }
}

/** WCAG relative luminance (0 = black, 1 = white) of an sRGB colour. */
export function relativeLuminance(color: Rgba): number {
  const linear = (value: number): number => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

/** Backgrounds darker than this count as the dark appearance. */
export const DARK_LUMINANCE_THRESHOLD = 0.4
/** Below this alpha a background is see-through and must be skipped. */
export const OPAQUE_ALPHA = 0.35

/**
 * Guess the scheme from a background colour. Transparent or unparsable
 * colours yield undefined so the caller keeps walking to the next ancestor.
 */
export function schemeFromBackground(color: string | undefined): ColorScheme | undefined {
  if (color === undefined) return undefined
  const parsed = parseColor(color)
  if (parsed === undefined || parsed.a < OPAQUE_ALPHA) return undefined
  return relativeLuminance(parsed) < DARK_LUMINANCE_THRESHOLD ? 'dark' : 'light'
}

/** Read the host-declared `color-scheme`, when it names exactly one scheme. */
function declaredScheme(): ColorScheme | undefined {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return undefined
  const declared = getComputedStyle(document.documentElement).colorScheme ?? ''
  const hasDark = declared.includes('dark')
  const hasLight = declared.includes('light')
  if (hasDark && !hasLight) return 'dark'
  if (hasLight && !hasDark) return 'light'
  return undefined
}

/** True when the OS/browser asks for the dark appearance. */
function mediaPrefersDark(): boolean {
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * Resolve the appearance around `start` (or the document): the host's declared
 * `color-scheme` first, then the nearest opaque ancestor background, then the
 * OS preference. Safe without a DOM (returns 'light'), so rendering and tests
 * never depend on the host being present.
 */
export function detectScheme(start?: HTMLElement | null): ColorScheme {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 'light'
  const declared = declaredScheme()
  if (declared !== undefined) return declared
  let element: HTMLElement | null = start ?? document.documentElement
  while (element !== null) {
    const scheme = schemeFromBackground(getComputedStyle(element).backgroundColor)
    if (scheme !== undefined) return scheme
    element = element.parentElement
  }
  return mediaPrefersDark() ? 'dark' : 'light'
}

/** Re-run `onChange` (debounced to one call per task) when the host repaints. */
function watchDocument(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => { timer = undefined; onChange() }, 0)
  }
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : undefined
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-ds-theme-source'],
  })
  if (document.body !== null) {
    observer?.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-ds-dark-theme'],
    })
  }
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined
  media?.addEventListener?.('change', schedule)
  return () => {
    observer?.disconnect()
    media?.removeEventListener?.('change', schedule)
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The plugin's published scheme: detected on mount from the host root, then
 * re-detected whenever the host repaints its palette (theme toggle, OS
 * appearance change).
 * @param ref - the plugin root the scheme is published on.
 * @returns the current scheme.
 */
export function useColorScheme(ref: { current: HTMLElement | null }): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(() => detectScheme(null))
  useEffect(() => {
    const read = (): void => { setScheme(detectScheme(ref.current)) }
    read()
    return watchDocument(read)
  }, [ref])
  return scheme
}
