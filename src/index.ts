/**
 * Gomoku (five-in-a-row) node half for the dsh web GUI. The plugin owns three
 * routes under `/plugins/gomoku`:
 *
 * - `GET  /plugins/gomoku/prompt`  — the default system prompt (game rules,
 *   strict return format, and worked examples). The browser half fetches it to
 *   show and to restore, so the rules text lives in exactly one place.
 * - `GET  /plugins/gomoku/models`  — the model catalog (registered provider
 *   routes and their models) for the side-model selectors.
 * - `POST /plugins/gomoku/move`    — frame the board into a single-shot LLM
 *   request through the chosen provider/model route (optionally with a
 *   thinking level and per-request timeout/token overrides), parse and
 *   validate the reply, and return the chosen intersection plus the model's
 *   reasoning text. Transient stream failures (a dropped connection, a
 *   provider rate limit) retry within the attempt budget before the request
 *   gives up.
 *
 * The board itself (state, turn order, win detection) lives in the browser
 * half; this plugin only arbitrates AI moves, so a malformed or illegal model
 * reply is rejected here and can never corrupt the client-side board.
 *
 * The game is freestyle gomoku (no forbidden moves): black may play double
 * threes, double fours, and overlines freely — any five-in-a-row or longer
 * wins. That rule, the return format, the blocking/attack tactics, and the
 * correct examples are all spelled out in {@link DEFAULT_SYSTEM_PROMPT};
 * users may hand-edit the prompt in the UI, in which case the edited text is
 * sent verbatim as the system prompt.
 * @module @xingmakesense/dsh-gomoku
 */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  FAST_RETRY_RESERVE_MS, MAX_CANDIDATES, MAX_MOVE_ATTEMPTS, MAX_MOVE_OUTPUT_TOKENS, MOVE_TIMEOUT_MS, MOVE_TIMEOUT_SECONDS,
} from './limits.ts'
import type {
  ContentBlock, FinishReason, GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, RequestUserInput, TokenUsage,
} from '@deepseek-ai/dsh-llm'
// Type-only: the ctx.webServer merge (the webserver host plugin).
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { JEV_MODEL, JEV_PROVIDER, isValidJevApiKey } from './jev-shared.ts'
import { requestJevMove } from './jev.ts'
import { analyzeThreats, candidateOptions, threatHintText } from './threats.ts'

/** Cordis plugin name (diagnostics only). */
export const name = 'gomoku'

/** Services required before the board routes can mount. */
export const inject = ['webServer', 'llm']

/** Board edge length in intersections (standard freestyle gomoku board). */
export const BOARD_SIZE = 15

/** Empty intersection. */
export const EMPTY = 0
/** Black stone (moves first). */
export const BLACK = 1
/** White stone (moves second). */
export const WHITE = 2

/** The side an AI move request plays for. */
export type GomokuSide = 'black' | 'white'

/**
 * The reasoning effort for one move request: any id the selected model
 * advertises in its native reasoning metadata (the host resolves it). Omitted
 * when the move follows the model's own default effort.
 */
export type GomokuThinking = string

/**
 * The fastest reasoning effort a model declares: "off" when it offers one,
 * otherwise its first (least) declared effort. A move retried after a failure
 * runs the same model at this effort, so a slow or truncated first attempt
 * still leaves room for a quick second one inside the same deadline.
 * @param efforts - declared efforts, ordered least to greatest.
 * @returns the effort id for the fast retry, or undefined when the model
 *   declares none (its own default then applies).
 */
export function fastestEffort(efforts: readonly { id: string }[]): string | undefined {
  if (efforts.some(effort => effort.id === 'off')) return 'off'
  return efforts.length > 0 ? efforts[0]!.id : undefined
}

/** Required plugin configuration. */
export interface Config {
  /** End-to-end deadline for one AI move request (all attempts), in milliseconds. */
  moveTimeoutMs: number
  /** Output-token cap for one AI move reply. */
  maxMoveOutputTokens: number
  /** Total AI move attempts per request (1 = no retry); the last attempt carries corrective feedback. */
  maxMoveAttempts: number
}

/** Loader schema with deployment defaults (no library defaults). */
export const Config: z<Config> = z.object({
  // Fixed at the product level: the browser half always sends these values
  // per request, and the node half clamps requests to this policy, so a caller
  // can only tighten the deadline, never widen it.
  moveTimeoutMs: z.number().step(1).min(1000).default(MOVE_TIMEOUT_MS),
  // Small by default: the model has thirty seconds per move, and the output
  // budget is exactly what it spends thinking. A reply cut short is still
  // parsed when the JSON itself survives the cut.
  maxMoveOutputTokens: z.number().step(1).min(8).default(MAX_MOVE_OUTPUT_TOKENS),
  maxMoveAttempts: z.number().step(1).min(1).max(5).default(MAX_MOVE_ATTEMPTS),
})

