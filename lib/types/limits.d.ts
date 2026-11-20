/**
 * Single source of truth for the numbers that the two halves and the default
 * prompt must agree on.
 *
 * A move is framed by the browser half, validated and clamped by the node
 * half, and described to the model by the default prompt; when those three
 * disagreed, the cap or the instructions silently drifted. Change a value
 * here and the config defaults, the browser defaults and the prompt text all
 * follow.
 */
/** Hard per-move deadline in milliseconds: every attempt and backoff of that move shares it. */
export declare const MOVE_TIMEOUT_MS = 30000;
/** The same deadline in whole seconds, for text the model reads. */
export declare const MOVE_TIMEOUT_SECONDS: number;
/** Output-token cap for one move reply; a reasoning model spends its thinking from this budget. */
export declare const MAX_MOVE_OUTPUT_TOKENS = 2048;
/** AI attempts per move request (1 = no retry). Attempts never extend the deadline above. */
export declare const MAX_MOVE_ATTEMPTS = 3;
/** Candidate intersections the default prompt lets the model compare before committing. */
export declare const MAX_CANDIDATES = 3;
