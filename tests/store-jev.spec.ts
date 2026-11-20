import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_MODEL, JEV_PROVIDER } from '../src/jev-shared.ts'

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Jev page-memory settings', () => {
  it('blocks moves without a key, then allows retry after key configuration', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ move: { row: 7, col: 7 } }) })
    vi.stubGlobal('fetch', fetch)
    const store = await import('../src/client/store.ts')
    store.patchSettings({ blackModel: { provider: JEV_PROVIDER, model: JEV_MODEL } })
    store.changeMode('white')
    expect(fetch).not.toHaveBeenCalled()
    expect(store.getSnapshot().game.thinking).toBe(false)
    expect(store.getSnapshot().game.log.at(-1)?.error).toContain('API Key')
    store.patchSettings({ jevApiKey: 'test-only-key' })
    store.retryMove()
    await vi.waitFor(() => expect(store.getSnapshot().game.moveCount).toBe(1))
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.jevApiKey).toBe('test-only-key')
    expect(body).not.toHaveProperty('thinking')
    store.newGame('black')
  })

  it('never attaches the Jev key to another provider request', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ move: { row: 7, col: 8 } }) })
    vi.stubGlobal('fetch', fetch)
    const store = await import('../src/client/store.ts')
    store.patchSettings({ jevApiKey: 'test-only-key', whiteModel: { provider: 'other', model: 'test' } })
    store.placeStone(7, 7)
    await vi.waitFor(() => expect(store.getSnapshot().game.moveCount).toBe(2))
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.provider).toBe('other')
    expect(body).not.toHaveProperty('jevApiKey')
    expect(body.thinking).toBe('off')
  })

  it('starts without a key after the page module is reloaded', async () => {
    const store = await import('../src/client/store.ts')
    store.patchSettings({ jevApiKey: 'test-only-key' })
    vi.resetModules()
    const reloaded = await import('../src/client/store.ts')
    expect(reloaded.getSnapshot().settings.jevApiKey).toBe('')
  })
})