/** Route prefix owned by this plugin (the browser half calls under it). */
export const GOMOKU_PATH = '/plugins/gomoku'

/**
 * The default system prompt: freestyle (no forbidden moves) gomoku rules, a
 * strict threat-first priority list (win → block a five → four/three
 * combinations → block a live three → build threats), a bounded candidate
 * scan with a compact scoring rule, and the strict JSON return format. Kept
 * deliberately short: the board text and the model's hidden thinking dominate
 * a move request, so a compact prompt is faster and leaves more budget for
 * play. Users may edit this text in Settings → Gomoku; the edited text
 * replaces it verbatim per move request.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  '你是五子棋落子引擎（无禁手，任意方向连成 5 子及以上即胜）。为指定执子方选择当前最优的一步合法空点。判断在内部完成，只输出 JSON。',
  '',
  '# 快速判断（按优先级，命中即停）',
  '1. 己方成五：任一方向己方已有连续 4 子（含跳四）且空端可成五 → 立即落子取胜。',
  '2. 对手成五：对手 4 子的成五点 → 必须封堵；若对手活四无法单点封堵，则改走己方最快取胜点。消息中的威胁提示会列出这些点。',
  '3. 己方强攻：能形成活四、冲四或「四三」的点优先；冲四可迫使对手应手，为下一手争取先手。',
  '4. 对手活三：立即封堵其一端；若一子能同时封堵两个威胁（双防点），优先选双防点。威胁提示会列出对方可形成活四的点。',
  '5. 己方活三/双活三：无紧急威胁时，选择能形成活三、双活三或多方向连线的点。',
  '6. 布局：靠近天元与双方已有棋群，保持连线；避免边角、孤立与没有后续的落点。',
  '',
  '# 时间预算（硬性）',
  `每一步只有 ${MOVE_TIMEOUT_SECONDS} 秒，思考与输出都算在内，超时这一手立即作废。不要展开长链推演：按上面的优先级自上而下扫描，命中第一条能执行的规则就落子；候选点最多比较 ${MAX_CANDIDATES} 个，拿不准就选最靠近现有棋群、最能延续连线的点。`,
  '',
  '# 术语',
  '活三＝3 连且两端可延伸（下一步可成活四）；冲四＝4 连且仅一端可成五；活四＝两端均可成五、无法单点封堵；双活三/四三＝一子同时形成两个活三 / 冲四加活三，均为强杀。',
  '',
  '# 威胁提示',
  '每次请求附带程序计算的威胁清单：对方可直接成五 / 活三（落子即形成活四）与冲四的点，以及己方机会。它只作参考，不强制落子；出现对方成五点或活三时必须优先处理，再考虑进攻。',
  '',
  `# 候选比较（最多评估 ${MAX_CANDIDATES} 个点）`,
  '- 只考虑现有棋子 2 格以内的空点；黑方首手固定天元 (7,7)。',
  '- 评分＝进攻价值（成 5 > 活四 > 冲四 > 活三 > 双三/四三 > 活二）＋防守价值（封成 5 > 封冲四 > 封活三/双防）。',
  '- 同分依次比较：能否强制对手应手 → 是否连接更多棋子 → 是否更靠近中心。',
  '- 宁可下在能持续进攻的要点，也不下没有后续的孤子。',
  '',
  '# 输出（严格遵守）',
  '只输出一行 JSON，不要解释或 Markdown：{"move": [row, col]}',
  '和棋：{"draw": true}',
  '无法判断：{"error": "一句话原因"}',
  'row、col 为 0–14 的整数，目标点必须为空。',
].join('\n')

/** The wire shape of one model group served to the browser half. */
export interface ModelGroupWire {
  /** Provider route key (passed back as the move request's `provider`). */
  provider: string
  /** Human-readable provider name. */
  displayName: string
  /** The provider's selectable models. */
  models: { id: string; name: string }[]
}

/** One provider whose model listing failed (the sound groups still serve). */
export interface ModelFailureWire {
  provider: string
  error: string
}

/** A parsed AI move reply (before board legality is checked). */
export type MoveReply =
  | { kind: 'move'; row: number; col: number }
  | { kind: 'draw' }
  | { kind: 'error'; message: string }
  | { kind: 'invalid'; reason: string }

/** The validated move-request wire body. */
export interface MoveRequestBody {
  /** Jev credential, supplied per request and never persisted by this plugin. */
  jevApiKey?: string
  /** Registered provider route key. */
  provider: string
  /** Model id the provider accepts. */
  model: string
  /** The side the AI plays in this request. */
  side: GomokuSide
  /** BOARD_SIZE² cells in row-major order: 0 empty, 1 black, 2 white. */
  board: number[]
  /** Custom system prompt; empty or absent falls back to the default. */
  system?: string
  /**
   * Model-native reasoning effort id; forwarded only when the selected model
   * advertises that effort, otherwise the model's own default applies.
   */
  thinking?: GomokuThinking
  /** Per-request deadline override (milliseconds); absent uses the config default. */
  moveTimeoutMs?: number
  /** Per-request output-token cap override; absent uses the config default. */
  maxMoveOutputTokens?: number
}

