import z from "@deepseek-ai/schemastery";
import { BlockAssembler, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
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
// src/jev-shared.ts
/** Plugin-owned route, separate from any host provider named Jev. */
const JEV_PROVIDER = "gomoku-jev";
const JEV_MODEL = "jev-latest";
/** Reject empty keys and characters that cannot be sent in an HTTP header. */
function isValidJevApiKey(value) {
	return typeof value === "string" && /^[\x21-\x7e]{1,4096}$/.test(value.trim());
}
// src/jev.ts
/** Official native API, documented at https://docs.typesafe.ai/api. */
const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Jev chooses from legal intersections; it does not generate chat text. */
async function requestJevMove(board, side, system, apiKey, signal) {
	const criteria = {};
	const opening = board.every((cell) => cell === 0) && side === "black";
	for (let index = 0; index < board.length; index++) {
		if (board[index] !== 0 || opening && index !== 112) continue;
		const row = Math.floor(index / 15);
		const col = index % 15;
		criteria[`${row},${col}`] = {
			row,
			col
		};
	}
	if (Object.keys(criteria).length === 0) return {
		text: "{\"draw\":true}",
		reasoning: "",
		truncated: false
	};
	let response;
	try {
		response = await fetch(JEV_ENDPOINT, {
			method: "POST",
			redirect: "error",
			signal,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${apiKey.trim()}`
			},
			body: JSON.stringify({
				model: JEV_MODEL,
				state: {
					board: Array.from({ length: 15 }, (_, row) => board.slice(row * 15, (row + 1) * 15)),
					side,
					legend: {
						0: "empty",
						1: "black",
						2: "white"
					}
				},
				questions: { move: {
					type: "choice",
					instructions: {
						strategy: system,
						task: "Choose the strongest legal move for your side in freestyle Gomoku. Five or more in a row wins. Coordinates are zero-based. Follow the strategy for tactics; return the chosen option using the Choice API, not chat text or JSON prose."
					},
					criteria
				} }
			})
		});
	} catch {
		signal.throwIfAborted();
		throw Object.assign(/* @__PURE__ */ new Error("Jev 连接失败，请稍后重试"), { code: "TRANSPORT" });
	}
	if (!response.ok) {
		const status = response.status;
		await response.body?.cancel();
		const message = status === 401 || status === 403 ? "Jev API Key 无效或没有访问权限，请重新设置" : status === 402 ? "Jev 账户额度不足" : status === 429 ? "Jev 请求过于频繁，请稍后重试" : `Jev 请求失败（HTTP ${status}）`;
		throw Object.assign(new Error(message), { code: status === 429 ? "RATE_LIMIT" : status >= 500 ? "SERVER" : "AUTH" });
	}
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error("Jev 返回了无法解析的响应");
	}
	signal.throwIfAborted();
	const answer = body?.answers?.move;
	if (answer?.type !== "choice" || typeof answer.choice !== "string" || !Object.hasOwn(criteria, answer.choice)) throw new Error("Jev 未返回合法的候选落点");
	const move = criteria[answer.choice];
	return {
		text: JSON.stringify({ move: [move.row, move.col] }),
		reasoning: "",
		truncated: false
	};
}
// src/threats.ts
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
const BOARD_SIZE$1 = 15;
const EMPTY$1 = 0;
const BLACK$1 = 1;
const WHITE$1 = 2;
/** The four line directions, with display labels. */
const DIRECTIONS = [
	{
		key: "row",
		label: "横向",
		dr: 0,
		dc: 1
	},
	{
		key: "column",
		label: "纵向",
		dr: 1,
		dc: 0
	},
	{
		key: "diagDown",
		label: "斜线↘",
		dr: 1,
		dc: 1
	},
	{
		key: "diagUp",
		label: "斜线↙",
		dr: 1,
		dc: -1
	}
];
/** Whether (row, col) is on the board. */
function inBounds(row, col) {
	return row >= 0 && row < BOARD_SIZE$1 && col >= 0 && col < BOARD_SIZE$1;
}
/**
* Count this color's stones through (row, col) along one direction,
* assuming the cell itself already holds that color.
*/
function lineCount(board, row, col, dr, dc, color) {
	let count = 1;
	for (const step of [1, -1]) {
		let r = row + dr * step;
		let c = col + dc * step;
		while (inBounds(r, c) && board[r * BOARD_SIZE$1 + c] === color) {
			count += 1;
			r += dr * step;
			c += dc * step;
		}
	}
	return count;
}
/** Whether the stone at (row, col) makes five or more in a line. */
function winsAt(board, row, col, color) {
	for (const { dr, dc } of DIRECTIONS) if (lineCount(board, row, col, dr, dc, color) >= 5) return true;
	return false;
}
/**
* Whether an empty point would complete a five for this color along one
* direction. The point is treated as the color's stone.
*/
function winsInDirection(board, row, col, color, dr, dc) {
	return lineCount(board, row, col, dr, dc, color) >= 5;
}
/** Analyze one color's opportunities and threats on the current board. */
function analyzeSide(board, color) {
	const five = [];
	const fours = [];
	const open = {
		row: [],
		column: [],
		diagDown: [],
		diagUp: []
	};
	for (let index = 0; index < board.length; index += 1) {
		if (board[index] !== EMPTY$1) continue;
		const row = Math.floor(index / BOARD_SIZE$1);
		const col = index % BOARD_SIZE$1;
		const next = board.slice();
		next[index] = color;
		if (winsAt(next, row, col, color)) {
			five.push({
				row,
				col
			});
			continue;
		}
		let hasOpenFour = false;
		let hasFour = false;
		for (const { key, dr, dc } of DIRECTIONS) {
			let finishingPoints = 0;
			for (let q = 0; q < next.length; q += 1) {
				if (next[q] !== EMPTY$1) continue;
				if (winsInDirection(next, Math.floor(q / BOARD_SIZE$1), q % BOARD_SIZE$1, color, dr, dc)) finishingPoints += 1;
			}
			if (finishingPoints >= 2) {
				open[key].push({
					row,
					col
				});
				hasOpenFour = true;
			} else if (finishingPoints === 1) hasFour = true;
		}
		if (!hasOpenFour && hasFour) fours.push({
			row,
			col
		});
	}
	return {
		five,
		fours,
		openThrees: DIRECTIONS.map(({ key, label }) => ({
			direction: key,
			label,
			points: open[key]
		}))
	};
}
/**
* Analyze both sides for the side to move.
* @param board - 225 row-major cells (0 empty, 1 black, 2 white).
* @param side - the side the AI plays (the opponent is the other color).
* @returns the opponent's threats and this side's opportunities.
*/
function analyzeThreats(board, side) {
	const selfColor = side === "black" ? BLACK$1 : WHITE$1;
	const opponentColor = side === "black" ? WHITE$1 : BLACK$1;
	return {
		self: analyzeSide(board, selfColor),
		opponent: analyzeSide(board, opponentColor)
	};
}
/** Render points as (r,c) pairs, capped so the hint stays short. */
function formatPoints(points, limit = 8) {
	const shown = points.slice(0, limit).map((point) => "(" + point.row + "," + point.col + ")").join("、");
	return points.length > limit ? shown + " 等" : shown;
}
/**
* Render the advisory block appended to the move request's user message.
* It states threats and opportunities; it never dictates a move.
* @param report - the computed threat report.
* @param side - the side the AI plays.
* @returns the threat block text (one bullet per finding).
*/
function threatHintText(report, side) {
	const opponent = side === "black" ? "白" : "黑";
	const self = side === "black" ? "黑" : "白";
	const lines = [];
	if (report.opponent.five.length > 0) lines.push("- 对方（" + opponent + "）下一手可直接成五：" + formatPoints(report.opponent.five) + "。不封堵将立刻输棋。");
	const opponentOpen = report.opponent.openThrees.filter((entry) => entry.points.length > 0);
	if (opponentOpen.length > 0) {
		lines.push("- 对方（" + opponent + "）活三：在下列点落子后对方将形成活四（两个成五点，无法单点封堵）：");
		for (const entry of opponentOpen) lines.push("  · " + entry.label + "：" + formatPoints(entry.points));
		if (opponentOpen.length > 1) lines.push("  · 对方存在多个方向的活三威胁，一子可能无法全部封堵；优先找双防点，或己方抢先取胜。");
		else if (opponentOpen[0].points.length > 2) lines.push("  · 对方在同一方向有多处活三威胁，注意一子能否同时封堵。");
	}
	if (report.opponent.fours.length > 0) lines.push("- 对方（" + opponent + "）冲四威胁点：" + formatPoints(report.opponent.fours) + "。对方在此落子后下一手可成五。");
	if (report.self.five.length > 0) lines.push("- 己方（" + self + "）下一手可直接成五：" + formatPoints(report.self.five) + "。能直接取胜时优先落子。");
	const selfOpen = report.self.openThrees.filter((entry) => entry.points.length > 0);
	if (selfOpen.length > 0) {
		lines.push("- 己方（" + self + "）活三进攻点（落子即形成活四）：");
		for (const entry of selfOpen) lines.push("  · " + entry.label + "：" + formatPoints(entry.points));
	}
	if (lines.length === 0) lines.push("- 当前没有可立即成五、形成活四或活三的战术要点。");
	return lines.join("\n");
}
// src/index.ts
/** Cordis plugin name (diagnostics only). */
const name = "gomoku";
/** Services required before the board routes can mount. */
const inject = ["webServer", "llm"];
/** Board edge length in intersections (standard freestyle gomoku board). */
const BOARD_SIZE = 15;
/** Empty intersection. */
const EMPTY = 0;
/** Black stone (moves first). */
const BLACK = 1;
/** White stone (moves second). */
const WHITE = 2;
/** Loader schema with deployment defaults (no library defaults). */
const Config = z.object({
	moveTimeoutMs: z.number().step(1).min(1e3).default(MOVE_TIMEOUT_MS),
	maxMoveOutputTokens: z.number().step(1).min(8).default(MAX_MOVE_OUTPUT_TOKENS),
	maxMoveAttempts: z.number().step(1).min(1).max(3).default(3)
});
/** Route prefix owned by this plugin (the browser half calls under it). */
const GOMOKU_PATH = "/plugins/gomoku";
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
const DEFAULT_SYSTEM_PROMPT = [
	"你是五子棋落子引擎（无禁手，任意方向连成 5 子及以上即胜）。为指定执子方选择当前最优的一步合法空点。判断在内部完成，只输出 JSON。",
	"",
	"# 快速判断（按优先级，命中即停）",
	"1. 己方成五：任一方向己方已有连续 4 子（含跳四）且空端可成五 → 立即落子取胜。",
	"2. 对手成五：对手 4 子的成五点 → 必须封堵；若对手活四无法单点封堵，则改走己方最快取胜点。消息中的威胁提示会列出这些点。",
	"3. 己方强攻：能形成活四、冲四或「四三」的点优先；冲四可迫使对手应手，为下一手争取先手。",
	"4. 对手活三：立即封堵其一端；若一子能同时封堵两个威胁（双防点），优先选双防点。威胁提示会列出对方可形成活四的点。",
	"5. 己方活三/双活三：无紧急威胁时，选择能形成活三、双活三或多方向连线的点。",
	"6. 布局：靠近天元与双方已有棋群，保持连线；避免边角、孤立与没有后续的落点。",
	"",
	"# 时间预算（硬性）",
	`每一步只有 30 秒，思考与输出都算在内，超时这一手立即作废。不要展开长链推演：按上面的优先级自上而下扫描，命中第一条能执行的规则就落子；候选点最多比较 3 个，拿不准就选最靠近现有棋群、最能延续连线的点。`,
	"",
	"# 术语",
	"活三＝3 连且两端可延伸（下一步可成活四）；冲四＝4 连且仅一端可成五；活四＝两端均可成五、无法单点封堵；双活三/四三＝一子同时形成两个活三 / 冲四加活三，均为强杀。",
	"",
	"# 威胁提示",
	"每次请求附带程序计算的威胁清单：对方可直接成五 / 活三（落子即形成活四）与冲四的点，以及己方机会。它只作参考，不强制落子；出现对方成五点或活三时必须优先处理，再考虑进攻。",
	"",
	`# 候选比较（最多评估 3 个点）`,
	"- 只考虑现有棋子 2 格以内的空点；黑方首手固定天元 (7,7)。",
	"- 评分＝进攻价值（成 5 > 活四 > 冲四 > 活三 > 双三/四三 > 活二）＋防守价值（封成 5 > 封冲四 > 封活三/双防）。",
	"- 同分依次比较：能否强制对手应手 → 是否连接更多棋子 → 是否更靠近中心。",
	"- 宁可下在能持续进攻的要点，也不下没有后续的孤子。",
	"",
	"# 输出（严格遵守）",
	"只输出一行 JSON，不要解释或 Markdown：{\"move\": [row, col]}",
	"和棋：{\"draw\": true}",
	"无法判断：{\"error\": \"一句话原因\"}",
	"row、col 为 0–14 的整数，目标点必须为空。"
].join("\n");
/**
* Whether an intersection is inside the board and currently empty.
* @param board - row-major cell values (length must be BOARD_SIZE²).
* @param row - intersection row.
* @param col - intersection column.
* @returns true when the move may be played.
*/
function isLegalMove(board, row, col) {
	return row >= 0 && row < 15 && col >= 0 && col < 15 && board[row * 15 + col] === 0;
}
/**
* Render the board as the 16-line labeled text the prompt describes: a
* column-number header (digits aligned over their columns) followed by one
* line per row, each prefixed with its row number, one character per
* intersection.
* @param board - row-major cell values (length must be BOARD_SIZE²).
* @returns the labeled board text.
*/
function boardText(board) {
	const tens = Array.from({ length: 15 }, (_, col) => String(Math.floor(col / 10))).join("");
	const units = Array.from({ length: 15 }, (_, col) => String(col % 10)).join("");
	const lines = [`  ${tens}`, `  ${units}`];
	for (let row = 0; row < 15; row += 1) {
		let line = String(row).padStart(2);
		for (let col = 0; col < 15; col += 1) {
			const cell = board[row * 15 + col];
			line += cell === 1 ? "B" : cell === 2 ? "W" : "·";
		}
		lines.push(line);
	}
	return lines.join("\n");
}
/** Tolerant extraction of the JSON object region from a model reply (first `{` … last `}`). */
function jsonObjectRegion(text) {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) return void 0;
	return text.slice(start, end + 1);
}
/**
* Parse and shape-check one model reply into a {@link MoveReply}. The reply
* may wrap the JSON in prose or a code fence (models do), so the object
* region is extracted before parsing; the move coordinates themselves are
* still strictly validated here.
* @param text - the assembled model reply text.
* @returns the parsed reply.
*/
function parseMoveReply(text) {
	const region = jsonObjectRegion(text);
	if (region === void 0) return {
		kind: "invalid",
		reason: "回复中没有 JSON 对象"
	};
	let parsed;
	try {
		parsed = JSON.parse(region);
	} catch {
		return {
			kind: "invalid",
			reason: "回复中的 JSON 无法解析"
		};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {
		kind: "invalid",
		reason: "回复不是 JSON 对象"
	};
	const value = parsed;
	const error = value.error;
	if (typeof error === "string") return {
		kind: "error",
		message: error
	};
	if (value.draw === true) return { kind: "draw" };
	const move = value.move;
	if (Array.isArray(move) && move.length === 2 && Number.isInteger(move[0]) && Number.isInteger(move[1]) && typeof move[0] === "number" && typeof move[1] === "number") {
		const row = move[0];
		const col = move[1];
		if (row < 0 || row >= 15 || col < 0 || col >= 15) return {
			kind: "invalid",
			reason: `落子坐标越界：[${row}, ${col}]`
		};
		return {
			kind: "move",
			row,
			col
		};
	}
	return {
		kind: "invalid",
		reason: "缺少合法的 move 字段（应为 [row, col] 整数坐标）"
	};
}
/** Translate a terminal finish reason into a move failure. */
function finishError(finish) {
	switch (finish.kind) {
		case "stop": return;
		case "error":
		case "aborted": {
			const error = new Error(finish.failure.message);
			error.code = finish.failure.code;
			return error;
		}
		case "max-tokens": return /* @__PURE__ */ new Error("gomoku: AI 回复超过最大输出长度");
		case "tool-calls": return /* @__PURE__ */ new Error("gomoku: AI 意外请求了工具调用");
		/* v8 ignore next -- closed-union exhaustiveness guard */
		default: return /* @__PURE__ */ new Error(`gomoku: unsupported finish reason "${String(finish.kind)}"`);
	}
}
/**
* Failure codes the move loop treats as transient, mirroring the harness's
* default provider retry policy (dsh-llm retry-policy.ts): a stream that
* dropped mid-response (e.g. pi-ai's "Stream ended without finish_reason") or
* a transient provider failure deserves one more attempt before the move
* request gives up. Auth, validation, and cancellation failures stay fatal.
*/
const RETRYABLE_MOVE_FAILURE_CODES = /* @__PURE__ */ new Set([
	"EMPTY_RESPONSE",
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
/**
* Whether a thrown move-stream failure is transient and worth one retry.
* @param error - the error thrown by {@link streamMoveText}.
* @returns true when the failure carries one of the retryable codes.
*/
function isRetryableMoveFailure(error) {
	const code = error?.code;
	return typeof code === "string" && RETRYABLE_MOVE_FAILURE_CODES.has(code);
}
/** First backoff step between failed move attempts, in milliseconds. */
const RETRY_BASE_DELAY_MS = 500;
/** Backoff cap between failed move attempts, in milliseconds. */
const RETRY_MAX_DELAY_MS = 8e3;
/**
* Exponential backoff before retrying a failed attempt. Retrying a rate limit
* or a dropped stream immediately just burns the remaining attempts against
* the same limit; a short capped backoff lets the provider recover.
* @param attempt - the failed 1-based attempt number.
* @returns the local delay in milliseconds.
*/
function retryDelayMs(attempt) {
	return Math.min(500 * 2 ** Math.max(0, attempt - 1), RETRY_MAX_DELAY_MS);
}
/** Backoff with ±20% jitter, so parallel games do not retry in lockstep. */
function jitteredDelayMs(attempt) {
	return Math.round(retryDelayMs(attempt) * (.8 + Math.random() * .4));
}
/** Sleep that rejects as soon as the move is aborted (timeout / disconnect). */
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const fail = () => {
			clearTimeout(timer);
			reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("gomoku: 落子请求已取消"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", fail);
			resolve();
		}, ms);
		if (signal.aborted) {
			clearTimeout(timer);
			reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("gomoku: 落子请求已取消"));
			return;
		}
		signal.addEventListener("abort", fail, { once: true });
	});
}
/** How long one provider's model capabilities are trusted before a refresh. */
const MODEL_INFO_TTL_MS = 3e5;
/** Provider/model capability cache, so a move does not pay a lookup roundtrip. */
const modelInfoCache = /* @__PURE__ */ new Map();
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
async function cachedModelInfo(ctx, provider, model, signal) {
	const key = provider + "/" + model;
	const cached = modelInfoCache.get(key);
	if (cached !== void 0 && Date.now() - cached.at < MODEL_INFO_TTL_MS) return cached.info;
	const info = await ctx.llm.resolveModelInfo(provider, model, signal);
	modelInfoCache.set(key, {
		at: Date.now(),
		info
	});
	return info;
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
* @returns the assembled reply text, the reasoning text, and the truncation flag.
* @throws when the stream fails or the model produced no text at all.
*/
async function streamMoveText(ctx, request, system, user, maxTokens, signal) {
	if (request.provider === "gomoku-jev") return requestJevMove(request.board, request.side, system, request.jevApiKey, signal);
	const info = await cachedModelInfo(ctx, request.provider, request.model, signal);
	let reasoningEffort;
	if (request.thinking !== void 0 && info.reasoning?.efforts.some((effort) => effort.id === request.thinking)) reasoningEffort = ReasoningEffortId(request.thinking);
	const budget = info.defaultMaxTokens !== void 0 ? Math.min(maxTokens, info.defaultMaxTokens) : maxTokens;
	const options = {
		provider: request.provider,
		model: request.model,
		messages: [user],
		system,
		maxTokens: budget,
		signal,
		...reasoningEffort !== void 0 ? { reasoningEffort } : {}
	};
	const assembler = new BlockAssembler();
	for await (const chunk of ctx.llm.stream(options)) {
		signal.throwIfAborted();
		assembler.push(chunk);
	}
	signal.throwIfAborted();
	const truncated = assembler.finish.kind === "max-tokens";
	const terminal = finishError(assembler.finish);
	if (terminal !== void 0 && !truncated) throw terminal;
	const blocks = assembler.blocks();
	const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim();
	if (text.length === 0 && !truncated) throw new Error("gomoku: AI 没有返回任何内容");
	return {
		text,
		reasoning: blocks.filter((block) => block.type === "reasoning").map((block) => block.text).join(" ").trim(),
		truncated,
		maxTokens: budget,
		...assembler.usage !== void 0 ? { usage: assembler.usage } : {}
	};
}
/**
* Validate an untrusted move-request body into a typed request.
* @param value - the parsed request body.
* @returns the validated request.
* @throws {Error} with a user-readable reason on the first invalid field.
*/
function validateMoveRequest(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("请求体必须是 JSON 对象");
	const candidate = value;
	if (typeof candidate.provider !== "string" || candidate.provider.length === 0) throw new Error("provider 必须是非空字符串");
	if (typeof candidate.model !== "string" || candidate.model.length === 0) throw new Error("model 必须是非空字符串");
	if (candidate.provider === "gomoku-jev") {
		if (candidate.model !== "jev-latest") throw new Error("不支持的 Jev 模型");
		if (!isValidJevApiKey(candidate.jevApiKey)) throw new Error("请先设置有效的 Jev API Key");
	} else if (candidate.jevApiKey !== void 0) throw new Error("Jev API Key 只能用于 Jev 模型");
	if (candidate.side !== "black" && candidate.side !== "white") throw new Error("side 必须是 \"black\" 或 \"white\"");
	if (candidate.thinking !== void 0 && (typeof candidate.thinking !== "string" || candidate.thinking.length === 0 || candidate.thinking.length > 64)) throw new Error("thinking 必须是模型原生思考强度 id（非空字符串）");
	if (candidate.moveTimeoutMs !== void 0 && (typeof candidate.moveTimeoutMs !== "number" || !Number.isInteger(candidate.moveTimeoutMs) || candidate.moveTimeoutMs < 1e3)) throw new Error("moveTimeoutMs 必须是 >= 1000 的整数毫秒数");
	if (candidate.maxMoveOutputTokens !== void 0 && (typeof candidate.maxMoveOutputTokens !== "number" || !Number.isInteger(candidate.maxMoveOutputTokens) || candidate.maxMoveOutputTokens < 8)) throw new Error("maxMoveOutputTokens 必须是 >= 8 的整数");
	const board = candidate.board;
	if (!Array.isArray(board) || board.length !== 225 || board.some((cell) => cell !== 0 && cell !== 1 && cell !== 2)) throw new Error(`board 必须是 225 个 0/1/2 组成的数组`);
	const system = candidate.system;
	if (system !== void 0 && typeof system !== "string") throw new Error("system 必须是字符串");
	return {
		provider: candidate.provider,
		model: candidate.model,
		side: candidate.side,
		board,
		...candidate.provider === "gomoku-jev" ? { jevApiKey: candidate.jevApiKey.trim() } : {},
		...typeof system === "string" ? { system } : {},
		...candidate.thinking !== void 0 ? { thinking: candidate.thinking } : {},
		...candidate.moveTimeoutMs !== void 0 ? { moveTimeoutMs: candidate.moveTimeoutMs } : {},
		...candidate.maxMoveOutputTokens !== void 0 ? { maxMoveOutputTokens: candidate.maxMoveOutputTokens } : {}
	};
}
/** Frame the user message for one move attempt (board + side + optional corrective feedback). */
function buildMoveUserMessage(request, previous, reason) {
	const sideLabel = request.side === "black" ? "黑方" : "白方";
	const lines = [
		`你执${sideLabel}。当前棋盘（黑=B，白=W，空=·；上方两行是列号的十位与个位，左侧是行号）：`,
		boardText(request.board),
		`轮到你（${sideLabel}）落子。请只返回合法的 JSON 落子。`
	];
	lines.push("", "# 威胁提示（程序判定，仅作参考，不强制落子）", threatHintText(analyzeThreats(request.board, request.side), request.side));
	if (previous !== void 0 && reason !== void 0) {
		lines.push("", `警告：你上一次的返回不合法（${reason}），完整输出如下：`, previous);
		lines.push("你的上一次落子已被拒绝。请重新观察棋盘，选择另一个未被占用的空交叉点，不要输出任何思考过程或解释，只返回一个合法的 JSON 对象。");
	}
	return {
		role: "user",
		content: [{
			type: "text",
			text: lines.join("\n")
		}]
	};
}
/**
* Mount the gomoku plugin: the three routes plus the move-request lifecycle.
* @param ctx - host cordis context.
* @param config - validated loader configuration.
*/
function apply(ctx, config) {
	const resolved = {
		moveTimeoutMs: config.moveTimeoutMs,
		maxMoveOutputTokens: config.maxMoveOutputTokens,
		maxMoveAttempts: config.maxMoveAttempts
	};
	/** How many finished moves the diagnostics ring keeps. */
	const MOVE_LOG_LIMIT = 40;
	/** Finished moves of this plugin instance, newest last. */
	const moveLog = [];
	/** Collect the request body into a parsed JSON value. */
	const readJson = async (req) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const raw = Buffer.concat(chunks).toString("utf8");
		if (raw.length === 0) return {};
		return JSON.parse(raw);
	};
	ctx.effect(() => {
		const dispose = ctx.webServer.register({
			kind: "prefix",
			path: GOMOKU_PATH,
			handler: async (req, res) => {
				const writeJson = (status, body) => {
					if (res.writableEnded || res.destroyed) return;
					res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify(body));
				};
				try {
					const url = new URL(req.url ?? "/", "http://dsh.internal");
					const segments = url.pathname.slice(15).split("/").filter(Boolean);
					if (req.method === "GET" && segments.length === 1 && segments[0] === "prompt") {
						writeJson(200, { prompt: DEFAULT_SYSTEM_PROMPT });
						return;
					}
					if (req.method === "GET" && segments.length === 1 && segments[0] === "efforts") {
						const provider = url.searchParams.get("provider") ?? "";
						const model = url.searchParams.get("model") ?? "";
						if (provider.length === 0 || model.length === 0) {
							writeJson(400, { error: "provider 与 model 必填" });
							return;
						}
						if (provider === "gomoku-jev") {
							writeJson(200, { efforts: [] });
							return;
						}
						try {
							const reasoning = (await cachedModelInfo(ctx, provider, model, new AbortController().signal)).reasoning;
							writeJson(200, {
								efforts: (reasoning?.efforts ?? []).map((effort) => ({
									id: effort.id,
									name: effort.name
								})),
								...reasoning?.defaultEffort !== void 0 ? { default: reasoning.defaultEffort } : {}
							});
						} catch (error) {
							writeJson(200, {
								efforts: [],
								error: error instanceof Error ? error.message : String(error)
							});
						}
						return;
					}
					if (req.method === "GET" && segments.length === 1 && segments[0] === "log") {
						writeJson(200, { entries: moveLog });
						return;
					}
					if (req.method === "GET" && segments.length === 1 && segments[0] === "models") {
						const groups = [];
						const failures = [];
						for (const provider of ctx.llm.listProviders()) {
							let models;
							try {
								models = await ctx.llm.listModels(provider.id);
							} catch (error) {
								failures.push({
									provider: provider.id,
									error: error instanceof Error ? error.message : String(error)
								});
								continue;
							}
							groups.push({
								provider: provider.id,
								displayName: provider.name,
								models: models.map((model) => ({
									id: model.id,
									name: model.name
								}))
							});
						}
						groups.push({
							provider: JEV_PROVIDER,
							displayName: "Jev · TypeSafe",
							models: [{
								id: JEV_MODEL,
								name: "Jev"
							}]
						});
						writeJson(200, {
							groups,
							failures
						});
						return;
					}
					if (req.method === "POST" && segments.length === 1 && segments[0] === "move") {
						const request = validateMoveRequest(await readJson(req));
						const effectiveTimeoutMs = Math.min(request.moveTimeoutMs ?? resolved.moveTimeoutMs, resolved.moveTimeoutMs);
						const effectiveMaxTokens = Math.min(request.maxMoveOutputTokens ?? resolved.maxMoveOutputTokens, resolved.maxMoveOutputTokens);
						const startedAt = Date.now();
						const elapsed = () => Date.now() - startedAt;
						const controller = new AbortController();
						const timer = setTimeout(() => {
							controller.abort(/* @__PURE__ */ new Error("gomoku: AI 落子超时"));
						}, effectiveTimeoutMs);
						const onResponseClose = () => {
							if (!res.writableFinished) controller.abort(/* @__PURE__ */ new Error("gomoku: 客户端已断开"));
						};
						res.on("close", onResponseClose);
						/** Record one settled move in the diagnostics ring and the logger. */
						const settle = (outcome, attempts, detail, attemptText) => {
							const usage = attemptText?.usage;
							moveLog.push({
								time: (/* @__PURE__ */ new Date()).toISOString(),
								side: request.side,
								provider: request.provider,
								model: request.model,
								attempts,
								durationMs: elapsed(),
								outcome,
								...detail !== void 0 ? { detail } : {},
								...usage !== void 0 ? { usage } : {},
								...attemptText?.maxTokens !== void 0 ? { maxTokens: attemptText.maxTokens } : {}
							});
							if (moveLog.length > MOVE_LOG_LIMIT) moveLog.splice(0, moveLog.length - MOVE_LOG_LIMIT);
							ctx.logger.info("gomoku: %s move via %s/%s took %dms over %d attempt(s)%s: %s", request.side, request.provider, request.model, elapsed(), attempts, usage !== void 0 ? `, tokens in/out ${usage.inputTokens}/${usage.outputTokens}${usage.reasoningTokens !== void 0 ? " (reasoning " + usage.reasoningTokens + ")" : ""}` : "", outcome);
						};
						/** Token fields every response carries when the provider reported them. */
						const telemetry = (attemptText) => ({
							...attemptText?.usage !== void 0 ? { usage: attemptText.usage } : {},
							...attemptText?.maxTokens !== void 0 ? { maxTokens: attemptText.maxTokens } : {}
						});
						try {
							const system = request.system !== void 0 && request.system.trim().length > 0 ? request.system : DEFAULT_SYSTEM_PROMPT;
							let lastText;
							let lastReason;
							let lastReasoning = "";
							let attemptsUsed = 0;
							let lastAttempt;
							for (let attempt = 1; attempt <= resolved.maxMoveAttempts; attempt += 1) {
								attemptsUsed = attempt;
								const user = buildMoveUserMessage(request, lastText, lastReason);
								let attemptText;
								try {
									attemptText = await streamMoveText(ctx, request, system, user, effectiveMaxTokens, controller.signal);
								} catch (error) {
									if (!isRetryableMoveFailure(error)) throw error;
									lastText = void 0;
									lastReason = error instanceof Error ? error.message : String(error);
									lastReasoning = "";
									ctx.logger.warn("gomoku: transient AI move failure (attempt %d/%d): %s", attempt, resolved.maxMoveAttempts, lastReason);
									if (attempt < resolved.maxMoveAttempts) {
										await sleep(jitteredDelayMs(attempt), controller.signal);
										continue;
									}
									break;
								}
								const text = attemptText.text;
								lastAttempt = attemptText;
								lastReasoning = attemptText.reasoning;
								const reply = parseMoveReply(text);
								if (reply.kind === "move") {
									if (!isLegalMove(request.board, reply.row, reply.col)) {
										lastText = text;
										lastReason = `目标交叉点 [${reply.row}, ${reply.col}] 已被占用或越界`;
										if (attempt < resolved.maxMoveAttempts) await sleep(jitteredDelayMs(attempt), controller.signal);
										continue;
									}
									settle("move " + reply.row + "," + reply.col, attempt, void 0, attemptText);
									writeJson(200, {
										move: {
											row: reply.row,
											col: reply.col
										},
										reasoning: lastReasoning,
										durationMs: elapsed(),
										attempts: attempt,
										...telemetry(attemptText)
									});
									return;
								}
								if (reply.kind === "draw") {
									settle("draw", attempt, void 0, attemptText);
									writeJson(200, {
										draw: true,
										reasoning: lastReasoning,
										durationMs: elapsed(),
										attempts: attempt,
										...telemetry(attemptText)
									});
									return;
								}
								if (reply.kind === "error") {
									settle("ai-error: " + reply.message, attempt, reply.message, attemptText);
									writeJson(200, {
										error: `AI 报告：${reply.message}`,
										reasoning: lastReasoning,
										durationMs: elapsed(),
										attempts: attempt,
										...telemetry(attemptText)
									});
									return;
								}
								lastText = text;
								lastReason = attemptText.truncated ? "AI 回复被截断（超过最大输出长度），可能未输出完整的 JSON" : reply.reason;
								if (attempt < resolved.maxMoveAttempts) await sleep(jitteredDelayMs(attempt), controller.signal);
							}
							settle("failed: " + (lastReason ?? "unknown"), attemptsUsed, lastReason, lastAttempt);
							writeJson(200, {
								error: `AI 连续 ${resolved.maxMoveAttempts} 次未能完成落子（最后原因：${lastReason ?? "未知"}）`,
								reasoning: lastReasoning,
								durationMs: elapsed(),
								attempts: attemptsUsed,
								...telemetry(lastAttempt)
							});
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							settle("aborted: " + message, 0, message);
							throw error;
						} finally {
							clearTimeout(timer);
							res.off("close", onResponseClose);
						}
						return;
					}
					writeJson(404, { error: "unknown gomoku route" });
				} catch (error) {
					writeJson(400, { error: error instanceof Error ? error.message : String(error) });
				}
			}
		});
		return () => {
			modelInfoCache.clear();
			dispose();
		};
	}, "gomoku: routes + move lifecycle");
}
export { BLACK, BOARD_SIZE, Config, DEFAULT_SYSTEM_PROMPT, EMPTY, GOMOKU_PATH, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, WHITE, apply, boardText, buildMoveUserMessage, inject, isLegalMove, isRetryableMoveFailure, name, parseMoveReply, retryDelayMs, validateMoveRequest };
