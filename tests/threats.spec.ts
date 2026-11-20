import { describe, expect, it } from 'vitest'
import { analyzeThreats, threatHintText } from '../src/threats.ts'
import { buildMoveUserMessage } from '../src/index.ts'

const BLACK = 1
const WHITE = 2
const SIZE = 15

/** Build a board from (row, col, color) stones. */
function boardOf(stones: readonly (readonly [number, number, number])[]): number[] {
  const board = new Array<number>(SIZE * SIZE).fill(0)
  for (const [row, col, color] of stones) board[row * SIZE + col] = color
  return board
}

/** One direction's points as "r,c" strings, for stable comparisons. */
function pointsOf(report: ReturnType<typeof analyzeThreats>, key: 'row' | 'column' | 'diagDown' | 'diagUp'): string[] {
  const entry = report.opponent.openThrees.find(item => item.direction === key)
  return (entry?.points ?? []).map(point => point.row + ',' + point.col)
}

describe('analyzeThreats', () => {
  it('reports no tactics on an empty board', () => {
    const report = analyzeThreats(boardOf([]), 'black')
    expect(report.opponent.five).toEqual([])
    expect(report.opponent.fours).toEqual([])
    expect(report.opponent.openThrees.every(entry => entry.points.length === 0)).toBe(true)
    expect(report.self.five).toEqual([])
  })

  it('finds both ends of a straight open three', () => {
    const report = analyzeThreats(boardOf([[7, 5, WHITE], [7, 6, WHITE], [7, 7, WHITE]]), 'black')
    expect(report.opponent.five).toEqual([])
    expect(pointsOf(report, 'row').sort()).toEqual(['7,4', '7,8'])
    expect(pointsOf(report, 'column')).toEqual([])
  })

  it('finds a broken open three', () => {
    // White at (7,5)(7,6)(7,8): filling the gap at (7,7) creates an open four.
    const report = analyzeThreats(boardOf([[7, 5, WHITE], [7, 6, WHITE], [7, 8, WHITE]]), 'black')
    expect(pointsOf(report, 'row')).toContain('7,7')
  })

  it('finds a diagonal open three', () => {
    const report = analyzeThreats(boardOf([[5, 5, WHITE], [6, 6, WHITE], [7, 7, WHITE]]), 'black')
    expect(pointsOf(report, 'diagDown').sort()).toEqual(['4,4', '8,8'])
  })

  it('lists every immediate winning point of an open four', () => {
    const report = analyzeThreats(boardOf([
      [7, 5, WHITE], [7, 6, WHITE], [7, 7, WHITE], [7, 8, WHITE],
    ]), 'black')
    expect(report.opponent.five.map(point => point.row + ',' + point.col).sort())
      .toEqual(['7,4', '7,9'])
  })

  it('lists the single winning point of a blocked four', () => {
    const report = analyzeThreats(boardOf([
      [7, 4, BLACK],
      [7, 5, WHITE], [7, 6, WHITE], [7, 7, WHITE], [7, 8, WHITE],
    ]), 'black')
    expect(report.opponent.five.map(point => point.row + ',' + point.col)).toEqual(['7,9'])
  })

  it('reports the same shape as an opportunity for the side that owns it', () => {
    const board = boardOf([[7, 5, WHITE], [7, 6, WHITE], [7, 7, WHITE]])
    const report = analyzeThreats(board, 'white')
    expect(report.self.openThrees.find(entry => entry.direction === 'row')!.points.length).toBe(2)
    expect(report.opponent.openThrees.every(entry => entry.points.length === 0)).toBe(true)
  })
})

describe('threatHintText', () => {
  it('tells the model about an opponent open three without forcing a move', () => {
    const report = analyzeThreats(boardOf([[7, 5, WHITE], [7, 6, WHITE], [7, 7, WHITE]]), 'black')
    const text = threatHintText(report, 'black')
    expect(text).toContain('对方（白）活三')
    expect(text).toContain('横向')
    expect(text).toContain('(7,4)')
    expect(text).toContain('(7,8)')
  })

  it('falls back to a plain no-threat line', () => {
    const text = threatHintText(analyzeThreats(boardOf([]), 'white'), 'white')
    expect(text).toContain('当前没有可立即成五')
  })
})

describe('move message threat block', () => {
  it('appends the computed threat hint to the user message', () => {
    const request = {
      provider: 'p', model: 'm', side: 'black' as const,
      board: boardOf([[7, 5, WHITE], [7, 6, WHITE], [7, 7, WHITE]]),
    }
    const message = buildMoveUserMessage(request, undefined, undefined)
    const text = (message.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('威胁提示（程序判定，仅作参考，不强制落子）')
    expect(text).toContain('对方（白）活三')
    expect(text).toContain('(7,4)')
  })
})