/**
 * Whether an intersection is inside the board and currently empty.
 * @param board - row-major cell values (length must be BOARD_SIZE²).
 * @param row - intersection row.
 * @param col - intersection column.
 * @returns true when the move may be played.
 */
export function isLegalMove(board: readonly number[], row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
    && board[row * BOARD_SIZE + col] === EMPTY
}

/**
 * Render the board as the 16-line labeled text the prompt describes: a
 * column-number header (digits aligned over their columns) followed by one
 * line per row, each prefixed with its row number, one character per
 * intersection.
 * @param board - row-major cell values (length must be BOARD_SIZE²).
 * @returns the labeled board text.
 */
export function boardText(board: readonly number[]): string {
  // Compact framed board: one character per intersection, row labels on the
  // left and a two-digit column header (tens over units). The previous
  // three-characters-per-cell grid said the same thing in ~2.5x the text; the
  // model pays for every character on every move.
  const tens = Array.from({ length: BOARD_SIZE }, (_, col) => String(Math.floor(col / 10))).join('')
  const units = Array.from({ length: BOARD_SIZE }, (_, col) => String(col % 10)).join('')
  const lines: string[] = [`  ${tens}`, `  ${units}`]
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let line = String(row).padStart(2)
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = board[row * BOARD_SIZE + col]
      line += cell === BLACK ? 'B' : cell === WHITE ? 'W' : '·'
    }
    lines.push(line)
  }
  return lines.join('\n')
}

/** Tolerant extraction of the JSON object region from a model reply (first `{` … last `}`). */
function jsonObjectRegion(text: string): string | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  return text.slice(start, end + 1)
}

/**
 * Parse and shape-check one model reply into a {@link MoveReply}. The reply
 * may wrap the JSON in prose or a code fence (models do), so the object
 * region is extracted before parsing; the move coordinates themselves are
 * still strictly validated here.
 * @param text - the assembled model reply text.
 * @returns the parsed reply.
 */
export function parseMoveReply(text: string): MoveReply {
  const region = jsonObjectRegion(text)
  if (region === undefined) return { kind: 'invalid', reason: '回复中没有 JSON 对象' }
  let parsed: unknown
  try {
    parsed = JSON.parse(region)
  } catch {
    return { kind: 'invalid', reason: '回复中的 JSON 无法解析' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'invalid', reason: '回复不是 JSON 对象' }
  }
  const value = parsed as Record<string, unknown>
  const error = value.error
  if (typeof error === 'string') return { kind: 'error', message: error }
  if (value.draw === true) return { kind: 'draw' }
  const move = value.move
  if (Array.isArray(move) && move.length === 2
    && Number.isInteger(move[0]) && Number.isInteger(move[1])
    && typeof move[0] === 'number' && typeof move[1] === 'number') {
    const row = move[0]
    const col = move[1]
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return { kind: 'invalid', reason: `落子坐标越界：[${row}, ${col}]` }
    }
    return { kind: 'move', row, col }
  }
  return { kind: 'invalid', reason: '缺少合法的 move 字段（应为 [row, col] 整数坐标）' }
}

/** Translate a terminal finish reason into a move failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('gomoku: AI 回复超过最大输出长度')
    case 'tool-calls':
      return new Error('gomoku: AI 意外请求了工具调用')
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default:
      return new Error(`gomoku: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** One attempt's assembled reply, reasoning, and whether the output budget cut it short. */
interface MoveAttemptText {
  /** The model's assembled visible text (may be incomplete). */
  text: string
  /** The model's reasoning/thinking text, when the reply carried any. */
  reasoning: string
  /** True when the stream hit maxMoveOutputTokens (the JSON may still be complete). */
  truncated: boolean
  /** Provider-reported token accounting for this attempt, when the stream carried it. */
  usage?: TokenUsage
  /** The output-token budget this attempt actually used (after model clamping). */
  maxTokens?: number
}

/**
 * Failure codes the move loop treats as transient, mirroring the harness's
 * default provider retry policy (dsh-llm retry-policy.ts): a stream that
 * dropped mid-response (e.g. pi-ai's "Stream ended without finish_reason") or
 * a transient provider failure deserves one more attempt before the move
 * request gives up. Auth, validation, and cancellation failures stay fatal.
 */
const RETRYABLE_MOVE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT',
])

/**
 * Whether a thrown move-stream failure is transient and worth one retry.
 * @param error - the error thrown by {@link streamMoveText}.
 * @returns true when the failure carries one of the retryable codes.
 */
