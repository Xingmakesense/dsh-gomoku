/**
 * Gomoku browser-half store: module-level game/settings state plus the AI
 * move lifecycle. Living outside React means the sidebar page can unmount
 * (tab switches, a collapsed sidebar) without resetting the game or
 * interrupting an in-flight AI move — the game and AI thinking continue in
 * the background, exactly the plugin's "关闭侧边栏不中断对局" contract. The
 * view subscribes via useSyncExternalStore.
 */
import { JEV_PROVIDER, isValidJevApiKey } from '../jev-shared.ts'
import {
  BLACK, BOARD_SIZE, CELL_COUNT, EMPTY, TENGEN, WHITE,
  hasEmpty, isLegalMove, requestAiMove, winsAt,
  type Board, type Cell, type GameMode, type MoveResponse, type Thinking,
} from './game.ts'

/** One entry in the per-move reasoning log. */
export interface ReasoningEntry {
  /** Move number (1-based). */
  n: number
  /** The side the AI played. */
  side: 'black' | 'white'
  /** The chosen intersection as "r,c", or null when the move failed. */
  move: string | null
  /** The model's reasoning text for this attempt. */
  reasoning: string
  /** The failure message when this attempt did not produce a move. */
  error?: string
  /** True when the request was cut off (aborted/timed out) mid-thought. */
  interrupted?: boolean
  /** Wall-clock time the node half spent on this attempt chain, in ms. */
  durationMs?: number
  /** How many model attempts the node half needed (1 = first try landed). */
  attempts?: number
}

/** The playable game state (board, turn, outcome, log). */
export interface GameState {
  board: Board
  /** Whose turn it is (BLACK opens). */
  turn: Cell
  /** The winning side, or EMPTY while the game runs. */
  winner: Cell | typeof EMPTY
  /** True when the board is full with no winner. */
  draw: boolean
  /** True while an AI move request is in flight. */
  thinking: boolean
  /** When the in-flight request started (ms epoch); absent while idle. */
  thinkingSince?: number
  /** True in manual-takeover (pause) mode: AI requests are cut off and the
   *  human plays both sides until the pause is released. */
  paused: boolean
  /** The last played intersection (win-marker highlight). */
  lastMove: { row: number; col: number } | null
  /** The reasoning log, newest last. */
  log: ReasoningEntry[]
  /** Played stones so far (for log labels). */
  moveCount: number
}

/** One provider group from the node half's model catalog. */
export interface ModelGroup {
  provider: string
  displayName: string
  models: { id: string; name: string }[]
}

/** One side's model selection (provider route + model id). */
export interface SideModel {
  provider: string | undefined
  model: string | undefined
}

/** The user-adjustable settings, kept across tab switches. */
export interface SettingsState {
  /** Page-memory only; shared by both Jev selectors, never persisted. */
  jevApiKey: string
  mode: GameMode
  /** The model used when the AI plays black (white-side human games, both-mode). */
  blackModel: SideModel
  /** The model used when the AI plays white (black-side human games, both-mode). */
  whiteModel: SideModel
  /** The AI thinking level when the AI plays black. */
  blackThinking: Thinking
  /** The AI thinking level when the AI plays white. */
  whiteThinking: Thinking
  /** Fixed per-move deadline; not user-adjustable (see DEFAULT_MOVE_TIMEOUT_MS). */
  moveTimeoutMs: number
  /** Fixed per-move output-token cap; not user-adjustable (see DEFAULT_MAX_MOVE_OUTPUT_TOKENS). */
  maxMoveOutputTokens: number
  /** Black's custom system prompt; undefined uses the node half's default. */
  blackPrompt: string | undefined
  /** White's custom system prompt; undefined uses the node half's default. */
  whitePrompt: string | undefined
  groups: ModelGroup[]
  modelsError: string | undefined
}

/** The fixed per-move deadline in milliseconds (3000 seconds; not user-adjustable). */
export const DEFAULT_MOVE_TIMEOUT_MS = 3_000_000
/** The fixed per-move output-token cap (not user-adjustable). */
export const DEFAULT_MAX_MOVE_OUTPUT_TOKENS = 32_000

/** localStorage key of the persisted user settings (never the Jev key). */
export const SETTINGS_STORAGE_KEY = 'dsh-gomoku:settings:v1'

