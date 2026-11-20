/**
 * The page-side reasoning log is capped so a long session cannot grow it
 * without bound; store.commitGame enforces the caps through trimLog.
 */
import { describe, expect, it } from 'vitest'
import { MAX_LOG_CHARS, MAX_LOG_ENTRIES, trimLog, type ReasoningEntry } from '../src/client/store.ts'

const entry = (n: number, chars: number): ReasoningEntry => ({
  n, side: 'black', move: null, reasoning: 'x'.repeat(chars),
})

describe('reasoning log caps', () => {
  it('keeps only the newest entries beyond the entry cap', () => {
    const log = Array.from({ length: MAX_LOG_ENTRIES + 25 }, (_, i) => entry(i + 1, 1))
    const kept = trimLog(log)
    expect(kept).toHaveLength(MAX_LOG_ENTRIES)
    expect(kept[0]!.n).toBe(26)
    expect(kept.at(-1)!.n).toBe(MAX_LOG_ENTRIES + 25)
  })

  it('drops the oldest entries until the character cap holds', () => {
    const log = [entry(1, 200_000), entry(2, 200_000), entry(3, 200_000)]
    const kept = trimLog(log)
    expect(kept.reduce((sum, item) => sum + item.reasoning.length, 0)).toBeLessThanOrEqual(MAX_LOG_CHARS)
    expect(kept.at(-1)!.n).toBe(3)
  })

  it('keeps a single oversized entry rather than emptying the log', () => {
    const kept = trimLog([entry(1, MAX_LOG_CHARS + 1)])
    expect(kept).toHaveLength(1)
  })
})
