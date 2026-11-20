/**
 * Pure geometry and index math for the plugin's model dropdown. The React
 * component (Dropdown.tsx) owns events and focus; everything that can be
 * decided from plain values lives here so the behaviour is unit-testable
 * without a DOM.
 */
/** One selectable model inside a provider group. */
export interface DropdownOption {
    /** Stable wire value (`provider/model` for the model picker). */
    value: string;
    /** Text shown in the trigger and the menu row. */
    label: string;
}
/** One provider group of options. */
export interface DropdownGroup {
    /** Group heading (`displayName` of the provider). */
    label: string;
    /** The group's options, in catalog order. */
    options: readonly DropdownOption[];
}
/** A flattened option carrying its menu index and group heading. */
export interface FlatOption extends DropdownOption {
    /** Position in the flattened list; doubles as the aria option index. */
    index: number;
    /** Heading of the group this option belongs to. */
    group: string;
}
/** A menu row: a group heading or one option (headings are not selectable). */
export type DropdownRow = {
    kind: 'group';
    label: string;
} | {
    kind: 'option';
    option: FlatOption;
};
/** Flatten groups into the selectable options, skipping empty groups. */
export declare function flattenGroups(groups: readonly DropdownGroup[]): FlatOption[];
/** Build the rendered row list: a heading per non-empty group, then its options. */
export declare function buildRows(groups: readonly DropdownGroup[]): DropdownRow[];
/** Index of `value` in the flattened options, or -1 when it is not offered. */
export declare function indexOfValue(flat: readonly FlatOption[], value: string): number;
/** Label to show on the trigger: the selected option's, else the fallback. */
export declare function labelOfValue(flat: readonly FlatOption[], value: string, fallback: string): string;
/**
 * Move the highlighted row by `delta`, wrapping at both ends. Coming from no
 * selection (-1), a forward step lands on the first row and a backward step on
 * the last, so opening a menu with a key press always highlights something.
 */
export declare function stepIndex(current: number, delta: number, count: number): number;
/** Viewport-relative box of the trigger the menu hangs under. */
export interface AnchorRect {
    left: number;
    top: number;
    width: number;
    height: number;
}
/** Visible viewport in CSS pixels. */
export interface ViewportSize {
    width: number;
    height: number;
}
/** Where the menu is painted: `top` for below-anchor, `bottom` for above. */
export interface MenuBox {
    placement: 'below' | 'above';
    left: number;
    width: number;
    /** Distance from the viewport top (placement 'below'). */
    top?: number;
    /** Distance from the viewport bottom (placement 'above'). */
    bottom?: number;
    /** Hard cap for the scrolling list, sized to the room on that side. */
    maxHeight: number;
}
/** Distance between the trigger and the menu. */
export declare const MENU_GAP = 6;
/** Minimum distance the menu keeps from every viewport edge. */
export declare const MENU_MARGIN = 8;
/** The menu never gets narrower than this, even for a tiny trigger. */
export declare const MENU_MIN_WIDTH = 200;
/** Preferred menu height; it shrinks instead of overflowing the viewport. */
export declare const MENU_MAX_HEIGHT = 320;
/**
 * Place the menu under (or over) its trigger: full trigger width (never below
 * MENU_MIN_WIDTH), clamped into the viewport horizontally, flipped above when
 * the space below cannot hold a usable list, and capped to the room on the
 * chosen side so the list always scrolls inside the viewport.
 */
export declare function menuBox(anchor: AnchorRect, viewport: ViewportSize, maxHeight?: number): MenuBox;