/** The user settings that survive a reload (the Jev key never does). */
interface PersistedSettings {
  mode?: GameMode
  blackModel?: SideModel
  whiteModel?: SideModel
  blackThinking?: Thinking
  whiteThinking?: Thinking
  blackPrompt?: string
  whitePrompt?: string
}

/** Whether a persisted value is a usable side-model selection. */
function isSideModel(value: unknown): value is SideModel {
  if (value === null || typeof value !== 'object') return false
  const model = value as Record<string, unknown>
  return (model.provider === undefined || typeof model.provider === 'string')
    && (model.model === undefined || typeof model.model === 'string')
}

/** Whether a persisted value is a known thinking level. */
function isThinking(value: unknown): value is Thinking {
  return value === 'off' || value === 'high' || value === 'max'
}

/** Whether a persisted value is a known play mode. */
function isMode(value: unknown): value is GameMode {
  return value === 'black' || value === 'white' || value === 'both'
}

/** Load and shape-check the persisted settings; bad or missing data falls back to defaults. */
function loadPersistedSettings(): PersistedSettings {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const value = parsed as Record<string, unknown>
    const saved: PersistedSettings = {}
    if (isMode(value.mode)) saved.mode = value.mode
    if (isSideModel(value.blackModel)) saved.blackModel = value.blackModel
    if (isSideModel(value.whiteModel)) saved.whiteModel = value.whiteModel
    if (isThinking(value.blackThinking)) saved.blackThinking = value.blackThinking
    if (isThinking(value.whiteThinking)) saved.whiteThinking = value.whiteThinking
    if (typeof value.blackPrompt === 'string') saved.blackPrompt = value.blackPrompt
    if (typeof value.whitePrompt === 'string') saved.whitePrompt = value.whitePrompt
    return saved
  } catch {
    return {}
  }
}

/** Persist the user settings; a storage failure is non-fatal (the page keeps them in memory). */
function persistSettings(settings: SettingsState): void {
  if (typeof localStorage === 'undefined') return
  const data: PersistedSettings = {
    mode: settings.mode,
    blackModel: settings.blackModel,
    whiteModel: settings.whiteModel,
    blackThinking: settings.blackThinking,
    whiteThinking: settings.whiteThinking,
    blackPrompt: settings.blackPrompt,
    whitePrompt: settings.whitePrompt,
  }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* quota/private mode: settings stay in memory for this page */
  }
}

/** The whole store snapshot the view subscribes to. */
export interface Snapshot {
  game: GameState
  settings: SettingsState
}

/** A fresh empty board. */
export function emptyBoard(): Board {
  return new Array<Cell>(CELL_COUNT).fill(EMPTY)
}

/** The fresh game state for a new game. */
function freshGame(): GameState {
  return {
    board: emptyBoard(),
    turn: BLACK,
    winner: EMPTY,
    draw: false,
    thinking: false,
    paused: false,
    lastMove: null,
    log: [],
    moveCount: 0,
  }
}

/** The built-in default settings (no persistence involved). */
function defaultSettings(): SettingsState {
  return {
    mode: 'black',
    jevApiKey: '',
    blackModel: { provider: undefined, model: undefined },
    whiteModel: { provider: undefined, model: undefined },
    blackThinking: 'off',
    whiteThinking: 'off',
    moveTimeoutMs: DEFAULT_MOVE_TIMEOUT_MS,
    maxMoveOutputTokens: DEFAULT_MAX_MOVE_OUTPUT_TOKENS,
    blackPrompt: undefined,
    whitePrompt: undefined,
    groups: [],
    modelsError: undefined,
  }
}

/** The default settings, overlaid with whatever the user persisted. */
function freshSettings(): SettingsState {
  const saved = loadPersistedSettings()
  return {
    ...defaultSettings(),
    mode: saved.mode ?? 'black',
    blackModel: saved.blackModel ?? { provider: undefined, model: undefined },
    whiteModel: saved.whiteModel ?? { provider: undefined, model: undefined },
    blackThinking: saved.blackThinking ?? 'off',
    whiteThinking: saved.whiteThinking ?? 'off',
    blackPrompt: saved.blackPrompt,
    whitePrompt: saved.whitePrompt,
  }
}

