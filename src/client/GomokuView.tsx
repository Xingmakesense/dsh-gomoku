/**
 * The gomoku Better Sidebar page: the board and the game-start controls
 * only. Model selection, thinking levels and prompts live in the plugin's
 * settings page (Settings → Gomoku), so the sidebar stays a board.
 *
 * The game state lives in the module-level store (see store.ts), so switching
 * tabs or collapsing the sidebar never resets a game or interrupts an
 * in-flight AI move.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { type GomokuT } from './i18n.ts'
import { type GomokuKey } from './locales.ts'
import {
  BLACK, BOARD_SIZE, EMPTY, TENGEN, WHITE,
  type Cell, type GameMode,
} from './game.ts'
import {
  changeMode, getSnapshot, loadModels, newGame, placeStone, retryMove, subscribe, togglePause,
  type GameState,
} from './store.ts'
import css from './Gomoku.module.css'

/** The board page's full component props: the sidebar tab seat + the translator. */
export type GomokuViewProps = TabComponentProps & { t: GomokuT }

/** The tab's + menu and settings-nav icon: a small four-stone grid. */
export function gomokuIcon(size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <rect x="1.25" y="1.25" width="13.5" height="13.5" rx="2.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.5 1.5v13M10.5 1.5v13M1.5 5.5h13M1.5 10.5h13" stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
      <circle cx="5.5" cy="5.5" r="1.55" fill="currentColor" />
      <circle cx="10.5" cy="10.5" r="1.55" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

const MODES: readonly { value: GameMode; key: GomokuKey }[] = [
  { value: 'black', key: 'mode.black' },
  { value: 'white', key: 'mode.white' },
  { value: 'both', key: 'mode.both' },
]

/**
 * The five star points of a 15×15 board (row-major indices): the four corner
 * hoshi plus tengen. Drawn while the intersection is still empty.
 */
const HOSHI: ReadonlySet<number> = new Set([
  3 * BOARD_SIZE + 3, 3 * BOARD_SIZE + 11,
  11 * BOARD_SIZE + 3, 11 * BOARD_SIZE + 11,
  TENGEN.row * BOARD_SIZE + TENGEN.col,
])

/** The status line copy for the current game. */
function statusCopy(game: GameState, t: GomokuT): { text: string; error: boolean } {
  if (game.winner === BLACK) return { text: t('status.win.black'), error: false }
  if (game.winner === WHITE) return { text: t('status.win.white'), error: false }
  if (game.draw) return { text: t('status.draw'), error: false }
  if (game.paused) return { text: t('status.paused'), error: false }
  if (game.thinking) return { text: t('status.thinking'), error: false }
  const last = game.log[game.log.length - 1]
  if (last?.interrupted === true) return { text: t('status.interrupted'), error: true }
  if (last?.error !== undefined) return { text: t('status.error', { message: last.error }), error: true }
  return {
    text: game.turn === BLACK ? t('status.turn.black') : t('status.turn.white'),
    error: false,
  }
}

/** Visual status shared by the board header in every model mode. */
function statusDotClass(game: GameState, error: boolean, settled: boolean): string {
  if (settled) {
    if (game.winner === BLACK) return css.dotBlack
    return game.winner === WHITE ? css.dotWhite : css.dotNeutral
  }
  if (error) return css.dotError
  if (game.paused || game.thinking) return css.dotAmber + ' ' + css.dotPulse
  return game.turn === BLACK ? css.dotBlack : css.dotWhite
}

/** Keep mode guidance separate from the board itself. */
function BoardHint({ paused, opening, mode, t }: {
  paused: boolean
  opening: boolean
  mode: GameMode
  t: GomokuT
}) {
  const hints: Record<GameMode, GomokuKey> = {
    black: 'status.side.hint', white: 'status.side.hint.white', both: 'status.side.hint.both',
  }
  return <div className={css.hint}>
    {t(paused ? 'status.paused.hint' : hints[mode])}
    {opening && (' · ' + t('rule.first.tengen'))}
  </div>
}

/** One intersection: clickable when it is the human's turn. */
function CellButton({
  row, col, cell, last, playable, preview, onClick,
}: {
  row: number
  col: number
  cell: Cell
  last: boolean
  playable: boolean
  /** The stone color shown as a ghost on hover (the side about to move). */
  preview: Cell
  onClick: (row: number, col: number) => void
}) {
  const index = row * BOARD_SIZE + col
  return (
    <button
      type="button"
      className={css.cell}
      disabled={!playable}
      aria-label={row + ',' + col}
      title={row + ',' + col}
      onClick={() => onClick(row, col)}
    >
      {cell !== EMPTY && <span className={css.stone + ' ' + (cell === BLACK ? css.stoneBlack : css.stoneWhite) + (last ? ' ' + css.lastMove : '')} />}
      {cell === EMPTY && playable && preview !== EMPTY && <span className={css.stone + ' ' + (preview === BLACK ? css.stoneBlack : css.stoneWhite) + ' ' + css.preview} />}
      {cell === EMPTY && HOSHI.has(index) && <span className={css.hoshi} />}
    </button>
  )
}

/** The gomoku sidebar page body: board + game-start controls. */
export function GomokuView({ ctx, t }: GomokuViewProps) {
  // Follow a live language switch; `t` reads the active locale at call time.
  useSyncExternalStore(
    (onChange) => ctx.locale.subscribe(onChange),
    () => ctx.locale.getSnapshot(),
  )
  const { game, settings } = useSyncExternalStore(subscribe, getSnapshot)

  // The catalog is needed the moment a game starts; the settings page also
  // calls this (idempotent once loaded).
  useEffect(() => { loadModels() }, [])

  const status = statusCopy(game, t)
  const settled = game.winner !== EMPTY || game.draw
  const humanTurn = (settings.mode === 'black' && game.turn === BLACK)
    || (settings.mode === 'white' && game.turn === WHITE)
  const opening = game.moveCount === 0
  // A failed AI move leaves the game waiting on that side; offer a retry
  // (the store ignores it when it is the human's turn or a request is live).
  // While paused the human owns the board, so no retry is offered.
  const retryableError = status.error && !settled && !game.thinking && !game.paused
  const statusDot = statusDotClass(game, status.error, settled)

  return (
    <div className={css.view}>
      <div className={css.statusRow}>
        <span className={css.statusDot + ' ' + statusDot} aria-hidden="true" />
        <div className={css.status + (status.error ? ' ' + css.statusError : '')}>{status.text}</div>
        {retryableError && (
          <button type="button" className={css.retry} onClick={retryMove}>{t('status.retry')}</button>
        )}
      </div>

      <BoardHint paused={game.paused} opening={opening} mode={settings.mode} t={t} />

      <div className={css.board} role="grid" aria-label={t('tab.label')}>
        {game.board.map((cell, index) => {
          const row = Math.floor(index / BOARD_SIZE)
          const col = index % BOARD_SIZE
          const last = game.lastMove !== null && game.lastMove.row === row && game.lastMove.col === col
          const playable = !settled && !game.thinking && (game.paused || humanTurn)
          return (
            <CellButton
              key={index}
              row={row}
              col={col}
              cell={cell}
              last={last}
              playable={playable}
              preview={playable ? game.turn : EMPTY}
              onClick={placeStone}
            />
          )
        })}
      </div>

      {/* Below the board: the mode selector and the new-game / pause actions.
          Inline SVG icons (no image assets) paired with text labels; the pause
          button turns amber while paused. */}
      <div className={css.bottomBar}>
        <div className={css.modeRow}>
          <span className={css.label}>{t('panel.mode')}</span>
          <div className={css.segmented} role="group" aria-label={t('panel.mode')}>
            {MODES.map(mode => (
              <button
                key={mode.value}
                type="button"
                className={css.segButton + (settings.mode === mode.value ? ' ' + css.segActive : '')}
                onClick={() => changeMode(mode.value)}
              >
                {t(mode.key)}
              </button>
            ))}
          </div>
        </div>
        <div className={css.actionRow}>
          <button
            type="button"
            className={css.action}
            onClick={() => newGame()}
            aria-label={t('panel.newGame')}
            title={t('panel.newGame')}
          >
            <svg className={css.actionIcon} viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M13.7 1.9v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{t('panel.newGame')}</span>
          </button>
          <button
            type="button"
            className={css.action + (game.paused ? ' ' + css.actionPaused : '')}
            disabled={settled}
            onClick={togglePause}
            aria-label={game.paused ? t('panel.resume') : t('panel.pause')}
            title={game.paused ? t('panel.resume') : t('panel.pause')}
          >
            <svg className={css.actionIcon} viewBox="0 0 16 16" aria-hidden="true">
              {game.paused ? (
                <path d="M5.2 3.4l7 4.6-7 4.6z" fill="currentColor" />
              ) : (
                <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
            <span>{game.paused ? t('panel.resume') : t('panel.pause')}</span>
          </button>
        </div>
        <div className={css.settingsHint}>{t('board.settings.hint')}</div>
      </div>
    </div>
  )
}