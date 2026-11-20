import { describe, expect, it } from 'vitest'
import {
  detectScheme, parseColor, relativeLuminance, schemeFromBackground,
} from '../src/client/theme.ts'

describe('parseColor', () => {
  it('parses the hex forms getComputedStyle can produce', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#151517')).toEqual({ r: 21, g: 21, b: 23, a: 1 })
    expect(parseColor('#00000080')?.a).toBeCloseTo(128 / 255, 5)
  })

  it('parses rgb() and rgba()', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('rgba(21, 21, 23, 0.5)')).toEqual({ r: 21, g: 21, b: 23, a: 0.5 })
    expect(parseColor('rgb(100% 50% 0%)')).toEqual({ r: 255, g: 128, b: 0, a: 1 })
  })

  it('rejects transparent and unparsable colours', () => {
    expect(parseColor('transparent')).toBeUndefined()
    expect(parseColor('')).toBeUndefined()
    expect(parseColor('oklch(0.5 0.1 200)')).toBeUndefined()
  })
})

describe('relativeLuminance', () => {
  it('scores black at 0 and white at 1', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBe(1)
  })
})

describe('schemeFromBackground', () => {
  it('reads the light palette', () => {
    expect(schemeFromBackground('#fff')).toBe('light')
    expect(schemeFromBackground('rgb(246, 246, 247)')).toBe('light')
  })

  it('reads the dark palette', () => {
    expect(schemeFromBackground('#151517')).toBe('dark')
    expect(schemeFromBackground('rgb(39, 39, 48)')).toBe('dark')
  })

  it('skips see-through and unparsable backgrounds', () => {
    expect(schemeFromBackground('rgba(0, 0, 0, 0.04)')).toBeUndefined()
    expect(schemeFromBackground(undefined)).toBeUndefined()
    expect(schemeFromBackground('transparent')).toBeUndefined()
  })
})

describe('detectScheme', () => {
  it('falls back to light without a DOM (server rendering)', () => {
    expect(typeof document).toBe('undefined')
    expect(detectScheme(null)).toBe('light')
  })
})
