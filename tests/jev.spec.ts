import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestJevMove, JEV_ENDPOINT } from '../src/jev.ts'
import { JEV_MODEL, JEV_PROVIDER } from '../src/jev-shared.ts'
import { validateMoveRequest } from '../src/index.ts'

const board = () => Array<number>(225).fill(0)
const request = (extra: object = {}) => ({
  provider: JEV_PROVIDER, model: JEV_MODEL, board: board(), side: 'black', ...extra,
})
const answer = (choice: string) => new Response(JSON.stringify({ answers: { move: { type: 'choice', choice } } }))
const call = (cells = board(), side: 'black' | 'white' = 'black') =>
  requestJevMove(cells, side, 'Win the game', 'test-only-key', new AbortController().signal)

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Jev authentication boundary', () => {
  it.each([undefined, '', ' ', 'a\nb', 'a b', '密钥', 'x'.repeat(4097)])('requires a valid key (%s)', key => {
    expect(() => validateMoveRequest(request({ jevApiKey: key }))).toThrow(/API Key/)
  })
  it('normalizes keys and rejects unsupported models or keys attached to other providers', () => {
    expect(validateMoveRequest(request({ jevApiKey: ' key ' })).jevApiKey).toBe('key')
    expect(() => validateMoveRequest(request({ model: 'other', jevApiKey: 'key' }))).toThrow(/模型/)
    expect(() => validateMoveRequest(request({ provider: 'test', jevApiKey: 'key' }))).toThrow(/只能用于/)
  })
})

describe('Jev native Choice API', () => {
  it('sends the credential only in the authorization header and enforces the center opening', async () => {
    const fetch = vi.fn().mockResolvedValue(answer('7,7'))
    vi.stubGlobal('fetch', fetch)
    expect(await call()).toEqual({ text: '{"move":[7,7]}', reasoning: '', truncated: false })
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(JEV_ENDPOINT)
    expect(options.headers.authorization).toBe('Bearer test-only-key')
    expect(options.redirect).toBe('error')
    expect(options.body).not.toContain('test-only-key')
    expect(JSON.parse(options.body)).toMatchObject({
      model: JEV_MODEL, state: { side: 'black' },
      questions: { move: { type: 'choice', criteria: { '7,7': { row: 7, col: 7 } } } },
    })
    expect(Object.keys(JSON.parse(options.body).questions.move.criteria)).toEqual(['7,7'])
  })

  it('offers all empty cells after the opening and accepts a legal choice', async () => {
    const cells = board(); cells[112] = 1
    const fetch = vi.fn().mockResolvedValue(answer('7,8'))
    vi.stubGlobal('fetch', fetch)
    expect((await call(cells, 'white')).text).toBe('{"move":[7,8]}')
    const criteria = JSON.parse(fetch.mock.calls[0][1].body).questions.move.criteria
    expect(Object.keys(criteria)).toHaveLength(224)
    expect(criteria).not.toHaveProperty('7,7')
  })

  it.each(['0,0', '99,99', '__proto__'])('rejects a choice outside the submitted options: %s', async choice => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(choice)))
    await expect(call()).rejects.toThrow(/候选落点/)
  })

  it.each([null, {}, { answers: { move: { type: 'noul', noul: 0.9 } } }])('rejects malformed response shapes', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(call()).rejects.toThrow(/候选落点/)
  })

  it.each([[401, 'AUTH'], [402, 'AUTH'], [429, 'RATE_LIMIT'], [503, 'SERVER']])('maps HTTP %s without exposing upstream content', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('test-only-key', { status: status as number })))
    await expect(call()).rejects.toMatchObject({ code })
    await expect(call()).rejects.not.toThrow('test-only-key')
  })

  it('does not echo network errors and respects cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('test-only-key')))
    await expect(call()).rejects.toMatchObject({ code: 'TRANSPORT', message: 'Jev 连接失败，请稍后重试' })
    const controller = new AbortController(); controller.abort(new Error('test deadline'))
    await expect(requestJevMove(board(), 'black', '', 'test-only-key', controller.signal)).rejects.toThrow('test deadline')
  })

  it('does not call the provider on a full board', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await call(Array(225).fill(1))).text).toBe('{"draw":true}')
    expect(fetch).not.toHaveBeenCalled()
  })
})
