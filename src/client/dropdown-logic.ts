/**
 * Pure geometry and index math for the plugin's model dropdown. The React
 * component (Dropdown.tsx) owns events and focus; everything that can be
 * decided from plain values lives here so the behaviour is unit-testable
 * without a DOM.
 */

/** One selectable model inside a provider group. */
export interface DropdownOption {
  /** Stable wire value (`provider/model` for the model picker). */
  value: string
  /** Text shown in the trigger and the menu row. */
  label: string
}

/** One provider group of options. */
export interface DropdownGroup {
  /** Group heading (`displayName` of the provider). */
  label: string
  /** The group's options, in catalog order. */
  options: readonly DropdownOption[]
}

/** A flattened option carrying its menu index and group heading. */
export interface FlatOption extends DropdownOption {
  /** Position in the flattened list; doubles as the aria option index. */
  index: number
  /** Heading of the group this option belongs to. */
  group: string
}

/** A menu row: a group heading or one option (headings are not selectable). */
export type DropdownRow =
  | { kind: 'group'; label: string }
  | { kind: 'option'; option: FlatOption }

/** Flatten groups into the selectable options, skipping empty groups. */
export function flattenGroups(groups: readonly DropdownGroup[]): FlatOption[] {
  const flat: FlatOption[] = []
  for (const group of groups) {
    for (const option of group.options) {
      flat.push({ value: option.value, label: option.label, index: flat.length, group: group.label })
    }
  }
  return flat
}

/** Build the rendered row list: a heading per non-empty group, then its options. */
export function buildRows(groups: readonly DropdownGroup[]): DropdownRow[] {
  const rows: DropdownRow[] = []
  let index = 0
  for (const group of groups) {
    if (group.options.length === 0) continue
    if (group.label !== '') rows.push({ kind: 'group', label: group.label })
    for (const option of group.options) {
      rows.push({ kind: 'option', option: { value: option.value, label: option.label, index, group: group.label } })
      index += 1
    }
  }
  return rows
}

/** Index of `value` in the flattened options, or -1 when it is not offered. */
export function indexOfValue(flat: readonly FlatOption[], value: string): number {
  return flat.findIndex(option => option.value === value)
}

/** Label to show on the trigger: the selected option's, else the fallback. */
export function labelOfValue(flat: readonly FlatOption[], value: string, fallback: string): string {
  const found = flat.find(option => option.value === value)
  return found === undefined ? fallback : found.label
}

/**
 * Move the highlighted row by `delta`, wrapping at both ends. Coming from no
 * selection (-1), a forward step lands on the first row and a backward step on
 * the last, so opening a menu with a key press always highlights something.
 */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1
  return ((current + delta) % count + count) % count
}

/** Viewport-relative box of the trigger the menu hangs under. */
export interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

/** Visible viewport in CSS pixels. */
export interface ViewportSize {
  width: number
  height: number
}

/** Where the menu is painted: `top` for below-anchor, `bottom` for above. */
export interface MenuBox {
  placement: 'below' | 'above'
  left: number
  width: number
  /** Distance from the viewport top (placement 'below'). */
  top?: number
  /** Distance from the viewport bottom (placement 'above'). */
  bottom?: number
  /** Hard cap for the scrolling list, sized to the room on that side. */
  maxHeight: number
}

/** Distance between the trigger and the menu. */
export const MENU_GAP = 6
/** Minimum distance the menu keeps from every viewport edge. */
export const MENU_MARGIN = 8
/** The menu never gets narrower than this, even for a tiny trigger. */
export const MENU_MIN_WIDTH = 200
/** Preferred menu height; it shrinks instead of overflowing the viewport. */
export const MENU_MAX_HEIGHT = 320
/** Below this much room the menu would be useless, so it flips above. */
const MENU_MIN_ROOM = 160

/**
 * Place the menu under (or over) its trigger: full trigger width (never below
 * MENU_MIN_WIDTH), clamped into the viewport horizontally, flipped above when
 * the space below cannot hold a usable list, and capped to the room on the
 * chosen side so the list always scrolls inside the viewport.
 */
export function menuBox(
  anchor: AnchorRect,
  viewport: ViewportSize,
  maxHeight: number = MENU_MAX_HEIGHT,
): MenuBox {
  const available = viewport.width - MENU_MARGIN * 2
  const width = Math.max(0, Math.min(Math.max(anchor.width, MENU_MIN_WIDTH), available))
  const left = Math.min(
    Math.max(anchor.left, MENU_MARGIN),
    Math.max(MENU_MARGIN, viewport.width - width - MENU_MARGIN),
  )
  const below = viewport.height - (anchor.top + anchor.height) - MENU_GAP - MENU_MARGIN
  const above = anchor.top - MENU_GAP - MENU_MARGIN
  const placement: MenuBox['placement'] = below >= Math.min(maxHeight, MENU_MIN_ROOM) || below > above
    ? 'below'
    : 'above'
  const room = Math.max(80, placement === 'below' ? below : above)
  const height = Math.max(80, Math.min(maxHeight, room))
  if (placement === 'below') {
    return { placement, left, width, top: anchor.top + anchor.height + MENU_GAP, maxHeight: height }
  }
  return { placement, left, width, bottom: viewport.height - anchor.top + MENU_GAP, maxHeight: height }
}
