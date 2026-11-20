import { afterEach, describe, expect, it, vi } from 'vitest'

/** An in-memory Storage stand-in for the browser API. */
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

afterEach(() => { vi.unstubAllGlobals() })

describe('settings persistence', () => {
  it('persists model, thinking and prompt choices without the Jev key', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const store = await import('../src/client/store.ts')

    store.patchSettings({
      blackThinking: 'max',
      whiteThinking: 'high',
      blackPrompt: 'custom black prompt',
      blackModel: { provider: 'prov', model: 'model' },
      jevApiKey: 'secret-jev-key',
    })

    const raw = storage.getItem(store.SETTINGS_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('secret-jev-key')
    expect(JSON.parse(raw!)).toEqual(expect.objectContaining({
      blackThinking: 'max',
      whiteThinking: 'high',
      blackPrompt: 'custom black prompt',
      blackModel: { provider: 'prov', model: 'model' },
    }))
  })

  it('restores defaults (and keeps the loaded catalog) on reset', async () => {
    const storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const store = await import('../src/client/store.ts')
    store.patchSettings({
      blackThinking: 'max',
      blackPrompt: 'custom',
      jevApiKey: 'secret',
      mode: 'both',
    })

    store.resetSettings()
    const settings = store.getSnapshot().settings
    expect(settings.blackThinking).toBe('off')
    expect(settings.blackPrompt).toBeUndefined()
    expect(settings.jevApiKey).toBe('')
    expect(settings.mode).toBe('black')
    expect(store.getSnapshot().game.moveCount).toBe(0)
    // reset persists the defaults again rather than leaving the old snapshot
    const raw = storage.getItem(store.SETTINGS_STORAGE_KEY)!
    expect(raw).not.toContain('secret')
    expect(JSON.parse(raw).mode).toBe('black')
  })
})
