import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { LlmAdapter, LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as gomoku from '../src/index.ts'

// Exercise the actual host services and their config/lifecycle contracts.
// Only the provider transport is fake: these tests never spend model tokens.
class TestAdapter extends LlmAdapter {
  calls: GenerateOptions[] = []
  /** How many times the runtime resolved a model's capabilities. */
  resolved = 0
  /** Advertised output-token ceiling (absent = no clamp). */
  defaultMaxTokens?: number
  /** Provider usage chunk emitted before the terminal finish. */
  usage?: { inputTokens: number; outputTokens: number; reasoningTokens?: number }
  replies = ['{"move":[7,7]}']

  async listModels(provider: string) {
    if (provider === 'unavailable') throw new Error('catalog unavailable')
    return [{ provider, id: 'test-model', name: 'Test model' }]
  }

  async resolveModel(provider: string, id: string) {
    this.resolved += 1
    return {
      provider, id, name: 'Test model',
      ...(this.defaultMaxTokens !== undefined ? { defaultMaxTokens: this.defaultMaxTokens } : {}),
      reasoning: {
        efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
        defaultEffort: ReasoningEffortId('high'),
      },
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    const text = this.replies.shift() ?? '{"move":[7,7]}'
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: 'Choose the center.' }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Choose the center.' } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text }
    yield { type: 'block-end', index: 1, block: { type: 'text', text } }
    if (this.usage !== undefined) yield { type: 'usage', usage: this.usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('DSH host integration', () => {
  let ctx: Context
  let adapter: TestAdapter
  let base: string
  let plugin: ReturnType<Context['plugin']>

  beforeEach(async () => {
    ctx = new Context()
    adapter = new TestAdapter()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }).await()
    await ctx.plugin(LlmRuntime).await()
    ctx.llm.registerAdapter(['test', 'unavailable'], adapter)
    plugin = ctx.plugin(gomoku, {})
    await plugin.await()
    base = `http://127.0.0.1:${ctx.webServer.port}${gomoku.GOMOKU_PATH}`
  })

  afterEach(async () => { vi.restoreAllMocks(); await ctx?.fiber.dispose() })

  const request = (overrides: object = {}) => ({
    provider: 'test', model: 'test-model', side: 'black',
    board: Array(225).fill(0), ...overrides,
  })

  const post = (base: string, body: object) => fetch(`${base}/move`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

  it('loads the config defaults and serves prompt and partial model catalogs', async () => {
    expect(await (await fetch(`${base}/prompt`)).json()).toEqual({ prompt: gomoku.DEFAULT_SYSTEM_PROMPT })
    expect(await (await fetch(`${base}/models`)).json()).toEqual({
      groups: [
        { provider: 'test', displayName: 'test', models: [{ id: 'test-model', name: 'Test model' }] },
        { provider: 'gomoku-jev', displayName: 'Jev · TypeSafe', models: [{ id: 'jev-latest', name: 'Jev' }] },
      ],
      failures: [{ provider: 'unavailable', error: 'catalog unavailable' }],
    })
  })

  it('streams an identity-free move request with reasoning and schema defaults', async () => {
    const response = await post(base, request({ thinking: 'high' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      move: { row: 7, col: 7 }, reasoning: 'Choose the center.', attempts: 1,
    })
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]).toMatchObject({
      maxTokens: 32000, reasoningEffort: 'high', system: gomoku.DEFAULT_SYSTEM_PROMPT,
    })
    expect(adapter.calls[0].messages[0]).not.toHaveProperty('source')
    expect(adapter.calls[0].messages[0]).not.toHaveProperty('id')
  })

  it('falls back to model reasoning defaults and preserves custom prompt/token settings', async () => {
    const response = await post(base, request({ thinking: 'max', system: 'Custom rules', maxMoveOutputTokens: 512 }))
    expect(response.status).toBe(200)
    expect(adapter.calls[0]).toMatchObject({ reasoningEffort: 'high', system: 'Custom rules', maxTokens: 512 })
  })

  it('retries an occupied move with corrective feedback', async () => {
    adapter.replies = ['{"move":[7,7]}', '{"move":[7,8]}']
    const board = Array(225).fill(0)
    board[7 * 15 + 7] = 1
    const response = await post(base, request({ side: 'white', board }))
    expect(await response.json()).toMatchObject({ move: { row: 7, col: 8 } })
    expect(adapter.calls).toHaveLength(2)
    expect(JSON.stringify(adapter.calls[1].messages)).toContain('已被占用')
  })

  it('resolves model capabilities once and records per-move diagnostics', async () => {
    const before = adapter.resolved
    expect((await post(base, request({ thinking: 'high' }))).status).toBe(200)
    const afterFirst = adapter.resolved
    expect((await post(base, request({ thinking: 'high' }))).status).toBe(200)
    const afterSecond = adapter.resolved
    // The runtime resolves a model while streaming too; the plugin's own cached
    // lookup must vanish from the second move, so it is exactly one call fewer.
    const firstMoveLookups = afterFirst - before
    const secondMoveLookups = afterSecond - afterFirst
    expect(secondMoveLookups).toBe(firstMoveLookups - 1)

    const body = await (await fetch(`${base}/log`)).json() as {
      entries: { side: string; attempts: number; durationMs: number; outcome: string }[]
    }
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0]).toMatchObject({ side: 'black', attempts: 1, outcome: 'move 7,7' })
    expect(body.entries[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('clamps the output budget to the model default and reports token usage', async () => {
    adapter.defaultMaxTokens = 4096
    adapter.usage = { inputTokens: 900, outputTokens: 40, reasoningTokens: 12 }
    const response = await post(base, request({ thinking: 'off', maxMoveOutputTokens: 32000 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      move: { row: 7, col: 7 },
      maxTokens: 4096,
      usage: { inputTokens: 900, outputTokens: 40, reasoningTokens: 12 },
    })
    expect(adapter.calls.at(-1)?.maxTokens).toBe(4096)

    const log = await (await fetch(`${base}/log`)).json() as {
      entries: { maxTokens?: number; usage?: { inputTokens: number } }[]
    }
    expect(log.entries.at(-1)).toMatchObject({ maxTokens: 4096, usage: { inputTokens: 900 } })
  })

  it('backs off before retrying a rejected move instead of hammering the provider', async () => {
    adapter.replies = ['{"move":[7,7]}', '{"move":[7,8]}']
    const board = Array(225).fill(0)
    board[7 * 15 + 7] = 1
    const startedAt = Date.now()
    const response = await post(base, request({ side: 'white', board }))
    expect(await response.json()).toMatchObject({ move: { row: 7, col: 8 }, attempts: 2 })
    // One retry means one backoff step (>= 400ms with jitter).
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(400)
  })

  it('rejects malformed requests without calling a model and removes routes on unload', async () => {
    expect((await post(base, request({ board: [] }))).status).toBe(400)
    expect(adapter.calls).toHaveLength(0)
    await plugin.dispose()
    expect((await fetch(`${base}/prompt`)).status).toBe(404)
  })

  it('routes Jev through its native API and never through the host chat adapter', async () => {
    const nativeFetch = globalThis.fetch
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { move: { type: 'choice', choice: '7,7' } },
    })))
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, options) =>
      url === 'https://api.typesafe.ai/v1/systemone' ? upstream(url, options) : nativeFetch(url, options))
    const body = request({ provider: 'gomoku-jev', model: 'jev-latest', jevApiKey: 'test-only-key' })
    expect(await (await post(base, body)).json()).toMatchObject({ move: { row: 7, col: 7 }, reasoning: '' })
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(adapter.calls).toHaveLength(0)
    const missing = await post(base, { ...body, jevApiKey: '' })
    expect(missing.status).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
})
