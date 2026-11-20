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
/** A board intersection. */
export interface BoardPoint {
    row: number;
    col: number;
}
/** The four line directions, with display labels. */
declare const DIRECTIONS: readonly [{
    readonly key: "row";
    readonly label: "横向";
    readonly dr: 0;
    readonly dc: 1;
}, {
    readonly key: "column";
    readonly label: "纵向";
    readonly dr: 1;
    readonly dc: 0;
}, {
    readonly key: "diagDown";
    readonly label: "斜线↘";
    readonly dr: 1;
    readonly dc: 1;
}, {
    readonly key: "diagUp";
    readonly label: "斜线↙";
    readonly dr: 1;
    readonly dc: -1;
}];
type DirectionKey = (typeof DIRECTIONS)[number]['key'];
/** One direction's dangerous points for a side. */
export interface DirectionThreat {
    direction: DirectionKey;
    label: string;
    points: BoardPoint[];
}
/** One side's tactical opportunities and threats. */
export interface SideThreats {
    /** Empty points where this side wins immediately on its next move. */
    five: BoardPoint[];
    /** Empty points where this side would create a four with exactly one winning point. */
    fours: BoardPoint[];
    /** Empty points where this side would create an open four (2+ winning points) in that direction. */
    openThrees: DirectionThreat[];
}
/** The full report for one position, from the side-to-move perspective. */
export interface ThreatReport {
    self: SideThreats;
    opponent: SideThreats;
}
/**
 * Analyze both sides for the side to move.
 * @param board - 225 row-major cells (0 empty, 1 black, 2 white).
 * @param side - the side the AI plays (the opponent is the other color).
 * @returns the opponent's threats and this side's opportunities.
 */
export declare function analyzeThreats(board: readonly number[], side: 'black' | 'white'): ThreatReport;
/**
 * Render the advisory block appended to the move request's user message.
 * It states threats and opportunities; it never dictates a move.
 * @param report - the computed threat report.
 * @param side - the side the AI plays.
 * @returns the threat block text (one bullet per finding).
 */
export declare function threatHintText(report: ThreatReport, side: 'black' | 'white'): string;
export {};