let snapshot: Snapshot = { game: freshGame(), settings: freshSettings() }
const listeners = new Set<() => void>()
/** Game generation: bumped on every new game; stale async results are dropped. */
let generation = 0
/** The in-flight move request's abort handle (cancelled on new game / teardown). */
let abort: AbortController | null = null

/** Subscribe to store changes (useSyncExternalStore's subscribe). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The current stable snapshot (useSyncExternalStore's getSnapshot). */
export function getSnapshot(): Snapshot {
  return snapshot
}

/** Whether the side belongs to the human in this mode. */
function isHumanTurn(mode: GameMode, turn: Cell): boolean {
  return (mode === 'black' && turn === BLACK) || (mode === 'white' && turn === WHITE)
}

/** Whether the side belongs to the AI in this mode. */
function isAiTurn(mode: GameMode, turn: Cell): boolean {
  return (mode === 'both') || (mode === 'black' && turn === WHITE) || (mode === 'white' && turn === BLACK)
}

/** The AI wire side spelling for a cell color. */
function sideOf(turn: Cell): 'black' | 'white' {
  return turn === BLACK ? 'black' : 'white'
}

/** Whether the game has settled (win or draw). */
function gameOver(game: GameState): boolean {
  return game.winner !== EMPTY || game.draw
}

/** Publish one game state to all subscribers. */
function commitGame(game: GameState): void {
  snapshot = { ...snapshot, game }
  for (const listener of [...listeners]) listener()
}

/** Publish one settings state to all subscribers. */
function commitSettings(settings: SettingsState): void {
  snapshot = { ...snapshot, settings }
  persistSettings(settings)
  for (const listener of [...listeners]) listener()
}

/**
 * The pure place-transition: put the current turn's stone at (row, col) and
 * advance the game. Returns null when the move is illegal or the game is
 * settled; the caller commits the result. (The thinking flag is NOT a guard
 * here — callers own it; an AI reply arrives while thinking is still set.)
 *
 * Freestyle rules with one house rule: black's opening move (moveCount 0,
 * always black) must land on the tengen (board center) intersection.
 */
function placed(game: GameState, row: number, col: number): GameState | null {
  if (gameOver(game)) return null
  if (!isLegalMove(game.board, row, col)) return null
  if (game.moveCount === 0 && game.turn === BLACK
    && (row !== TENGEN.row || col !== TENGEN.col)) {
    return null
  }
  const board = [...game.board] as Cell[]
  const color = game.turn
  board[row * BOARD_SIZE + col] = color
  const base: GameState = {
    ...game,
    board,
    lastMove: { row, col },
    moveCount: game.moveCount + 1,
    turn: color === BLACK ? WHITE : BLACK,
  }
  if (winsAt(board, row, col)) return { ...base, winner: color }
  if (!hasEmpty(board)) return { ...base, draw: true }
  return base
}

/**
 * Fill an unusable per-side selection from the first catalog model.
 *
 * Catalog entries can advertise zero models (a provider whose listing failed
 * or is still configuring). Taking groups[0] blindly would persist a
 * selection with a provider but no model — later moves then fail with
 * "model catalog unavailable" even though the catalog loaded. A selection is
 * therefore usable only when BOTH its provider and model are set; otherwise
 * the first provider that actually has a model wins. A valid user choice is
 * never overwritten.
 */
function fillDefaultModels(settings: SettingsState): SettingsState {
  const firstWithModels = settings.groups.find(group => group.models.length > 0)
  if (firstWithModels === undefined) return settings
  const fallback: SideModel = {
    provider: firstWithModels.provider,
    model: firstWithModels.models[0]!.id,
  }
  const next = { ...settings }
  if (next.blackModel.provider === undefined || next.blackModel.model === undefined) {
    next.blackModel = { ...fallback }
  }
  if (next.whiteModel.provider === undefined || next.whiteModel.model === undefined) {
    next.whiteModel = { ...fallback }
  }
  return next
}

/** The in-flight catalog request (one at a time; board and settings may both ask). */
let modelsRequest: Promise<void> | null = null
/** True when an AI move was requested before the catalog finished loading. */
let pendingAiStart = false

