/**
 * A themed listbox that stands in for the native `<select>`.
 *
 * A native select paints its popup with OS/browser chrome that ignores the
 * host palette: in the dark appearance the option list came out as a white
 * sheet with near-invisible labels. This component draws the trigger and the
 * list itself, entirely from the plugin's `--dsw-alias-*` tokens, so the
 * picker follows the light and dark appearances like the rest of the page.
 *
 * The menu is portaled onto `document.body` and painted with
 * `position: fixed` (coordinates from dropdown-logic.ts). The portal matters:
 * a settings shell that animates with a transform makes every
 * `position: fixed` descendant position itself against that transformed
 * ancestor instead of the viewport, which put the list hundreds of pixels off
 * its trigger. Detached from that ancestor it is also never clipped by the
 * settings scroll container. Keyboard: Arrow/Home/End move, Enter/Space
 * choose, Escape closes, Tab leaves; focus stays on the trigger and the active
 * row is published through `aria-activedescendant`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  buildRows, flattenGroups, indexOfValue, labelOfValue, menuBox, stepIndex,
  type DropdownGroup, type MenuBox,
} from './dropdown-logic.ts'
import type { ColorScheme } from './theme.ts'
import css from './Gomoku.module.css'

/** Props of one dropdown: the label above it plus the option groups. */
export interface DropdownProps {
  /** Field label, rendered above the trigger and used as its accessible name. */
  label: string
  /** Currently selected wire value ('' when nothing is selected yet). */
  value: string
  /** Selectable groups, in catalog order. */
  groups: readonly DropdownGroup[]
  /** Trigger text while nothing is selected. */
  placeholder: string
  /** Text shown when the list has no options at all. */
  emptyText: string
  /** Called with the chosen value; the menu closes first. */
  onChange: (value: string) => void
  /** Renders the trigger inert (e.g. the catalog is still loading). */
  disabled?: boolean
  /** The appearance the portaled menu paints itself in. */
  scheme?: ColorScheme
}

/** The model picker: a token-themed listbox. */
export function Dropdown({
  label, value, groups, placeholder, emptyText, onChange, disabled = false, scheme,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [box, setBox] = useState<MenuBox | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const labelId = useId()

  const flat = useMemo(() => flattenGroups(groups), [groups])
  const rows = useMemo(() => buildRows(groups), [groups])
  const selected = useMemo(() => indexOfValue(flat, value), [flat, value])
  const triggerLabel = useMemo(() => labelOfValue(flat, value, placeholder), [flat, value, placeholder])

  const closeMenu = useCallback((restoreFocus = false): void => {
    setOpen(false)
    setActive(-1)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  /** Re-measure the trigger and re-clamp the menu into the viewport. */
  const placeMenu = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return
    const rect = trigger.getBoundingClientRect()
    setBox(menuBox(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    ))
  }, [])

  const openMenu = useCallback((): void => {
    if (disabled) return
    setActive(selected >= 0 ? selected : (flat.length > 0 ? 0 : -1))
    setOpen(true)
  }, [disabled, selected, flat.length])

  // Measured before paint so the menu never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (open) placeMenu()
  }, [open, placeMenu])

  // Follow the page while the menu is open, and close on any outside press.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target !== null
        && (rootRef.current?.contains(target) === true || menuRef.current?.contains(target) === true)) return
      closeMenu()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('scroll', placeMenu, true)
    window.addEventListener('resize', placeMenu)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('scroll', placeMenu, true)
      window.removeEventListener('resize', placeMenu)
    }
  }, [open, placeMenu, closeMenu])

  // A disabled control must not keep an open menu around.
  useEffect(() => {
    if (disabled && open) closeMenu()
  }, [disabled, open, closeMenu])

  // Keep the highlighted row inside the scrolling list.
  useEffect(() => {
    if (!open || active < 0) return
    const node = menuRef.current?.querySelector('[data-active="true"]')
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (index: number): void => {
    const option = flat[index]
    if (option === undefined) return
    onChange(option.value)
    closeMenu(true)
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (open) setActive(stepIndex(active, 1, flat.length))
        else openMenu()
        break
      case 'ArrowUp':
        event.preventDefault()
        if (open) setActive(stepIndex(active, -1, flat.length))
        else openMenu()
        break
      case 'Home':
        if (!open) break
        event.preventDefault()
        setActive(stepIndex(-1, 1, flat.length))
        break
      case 'End':
        if (!open) break
        event.preventDefault()
        setActive(stepIndex(-1, -1, flat.length))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) {
          if (active >= 0) choose(active)
        } else {
          openMenu()
        }
        break
      case 'Escape':
        if (!open) break
        event.preventDefault()
        closeMenu(true)
        break
      case 'Tab':
        if (open) closeMenu()
        break
      default:
        break
    }
  }

  return (
    <div className={css.field} ref={rootRef}>
      <span className={css.label} id={labelId}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? listId + '-' + active : undefined}
        onClick={() => { if (open) closeMenu(true); else openMenu() }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={css.triggerLabel + (selected < 0 ? ' ' + css.triggerPlaceholder : '')}>{triggerLabel}</span>
        <span className={css.triggerChevron + (open ? ' ' + css.triggerChevronOpen : '')} aria-hidden="true">▾</span>
      </button>

      {open && box !== null && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          data-gomoku-theme={scheme}
          className={css.menu}
          style={{
            left: box.left,
            width: box.width,
            maxHeight: box.maxHeight,
            colorScheme: scheme,
            ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }),
          }}
        >
          {flat.length === 0 && <div className={css.menuEmpty}>{emptyText}</div>}
          {rows.map((row, position) => row.kind === 'group'
            ? (
              <div key={'group-' + row.label + '-' + position} className={css.menuGroup} aria-hidden="true">
                {row.label}
              </div>
            )
            : (
              <div
                key={'option-' + row.option.value}
                id={listId + '-' + row.option.index}
                role="option"
                aria-selected={row.option.value === value}
                aria-label={row.option.group === '' ? row.option.label : row.option.group + ' · ' + row.option.label}
                data-active={row.option.index === active ? 'true' : undefined}
                className={css.menuOption
                  + (row.option.index === active ? ' ' + css.menuOptionActive : '')
                  + (row.option.value === value ? ' ' + css.menuOptionSelected : '')}
                onMouseEnter={() => setActive(row.option.index)}
                onClick={() => choose(row.option.index)}
              >
                <span className={css.menuOptionLabel}>{row.option.label}</span>
                {row.option.value === value && <span className={css.menuCheck} aria-hidden="true">✓</span>}
              </div>
            ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
