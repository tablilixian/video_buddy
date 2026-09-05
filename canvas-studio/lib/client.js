window.__ModuleLoader__.load({
	id: "canvas-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
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
		const WORKFLOW_TOOLS = /* @__PURE__ */ new Set([
			"submit_storyboard_for_approval",
			"submit_keyframes_for_approval",
			"ask_user_choice"
		]);
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
					const source = event.data.message?.source;
					if (source === void 0 || source === null || source.callId === void 0 || source.callId === null) return null;
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
				state: record.state === "awaiting_approval" || record.state === "keyframe_review" || record.state === "executing" ? record.state : "drafting"
			};
			const pending = record.pendingQuestion;
			if (pending !== null && pending !== void 0 && typeof pending === "object" && !Array.isArray(pending)) {
				const question = pending;
				if (!Array.isArray(question.options)) console.warn("[canvas-studio] normalizeWorkflow: pendingQuestion.options 缺失或非数组，降级为空候选", question);
				workflow.pendingQuestion = {
					id: typeof question.id === "string" ? question.id : "",
					question: typeof question.question === "string" ? question.question : "",
					options: Array.isArray(question.options) ? question.options.map(String) : [],
					...question.allowFreeText === false ? { allowFreeText: false } : {},
					...question.multiSelect === true ? { multiSelect: true } : {},
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
			let value;
			try {
				value = await response.json();
			} catch {
				throw new StudioApiError(`request failed: ${response.status}`, response.status);
			}
			const record = value;
			if (!response.ok) throw new StudioApiError(typeof record.error === "string" ? record.error : `request failed: ${response.status}`, response.status, typeof record.code === "string" ? record.code : void 0);
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
		async function createStudioProject(name, groupId, signal) {
			return (await readJson(await fetch("/canvas-studio/projects", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(groupId === void 0 ? { name } : {
					name,
					groupId
				}),
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
		/**
		* CV-091：列出全部分组（左侧栏可折叠分组的一等公民）。
		*/
		async function listStudioGroups(signal) {
			return (await readJson(await fetch("/canvas-studio/groups", {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}))).groups;
		}
		/** CV-091：新建分组，返回其记录。 */
		async function createStudioGroup(name, signal) {
			return (await readJson(await fetch("/canvas-studio/groups", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name }),
				...signal === void 0 ? {} : { signal }
			}))).group;
		}
		/** CV-091：重命名分组。 */
		async function renameStudioGroup(id, name, signal) {
			return (await readJson(await fetch("/canvas-studio/groups", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id,
					name
				}),
				...signal === void 0 ? {} : { signal }
			}))).group;
		}
		/** CV-091：删除分组（组内项目回落未分组）。 */
		async function deleteStudioGroup(id, signal) {
			await readJson(await fetch("/canvas-studio/groups", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id }),
				...signal === void 0 ? {} : { signal }
			}));
		}
		/** CV-091：把项目移入/移出分组（groupId=null 即归未分组）。 */
		async function moveStudioProjectToGroup(projectId, groupId, signal) {
			await readJson(await fetch("/canvas-studio/projects", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: projectId,
					groupId
				}),
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
		/** P7：工作流动作（批准 / 驳回 / 确认关键帧 / 切换模式），返回更新后的工作流。 */
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
				const rewritten = node.url.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/canvas-studio\/.*)$/, "$1");
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
		/** CV-066：读某项目已装载的 skill 清单（skills.json）。 */
		async function loadActiveSkills(projectId, signal) {
			return (await readJson(await fetch(`/canvas-studio/active-skills?projectId=${encodeURIComponent(projectId)}`, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}))).skills;
		}
		/** CV-066：整表替换某项目已装载的 skill 清单（幂等；activate/deactivate 都是调它）。 */
		async function saveActiveSkills(projectId, skills, signal) {
			await readJson(await fetch("/canvas-studio/active-skills", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId,
					skills
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
		//#region src/brand.ts
		/**
		* Canvas Studio 品牌令牌（可切换配色预设）。
		*
		* 纯数据 + 纯函数，无 DOM 依赖：Host/Client 双半均可编译，`node --test` 可直连
		* （tests/brand.test.mjs 直连 lib/brand.js）。DOM 注入逻辑在
		* `src/client/brand-inject.ts`，UI 组件在 `src/client/brand/`。
		*
		* 设计约束（brand-identity-proposal.md §3）：
		* - 令牌命名空间 `--cs-*`，叠加在 dsh `--dsw-alias-*` 语义令牌之上，不推翻宿主；
		* - 配色做成多预设可切换（Q3 拍板 2026-08-31）：切换只动 accent 族，gold/teal
		*   固定功能色与宿主语义色不变；
		* - 明暗双轨：浅色默认取 accentDeep，深色经 `body[data-ds-dark-theme]` 覆盖取 accent。
		*/
		const BRAND_PRESET_IDS = [
			"cinema-violet",
			"ocean-blue",
			"ember-violet",
			"amber-creative"
		];
		const DEFAULT_BRAND_PRESET = "cinema-violet";
		/** 四套品牌配色预设（默认 + 3 备选，用户可在设置页「外观」区切换）。 */
		const BRAND_PRESETS = {
			"cinema-violet": {
				id: "cinema-violet",
				label: "电影紫",
				description: "AI 创作行业色 · 默认",
				accent: "#7C6CFF",
				accentStrong: "#9D8DFF",
				accentDeep: "#5B4BD6",
				accentSoft: "rgba(124, 108, 255, 0.14)",
				accentSoftLight: "rgba(91, 75, 214, 0.12)",
				canvasBg: "#0F1117",
				canvasBgL1: "#1A1D29",
				canvasGrid: "rgba(255, 255, 255, 0.045)",
				canvasGridMajor: "rgba(255, 255, 255, 0.07)"
			},
			"ocean-blue": {
				id: "ocean-blue",
				label: "海洋蓝",
				description: "偏蓝 · 贴近宿主",
				accent: "#5B7CFF",
				accentStrong: "#7E9BFF",
				accentDeep: "#3E5CD6",
				accentSoft: "rgba(91, 124, 255, 0.14)",
				accentSoftLight: "rgba(62, 92, 214, 0.12)",
				canvasBg: "#0E1118",
				canvasBgL1: "#182031",
				canvasGrid: "rgba(255, 255, 255, 0.045)",
				canvasGridMajor: "rgba(255, 255, 255, 0.07)"
			},
			"ember-violet": {
				id: "ember-violet",
				label: "炽焰紫",
				description: "更紫 · 高饱和戏剧感",
				accent: "#8B5CF6",
				accentStrong: "#A78BFA",
				accentDeep: "#6D28D9",
				accentSoft: "rgba(139, 92, 246, 0.14)",
				accentSoftLight: "rgba(109, 40, 217, 0.12)",
				canvasBg: "#120F18",
				canvasBgL1: "#1F1930",
				canvasGrid: "rgba(255, 255, 255, 0.045)",
				canvasGridMajor: "rgba(255, 255, 255, 0.07)"
			},
			"amber-creative": {
				id: "amber-creative",
				label: "琥珀金",
				description: "暖金 · 创作激情 / 胶片方向",
				accent: "#F0A94B",
				accentStrong: "#F5C273",
				accentDeep: "#C97F2E",
				accentSoft: "rgba(240, 169, 75, 0.16)",
				accentSoftLight: "rgba(201, 127, 46, 0.14)",
				canvasBg: "#14110E",
				canvasBgL1: "#241E15",
				canvasGrid: "rgba(255, 255, 255, 0.045)",
				canvasGridMajor: "rgba(255, 255, 255, 0.07)"
			}
		};
		/** 固定功能色（不随预设切换）：gold = HITL 审批，teal = 播放 / 预览。 */
		const BRAND_FIXED = {
			gold: "#E8B45A",
			teal: "#35C2A6"
		};
		/** 未知 / 空 id 一律回退默认预设（设置文档损坏或旧版本无该字段时兜底）。 */
		function resolveBrandPreset(id) {
			if (id !== null && id !== void 0 && id in BRAND_PRESETS) return BRAND_PRESETS[id];
			return BRAND_PRESETS[DEFAULT_BRAND_PRESET];
		}
		/** 非配色令牌（间距 / 圆角 / 阴影 / 动效），不随预设切换。 */
		const NON_COLOR_TOKENS = [
			["--cs-space-1", "4px"],
			["--cs-space-2", "8px"],
			["--cs-space-3", "12px"],
			["--cs-space-4", "16px"],
			["--cs-space-5", "24px"],
			["--cs-space-6", "32px"],
			["--cs-space-7", "48px"],
			["--cs-radius-sm", "6px"],
			["--cs-radius-md", "8px"],
			["--cs-radius-lg", "12px"],
			["--cs-radius-pill", "999px"],
			["--cs-shadow-1", "0 1px 2px rgba(0, 0, 0, 0.4)"],
			["--cs-shadow-2", "0 4px 12px rgba(0, 0, 0, 0.45)"],
			["--cs-shadow-3", "0 12px 32px rgba(0, 0, 0, 0.55)"],
			["--cs-duration-fast", "120ms"],
			["--cs-duration-base", "200ms"],
			["--cs-duration-slow", "320ms"],
			["--cs-ease", "cubic-bezier(0.2, 0, 0, 1)"]
		];
		const renderPairs = (pairs) => pairs.map(([name, value]) => `  ${name}: ${value};`).join("\n");
		/**
		* 生成某预设的完整 `--cs-*` 令牌 CSS 文本。
		*
		* 结构：`body[data-cs-brand="<id>"]`（浅色默认：accent 取 deep、画布底浅色）
		* + `body[data-ds-dark-theme][data-cs-brand="<id>"]`（深色：accent 取主色）。
		* 属性锚在 `document.body` 上（CSS 自定义属性沿 DOM 树向下继承，body 下的
		* 全部 UI 才能拿到令牌；此前锚在 <style> 元素自身导致令牌永不生效）。
		* 固定功能色与非配色令牌在两块都注入。切换 = 更新元素 textContent 与
		* body 上的 `data-cs-brand` 属性（见 src/client/brand-inject.ts）。
		*/
		function brandCssText(presetId) {
			const preset = resolveBrandPreset(presetId);
			const light = [
				["--cs-accent", preset.accentDeep],
				["--cs-accent-strong", preset.accentDeep],
				["--cs-accent-deep", preset.accentDeep],
				["--cs-accent-soft", preset.accentSoftLight],
				["--cs-canvas-bg", "#F7F7FA"],
				["--cs-canvas-bg-l1", "#EFEFF4"],
				["--cs-canvas-grid", "rgba(15, 17, 23, 0.05)"],
				["--cs-canvas-grid-major", "rgba(15, 17, 23, 0.09)"]
			];
			const dark = [
				["--cs-accent", preset.accent],
				["--cs-accent-strong", preset.accentStrong],
				["--cs-accent-deep", preset.accentDeep],
				["--cs-accent-soft", preset.accentSoft],
				["--cs-canvas-bg", preset.canvasBg],
				["--cs-canvas-bg-l1", preset.canvasBgL1],
				["--cs-canvas-grid", preset.canvasGrid],
				["--cs-canvas-grid-major", preset.canvasGridMajor],
				["--cs-glow-accent", `0 0 0 1px var(--cs-accent-soft), 0 0 16px ${preset.accent}40`]
			];
			const fixed = [["--cs-gold", BRAND_FIXED.gold], ["--cs-teal", BRAND_FIXED.teal]];
			const fixedText = renderPairs(fixed);
			const nonColorText = renderPairs(NON_COLOR_TOKENS);
			return [
				`body[data-cs-brand="${preset.id}"] {`,
				fixedText,
				nonColorText,
				renderPairs(light),
				"}",
				`body[data-ds-dark-theme][data-cs-brand="${preset.id}"] {`,
				renderPairs(dark),
				"}"
			].join("\n");
		}
		/**
		* 品牌 favicon（V2 Aperture Squircle 简化形，data: URL，零外部请求）。
		* 几何与 scripts/build-brand-assets.mjs 的 favicon.svg 同源（32 网格）：方形
		* squircle + 左侧铰链缝（负空间）+ 两道正片 deep 斜条纹。favicon 无法吃主题令牌，
		* 故硬编码默认预设 cinema-violet 的两色（#7C6CFF 主体 / #5B4BD6 条纹）。
		*/
		const FAVICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\" fill=\"none\"><path fill-rule=\"evenodd\" d=\"M10 2 H22 A8 8 0 0 1 30 10 V22 A8 8 0 0 1 22 30 H10 A8 8 0 0 1 2 22 V10 A8 8 0 0 1 10 2 Z M8 13 H30 V17 H8 Z\" fill=\"#7C6CFF\"/><g fill=\"#5B4BD6\"><path d=\"M9 11 L13 11 L16 4 L12 4 Z\"/><path d=\"M18 11 L22 11 L25 4 L21 4 Z\"/></g></svg>")}`;
		//#endregion
		//#region src/client/brand-inject.ts
		/**
		* 品牌令牌 DOM 注入（client 半）。
		*
		* 单例 `<style data-plugin="canvas-studio">` 元素与组件样式（styles.ts 的
		* installStudioStyles）并列挂在 body；品牌预设锚点 `data-cs-brand` 挂在
		* `document.body` 上——CSS 自定义属性只沿 DOM 树向下继承，锚在 <style>
		* 自身会让令牌永远无法到达页面节点。切换预设 = 更新该元素 textContent
		* （完整 `--cs-*` 令牌）与 body 的 `data-cs-brand` 属性（选择器锚点）。
		*/
		const PLUGIN_ID = "canvas-studio";
		const BRAND_ATTR = "data-cs-brand";
		let brandElement = null;
		let activePreset = DEFAULT_BRAND_PRESET;
		/** 创建 / 复用品牌样式元素（幂等；被外部移除时重建），并在 body 上设置
		* 预设锚点属性（浅色轨道选择器 `body[data-cs-brand=…]` 与深色轨道
		* `body[data-ds-dark-theme][data-cs-brand=…]` 都直接匹配 body 本身）。 */
		function ensureBrandElement() {
			if (brandElement !== null && brandElement.isConnected) return brandElement;
			brandElement = document.createElement("style");
			brandElement.setAttribute("data-plugin", PLUGIN_ID);
			brandElement.textContent = brandCssText(activePreset);
			document.body.appendChild(brandElement);
			document.body.setAttribute(BRAND_ATTR, activePreset);
			return brandElement;
		}
		/** 应用某预设（更新 CSS 变量 + body 的 data-cs-brand 属性），幂等，返回生效的 preset id。 */
		function applyBrandPreset(presetId) {
			const preset = resolveBrandPreset(presetId);
			activePreset = preset.id;
			const element = ensureBrandElement();
			element.textContent = brandCssText(preset.id);
			document.body.setAttribute(BRAND_ATTR, preset.id);
			return preset.id;
		}
		/** 注入品牌 favicon（data: URL 单色场记板），幂等。 */
		function installBrandFavicon() {
			if (document.head.querySelector("link[data-plugin=\"canvas-studio\"][rel=\"icon\"]") !== null) return;
			const link = document.createElement("link");
			link.setAttribute("rel", "icon");
			link.setAttribute("data-plugin", PLUGIN_ID);
			link.href = FAVICON_DATA_URL;
			document.head.appendChild(link);
		}
		/** 安装品牌令牌（默认或给定预设）+ favicon，返回卸载函数（CR-042：真正移除
		* 注入的 DOM 元素、body 上的预设锚点属性并复位引用——否则 effect 重跑会再
		* createElement，旧 <style> 残留在 body 里累积品牌样式）。 */
		function installBrandStyles(presetId) {
			applyBrandPreset(presetId);
			installBrandFavicon();
			return () => {
				if (brandElement !== null) {
					brandElement.remove();
					brandElement = null;
				}
				document.body.removeAttribute(BRAND_ATTR);
				document.head.querySelector("link[data-plugin=\"canvas-studio\"][rel=\"icon\"]")?.remove();
			};
		}
		//#endregion
		//#region src/client/brand/LogoMark.tsx
		function LogoMark(props) {
			const { size = 22, className = "csLogoMark" } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: `csLogoMark ${className}`.trim(),
				width: size,
				height: size,
				viewBox: "0 0 64 64",
				fill: "none",
				role: "img",
				"aria-label": "Canvas Studio",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						fillRule: "evenodd",
						fill: "var(--cs-accent, #7C6CFF)",
						d: "M20 4 H44 A16 16 0 0 1 60 20 V44 A16 16 0 0 1 44 60 H20 A16 16 0 0 1 4 44 V20 A16 16 0 0 1 20 4 Z M12 26 H60 V31 H12 Z M22 38 H42 A6 6 0 0 1 48 44 V48 A6 6 0 0 1 42 54 H22 A6 6 0 0 1 16 48 V44 A6 6 0 0 1 22 38 Z"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						fill: "var(--cs-accent-deep, #5B4BD6)",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10 24 L20 24 L30 8 L20 8 Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M26 24 L36 24 L46 8 L36 8 Z" })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						fill: "var(--cs-accent, #7C6CFF)",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "23",
								cy: "43",
								r: "2.6"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "32",
								cy: "43",
								r: "2.6"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "41",
								cy: "43",
								r: "2.6"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "23",
								cy: "49",
								r: "2.6"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "32",
								cy: "49",
								r: "2.6"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "41",
								cy: "49",
								r: "2.6"
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/brand/HeroBrandMark.tsx
		function HeroBrandMark(props) {
			const { size, className } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LogoMark, {
				size,
				className: className ?? ""
			});
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
		/** CV-066：取某项目已装载的 skill 清单（未绑定或空时返回空数组）。 */
		function activeSkillsOf(state, projectId) {
			if (projectId === null) return [];
			return state.activeSkills[projectId] ?? [];
		}
		/** CV-064 二期：取某项目「是否有过对话」（未绑定或未标记时视为无对话）。 */
		function hasConversationOf(state, projectId) {
			if (projectId === null) return false;
			return state.hasConversation[projectId] === true;
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
					groups: [],
					selectedProjectId: null,
					selectedNodeId: null,
					selectedNodeIds: [],
					phase: "idle",
					error: null,
					creating: false,
					nodes: {},
					views: {},
					workflows: {},
					activeSkills: {},
					hasConversation: {},
					effectTest: null,
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
					setGroups: (draft, groups) => {
						draft.groups = [...groups].sort((left, right) => left.order - right.order);
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
					setActiveSkills: (draft, projectId, skills) => {
						draft.activeSkills = {
							...draft.activeSkills,
							[projectId]: [...skills]
						};
					},
					activateSkill: (draft, projectId, name) => {
						const current = draft.activeSkills[projectId] ?? [];
						if (current.includes(name)) return;
						draft.activeSkills = {
							...draft.activeSkills,
							[projectId]: [...current, name]
						};
					},
					deactivateSkill: (draft, projectId, name) => {
						const current = draft.activeSkills[projectId] ?? [];
						if (!current.includes(name)) return;
						draft.activeSkills = {
							...draft.activeSkills,
							[projectId]: current.filter((candidate) => candidate !== name)
						};
					},
					setHasConversation: (draft, projectId, has) => {
						draft.hasConversation = {
							...draft.hasConversation,
							[projectId]: has
						};
					},
					patchEffectTest: (draft, patch) => {
						draft.effectTest = {
							...draft.effectTest ?? {
								running: false,
								round: "",
								queue: [],
								currentIndex: -1,
								currentLabel: null,
								done: [],
								failures: [],
								finished: false,
								message: null
							},
							...patch
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
					addNode: (draft, projectId, kind, at) => {
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
							x: at?.x ?? LAYOUT.origin + index % LAYOUT.columns * LAYOUT.stepX,
							y: at?.y ?? LAYOUT.origin + Math.floor(index / LAYOUT.columns) * LAYOUT.stepY,
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
						draft.activeSkills = {
							...draft.activeSkills,
							[projectId]: []
						};
						draft.hasConversation = {
							...draft.hasConversation,
							[projectId]: false
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
  /* CV-064：lobby ↔ work 切换时列宽平滑过渡。lobby 态保持 3 列（第三列压到
     0px），列数一致才能插值；列数变化会退化成瞬跳。 */
  transition: grid-template-columns 300ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .csFrame { transition: none; }
}

/* CV-064 lobby 态（无项目）：对话从右栏挪到中栏居中。
 *
 * 实现要点：对话槽（.csChat）**不搬家、不卸载** —— JSX 条件渲染换容器会让
 * 上游 conversation 组件重建，草稿 / 滚动 / 会话绑定全丢。这里只重排 grid：
 * 第三列压 0px，中栏切成「品牌条（auto）/ 聊天（1fr）」两行。
 *
 * 浮层类子元素（.csDetailPanel / .csContextMenu / .csToasts / .csOverlay /
 * 各 Modal）都是 position: fixed，不参与 grid 排布，不受 two-row 影响。 */
.csFrame[data-mode="lobby"],
.csFrame[data-mode="lobby-pending"] {
  grid-template-columns: 280px minmax(0, 1fr) 0px;
  /* 第三行（auto）：CV-065 推荐技能横滚，落在聊天卡片下方。 */
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.csFrame[data-mode="lobby"] .csProjects,
.csFrame[data-mode="lobby-pending"] .csProjects { grid-area: 1 / 1 / 4 / 2; }
.csFrame[data-mode="lobby"] .csCanvas,
.csFrame[data-mode="lobby-pending"] .csCanvas { grid-area: 1 / 2 / 2 / 3; }
/* CV-065：lobby 中栏第三行 —— 推荐技能横滚（work 态不渲染，行塌为 0）。 */
.csFrame[data-mode="lobby"] .csLobbyTail,
.csFrame[data-mode="lobby-pending"] .csLobbyTail { grid-area: 3 / 2 / 4 / 3; }
/* 聊天卡片：居中、限宽限高，浮在中栏下半部分的底色上。 */
.csFrame[data-mode="lobby"] .csChat,
.csFrame[data-mode="lobby-pending"] .csChat {
  grid-area: 2 / 2 / 3 / 3;
  justify-self: center;
  align-self: center;
  width: min(880px, calc(100% - 48px));
  height: min(560px, 100%);
  margin: 0 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-1, none);
}

/* lobby / lobby-pending 态没有画布可操作：工具栏与工作流条整体让位给品牌条
   + 聊天。保持挂载（不条件渲染）以保证 work 态 DOM/交互零变化。 */
.csFrame[data-mode="lobby"] .csToolbar,
.csFrame[data-mode="lobby"] .csWorkflowBar,
.csFrame[data-mode="lobby-pending"] .csToolbar,
.csFrame[data-mode="lobby-pending"] .csWorkflowBar {
  display: none;
}

/* P7 创作工作流条：模式开关 + 审批提示，位于工具栏与画布之间。 */
.csWorkflowBar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
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
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}

/* CV-052 防御层：当前已激活的模式按钮禁用（路由层已短路，这里是第二道）。 */
.csWorkflowMode button:disabled {
  cursor: default;
}

.csWorkflowMode button.csActive:disabled {
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
  background: var(--dsw-alias-bg-layer-3);
}

/* R1（G1）：驳回意见输入框——可选填写不满意点，随驳回消息转述给 agent。 */
.csWorkflowApproval input.csRejectInput {
  width: 260px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.csWorkflowApproval input.csRejectInput::placeholder {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

/* P7 点选式澄清卡片：ask_user_choice 弹出的选择题。 */
.csQuestionCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

.csQuestionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-062：问题头部徽标与操作提示，让点选卡片在对话流里可辨识。 */
.csQuestionIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-3);
  font-size: 11px;
  font-style: normal;
}

.csQuestionHint {
  margin-left: auto;
  font-style: normal;
  font-size: 10px;
  font-weight: 400;
  opacity: 0.6;
}

.csQuestionOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.csQuestionOptions button {
  padding: 6px 16px;
  min-height: 28px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.csQuestionOptions button:hover:not(:disabled) {
  transform: translateY(-1px);
}

/* hover 配色只作用于未选中项——否则会盖掉选中态的反色配色（深底深字不可读）。 */
.csQuestionOptions button:hover:not(:disabled):not(.csSelected) {
  background: var(--dsw-alias-bg-layer-3);
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.csQuestionOptions button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* CV-062：选中态——实心填充 + ✓ 前缀，一眼可辨。 */
.csQuestionOptions button.csSelected {
  background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}

.csQuestionOptions button.csSelected::before {
  content: "✓ ";
}

/* CV-062：确认按钮（两段式交互的提交步），主按钮样式。 */
.csQuestionConfirm {
  align-self: flex-start;
  padding: 6px 18px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
}

.csQuestionConfirm:hover:not(:disabled) {
  transform: translateY(-1px);
}

.csQuestionConfirm:disabled {
  opacity: 0.4;
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

.csStyleDemoCard:hover:not(:disabled):not(.csSelected) {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-layer-2);
}

.csStyleDemoCard:disabled {
  opacity: 0.5;
  cursor: default;
}

.csStyleDemoCard.csSelected {
  border-color: var(--dsw-alias-label-primary);
}

.csStyleDemoCard.csSelected .csStyleDemoName::before {
  content: "✓ ";
  font-weight: 600;
}

.csStyleDemoImg {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
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
  background: var(--dsw-alias-bg-layer-3);
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
  /* CV-070：拆出 .csProjectsScroll 让「品牌条 / 段头+列表 / 用户卡」三段分别
     自管 padding；侧栏自身不再 overflow，列表仅在列表区滚动，用户卡固定底部。 */
  border-right: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  min-height: 0;
  overflow: hidden;
}

/* CV-070：列表区独立滚动容器 —— 段头「项目 + 刷新」与项目行共享同一滚动条，
   不会带飞用户卡。min-height:0 是 flex item 在固定高度父下允许收缩的硬条件。 */
.csProjectsScroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csProjectsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* CV-070：与「+ 新建项目」按钮顶部 4px 呼吸，确保刷新按钮不贴边 */
  padding: 4px 0 2px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectsHeader > span {
  flex: 1 1 auto;
}

.csProjectsHeader button {
  font: inherit;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.csProjectsHeader button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
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
  /* CV-070：列表现处于 .csProjectsScroll 滚动容器内，必须按自然高度排布
     （flex:0 0 auto）。若保留 flex:1 1 auto + min-height:0，列表会被压到
     滚动容器高度后再溢出，滚动高度依赖浏览器对 flex item 溢出的计算，
     Chrome/Safari 行为不一致，末尾几行可能滚不到。 */
  flex: 0 0 auto;
}

/* -- CV-069 / CV-070：左栏底部用户卡（固定底部，与上方列表区用顶 border 分隔） -- */
.csUser {
  /* 不再用 margin-top:auto 推底——列表区已独立滚动，卡片始终固定底部，自身
     不参与 flex grow。 */
  flex: 0 0 auto;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
/* 单个用户条按钮（点开面板；设置入口在面板内部 .csUserSettings）。 */
.csUserBar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.csUserBar:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserAvatar {
  border-radius: 50%;
  flex-shrink: 0;
}
.csUserBarName {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* CV-069 修复：position:fixed 逃出 .csProjects 的 overflow 裁剪（坐标由组件
   实测内联注入）；background 用真实存在的 --dsw-alias-bg-base（bg-l1 缩写
   令牌在主题包中不存在，此前面板背景透明）。 */
.csUserPanel {
  position: fixed;
  z-index: 90;
  width: 260px;
  max-height: min(480px, 72vh);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
}
.csUserHead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 10px;
}
.csUserHeadMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.csUserName {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csUserUid {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csUserRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 6px;
}
.csUserRowLabel {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
.csUserValue {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csUserBadge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.csUserChevron {
  color: var(--dsw-alias-label-tertiary);
}
.csUserGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.csUserGroupLabel {
  padding: 0 6px 4px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: 0.05em;
}
.csUserEntry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.csUserEntry:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserEntry:disabled {
  cursor: default;
}
.csUserSettings {
  margin-top: 6px;
  padding-top: 9px;
  padding-bottom: 9px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0 0 8px 8px;
}
.csUserThemeRow {
  display: flex;
  gap: 6px;
  padding: 2px 6px 6px;
}
.csUserThemeBtn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csUserThemeBtn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserThemeActive {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}

/* CV-088：Lobby 个性化问候（LobbyHero 品牌条内）。 */
.csLobbyGreet {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
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

/* 一键效果测试：用例勾选行 + 运行进度块（复用侧栏字色与间距节奏）。 */
.csEffectTestCases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.csEffectTestCase {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  cursor: pointer;
}

.csEffectTestProgress {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  margin: 2px 0;
  border: 1px solid var(--cs-border, rgba(128, 128, 128, 0.35));
  border-radius: 6px;
  font-size: 12px;
  opacity: 0.9;
}

.csEffectTestTitle {
  font-weight: 600;
}

.csEffectTestFailure {
  color: #e05252;
  word-break: break-all;
}

.csEffectTestSummary {
  opacity: 0.75;
  word-break: break-all;
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
  padding: 8px 10px 8px 12px;
  border-radius: 6px;
  /* CV-070：选中态用左侧 accent 边线取代整圈边框，配上轻微底色，活动状态更易扫视。 */
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.csProjectItem:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csProjectItemActive {
  border-color: var(--dsw-alias-border-l2);
  border-left-color: var(--cs-accent, #6c5ce7);
  background: var(--dsw-alias-interactive-bg-active);
}

.csProjectItem:focus-visible {
  outline: 2px solid var(--cs-accent, #6c5ce7);
  outline-offset: -2px;
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
  font-size: 11px;
  line-height: 1.3;
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
  /* CV-070：默认隐藏 × ，hover/focus 当前行才显出，避免视觉噪音 */
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.csProjectItem:hover .csProjectDelete,
.csProjectItem:focus-within .csProjectDelete,
.csProjectDelete:focus-visible {
  opacity: 1;
}

.csProjectItemActive .csProjectDelete {
  /* 选中行始终可见 —— 用户已经盯着这一行，需要确切的删除入口 */
  opacity: 1;
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

/* -- CV-091：用户自定义分组 + 折叠（沿用 DSW 主题变量，深色/浅色自适应） -- */
.csProjectListActions {
  display: flex;
  gap: 6px;
  padding: 2px 0 4px;
}

.csProjectNewGroup {
  /* 与「+ 新建项目」共用 .csProjectNew 虚线外观，不作额外视觉区分。 */
  flex: 0 0 auto;
}

.csProjectGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

.csProjectGroupHeader {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 2px;
}

.csProjectGroupToggle {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.csProjectGroupToggle:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csProjectGroupName {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 可重命名分组的名字（有 title）才显示手型，提示双击改名。 */
.csProjectGroupName[title] {
  cursor: pointer;
}

.csProjectGroupNameInput {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--cs-accent, #6c5ce7);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csProjectGroupCount {
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectGroupActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.csProjectGroupAdd,
.csProjectGroupDelete {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.csProjectGroupAdd:hover:not(:disabled),
.csProjectGroupDelete:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* 删组按钮：默认隐藏，hover/focus 分组头才显出（与项目行 × 同惯例）。 */
.csProjectGroupDelete {
  opacity: 0;
}

.csProjectGroupHeader:hover .csProjectGroupDelete,
.csProjectGroupHeader:focus-within .csProjectGroupDelete,
.csProjectGroupDelete:focus-visible {
  opacity: 1;
}

.csProjectGroupDelete:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-border-l2);
}

.csProjectGroupDelete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csProjectGroupEmpty {
  padding: 4px 10px 4px 26px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectFormInline {
  padding: 2px 0 2px 22px;
}

.csProjectRowActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.csProjectMove {
  font: inherit;
  font-size: 11px;
  max-width: 92px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  /* 默认隐藏，hover/focus 当前行才显出（与 × 同惯例，减少噪音）。 */
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.csProjectItem:hover .csProjectMove,
.csProjectItem:focus-within .csProjectMove,
.csProjectMove:focus-visible {
  opacity: 1;
}

/* 选中行始终显出移动入口，与选中行 × 常驻一致。 */
.csProjectItemActive .csProjectMove {
  opacity: 1;
}

.csProjectMove:disabled {
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

/* CV-089：marquee 期间切到 crosshair。覆盖 :active 的 grabbing 优先级，因为
   框选是该手势的目的态而不是平移状态。 */
.csCanvasSurface[data-mode="marquee"] {
  cursor: crosshair;
}
.csCanvasSurface[data-mode="marquee"]:active {
  cursor: crosshair;
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
  /* CR-081：位移走 transform（CanvasNode 用 translate3d 定位），提升为合成层，
     拖拽/微调不触发布局重绘。 */
  will-change: transform;
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

/* CV-089：选中态用实色 accent 描边 + 外光晕，去掉「半透明蓝蒙层」观感。
   旧实现用 --dsw-alias-interactive-bg-active（带透明度的浅蓝），在大节点上
   视觉上像「蒙了一层蓝」；改用 --cs-accent 实色双层 box-shadow（外描边 +
   外光晕），节点内容不被覆盖、视觉上明显是「被选中」而非「被蒙层」。
   --cs-accent-soft 在深色主题下 = accentSoft（同色稍降饱和），浅色主题
   下 = accentSoftLight，保证光晕在两种主题里都可见。 */
/* CV-089：主被拖动节点 —— z-index 抬到最上层，避免拖动时被其他选中节点的
   box-shadow 外光晕遮住；同时用更明显的描边宽度区分它与一般选中成员。
   （多选拖拽时所有选中节点都会拿到 csNodeSelected，但只有"用户按下的
   那个"再拿到 csNodePrimary；这样视觉上「主」与「随从」一眼可分。） */
.csNodePrimary.csNodeSelected {
  z-index: 3;
  box-shadow:
    0 0 0 2px var(--cs-accent, #6c5ce7),
    0 0 0 6px var(--cs-accent-soft, transparent);
}

/* CV-089：连线和 resize 把手只在 hover/选中 显 —— 之前 link handle 常驻，
   每个媒体节点右缘都挂一个 12px 圆点，叠加在大批节点上视觉上像"蒙了一层"。
   现改为 hover 当前节点或该节点被选中才显出。 */
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
  opacity: 0;
  transition: opacity 100ms ease;
}

.csNode:hover .csNodeLinkHandle,
.csNodeSelected .csNodeLinkHandle {
  opacity: 1;
}

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

/* CV-089：选中态 —— 实色 accent 描边 + 外光晕。
   【已移除 dim】曾在这里挂过 .csCanvasSurface[data-dragging="true"] 规则，
   把「非被拖节点」压到 opacity 0.55 / 0.85。那是错的：dim 的合理语义是
   「框选时区分命中/未命中」，而 data-dragging 是在**节点拖动**时置上的，
   于是点选单张图拖动会把整屏其他节点压暗，看上去像"蒙了一层"。
   现在拖动节点不改任何节点的不透明度，只给被拖的那个抬 z-index + 加粗描边。 */
.csNodeSelected {
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow:
    0 0 0 1.5px var(--cs-accent, #6c5ce7),
    0 0 0 4px var(--cs-accent-soft, transparent);
  transition: box-shadow 80ms ease, opacity 80ms ease, border-color 80ms ease;
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

/* CV-081：文本类节点选中态正文可滚动（长分镜表/脚本不再截断）。
   滚轮豁免在 CanvasSurface 的 wheel handler 里按「可滚」判定。 */
.csNodeSelected .csNodeBody {
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
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
  position: relative;
  width: 100%;
  height: 100%;
}

/* CV-083：视频时长角标（左下角 m:ss，metadata 就绪后显示）。 */
.csNodeDuration {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: #fff;
  background: color-mix(in srgb, #000 62%, transparent);
  pointer-events: none;
}

/* CV-089：分辨率角标（右下角，图片视频都用；与左下时长角标对称）。
   字号/字号族与时长保持一致，便于左右扫读。 */
.csNodeMediaDims {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: color-mix(in srgb, #000 62%, transparent);
  pointer-events: none;
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

/* CV-011：参考图角色角标（左上角，色点按角色区分，避开错误徽章的位置放底部）。 */
.csNodeRefBadge {
  position: absolute;
  bottom: -8px;
  left: -8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  z-index: 2;
}

.csNodeRefDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-border-l3);
}

/* 角色色点：构图=蓝 / 角色=红 / 风格=紫 / 首末帧=青。 */
.csNodeRefBadge[data-role='image'] .csNodeRefDot { background: #4d9fff; }
.csNodeRefBadge[data-role='character'] .csNodeRefDot { background: #ff6b6b; }
.csNodeRefBadge[data-role='style'] .csNodeRefDot { background: #b58cff; }
.csNodeRefBadge[data-role='frame'] .csNodeRefDot { background: #38c9b8; }

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

/* CV-016：空白处右键菜单（复用 csContextMenu 骨架，仅调宽度）。 */
.csBlankMenu {
  min-width: 140px;
}

/* CV-015：非阻塞 toast（底部居中，逐条堆叠）。 */
.csToasts {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: min(480px, calc(100vw - 48px));
}

.csToast {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-line;
  box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
  animation: csToastIn 160ms ease-out;
}

.csToast-success { border-color: var(--dsw-alias-state-success-primary, var(--dsw-alias-border-l2)); }
.csToast-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }

@keyframes csToastIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
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

/* CV-011：参考托盘空态引导卡片。 */
.csReferenceEmpty {
  margin: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}

.csReferenceEmptyTitle {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.csReferenceEmptyHint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
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

/* CV-059：右侧图标组按钮（整理布局 / 图层 / 小地图）。 */
.csToolbarIconButton {
  display: grid;
  place-items: center;
  padding: 3px 8px;
  color: var(--dsw-alias-label-secondary);
}
.csToolbarIconButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
/* 开关态（图层 / 小地图展开时高亮，等价于原「隐藏图层」文案语义）。 */
.csToolbarIconActive {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
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

/* ---- Settings popup (DeepSeek Harness style: nav rail + content column) ---- */
.csSettingsBackdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}

.csSettingsModal {
  width: 800px;
  height: min(800px, calc(100vh - 48px));
  max-width: calc(100vw - 48px);
  display: flex;
  border-radius: 24px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv3);
}

/* ---- General modal backdrop (used by create project, video player, image preview) ---- */
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

/* ---- Nav rail (left sidebar) ---- */
.csNav {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 188px;
  padding: 22px 12px 0;
  box-sizing: border-box;
}

.csNavTitle {
  padding: 0 12px;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.csNavList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csNavCell {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 9px 16px 9px 12px;
  box-sizing: border-box;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}

.csNavCell:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csNavCellActive {
  background: var(--dsw-alias-interactive-bg-active);
}

.csNavLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---- Content column (right side) ---- */
.csContent {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.csContentHeader {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  height: 54px;
  padding: 20px 14px 8px 10px;
  box-sizing: border-box;
}

.csContentActions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.csClose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 28px;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
}

.csClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csCloseIcon {
  font-size: 18px;
  line-height: 1;
}

.csContentOptions {
  flex: 1;
  min-height: 0;
  padding: 0 24px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- Legacy class names (kept for compatibility with child sections) ---- */
.csModalHeader {
  display: none;
}

.csModalHeader h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.csModalHeaderText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.csModalHeaderMeta {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.csModalHeaderMetaSep {
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.6;
}

.csModalClose {
  display: none;
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
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldSelect:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

/* ---- CV-092：新建项目弹窗 ---- */
/* 分组选择行：文件夹图标 + 下拉，对齐截图里的「📁 项目 / 选择」。 */
.csCreateGroupRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csCreateGroupIcon {
  font-size: 15px;
  line-height: 1;
  flex: 0 0 auto;
}

.csCreateGroupRow .csFieldSelect {
  flex: 1 1 auto;
  min-width: 0;
}

/* 弹窗底部操作区（取消 / 创建）。 */
.csModalFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.csModalBtnSecondary {
  font: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csModalBtnSecondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csModalBtnSecondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.csModalBtnPrimary {
  font: inherit;
  font-size: 13px;
  padding: 7px 18px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--cs-accent, #5b4bd6);
  color: #fff;
  cursor: pointer;
}

.csModalBtnPrimary:hover:not(:disabled) {
  filter: brightness(1.12);
}

.csModalBtnPrimary:disabled {
  opacity: 0.5;
  cursor: default;
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
  background: var(--dsw-alias-bg-layer-1);
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

/* 精简模式：未使用官方 provider 的折叠开关条 */
.csModelFold {
  display: flex;
  margin: 8px 0;
}

.csModelFoldToggle {
  width: 100%;
  justify-content: center;
  border-style: dashed;
}

.csModelCustomForm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

/* ---- CV-044：视频 / 图片全尺寸预览浮层 ---- */
/* 撑大至接近应用窗口尺寸（max-width 1280 / calc(100vw - 48px)）；视频以真实比例渲染，
   按容器 max-* 自动钳制并保持宽高比，stage 黑底衬出任意比例的 letterbox/pillarbox。 */
.csVideoModalCard {
  width: auto;
  max-width: min(1280px, calc(100vw - 48px));
}
/* CV-044：浮层播放器不挂原生控件（避免原生「双击=全屏」），改点击画面切换
   播放/暂停；stage 相对定位承载居中播放图标。 */
.csVideoStage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  cursor: pointer;
  min-height: 240px;
}
.csVideoModalVideo {
  display: block;
  /* 浏览器按内在尺寸保持宽高比：max-width 限制宽度，max-height 扣除标题栏(49)
     + 控制条(56) + 上下安全边距(≈35) ≈ 140；剩余空间由浏览器等比缩放。 */
  max-width: 100%;
  max-height: calc(100vh - 140px);
  width: auto;
  height: auto;
  background: #000;
}
.csVideoPlayIcon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: rgb(255 255 255 / 85%);
  text-shadow: 0 4px 16px rgb(0 0 0 / 60%);
  pointer-events: none;
}

/* ---- CV-057：视频浮层自绘控制条 ---- */
.csVideoControls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csVideoControlButton {
  display: grid;
  place-items: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.csVideoControlButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.csVideoTime {
  min-width: 44px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  user-select: none;
}
/* 进度条：轨道 + 已播填充；pointer capture 拖动 seek。 */
.csVideoProgress {
  position: relative;
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3);
  cursor: pointer;
  touch-action: none;
}
.csVideoProgressFill {
  height: 100%;
  border-radius: 3px;
  background: var(--dsw-alias-brand, #4f7cff);
  pointer-events: none;
}
.csVideoVolume {
  width: 72px;
  accent-color: var(--dsw-alias-brand, #4f7cff);
}

/* CV-044 扩展：图片大图预览浮层（与视频浮层同尺寸规则，黑底衬托图片）。 */
.csImagePreviewStage {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  min-height: 240px;
}
.csImagePreviewImg {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 49px);
  width: auto;
  height: auto;
  object-fit: contain;
}

/* 媒体预览（视频 / 图片）加深背景遮罩，与参考 #1 的暗化预览观感一致；不挂在
   .csModalBackdrop 上以免影响 Settings/SkillMarket 等普通弹窗。 */
.csMediaPreviewBackdrop {
  background: rgb(0 0 0 / 78%);
}

/* ===== 品牌层（--cs-* 令牌由 src/brand.ts 注入，见 brand-inject.ts；叠加 --dsw-alias-*） ===== */

/* 左侧栏品牌条：场记板 logo + Canvas Studio（创意工厂）。 */
.csBrandHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.csLogoMark {
  display: block;
  flex: 0 0 auto;
}
.csBrandMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.csBrandName {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csBrandSub {
  font-size: 11px;
  color: var(--cs-accent, var(--dsw-alias-label-tertiary));
}

/* 首启欢迎屏（画布区）。 */
.csWelcome {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 32px;
  background:
    radial-gradient(60% 50% at 50% 40%, var(--cs-accent-soft, transparent), transparent 70%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csWelcomeCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  text-align: center;
  padding: 36px 40px;
  border-radius: var(--cs-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-2, none);
}
.csWelcomeTitle {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csWelcomeNameZh {
  margin-left: 8px;
  font-size: 14px;
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomeTagline {
  margin: 0;
  font-size: 13px;
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomePositioning {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csWelcomeActions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.csWelcomeActions button {
  padding: 7px 16px;
  font-size: 13px;
  border-radius: var(--cs-radius-md, 8px);
  cursor: pointer;
}
.csWelcomeActions .csPrimary {
  border: 1px solid transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csWelcomeActions .csPrimary:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}
.csWelcomeSample {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.csWelcomeSample:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csWelcomeSample:disabled {
  opacity: 0.55;
  cursor: default;
}
.csWelcomeSampleHint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

/* CV-064：Lobby 态中栏顶部品牌条（横向紧凑版，与下方居中的聊天卡片配套）。
   与 .csWelcome*（整屏欢迎卡）分开：后者会把聊天挤出视口。 */
.csLobbyHero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 32px 18px;
  background:
    radial-gradient(70% 130% at 50% 0%, var(--cs-accent-soft, transparent), transparent 70%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csLobbyBrand {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.csLobbyBrandMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.csLobbyTitle {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csLobbyNameZh {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyTagline {
  margin: 0;
  font-size: 12px;
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyHint {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csLobbyActions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.csLobbyButtons {
  display: flex;
  gap: 10px;
}
.csLobbyActions button {
  padding: 7px 16px;
  font-size: 13px;
  border-radius: var(--cs-radius-md, 8px);
  cursor: pointer;
}
.csLobbyActions .csPrimary {
  border: 1px solid transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csLobbyActions .csPrimary:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}
.csLobbyActions .csWelcomeSample {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.csLobbyActions .csWelcomeSample:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csLobbyActions .csWelcomeSample:disabled {
  opacity: 0.55;
  cursor: default;
}
.csLobbySampleHint {
  margin: 0;
  font-size: 11px;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
}

/* 画布中心空态引导（不挡画布交互）。 */
.csCanvasEmptyHint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, 80%);
  padding: 18px 22px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  text-align: center;
  pointer-events: none;
  box-shadow: var(--cs-shadow-1, none);
}
.csCanvasEmptyHintTitle {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.csCanvasEmptyHintText {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

/* 通用加载卡。 */
.csLoadingCard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
}
.csLoadingText {
  font-size: 12px;
}
.csLogoMarkPulse {
  animation: csLogoPulse 1.6s ease-in-out infinite;
}
@keyframes csLogoPulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

/* 错误三级处置卡。 */
.csErrorCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-state-error-border, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-layer-1);
}
.csErrorTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
}
.csErrorMessage {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.csErrorHint {
  margin: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csErrorActions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.csErrorAction {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csErrorAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csErrorActionPrimary {
  border-color: transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csErrorActionPrimary:hover {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}

/* 设置页「外观」区：品牌配色预设 swatch。 */
.csBrandSwatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.csBrandSwatch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csBrandSwatch:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csBrandSwatchActive {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  box-shadow: 0 0 0 1px var(--cs-accent-soft, transparent);
}
.csBrandSwatchChip {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgb(0 0 0 / 25%);
  display: inline-block;
}
.csBrandSwatchName {
  font-size: 12px;
}

/* ==================== CV-065 技能广场 ====================
   组件：SkillCarousel（lobby 横滚）/ SkillMarket（全屏）/ SkillCard（卡）。
   「使用」= 提示词插进对话输入框，不做其它副作用。 */

/* -- lobby 第三行：推荐技能横滚 -- */
.csLobbyTail {
  padding: 4px 24px 18px;
  overflow: hidden;
}
.csLobbyTailHead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.csLobbyTailHead > span:first-child {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csLobbyTailHint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

/* -- 横滚条 -- */
.csSkillCarousel {
  display: flex;
  align-items: center;
  gap: 10px;
}
.csCarouselTrack {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 2px 6px;
  scroll-behavior: smooth;
}
.csCarouselTrack::-webkit-scrollbar {
  display: none;
}
.csCarouselItem {
  flex: 0 0 auto;
  width: 264px;
}
.csCarouselNav {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.csCarouselNav:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csCarouselMore {
  flex: 0 0 auto;
  margin-left: 4px;
  padding: 6px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.csCarouselMore:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* -- 技能卡 -- */
.csSkillCard {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.csSkillCard:hover {
  border-color: var(--cs-accent-soft, var(--dsw-alias-border-l2));
  box-shadow: var(--cs-shadow-1, none);
}
.csSkillThumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 110px;
  color: rgb(255 255 255 / 92%);
}

/* CV-070：默认显示的动态演示 GIF（盖在渐变缩略图上；无 demo 则不渲染）。
   prefers-reduced-motion 降级为静态渐变（不动画敏感用户不强制播）。 */
.csSkillThumbGif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .csSkillThumbGif {
    display: none;
  }
}

/* CV-076：H3 能力角标（左上角，真实信息）。 */
.csSkillH3 {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: #fff;
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 82%, transparent);
  pointer-events: none;
}

/* CV-071：hover 浮层「查看详情」。 */
.csSkillHover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: color-mix(in srgb, #000 45%, transparent);
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.csSkillCard:hover .csSkillHover,
.csSkillCard:focus-within .csSkillHover {
  opacity: 1;
  pointer-events: auto;
}
.csSkillHoverBtn {
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 90%, transparent);
  cursor: pointer;
}
/* CV-071：次要操作（查看详情）用 ghost 变体，避免与主操作「使用」抢视觉。 */
.csSkillHoverGhost {
  background: color-mix(in srgb, rgb(255 255 255 / 14%) 100%, transparent);
  border: 1px solid color-mix(in srgb, #fff 42%, transparent);
}
.csSkillHoverGhost:hover {
  background: color-mix(in srgb, rgb(255 255 255 / 24%) 100%, transparent);
}
.csSkillHoverBtn:hover {
  filter: brightness(1.1);
}

/* CV-072：广场右上搜索框。 */
.csSkillSearch {
  width: 200px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillSearch:focus {
  outline: none;
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
}

/* CV-074：官方精选 / 其他技能 分区标题。 */
.csSkillSectionTitle {
  margin: 4px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-077：仅显示未装载 过滤行。 */
.csSkillOnlyInactive {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
}

/* CV-073：我的 Skill 清单。 */
.csSkillContent {
  flex: 1;
  overflow-y: auto;
  padding: 4px 4px 16px;
}
.csSkillMine {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.csSkillMineRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillMineTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csSkillMineName {
  flex: 1;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillMineRemove {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csSkillMineRemove:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-border-l2);
}
.csSkillEmpty {
  padding: 32px 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}

/* CV-078：创作者社区收尾卡（reserved 纯展示）。 */
.csSkillCommunity {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 140px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  padding: 12px;
}
.csSkillCommunity h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.csSkillCommunity p {
  margin: 0;
  font-size: 11px;
}
.csSkillCommunityIcon {
  font-size: 16px;
}

/* CV-071：技能详情弹窗。 */
.csSkillDetailBackdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 50%, transparent);
}
.csSkillDetail {
  display: flex;
  gap: 14px;
  width: min(460px, calc(100vw - 48px));
  padding: 18px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-2, none);
}
.csSkillDetailThumb {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  border-radius: 12px;
  color: rgb(255 255 255 / 92%);
}
.csSkillDetailBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.csSkillDetailTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csSkillDetailTitle .csSkillH3 {
  position: static;
}
.csSkillDetailCategory {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillDetailSummary {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.csSkillDetailName {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillDetailActions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.csSkillDetailUse {
  padding: 5px 14px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  color: #fff;
  background: var(--cs-accent, #6c5ce7);
  cursor: pointer;
}
.csSkillDetailClose {
  padding: 5px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csSkillBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  flex: 1;
}
.csSkillTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csSkillSummary {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.csSkillFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}
.csSkillCategory {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
}
.csSkillUse {
  padding: 4px 14px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-md, 8px);
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
  cursor: pointer;
}
.csSkillUse:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}

/* -- 全屏技能广场（覆盖层） -- */
.csSkillMarket {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.csSkillMarketBar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillMarketBack {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
.csSkillMarketBack:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csSkillMarketTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.csSkillMarketCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillMarketSpacer {
  flex: 1;
}
.csSkillMarketCreate {
  position: relative;
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: default;
  opacity: 0.6;
}
.csSkillMarketCreate .csReserved {
  margin-left: 6px;
}
.csSkillMarketBody {
  display: flex;
  flex: 1;
  min-height: 0;
}
.csSkillRail {
  flex: 0 0 190px;
  padding: 10px 8px;
  border-right: 1px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.csSkillRailItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.csSkillRailItem:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csSkillRailActive {
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.csSkillRailCount {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillRailActive .csSkillRailCount {
  color: inherit;
}
.csSkillGrid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
  align-content: start;
}

/* CV-008 / CV-089：marquee 框选矩形（屏幕坐标层，pointer-events 关闭）。
   旧实现 1px 实线 + 10% 蒙层在深色画布上太弱；改为 1.5px dashed + 加深蒙层
   + 一道外发光，整体观感与选中节点统一，强化「正在框选」的反馈。 */
.csMarquee {
  position: absolute;
  z-index: 30;
  border: 1.5px dashed var(--cs-accent, #6c5ce7);
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 14%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--cs-accent, #6c5ce7) 22%, transparent);
  border-radius: 2px;
  pointer-events: none;
}

/* -- CV-066：work 态已装载技能 chip 行 -- */
.csSkillChips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillChipsLabel {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  margin-right: 2px;
}
.csSkillChip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 10px;
  border: 1px solid var(--cs-accent-soft, var(--dsw-alias-border-l2));
  border-radius: 999px;
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-size: 12px;
}
.csSkillChipName {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillChipRemove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.csSkillChipRemove:hover {
  background: rgb(0 0 0 / 12%);
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
		//#region src/brand-copy.ts
		/**
		* Canvas Studio 品牌文案与三态微文案（集中常量表）。
		*
		* 统一「导演 / 镜头 / 成片」语汇（brand-identity-proposal.md §6）。纯数据模块，
		* 组件只从这里取文案，不散落硬编码。命名：Canvas Studio（英文主名）· 创意工厂
		* （中文运营名，2026-08-31 拍板）；tagline From idea to final cut.
		*/
		const BRAND = {
			/** 英文主名。 */
			name: "Canvas Studio",
			/** 中文运营名。 */
			nameZh: "创意工厂",
			/** 主 Tagline（已定案）。 */
			tagline: "From idea to final cut.",
			/** Tagline 中文。 */
			taglineZh: "从创意到成片",
			/** 一句话定位（正式场合：README / 设置页 About）。 */
			positioning: "Agent 驱动的 AI 视频生产工作台",
			/** 定位完整句。 */
			positioningFull: "Agent 驱动的 AI 视频生产工作台：你定方向，AI 执导全程。",
			/** 副语（欢迎屏 / About 补充）。 */
			subline: "Let your agent direct."
		};
		/** 空态（empty）三场景文案。 */
		const EMPTY_COPY = {
			/** 首启欢迎屏主标题。 */
			welcomeTitle: "从一句话创意开始",
			/** 首启欢迎屏引导。 */
			welcomeHint: "新建项目后，在右侧对话里描述你的创意——分镜、定妆、场景与成片，都由 agent 替你排好。",
			/** 欢迎屏主 CTA。 */
			createProject: "新建项目",
			/** 欢迎屏副 CTA：示例项目。 */
			createSample: "创建示例项目",
			/** 欢迎屏副 CTA 说明。 */
			sampleHint: "预置分镜、定妆、场景与视频节点，直观感受画布全链路",
			/** 有项目但画布无节点（画布中心引导）。 */
			canvasEmptyTitle: "画布空空如也",
			canvasEmptyHint: "在右侧对话描述你的创意，agent 会为你排好一切；也可以拖入图片或右键新建素材。",
			/** 未选中项目（画布区提示）。 */
			noProject: "打开或新建一个项目，开始创作",
			/** 项目列表空态。 */
			projectEmpty: "还没有项目，点击「新建项目」开始创作"
		};
		/** Lobby 态（无项目：对话居中）文案。 */
		const LOBBY_COPY = {
			/** 品牌条引导句（聊天框上方）。 */
			hint: "在下面描述你的创意 —— 分镜、定妆、场景与成片，agent 替你排好。",
			/** 示例项目短说明（品牌条右侧，比欢迎屏更紧凑）。 */
			sampleHint: "预置分镜与视频节点，直观感受全链路"
		};
		/**
		* CV-069：用户信息面板假数据（mock persona，中文创作人设）。
		* 接真用户体系时只改这一处；积分/订阅为 reserved 展示（UI 挂「待接入」
		* 角标，不伪造可充值语义）。
		*/
		const USER_MOCK = {
			/** 昵称（CV-088 Lobby 问候同源）。 */
			name: "林小满",
			/** 展示用 UID（假）。 */
			uid: "467368332739416065",
			/** 账号身份。 */
			plan: "个人账号",
			/** 积分余额（假数，reserved）。 */
			credits: 2600
		};
		/** 加载态（loading）文案。 */
		const LOADING_COPY = {
			/** 项目列表加载中。 */
			projects: "正在加载项目…",
			/** 画布载入中。 */
			canvas: "画布载入中…",
			/** 按生产阶段的生成中文案（节点级与骨架屏共用）。 */
			stage: (stage) => `${stage}中…`,
			stages: {
				storyboard: "分镜推演",
				character: "角色定妆",
				scene: "场景概念",
				clip: "镜头渲染",
				compose: "成片合成"
			}
		};
		/** 错误态（error）三级处置文案。 */
		const ERROR_COPY = {
			/** 可重试：通用文案。 */
			retryable: "出错了，重试一次？",
			retry: "重试",
			/** 配置缺失。 */
			configTitle: "配置缺失",
			configHint: "请到设置里检查 Drama API 基址与密钥。",
			openSettings: "打开设置",
			/** 服务不可达。 */
			unreachableTitle: "服务不可达",
			unreachableHint: "生成服务没有响应，请确认 Drama 后端已启动后重试。"
		};
		//#endregion
		//#region src/error-kind.ts
		/**
		* 硬性网络信号：连接被拒 / DNS 失败 / 底层 fetch 失败——服务确实不可达，
		* 即使消息里混着 api key 等词也优先提示「检查后端」（既有语义，勿改）。
		*/
		const UNREACHABLE_HARD_PATTERNS = [
			/fetch failed/i,
			/ECONNREFUSED/i,
			/ENOTFOUND/i,
			/connection refused/i,
			/socket hang up/i,
			/failed to fetch/i
		];
		/**
		* 软性网络信号：超时 / 连接失败等措辞——可能与配置缺失同时出现
		* （「未配置密钥导致连接失败」）。CR-032：软信号与配置关键词同现时归 config，
		* 避免「连接失败：invalid api key」被误判为后端不可达、把用户带去检查服务。
		*/
		const UNREACHABLE_SOFT_PATTERNS = [
			/ETIMEDOUT/i,
			/network error/i,
			/无响应/i,
			/不可达/i,
			/无法连接/i,
			/连接失败/i,
			/超时/i,
			/timeout/i
		];
		const CONFIG_PATTERNS = [
			/api[ _-]?key/i,
			/apikey/i,
			/密钥/i,
			/credential/i,
			/未配置/i,
			/unauthor/i,
			/forbidden/i,
			/\b401\b/i,
			/\b403\b/i,
			/invalid (api|base)/i,
			/基址/i
		];
		/** 把错误消息归类为三级处置（空消息一律 retryable）。 */
		function classifyStudioError(message) {
			if (message === null || message === void 0 || message.length === 0) return "retryable";
			if (UNREACHABLE_HARD_PATTERNS.some((pattern) => pattern.test(message))) return "unreachable";
			const hasConfig = CONFIG_PATTERNS.some((pattern) => pattern.test(message));
			if (UNREACHABLE_SOFT_PATTERNS.some((pattern) => pattern.test(message)) && !hasConfig) return "unreachable";
			if (hasConfig) return "config";
			return "retryable";
		}
		//#endregion
		//#region src/client/brand/States.tsx
		/** 有项目但画布无节点：画布中心引导卡（pointer-events none，不挡画布交互）。 */
		function CanvasEmptyHint() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csCanvasEmptyHint",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "csCanvasEmptyHintTitle",
					children: EMPTY_COPY.canvasEmptyTitle
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "csCanvasEmptyHintText",
					children: EMPTY_COPY.canvasEmptyHint
				})]
			});
		}
		/** 通用品牌加载卡（骨架感：logo 微光 + 文案）。 */
		function StudioLoadingState(props) {
			const { label = LOADING_COPY.projects } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csLoadingCard",
				role: "status",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LogoMark, {
					size: 26,
					className: "csLogoMark csLogoMarkPulse"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "csLoadingText",
					children: label
				})]
			});
		}
		/** 错误三级处置卡。 */
		function StudioErrorState(props) {
			const { message, onRetry, onOpenSettings } = props;
			const kind = classifyStudioError(message);
			const isConfig = kind === "config";
			const isUnreachable = kind === "unreachable";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csErrorCard",
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csErrorTitle",
						children: isConfig ? ERROR_COPY.configTitle : isUnreachable ? ERROR_COPY.unreachableTitle : ERROR_COPY.retryable
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csErrorMessage",
						children: message
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csErrorHint",
						children: isConfig ? ERROR_COPY.configHint : isUnreachable ? ERROR_COPY.unreachableHint : ""
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csErrorActions",
						children: [isConfig && onOpenSettings !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csErrorAction",
							onClick: onOpenSettings,
							children: ERROR_COPY.openSettings
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csErrorAction csErrorActionPrimary",
							onClick: onRetry,
							children: ERROR_COPY.retry
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/ProjectList.tsx
		/** 一键效果测试当前支持的用例（与 effect-test-runner skill 的 fixtures 对应）。 */
		const EFFECT_TEST_CASES = [
			"T1",
			"T1b",
			"T3",
			"T5",
			"T6",
			"T9"
		];
		/** CV-091：折叠状态持久化的 localStorage key（按 groupId 记录）。 */
		const GROUP_COLLAPSE_KEY = "canvas-studio.group-collapse";
		/** 读取折叠状态（groupId → collapsed）。损坏/缺失按空对象降级。 */
		function loadCollapsed() {
			try {
				const raw = localStorage.getItem(GROUP_COLLAPSE_KEY);
				if (raw === null) return {};
				const value = JSON.parse(raw);
				if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
				const result = {};
				for (const [key, flag] of Object.entries(value)) if (typeof flag === "boolean") result[key] = flag;
				return result;
			} catch {
				return {};
			}
		}
		/** Relative-day label for the project creation date. */
		function createdLabel(project) {
			const date = new Date(project.createdAt);
			if (Number.isNaN(date.getTime())) return "-";
			return date.toLocaleDateString();
		}
		/**
		* The studio project list (CV-091)：项目按用户自定义分组渲染，每组可折叠，
		* 支持组内新建 / 移动到分组 / 重命名 / 删除。未分组桶常驻兜底（老项目与新建
		* 未分组项目都进这里）。点击行打开项目，行 hover 出「移动到分组」与删除。
		*/
		function ProjectListInner(props) {
			const { projects: rawProjects, groups: rawGroups, selectedProjectId, phase, error, creating, createOpen, onCreateOpenChange, onRefresh, onCreate, onOpen, onDelete, onMoveToGroup, onCreateGroup, onRenameGroup, onDeleteGroup, onOpenSettings, effectTest, onRunEffectTests } = props;
			const projects = Array.isArray(rawProjects) ? rawProjects : [];
			const groups = [...Array.isArray(rawGroups) ? rawGroups : []].sort((a, b) => a.order - b.order);
			const [createModalOpen, setCreateModalOpen] = (0, react.useState)(false);
			const [createModalGroupId, setCreateModalGroupId] = (0, react.useState)(null);
			const [createName, setCreateName] = (0, react.useState)("");
			const [createError, setCreateError] = (0, react.useState)(null);
			const [groupNameFormOpen, setGroupNameFormOpen] = (0, react.useState)(false);
			const [groupNameDraft, setGroupNameDraft] = (0, react.useState)("");
			const [renameKey, setRenameKey] = (0, react.useState)(null);
			const [renameDraft, setRenameDraft] = (0, react.useState)("");
			const [collapsed, setCollapsed] = (0, react.useState)(() => loadCollapsed());
			const toggleCollapse = (key) => {
				setCollapsed((prev) => {
					const next = {
						...prev,
						[key]: !prev[key]
					};
					try {
						localStorage.setItem(GROUP_COLLAPSE_KEY, JSON.stringify(next));
					} catch {}
					return next;
				});
			};
			const [testPanelOpen, setTestPanelOpen] = (0, react.useState)(false);
			const [testCases, setTestCases] = (0, react.useState)([...EFFECT_TEST_CASES]);
			const [testRoundDraft, setTestRoundDraft] = (0, react.useState)("");
			const openCreateModal = (groupId) => {
				setCreateModalGroupId(groupId);
				setCreateName("");
				setCreateError(null);
				setCreateModalOpen(true);
			};
			const closeCreateModal = () => {
				setCreateModalOpen(false);
				setCreateName("");
				setCreateError(null);
				onCreateOpenChange(false);
			};
			(0, react.useEffect)(() => {
				if (createOpen) {
					setCreateModalGroupId(null);
					setCreateName("");
					setCreateError(null);
					setCreateModalOpen(true);
				}
			}, [createOpen]);
			const submitCreate = async () => {
				const name = createName.trim();
				if (name.length === 0 || creating) return;
				setCreateError(null);
				try {
					await onCreate(name, createModalGroupId);
					setCreateModalOpen(false);
					setCreateName("");
					onCreateOpenChange(false);
				} catch (cause) {
					setCreateError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			const submitGroupName = async () => {
				const name = groupNameDraft.trim();
				if (name.length === 0 || creating) return;
				await onCreateGroup(name);
				setGroupNameFormOpen(false);
				setGroupNameDraft("");
			};
			const submitRename = async (groupId) => {
				const name = renameDraft.trim();
				if (name.length === 0 || creating) return;
				await onRenameGroup(groupId, name);
				setRenameKey(null);
				setRenameDraft("");
			};
			const maxRound = projects.reduce((acc, project) => {
				const match = /^效果验证-R(\d+)-/.exec(project.name);
				return match === null ? acc : Math.max(acc, Number(match[1]));
			}, 0);
			const defaultRound = `R${String(maxRound + 1).padStart(3, "0")}`;
			const round = testRoundDraft.trim().length > 0 ? testRoundDraft.trim().toUpperCase() : defaultRound;
			const testRunning = effectTest?.running === true;
			const toggleCase = (caseId) => {
				setTestCases((current) => current.includes(caseId) ? current.filter((candidate) => candidate !== caseId) : [...current, caseId]);
			};
			const ungrouped = projects.filter((p) => p.groupId === void 0 || p.groupId === null);
			const sections = groups.map((group) => ({
				key: group.id,
				title: group.name,
				items: projects.filter((p) => p.groupId === group.id),
				groupId: group.id,
				deletable: true
			}));
			const renderRows = (items) => items.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: project.id === selectedProjectId ? "csProjectItem csProjectItemActive" : "csProjectItem",
				onClick: () => onOpen(project),
				role: "button",
				tabIndex: 0,
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onOpen(project);
					}
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "csProjectMeta",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csProjectName",
						children: project.name
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csProjectDate",
						children: createdLabel(project)
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "csProjectRowActions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: "csProjectMove",
						title: "移动到分组",
						value: project.groupId ?? "",
						disabled: creating,
						onClick: (event) => {
							event.stopPropagation();
						},
						onChange: (event) => {
							event.stopPropagation();
							const value = event.target.value;
							onMoveToGroup(project.id, value === "" ? null : value);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: "未分组"
						}), groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: g.id,
							children: g.name
						}, g.id))]
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
				})]
			}, project.id));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csProjectList",
				children: [
					!groupNameFormOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csProjectListActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csProjectNew",
							disabled: creating,
							onClick: () => openCreateModal(null),
							children: "+ 新建项目"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csProjectNew csProjectNewGroup",
							disabled: creating,
							onClick: () => setGroupNameFormOpen(true),
							children: "+ 新建分组"
						})]
					}),
					groupNameFormOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csProjectForm",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "csProjectNameInput",
							value: groupNameDraft,
							placeholder: "分组名",
							autoFocus: true,
							disabled: creating,
							onChange: (event) => {
								setGroupNameDraft(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") submitGroupName();
								if (event.key === "Escape") setGroupNameFormOpen(false);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csProjectFormActions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: creating || groupNameDraft.trim().length === 0,
								onClick: () => void submitGroupName(),
								children: creating ? "创建中" : "创建"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: creating,
								onClick: () => setGroupNameFormOpen(false),
								children: "取消"
							})]
						})]
					}),
					!groupNameFormOpen && !testRunning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csProjectNew",
						disabled: creating || testCases.length === 0,
						onClick: () => setTestPanelOpen((open) => !open),
						children: "▶ 跑效果测试"
					}),
					testPanelOpen && !testRunning && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csProjectForm",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csEffectTestCases",
								children: EFFECT_TEST_CASES.map((caseId) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "csEffectTestCase",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: testCases.includes(caseId),
										onChange: () => toggleCase(caseId)
									}), caseId]
								}, caseId))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "csProjectNameInput",
								value: testRoundDraft,
								placeholder: `轮次号（缺省 ${defaultRound}）`,
								disabled: creating,
								onChange: (event) => {
									setTestRoundDraft(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csProjectFormActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									disabled: creating || testCases.length === 0,
									onClick: () => {
										onRunEffectTests(round, testCases);
										setTestPanelOpen(false);
									},
									children: [
										"开始（",
										testCases.length,
										" 例）"
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: creating,
									onClick: () => setTestPanelOpen(false),
									children: "取消"
								})]
							})
						]
					}),
					effectTest !== null && (testRunning || effectTest.finished) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csEffectTestProgress",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csEffectTestTitle",
								children: testRunning ? `${effectTest.round} 进行中（${effectTest.currentIndex + 1}/${effectTest.queue.length}）` : `${effectTest.round} 已结束`
							}),
							testRunning && effectTest.currentLabel !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csEffectTestCurrent",
								children: effectTest.currentLabel
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								"完成 ",
								effectTest.done.length,
								" · 失败 ",
								effectTest.failures.length
							] }),
							effectTest.failures.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csEffectTestFailure",
								children: entry
							}, entry)),
							effectTest.finished && effectTest.message !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csEffectTestSummary",
								children: effectTest.message
							})
						]
					}),
					phase === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StudioLoadingState, { label: LOADING_COPY.projects }),
					phase === "error" && error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StudioErrorState, {
						message: error,
						onRetry: onRefresh,
						onOpenSettings
					}),
					phase === "idle" && projects.length === 0 && groups.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csProjectsEmpty",
						children: EMPTY_COPY.projectEmpty
					}),
					renderSection("__ungrouped__", "未分组", ungrouped, null, false),
					sections.map((section) => renderSection(section.key, section.title, section.items, section.groupId, true)),
					createModalOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csModalBackdrop",
						role: "dialog",
						"aria-modal": "true",
						"aria-label": "新建项目",
						onMouseDown: (event) => {
							if (event.target === event.currentTarget) closeCreateModal();
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csModal",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
									className: "csModalHeader",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "新建项目" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "csModalClose",
										"aria-label": "关闭",
										disabled: creating,
										onClick: closeCreateModal,
										children: "×"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "csModalBody",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "csField",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												className: "csFieldLabel",
												htmlFor: "cs-create-name",
												children: "名称"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												id: "cs-create-name",
												className: "csFieldInput",
												value: createName,
												placeholder: "输入名称",
												autoFocus: true,
												disabled: creating,
												onChange: (event) => {
													setCreateName(event.target.value);
												},
												onKeyDown: (event) => {
													if (event.key === "Enter") submitCreate();
													if (event.key === "Escape") closeCreateModal();
												}
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "csField",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												className: "csFieldLabel",
												htmlFor: "cs-create-group",
												children: "所属分组"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "csCreateGroupRow",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "csCreateGroupIcon",
													"aria-hidden": "true",
													children: "📁"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
													id: "cs-create-group",
													className: "csFieldSelect",
													value: createModalGroupId ?? "",
													disabled: creating,
													onChange: (event) => {
														setCreateModalGroupId(event.target.value === "" ? null : event.target.value);
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "",
														children: "未分组"
													}), groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: group.id,
														children: group.name
													}, group.id))]
												})]
											})]
										}),
										createError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "csFieldError",
											children: createError
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
									className: "csModalFooter",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "csModalBtnSecondary",
										disabled: creating,
										onClick: closeCreateModal,
										children: "取消"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "csModalBtnPrimary",
										disabled: creating || createName.trim().length === 0,
										onClick: () => void submitCreate(),
										children: creating ? "创建中" : "创建"
									})]
								})
							]
						})
					})
				]
			});
			/** 渲染一个分组区块（含折叠头、内联新建、行列表）。函数声明会被提升，可在 return 上方引用。 */
			function renderSection(key, title, items, groupId, deletable) {
				const isCollapsed = collapsed[key] === true;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csProjectGroup",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csProjectGroupHeader",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csProjectGroupToggle",
								title: isCollapsed ? "展开" : "折叠",
								onClick: () => toggleCollapse(key),
								children: isCollapsed ? "▸" : "▾"
							}),
							renameKey === key ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "csProjectGroupNameInput",
								value: renameDraft,
								autoFocus: true,
								disabled: creating,
								onChange: (event) => {
									setRenameDraft(event.target.value);
								},
								onKeyDown: (event) => {
									if (event.key === "Enter") submitRename(key);
									if (event.key === "Escape") setRenameKey(null);
								},
								onBlur: () => setRenameKey(null)
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csProjectGroupName",
								onDoubleClick: () => {
									if (deletable) {
										setRenameKey(key);
										setRenameDraft(title);
									}
								},
								title: deletable ? "双击重命名" : void 0,
								children: [
									title,
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csProjectGroupCount",
										children: [
											"(",
											items.length,
											")"
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csProjectGroupActions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csProjectGroupAdd",
									title: "在该分组下新建项目",
									disabled: creating,
									onClick: () => {
										openCreateModal(groupId);
									},
									children: "+"
								}), deletable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csProjectGroupDelete",
									title: "删除分组（组内项目回落未分组）",
									disabled: creating,
									onClick: () => {
										if (window.confirm(`删除分组「${title}」？组内项目将移至「未分组」，分组本身不可恢复。`)) onDeleteGroup(key);
									},
									children: "×"
								})]
							})
						]
					}), !isCollapsed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csProjectGroupEmpty",
						children: "空"
					}), renderRows(items)] })]
				}, key);
			}
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
			const [cProtocol, setCProtocol] = (0, react.useState)("openai-completions");
			const [cKey, setCKey] = (0, react.useState)("");
			const [cModels, setCModels] = (0, react.useState)([]);
			const [showFolded, setShowFolded] = (0, react.useState)(false);
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
						const cRes = await api.credentials.describe({ refs });
						cm = cRes.result.ok ? cRes.result.value.credentials ?? {} : {};
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
					const hasKeyRef = typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0;
					if (draft.keyDraft && !hasKeyRef) ops.push({
						op: "set",
						path: [...p.settingsPath, "apiKeyEnv"],
						value: keyRef
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
			/** 清除一个 provider 的密钥引用（自部署无鉴权端点无需 API Key）。 */
			const clearKeyRef = (0, react.useCallback)(async (p) => {
				const api = getModelApi();
				if (api === void 0) return;
				const { ns, profile } = profileOf(p);
				if (ns === void 0 || profile === void 0) return;
				if (!(typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0)) return;
				setBusy((b) => ({
					...b,
					[p.provider]: true
				}));
				setSaveError((m) => ({
					...m,
					[p.provider]: null
				}));
				try {
					const res = await api.settings.mutate({
						ns: p.settingsNs,
						ops: [{
							op: "unset",
							path: [...p.settingsPath, "apiKeyEnv"]
						}],
						expectedRevision: ns.revision
					});
					if (!res.result.ok) throw new Error(res.result.error.message);
					await refresh();
				} catch (cause) {
					setSaveError((m) => ({
						...m,
						[p.provider]: cause instanceof Error ? cause.message : "清除失败"
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
					setCProtocol("openai-completions");
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
			const isCoreProvider = (p) => {
				const { profile } = profileOf(p);
				return p.provider === "deepseek-official" || p.declared === true || p.active === true || profile !== void 0;
			};
			const coreProviders = providers.filter(isCoreProvider);
			const foldedProviders = providers.filter((p) => !isCoreProvider(p));
			const visibleProviders = showFolded ? providers : coreProviders;
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
						children: [visibleProviders.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldHint",
							children: "未检测到可配置的模型 provider。"
						}), visibleProviders.map((p) => {
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
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csFieldLabel",
											children: profile !== void 0 && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0 ? `API Key（凭据引用 ${keyRef}${cred?.configured ? "，已配置" : "，未配置"}）` : "API Key（未引用凭据：自部署无鉴权端点可留空直接使用）"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "csFieldRow",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												className: "csFieldInput",
												type: "password",
												placeholder: cred?.configured ? "已保存，留空不改；输入新值覆盖" : "需要鉴权时输入密钥后点保存",
												value: draft.keyDraft,
												disabled: isBusy || !writable,
												onChange: (e) => patchDraft(p.provider, { keyDraft: e.target.value })
											}), profile !== void 0 && typeof profile.apiKeyEnv === "string" && profile.apiKeyEnv.length > 0 && cred?.configured !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csFieldButton",
												disabled: isBusy || !writable,
												onClick: () => {
													clearKeyRef(p);
												},
												children: "清除引用"
											})]
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
					foldedProviders.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csModelFold",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csFieldButton csModelFoldToggle",
							onClick: () => setShowFolded((v) => !v),
							children: showFolded ? `收起未使用的 provider（隐藏 ${foldedProviders.length} 个）` : `显示全部 provider（共 ${providers.length} 个）`
						})
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
										children: "协议（api，默认 openai-completions = OpenAI 兼容）"
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "csFieldHint",
						children: [
							"该配置与桌面「设置 → 模型」共享同一份存储；需要鉴权的服务商填 Base URL + Key，密钥只存凭据域不落明文。 底层对任何端点都要求非空密钥：无鉴权自部署端点请在 API Key 填任意占位符（如 -），或在 settings.yaml 的该 provider 下加 headers: ",
							"{",
							" authorization: unused ",
							"}",
							"。"
						]
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
		function themeLabel$1(id) {
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
			const TINYFISH_REF = "TINYFISH_API_KEY";
			const [tinyfishInput, setTinyfishInput] = (0, react.useState)("");
			const [tinyfishCred, setTinyfishCred] = (0, react.useState)(null);
			const [tinyfishBusy, setTinyfishBusy] = (0, react.useState)(false);
			const [tinyfishError, setTinyfishError] = (0, react.useState)(null);
			const [dramaSaved, setDramaSaved] = (0, react.useState)(false);
			const [tinyfishSaved, setTinyfishSaved] = (0, react.useState)(false);
			const [falKeyInput, setFalKeyInput] = (0, react.useState)("");
			const [falCred, setFalCred] = (0, react.useState)(null);
			const [falBusy, setFalBusy] = (0, react.useState)(false);
			const [falError, setFalError] = (0, react.useState)(null);
			const [falSaved, setFalSaved] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (value === void 0) return;
				const credentials = getCredentials();
				if (credentials === void 0) {
					setTinyfishCred(null);
					return;
				}
				let cancelled = false;
				credentials.describe({ refs: [TINYFISH_REF] }).then((res) => {
					if (cancelled) return;
					const view = res.result.ok ? res.result.value.credentials[TINYFISH_REF] : null;
					setTinyfishCred(view?.configured === true ? view : null);
				}).catch(() => {
					if (!cancelled) setTinyfishCred(null);
				});
				return () => {
					cancelled = true;
				};
			}, [getCredentials, value]);
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
					if (cancelled) return;
					const view = res.result.ok ? res.result.value.credentials[ref] : null;
					setCredState(view?.configured === true ? view : null);
				}).catch(() => {
					if (!cancelled) setCredState(null);
				});
				return () => {
					cancelled = true;
				};
			}, [getCredentials, value?.dramaApiKey]);
			(0, react.useEffect)(() => {
				if (value === void 0) return;
				const ref = value.falApiKey;
				let cancelled = false;
				const credentials = getCredentials();
				if (credentials === void 0) {
					setFalCred(null);
					return;
				}
				credentials.describe({ refs: [ref] }).then((res) => {
					if (cancelled) return;
					const view = res.result.ok ? res.result.value.credentials[ref] : null;
					setFalCred(view?.configured === true ? view : null);
				}).catch(() => {
					if (!cancelled) setFalCred(null);
				});
				return () => {
					cancelled = true;
				};
			}, [getCredentials, value?.falApiKey]);
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			const onBase = (v) => {
				scope.set("dramaApiBase", v);
			};
			const onSeconds = (v) => {
				if (v.trim().length === 0) return;
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
					setDramaSaved(true);
					window.setTimeout(() => setDramaSaved(false), 2500);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : "密钥保存失败");
				} finally {
					setBusy(false);
				}
			};
			/** 保存 TinyFish 联网搜索 key 到凭据域（ref 与 tinyfish 插件一致）。 */
			const saveTinyfishKey = async () => {
				if (tinyfishInput.length === 0) return;
				const credentials = getCredentials();
				if (credentials === void 0) {
					setTinyfishError("凭据服务不可用：当前环境未提供 credentials");
					return;
				}
				setTinyfishBusy(true);
				setTinyfishError(null);
				try {
					await credentials.set({
						ref: TINYFISH_REF,
						value: tinyfishInput
					});
					setTinyfishInput("");
					setTinyfishCred({
						configured: true,
						writable: true
					});
					setTinyfishSaved(true);
					window.setTimeout(() => setTinyfishSaved(false), 2500);
				} catch (cause) {
					setTinyfishError(cause instanceof Error ? cause.message : "TinyFish key 保存失败");
				} finally {
					setTinyfishBusy(false);
				}
			};
			/** 保存 fal key 到凭据域（阶段 4；ref 来自设置项 falApiKey，形态与 Drama key 一致）。 */
			const saveFalKey = async () => {
				if (falKeyInput.length === 0) return;
				const credentials = getCredentials();
				if (credentials === void 0) {
					setFalError("凭据服务不可用：当前环境未提供 credentials");
					return;
				}
				setFalBusy(true);
				setFalError(null);
				try {
					await credentials.set({
						ref: value.falApiKey,
						value: falKeyInput
					});
					setFalKeyInput("");
					setFalCred({
						configured: true,
						writable: true
					});
					setFalSaved(true);
					window.setTimeout(() => setFalSaved(false), 2500);
				} catch (cause) {
					setFalError(cause instanceof Error ? cause.message : "fal key 保存失败");
				} finally {
					setFalBusy(false);
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
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csFieldInput",
									type: "password",
									placeholder: credState?.configured ? "已保存，留空保持不变；输入新值覆盖" : "输入密钥后点保存",
									value: keyInput,
									onChange: (event) => setKeyInput(event.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csFieldButton",
									disabled: busy || keyInput.length === 0,
									onClick: () => {
										onSaveKey();
									},
									children: busy ? "保存中…" : "保存密钥"
								}),
								dramaSaved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csFieldHint",
									children: "已保存"
								})
							]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldError",
							role: "alert",
							children: error
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csField",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csFieldLabel",
							children: [
								"fal API Key（凭据引用 ",
								value.falApiKey,
								falCred?.configured ? "，已配置" : "，未配置",
								"）"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csFieldRow",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csFieldInput",
									type: "password",
									placeholder: falCred?.configured ? "已保存，留空保持不变；输入新值覆盖" : "输入 fal 密钥（Key xxx）后点保存",
									spellCheck: false,
									value: falKeyInput,
									onChange: (event) => setFalKeyInput(event.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csFieldButton",
									disabled: falBusy || falKeyInput.length === 0,
									onClick: () => {
										saveFalKey();
									},
									children: falBusy ? "保存中…" : "保存密钥"
								}),
								falSaved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csFieldHint",
									children: "已保存"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldHint",
							children: "视频供应商切换为「fal H3」时必需；留空则 fal 生成会报「未配置 fal API Key」。"
						}),
						falError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldError",
							role: "alert",
							children: falError
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csField",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csFieldLabel",
							children: [
								"TinyFish 联网搜索 Key（",
								TINYFISH_REF,
								tinyfishCred?.configured ? "，已配置" : "，未配置",
								"）"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csFieldRow",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csFieldInput",
									type: "password",
									placeholder: tinyfishCred?.configured ? "已保存，留空保持不变；输入新值覆盖" : "输入 TinyFish 免费 key 后点保存",
									spellCheck: false,
									value: tinyfishInput,
									onChange: (event) => setTinyfishInput(event.target.value)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csFieldButton",
									disabled: tinyfishBusy || tinyfishInput.length === 0,
									onClick: () => {
										saveTinyfishKey();
									},
									children: tinyfishBusy ? "保存中…" : "保存密钥"
								}),
								tinyfishSaved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csFieldHint",
									children: "已保存"
								})
							]
						}),
						tinyfishError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldError",
							role: "alert",
							children: tinyfishError
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
				label: themeLabel$1(definition.id)
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
							themeLabel$1(activeId),
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
		/** 品牌配色分区：4 套 --cs-* 预设 swatch，选择即切换并持久化到 'canvas-studio' 命名空间。 */
		function BrandSection(props) {
			const { settingsScope } = props;
			const scope = (0, react.useMemo)(() => settingsScope.bind({ namespace: "canvas-studio" }), [settingsScope]);
			const value = useScope(scope).value;
			if (value === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csField",
				children: "加载中…"
			});
			const onSelect = (id) => {
				applyBrandPreset(id);
				scope.set("brandPreset", id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csField",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csFieldLabel",
						children: [
							"品牌配色（",
							BRAND.name,
							" 专属，不影响宿主主题）"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csBrandSwatches",
						children: BRAND_PRESET_IDS.map((id) => {
							const preset = BRAND_PRESETS[id];
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								title: preset.description,
								"aria-pressed": value.brandPreset === id,
								className: value.brandPreset === id ? "csBrandSwatch csBrandSwatchActive" : "csBrandSwatch",
								onClick: () => onSelect(id),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csBrandSwatchChip",
									style: { background: preset.accent },
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csBrandSwatchName",
									children: preset.label
								})]
							}, id);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csFieldHint",
						children: "切换即时生效并记住选择；默认「电影紫」。"
					})
				]
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
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csFieldLabel",
							children: "默认视频供应商"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "csFieldSelect",
							value: value.defaultVideoProvider,
							onChange: (event) => void scope.set("defaultVideoProvider", event.target.value),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "drama",
								children: "Drama（默认）"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "fal",
								children: "fal H3"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csFieldHint",
							children: "生成视频时未显式指定供应商则走此项；升级后默认 Drama，既有项目行为不变。"
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
				if (raw.trim().length === 0) return;
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
				if (raw.trim().length === 0) return;
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
		/** 导航项列表。 */
		const NAV_ITEMS = [
			{
				id: "general",
				label: "通用"
			},
			{
				id: "theme",
				label: "外观"
			},
			{
				id: "model",
				label: "模型"
			},
			{
				id: "output",
				label: "输出"
			},
			{
				id: "workflow",
				label: "工作流"
			},
			{
				id: "storage",
				label: "存储"
			}
		];
		/**
		* Render the Canvas Studio settings popup with six sections: 通用 / 外观 / 模型 / 输出 / 工作流 / 存储.
		* 通用/输出/工作流/存储经 canvas-studio 命名空间回写；外观 = 全局主题（ctx.theme）+ 品牌配色
		* （--cs-* 预设，见 BrandSection）；模型经 host wire 三域。
		*
		* 布局采用 DeepSeek Harness 风格：左侧 188px 垂直导航栏 + 右侧内容区。
		*/
		function SettingsModal(props) {
			const { settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme, onClose } = props;
			const [activeTab, setActiveTab] = (0, react.useState)("general");
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
				className: "csSettingsBackdrop",
				role: "presentation",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csSettingsModal",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "cs-settings-title",
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
						className: "csNav",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csNavTitle",
							id: "cs-settings-title",
							children: "设置"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csNavList",
							children: NAV_ITEMS.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: activeTab === item.id ? "csNavCell csNavCellActive" : "csNavCell",
								"aria-current": activeTab === item.id ? "true" : void 0,
								onClick: () => {
									setActiveTab(item.id);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csNavLabel",
									children: item.label
								})
							}, item.id))
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csContent",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csContentHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "csContentActions" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csClose",
								"aria-label": "关闭",
								onClick: onClose,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csCloseIcon",
									children: "×"
								})
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csContentOptions",
							children: [
								activeTab === "general" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeneralSection, {
									settingsScope,
									getCredentials
								}),
								activeTab === "theme" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ThemeSection, { theme }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandSection, { settingsScope })] }),
								activeTab === "model" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelSection, {
									settingsScope,
									getModelApi
								}),
								activeTab === "output" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OutputSection, { settingsScope }),
								activeTab === "workflow" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowSection, { settingsScope }),
								activeTab === "storage" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StorageSection, {
									settingsScope,
									getDirectoryPicker
								})
							]
						})]
					})]
				})
			});
		}
		//#endregion
		//#region src/client/canvas/CanvasToolbar.tsx
		/**
		* 顶部工具栏分组可见性（2026-08-31）：**功能全部保留，仅控制入口显示**。
		*
		* 当前隐藏：撤销/重做、删除/编组/解组、+便签/+文本/+提示（用户 2026-08-31 指定）。
		* 保留：上传图片/上传视频、缩放；整理布局 / 图层 / 小地图移至最右侧图标组
		* （CV-059，2026-09-01 用户指定）。
		* 设置按钮已移除（CV-059 拍板：设置入口 = app 左下角全局入口）。
		* 需要恢复某一组：把对应项改为 `true` 即可（组件与回调一直在，无死代码）。
		*/
		const TOOLBAR_VISIBILITY = {
			/** 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z）。 */
			undoRedo: false,
			/** 删除 / 编组 / 解组（节点右键菜单已提供同名命令）。 */
			editing: false,
			/** 整理布局：一键无重叠排列 + 适配视野（图标在最右组）。 */
			arrange: true,
			/** + 便签 / + 文本 / + 提示（手动素材；主链路产物由 agent 生成）。 */
			create: false,
			/** 上传图片 / 上传视频（P8 素材入口）。 */
			upload: true,
			/** 显示 / 隐藏图层面板（图标在最右组）。 */
			layers: true,
			/** 缩放：百分比 / − / + / 适配内容 / 1:1。 */
			zoom: true,
			/** 显示 / 隐藏小地图（图标在最右组）。 */
			minimap: true,
			/** CV-059：画布设置按钮已移除，设置入口 = app 左下角全局入口。 */
			settings: false
		};
		/**
		* The canvas toolbar: undo/redo, selection editing (delete/group/ungroup),
		* the one-click arrange, and manual node creation (sticky/text/prompt).
		* Everything is props-driven — the frame wires the store actions.
		* Group visibility is driven by {@link TOOLBAR_VISIBILITY}.
		*
		* CV-059：设置按钮移除（入口 = app 左下角全局设置），`onOpenSettings` 保留在
		* props 上仅作接线预留；右侧图标组 = 整理布局 / 图层 / 小地图。
		*/
		function CanvasToolbar(props) {
			const { canUndo, canRedo, selectedCount, hasSelection, onUndo, onRedo, onDelete, onGroup, onUngroup, onAutoArrange, onAddNode, onUploadImage, onUploadVideo, layersOpen, onToggleLayers, scale, onZoomOut, onZoomIn, onFitContent, onResetZoom, minimapVisible, onToggleMinimap, onOpenSkills } = props;
			const uploadInputRef = (0, react.useRef)(null);
			const uploadVideoInputRef = (0, react.useRef)(null);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csToolbar",
				children: [
					TOOLBAR_VISIBILITY.undoRedo && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					TOOLBAR_VISIBILITY.editing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					TOOLBAR_VISIBILITY.create && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
							})
						]
					}),
					"      ",
					TOOLBAR_VISIBILITY.upload && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csToolbarGroup",
						children: [
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
					TOOLBAR_VISIBILITY.zoom && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					(TOOLBAR_VISIBILITY.arrange || TOOLBAR_VISIBILITY.layers || TOOLBAR_VISIBILITY.minimap) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csToolbarGroup csToolbarGroupEnd",
						children: [
							TOOLBAR_VISIBILITY.arrange && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton csToolbarIconButton",
								title: "整理布局：消除重叠并适配视野",
								"aria-label": "整理布局",
								onClick: onAutoArrange,
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
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "3",
											y: "3",
											width: "7",
											height: "7",
											rx: "1"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "14",
											y: "3",
											width: "7",
											height: "7",
											rx: "1"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "14",
											y: "14",
											width: "7",
											height: "7",
											rx: "1"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "3",
											y: "14",
											width: "7",
											height: "7",
											rx: "1"
										})
									]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csToolbarButton csToolbarIconButton",
								title: "技能广场：浏览并装载视频生成技能",
								"aria-label": "技能广场",
								onClick: onOpenSkills,
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
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "3",
											y: "3",
											width: "8",
											height: "8",
											rx: "2"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "13",
											y: "3",
											width: "8",
											height: "8",
											rx: "2"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "3",
											y: "13",
											width: "8",
											height: "8",
											rx: "2"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
											cx: "17",
											cy: "17",
											r: "2.6"
										})
									]
								})
							}),
							TOOLBAR_VISIBILITY.layers && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: layersOpen ? "csToolbarButton csToolbarIconButton csToolbarIconActive" : "csToolbarButton csToolbarIconButton",
								title: layersOpen ? "隐藏图层" : "显示图层",
								"aria-label": layersOpen ? "隐藏图层" : "显示图层",
								"aria-pressed": layersOpen,
								onClick: onToggleLayers,
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
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", { points: "12 2 2 7 12 12 22 7 12 2" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "2 17 12 22 22 17" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", { points: "2 12 12 17 22 12" })
									]
								})
							}),
							TOOLBAR_VISIBILITY.minimap && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: minimapVisible ? "csToolbarButton csToolbarIconButton csToolbarIconActive" : "csToolbarButton csToolbarIconButton",
								title: minimapVisible ? "隐藏小地图" : "显示小地图",
								"aria-label": minimapVisible ? "隐藏小地图" : "显示小地图",
								"aria-pressed": minimapVisible,
								onClick: onToggleMinimap,
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
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", { points: "1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
											x1: "8",
											y1: "2",
											x2: "8",
											y2: "18"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
											x1: "16",
											y1: "6",
											x2: "16",
											y2: "22"
										})
									]
								})
							})
						]
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
		/**
		* CV-017：计算一次方向键微调后各选中节点的新位置。
		*
		* 锁定节点跳过（与拖拽行为一致）；返回按 id 逐个移动的指令列表，调用方
		* 对每项执行 `onMoveNode`。`dx`/`dy` 已含步长（1px，Shift 时 10px）。
		*/
		function computeNudge(nodes, selectedIds, dx, dy) {
			const moves = [];
			for (const id of selectedIds) {
				const node = nodes.find((candidate) => candidate.id === id);
				if (node === void 0 || node.locked === true) continue;
				moves.push({
					id,
					x: node.x + dx,
					y: node.y + dy
				});
			}
			return moves;
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
			const seenGuides = /* @__PURE__ */ new Set();
			const uniqueGuides = guides.filter((guide) => {
				const key = `${guide.type}:${guide.position}`;
				if (seenGuides.has(key)) return false;
				seenGuides.add(key);
				return true;
			});
			return {
				x: snapX,
				y: snapY,
				guides: uniqueGuides
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
		/** CV-011：参考角色短标签（节点角标用；托盘里用 ReferenceTray 的全称版）。 */
		const REFERENCE_ROLE_SHORT = {
			image: "构图",
			character: "角色",
			style: "风格",
			frame: "首末帧"
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
		function CanvasEdgesInner(props) {
			const { nodes, selectedNodeIds, scale } = props;
			const inv = 1 / Math.max(scale, .05);
			const chipsVisible = scale >= .6;
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const selected = new Set(selectedNodeIds);
			const operationTypes = /* @__PURE__ */ new Set([...nodes.map((node) => node.operationType).filter(Boolean), "import"]);
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
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: [...operationTypes].map((operation) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
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
				}, markerId(operation))) }), paths]
			});
		}
		const CanvasEdges = (0, react.memo)(CanvasEdgesInner);
		/** 真实分辨率（宽高像素）→ 画布显示框尺寸。 */
		function previewSizeOf(media) {
			if (!Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0) return {
				width: 420,
				height: 420
			};
			if (media.width === media.height) return {
				width: 420,
				height: 420
			};
			return media.width > media.height ? {
				width: 480,
				height: Math.max(60, Math.round(480 * media.height / media.width))
			} : {
				width: Math.max(60, Math.round(480 * media.width / media.height)),
				height: 480
			};
		}
		/**
		* CV-083：媒体秒数 → 「m:ss」显示（时长角标）。非法值（NaN/负数/未定义）
		* 返回 null，调用方据此决定是否渲染角标。纯函数，单测直连。
		*/
		function formatMediaDuration(seconds) {
			if (seconds === void 0 || !Number.isFinite(seconds) || seconds < 0) return null;
			const total = Math.round(seconds);
			return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
		}
		//#endregion
		//#region src/client/canvas/CanvasNode.tsx
		/** Tool names for the transient (loading) node titles. */
		const TOOL_TITLES = {
			image_generate: "生成图片中…",
			character_generate: "生成角色立绘中…",
			inpaint: "图像修复中…",
			video_generate: "生成视频中…",
			video_composite: "合成视频中…"
		};
		/** CV-010：超过该秒数认为「可能卡住」，overlay 追加可打断提示。 */
		const LOADING_SLOW_THRESHOLD = 180;
		/** CV-082：hover 预览启动延迟（ms）——快速扫过多个视频时不 play/pause 抖动。 */
		const HOVER_PREVIEW_DELAY = 150;
		/** CR-067：系统减少动效偏好，模块加载时计算一次（会话中极少变化；此前每渲染查 matchMedia）。 */
		const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		/** CV-082：全画布同一时刻只允许一个 hover 播放的 video 元素（模块级登记）。 */
		let activeHoverVideo = null;
		/**
		* CR-066：全局共享的 1s ticker——所有 loading 节点订阅同一个定时器，避免每个
		* loading 节点各起一个 setInterval + 每秒各重渲染一次（批量生成时 N 个定时器）。
		* 监听器归零时自动停表。
		*/
		const loadingTicker = (() => {
			const listeners = /* @__PURE__ */ new Set();
			let timer = null;
			const stopIfEmpty = () => {
				if (listeners.size === 0 && timer !== null) {
					clearInterval(timer);
					timer = null;
				}
			};
			return { subscribe(fn) {
				listeners.add(fn);
				if (timer === null) timer = setInterval(() => {
					for (const l of [...listeners]) l();
				}, 1e3);
				return () => {
					listeners.delete(fn);
					stopIfEmpty();
				};
			} };
		})();
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
		function CanvasNodeInner(props) {
			const { node, selected, primary = false, onNodePointerDown, onResizePointerDown, onLinkPointerDown, onRenameSubmit, onTextSubmit, onOpenDetail, onOpenPlayback, onOpenPreview, onContextMenu, onRetry, onMediaNatural } = props;
			const [editingTitle, setEditingTitle] = (0, react.useState)(false);
			const [titleInput, setTitleInput] = (0, react.useState)("");
			const [editingBody, setEditingBody] = (0, react.useState)(false);
			const [bodyInput, setBodyInput] = (0, react.useState)("");
			const [mediaFailed, setMediaFailed] = (0, react.useState)(false);
			const [durationLabel, setDurationLabel] = (0, react.useState)(null);
			const [mediaDims, setMediaDims] = (0, react.useState)(null);
			const videoRef = (0, react.useRef)(null);
			const hoverTimer = (0, react.useRef)(null);
			const [now, setNow] = (0, react.useState)(() => Date.now());
			(0, react.useEffect)(() => {
				if (node.isLoading !== true) return;
				setNow(Date.now());
				return loadingTicker.subscribe(() => {
					setNow(Date.now());
				});
			}, [node.isLoading]);
			const canHoverPreview = node.kind === "video" && node.url !== void 0 && !mediaFailed && node.isLoading !== true && node.error === void 0;
			const stopHoverPreview = () => {
				if (hoverTimer.current !== null) {
					clearTimeout(hoverTimer.current);
					hoverTimer.current = null;
				}
				const el = videoRef.current;
				if (el !== null && !el.paused) {
					el.pause();
					el.currentTime = 0;
				}
				if (el !== null && activeHoverVideo === el) activeHoverVideo = null;
			};
			const handleVideoEnter = () => {
				if (!canHoverPreview || prefersReducedMotion) return;
				if (hoverTimer.current !== null) return;
				hoverTimer.current = window.setTimeout(() => {
					hoverTimer.current = null;
					const el = videoRef.current;
					if (el === null) return;
					if (activeHoverVideo !== null && activeHoverVideo !== el) {
						activeHoverVideo.pause();
						activeHoverVideo.currentTime = 0;
					}
					activeHoverVideo = el;
					el.muted = true;
					el.loop = true;
					el.play().catch(() => {});
				}, HOVER_PREVIEW_DELAY);
			};
			(0, react.useEffect)(() => {
				return () => {
					if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
					const el = videoRef.current;
					if (el !== null && !el.paused) el.pause();
					if (el !== null && activeHoverVideo === el) activeHoverVideo = null;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!canHoverPreview) stopHoverPreview();
			}, [canHoverPreview]);
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
				if (node.kind === "video" && node.url !== void 0 && onOpenPlayback !== void 0) {
					onOpenPlayback(node);
					return;
				}
				if (node.kind === "image" && node.url !== void 0 && onOpenPreview !== void 0) {
					onOpenPreview(node);
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
				const element = event.currentTarget;
				const naturalWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
				const naturalHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
				if (naturalWidth <= 0 || naturalHeight <= 0) return;
				setMediaDims({
					width: naturalWidth,
					height: naturalHeight
				});
				if (onMediaNatural !== void 0) onMediaNatural(node.id, naturalWidth, naturalHeight);
			};
			const handleVideoMetadata = (event) => {
				setDurationLabel(formatMediaDuration(event.currentTarget.duration));
				handleMediaLoad(event);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: [
					"csNode",
					selected ? "csNodeSelected" : "",
					selected && primary ? "csNodePrimary" : "",
					node.locked ? "csNodeLocked" : "",
					node.error !== void 0 ? "csNodeError" : "",
					node.isLoading ? "csNodeLoading" : ""
				].filter(Boolean).join(" "),
				style: {
					left: 0,
					top: 0,
					transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
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
					isMedia && node.url !== void 0 && !mediaFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csNodeMediaBox",
						style: flipTransform ? { transform: flipTransform } : void 0,
						onPointerEnter: handleVideoEnter,
						onPointerLeave: stopHoverPreview,
						children: [
							node.kind === "image" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								className: "csNodeMedia",
								src: node.url,
								alt: node.title ?? "image",
								draggable: false,
								onLoad: handleMediaLoad,
								onError: () => {
									setMediaFailed(true);
								}
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
								ref: videoRef,
								className: "csNodeMedia",
								src: node.url,
								preload: "metadata",
								onLoadedMetadata: handleVideoMetadata,
								onError: () => {
									setMediaFailed(true);
								}
							}),
							node.kind === "video" && durationLabel !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csNodeDuration",
								children: durationLabel
							}),
							mediaDims !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csNodeMediaDims",
								children: [
									mediaDims.width,
									" × ",
									mediaDims.height
								]
							})
						]
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
					node.isReference === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csNodeRefBadge",
						"data-role": node.referenceRole ?? "image",
						title: `参考图 · ${REFERENCE_ROLE_SHORT[node.referenceRole ?? "image"]}`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csNodeRefDot" }),
							"参考 · ",
							REFERENCE_ROLE_SHORT[node.referenceRole ?? "image"]
						]
					}),
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
		const CanvasNode = (0, react.memo)(CanvasNodeInner);
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
			const sizeRef = (0, react.useRef)({
				vw,
				vh
			});
			sizeRef.current = {
				vw,
				vh
			};
			const jumpTo = (0, react.useCallback)((clientX, clientY) => {
				const rect = containerRef.current?.getBoundingClientRect();
				if (rect === void 0 || rect === null) return;
				const minimapX = clientX - rect.left;
				const minimapY = clientY - rect.top;
				const worldX = minimapX / fitScale + contentBounds.x;
				const worldY = minimapY / fitScale + contentBounds.y;
				const { vw, vh } = sizeRef.current;
				onSetOffset({
					x: vw / 2 - worldX * scale,
					y: vh / 2 - worldY * scale
				});
			}, [
				fitScale,
				contentBounds,
				scale,
				onSetOffset
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
		/** CV-071：拖拽启动阈值（屏幕像素）。未越过即视为点击，不移动/不捕获/不入 undo。 */
		const DRAG_THRESHOLD = 3;
		/** CV-017：方向键 → 画布坐标增量（×步长 1 或 10）。 */
		const NUDGE_DELTAS = {
			ArrowUp: [0, -1],
			ArrowDown: [0, 1],
			ArrowLeft: [-1, 0],
			ArrowRight: [1, 0]
		};
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
			const { nodes, view, onViewChange, selectedNodeIds, onSelectNode, onSelectAllNodes, onMoveNode, onUpdateNode, onBeginEdit, onPersist, onRemoveNodes, onCopy, onPaste, onUndo, onRedo, onLinkLayers, onRename, onNodeTextSubmit, onNodeOpenDetail, onNodeOpenPlayback, onNodeOpenPreview, onContextMenu, onBlankContextMenu, onRetry, onMediaNatural, focusNodeId, minimapVisible = true } = props;
			const [guides, setGuides] = (0, react.useState)({
				vertical: [],
				horizontal: []
			});
			const [linkLine, setLinkLine] = (0, react.useState)(null);
			const [marquee, setMarquee] = (0, react.useState)(null);
			const [primaryDragId, setPrimaryDragId] = (0, react.useState)(null);
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
			const armPointer = (event) => {
				gesture.current = {
					...gesture.current,
					pointerId: event.pointerId,
					captured: false
				};
			};
			/** CV-071：首次实际移动时才真正捕获（纯点击/双击全程不捕获，dblclick 正常）。 */
			const ensureCaptured = () => {
				const current = gesture.current;
				if (current.pointerId === void 0 || current.captured === true) return;
				try {
					containerRef.current?.setPointerCapture(current.pointerId);
				} catch {}
				current.captured = true;
			};
			const releasePointer = () => {
				const id = gesture.current.pointerId;
				if (id === void 0) return;
				try {
					containerRef.current?.releasePointerCapture(id);
				} catch {}
				delete gesture.current.pointerId;
				delete gesture.current.captured;
			};
			/** CV-071：屏幕位移是否已越过拖拽阈值。 */
			const exceededThreshold = (event, current) => Math.abs(event.clientX - current.startX) > DRAG_THRESHOLD || Math.abs(event.clientY - current.startY) > DRAG_THRESHOLD;
			const beginEditOnce = (current) => {
				if (current.editBegun === true) return;
				current.editBegun = true;
				onBeginEdit();
			};
			const nodesRef = (0, react.useRef)(nodes);
			const lastNudgeAtRef = (0, react.useRef)(0);
			const nudgePersistTimerRef = (0, react.useRef)(null);
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
					const scrollable = (event.target instanceof HTMLElement ? event.target : null)?.closest(".csNodeSelected .csNodeBody, textarea");
					if (scrollable != null && scrollable.scrollHeight > scrollable.clientHeight) return;
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
					const nudgeDelta = NUDGE_DELTAS[event.key];
					if (nudgeDelta !== void 0 && selectedNodeIds.length > 0) {
						event.preventDefault();
						const step = event.shiftKey ? 10 : 1;
						const now = Date.now();
						if (now - lastNudgeAtRef.current > 800) onBeginEdit();
						lastNudgeAtRef.current = now;
						for (const move of computeNudge(nodesRef.current, selectedNodeIds, nudgeDelta[0] * step, nudgeDelta[1] * step)) onMoveNode(move.id, move.x, move.y);
						if (nudgePersistTimerRef.current !== null) clearTimeout(nudgePersistTimerRef.current);
						nudgePersistTimerRef.current = setTimeout(() => {
							nudgePersistTimerRef.current = null;
							onPersist();
						}, 300);
						return;
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
					if (nudgePersistTimerRef.current !== null) {
						clearTimeout(nudgePersistTimerRef.current);
						nudgePersistTimerRef.current = null;
					}
				};
			}, [
				selectedNodeIds,
				onSelectNode,
				onSelectAllNodes,
				onRemoveNodes,
				onCopy,
				onPaste,
				onUndo,
				onRedo,
				onMoveNode,
				onBeginEdit,
				onPersist
			]);
			const fitToBounds = (0, react.useCallback)((bounds) => {
				const el = containerRef.current;
				if (el === null) return;
				const vw = el.clientWidth;
				const vh = el.clientHeight;
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
			const fitToContent = (0, react.useCallback)(() => {
				const bounds = contentBounds(nodesRef.current);
				if (bounds === null) {
					onViewChangeRef.current({
						x: 0,
						y: 0,
						scale: 1
					});
					return;
				}
				fitToBounds(bounds);
			}, [fitToBounds]);
			const zoomToSelection = (0, react.useCallback)(() => {
				if (selectedNodeIds.length === 0) {
					fitToContent();
					return;
				}
				const bounds = contentBounds(nodesRef.current.filter((node) => selectedNodeIds.includes(node.id)));
				if (bounds === null) {
					fitToContent();
					return;
				}
				fitToBounds(bounds);
			}, [
				selectedNodeIds,
				fitToContent,
				fitToBounds
			]);
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
					armPointer(event);
					event.preventDefault();
					return;
				}
				if (event.button !== 0) return;
				const additive = event.ctrlKey || event.metaKey;
				if (!additive) onSelectNode(null);
				const startWorld = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
				gesture.current = {
					mode: "marquee",
					startX: event.clientX,
					startY: event.clientY,
					startWorldX: startWorld.x,
					startWorldY: startWorld.y,
					additive
				};
				const el = containerRef.current;
				if (el !== null) {
					const rect = el.getBoundingClientRect();
					setMarquee({
						x1: event.clientX - rect.left,
						y1: event.clientY - rect.top,
						x2: event.clientX - rect.left,
						y2: event.clientY - rect.top
					});
				}
			};
			const onNodePointerDown = (event, node) => {
				const inRoster = selectedNodeIds.includes(node.id);
				const roster = event.ctrlKey || event.metaKey ? inRoster ? selectedNodeIds.filter((id) => id !== node.id) : [...selectedNodeIds, node.id] : inRoster ? selectedNodeIds : [node.id];
				onSelectNode(node.id, event.ctrlKey || event.metaKey);
				if (node.locked) return;
				const origins = roster.filter((id) => {
					const member = nodesRef.current.find((candidate) => candidate.id === id);
					return member !== void 0 && !member.locked && !(member.parentId !== void 0 && roster.includes(member.parentId));
				}).map((id) => {
					const member = nodesRef.current.find((candidate) => candidate.id === id);
					return {
						id,
						x: member.x,
						y: member.y
					};
				});
				gesture.current = {
					mode: "node",
					startX: event.clientX,
					startY: event.clientY,
					nodeId: node.id,
					originX: node.x,
					originY: node.y,
					origins
				};
				armPointer(event);
				setPrimaryDragId(node.id);
			};
			const onResizePointerDown = (event, node, corner) => {
				onSelectNode(node.id);
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
				armPointer(event);
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
				armPointer(event);
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
					ensureCaptured();
					panBy(event.clientX - current.startX, event.clientY - current.startY);
					current.startX = event.clientX;
					current.startY = event.clientY;
					return;
				}
				if (current.mode === "marquee") {
					const el = containerRef.current;
					if (el !== null) {
						const rect = el.getBoundingClientRect();
						setMarquee((prev) => prev === null ? prev : {
							...prev,
							x2: event.clientX - rect.left,
							y2: event.clientY - rect.top
						});
					}
					return;
				}
				if (current.mode === "node" && current.nodeId !== void 0 && current.originX !== void 0 && current.originY !== void 0) {
					if (!current.editBegun && !exceededThreshold(event, current)) return;
					ensureCaptured();
					beginEditOnce(current);
					const dx = (event.clientX - current.startX) / viewRef.current.scale;
					const dy = (event.clientY - current.startY) / viewRef.current.scale;
					if (current.origins !== void 0 && current.origins.length > 1) {
						const dragged = nodesRef.current.find((candidate) => candidate.id === current.nodeId);
						const primary = current.origins.find((origin) => origin.id === current.nodeId);
						if (dragged === void 0 || primary === void 0) return;
						const snapped = calculateSnap(nodesRef.current, dragged, primary.x + dx, primary.y + dy);
						const correctX = snapped.x - (primary.x + dx);
						const correctY = snapped.y - (primary.y + dy);
						for (const origin of current.origins) onMoveNode(origin.id, origin.x + dx + correctX, origin.y + dy + correctY);
						setGuides({
							vertical: snapped.guides.filter((guide) => guide.type === "vertical").map((guide) => guide.position),
							horizontal: snapped.guides.filter((guide) => guide.type === "horizontal").map((guide) => guide.position)
						});
						return;
					}
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
					if (!current.editBegun && !exceededThreshold(event, current)) return;
					ensureCaptured();
					beginEditOnce(current);
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
					ensureCaptured();
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
				if (current.mode === "marquee" && current.startWorldX !== void 0 && current.startWorldY !== void 0 && current.additive !== void 0) {
					const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
					const minX = Math.min(current.startWorldX, world.x);
					const maxX = Math.max(current.startWorldX, world.x);
					const minY = Math.min(current.startWorldY, world.y);
					const maxY = Math.max(current.startWorldY, world.y);
					const hits = maxX - minX < 2 && maxY - minY < 2 ? [] : nodesRef.current.filter((candidate) => candidate.visible !== false && candidate.x < maxX && candidate.x + candidate.width > minX && candidate.y < maxY && candidate.y + candidate.height > minY).map((candidate) => candidate.id);
					const roster = current.additive ? Array.from(/* @__PURE__ */ new Set([...selectedNodeIds, ...hits])) : hits;
					onSelectNode(null);
					for (const id of roster) onSelectNode(id, true);
				}
				if (current.mode === "link" && current.sourceId !== void 0) {
					const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
					const target = nodesRef.current.find((candidate) => candidate.id !== current.sourceId && candidate.visible !== false && world.x >= candidate.x && world.x <= candidate.x + candidate.width && world.y >= candidate.y && world.y <= candidate.y + candidate.height);
					if (target !== void 0) onLinkLayers([current.sourceId], target.id);
					setLinkLine(null);
					onPersist();
				}
				if ((current.mode === "node" || current.mode === "resize") && current.editBegun === true) onPersist();
				setGuides({
					vertical: [],
					horizontal: []
				});
				setMarquee(null);
				setPrimaryDragId(null);
				releasePointer();
				gesture.current = {
					mode: "none",
					startX: 0,
					startY: 0
				};
			};
			const visibleNodes = (0, react.useMemo)(() => nodes.filter((node) => node.visible !== false), [nodes]);
			const ordered = (0, react.useMemo)(() => [...visibleNodes].sort(compareNodes), [visibleNodes]);
			(0, react.useImperativeHandle)(ref, () => ({
				zoomBy,
				fitToContent,
				zoomToSelection,
				resetZoom
			}), [
				zoomBy,
				fitToContent,
				zoomToSelection,
				resetZoom
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csCanvasSurface",
				ref: containerRef,
				"data-mode": marquee !== null ? "marquee" : void 0,
				onPointerDown: onSurfacePointerDown,
				onPointerMove,
				onPointerUp,
				onContextMenu: (event) => {
					event.preventDefault();
					const world = screenToWorld(event.clientX, event.clientY, viewRef.current.x, viewRef.current.y, viewRef.current.scale);
					onBlankContextMenu(event.clientX, event.clientY, world.x, world.y);
				},
				onDoubleClick: () => {
					fitToContent();
				},
				onPointerLeave: () => {
					if (gesture.current.mode === "marquee") {
						setMarquee(null);
						gesture.current = {
							mode: "none",
							startX: 0,
							startY: 0
						};
						return;
					}
					if (gesture.current.mode === "link") {
						setLinkLine(null);
						releasePointer();
						gesture.current = {
							mode: "none",
							startX: 0,
							startY: 0
						};
						return;
					}
					if (gesture.current.mode !== "none") onPointerUp(new MouseEvent("pointerup"));
				},
				style: {
					backgroundPosition: `${view.x}px ${view.y}px`,
					backgroundSize: `${40 * view.scale}px ${40 * view.scale}px`
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								primary: node.id === primaryDragId,
								onNodePointerDown,
								onResizePointerDown,
								onLinkPointerDown,
								onRenameSubmit: onRename,
								onTextSubmit: onNodeTextSubmit,
								onOpenDetail: onNodeOpenDetail,
								...onNodeOpenPlayback !== void 0 ? { onOpenPlayback: onNodeOpenPlayback } : {},
								...onNodeOpenPreview !== void 0 ? { onOpenPreview: onNodeOpenPreview } : {},
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
					}),
					marquee !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csMarquee",
						style: {
							left: Math.min(marquee.x1, marquee.x2),
							top: Math.min(marquee.y1, marquee.y2),
							width: Math.abs(marquee.x2 - marquee.x1),
							height: Math.abs(marquee.y2 - marquee.y1)
						}
					}),
					minimapVisible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Minimap, {
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
					})
				]
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
			const hideBrokenMedia = (event) => {
				event.currentTarget.style.display = "none";
			};
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
								setHoverIndex((prev) => prev === index ? prev : index);
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
										draggable: false,
										onError: hideBrokenMedia
									}) : null,
									node.kind === "video" && node.url ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
										src: node.url,
										muted: true,
										preload: "metadata",
										onError: hideBrokenMedia
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
			const copyTimer = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				if (copyTimer.current !== null) clearTimeout(copyTimer.current);
			}, []);
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
					if (copyTimer.current !== null) clearTimeout(copyTimer.current);
					copyTimer.current = setTimeout(() => {
						copyTimer.current = null;
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
												src: ref.url,
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
		//#region src/client/canvas/VideoPlayerModal.tsx
		/** 秒 → mm:ss（超一小时罕见，兜底 h:mm:ss）。 */
		function formatTime(seconds) {
			if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
			const total = Math.floor(seconds);
			const h = Math.floor(total / 3600);
			const m = Math.floor(total % 3600 / 60);
			const s = total % 60;
			const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
			const ss = String(s).padStart(2, "0");
			return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
		}
		function VideoPlayerModal(props) {
			const { title, url, onClose } = props;
			const [paused, setPaused] = (0, react.useState)(false);
			const [duration, setDuration] = (0, react.useState)(0);
			const [current, setCurrent] = (0, react.useState)(0);
			const [volume, setVolume] = (0, react.useState)(1);
			const [muted, setMuted] = (0, react.useState)(false);
			const [videoDims, setVideoDims] = (0, react.useState)(null);
			const videoRef = (0, react.useRef)(null);
			const progressRef = (0, react.useRef)(null);
			const seekingRef = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onClose();
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [onClose]);
			const handleTogglePlay = () => {
				const el = videoRef.current;
				if (el === null) return;
				if (el.paused) {
					el.play();
					setPaused(false);
				} else {
					el.pause();
					setPaused(true);
				}
			};
			const seekToClientX = (clientX) => {
				const el = videoRef.current;
				const bar = progressRef.current;
				if (el === null || bar === null || duration <= 0) return;
				const rect = bar.getBoundingClientRect();
				if (rect.width <= 0) return;
				el.currentTime = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
				setCurrent(el.currentTime);
			};
			const handleVolumeChange = (next) => {
				const el = videoRef.current;
				if (el === null) return;
				el.volume = next;
				setVolume(next);
				if (next > 0 && el.muted) {
					el.muted = false;
					setMuted(false);
				}
			};
			const handleToggleMute = () => {
				const el = videoRef.current;
				if (el === null) return;
				el.muted = !el.muted;
				setMuted(el.muted);
			};
			const progressRatio = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csModalBackdrop csMediaPreviewBackdrop",
				role: "presentation",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csModal csVideoModalCard",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": `播放 ${title}`,
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "csModalHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csModalHeaderText",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "csModalHeaderMeta",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: videoDims !== null ? `${videoDims.width} × ${videoDims.height}` : "— × —" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csModalHeaderMetaSep",
											children: "·"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: duration > 0 ? `时长 ${formatTime(duration)}` : "加载中…" })
									]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csModalClose",
								"aria-label": "关闭",
								onClick: onClose,
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csVideoStage",
							onClick: handleTogglePlay,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
								ref: videoRef,
								className: "csVideoModalVideo",
								src: url,
								autoPlay: true,
								onPlay: () => {
									setPaused(false);
								},
								onPause: () => {
									setPaused(true);
								},
								onLoadedMetadata: () => {
									const el = videoRef.current;
									if (el !== null) {
										setDuration(el.duration);
										if (el.videoWidth > 0 && el.videoHeight > 0) setVideoDims({
											width: el.videoWidth,
											height: el.videoHeight
										});
									}
								},
								onTimeUpdate: () => {
									const el = videoRef.current;
									if (el !== null && !seekingRef.current) setCurrent(el.currentTime);
								}
							}), paused && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csVideoPlayIcon",
								"aria-hidden": "true",
								children: "▶"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csVideoControls",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csVideoControlButton",
									"aria-label": paused ? "播放" : "暂停",
									title: paused ? "播放" : "暂停",
									onClick: handleTogglePlay,
									children: paused ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
										width: "16",
										height: "16",
										viewBox: "0 0 24 24",
										fill: "currentColor",
										stroke: "none",
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", { points: "6 3 21 12 6 21 6 3" })
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
										width: "16",
										height: "16",
										viewBox: "0 0 24 24",
										fill: "currentColor",
										stroke: "none",
										"aria-hidden": "true",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "5",
											y: "3",
											width: "5",
											height: "18",
											rx: "1"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: "14",
											y: "3",
											width: "5",
											height: "18",
											rx: "1"
										})]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csVideoTime",
									children: formatTime(current)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									ref: progressRef,
									className: "csVideoProgress",
									role: "slider",
									"aria-label": "播放进度",
									"aria-valuemin": 0,
									"aria-valuemax": Math.round(duration),
									"aria-valuenow": Math.round(current),
									onPointerDown: (event) => {
										seekingRef.current = true;
										event.currentTarget.setPointerCapture(event.pointerId);
										seekToClientX(event.clientX);
									},
									onPointerMove: (event) => {
										if (seekingRef.current) seekToClientX(event.clientX);
									},
									onPointerUp: (event) => {
										seekingRef.current = false;
										event.currentTarget.releasePointerCapture(event.pointerId);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "csVideoProgressFill",
										style: { width: `${progressRatio * 100}%` }
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csVideoTime",
									children: formatTime(duration)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csVideoControlButton",
									"aria-label": muted ? "取消静音" : "静音",
									title: muted ? "取消静音" : "静音",
									onClick: handleToggleMute,
									children: muted || volume === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
										width: "16",
										height: "16",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										"aria-hidden": "true",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", {
												points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5",
												fill: "currentColor",
												stroke: "none"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
												x1: "23",
												y1: "9",
												x2: "17",
												y2: "15"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
												x1: "17",
												y1: "9",
												x2: "23",
												y2: "15"
											})
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
										width: "16",
										height: "16",
										viewBox: "0 0 24 24",
										fill: "none",
										stroke: "currentColor",
										strokeWidth: "2",
										strokeLinecap: "round",
										strokeLinejoin: "round",
										"aria-hidden": "true",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", {
												points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5",
												fill: "currentColor",
												stroke: "none"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14" })
										]
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "csVideoVolume",
									type: "range",
									min: 0,
									max: 1,
									step: .05,
									value: muted ? 0 : volume,
									"aria-label": "音量",
									onChange: (event) => {
										handleVolumeChange(Number(event.target.value));
									}
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/canvas/ImagePreviewModal.tsx
		function ImagePreviewModal(props) {
			const { title, url, onClose } = props;
			const [dims, setDims] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						onClose();
					}
				};
				window.addEventListener("keydown", onKeyDown, true);
				return () => {
					window.removeEventListener("keydown", onKeyDown, true);
				};
			}, [onClose]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csModalBackdrop csMediaPreviewBackdrop",
				role: "presentation",
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csModal csVideoModalCard",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": `预览 ${title}`,
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "csModalHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csModalHeaderText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "csModalHeaderMeta",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: dims !== null ? `${dims.width} × ${dims.height}` : "— × —" })
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csModalClose",
							"aria-label": "关闭",
							onClick: onClose,
							children: "×"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csImagePreviewStage",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: "csImagePreviewImg",
							src: url,
							alt: title,
							onLoad: (event) => {
								const img = event.currentTarget;
								if (img.naturalWidth > 0 && img.naturalHeight > 0) setDims({
									width: img.naturalWidth,
									height: img.naturalHeight
								});
							}
						})
					})]
				})
			});
		}
		//#endregion
		//#region src/client/canvas/CanvasContextMenu.tsx
		/** 右键菜单入口开关：只隐藏入口，处理函数与 props 接线全部保留（同 CanvasToolbar.TOOLBAR_VISIBILITY 模式）。 */
		const MENU_VISIBILITY = {
			/** 锁定 / 解锁（图层面板提供同名操作）。 */
			lock: false,
			/** 显示 / 隐藏（图层面板提供同名操作）。 */
			visibility: false,
			/** 置顶 / 置底 / 上移一层 / 下移一层（层级调整走图层面板）。 */
			zOrder: false
		};
		/**
		* The node context menu: edit/order/state actions plus generation actions.
		* Positioned at the cursor; closes on any action or when a press lands
		* outside the menu (CV-037). The forwarded ref points at the menu root so the
		* owner can tell inside from outside presses.
		*/
		const CanvasContextMenu = (0, react.forwardRef)(function CanvasContextMenu(props, ref) {
			const { node, x, y, onClose, onRename, onCopy, onDelete, onReorder, onToggleLock, onToggleVisibility, onRetry, onSteer, onCancel, onUngroup, onReferenceToChat, onDownload, onOpenDetail } = props;
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
					item("查看详情", () => {
						onOpenDetail(node.id);
					}),
					item("引用到对话", () => {
						onReferenceToChat(node.id);
					}),
					canDownloadNode(node) && item("下载资产", () => {
						onDownload(node.id);
					}),
					MENU_VISIBILITY.lock && item(node.locked ? "解锁" : "锁定", () => {
						onToggleLock(node.id);
					}),
					MENU_VISIBILITY.visibility && item(node.visible === false ? "显示" : "隐藏", () => {
						onToggleVisibility(node.id);
					}),
					MENU_VISIBILITY.zOrder && item("置顶", () => {
						onReorder(node.id, "front");
					}),
					MENU_VISIBILITY.zOrder && item("置底", () => {
						onReorder(node.id, "back");
					}),
					MENU_VISIBILITY.zOrder && item("上移一层", () => {
						onReorder(node.id, "forward");
					}),
					MENU_VISIBILITY.zOrder && item("下移一层", () => {
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
		//#region src/client/canvas/CanvasBlankMenu.tsx
		const CanvasBlankMenu = (0, react.forwardRef)(function CanvasBlankMenu(props, ref) {
			const { x, y, onClose, onCreateNode, onPaste, onFit } = props;
			const run = (action) => {
				onClose();
				action();
			};
			const item = (label, action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "csMenuAction",
				onClick: () => {
					run(action);
				},
				children: label
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref,
				className: "csContextMenu csBlankMenu",
				style: {
					left: x,
					top: y
				},
				onContextMenu: (event) => {
					event.preventDefault();
					event.stopPropagation();
				},
				children: [
					item("在此新建便签", () => {
						onCreateNode("sticky");
					}),
					item("在此新建文本", () => {
						onCreateNode("text");
					}),
					item("在此新建提示", () => {
						onCreateNode("prompt");
					}),
					item("粘贴", () => {
						onPaste();
					}),
					item("适配视野", () => {
						onFit();
					})
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
		/** 把节点显示名格式化为对话内引用标记。 */
		function formatRefToken(title) {
			if (/[[\]]/u.test(title)) throw new Error("节点标题包含 [ 或 ]，无法生成 @ref 引用标记，请先重命名该节点");
			return `@ref[${title}]`;
		}
		//#endregion
		//#region src/client/LobbyHero.tsx
		/** Lobby 品牌条：左侧品牌标识 + 引导句，右侧双 CTA。 */
		function LobbyHero(props) {
			const { onCreate, onCreateSample, creating } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csLobbyHero",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csLobbyBrand",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LogoMark, { size: 38 }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csLobbyBrandMeta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h1", {
								className: "csLobbyTitle",
								children: [BRAND.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csLobbyNameZh",
									children: BRAND.nameZh
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "csLobbyGreet",
								children: [
									"你好，",
									USER_MOCK.name,
									"，",
									EMPTY_COPY.welcomeTitle,
									"。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "csLobbyTagline",
								children: [
									BRAND.tagline,
									" · ",
									BRAND.taglineZh
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "csLobbyHint",
								children: LOBBY_COPY.hint
							})
						]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csLobbyActions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csLobbyButtons",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "csPrimary",
							onClick: onCreate,
							children: ["+ ", EMPTY_COPY.createProject]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csWelcomeSample",
							disabled: creating,
							onClick: onCreateSample,
							children: creating ? "创建中…" : EMPTY_COPY.createSample
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csLobbySampleHint",
						children: LOBBY_COPY.sampleHint
					})]
				})]
			});
		}
		//#endregion
		//#region src/skill-catalog.ts
		/**
		* 技能广场客户端元数据（CV-065 Phase B）。
		*
		* 诚实边界：这份清单是**展示层**数据，与 `skills/` 目录里的真实 skill 是
		* 两份东西。之所以不走 SKILL.md frontmatter 扩展，是因为上游 skill 严禁改编
		* （skill-expansion-spec.md 第 1 条）—— 不能往 H3 原版 SKILL.md 里塞
		* category / icon / 中文标题。
		*
		* 一致性靠测试兜底：`tests/skill-catalog.test.mjs` 断言 `skills/` 下每个已注册
		* skill 都能在本表取到条目，新增 skill 忘记补表会直接红。
		*
		* 放 src/ 根目录而非 src/client/ —— Host tsconfig 排除了 src/client/**，
		* 单测要直连编译产物 lib/skill-catalog.js。
		*/
		/** 广场侧栏分类（顺序即展示顺序）。 */
		const SKILL_CATEGORY_IDS = [
			"spec",
			"prompting",
			"marketing",
			"style",
			"audio",
			"other"
		];
		/** 分类中文名。 */
		const SKILL_CATEGORY_LABELS = {
			spec: "创作规范",
			prompting: "提示词技术",
			marketing: "营销广告",
			style: "视频风格",
			audio: "字幕配乐",
			other: "未分类"
		};
		/** 展示元数据清单（featured 排前，其余按分类顺序）。 */
		const SKILL_CATALOG = [
			{
				name: "canvas-studio-creation",
				title: "画布创作总纲",
				summary: "需求澄清 → 分镜审批 → 关键帧 → 成片的标准串联流程，所有创作的默认规范。",
				category: "spec",
				icon: "compass",
				hue: 262,
				featured: true,
				hidden: true
			},
			{
				name: "h3-prompt-writing",
				title: "H3 视频提示词",
				summary: "MiniMax H3 结构化写法：T2VA / I2VA / FL2VA / L2VA / Ref2VA 五种生成模式。",
				category: "prompting",
				icon: "quill",
				hue: 205,
				featured: true,
				h3: true,
				hidden: true
			},
			{
				name: "z-image-prompt-writing",
				title: "Z-Image 生图提示词",
				summary: "文生图九段式结构、无负向提示词的正向改写规则、打光与文字渲染词表。",
				category: "prompting",
				icon: "quill",
				hue: 190,
				featured: true,
				hidden: true
			},
			{
				name: "qwen-image-edit-writing",
				title: "图生图与改图提示词",
				summary: "指令式四段式（操作+目标+规格+保留子句）、多参考图分工、分步链式改写。",
				category: "prompting",
				icon: "quill",
				hue: 220,
				featured: true,
				hidden: true
			},
			{
				name: "brand-promo-video-generator",
				title: "品牌宣传片",
				summary: "给 logo、产品图或官网链接，确认时长后自动产出品牌宣传成片。",
				category: "marketing",
				icon: "megaphone",
				hue: 12,
				featured: true,
				demo: "brand-promo-video-generator.gif",
				h3: true
			},
			{
				name: "minimalist-product-ad-generator",
				title: "极简产品广告",
				summary: "从产品图提炼卖点，极简高质感分镜，适合电商主图视频与新品发布。",
				category: "marketing",
				icon: "megaphone",
				hue: 30,
				featured: false,
				demo: "minimalist-product-ad-generator.gif",
				h3: true
			},
			{
				name: "3d-animation-short-generator",
				title: "3D 动画短片",
				summary: "风格化 3D 短片：故事创意 → 角色/场景卡 → 标准化分镜的完整链路。",
				category: "style",
				icon: "film",
				hue: 275,
				featured: false,
				demo: "3d-animation-short-generator.gif",
				h3: true
			},
			{
				name: "co-op-game-intro-generator",
				title: "双人游戏开场",
				summary: "双人合作游戏菜单与开场动画：锁定双人身份线索，先出确认图再扩成片。",
				category: "style",
				icon: "film",
				hue: 148,
				featured: false,
				demo: "co-op-game-intro-generator.gif",
				h3: true
			},
			{
				name: "handdrawn-live-video-generator",
				title: "手绘发光动画",
				summary: "手绘发光动画与实拍空间融合，蜡笔粉笔质感的超现实短视频。",
				category: "style",
				icon: "film",
				hue: 44,
				featured: false,
				demo: "handdrawn-live-video-generator.gif",
				h3: true
			},
			{
				name: "paper-collage-explainer-generator",
				title: "纸拼贴科普",
				summary: "半调网点纸拼贴动画，讲知识点、观点与抽象话题的解说短片。",
				category: "style",
				icon: "film",
				hue: 20,
				featured: false,
				demo: "paper-collage-explainer-generator.gif",
				h3: true
			},
			{
				name: "papercraft-stop-motion-explainer",
				title: "纸艺定格科普",
				summary: "手工纸艺定格动画，用 tactile 质感讲解科学、教育与通识内容。",
				category: "style",
				icon: "film",
				hue: 330,
				featured: false,
				demo: "papercraft-stop-motion-explainer.gif",
				h3: true
			},
			{
				name: "music-video-subtitle-generator",
				title: "MV 歌词字幕",
				summary: "AI MV 与情绪短片的歌词字体排版：音乐 + 歌词 + 方向 → 卡点字幕成片。",
				category: "audio",
				icon: "music",
				hue: 300,
				featured: false,
				demo: "music-video-subtitle-generator.gif",
				h3: true
			},
			{
				name: "effect-test-runner",
				title: "效果测试执行器",
				summary: "放手跑模式下按固定用例自动跑创作全流程，采集参数与产物并出一致性测试报告。",
				category: "other",
				icon: "puzzle",
				hue: 150,
				featured: false
			}
		];
		/** 对广场 / lobby 推荐可见的子集：hidden 技能仍可在项目中使用，但不做展示。 */
		const VISIBLE_CATALOG = SKILL_CATALOG.filter((entry) => entry.hidden !== true);
		/** 按注册名取展示元数据；未收录（新增 skill 忘了补表）返回 null，不抛错。 */
		function getSkillEntry(name) {
			return SKILL_CATALOG.find((entry) => entry.name === name) ?? null;
		}
		/** 某分类下的广场可见技能。 */
		function skillsByCategory(category) {
			return VISIBLE_CATALOG.filter((entry) => entry.category === category);
		}
		/** 每个分类下的广场可见技能数（侧栏角标用，含 0 的分类）。 */
		function skillCountByCategory() {
			const counts = {};
			for (const id of SKILL_CATEGORY_IDS) counts[id] = 0;
			for (const entry of VISIBLE_CATALOG) counts[entry.category] += 1;
			return counts;
		}
		/**
		* lobby 横滚的推荐技能：在广场可见条目中 featured 优先，不足则用其余条目补齐。
		* @param limit - 返回条数上限（默认 8）。
		*/
		function recommendedSkills(limit = 8) {
			const featured = VISIBLE_CATALOG.filter((entry) => entry.featured);
			const rest = VISIBLE_CATALOG.filter((entry) => !entry.featured);
			return [...featured, ...rest].slice(0, Math.max(0, limit));
		}
		//#endregion
		//#region src/client/SkillIcon.tsx
		/** 按 id 渲染技能图标（id 未收录时落兜底的「方块横线」，不会渲染空白）。 */
		function SkillIcon(props) {
			const { id, size = 20 } = props;
			const common = {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			};
			switch (id) {
				case "compass": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...common,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "9"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", { points: "15.5 8.5 13 13 8.5 15.5 11 11 15.5 8.5" })]
				});
				case "quill": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...common,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 4 10 14l-4 4 4-4L20 4Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 10c0 5-4 8-9 8" })]
				});
				case "megaphone": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...common,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 10v4l11 5V5L4 10Z" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M15 8a4 4 0 0 1 0 8" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 16v4h3v-3.2" })
					]
				});
				case "film": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...common,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "3",
							y: "4",
							width: "18",
							height: "16",
							rx: "2"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "8",
							y1: "4",
							x2: "8",
							y2: "20"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "16",
							y1: "4",
							x2: "16",
							y2: "20"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "3",
							y1: "10",
							x2: "21",
							y2: "10"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "3",
							y1: "14",
							x2: "21",
							y2: "14"
						})
					]
				});
				case "music": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...common,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "7",
							cy: "18",
							r: "2.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "18",
							cy: "16",
							r: "2.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.5 18V7l11-2v11" })
					]
				});
				case "puzzle": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...common,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10 4h4v2a2 2 0 1 0 4 0V4h2v6h-2a2 2 0 1 0 0 4h2v6h-6v-2a2 2 0 1 0-4 0v2H4v-6h2a2 2 0 1 0 0-4H4V4h6Z" })
				});
				default: return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...common,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "4",
							y: "4",
							width: "16",
							height: "16",
							rx: "3"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "9",
							y1: "10",
							x2: "15",
							y2: "10"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: "9",
							y1: "14",
							x2: "15",
							y2: "14"
						})
					]
				});
			}
		}
		//#endregion
		//#region src/client/SkillCard.tsx
		/** 缩略图渐变：由色相现算，明暗主题自适应（不用硬编码色值）。 */
		function thumbStyle(hue) {
			return { background: `linear-gradient(135deg, hsl(${hue} 70% 56%), hsl(${(hue + 42) % 360} 62% 42%))` };
		}
		/** 单张技能卡：缩略图（默认动态演示）+ hover 操作菜单 + 标题 + 说明 + 分类 chip + 使用按钮。 */
		function SkillCard(props) {
			const { entry, onActivate, onDetail } = props;
			const showDemo = entry.demo !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: "csSkillCard",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csSkillThumb",
					style: thumbStyle(entry.hue),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillIcon, {
							id: entry.icon,
							size: 26
						}),
						showDemo && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: "csSkillThumbGif",
							src: `/canvas-studio/style-demos/${entry.demo}`,
							alt: "",
							draggable: false,
							loading: "lazy"
						}),
						entry.h3 === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csSkillH3",
							title: "基于 H3 技术路线（音视频联合生成）",
							children: "H3"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csSkillHover",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csSkillHoverBtn",
								onClick: () => {
									onActivate(entry);
								},
								children: "使用"
							}), onDetail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csSkillHoverBtn csSkillHoverGhost",
								onClick: () => {
									onDetail(entry);
								},
								children: "查看详情"
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csSkillBody",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "csSkillTitle",
							children: entry.title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "csSkillSummary",
							children: entry.summary
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csSkillFoot",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csSkillCategory",
								children: SKILL_CATEGORY_LABELS[entry.category]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csSkillUse",
								onClick: () => {
									onActivate(entry);
								},
								children: "使用"
							})]
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/SkillCarousel.tsx
		/**
		* lobby 推荐技能横滚（CV-065）。
		*
		* 只做横向滚动 + 左右翻页按钮，不做自动轮播（自动滚动会抢焦点、干扰输入）。
		* 滚动条隐藏，滚动位置靠 scrollBy 分页。
		*/
		/** 每次翻页滚动的距离（px）：约两张卡 + 间距。 */
		const PAGE_STEP = 420;
		/** 推荐技能横滚条。 */
		function SkillCarousel(props) {
			const { entries, onActivate, onOpenAll } = props;
			const trackRef = (0, react.useRef)(null);
			const [canScrollLeft, setCanScrollLeft] = (0, react.useState)(false);
			const [canScrollRight, setCanScrollRight] = (0, react.useState)(false);
			const updateNav = () => {
				const el = trackRef.current;
				if (el === null) return;
				setCanScrollLeft(el.scrollLeft > 1);
				setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
			};
			(0, react.useEffect)(() => {
				updateNav();
				const el = trackRef.current;
				if (el === null) return;
				const observer = new ResizeObserver(updateNav);
				observer.observe(el);
				return () => {
					observer.disconnect();
				};
			}, []);
			const scrollBy = (delta) => {
				trackRef.current?.scrollBy({
					left: delta,
					behavior: "smooth"
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csSkillCarousel",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csCarouselNav",
						title: "向前滚动",
						"aria-label": "向前滚动",
						disabled: !canScrollLeft,
						onClick: () => {
							scrollBy(-420);
						},
						children: "‹"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csCarouselTrack",
						ref: trackRef,
						onScroll: updateNav,
						children: entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csCarouselItem",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillCard, {
								entry,
								onActivate
							})
						}, entry.name))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csCarouselNav",
						title: "向后滚动",
						"aria-label": "向后滚动",
						disabled: !canScrollRight,
						onClick: () => {
							scrollBy(PAGE_STEP);
						},
						children: "›"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csCarouselMore",
						onClick: onOpenAll,
						children: "浏览全部 ›"
					})
				]
			});
		}
		//#endregion
		//#region src/client/SkillMarket.tsx
		/**
		* 全屏技能广场（CV-065）。
		*
		* 布局参照 MiniMaxHub（需求 2 图 #2）：左侧分类侧栏 + 右侧卡片网格。以覆盖层
		* 形式盖在 `.csFrame` 上（避开左侧 280px 项目栏），而不是替换画布容器 ——
		* 这样 lobby 与 work 两种模式共用同一套进入/退出逻辑，也不用重排 grid。
		*
		* 「新建技能」按钮保留但禁用 + 「待接入」角标（reserved 字段原则：不伪造
		* 已生效——自建 skill 的目录规范见 docs/skill-expansion-spec.md，UI 编辑器
		* 尚未实现）。
		*
		* 竞品对标批次（2026-09-02）：
		* - CV-072：右上搜索框（title/summary 子串过滤，与分类筛选叠加）。
		* - CV-074：「官方精选」分区（featured 置顶）+「其他技能」两级呈现。
		* - CV-073：「我的 Skill」视图（activeSkills 已激活条目 + 卸载，复用 CV-066 链路）。
		* - CV-077：「仅显示未激活」过滤。
		* - CV-071：技能详情弹窗（标题/说明/分类/使用入口）。
		* - CV-078：网格末尾创作者社区 CTA 卡（reserved 纯展示）。
		*/
		/** 侧栏「全部」的伪分类 id。 */
		const ALL = "all";
		/** 过滤链：分类 → 搜索子串 → 仅显示未激活。 */
		function filterEntries(active, query, onlyInactive, activeSkills) {
			const base = active === ALL ? VISIBLE_CATALOG : skillsByCategory(active);
			const q = query.trim().toLowerCase();
			return base.filter((entry) => {
				if (entry.hidden === true) return false;
				if (q.length > 0 && !entry.title.toLowerCase().includes(q) && !entry.summary.toLowerCase().includes(q) && !entry.name.toLowerCase().includes(q)) return false;
				if (onlyInactive && activeSkills.includes(entry.name)) return false;
				return true;
			});
		}
		/** 全屏技能广场：左分类侧栏 + 右卡片网格。 */
		function SkillMarket(props) {
			const { onClose, onActivate, activeSkills = [], onDeactivate } = props;
			const [active, setActive] = (0, react.useState)(ALL);
			const [view, setView] = (0, react.useState)("discover");
			const [query, setQuery] = (0, react.useState)("");
			const [onlyInactive, setOnlyInactive] = (0, react.useState)(false);
			const [detail, setDetail] = (0, react.useState)(null);
			const counts = skillCountByCategory();
			const mineActive = view === "mine";
			const entries = (0, react.useMemo)(() => filterEntries(active, query, onlyInactive && !mineActive, activeSkills), [
				active,
				query,
				onlyInactive,
				mineActive,
				activeSkills
			]);
			const splitFeatured = active === ALL && query.trim().length === 0 && !(onlyInactive && !mineActive) && !mineActive;
			const featured = splitFeatured ? entries.filter((entry) => entry.featured) : [];
			const rest = splitFeatured ? entries.filter((entry) => !entry.featured) : entries;
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						if (detail !== null) {
							setDetail(null);
							return;
						}
						onClose();
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [onClose, detail]);
			const renderGrid = (items) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csSkillGrid",
				children: items.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillCard, {
					entry,
					onActivate,
					onDetail: setDetail
				}, entry.name))
			});
			const renderCommunityCta = () => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csSkillCommunity",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csSkillCommunityIcon",
						children: "✦"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "加入创作者社区" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "按目录规范投放你的技能（规划中）" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csReserved",
						children: "待接入"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csSkillMarket",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "技能广场",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "csSkillMarketBar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csSkillMarketBack",
								onClick: onClose,
								children: "← 返回"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: "csSkillMarketTitle",
								children: "技能广场"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csSkillMarketCount",
								children: [VISIBLE_CATALOG.length, " 个技能"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csSkillMarketSpacer" }),
							view === "discover" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "search",
								className: "csSkillSearch",
								placeholder: "搜索 Skill...",
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "csSkillMarketCreate",
								disabled: true,
								title: "自建技能需按 docs/skill-expansion-spec.md 放目录，UI 编辑器尚未实现",
								children: ["+ 新建技能", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csReserved",
									children: "待接入"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csSkillMarketBody",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
							className: "csSkillRail",
							"aria-label": "技能分类",
							children: [
								onDeactivate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: mineActive ? "csSkillRailItem csSkillRailActive" : "csSkillRailItem",
									onClick: () => {
										setView("mine");
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "我的 Skill" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csSkillRailCount",
										children: activeSkills.length
									})]
								}),
								!mineActive && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: active === ALL ? "csSkillRailItem csSkillRailActive" : "csSkillRailItem",
									onClick: () => {
										setActive(ALL);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "全部" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csSkillRailCount",
										children: VISIBLE_CATALOG.length
									})]
								}),
								!mineActive && SKILL_CATEGORY_IDS.filter((id) => counts[id] > 0).map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: active === id ? "csSkillRailItem csSkillRailActive" : "csSkillRailItem",
									onClick: () => {
										setActive(id);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: SKILL_CATEGORY_LABELS[id] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csSkillRailCount",
										children: counts[id]
									})]
								}, id))
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csSkillContent",
							children: mineActive ? activeSkills.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csSkillEmpty",
								children: "还没有装载任何技能。在「发现」里点「使用」，work 态会同步装载。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csSkillMine",
								children: activeSkills.map((name) => {
									const entry = getSkillEntry(name);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csSkillMineRow",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillIcon, {
												id: entry?.icon ?? "puzzle",
												size: 18
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csSkillMineTitle",
												children: entry?.title ?? name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csSkillMineName",
												children: name
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csSkillMineRemove",
												title: "卸载该技能",
												onClick: () => {
													onDeactivate?.(name);
												},
												children: "×"
											})
										]
									}, name);
								})
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "csSkillOnlyInactive",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: onlyInactive,
									onChange: (event) => {
										setOnlyInactive(event.target.checked);
									}
								}), "仅显示未装载"]
							}), entries.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csSkillEmpty",
								children: "没有匹配的技能，换个关键词试试。"
							}) : splitFeatured ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								featured.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "csSkillSectionTitle",
									children: "官方精选"
								}), renderGrid(featured)] }),
								rest.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
									className: "csSkillSectionTitle",
									children: ["其他技能 · ", rest.length]
								}), renderGrid(rest)] }),
								renderCommunityCta()
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGrid(entries), renderCommunityCta()] })] })
						})]
					}),
					detail !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csSkillDetailBackdrop",
						onClick: () => {
							setDetail(null);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csSkillDetail",
							role: "dialog",
							"aria-modal": "true",
							"aria-label": detail.title,
							onClick: (event) => {
								event.stopPropagation();
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csSkillDetailThumb",
								style: { background: `linear-gradient(135deg, hsl(${detail.hue} 70% 56%), hsl(${(detail.hue + 42) % 360} 62% 42%))` },
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillIcon, {
									id: detail.icon,
									size: 30
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csSkillDetailBody",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
										className: "csSkillDetailTitle",
										children: [detail.title, detail.h3 === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csSkillH3",
											children: "H3"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csSkillDetailCategory",
										children: SKILL_CATEGORY_LABELS[detail.category]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "csSkillDetailSummary",
										children: detail.summary
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: "csSkillDetailName",
										children: detail.name
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csSkillDetailActions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csSkillDetailUse",
											onClick: () => {
												onActivate(detail);
											},
											children: "使用该技能"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "csSkillDetailClose",
											onClick: () => {
												setDetail(null);
											},
											children: "关闭"
										})]
									})
								]
							})]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/ActiveSkillChips.tsx
		/** work 态工作流条下方一行：已装载技能 chips。 */
		function ActiveSkillChips(props) {
			const { skills, onRemove } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csSkillChips",
				role: "group",
				"aria-label": "已装载技能",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "csSkillChipsLabel",
					children: "已装载"
				}), skills.map((name) => {
					const entry = getSkillEntry(name);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csSkillChip",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csSkillChipName",
							children: entry?.title ?? name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csSkillChipRemove",
							title: `卸载「${entry?.title ?? name}」`,
							"aria-label": `卸载 ${entry?.title ?? name}`,
							onClick: () => {
								onRemove(name);
							},
							children: "×"
						})]
					}, name);
				})]
			});
		}
		//#endregion
		//#region src/client/UserCard.tsx
		/**
		* CV-069：左栏底部用户卡 + 个人信息 popover（三态常驻，竞品对标 MiniMax Design）。
		*
		* 诚实边界（拍板四项之一）：主题与设置接**真实功能**（ctx.theme / 现有
		* SettingsModal —— 用户卡恰是 CV-059「设置入口 = 左下角」的插件内落点）；
		* 积分、订阅、记忆管理、教程、更新日志为 **reserved 入口**（挂「待接入」
		* 角标，不伪造已生效）；「接入飞书/微信」照抄竞品「未接入」badge 语义。
		* 假数据收敛在 brand-copy.ts 的 USER_MOCK，接真用户体系只改一处。
		*
		* 关闭语义复用 CV-037 教训：window mousedown 命中卡片/面板内部时放行
		* （否则 mousedown 抢先卸载导致点击无效）；Escape 关闭。
		*/
		/** 主题 id → 中文标签（与 SettingsModal 同规则）。 */
		function themeLabel(id) {
			if (id === "light") return "浅色";
			if (id === "dark") return "深色";
			if (id === "system") return "跟随系统";
			return id;
		}
		/** 首字母 + 品牌色渐变 SVG 头像（不用图片资源）。 */
		function LetterAvatar(props) {
			const initial = props.name.trim().charAt(0).toUpperCase() || "U";
			const size = props.size ?? 28;
			const gradientId = (0, react.useId)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "csUserAvatar",
				width: size,
				height: size,
				viewBox: "0 0 36 36",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("linearGradient", {
						id: gradientId,
						x1: "0",
						y1: "0",
						x2: "1",
						y2: "1",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
							offset: "0%",
							stopColor: "var(--cs-accent, #6c5ce7)"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
							offset: "100%",
							stopColor: "color-mix(in srgb, var(--cs-accent, #6c5ce7) 60%, #000)"
						})]
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "18",
						cy: "18",
						r: "18",
						fill: `url(#${gradientId})`
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
						x: "18",
						y: "24",
						textAnchor: "middle",
						fontSize: "16",
						fontWeight: "600",
						fill: "#fff",
						children: initial
					})
				]
			});
		}
		function UserCard(props) {
			const { onOpenSettings, theme } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const barRef = (0, react.useRef)(null);
			const [panelPos, setPanelPos] = (0, react.useState)(null);
			const toggle = () => setOpen((current) => !current);
			(0, react.useLayoutEffect)(() => {
				if (!open || barRef.current === null) return;
				const rect = barRef.current.getBoundingClientRect();
				setPanelPos({
					left: rect.left,
					bottom: window.innerHeight - rect.top + 8
				});
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const recompute = () => {
					if (barRef.current === null) return;
					const rect = barRef.current.getBoundingClientRect();
					setPanelPos({
						left: rect.left,
						bottom: window.innerHeight - rect.top + 8
					});
				};
				window.addEventListener("resize", recompute);
				window.addEventListener("scroll", recompute, true);
				return () => {
					window.removeEventListener("resize", recompute);
					window.removeEventListener("scroll", recompute, true);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onMouseDown = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("mousedown", onMouseDown);
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("mousedown", onMouseDown);
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			const themeSnap = theme !== void 0 ? theme.getTheme() : null;
			const activeThemeId = themeSnap === null ? null : themeSnap.preference === "system" ? "system" : themeSnap.active.id;
			const themeOptions = themeSnap === null ? [] : [...themeSnap.themes.map((definition) => definition.id), "system"];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csUser",
				ref: rootRef,
				children: [open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csUserPanel",
					role: "dialog",
					"aria-label": "用户信息",
					style: {
						left: panelPos?.left ?? 12,
						bottom: panelPos?.bottom ?? 24
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csUserHead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LetterAvatar, {
								name: USER_MOCK.name,
								size: 40
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csUserHeadMeta",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csUserName",
									children: USER_MOCK.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "csUserUid",
									children: ["UID：", USER_MOCK.uid]
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csUserRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserRowLabel",
								children: USER_MOCK.plan
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserBadge",
								children: "默认"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csUserRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserRowLabel",
								children: "积分余额"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csUserValue",
								children: [
									"✦ ",
									USER_MOCK.credits,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csReserved",
										children: "待接入"
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "csUserRow csUserEntry",
							disabled: true,
							title: "订阅体系尚未接入",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserRowLabel",
								children: "订阅"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csUserValue",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csReserved",
									children: "待接入"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csUserChevron",
									children: "›"
								})]
							})]
						}),
						theme !== void 0 && themeSnap !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csUserGroup",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserGroupLabel",
								children: "主题"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csUserThemeRow",
								children: themeOptions.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: activeThemeId === id ? "csUserThemeBtn csUserThemeActive" : "csUserThemeBtn",
									onClick: () => {
										theme.setTheme(id);
									},
									children: themeLabel(id)
								}, id))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csUserGroup",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csUserGroupLabel",
									children: "帮助"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "csUserEntry",
									disabled: true,
									title: "记忆管理尚未接入",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csUserRowLabel",
										children: "记忆管理"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csUserValue",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csReserved",
											children: "待接入"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csUserChevron",
											children: "›"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "csUserEntry",
									disabled: true,
									title: "外部接入尚未开通",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csUserRowLabel",
										children: "接入飞书 / 微信"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csUserValue",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csUserBadge",
											children: "未接入"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csUserChevron",
											children: "›"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "csUserEntry",
									disabled: true,
									title: "教程中心尚未接入",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csUserRowLabel",
										children: "教程"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csUserValue",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csReserved",
											children: "待接入"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csUserChevron",
											children: "›"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "csUserEntry",
									disabled: true,
									title: "更新日志尚未接入",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csUserRowLabel",
										children: "更新日志"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csUserValue",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csReserved",
											children: "待接入"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "csUserChevron",
											children: "›"
										})]
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "csUserEntry csUserSettings",
							onClick: () => {
								setOpen(false);
								onOpenSettings();
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserRowLabel",
								children: "设置"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csUserChevron",
								children: "›"
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "csUserBar",
					"aria-expanded": open,
					onClick: toggle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LetterAvatar, { name: USER_MOCK.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csUserBarName",
						children: USER_MOCK.name
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/StudioFrame.tsx
		const ZOOM_STEP = 1.2;
		/** Debounce for viewport saves (pan/zoom fire per frame; disk saves must not). */
		const VIEW_SAVE_DEBOUNCE_MS = 400;
		/** CV-015：toast 自动消失时长（错误比普通提示停留更久）。 */
		const TOAST_MS = {
			info: 3500,
			success: 3500,
			error: 6e3
		};
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
			const { renderSlot, useStudio, refreshProjects, createProject, openProject, deleteProject, createSampleProject, persistCanvas, retryNode, steerNode, cancelCurrentTurn, approveStoryboard, rejectStoryboard, confirmKeyframes, setWorkflowMode, activateSkill, deactivateSkill, actions, runEffectTests, createGroup, renameGroup, deleteGroup, moveProjectToGroup, settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme } = props;
			const projects = useStudio((store) => store.projects);
			const groups = useStudio((store) => store.groups);
			const selectedProjectId = useStudio((store) => store.selectedProjectId);
			const selectedNodeId = useStudio((store) => store.selectedNodeId);
			const selectedNodeIds = useStudio((store) => store.selectedNodeIds);
			const nodes = useStudio((store) => nodesOf(store, store.selectedProjectId));
			const nodesRef = (0, react.useRef)(nodes);
			nodesRef.current = nodes;
			const referenceNodes = (0, react.useMemo)(() => nodes.filter((node) => node.isReference === true && node.kind === "image"), [nodes]);
			const selectedNode = useStudio((store) => selectedNodeOf(store));
			const phase = useStudio((store) => store.phase);
			const error = useStudio((store) => store.error);
			const creating = useStudio((store) => store.creating);
			const historyIndex = useStudio((store) => store.historyIndex);
			const historyLength = useStudio((store) => store.history.length);
			const viewEntry = useStudio((store) => viewOf(store, store.selectedProjectId));
			const view = viewEntry.view;
			const workflow = useStudio((store) => store.selectedProjectId === null ? void 0 : store.workflows[store.selectedProjectId]);
			const activeSkills = useStudio((store) => activeSkillsOf(store, store.selectedProjectId));
			const hasConversation = useStudio((store) => hasConversationOf(store, store.selectedProjectId));
			const effectTest = useStudio((store) => store.effectTest);
			const [focusNodeId, setFocusNodeId] = (0, react.useState)(null);
			const [detailNodeId, setDetailNodeId] = (0, react.useState)(null);
			const [playbackNodeId, setPlaybackNodeId] = (0, react.useState)(null);
			const [previewNodeId, setPreviewNodeId] = (0, react.useState)(null);
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [projectFormOpen, setProjectFormOpen] = (0, react.useState)(false);
			const surfaceRef = (0, react.useRef)(null);
			const [menu, setMenu] = (0, react.useState)(null);
			const menuRef = (0, react.useRef)(null);
			const [blankMenu, setBlankMenu] = (0, react.useState)(null);
			const blankMenuRef = (0, react.useRef)(null);
			const [toasts, setToasts] = (0, react.useState)([]);
			const toastSeq = (0, react.useRef)(0);
			const viewSaveTimer = (0, react.useRef)(null);
			const fitPendingRef = (0, react.useRef)(false);
			const fittedProjectRef = (0, react.useRef)(null);
			const [fitRequestedAt, setFitRequestedAt] = (0, react.useState)(0);
			const [composeBusy, setComposeBusy] = (0, react.useState)(false);
			const [rejectFeedback, setRejectFeedback] = (0, react.useState)("");
			const [skillMarketOpen, setSkillMarketOpen] = (0, react.useState)(false);
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
			(0, react.useEffect)(() => {
				if (blankMenu === null) return;
				const close = () => {
					setBlankMenu(null);
				};
				const onMouseDown = (event) => {
					if (shouldKeepMenuOpen(event.target, blankMenuRef.current)) return;
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
			}, [blankMenu]);
			const projectId = selectedProjectId;
			const pushToast = (text, kind = "info") => {
				const id = ++toastSeq.current;
				setToasts((prev) => [...prev, {
					id,
					kind,
					text
				}]);
				setTimeout(() => {
					setToasts((prev) => prev.filter((entry) => entry.id !== id));
				}, TOAST_MS[kind]);
			};
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
			const beginEdit = (0, react.useCallback)(() => {
				if (projectId !== null) actions.pushHistory(projectId);
			}, [projectId, actions]);
			const persist = (0, react.useCallback)(() => {
				if (projectId !== null) persistCanvas(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "画布保存失败");
				});
			}, [
				projectId,
				actions,
				persistCanvas
			]);
			const persistAfter = (0, react.useCallback)((mutate) => {
				mutate();
				persist();
			}, [persist]);
			const probeImageDisplay = async (buffer) => {
				try {
					const bitmap = await createImageBitmap(new Blob([buffer]));
					const result = {
						display: previewSizeOf({
							width: bitmap.width,
							height: bitmap.height
						}),
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
			const handleViewChange = (0, react.useCallback)((patch) => {
				if (projectId === null) return;
				actions.setView(projectId, patch);
				if (viewSaveTimer.current !== null) clearTimeout(viewSaveTimer.current);
				viewSaveTimer.current = setTimeout(() => {
					viewSaveTimer.current = null;
					persist();
				}, VIEW_SAVE_DEBOUNCE_MS);
			}, [
				projectId,
				actions,
				persist
			]);
			const handleDelete = (0, react.useCallback)((ids) => {
				if (projectId === null || ids.length === 0) return;
				persistAfter(() => actions.removeNodes(projectId, ids));
				setDetailNodeId(null);
			}, [
				projectId,
				actions,
				persistAfter
			]);
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
			const handleUndo = (0, react.useCallback)(() => {
				persistAfter(() => actions.undo());
			}, [persistAfter, actions]);
			const handleRedo = (0, react.useCallback)(() => {
				persistAfter(() => actions.redo());
			}, [persistAfter, actions]);
			const handleRename = (0, react.useCallback)((id, title) => {
				if (projectId === null) return;
				persistAfter(() => actions.renameNode(projectId, id, title));
			}, [
				projectId,
				actions,
				persistAfter
			]);
			const handleUpdateNode = (0, react.useCallback)((id, updates) => {
				if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, updates));
			}, [
				projectId,
				actions,
				persistAfter
			]);
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
				let token;
				try {
					token = formatRefToken(node.title ?? node.id);
				} catch (cause) {
					pushToast(cause instanceof Error ? cause.message : "无法生成引用标记");
					return;
				}
				const input = document.querySelector(".csConversation textarea, .csConversation [contenteditable=\"true\"], .csConversation input[type=\"text\"]");
				if (input instanceof HTMLElement && insertReferenceToken(input, token)) return;
				navigator.clipboard?.writeText(token).catch(() => {});
				pushToast(`已复制引用标记：${token}\n在右侧聊天框粘贴，并补充说明（如「用这张角色图生成分镜」）。`);
			};
			/**
			* CV-065/066：技能广场「使用」。
			*
			* 语义是**把提示词插进对话输入框**，不自动发送、不注入 system prompt：
			* 用户不改不回车就什么都没发生（reserved 字段原则：不伪造已生效），也让
			* agent 自己决定要不要 `skill(name=X)` 加载正文（不污染模型决策）。
			* 找不到输入框时与 @ref 引用一样回退「复制 + 提示」。
			*
			* CV-066：work 态（已开项目）下**同时装载**到该项目的 activeSkills ——
			* 用户明确选了它，装载是自然结果；chip 常驻展示「已装载」，之后说
			* 「换个风格做一版」agent 仍会沿用该 skill。卸载走 chip 的 ×。
			* lobby 态没有项目可挂，只插提示词（用户回车后按消息里的技能名走软激活）。
			*/
			const handleActivateSkill = (entry) => {
				setSkillMarketOpen(false);
				const token = `使用技能「${entry.title}」（${entry.name}）：`;
				const input = document.querySelector(".csConversation textarea, .csConversation [contenteditable=\"true\"], .csConversation input[type=\"text\"]");
				if (input instanceof HTMLElement && insertReferenceToken(input, token)) pushToast(`已填入技能提示词：${entry.title}。补充说明后发送，agent 会加载该技能。`);
				else {
					navigator.clipboard?.writeText(token).catch(() => {});
					pushToast(`已复制技能提示词：${token}\n粘贴到聊天框并补充说明后发送。`);
				}
				if (projectId !== null) activateSkill(projectId, entry.name).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "技能装载失败");
				});
			};
			const handleDeactivateSkill = (name) => {
				if (projectId === null) return;
				deactivateSkill(projectId, name).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "技能卸载失败");
				});
			};
			const handleRetry = (0, react.useCallback)((id) => {
				if (projectId === null) return;
				retryNode(projectId, id).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "重试失败");
				});
			}, [
				projectId,
				actions,
				retryNode
			]);
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
			const handleTimelineSelect = (0, react.useCallback)((id) => {
				actions.selectNode(id);
				setFocusNodeId(id);
				setDetailNodeId(null);
			}, [actions]);
			const handleApprove = () => {
				if (projectId !== null) approveStoryboard(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "批准失败");
				});
			};
			const handleReject = () => {
				if (projectId !== null) rejectStoryboard(projectId, rejectFeedback).then(() => {
					setRejectFeedback("");
				}).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "驳回失败");
				});
			};
			const handleConfirmKeyframes = () => {
				if (projectId !== null) confirmKeyframes(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "确认关键帧失败");
				});
			};
			const handleSetMode = (mode) => {
				if (projectId !== null) setWorkflowMode(projectId, mode).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "模式切换失败");
				});
			};
			const timelineOrder = (0, react.useMemo)(() => deriveTimelineOrder(nodes, view.timeline), [nodes, view.timeline]);
			const handleTimelineReorder = (ids) => {
				handleViewChange({ timeline: ids });
			};
			const handleComposeExport = async () => {
				if (projectId === null || composeBusy) return;
				const clipIds = timelineOrder.filter((node) => node.kind === "video").map((node) => node.id);
				if (clipIds.length < 2) {
					pushToast("请先在时间轴上排列至少 2 个视频片段，再导出成片", "error");
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
					pushToast(`成片已生成（${duration.toFixed(1)}s），已添加到画布并自动定位到视图中心，可在时间轴或画布播放。`, "success");
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : String(cause);
					pushToast(`成片合成失败：${message}`, "error");
				} finally {
					setComposeBusy(false);
				}
			};
			const handleSelectNode = (0, react.useCallback)((id, multi) => {
				actions.selectNode(id, multi);
			}, [actions]);
			const handleSelectAllNodes = (0, react.useCallback)(() => {
				actions.selectAllNodes();
			}, [actions]);
			const handleMoveNode = (0, react.useCallback)((id, x, y) => {
				if (projectId === null) return;
				actions.moveNode(projectId, id, x, y);
			}, [projectId, actions]);
			const handleCopy = (0, react.useCallback)(() => {
				if (projectId !== null) actions.copySelected(projectId);
			}, [projectId, actions]);
			const handlePaste = (0, react.useCallback)(() => {
				if (projectId !== null) persistAfter(() => actions.pasteNodes(projectId));
			}, [
				projectId,
				actions,
				persistAfter
			]);
			const handleLinkLayers = (0, react.useCallback)((sourceIds, targetId) => {
				if (projectId !== null) persistAfter(() => actions.linkLayers(projectId, sourceIds, targetId));
			}, [
				projectId,
				actions,
				persistAfter
			]);
			const handleNodeTextSubmit = (0, react.useCallback)((id, text) => {
				if (projectId !== null) persistAfter(() => actions.updateNode(projectId, id, { text }));
			}, [
				projectId,
				actions,
				persistAfter
			]);
			const handleNodeOpenDetail = (0, react.useCallback)((node) => {
				actions.selectNode(node.id);
				setDetailNodeId(node.id);
			}, [actions]);
			const handleNodeOpenPlayback = (0, react.useCallback)((node) => {
				actions.selectNode(node.id);
				setPlaybackNodeId(node.id);
			}, [actions]);
			const handleNodeOpenPreview = (0, react.useCallback)((node) => {
				actions.selectNode(node.id);
				setPreviewNodeId(node.id);
			}, [actions]);
			const handleCanvasContextMenu = (0, react.useCallback)((node, x, y) => {
				setBlankMenu(null);
				setMenu({
					node,
					x,
					y
				});
			}, []);
			const handleBlankContextMenu = (0, react.useCallback)((x, y, worldX, worldY) => {
				setMenu(null);
				setBlankMenu({
					x,
					y,
					worldX,
					worldY
				});
			}, []);
			const handleMediaNatural = (0, react.useCallback)((id, naturalWidth, naturalHeight) => {
				if (projectId === null || naturalWidth <= 0) return;
				const target = nodesRef.current.find((node) => node.id === id);
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
						const display = previewSizeOf({
							width: naturalWidth,
							height: naturalHeight
						});
						updates.width = display.width;
						updates.height = display.height;
					}
				}
				if (Object.keys(updates).length === 0) return;
				persistAfter(() => actions.updateNode(projectId, id, updates));
			}, [
				projectId,
				actions,
				persistAfter
			]);
			const canvasBody = (() => {
				if (projectId === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LobbyHero, {
					creating,
					onCreate: () => setProjectFormOpen(true),
					onCreateSample: () => {
						createSampleProject();
					}
				});
				if (!hasConversation) return null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csCanvasBody",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasSurface, {
							nodes,
							view,
							onViewChange: handleViewChange,
							selectedNodeId,
							selectedNodeIds,
							onSelectNode: handleSelectNode,
							onSelectAllNodes: handleSelectAllNodes,
							onMoveNode: handleMoveNode,
							onUpdateNode: handleUpdateNode,
							onBeginEdit: beginEdit,
							onPersist: persist,
							onRemoveNodes: handleDelete,
							onCopy: handleCopy,
							onPaste: handlePaste,
							onUndo: handleUndo,
							onRedo: handleRedo,
							onLinkLayers: handleLinkLayers,
							onRename: handleRename,
							onNodeTextSubmit: handleNodeTextSubmit,
							onNodeOpenDetail: handleNodeOpenDetail,
							onNodeOpenPlayback: handleNodeOpenPlayback,
							onNodeOpenPreview: handleNodeOpenPreview,
							onContextMenu: handleCanvasContextMenu,
							onBlankContextMenu: handleBlankContextMenu,
							onRetry: handleRetry,
							onMediaNatural: handleMediaNatural,
							focusNodeId,
							ref: surfaceRef,
							minimapVisible: view.minimapVisible
						}),
						nodes.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasEmptyHint, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csReferenceFloat",
							children: referenceNodes.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReferenceTray, {
								nodes: referenceNodes,
								onUpdateNode: handleUpdateNode,
								onReferenceToChat: handleReferenceToChat
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csReferenceEmpty",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "csReferenceEmptyTitle",
									children: "参考图"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "csReferenceEmptyHint",
									children: "上传图片后在节点详情面板点「标记为参考」—— 被标记的图片会出现在这里， 可指定角色 / 风格 / 首末帧用途，并通过「引用到对话」交给 agent 使用。"
								})]
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
			const mode = projectId === null ? "lobby" : hasConversation ? "work" : "lobby-pending";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csFrame",
				"data-mode": mode,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: "csProjects",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csBrandHeader",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LogoMark, { size: 22 }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "csBrandMeta",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csBrandName",
										children: BRAND.name
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csBrandSub",
										children: BRAND.nameZh
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csProjectsScroll",
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
									groups,
									selectedProjectId,
									phase,
									error,
									creating,
									createOpen: projectFormOpen,
									onCreateOpenChange: setProjectFormOpen,
									onRefresh: () => void refreshProjects(),
									onCreate: createProject,
									onOpen: openProject,
									onDelete: deleteProject,
									onMoveToGroup: moveProjectToGroup,
									onCreateGroup: createGroup,
									onRenameGroup: renameGroup,
									onDeleteGroup: deleteGroup,
									onOpenSettings: () => {
										setSettingsOpen(true);
									},
									effectTest,
									onRunEffectTests: (round, cases) => {
										runEffectTests(round, cases);
									}
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UserCard, {
								onOpenSettings: () => {
									setSettingsOpen(true);
								},
								theme
							})
						]
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
									pushToast(video !== void 0 ? `参考视频处理失败：${message}` : `图片上传失败：${message}`, "error");
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
										pushToast(`图片上传失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
									}
								},
								onUploadVideo: async (file) => {
									try {
										await handleUploadVideo(file);
									} catch (cause) {
										pushToast(`参考视频处理失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
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
								onOpenSkills: () => {
									setSkillMarketOpen(true);
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
											disabled: workflow?.mode !== "auto",
											title: workflow?.mode !== "auto" ? "当前已是逐步确认模式" : void 0,
											onClick: () => {
												handleSetMode("confirm");
											},
											children: "逐步确认"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: workflow?.mode === "auto" ? "csActive" : "",
											disabled: workflow?.mode === "auto",
											title: workflow?.mode === "auto" ? "当前已是放手跑模式" : void 0,
											onClick: () => {
												handleSetMode("auto");
											},
											children: "放手跑"
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csWorkflowState",
										children: workflow?.state === "awaiting_approval" ? "等待批准" : workflow?.state === "keyframe_review" ? "关键帧待确认" : workflow?.state === "executing" ? "制作中" : "需求沟通中"
									}),
									workflow?.state === "awaiting_approval" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csWorkflowApproval",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowMessage",
												children: "分镜表已提交到画布，请确认后批准"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "text",
												className: "csRejectInput",
												value: rejectFeedback,
												onChange: (event) => {
													setRejectFeedback(event.target.value);
												},
												onKeyDown: (event) => {
													if (event.key === "Enter") handleReject();
												},
												placeholder: "不满意哪里？（可选，随驳回转给 AI）",
												title: "填写具体意见（如：第 3 镜节奏太快），AI 将按意见重做分镜；留空则只打回",
												maxLength: 500
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
												children: "批准后自动恢复流程"
											})
										]
									}),
									workflow?.state === "keyframe_review" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csWorkflowApproval",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowMessage",
												children: "关键帧已生成，请确认或二次编辑后点确认"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csPrimary",
												onClick: handleConfirmKeyframes,
												children: "确认关键帧"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowState",
												children: "确认后自动继续视频流程"
											})
										]
									})
								]
							}),
							mode === "work" && projectId !== null && activeSkills.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ActiveSkillChips, {
								skills: activeSkills,
								onRemove: (name) => {
									deactivateSkill(projectId, name).catch((cause) => {
										actions.setFailed(cause instanceof Error ? cause.message : "技能卸载失败");
									});
								}
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
					mode !== "work" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "csLobbyTail",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "csLobbyTailHead",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "推荐技能" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csLobbyTailHint",
								children: "点「使用」把提示词填进上面的输入框"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillCarousel, {
							entries: recommendedSkills(),
							onActivate: handleActivateSkill,
							onOpenAll: () => {
								setSkillMarketOpen(true);
							}
						})]
					}),
					skillMarketOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillMarket, {
						onClose: () => {
							setSkillMarketOpen(false);
						},
						onActivate: handleActivateSkill,
						activeSkills,
						onDeactivate: handleDeactivateSkill
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
					(() => {
						if (playbackNodeId === null) return null;
						const target = nodes.find((node) => node.id === playbackNodeId);
						if (target === void 0 || target.kind !== "video" || target.url === void 0) return null;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VideoPlayerModal, {
							title: target.title ?? "视频",
							url: target.url,
							onClose: () => {
								setPlaybackNodeId(null);
							}
						});
					})(),
					(() => {
						if (previewNodeId === null) return null;
						const target = nodes.find((node) => node.id === previewNodeId);
						if (target === void 0 || target.kind !== "image" || target.url === void 0) return null;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImagePreviewModal, {
							title: target.title ?? "图片",
							url: target.url,
							onClose: () => {
								setPreviewNodeId(null);
							}
						});
					})(),
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
						onOpenDetail: (id) => {
							actions.selectNode(id);
							setDetailNodeId(id);
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
					blankMenu !== null && projectId !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasBlankMenu, {
						ref: blankMenuRef,
						x: blankMenu.x,
						y: blankMenu.y,
						worldX: blankMenu.worldX,
						worldY: blankMenu.worldY,
						onClose: () => {
							setBlankMenu(null);
						},
						onCreateNode: (kind) => {
							persistAfter(() => actions.addNode(projectId, kind, {
								x: blankMenu.worldX,
								y: blankMenu.worldY
							}));
						},
						onPaste: () => {
							persistAfter(() => actions.pasteNodes(projectId));
						},
						onFit: () => {
							surfaceRef.current?.fitToContent();
						}
					}),
					toasts.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csToasts",
						role: "status",
						"aria-live": "polite",
						children: toasts.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `csToast csToast-${entry.kind}`,
							children: entry.text
						}, entry.id))
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
				allowFreeText: record.allowFreeText !== false,
				multiSelect: record.multiSelect === true
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
			const [selected, setSelected] = (0, react.useState)([]);
			const [submitted, setSubmitted] = (0, react.useState)(false);
			const settled = data.answer !== null || data.note !== null || submitted;
			(0, react.useEffect)(() => {
				if (data.answer !== null || data.note !== null) {
					setSelected([]);
					setFreeText("");
				}
			}, [data.answer, data.note]);
			const handleAnswer = (value) => {
				if (settled) return;
				const projectId = hooks.getSelectedProjectId();
				if (projectId !== null) hooks.onAnswer(projectId, value);
			};
			const handleOptionClick = (option) => {
				if (settled) return;
				setSelected((prev) => data.multiSelect ? prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option] : [option]);
			};
			const confirmLabel = data.multiSelect ? `确认（已选 ${selected.length} 项）` : selected.length > 0 ? `确认：${selected[0]}` : "确认";
			const submitSelected = () => {
				if (selected.length === 0 || settled) return;
				handleAnswer(selected.join("、"));
				setSubmitted(true);
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "csQuestionLabel",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
								className: "csQuestionIcon",
								children: "✦"
							}),
							data.question,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
								className: "csQuestionHint",
								children: "点选后确认"
							})
						]
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
								className: `csStyleDemoCard${selected.includes(option) ? " csSelected" : ""}`,
								disabled: settled,
								onClick: () => {
									handleOptionClick(option);
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
							className: selected.includes(option) ? "csSelected" : void 0,
							disabled: settled,
							onClick: () => {
								handleOptionClick(option);
							},
							children: option
						}, option))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "csQuestionConfirm",
						disabled: settled || selected.length === 0,
						onClick: submitSelected,
						children: confirmLabel
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
						children: data.answer !== null ? `✓ 已选择：${data.answer}` : data.note
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
						const source = event.data.message?.source;
						if (source === void 0 || source === null || source.callId === void 0 || source.callId === null) return null;
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
			const activateSkill = async (projectId, name) => {
				storeInstance.actions.activateSkill(projectId, name);
				const next = activeSkillsOf(storeInstance.getSnapshot(), projectId);
				try {
					await saveActiveSkills(projectId, next);
				} catch (cause) {
					storeInstance.actions.setActiveSkills(projectId, next.filter((candidate) => candidate !== name));
					throw cause;
				}
			};
			const deactivateSkill = async (projectId, name) => {
				const before = activeSkillsOf(storeInstance.getSnapshot(), projectId);
				storeInstance.actions.deactivateSkill(projectId, name);
				const next = activeSkillsOf(storeInstance.getSnapshot(), projectId);
				try {
					await saveActiveSkills(projectId, next);
				} catch (cause) {
					storeInstance.actions.setActiveSkills(projectId, before);
					throw cause;
				}
			};
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
			const syncHasConversation = () => {
				const projectId = resolveActiveProjectId();
				if (projectId === null) return;
				const sessions = sessionSvc.list.getSnapshot();
				if (sessions.phase === "pending") return;
				const current = sessions.current === void 0 ? void 0 : sessions.byId[sessions.current];
				const has = current !== void 0 && current.blank !== true;
				if ((storeInstance.getSnapshot().hasConversation[projectId] ?? false) !== has) storeInstance.actions.setHasConversation(projectId, has);
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
			const wakeAgent = (text) => {
				const sessionId = sessionSvc.list.getSnapshot().current;
				if (sessionId === void 0) return;
				const scoped = sessionSvc.scope(sessionId);
				if (scoped === void 0) return;
				const conversation = scoped.get("conversation");
				if (conversation === void 0) return;
				conversation.send(text).catch(() => {});
			};
			const approveStoryboard = async (projectId) => {
				await applyWorkflowAction(projectId, "approve");
				wakeAgent("继续");
			};
			const rejectStoryboard = async (projectId, feedback) => {
				await applyWorkflowAction(projectId, "reject");
				const trimmed = feedback?.trim();
				wakeAgent(trimmed !== void 0 && trimmed.length > 0 ? `分镜已驳回，请按以下意见修改后重新提交：${trimmed}` : "请按我的修改意见重新提交分镜");
			};
			const confirmKeyframes = async (projectId) => {
				const workflow = await postStudioWorkflowAction(projectId, "confirm_keyframes");
				storeInstance.actions.setWorkflow(projectId, workflow);
				wakeAgent("继续");
			};
			const setWorkflowMode = async (projectId, mode) => {
				const before = storeInstance.getSnapshot().workflows[projectId];
				const workflow = await postStudioWorkflowAction(projectId, "setMode", mode);
				storeInstance.actions.setWorkflow(projectId, workflow);
				if ((before?.state === "awaiting_approval" || before?.state === "keyframe_review") && workflow.state === "executing") wakeAgent("继续");
			};
			const answerQuestion = async (projectId, value) => {
				const workflow = await answerStudioQuestion(projectId, value);
				storeInstance.actions.setWorkflow(projectId, workflow);
			};
			ctx.effect(() => installStudioStyles(), "canvas-studio: studio styles");
			const initialBrandPreset = ctx.settingsScope.bind({ namespace: "canvas-studio" }).getSnapshot().value?.brandPreset;
			ctx.effect(() => installBrandStyles(initialBrandPreset), "canvas-studio: brand tokens + favicon");
			const applyThemeToDom = () => {
				const dark = ctx.theme.getTheme().active.colorScheme === "dark";
				document.documentElement.style.colorScheme = dark ? "dark" : "light";
				document.body.toggleAttribute("data-ds-dark-theme", dark);
			};
			ctx.effect(() => {
				applyThemeToDom();
				return ctx.on("theme/change", applyThemeToDom);
			}, "canvas-studio: theme presenter (ui-layout disabled)");
			{
				const slots = ctx.slots;
				slots.inject("conversation.hero.brand.mark", () => slots.register({ name: "conversation.hero.brand.mark" }, HeroBrandMark));
			}
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
				syncHasConversation();
				alignStartupSession();
				const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(() => {
					syncActiveProject();
					syncHasConversation();
					alignStartupSession();
				});
				const unsubscribeSessions = sessionSvc.list.subscribe(() => {
					syncActiveProject();
					syncHasConversation();
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
								let projects = await listStudioProjects();
								const STALE_GRACE_MS = 10 * 6e4;
								const createdMs = (p) => {
									const t = Date.parse(p.createdAt);
									return Number.isFinite(t) ? t : 0;
								};
								const stale = projects.filter((p) => /^效果验证-R\d+-/.test(p.name) && Date.now() - createdMs(p) > STALE_GRACE_MS);
								const staleChecks = await Promise.all(stale.map(async (p) => ({
									project: p,
									empty: await loadStudioCanvas(p.id).then((doc) => doc.nodes.length === 0).catch(() => false)
								})));
								for (const { project, empty } of staleChecks) {
									if (!empty) continue;
									try {
										await deleteStudioProject(project.id);
										const bound = ctx.workspaces.list.getSnapshot().items.find((item) => item.path === project.dir);
										if (bound !== void 0) await ctx.workspaces.delete(bound.workspaceId);
									} catch {}
								}
								if (staleChecks.some(({ empty }) => empty)) projects = await listStudioProjects();
								storeInstance.actions.setLoaded(projects);
								try {
									storeInstance.actions.setGroups(await listStudioGroups());
								} catch {}
								syncActiveProject();
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目列表加载失败");
							}
						};
						const persistCanvas = (projectId) => enqueueCanvasIo(async () => {
							const snapshot = storeInstance.getSnapshot();
							await saveStudioCanvas(projectId, (snapshot.nodes[projectId] ?? []).filter((node) => !isTransientNode(node)), viewOf(snapshot, projectId).view);
						});
						/** 画布为空时预置示例节点（onboarding 示例项目 / dev-seed 共用），幂等。 */
						const seedProjectIfEmpty = async (projectId) => {
							if ((storeInstance.getSnapshot().nodes[projectId] ?? []).length > 0) return;
							const seeded = seedNodes();
							storeInstance.actions.setNodes(projectId, seeded);
							await persistCanvas(projectId);
						};
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
								syncHasConversation();
								try {
									storeInstance.actions.setActiveSkills(project.id, await loadActiveSkills(project.id));
								} catch {}
								refreshWorkflow(project.id);
								if (devSeed) await seedProjectIfEmpty(project.id);
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目会话绑定失败");
							}
						};
						const createProject = async (name, groupId) => {
							storeInstance.actions.setCreating(true);
							try {
								const project = await createStudioProject(name, groupId);
								await refreshProjects();
								await openProject(project);
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目创建失败");
							} finally {
								storeInstance.actions.setCreating(false);
							}
						};
						const refreshGroups = async () => {
							try {
								storeInstance.actions.setGroups(await listStudioGroups());
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "分组加载失败");
							}
						};
						const createGroup = async (name) => {
							try {
								await createStudioGroup(name);
								await refreshGroups();
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "分组创建失败");
							}
						};
						const renameGroup = async (groupId, name) => {
							try {
								await renameStudioGroup(groupId, name);
								await refreshGroups();
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "分组重命名失败");
							}
						};
						const deleteGroup = async (groupId) => {
							try {
								await deleteStudioGroup(groupId);
								await refreshGroups();
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "分组删除失败");
							}
						};
						const moveProjectToGroup = async (projectId, groupId) => {
							try {
								await moveStudioProjectToGroup(projectId, groupId);
								await refreshProjects();
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "项目移动分组失败");
							}
						};
						const createSampleProject = async () => {
							storeInstance.actions.setCreating(true);
							try {
								const existing = storeInstance.getSnapshot().projects.find((entry) => entry.name === "示例项目");
								const project = existing ?? await createStudioProject("示例项目");
								if (existing === void 0) await refreshProjects();
								await openProject(project);
								await seedProjectIfEmpty(project.id);
							} catch (cause) {
								storeInstance.actions.setFailed(cause instanceof Error ? cause.message : "示例项目创建失败");
							} finally {
								storeInstance.actions.setCreating(false);
							}
						};
						const EFFECT_TEST_START_TIMEOUT_MS = 12e4;
						const EFFECT_TEST_CASE_TIMEOUT_MS = 25 * 6e4;
						const effectTestPoll = (ms) => new Promise((resolve) => {
							setTimeout(resolve, ms);
						});
						/** 等当前会话切到目标项目（cwd 匹配；openProject 的 startSession 是 fire-and-forget）。 */
						const waitSessionBound = async (projectDir, timeoutMs) => {
							const deadline = Date.now() + timeoutMs;
							while (Date.now() < deadline) {
								const sessions = sessionSvc.list.getSnapshot();
								const summary = sessions.current === void 0 ? void 0 : sessions.byId[sessions.current];
								if (summary !== void 0 && summary.cwd === projectDir) return summary.id;
								await effectTestPoll(1500);
							}
							throw new Error("会话绑定项目超时");
						};
						/** 等一轮 agent 回合完整结束（启动 → 稳定空闲）。 */
						const waitAgentTurn = async (sessionId, timeoutMs) => {
							const started = Date.now();
							let sawRunning = false;
							let idleStreak = 0;
							while (Date.now() - started < timeoutMs) {
								const summary = sessionSvc.list.getSnapshot().byId[sessionId];
								if (summary?.running === true) sawRunning = true;
								idleStreak = summary !== void 0 && summary.running !== true && summary.pendingInteraction === void 0 ? idleStreak + 1 : 0;
								if (sawRunning && idleStreak >= 2) return;
								if (!sawRunning && Date.now() - started > EFFECT_TEST_START_TIMEOUT_MS) throw new Error("测试指令发出后回合未启动");
								await effectTestPoll(3e3);
							}
							throw new Error("等待 agent 回合结束超时");
						};
						const runEffectTests = async (round, cases) => {
							if (storeInstance.getSnapshot().effectTest?.running) return;
							if (cases.length === 0) return;
							storeInstance.actions.patchEffectTest({
								running: true,
								round,
								queue: [...cases],
								currentIndex: -1,
								currentLabel: null,
								done: [],
								failures: [],
								finished: false,
								message: null
							});
							for (let index = 0; index < cases.length; index += 1) {
								const caseId = cases[index];
								const label = `效果验证-${round}-${caseId}`;
								storeInstance.actions.patchEffectTest({
									currentIndex: index,
									currentLabel: label
								});
								try {
									const project = await createStudioProject(label);
									await refreshProjects();
									await openProject(project);
									const sessionId = await waitSessionBound(project.dir, EFFECT_TEST_START_TIMEOUT_MS);
									await setWorkflowMode(project.id, "auto");
									const conversation = sessionSvc.scope(sessionId)?.get("conversation");
									if (conversation === void 0) throw new Error("会话 conversation 服务未就绪");
									await conversation.send(`跑效果测试 ${caseId}（记为 ${round}）`);
									await waitAgentTurn(sessionId, EFFECT_TEST_CASE_TIMEOUT_MS);
									const snapshot = storeInstance.getSnapshot().effectTest;
									storeInstance.actions.patchEffectTest({ done: [...snapshot?.done ?? [], label] });
								} catch (cause) {
									const message = cause instanceof Error ? cause.message : String(cause);
									const snapshot = storeInstance.getSnapshot().effectTest;
									storeInstance.actions.patchEffectTest({
										done: [...snapshot?.done ?? [], label],
										failures: [...snapshot?.failures ?? [], `${label}: ${message}`]
									});
								}
							}
							const finished = storeInstance.getSnapshot().effectTest;
							const succeeded = (finished?.done.length ?? 0) - (finished?.failures.length ?? 0);
							storeInstance.actions.patchEffectTest({
								running: false,
								currentIndex: -1,
								currentLabel: null,
								finished: true,
								message: `本轮 ${round} 完成：成功 ${succeeded} · 失败 ${finished?.failures.length ?? 0}。报告在各项目目录「效果测试报告.md」，跑 scripts/collect-effect-tests.mjs 归档。`
							});
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
									if (project !== void 0) {
										const deadline = Date.now() + 5e3;
										while (ctx.workspaces.list.getSnapshot().items.some((item) => item.path === project.dir) && Date.now() < deadline) await new Promise((resolve) => {
											setTimeout(resolve, 100);
										});
									}
									const nextId = resolveActiveProjectId();
									const next = nextId === null ? void 0 : storeInstance.getSnapshot().projects.find((entry) => entry.id === nextId);
									if (next !== void 0) await openProject(next);
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
							createSampleProject,
							refreshGroups,
							createGroup,
							renameGroup,
							deleteGroup,
							moveProjectToGroup,
							persistCanvas,
							retryNode,
							steerNode,
							cancelCurrentTurn,
							refreshWorkflow,
							approveStoryboard,
							rejectStoryboard,
							confirmKeyframes,
							setWorkflowMode,
							runEffectTests,
							activateSkill,
							deactivateSkill,
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