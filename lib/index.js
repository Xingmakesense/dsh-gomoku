import z from "@deepseek-ai/schemastery";
import { BlockAssembler, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
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
	moveTimeoutMs: z.number().step(1).min(1e3).default(3e6),
	maxMoveOutputTokens: z.number().step(1).min(8).default(32e3),
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
	"2. 对手成五：对手 4 子的成五点 → 必须封堵；若对手活四无法单点封堵，则改走己方最快取胜点。",
	"3. 己方强攻：能形成活四、冲四或「四三」的点优先；冲四可迫使对手应手，为下一手争取先手。",
	"4. 对手活三：立即封堵其一端；若一子能同时封堵两个威胁（双防点），优先选双防点。",
	"5. 己方活三/双活三：无紧急威胁时，选择能形成活三、双活三或多方向连线的点。",
	"6. 布局：靠近天元与双方已有棋群，保持连线；避免边角、孤立与没有后续的落点。",
	"",
	"# 术语",
	"活三＝3 连且两端可延伸（下一步可成活四）；冲四＝4 连且仅一端可成五；活四＝两端均可成五、无法单点封堵；双活三/四三＝一子同时形成两个活三 / 冲四加活三，均为强杀。",
	"",
	"# 候选比较（最多评估 6 个点）",
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
	const lines = [];
	lines.push(`   ${Array.from({ length: 15 }, (_, col) => String(col).padStart(3)).join("")}`);
	for (let row = 0; row < 15; row += 1) {
		let line = `${String(row).padStart(2)} `;
		for (let col = 0; col < 15; col += 1) {
			const cell = board[row * 15 + col];
			line += `  ${cell === 1 ? "B" : cell === 2 ? "W" : "·"}`;
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
	let reasoningEffort;
	if (request.thinking !== void 0) {
		if ((await ctx.llm.resolveModelInfo(request.provider, request.model, signal)).reasoning?.efforts.some((effort) => effort.id === request.thinking)) reasoningEffort = ReasoningEffortId(request.thinking);
	}
	const options = {
		provider: request.provider,
		model: request.model,
		messages: [user],
		system,
		maxTokens,
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
		truncated
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
	if (candidate.thinking !== void 0 && candidate.thinking !== "off" && candidate.thinking !== "high" && candidate.thinking !== "max") throw new Error("thinking 必须是 \"off\"、\"high\" 或 \"max\"");
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
		`你执${sideLabel}。当前棋盘（黑=B，白=W，空=·）：`,
		boardText(request.board),
		`轮到你（${sideLabel}）落子。请只返回合法的 JSON 落子。`
	];
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
					res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify(body));
				};
				try {
					const segments = new URL(req.url ?? "/", "http://dsh.internal").pathname.slice(15).split("/").filter(Boolean);
					if (req.method === "GET" && segments.length === 1 && segments[0] === "prompt") {
						writeJson(200, { prompt: DEFAULT_SYSTEM_PROMPT });
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
						const effectiveTimeoutMs = request.moveTimeoutMs ?? resolved.moveTimeoutMs;
						const effectiveMaxTokens = request.maxMoveOutputTokens ?? resolved.maxMoveOutputTokens;
						const controller = new AbortController();
						const timer = setTimeout(() => {
							controller.abort(/* @__PURE__ */ new Error("gomoku: AI 落子超时"));
						}, effectiveTimeoutMs);
						try {
							const system = request.system !== void 0 && request.system.trim().length > 0 ? request.system : DEFAULT_SYSTEM_PROMPT;
							let lastText;
							let lastReason;
							let lastReasoning = "";
							for (let attempt = 1; attempt <= resolved.maxMoveAttempts; attempt += 1) {
								const user = buildMoveUserMessage(request, lastText, lastReason);
								let attemptText;
								try {
									attemptText = await streamMoveText(ctx, request, system, user, effectiveMaxTokens, controller.signal);
								} catch (error) {
									if (!isRetryableMoveFailure(error)) throw error;
									lastText = void 0;
									lastReason = error instanceof Error ? error.message : String(error);
									lastReasoning = "";
									ctx.logger.warn("gomoku: transient AI move failure: %s", lastReason);
									if (attempt < resolved.maxMoveAttempts) continue;
									break;
								}
								const text = attemptText.text;
								lastReasoning = attemptText.reasoning;
								const reply = parseMoveReply(text);
								if (reply.kind === "move") {
									if (!isLegalMove(request.board, reply.row, reply.col)) {
										lastText = text;
										lastReason = `目标交叉点 [${reply.row}, ${reply.col}] 已被占用或越界`;
										continue;
									}
									writeJson(200, {
										move: {
											row: reply.row,
											col: reply.col
										},
										reasoning: lastReasoning
									});
									return;
								}
								if (reply.kind === "draw") {
									writeJson(200, {
										draw: true,
										reasoning: lastReasoning
									});
									return;
								}
								if (reply.kind === "error") {
									writeJson(200, {
										error: `AI 报告：${reply.message}`,
										reasoning: lastReasoning
									});
									return;
								}
								lastText = text;
								lastReason = attemptText.truncated ? "AI 回复被截断（超过最大输出长度），可能未输出完整的 JSON" : reply.reason;
							}
							writeJson(200, {
								error: `AI 连续 ${resolved.maxMoveAttempts} 次未能完成落子（最后原因：${lastReason ?? "未知"}）`,
								reasoning: lastReasoning
							});
						} finally {
							clearTimeout(timer);
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
			dispose();
		};
	}, "gomoku: routes + move lifecycle");
}
export { BLACK, BOARD_SIZE, Config, DEFAULT_SYSTEM_PROMPT, EMPTY, GOMOKU_PATH, WHITE, apply, boardText, buildMoveUserMessage, inject, isLegalMove, isRetryableMoveFailure, name, parseMoveReply, validateMoveRequest };
