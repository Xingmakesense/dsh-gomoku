/**
 * Deterministic board-pattern analysis for one AI move request.
 *
 * The node half computes this report and appends a human-readable threat
 * block to the user message, so the model is told (rather than left to
 * notice) which points would complete a five, create an open four, or
 * leave a single-win-point four. It is advisory: no move is forced.
 *
 * Classification is simulation-based ("if this side played here, how many
 * finishing points would exist?"), which covers straight, broken and
 * diagonal shapes without enumerating named patterns.
 */

const BOARD_SIZE = 15
const EMPTY = 0
const BLACK = 1
const WHITE = 2

/** A board intersection. */
export interface BoardPoint {
  row: number
  col: number
}

/** The four line directions, with display labels. */
const DIRECTIONS = [
  { key: 'row', label: '横向', dr: 0, dc: 1 },
  { key: 'column', label: '纵向', dr: 1, dc: 0 },
  { key: 'diagDown', label: '斜线↘', dr: 1, dc: 1 },
  { key: 'diagUp', label: '斜线↙', dr: 1, dc: -1 },
] as const

type DirectionKey = (typeof DIRECTIONS)[number]['key']

/** One direction's dangerous points for a side. */
export interface DirectionThreat {
  direction: DirectionKey
  label: string
  points: BoardPoint[]
}

/** One side's tactical opportunities and threats. */
export interface SideThreats {
  /** Empty points where this side wins immediately on its next move. */
  five: BoardPoint[]
  /** Empty points where this side would create a four with exactly one winning point. */
  fours: BoardPoint[]
  /** Empty points where this side would create an open four (2+ winning points) in that direction. */
  openThrees: DirectionThreat[]
}

/** The full report for one position, from the side-to-move perspective. */
export interface ThreatReport {
  self: SideThreats
  opponent: SideThreats
}

/** Whether (row, col) is on the board. */
function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

/**
 * Count this color's stones through (row, col) along one direction,
 * assuming the cell itself already holds that color.
 */
function lineCount(board: readonly number[], row: number, col: number, dr: number, dc: number, color: number): number {
  let count = 1
  for (const step of [1, -1] as const) {
    let r = row + dr * step
    let c = col + dc * step
    while (inBounds(r, c) && board[r * BOARD_SIZE + c] === color) {
      count += 1
      r += dr * step
      c += dc * step
    }
  }
  return count
}

/** Whether the stone at (row, col) makes five or more in a line. */
function winsAt(board: readonly number[], row: number, col: number, color: number): boolean {
  for (const { dr, dc } of DIRECTIONS) {
    if (lineCount(board, row, col, dr, dc, color) >= 5) return true
  }
  return false
}

/**
 * Whether an empty point would complete a five for this color along one
 * direction. The point is treated as the color's stone.
 */
function winsInDirection(
  board: readonly number[], row: number, col: number, color: number, dr: number, dc: number,
): boolean {
  return lineCount(board, row, col, dr, dc, color) >= 5
}

/** Analyze one color's opportunities and threats on the current board. */
function analyzeSide(board: readonly number[], color: number): SideThreats {
  const five: BoardPoint[] = []
  const fours: BoardPoint[] = []
  const open: Record<DirectionKey, BoardPoint[]> = {
    row: [], column: [], diagDown: [], diagUp: [],
  }

  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== EMPTY) continue
    const row = Math.floor(index / BOARD_SIZE)
    const col = index % BOARD_SIZE
    // Simulate this side's stone here so winning-point scans below see it.
    const next = board.slice()
    next[index] = color
    if (winsAt(next, row, col, color)) {
      five.push({ row, col })
      continue
    }
    let hasOpenFour = false
    let hasFour = false
    for (const { key, dr, dc } of DIRECTIONS) {
      let finishingPoints = 0
      for (let q = 0; q < next.length; q += 1) {
        if (next[q] !== EMPTY) continue
        const qr = Math.floor(q / BOARD_SIZE)
        const qc = q % BOARD_SIZE
        if (winsInDirection(next, qr, qc, color, dr, dc)) finishingPoints += 1
      }
      if (finishingPoints >= 2) {
        open[key].push({ row, col })
        hasOpenFour = true
      } else if (finishingPoints === 1) {
        hasFour = true
      }
    }
    if (!hasOpenFour && hasFour) fours.push({ row, col })
  }

  return {
    five,
    fours,
    openThrees: DIRECTIONS.map(({ key, label }) => ({ direction: key, label, points: open[key] })),
  }
}

