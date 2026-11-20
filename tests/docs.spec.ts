/**
 * Documentation guard.
 *
 * The READMEs publish the default system prompt verbatim and restate the move
 * limits, so they cannot be derived from src/limits.ts at runtime. These
 * checks fail with a readable diff instead of letting the docs drift silently
 * when a constant or the prompt changes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT } from '../src/index.ts'
import { MAX_MOVE_OUTPUT_TOKENS, MOVE_TIMEOUT_MS, MOVE_TIMEOUT_SECONDS } from '../src/limits.ts'

const read = (name: string): string => readFileSync(new URL('../' + name, import.meta.url), 'utf8')

describe.each(['README.md', 'README.en.md'])('%s stays in sync with src', (name) => {
  const text = read(name)

  it('publishes the default prompt verbatim', () => {
    const block = text.match(/```markdown\n([\s\S]*?)\n```/)
    expect(block, 'the README lost its verbatim prompt block').not.toBeNull()
    expect(block![1]!.trim()).toBe(DEFAULT_SYSTEM_PROMPT.trim())
  })

  it('restates the move limits from src/limits.ts', () => {
    expect(text).toContain(String(MOVE_TIMEOUT_MS))
    expect(text).toContain(String(MAX_MOVE_OUTPUT_TOKENS))
    expect(text).toContain(name === 'README.md' ? `${MOVE_TIMEOUT_SECONDS} 秒` : `${MOVE_TIMEOUT_SECONDS} s`)
  })
})