/** Record a model-catalog failure on the board (the retry button can re-run it). */
function recordModelsFailure(message: string): void {
  const { game } = snapshot
  commitGame({
    ...game,
    log: [...game.log, {
      n: game.moveCount + 1, side: sideOf(game.turn), move: null, reasoning: '', error: message,
    }],
  })
}

/** Start the AI move that was waiting for the catalog, if it is still wanted. */
function startPendingAi(): void {
  if (!pendingAiStart) return
  pendingAiStart = false
  const { game, settings } = snapshot
  if (gameOver(game) || game.paused || game.thinking) return
  const model = sideModelOf(settings, game.turn)
  if (model.provider === undefined || model.model === undefined) {
    recordModelsFailure(settings.modelsError ?? '模型目录中没有可用模型')
    return
  }
  if (isAiTurn(settings.mode, game.turn)) scheduleAi()
}

/** Fetch the model catalog once; failures surface in settings.modelsError. */
export function loadModels(): void {
  if (snapshot.settings.groups.length > 0) return
  if (modelsRequest !== null) return
  modelsRequest = fetchModels().finally(() => { modelsRequest = null })
}

/** The catalog request body as served by the node half. */
interface ModelsBody {
  groups?: ModelGroup[]
  failures?: { provider: string; error: string }[]
  /** Present on a non-OK response (route-level failure). */
  error?: string
}

/** Run the catalog request and publish the outcome. */
async function fetchModels(): Promise<void> {
  try {
    const response = await fetch('/plugins/gomoku/models', { headers: { accept: 'application/json' } })
    let body: ModelsBody | undefined
    try { body = await response.json() as ModelsBody } catch { body = undefined }
    if (!response.ok) {
      const detail = body?.error ?? body?.failures?.[0]?.error
      throw new Error(detail ?? ('模型目录加载失败（HTTP ' + response.status + '）'))
    }
    const groups = body?.groups ?? []
    if (groups.length === 0) throw new Error('模型目录为空')
    commitSettings(fillDefaultModels({ ...snapshot.settings, groups, modelsError: undefined }))
    startPendingAi()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (snapshot.settings.groups.length === 0) {
      commitSettings({ ...snapshot.settings, modelsError: message })
    }
    if (pendingAiStart) {
      pendingAiStart = false
      recordModelsFailure(message)
    }
  }
}

/** Start a new game in the given mode (or the current one), opening with AI when required. */
export function newGame(mode?: GameMode): void {
  generation += 1
  abort?.abort()
  const nextMode = mode ?? snapshot.settings.mode
  commitGame(freshGame())
  if (nextMode === 'white' || nextMode === 'both') scheduleAi()
}

/** Switch the play mode and restart the game in it. */
export function changeMode(mode: GameMode): void {
  if (mode === snapshot.settings.mode) return
  commitSettings({ ...snapshot.settings, mode })
  newGame(mode)
}

/** Human click on an empty intersection. While paused the human may play
 * either side (turn order still alternates, no move-count limit); otherwise
 * only the human's own side accepts clicks. */
export function placeStone(row: number, col: number): void {
  const { game, settings } = snapshot
  if (gameOver(game) || game.thinking) return
  if (!game.paused && !isHumanTurn(settings.mode, game.turn)) return
  const next = placed(game, row, col)
  if (next === null) return
  commitGame(next)
  if (!gameOver(next) && !next.paused && isAiTurn(settings.mode, next.turn)) scheduleAi()
}

/**
 * Toggle manual-takeover (pause) mode. Pausing cuts off any in-flight AI
 * move (the board stays fully playable for both sides, and the interrupted
 * request's catch path only records a log entry — it can never touch the
 * board, because the pause commit already cleared the thinking flag).
 * Releasing the pause hands the turn back to the AI when it is the AI's side.
 */
export function togglePause(): void {
  const { game, settings } = snapshot
  if (gameOver(game)) return
  if (game.paused) {
    commitGame({ ...game, paused: false })
    if (isAiTurn(settings.mode, game.turn)) scheduleAi()
  } else {
    abort?.abort()
    commitGame({ ...game, paused: true, thinking: false })
  }
}

/** Apply one settings patch (model selection, thinking, overrides, prompt). */
export function patchSettings(patch: Partial<SettingsState>): void {
  commitSettings({ ...snapshot.settings, ...patch })
}