export function isRetryableMoveFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && RETRYABLE_MOVE_FAILURE_CODES.has(code)
}

/** First backoff step between failed move attempts, in milliseconds. */
export const RETRY_BASE_DELAY_MS = 500
/** Backoff cap between failed move attempts, in milliseconds. */
export const RETRY_MAX_DELAY_MS = 8_000

/**
 * Exponential backoff before retrying a failed attempt. Retrying a rate limit
 * or a dropped stream immediately just burns the remaining attempts against
 * the same limit; a short capped backoff lets the provider recover.
 * @param attempt - the failed 1-based attempt number.
 * @returns the local delay in milliseconds.
 */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_DELAY_MS)
}

/** Backoff with ±20% jitter, so parallel games do not retry in lockstep. */
function jitteredDelayMs(attempt: number): number {
  return Math.round(retryDelayMs(attempt) * (0.8 + Math.random() * 0.4))
}

/** Sleep that rejects as soon as the move is aborted (timeout / disconnect). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (): void => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('gomoku: 落子请求已取消'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', fail)
      resolve()
    }, ms)
    if (signal.aborted) {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('gomoku: 落子请求已取消'))
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })
}

/** How long one provider's model capabilities are trusted before a refresh. */
const MODEL_INFO_TTL_MS = 5 * 60_000

/** Provider/model capability cache, so a move does not pay a lookup roundtrip. */
const modelInfoCache = new Map<string, { at: number; info: LlmResolvedModelInfo }>()

/**
 * Resolve one model's capabilities, cached for a few minutes. Every move used
 * to re-resolve the model before it could even start streaming (an extra
 * provider roundtrip, and one more failure point, on every single move).
 * @param ctx - host context exposing the llm service.
 * @param provider - registered provider route.
 * @param model - model id.
 * @param signal - cancellation.
 * @returns the model info.
 */
async function cachedModelInfo(
  ctx: Context,
  provider: string,
  model: string,
  signal: AbortSignal,
): Promise<LlmResolvedModelInfo> {
  const key = provider + '/' + model
  const cached = modelInfoCache.get(key)
  if (cached !== undefined && Date.now() - cached.at < MODEL_INFO_TTL_MS) return cached.info
  const info = await ctx.llm.resolveModelInfo(provider, model, signal)
  modelInfoCache.set(key, { at: Date.now(), info })
  return info
}

/**
 * Run one AI move attempt: stream the framed board through the chosen
 * provider/model route and assemble the reply text plus any reasoning blocks.
 * The requested thinking level is forwarded only when the selected model
 * advertises that exact effort; an unsupported level falls back to the
 * model's own default instead of failing the attempt.
 * @param ctx - host context exposing the llm service.
 * @param request - the validated move request.
 * @param system - the system prompt for this attempt.
 * @param user - the user message for this attempt.
 * @param maxTokens - the output-token cap for this attempt (per-request override or config default).
 * @param signal - cancellation (request deadline / plugin disposal).
 * @param thinking - the effort to request for this attempt (the first attempt
 *   uses the user's choice, retries use the model's fastest effort).
 * @returns the assembled reply text, the reasoning text, and the truncation flag.
 * @throws when the stream fails or the model produced no text at all.
 */
async function streamMoveText(
  ctx: Context,
  request: MoveRequestBody,
  system: string,
  user: RequestUserInput,
  maxTokens: number,
  signal: AbortSignal,
  thinking: string | undefined,
): Promise<MoveAttemptText> {
  if (request.provider === JEV_PROVIDER) {
    return requestJevMove(request.board, request.side, system, request.jevApiKey!, signal)
  }
  const info = await cachedModelInfo(ctx, request.provider, request.model, signal)
  let reasoningEffort: ReasoningEffortId | undefined
  if (thinking !== undefined
    && info.reasoning?.efforts.some(effort => effort.id === thinking)) {
    reasoningEffort = ReasoningEffortId(thinking)
  }
  // Never ask for more output than the model advertises: an oversized budget
  // is rejected by some providers and otherwise just invites runaway thinking.
  const budget = info.defaultMaxTokens !== undefined
    ? Math.min(maxTokens, info.defaultMaxTokens)
    : maxTokens
  const options: GenerateOptions = {
    provider: request.provider,
    model: request.model,
    messages: [user],
    system,
    maxTokens: budget,
    signal,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const truncated = assembler.finish.kind === 'max-tokens'
  // A max-tokens cut is NOT a hard failure: reasoning models spend most of
  // the budget thinking, and the visible text may already hold a complete
  // JSON object — parsing it is the caller's job.
  const terminal = finishError(assembler.finish)
  if (terminal !== undefined && !truncated) throw terminal
  const blocks = assembler.blocks()
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .trim()
  if (text.length === 0 && !truncated) throw new Error('gomoku: AI 没有返回任何内容')
  const reasoning = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'reasoning' }> => block.type === 'reasoning')
    .map(block => block.text)
    .join(' ')
    .trim()
  return { text, reasoning, truncated, maxTokens: budget, ...(assembler.usage !== undefined ? { usage: assembler.usage } : {}) }
}

