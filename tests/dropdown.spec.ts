import { describe, expect, it } from 'vitest'
import {
  MENU_GAP, MENU_MARGIN, MENU_MIN_WIDTH, MENU_MAX_HEIGHT,
  buildRows, flattenGroups, indexOfValue, labelOfValue, menuBox, stepIndex,
  type DropdownGroup,
} from '../src/client/dropdown-logic.ts'

const groups: DropdownGroup[] = [
  {
    label: 'DeepSeek',
    options: [
      { value: 'deepseek/a', label: 'A' },
      { value: 'deepseek/b', label: 'B' },
    ],
  },
  { label: 'Empty provider', options: [] },
  { label: 'OpenAI', options: [{ value: 'openai/c', label: 'C' }] },
]

const viewport = { width: 1200, height: 800 }
const anchorAt = (top: number, left = 100, width = 300) => ({ left, top, width, height: 32 })

describe('flattenGroups', () => {
  it('flattens the non-empty groups and numbers the options', () => {
    expect(flattenGroups(groups).map(option => option.value)).toEqual([
      'deepseek/a', 'deepseek/b', 'openai/c',
    ])
    expect(flattenGroups(groups).map(option => option.index)).toEqual([0, 1, 2])
    expect(flattenGroups(groups).map(option => option.group)).toEqual(['DeepSeek', 'DeepSeek', 'OpenAI'])
  })

  it('ignores groups without options', () => {
    expect(flattenGroups([{ label: 'none', options: [] }])).toEqual([])
  })
})

describe('buildRows', () => {
  it('emits a heading per non-empty group, then its options', () => {
    const kinds = buildRows(groups).map(row => row.kind === 'group' ? 'group:' + row.label : 'option:' + row.option.value)
    expect(kinds).toEqual([
      'group:DeepSeek', 'option:deepseek/a', 'option:deepseek/b',
      'group:OpenAI', 'option:openai/c',
    ])
  })

  it('numbers options continuously across groups', () => {
    const indexes = buildRows(groups).flatMap(row => row.kind === 'option' ? [row.option.index] : [])
    expect(indexes).toEqual([0, 1, 2])
  })
})

describe('indexOfValue and labelOfValue', () => {
  const flat = flattenGroups(groups)

  it('finds a selected option by its wire value', () => {
    expect(indexOfValue(flat, 'openai/c')).toBe(2)
    expect(indexOfValue(flat, 'gone/model')).toBe(-1)
  })

  it('falls back to the placeholder when the selection is not offered', () => {
    expect(labelOfValue(flat, 'deepseek/b', 'Select a model')).toBe('B')
    expect(labelOfValue(flat, 'gone/model', 'Select a model')).toBe('Select a model')
  })
})

describe('stepIndex', () => {
  it('wraps at both ends', () => {
    expect(stepIndex(0, 1, 3)).toBe(1)
    expect(stepIndex(2, 1, 3)).toBe(0)
    expect(stepIndex(0, -1, 3)).toBe(2)
  })

  it('lands on an end when nothing is highlighted yet', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0)
    expect(stepIndex(-1, -1, 3)).toBe(2)
  })

  it('reports no row for an empty list', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1)
  })
})

describe('menuBox', () => {
  it('opens below the trigger with the trigger width', () => {
    const box = menuBox(anchorAt(100), viewport)
    expect(box.placement).toBe('below')
    expect(box.top).toBe(100 + 32 + MENU_GAP)
    expect(box.left).toBe(100)
    expect(box.width).toBe(300)
    expect(box.maxHeight).toBe(MENU_MAX_HEIGHT)
  })

  it('widens to the minimum width for a narrow trigger', () => {
    const box = menuBox(anchorAt(100, 100, 40), viewport)
    expect(box.width).toBe(MENU_MIN_WIDTH)
  })

  it('flips above when the trigger sits near the bottom edge', () => {
    const box = menuBox(anchorAt(viewport.height - 40), viewport)
    expect(box.placement).toBe('above')
    expect(box.bottom).toBe(viewport.height - (viewport.height - 40) + MENU_GAP)
    expect(box.top).toBeUndefined()
  })

  it('caps the list height to the room below when that room is short', () => {
    // 800 - (560 + 32) - gap - margin = 194px of room: usable, but less than
    // the preferred height, so the list scrolls instead of overflowing.
    const box = menuBox(anchorAt(560), viewport)
    expect(box.placement).toBe('below')
    expect(box.maxHeight).toBeLessThan(MENU_MAX_HEIGHT)
    expect(box.maxHeight).toBe(194)
  })

  it('flips above rather than shrinking below the usable room', () => {
    const box = menuBox(anchorAt(viewport.height - 180), viewport)
    expect(box.placement).toBe('above')
  })

  it('clamps the menu inside the viewport horizontally', () => {
    const right = menuBox(anchorAt(100, viewport.width - 60), viewport)
    expect(right.left).toBe(viewport.width - right.width - MENU_MARGIN)
    const left = menuBox(anchorAt(100, -40), viewport)
    expect(left.left).toBe(MENU_MARGIN)
  })
})