/**
 * Restore every user setting to its default (model/thinking/prompt/mode/Jev
 * key) without touching the board or the loaded model catalog.
 */
export function resetSettings(): void {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(SETTINGS_STORAGE_KEY) } catch { /* page-memory only */ }
  }
  const { groups, modelsError } = snapshot.settings
  commitSettings(fillDefaultModels({ ...defaultSettings(), groups, modelsError }))
}

/**
 * Retry the current move: re-run the AI move for the side whose last attempt
 * failed (the board is unchanged and it is that side's turn). A no-op while
 * the game is settled, a request is in flight, the game is paused (manual
 * play owns the board), or it is the human's turn (the human can simply
 * click the board).
 */
export function retryMove(): void {
  const { game, settings } = snapshot
  if (gameOver(game) || game.thinking || game.paused) return
  if (!isAiTurn(settings.mode, game.turn)) return
  scheduleAi()
}

/** Max AI attempts per move before the move fails (rejected moves retry). */
const MAX_AI_ATTEMPTS = 3

/** The side model selection for one turn color. */
function sideModelOf(settings: SettingsState, turn: Cell): SideModel {
  return turn === BLACK ? settings.blackModel : settings.whiteModel
}

/** The side thinking level for one turn color. */
function sideThinkingOf(settings: SettingsState, turn: Cell): Thinking {
  return turn === BLACK ? settings.blackThinking : settings.whiteThinking
}

/** The side custom system prompt for one turn color (undefined = node default). */
function sidePromptOf(settings: SettingsState, turn: Cell): string | undefined {
  return turn === BLACK ? settings.blackPrompt : settings.whitePrompt
}

/**
 * How long past the node half's own deadline a request may stay silent
 * before the client declares the thinking interrupted (the node half answers
 * within moveTimeoutMs; only a dropped connection stays silent longer).
 */
const WATCHDOG_MARGIN_MS = 5000

/** Per-request sequence: a settled reply only applies to the request it came from. */
let requestSeq = 0

