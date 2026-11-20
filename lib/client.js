window.__ModuleLoader__.load({
	id: "@xingmakesense/dsh-gomoku",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		/** The fixed per-move deadline in milliseconds (3000 seconds; not user-adjustable). */
		const DEFAULT_MOVE_TIMEOUT_MS = 3e6;
		/** The fixed per-move output-token cap (not user-adjustable). */
		const DEFAULT_MAX_MOVE_OUTPUT_TOKENS = 32e3;
		/** localStorage key of the persisted user settings (never the Jev key). */
		const SETTINGS_STORAGE_KEY = "dsh-gomoku:settings:v1";
		/** Whether a persisted value is a usable side-model selection. */
		function isSideModel(value) {
			if (value === null || typeof value !== "object") return false;
			const model = value;
			return (model.provider === void 0 || typeof model.provider === "string") && (model.model === void 0 || typeof model.model === "string");
		}
		/** Whether a persisted value is a known thinking level. */
		function isThinking(value) {
			return value === "off" || value === "high" || value === "max";
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
				blackThinking: "off",
				whiteThinking: "off",
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
				blackThinking: saved.blackThinking ?? "off",
				whiteThinking: saved.whiteThinking ?? "off",
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
		/** Publish one game state to all subscribers. */
		function commitGame(game) {
			snapshot = {
				...snapshot,
				game
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
		/** Max AI attempts per move before the move fails (rejected moves retry). */
		const MAX_AI_ATTEMPTS = 3;
		/** The side model selection for one turn color. */
		function sideModelOf(settings, turn) {
			return turn === 1 ? settings.blackModel : settings.whiteModel;
		}
		/** The side thinking level for one turn color. */
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
			commitGame({
				...game,
				thinking: true
			});
			const controller = new AbortController();
			abort = controller;
			const seq = ++requestSeq;
			const watchdog = window.setTimeout(() => {
				if (gen === generation && seq === requestSeq) controller.abort();
			}, settings.moveTimeoutMs + WATCHDOG_MARGIN_MS);
			const system = sidePromptOf(settings, turn);
			requestAiMove({
				provider: model.provider,
				model: model.model,
				side: sideOf(turn),
				board: [...game.board],
				...model.provider === "gomoku-jev" ? { jevApiKey: settings.jevApiKey } : { thinking: sideThinkingOf(settings, turn) },
				moveTimeoutMs: settings.moveTimeoutMs,
				maxMoveOutputTokens: settings.maxMoveOutputTokens,
				...system !== void 0 ? { system } : {}
			}, controller.signal).then((reply) => {
				window.clearTimeout(watchdog);
				if (gen !== generation || seq !== requestSeq) return;
				applyAiReply(reply, turn, gen, attempt);
			}).catch((error) => {
				window.clearTimeout(watchdog);
				if (gen !== generation || seq !== requestSeq) return;
				const current = snapshot.game;
				if (current.turn !== turn) return;
				if (error?.name === "AbortError") {
					commitGame({
						...current,
						thinking: false,
						log: [...current.log, {
							n: current.moveCount + 1,
							side: sideOf(turn),
							move: null,
							reasoning: "",
							interrupted: true
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
						error: message
					}]
				});
			});
		}
		/** Apply one settled AI reply for the turn it was requested for. */
		function applyAiReply(reply, turn, gen, attempt) {
			const { game, settings } = snapshot;
			if (game.turn !== turn || !game.thinking) return;
			if (reply.move !== void 0) {
				const next = placed(game, reply.move.row, reply.move.col);
				if (next !== null) {
					const withLog = {
						...next,
						thinking: false,
						log: [...next.log, {
							n: next.moveCount,
							side: sideOf(turn),
							move: `${reply.move.row},${reply.move.col}`,
							reasoning: reply.reasoning ?? ""
						}]
					};
					commitGame(withLog);
					if (!gameOver(withLog) && isAiTurn(settings.mode, withLog.turn)) window.setTimeout(() => {
						if (gen === generation) scheduleAi();
					}, 350);
					return;
				}
				if (attempt < MAX_AI_ATTEMPTS) {
					commitGame({
						...game,
						thinking: false
					});
					window.setTimeout(() => {
						if (gen === generation) scheduleAi(attempt + 1);
					}, 200);
					return;
				}
			}
			if (reply.draw === true) {
				commitGame({
					...game,
					thinking: false,
					draw: true
				});
				return;
			}
			const error = reply.error ?? "unknown error";
			commitGame({
				...game,
				thinking: false,
				log: [...game.log, {
					n: game.moveCount + 1,
					side: sideOf(turn),
					move: null,
					reasoning: reply.reasoning ?? "",
					error
				}]
			});
		}
		// \0dsh-css:src/client/Gomoku.module.css.mjs
		const css = ".fybyjG_view{box-sizing:border-box;--border:var(--dsw-alias-border-l2,#8080804d);--border-soft:var(--dsw-alias-border-l1,#80808029);--panel-bg:var(--dsw-alias-bg-module-platform,#8080800f);--well-bg:var(--dsw-alias-bg-layer-1,#80808012);--interactive-hover:var(--dsw-alias-interactive-bg-hover,#8080801f);--interactive-active:var(--dsw-alias-interactive-bg-active,#80808033);--label-primary:var(--dsw-alias-label-primary,inherit);--label-secondary:var(--dsw-alias-label-secondary,#808080c7);--label-tertiary:var(--dsw-alias-label-tertiary,#80808094);--error:var(--dsw-alias-state-error-primary,#e05252);--success:var(--dsw-alias-state-success-primary,#4caf50);--wood-base:oklch(74% .1 78);--grid-ink:oklch(32% .04 55/.6);--hoshi-ink:oklch(30% .04 50/.72);--stone-black-rim:oklch(45% .02 65);--stone-black-core:oklch(16% .01 60);--stone-white-rim:oklch(99% .005 90);--stone-white-core:oklch(86% .015 80);--accent:oklch(72% .12 72);--accent-soft:oklch(72% .12 72/.22);--cinnabar:oklch(55% .17 30);--serif:\"Songti SC\", \"STSong\", \"Noto Serif CJK SC\", Georgia, \"Times New Roman\", serif;flex-direction:column;gap:10px;height:100%;padding:12px;display:flex;overflow-y:auto}.fybyjG_settings{--border:var(--dsw-alias-border-l2,#8080804d);--border-soft:var(--dsw-alias-border-l1,#80808029);--panel-bg:var(--dsw-alias-bg-module-platform,#8080800f);--well-bg:var(--dsw-alias-bg-layer-1,#80808012);--interactive-hover:var(--dsw-alias-interactive-bg-hover,#8080801f);--interactive-active:var(--dsw-alias-interactive-bg-active,#80808033);--label-primary:var(--dsw-alias-label-primary,inherit);--label-secondary:var(--dsw-alias-label-secondary,#808080c7);--label-tertiary:var(--dsw-alias-label-tertiary,#80808094);--error:var(--dsw-alias-state-error-primary,#e05252);--success:var(--dsw-alias-state-success-primary,#4caf50);--wood-base:oklch(74% .1 78);--grid-ink:oklch(32% .04 55/.6);--hoshi-ink:oklch(30% .04 50/.72);--stone-black-rim:oklch(45% .02 65);--stone-black-core:oklch(16% .01 60);--stone-white-rim:oklch(99% .005 90);--stone-white-core:oklch(86% .015 80);--accent:oklch(72% .12 72);--accent-soft:oklch(72% .12 72/.22);--cinnabar:oklch(55% .17 30);--serif:\"Songti SC\", \"STSong\", \"Noto Serif CJK SC\", Georgia, \"Times New Roman\", serif;box-sizing:border-box;flex-direction:column;gap:16px;max-width:980px;padding:4px 2px 28px;display:flex}.fybyjG_settingsTitle{font-family:var(--serif);color:var(--label-primary);margin:0;font-size:18px;font-weight:600}.fybyjG_settingsIntro{color:var(--label-secondary);margin:-8px 0 0;font-size:12px;line-height:1.6}.fybyjG_settingsGrid{grid-template-columns:repeat(auto-fit,minmax(340px,1fr));align-items:start;gap:16px;display:grid}.fybyjG_settingsCard{border:1px solid var(--border);background:var(--panel-bg);border-radius:12px;flex-direction:column;gap:12px;min-width:0;padding:14px;display:flex}.fybyjG_settingsCardTitle{font-family:var(--serif);align-items:center;gap:8px;font-size:14px;font-weight:600;display:flex}.fybyjG_settingsBlock{border:1px solid var(--border);background:var(--panel-bg);border-radius:12px;flex-direction:column;gap:10px;padding:14px;display:flex}.fybyjG_settingsHeading{font-family:var(--serif);margin:0;font-size:14px;font-weight:600}.fybyjG_settingsNote{color:var(--label-tertiary);margin:0;font-size:11px;line-height:1.5}.fybyjG_settingsFooter{align-items:center;gap:10px;display:flex}.fybyjG_settingsHint{color:var(--label-tertiary);text-align:center;font-size:11px}.fybyjG_titleStone{border-radius:50%;flex:none;width:12px;height:12px}.fybyjG_titleStoneBlack{background:radial-gradient(circle at 35% 30%, var(--stone-black-rim), var(--stone-black-core) 75%);box-shadow:0 1px 1px oklch(15% .02 50/.5)}.fybyjG_titleStoneWhite{background:radial-gradient(circle at 35% 30%, var(--stone-white-rim), var(--stone-white-core) 75%);box-shadow:0 1px 1px oklch(30% .03 55/.4)}.fybyjG_toolbar{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.fybyjG_label{color:var(--label-tertiary);font-size:12px}.fybyjG_segmented{border:1px solid var(--border);background:var(--panel-bg);border-radius:999px;align-items:center;gap:2px;padding:2px;display:inline-flex}.fybyjG_segButton{cursor:pointer;color:var(--label-secondary);background:0 0;border:none;border-radius:999px;padding:3px 12px;font-size:12px;transition:background-color .16s,color .16s}.fybyjG_segButton:hover:not(:disabled){background:var(--interactive-hover);color:var(--label-primary)}.fybyjG_segActive{background:var(--accent-soft);color:var(--label-primary);font-weight:600}.fybyjG_select{border:1px solid var(--border);color:inherit;box-sizing:border-box;background:0 0;border-radius:8px;width:100%;padding:5px 8px;font-size:12px;transition:border-color .16s}.fybyjG_select:disabled{opacity:.5}.fybyjG_jevKey{flex-direction:column;gap:8px;min-width:0;display:flex}.fybyjG_jevKey p{margin:0}.fybyjG_jevKey input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.fybyjG_jevKey input[aria-invalid=true]{border-color:var(--error)}.fybyjG_jevKey button:disabled{opacity:.5;cursor:not-allowed}.fybyjG_jevError{color:var(--error);font-size:12px}.fybyjG_ghost{border:1px solid var(--border);color:var(--label-secondary);cursor:pointer;background:0 0;border-radius:999px;padding:4px 12px;font-size:12px;transition:background-color .16s,color .16s,border-color .16s}.fybyjG_ghost:hover:not(:disabled){background:var(--interactive-hover);color:var(--label-primary)}.fybyjG_primary{border:1px solid var(--accent);background:var(--accent-soft);color:var(--label-primary);cursor:pointer;border-radius:999px;padding:4px 14px;font-size:12px;font-weight:600;transition:background-color .16s,border-color .16s}.fybyjG_primary:hover:not(:disabled){background:oklch(72% .12 72/.32)}.fybyjG_action{border:1px solid var(--border);background:var(--panel-bg);height:30px;color:var(--label-primary);cursor:pointer;border-radius:999px;align-items:center;gap:6px;padding:0 12px;font-size:12px;font-weight:500;transition:background-color .16s,border-color .16s,box-shadow .16s;display:inline-flex}.fybyjG_action:hover:not(:disabled){background:var(--interactive-hover);border-color:var(--dsw-alias-border-l3,#80808073)}.fybyjG_action:active:not(:disabled){background:var(--interactive-active)}.fybyjG_action:disabled{cursor:default;opacity:.45}.fybyjG_actionPaused{border-color:var(--accent);background:var(--accent-soft)}.fybyjG_actionPaused:hover:not(:disabled){background:oklch(72% .12 72/.32)}.fybyjG_actionIcon{flex:none;width:15px;height:15px}.fybyjG_statusRow{align-items:center;gap:8px;min-height:20px;display:flex}.fybyjG_status{font-family:var(--serif);letter-spacing:.02em;font-size:14px;font-weight:600}.fybyjG_statusError{color:var(--error)}.fybyjG_statusDot{border-radius:50%;flex:none;width:10px;height:10px}.fybyjG_dotBlack{background:radial-gradient(circle at 35% 30%, var(--stone-black-rim), var(--stone-black-core) 75%)}.fybyjG_dotWhite{background:radial-gradient(circle at 35% 30%, var(--stone-white-rim), var(--stone-white-core) 75%);border:1px solid oklch(50% .03 60/.4)}.fybyjG_dotAmber{background:var(--accent)}.fybyjG_dotError{background:var(--error)}.fybyjG_dotNeutral{background:var(--label-tertiary)}.fybyjG_dotPulse{animation:1.6s ease-in-out infinite fybyjG_dot-pulse}@keyframes fybyjG_dot-pulse{0%,to{opacity:1}50%{opacity:.35}}.fybyjG_retry{border:1px solid var(--error);background:color-mix(in oklab, var(--error) 12%, transparent);color:var(--error);cursor:pointer;border-radius:999px;padding:2px 12px;font-size:12px;transition:background-color .16s}.fybyjG_retry:hover{background:color-mix(in oklab, var(--error) 24%, transparent)}.fybyjG_hint{color:var(--label-tertiary);text-align:center;min-height:14px;font-size:11px}.fybyjG_bottomBar{flex-direction:column;gap:8px;width:100%;display:flex}.fybyjG_modeRow,.fybyjG_actionRow{flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;display:flex}.fybyjG_board{aspect-ratio:1;background-color:var(--wood-base);background-image:repeating-linear-gradient(90deg, oklch(66% .09 70/.14) 0 1px, transparent 1px 6px), radial-gradient(120% 60% at 50% 0%, oklch(86% .08 80/.35), transparent 60%), radial-gradient(130% 130% at 50% 50%, transparent 55%, oklch(45% .06 55/.3)), linear-gradient(90deg, transparent calc(50% - .5px), var(--grid-ink) calc(50% - .5px), var(--grid-ink) calc(50% + .5px), transparent calc(50% + .5px)), linear-gradient(to bottom, transparent calc(50% - .5px), var(--grid-ink) calc(50% - .5px), var(--grid-ink) calc(50% + .5px), transparent calc(50% + .5px));user-select:none;background-repeat:repeat,no-repeat,no-repeat,repeat-x,repeat-y;background-size:auto,auto,auto,6.66667% 100%,100% 6.66667%;border-radius:12px;grid-template-columns:repeat(15,1fr);width:100%;max-width:520px;margin:0 auto;display:grid;position:relative;box-shadow:0 1px 2px oklch(20% .03 50/.4),0 10px 24px oklch(20% .03 50/.28)}.fybyjG_cellSlot{min-width:0;position:relative}.fybyjG_cell{cursor:pointer;background:0 0;border:none;width:100%;height:100%;padding:0;position:relative}.fybyjG_cell:disabled{cursor:default}.fybyjG_cell:hover:not(:disabled){background:oklch(100% .02 85/.16)}.fybyjG_cell:focus-visible{outline-offset:-2px;outline:2px solid oklch(25% .03 50/.8)}.fybyjG_stone{pointer-events:none;border-radius:50%;animation:.18s cubic-bezier(.25,1,.4,1) fybyjG_stone-pop;position:absolute;inset:8%}@keyframes fybyjG_stone-pop{0%{opacity:.6;transform:scale(.85)}to{opacity:1;transform:scale(1)}}.fybyjG_stoneBlack{background:radial-gradient(circle at 35% 30%, var(--stone-black-rim), var(--stone-black-core) 75%);box-shadow:0 1px 2px oklch(15% .02 50/.6),inset 0 1px 1px oklch(90% .02 80/.25)}.fybyjG_stoneWhite{background:radial-gradient(circle at 35% 30%, var(--stone-white-rim), var(--stone-white-core) 75%);box-shadow:0 1px 2px oklch(30% .03 55/.45),inset 0 -1px 1px oklch(50% .03 60/.35)}.fybyjG_preview{opacity:0;transition:opacity .16s;animation:none}.fybyjG_cell:hover:not(:disabled) .fybyjG_preview,.fybyjG_cell:focus-visible .fybyjG_preview{opacity:.45}.fybyjG_lastMove:after{content:\"\";background:var(--cinnabar);border-radius:50%;width:22%;height:22%;position:absolute;top:10%;right:10%;box-shadow:0 0 0 1px oklch(30% .05 30/.35)}.fybyjG_hoshi{background:var(--hoshi-ink);pointer-events:none;border-radius:50%;width:24%;height:24%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.fybyjG_field{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.fybyjG_promptArea{border:1px solid var(--border);background:var(--well-bg);border-radius:10px;flex-direction:column;gap:8px;padding:10px;display:flex}.fybyjG_promptTitle{color:var(--label-secondary);font-size:12px;font-weight:600}.fybyjG_promptTextarea{box-sizing:border-box;border:1px solid var(--border);background:var(--well-bg);width:100%;color:inherit;resize:vertical;border-radius:8px;padding:8px;font-family:inherit;font-size:12px;line-height:1.5;transition:border-color .16s}.fybyjG_promptActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.fybyjG_flash{color:var(--success);font-size:12px}.fybyjG_reasoningList{border:1px solid var(--border);background:var(--well-bg);border-radius:10px;flex-direction:column;max-height:240px;padding:6px 10px;display:flex;overflow-y:auto}.fybyjG_reasoningTitle{color:var(--label-secondary);padding:4px 0 6px;font-size:12px;font-weight:600}.fybyjG_reasoningItem+.fybyjG_reasoningItem{border-top:1px solid var(--border-soft)}.fybyjG_reasoningHeader{box-sizing:border-box;width:100%;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:baseline;gap:8px;padding:5px 2px;font-size:12px;font-weight:600;transition:background-color .15s;display:flex}.fybyjG_reasoningHeader:hover{background:var(--interactive-hover)}.fybyjG_chevron{font-size:10px;transition:transform .15s;display:inline-block}.fybyjG_chevronOpen{transform:rotate(90deg)}.fybyjG_reasoningCoord{opacity:.7;margin-left:6px;font-weight:400}.fybyjG_errorText{color:var(--error);font-weight:400}.fybyjG_reasoningText{white-space:pre-wrap;word-break:break-word;color:var(--label-secondary);background:var(--well-bg);border-radius:6px;margin:6px 0 2px;padding:8px;font-family:inherit;font-size:11px;line-height:1.5}.fybyjG_action:focus-visible,.fybyjG_ghost:focus-visible,.fybyjG_primary:focus-visible,.fybyjG_retry:focus-visible,.fybyjG_segButton:focus-visible,.fybyjG_reasoningHeader:focus-visible,.fybyjG_select:focus-visible,.fybyjG_promptTextarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media (prefers-reduced-motion:reduce){.fybyjG_stone,.fybyjG_dotPulse{animation:none}.fybyjG_segButton,.fybyjG_action,.fybyjG_ghost,.fybyjG_primary,.fybyjG_retry,.fybyjG_preview,.fybyjG_chevron,.fybyjG_select,.fybyjG_promptTextarea,.fybyjG_preview{transition:none}}.fybyjG_coordTip{z-index:4;color:oklch(98% .005 250);letter-spacing:.02em;white-space:nowrap;pointer-events:none;background:oklch(22% .01 260/.94);border:1px solid oklch(100% 0 0/.14);border-radius:6px;padding:2px 7px;font-size:10.5px;font-weight:600;line-height:1.5;position:absolute;box-shadow:0 6px 16px oklch(10% 0 0/.32)}";
		const tagId = "@xingmakesense/dsh-gomoku/Gomoku.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@xingmakesense/dsh-gomoku";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var Gomoku_module_css_default = {
			"actionPaused": "fybyjG_actionPaused",
			"reasoningHeader": "fybyjG_reasoningHeader",
			"preview": "fybyjG_preview",
			"errorText": "fybyjG_errorText",
			"dotError": "fybyjG_dotError",
			"dotNeutral": "fybyjG_dotNeutral",
			"promptTitle": "fybyjG_promptTitle",
			"actionIcon": "fybyjG_actionIcon",
			"field": "fybyjG_field",
			"settingsHint": "fybyjG_settingsHint",
			"promptTextarea": "fybyjG_promptTextarea",
			"reasoningItem": "fybyjG_reasoningItem",
			"chevron": "fybyjG_chevron",
			"chevronOpen": "fybyjG_chevronOpen",
			"settingsCard": "fybyjG_settingsCard",
			"dotBlack": "fybyjG_dotBlack",
			"settingsIntro": "fybyjG_settingsIntro",
			"actionRow": "fybyjG_actionRow",
			"settingsHeading": "fybyjG_settingsHeading",
			"dot-pulse": "fybyjG_dot-pulse",
			"label": "fybyjG_label",
			"stone": "fybyjG_stone",
			"segButton": "fybyjG_segButton",
			"promptArea": "fybyjG_promptArea",
			"settingsBlock": "fybyjG_settingsBlock",
			"cellSlot": "fybyjG_cellSlot",
			"titleStoneWhite": "fybyjG_titleStoneWhite",
			"flash": "fybyjG_flash",
			"dotWhite": "fybyjG_dotWhite",
			"retry": "fybyjG_retry",
			"lastMove": "fybyjG_lastMove",
			"segmented": "fybyjG_segmented",
			"titleStone": "fybyjG_titleStone",
			"bottomBar": "fybyjG_bottomBar",
			"stone-pop": "fybyjG_stone-pop",
			"ghost": "fybyjG_ghost",
			"action": "fybyjG_action",
			"statusError": "fybyjG_statusError",
			"stoneBlack": "fybyjG_stoneBlack",
			"reasoningCoord": "fybyjG_reasoningCoord",
			"settingsFooter": "fybyjG_settingsFooter",
			"primary": "fybyjG_primary",
			"statusRow": "fybyjG_statusRow",
			"reasoningTitle": "fybyjG_reasoningTitle",
			"cell": "fybyjG_cell",
			"promptActions": "fybyjG_promptActions",
			"settingsGrid": "fybyjG_settingsGrid",
			"select": "fybyjG_select",
			"hint": "fybyjG_hint",
			"modeRow": "fybyjG_modeRow",
			"reasoningList": "fybyjG_reasoningList",
			"reasoningText": "fybyjG_reasoningText",
			"hoshi": "fybyjG_hoshi",
			"status": "fybyjG_status",
			"dotAmber": "fybyjG_dotAmber",
			"view": "fybyjG_view",
			"toolbar": "fybyjG_toolbar",
			"segActive": "fybyjG_segActive",
			"titleStoneBlack": "fybyjG_titleStoneBlack",
			"settingsTitle": "fybyjG_settingsTitle",
			"jevKey": "fybyjG_jevKey",
			"dotPulse": "fybyjG_dotPulse",
			"board": "fybyjG_board",
			"stoneWhite": "fybyjG_stoneWhite",
			"settingsCardTitle": "fybyjG_settingsCardTitle",
			"statusDot": "fybyjG_statusDot",
			"coordTip": "fybyjG_coordTip",
			"settingsNote": "fybyjG_settingsNote",
			"jevError": "fybyjG_jevError",
			"settings": "fybyjG_settings"
		};
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
			(0, react.useEffect)(() => {
				loadModels();
			}, []);
			const status = statusCopy(game, t);
			const settled = game.winner !== 0 || game.draw;
			const humanTurn = settings.mode === "black" && game.turn === 1 || settings.mode === "white" && game.turn === 2;
			const opening = game.moveCount === 0;
			const retryableError = status.error && !settled && !game.thinking && !game.paused;
			const statusDot = statusDotClass(game, status.error, settled);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.view,
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
								children: status.text
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
		const THINKINGS = [
			{
				value: "off",
				key: "thinking.off"
			},
			{
				value: "high",
				key: "thinking.high"
			},
			{
				value: "max",
				key: "thinking.max"
			}
		];
		/** One per-side model selector (keeps a persisted unknown model visible). */
		function ModelSelect({ label, value, groups, onChange }) {
			const selected = value.provider !== void 0 && value.model !== void 0 ? value.provider + "/" + value.model : "";
			const known = groups.some((group) => group.provider === value.provider && group.models.some((model) => model.id === value.model));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: Gomoku_module_css_default.field,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: Gomoku_module_css_default.label,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					className: Gomoku_module_css_default.select,
					value: selected,
					onChange: (event) => {
						const [provider, ...rest] = event.target.value.split("/");
						onChange({
							provider,
							model: rest.join("/")
						});
					},
					disabled: groups.length === 0 && selected === "",
					children: [
						groups.length === 0 && selected === "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: "—"
						}),
						!known && selected !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: selected,
							children: value.model
						}),
						groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
							label: group.displayName,
							children: group.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: group.provider + "/" + model.id,
								children: model.name
							}, model.id))
						}, group.provider))
					]
				})]
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
		/** One side's configuration card: model, thinking level, prompt and log. */
		function SideSettings({ heading, stone, settings, logs, expanded, t, onToggle }) {
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
						onChange: (next) => patchSettings(isBlack ? { blackModel: next } : { whiteModel: next })
					}),
					model.provider === "gomoku-jev" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: Gomoku_module_css_default.settingsNote,
						children: t("jev.decision.hint")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: Gomoku_module_css_default.toolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Gomoku_module_css_default.label,
							children: t("panel.thinking")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: Gomoku_module_css_default.segmented,
							role: "group",
							"aria-label": t("panel.thinking"),
							children: THINKINGS.map((level) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Gomoku_module_css_default.segButton + (thinking === level.value ? " " + Gomoku_module_css_default.segActive : ""),
								onClick: () => patchSettings(isBlack ? { blackThinking: level.value } : { whiteThinking: level.value }),
								children: t(level.key)
							}, level.value))
						})]
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
			const resetTimer = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				loadModels();
			}, []);
			(0, react.useEffect)(() => () => {
				window.clearTimeout(resetTimer.current);
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: Gomoku_module_css_default.settings,
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
							onToggle: toggleEntry
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SideSettings, {
							heading: t("panel.white"),
							stone: "white",
							settings,
							logs: game.log.filter((entry) => entry.side === "white"),
							expanded,
							t,
							onToggle: toggleEntry
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
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Gomoku_module_css_default.ghost,
							onClick: handleReset,
							children: t("settings.reset")
						}), resetDone && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: Gomoku_module_css_default.flash,
							role: "status",
							children: t("settings.reset.done")
						})]
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
			"board.settings.hint": "模型、思考档位与提示词：设置 → 五子棋",
			"board.coord": "行 {row} · 列 {col}",
			"settings.label": "五子棋",
			"settings.title": "五子棋设置",
			"settings.intro": "设置黑白两方的模型、思考档位与提示词，并查看当前对局的思考记录。这些设置会自动保存，对局进行中修改会在下一手生效。",
			"settings.jev": "Jev 访问凭据",
			"settings.reset": "恢复默认设置",
			"settings.reset.done": "已恢复默认设置",
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
			"panel.thinking": "思考档位",
			"thinking.off": "Off",
			"thinking.high": "High",
			"thinking.max": "Max",
			"panel.model.black": "黑方模型",
			"panel.model.white": "白方模型",
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
			"reasoning.expand": "展开详情",
			"reasoning.collapse": "收起",
			"status.retry": "重试",
			"status.interrupted": "AI 思考已中断",
			"status.turn.black": "黑方落子",
			"status.turn.white": "白方落子",
			"status.thinking": "AI 思考中…",
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
			"board.settings.hint": "Models, thinking level and prompts: Settings → Gomoku",
			"board.coord": "Row {row} · Column {col}",
			"settings.label": "Gomoku",
			"settings.title": "Gomoku settings",
			"settings.intro": "Choose the model, thinking level and prompt for each side, and review the reasoning of the current game. Settings are saved automatically and apply from the next move, even mid-game.",
			"settings.jev": "Jev credential",
			"settings.reset": "Restore defaults",
			"settings.reset.done": "Defaults restored",
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
			"panel.thinking": "Thinking",
			"thinking.off": "Off",
			"thinking.high": "High",
			"thinking.max": "Max",
			"panel.model.black": "Black model",
			"panel.model.white": "White model",
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
			"reasoning.expand": "Expand",
			"reasoning.collapse": "Collapse",
			"status.retry": "Retry",
			"status.interrupted": "AI thinking interrupted",
			"status.turn.black": "Black's turn",
			"status.turn.white": "White's turn",
			"status.thinking": "AI is thinking…",
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