/**
 * Analyze both sides for the side to move.
 * @param board - 225 row-major cells (0 empty, 1 black, 2 white).
 * @param side - the side the AI plays (the opponent is the other color).
 * @returns the opponent's threats and this side's opportunities.
 */
export function analyzeThreats(board: readonly number[], side: 'black' | 'white'): ThreatReport {
  const selfColor = side === 'black' ? BLACK : WHITE
  const opponentColor = side === 'black' ? WHITE : BLACK
  return {
    self: analyzeSide(board, selfColor),
    opponent: analyzeSide(board, opponentColor),
  }
}

/** Render points as (r,c) pairs, capped so the hint stays short. */
function formatPoints(points: readonly BoardPoint[], limit = 8): string {
  const shown = points.slice(0, limit).map(point => '(' + point.row + ',' + point.col + ')').join('、')
  return points.length > limit ? shown + ' 等' : shown
}

/**
 * Render the advisory block appended to the move request's user message.
 * It states threats and opportunities; it never dictates a move.
 * @param report - the computed threat report.
 * @param side - the side the AI plays.
 * @returns the threat block text (one bullet per finding).
 */
export function threatHintText(report: ThreatReport, side: 'black' | 'white'): string {
  const opponent = side === 'black' ? '白' : '黑'
  const self = side === 'black' ? '黑' : '白'
  const lines: string[] = []

  if (report.opponent.five.length > 0) {
    lines.push('- 对方（' + opponent + '）下一手可直接成五：' + formatPoints(report.opponent.five) + '。不封堵将立刻输棋。')
  }
  const opponentOpen = report.opponent.openThrees.filter(entry => entry.points.length > 0)
  if (opponentOpen.length > 0) {
    lines.push('- 对方（' + opponent + '）活三：在下列点落子后对方将形成活四（两个成五点，无法单点封堵）：')
    for (const entry of opponentOpen) {
      lines.push('  · ' + entry.label + '：' + formatPoints(entry.points))
    }
    if (opponentOpen.length > 1) {
      lines.push('  · 对方存在多个方向的活三威胁，一子可能无法全部封堵；优先找双防点，或己方抢先取胜。')
    } else if (opponentOpen[0]!.points.length > 2) {
      lines.push('  · 对方在同一方向有多处活三威胁，注意一子能否同时封堵。')
    }
  }
  if (report.opponent.fours.length > 0) {
    lines.push('- 对方（' + opponent + '）冲四威胁点：' + formatPoints(report.opponent.fours) + '。对方在此落子后下一手可成五。')
  }
  if (report.self.five.length > 0) {
    lines.push('- 己方（' + self + '）下一手可直接成五：' + formatPoints(report.self.five) + '。能直接取胜时优先落子。')
  }
  const selfOpen = report.self.openThrees.filter(entry => entry.points.length > 0)
  if (selfOpen.length > 0) {
    lines.push('- 己方（' + self + '）活三进攻点（落子即形成活四）：')
    for (const entry of selfOpen) {
      lines.push('  · ' + entry.label + '：' + formatPoints(entry.points))
    }
  }
  if (lines.length === 0) {
    lines.push('- 当前没有可立即成五、形成活四或活三的战术要点。')
  }
  return lines.join('\n')
}
