import { JEV_MODEL } from './jev-shared.ts'

/** Official native API, documented at https://docs.typesafe.ai/api. */
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** Jev chooses from legal intersections; it does not generate chat text. */
export async function requestJevMove(
  board: readonly number[], side: 'black' | 'white', system: string, apiKey: string, signal: AbortSignal,
): Promise<{ text: string; reasoning: string; truncated: boolean }> {
  const criteria: Record<string, { row: number; col: number }> = {}
  const opening = board.every(cell => cell === 0) && side === 'black'
  for (let index = 0; index < board.length; index++) {
    if (board[index] !== 0 || (opening && index !== 112)) continue
    const row = Math.floor(index / 15)
    const col = index % 15
    criteria[`${row},${col}`] = { row, col }
  }
  if (Object.keys(criteria).length === 0) return { text: '{"draw":true}', reasoning: '', truncated: false }

  let response: Response
  try {
    response = await fetch(JEV_ENDPOINT, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: {
          board: Array.from({ length: 15 }, (_, row) => board.slice(row * 15, (row + 1) * 15)),
          side, legend: { 0: 'empty', 1: 'black', 2: 'white' },
        },
        questions: {
          move: {
            type: 'choice',
            instructions: {
              strategy: system,
              task: 'Choose the strongest legal move for your side in freestyle Gomoku. Five or more in a row wins. Coordinates are zero-based. Follow the strategy for tactics; return the chosen option using the Choice API, not chat text or JSON prose.',
            },
            criteria,
          },
        },
      }),
    })
  } catch {
    signal.throwIfAborted()
    // Never echo a transport exception or upstream body: either may contain a key.
    throw Object.assign(new Error('Jev 连接失败，请稍后重试'), { code: 'TRANSPORT' })
  }
  if (!response.ok) {
    const status = response.status
    await response.body?.cancel()
    const message = status === 401 || status === 403
      ? 'Jev API Key 无效或没有访问权限，请重新设置'
      : status === 402 ? 'Jev 账户额度不足'
        : status === 429 ? 'Jev 请求过于频繁，请稍后重试'
          : `Jev 请求失败（HTTP ${status}）`
    throw Object.assign(new Error(message), { code: status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'SERVER' : 'AUTH' })
  }
  let body: unknown
  try { body = await response.json() } catch { throw new Error('Jev 返回了无法解析的响应') }
  signal.throwIfAborted()
  const answer = (body as { answers?: { move?: { type?: unknown; choice?: unknown } } } | null)?.answers?.move
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string' || !Object.hasOwn(criteria, answer.choice)) {
    throw new Error('Jev 未返回合法的候选落点')
  }
  const move = criteria[answer.choice]!
  return { text: JSON.stringify({ move: [move.row, move.col] }), reasoning: '', truncated: false }
}
