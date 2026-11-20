window.__ModuleLoader__.load({
	id: "@xingmakesense/dsh-gomoku",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom = require("react-dom");
		/** The board center intersection (天元): black's opening move is pinned here. */
		const TENGEN = {
			row: 7,
			col: 7
		};
		/**
		* Whether an intersection is inside the board and currently empty.
		* @param board - row-major cell values (length must be CELL_COUNT).
		* @param row - intersection row.
		* @param col - intersection column.
		* @returns true when the move may be played.
		*/
		function isLegalMove(board, row, col) {
			return row >= 0 && row < 15 && col >= 0 && col < 15 && board[row * 15 + col] === 0;
		}
		/** Whether any empty intersection remains. */
		function hasEmpty(board) {
			return board.includes(0);
		}
		/** The four line directions scanned for a win. */
		const DIRECTIONS = [
			[0, 1],
			[1, 0],
			[1, 1],
			[1, -1]
		];
		/**
		* Whether the stone at (row, col) completes a freestyle win: five or more
		* consecutive stones of the same color along any of the four directions
		* (overlines count — this game has no forbidden moves).
		* @param board - row-major cell values.
		* @param row - the intersection just played.
		* @param col - the intersection just played.
		* @returns true when the placed stone wins the game.
		*/
		function winsAt(board, row, col) {
			const color = board[row * 15 + col];
			if (color === 0) return false;
			for (const [dr, dc] of DIRECTIONS) {
				let count = 1;
				for (const step of [1, -1]) {
					let r = row + dr * step;
					let c = col + dc * step;
					while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r * 15 + c] === color) {
						count += 1;
						r += dr * step;
						c += dc * step;
					}
				}
				if (count >= 5) return true;
			}
			return false;
		}
		/**
		* Post one AI move request to the node half's route.
		* @param body - the validated move request.
		* @param signal - optional abort (request teardown).
		* @returns the parsed reply.
		* @throws {Error} with the node half's error message on a non-OK status.
		*/
		async function requestAiMove(body, signal) {
			const response = await fetch("/plugins/gomoku/move", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal
			});
			const parsed = await response.json();
			if (!response.ok) throw new Error(typeof parsed.error === "string" ? parsed.error : `gomoku: HTTP ${response.status}`);
			return parsed;
		}
		// src/limits.ts
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
		const MOVE_TIMEOUT_MS = 3e4;
		/** Output-token cap for one move reply; a reasoning model spends its thinking from this budget. */
		const MAX_MOVE_OUTPUT_TOKENS = 2048;
		/** Reject empty keys and characters that cannot be sent in an HTTP header. */
		function isValidJevApiKey(value) {
			return typeof value === "string" && /^[\x21-\x7e]{1,4096}$/.test(value.trim());
		}
		// src/client/store.ts
		/**
		* Gomoku browser-half store: module-level game/settings state plus the AI
		* move lifecycle. Living outside React means the sidebar page can unmount
		* (tab switches, a collapsed sidebar) without resetting the game or
		* interrupting an in-flight AI move — the game and AI thinking continue in
		* the background, exactly the plugin's "关闭侧边栏不中断对局" contract. The
		* view subscribes via useSyncExternalStore.
		*/
		/** The fixed per-move deadline in milliseconds (not user-adjustable); derived from src/limits.ts. */
		const DEFAULT_MOVE_TIMEOUT_MS = MOVE_TIMEOUT_MS;
		/** The fixed per-move output-token cap (not user-adjustable); derived from src/limits.ts. */
		const DEFAULT_MAX_MOVE_OUTPUT_TOKENS = MAX_MOVE_OUTPUT_TOKENS;
		/** localStorage key of the persisted user settings (never the Jev key). */
		const SETTINGS_STORAGE_KEY = "dsh-gomoku:settings:v1";
		/** Whether a persisted value is a usable side-model selection. */
		function isSideModel(value) {
			if (value === null || typeof value !== "object") return false;
			const model = value;
			return (model.provider === void 0 || typeof model.provider === "string") && (model.model === void 0 || typeof model.model === "string");
		}
		/** Whether a persisted value is a usable native effort id. */
		function isThinking(value) {
			return typeof value === "string" && value.length > 0 && value.length <= 64;
		}
		/** Whether a persisted value is a known play mode. */
		function isMode(value) {
			return value === "black" || value === "white" || value === "both";
		}
		/** Load and shape-check the persisted settings; bad or missing data falls back to defaults. */
		function loadPersistedSettings() {
			try {
				if (typeof localStorage === "undefined") return {};
				const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
				if (raw === null) return {};
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
				const value = parsed;
				const saved = {};
				if (isMode(value.mode)) saved.mode = value.mode;
				if (isSideModel(value.blackModel)) saved.blackModel = value.blackModel;
				if (isSideModel(value.whiteModel)) saved.whiteModel = value.whiteModel;
				if (isThinking(value.blackThinking)) saved.blackThinking = value.blackThinking;
				if (isThinking(value.whiteThinking)) saved.whiteThinking = value.whiteThinking;
				if (typeof value.blackPrompt === "string") saved.blackPrompt = value.blackPrompt;
				if (typeof value.whitePrompt === "string") saved.whitePrompt = value.whitePrompt;
				return saved;
			} catch {
				return {};
			}
		}
		/** Persist the user settings; a storage failure is non-fatal (the page keeps them in memory). */
		function persistSettings(settings) {
			if (typeof localStorage === "undefined") return;
			const data = {
				mode: settings.mode,
				blackModel: settings.blackModel,
				whiteModel: settings.whiteModel,
				blackThinking: settings.blackThinking,
				whiteThinking: settings.whiteThinking,
				blackPrompt: settings.blackPrompt,
				whitePrompt: settings.whitePrompt
			};
			try {
				localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
			} catch {}
		}
		/** A fresh empty board. */
		function emptyBoard() {
			return new Array(225).fill(0);
		}
		/** The fresh game state for a new game. */
		function freshGame() {
			return {
				board: emptyBoard(),
				turn: 1,
				winner: 0,
				draw: false,
				thinking: false,
				paused: false,
				lastMove: null,
				log: [],
				moveCount: 0
			};
		}
		/** The built-in default settings (no persistence involved). */
		function defaultSettings() {
			return {
				mode: "black",
				jevApiKey: "",
				blackModel: {
					provider: void 0,
					model: void 0
				},
				whiteModel: {
					provider: void 0,
					model: void 0
				},
				blackThinking: void 0,
				whiteThinking: void 0,
				moveTimeoutMs: DEFAULT_MOVE_TIMEOUT_MS,
				maxMoveOutputTokens: DEFAULT_MAX_MOVE_OUTPUT_TOKENS,
				blackPrompt: void 0,
				whitePrompt: void 0,
				groups: [],
				modelsError: void 0
			};
		}
		/** The default settings, overlaid with whatever the user persisted. */
		function freshSettings() {
			const saved = loadPersistedSettings();
			return {
				...defaultSettings(),
				mode: saved.mode ?? "black",
				blackModel: saved.blackModel ?? {
					provider: void 0,
					model: void 0
				},
				whiteModel: saved.whiteModel ?? {
					provider: void 0,
					model: void 0
				},
				blackThinking: saved.blackThinking,
				whiteThinking: saved.whiteThinking,
				blackPrompt: saved.blackPrompt,
				whitePrompt: saved.whitePrompt
			};
		}
		let snapshot = {
			game: freshGame(),
			settings: freshSettings()
		};
		const listeners = /* @__PURE__ */ new Set();
		/** Game generation: bumped on every new game; stale async results are dropped. */
		let generation = 0;
		/** The in-flight move request's abort handle (cancelled on new game / teardown). */
		let abort = null;
		/** Subscribe to store changes (useSyncExternalStore's subscribe). */
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		/** The current stable snapshot (useSyncExternalStore's getSnapshot). */
		function getSnapshot() {
			return snapshot;
		}
		/** Whether the side belongs to the human in this mode. */
		function isHumanTurn(mode, turn) {
			return mode === "black" && turn === 1 || mode === "white" && turn === 2;
		}
		/** Whether the side belongs to the AI in this mode. */
		function isAiTurn(mode, turn) {
			return mode === "both" || mode === "black" && turn === 2 || mode === "white" && turn === 1;
		}
		/** The AI wire side spelling for a cell color. */
		function sideOf(turn) {
			return turn === 1 ? "black" : "white";
		}
		/** Whether the game has settled (win or draw). */
		function gameOver(game) {
			return game.winner !== 0 || game.draw;
		}
		/** Publish one game state to all subscribers, trimming the reasoning log. */
		function commitGame(game) {
			snapshot = {
				...snapshot,
				game: {
					...game,
					log: trimLog(game.log)
				}
			};
			for (const listener of [...listeners]) listener();
		}
		/** Publish one settings state to all subscribers. */
		function commitSettings(settings) {
			snapshot = {
				...snapshot,
				settings
			};
			persistSettings(settings);
			for (const listener of [...listeners]) listener();
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
		function placed(game, row, col) {
			if (gameOver(game)) return null;
			if (!isLegalMove(game.board, row, col)) return null;
			if (game.moveCount === 0 && game.turn === 1 && (row !== TENGEN.row || col !== TENGEN.col)) return null;
			const board = [...game.board];
			const color = game.turn;
			board[row * 15 + col] = color;
			const base = {
				...game,
				board,
				lastMove: {
					row,
					col
				},
				moveCount: game.moveCount + 1,
				turn: color === 1 ? 2 : 1
			};
			if (winsAt(board, row, col)) return {
				...base,
				winner: color
			};
			if (!hasEmpty(board)) return {
				...base,
				draw: true
			};
			return base;
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
		function fillDefaultModels(settings) {
			const firstWithModels = settings.groups.find((group) => group.models.length > 0);
			if (firstWithModels === void 0) return settings;
			const fallback = {
				provider: firstWithModels.provider,
				model: firstWithModels.models[0].id
			};
			const next = { ...settings };
			if (next.blackModel.provider === void 0 || next.blackModel.model === void 0) next.blackModel = { ...fallback };
			if (next.whiteModel.provider === void 0 || next.whiteModel.model === void 0) next.whiteModel = { ...fallback };
			return next;
		}
		/** The in-flight catalog request (one at a time; board and settings may both ask). */
		let modelsRequest = null;
		/** True when an AI move was requested before the catalog finished loading. */
		let pendingAiStart = false;
		/** Record a model-catalog failure on the board (the retry button can re-run it). */
		function recordModelsFailure(message) {
			const { game } = snapshot;
			commitGame({
				...game,
				log: [...game.log, {
					n: game.moveCount + 1,
					side: sideOf(game.turn),
					move: null,
					reasoning: "",
					error: message
				}]
			});
		}
		/** Start the AI move that was waiting for the catalog, if it is still wanted. */
		function startPendingAi() {
			if (!pendingAiStart) return;
			pendingAiStart = false;
			const { game, settings } = snapshot;
			if (gameOver(game) || game.paused || game.thinking) return;
			const model = sideModelOf(settings, game.turn);
			if (model.provider === void 0 || model.model === void 0) {
				recordModelsFailure(settings.modelsError ?? "模型目录中没有可用模型");
				return;
			}
			if (isAiTurn(settings.mode, game.turn)) scheduleAi();
		}
		/** Fetch the model catalog once; failures surface in settings.modelsError. */
		function loadModels() {
			if (snapshot.settings.groups.length > 0) return;
			if (modelsRequest !== null) return;
			modelsRequest = fetchModels().finally(() => {
				modelsRequest = null;
			});
		}
		/** Run the catalog request and publish the outcome. */
		async function fetchModels() {
			try {
				const response = await fetch("/plugins/gomoku/models", { headers: { accept: "application/json" } });
				let body;
				try {
					body = await response.json();
				} catch {
					body = void 0;
				}
				if (!response.ok) {
					const detail = body?.error ?? body?.failures?.[0]?.error;
					throw new Error(detail ?? "模型目录加载失败（HTTP " + response.status + "）");
				}
				const groups = body?.groups ?? [];
				if (groups.length === 0) throw new Error("模型目录为空");
				commitSettings(fillDefaultModels({
					...snapshot.settings,
					groups,
					modelsError: void 0
				}));
				startPendingAi();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (snapshot.settings.groups.length === 0) commitSettings({
					...snapshot.settings,
					modelsError: message
				});
				if (pendingAiStart) {
					pendingAiStart = false;
					recordModelsFailure(message);
				}
			}
		}
		/** Start a new game in the given mode (or the current one), opening with AI when required. */
		function newGame(mode) {
			generation += 1;
			abort?.abort();
			const nextMode = mode ?? snapshot.settings.mode;
			commitGame(freshGame());
			if (nextMode === "white" || nextMode === "both") scheduleAi();
		}
		/** Switch the play mode and restart the game in it. */
		function changeMode(mode) {
			if (mode === snapshot.settings.mode) return;
			commitSettings({
				...snapshot.settings,
				mode
			});
			newGame(mode);
		}
		/** Human click on an empty intersection. While paused the human may play
		* either side (turn order still alternates, no move-count limit); otherwise
		* only the human's own side accepts clicks. */
		function placeStone(row, col) {
			const { game, settings } = snapshot;
			if (gameOver(game) || game.thinking) return;
			if (!game.paused && !isHumanTurn(settings.mode, game.turn)) return;
			const next = placed(game, row, col);
			if (next === null) return;
			commitGame(next);
			if (!gameOver(next) && !next.paused && isAiTurn(settings.mode, next.turn)) scheduleAi();
		}
		/**
		* Toggle manual-takeover (pause) mode. Pausing cuts off any in-flight AI
		* move (the board stays fully playable for both sides, and the interrupted
		* request's catch path only records a log entry — it can never touch the
		* board, because the pause commit already cleared the thinking flag).
		* Releasing the pause hands the turn back to the AI when it is the AI's side.
		*/
		function togglePause() {
			const { game, settings } = snapshot;
			if (gameOver(game)) return;
			if (game.paused) {
				commitGame({
					...game,
					paused: false
				});
				if (isAiTurn(settings.mode, game.turn)) scheduleAi();
			} else {
				abort?.abort();
				commitGame({
					...game,
					paused: true,
					thinking: false
				});
			}
		}
		/** Apply one settings patch (model selection, thinking, overrides, prompt). */
		function patchSettings(patch) {
			commitSettings({
				...snapshot.settings,
				...patch
			});
		}
		/**
		* Restore every user setting to its default (model/thinking/prompt/mode/Jev
		* key) without touching the board or the loaded model catalog.
		*/
		function resetSettings() {
			if (typeof localStorage !== "undefined") try {
				localStorage.removeItem(SETTINGS_STORAGE_KEY);
			} catch {}
			const { groups, modelsError } = snapshot.settings;
			commitSettings(fillDefaultModels({
				...defaultSettings(),
				groups,
				modelsError
			}));
		}
		/**
		* Retry the current move: re-run the AI move for the side whose last attempt
		* failed (the board is unchanged and it is that side's turn). A no-op while
		* the game is settled, a request is in flight, the game is paused (manual
		* play owns the board), or it is the human's turn (the human can simply
		* click the board).
		*/
		function retryMove() {
			const { game, settings } = snapshot;
			if (gameOver(game) || game.thinking || game.paused) return;
			if (!isAiTurn(settings.mode, game.turn)) return;
			scheduleAi();
		}
		/** Drop the current game's reasoning log (the board, settings and turn stay). */
		function clearLog() {
			commitGame({
				...snapshot.game,
				log: []
			});
		}
		/** Max AI attempts per move before the move fails (rejected moves retry). */
		const MAX_AI_ATTEMPTS = 3;
		/**
		* Trim a reasoning log to the newest entries that fit both caps. The log lives
		* in page memory rather than a file, but it grows with every move and the
		* settings page renders it, so it needs a ceiling all the same.
		* @param log - the log to trim, oldest first.
		* @returns a new array holding the newest entries inside both caps.
		*/
		function trimLog(log) {
			const kept = log.length > 200 ? log.slice(log.length - 200) : [...log];
			let chars = kept.reduce((sum, entry) => sum + entry.reasoning.length, 0);
			while (kept.length > 1 && chars > 262144) chars -= kept.shift().reasoning.length;
			return kept;
		}
		/** The side model selection for one turn color. */
		function sideModelOf(settings, turn) {
			return turn === 1 ? settings.blackModel : settings.whiteModel;
		}
		/** The side's native reasoning effort for one turn color (undefined = model default). */
		function sideThinkingOf(settings, turn) {
			return turn === 1 ? settings.blackThinking : settings.whiteThinking;
		}
		/** The side custom system prompt for one turn color (undefined = node default). */
		function sidePromptOf(settings, turn) {
			return turn === 1 ? settings.blackPrompt : settings.whitePrompt;
		}
		/**
		* How long past the node half's own deadline a request may stay silent
		* before the client declares the thinking interrupted (the node half answers
		* within moveTimeoutMs; only a dropped connection stays silent longer).
		*/
		const WATCHDOG_MARGIN_MS = 5e3;
		/** Per-request sequence: a settled reply only applies to the request it came from. */
		let requestSeq = 0;
		/** Run one AI move attempt for the current turn of the current game generation. */
		function scheduleAi(attempt = 1) {
			const { game, settings } = snapshot;
			if (gameOver(game) || game.thinking) return;
			const gen = generation;
			const turn = game.turn;
			const model = sideModelOf(settings, turn);
			if (model.provider === void 0 || model.model === void 0) {
				if (settings.groups.length === 0) {
					pendingAiStart = true;
					loadModels();
					return;
				}
				commitGame({
					...game,
					thinking: false,
					log: [...game.log, {
						n: game.moveCount + 1,
						side: sideOf(turn),
						move: null,
						reasoning: "",
						error: settings.modelsError ?? "模型目录中没有可用模型"
					}]
				});
				return;
			}
			if (model.provider === "gomoku-jev" && !isValidJevApiKey(settings.jevApiKey)) {
				commitGame({
					...game,
					log: [...game.log, {
						n: game.moveCount + 1,
						side: sideOf(turn),
						move: null,
						reasoning: "",
						error: "请先设置 Jev API Key"
					}]
				});
				return;
			}
			abort?.abort();
			const startedAt = Date.now();
			commitGame({
				...game,
				thinking: true,
				thinkingSince: startedAt
			});
			const controller = new AbortController();
			abort = controller;
			const seq = ++requestSeq;
			const watchdog = window.setTimeout(() => {
				if (gen === generation && seq === requestSeq) controller.abort();
			}, settings.moveTimeoutMs + WATCHDOG_MARGIN_MS);
			const system = sidePromptOf(settings, turn);
			const thinking = sideThinkingOf(settings, turn);
			requestAiMove({
				provider: model.provider,
				model: model.model,
				side: sideOf(turn),
				board: [...game.board],
				...model.provider === "gomoku-jev" ? { jevApiKey: settings.jevApiKey } : thinking !== void 0 ? { thinking } : {},
				moveTimeoutMs: settings.moveTimeoutMs,
				maxMoveOutputTokens: settings.maxMoveOutputTokens,
				...system !== void 0 ? { system } : {}
			}, controller.signal).then((reply) => {
				window.clearTimeout(watchdog);
				if (gen !== generation || seq !== requestSeq) return;
				applyAiReply(reply, turn, gen, attempt, Date.now() - startedAt);
			}).catch((error) => {
				window.clearTimeout(watchdog);
				if (gen !== generation || seq !== requestSeq) return;
				const current = snapshot.game;
				if (current.turn !== turn) return;
				if (error?.name === "AbortError") {
					commitGame({
						...current,
						thinking: false,
						thinkingSince: void 0,
						log: [...current.log, {
							n: current.moveCount + 1,
							side: sideOf(turn),
							move: null,
							reasoning: "",
							interrupted: true,
							durationMs: Date.now() - startedAt
						}]
					});
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				commitGame({
					...current,
					thinking: false,
					log: [...current.log, {
						n: current.moveCount + 1,
						side: sideOf(turn),
						move: null,
						reasoning: "",
						error: message,
						durationMs: Date.now() - startedAt
					}]
				});
			});
		}
		/** Apply one settled AI reply for the turn it was requested for. */
		function applyAiReply(reply, turn, gen, attempt, durationMs) {
			const { game, settings } = snapshot;
			if (game.turn !== turn || !game.thinking) return;
			if (reply.move !== void 0) {
				const next = placed(game, reply.move.row, reply.move.col);
				if (next !== null) {
					const withLog = {
						...next,
						thinking: false,
						thinkingSince: void 0,
						log: [...next.log, {
							n: next.moveCount,
							side: sideOf(turn),
							move: `${reply.move.row},${reply.move.col}`,
							reasoning: reply.reasoning ?? "",
							durationMs: reply.durationMs ?? durationMs,
							...reply.attempts !== void 0 ? { attempts: reply.attempts } : {},
							...reply.usage?.inputTokens !== void 0 ? { inputTokens: reply.usage.inputTokens } : {},
							...reply.usage?.outputTokens !== void 0 ? { outputTokens: reply.usage.outputTokens } : {},
							...reply.usage?.reasoningTokens !== void 0 ? { reasoningTokens: reply.usage.reasoningTokens } : {}
						}]
					};
					commitGame(withLog);
					if (!gameOver(withLog) && isAiTurn(settings.mode, withLog.turn)) window.setTimeout(() => {
						if (gen === generation) scheduleAi();
					}, 0);
					return;
				}
				if (attempt < MAX_AI_ATTEMPTS) {
					commitGame({
						...game,
						thinking: false,
						thinkingSince: void 0
					});
					window.setTimeout(() => {
						if (gen === generation) scheduleAi(attempt + 1);
					}, 0);
					return;
				}
			}
			if (reply.draw === true) {
				commitGame({
					...game,
					thinking: false,
					thinkingSince: void 0,
					draw: true
				});
				return;
			}
			const error = reply.error ?? "unknown error";
			commitGame({
				...game,
				thinking: false,
				thinkingSince: void 0,
				log: [...game.log, {
					n: game.moveCount + 1,
					side: sideOf(turn),
					move: null,
					reasoning: reply.reasoning ?? "",
					error,
					durationMs: reply.durationMs ?? durationMs,
					...reply.attempts !== void 0 ? { attempts: reply.attempts } : {},
					...reply.usage?.inputTokens !== void 0 ? { inputTokens: reply.usage.inputTokens } : {},
					...reply.usage?.outputTokens !== void 0 ? { outputTokens: reply.usage.outputTokens } : {}
				}]
			});
		}
		// \0dsh-css:src/client/Gomoku.module.css.mjs
		const css = ".TjYSaa_view,.TjYSaa_settings,.TjYSaa_menu{--border:var(--dsw-alias-border-l2,#8080804d);--border-soft:var(--dsw-alias-border-l1,#80808029);--panel-bg:var(--dsw-alias-bg-module-platform,#8080800f);--well-bg:var(--dsw-alias-bg-layer-1,#80808012);--interactive-hover:var(--dsw-alias-interactive-bg-hover,#8080801f);--interactive-active:var(--dsw-alias-interactive-bg-active,#80808033);--label-primary:var(--dsw-alias-label-primary,inherit);--label-secondary:var(--dsw-alias-label-secondary,#808080c7);--label-tertiary:var(--dsw-alias-label-tertiary,#80808094);--error:var(--dsw-alias-state-error-primary,#e05252);--success:var(--dsw-alias-state-success-primary,#4caf50);--popup-bg:var(--dsw-alias-bg-layer-2,Canvas);--popup-shadow:var(--dsw-elevation-prominent,0 12px 32px #00000047);--wood-base:oklch(74% .1 78);--grid-ink:oklch(32% .04 55/.6);--hoshi-ink:oklch(30% .04 50/.72);--stone-black-rim:oklch(45% .02 65);--stone-black-core:oklch(16% .01 60);--stone-white-rim:oklch(99% .005 90);--stone-white-core:oklch(86% .015 80);--accent:oklch(72% .12 72);--accent-soft:oklch(72% .12 72/.22);--cinnabar:oklch(55% .17 30);--serif:\"Songti SC\", \"STSong\", \"Noto Serif CJK SC\", Georgia, \"Times New Roman\", serif}.TjYSaa_view{box-sizing:border-box;flex-direction:column;gap:10px;height:100%;padding:12px;display:flex;overflow:hidden auto}.TjYSaa_settings{box-sizing:border-box;flex-direction:column;gap:16px;width:100%;min-width:0;max-width:100%;padding:4px 2px 28px;display:flex}.TjYSaa_settingsTitle{font-family:var(--serif);color:var(--label-primary);margin:0;font-size:18px;font-weight:600}.TjYSaa_settingsIntro{color:var(--label-secondary);margin:-8px 0 0;font-size:12px;line-height:1.6}.TjYSaa_settingsGrid{flex-direction:column;gap:14px;min-width:0;display:flex}.TjYSaa_settingsCard{border:1px solid var(--border);background:var(--panel-bg);border-radius:12px;flex-direction:column;gap:12px;min-width:0;max-width:100%;padding:14px;display:flex}.TjYSaa_settingsCardTitle{font-family:var(--serif);align-items:center;gap:8px;font-size:14px;font-weight:600;display:flex}.TjYSaa_settingsBlock{border:1px solid var(--border);background:var(--panel-bg);border-radius:12px;flex-direction:column;gap:10px;min-width:0;max-width:100%;padding:14px;display:flex}.TjYSaa_settingsHeading{font-family:var(--serif);margin:0;font-size:14px;font-weight:600}.TjYSaa_settingsNote{color:var(--label-tertiary);margin:0;font-size:11px;line-height:1.5}.TjYSaa_settingsFooter{align-items:center;gap:10px;display:flex}.TjYSaa_settingsHint{color:var(--label-tertiary);text-align:center;font-size:11px}.TjYSaa_titleStone{border-radius:50%;flex:none;width:12px;height:12px}.TjYSaa_titleStoneBlack{background:radial-gradient(circle at 35% 30%, var(--stone-black-rim), var(--stone-black-core) 75%);box-shadow:0 1px 1px oklch(15% .02 50/.5)}.TjYSaa_titleStoneWhite{background:radial-gradient(circle at 35% 30%, var(--stone-white-rim), var(--stone-white-core) 75%);box-shadow:0 1px 1px oklch(30% .03 55/.4)}.TjYSaa_toolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.TjYSaa_label{color:var(--label-tertiary);font-size:12px}.TjYSaa_segmented{border:1px solid var(--border);background:var(--panel-bg);border-radius:999px;align-items:center;gap:2px;padding:2px;display:inline-flex}.TjYSaa_segButton{cursor:pointer;color:var(--label-secondary);background:0 0;border:none;border-radius:999px;padding:3px 12px;font-size:12px;transition:background-color .16s,color .16s}.TjYSaa_segButton:hover:not(:disabled){background:var(--interactive-hover);color:var(--label-primary)}.TjYSaa_segActive{background:var(--accent-soft);color:var(--label-primary);font-weight:600}.TjYSaa_select{border:1px solid var(--border);color:inherit;box-sizing:border-box;background:0 0;border-radius:8px;width:100%;padding:5px 8px;font-size:12px;transition:border-color .16s}.TjYSaa_select:disabled{opacity:.5}.TjYSaa_jevKey{flex-direction:column;gap:8px;min-width:0;display:flex}.TjYSaa_jevKey p{margin:0}.TjYSaa_jevKey input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.TjYSaa_jevKey input[aria-invalid=true]{border-color:var(--error)}.TjYSaa_jevKey button:disabled{opacity:.5;cursor:not-allowed}.TjYSaa_jevError{color:var(--error);font-size:12px}.TjYSaa_ghost{border:1px solid var(--border);color:var(--label-secondary);cursor:pointer;background:0 0;border-radius:999px;padding:4px 12px;font-size:12px;transition:background-color .16s,color .16s,border-color .16s}.TjYSaa_ghost:hover:not(:disabled){background:var(--interactive-hover);color:var(--label-primary)}.TjYSaa_primary{border:1px solid var(--accent);background:var(--accent-soft);color:var(--label-primary);cursor:pointer;border-radius:999px;padding:4px 14px;font-size:12px;font-weight:600;transition:background-color .16s,border-color .16s}.TjYSaa_primary:hover:not(:disabled){background:color-mix(in oklab, var(--accent) 32%, transparent)}.TjYSaa_action{border:1px solid var(--border);background:var(--panel-bg);height:30px;color:var(--label-primary);cursor:pointer;border-radius:999px;align-items:center;gap:6px;padding:0 12px;font-size:12px;font-weight:500;transition:background-color .16s,border-color .16s,box-shadow .16s;display:inline-flex}.TjYSaa_action:hover:not(:disabled){background:var(--interactive-hover);border-color:var(--dsw-alias-border-l3,#80808073)}.TjYSaa_action:active:not(:disabled){background:var(--interactive-active)}.TjYSaa_action:disabled{cursor:default;opacity:.45}.TjYSaa_actionPaused{border-color:var(--accent);background:var(--accent-soft)}.TjYSaa_actionPaused:hover:not(:disabled){background:color-mix(in oklab, var(--accent) 32%, transparent)}.TjYSaa_actionIcon{flex:none;width:15px;height:15px}.TjYSaa_statusRow{align-items:center;gap:8px;min-height:20px;display:flex}.TjYSaa_status{font-family:var(--serif);letter-spacing:.02em;font-size:14px;font-weight:600}.TjYSaa_statusError{color:var(--error)}.TjYSaa_statusDot{border-radius:50%;flex:none;width:10px;height:10px}.TjYSaa_dotBlack{background:radial-gradient(circle at 35% 30%, var(--stone-black-rim), var(--stone-black-core) 75%)}.TjYSaa_dotWhite{background:radial-gradient(circle at 35% 30%, var(--stone-white-rim), var(--stone-white-core) 75%);border:1px solid oklch(50% .03 60/.4)}.TjYSaa_dotAmber{background:var(--accent)}.TjYSaa_dotError{background:var(--error)}.TjYSaa_dotNeutral{background:var(--label-tertiary)}.TjYSaa_dotPulse{animation:1.6s ease-in-out infinite TjYSaa_dot-pulse}@keyframes TjYSaa_dot-pulse{0%,to{opacity:1}50%{opacity:.35}}.TjYSaa_retry{border:1px solid var(--error);background:color-mix(in oklab, var(--error) 12%, transparent);color:var(--error);cursor:pointer;border-radius:999px;padding:2px 12px;font-size:12px;transition:background-color .16s}.TjYSaa_retry:hover{background:color-mix(in oklab, var(--error) 24%, transparent)}.TjYSaa_hint{color:var(--label-tertiary);text-align:center;min-height:14px;font-size:11px}.TjYSaa_bottomBar{flex-direction:column;gap:8px;width:100%;display:flex}.TjYSaa_modeRow,.TjYSaa_actionRow{flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;display:flex}.TjYSaa_board{aspect-ratio:1;background-color:var(--wood-base);background-image:repeating-linear-gradient(90deg, oklch(66% .09 70/.14) 0 1px, transparent 1px 6px), radial-gradient(120% 60% at 50% 0%, oklch(86% .08 80/.35), transparent 60%), radial-gradient(130% 130% at 50% 50%, transparent 55%, oklch(45% .06 55/.3)), linear-gradient(90deg, transparent calc(50% - .5px), var(--grid-ink) calc(50% - .5px), var(--grid-ink) calc(50% + .5px), transparent calc(50% + .5px)), linear-gradient(to bottom, transparent calc(50% - .5px), var(--grid-ink) calc(50% - .5px), var(--grid-ink) calc(50% + .5px), transparent calc(50% + .5px));user-select:none;background-repeat:repeat,no-repeat,no-repeat,repeat-x,repeat-y;background-size:auto,auto,auto,6.66667% 100%,100% 6.66667%;border-radius:12px;grid-template-columns:repeat(15,1fr);width:100%;max-width:520px;margin:0 auto;display:grid;position:relative;box-shadow:0 1px 2px oklch(20% .03 50/.4),0 10px 24px oklch(20% .03 50/.28)}.TjYSaa_cellSlot{min-width:0;position:relative}.TjYSaa_cell{cursor:pointer;background:0 0;border:none;width:100%;height:100%;padding:0;position:relative}.TjYSaa_cell:disabled{cursor:default}.TjYSaa_cell:hover:not(:disabled){background:oklch(100% .02 85/.16)}.TjYSaa_cell:focus-visible{outline-offset:-2px;outline:2px solid oklch(25% .03 50/.8)}.TjYSaa_stone{pointer-events:none;border-radius:50%;animation:.18s cubic-bezier(.25,1,.4,1) TjYSaa_stone-pop;position:absolute;inset:8%}@keyframes TjYSaa_stone-pop{0%{opacity:.6;transform:scale(.85)}to{opacity:1;transform:scale(1)}}.TjYSaa_stoneBlack{background:radial-gradient(circle at 35% 30%, var(--stone-black-rim), var(--stone-black-core) 75%);box-shadow:0 1px 2px oklch(15% .02 50/.6),inset 0 1px 1px oklch(90% .02 80/.25)}.TjYSaa_stoneWhite{background:radial-gradient(circle at 35% 30%, var(--stone-white-rim), var(--stone-white-core) 75%);box-shadow:0 1px 2px oklch(30% .03 55/.45),inset 0 -1px 1px oklch(50% .03 60/.35)}.TjYSaa_preview{opacity:0;transition:opacity .16s;animation:none}.TjYSaa_cell:hover:not(:disabled) .TjYSaa_preview,.TjYSaa_cell:focus-visible .TjYSaa_preview{opacity:.45}.TjYSaa_lastMove:after{content:\"\";background:var(--cinnabar);border-radius:50%;width:22%;height:22%;position:absolute;top:10%;right:10%;box-shadow:0 0 0 1px oklch(30% .05 30/.35)}.TjYSaa_hoshi{background:var(--hoshi-ink);pointer-events:none;border-radius:50%;width:24%;height:24%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.TjYSaa_field{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.TjYSaa_promptArea{border:1px solid var(--border);background:var(--well-bg);border-radius:10px;flex-direction:column;gap:8px;padding:10px;display:flex}.TjYSaa_promptTitle{color:var(--label-secondary);font-size:12px;font-weight:600}.TjYSaa_promptTextarea{box-sizing:border-box;border:1px solid var(--border);background:var(--well-bg);width:100%;color:inherit;resize:vertical;border-radius:8px;padding:8px;font-family:inherit;font-size:12px;line-height:1.5;transition:border-color .16s}.TjYSaa_promptActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.TjYSaa_flash{color:var(--success);font-size:12px}.TjYSaa_reasoningList{border:1px solid var(--border);background:var(--well-bg);border-radius:10px;flex-direction:column;max-height:240px;padding:6px 10px;display:flex;overflow-y:auto}.TjYSaa_reasoningTitle{color:var(--label-secondary);padding:4px 0 6px;font-size:12px;font-weight:600}.TjYSaa_reasoningItem+.TjYSaa_reasoningItem{border-top:1px solid var(--border-soft)}.TjYSaa_reasoningHeader{box-sizing:border-box;width:100%;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:baseline;gap:8px;padding:5px 2px;font-size:12px;font-weight:600;transition:background-color .15s;display:flex}.TjYSaa_reasoningHeader:hover{background:var(--interactive-hover)}.TjYSaa_chevron{font-size:10px;transition:transform .15s;display:inline-block}.TjYSaa_chevronOpen{transform:rotate(90deg)}.TjYSaa_reasoningCoord{opacity:.7;margin-left:6px;font-weight:400}.TjYSaa_reasoningMeta{color:var(--label-tertiary);white-space:nowrap;margin-left:6px;font-size:10.5px;font-weight:400}.TjYSaa_errorText{color:var(--error);font-weight:400}.TjYSaa_reasoningText{white-space:pre-wrap;word-break:break-word;color:var(--label-secondary);background:var(--well-bg);border-radius:6px;margin:6px 0 2px;padding:8px;font-family:inherit;font-size:11px;line-height:1.5}.TjYSaa_action:focus-visible,.TjYSaa_ghost:focus-visible,.TjYSaa_primary:focus-visible,.TjYSaa_retry:focus-visible,.TjYSaa_segButton:focus-visible,.TjYSaa_reasoningHeader:focus-visible,.TjYSaa_select:focus-visible,.TjYSaa_trigger:focus-visible,.TjYSaa_promptTextarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media (prefers-reduced-motion:reduce){.TjYSaa_stone,.TjYSaa_dotPulse{animation:none}.TjYSaa_segButton,.TjYSaa_action,.TjYSaa_ghost,.TjYSaa_primary,.TjYSaa_retry,.TjYSaa_preview,.TjYSaa_chevron,.TjYSaa_select,.TjYSaa_promptTextarea,.TjYSaa_preview{transition:none}}.TjYSaa_coordTip{z-index:4;color:oklch(98% .005 250);letter-spacing:.02em;white-space:nowrap;pointer-events:none;background:oklch(22% .01 260/.94);border:1px solid oklch(100% 0 0/.14);border-radius:6px;padding:2px 7px;font-size:10.5px;font-weight:600;line-height:1.5;position:absolute;box-shadow:0 6px 16px oklch(10% 0 0/.32)}.TjYSaa_trigger{box-sizing:border-box;border:1px solid var(--border);background:var(--well-bg);width:100%;min-width:0;height:32px;color:var(--label-primary);text-align:left;cursor:pointer;border-radius:8px;align-items:center;gap:6px;padding:0 8px;font-size:12px;transition:border-color .16s,background-color .16s;display:flex}.TjYSaa_trigger:hover:not(:disabled){border-color:var(--dsw-alias-border-l3,#80808073);background:var(--interactive-hover)}.TjYSaa_trigger[aria-expanded=true]{border-color:var(--accent)}.TjYSaa_trigger:disabled{opacity:.5;cursor:default}.TjYSaa_triggerLabel{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.TjYSaa_triggerPlaceholder{color:var(--label-tertiary)}.TjYSaa_triggerChevron{color:var(--label-tertiary);flex:none;font-size:10px;transition:transform .16s}.TjYSaa_triggerChevronOpen{transform:rotate(180deg)}.TjYSaa_menu{z-index:1200;box-sizing:border-box;border:1px solid var(--border);background:var(--popup-bg);color:var(--label-primary);box-shadow:var(--popup-shadow);overscroll-behavior:contain;border-radius:10px;padding:4px;position:fixed;overflow:hidden auto}.TjYSaa_menuEmpty{color:var(--label-tertiary);padding:8px;font-size:12px}.TjYSaa_menuGroup{letter-spacing:.04em;text-transform:uppercase;color:var(--label-tertiary);padding:6px 8px 4px;font-size:10.5px;font-weight:600}.TjYSaa_menuOption{cursor:pointer;border-radius:6px;align-items:center;gap:8px;padding:5px 8px;font-size:12px;line-height:1.5;display:flex}.TjYSaa_menuOptionActive{background:var(--interactive-hover)}.TjYSaa_menuOptionSelected .TjYSaa_menuOptionLabel{font-weight:600}.TjYSaa_menuOptionLabel{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.TjYSaa_menuCheck{color:var(--accent);flex:none;font-size:11px}.TjYSaa_view[data-gomoku-theme=light],.TjYSaa_settings[data-gomoku-theme=light],.TjYSaa_menu[data-gomoku-theme=light]{--accent:oklch(62% .14 62);--accent-soft:oklch(62% .14 62/.16)}";
		const tagId = "@xingmakesense/dsh-gomoku/Gomoku.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@xingmakesense/dsh-gomoku";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Gomoku_module_css_default = {
			"modeRow": "TjYSaa_modeRow",
			"dotError": "TjYSaa_dotError",
			"reasoningMeta": "TjYSaa_reasoningMeta",
			"coordTip": "TjYSaa_coordTip",
			"toolbar": "TjYSaa_toolbar",
			"settings": "TjYSaa_settings",
			"actionRow": "TjYSaa_actionRow",
			"errorText": "TjYSaa_errorText",
			"promptTextarea": "TjYSaa_promptTextarea",
			"menuOption": "TjYSaa_menuOption",
			"settingsHint": "TjYSaa_settingsHint",
			"chevron": "TjYSaa_chevron",
			"dotBlack": "TjYSaa_dotBlack",
			"menu": "TjYSaa_menu",
			"settingsGrid": "TjYSaa_settingsGrid",
			"menuEmpty": "TjYSaa_menuEmpty",
			"hint": "TjYSaa_hint",
			"triggerLabel": "TjYSaa_triggerLabel",
			"settingsCardTitle": "TjYSaa_settingsCardTitle",
			"triggerPlaceholder": "TjYSaa_triggerPlaceholder",
			"retry": "TjYSaa_retry",
			"menuGroup": "TjYSaa_menuGroup",
			"field": "TjYSaa_field",
			"menuCheck": "TjYSaa_menuCheck",
			"menuOptionSelected": "TjYSaa_menuOptionSelected",
			"settingsNote": "TjYSaa_settingsNote",
			"chevronOpen": "TjYSaa_chevronOpen",
			"view": "TjYSaa_view",
			"reasoningHeader": "TjYSaa_reasoningHeader",
			"titleStone": "TjYSaa_titleStone",
			"settingsBlock": "TjYSaa_settingsBlock",
			"dotWhite": "TjYSaa_dotWhite",
			"board": "TjYSaa_board",
			"settingsTitle": "TjYSaa_settingsTitle",
			"dotAmber": "TjYSaa_dotAmber",
			"statusError": "TjYSaa_statusError",
			"dotNeutral": "TjYSaa_dotNeutral",
			"trigger": "TjYSaa_trigger",
			"lastMove": "TjYSaa_lastMove",
			"ghost": "TjYSaa_ghost",
			"label": "TjYSaa_label",
			"reasoningItem": "TjYSaa_reasoningItem",
			"triggerChevronOpen": "TjYSaa_triggerChevronOpen",
			"reasoningTitle": "TjYSaa_reasoningTitle",
			"titleStoneBlack": "TjYSaa_titleStoneBlack",
			"triggerChevron": "TjYSaa_triggerChevron",
			"promptArea": "TjYSaa_promptArea",
			"stone": "TjYSaa_stone",
			"segButton": "TjYSaa_segButton",
			"jevKey": "TjYSaa_jevKey",
			"jevError": "TjYSaa_jevError",
			"reasoningList": "TjYSaa_reasoningList",
			"settingsFooter": "TjYSaa_settingsFooter",
			"settingsHeading": "TjYSaa_settingsHeading",
			"select": "TjYSaa_select",
			"flash": "TjYSaa_flash",
			"actionIcon": "TjYSaa_actionIcon",
			"titleStoneWhite": "TjYSaa_titleStoneWhite",
			"primary": "TjYSaa_primary",
			"segmented": "TjYSaa_segmented",
			"actionPaused": "TjYSaa_actionPaused",
			"statusRow": "TjYSaa_statusRow",
			"cellSlot": "TjYSaa_cellSlot",
			"stone-pop": "TjYSaa_stone-pop",
			"hoshi": "TjYSaa_hoshi",
			"status": "TjYSaa_status",
			"promptActions": "TjYSaa_promptActions",
			"reasoningCoord": "TjYSaa_reasoningCoord",
			"promptTitle": "TjYSaa_promptTitle",
			"dotPulse": "TjYSaa_dotPulse",
			"menuOptionActive": "TjYSaa_menuOptionActive",
			"settingsIntro": "TjYSaa_settingsIntro",
			"action": "TjYSaa_action",
			"statusDot": "TjYSaa_statusDot",
			"dot-pulse": "TjYSaa_dot-pulse",
			"preview": "TjYSaa_preview",
			"segActive": "TjYSaa_segActive",
			"stoneBlack": "TjYSaa_stoneBlack",
			"settingsCard": "TjYSaa_settingsCard",
			"bottomBar": "TjYSaa_bottomBar",
			"cell": "TjYSaa_cell",
			"menuOptionLabel": "TjYSaa_menuOptionLabel",
			"reasoningText": "TjYSaa_reasoningText",
			"stoneWhite": "TjYSaa_stoneWhite"
		};
		// src/client/theme.ts
		/**
		* Theme awareness for the plugin's own chrome.
		*
		* Every surface already inherits the host's `--dsw-alias-*` tokens, which the
		* host re-binds when the appearance switches. Native form chrome (scrollbars,
		* carets, the OS-drawn parts of inputs) does not follow those tokens: it
		* follows CSS `color-scheme`. This module resolves the host's active scheme
		* and the plugin re-publishes it on its own roots, so the light and dark
		* appearances paint the same inside the plugin as outside it.
		*
		* The pure helpers (colour parsing, luminance, scheme choice) are exported for
		* unit tests; the hook only adds the document observers.
		*/
		/** Parse the colour syntaxes `getComputedStyle` reports plus hex literals. */
		function parseColor(color) {
			const text = color.trim().toLowerCase();
			if (text === "" || text === "transparent") return void 0;
			const hex = /^#([0-9a-f]{3,8})$/.exec(text);
			if (hex !== null) {
				const digits = hex[1];
				const expand = (part) => parseInt(part.length === 1 ? part + part : part, 16);
				if (digits.length === 3 || digits.length === 4) return {
					r: expand(digits[0]),
					g: expand(digits[1]),
					b: expand(digits[2]),
					a: digits.length === 4 ? expand(digits[3]) / 255 : 1
				};
				if (digits.length === 6 || digits.length === 8) return {
					r: expand(digits.slice(0, 2)),
					g: expand(digits.slice(2, 4)),
					b: expand(digits.slice(4, 6)),
					a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1
				};
				return;
			}
			const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
			if (rgb === null) return void 0;
			const parts = rgb[1].split(/[,\s/]+/).filter((part) => part !== "");
			if (parts.length < 3) return void 0;
			const channel = (part) => {
				const value = part.endsWith("%") ? parseFloat(part) / 100 * 255 : parseFloat(part);
				return Number.isFinite(value) ? Math.round(Math.min(255, Math.max(0, value))) : 0;
			};
			const alphaText = parts.length > 3 ? parts[3] : "1";
			const alpha = alphaText.endsWith("%") ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
			return {
				r: channel(parts[0]),
				g: channel(parts[1]),
				b: channel(parts[2]),
				a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1
			};
		}
		/** WCAG relative luminance (0 = black, 1 = white) of an sRGB colour. */
		function relativeLuminance(color) {
			const linear = (value) => {
				const channel = value / 255;
				return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
			};
			return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b);
		}
		/**
		* Guess the scheme from a background colour. Transparent or unparsable
		* colours yield undefined so the caller keeps walking to the next ancestor.
		*/
		function schemeFromBackground(color) {
			if (color === void 0) return void 0;
			const parsed = parseColor(color);
			if (parsed === void 0 || parsed.a < .35) return void 0;
			return relativeLuminance(parsed) < .4 ? "dark" : "light";
		}
		/** Read the host-declared `color-scheme`, when it names exactly one scheme. */
		function declaredScheme() {
			if (typeof document === "undefined" || typeof getComputedStyle !== "function") return void 0;
			const declared = getComputedStyle(document.documentElement).colorScheme ?? "";
			const hasDark = declared.includes("dark");
			const hasLight = declared.includes("light");
			if (hasDark && !hasLight) return "dark";
			if (hasLight && !hasDark) return "light";
		}
		/** True when the OS/browser asks for the dark appearance. */
		function mediaPrefersDark() {
			if (typeof matchMedia !== "function") return false;
			try {
				return matchMedia("(prefers-color-scheme: dark)").matches;
			} catch {
				return false;
			}
		}
		/**
		* Resolve the appearance around `start` (or the document): the host's declared
		* `color-scheme` first, then the nearest opaque ancestor background, then the
		* OS preference. Safe without a DOM (returns 'light'), so rendering and tests
		* never depend on the host being present.
		*/
		function detectScheme(start) {
			if (typeof document === "undefined" || typeof getComputedStyle !== "function") return "light";
			const declared = declaredScheme();
			if (declared !== void 0) return declared;
			let element = start ?? document.documentElement;
			while (element !== null) {
				const scheme = schemeFromBackground(getComputedStyle(element).backgroundColor);
				if (scheme !== void 0) return scheme;
				element = element.parentElement;
			}
			return mediaPrefersDark() ? "dark" : "light";
		}
		/** Re-run `onChange` (debounced to one call per task) when the host repaints. */
		function watchDocument(onChange) {
			if (typeof document === "undefined") return () => {};
			let timer;
			const schedule = () => {
				if (timer !== void 0) return;
				timer = setTimeout(() => {
					timer = void 0;
					onChange();
				}, 0);
			};
			const observer = typeof MutationObserver === "function" ? new MutationObserver(schedule) : void 0;
			observer?.observe(document.documentElement, {
				attributes: true,
				attributeFilter: [
					"style",
					"class",
					"data-ds-theme-source"
				]
			});
			if (document.body !== null) observer?.observe(document.body, {
				attributes: true,
				attributeFilter: [
					"style",
					"class",
					"data-ds-dark-theme"
				]
			});
			const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : void 0;
			media?.addEventListener?.("change", schedule);
			return () => {
				observer?.disconnect();
				media?.removeEventListener?.("change", schedule);
				if (timer !== void 0) clearTimeout(timer);
			};
		}
		/**
		* The plugin's published scheme: detected on mount from the host root, then
		* re-detected whenever the host repaints its palette (theme toggle, OS
		* appearance change).
		* @param ref - the plugin root the scheme is published on.
		* @returns the current scheme.
		*/
		function useColorScheme(ref) {
			const [scheme, setScheme] = (0, react.useState)(() => detectScheme(null));
			(0, react.useEffect)(() => {
				const read = () => {
					setScheme(detectScheme(ref.current));
				};
				read();
				return watchDocument(read);
			}, [ref]);
			return scheme;
		}
		// src/client/GomokuView.tsx
		/**
		* The gomoku Better Sidebar page: the board and the game-start controls
		* only. Model selection, thinking levels and prompts live in the plugin's
		* settings page (Settings → Gomoku), so the sidebar stays a board.
		*
		* The game state lives in the module-level store (see store.ts), so switching
		* tabs or collapsing the sidebar never resets a game or interrupts an
		* in-flight AI move.
		*/
		/** The tab's + menu and settings-nav icon: a small four-stone grid. */
		function gomokuIcon(size = 16) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				fill: "none",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "1.25",
						y: "1.25",
						width: "13.5",
						height: "13.5",
						rx: "2.5",
						stroke: "currentColor",
						strokeWidth: "1.1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M5.5 1.5v13M10.5 1.5v13M1.5 5.5h13M1.5 10.5h13",
						stroke: "currentColor",
						strokeWidth: "0.8",
						opacity: "0.55"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "5.5",
						cy: "5.5",
						r: "1.55",
						fill: "currentColor"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "10.5",
						cy: "10.5",
						r: "1.55",
						fill: "currentColor",
						opacity: "0.55"
					})
				]
			});
		}
		const MODES = [
			{
				value: "black",
				key: "mode.black"
			},
			{
				value: "white",
				key: "mode.white"
			},
			{
				value: "both",
				key: "mode.both"
			}
		];
		/**
		* The five star points of a 15×15 board (row-major indices): the four corner
		* hoshi plus tengen. Drawn while the intersection is still empty.
		*/
		const HOSHI = /* @__PURE__ */ new Set([
			48,
			56,
			168,
			176,
			TENGEN.row * 15 + TENGEN.col
		]);
		/** The status line copy for the current game. */
		function statusCopy(game, t) {
			if (game.winner === 1) return {
				text: t("status.win.black"),
				error: false
			};
			if (game.winner === 2) return {
				text: t("status.win.white"),
				error: false
			};
			if (game.draw) return {
				text: t("status.draw"),
				error: false
			};
			if (game.paused) return {
				text: t("status.paused"),
				error: false
			};
			if (game.thinking) return {
				text: t("status.thinking"),
				error: false
			};
			const last = game.log[game.log.length - 1];
			if (last?.interrupted === true) return {
				text: t("status.interrupted"),
				error: true
			};
			if (last?.error !== void 0) return {
				text: t("status.error", { message: last.error }),
				error: true
			};
			return {
				text: game.turn === 1 ? t("status.turn.black") : t("status.turn.white"),
				error: false
			};
		}
		/** Visual status shared by the board header in every model mode. */
		function statusDotClass(game, error, settled) {
			if (settled) {
				if (game.winner === 1) return Gomoku_module_css_default.dotBlack;
				return game.winner === 2 ? Gomoku_module_css_default.dotWhite : Gomoku_module_css_default.dotNeutral;
			}
			if (error) return Gomoku_module_css_default.dotError;
			if (game.paused || game.thinking) return Gomoku_module_css_default.dotAmber + " " + Gomoku_module_css_default.dotPulse;
			return game.turn === 1 ? Gomoku_module_css_default.dotBlack : Gomoku_module_css_default.dotWhite;
		}
		/** Keep mode guidance separate from the board itself. */
		function BoardHint({ paused, opening, mode, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.hint,
				children: [t(paused ? "status.paused.hint" : {
					black: "status.side.hint",
					white: "status.side.hint.white",
					both: "status.side.hint.both"
				}[mode]), opening && " · " + t("rule.first.tengen")]
			});
		}
		/** One intersection: clickable when it is the human's turn. */
		function CellButton({ row, col, cell, last, playable, preview, onClick, onHover, onLeave }) {
			const index = row * 15 + col;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: Gomoku_module_css_default.cellSlot,
				onMouseEnter: () => onHover(row, col),
				onMouseLeave: onLeave,
				onFocus: () => onHover(row, col),
				onBlur: onLeave,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: Gomoku_module_css_default.cell,
					disabled: !playable,
					"aria-label": row + "," + col,
					onClick: () => onClick(row, col),
					children: [
						cell !== 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: Gomoku_module_css_default.stone + " " + (cell === 1 ? Gomoku_module_css_default.stoneBlack : Gomoku_module_css_default.stoneWhite) + (last ? " " + Gomoku_module_css_default.lastMove : "") }),
						cell === 0 && playable && preview !== 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: Gomoku_module_css_default.stone + " " + (preview === 1 ? Gomoku_module_css_default.stoneBlack : Gomoku_module_css_default.stoneWhite) + " " + Gomoku_module_css_default.preview }),
						cell === 0 && HOSHI.has(index) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: Gomoku_module_css_default.hoshi })
					]
				})
			});
		}
		/**
		* Position the coordinate chip above the hovered intersection, kept inside
		* the board's left/right edges (and below the top rows so it never leaves
		* the board surface).
		*/
		function coordTipStyle(row, col) {
			const cell = 100 / 15;
			const below = row < 2;
			const top = below ? (row + 1) * cell : row * cell;
			const translateY = below ? "8px" : "calc(-100% - 8px)";
			let left = (col + .5) * cell;
			let translateX = "-50%";
			if (col <= 1) {
				left = col * cell;
				translateX = "0";
			} else if (col >= 13) {
				left = (col + 1) * cell;
				translateX = "-100%";
			}
			return {
				left: left + "%",
				top: top + "%",
				transform: "translate(" + translateX + ", " + translateY + ")"
			};
		}
		/** The gomoku sidebar page body: board + game-start controls. */
		function GomokuView({ ctx, t }) {
			(0, react.useSyncExternalStore)((onChange) => ctx.locale.subscribe(onChange), () => ctx.locale.getSnapshot());
			const { game, settings } = (0, react.useSyncExternalStore)(subscribe, getSnapshot);
			const [hovered, setHovered] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const scheme = useColorScheme(rootRef);
			(0, react.useEffect)(() => {
				loadModels();
			}, []);
			const status = statusCopy(game, t);
			const [thinkSeconds, setThinkSeconds] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (!game.thinking || game.thinkingSince === void 0) {
					setThinkSeconds(0);
					return;
				}
				const since = game.thinkingSince;
				const read = () => {
					setThinkSeconds(Math.max(0, Math.floor((Date.now() - since) / 1e3)));
				};
				read();
				const timer = window.setInterval(read, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, [game.thinking, game.thinkingSince]);
			const statusText = game.thinking && thinkSeconds > 0 ? t("status.thinking.elapsed", { s: thinkSeconds }) : status.text;
			const settled = game.winner !== 0 || game.draw;
			const humanTurn = settings.mode === "black" && game.turn === 1 || settings.mode === "white" && game.turn === 2;
			const opening = game.moveCount === 0;
			const retryableError = status.error && !settled && !game.thinking && !game.paused;
			const statusDot = statusDotClass(game, status.error, settled);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.view,
				ref: rootRef,
				"data-gomoku-theme": scheme,
				style: { colorScheme: scheme },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.statusRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.statusDot + " " + statusDot,
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Gomoku_module_css_default.status + (status.error ? " " + Gomoku_module_css_default.statusError : ""),
								children: statusText
							}),
							retryableError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.retry,
								onClick: retryMove,
								children: t("status.retry")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BoardHint, {
						paused: game.paused,
						opening,
						mode: settings.mode,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.board,
						role: "grid",
						"aria-label": t("tab.label"),
						children: [game.board.map((cell, index) => {
							const row = Math.floor(index / 15);
							const col = index % 15;
							const last = game.lastMove !== null && game.lastMove.row === row && game.lastMove.col === col;
							const playable = !settled && !game.thinking && (game.paused || humanTurn);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CellButton, {
								row,
								col,
								cell,
								last,
								playable,
								preview: playable ? game.turn : 0,
								onClick: placeStone,
								onHover: (row, col) => setHovered({
									row,
									col
								}),
								onLeave: () => setHovered(null)
							}, index);
						}), hovered !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Gomoku_module_css_default.coordTip,
							style: coordTipStyle(hovered.row, hovered.col),
							"aria-hidden": "true",
							children: t("board.coord", {
								row: hovered.row,
								col: hovered.col
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.bottomBar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Gomoku_module_css_default.modeRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: Gomoku_module_css_default.label,
									children: t("panel.mode")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: Gomoku_module_css_default.segmented,
									role: "group",
									"aria-label": t("panel.mode"),
									children: MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: Gomoku_module_css_default.segButton + (settings.mode === mode.value ? " " + Gomoku_module_css_default.segActive : ""),
										onClick: () => changeMode(mode.value),
										children: t(mode.key)
									}, mode.value))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: Gomoku_module_css_default.actionRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: Gomoku_module_css_default.action,
									onClick: () => newGame(),
									"aria-label": t("panel.newGame"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
										className: Gomoku_module_css_default.actionIcon,
										viewBox: "0 0 16 16",
										"aria-hidden": "true",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "1.5",
											strokeLinecap: "round"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M13.7 1.9v3.2h-3.2",
											fill: "none",
											stroke: "currentColor",
											strokeWidth: "1.5",
											strokeLinecap: "round",
											strokeLinejoin: "round"
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.newGame") })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: Gomoku_module_css_default.action + (game.paused ? " " + Gomoku_module_css_default.actionPaused : ""),
									disabled: settled,
									onClick: togglePause,
									"aria-label": game.paused ? t("panel.resume") : t("panel.pause"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
										className: Gomoku_module_css_default.actionIcon,
										viewBox: "0 0 16 16",
										"aria-hidden": "true",
										children: game.paused ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M5.2 3.4l7 4.6-7 4.6z",
											fill: "currentColor"
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M5.5 3.5v9M10.5 3.5v9",
											stroke: "currentColor",
											strokeWidth: "1.8",
											strokeLinecap: "round"
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: game.paused ? t("panel.resume") : t("panel.pause") })]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Gomoku_module_css_default.settingsHint,
								children: t("board.settings.hint")
							})
						]
					})
				]
			});
		}
		// src/client/JevKeyEditor.tsx
		/** Saved keys stay in page memory and never refill the password input. */
		function JevKeyEditor({ configured, onSave, t }) {
			const id = (0, react.useId)();
			const [draft, setDraft] = (0, react.useState)("");
			const [invalid, setInvalid] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				className: Gomoku_module_css_default.jevKey,
				onSubmit: (event) => {
					event.preventDefault();
					if (!isValidJevApiKey(draft)) {
						setInvalid(true);
						return;
					}
					onSave(draft.trim());
					setDraft("");
					setInvalid(false);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: Gomoku_module_css_default.field,
						htmlFor: id,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Gomoku_module_css_default.label,
							children: t("jev.key.label")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id,
							className: Gomoku_module_css_default.select,
							type: "password",
							value: draft,
							placeholder: configured ? t("jev.key.replace") : t("jev.key.placeholder"),
							autoComplete: "off",
							spellCheck: false,
							maxLength: 4096,
							"aria-describedby": id + "-hint",
							"aria-invalid": invalid,
							onChange: (event) => {
								setDraft(event.target.value);
								setInvalid(false);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: id + "-hint",
						className: Gomoku_module_css_default.hint,
						children: t("jev.key.hint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.promptActions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								className: Gomoku_module_css_default.primary,
								disabled: !draft.trim(),
								children: t("jev.key.save")
							}),
							configured && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.ghost,
								onClick: () => {
									onSave("");
									setDraft("");
									setInvalid(false);
								},
								children: t("jev.key.clear")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.hint,
								role: "status",
								children: configured ? t("jev.key.configured") : t("jev.key.required")
							})
						]
					}),
					invalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Gomoku_module_css_default.jevError,
						role: "alert",
						children: t("jev.key.invalid")
					})
				]
			});
		}
		// src/client/dropdown-logic.ts
		/** Flatten groups into the selectable options, skipping empty groups. */
		function flattenGroups(groups) {
			const flat = [];
			for (const group of groups) for (const option of group.options) flat.push({
				value: option.value,
				label: option.label,
				index: flat.length,
				group: group.label
			});
			return flat;
		}
		/** Build the rendered row list: a heading per non-empty group, then its options. */
		function buildRows(groups) {
			const rows = [];
			let index = 0;
			for (const group of groups) {
				if (group.options.length === 0) continue;
				if (group.label !== "") rows.push({
					kind: "group",
					label: group.label
				});
				for (const option of group.options) {
					rows.push({
						kind: "option",
						option: {
							value: option.value,
							label: option.label,
							index,
							group: group.label
						}
					});
					index += 1;
				}
			}
			return rows;
		}
		/** Index of `value` in the flattened options, or -1 when it is not offered. */
		function indexOfValue(flat, value) {
			return flat.findIndex((option) => option.value === value);
		}
		/** Label to show on the trigger: the selected option's, else the fallback. */
		function labelOfValue(flat, value, fallback) {
			const found = flat.find((option) => option.value === value);
			return found === void 0 ? fallback : found.label;
		}
		/**
		* Move the highlighted row by `delta`, wrapping at both ends. Coming from no
		* selection (-1), a forward step lands on the first row and a backward step on
		* the last, so opening a menu with a key press always highlights something.
		*/
		function stepIndex(current, delta, count) {
			if (count <= 0) return -1;
			if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
			return ((current + delta) % count + count) % count;
		}
		/** Below this much room the menu would be useless, so it flips above. */
		const MENU_MIN_ROOM = 160;
		/**
		* Place the menu under (or over) its trigger: full trigger width (never below
		* MENU_MIN_WIDTH), clamped into the viewport horizontally, flipped above when
		* the space below cannot hold a usable list, and capped to the room on the
		* chosen side so the list always scrolls inside the viewport.
		*/
		function menuBox(anchor, viewport, maxHeight = 320) {
			const available = viewport.width - 16;
			const width = Math.max(0, Math.min(Math.max(anchor.width, 200), available));
			const left = Math.min(Math.max(anchor.left, 8), Math.max(8, viewport.width - width - 8));
			const below = viewport.height - (anchor.top + anchor.height) - 6 - 8;
			const above = anchor.top - 6 - 8;
			const placement = below >= Math.min(maxHeight, MENU_MIN_ROOM) || below > above ? "below" : "above";
			const height = Math.max(80, Math.min(maxHeight, Math.max(80, placement === "below" ? below : above)));
			if (placement === "below") return {
				placement,
				left,
				width,
				top: anchor.top + anchor.height + 6,
				maxHeight: height
			};
			return {
				placement,
				left,
				width,
				bottom: viewport.height - anchor.top + 6,
				maxHeight: height
			};
		}
		// src/client/Dropdown.tsx
		/**
		* A themed listbox that stands in for the native `<select>`.
		*
		* A native select paints its popup with OS/browser chrome that ignores the
		* host palette: in the dark appearance the option list came out as a white
		* sheet with near-invisible labels. This component draws the trigger and the
		* list itself, entirely from the plugin's `--dsw-alias-*` tokens, so the
		* picker follows the light and dark appearances like the rest of the page.
		*
		* The menu is portaled onto `document.body` and painted with
		* `position: fixed` (coordinates from dropdown-logic.ts). The portal matters:
		* a settings shell that animates with a transform makes every
		* `position: fixed` descendant position itself against that transformed
		* ancestor instead of the viewport, which put the list hundreds of pixels off
		* its trigger. Detached from that ancestor it is also never clipped by the
		* settings scroll container. Keyboard: Arrow/Home/End move, Enter/Space
		* choose, Escape closes, Tab leaves; focus stays on the trigger and the active
		* row is published through `aria-activedescendant`.
		*/
		/** The model picker: a token-themed listbox. */
		function Dropdown({ label, value, groups, placeholder, emptyText, onChange, disabled = false, scheme }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [active, setActive] = (0, react.useState)(-1);
			const [box, setBox] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const menuRef = (0, react.useRef)(null);
			const listId = (0, react.useId)();
			const labelId = (0, react.useId)();
			const flat = (0, react.useMemo)(() => flattenGroups(groups), [groups]);
			const rows = (0, react.useMemo)(() => buildRows(groups), [groups]);
			const selected = (0, react.useMemo)(() => indexOfValue(flat, value), [flat, value]);
			const triggerLabel = (0, react.useMemo)(() => labelOfValue(flat, value, placeholder), [
				flat,
				value,
				placeholder
			]);
			const closeMenu = (0, react.useCallback)((restoreFocus = false) => {
				setOpen(false);
				setActive(-1);
				if (restoreFocus) triggerRef.current?.focus();
			}, []);
			/** Re-measure the trigger and re-clamp the menu into the viewport. */
			const placeMenu = (0, react.useCallback)(() => {
				const trigger = triggerRef.current;
				if (trigger === null) return;
				const rect = trigger.getBoundingClientRect();
				setBox(menuBox({
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height
				}, {
					width: window.innerWidth,
					height: window.innerHeight
				}));
			}, []);
			const openMenu = (0, react.useCallback)(() => {
				if (disabled) return;
				setActive(selected >= 0 ? selected : flat.length > 0 ? 0 : -1);
				setOpen(true);
			}, [
				disabled,
				selected,
				flat.length
			]);
			(0, react.useLayoutEffect)(() => {
				if (open) placeMenu();
			}, [open, placeMenu]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (target !== null && (rootRef.current?.contains(target) === true || menuRef.current?.contains(target) === true)) return;
					closeMenu();
				};
				document.addEventListener("mousedown", onPointerDown, true);
				window.addEventListener("scroll", placeMenu, true);
				window.addEventListener("resize", placeMenu);
				return () => {
					document.removeEventListener("mousedown", onPointerDown, true);
					window.removeEventListener("scroll", placeMenu, true);
					window.removeEventListener("resize", placeMenu);
				};
			}, [
				open,
				placeMenu,
				closeMenu
			]);
			(0, react.useEffect)(() => {
				if (disabled && open) closeMenu();
			}, [
				disabled,
				open,
				closeMenu
			]);
			(0, react.useEffect)(() => {
				if (!open || active < 0) return;
				const node = menuRef.current?.querySelector("[data-active=\"true\"]");
				if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
			}, [open, active]);
			const choose = (index) => {
				const option = flat[index];
				if (option === void 0) return;
				onChange(option.value);
				closeMenu(true);
			};
			const onTriggerKeyDown = (event) => {
				switch (event.key) {
					case "ArrowDown":
						event.preventDefault();
						if (open) setActive(stepIndex(active, 1, flat.length));
						else openMenu();
						break;
					case "ArrowUp":
						event.preventDefault();
						if (open) setActive(stepIndex(active, -1, flat.length));
						else openMenu();
						break;
					case "Home":
						if (!open) break;
						event.preventDefault();
						setActive(stepIndex(-1, 1, flat.length));
						break;
					case "End":
						if (!open) break;
						event.preventDefault();
						setActive(stepIndex(-1, -1, flat.length));
						break;
					case "Enter":
					case " ":
						event.preventDefault();
						if (open) {
							if (active >= 0) choose(active);
						} else openMenu();
						break;
					case "Escape":
						if (!open) break;
						event.preventDefault();
						closeMenu(true);
						break;
					case "Tab": if (open) closeMenu();
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.field,
				ref: rootRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: Gomoku_module_css_default.label,
						id: labelId,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: triggerRef,
						type: "button",
						className: Gomoku_module_css_default.trigger,
						disabled,
						"aria-haspopup": "listbox",
						"aria-expanded": open,
						"aria-labelledby": labelId,
						"aria-controls": open ? listId : void 0,
						"aria-activedescendant": open && active >= 0 ? listId + "-" + active : void 0,
						onClick: () => {
							if (open) closeMenu(true);
							else openMenu();
						},
						onKeyDown: onTriggerKeyDown,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Gomoku_module_css_default.triggerLabel + (selected < 0 ? " " + Gomoku_module_css_default.triggerPlaceholder : ""),
							children: triggerLabel
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Gomoku_module_css_default.triggerChevron + (open ? " " + Gomoku_module_css_default.triggerChevronOpen : ""),
							"aria-hidden": "true",
							children: "▾"
						})]
					}),
					open && box !== null && typeof document !== "undefined" && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: menuRef,
						id: listId,
						role: "listbox",
						"aria-labelledby": labelId,
						"data-gomoku-theme": scheme,
						className: Gomoku_module_css_default.menu,
						style: {
							left: box.left,
							width: box.width,
							maxHeight: box.maxHeight,
							colorScheme: scheme,
							...box.top !== void 0 ? { top: box.top } : { bottom: box.bottom }
						},
						children: [flat.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Gomoku_module_css_default.menuEmpty,
							children: emptyText
						}), rows.map((row, position) => row.kind === "group" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Gomoku_module_css_default.menuGroup,
							"aria-hidden": "true",
							children: row.label
						}, "group-" + row.label + "-" + position) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							id: listId + "-" + row.option.index,
							role: "option",
							"aria-selected": row.option.value === value,
							"aria-label": row.option.group === "" ? row.option.label : row.option.group + " · " + row.option.label,
							"data-active": row.option.index === active ? "true" : void 0,
							className: Gomoku_module_css_default.menuOption + (row.option.index === active ? " " + Gomoku_module_css_default.menuOptionActive : "") + (row.option.value === value ? " " + Gomoku_module_css_default.menuOptionSelected : ""),
							onMouseEnter: () => setActive(row.option.index),
							onClick: () => choose(row.option.index),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.menuOptionLabel,
								children: row.option.label
							}), row.option.value === value && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.menuCheck,
								"aria-hidden": "true",
								children: "✓"
							})]
						}, "option-" + row.option.value))]
					}), document.body)
				]
			});
		}
		// src/client/GomokuSettings.tsx
		/**
		* The Gomoku settings page (Settings → Gomoku): per-side model, thinking
		* level and system prompt, the shared Jev key, and the read-only reasoning
		* log of the current game. Everything configurable lives here; the sidebar
		* page keeps only the board and the game-start controls.
		*
		* Values are written through the module store, which persists the
		* user-adjustable subset to localStorage (the Jev key never leaves page
		* memory). The page updates live while a game is running.
		*/
		/** Compact token count: 940 → "940", 1234 → "1.2k". */
		function formatTokens(count) {
			return count >= 1e3 ? (count / 1e3).toFixed(1) + "k" : String(count);
		}
		/**
		* One per-side model selector. The dropdown is themed by the plugin itself
		* (see Dropdown.tsx): a native select painted its option list with OS chrome
		* that ignored the host palette. A persisted model missing from the catalog
		* stays selectable, under its own "current selection" group, so an offline
		* provider never silently switches sides.
		*/
		function ModelSelect({ label, value, groups, onChange, t, scheme }) {
			const selected = value.provider !== void 0 && value.model !== void 0 ? value.provider + "/" + value.model : "";
			const known = groups.some((group) => group.provider === value.provider && group.models.some((model) => model.id === value.model));
			const dropdownGroups = groups.map((group) => ({
				label: group.displayName,
				options: group.models.map((model) => ({
					value: group.provider + "/" + model.id,
					label: model.name
				}))
			}));
			if (!known && selected !== "") dropdownGroups.unshift({
				label: t("model.current"),
				options: [{
					value: selected,
					label: value.model ?? selected
				}]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dropdown, {
				label,
				value: selected,
				groups: dropdownGroups,
				placeholder: t("model.placeholder"),
				emptyText: t("model.empty"),
				disabled: groups.length === 0 && selected === "",
				scheme,
				onChange: (next) => {
					const [provider, ...rest] = next.split("/");
					onChange({
						provider,
						model: rest.join("/")
					});
				}
			});
		}
		/**
		* One side's system-prompt editor. Starts from the stored value (or the node
		* half's default once loaded, when nothing is stored) and saves back through
		* the store — an empty value restores the default prompt.
		*/
		function PromptEditor({ label, value, onSave, t }) {
			const [text, setText] = (0, react.useState)(value ?? "");
			const [defaultPrompt, setDefaultPrompt] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const savedTimer = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setLoading(true);
				fetch("/plugins/gomoku/prompt").then((response) => response.json()).then((body) => {
					if (cancelled || body.prompt === void 0) return;
					setDefaultPrompt(body.prompt);
				}).catch(() => {}).finally(() => {
					if (!cancelled) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, []);
			(0, react.useEffect)(() => {
				setText(value ?? defaultPrompt ?? "");
			}, [value, defaultPrompt]);
			(0, react.useEffect)(() => () => {
				window.clearTimeout(savedTimer.current);
			}, []);
			const flashSaved = () => {
				setSaved(true);
				window.clearTimeout(savedTimer.current);
				savedTimer.current = window.setTimeout(() => setSaved(false), 1500);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.promptArea,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Gomoku_module_css_default.promptTitle,
						children: label
					}),
					loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: Gomoku_module_css_default.hint,
						children: t("panel.prompt.loading")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: Gomoku_module_css_default.promptTextarea,
						value: text,
						rows: 8,
						spellCheck: false,
						onChange: (event) => setText(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.promptActions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.ghost,
								onClick: () => {
									onSave(void 0);
									setText(defaultPrompt ?? "");
								},
								children: t("panel.prompt.restore")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.primary,
								onClick: () => {
									onSave(text.trim().length > 0 ? text : void 0);
									flashSaved();
								},
								children: t("panel.prompt.save")
							}),
							saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.flash,
								children: t("panel.prompt.saved")
							})
						]
					})
				]
			});
		}
		/**
		* One side's reasoning-effort selector. The options come from the host's
		* native model metadata (GET /plugins/gomoku/efforts) — the plugin keeps no
		* effort vocabulary of its own — plus an explicit "follow the model's default"
		* choice, which sends no effort at all.
		*/
		function EffortSelect({ provider, model, value, onChange, t, scheme }) {
			const [efforts, setEfforts] = (0, react.useState)([]);
			const [defaultEffort, setDefaultEffort] = (0, react.useState)(void 0);
			const [loading, setLoading] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (provider === void 0 || model === void 0) {
					setEfforts([]);
					setDefaultEffort(void 0);
					return;
				}
				let cancelled = false;
				setLoading(true);
				fetch("/plugins/gomoku/efforts?provider=" + encodeURIComponent(provider) + "&model=" + encodeURIComponent(model)).then((response) => response.json()).then((body) => {
					if (cancelled) return;
					setEfforts(body.efforts ?? []);
					setDefaultEffort(body.default);
				}).catch(() => {
					if (!cancelled) {
						setEfforts([]);
						setDefaultEffort(void 0);
					}
				}).finally(() => {
					if (!cancelled) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, [provider, model]);
			const defaultName = defaultEffort !== void 0 ? efforts.find((effort) => effort.id === defaultEffort)?.name ?? defaultEffort : void 0;
			const defaultLabel = defaultName !== void 0 ? t("thinking.default") + " · " + defaultName : t("thinking.default");
			const stored = value !== void 0 && !efforts.some((effort) => effort.id === value) ? [{
				value,
				label: value
			}] : [];
			const options = [
				{
					value: "",
					label: defaultLabel
				},
				...efforts.map((effort) => ({
					value: effort.id,
					label: effort.name
				})),
				...stored
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Dropdown, {
				label: t("panel.thinking"),
				value: value ?? "",
				groups: [{
					label: t("thinking.native"),
					options
				}],
				placeholder: defaultLabel,
				emptyText: loading ? t("thinking.loading") : t("thinking.none"),
				disabled: provider === void 0 || model === void 0,
				scheme,
				onChange: (next) => onChange(next === "" ? void 0 : next)
			});
		}
		/** One side's configuration card: model, thinking level, prompt and log. */
		function SideSettings({ heading, stone, settings, logs, expanded, t, onToggle, scheme }) {
			const isBlack = stone === "black";
			const model = isBlack ? settings.blackModel : settings.whiteModel;
			const thinking = isBlack ? settings.blackThinking : settings.whiteThinking;
			const prompt = isBlack ? settings.blackPrompt : settings.whitePrompt;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: Gomoku_module_css_default.settingsCard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.settingsCardTitle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: Gomoku_module_css_default.titleStone + " " + (isBlack ? Gomoku_module_css_default.titleStoneBlack : Gomoku_module_css_default.titleStoneWhite) }), heading]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelSelect, {
						label: isBlack ? t("panel.model.black") : t("panel.model.white"),
						value: model,
						groups: settings.groups,
						onChange: (next) => patchSettings(isBlack ? { blackModel: next } : { whiteModel: next }),
						t,
						scheme
					}),
					model.provider === "gomoku-jev" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Gomoku_module_css_default.settingsNote,
						children: t("jev.decision.hint")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortSelect, {
						provider: model.provider,
						model: model.model,
						value: thinking,
						onChange: (next) => patchSettings(isBlack ? { blackThinking: next } : { whiteThinking: next }),
						t,
						scheme
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptEditor, {
						label: isBlack ? t("panel.prompt.black") : t("panel.prompt.white"),
						value: prompt,
						onSave: (next) => patchSettings(isBlack ? { blackPrompt: next } : { whitePrompt: next }),
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.reasoningList,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Gomoku_module_css_default.reasoningTitle,
								children: isBlack ? t("panel.log.black") : t("panel.log.white")
							}),
							logs.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: Gomoku_module_css_default.hint,
								children: t("reasoning.empty")
							}),
							logs.map((entry) => {
								const isExpanded = expanded.has(entry.n);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: Gomoku_module_css_default.reasoningItem,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: Gomoku_module_css_default.reasoningHeader,
										"aria-expanded": isExpanded,
										"aria-label": isExpanded ? t("reasoning.collapse") : t("reasoning.expand"),
										onClick: () => onToggle(entry.n),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Gomoku_module_css_default.chevron + (isExpanded ? " " + Gomoku_module_css_default.chevronOpen : ""),
												children: "▸"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: Gomoku_module_css_default.reasoningMove,
												children: [t("reasoning.move", { n: entry.n }), entry.move !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: Gomoku_module_css_default.reasoningCoord,
													children: entry.move
												})]
											}),
											entry.durationMs !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Gomoku_module_css_default.reasoningMeta,
												children: t("reasoning.duration", { s: (entry.durationMs / 1e3).toFixed(1) })
											}),
											entry.attempts !== void 0 && entry.attempts > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Gomoku_module_css_default.reasoningMeta,
												children: t("reasoning.attempts", { n: entry.attempts })
											}),
											entry.inputTokens !== void 0 && entry.outputTokens !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Gomoku_module_css_default.reasoningMeta,
												children: t("reasoning.tokens", {
													i: formatTokens(entry.inputTokens),
													o: formatTokens(entry.outputTokens)
												})
											}),
											entry.interrupted === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Gomoku_module_css_default.errorText,
												children: t("status.interrupted")
											}),
											entry.error !== void 0 && entry.interrupted !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: Gomoku_module_css_default.errorText,
												children: entry.error
											})
										]
									}), isExpanded && entry.reasoning !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
										className: Gomoku_module_css_default.reasoningText,
										children: entry.reasoning
									})]
								}, entry.n);
							})
						]
					})
				]
			});
		}
		/** The settings page body. */
		function GomokuSettings({ t }) {
			const { game, settings } = (0, react.useSyncExternalStore)(subscribe, getSnapshot);
			const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [resetDone, setResetDone] = (0, react.useState)(false);
			const [logCleared, setLogCleared] = (0, react.useState)(false);
			const resetTimer = (0, react.useRef)(void 0);
			const logTimer = (0, react.useRef)(void 0);
			const rootRef = (0, react.useRef)(null);
			const scheme = useColorScheme(rootRef);
			(0, react.useEffect)(() => {
				loadModels();
			}, []);
			(0, react.useEffect)(() => () => {
				window.clearTimeout(resetTimer.current);
				window.clearTimeout(logTimer.current);
			}, []);
			const toggleEntry = (n) => {
				setExpanded((prev) => {
					const next = new Set(prev);
					if (next.has(n)) next.delete(n);
					else next.add(n);
					return next;
				});
			};
			const handleReset = () => {
				resetSettings();
				setResetDone(true);
				window.clearTimeout(resetTimer.current);
				resetTimer.current = window.setTimeout(() => setResetDone(false), 1800);
			};
			/** Drop both the page log and the node half's diagnostics ring. */
			const handleClearLog = () => {
				clearLog();
				fetch("/plugins/gomoku/log", { method: "DELETE" }).catch(() => {});
				setLogCleared(true);
				window.clearTimeout(logTimer.current);
				logTimer.current = window.setTimeout(() => setLogCleared(false), 1800);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.settings,
				ref: rootRef,
				"data-gomoku-theme": scheme,
				style: { colorScheme: scheme },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: Gomoku_module_css_default.settingsTitle,
						children: t("settings.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Gomoku_module_css_default.settingsIntro,
						children: t("settings.intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.settingsGrid,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideSettings, {
							heading: t("panel.black"),
							stone: "black",
							settings,
							logs: game.log.filter((entry) => entry.side === "black"),
							expanded,
							t,
							onToggle: toggleEntry,
							scheme
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideSettings, {
							heading: t("panel.white"),
							stone: "white",
							settings,
							logs: game.log.filter((entry) => entry.side === "white"),
							expanded,
							t,
							onToggle: toggleEntry,
							scheme
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: Gomoku_module_css_default.settingsBlock,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: Gomoku_module_css_default.settingsHeading,
							children: t("settings.jev")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(JevKeyEditor, {
							configured: settings.jevApiKey.length > 0,
							onSave: (jevApiKey) => patchSettings({ jevApiKey }),
							t
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.settingsFooter,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.ghost,
								onClick: handleClearLog,
								children: t("settings.log.clear")
							}),
							logCleared && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.flash,
								role: "status",
								children: t("settings.log.cleared")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.ghost,
								onClick: handleReset,
								children: t("settings.reset")
							}),
							resetDone && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: Gomoku_module_css_default.flash,
								role: "status",
								children: t("settings.reset.done")
							})
						]
					})
				]
			});
		}
		// src/client/locales.ts
		/** `gomoku` namespace dictionaries for the board page. */
		/** Dictionary namespace owned by this plugin. */
		const NS = "gomoku";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"tab.label": "五子棋",
			"tab.description": "和 AI 下一盘 15×15 无禁手五子棋；模型与提示词在设置页调整",
			"board.settings.hint": "模型、思考强度与提示词：设置 → 五子棋",
			"board.coord": "行 {row} · 列 {col}",
			"settings.label": "五子棋",
			"settings.title": "五子棋设置",
			"settings.intro": "设置黑白两方的模型、思考强度与提示词，并查看当前对局的思考记录。思考强度直接读取宿主为该模型声明的原生档位，默认跟随模型自身设置。这些设置会自动保存，对局进行中修改会在下一手生效。",
			"settings.jev": "Jev 访问凭据",
			"settings.reset": "恢复默认设置",
			"settings.reset.done": "已恢复默认设置",
			"settings.log.clear": "清理对局日志",
			"settings.log.cleared": "对局日志已清理",
			"jev.key.label": "Jev API Key",
			"jev.key.placeholder": "输入 TypeSafe API Key",
			"jev.key.replace": "输入新 Key 以替换",
			"jev.key.hint": "用于 TypeSafe 官方 Jev，黑白双方共用。仅在当前页面保留，刷新后需重新填写。",
			"jev.key.save": "使用此 Key",
			"jev.key.clear": "清除",
			"jev.key.configured": "已设置",
			"jev.key.required": "需要设置 Key 才能对弈",
			"jev.key.invalid": "请输入有效的 API Key，不可包含空格或换行。",
			"jev.decision.hint": "Jev 从合法落点中直接选择，不提供思考档位或思维链。",
			"panel.mode": "对弈模式",
			"mode.black": "执黑先手",
			"mode.white": "执白后发",
			"mode.both": "双 AI 对弈",
			"panel.black": "黑方 AI",
			"panel.white": "白方 AI",
			"panel.thinking": "思考强度",
			"thinking.default": "默认（跟随模型）",
			"thinking.native": "模型原生档位",
			"thinking.loading": "正在读取模型档位…",
			"thinking.none": "该模型未声明思考强度",
			"panel.model.black": "黑方模型",
			"panel.model.white": "白方模型",
			"model.current": "当前选择",
			"model.placeholder": "选择模型",
			"model.empty": "没有可用模型",
			"panel.newGame": "新开局",
			"panel.pause": "暂停",
			"panel.resume": "继续",
			"panel.log.black": "黑方思考记录",
			"panel.log.white": "白方思考记录",
			"panel.prompt.black": "黑方提示词",
			"panel.prompt.white": "白方提示词",
			"panel.prompt.save": "保存",
			"panel.prompt.restore": "恢复默认",
			"panel.prompt.loading": "正在加载默认提示词…",
			"panel.prompt.saved": "已保存",
			"reasoning.empty": "暂无思考记录",
			"reasoning.move": "第 {n} 手",
			"reasoning.attempts": "第 {n} 次尝试",
			"reasoning.tokens": "输入 {i} → 输出 {o} token",
			"reasoning.duration": "{s}s",
			"reasoning.expand": "展开详情",
			"reasoning.collapse": "收起",
			"status.retry": "重试",
			"status.interrupted": "AI 思考已中断",
			"status.turn.black": "黑方落子",
			"status.turn.white": "白方落子",
			"status.thinking": "AI 思考中…",
			"status.thinking.elapsed": "AI 思考中… {s}s",
			"status.paused": "已暂停 · 手动对弈中",
			"status.paused.hint": "暂停中：可为黑白双方轮流落子，AI 思考已中断",
			"status.win.black": "黑方胜！",
			"status.win.white": "白方胜！",
			"status.draw": "和棋",
			"status.error": "出错了：{message}",
			"status.side.hint": "你执黑方 · 黑先手",
			"status.side.hint.white": "你执白方 · AI 执黑先手",
			"status.side.hint.both": "双 AI 对弈，旁观中",
			"rule.first.tengen": "黑方第一手必须落在天元 (7,7)"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"tab.label": "Gomoku",
			"tab.description": "Play 15×15 freestyle Gomoku against your models; models and prompts live in Settings",
			"board.settings.hint": "Models, reasoning effort and prompts: Settings → Gomoku",
			"board.coord": "Row {row} · Column {col}",
			"settings.label": "Gomoku",
			"settings.title": "Gomoku settings",
			"settings.intro": "Choose the model, reasoning effort and prompt for each side, and review the reasoning of the current game. The effort list is the model's own native metadata reported by the host, and the default follows the model itself. Settings are saved automatically and apply from the next move, even mid-game.",
			"settings.jev": "Jev credential",
			"settings.reset": "Restore defaults",
			"settings.reset.done": "Defaults restored",
			"settings.log.clear": "Clear game log",
			"settings.log.cleared": "Game log cleared",
			"jev.key.label": "Jev API Key",
			"jev.key.placeholder": "Enter your TypeSafe API key",
			"jev.key.replace": "Enter a new key to replace it",
			"jev.key.hint": "For official TypeSafe Jev, shared by both sides. Kept only in this page; enter it again after refreshing.",
			"jev.key.save": "Use this key",
			"jev.key.clear": "Clear",
			"jev.key.configured": "Configured",
			"jev.key.required": "Set a key to play",
			"jev.key.invalid": "Enter a valid API key without spaces or line breaks.",
			"jev.decision.hint": "Jev chooses a legal move directly, without thinking levels or a reasoning trace.",
			"panel.mode": "Mode",
			"mode.black": "Play Black",
			"mode.white": "Play White",
			"mode.both": "AI vs AI",
			"panel.black": "Black AI",
			"panel.white": "White AI",
			"panel.thinking": "Reasoning effort",
			"thinking.default": "Default (follow the model)",
			"thinking.native": "Native model efforts",
			"thinking.loading": "Reading the model efforts…",
			"thinking.none": "This model declares no reasoning efforts",
			"panel.model.black": "Black model",
			"panel.model.white": "White model",
			"model.current": "Current selection",
			"model.placeholder": "Select a model",
			"model.empty": "No models available",
			"panel.newGame": "New game",
			"panel.pause": "Pause",
			"panel.resume": "Resume",
			"panel.log.black": "Black's reasoning log",
			"panel.log.white": "White's reasoning log",
			"panel.prompt.black": "Black's prompt",
			"panel.prompt.white": "White's prompt",
			"panel.prompt.save": "Save",
			"panel.prompt.restore": "Restore default",
			"panel.prompt.loading": "Loading default prompt…",
			"panel.prompt.saved": "Saved",
			"reasoning.empty": "No reasoning recorded yet",
			"reasoning.move": "Move {n}",
			"reasoning.attempts": "attempt {n}",
			"reasoning.tokens": "{i} in → {o} out tokens",
			"reasoning.duration": "{s}s",
			"reasoning.expand": "Expand",
			"reasoning.collapse": "Collapse",
			"status.retry": "Retry",
			"status.interrupted": "AI thinking interrupted",
			"status.turn.black": "Black's turn",
			"status.turn.white": "White's turn",
			"status.thinking": "AI is thinking…",
			"status.thinking.elapsed": "AI is thinking… {s}s",
			"status.paused": "Paused — manual play",
			"status.paused.hint": "Paused: play both black and white; AI thinking is interrupted",
			"status.win.black": "Black wins!",
			"status.win.white": "White wins!",
			"status.draw": "Draw",
			"status.error": "Error: {message}",
			"status.side.hint": "You play black · black moves first",
			"status.side.hint.white": "You play white · AI opens as black",
			"status.side.hint.both": "AI vs AI — spectating",
			"rule.first.tengen": "Black's opening move must be the tengen (7,7)"
		};
		// src/client/index.ts
		/**
		* Gomoku browser half, plugin entry. Contributes three client pieces:
		*
		* - the gomoku dictionaries;
		* - the Settings → Gomoku page (models, thinking levels, prompts, Jev key
		*   and the reasoning log);
		* - the board page on the Better Sidebar service (board + game-start
		*   controls only).
		*
		* The board state lives in the module-level store, so tab switches never
		* reset the game. Better Sidebar is a hard client requirement: the board
		* page exists only inside its registry, so the plugin waits for
		* `ctx.betterSidebar` before applying.
		* @module @xingmakesense/dsh-gomoku/client
		*/
		/** Required services: locale, the slot registry and the sidebar tab registry. */
		const inject = [
			"locale",
			"slots",
			"betterSidebar"
		];
		/**
		* Client plugin body: register the dictionaries, the settings page and the
		* board page. Every registration rides its service's disposer, so plugin
		* unload removes all three.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "gomoku: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "gomoku",
				order: 140,
				label: () => t("settings.label"),
				locale: NS
			}, GomokuSettings));
			ctx.slots.inject("settings.section.icon", () => ctx.slots.register({
				name: "settings.section.icon",
				id: "gomoku",
				order: 140
			}, ({ size }) => gomokuIcon(size)));
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "gomoku",
				title: () => t("tab.label"),
				description: () => t("tab.description"),
				icon: (size) => gomokuIcon(size),
				order: 200,
				single: true,
				component: (props) => (0, react.createElement)(GomokuView, {
					...props,
					t
				})
			}), "gomoku: better-sidebar page");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map