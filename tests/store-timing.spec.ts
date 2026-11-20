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
function memoryStorage(): Storage {
  const map = new Map<string, string>()
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
function stubBrowser(): void {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  })
}

const catalogBody = {
  groups: [{ provider: 'ok-provider', displayName: 'OK', models: [{ id: 'ok-model', name: 'OK model' }] }],
}

/** A fetch stub answering the catalog and delegating moves to `move`. */
function stubFetch(move: (url: string, init?: RequestInit) => Promise<unknown>): void {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/models')) {
      return { ok: true, status: 200, json: async () => catalogBody }
    }
    if (String(url).endsWith('/move')) return move(String(url), init)
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

/** An error shaped like the DOM's AbortError. */
function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('move timing', () => {
  it('records the node half duration and attempt count in the log', async () => {
    stubBrowser()
    stubFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({
        move: { row: 7, col: 7 }, reasoning: 'center', durationMs: 1234, attempts: 2,
      }),
    }))
    const store = await import('../src/client/store.ts')
    store.loadModels()
    await waitFor(() => store.getSnapshot().settings.groups.length > 0)
    store.newGame('both')
    await waitFor(() => store.getSnapshot().game.log.length > 0)

    const entry = store.getSnapshot().game.log[0]!
    expect(entry).toMatchObject({ side: 'black', move: '7,7', attempts: 2 })
    // The node half's clock wins over the client-side measurement.
    expect(entry.durationMs).toBe(1234)
    expect(store.getSnapshot().game.thinking).toBe(false)
    expect(store.getSnapshot().game.thinkingSince).toBeUndefined()
  })

  it('exposes the start time while a move is in flight', async () => {
    stubBrowser()
    const pending = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>()
    stubFetch(async () => pending.promise)
    const store = await import('../src/client/store.ts')
    store.loadModels()
    await waitFor(() => store.getSnapshot().settings.groups.length > 0)
    store.newGame('both')
    await waitFor(() => store.getSnapshot().game.thinking)

    const since = store.getSnapshot().game.thinkingSince
    expect(since).toBeGreaterThan(0)
    expect(Date.now() - (since ?? 0)).toBeLessThan(5000)

    pending.resolve({ ok: true, status: 200, json: async () => ({ move: { row: 7, col: 7 } }) })
    await waitFor(() => !store.getSnapshot().game.thinking)
    expect(store.getSnapshot().game.thinkingSince).toBeUndefined()
  })

  it('marks a paused (aborted) move as interrupted with its elapsed time', async () => {
    stubBrowser()
    stubFetch(async (_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted === true) {
        reject(abortError())
        return
      }
      signal?.addEventListener('abort', () => reject(abortError()), { once: true })
    }))
    const store = await import('../src/client/store.ts')
    store.loadModels()
    await waitFor(() => store.getSnapshot().settings.groups.length > 0)
    store.newGame('both')
    await waitFor(() => store.getSnapshot().game.thinking)

    store.togglePause()
    await waitFor(() => store.getSnapshot().game.log.length > 0)
    const entry = store.getSnapshot().game.log[0]!
    expect(entry.interrupted).toBe(true)
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    expect(store.getSnapshot().game.thinking).toBe(false)
    expect(store.getSnapshot().game.paused).toBe(true)
  })
})
