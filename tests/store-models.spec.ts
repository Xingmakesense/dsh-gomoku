import { afterEach, describe, expect, it, vi } from 'vitest'

/** A deferred promise for controlling a fetch response from the test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** Wait until a predicate holds (short real-timer poll). */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** A minimal Storage stand-in. */
function memoryStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(seed ? Object.entries(seed) : [])
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

/** Browser-ish globals the store touches. */
function stubBrowser(storage: Storage): void {
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  })
}

const catalogBody = {
  groups: [
    // A provider whose listing is empty must not win the default selection.
    { provider: 'empty-provider', displayName: 'Empty', models: [] },
    { provider: 'ok-provider', displayName: 'OK', models: [{ id: 'ok-model', name: 'OK model' }] },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('model catalog handling', () => {
  it('skips providers without models when choosing the default', async () => {
    stubBrowser(memoryStorage())
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, status: 200, json: async () => catalogBody }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const store = await import('../src/client/store.ts')
    store.loadModels()
    await waitFor(() => store.getSnapshot().settings.groups.length > 0)
    expect(store.getSnapshot().settings.blackModel).toEqual({ provider: 'ok-provider', model: 'ok-model' })
    expect(store.getSnapshot().settings.whiteModel).toEqual({ provider: 'ok-provider', model: 'ok-model' })
  })

  it('repairs a persisted selection that has a provider but no model', async () => {
    stubBrowser(memoryStorage({
      'dsh-gomoku:settings:v1': JSON.stringify({
        blackModel: { provider: 'empty-provider' },
        whiteModel: { provider: 'empty-provider' },
      }),
    }))
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, status: 200, json: async () => catalogBody }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const store = await import('../src/client/store.ts')
    expect(store.getSnapshot().settings.blackModel.model).toBeUndefined()
    store.loadModels()
    await waitFor(() => store.getSnapshot().settings.groups.length > 0)
    expect(store.getSnapshot().settings.blackModel).toEqual({ provider: 'ok-provider', model: 'ok-model' })
    expect(store.getSnapshot().settings.whiteModel).toEqual({ provider: 'ok-provider', model: 'ok-model' })
  })

  it('defers an AI start until the catalog arrives instead of failing', async () => {
    stubBrowser(memoryStorage())
    const catalog = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>()
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url))
      if (String(url).endsWith('/models')) return catalog.promise
      if (String(url).endsWith('/move')) {
        return { ok: true, status: 200, json: async () => ({ move: { row: 7, col: 7 }, reasoning: 'center' }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const store = await import('../src/client/store.ts')
    store.changeMode('both')
    // No fake failure while the catalog is still in flight.
    expect(store.getSnapshot().game.log).toHaveLength(0)
    expect(store.getSnapshot().game.thinking).toBe(false)

    catalog.resolve({ ok: true, status: 200, json: async () => catalogBody })
    await waitFor(() => store.getSnapshot().game.moveCount >= 1)
    expect(store.getSnapshot().game.log[0]?.error).toBeUndefined()
    expect(calls.filter(url => url.endsWith('/models'))).toHaveLength(1)
  })

  it('surfaces the real route error when the catalog request fails', async () => {
    stubBrowser(memoryStorage())
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/models')) {
        return { ok: false, status: 503, json: async () => ({ error: 'provider down' }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })
    const store = await import('../src/client/store.ts')
    store.newGame('both')
    await waitFor(() => store.getSnapshot().settings.modelsError === 'provider down')
    await waitFor(() => store.getSnapshot().game.log.some(entry => entry.error === 'provider down'))
    expect(store.getSnapshot().game.log[0]?.error).toBe('provider down')
  })
})