/**
 * Validate an untrusted move-request body into a typed request.
 * @param value - the parsed request body.
 * @returns the validated request.
 * @throws {Error} with a user-readable reason on the first invalid field.
 */
export function validateMoveRequest(value: unknown): MoveRequestBody {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求体必须是 JSON 对象')
  }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.provider !== 'string' || candidate.provider.length === 0) {
    throw new Error('provider 必须是非空字符串')
  }
  if (typeof candidate.model !== 'string' || candidate.model.length === 0) {
    throw new Error('model 必须是非空字符串')
  }
  if (candidate.provider === JEV_PROVIDER) {
    if (candidate.model !== JEV_MODEL) throw new Error('不支持的 Jev 模型')
    if (!isValidJevApiKey(candidate.jevApiKey)) throw new Error('请先设置有效的 Jev API Key')
  } else if (candidate.jevApiKey !== undefined) {
    throw new Error('Jev API Key 只能用于 Jev 模型')
  }
  if (candidate.side !== 'black' && candidate.side !== 'white') {
    throw new Error('side 必须是 "black" 或 "white"')
  }
  if (candidate.thinking !== undefined
    && (typeof candidate.thinking !== 'string'
      || candidate.thinking.length === 0 || candidate.thinking.length > 64)) {
    throw new Error('thinking 必须是模型原生思考强度 id（非空字符串）')
  }
  if (candidate.moveTimeoutMs !== undefined
    && (typeof candidate.moveTimeoutMs !== 'number'
      || !Number.isInteger(candidate.moveTimeoutMs) || candidate.moveTimeoutMs < 1000)) {
    throw new Error('moveTimeoutMs 必须是 >= 1000 的整数毫秒数')
  }
  if (candidate.maxMoveOutputTokens !== undefined
    && (typeof candidate.maxMoveOutputTokens !== 'number'
      || !Number.isInteger(candidate.maxMoveOutputTokens) || candidate.maxMoveOutputTokens < 8)) {
    throw new Error('maxMoveOutputTokens 必须是 >= 8 的整数')
  }
  const board = candidate.board
  if (!Array.isArray(board) || board.length !== BOARD_SIZE * BOARD_SIZE
    || board.some(cell => cell !== EMPTY && cell !== BLACK && cell !== WHITE)) {
    throw new Error(`board 必须是 ${BOARD_SIZE * BOARD_SIZE} 个 0/1/2 组成的数组`)
  }
  const system = candidate.system
  if (system !== undefined && typeof system !== 'string') {
    throw new Error('system 必须是字符串')
  }
  return {
    provider: candidate.provider,
    model: candidate.model,
    side: candidate.side,
    board: board as number[],
    ...(candidate.provider === JEV_PROVIDER ? { jevApiKey: (candidate.jevApiKey as string).trim() } : {}),
    ...(typeof system === 'string' ? { system } : {}),
    ...(candidate.thinking !== undefined ? { thinking: candidate.thinking } : {}),
    ...(candidate.moveTimeoutMs !== undefined ? { moveTimeoutMs: candidate.moveTimeoutMs } : {}),
    ...(candidate.maxMoveOutputTokens !== undefined ? { maxMoveOutputTokens: candidate.maxMoveOutputTokens } : {}),
  }
}

/** Frame the user message for one move attempt (board + side + optional corrective feedback). */
export function buildMoveUserMessage(request: MoveRequestBody, previous: string | undefined, reason: string | undefined): RequestUserInput {
  const sideLabel = request.side === 'black' ? '黑方' : '白方'
  const lines = [
    `你执${sideLabel}。当前棋盘（黑=B，白=W，空=·；上方两行是列号的十位与个位，左侧是行号）：`,
    boardText(request.board),
    `轮到你（${sideLabel}）落子。请只返回合法的 JSON 落子。`,
  ]
  // Tell the model what the position actually contains; the hint is advice,
  // never a forced move.
  const report = analyzeThreats(request.board, request.side)
  lines.push('', '# 威胁提示（程序判定，仅作参考，不强制落子）', threatHintText(report, request.side))
  // Ranked options: the model still decides, but the obvious tactical points
  // no longer have to be rediscovered on every move.
  const options = candidateOptions(report, request.side)
  if (options.length > 0) {
    lines.push('', '# 候选选项（程序按威胁排序，建议优先选择）')
    options.forEach((option, index) => {
      lines.push(`${index + 1}. (${option.row},${option.col}) —— ${option.reason}`)
    })
    lines.push('优先从上述选项中选择；如果都不合适，可以另选其他合法空点。')
  }
  if (previous !== undefined && reason !== undefined) {
    lines.push('', `警告：你上一次的返回不合法（${reason}），完整输出如下：`, previous)
    lines.push('你的上一次落子已被拒绝。请重新观察棋盘，选择另一个未被占用的空交叉点，不要输出任何思考过程或解释，只返回一个合法的 JSON 对象。')
  }
  // One-shot requests have no session identity or durable message source.
  return { role: 'user', content: [{ type: 'text', text: lines.join('\n') }] }
}

