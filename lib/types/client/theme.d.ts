/** The two schemes the plugin supports. */
export type ColorScheme = 'light' | 'dark';
/** RGBA channels in the 0–255 / 0–1 ranges. */
export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}
/** Parse the colour syntaxes `getComputedStyle` reports plus hex literals. */
export declare function parseColor(color: string): Rgba | undefined;
/** WCAG relative luminance (0 = black, 1 = white) of an sRGB colour. */
export declare function relativeLuminance(color: Rgba): number;
/** Backgrounds darker than this count as the dark appearance. */
export declare const DARK_LUMINANCE_THRESHOLD = 0.4;
/** Below this alpha a background is see-through and must be skipped. */
export declare const OPAQUE_ALPHA = 0.35;
/**
 * Guess the scheme from a background colour. Transparent or unparsable
 * colours yield undefined so the caller keeps walking to the next ancestor.
 */
export declare function schemeFromBackground(color: string | undefined): ColorScheme | undefined;
/**
 * Resolve the appearance around `start` (or the document): the host's declared
 * `color-scheme` first, then the nearest opaque ancestor background, then the
 * OS preference. Safe without a DOM (returns 'light'), so rendering and tests
 * never depend on the host being present.
 */
export declare function detectScheme(start?: HTMLElement | null): ColorScheme;
/**
 * The plugin's published scheme: detected on mount from the host root, then
 * re-detected whenever the host repaints its palette (theme toggle, OS
 * appearance change).
 * @param ref - the plugin root the scheme is published on.
 * @returns the current scheme.
 */
export declare function useColorScheme(ref: {
    current: HTMLElement | null;
}): ColorScheme;