/** Run one AI move attempt for the current turn of the current game generation. */
function scheduleAi(attempt: number = 1): void {
  const { game, settings } = snapshot
  if (gameOver(game) || game.thinking) return
  const gen = generation
  const turn = game.turn
  const model = sideModelOf(settings, turn)
  if (model.provider === undefined || model.model === undefined) {
    if (settings.groups.length === 0) {
      // The catalog has not arrived yet (tab opened / mode switched during the
      // first fetch). Wait for it instead of reporting a failure the user
      // cannot act on; the deferred start resumes once models are known.
      pendingAiStart = true
      loadModels()
      return
    }
    commitGame({
      ...game,
      thinking: false,
      log: [...game.log, {
        n: game.moveCount + 1, side: sideOf(turn), move: null,
        reasoning: '', error: settings.modelsError ?? '模型目录中没有可用模型',
      }],
    })
    return
  }
  if (model.provider === JEV_PROVIDER && !isValidJevApiKey(settings.jevApiKey)) {
    commitGame({ ...game, log: [...game.log, {
      n: game.moveCount + 1, side: sideOf(turn), move: null, reasoning: '', error: '请先设置 Jev API Key',
    }] })
    return
  }
  // A new move supersedes anything still in flight (a resume racing a stale
  // timer, a retry click): abort it first, so two models never generate at
  // once and a late reply can never overwrite the new request.
  abort?.abort()
  const startedAt = Date.now()
  commitGame({ ...game, thinking: true, thinkingSince: startedAt })
  const controller = new AbortController()
  abort = controller
  const seq = ++requestSeq
  // Watchdog: if the request stays silent past the node half's own deadline
  // plus margin, abort it — the catch below then records an interruption
  // instead of leaving the board stuck on "AI 思考中" forever.
  const watchdog = window.setTimeout(() => {
    if (gen === generation && seq === requestSeq) controller.abort()
  }, settings.moveTimeoutMs + WATCHDOG_MARGIN_MS)
  const system = sidePromptOf(settings, turn)
  requestAiMove({
    provider: model.provider,
    model: model.model,
    side: sideOf(turn),
    board: [...game.board],
    ...(model.provider === JEV_PROVIDER
      ? { jevApiKey: settings.jevApiKey }
      : { thinking: sideThinkingOf(settings, turn) }),
    moveTimeoutMs: settings.moveTimeoutMs,
    maxMoveOutputTokens: settings.maxMoveOutputTokens,
    ...(system !== undefined ? { system } : {}),
  }, controller.signal)
    .then((reply: MoveResponse) => {
      window.clearTimeout(watchdog)
      if (gen !== generation || seq !== requestSeq) return
      applyAiReply(reply, turn, gen, attempt, Date.now() - startedAt)
    })
    .catch((error: unknown) => {
      window.clearTimeout(watchdog)
      if (gen !== generation || seq !== requestSeq) return
      const current = snapshot.game
      if (current.turn !== turn) return
      // An aborted request (watchdog or an external abort) is an
      // interruption, not a model failure: the user gets a dedicated status
      // and a retry, and the stale promise can never touch the board.
      if ((error as { name?: string } | null)?.name === 'AbortError') {
        commitGame({
          ...current,
          thinking: false,
          thinkingSince: undefined,
          log: [...current.log, {
            n: current.moveCount + 1, side: sideOf(turn), move: null, reasoning: '', interrupted: true,
            durationMs: Date.now() - startedAt,
          }],
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      commitGame({
        ...current,
        thinking: false,
        log: [...current.log, {
          n: current.moveCount + 1, side: sideOf(turn), move: null, reasoning: '', error: message,
          durationMs: Date.now() - startedAt,
        }],
      })
    })
}

/** Apply one settled AI reply for the turn it was requested for. */
function applyAiReply(
  reply: MoveResponse,
  turn: Cell,
  gen: number,
  attempt: number,
  durationMs: number,
): void {
  const { game, settings } = snapshot
  // `thinking` guards stale replies landing after an interruption (the seq
  // guard above already filtered superseded requests).
  if (game.turn !== turn || !game.thinking) return
  if (reply.move !== undefined) {
    const next = placed(game, reply.move.row, reply.move.col)
    if (next !== null) {
      const withLog: GameState = {
        ...next,
        // placed() spreads the in-flight game (thinking still true); the
        // move has now settled, so the flag must drop before commit or the
        // board stays locked on "AI 思考中".
        thinking: false,
        thinkingSince: undefined,
        log: [...next.log, {
          n: next.moveCount,
          side: sideOf(turn),
          move: `${reply.move.row},${reply.move.col}`,
          reasoning: reply.reasoning ?? '',
          // Prefer the node half's own wall clock (it excludes the network hop);
          // fall back to the client measurement for older node halves.
          durationMs: reply.durationMs ?? durationMs,
          ...(reply.attempts !== undefined ? { attempts: reply.attempts } : {}),
        }],
      }
      commitGame(withLog)
      if (!gameOver(withLog) && isAiTurn(settings.mode, withLog.turn)) {
        // A zero-delay hop keeps the next move flowing; a timed pause would be
        // throttled to seconds in a backgrounded sidebar tab.
        window.setTimeout(() => { if (gen === generation) scheduleAi() }, 0)
      }
      return
    }
    // The node half only checks board legality; the client-side house rules
    // (the tengen opening) can still reject a reply, so retry within the
    // attempt budget before failing the move. Clear the thinking flag first
    // so the re-entrant scheduleAi can pass its own in-flight guard.
    if (attempt < MAX_AI_ATTEMPTS) {
      commitGame({ ...game, thinking: false, thinkingSince: undefined })
      window.setTimeout(() => { if (gen === generation) scheduleAi(attempt + 1) }, 0)
      return
    }
  }
  if (reply.draw === true) {
    commitGame({ ...game, thinking: false, thinkingSince: undefined, draw: true })
    return
  }
  const error = reply.error ?? 'unknown error'
  commitGame({
    ...game,
    thinking: false,
    thinkingSince: undefined,
    log: [...game.log, {
      n: game.moveCount + 1, side: sideOf(turn), move: null, reasoning: reply.reasoning ?? '', error,
      durationMs: reply.durationMs ?? durationMs,
      ...(reply.attempts !== undefined ? { attempts: reply.attempts } : {}),
    }],
  })
}