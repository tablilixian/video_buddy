window.__ModuleLoader__.load({
	id: "canvas-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/asset-capture.ts
		/** 画布媒体工具名 → 产物类型。 */
		const STUDIO_TOOL_KINDS = {
			image_generate: "image",
			video_generate: "video",
			video_composite: "video",
			style_transfer: "image",
			storyboard_generate: "image"
		};
		/** 判断工具名是否属于画布媒体工具。 */
		function isStudioTool(name) {
			return Object.prototype.hasOwnProperty.call(STUDIO_TOOL_KINDS, name);
		}
		/**
		* P7 工作流工具：结果会改变审批门禁状态 / 落分镜表节点 / 弹出点选问题。
		* 它们不产生媒体产物（不放占位节点），但 tool/call 与 tool/result 后客户端
		* 必须刷新工作流状态与画布，否则审批条与点选卡片永远不出现。
		*/
		const WORKFLOW_TOOLS = /* @__PURE__ */ new Set(["submit_storyboard_for_approval", "ask_user_choice"]);
		/** 从 tool/call 的 arguments 字段解析出参考图 URL（video 工具的 imageUrl）。 */
		function sourceUrlFromArguments(value) {
			if (value === void 0 || value === null) return void 0;
			let parsed = value;
			if (typeof value === "string") try {
				parsed = JSON.parse(value);
			} catch {
				return;
			}
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void 0;
			const imageUrl = parsed.imageUrl;
			return typeof imageUrl === "string" && imageUrl.length > 0 ? imageUrl : void 0;
		}
		/**
		* 创建 P4 的 conversationEvents 节点 definition。
		* @param hooks - 与画布 store 的接线（React 之外）。
		* @returns 节点 definition，供 `ctx.conversationEvents.register` 注册。
		*/
		function createAssetCaptureDefinition(hooks) {
			const onToolCall = hooks.onToolCall ?? (() => {});
			const onToolError = hooks.onToolError ?? (() => {});
			const onToolFinished = hooks.onToolFinished ?? (() => {});
			const onWorkflowToolStarted = hooks.onWorkflowToolStarted ?? (() => {});
			const match = (event) => {
				if (event.type === "tool/call") {
					const data = event.data;
					if (isStudioTool(data.name) || WORKFLOW_TOOLS.has(data.name)) return {
						id: String(data.callId),
						role: "start"
					};
					return null;
				}
				if (event.type === "tool/result") {
					const source = event.data.message.source;
					return {
						id: String(source.callId),
						role: "update"
					};
				}
				return null;
			};
			return {
				kind: "canvas-studio-asset",
				target: "chat",
				match,
				start: (_context, startMatch) => {
					const data = startMatch.event.data;
					const toolName = data.name;
					const rawArguments = typeof data.arguments === "string" ? data.arguments : "";
					const kind = WORKFLOW_TOOLS.has(toolName) ? "workflow" : STUDIO_TOOL_KINDS[toolName];
					if (kind === "workflow") {
						const projectId = hooks.getSelectedProjectId();
						if (projectId !== null) onWorkflowToolStarted(projectId, toolName);
					} else {
						const projectId = hooks.getSelectedProjectId();
						if (projectId !== null) onToolCall(projectId, {
							toolName,
							runId: String(data.callId),
							kind,
							arguments: rawArguments
						});
					}
					return {
						toolName,
						sourceUrl: sourceUrlFromArguments(data.arguments) ?? "",
						kind
					};
				},
				update: (context, updateMatch) => {
					const state = context.state;
					const projectId = hooks.getSelectedProjectId();
					if (updateMatch.event.type === "tool/result" && projectId !== null) {
						if (state.kind === "workflow") {
							onToolFinished(projectId, state.toolName);
							return state;
						}
						const data = updateMatch.event.data;
						if (data.error !== void 0) {
							const error = data.error;
							const message = typeof error === "string" ? error : error !== null && typeof error === "object" && typeof error.message === "string" ? error.message : "生成失败";
							onToolError(projectId, String(data.message.source.callId), message);
						} else hooks.reloadCanvas(projectId);
					}
					return state;
				},
				buildViewNode: () => null
			};
		}
		//#endregion
		//#region src/contracts/project.ts
		/** 旧记录 / 新建项目的默认工作流。 */
		const WORKFLOW_DEFAULT = {
			mode: "confirm",
			state: "drafting"
		};
		/**
		* Leniently coerce an unknown parsed workflow into a safe value; invalid or
		* missing fields degrade to their defaults (registry records may predate P7).
		*/
		function normalizeWorkflow(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return { ...WORKFLOW_DEFAULT };
			const record = value;
			const workflow = {
				mode: record.mode === "auto" ? "auto" : "confirm",
				state: record.state === "awaiting_approval" || record.state === "executing" ? record.state : "drafting"
			};
			const pending = record.pendingQuestion;
			if (pending !== null && pending !== void 0 && typeof pending === "object" && !Array.isArray(pending)) {
				const question = pending;
				workflow.pendingQuestion = {
					id: typeof question.id === "string" ? question.id : "",
					question: typeof question.question === "string" ? question.question : "",
					options: Array.isArray(question.options) ? question.options.map(String) : [],
					...question.allowFreeText === true ? { allowFreeText: true } : {},
					...typeof question.answer === "string" ? { answer: question.answer } : {}
				};
			}
			return workflow;
		}
		//#endregion
		//#region src/contracts/canvas.ts
		/** Viewport defaults used when a document predates v3 or a field is invalid. */
		const VIEW_DEFAULTS = {
			x: 0,
			y: 0,
			scale: 1,
			layersOpen: false,
			minimapVisible: false
		};
		/**
		* CV-023/025：用户首条创意节点的 toolName 标记。客户端（幂等去重）与 Host
		* （分镜/文案节点自动挂接创意血缘、落位）共用同一常量。
		*/
		const BRIEF_NODE_TOOL = "user_brief";
		//#endregion
		//#region src/canvas-view.ts
		/** Zoom clamp range (matches the surface wheel/zoom clamp). */
		const MIN_VIEW_SCALE = .1;
		/** Clamp a zoom factor into the supported range. */
		function clampViewScale(scale) {
			return Math.min(5, Math.max(MIN_VIEW_SCALE, scale));
		}
		/**
		* Coerce an unknown parsed `view` value into a safe viewport. Returns
		* `undefined` when the value is absent or not an object, so callers can
		* distinguish "no saved view" (fit content instead) from a default one.
		* Invalid individual fields fall back to their defaults; scale is clamped.
		*/
		function normalizeCanvasView(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return void 0;
			const raw = value;
			const numberOr = (candidate, fallback) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
			const boolOr = (candidate, fallback) => typeof candidate === "boolean" ? candidate : fallback;
			const timeline = Array.isArray(raw.timeline) && raw.timeline.every((id) => typeof id === "string") ? raw.timeline : void 0;
			return {
				x: numberOr(raw.x, VIEW_DEFAULTS.x),
				y: numberOr(raw.y, VIEW_DEFAULTS.y),
				scale: clampViewScale(numberOr(raw.scale, VIEW_DEFAULTS.scale)),
				layersOpen: boolOr(raw.layersOpen, VIEW_DEFAULTS.layersOpen),
				minimapVisible: boolOr(raw.minimapVisible, VIEW_DEFAULTS.minimapVisible),
				...timeline !== void 0 ? { timeline } : {}
			};
		}
		/**
		* P9.1 时间轴的有效顺序：优先持久化的 `timeline`（自动剔除已删除的节点 id），
		* 没入过列的节点（新建/旧文档）按 createdAt 追加在后。纯函数 —— Host 单测
		* 可直接跑，客户端渲染与 compose 的 clipIds 都以它为准。
		*/
		function deriveTimelineOrder(nodes, timeline) {
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const ordered = [];
			const seen = /* @__PURE__ */ new Set();
			if (timeline !== void 0) for (const id of timeline) {
				if (seen.has(id)) continue;
				const node = byId.get(id);
				if (node !== void 0) {
					ordered.push(node);
					seen.add(id);
				}
			}
			for (const node of [...nodes].sort((left, right) => left.createdAt - right.createdAt)) if (!seen.has(node.id)) {
				ordered.push(node);
				seen.add(node.id);
			}
			return ordered;
		}
		/** Arrange-grid gaps between cells (canvas-space pixels). */
		const ARRANGE_GAP_X = 48;
		const ARRANGE_GAP_Y = 48;
		const ARRANGE_ORIGIN = 40;
		/**
		* Compute the auto-arrange layout: an overlap-free grid over top-level units
		* (nodes without a live parent), ordered by bloodline depth then creation
		* time. Group nodes travel with their children (relative offsets inside the
		* group are preserved), so a group's box keeps wrapping its members and no
		* two boxes can overlap regardless of user-resized sizes.
		* @returns the new canvas-space position per moved node id.
		*/
		function computeArrangeLayout(nodes) {
			const positions = /* @__PURE__ */ new Map();
			if (nodes.length === 0) return positions;
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const depthOf = (node) => {
				let maxDepth = 0;
				const seen = /* @__PURE__ */ new Set([node.id]);
				const queue = [...node.sourceIds, ...node.parentId !== void 0 ? [node.parentId] : []].map((id) => ({
					id,
					depth: 1
				}));
				while (queue.length > 0) {
					const current = queue.shift();
					if (seen.has(current.id)) continue;
					seen.add(current.id);
					maxDepth = Math.max(maxDepth, current.depth);
					const parent = byId.get(current.id);
					if (parent === void 0) continue;
					for (const next of [...parent.sourceIds, ...parent.parentId !== void 0 ? [parent.parentId] : []]) queue.push({
						id: next,
						depth: current.depth + 1
					});
				}
				return maxDepth;
			};
			const units = [];
			const childrenByParent = /* @__PURE__ */ new Map();
			for (const node of nodes) if (node.parentId === void 0 || !byId.has(node.parentId)) units.push({
				node,
				children: [],
				depth: depthOf(node)
			});
			else {
				const siblings = childrenByParent.get(node.parentId) ?? [];
				siblings.push(node);
				childrenByParent.set(node.parentId, siblings);
			}
			for (const unit of units) unit.children = childrenByParent.get(unit.node.id) ?? [];
			units.sort((left, right) => left.depth !== right.depth ? left.depth - right.depth : left.node.createdAt - right.node.createdAt);
			if (units.length === 0) return positions;
			const cellWidth = Math.max(...units.map((unit) => unit.node.width)) + ARRANGE_GAP_X;
			const cellHeight = Math.max(...units.map((unit) => unit.node.height)) + ARRANGE_GAP_Y;
			const columnCursor = /* @__PURE__ */ new Map();
			for (const unit of units) {
				const column = unit.depth;
				const row = columnCursor.get(column) ?? 0;
				columnCursor.set(column, row + 1);
				const targetX = ARRANGE_ORIGIN + column * cellWidth;
				const targetY = ARRANGE_ORIGIN + row * cellHeight;
				const deltaX = targetX - unit.node.x;
				const deltaY = targetY - unit.node.y;
				positions.set(unit.node.id, {
					x: targetX,
					y: targetY
				});
				for (const child of unit.children) positions.set(child.id, {
					x: child.x + deltaX,
					y: child.y + deltaY
				});
			}
			return positions;
		}
		//#endregion
		//#region src/encoding.ts
		/**
		* 通用编码工具（纯函数，不依赖 DOM / Node 专属 API）。
		*
		* 客户端与 Host 端共享：放在 src/ 顶层，不在 src/client/** 内，确保
		* `tsc -p tsconfig.json`（host）会 emit `lib/encoding.js`，便于测试 import。
		* 客户端通过 `client/api.ts` 重新 export 给 React 组件使用。
		*/
		/**
		* 把 `Uint8Array` 编码为标准 base64。
		*
		* 不能用 `File.text() + btoa(unescape(encodeURIComponent(text)))` 这条捷径：
		* `File.text()` 会按 UTF-8 解码二进制，把 0x80–0xFF 的字节替换成 U+FFFD，
		* 导致 PNG/JPEG 头部字节被破坏，落地后再被 `<img>` 加载会触发 `onerror`。
		*
		* 直接走字节，按 32KB 分块避免向 V8 一次性推过多参数。
		*/
		function bytesToBase64(bytes) {
			let binary = "";
			const chunk = 32768;
			for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
			return btoa(binary);
		}
		//#endregion
		//#region src/client/api.ts
		/** HTTP facts used to localize safe Client-facing Studio failures. */
		var StudioApiError = class extends Error {
			status;
			code;
			constructor(message, status, code) {
				super(message);
				this.status = status;
				this.code = code;
				this.name = "StudioApiError";
			}
		};
		async function readJson(response) {
			const value = await response.json();
			if (!response.ok) throw new StudioApiError(typeof value.error === "string" ? value.error : `request failed: ${response.status}`, response.status, typeof value.code === "string" ? value.code : void 0);
			return value;
		}
		/** List all registered projects. */
		async function listStudioProjects(signal) {
			return (await readJson(await fetch("/canvas-studio/projects", {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}))).projects;
		}
		/** Create a project and return its record. */
		async function createStudioProject(name, signal) {
			return (await readJson(await fetch("/canvas-studio/projects", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name }),
				...signal === void 0 ? {} : { signal }
			}))).project;
		}
		/** Delete a project by id (removes its directory and registry record). */
		async function deleteStudioProject(id, signal) {
			await readJson(await fetch("/canvas-studio/projects", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id }),
				...signal === void 0 ? {} : { signal }
			}));
		}
		/** P7：读某项目的创作工作流（模式 + 审批门禁状态），缺失字段降级为默认值。 */
		async function getStudioWorkflow(projectId, signal) {
			return normalizeWorkflow((await readJson(await fetch(`/canvas-studio/workflow?projectId=${encodeURIComponent(projectId)}`, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}))).workflow);
		}
		/** P7：工作流动作（批准 / 驳回 / 切换模式），返回更新后的工作流。 */
		async function postStudioWorkflowAction(projectId, action, mode, signal) {
			return normalizeWorkflow((await readJson(await fetch("/canvas-studio/workflow", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(mode === void 0 ? {
					projectId,
					action
				} : {
					projectId,
					action,
					mode
				}),
				...signal === void 0 ? {} : { signal }
			}))).workflow);
		}
		/** P7 点选式澄清：提交用户对当前问题的选择，返回更新后的工作流（问题已带答案）。 */
		async function answerStudioQuestion(projectId, value, signal) {
			return normalizeWorkflow((await readJson(await fetch("/canvas-studio/workflow", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId,
					action: "answer",
					value
				}),
				...signal === void 0 ? {} : { signal }
			}))).workflow);
		}
		/**
		* 把历史节点里写死的 `http://127.0.0.1:<port>/canvas-studio/...` 绝对 URL 归一化为
		* 同源相对路径。渲染进程与 webServer 同源，相对 URL 自动解析到当前端口，桌面重启
		* 换端口也不会 404（早期版本把端口写死在 URL 里，换端口后已有产物会失效）。
		*/
		function normalizeCanvasNodes(nodes) {
			return nodes.map((node) => {
				if (typeof node.url !== "string") return node;
				const rewritten = node.url.replace(/^https?:\/\/127\.0\.0\.1:\d+(\/canvas-studio\/.*)$/, "$1");
				return rewritten === node.url ? node : {
					...node,
					url: rewritten
				};
			});
		}
		/** Load a project's persisted canvas (nodes + viewport; view is null pre-v3). */
		async function loadStudioCanvas(projectId, signal) {
			const response = await readJson(await fetch(`/canvas-studio/canvas?projectId=${encodeURIComponent(projectId)}`, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
			return {
				nodes: normalizeCanvasNodes(response.nodes),
				view: normalizeCanvasView(response.view) ?? null
			};
		}
		/** P8.1：本地图片上传（base64）→ 返回同源 URL + Drama filename（供生成工具引用）。 */
		async function uploadLocalStudioImage(projectId, name, dataBase64, signal) {
			return await readJson(await fetch("/canvas-studio/upload", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId,
					name,
					dataBase64
				}),
				...signal === void 0 ? {} : { signal }
			}));
		}
		/**
		* P8.4：本地参考视频上传（原始字节流，免 base64 膨胀）→ Host 抽帧提风格。
		* 返回帧列表（含 Drama filename）与风格归纳文本，由调用方落成画布节点。
		*/
		async function uploadStudioVideo(projectId, file, signal) {
			const query = new URLSearchParams({
				projectId,
				name: file.name
			});
			return readJson(await fetch(`/canvas-studio/upload-video?${query.toString()}`, {
				method: "POST",
				headers: { "content-type": "application/octet-stream" },
				body: file,
				...signal === void 0 ? {} : { signal }
			}));
		}
		/** Persist a project's full canvas node list plus the current viewport state. */
		async function saveStudioCanvas(projectId, nodes, view, signal) {
			await readJson(await fetch("/canvas-studio/canvas", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId,
					nodes,
					view
				}),
				...signal === void 0 ? {} : { signal }
			}));
		}
		/** P9.2/P9.3：合成成片。提交选中的分镜视频 clip id（与可选 BGM 节点 id），返回成片同源 URL + 时长。 */
		async function composeStudioVideo(projectId, clipIds, bgmNodeId, signal) {
			return await readJson(await fetch("/canvas-studio/compose", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(bgmNodeId === void 0 ? {
					projectId,
					clipIds
				} : {
					projectId,
					clipIds,
					bgmNodeId
				}),
				...signal === void 0 ? {} : { signal }
			}));
		}
		/**
		* 解析节点上保存的生成参数（generationPrompt 是原参数 JSON）；无法解析或缺失时
		* 返回 null。重试 / 修改提示词都基于它重放原参数（plan §7.8）。
		*/
		function generationParamsOf(node) {
			if (node.generationPrompt === void 0) return null;
			try {
				const value = JSON.parse(node.generationPrompt);
				if (value === null || typeof value !== "object") return null;
				return value;
			} catch {
				return null;
			}
		}
		/**
		* 节点级重试 / 修改提示词：按原参数（可带 overrides）重新请求 Host 生成，
		* 并把结果写回原节点（retryOf，不产生新边）。成功后返回新的产物 URL。
		*/
		async function retryStudioNode(projectId, node, overrides, signal) {
			if (node.toolName === void 0) throw new Error("节点缺少工具名，无法重试");
			const base = generationParamsOf(node);
			if (base === null) throw new Error("节点缺少可重放的生成参数");
			const params = {
				...base,
				...overrides,
				retryOf: node.id
			};
			return await readJson(await fetch("/canvas-studio/generate", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					tool: node.toolName,
					projectId,
					params
				}),
				...signal === void 0 ? {} : { signal }
			}));
		}
		//#endregion
		//#region src/client/brief-capture.ts
		/** 从消息 content 块提取纯文本正文（无文本块时返回空串）。 */
		function briefTextOf(message) {
			return (message.content ?? []).filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
		}
		/**
		* 创建创意捕获 definition（state-only：start/update 返回 null 状态）。
		* @param hooks - 与画布 store 的接线。
		*/
		function createBriefCaptureDefinition(hooks) {
			return {
				kind: "canvas-studio-brief",
				match(event) {
					if (event.type !== "user/message") return null;
					const message = event.data ?? {};
					if (message.source?.kind !== "user") return null;
					return {
						id: String(message.id ?? ""),
						role: "start"
					};
				},
				start: (_context, startMatch) => {
					const projectId = hooks.getSelectedProjectId();
					if (projectId !== null && !hooks.hasBriefNode(projectId)) {
						const text = briefTextOf(startMatch.event.data ?? {});
						if (text.length > 0) hooks.onBrief(projectId, text);
					}
					return null;
				},
				update: () => null
			};
		}
		//#endregion
		//#region src/client/layout-controller.ts
		/**
		* Studio-owned implementation of the standard panel-action face. The studio
		* frame does not render the sidebar or details columns in P1, so every
		* transition is a no-op until those columns land.
		*/
		var StudioLayoutController = class {
			/** Toggle the sidebar panel (no-op: the studio frame renders no sidebar). */
			toggleSidebar() {}
			/** Open the details panel (no-op: the studio frame renders no details column). */
			openDetails() {}
			/** Close the details panel (no-op: the studio frame renders no details column). */
			closeDetails() {}
		};
		//#endregion
		//#region src/client/project-store.ts
		/**
		* Project + canvas store: the registry snapshot, the current selection
		* (single + multi), per-project canvas node lists, snapshot history
		* (undo/redo), and the clipboard.
		*
		* Reads happen through the framework-bound `useStore`; writes go through the
		* declared actions only (async fetching lives in the apply-world inject
		* callbacks, which commit through these actions). The canvas node list is the
		* full P4+ model: every captured generation result (image/video) or manual
		* annotation (sticky/text/prompt/group) is a node, and bloodline edges are
		* derived from each node's `sourceIds` at render time (plan §7.3).
		*
		* History semantics follow the reference canvas store (snapshot the pre-mutation
		* list, cap 20): atomic actions snapshot first, while drags call `pushHistory`
		* explicitly at drag start (moveNode itself never snapshots — it fires every
		* pointer-move frame). Transient generation state (isLoading/progress/error)
		* lives on client-minted pending nodes and is stripped on reload.
		*/
		/** Snapshot-history cap (reference: MAX_HISTORY = 20). */
		const MAX_HISTORY = 20;
		/** Default rendered box size per node kind (canvas-space pixels). */
		const NODE_SIZE = {
			image: {
				width: 260,
				height: 180
			},
			video: {
				width: 260,
				height: 180
			},
			sticky: {
				width: 220,
				height: 140
			},
			text: {
				width: 220,
				height: 120
			},
			prompt: {
				width: 240,
				height: 120
			},
			group: {
				width: 320,
				height: 220
			}
		};
		/** Auto-layout grid for freshly captured nodes. */
		const LAYOUT = {
			origin: 40,
			stepX: 300,
			stepY: 240,
			columns: 4
		};
		/** Default titles for manually added annotation nodes. */
		const NODE_TITLES = {
			sticky: "便签",
			text: "文本",
			prompt: "提示"
		};
		/** Mint a node id in the browser (secure context over loopback). */
		function newNodeId() {
			const cryptoObj = globalThis.crypto;
			if (cryptoObj !== void 0 && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
			return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		}
		/**
		* 客户端瞬态节点判定：生成中的占位（isLoading / `pending-*` id）以及没有产物
		* URL 的 agent 媒体节点。它们只应存在于内存 —— 持久化前必须剔除，载入时也要
		* 丢弃（否则一次生成中途的保存就会让画布永久残留「黑块」节点）。
		*/
		function isTransientNode(node) {
			return node.isLoading === true || node.id.startsWith("pending-") || (node.kind === "image" || node.kind === "video") && node.url === void 0;
		}
		/** 取某项目的全部节点（未绑定或空时返回空数组）。 */
		function nodesOf(state, projectId) {
			if (projectId === null) return [];
			return state.nodes[projectId] ?? [];
		}
		/** Shared fallback so `viewOf` never allocates (stable snapshot identity). */
		const DEFAULT_VIEW_ENTRY = {
			view: VIEW_DEFAULTS,
			saved: false
		};
		/** 取某项目的视口条目（缺失时回退默认值，`saved: false`）。 */
		function viewOf(state, projectId) {
			if (projectId === null) return DEFAULT_VIEW_ENTRY;
			return state.views[projectId] ?? DEFAULT_VIEW_ENTRY;
		}
		/** 取当前选中的节点。 */
		function selectedNodeOf(state) {
			if (state.selectedNodeId === null || state.selectedProjectId === null) return null;
			return nodesOf(state, state.selectedProjectId).find((node) => node.id === state.selectedNodeId) ?? null;
		}
		/** 渲染序：zIndex 升序，同层按 createdAt 稳定。 */
		function compareNodes(left, right) {
			const leftZ = left.zIndex ?? 0;
			const rightZ = right.zIndex ?? 0;
			if (leftZ !== rightZ) return leftZ - rightZ;
			return left.createdAt - right.createdAt;
		}
		/** 从节点列表里找 union 边界（空表返回 null）。 */
		function boundsOf(nodes) {
			if (nodes.length === 0) return null;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const node of nodes) {
				minX = Math.min(minX, node.x);
				minY = Math.min(minY, node.y);
				maxX = Math.max(maxX, node.x + node.width);
				maxY = Math.max(maxY, node.y + node.height);
			}
			return {
				x: minX,
				y: minY,
				width: maxX - minX,
				height: maxY - minY
			};
		}
		/** 快照当前节点列表进历史（内部实现：先截断 redo 尾部，再压入）。 */
		function snapshotHistory(history, historyIndex, projectId, nodes) {
			const trimmed = history.slice(0, historyIndex + 1);
			trimmed.push({
				projectId,
				nodes: [...nodes]
			});
			return {
				history: trimmed.slice(-20),
				historyIndex: Math.min(trimmed.length - 1, MAX_HISTORY - 1)
			};
		}
		/**
		* Create the project + canvas store handle.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createProjectStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					projects: [],
					selectedProjectId: null,
					selectedNodeId: null,
					selectedNodeIds: [],
					phase: "idle",
					error: null,
					creating: false,
					nodes: {},
					views: {},
					workflows: {},
					history: [],
					historyIndex: -1,
					clipboard: []
				}),
				actions: {
					setPhase: (draft, phase) => {
						draft.phase = phase;
					},
					setLoaded: (draft, projects) => {
						draft.projects = projects;
						draft.phase = "idle";
						draft.error = null;
						if (draft.selectedProjectId !== null && !projects.some((project) => project.id === draft.selectedProjectId)) {
							draft.selectedProjectId = null;
							draft.selectedNodeId = null;
							draft.selectedNodeIds = [];
						}
					},
					setFailed: (draft, error) => {
						draft.phase = "error";
						draft.error = error;
					},
					select: (draft, projectId) => {
						draft.selectedProjectId = projectId;
						draft.selectedNodeId = null;
						draft.selectedNodeIds = [];
					},
					setCreating: (draft, creating) => {
						draft.creating = creating;
					},
					setNodes: (draft, projectId, nodes) => {
						const clean = nodes.filter((node) => !isTransientNode(node)).map((node) => {
							const { isLoading: _isLoading, progress: _progress, error: _error, ...rest } = node;
							return rest;
						});
						draft.nodes = {
							...draft.nodes,
							[projectId]: clean
						};
					},
					setView: (draft, projectId, patch, saved) => {
						const current = draft.views[projectId] ?? {
							view: VIEW_DEFAULTS,
							saved: false
						};
						draft.views = {
							...draft.views,
							[projectId]: {
								view: {
									...current.view,
									...patch,
									scale: clampViewScale(patch.scale ?? current.view.scale)
								},
								saved: saved ?? current.saved
							}
						};
					},
					setWorkflow: (draft, projectId, workflow) => {
						draft.workflows = {
							...draft.workflows,
							[projectId]: workflow
						};
					},
					addAsset: (draft, projectId, asset) => {
						const existing = draft.nodes[projectId] ?? [];
						if (existing.some((candidate) => candidate.url === asset.url)) return;
						const sourceIds = [];
						if (asset.sourceUrl !== void 0) {
							const source = existing.find((candidate) => candidate.url === asset.sourceUrl);
							if (source !== void 0) sourceIds.push(source.id);
						}
						const index = existing.length;
						const size = NODE_SIZE[asset.kind];
						const node = {
							id: newNodeId(),
							kind: asset.kind,
							url: asset.url,
							x: LAYOUT.origin + index % LAYOUT.columns * LAYOUT.stepX,
							y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
							width: size.width,
							height: size.height,
							createdAt: asset.createdAt,
							toolName: asset.toolName,
							runId: asset.runId,
							origin: "agent",
							sourceIds
						};
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, node]
						};
					},
					selectNode: (draft, id, multi = false) => {
						if (multi && id !== null) {
							const roster = new Set(draft.selectedNodeIds);
							if (roster.has(id)) roster.delete(id);
							else roster.add(id);
							draft.selectedNodeIds = [...roster];
							draft.selectedNodeId = roster.size === 1 ? id : null;
						} else {
							draft.selectedNodeIds = id === null ? [] : [id];
							draft.selectedNodeId = id;
						}
					},
					selectAllNodes: (draft) => {
						if (draft.selectedProjectId === null) return;
						const ids = nodesOf(draft, draft.selectedProjectId).map((node) => node.id);
						draft.selectedNodeIds = ids;
						draft.selectedNodeId = ids.length === 1 ? ids[0] : null;
					},
					moveNode: (draft, projectId, id, x, y) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const node = existing.find((candidate) => candidate.id === id);
						if (node === void 0) return;
						const deltaX = x - node.x;
						const deltaY = y - node.y;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((candidate) => candidate.id === id ? {
								...candidate,
								x,
								y
							} : candidate.parentId === id ? {
								...candidate,
								x: candidate.x + deltaX,
								y: candidate.y + deltaY
							} : candidate)
						};
					},
					updateNode: (draft, projectId, id, updates) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => node.id === id ? {
								...node,
								...updates
							} : node)
						};
					},
					removeNodes: (draft, projectId, ids) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0 || ids.length === 0) return;
						const removed = new Set(ids);
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.filter((node) => !removed.has(node.id)).map((node) => {
								const survivors = {
									...node,
									sourceIds: node.sourceIds.filter((sourceId) => !removed.has(sourceId))
								};
								if (node.parentId !== void 0 && removed.has(node.parentId)) {
									const { parentId: _staleParent, ...rest } = survivors;
									return rest;
								}
								return survivors;
							})
						};
						draft.selectedNodeIds = draft.selectedNodeIds.filter((id) => !removed.has(id));
						if (draft.selectedNodeId !== null && removed.has(draft.selectedNodeId)) draft.selectedNodeId = draft.selectedNodeIds.length === 1 ? draft.selectedNodeIds[0] : null;
					},
					pushHistory: (draft, projectId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
					},
					undo: (draft) => {
						if (draft.historyIndex < 0 || draft.historyIndex >= draft.history.length) return;
						const entry = draft.history[draft.historyIndex];
						draft.nodes = {
							...draft.nodes,
							[entry.projectId]: [...entry.nodes]
						};
						draft.historyIndex -= 1;
						draft.selectedNodeId = null;
						draft.selectedNodeIds = [];
					},
					redo: (draft) => {
						const nextIndex = draft.historyIndex + 1;
						if (nextIndex >= draft.history.length) return;
						const entry = draft.history[nextIndex];
						draft.nodes = {
							...draft.nodes,
							[entry.projectId]: [...entry.nodes]
						};
						draft.historyIndex = nextIndex;
						draft.selectedNodeId = null;
						draft.selectedNodeIds = [];
					},
					copySelected: (draft, projectId) => {
						const byId = new Map(nodesOf(draft, projectId).map((node) => [node.id, node]));
						draft.clipboard = draft.selectedNodeIds.map((id) => byId.get(id)).filter((node) => node !== void 0);
					},
					pasteNodes: (draft, projectId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0 || draft.clipboard.length === 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const idMap = /* @__PURE__ */ new Map();
						const pasted = draft.clipboard.map((node) => {
							const newId = newNodeId();
							idMap.set(node.id, newId);
							return {
								...node,
								id: newId,
								x: node.x + 20,
								y: node.y + 20,
								createdAt: Date.now()
							};
						});
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, ...pasted.map((node) => ({
								...node,
								sourceIds: node.sourceIds.map((sourceId) => idMap.get(sourceId) ?? sourceId),
								...node.parentId !== void 0 ? { parentId: idMap.get(node.parentId) ?? node.parentId } : {}
							}))]
						};
						draft.selectedNodeIds = pasted.map((node) => node.id);
						draft.selectedNodeId = pasted.length === 1 ? pasted[0].id : null;
					},
					reorderNode: (draft, projectId, id, direction) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const node = existing.find((candidate) => candidate.id === id);
						if (node === void 0) return;
						const sorted = [...existing].sort(compareNodes);
						const index = sorted.findIndex((candidate) => candidate.id === id);
						if (index === -1) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						let targetZ = node.zIndex ?? 0;
						if (direction === "front") targetZ = Math.max(0, ...existing.map((candidate) => candidate.zIndex ?? 0)) + 1;
						else if (direction === "back") targetZ = Math.min(0, ...existing.map((candidate) => candidate.zIndex ?? 0)) - 1;
						else if (direction === "forward") {
							const next = sorted[index + 1];
							if (next !== void 0) targetZ = (next.zIndex ?? 0) + 1;
						} else if (direction === "backward") {
							const previous = sorted[index - 1];
							if (previous !== void 0) targetZ = (previous.zIndex ?? 0) - 1;
						}
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((candidate) => candidate.id === id ? {
								...candidate,
								zIndex: targetZ
							} : candidate)
						};
					},
					toggleLock: (draft, projectId, id) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => node.id === id ? {
								...node,
								locked: !node.locked
							} : node)
						};
					},
					setVisibility: (draft, projectId, id, visible) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => node.id === id ? {
								...node,
								visible
							} : node)
						};
					},
					setOpacity: (draft, projectId, id, opacity) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const clamped = Math.min(1, Math.max(0, opacity));
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => node.id === id ? {
								...node,
								opacity: clamped
							} : node)
						};
					},
					renameNode: (draft, projectId, id, title) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const nextTitle = title.trim();
						if (nextTitle.length === 0) return;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => node.id === id ? {
								...node,
								title: nextTitle
							} : node)
						};
					},
					linkLayers: (draft, projectId, sourceIds, targetId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0 || sourceIds.length === 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => {
								if (node.id !== targetId) return node;
								const merged = [...node.sourceIds];
								for (const sourceId of sourceIds) if (sourceId !== targetId && !merged.includes(sourceId)) merged.push(sourceId);
								return {
									...node,
									sourceIds: merged
								};
							})
						};
					},
					groupSelected: (draft, projectId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0 || draft.selectedNodeIds.length < 2) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const byId = new Map(existing.map((node) => [node.id, node]));
						const members = draft.selectedNodeIds.map((id) => byId.get(id)).filter((node) => node !== void 0);
						const bounds = boundsOf(members);
						if (bounds === null) return;
						const group = {
							id: newNodeId(),
							kind: "group",
							title: "分组",
							x: bounds.x - 12,
							y: bounds.y - 12,
							width: bounds.width + 24,
							height: bounds.height + 24,
							createdAt: Date.now(),
							origin: "manual",
							sourceIds: [],
							zIndex: Math.min(...members.map((node) => node.zIndex ?? 0)) - 1
						};
						const memberIds = new Set(members.map((node) => node.id));
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing.map((node) => memberIds.has(node.id) ? {
								...node,
								parentId: group.id
							} : node), group]
						};
						draft.selectedNodeIds = [group.id];
						draft.selectedNodeId = group.id;
					},
					ungroup: (draft, projectId, groupId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.filter((node) => node.id !== groupId).map((node) => {
								if (node.parentId !== groupId) return node;
								const { parentId: _staleParent, ...rest } = node;
								return rest;
							})
						};
						draft.selectedNodeIds = draft.selectedNodeIds.filter((id) => id !== groupId);
						if (draft.selectedNodeId === groupId) draft.selectedNodeId = null;
					},
					autoArrange: (draft, projectId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0 || existing.length === 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const positions = computeArrangeLayout(existing);
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => {
								const position = positions.get(node.id);
								return position === void 0 ? node : {
									...node,
									x: position.x,
									y: position.y
								};
							})
						};
					},
					setPendingNode: (draft, projectId, node) => {
						const existing = draft.nodes[projectId] ?? [];
						if (existing.some((candidate) => candidate.runId === node.runId && candidate.isLoading)) return;
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, node]
						};
					},
					addNode: (draft, projectId, kind) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const index = existing.length;
						const size = NODE_SIZE[kind];
						const defaults = kind === "sticky" ? { text: "新便签" } : kind === "text" ? { text: "新文本" } : { text: "新提示" };
						const node = {
							id: newNodeId(),
							kind,
							title: NODE_TITLES[kind],
							x: LAYOUT.origin + index % LAYOUT.columns * LAYOUT.stepX,
							y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
							width: size.width,
							height: size.height,
							createdAt: Date.now(),
							origin: "manual",
							sourceIds: [],
							...defaults
						};
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, node]
						};
						draft.selectedNodeIds = [node.id];
						draft.selectedNodeId = node.id;
					},
					addBriefNode: (draft, projectId, text) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						if (existing.some((node) => node.toolName === "user_brief")) return;
						const node = {
							id: newNodeId(),
							kind: "text",
							title: "创意",
							text,
							x: LAYOUT.origin,
							y: LAYOUT.origin,
							width: 360,
							height: 200,
							createdAt: Date.now(),
							toolName: BRIEF_NODE_TOOL,
							origin: "manual",
							sourceIds: [],
							operationType: "import"
						};
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, node]
						};
					},
					addImportNode: (draft, projectId, url, title, filename, referenceRole = "image", isReference = true, display) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const index = existing.length;
						const size = display ?? NODE_SIZE.image;
						const node = {
							id: newNodeId(),
							kind: "image",
							title: typeof title === "string" && title.length > 0 ? title : "本地素材",
							url,
							...typeof filename === "string" && filename.length > 0 ? { filename } : {},
							...isReference ? { isReference: true } : {},
							...isReference && referenceRole !== void 0 ? { referenceRole } : {},
							...display?.mediaWidth !== void 0 ? { mediaWidth: display.mediaWidth } : {},
							...display?.mediaHeight !== void 0 ? { mediaHeight: display.mediaHeight } : {},
							x: LAYOUT.origin + index % LAYOUT.columns * LAYOUT.stepX,
							y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
							width: size.width,
							height: size.height,
							createdAt: Date.now(),
							origin: "manual",
							sourceIds: []
						};
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, node]
						};
						draft.selectedNodeIds = [node.id];
						draft.selectedNodeId = node.id;
					},
					addVideoStyleNodes: (draft, projectId, payload) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const size = NODE_SIZE.image;
						const stickySize = NODE_SIZE.sticky;
						const createdAt = Date.now();
						const frameNodes = payload.frames.map((frame, i) => {
							const index = existing.length + i;
							return {
								id: newNodeId(),
								kind: "image",
								title: `帧 ${String(i + 1).padStart(2, "0")} @${frame.time.toFixed(1)}s`,
								url: frame.url,
								filename: frame.filename,
								isReference: true,
								referenceRole: "style",
								x: LAYOUT.origin + index % LAYOUT.columns * LAYOUT.stepX,
								y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
								width: size.width,
								height: size.height,
								createdAt,
								toolName: "upload_video",
								origin: "manual",
								sourceIds: [],
								operationType: "import",
								generationPrompt: JSON.stringify({
									video: payload.name,
									time: frame.time
								})
							};
						});
						const stickyIndex = existing.length + frameNodes.length;
						const stickyNode = {
							id: newNodeId(),
							kind: "sticky",
							title: `风格归纳 · ${payload.name.length > 0 ? payload.name : "参考视频"}`,
							text: payload.summary,
							x: LAYOUT.origin + stickyIndex % LAYOUT.columns * LAYOUT.stepX,
							y: LAYOUT.origin + Math.floor(stickyIndex / LAYOUT.columns) * LAYOUT.stepY,
							width: stickySize.width + 140,
							height: stickySize.height + 120,
							createdAt,
							toolName: "upload_video",
							origin: "manual",
							sourceIds: frameNodes.map((node) => node.id),
							operationType: "import",
							generationPrompt: JSON.stringify({
								video: payload.name,
								duration: payload.duration,
								videoUrl: payload.videoUrl,
								frames: payload.frames.map((frame) => frame.time)
							})
						};
						draft.nodes = {
							...draft.nodes,
							[projectId]: [
								...existing,
								...frameNodes,
								stickyNode
							]
						};
						draft.selectedNodeIds = [stickyNode.id];
						draft.selectedNodeId = stickyNode.id;
					},
					addComposedVideo: (draft, projectId, asset) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const history = snapshotHistory(draft.history, draft.historyIndex, projectId, existing);
						draft.history = history.history;
						draft.historyIndex = history.historyIndex;
						const index = existing.length;
						const size = NODE_SIZE.video;
						const node = {
							id: asset.id ?? newNodeId(),
							kind: "video",
							title: asset.title,
							url: asset.url,
							...typeof asset.duration === "number" ? { duration: asset.duration } : {},
							...typeof asset.mediaWidth === "number" ? { mediaWidth: asset.mediaWidth } : {},
							...typeof asset.mediaHeight === "number" ? { mediaHeight: asset.mediaHeight } : {},
							...typeof asset.script === "string" ? { script: asset.script } : {},
							x: LAYOUT.origin + index % LAYOUT.columns * LAYOUT.stepX,
							y: LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
							width: size.width,
							height: size.height,
							createdAt: Date.now(),
							toolName: "compose",
							origin: "manual",
							sourceIds: asset.sourceIds,
							operationType: "video-composite"
						};
						draft.nodes = {
							...draft.nodes,
							[projectId]: [...existing, node]
						};
						draft.selectedNodeIds = [node.id];
						draft.selectedNodeId = node.id;
					},
					removePendingByRunId: (draft, projectId, runId) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						const pending = existing.find((node) => node.runId === runId && node.isLoading);
						if (pending === void 0) return;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.filter((node) => node.id !== pending.id)
						};
					},
					markPendingError: (draft, projectId, runId, error) => {
						const existing = draft.nodes[projectId];
						if (existing === void 0) return;
						draft.nodes = {
							...draft.nodes,
							[projectId]: existing.map((node) => node.runId === runId && node.isLoading ? {
								...node,
								isLoading: false,
								error
							} : node)
						};
					},
					clearProject: (draft, projectId) => {
						draft.nodes = {
							...draft.nodes,
							[projectId]: []
						};
						draft.selectedNodeId = null;
						draft.selectedNodeIds = [];
					}
				}
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Studio frame styles, injected as one style element tagged with the plugin
		* id (the client-modules owner tagging pattern). Product copy lives in the
		* components; this file only carries presentation.
		*/
		const STUDIO_STYLES = `
/* Presentation follows the official design system: all colors come from the
 * --dsw-alias-* semantic tokens owned by @deepseek-ai/dsh-client-ui-theme
 * (imported into the web shell base.css). Those tokens resolve to light or
 * dark values via body[data-ds-dark-theme], so this panel adapts to the app
 * theme automatically. Never hardcode colors or use currentColor here. */

.csFrame {
  display: grid;
  /* 验收反馈（2026-08-25）：对话区从 380px 加宽到 480px。 */
  grid-template-columns: 280px minmax(0, 1fr) 480px;
  height: 100%;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* P7 创作工作流条：模式开关 + 审批提示，位于工具栏与画布之间。 */
.csWorkflowBar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-l1);
}

.csWorkflowMode {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  overflow: hidden;
}

.csWorkflowMode button {
  padding: 3px 10px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csWorkflowMode button + button {
  border-left: 1px solid var(--dsw-alias-border-l2);
}

.csWorkflowMode button.csActive {
  background: var(--dsw-alias-bg-l3);
  color: var(--dsw-alias-label-primary);
}

.csWorkflowState {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.csWorkflowApproval {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.csWorkflowApproval .csWorkflowMessage {
  font-size: 12px;
  color: var(--dsw-alias-label-warning, var(--dsw-alias-label-primary));
}

.csWorkflowApproval button {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csWorkflowApproval button.csPrimary {
  background: var(--dsw-alias-bg-l3);
}

/* P7 点选式澄清卡片：ask_user_choice 弹出的选择题。 */
.csQuestionCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-l1);
}

.csQuestionLabel {
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.csQuestionOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.csQuestionOptions button {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csQuestionOptions button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-l3);
}

.csQuestionOptions button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* S3：风格澄清 GIF 预览卡片（ask_user_choice 选项命中风格预设时）。 */
.csStyleDemoGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.csStyleDemoCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  text-align: left;
}

.csStyleDemoCard:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-l2);
}

.csStyleDemoCard:disabled {
  opacity: 0.5;
  cursor: default;
}

.csStyleDemoImg {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: var(--dsw-alias-bg-l2);
}

.csStyleDemoName {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.csStyleDemoBadge {
  font-style: normal;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-l3);
  color: var(--dsw-alias-label-primary);
}

.csQuestionOther {
  opacity: 0.75;
}

.csQuestionFree {
  display: flex;
  gap: 6px;
}

.csQuestionFree input {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csQuestionFree button {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csProjects {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-right: 1px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  color: var(--dsw-alias-label-primary);
  /* Rebind scrollbar to the elevated-surface tokens so it matches the theme. */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csProjectsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}

.csProjectsHeader button {
  font: inherit;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csProjectsHeader button:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectsEmpty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  padding: 24px 8px;
  text-align: center;
}

.csProjectList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* 作为 csProjects 侧栏的 flex item 撑满 header 之外的高度，让 footer 推到容器底部。 */
  flex: 1 1 auto;
  min-height: 0;
}

/* 容器底部的「固定元素」槽位：当前承载设置图标按钮。
 * 用 margin-top:auto 在 flex column 容器里推到底部。 */
.csProjectListFooter {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.csProjectSettingsIcon {
  font: inherit;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0;
  transition: background 120ms ease, border-color 120ms ease;
}

.csProjectSettingsIcon:hover {
  background: var(--dsw-alias-bg-hover);
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.csProjectSettingsIcon:focus-visible {
  outline: 2px solid var(--dsw-alias-focus-ring, var(--dsw-alias-border-l3, currentColor));
  outline-offset: 2px;
}

.csProjectNew {
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
}

.csProjectNew:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectSettings {
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
}

.csProjectSettings:hover {
  background: var(--dsw-alias-bg-hover);
}

.csProjectForm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

.csProjectNameInput {
  font: inherit;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csProjectFormActions {
  display: flex;
  gap: 6px;
}

.csProjectFormActions button {
  font: inherit;
  flex: 1;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csProjectFormActions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectItem {
  font: inherit;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
}

.csProjectItem:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csProjectItemActive {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-active);
}

.csProjectMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.csProjectName {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csProjectDate {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectDelete {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.csProjectDelete:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2);
}

.csProjectDelete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csProjectError {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  font-size: 13px;
  color: var(--dsw-alias-state-error-primary);
}

.csProjectError button {
  font: inherit;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csCanvas {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

/* Middle region between the top toolbar and the bottom timeline: the pannable
 * surface plus the floating layer-list overlay share this positioned box. */
.csCanvasBody {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.csCanvasEmpty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
}

/* Infinite canvas surface: grid background pans/zooms with the layer. */
.csCanvasSurface {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-color: var(--dsw-alias-bg-base);
  /* CV-035：网格线降到 45% 不透明度。原样用 border-l2 时网格与节点描边同色，
     40px 密格在放大后压过内容。color-mix 保持跟随明暗主题（Chromium 111+，
     桌面 Electron 43 满足）。格子尺寸（40px）不变。 */
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px);
  background-repeat: repeat;
}

.csCanvasSurface:active {
  cursor: grabbing;
}

.csCanvasLayer {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  will-change: transform;
}

.csEdges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.csEdge {
  fill: none;
  stroke: var(--dsw-alias-interactive-bg-active);
  stroke-width: 2;
  opacity: 0.8;
}

.csNode {
  position: absolute;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
  cursor: grab;
  box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
}

.csNode:active {
  cursor: grabbing;
}

.csNodeSelected {
  border-color: var(--dsw-alias-interactive-bg-active);
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

.csNodeMedia {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: var(--dsw-alias-bg-base);
}

/* Images stay inert so node dragging owns every pointer; the video keeps
   native controls (play/seek/volume) interactive. */
img.csNodeMedia {
  pointer-events: none;
}

.csNodeText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.csNodeKind {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.csNodeBody {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* CV-001：文本类节点内联正文编辑（双击进入，替换只读正文）。 */
.csNodeBodyEdit {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  border: 1px solid var(--dsw-alias-interactive-bg-active);
  border-radius: 4px;
  padding: 4px 6px;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csNodeRing {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  pointer-events: none;
}

.csTimeline {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* P9.3 合成工具条：片段计数 + 导出按钮。 */
.csTimelineToolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.csTimelineCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* 片段条横向滚动（工具条固定不滚）。 */
.csTimelineStrip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.csTimelineEmpty {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-base);
}

.csTimelineItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csTimelineItem:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csTimelineItemActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
}

/* P9.1 拖拽排序的插入落点提示。 */
.csTimelineItemTarget {
  outline: 2px dashed var(--dsw-alias-interactive-bg-active);
  outline-offset: 1px;
}

.csTimelineThumb {
  display: grid;
  place-items: center;
  width: 96px;
  height: 60px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
}

.csTimelineThumb img,
.csTimelineThumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csTimelineKind {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}

.csTimelineTime {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.csConversation {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.csOverlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
}

.csOverlay > * {
  pointer-events: auto;
}

/* ---- Canvas toolbar (floating strip above the surface) ---- */
.csToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  z-index: 5;
}

.csToolbarGroup {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  margin-right: 4px;
  border-right: 1px solid var(--dsw-alias-border-l2);
}

.csToolbarGroup:last-child {
  border-right: none;
  padding-right: 0;
  margin-right: 0;
}

.csToolbarButton {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.csToolbarButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csToolbarButton:disabled {
  opacity: 0.4;
  cursor: default;
}

.csToolbarZoomValue {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  padding: 0 4px;
  min-width: 40px;
  text-align: center;
  white-space: nowrap;
}

/* ---- Snap alignment guides ---- */
.csGuide {
  position: absolute;
  background: var(--dsw-alias-interactive-bg-active);
  pointer-events: none;
  z-index: 3;
}

.csGuideVertical {
  top: 0;
  bottom: 0;
  width: 1px;
}

.csGuideHorizontal {
  left: 0;
  right: 0;
  height: 1px;
}

/* ---- Node visual states ---- */
.csNodeLocked {
  opacity: 0.75;
  cursor: not-allowed;
}

.csNodeError {
  border-color: var(--dsw-alias-state-error-primary);
}

.csNodeLoading {
  border-style: dashed;
  border-color: var(--dsw-alias-interactive-bg-active);
}

.csNodeMediaBox {
  width: 100%;
  height: 100%;
}

.csNodeGroup {
  display: flex;
  align-items: flex-start;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
  border: 1px dashed var(--dsw-alias-interactive-bg-active);
  border-radius: 8px;
  background: rgb(99 102 241 / 6%);
}

.csNodeResize {
  position: absolute;
  z-index: 4;
}

.csNodeResizeN {
  top: -4px;
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.csNodeResizeS {
  bottom: -4px;
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.csNodeResizeE {
  top: 8px;
  bottom: 8px;
  right: -4px;
  width: 8px;
  cursor: ew-resize;
}

.csNodeResizeW {
  top: 8px;
  bottom: 8px;
  left: -4px;
  width: 8px;
  cursor: ew-resize;
}

.csNodeResizeNW {
  top: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.csNodeResizeNE {
  top: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.csNodeResizeSW {
  bottom: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.csNodeResizeSE {
  bottom: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.csNodeResizeN, .csNodeResizeS, .csNodeResizeE, .csNodeResizeW {
  opacity: 0;
}

.csNode:hover .csNodeResize,
.csNodeSelected .csNodeResize {
  opacity: 1;
}

.csNodeLinkHandle {
  position: absolute;
  right: -9px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-bg-base);
  background: var(--dsw-alias-interactive-bg-active);
  cursor: crosshair;
  z-index: 4;
}

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

.csNodeOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--dsw-alias-bg-base);
  opacity: 0.92;
}

.csNodeOverlayLabel {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.csNodeProgress {
  width: 70%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--dsw-alias-border-l2);
}

.csNodeProgressBar {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 2px;
  background: var(--dsw-alias-interactive-bg-active);
  animation: csProgressSlide 1.2s ease-in-out infinite;
}

/* CV-010：loading 超时（>3 分钟）的可打断提示。 */
.csNodeOverlayHint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

@keyframes csProgressSlide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.csNodeBadge {
  position: absolute;
  top: -8px;
  left: -8px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}

.csNodeBadgeError {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

/* CV-018：可重试的失败徽章 —— 保持错误配色，叠加可点 affordance。 */
.csNodeBadgeRetry {
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  z-index: 2;
}

.csNodeBadgeRetry:hover {
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-bg-base);
}

.csNodeBadgeLock {
  left: auto;
  right: -8px;
}

.csNodeRename {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  z-index: 5;
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* ---- Edge draft line + chip text ---- */
.csEdgeDraft {
  stroke-dasharray: 6 4;
  stroke: var(--dsw-alias-interactive-bg-active);
}

.csEdgeChipText {
  font-family: inherit;
  user-select: none;
}

/* ---- Minimap ---- */
.csMinimap {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 6px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  cursor: grab;
  user-select: none;
}

.csMinimap:active {
  cursor: grabbing;
}

.csMinimap svg {
  display: block;
}

/* ---- Right column (conversation only) ---- */
.csChat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--dsw-alias-border-l2);
}

/* ---- Floating layer-list overlay (inside the canvas body) ---- */
.csCanvasLayers {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  width: 260px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csCanvasLayers .csLayerPanel {
  max-height: 320px;
  border-bottom: none;
}

/* ---- Layer panel ---- */
.csLayerPanel {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csLayerPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-weight: 600;
  font-size: 13px;
}

.csLayerSearch {
  font: inherit;
  font-size: 12px;
  flex: 0 0 120px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csLayerList {
  overflow-y: auto;
  padding: 0 6px 8px;
}

.csLayerRow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.csLayerRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csLayerRowActive {
  background: var(--dsw-alias-interactive-bg-active);
}

.csLayerThumb {
  flex: 0 0 40px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.csLayerThumb img,
.csLayerThumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csLayerThumbKind {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}

.csLayerTitle {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.csLayerActions {
  display: flex;
  gap: 1px;
  flex: 0 0 auto;
}

.csLayerAction {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 11px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.csLayerAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csLayerActionActive {
  color: var(--dsw-alias-label-primary);
}

.csLayerActionDanger:hover {
  color: var(--dsw-alias-state-error-primary);
}

.csLayerEmpty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- Layer detail panel (overlay) ---- */
.csDetailPanel {
  position: fixed;
  top: 64px;
  right: 12px;
  z-index: 30;
  width: 320px;
  max-height: calc(100% - 80px);
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  overflow: hidden;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csDetailPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csDetailPanelClose {
  font: inherit;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.csDetailPanelClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csDetailPanelBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  font-size: 12px;
}

.csDetailRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* CV-001：多行控件（正文 textarea）所在行，标签与内容顶对齐。 */
.csDetailRowTop {
  align-items: flex-start;
}

.csDetailRowTop > .csDetailLabel {
  padding-top: 4px;
}

/* CV-001：详情面板正文编辑区。 */
.csDetailTextarea {
  flex: 1 1 auto;
  min-width: 0;
  resize: vertical;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csDetailLabel {
  flex: 0 0 72px;
  color: var(--dsw-alias-label-tertiary);
}

.csDetailValue {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.csDetailValueClickable {
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

.csDetailInput {
  font: inherit;
  font-size: 12px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csDetailRange {
  flex: 1 1 auto;
  accent-color: var(--dsw-alias-interactive-bg-active);
}

.csDetailButton {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csDetailButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csDetailButtonActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.csDetailButtonDanger {
  border-color: transparent;
  color: var(--dsw-alias-state-error-primary);
}

.csDetailPrompt {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--dsw-alias-label-secondary);
}

/* 详情面板：生成参数结构化展示（提示词/参考图缩略图/原始 JSON 折叠）。 */
.csDetailRefThumbs {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.csDetailRefThumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.35);
}

.csDetailRaw {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.csDetailRaw summary {
  cursor: pointer;
  user-select: none;
}

.csDetailError {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-state-error-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

.csDetailActions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1 1 auto;
  justify-content: flex-end;
}

.csDetailSteer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

/* ---- Node context menu ---- */
.csContextMenu {
  position: fixed;
  z-index: 50;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
}

.csMenuAction {
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csMenuAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csMenuAction:disabled {
  opacity: 0.4;
  cursor: default;
}

.csMenuActionDanger {
  color: var(--dsw-alias-state-error-primary);
}

.csMenuActionDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Reference tray (floating overlay on the canvas, not the project list) ---- */
.csReferenceFloat {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 20;
  width: 260px;
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}
.csReferenceTray {
  margin: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}
.csReferenceHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}
.csReferenceToggle {
  font-size: 16px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
}
.csReferenceList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.csReferenceItem {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
.csReferenceThumb {
  width: 56px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
  background: #e9e9e9;
}
.csReferenceMeta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.csReferenceTitleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.csReferenceTitle {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csReferenceChip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.csReferenceRange {
  width: 100%;
}
.csReferenceActions {
  display: flex;
  gap: 6px;
}
.csReferenceButton {
  flex: 1 1 auto;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csReferenceButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Detail panel reference section ---- */
.csDetailSection {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.csDetailSelect {
  flex: 1 1 auto;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* ---- Canvas toolbar settings button (opens the settings popup) ---- */
.csToolbarGroupEnd {
  margin-left: auto;
}

.csToolbarSettings {
  display: grid;
  place-items: center;
  padding: 3px 8px;
  color: var(--dsw-alias-label-secondary);
}

.csToolbarSettings:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Settings popup (self-contained; not the desktop global panel) ---- */
.csModalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 40%);
}

.csModal {
  width: min(440px, 100%);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
  overflow: hidden;
}

.csModalHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csModalHeader h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.csModalClose {
  font: inherit;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.csModalClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csModalBody {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
}

.csField {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.csFieldLabel {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}

.csFieldInput {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csFieldInput:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

.csFieldRow {
  display: flex;
  gap: 8px;
}

.csFieldRow .csFieldInput {
  flex: 1 1 auto;
  min-width: 0;
}

.csFieldButton {
  font: inherit;
  font-size: 13px;
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csFieldButton:disabled {
  opacity: 0.5;
  cursor: default;
}

.csFieldError {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
}

/* ---- Settings popup tab bar (通用 / 主题 / 模型) ---- */
.csModalTabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csTab {
  font: inherit;
  font-size: 13px;
  padding: 7px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csTab:hover:not(.csTabActive) {
  color: var(--dsw-alias-label-primary);
}

.csTabActive {
  color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-interactive-bg-active);
  font-weight: 600;
}

/* ---- Theme option chips (主题分区) ---- */
.csThemeOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csThemeOption {
  font: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csThemeOption:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csThemeOptionActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

/* ---- Inline hint text under a settings field ---- */
.csFieldHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- Select control (输出/工作流分区) ---- */
.csFieldSelect {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-l2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldSelect:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

/* ---- Toggle row (checkbox + label, 工作流/存储分区) ---- */
.csToggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csToggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-interactive-bg-active);
  cursor: pointer;
}

/* ---- "待接入" 标记：字段已落 schema 但当前管线尚未消费 ---- */
.csReserved {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  vertical-align: middle;
}

/* ---- Model settings panel (provider-aware, complete) ---- */
.csModelPanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.csModelDefault {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csModelProviders {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.csModelCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-l1);
}

.csModelCardHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csModelCardTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.csModelBadge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.csModelBadgeOn {
  background: var(--dsw-alias-state-success-bg, var(--dsw-alias-interactive-bg-active));
  color: var(--dsw-alias-label-primary);
}

.csModelDiscovered {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.csModelDiscoveredList {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  max-height: 140px;
  overflow-y: auto;
}

.csModelCardActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csModelPrimary {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.csModelDanger {
  border-color: transparent;
  color: var(--dsw-alias-state-error-primary);
}

.csModelDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csModelCustom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.csModelCustomForm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-l1);
}
`;
		/** Inject the studio stylesheet once per browser lifetime. */
		function installStudioStyles() {
			const element = document.createElement("style");
			element.setAttribute("data-plugin", "canvas-studio");
			element.textContent = STUDIO_STYLES;
			document.head.appendChild(element);
			return () => {
				element.remove();
			};
		}
		//#endregion
		//#region src/client/ProjectList.tsx
		/** Relative-day label for the project creation date. */
		function createdLabel(project) {
			const date = new Date(project.createdAt);
			if (Number.isNaN(date.getTime())) return "-";
			return date.toLocaleDateString();
		}
		/**
		* The studio project list: an inline create form plus one row per project.
		* Clicking a row opens the project (session binding happens in the callback).
		* Each row also carries a delete affordance (confirmed before firing).
		*/
		function ProjectListInner(props) {
			const { projects: rawProjects, selectedProjectId, phase, error, creating, onRefresh, onCreate, onOpen, onDelete, onOpenSettings } = props;
			const projects = Array.isArray(rawProjects) ? rawProjects : [];
			const [formOpen, setFormOpen] = (0, react.useState)(false);
			const [draftName, setDraftName] = (0, react.useState)("");
			const submit = async () => {
				const name = draftName.trim();
				if (name.length === 0 || creating) return;
				await onCreate(name);
				setFormOpen(false);
				setDraftName("");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csProjectList",
				children: [
					!formOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csProjectNew",
						disabled: creating,
						onClick: () => setFormOpen(true),
						children: "+ 新建项目"
					}),
					formOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csProjectForm",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "csProjectNameInput",
							value: draftName,
							placeholder: "项目名",
							autoFocus: true,
							disabled: creating,
							onChange: (event) => {
								setDraftName(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") submit();
								if (event.key === "Escape") setFormOpen(false);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csProjectFormActions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: creating || draftName.trim().length === 0,
								onClick: () => void submit(),
								children: creating ? "创建中" : "创建"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: creating,
								onClick: () => setFormOpen(false),
								children: "取消"
							})]
						})]
					}),
					phase === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csProjectsEmpty",
						children: "加载中…"
					}),
					phase === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csProjectError",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: onRefresh,
							children: "重试"
						})]
					}),
					phase === "idle" && projects.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csProjectsEmpty",
						children: "还没有项目,点击「新建项目」开始创作"
					}),
					projects.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: project.id === selectedProjectId ? "csProjectItem csProjectItemActive" : "csProjectItem",
						onClick: () => onOpen(project),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csProjectMeta",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csProjectName",
								children: project.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csProjectDate",
								children: createdLabel(project)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csProjectDelete",
							title: "删除项目",
							disabled: creating,
							onClick: (event) => {
								event.stopPropagation();
								if (window.confirm(`确定删除项目「${project.name}」？该操作会同时删除其目录与画布，不可恢复。`)) onDelete(project.id);
							},
							children: "×"
						})]
					}, project.id)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csProjectListFooter",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csProjectSettingsIcon",
							"aria-label": "打开设置",
							title: "设置",
							onClick: () => onOpenSettings(),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"aria-hidden": "true",
								children: "⚙"
							})
						})
					})
				]
			});
		}
		/** Render boundary: if the list crashes, show the error instead of vanishing. */
		var ProjectListErrorBoundary = class extends react.Component {
			state = {
				crashed: false,
				crashError: null
			};
			static getDerivedStateFromError(error) {
				return {
					crashed: true,
					crashError: error instanceof Error ? error : new Error(String(error))
				};
			}
			componentDidCatch(error, errorInfo) {
				console.error("[canvas-studio] ProjectList render error:", error, errorInfo);
			}
			render() {
				if (this.state.crashed) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csProjectError",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["项目列表渲染失败: ", this.state.crashError?.message ?? "未知错误"] })
				});
				return this.props.children;
			}
		};
		/**
		* The studio project list: an inline create form plus one row per project.
		* Wrapped in an error boundary so crashes surface in the UI instead of being
		* swallowed by the upstream slot boundary.
		*/
		function ProjectList(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectListErrorBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectListInner, { ...props }) });
		}
		//#endregion
		//#region src/client/ModelSettingsPanel.tsx
		/**
		* Canvas Studio「模型」设置面板（provider 感知，完整功能）。
		*
		* 设计：不直接复用桌面 dsh 的 `ModelsSettingsStore` / `ModelsSection`（包内私有、
		* 不导出，且没有打开桌面设置页的命令），而是调用与 dsh **完全相同**的 Host wire
		* 接口（经 canvas-studio 已有的 `connection` 服务）：
		* - `llm.providers({})`            拉可配置 provider 目录（自部署 / OpenAI / DeepSeek / 自定义…）
		* - `settings.describe({})`        拉全量命名空间视图（含已解析值 + revision）
		* - `settings.mutate({...})`       写 provider profile（base URL / 模型清单 / apiKeyEnv）
		* - `credentials.set/describe`     密钥走凭据域，不落明文
		*
		* 因此本面板与桌面原生「模型」设置共享同一份存储：在桌面设置里看到的配置，这里也能
		* 改；反之亦然。写入格式严格对齐 dsh（path ops + 派生凭据引用），不会损坏其它字段。
		*/
		/** 自定义 provider 路由 id 规则（与 dsh 一致：小写字母数字加连字符，字母开头）。 */
		const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
		/** 自定义 provider 写入的命名空间（与 dsh CustomProviderCard 一致）。 */
		const CUSTOM_NS = "llm-pi-ai";
		/** 沿路径安全读取嵌套值。 */
		function getAt(value, path) {
			let cur = value;
			for (const key of path) {
				if (cur === null || typeof cur !== "object") return void 0;
				cur = cur[key];
			}
			return cur;
		}
		/** 是否存在该路径（用于 removable 判定）。 */
		function hasAt(value, path) {
			return getAt(value, path) !== void 0;
		}
		function asString(value) {
			return typeof value === "string" ? value : "";
		}
		/** 把 profile.models（可能是字符串数组或 {id} 对象数组）规范成 id 字符串数组。 */
		function asModelIds(value) {
			if (!Array.isArray(value)) return [];
			return value.map((m) => {
				if (typeof m === "string") return m;
				if (m !== null && typeof m === "object" && "id" in m) return String(m.id);
				return "";
			}).filter((s) => s.length > 0);
		}
		/** 派生 provider 的凭据引用（与 dsh deriveKeyRef 完全一致）。 */
		function deriveKeyRef(provider) {
			return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
		}
		/** 订阅 settingsScope 的响应式快照（与 DesktopSettingsSection.useScope 同构）。 */
		function useScope$1(scope) {
			return (0, react.useSyncExternalStore)((0, react.useMemo)(() => (listener) => scope.subscribe(listener), [scope]), (0, react.useMemo)(() => () => scope.getSnapshot(), [scope]));
		}
		/** 模型设置面板主体。 */
		function ModelSettingsPanel(props) {
			const { getModelApi, settingsScope } = props;
			const [status, setStatus] = (0, react.useState)("loading");
			const [error, setError] = (0, react.useState)(null);
			const [writable, setWritable] = (0, react.useState)(false);
			const [providers, setProviders] = (0, react.useState)([]);
			const [namespaces, setNamespaces] = (0, react.useState)([]);
			const [credMap, setCredMap] = (0, react.useState)({});
			const [drafts, setDrafts] = (0, react.useState)({});
			const [discovered, setDiscovered] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)({});
			const [saveError, setSaveError] = (0, react.useState)({});
			const [customOpen, setCustomOpen] = (0, react.useState)(false);
			const [customBusy, setCustomBusy] = (0, react.useState)(false);
			const [customError, setCustomError] = (0, react.useState)(null);
			const [cRoute, setCRoute] = (0, react.useState)("");
			const [cName, setCName] = (0, react.useState)("");
			const [cBase, setCBase] = (0, react.useState)("");
			const [cProtocol, setCProtocol] = (0, react.useState)("openai");
			const [cKey, setCKey] = (0, react.useState)("");
			const [cModels, setCModels] = (0, react.useState)([]);
			const agentScope = (0, react.useMemo)(() => settingsScope.bind({ namespace: "agent-default-model" }), [settingsScope]);
			const agentValue = useScope$1(agentScope).value;
			/** 拉取 provider 目录 + 命名空间视图 + 密钥态。 */
			const refresh = (0, react.useCallback)(async () => {
				const api = getModelApi();
				if (api === void 0) {
					setError("连接服务不可用：当前环境未提供模型设置所需的 Host 接口");
					setStatus("error");
					return;
				}
				setStatus("loading");
				setError(null);
				try {
					const [provRes, setRes] = await Promise.all([api.llm.providers({}), api.settings.describe({})]);
					if (!provRes.result.ok) throw new Error(provRes.result.error.message);
					if (!setRes.result.ok) throw new Error(setRes.result.error.message);
					const provList = provRes.result.value.providers;
					const nsList = setRes.result.value.namespaces;
					const draftMap = {};
					const refs = [];
					for (const p of provList) {
						if (!p.settingsNs) continue;
						const ns = nsList.find((n) => n.ns === p.settingsNs);
						const profile = ns ? getAt(ns.value, p.settingsPath) : void 0;
						const profObj = profile !== null && typeof profile === "object" ? profile : void 0;
						const keyRef = profObj && typeof profObj.apiKeyEnv === "string" && profObj.apiKeyEnv.length > 0 ? profObj.apiKeyEnv : deriveKeyRef(p.provider);
						draftMap[p.provider] = {
							displayName: asString(profObj?.displayName) || p.displayName || "",
							baseURL: asString(profObj?.baseURL),
							models: asModelIds(profObj?.models),
							keyDraft: ""
						};
						if (keyRef) refs.push(keyRef);
					}
					let cm = {};
					if (refs.length > 0) try {
						cm = (await api.credentials.describe({ refs })).credentials ?? {};
					} catch {}
					setProviders(provList);
					setNamespaces(nsList);
					setWritable(setRes.result.value.writable);
					setDrafts(draftMap);
					setCredMap(cm);
					setStatus("ready");
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : "模型设置加载失败");
					setStatus("error");
				}
			}, [getModelApi]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			/** 取某 provider 的命名空间视图与已解析 profile。 */
			const profileOf = (0, react.useCallback)((p) => {
				const ns = namespaces.find((n) => n.ns === p.settingsNs);
				const profile = ns ? getAt(ns.value, p.settingsPath) : void 0;
				return {
					ns,
					profile: profile !== null && typeof profile === "object" ? profile : void 0
				};
			}, [namespaces]);
			/** 以补丁方式更新某 provider 的草稿（避免在 updater 内对可能为 undefined 的索引做展开）。 */
			const patchDraft = (0, react.useCallback)((provider, patch) => {
				setDrafts((dm) => {
					const cur = dm[provider];
					if (cur === void 0) return dm;
					return {
						...dm,
						[provider]: {
							...cur,
							...patch
						}
					};
				});
			}, []);
			/** 保存一个 provider 的配置（base URL / 模型清单 / displayName / API Key）。 */
			const saveProvider = (0, react.useCallback)(async (p) => {
				const api = getModelApi();
				if (api === void 0) return;
				const { ns, profile } = profileOf(p);
				if (ns === void 0) {
					setSaveError((m) => ({
						...m,
						[p.provider]: "未找到该 provider 的 settings 命名空间"
					}));
					return;
				}
				const draft = drafts[p.provider];
				if (draft === void 0) return;
				const keyRef = profile && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : deriveKeyRef(p.provider);
				const ops = [];
				if (profile === void 0) {
					const value = {};
					if (draft.displayName) value.displayName = draft.displayName;
					if (draft.baseURL) value.baseURL = draft.baseURL;
					value.models = draft.models.map((id) => ({ id }));
					if (draft.keyDraft) value.apiKeyEnv = keyRef;
					ops.push({
						op: "set",
						path: [...p.settingsPath],
						value
					});
				} else {
					const curBase = asString(profile.baseURL);
					if (draft.baseURL !== curBase) ops.push(draft.baseURL ? {
						op: "set",
						path: [...p.settingsPath, "baseURL"],
						value: draft.baseURL
					} : {
						op: "unset",
						path: [...p.settingsPath, "baseURL"]
					});
					const curName = asString(profile.displayName);
					if (draft.displayName !== curName) ops.push(draft.displayName ? {
						op: "set",
						path: [...p.settingsPath, "displayName"],
						value: draft.displayName
					} : {
						op: "unset",
						path: [...p.settingsPath, "displayName"]
					});
					if (asModelIds(profile.models).join("\n") !== draft.models.join("\n")) ops.push({
						op: "set",
						path: [...p.settingsPath, "models"],
						value: draft.models.map((id) => ({ id }))
					});
				}
				setBusy((b) => ({
					...b,
					[p.provider]: true
				}));
				setSaveError((m) => ({
					...m,
					[p.provider]: null
				}));
				try {
					if (ops.length > 0) {
						const res = await api.settings.mutate({
							ns: p.settingsNs,
							ops,
							expectedRevision: ns.revision
						});
						if (!res.result.ok) throw new Error(res.result.error.code === "settings-conflict" ? "配置已被其它改动覆盖，请刷新后重试" : res.result.error.message);
					}
					if (draft.keyDraft) await api.credentials.set({
						ref: keyRef,
						value: draft.keyDraft
					});
					await refresh();
				} catch (cause) {
					setSaveError((m) => ({
						...m,
						[p.provider]: cause instanceof Error ? cause.message : "保存失败"
					}));
				} finally {
					setBusy((b) => ({
						...b,
						[p.provider]: false
					}));
				}
			}, [
				getModelApi,
				profileOf,
				drafts,
				refresh
			]);
			/** 移除一个用户添加的 provider 及其托管密钥。 */
			const removeProvider = (0, react.useCallback)(async (p) => {
				const api = getModelApi();
				if (api === void 0) return;
				const { ns, profile } = profileOf(p);
				if (ns === void 0) return;
				const keyRef = profile && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : void 0;
				setBusy((b) => ({
					...b,
					[p.provider]: true
				}));
				setSaveError((m) => ({
					...m,
					[p.provider]: null
				}));
				try {
					if (keyRef) try {
						await api.credentials.unset({ ref: keyRef });
					} catch {}
					const res = await api.settings.mutate({
						ns: p.settingsNs,
						ops: [{
							op: "unset",
							path: [...p.settingsPath]
						}],
						expectedRevision: ns.revision
					});
					if (!res.result.ok) throw new Error(res.result.error.message);
					await refresh();
				} catch (cause) {
					setSaveError((m) => ({
						...m,
						[p.provider]: cause instanceof Error ? cause.message : "移除失败"
					}));
				} finally {
					setBusy((b) => ({
						...b,
						[p.provider]: false
					}));
				}
			}, [
				getModelApi,
				profileOf,
				refresh
			]);
			/** 从端点拉取该 provider 当前广告的模型清单。 */
			const discoverModels = (0, react.useCallback)(async (p) => {
				const api = getModelApi();
				if (api === void 0) return;
				const draft = drafts[p.provider];
				if (draft === void 0) return;
				try {
					const res = await api.llm.discoverModels({
						settingsNs: p.settingsNs,
						provider: p.provider,
						...draft.baseURL ? { baseURL: draft.baseURL } : {},
						...draft.keyDraft ? { apiKey: draft.keyDraft } : {}
					});
					if (!res.result.ok) throw new Error(res.result.error.message);
					const models = res.result.value.models;
					setDiscovered((d) => ({
						...d,
						[p.provider]: models
					}));
				} catch (cause) {
					setSaveError((m) => ({
						...m,
						[p.provider]: `拉取模型失败：${cause instanceof Error ? cause.message : "未知错误"}`
					}));
				}
			}, [getModelApi, drafts]);
			/** 采用拉取到的模型清单覆盖当前草稿。 */
			const adoptDiscovered = (0, react.useCallback)((p) => {
				const list = discovered[p.provider] ?? [];
				patchDraft(p.provider, { models: list.map((m) => m.id) });
			}, [discovered, patchDraft]);
			/** 写默认模型（agent-default-model 命名空间）。 */
			const setDefault = (0, react.useCallback)((provider, model) => {
				if (agentValue === void 0) return;
				if (provider !== agentValue.provider) agentScope.set("provider", provider);
				if (model !== agentValue.model) agentScope.set("model", model);
			}, [agentScope, agentValue]);
			/** 添加自定义 provider（自部署 / 第三方 OpenAI 兼容网关）。 */
			const addCustom = (0, react.useCallback)(async () => {
				const api = getModelApi();
				if (api === void 0) return;
				const ns = namespaces.find((n) => n.ns === CUSTOM_NS);
				if (ns === void 0) {
					setCustomError("未找到 llm-pi-ai 命名空间");
					return;
				}
				if (!ROUTE_PATTERN.test(cRoute)) {
					setCustomError("路由 id 需为小写字母数字加连字符，且字母开头（如 my-local-llm）");
					return;
				}
				if (cBase.length === 0) {
					setCustomError("需填写 API 地址（Base URL）");
					return;
				}
				if (cModels.length === 0) {
					setCustomError("至少填写一个模型 id");
					return;
				}
				const keyRef = deriveKeyRef(cRoute);
				const profile = {
					api: cProtocol,
					baseURL: cBase,
					models: cModels.map((id) => ({ id }))
				};
				if (cName) profile.displayName = cName;
				if (cKey) profile.apiKeyEnv = keyRef;
				setCustomBusy(true);
				setCustomError(null);
				try {
					const res = await api.settings.mutate({
						ns: CUSTOM_NS,
						ops: [{
							op: "set",
							path: ["providers", cRoute],
							value: profile
						}],
						expectedRevision: ns.revision
					});
					if (!res.result.ok) throw new Error(res.result.error.message);
					if (cKey) await api.credentials.set({
						ref: keyRef,
						value: cKey
					});
					setCRoute("");
					setCName("");
					setCBase("");
					setCProtocol("openai");
					setCKey("");
					setCModels([]);
					setCustomOpen(false);
					await refresh();
				} catch (cause) {
					setCustomError(cause instanceof Error ? cause.message : "添加失败");
				} finally {
					setCustomBusy(false);
				}
			}, [
				getModelApi,
				namespaces,
				cRoute,
				cName,
				cBase,
				cProtocol,
				cKey,
				cModels,
				refresh
			]);
			if (status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csField",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "csFieldError",
					role: "alert",
					children: error
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "csFieldButton",
					onClick: () => {
						refresh();
					},
					children: "重试"
				})]
			});
			if (status === "loading" || agentValue === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			const defaultable = providers.filter((p) => {
				const { profile } = profileOf(p);
				return profile !== void 0;
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csModelPanel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csModelDefault",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csFieldLabel",
								children: "默认模型（全局生效，驱动创作流水线）"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csFieldRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: "csFieldInput",
									value: agentValue.provider,
									onChange: (e) => setDefault(e.target.value, drafts[e.target.value]?.models[0] ?? agentValue.model),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "— 选择 provider —"
									}), defaultable.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: p.provider,
										children: drafts[p.provider]?.displayName || p.displayName
									}, p.provider))]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csFieldInput",
									value: agentValue.model,
									placeholder: "模型 id",
									spellCheck: false,
									onChange: (e) => setDefault(agentValue.provider, e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "csField",
								style: { marginTop: 8 },
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csFieldLabel",
									children: "推理强度（reasoningEffort，可选）"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csFieldInput",
									value: agentValue.reasoningEffort ?? "",
									placeholder: "留空使用默认",
									spellCheck: false,
									onChange: (e) => void agentScope.set("reasoningEffort", e.target.value)
								})]
							})
						]
					}),
					!writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csFieldHint",
						children: "当前设置只读（宿主以只读方式挂载），保存按钮已禁用。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csModelProviders",
						children: [providers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldHint",
							children: "未检测到可配置的模型 provider。"
						}), providers.map((p) => {
							const draft = drafts[p.provider];
							if (draft === void 0 || !p.settingsNs) return null;
							const { ns, profile } = profileOf(p);
							const keyRef = profile && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : deriveKeyRef(p.provider);
							const cred = credMap[keyRef];
							const removable = ns !== void 0 && p.settingsPath.length > 0 && hasAt(ns.user, p.settingsPath) && !hasAt(ns.base, p.settingsPath);
							const isBusy = busy[p.provider] === true;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csModelCard",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csModelCardHead",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csModelCardTitle",
												children: draft.displayName || p.displayName
											}),
											p.active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csModelBadge csModelBadgeOn",
												children: "已激活"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csModelBadge",
												children: "未激活"
											}),
											p.declared === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csModelBadge",
												children: "自定义"
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "csField",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csFieldLabel",
											children: "展示名"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "csFieldInput",
											value: draft.displayName,
											placeholder: p.displayName,
											disabled: isBusy || !writable,
											onChange: (e) => patchDraft(p.provider, { displayName: e.target.value })
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "csField",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csFieldLabel",
											children: "API 地址（Base URL）"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "csFieldInput",
											value: draft.baseURL,
											placeholder: "留空使用 provider 默认",
											spellCheck: false,
											disabled: isBusy || !writable,
											onChange: (e) => patchDraft(p.provider, { baseURL: e.target.value })
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: "csField",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "csFieldLabel",
											children: [
												"API Key（凭据引用 ",
												keyRef,
												cred?.configured ? "，已配置" : "，未配置",
												"）"
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "csFieldInput",
											type: "password",
											placeholder: cred?.configured ? "已保存，留空不改；输入新值覆盖" : "输入密钥后点保存",
											value: draft.keyDraft,
											disabled: isBusy || !writable,
											onChange: (e) => patchDraft(p.provider, { keyDraft: e.target.value })
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csField",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csFieldLabel",
												children: "模型清单（留空 = 使用 provider 目录自带）"
											}),
											draft.models.map((mid, idx) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "csFieldRow",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: "csFieldInput",
													value: mid,
													spellCheck: false,
													disabled: isBusy || !writable,
													onChange: (e) => patchDraft(p.provider, { models: draft.models.map((m, i) => i === idx ? e.target.value : m) })
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "csFieldButton",
													disabled: isBusy || !writable,
													onClick: () => patchDraft(p.provider, { models: draft.models.filter((_, i) => i !== idx) }),
													children: "删除"
												})]
											}, `${p.provider}-${idx}`)),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "csFieldRow",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "csFieldButton",
													disabled: isBusy || !writable,
													onClick: () => patchDraft(p.provider, { models: [...draft.models, ""] }),
													children: "+ 添加模型"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: "csFieldButton",
													disabled: isBusy || !writable,
													onClick: () => {
														discoverModels(p);
													},
													children: "从端点拉取"
												})]
											}),
											(discovered[p.provider]?.length ?? 0) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "csModelDiscovered",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "csFieldLabel",
														children: [
															"拉取到 ",
															(discovered[p.provider] ?? []).length,
															" 个模型："
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
														className: "csModelDiscoveredList",
														children: (discovered[p.provider] ?? []).map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [m.id, m.name ? `（${m.name}）` : ""] }, m.id))
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "csFieldButton",
														disabled: isBusy,
														onClick: () => adoptDiscovered(p),
														children: "采用清单"
													})
												]
											})
										]
									}),
									saveError[p.provider] !== null && saveError[p.provider] !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "csFieldError",
										role: "alert",
										children: saveError[p.provider]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csModelCardActions",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csFieldButton",
												disabled: isBusy || !writable,
												onClick: () => {
													saveProvider(p);
												},
												children: isBusy ? "保存中…" : "保存"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csFieldButton csModelPrimary",
												disabled: isBusy,
												onClick: () => setDefault(p.provider, draft.models[0] ?? agentValue.model),
												children: "设为默认"
											}),
											removable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csFieldButton csModelDanger",
												disabled: isBusy || !writable,
												onClick: () => {
													removeProvider(p);
												},
												children: "移除"
											})
										]
									})
								]
							}, p.provider);
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csModelCustom",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csFieldButton",
							onClick: () => {
								setCustomOpen((v) => !v);
								setCustomError(null);
							},
							children: customOpen ? "收起自定义 provider" : "+ 添加自定义 provider（自部署 / 第三方 OpenAI 兼容）"
						}), customOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csModelCustomForm",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csFieldLabel",
										children: "路由 id（小写字母数字加连字符，字母开头）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csFieldInput",
										value: cRoute,
										placeholder: "如 my-local-llm",
										spellCheck: false,
										onChange: (e) => setCRoute(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csFieldLabel",
										children: "展示名（可选）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csFieldInput",
										value: cName,
										onChange: (e) => setCName(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csFieldLabel",
										children: "API 地址（Base URL）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csFieldInput",
										value: cBase,
										placeholder: "https://your-endpoint/v1",
										spellCheck: false,
										onChange: (e) => setCBase(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csFieldLabel",
										children: "协议（api，默认 openai = OpenAI 兼容）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csFieldInput",
										value: cProtocol,
										spellCheck: false,
										onChange: (e) => setCProtocol(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csFieldLabel",
										children: "API Key（可选，写凭据域）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csFieldInput",
										type: "password",
										value: cKey,
										onChange: (e) => setCKey(e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csField",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csFieldLabel",
										children: "模型 id（至少一个，逗号或逐行添加）"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csFieldInput",
										value: cModels.join(", "),
										placeholder: "gpt-4o, gpt-4o-mini",
										spellCheck: false,
										onChange: (e) => setCModels(e.target.value.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0))
									})]
								}),
								customError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "csFieldError",
									role: "alert",
									children: customError
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "csModelCardActions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "csFieldButton csModelPrimary",
										disabled: customBusy,
										onClick: () => {
											addCustom();
										},
										children: customBusy ? "添加中…" : "添加 provider"
									})
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csFieldHint",
						children: "该配置与桌面「设置 → 模型」共享同一份存储；自部署或其它服务商的 provider 填 Base URL + Key 即可， 密钥只存凭据域不落明文。"
					})
				]
			});
		}
		//#endregion
		//#region src/client/SettingsModal.tsx
		/**
		* Canvas Studio 设置弹窗（浏览器半侧，自包含 UI）。
		*
		* 不依赖桌面全局 Plugins 面板（ui-settings-plugins 未装入当前桌面），由 canvas-studio
		* 自带弹窗承载配置；主页画布上的「设置」按钮 → 弹出本弹窗 → 分区编辑 → 经
		* 不同作用域回写：
		* - 通用：绑定 'canvas-studio' 命名空间（Drama 连接；Host 侧 source() 实时读到）。
		* - 输出 / 工作流 / 存储：同样绑定 'canvas-studio' 命名空间，分字段回写（画幅比例已接入
		*   生成兜底，其余字段待 P2-P4 管线消费，见 plan.md §1.7 消费状态表）。
		* - 主题：复用桌面 dsh-client-ui-theme 的 ctx.theme 运行时（全局浅色/深色/跟随系统）。
		* - 模型：自实现的 provider 感知面板（见 ModelSettingsPanel）。直接复用桌面 dsh 的
		*   `ModelsSettingsStore` / `ModelsSection` 不可行——它们包内私有、不导出，且没有打开
		*   桌面设置页的命令。本面板改为调用与 dsh 完全相同的 Host wire 接口（llm.providers /
		*   settings.describe + settings.mutate / credentials.set），因此与桌面「设置 → 模型」
		*   共享同一份存储、功能对等：支持 DeepSeek / Anthropic / 自部署 OpenAI 兼容 / 自定义
		*   provider，填 Base URL + API Key、拉模型清单、设为默认。该配置为桌面全局默认模型，
		*   驱动 Canvas Studio 创作流水线。
		*
		* 密钥走凭据域（credentials.set），不落明文。订阅方式照搬 dsh-plugin-desktop 的
		* DesktopSettingsSection.useScope（useSyncExternalStore）。
		*/
		/** 订阅 settingsScope 的响应式快照（与 DesktopSettingsSection.useScope 同构）。 */
		function useScope(scope) {
			return (0, react.useSyncExternalStore)((0, react.useMemo)(() => (listener) => scope.subscribe(listener), [scope]), (0, react.useMemo)(() => () => scope.getSnapshot(), [scope]));
		}
		/** 主题 id → 中文标签。 */
		function themeLabel(id) {
			if (id === "light") return "浅色";
			if (id === "dark") return "深色";
			if (id === "system") return "跟随系统";
			return id;
		}
		/** 通用分区：Drama API 基址 / 视频时长上限 / API Key（凭据域）。 */
		function GeneralSection(props) {
			const { settingsScope, getCredentials } = props;
			const scope = (0, react.useMemo)(() => settingsScope.bind({ namespace: "canvas-studio" }), [settingsScope]);
			const snapshot = useScope(scope);
			const value = snapshot.value;
			const base = snapshot.base;
			const [keyInput, setKeyInput] = (0, react.useState)("");
			const [credState, setCredState] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (value === void 0) return;
				const ref = value.dramaApiKey;
				let cancelled = false;
				const credentials = getCredentials();
				if (credentials === void 0) {
					setCredState(null);
					return;
				}
				credentials.describe({ refs: [ref] }).then((res) => {
					if (!cancelled) setCredState(res.credentials[ref] ?? null);
				}).catch(() => {
					if (!cancelled) setCredState(null);
				});
				return () => {
					cancelled = true;
				};
			}, [getCredentials, value?.dramaApiKey]);
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			const onBase = (v) => {
				scope.set("dramaApiBase", v);
			};
			const onSeconds = (v) => {
				const n = Number(v);
				if (Number.isFinite(n)) scope.set("maxVideoSeconds", n);
			};
			const onSaveKey = async () => {
				if (keyInput.length === 0) return;
				const credentials = getCredentials();
				if (credentials === void 0) {
					setError("凭据服务不可用：当前环境未提供 credentials");
					return;
				}
				setBusy(true);
				setError(null);
				try {
					await credentials.set({
						ref: value.dramaApiKey,
						value: keyInput
					});
					setKeyInput("");
					setCredState({
						configured: true,
						writable: true
					});
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : "密钥保存失败");
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csFieldLabel",
						children: "Drama API 基址"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csFieldInput",
						value: value.dramaApiBase,
						placeholder: base?.dramaApiBase,
						spellCheck: false,
						onChange: (event) => onBase(event.target.value)
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csFieldLabel",
						children: "视频时长上限（秒，1–15）"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csFieldInput",
						type: "number",
						min: 1,
						max: 15,
						value: value.maxVideoSeconds,
						onChange: (event) => onSeconds(event.target.value)
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csField",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csFieldLabel",
							children: [
								"Drama API Key（凭据引用 ",
								value.dramaApiKey,
								credState?.configured ? "，已配置" : "，未配置",
								"）"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csFieldRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "csFieldInput",
								type: "password",
								placeholder: "输入密钥后点保存",
								value: keyInput,
								onChange: (event) => setKeyInput(event.target.value)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csFieldButton",
								disabled: busy || keyInput.length === 0,
								onClick: () => {
									onSaveKey();
								},
								children: busy ? "保存中…" : "保存密钥"
							})]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldError",
							role: "alert",
							children: error
						})
					]
				})
			] });
		}
		/** 主题分区：复用桌面 ctx.theme，切换全局浅色/深色/跟随系统。 */
		function ThemeSection(props) {
			const { theme } = props;
			const subscribe = (0, react.useMemo)(() => (listener) => {
				return () => {};
			}, []);
			const getSnapshot = (0, react.useMemo)(() => () => theme.getTheme(), [theme]);
			const snap = (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			const [, forceTick] = (0, react.useState)(0);
			const select = (id) => {
				theme.setTheme(id);
				forceTick((n) => n + 1);
				requestAnimationFrame(() => {
					forceTick((n) => n + 1);
				});
			};
			const options = [...snap.themes.map((definition) => ({
				id: definition.id,
				label: themeLabel(definition.id)
			})), {
				id: "system",
				label: "跟随系统"
			}];
			const activeId = snap.preference === "system" ? "system" : snap.active.id;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csField",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csFieldLabel",
						children: "外观主题（全局生效，影响整个桌面）"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csThemeOptions",
						children: options.map((opt) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: activeId === opt.id ? "csThemeOption csThemeOptionActive" : "csThemeOption",
							onClick: () => select(opt.id),
							children: opt.label
						}, opt.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "csFieldHint",
						children: [
							"当前：",
							themeLabel(activeId),
							"（",
							snap.active.colorScheme === "dark" ? "深色" : "浅色",
							"）"
						]
					})
				]
			});
		}
		/** 模型分区：provider 感知的完整设置面板（写 host wire 三域，状态与桌面设置共享）。 */
		function ModelSection(props) {
			const { settingsScope, getModelApi } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelSettingsPanel, {
				settingsScope,
				getModelApi
			});
		}
		/** 输出与导出分区：默认画幅比例（已接入生成兜底）+ 导出格式/目录/质量（待 P3 导出管线）。 */
		function OutputSection(props) {
			const { settingsScope } = props;
			const scope = (0, react.useMemo)(() => settingsScope.bind({ namespace: "canvas-studio" }), [settingsScope]);
			const value = useScope(scope).value;
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csFieldLabel",
							children: "默认画幅比例"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "csFieldSelect",
							value: value.defaultAspectRatio,
							onChange: (event) => void scope.set("defaultAspectRatio", event.target.value),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "16:9",
									children: "16:9（横屏）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "9:16",
									children: "9:16（竖屏）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "1:1",
									children: "1:1（方形）"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldHint",
							children: "agent 未指定画幅时，生成按此兜底（已生效）。"
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csFieldLabel",
						children: ["导出格式 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csReserved",
							children: "待接入"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
						className: "csFieldSelect",
						value: value.exportFormat,
						onChange: (event) => void scope.set("exportFormat", event.target.value),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "mp4",
							children: "mp4"
						})
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csFieldLabel",
						children: ["导出目录 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csReserved",
							children: "待接入"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csFieldInput",
						value: value.exportDir,
						placeholder: "留空=项目默认目录",
						spellCheck: false,
						onChange: (event) => void scope.set("exportDir", event.target.value)
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csFieldLabel",
						children: ["视频质量 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csReserved",
							children: "待接入"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: "csFieldSelect",
						value: value.videoQuality,
						onChange: (event) => void scope.set("videoQuality", event.target.value),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "standard",
							children: "标准"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "high",
							children: "高"
						})]
					})]
				})
			] });
		}
		/** 工作流偏好分区：执行模式 / HITL 门禁 / 自动重试 / 并行数（待 P2-P4 agent 编排接入消费）。 */
		function WorkflowSection(props) {
			const { settingsScope } = props;
			const scope = (0, react.useMemo)(() => settingsScope.bind({ namespace: "canvas-studio" }), [settingsScope]);
			const value = useScope(scope).value;
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			const onParallel = (raw) => {
				const n = Number(raw);
				if (Number.isFinite(n)) scope.set("maxParallel", n);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csFieldLabel",
							children: ["默认执行模式 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csReserved",
								children: "待接入"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "csFieldSelect",
							value: value.workflowMode,
							onChange: (event) => void scope.set("workflowMode", event.target.value),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "confirm",
								children: "每步人工确认"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "auto",
								children: "全自动"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "csFieldHint",
							children: [
								"待 P2-P4 agent 编排接入消费，",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "当前不影响运行" }),
								"。今天真正生效的模式开关在 画布顶部（「逐步确认」/「放手跑」），按",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "项目" }),
								"持久化。"
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csToggle",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value.hitlStoryboard,
						onChange: (event) => void scope.set("hitlStoryboard", event.target.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["分镜阶段需人工批准（HITL 门禁） ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csReserved",
						children: "待接入"
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "csFieldHint",
					children: [
						"该开关尚未接入：分镜审批门禁",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "当前始终开启" }),
						"（无条件要求先提交分镜表获批）， 取消勾选也不会关闭它。"
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csToggle",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value.hitlKeyframe,
						onChange: (event) => void scope.set("hitlKeyframe", event.target.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["关键帧阶段需人工批准 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csReserved",
						children: "待接入"
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csToggle",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value.autoRetry,
						onChange: (event) => void scope.set("autoRetry", event.target.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["生成失败自动重试 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csReserved",
						children: "待接入"
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csFieldLabel",
						children: ["最大并行生成数（1–8） ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csReserved",
							children: "待接入"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csFieldInput",
						type: "number",
						min: 1,
						max: 8,
						value: value.maxParallel,
						onChange: (event) => onParallel(event.target.value)
					})]
				})
			] });
		}
		/** 存储与缓存分区：资产库位置（已接通）+ 画布自动保存开关/间隔（待客户端画布自动保存接入）。 */
		function StorageSection(props) {
			const { settingsScope, getDirectoryPicker } = props;
			const scope = (0, react.useMemo)(() => settingsScope.bind({ namespace: "canvas-studio" }), [settingsScope]);
			const value = useScope(scope).value;
			const [picking, setPicking] = (0, react.useState)(false);
			const [pickError, setPickError] = (0, react.useState)(null);
			const onInterval = (raw) => {
				const n = Number(raw);
				if (Number.isFinite(n)) scope.set("autoSaveInterval", n);
			};
			const onPickDirectory = async () => {
				const picker = getDirectoryPicker();
				if (picker === void 0) {
					setPickError("当前桌面环境未提供目录选择器，请手动输入路径");
					return;
				}
				setPickError(null);
				setPicking(true);
				try {
					const path = await picker.pick();
					if (path === null) return;
					scope.set("assetDir", path);
				} catch (cause) {
					setPickError(cause instanceof Error ? cause.message : "选择目录失败");
				} finally {
					setPicking(false);
				}
			};
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csFieldLabel",
							children: ["资产库位置 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csReserved",
								children: "已接入"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csFieldRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "csFieldInput",
								value: value.assetDir,
								placeholder: "留空=默认 ($DSH_HOME/canvas-studio)",
								spellCheck: false,
								onChange: (event) => void scope.set("assetDir", event.target.value)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csFieldButton",
								disabled: picking,
								onClick: () => {
									onPickDirectory();
								},
								title: "弹系统文件夹选择器",
								children: picking ? "选择中…" : "浏览…"
							})]
						}),
						pickError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldError",
							role: "alert",
							children: pickError
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "csFieldHint",
							children: [
								"仅对",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "新建项目" }),
								"生效；旧项目保留在原位不迁移。留空 = 使用桌面默认 `$DSH_HOME/canvas-studio`。"
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csToggle",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: value.autoSave,
						onChange: (event) => void scope.set("autoSave", event.target.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["画布自动保存 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csReserved",
						children: "待接入"
					})] })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "csField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csFieldLabel",
						children: ["自动保存间隔（秒，5–600） ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csReserved",
							children: "待接入"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csFieldInput",
						type: "number",
						min: 5,
						max: 600,
						value: value.autoSaveInterval,
						onChange: (event) => onInterval(event.target.value)
					})]
				})
			] });
		}
		/** 弹窗顶部分区切换按钮。 */
		function TabButton(props) {
			const { active, onClick, children } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				role: "tab",
				"aria-selected": active,
				className: active ? "csTab csTabActive" : "csTab",
				onClick,
				children
			});
		}
		/**
		* Render the Canvas Studio settings popup with six sections: 通用 / 主题 / 模型 / 输出 / 工作流 / 存储.
		* 通用/输出/工作流/存储经 canvas-studio 命名空间回写；主题经 ctx.theme；模型经 host wire 三域。
		*/
		function SettingsModal(props) {
			const { settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme, onClose } = props;
			const [tab, setTab] = (0, react.useState)("general");
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [onClose]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csModalBackdrop",
				role: "presentation",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csModal",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "cs-settings-title",
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "csModalHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "cs-settings-title",
								children: "Canvas Studio 设置"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csModalClose",
								"aria-label": "关闭",
								onClick: onClose,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csModalTabs",
							role: "tablist",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabButton, {
									active: tab === "general",
									onClick: () => {
										setTab("general");
									},
									children: "通用"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabButton, {
									active: tab === "theme",
									onClick: () => {
										setTab("theme");
									},
									children: "主题"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabButton, {
									active: tab === "model",
									onClick: () => {
										setTab("model");
									},
									children: "模型"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabButton, {
									active: tab === "output",
									onClick: () => {
										setTab("output");
									},
									children: "输出"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabButton, {
									active: tab === "workflow",
									onClick: () => {
										setTab("workflow");
									},
									children: "工作流"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TabButton, {
									active: tab === "storage",
									onClick: () => {
										setTab("storage");
									},
									children: "存储"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csModalBody",
							children: [
								tab === "general" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeneralSection, {
									settingsScope,
									getCredentials
								}),
								tab === "theme" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThemeSection, { theme }),
								tab === "model" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelSection, {
									settingsScope,
									getModelApi
								}),
								tab === "output" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OutputSection, { settingsScope }),
								tab === "workflow" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowSection, { settingsScope }),
								tab === "storage" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StorageSection, {
									settingsScope,
									getDirectoryPicker
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/canvas/CanvasToolbar.tsx
		/**
		* The canvas toolbar: undo/redo, selection editing (delete/group/ungroup),
		* the one-click arrange, and manual node creation (sticky/text/prompt).
		* Everything is props-driven — the frame wires the store actions.
		*/
		function CanvasToolbar(props) {
			const { canUndo, canRedo, selectedCount, hasSelection, onUndo, onRedo, onDelete, onGroup, onUngroup, onAutoArrange, onAddNode, onUploadImage, onUploadVideo, layersOpen, onToggleLayers, scale, onZoomOut, onZoomIn, onFitContent, onResetZoom, minimapVisible, onToggleMinimap, onOpenSettings } = props;
			const uploadInputRef = (0, react.useRef)(null);
			const uploadVideoInputRef = (0, react.useRef)(null);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csToolbar",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csToolbarGroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csToolbarButton",
							disabled: !canUndo,
							title: "撤销 (Ctrl+Z)",
							onClick: onUndo,
							children: "↩ 撤销"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csToolbarButton",
							disabled: !canRedo,
							title: "重做 (Ctrl+Shift+Z)",
							onClick: onRedo,
							children: "↪ 重做"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csToolbarGroup",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								disabled: !hasSelection,
								onClick: onDelete,
								children: "删除"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								disabled: selectedCount < 2,
								onClick: onGroup,
								children: "编组"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								disabled: selectedCount !== 1,
								onClick: onUngroup,
								children: "解组"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csToolbarGroup",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csToolbarButton",
							title: "整理布局：消除重叠并适配视野",
							onClick: onAutoArrange,
							children: "整理布局"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csToolbarGroup",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								onClick: () => {
									onAddNode("sticky");
								},
								children: "+ 便签"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								onClick: () => {
									onAddNode("text");
								},
								children: "+ 文本"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								onClick: () => {
									onAddNode("prompt");
								},
								children: "+ 提示"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								onClick: () => {
									uploadInputRef.current?.click();
								},
								children: "上传图片"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: uploadInputRef,
								type: "file",
								accept: "image/png,image/jpeg,image/webp,image/gif",
								style: { display: "none" },
								onChange: (event) => {
									const file = event.target.files?.[0];
									if (file !== void 0) onUploadImage(file);
									event.target.value = "";
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								title: "上传参考视频：抽帧并归纳风格要素，帧图成为可用参考",
								onClick: () => {
									uploadVideoInputRef.current?.click();
								},
								children: "上传视频"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: uploadVideoInputRef,
								type: "file",
								accept: "video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv",
								style: { display: "none" },
								onChange: (event) => {
									const file = event.target.files?.[0];
									if (file !== void 0) onUploadVideo(file);
									event.target.value = "";
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csToolbarGroup",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csToolbarButton",
							onClick: onToggleLayers,
							children: layersOpen ? "隐藏图层" : "显示图层"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csToolbarGroup",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csToolbarZoomValue",
								children: [Math.round(scale * 100), "%"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								title: "缩小",
								onClick: onZoomOut,
								children: "−"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								title: "放大",
								onClick: onZoomIn,
								children: "+"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								title: "适配内容",
								onClick: onFitContent,
								children: "⤢"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton",
								title: "重置缩放",
								onClick: onResetZoom,
								children: "1:1"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csToolbarGroup",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csToolbarButton",
							onClick: onToggleMinimap,
							children: minimapVisible ? "隐藏小地图" : "显示小地图"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csToolbarGroup csToolbarGroupEnd",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csToolbarButton csToolbarSettings",
							title: "Canvas Studio 设置",
							"aria-label": "设置",
							onClick: onOpenSettings,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
								width: "16",
								height: "16",
								viewBox: "0 0 24 24",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "2",
								strokeLinecap: "round",
								strokeLinejoin: "round",
								"aria-hidden": "true",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "12",
									cy: "12",
									r: "3"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" })]
							})
						})
					})
				]
			});
		}
		//#endregion
		//#region src/canvas-geometry.ts
		/**
		* 边的**出发点**：来源节点的右缘中点。
		* 与 `CanvasEdges` 的正式锚点严格一致，起草线必须复用它。
		*/
		function sourceAnchor(box) {
			return {
				x: box.x + box.width,
				y: box.y + box.height / 2
			};
		}
		/**
		* 边的**落点**：目标节点的左缘中点。
		* 起草线拖拽过程中目标尚未确定，此时落点是光标的世界坐标。
		*/
		function targetAnchor(box) {
			return {
				x: box.x,
				y: box.y + box.height / 2
			};
		}
		/**
		* 三次贝塞尔路径，水平方向外扩控制点 —— 与正式边逐字一致。
		*
		* 控制点偏移量取水平距离的一半：两点越远，曲线外扩越明显；纵向落差由
		* 贝塞尔自然吸收，因此上下错位的节点也能连出平滑曲线而非折线。
		*
		* @param from 出发点（右缘中点）
		* @param to 落点（左缘中点，或拖拽中的光标世界坐标）
		* @returns SVG `path` 的 `d` 属性
		*/
		function buildEdgePath(from, to) {
			const control = Math.abs(to.x - from.x) * .5;
			return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`;
		}
		//#endregion
		//#region src/client/canvas/canvas-math.ts
		/** Clamp a value into [min, max]. */
		function clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		}
		/** Snap threshold in canvas-space pixels. */
		const SNAP_THRESHOLD = 5;
		/**
		* Snap a dragged node's target position against every other node: left/right/
		* center edges on both axes, with optional grid snapping first.
		*/
		function calculateSnap(nodes, dragged, targetX, targetY, options = {}) {
			const { gridSnap = false, gridSize = 50 } = options;
			const guides = [];
			if (gridSnap) return {
				x: Math.round(targetX / gridSize) * gridSize,
				y: Math.round(targetY / gridSize) * gridSize,
				guides
			};
			let snapX = targetX;
			let snapY = targetY;
			const draggedRight = targetX + dragged.width;
			const draggedBottom = targetY + dragged.height;
			const draggedCenterX = targetX + dragged.width / 2;
			const draggedCenterY = targetY + dragged.height / 2;
			for (const node of nodes) {
				if (node.id === dragged.id) continue;
				if (node.visible === false) continue;
				const right = node.x + node.width;
				const bottom = node.y + node.height;
				const centerX = node.x + node.width / 2;
				const centerY = node.y + node.height / 2;
				if (Math.abs(targetX - node.x) < SNAP_THRESHOLD) {
					snapX = node.x;
					guides.push({
						type: "vertical",
						position: node.x
					});
				}
				if (Math.abs(draggedRight - right) < SNAP_THRESHOLD) {
					snapX = right - dragged.width;
					guides.push({
						type: "vertical",
						position: right
					});
				}
				if (Math.abs(draggedCenterX - centerX) < SNAP_THRESHOLD) {
					snapX = centerX - dragged.width / 2;
					guides.push({
						type: "vertical",
						position: centerX
					});
				}
				if (Math.abs(targetY - node.y) < SNAP_THRESHOLD) {
					snapY = node.y;
					guides.push({
						type: "horizontal",
						position: node.y
					});
				}
				if (Math.abs(draggedBottom - bottom) < SNAP_THRESHOLD) {
					snapY = bottom - dragged.height;
					guides.push({
						type: "horizontal",
						position: bottom
					});
				}
				if (Math.abs(draggedCenterY - centerY) < SNAP_THRESHOLD) {
					snapY = centerY - dragged.height / 2;
					guides.push({
						type: "horizontal",
						position: centerY
					});
				}
			}
			return {
				x: snapX,
				y: snapY,
				guides
			};
		}
		/** Union bounds of nodes (null when empty). */
		function contentBounds(nodes) {
			if (nodes.length === 0) return null;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const node of nodes) {
				if (node.visible === false) continue;
				minX = Math.min(minX, node.x);
				minY = Math.min(minY, node.y);
				maxX = Math.max(maxX, node.x + node.width);
				maxY = Math.max(maxY, node.y + node.height);
			}
			if (minX === Infinity) return null;
			return {
				x: minX,
				y: minY,
				width: maxX - minX,
				height: maxY - minY
			};
		}
		/** Screen → canvas-space coordinate (inverse of the surface transform). */
		function screenToWorld(screenX, screenY, offsetX, offsetY, scale) {
			return {
				x: (screenX - offsetX) / scale,
				y: (screenY - offsetY) / scale
			};
		}
		//#endregion
		//#region src/client/canvas/labels.ts
		/**
		* 画布标签唯一来源（CV-004）：节点类型与操作类型的中文名此前分散在
		* CanvasNode / CanvasEdges / LayerPanel / LayerDetailPanel / CanvasTimeline
		* 五处且已漂移（storyboard-split 缺失导致详情面板显示原始英文 key），统一
		* 收敛到本模块共用，新增类型只改这里。
		*/
		/** 节点类型中文标签（节点角标 / 图层行 / 详情面板 / 时间轴 chip 共用）。 */
		const KIND_LABEL = {
			image: "图片",
			video: "视频",
			sticky: "便签",
			text: "文本",
			prompt: "提示",
			group: "分组"
		};
		/** 操作类型中文标签（边 chip + 详情面板共用）。 */
		const OPERATION_LABELS = {
			"text-to-image": "文生图",
			"image-to-image": "图生图",
			"text-to-video": "文生视频",
			"image-to-video": "图生视频",
			"mkr-video": "MKR 多关键帧",
			"style-transfer": "风格迁移",
			"background-replace": "背景替换",
			expand: "图片扩展",
			"background-remove": "智能抠图",
			variant: "图片变体",
			import: "导入",
			drawing: "绘图",
			storyboard: "分镜",
			"storyboard-split": "拆分单镜",
			"character-sheet": "定妆照",
			"scene-concept": "概念图",
			"video-clip": "视频片段",
			"video-composite": "视频合成"
		};
		//#endregion
		//#region src/client/canvas/CanvasEdges.tsx
		/** Edge color per operation type (reference ConnectionLines palette subset). */
		const OPERATION_COLORS = {
			"text-to-image": "#22c55e",
			"image-to-image": "#3b82f6",
			"text-to-video": "#06b6d4",
			"image-to-video": "#8b5cf6",
			"mkr-video": "#a855f7",
			"style-transfer": "#f59e0b",
			"background-replace": "#f97316",
			expand: "#ec4899",
			"background-remove": "#14b8a6",
			variant: "#84cc16",
			import: "#6b7280",
			drawing: "#eab308",
			storyboard: "#f59e0b",
			"storyboard-split": "#f97316",
			"character-sheet": "#3b82f6",
			"scene-concept": "#10b981",
			"video-clip": "#06b6d4",
			"video-composite": "#a855f7"
		};
		/** Source-role labels for multi-source operations (index-aligned). */
		const SOURCE_ROLE_LABELS = { "mkr-video": [
			"首帧",
			"中间帧",
			"尾帧"
		] };
		/** Marker id suffix must stay URL-safe; operation types are already safe. */
		function markerId(operation) {
			return `cs-arrow-${operation}`;
		}
		/**
		* Bloodline edges: every node draws a bezier from each of its `sourceIds`
		* sources to its own left edge, colored by the target node's operationType
		* with an arrow marker and a Chinese operation chip at the midpoint (the
		* reference ConnectionLines rendering, adapted to canvas-space coordinates —
		* this SVG sits inside the transformed layer, so no manual offset/scale).
		* CV-032：线宽 / 箭头 / chip 均按 1/scale 反向补偿，小缩放下保持屏幕尺寸
		* 恒定（此前 3.5 用户单位宽度在 0.3x 缩放下不足 1px，几乎不可见）；箭头
		* marker 默认随 strokeWidth 缩放，无需单独补偿。CV-014：chip 低缩放隐藏
		* （scale < 0.6）只留线，选中节点相关边的 chip 始终保留。
		* There is no separate edge table — edges are derived from the node graph at
		* render time (plan §7.3).
		*/
		function CanvasEdges(props) {
			const { nodes, selectedNodeIds, scale } = props;
			const inv = 1 / Math.max(scale, .05);
			const chipsVisible = scale >= .6;
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const selected = new Set(selectedNodeIds);
			const operationTypes = new Set(nodes.map((node) => node.operationType).filter(Boolean));
			const paths = [];
			for (const node of nodes) {
				if (node.sourceIds.length === 0) continue;
				const operation = node.operationType ?? "import";
				const color = OPERATION_COLORS[operation] ?? "#6b7280";
				const label = OPERATION_LABELS[operation] ?? "操作";
				const roles = SOURCE_ROLE_LABELS[operation];
				const to = targetAnchor(node);
				node.sourceIds.forEach((sourceId, index) => {
					const source = byId.get(sourceId);
					if (source === void 0) return;
					const from = sourceAnchor(source);
					const toX = to.x;
					const toY = to.y;
					const fromX = from.x;
					const fromY = from.y;
					const d = buildEdgePath(from, to);
					const highlighted = selected.has(node.id) || selected.has(source.id);
					const midX = (fromX + toX) / 2;
					const midY = (fromY + toY) / 2;
					const chipLabel = roles?.[index] ?? label;
					const chipWidth = Math.max(chipLabel.length * 8 + 16, 50) * inv;
					const chipHeight = 20 * inv;
					const showChip = chipsVisible || highlighted;
					paths.push(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						className: "csEdge",
						d,
						stroke: color,
						strokeWidth: (highlighted ? 5 : 3.5) * inv,
						opacity: highlighted ? 1 : .6,
						markerEnd: `url(#${markerId(operation)})`
					}), showChip && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: midX - chipWidth / 2,
						y: midY - chipHeight / 2,
						width: chipWidth,
						height: chipHeight,
						rx: 4 * inv,
						fill: "#1f2937",
						stroke: color,
						strokeWidth: 1 * inv,
						opacity: .9
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
						x: midX,
						y: midY + 4 * inv,
						fill: color,
						fontSize: 10 * inv,
						textAnchor: "middle",
						className: "csEdgeChipText",
						children: chipLabel
					})] })] }, `${sourceId}->${node.id}`));
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "csEdges",
				width: 1,
				height: 1,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("defs", { children: [[...operationTypes].map((operation) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
					id: markerId(operation),
					viewBox: "0 0 10 10",
					refX: "9",
					refY: "5",
					markerWidth: "9",
					markerHeight: "9",
					orient: "auto-start-reverse",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M 0 0 L 10 5 L 0 10 z",
						fill: OPERATION_COLORS[operation] ?? "#6b7280"
					})
				}, markerId(operation))), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
					id: "cs-arrow-import",
					viewBox: "0 0 10 10",
					refX: "9",
					refY: "5",
					markerWidth: "9",
					markerHeight: "9",
					orient: "auto-start-reverse",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M 0 0 L 10 5 L 0 10 z",
						fill: "#6b7280"
					})
				})] }), paths]
			});
		}
		//#endregion
		//#region src/canvas-actions.ts
		/**
		* CV-018：该节点是否支持「就地重试」。判定条件与 client 侧 `rerunNode`
		* 的重放前置检查保持一致（`toolName` + `generationPrompt` 齐备），因此徽章
		* 一旦可点，点击必然真的重放，不会出现「点了才提示没有可重放参数」。
		* 生成中的节点（`isLoading`）不显示重试。
		*/
		function canRetryNode(node) {
			if (node.isLoading === true) return false;
			return node.toolName !== void 0 && node.generationPrompt !== void 0;
		}
		/**
		* CV-020：该节点是否有可下载的资产。
		*
		* 只有 image / video 且带 `url` 的节点才有实体产物；sticky / text / prompt /
		* group 是画布上的标注，没有可另存的文件。
		*/
		function canDownloadNode(node) {
			if (node.kind !== "image" && node.kind !== "video") return false;
			return typeof node.url === "string" && node.url.length > 0;
		}
		/** 各节点类型的产物扩展名（`assetDownloadName` 兜底补后缀用）。 */
		const ASSET_EXTENSION = {
			image: ".png",
			video: ".mp4"
		};
		/** 文件名不安全字符（路径分隔符与控制字符）替换为 `-`。 */
		function sanitizeFileName(raw) {
			return raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
		}
		/**
		* CV-020：资产的下载文件名。
		*
		* 优先用 Drama 落盘的 `filename`（与存储里的名字一致，方便和 agent 的
		* `@ref` 句柄对上）；没有则退回「标题」，再退回节点 id 前 8 位。缺扩展名时
		* 按节点类型补 `.png` / `.mp4`，避免存下一个无后缀的文件。
		*/
		function assetDownloadName(node) {
			const base = sanitizeFileName(node.filename !== void 0 && node.filename.trim().length > 0 ? node.filename : node.title !== void 0 && node.title.trim().length > 0 ? node.title : `canvas-${node.id.slice(0, 8)}`);
			if (base.length === 0) return `canvas-${node.id.slice(0, 8)}${ASSET_EXTENSION[node.kind] ?? ""}`;
			return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}${ASSET_EXTENSION[node.kind] ?? ""}`;
		}
		/**
		* CV-037：一次全局 `mousedown` 是否应保持右键菜单打开。
		*
		* 背景：菜单原先在任意 window mousedown 时无条件卸载，`mousedown` 先于
		* `click` 到达，菜单项在 mouseup 前就从 DOM 消失，`click` 永不触发 —— 全部
		* 菜单项失效。现在只有「按在菜单外」才关闭；按在菜单内部时事件照常冒泡
		* 给菜单项自身，`onClick` 内自行 onClose + 执行动作。
		*
		* @param target 事件目标（`event.target`）
		* @param menu 菜单根元素；`null`（尚未挂载/已关闭）时一律不拦截
		*/
		function shouldKeepMenuOpen(target, menu) {
			if (menu === null) return false;
			if (target === null || target === void 0) return false;
			return menu.contains(target);
		}
		//#endregion
		//#region src/client/canvas/CanvasNode.tsx
		/** Tool names for the transient (loading) node titles. */
		const TOOL_TITLES = {
			image_generate: "生成图片中…",
			video_generate: "生成视频中…",
			video_composite: "合成视频中…"
		};
		/** CV-010：超过该秒数认为「可能卡住」，overlay 追加可打断提示。 */
		const LOADING_SLOW_THRESHOLD = 180;
		/** Resize corners (grid of 9, center omitted). */
		const RESIZE_CORNERS = [
			"nw",
			"n",
			"ne",
			"e",
			"se",
			"s",
			"sw",
			"w"
		];
		/** True when a pointer-down target is an interactive element (no drag). */
		function isInteractiveTarget(target) {
			if (!(target instanceof HTMLElement)) return false;
			return target.closest("textarea, input, button, select, a, [contenteditable=\"true\"]") !== null;
		}
		/**
		* One canvas node: media box or text annotation, placed at its canvas-space
		* coordinates. The surface owns pan/zoom/drag/resize gestures; this component
		* is presentational and reports pointer-downs with the intended gesture.
		* Visual state follows the reference LayerData semantics: locked (no drag),
		* loading overlay, error badge, opacity, flipX/flipY (media only), hidden
		* nodes are filtered by the surface.
		*/
		function CanvasNode(props) {
			const { node, selected, onNodePointerDown, onResizePointerDown, onLinkPointerDown, onRenameSubmit, onTextSubmit, onOpenDetail, onContextMenu, onRetry, onMediaNatural } = props;
			const [editingTitle, setEditingTitle] = (0, react.useState)(false);
			const [titleInput, setTitleInput] = (0, react.useState)("");
			const [editingBody, setEditingBody] = (0, react.useState)(false);
			const [bodyInput, setBodyInput] = (0, react.useState)("");
			const [mediaFailed, setMediaFailed] = (0, react.useState)(false);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				if (node.isLoading !== true) return;
				setNow(Date.now());
				const timer = setInterval(() => {
					setNow(Date.now());
				}, 1e3);
				return () => {
					clearInterval(timer);
				};
			}, [node.isLoading]);
			const isMedia = node.kind === "image" || node.kind === "video";
			const isGroup = node.kind === "group";
			const opacity = node.opacity ?? 1;
			const loadingSeconds = node.isLoading === true ? Math.max(0, Math.floor((now - node.createdAt) / 1e3)) : 0;
			const loadingLabel = `${String(Math.floor(loadingSeconds / 60)).padStart(2, "0")}:${String(loadingSeconds % 60).padStart(2, "0")}`;
			const flipTransform = (node.flipX ? "scaleX(-1) " : "") + (node.flipY ? "scaleY(-1)" : "");
			const handleNodePointerDown = (event) => {
				if (event.button !== 0 || event.shiftKey) return;
				event.stopPropagation();
				if (isInteractiveTarget(event.target)) return;
				onNodePointerDown(event, node);
			};
			const handleResizePointerDown = (event, corner) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				if (node.locked) return;
				onResizePointerDown(event, node, corner);
			};
			const handleLinkPointerDown = (event) => {
				if (event.button !== 0) return;
				event.stopPropagation();
				onLinkPointerDown(event, node);
			};
			const handleDoubleClick = (event) => {
				event.stopPropagation();
				if (node.locked || editingBody) return;
				if (node.kind === "sticky" || node.kind === "text" || node.kind === "prompt") {
					setBodyInput(node.text ?? node.title ?? "");
					setEditingBody(true);
					return;
				}
				onOpenDetail(node);
			};
			const handleRenameSubmit = () => {
				setEditingTitle(false);
				if (titleInput.trim().length > 0) onRenameSubmit(node.id, titleInput.trim());
			};
			const handleBodySubmit = () => {
				setEditingBody(false);
				if (bodyInput !== (node.text ?? node.title ?? "")) onTextSubmit(node.id, bodyInput);
			};
			const handleBodyKeyDown = (event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					handleBodySubmit();
					return;
				}
				if (event.key === "Escape") {
					event.stopPropagation();
					setEditingBody(false);
				}
			};
			const handleContextMenu = (event) => {
				event.preventDefault();
				event.stopPropagation();
				onContextMenu(node, event.clientX, event.clientY);
			};
			const handleMediaLoad = (event) => {
				if (onMediaNatural === void 0) return;
				const element = event.currentTarget;
				const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
				const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
				if (naturalWidth > 0 && naturalHeight > 0) onMediaNatural(node.id, naturalWidth, naturalHeight);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: [
					"csNode",
					selected ? "csNodeSelected" : "",
					node.locked ? "csNodeLocked" : "",
					node.error !== void 0 ? "csNodeError" : "",
					node.isLoading ? "csNodeLoading" : ""
				].filter(Boolean).join(" "),
				style: {
					left: node.x,
					top: node.y,
					width: node.width,
					height: node.height,
					opacity
				},
				onPointerDown: handleNodePointerDown,
				onDoubleClick: handleDoubleClick,
				onContextMenu: handleContextMenu,
				"data-node-id": node.id,
				children: [
					isGroup ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeGroup",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csNodeKind",
							children: node.title ?? "分组"
						})
					}) : null,
					isMedia && node.url !== void 0 && !mediaFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeMediaBox",
						style: flipTransform ? { transform: flipTransform } : void 0,
						children: node.kind === "image" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: "csNodeMedia",
							src: node.url,
							alt: node.title ?? "image",
							draggable: false,
							onLoad: handleMediaLoad,
							onError: () => {
								setMediaFailed(true);
							}
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
							className: "csNodeMedia",
							src: node.url,
							controls: true,
							preload: "metadata",
							onLoadedMetadata: handleMediaLoad,
							onError: () => {
								setMediaFailed(true);
							}
						})
					}) : null,
					isMedia && mediaFailed && node.isLoading !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeText",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csNodeBadge csNodeBadgeError",
							children: ["媒体加载失败：", node.title ?? node.kind]
						})
					}),
					node.kind === "sticky" || node.kind === "text" || node.kind === "prompt" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csNodeText",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csNodeKind",
							children: KIND_LABEL[node.kind]
						}), editingBody ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "csNodeBodyEdit",
							value: bodyInput,
							autoFocus: true,
							onChange: (event) => {
								setBodyInput(event.target.value);
							},
							onBlur: handleBodySubmit,
							onKeyDown: handleBodyKeyDown
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csNodeBody",
							children: node.text ?? node.title ?? ""
						})]
					}) : null,
					selected && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "csNodeRing" }),
					node.isLoading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csNodeOverlay",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csNodeOverlayLabel",
								children: [
									TOOL_TITLES[node.toolName ?? ""] ?? "生成中…",
									" · ",
									loadingLabel
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csNodeProgress",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csNodeProgressBar" })
							}),
							loadingSeconds >= LOADING_SLOW_THRESHOLD && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csNodeOverlayHint",
								children: "耗时较久，可在详情面板或右键菜单打断"
							})
						]
					}),
					node.error !== void 0 && (canRetryNode(node) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csNodeBadge csNodeBadgeError csNodeBadgeRetry",
						title: `${node.error}\n点击重试（同参数重新生成）`,
						onClick: () => {
							onRetry(node.id);
						},
						children: "生成失败 · 点击重试"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csNodeBadge csNodeBadgeError",
						title: node.error,
						children: ["生成失败：", node.error]
					})),
					node.locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csNodeBadge csNodeBadgeLock",
						children: "🔒"
					}),
					editingTitle && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csNodeRename",
						value: titleInput,
						autoFocus: true,
						onChange: (event) => {
							setTitleInput(event.target.value);
						},
						onBlur: handleRenameSubmit,
						onKeyDown: (event) => {
							if (event.key === "Enter") handleRenameSubmit();
							if (event.key === "Escape") setEditingTitle(false);
						}
					}),
					!node.locked && isMedia && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [RESIZE_CORNERS.map((corner) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `csNodeResize csNodeResize${corner.toUpperCase()}`,
						onPointerDown: (event) => {
							handleResizePointerDown(event, corner);
						}
					}, corner)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeLinkHandle",
						title: "拖到其它节点建立血缘连线",
						onPointerDown: handleLinkPointerDown
					})] })
				]
			});
		}
		//#endregion
		//#region src/client/canvas/Minimap.tsx
		/** Minimap size in screen pixels. */
		const MINIMAP_WIDTH = 200;
		const MINIMAP_HEIGHT = 150;
		const PADDING = 20;
		/** Node color per kind (reference Minimap palette). */
		const NODE_COLORS = {
			image: "#f59e0b",
			video: "#8b5cf6",
			sticky: "#fbbf24",
			text: "#fafaf9",
			prompt: "#3b82f6",
			group: "rgba(99, 102, 241, 0.5)"
		};
		/**
		* Content-fit minimap: every node as a colored rect, the current viewport as
		* a draggable frame. Click/drag jumps the canvas so the viewport centers on
		* the minimap position (reference Minimap behavior).
		*/
		function Minimap(props) {
			const { nodes, offset, scale, onSetOffset, viewportWidth, viewportHeight } = props;
			const containerRef = (0, react.useRef)(null);
			const [isDragging, setIsDragging] = (0, react.useState)(false);
			const contentBounds = (0, react.useMemo)(() => {
				let minX = Infinity;
				let minY = Infinity;
				let maxX = -Infinity;
				let maxY = -Infinity;
				for (const node of nodes) {
					minX = Math.min(minX, node.x);
					minY = Math.min(minY, node.y);
					maxX = Math.max(maxX, node.x + node.width);
					maxY = Math.max(maxY, node.y + node.height);
				}
				if (minX === Infinity) return {
					x: 0,
					y: 0,
					width: 1e3,
					height: 1e3
				};
				return {
					x: minX - PADDING,
					y: minY - PADDING,
					width: Math.max(maxX - minX + PADDING * 2, 1e3),
					height: Math.max(maxY - minY + PADDING * 2, 1e3)
				};
			}, [nodes]);
			const fitScale = (0, react.useMemo)(() => {
				return Math.min(MINIMAP_WIDTH / contentBounds.width, MINIMAP_HEIGHT / contentBounds.height);
			}, [contentBounds]);
			const vw = viewportWidth > 0 ? viewportWidth : window.innerWidth;
			const vh = viewportHeight > 0 ? viewportHeight : window.innerHeight;
			const jumpTo = (0, react.useCallback)((clientX, clientY) => {
				const rect = containerRef.current?.getBoundingClientRect();
				if (rect === void 0 || rect === null) return;
				const minimapX = clientX - rect.left;
				const minimapY = clientY - rect.top;
				const worldX = minimapX / fitScale + contentBounds.x;
				const worldY = minimapY / fitScale + contentBounds.y;
				onSetOffset({
					x: vw / 2 - worldX * scale,
					y: vh / 2 - worldY * scale
				});
			}, [
				fitScale,
				contentBounds,
				scale,
				onSetOffset,
				vw,
				vh
			]);
			(0, react.useEffect)(() => {
				if (!isDragging) return;
				const handleMove = (event) => jumpTo(event.clientX, event.clientY);
				const handleUp = () => setIsDragging(false);
				window.addEventListener("mousemove", handleMove);
				window.addEventListener("mouseup", handleUp);
				return () => {
					window.removeEventListener("mousemove", handleMove);
					window.removeEventListener("mouseup", handleUp);
				};
			}, [isDragging, jumpTo]);
			const viewport = {
				x: -offset.x / scale,
				y: -offset.y / scale,
				width: vw / scale,
				height: vh / scale
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: containerRef,
				className: "csMinimap",
				onMouseDown: () => {
					setIsDragging(true);
				},
				onMouseUp: () => {
					setIsDragging(false);
				},
				onMouseLeave: () => {
					setIsDragging(false);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: MINIMAP_WIDTH,
					height: MINIMAP_HEIGHT,
					children: [nodes.map((node) => {
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: (node.x - contentBounds.x) * fitScale,
							y: (node.y - contentBounds.y) * fitScale,
							width: Math.max(node.width * fitScale, 2),
							height: Math.max(node.height * fitScale, 2),
							fill: NODE_COLORS[node.kind],
							opacity: .8
						}, node.id);
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: (viewport.x - contentBounds.x) * fitScale,
						y: (viewport.y - contentBounds.y) * fitScale,
						width: viewport.width * fitScale,
						height: viewport.height * fitScale,
						fill: "transparent",
						stroke: "rgba(255, 255, 255, 0.6)",
						strokeWidth: 1,
						style: { cursor: isDragging ? "grabbing" : "grab" }
					})]
				})
			});
		}
		//#endregion
		//#region src/client/canvas/CanvasSurface.tsx
		const ZOOM_STEP$1 = 1.2;
		const MIN_NODE_SIZE = 50;
		/**
		* The infinite canvas: a grid background that pans/zooms with content, node
		* boxes placed at their canvas-space coordinates, the bloodline edge overlay,
		* snap alignment guides, a minimap, and corner zoom controls.
		*
		* The viewport (`offset`/`scale`) is controlled: it lives in the project store
		* so it survives restarts (canvas.json v3) and project switches. Interactions
		* follow the reference canvas controls: background pointer-down pans (middle
		* button or Shift+left also pan), wheel without modifiers pans, Ctrl/Cmd+wheel
		* zooms around the cursor, node pointer-down begins a node drag (snap
		* alignment + guides), the node's resize handles begin a resize, and the link
		* handle begins a manual connection drag. Keyboard: Delete removes the
		* selection, Ctrl/Cmd+C/V copy/paste, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
		* undo/redo, Ctrl/Cmd+A selects all, Escape clears the selection.
		*/
		const CanvasSurface = (0, react.forwardRef)(function CanvasSurface(props, ref) {
			const { nodes, view, onViewChange, selectedNodeIds, onSelectNode, onSelectAllNodes, onMoveNode, onUpdateNode, onBeginEdit, onPersist, onRemoveNodes, onCopy, onPaste, onUndo, onRedo, onLinkLayers, onRename, onNodeTextSubmit, onNodeOpenDetail, onContextMenu, onRetry, onMediaNatural, focusNodeId, minimapVisible = true } = props;
			const [guides, setGuides] = (0, react.useState)({
				vertical: [],
				horizontal: []
			});
			const [linkLine, setLinkLine] = (0, react.useState)(null);
			const containerRef = (0, react.useRef)(null);
			const [surfaceSize, setSurfaceSize] = (0, react.useState)({
				width: 0,
				height: 0
			});
			(0, react.useEffect)(() => {
				const el = containerRef.current;
				if (el === null) return;
				const update = () => {
					setSurfaceSize({
						width: el.clientWidth,
						height: el.clientHeight
					});
				};
				update();
				const observer = new ResizeObserver(update);
				observer.observe(el);
				return () => {
					observer.disconnect();
				};
			}, []);
			const viewRef = (0, react.useRef)(view);
			viewRef.current = view;
			const onViewChangeRef = (0, react.useRef)(onViewChange);
			onViewChangeRef.current = onViewChange;
			const gesture = (0, react.useRef)({
				mode: "none",
				startX: 0,
				startY: 0
			});
			const nodesRef = (0, react.useRef)(nodes);
			nodesRef.current = nodes;
			const lastFocusedRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (focusNodeId === void 0 || focusNodeId === null) {
					lastFocusedRef.current = null;
					return;
				}
				if (lastFocusedRef.current === focusNodeId) return;
				lastFocusedRef.current = focusNodeId;
				const node = nodesRef.current.find((candidate) => candidate.id === focusNodeId);
				const el = containerRef.current;
				if (node === void 0 || el === null) return;
				const cx = node.x + node.width / 2;
				const cy = node.y + node.height / 2;
				onViewChangeRef.current({
					x: el.clientWidth / 2 - cx * viewRef.current.scale,
					y: el.clientHeight / 2 - cy * viewRef.current.scale
				});
			}, [focusNodeId]);
			const panBy = (0, react.useCallback)((deltaX, deltaY) => {
				onViewChangeRef.current({
					x: viewRef.current.x + deltaX,
					y: viewRef.current.y + deltaY
				});
			}, []);
			const zoomAround = (0, react.useCallback)((pointX, pointY, factor) => {
				const el = containerRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				const px = pointX - rect.left;
				const py = pointY - rect.top;
				const newScale = clamp(viewRef.current.scale * factor, MIN_VIEW_SCALE, 5);
				const wx = (px - viewRef.current.x) / viewRef.current.scale;
				const wy = (py - viewRef.current.y) / viewRef.current.scale;
				onViewChangeRef.current({
					x: px - wx * newScale,
					y: py - wy * newScale,
					scale: newScale
				});
			}, []);
			(0, react.useEffect)(() => {
				const el = containerRef.current;
				if (el === null) return;
				const onWheel = (event) => {
					event.preventDefault();
					if (event.ctrlKey || event.metaKey) zoomAround(event.clientX, event.clientY, event.deltaY < 0 ? ZOOM_STEP$1 : 1 / ZOOM_STEP$1);
					else panBy(-event.deltaX, -event.deltaY);
				};
				el.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					el.removeEventListener("wheel", onWheel);
				};
			}, [zoomAround, panBy]);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					const target = event.target;
					if (target !== null && target.closest("input, textarea, select, [contenteditable=\"true\"]") !== null) return;
					const modifier = event.ctrlKey || event.metaKey;
					if (modifier && event.key.toLowerCase() === "z") {
						event.preventDefault();
						if (event.shiftKey) onRedo();
						else onUndo();
						return;
					}
					if (modifier && event.key.toLowerCase() === "y") {
						event.preventDefault();
						onRedo();
						return;
					}
					if (modifier && event.key.toLowerCase() === "c") {
						event.preventDefault();
						onCopy();
						return;
					}
					if (modifier && event.key.toLowerCase() === "v") {
						event.preventDefault();
						onPaste();
						return;
					}
					if (modifier && event.key.toLowerCase() === "a") {
						event.preventDefault();
						onSelectAllNodes();
						return;
					}
					if (event.key === "Delete" || event.key === "Backspace") {
						if (selectedNodeIds.length > 0) onRemoveNodes([...selectedNodeIds]);
						return;
					}
					if (event.key === "Escape") {
						onSelectNode(null);
						return;
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [
				selectedNodeIds,
				onSelectNode,
				onSelectAllNodes,
				onRemoveNodes,
				onCopy,
				onPaste,
				onUndo,
				onRedo
			]);
			const fitToContent = (0, react.useCallback)(() => {
				const el = containerRef.current;
				if (el === null) return;
				const bounds = contentBounds(nodesRef.current);
				const vw = el.clientWidth;
				const vh = el.clientHeight;
				if (bounds === null) {
					onViewChangeRef.current({
						x: 0,
						y: 0,
						scale: 1
					});
					return;
				}
				const padding = 60;
				const scaleX = (vw - padding * 2) / bounds.width;
				const scaleY = (vh - padding * 2) / bounds.height;
				const newScale = clamp(Math.min(scaleX, scaleY), MIN_VIEW_SCALE, 5);
				const centerX = bounds.x + bounds.width / 2;
				const centerY = bounds.y + bounds.height / 2;
				onViewChangeRef.current({
					x: vw / 2 - centerX * newScale,
					y: vh / 2 - centerY * newScale,
					scale: newScale
				});
			}, []);
			const zoomBy = (0, react.useCallback)((factor) => {
				const el = containerRef.current;
				if (el === null) return;
				zoomAround(el.clientWidth / 2, el.clientHeight / 2, factor);
			}, [zoomAround]);
			const resetZoom = (0, react.useCallback)(() => {
				onViewChangeRef.current({
					x: 0,
					y: 0,
					scale: 1
				});
			}, []);
			const onSurfacePointerDown = (event) => {
				if (event.button === 1 || event.button === 0 && event.shiftKey) {
					gesture.current = {
						mode: "pan",
						startX: event.clientX,
						startY: event.clientY
					};
					event.preventDefault();
					return;
				}
				if (event.button !== 0) return;
				gesture.current = {
					mode: "pan",
					startX: event.clientX,
					startY: event.clientY
				};
				if (!event.shiftKey) onSelectNode(null);
			};
			const onNodePointerDown = (event, node) => {
				onSelectNode(node.id, event.ctrlKey || event.metaKey);
				if (node.locked) return;
				onBeginEdit();
				gesture.current = {
					mode: "node",
					startX: event.clientX,
					startY: event.clientY,
					nodeId: node.id,
					originX: node.x,
					originY: node.y
				};
			};
			const onResizePointerDown = (event, node, corner) => {
				onSelectNode(node.id);
				onBeginEdit();
				gesture.current = {
					mode: "resize",
					startX: event.clientX,
					startY: event.clientY,
					nodeId: node.id,
					originX: node.x,
					originY: node.y,
					originWidth: node.width,
					originHeight: node.height,
					corner
				};
			};
			const onLinkPointerDown = (event, node) => {
				const anchor = sourceAnchor(node);
				const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
				gesture.current = {
					mode: "link",
					startX: event.clientX,
					startY: event.clientY,
					sourceId: node.id,
					fromWorldX: anchor.x,
					fromWorldY: anchor.y
				};
				setLinkLine({
					fromX: anchor.x,
					fromY: anchor.y,
					toX: world.x,
					toY: world.y
				});
			};
			const onPointerMove = (event) => {
				const current = gesture.current;
				if (current.mode === "none") return;
				if (event.pointerType === "mouse" && event.buttons === 0) {
					onPointerUp(event);
					return;
				}
				if (containerRef.current === null) return;
				if (current.mode === "pan") {
					panBy(event.clientX - current.startX, event.clientY - current.startY);
					current.startX = event.clientX;
					current.startY = event.clientY;
					return;
				}
				if (current.mode === "node" && current.nodeId !== void 0 && current.originX !== void 0 && current.originY !== void 0) {
					const dx = (event.clientX - current.startX) / viewRef.current.scale;
					const dy = (event.clientY - current.startY) / viewRef.current.scale;
					const targetX = current.originX + dx;
					const targetY = current.originY + dy;
					const dragged = nodesRef.current.find((candidate) => candidate.id === current.nodeId);
					if (dragged === void 0) return;
					const snapped = calculateSnap(nodesRef.current, dragged, targetX, targetY);
					onMoveNode(current.nodeId, snapped.x, snapped.y);
					setGuides({
						vertical: snapped.guides.filter((guide) => guide.type === "vertical").map((guide) => guide.position),
						horizontal: snapped.guides.filter((guide) => guide.type === "horizontal").map((guide) => guide.position)
					});
					return;
				}
				if (current.mode === "resize" && current.nodeId !== void 0 && current.originX !== void 0 && current.originY !== void 0 && current.originWidth !== void 0 && current.originHeight !== void 0 && current.corner !== void 0) {
					const dx = (event.clientX - current.startX) / viewRef.current.scale;
					const dy = (event.clientY - current.startY) / viewRef.current.scale;
					const corner = current.corner;
					let x = current.originX;
					let y = current.originY;
					let width = current.originWidth;
					let height = current.originHeight;
					if (corner.includes("e")) width = Math.max(MIN_NODE_SIZE, current.originWidth + dx);
					if (corner.includes("s")) height = Math.max(MIN_NODE_SIZE, current.originHeight + dy);
					if (corner.includes("w")) {
						width = Math.max(MIN_NODE_SIZE, current.originWidth - dx);
						x = current.originX + current.originWidth - width;
					}
					if (corner.includes("n")) {
						height = Math.max(MIN_NODE_SIZE, current.originHeight - dy);
						y = current.originY + current.originHeight - height;
					}
					onUpdateNode(current.nodeId, {
						x,
						y,
						width,
						height
					});
					return;
				}
				if (current.mode === "link" && current.fromWorldX !== void 0 && current.fromWorldY !== void 0) {
					const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
					setLinkLine({
						fromX: current.fromWorldX,
						fromY: current.fromWorldY,
						toX: world.x,
						toY: world.y
					});
				}
			};
			const onPointerUp = (event) => {
				const current = gesture.current;
				if (current.mode === "link" && current.sourceId !== void 0) {
					const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
					const target = nodesRef.current.find((candidate) => candidate.id !== current.sourceId && candidate.visible !== false && world.x >= candidate.x && world.x <= candidate.x + candidate.width && world.y >= candidate.y && world.y <= candidate.y + candidate.height);
					if (target !== void 0) onLinkLayers([current.sourceId], target.id);
					setLinkLine(null);
					onPersist();
				}
				if (current.mode === "node" || current.mode === "resize") onPersist();
				setGuides({
					vertical: [],
					horizontal: []
				});
				gesture.current = {
					mode: "none",
					startX: 0,
					startY: 0
				};
			};
			const visibleNodes = nodes.filter((node) => node.visible !== false);
			const ordered = [...visibleNodes].sort(compareNodes);
			(0, react.useImperativeHandle)(ref, () => ({
				zoomBy,
				fitToContent,
				resetZoom
			}), [
				zoomBy,
				fitToContent,
				resetZoom
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csCanvasSurface",
				ref: containerRef,
				onPointerDown: onSurfacePointerDown,
				onPointerMove,
				onPointerUp,
				onPointerLeave: () => {
					if (gesture.current.mode !== "none") onPointerUp(new MouseEvent("pointerup"));
				},
				style: {
					backgroundPosition: `${view.x}px ${view.y}px`,
					backgroundSize: `${40 * view.scale}px ${40 * view.scale}px`
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csCanvasLayer",
					style: {
						transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
						transformOrigin: "0 0"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasEdges, {
							nodes: visibleNodes,
							selectedNodeIds,
							scale: view.scale
						}),
						guides.vertical.map((position) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csGuide csGuideVertical",
							style: { left: position }
						}, `gv-${position}`)),
						guides.horizontal.map((position) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csGuide csGuideHorizontal",
							style: { top: position }
						}, `gh-${position}`)),
						ordered.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasNode, {
							node,
							selected: selectedNodeIds.includes(node.id),
							onNodePointerDown,
							onResizePointerDown,
							onLinkPointerDown,
							onRenameSubmit: onRename,
							onTextSubmit: onNodeTextSubmit,
							onOpenDetail: onNodeOpenDetail,
							onContextMenu,
							onRetry,
							...onMediaNatural !== void 0 ? { onMediaNatural } : {}
						}, node.id)),
						linkLine !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: "csEdges",
							width: 1,
							height: 1,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								className: "csEdge csEdgeDraft",
								d: buildEdgePath({
									x: linkLine.fromX,
									y: linkLine.fromY
								}, {
									x: linkLine.toX,
									y: linkLine.toY
								})
							})
						})
					]
				}), minimapVisible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Minimap, {
					nodes: visibleNodes,
					offset: {
						x: view.x,
						y: view.y
					},
					scale: view.scale,
					onSetOffset: (next) => {
						onViewChangeRef.current({
							x: next.x,
							y: next.y
						});
					},
					viewportWidth: surfaceSize.width,
					viewportHeight: surfaceSize.height
				})]
			});
		});
		//#endregion
		//#region src/client/canvas/CanvasTimeline.tsx
		/** Short HH:MM:SS label for a node timestamp. */
		function timeLabel(createdAt) {
			const date = new Date(createdAt);
			if (Number.isNaN(date.getTime())) return "-";
			return date.toLocaleTimeString();
		}
		/**
		* The review strip: every node of the project as a thumbnail chip. Clicking a
		* chip selects the node and (via the parent) centers it on the surface — this
		* is the "回看" entry point. P9.1: chips are drag-reorderable; the resulting
		* order persists via view.timeline and later feeds compose 的 clipIds。
		*/
		function CanvasTimeline(props) {
			const { ordered, selectedNodeId, onSelect, onReorder, onCompose, composeBusy } = props;
			const [dragIndex, setDragIndex] = (0, react.useState)(null);
			const [hoverIndex, setHoverIndex] = (0, react.useState)(null);
			const clipCount = ordered.filter((node) => node.kind === "video").length;
			const handleDrop = (targetIndex) => {
				if (dragIndex === null || dragIndex === targetIndex) {
					setDragIndex(null);
					setHoverIndex(null);
					return;
				}
				const ids = ordered.map((node) => node.id);
				const [moved] = ids.splice(dragIndex, 1);
				if (moved !== void 0) ids.splice(targetIndex, 0, moved);
				onReorder(ids);
				setDragIndex(null);
				setHoverIndex(null);
			};
			if (ordered.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csTimeline csTimelineEmpty",
				children: "尚无产物 —— 在右侧对话让 agent 生成后，按时间线回看"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csTimeline",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csTimelineToolbar",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csTimelineCount",
						children: ["视频片段 ", clipCount]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csPrimary",
						disabled: clipCount < 2 || composeBusy,
						title: clipCount < 2 ? "至少排列 2 个视频片段才能导出成片" : "选中的视频片段将按顺序拼接成片",
						onClick: () => {
							onCompose();
						},
						children: composeBusy ? "合成中…" : "合成导出成片"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csTimelineStrip",
					children: ordered.map((node, index) => {
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: [
								"csTimelineItem",
								node.id === selectedNodeId ? "csTimelineItemActive" : "",
								index === hoverIndex && dragIndex !== null && dragIndex !== index ? "csTimelineItemTarget" : ""
							].filter(Boolean).join(" "),
							draggable: true,
							onDragStart: () => {
								setDragIndex(index);
							},
							onDragOver: (event) => {
								if (dragIndex === null) return;
								event.preventDefault();
								setHoverIndex(index);
							},
							onDrop: (event) => {
								event.preventDefault();
								handleDrop(index);
							},
							onDragEnd: () => {
								setDragIndex(null);
								setHoverIndex(null);
							},
							onClick: () => {
								onSelect(node.id);
							},
							title: `${node.title ?? KIND_LABEL[node.kind]} · 拖拽排序`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csTimelineThumb",
								children: [
									node.kind === "image" && node.url ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
										src: node.url,
										alt: node.title ?? "image",
										draggable: false
									}) : null,
									node.kind === "video" && node.url ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
										src: node.url,
										muted: true,
										preload: "metadata"
									}) : null,
									node.kind !== "image" && node.kind !== "video" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csTimelineKind",
										children: KIND_LABEL[node.kind]
									}) : null
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csTimelineTime",
								children: timeLabel(node.createdAt)
							})]
						}, node.id);
					})
				})]
			});
		}
		//#endregion
		//#region src/client/canvas/LayerPanel.tsx
		/**
		* The layer list: every node as a row with thumbnail/kind, lock and visibility
		* toggles, z-order buttons, and delete. Click selects (ctrl/cmd multi-select);
		* group members indent under their group row. Reference LayerPanel semantics,
		* rendered with the DSH theme tokens.
		*/
		function LayerPanel(props) {
			const { nodes, selectedNodeIds, onSelect, onDelete, onToggleLock, onToggleVisibility, onReorder } = props;
			const [query, setQuery] = (0, react.useState)("");
			const selected = new Set(selectedNodeIds);
			const ordered = [...nodes].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
			const filtered = query.trim().length > 0 ? ordered.filter((node) => (node.title ?? "").toLowerCase().includes(query.trim().toLowerCase())) : ordered;
			const grouped = filtered.filter((node) => node.parentId === void 0);
			const membersByGroup = /* @__PURE__ */ new Map();
			for (const node of filtered) {
				if (node.parentId === void 0) continue;
				const list = membersByGroup.get(node.parentId) ?? [];
				list.push(node);
				membersByGroup.set(node.parentId, list);
			}
			const renderRow = (node, depth) => {
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `csLayerRow${selected.has(node.id) ? " csLayerRowActive" : ""}`,
					style: { paddingLeft: `${depth * 14 + 6}px` },
					onClick: (event) => {
						onSelect(node.id, event.ctrlKey || event.metaKey);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csLayerThumb",
							children: node.kind === "image" && node.url !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: node.url,
								alt: "",
								draggable: false
							}) : node.kind === "video" && node.url !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
								src: node.url,
								muted: true,
								preload: "metadata"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csLayerThumbKind",
								children: KIND_LABEL[node.kind]
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csLayerTitle",
							children: node.title ?? KIND_LABEL[node.kind]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csLayerActions",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: node.locked ? "csLayerAction csLayerActionActive" : "csLayerAction",
									title: node.locked ? "解锁" : "锁定",
									onClick: (event) => {
										event.stopPropagation();
										onToggleLock(node.id);
									},
									children: node.locked ? "🔒" : "🔓"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: node.visible === false ? "csLayerAction" : "csLayerAction csLayerActionActive",
									title: node.visible === false ? "显示" : "隐藏",
									onClick: (event) => {
										event.stopPropagation();
										onToggleVisibility(node.id);
									},
									children: node.visible === false ? "👁️‍🗨️" : "👁️"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csLayerAction",
									title: "置顶",
									onClick: (event) => {
										event.stopPropagation();
										onReorder(node.id, "front");
									},
									children: "↑↑"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csLayerAction",
									title: "置底",
									onClick: (event) => {
										event.stopPropagation();
										onReorder(node.id, "back");
									},
									children: "↓↓"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csLayerAction csLayerActionDanger",
									title: "删除",
									onClick: (event) => {
										event.stopPropagation();
										onDelete([node.id]);
									},
									children: "×"
								})
							]
						})
					]
				}), (membersByGroup.get(node.id) ?? []).map((member) => renderRow(member, depth + 1))] }, node.id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: "csLayerPanel",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "csLayerPanelHeader",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "图层" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "csLayerSearch",
						placeholder: "搜索图层…",
						value: query,
						onChange: (event) => {
							setQuery(event.target.value);
						}
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csLayerList",
					children: grouped.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csLayerEmpty",
						children: "暂无图层"
					}) : grouped.map((node) => renderRow(node, 0))
				})]
			});
		}
		//#endregion
		//#region src/client/canvas/LayerDetailPanel.tsx
		/**
		* 宽松解析 generationPrompt（节点级重试的回放锚点）。仅用于展示：解析失败
		* （旧数据 / 手改）时返回 null，详情面板回退原始 JSON 展示，不影响重试。
		*/
		function parseGenerationParams(raw) {
			if (raw === void 0 || raw.length === 0) return null;
			try {
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
				return {
					...typeof parsed.prompt === "string" && parsed.prompt.length > 0 ? { prompt: parsed.prompt } : {},
					...typeof parsed.filename === "string" ? { filename: parsed.filename } : {},
					...Array.isArray(parsed.filenames) ? { filenames: parsed.filenames.map(String) } : {},
					...typeof parsed.styleFilename === "string" ? { styleFilename: parsed.styleFilename } : {},
					...typeof parsed.aspectRatio === "string" ? { aspectRatio: parsed.aspectRatio } : {},
					...typeof parsed.duration === "number" ? { duration: parsed.duration } : {},
					...typeof parsed.negativePrompt === "string" && parsed.negativePrompt.length > 0 ? { negativePrompt: parsed.negativePrompt } : {}
				};
			} catch {
				return null;
			}
		}
		/**
		* The layer detail panel: edit the selected node's title, opacity, flip,
		* lock/visibility, z-order, and run node-level generation actions (retry /
		* steer / cancel). Reference LayerDetailPanel semantics, DSH tokens.
		*/
		function LayerDetailPanel(props) {
			const { node, allNodes, onClose, onRename, onSetOpacity, onToggleFlip, onToggleLock, onToggleVisibility, onReorder, onDelete, onRetry, onSteer, onCancel, onUpdateNode, onReferenceToChat, onDownload } = props;
			const [editingTitle, setEditingTitle] = (0, react.useState)(false);
			const [titleInput, setTitleInput] = (0, react.useState)(node.title ?? "");
			const [steering, setSteering] = (0, react.useState)(false);
			const [steerInput, setSteerInput] = (0, react.useState)("");
			const [copiedPrompt, setCopiedPrompt] = (0, react.useState)(false);
			const isAgent = node.origin === "agent" && node.toolName !== void 0;
			const operation = node.operationType !== void 0 ? OPERATION_LABELS[node.operationType] ?? node.operationType : null;
			const generationPrompt = node.generationPrompt !== void 0 ? node.generationPrompt : null;
			const parsedParams = parseGenerationParams(node.generationPrompt);
			const referenceNodes = parsedParams === null ? [] : [...new Set([
				parsedParams.filename,
				parsedParams.styleFilename,
				...parsedParams.filenames ?? []
			].filter((name) => name !== void 0 && name.length > 0))].map((name) => allNodes.find((candidate) => candidate.filename === name)).filter((candidate) => candidate !== void 0);
			const copyPrompt = () => {
				if (parsedParams?.prompt === void 0) return;
				navigator.clipboard?.writeText(parsedParams.prompt).then(() => {
					setCopiedPrompt(true);
					setTimeout(() => {
						setCopiedPrompt(false);
					}, 1500);
				});
			};
			/** 媒体原始分辨率文本（mediaWidth/Height 为真实产物分辨率；缺失显示未知）。 */
			const resolutionText = () => {
				const w = node.mediaWidth;
				const h = node.mediaHeight;
				return w !== void 0 && h !== void 0 ? `${w}×${h}` : "未知";
			};
			const submitTitle = () => {
				setEditingTitle(false);
				if (titleInput.trim().length > 0) onRename(node.id, titleInput.trim());
			};
			const submitSteer = () => {
				setSteering(false);
				if (steerInput.trim().length > 0) onSteer(node.id, steerInput.trim());
			};
			const formatTime = (value) => {
				const date = new Date(value);
				return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: "csDetailPanel",
				onClick: (event) => {
					event.stopPropagation();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "csDetailPanelHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "节点属性" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csDetailPanelClose",
							onClick: onClose,
							children: "×"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csDetailPanelBody",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "标题"
								}), editingTitle ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csDetailInput",
									value: titleInput,
									autoFocus: true,
									onChange: (event) => {
										setTitleInput(event.target.value);
									},
									onBlur: submitTitle,
									onKeyDown: (event) => {
										if (event.key === "Enter") submitTitle();
										if (event.key === "Escape") setEditingTitle(false);
									}
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailValue csDetailValueClickable",
									onClick: () => {
										setTitleInput(node.title ?? "");
										setEditingTitle(true);
									},
									children: node.title ?? KIND_LABEL[node.kind]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "类型"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "csDetailValue",
									children: [KIND_LABEL[node.kind], operation !== null ? ` · ${operation}` : ""]
								})]
							}),
							node.toolName !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "工具"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailValue",
									children: node.toolName
								})]
							}),
							(node.kind === "sticky" || node.kind === "text" || node.kind === "prompt") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow csDetailRowTop",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "正文"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: "csDetailTextarea",
									rows: 5,
									defaultValue: node.text ?? node.title ?? "",
									onBlur: (event) => {
										const next = event.target.value;
										if (next !== (node.text ?? node.title ?? "")) onUpdateNode(node.id, { text: next });
									}
								}, node.id)]
							}),
							node.duration !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "时长"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "csDetailValue",
									children: [node.duration, "s"]
								})]
							}),
							(node.kind === "image" || node.kind === "video") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "分辨率"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailValue",
									children: resolutionText()
								})]
							}),
							node.script !== void 0 && node.script.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "文案"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
									className: "csDetailPrompt",
									children: node.script
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "创建时间"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailValue",
									children: formatTime(node.createdAt)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csDetailLabel",
										children: "透明度"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csDetailRange",
										type: "range",
										min: 0,
										max: 100,
										value: Math.round((node.opacity ?? 1) * 100),
										onChange: (event) => {
											onSetOpacity(node.id, Number(event.target.value) / 100);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csDetailValue",
										children: [Math.round((node.opacity ?? 1) * 100), "%"]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csDetailLabel",
										children: "镜像"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: node.flipX ? "csDetailButton csDetailButtonActive" : "csDetailButton",
										onClick: () => {
											onToggleFlip(node.id, "flipX");
										},
										children: "水平"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: node.flipY ? "csDetailButton csDetailButtonActive" : "csDetailButton",
										onClick: () => {
											onToggleFlip(node.id, "flipY");
										},
										children: "垂直"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csDetailLabel",
										children: "锁定 / 可见"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: node.locked ? "csDetailButton csDetailButtonActive" : "csDetailButton",
										onClick: () => {
											onToggleLock(node.id);
										},
										children: node.locked ? "已锁定" : "锁定"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: node.visible === false ? "csDetailButton" : "csDetailButton csDetailButtonActive",
										onClick: () => {
											onToggleVisibility(node.id, node.visible === false);
										},
										children: node.visible === false ? "已隐藏" : "可见"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csDetailLabel",
										children: "层级"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "csDetailButton",
										onClick: () => {
											onReorder(node.id, "front");
										},
										children: "置顶"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "csDetailButton",
										onClick: () => {
											onReorder(node.id, "back");
										},
										children: "置底"
									})
								]
							}),
							node.kind === "image" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailSection",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "csDetailRow",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailLabel",
											children: "参考图"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: node.isReference ? "csDetailButton csDetailButtonActive" : "csDetailButton",
											onClick: () => {
												onUpdateNode(node.id, { isReference: !node.isReference });
											},
											children: node.isReference ? "已标记" : "标记为参考"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csDetailButton",
											onClick: () => {
												onReferenceToChat(node);
											},
											children: "引用到对话"
										})
									]
								}), node.isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "csDetailRow",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csDetailLabel",
										children: "角色"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: "csDetailSelect",
										value: node.referenceRole ?? "image",
										onChange: (event) => {
											onUpdateNode(node.id, { referenceRole: event.target.value });
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "image",
												children: "构图/通用"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "character",
												children: "角色"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "style",
												children: "风格"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "frame",
												children: "首末帧"
											})
										]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "csDetailRow",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailLabel",
											children: "强度"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "csDetailRange",
											type: "range",
											min: 0,
											max: 100,
											value: Math.round((node.referenceStrength ?? 1) * 100),
											onChange: (event) => {
												onUpdateNode(node.id, { referenceStrength: Number(event.target.value) / 100 });
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "csDetailValue",
											children: [Math.round((node.referenceStrength ?? 1) * 100), "%"]
										})
									]
								})] })]
							}),
							generationPrompt !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailSection",
								children: [
									parsedParams?.prompt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csDetailRow",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csDetailLabel",
												children: "提示词"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
												className: "csDetailPrompt",
												children: parsedParams.prompt
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csDetailButton",
												onClick: copyPrompt,
												children: copiedPrompt ? "已复制" : "复制"
											})
										]
									}),
									referenceNodes.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csDetailRow",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailLabel",
											children: "参考图"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailRefThumbs",
											children: referenceNodes.map((ref) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
												className: "csDetailRefThumb",
												src: ref.url ?? "",
												alt: ref.title ?? ref.filename ?? "",
												title: ref.title ?? ref.filename ?? ""
											}, ref.id))
										})]
									}),
									(parsedParams?.aspectRatio !== void 0 || parsedParams?.duration !== void 0 || parsedParams?.negativePrompt !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csDetailRow",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailLabel",
											children: "参数"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailValue",
											children: [
												parsedParams?.aspectRatio,
												parsedParams?.duration !== void 0 ? `${parsedParams.duration}s` : void 0,
												parsedParams?.negativePrompt !== void 0 ? `负向：${parsedParams.negativePrompt}` : void 0
											].filter(Boolean).join(" · ")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csDetailRow",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csDetailLabel",
											children: "生成参数"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
											className: "csDetailRaw",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "原始 JSON" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
												className: "csDetailPrompt",
												children: generationPrompt
											})]
										})]
									})
								]
							}),
							node.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "错误"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailError",
									children: node.error
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "操作"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "csDetailActions",
									children: [
										node.isLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csDetailButton",
											onClick: () => {
												onCancel(node.id);
											},
											children: "打断"
										}) : null,
										isAgent && generationPrompt !== null && !node.isLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csDetailButton",
											onClick: () => {
												onRetry(node.id);
											},
											children: "重试"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csDetailButton",
											onClick: () => {
												setSteerInput(parsedParams?.prompt ?? "");
												setSteering(true);
											},
											children: "修改提示词"
										})] }) : null,
										canDownloadNode(node) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csDetailButton",
											onClick: () => {
												onDownload(node);
											},
											children: "下载资产"
										}) : null,
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csDetailButton csDetailButtonDanger",
											onClick: () => {
												onDelete(node.id);
											},
											children: "删除"
										})
									]
								})]
							})
						]
					}),
					steering && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csDetailSteer",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "csDetailInput",
							placeholder: "新的提示词…（沿用原参考图重新生成）",
							value: steerInput,
							autoFocus: true,
							onChange: (event) => {
								setSteerInput(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") submitSteer();
								if (event.key === "Escape") setSteering(false);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csDetailActions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csDetailButton",
								onClick: submitSteer,
								children: "提交"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csDetailButton",
								onClick: () => {
									setSteering(false);
								},
								children: "取消"
							})]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/canvas/CanvasContextMenu.tsx
		/**
		* The node context menu: edit/order/state actions plus generation actions.
		* Positioned at the cursor; closes on any action or when a press lands
		* outside the menu (CV-037). The forwarded ref points at the menu root so the
		* owner can tell inside from outside presses.
		*/
		const CanvasContextMenu = (0, react.forwardRef)(function CanvasContextMenu(props, ref) {
			const { node, x, y, onClose, onRename, onCopy, onDelete, onReorder, onToggleLock, onToggleVisibility, onRetry, onSteer, onCancel, onUngroup, onReferenceToChat, onDownload } = props;
			const isAgent = node.origin === "agent" && node.toolName !== void 0;
			const hasPrompt = node.generationPrompt !== void 0;
			const item = (label, action, danger = false) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: `csMenuAction${danger ? " csMenuActionDanger" : ""}`,
				disabled: action === null,
				onClick: () => {
					onClose();
					if (action !== null) action();
				},
				children: label
			}, label);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref,
				className: "csContextMenu",
				style: {
					left: x,
					top: y
				},
				onContextMenu: (event) => {
					event.preventDefault();
					event.stopPropagation();
				},
				children: [
					item("重命名", () => {
						onRename(node.id);
					}),
					item("复制", () => {
						onCopy(node.id);
					}),
					item("引用到对话", () => {
						onReferenceToChat(node.id);
					}),
					canDownloadNode(node) && item("下载资产", () => {
						onDownload(node.id);
					}),
					item(node.locked ? "解锁" : "锁定", () => {
						onToggleLock(node.id);
					}),
					item(node.visible === false ? "显示" : "隐藏", () => {
						onToggleVisibility(node.id);
					}),
					item("置顶", () => {
						onReorder(node.id, "front");
					}),
					item("置底", () => {
						onReorder(node.id, "back");
					}),
					item("上移一层", () => {
						onReorder(node.id, "forward");
					}),
					item("下移一层", () => {
						onReorder(node.id, "backward");
					}),
					node.kind === "group" && item("解组", () => {
						onUngroup(node.id);
					}),
					node.isLoading && item("打断", () => {
						onCancel(node.id);
					}),
					isAgent && hasPrompt && !node.isLoading && item("重试（同参数重新生成）", () => {
						onRetry(node.id);
					}),
					isAgent && !node.isLoading && item("修改提示词", () => {
						onSteer(node.id);
					}),
					item("删除", () => {
						onDelete(node.id);
					}, true)
				]
			});
		});
		//#endregion
		//#region src/client/canvas/ReferenceTray.tsx
		/** 参考角色 → 中文标签（与 Runway 式参考分类对齐）。 */
		const ROLE_LABELS = {
			image: "构图/通用",
			character: "角色",
			style: "风格",
			frame: "首末帧"
		};
		/**
		* 参考托盘（左侧栏，复用画布作为素材库）：列出所有标记为参考图的图片节点，
		* 每项带缩略图、角色 chip、强度滑块、「引用到对话」与「移除」操作。对应
		* Runway 的参考区 + Midjourney 的钉住参考；节点即画布节点，不另开素材库。
		*/
		function ReferenceTray(props) {
			const { nodes, onUpdateNode, onReferenceToChat } = props;
			const [open, setOpen] = (0, react.useState)(true);
			if (nodes.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "csReferenceTray",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "csReferenceHeader",
					onClick: () => {
						setOpen((prev) => !prev);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"参考图（",
						nodes.length,
						"）"
					] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csReferenceToggle",
						children: open ? "−" : "+"
					})]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csReferenceList",
					children: nodes.map((node) => {
						const role = node.referenceRole ?? "image";
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csReferenceItem",
							children: [node.url !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								className: "csReferenceThumb",
								src: node.url,
								alt: node.title ?? ""
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csReferenceMeta",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csReferenceTitleRow",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csReferenceTitle",
											title: node.title ?? "",
											children: node.title ?? "未命名"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csReferenceChip",
											children: ROLE_LABELS[role] ?? "构图/通用"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "csReferenceRange",
										type: "range",
										min: 0,
										max: 100,
										value: Math.round((node.referenceStrength ?? 1) * 100),
										onChange: (event) => {
											onUpdateNode(node.id, { referenceStrength: Number(event.target.value) / 100 });
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csReferenceActions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csReferenceButton",
											onClick: () => {
												onReferenceToChat(node);
											},
											children: "引用到对话"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csReferenceButton",
											onClick: () => {
												onUpdateNode(node.id, { isReference: false });
											},
											children: "移除"
										})]
									})
								]
							})]
						}, node.id);
					})
				})]
			});
		}
		//#endregion
		//#region src/reference-token.ts
		/**
		* @ref 引用标记工具（Host/Client 共用，纯函数，无副作用）。
		*
		* 画布参考托盘里的图片节点用 `@ref[显示名]` 作为对话内引用句柄：用户在节点
		* 详情面板 / 参考托盘点「引用到对话」会把该标记复制到剪贴板，粘贴进聊天框后，
		* Host 侧生成工具（image_generate / video_generate / style_transfer / video_composite）
		* 会自动把 `@ref[显示名]` 解析成对应的 Drama Backend 文件名，免去手动 upload_image。
		*
		* 这与 Midjourney 的 `--cref` / `--sref` token、Runway 的参考区思路一致：
		* 一个稳定的引用句柄，跨「画布 ↔ 聊天」复用素材。
		*/
		/** 把节点显示名格式化为对话内引用标记。 */
		function formatRefToken(title) {
			return `@ref[${title}]`;
		}
		//#endregion
		//#region src/client/StudioFrame.tsx
		const ZOOM_STEP = 1.2;
		/** Debounce for viewport saves (pan/zoom fire per frame; disk saves must not). */
		const VIEW_SAVE_DEBOUNCE_MS = 400;
		/**
		* Three-region studio frame: project list + layer list on the left, the canvas
		* surface (toolbar on top, review timeline at the bottom) in the center, and
		* the official conversation seat on the right. The sidebar and details seats
		* stay declared (upstream registrants keep their paths) but are not rendered.
		* A single selected node opens the detail panel; a context menu offers node
		* ordering / lock / generation actions. The canvas shows every captured node
		* of the selected project (image/video/sticky/text/prompt/group) with
		* bloodline edges; the timeline lets the user review and jump to any node.
		*/
		function StudioFrame(props) {
			const { renderSlot, useStudio, refreshProjects, createProject, openProject, deleteProject, persistCanvas, retryNode, steerNode, cancelCurrentTurn, approveStoryboard, rejectStoryboard, setWorkflowMode, actions, settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme } = props;
			const projects = useStudio((store) => store.projects);
			const selectedProjectId = useStudio((store) => store.selectedProjectId);
			const selectedNodeId = useStudio((store) => store.selectedNodeId);
			const selectedNodeIds = useStudio((store) => store.selectedNodeIds);
			const nodes = useStudio((store) => nodesOf(store, store.selectedProjectId));
			const referenceNodes = nodes.filter((node) => node.isReference === true && node.kind === "image");
			const selectedNode = useStudio((store) => selectedNodeOf(store));
			const phase = useStudio((store) => store.phase);
			const error = useStudio((store) => store.error);
			const creating = useStudio((store) => store.creating);
			const historyIndex = useStudio((store) => store.historyIndex);
			const historyLength = useStudio((store) => store.history.length);
			const viewEntry = useStudio((store) => viewOf(store, store.selectedProjectId));
			const view = viewEntry.view;
			const workflow = useStudio((store) => store.selectedProjectId === null ? void 0 : store.workflows[store.selectedProjectId]);
			const [focusNodeId, setFocusNodeId] = (0, react.useState)(null);
			const [detailNodeId, setDetailNodeId] = (0, react.useState)(null);
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const surfaceRef = (0, react.useRef)(null);
			const [menu, setMenu] = (0, react.useState)(null);
			const menuRef = (0, react.useRef)(null);
			const viewSaveTimer = (0, react.useRef)(null);
			const fitPendingRef = (0, react.useRef)(false);
			const fittedProjectRef = (0, react.useRef)(null);
			const [fitRequestedAt, setFitRequestedAt] = (0, react.useState)(0);
			const [composeBusy, setComposeBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				refreshProjects();
			}, [refreshProjects]);
			(0, react.useEffect)(() => () => {
				if (viewSaveTimer.current !== null) clearTimeout(viewSaveTimer.current);
			}, []);
			(0, react.useEffect)(() => {
				if (menu === null) return;
				const close = () => {
					setMenu(null);
				};
				const onMouseDown = (event) => {
					if (shouldKeepMenuOpen(event.target, menuRef.current)) return;
					close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				window.addEventListener("mousedown", onMouseDown);
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("mousedown", onMouseDown);
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [menu]);
			const projectId = selectedProjectId;
			(0, react.useEffect)(() => {
				if (projectId === null || viewEntry.saved || nodes.length === 0) return;
				if (fittedProjectRef.current === projectId) return;
				fittedProjectRef.current = projectId;
				surfaceRef.current?.fitToContent();
			}, [
				projectId,
				viewEntry.saved,
				nodes
			]);
			(0, react.useEffect)(() => {
				if (fitRequestedAt === 0) return;
				if (!fitPendingRef.current) return;
				fitPendingRef.current = false;
				surfaceRef.current?.fitToContent();
			}, [fitRequestedAt, nodes]);
			const beginEdit = () => {
				if (projectId !== null) actions.pushHistory(projectId);
			};
			const persist = () => {
				if (projectId !== null) persistCanvas(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "画布保存失败");
				});
			};
			const persistAfter = (mutate) => {
				mutate();
				persist();
			};
			const longSide480 = (width, height) => width >= height ? {
				width: 480,
				height: Math.max(60, Math.round(480 * height / width))
			} : {
				width: Math.max(60, Math.round(480 * width / height)),
				height: 480
			};
			const probeImageDisplay = async (buffer) => {
				try {
					const bitmap = await createImageBitmap(new Blob([buffer]));
					const result = {
						display: longSide480(bitmap.width, bitmap.height),
						mediaWidth: bitmap.width,
						mediaHeight: bitmap.height
					};
					bitmap.close();
					return result;
				} catch {
					return null;
				}
			};
			const handleUploadImage = async (file) => {
				if (projectId === null) return;
				const buffer = await file.arrayBuffer();
				const dataBase64 = bytesToBase64(new Uint8Array(buffer));
				try {
					const { url, filename } = await uploadLocalStudioImage(projectId, file.name, dataBase64);
					const probe = await probeImageDisplay(buffer);
					persistAfter(() => actions.addImportNode(projectId, url, file.name || "本地素材", filename, void 0, void 0, probe === null ? void 0 : {
						...probe.display,
						mediaWidth: probe.mediaWidth,
						mediaHeight: probe.mediaHeight
					}));
				} catch (cause) {
					throw cause instanceof Error ? cause : /* @__PURE__ */ new Error("图片上传失败");
				}
			};
			const handleUploadVideo = async (file) => {
				if (projectId === null) return;
				try {
					const payload = await uploadStudioVideo(projectId, file);
					persistAfter(() => actions.addVideoStyleNodes(projectId, {
						...payload,
						name: file.name
					}));
				} catch (cause) {
					throw cause instanceof Error ? cause : /* @__PURE__ */ new Error("参考视频处理失败");
				}
			};
			const handleViewChange = (patch) => {
				if (projectId === null) return;
				actions.setView(projectId, patch);
				if (viewSaveTimer.current !== null) clearTimeout(viewSaveTimer.current);
				viewSaveTimer.current = setTimeout(() => {
					viewSaveTimer.current = null;
					persist();
				}, VIEW_SAVE_DEBOUNCE_MS);
			};
			const handleDelete = (ids) => {
				if (projectId === null || ids.length === 0) return;
				persistAfter(() => actions.removeNodes(projectId, ids));
				setDetailNodeId(null);
			};
			const handleToggleVisibility = (id) => {
				if (projectId === null) return;
				const node = nodes.find((candidate) => candidate.id === id);
				if (node === void 0) return;
				actions.setVisibility(projectId, id, node.visible === false);
			};
			const handleReorder = (id, direction) => {
				if (projectId === null) return;
				persistAfter(() => actions.reorderNode(projectId, id, direction));
			};
			const handleUndo = () => {
				persistAfter(() => actions.undo());
			};
			const handleRedo = () => {
				persistAfter(() => actions.redo());
			};
			const handleRename = (id, title) => {
				if (projectId === null) return;
				persistAfter(() => actions.renameNode(projectId, id, title));
			};
			const handleUpdateNode = (id, updates) => {
				if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, updates));
			};
			const setNativeValue = (el, value) => {
				const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
				if (setter !== void 0) setter.call(el, value);
				else el.value = value;
			};
			const insertReferenceToken = (input, token) => {
				if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
					const start = input.selectionStart ?? input.value.length;
					const end = input.selectionEnd ?? start;
					const next = input.value.slice(0, start) + token + input.value.slice(end);
					setNativeValue(input, next);
					input.dispatchEvent(new Event("input", { bubbles: true }));
					input.focus();
					const caret = start + token.length;
					try {
						input.setSelectionRange(caret, caret);
					} catch {}
					return true;
				}
				if (input.isContentEditable) {
					input.focus();
					const sel = window.getSelection();
					if (sel !== null && sel.rangeCount > 0) {
						const range = sel.getRangeAt(0);
						range.deleteContents();
						const textNode = document.createTextNode(token);
						range.insertNode(textNode);
						range.setStartAfter(textNode);
						range.collapse(true);
						sel.removeAllRanges();
						sel.addRange(range);
						input.dispatchEvent(new Event("input", { bubbles: true }));
						return true;
					}
				}
				return false;
			};
			const handleReferenceToChat = (node) => {
				const token = formatRefToken(node.title ?? node.id);
				const input = document.querySelector(".csConversation textarea, .csConversation [contenteditable=\"true\"], .csConversation input[type=\"text\"]");
				if (input instanceof HTMLElement && insertReferenceToken(input, token)) return;
				navigator.clipboard?.writeText(token).catch(() => {});
				window.alert(`已复制引用标记：${token}\n在右侧聊天框粘贴，并补充说明（如「用这张角色图生成分镜」）。`);
			};
			const handleRetry = (id) => {
				if (projectId === null) return;
				retryNode(projectId, id).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "重试失败");
				});
			};
			/**
			* CV-020：把节点资产另存到本地。
			*
			* 资产由插件自己的 webServer 提供，与页面同源，`a[download]` 会被浏览器
			* 尊重（存到「下载」目录而非跳转打开）。万一将来资产挪到跨域地址，
			* `download` 会被忽略并退化为「在新标签打开」，仍可取回文件，不会静默失败。
			*/
			const handleDownload = (node) => {
				if (!canDownloadNode(node) || node.url === void 0) return;
				const link = document.createElement("a");
				link.href = node.url;
				link.download = assetDownloadName(node);
				link.rel = "noopener";
				document.body.appendChild(link);
				link.click();
				link.remove();
			};
			const handleSteer = (id, prompt) => {
				if (projectId === null) return;
				steerNode(projectId, id, prompt).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "重新生成失败");
				});
			};
			const handleTimelineSelect = (id) => {
				actions.selectNode(id);
				setFocusNodeId(id);
				setDetailNodeId(null);
			};
			const handleApprove = () => {
				if (projectId !== null) approveStoryboard(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "批准失败");
				});
			};
			const handleReject = () => {
				if (projectId !== null) rejectStoryboard(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "驳回失败");
				});
			};
			const handleSetMode = (mode) => {
				if (projectId !== null) setWorkflowMode(projectId, mode).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "模式切换失败");
				});
			};
			const timelineOrder = deriveTimelineOrder(nodes, view.timeline);
			const handleTimelineReorder = (ids) => {
				handleViewChange({ timeline: ids });
			};
			const handleComposeExport = async () => {
				if (projectId === null || composeBusy) return;
				const clipIds = timelineOrder.filter((node) => node.kind === "video").map((node) => node.id);
				if (clipIds.length < 2) {
					window.alert("请先在时间轴上排列至少 2 个视频片段，再导出成片");
					return;
				}
				setComposeBusy(true);
				try {
					const { url, duration, width, height } = await composeStudioVideo(projectId, clipIds);
					const composedId = newNodeId();
					const script = nodes.find((node) => (node.kind === "text" || node.kind === "prompt") && /文案/.test(node.title ?? ""))?.text;
					persistAfter(() => actions.addComposedVideo(projectId, {
						id: composedId,
						url,
						title: `成片 ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`,
						duration,
						...typeof width === "number" ? { mediaWidth: width } : {},
						...typeof height === "number" ? { mediaHeight: height } : {},
						...typeof script === "string" && script.length > 0 ? { script } : {},
						sourceIds: clipIds
					}));
					setFocusNodeId(composedId);
					fitPendingRef.current = true;
					setFitRequestedAt(Date.now());
					window.alert(`成片已生成（${duration.toFixed(1)}s），已添加到画布并自动定位到视图中心，可在时间轴或画布播放。`);
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					window.alert(`成片合成失败：${message}`);
				} finally {
					setComposeBusy(false);
				}
			};
			const canvasBody = (() => {
				if (projectId === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csCanvasEmpty",
					children: "打开或新建一个项目，开始创作"
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csCanvasBody",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasSurface, {
							nodes,
							view,
							onViewChange: handleViewChange,
							selectedNodeId,
							selectedNodeIds,
							onSelectNode: (id, multi) => {
								actions.selectNode(id, multi);
							},
							onSelectAllNodes: () => {
								actions.selectAllNodes();
							},
							onMoveNode: (id, x, y) => {
								actions.moveNode(projectId, id, x, y);
							},
							onUpdateNode: (id, updates) => {
								actions.updateNode(projectId, id, updates);
							},
							onBeginEdit: beginEdit,
							onPersist: persist,
							onRemoveNodes: handleDelete,
							onCopy: () => {
								actions.copySelected(projectId);
							},
							onPaste: () => {
								persistAfter(() => actions.pasteNodes(projectId));
							},
							onUndo: handleUndo,
							onRedo: handleRedo,
							onLinkLayers: (sourceIds, targetId) => {
								persistAfter(() => actions.linkLayers(projectId, sourceIds, targetId));
							},
							onRename: handleRename,
							onNodeTextSubmit: (id, text) => {
								if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, { text }));
							},
							onNodeOpenDetail: (node) => {
								actions.selectNode(node.id);
								setDetailNodeId(node.id);
							},
							onContextMenu: (node, x, y) => {
								setMenu({
									node,
									x,
									y
								});
							},
							onRetry: handleRetry,
							onMediaNatural: (id, naturalWidth, naturalHeight) => {
								if (projectId === null || naturalWidth <= 0) return;
								const target = nodes.find((node) => node.id === id);
								if (target === void 0) return;
								const updates = {};
								if (target.mediaWidth === void 0) {
									updates.mediaWidth = naturalWidth;
									updates.mediaHeight = naturalHeight;
								}
								if (!target.locked) {
									const mediaAspect = naturalWidth / naturalHeight;
									const boxAspect = target.width / target.height;
									if (Math.abs(boxAspect - mediaAspect) / mediaAspect > .05) {
										updates.width = mediaAspect >= 1 ? 480 : Math.max(60, Math.round(480 * mediaAspect));
										updates.height = mediaAspect >= 1 ? Math.max(60, Math.round(480 / mediaAspect)) : 480;
									}
								}
								if (Object.keys(updates).length === 0) return;
								persistAfter(() => actions.updateNode(projectId, id, updates));
							},
							focusNodeId,
							ref: surfaceRef,
							minimapVisible: view.minimapVisible
						}),
						referenceNodes.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csReferenceFloat",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReferenceTray, {
								nodes: referenceNodes,
								onUpdateNode: handleUpdateNode,
								onReferenceToChat: handleReferenceToChat
							})
						}),
						view.layersOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
							className: "csCanvasLayers",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LayerPanel, {
								nodes,
								selectedNodeIds,
								onSelect: (id, multi) => {
									actions.selectNode(id, multi);
									setFocusNodeId(id);
								},
								onDelete: handleDelete,
								onToggleLock: (id) => {
									if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id));
								},
								onToggleVisibility: handleToggleVisibility,
								onReorder: handleReorder
							})
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasTimeline, {
					ordered: timelineOrder,
					selectedNodeId,
					onSelect: handleTimelineSelect,
					onReorder: handleTimelineReorder,
					onCompose: handleComposeExport,
					composeBusy
				})] });
			})();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csFrame",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: "csProjects",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "csProjectsHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "项目" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: phase === "loading" || creating,
								onClick: () => void refreshProjects(),
								children: "刷新"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectList, {
							projects,
							selectedProjectId,
							phase,
							error,
							creating,
							onRefresh: () => void refreshProjects(),
							onCreate: createProject,
							onOpen: openProject,
							onDelete: deleteProject,
							onOpenSettings: () => {
								setSettingsOpen(true);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
						className: "csCanvas",
						onDragOver: (event) => {
							if (event.dataTransfer.types.includes("Files")) event.preventDefault();
						},
						onDrop: (event) => {
							if (!event.dataTransfer.types.includes("Files")) return;
							event.preventDefault();
							const files = Array.from(event.dataTransfer.files);
							const video = files.find((item) => item.type.startsWith("video/"));
							const image = files.find((item) => item.type.startsWith("image/"));
							if (video === void 0 && image === void 0) return;
							(async () => {
								try {
									if (video !== void 0) await handleUploadVideo(video);
									else if (image !== void 0) await handleUploadImage(image);
								} catch (cause) {
									const message = cause instanceof Error ? cause.message : String(cause);
									window.alert(video !== void 0 ? `参考视频处理失败：${message}` : `图片上传失败：${message}`);
								}
							})();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasToolbar, {
								canUndo: historyIndex >= 0,
								canRedo: historyIndex + 1 < historyLength,
								selectedCount: selectedNodeIds.length,
								hasSelection: selectedNodeIds.length > 0,
								onUndo: handleUndo,
								onRedo: handleRedo,
								onDelete: () => {
									handleDelete(selectedNodeIds);
								},
								onGroup: () => {
									if (projectId !== null) persistAfter(() => actions.groupSelected(projectId));
								},
								onUngroup: () => {
									if (selectedNode !== null && selectedNode.kind === "group" && projectId !== null) persistAfter(() => actions.ungroup(projectId, selectedNode.id));
								},
								onAutoArrange: () => {
									if (projectId === null) return;
									persistAfter(() => actions.autoArrange(projectId));
									fitPendingRef.current = true;
									setFitRequestedAt(Date.now());
								},
								onAddNode: (kind) => {
									if (projectId !== null) persistAfter(() => actions.addNode(projectId, kind));
								},
								onUploadImage: async (file) => {
									try {
										await handleUploadImage(file);
									} catch (cause) {
										window.alert(`图片上传失败：${cause instanceof Error ? cause.message : String(cause)}`);
									}
								},
								onUploadVideo: async (file) => {
									try {
										await handleUploadVideo(file);
									} catch (cause) {
										window.alert(`参考视频处理失败：${cause instanceof Error ? cause.message : String(cause)}`);
									}
								},
								layersOpen: view.layersOpen,
								onToggleLayers: () => {
									handleViewChange({ layersOpen: !view.layersOpen });
								},
								scale: view.scale,
								onZoomOut: () => {
									surfaceRef.current?.zoomBy(1 / ZOOM_STEP);
								},
								onZoomIn: () => {
									surfaceRef.current?.zoomBy(ZOOM_STEP);
								},
								onFitContent: () => {
									surfaceRef.current?.fitToContent();
								},
								onResetZoom: () => {
									surfaceRef.current?.resetZoom();
								},
								minimapVisible: view.minimapVisible,
								onToggleMinimap: () => {
									handleViewChange({ minimapVisible: !view.minimapVisible });
								},
								onOpenSettings: () => {
									setSettingsOpen(true);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csWorkflowBar",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csWorkflowMode",
										role: "group",
										"aria-label": "执行模式",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: workflow?.mode !== "auto" ? "csActive" : "",
											onClick: () => {
												handleSetMode("confirm");
											},
											children: "逐步确认"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: workflow?.mode === "auto" ? "csActive" : "",
											onClick: () => {
												handleSetMode("auto");
											},
											children: "放手跑"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csWorkflowState",
										children: workflow?.state === "awaiting_approval" ? "等待批准" : workflow?.state === "executing" ? "制作中" : "需求沟通中"
									}),
									workflow?.state === "awaiting_approval" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csWorkflowApproval",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowMessage",
												children: "分镜表已提交到画布，请确认后批准"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csPrimary",
												onClick: handleApprove,
												children: "批准并开始制作"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												onClick: handleReject,
												children: "驳回，继续修改"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowState",
												children: "批准后在对话中发送「继续」恢复流程"
											})
										]
									})
								]
							}),
							canvasBody
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
						className: "csChat",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
							className: "csConversation",
							children: renderSlot("conversation", {})
						})
					}),
					selectedNode !== null && projectId !== null && selectedNode.id === detailNodeId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LayerDetailPanel, {
						node: selectedNode,
						allNodes: nodes,
						onClose: () => {
							setDetailNodeId(null);
						},
						onRename: handleRename,
						onSetOpacity: (id, opacity) => {
							if (projectId !== null) persistAfter(() => actions.setOpacity(projectId, id, opacity));
						},
						onToggleFlip: (id, axis) => {
							if (projectId !== null) {
								const node = nodes.find((candidate) => candidate.id === id);
								if (node === void 0) return;
								persistAfter(() => actions.updateNode(projectId, id, { [axis]: !node[axis] }));
							}
						},
						onToggleLock: (id) => {
							if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id));
						},
						onToggleVisibility: handleToggleVisibility,
						onReorder: handleReorder,
						onDelete: (id) => {
							handleDelete([id]);
						},
						onRetry: handleRetry,
						onSteer: handleSteer,
						onCancel: () => {
							cancelCurrentTurn();
						},
						onUpdateNode: handleUpdateNode,
						onReferenceToChat: handleReferenceToChat,
						onDownload: handleDownload
					}),
					menu !== null && projectId !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasContextMenu, {
						ref: menuRef,
						node: menu.node,
						x: menu.x,
						y: menu.y,
						onClose: () => {
							setMenu(null);
						},
						onRename: (id) => {
							actions.selectNode(id);
							setDetailNodeId(id);
						},
						onCopy: (id) => {
							actions.selectNode(id);
							actions.copySelected(projectId);
						},
						onDelete: (id) => {
							handleDelete([id]);
						},
						onReorder: handleReorder,
						onToggleLock: (id) => {
							if (projectId !== null) persistAfter(() => actions.toggleLock(projectId, id));
						},
						onToggleVisibility: handleToggleVisibility,
						onRetry: handleRetry,
						onSteer: (id) => {
							actions.selectNode(id);
							setDetailNodeId(id);
						},
						onCancel: () => {
							cancelCurrentTurn();
						},
						onUngroup: (id) => {
							if (projectId !== null) persistAfter(() => actions.ungroup(projectId, id));
						},
						onReferenceToChat: (id) => {
							const target = nodes.find((candidate) => candidate.id === id);
							if (target !== void 0) handleReferenceToChat(target);
						},
						onDownload: (id) => {
							const target = nodes.find((candidate) => candidate.id === id);
							if (target !== void 0) handleDownload(target);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csOverlay",
						"data-cs-overlay": true,
						children: renderSlot("shell.overlay", {})
					}),
					settingsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsModal, {
						settingsScope,
						getCredentials,
						getModelApi,
						getDirectoryPicker,
						theme,
						onClose: () => {
							setSettingsOpen(false);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/question-capture.tsx
		/**
		* P7 点选式澄清的对话区内联卡片：conversationEvents 定义把 ask_user_choice
		* 的 tool/call 组装成 `canvas-studio-question` 聊天节点，渲染器注册进上游
		* `conversation.chat.node` keyed seat —— 问题与选项按钮直接出现在对话流里，
		* 用户点选后答案回流给模型（Host 工具轮询 pendingQuestion）。
		*
		* S3 增强：当选项命中「风格预设」8 类名称时，把文字按钮升级为 GIF 预览卡片
		* （资源来自 webServer /canvas-studio/style-demos，sync 脚本从 minimax-h3
		* submodule copy）；未命中的选项（时长/画幅等）保持文字按钮。
		*
		* 仅客户端使用（JSX + 框架类型），不进 Host tsc 产物。
		*/
		/** S3：风格预设名 → 上游 skill 名（对应 webServer 托管的 <skill>.gif 与 creation-spec 风格表）。 */
		const STYLE_DEMO_MAP = {
			"极简产品广告": "minimalist-product-ad-generator",
			"3D 动画短片": "3d-animation-short-generator",
			"纸艺定格讲解": "papercraft-stop-motion-explainer",
			"品牌宣传": "brand-promo-video-generator",
			"MV 字幕": "music-video-subtitle-generator",
			"合作游戏开场": "co-op-game-intro-generator",
			"纸拼贴讲解": "paper-collage-explainer-generator",
			"手绘实景融合": "handdrawn-live-video-generator"
		};
		/** 选项命中风格预设时返回对应 skill 名（用于 GIF 预览），否则 null：精确优先，再走宽松匹配。 */
		function styleDemoSkill(option) {
			const clean = option.replace(/（推荐）/g, "").trim();
			return STYLE_DEMO_MAP[clean] ?? styleDemoSkillLoose(clean);
		}
		/**
		* 宽松变体：模型给的选项文字可能有空格/后缀差异（如「3D动画短片」「极简产品广告风格」），
		* 精确匹配之外再退两级——去空格比较、双向包含比较。
		*/
		function styleDemoSkillLoose(option) {
			const squashed = option.replace(/\s+/g, "");
			for (const [label, skill] of Object.entries(STYLE_DEMO_MAP)) if (label.replace(/\s+/g, "") === squashed) return skill;
			for (const [label, skill] of Object.entries(STYLE_DEMO_MAP)) if (squashed.includes(label.replace(/\s+/g, ""))) return skill;
			return null;
		}
		/** 从 tool/call 参数解析问题（arguments 是 JSON 字符串）。 */
		function parseQuestionArguments(raw) {
			let parsed;
			try {
				parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
			} catch {
				parsed = null;
			}
			const record = parsed ?? {};
			return {
				question: typeof record.question === "string" ? record.question : "（问题解析失败）",
				options: Array.isArray(record.options) ? record.options.map(String) : [],
				allowFreeText: record.allowFreeText === true
			};
		}
		/** 从 renderTextResult 的文本块提取结算说明。 */
		function extractResultNote(blocks) {
			if (!Array.isArray(blocks)) return "已结算";
			for (const block of blocks) if (block !== null && typeof block === "object" && block.type === "text") {
				const text = block.text;
				if (typeof text === "string" && text.length > 0) return text;
			}
			return "已结算";
		}
		/** 对话区内联点选卡片渲染器。 */
		const QuestionNodeView = (0, react.memo)(function QuestionNodeView(props) {
			const { node, hooks } = props;
			const data = node.data;
			const [freeText, setFreeText] = (0, react.useState)("");
			const [submitted, setSubmitted] = (0, react.useState)(false);
			const settled = data.answer !== null || data.note !== null || submitted;
			const handleAnswer = (value) => {
				if (settled) return;
				const projectId = hooks.getSelectedProjectId();
				if (projectId !== null) hooks.onAnswer(projectId, value);
			};
			const submitFreeText = () => {
				const value = freeText.trim();
				if (value.length === 0 || settled) return;
				handleAnswer(value);
				setSubmitted(true);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csQuestionCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csQuestionLabel",
						children: data.question
					}),
					data.options.some((option) => styleDemoSkill(option) !== null) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csStyleDemoGrid",
						children: data.options.map((option) => {
							const skill = styleDemoSkill(option);
							if (skill === null) return null;
							const recommended = option.includes("（推荐）");
							const label = option.replace("（推荐）", "").trim();
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "csStyleDemoCard",
								disabled: settled,
								onClick: () => {
									handleAnswer(option);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: "csStyleDemoImg",
									loading: "lazy",
									src: `/canvas-studio/style-demos/${skill}.gif`,
									alt: label
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "csStyleDemoName",
									children: [label, recommended && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
										className: "csStyleDemoBadge",
										children: "推荐"
									})]
								})]
							}, option);
						})
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csQuestionOptions",
						children: data.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: settled,
							onClick: () => {
								handleAnswer(option);
							},
							children: option
						}, option))
					}),
					data.allowFreeText && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csQuestionFree",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: freeText,
							placeholder: "或输入自定义答案…",
							disabled: settled,
							onChange: (event) => {
								setFreeText(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") submitFreeText();
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: settled,
							onClick: submitFreeText,
							children: "提交"
						})]
					}),
					settled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csWorkflowState",
						children: data.answer !== null ? `已选择：${data.answer}` : data.note
					})
				]
			});
		});
		/**
		* 创建 ask_user_choice 的对话节点定义（纯事件组装；渲染交互见 QuestionNodeView）。
		* @returns 注册进 `ctx.conversationEvents` 的 definition。
		*/
		function createQuestionCaptureDefinition() {
			return {
				kind: "canvas-studio-question",
				target: "chat",
				match(event) {
					if (event.type === "tool/call") {
						const data = event.data;
						if (data.name === "ask_user_choice") return {
							id: String(data.callId),
							role: "start"
						};
						return null;
					}
					if (event.type === "tool/result") {
						const source = event.data.message.source;
						return {
							id: String(source.callId),
							role: "update"
						};
					}
					return null;
				},
				start: (_context, startMatch) => {
					const data = startMatch.event.data;
					return {
						...parseQuestionArguments(data.arguments),
						answer: null,
						note: null
					};
				},
				update: (context, updateMatch) => {
					if (updateMatch.event.type !== "tool/result") return context.state;
					const data = updateMatch.event.data;
					if (data.error !== void 0) {
						const message = typeof data.error === "string" ? data.error : "提问已取消";
						return {
							...context.state,
							note: message
						};
					}
					return {
						...context.state,
						note: extractResultNote(data.message?.content)
					};
				},
				buildViewNode: (context) => {
					const state = context.state;
					if (state === void 0) return null;
					const anchorSeq = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0;
					const location = context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
					return {
						key: context.key,
						kind: "canvas-studio-question",
						id: context.id,
						target: "chat",
						anchorSeq,
						location,
						visibility: "visible",
						data: state
					};
				}
			};
		}
		/**
		* 注册对话区点选卡片：definition（事件组装）+ 渲染器（keyed seat）。
		* @param ctx - active client context。
		* @param hooks - 与 apply 世界的接线。
		* @returns 注销函数。
		*/
		function registerQuestionChatNode(ctx, hooks) {
			const disposeDefinition = ctx.conversationEvents.register(createQuestionCaptureDefinition());
			const disposeRenderer = ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "canvas-studio-question"
			}, ((props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuestionNodeView, {
				...props,
				hooks
			}))));
			return () => {
				disposeRenderer();
				disposeDefinition();
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* Services required before the studio frame can mount.
		*
		* 注意：`tools` 是 Host 专属服务，客户端没有该服务。媒体生成工具已在 Host
		* 侧（`src/host-tools.ts`）注册，客户端只负责 UI、项目/工作区绑定，以及
		* 通过 `conversationEvents` 捕获工具产物到画布 store（P4），并把画布节点
		* 持久化到 Host（P4+ 重启恢复）。`sessions` 用于打断当前会话的生成回合。
		*/
		const inject = [
			"slots",
			"workspaces",
			"conversationEvents",
			"sessions",
			"connection",
			"settingsScope",
			"theme"
		];
		/** Dev-only seed sample media so the canvas is verifiable without a backend. */
		const SEED_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"260\" height=\"180\"><rect width=\"100%\" height=\"100%\" fill=\"#4285f4\"/><text x=\"50%\" y=\"50%\" fill=\"white\" font-size=\"18\" text-anchor=\"middle\" dominant-baseline=\"middle\">种子示例图</text></svg>")}`;
		const SEED_VIDEO = "https://example.invalid/canvas-studio-seed/sample.mp4";
		/** Pending-node placeholder box size per kind. */
		const NODE_SIZE_PENDING = {
			image: {
				width: 260,
				height: 180
			},
			video: {
				width: 260,
				height: 180
			}
		};
		/**
		* Build dev-seed nodes for a project: an image, a video derived from it
		* (bloodline edge), and a sticky note — enough to exercise every node kind,
		* the edge renderer, and the timeline without a live Drama Backend.
		*/
		function seedNodes() {
			const now = Date.now();
			return [
				{
					id: "seed-image",
					kind: "image",
					url: SEED_IMAGE,
					title: "示例图",
					x: 40,
					y: 40,
					width: 260,
					height: 180,
					createdAt: now,
					origin: "manual",
					sourceIds: []
				},
				{
					id: "seed-video",
					kind: "video",
					url: SEED_VIDEO,
					title: "示例视频",
					x: 340,
					y: 40,
					width: 260,
					height: 180,
					createdAt: now + 1,
					origin: "manual",
					sourceIds: ["seed-image"]
				},
				{
					id: "seed-sticky",
					kind: "sticky",
					text: "种子便签：演示文本 / 提示节点与画布交互",
					x: 40,
					y: 300,
					width: 220,
					height: 140,
					createdAt: now + 2,
					origin: "manual",
					sourceIds: []
				}
			];
		}
		/**
		* Client plugin body: provide the standard ctx.layout contract (owned by the
		* disabled ui-layout row) and register the studio frame into the runtime's
		* built-in root slot, declaring the standard child seats so the upstream
		* sidebar/conversation/details plugins keep their registration paths.
		*
		* Project switching binds the conversation to the project's workspace: each
		* project owns one workspace registered at its disk directory, and opening a
		* project connects (reusing a blank session) and navigates to it. The canvas
		* nodes for that project are loaded (and, with `?cs-dev-seed=1`, seeded) here.
		* @param ctx - active browser Cordis context.
		*/
		function apply(ctx) {
			ctx.logger.info("canvas-studio client v2 loaded");
			const params = new URLSearchParams(window.location.search);
			if (params.get("dsh-desktop-mode") === "advanced") {
				ctx.logger.warn("canvas-studio: advanced desktop mode keeps the desktop frame; switch the desktop profile to compatibility mode to use the studio layout");
				return;
			}
			const devSeed = params.get("cs-dev-seed") === "1";
			const layout = new StudioLayoutController();
			const storeInstance = createProjectStore().create();
			const sessionSvc = ctx.sessions;
			const applyLoadedCanvas = (projectId, loaded) => {
				storeInstance.actions.setNodes(projectId, loaded.nodes);
				storeInstance.actions.setView(projectId, loaded.view ?? {}, loaded.view !== void 0);
			};
			let canvasIoChain = Promise.resolve();
			const enqueueCanvasIo = (job) => {
				const next = canvasIoChain.then(job, job);
				canvasIoChain = next.catch(() => {});
				return next;
			};
			/** 从磁盘重载某项目画布进 store（排队执行，避免与保存交错）。 */
			const reloadCanvasQueued = (projectId) => enqueueCanvasIo(async () => {
				try {
					applyLoadedCanvas(projectId, await loadStudioCanvas(projectId));
				} catch {}
			});
			/** 画布持久化（排队执行；剔除瞬态占位节点）。与 props.persistCanvas 同一语义。 */
			const persistCanvasQueued = (projectId) => enqueueCanvasIo(async () => {
				const snapshot = storeInstance.getSnapshot();
				await saveStudioCanvas(projectId, (snapshot.nodes[projectId] ?? []).filter((node) => !isTransientNode(node)), viewOf(snapshot, projectId).view);
			});
			const resolveActiveProjectId = () => {
				const manual = storeInstance.getSnapshot().selectedProjectId;
				if (manual !== null) return manual;
				const snapshot = ctx.workspaces.list.getSnapshot();
				if (!snapshot.baselinesReady) return null;
				const projects = storeInstance.getSnapshot().projects;
				const sessions = sessionSvc.list.getSnapshot();
				const current = sessions.current === void 0 ? void 0 : sessions.byId[sessions.current];
				if (current !== void 0 && current.cwd !== void 0) {
					const bound = projects.find((entry) => entry.dir === current.cwd);
					if (bound !== void 0) return bound.id;
				}
				const recentId = snapshot.recentWorkspaceId;
				if (recentId === void 0) return null;
				const view = snapshot.items.find((item) => item.workspaceId === recentId);
				if (view === void 0 || view.path === void 0) return null;
				return projects.find((entry) => entry.dir === view.path)?.id ?? null;
			};
			const pendingBriefs = /* @__PURE__ */ new Map();
			const flushPendingBrief = (projectId) => {
				const text = pendingBriefs.get(projectId);
				if (text === void 0) return Promise.resolve();
				pendingBriefs.delete(projectId);
				try {
					storeInstance.actions.addBriefNode(projectId, text);
				} catch {
					return Promise.resolve();
				}
				return persistCanvasQueued(projectId).catch(() => {});
			};
			ctx.effect(() => ctx.conversationEvents.register(createBriefCaptureDefinition({
				getSelectedProjectId: () => resolveActiveProjectId(),
				hasBriefNode: (projectId) => (storeInstance.getSnapshot().nodes[projectId] ?? []).some((node) => node.toolName === BRIEF_NODE_TOOL),
				onBrief: (projectId, text) => {
					if (storeInstance.getSnapshot().nodes[projectId] !== void 0) {
						storeInstance.actions.addBriefNode(projectId, text);
						persistCanvasQueued(projectId);
					} else pendingBriefs.set(projectId, text);
				}
			})), "canvas-studio: brief capture");
			/** 挑工作区里 updatedAt 最新的非空会话（排除 archived）；没有则 undefined。 */
			const latestResumableSession = (workspaceId) => {
				const workspaces = ctx.workspaces.list.getSnapshot();
				const entry = workspaces.items.find((item) => item.workspaceId === workspaceId);
				if (entry === void 0) return void 0;
				const byId = sessionSvc.list.getSnapshot().byId;
				return entry.sessionIds.map((id) => byId[id]).filter((summary) => summary !== void 0 && summary.blank !== true && !workspaces.archivedSessionIds.includes(summary.id)).sort((left, right) => right.updatedAt - left.updatedAt)[0];
			};
			/** 恢复工作区最近的非空会话（已在目标会话时是空操作）；无历史返回 false。 */
			const resumeLatestSession = (workspaceId) => {
				const resumable = latestResumableSession(workspaceId);
				if (resumable === void 0) return false;
				if (sessionSvc.list.getSnapshot().current !== resumable.id) sessionSvc.open(resumable.id);
				return true;
			};
			const syncActiveProject = () => {
				const id = resolveActiveProjectId();
				if (id === null) return;
				if (storeInstance.getSnapshot().selectedProjectId === id) return;
				storeInstance.actions.select(id);
				(async () => {
					await reloadCanvasQueued(id).then(() => flushPendingBrief(id));
					refreshWorkflow(id);
				})();
			};
			let startupSessionAligned = false;
			const alignStartupSession = () => {
				if (startupSessionAligned) return;
				const workspaces = ctx.workspaces.list.getSnapshot();
				if (!workspaces.baselinesReady) return;
				const sessions = sessionSvc.list.getSnapshot();
				if (sessions.phase === "pending") return;
				startupSessionAligned = true;
				const recentId = workspaces.recentWorkspaceId;
				if (recentId === void 0) return;
				const current = sessions.current === void 0 ? void 0 : sessions.byId[sessions.current];
				if (current !== void 0 && current.blank !== true) return;
				const resumable = latestResumableSession(recentId);
				if (resumable !== void 0 && sessions.current !== resumable.id) sessionSvc.open(resumable.id);
			};
			const PENDING_TIMEOUT_MS = 66e4;
			const pendingTimers = /* @__PURE__ */ new Map();
			const clearPendingTimer = (runId) => {
				const timer = pendingTimers.get(runId);
				if (timer !== void 0) {
					clearTimeout(timer);
					pendingTimers.delete(runId);
				}
			};
			const refreshWorkflow = async (projectId) => {
				try {
					storeInstance.actions.setWorkflow(projectId, await getStudioWorkflow(projectId));
				} catch {}
			};
			const applyWorkflowAction = async (projectId, action) => {
				const workflow = await postStudioWorkflowAction(projectId, action);
				storeInstance.actions.setWorkflow(projectId, workflow);
			};
			const approveStoryboard = (projectId) => applyWorkflowAction(projectId, "approve");
			const rejectStoryboard = (projectId) => applyWorkflowAction(projectId, "reject");
			const setWorkflowMode = async (projectId, mode) => {
				const workflow = await postStudioWorkflowAction(projectId, "setMode", mode);
				storeInstance.actions.setWorkflow(projectId, workflow);
			};
			const answerQuestion = async (projectId, value) => {
				const workflow = await answerStudioQuestion(projectId, value);
				storeInstance.actions.setWorkflow(projectId, workflow);
			};
			ctx.effect(() => installStudioStyles(), "canvas-studio: studio styles");
			ctx.effect(() => {
				const reloadCanvas = (projectId) => reloadCanvasQueued(projectId).then(() => flushPendingBrief(projectId));
				return ctx.conversationEvents.register(createAssetCaptureDefinition({
					reloadCanvas,
					getSelectedProjectId: () => resolveActiveProjectId(),
					onToolFinished: (projectId) => {
						reloadCanvas(projectId);
						refreshWorkflow(projectId);
					},
					onWorkflowToolStarted: (projectId) => {
						setTimeout(() => {
							refreshWorkflow(projectId);
						}, 600);
						setTimeout(() => {
							refreshWorkflow(projectId);
						}, 2500);
					},
					onToolCall: (projectId, info) => {
						if (storeInstance.getSnapshot().projects.find((entry) => entry.id === projectId) === void 0) return;
						const index = (storeInstance.getSnapshot().nodes[projectId] ?? []).length;
						const size = NODE_SIZE_PENDING[info.kind];
						storeInstance.actions.setPendingNode(projectId, {
							id: `pending-${info.runId}`,
							runId: info.runId,
							kind: info.kind,
							x: 40 + index % 4 * 300,
							y: 40 + Math.floor(index / 4) * 240,
							width: size.width,
							height: size.height,
							createdAt: Date.now(),
							origin: "agent",
							sourceIds: [],
							toolName: info.toolName,
							...info.arguments !== void 0 ? { generationPrompt: info.arguments } : {},
							isLoading: true,
							progress: 0
						});
						const timer = setTimeout(() => {
							pendingTimers.delete(info.runId);
							storeInstance.actions.markPendingError(projectId, info.runId, "生成超时：等待产物超过上限。请在画布右键该节点选择「重试」，或在对话中让 agent 重新生成。");
						}, PENDING_TIMEOUT_MS);
						pendingTimers.set(info.runId, timer);
					},
					onToolError: (projectId, runId, message) => {
						clearPendingTimer(runId);
						storeInstance.actions.markPendingError(projectId, runId, message);
					}
				}));
			}, "canvas-studio: reload canvas on generated assets");
			ctx.effect(() => {
				syncActiveProject();
				alignStartupSession();
				const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(() => {
					syncActiveProject();
					alignStartupSession();
				});
				const unsubscribeSessions = sessionSvc.list.subscribe(() => {
					syncActiveProject();
					alignStartupSession();
				});
				return () => {
					unsubscribeWorkspaces();
					unsubscribeSessions();
				};
			}, "canvas-studio: sync canvas to active workspace");
			ctx.effect(() => registerQuestionChatNode(ctx, {
				getSelectedProjectId: () => resolveActiveProjectId(),
				onAnswer: (projectId, value) => {
					answerQuestion(projectId, value).catch(() => {});
				}
			}), "canvas-studio: question chat node");
			const cancelCurrentTurn = async () => {
				const current = sessionSvc.list.getSnapshot().current;
				if (current === void 0) return;
				const binding = sessionSvc.binding(current);
				if (binding === void 0) return;
				await binding.session.cancel();
			};
			const rerunNode = async (projectId, nodeId, overrides) => {
				const node = storeInstance.getSnapshot().nodes[projectId]?.find((entry) => entry.id === nodeId);
				if (node === void 0) return;
				if (node.isLoading === true) return;
				if (node.toolName === void 0 || node.generationPrompt === void 0) {
					storeInstance.actions.updateNode(projectId, nodeId, { error: "该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）" });
					return;
				}
				storeInstance.actions.updateNode(projectId, nodeId, {
					isLoading: true,
					progress: 0,
					error: void 0
				});
				try {
					await retryStudioNode(projectId, node, overrides);
					await reloadCanvasQueued(projectId);
				} catch (cause) {
					storeInstance.actions.updateNode(projectId, nodeId, {
						isLoading: false,
						error: cause instanceof Error ? cause.message : "重试失败"
					});
				}
			};
			const retryNode = (projectId, nodeId) => rerunNode(projectId, nodeId);
			const steerNode = (projectId, nodeId, prompt) => rerunNode(projectId, nodeId, { prompt });
			ctx.effect(() => {
				const disposeService = ctx.reflect.provide("layout", layout);
				const disposeRegistration = ctx.slots.register({
					name: "root",
					children: {
						"sidebar": {
							kind: "single",
							scope: "root"
						},
						"conversation": {
							kind: "single",
							scope: "session-maybe"
						},
						"details": {
							kind: "single",
							scope: "session"
						},
						"shell.overlay": {
							kind: "list",
							scope: "root"
						}
					},
					inject: () => {
						const refreshProjects = async () => {
							storeInstance.actions.setPhase("loading");
							try {
								storeInstance.actions.setLoaded(await listStudioProjects());
								syncActiveProject();
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目列表加载失败");
							}
						};
						const persistCanvas = (projectId) => enqueueCanvasIo(async () => {
							const snapshot = storeInstance.getSnapshot();
							await saveStudioCanvas(projectId, (snapshot.nodes[projectId] ?? []).filter((node) => !isTransientNode(node)), viewOf(snapshot, projectId).view);
						});
						const openProject = async (project) => {
							storeInstance.actions.select(project.id);
							try {
								const workspace = await ctx.workspaces.create({ path: project.dir });
								const projects = storeInstance.getSnapshot().projects;
								const occupied = ctx.workspaces.list.getSnapshot().items.find((item) => item.title === project.name && item.path !== project.dir);
								if (occupied !== void 0 && !projects.some((entry) => entry.dir === occupied.path)) await ctx.workspaces.delete(occupied.workspaceId);
								await ctx.workspaces.rename(workspace.workspaceId, project.name);
								if (!resumeLatestSession(workspace.workspaceId)) ctx.workspaces.startSession(workspace.workspaceId);
								await reloadCanvasQueued(project.id).then(() => flushPendingBrief(project.id));
								refreshWorkflow(project.id);
								if (devSeed) {
									if ((storeInstance.getSnapshot().nodes[project.id] ?? []).length === 0) {
										const seeded = seedNodes();
										storeInstance.actions.setNodes(project.id, seeded);
										await persistCanvas(project.id);
									}
								}
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目会话绑定失败");
							}
						};
						const createProject = async (name) => {
							storeInstance.actions.setCreating(true);
							try {
								const project = await createStudioProject(name);
								await refreshProjects();
								await openProject(project);
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目创建失败");
							} finally {
								storeInstance.actions.setCreating(false);
							}
						};
						const deleteProject = async (projectId) => {
							try {
								const project = storeInstance.getSnapshot().projects.find((entry) => entry.id === projectId);
								await deleteStudioProject(projectId);
								if (project !== void 0) {
									const bound = ctx.workspaces.list.getSnapshot().items.find((item) => item.path === project.dir);
									if (bound !== void 0) await ctx.workspaces.delete(bound.workspaceId);
								}
								await refreshProjects();
								if (storeInstance.getSnapshot().selectedProjectId === projectId) {
									storeInstance.actions.select(null);
									storeInstance.actions.clearProject(projectId);
								}
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目删除失败");
							}
						};
						return {
							layout,
							actions: storeInstance.actions,
							refreshProjects,
							createProject,
							openProject,
							deleteProject,
							persistCanvas,
							retryNode,
							steerNode,
							cancelCurrentTurn,
							refreshWorkflow,
							approveStoryboard,
							rejectStoryboard,
							setWorkflowMode,
							settingsScope: ctx.settingsScope,
							getCredentials: () => ctx.get("connection")?.api?.credentials,
							getModelApi: () => ctx.get("connection")?.api,
							getDirectoryPicker: () => ({ pick: () => ctx.workspaces.pickDirectory() }),
							theme: ctx.theme,
							hooks: { studio: storeInstance }
						};
					}
				}, StudioFrame);
				return () => {
					disposeRegistration();
					disposeService();
				};
			}, "canvas-studio: layout service + studio root frame");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map