/**
 * Mount the gomoku plugin: the three routes plus the move-request lifecycle.
 * @param ctx - host cordis context.
 * @param config - validated loader configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: Required<Config> = {
    moveTimeoutMs: config.moveTimeoutMs,
    maxMoveOutputTokens: config.maxMoveOutputTokens,
    maxMoveAttempts: config.maxMoveAttempts,
  }

  /** One finished move, kept for the /log diagnostics endpoint. */
  interface MoveLogEntry {
    /** ISO timestamp of the settlement. */
    time: string
    /** The side that was playing. */
    side: GomokuSide
    /** Provider route the move went through. */
    provider: string
    /** Model id the move went through. */
    model: string
    /** Attempts the node half used (0 = aborted before an attempt settled). */
    attempts: number
    /** End-to-end wall-clock time, in milliseconds. */
    durationMs: number
    /** Short outcome label ("move 7,7", "draw", "failed: ...", "aborted: ..."). */
    outcome: string
    /** The failure detail, when the move failed. */
    detail?: string
    /** Provider-reported token accounting of the last attempt. */
    usage?: TokenUsage
    /** The output-token budget the move actually requested. */
    maxTokens?: number
  }

  /** How many finished moves the diagnostics ring keeps. */
  const MOVE_LOG_LIMIT = 40
  /** Byte ceiling of the diagnostics ring, so a long session cannot grow it without bound. */
  const MOVE_LOG_MAX_BYTES = 32_768
  /** Finished moves of this plugin instance, newest last. */
  const moveLog: MoveLogEntry[] = []

  /** Collect the request body into a parsed JSON value. */
  const readJson = async (req: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (raw.length === 0) return {}
    return JSON.parse(raw)
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: GOMOKU_PATH,
      handler: async (req, res) => {
        const writeJson = (status: number, body: unknown): void => {
          // The board page can navigate away mid-move; never write to a socket
          // that is already gone.
          if (res.writableEnded || res.destroyed) return
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(body))
        }
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const segments = url.pathname.slice(GOMOKU_PATH.length).split('/').filter(Boolean)
          if (req.method === 'GET' && segments.length === 1 && segments[0] === 'prompt') {
            writeJson(200, { prompt: DEFAULT_SYSTEM_PROMPT })
            return
          }
          if (req.method === 'GET' && segments.length === 1 && segments[0] === 'efforts') {
            // The model's own reasoning metadata: the settings page lists the
            // efforts the host says this exact model supports instead of a
            // hard-coded vocabulary. An unreachable catalog answers with an
            // empty list rather than failing the page.
            const provider = url.searchParams.get('provider') ?? ''
            const model = url.searchParams.get('model') ?? ''
            if (provider.length === 0 || model.length === 0) {
              writeJson(400, { error: 'provider 与 model 必填' })
              return
            }
            if (provider === JEV_PROVIDER) {
              writeJson(200, { efforts: [] })
              return
            }
            try {
              const info = await cachedModelInfo(ctx, provider, model, new AbortController().signal)
              const reasoning = info.reasoning
              writeJson(200, {
                efforts: (reasoning?.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name })),
                ...(reasoning?.defaultEffort !== undefined ? { default: reasoning.defaultEffort } : {}),
              })
            } catch (error) {
              writeJson(200, {
                efforts: [],
                error: error instanceof Error ? error.message : String(error),
              })
            }
            return
          }
          if (req.method === 'GET' && segments.length === 1 && segments[0] === 'log') {
            // Diagnostics: the last moves with their timing and outcome. This is
            // what makes "the third move felt slow" answerable after the fact.
            writeJson(200, { entries: moveLog })
            return
          }
          if (req.method === 'DELETE' && segments.length === 1 && segments[0] === 'log') {
            // Explicit user action from the settings page. The ring is the only
            // unbounded record this plugin keeps, so clearing it never touches
            // the game itself.
            moveLog.length = 0
            writeJson(200, { cleared: true })
            return
          }
          if (req.method === 'GET' && segments.length === 1 && segments[0] === 'models') {
            const groups: ModelGroupWire[] = []
            const failures: ModelFailureWire[] = []
            for (const provider of ctx.llm.listProviders()) {
              let models: readonly LlmModelInfo[]
              try {
                models = await ctx.llm.listModels(provider.id)
              } catch (error) {
                failures.push({ provider: provider.id, error: error instanceof Error ? error.message : String(error) })
                continue
              }
              groups.push({
                provider: provider.id,
                displayName: provider.name,
                models: models.map(model => ({ id: model.id, name: model.name })),
              })
            }
            groups.push({ provider: JEV_PROVIDER, displayName: 'Jev · TypeSafe', models: [{ id: JEV_MODEL, name: 'Jev' }] })
            writeJson(200, { groups, failures })
            return
          }
          if (req.method === 'POST' && segments.length === 1 && segments[0] === 'move') {
            const request = validateMoveRequest(await readJson(req))
            // The loader config is the policy: a request may only tighten the
            // deadline or shrink the output budget, never widen either. That
            // is what keeps the per-move cap hard for every caller.
            const effectiveTimeoutMs = Math.min(
              request.moveTimeoutMs ?? resolved.moveTimeoutMs,
              resolved.moveTimeoutMs,
            )
            const effectiveMaxTokens = Math.min(
              request.maxMoveOutputTokens ?? resolved.maxMoveOutputTokens,
              resolved.maxMoveOutputTokens,
            )
            const startedAt = Date.now()
            const elapsed = (): number => Date.now() - startedAt
            const controller = new AbortController()
            const timer = setTimeout(
              () => { controller.abort(new Error('gomoku: AI 落子超时')) },
              effectiveTimeoutMs,
            )
            // Stop generating when the browser goes away (closed tab, reload,
            // new game): an abandoned move must not keep burning provider
            // tokens or holding a rate-limit slot.
            const onResponseClose = (): void => {
              if (!res.writableFinished) controller.abort(new Error('gomoku: 客户端已断开'))
            }
            res.on('close', onResponseClose)
            /** Record one settled move in the diagnostics ring and the logger. */
            const settle = (
              outcome: string, attempts: number, detail?: string, attemptText?: MoveAttemptText,
            ): void => {
              const usage = attemptText?.usage
              moveLog.push({
                time: new Date().toISOString(), side: request.side, provider: request.provider,
                model: request.model, attempts, durationMs: elapsed(), outcome,
                ...(detail !== undefined ? { detail } : {}),
                ...(usage !== undefined ? { usage } : {}),
                ...(attemptText?.maxTokens !== undefined ? { maxTokens: attemptText.maxTokens } : {}),
              })
              while (moveLog.length > MOVE_LOG_LIMIT) moveLog.shift()
              while (moveLog.length > 1
                && Buffer.byteLength(JSON.stringify(moveLog), 'utf8') > MOVE_LOG_MAX_BYTES) {
                moveLog.shift()
              }
              ctx.logger.info(
                'gomoku: %s move via %s/%s took %dms over %d attempt(s)%s: %s',
                request.side, request.provider, request.model, elapsed(), attempts,
                usage !== undefined
                  ? `, tokens in/out ${usage.inputTokens}/${usage.outputTokens}${usage.reasoningTokens !== undefined ? ' (reasoning ' + usage.reasoningTokens + ')' : ''}`
                  : '',
                outcome,
              )
            }
            /** Token fields every response carries when the provider reported them. */
            const telemetry = (attemptText: MoveAttemptText | undefined): Record<string, unknown> => ({
              ...(attemptText?.usage !== undefined ? { usage: attemptText.usage } : {}),
              ...(attemptText?.maxTokens !== undefined ? { maxTokens: attemptText.maxTokens } : {}),
            })
            try {
              const system = request.system !== undefined && request.system.trim().length > 0
                ? request.system
                : DEFAULT_SYSTEM_PROMPT
              // The cheapest effort the model declares: every attempt after the
              // first runs the same route with it, so a slow or truncated first
              // attempt still leaves time for a quick second one.
              let fastEffort: string | undefined
              if (request.provider !== JEV_PROVIDER) {
                try {
                  const info = await cachedModelInfo(ctx, request.provider, request.model, controller.signal)
                  fastEffort = fastestEffort(info.reasoning?.efforts ?? [])
                } catch (error) {
                  ctx.logger.warn(
                    'gomoku: cannot resolve the fast retry effort: %s',
                    error instanceof Error ? error.message : String(error),
                  )
                }
              }
              let lastText: string | undefined
              let lastReason: string | undefined
              let lastReasoning = ''
              let attemptsUsed = 0
              let lastAttempt: MoveAttemptText | undefined
              for (let attempt = 1; attempt <= resolved.maxMoveAttempts; attempt += 1) {
                attemptsUsed = attempt
                const user = buildMoveUserMessage(request, lastText, lastReason)
                const remainingMs = effectiveTimeoutMs - elapsed()
                if (remainingMs <= 0) break
                // Keep a slice of the deadline for the fast retry: a slow first
                // attempt must not eat the whole budget, or the handoff would
                // have no time left to run in.
                const attemptBudgetMs = Math.min(
                  attempt === 1 && resolved.maxMoveAttempts > 1
                    ? Math.max(3_000, effectiveTimeoutMs - FAST_RETRY_RESERVE_MS)
                    : remainingMs,
                  remainingMs,
                )
                const attemptController = new AbortController()
                const attemptTimer = setTimeout(
                  () => attemptController.abort(new Error('gomoku: AI 落子超时')),
                  attemptBudgetMs,
                )
                const attemptSignal = AbortSignal.any([controller.signal, attemptController.signal])
                let attemptText: MoveAttemptText
                try {
                  attemptText = await streamMoveText(
                    ctx, request, system, user, effectiveMaxTokens, attemptSignal,
                    attempt === 1 ? request.thinking : fastEffort,
                  )
                } catch (error) {
                  // The reserved slice expiring is a normal failure: the next
                  // attempt (same model, cheapest effort) takes over. A
                  // transient stream failure is retried the same way; a hard
                  // failure still propagates.
                  const sliceExpired = attemptController.signal.aborted && !controller.signal.aborted
                  if (!sliceExpired && !isRetryableMoveFailure(error)) throw error
                  lastText = undefined
                  lastReason = sliceExpired
                    ? '首次尝试超时，已切到快速重试'
                    : error instanceof Error ? error.message : String(error)
                  // A failed stream carries no usable reasoning; drop any
                  // earlier attempt's text so the error response stays honest.
                  lastReasoning = ''
                  ctx.logger.warn(
                    'gomoku: AI move attempt %d/%d failed: %s',
                    attempt, resolved.maxMoveAttempts, lastReason,
                  )
                  if (attempt < resolved.maxMoveAttempts) {
                    await sleep(jitteredDelayMs(attempt), controller.signal)
                    continue
                  }
                  break
                } finally {
                  clearTimeout(attemptTimer)
                }
                const text = attemptText.text
                lastAttempt = attemptText
                lastReasoning = attemptText.reasoning
                const reply = parseMoveReply(text)
                if (reply.kind === 'move') {
                  if (!isLegalMove(request.board, reply.row, reply.col)) {
                    lastText = text
                    lastReason = `目标交叉点 [${reply.row}, ${reply.col}] 已被占用或越界`
                    if (attempt < resolved.maxMoveAttempts) {
                      await sleep(jitteredDelayMs(attempt), controller.signal)
                    }
                    continue
                  }
                  settle('move ' + reply.row + ',' + reply.col, attempt, undefined, attemptText)
                  writeJson(200, {
                    move: { row: reply.row, col: reply.col },
                    reasoning: lastReasoning,
                    durationMs: elapsed(),
                    attempts: attempt,
                    ...telemetry(attemptText),
                  })
                  return
                }
                if (reply.kind === 'draw') {
                  settle('draw', attempt, undefined, attemptText)
                  writeJson(200, {
                    draw: true, reasoning: lastReasoning, durationMs: elapsed(), attempts: attempt,
                    ...telemetry(attemptText),
                  })
                  return
                }
                if (reply.kind === 'error') {
                  settle('ai-error: ' + reply.message, attempt, reply.message, attemptText)
                  writeJson(200, {
                    error: `AI 报告：${reply.message}`,
                    reasoning: lastReasoning,
                    durationMs: elapsed(),
                    attempts: attempt,
                    ...telemetry(attemptText),
                  })
                  return
                }
                lastText = text
                lastReason = attemptText.truncated
                  ? 'AI 回复被截断（超过最大输出长度），可能未输出完整的 JSON'
                  : reply.reason
                if (attempt < resolved.maxMoveAttempts) {
                  await sleep(jitteredDelayMs(attempt), controller.signal)
                }
              }
              settle('failed: ' + (lastReason ?? 'unknown'), attemptsUsed, lastReason, lastAttempt)
              writeJson(200, {
                error: `AI 连续 ${resolved.maxMoveAttempts} 次未能完成落子（最后原因：${lastReason ?? '未知'}）`,
                reasoning: lastReasoning,
                durationMs: elapsed(),
                attempts: attemptsUsed,
                ...telemetry(lastAttempt),
              })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              settle('aborted: ' + message, 0, message)
              throw error
            } finally {
              clearTimeout(timer)
              res.off('close', onResponseClose)
            }
            return
          }
          writeJson(404, { error: 'unknown gomoku route' })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(400, { error: message })
        }
      },
    })
    return () => {
      // Drop the capability cache with the plugin: a re-registered adapter may
      // advertise different efforts.
      modelInfoCache.clear()
      dispose()
    }
  }, 'gomoku: routes + move lifecycle')
}