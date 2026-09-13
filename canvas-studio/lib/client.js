window.__ModuleLoader__.load({
	id: "canvas-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		/**
		* CV-143：音轨构成的中文标签。放共享契约而非各端各写一份——Host 的工具结果
		* 文案与客户端角标必须说同一句话，否则用户看到的和模型读到的不一致。
		*/
		const AUDIO_COMPOSITION_LABELS = {
			native: "环境声",
			"native+bgm": "环境声 + BGM",
			bgm: "纯 BGM",
			none: "无声"
		};
		/** CV-143：音轨构成的悬停解释（角标 title，说明「为什么是这个构成」）。 */
		const AUDIO_COMPOSITION_HINTS = {
			native: "单镜整出，保留该镜原生环境声",
			"native+bgm": "单镜整出，原生环境声与 BGM 叠混",
			bgm: "多镜拼接，各镜环境声已丢弃，成片只有 BGM",
			none: "多镜拼接且未提供 BGM，各镜环境声已丢弃 —— 成片无声"
		};
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
		//#region src/asset-capture.ts
		/**
		* 画布媒体工具名 → 产物类型。
		*
		* ⚠️ **这是「工具能否上画布」的唯一白名单**：不在表里的工具，`tool/call` 不会
		* 产生 start，于是它的 `tool/result` 在 conversationEvents 里找不到挂载点，
		* `reloadCanvas` 永不触发 —— **产物已经落盘，画布却要切窗口才刷新**。
		* 新增任何「会 appendCanvasNode 的工具」必须同时在此登记（CV-130 就踩过
		* music_generation 漏登记的坑），`tests/asset-capture.test.mjs` 有对应用例。
		*/
		const STUDIO_TOOL_KINDS = {
			image_generate: "image",
			character_generate: "image",
			character_sheet: "image",
			video_generate: "video",
			video_composite: "video",
			compose_video: "video",
			extract_last_frame: "image",
			music_generation: "audio"
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
			"submit_screenplay_for_approval",
			"ask_user_choice",
			"write_screenplay",
			"write_script",
			"qc_shot"
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
				state: record.state === "awaiting_approval" || record.state === "script_review" || record.state === "keyframe_review" || record.state === "executing" ? record.state : "drafting"
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
			const composeExcluded = Array.isArray(raw.composeExcluded) && raw.composeExcluded.every((id) => typeof id === "string") ? raw.composeExcluded : void 0;
			const composeBgmNodeId = typeof raw.composeBgmNodeId === "string" ? raw.composeBgmNodeId : void 0;
			return {
				x: numberOr(raw.x, VIEW_DEFAULTS.x),
				y: numberOr(raw.y, VIEW_DEFAULTS.y),
				scale: clampViewScale(numberOr(raw.scale, VIEW_DEFAULTS.scale)),
				layersOpen: boolOr(raw.layersOpen, VIEW_DEFAULTS.layersOpen),
				minimapVisible: boolOr(raw.minimapVisible, VIEW_DEFAULTS.minimapVisible),
				...timeline !== void 0 ? { timeline } : {},
				...composeExcluded !== void 0 ? { composeExcluded } : {},
				...composeBgmNodeId !== void 0 ? { composeBgmNodeId } : {}
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
		async function createStudioProject(name, groupId, plan, signal) {
			const body = groupId === void 0 ? { name } : {
				name,
				groupId
			};
			if (plan !== void 0) body.plan = plan;
			return (await readJson(await fetch("/canvas-studio/projects", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
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
		* 2026-09-05 两段式上传（对话附件旁路体验优化）：快速段只落盘（毫秒级），
		* 返回同源 url + 磁盘文件名；Drama 提升由 promoteStudioImage 后台接力，
		* 发送不再被公网上传阻塞。
		*/
		async function uploadLocalStudioImageDeferred(projectId, name, dataBase64, signal) {
			return await readJson(await fetch("/canvas-studio/upload-local", {
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
		/** 提升段：把已落盘资产上传 Drama 拿 filename（后台预热 / 惰性兜底共用）。 */
		async function promoteStudioImage(projectId, assetFile, signal) {
			return (await readJson(await fetch("/canvas-studio/promote", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId,
					assetFile
				}),
				...signal === void 0 ? {} : { signal }
			}))).filename;
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
		/**
		* C3 真波形：取音频包络（0–1 峰值序列）。任何失败（ffmpeg 缺失 / 解码失败 /
		* 非音频资产）返回 null —— 波形是装饰性信息，调用方静默退回确定性公式，
		* 不重试、不报 UI 错。
		*/
		async function fetchStudioWaveform(projectId, file, signal) {
			try {
				const response = await readJson(await fetch("/canvas-studio/waveform", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						projectId,
						file
					}),
					...signal === void 0 ? {} : { signal }
				}));
				if (!Array.isArray(response.envelope)) return null;
				return response.envelope.every((value) => typeof value === "number" && Number.isFinite(value)) ? response.envelope : null;
			} catch {
				return null;
			}
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
				canvasGrid: "rgba(255, 255, 255, 0.06)",
				canvasGridMajor: "rgba(255, 255, 255, 0.11)"
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
				canvasGrid: "rgba(255, 255, 255, 0.06)",
				canvasGridMajor: "rgba(255, 255, 255, 0.11)"
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
				canvasGrid: "rgba(255, 255, 255, 0.06)",
				canvasGridMajor: "rgba(255, 255, 255, 0.11)"
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
				canvasGrid: "rgba(255, 255, 255, 0.06)",
				canvasGridMajor: "rgba(255, 255, 255, 0.11)"
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
		/** 非配色令牌（间距 / 圆角 / 阴影 / 动效 / 景深 / 字阶），不随预设切换。 */
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
			["--cs-ease", "cubic-bezier(0.2, 0, 0, 1)"],
			["--cs-dim", "0.42"],
			["--cs-node-opacity", "1"],
			["--cs-node-state", "1"],
			["--cs-node-dim", "1"],
			["--cs-fs-xs", "11px"],
			["--cs-fs-sm", "12px"],
			["--cs-fs-md", "13px"],
			["--cs-fs-lg", "14px"],
			["--cs-fs-xl", "18px"],
			["--cs-fs-2xl", "24px"]
		];
		/**
		* 界面骨架表面令牌（DD-02 空间三档）：壳 → 画布 → 节点 → 浮层。
		*
		* 不随预设切换（预设只动 accent 族，见 §3 设计约束），但**分明明暗两轨** ——
		* 深色下画布最暗、壳居中、节点最亮；浅色下反向压出对比。宿主已有的
		* `--dsw-alias-bg-layer-*` 表达的是宿主意图（弹层 / 卡片），与「制作现场」
		* 的空间语义不同名，故单列一族，不抢宿主令牌。
		*/
		const SURFACE_LIGHT = [
			["--cs-shell", "#FFFFFF"],
			["--cs-shell-2", "#FAFAFC"],
			["--cs-node", "#FFFFFF"],
			["--cs-node-hi", "#F4F5FA"],
			["--cs-float", "#FFFFFF"],
			["--cs-line", "rgba(15, 17, 23, 0.08)"],
			["--cs-line-hi", "rgba(15, 17, 23, 0.16)"],
			["--cs-gate", "rgba(15, 17, 23, 0.82)"],
			["--cs-scrim", "rgba(252, 252, 254, 0.9)"]
		];
		const SURFACE_DARK = [
			["--cs-shell", "#15171E"],
			["--cs-shell-2", "#1A1D26"],
			["--cs-node", "#1E2230"],
			["--cs-node-hi", "#252A3B"],
			["--cs-float", "#22273A"],
			["--cs-line", "rgba(255, 255, 255, 0.075)"],
			["--cs-line-hi", "rgba(255, 255, 255, 0.14)"],
			["--cs-gate", "#0B0D12"],
			["--cs-scrim", "rgba(11, 13, 18, 0.86)"]
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
				["--cs-canvas-bg", "#EFEFF4"],
				["--cs-canvas-bg-l1", "#F7F7FA"],
				["--cs-canvas-grid", "rgba(15, 17, 23, 0.06)"],
				["--cs-canvas-grid-major", "rgba(15, 17, 23, 0.11)"],
				["--cs-glow-accent", "0 0 0 1px var(--cs-accent-soft), 0 2px 14px color-mix(in srgb, var(--cs-accent) 26%, transparent)"]
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
				["--cs-glow-accent", "0 0 0 1px var(--cs-accent-soft), 0 0 18px color-mix(in srgb, var(--cs-accent) 32%, transparent)"]
			];
			const fixed = [["--cs-gold", BRAND_FIXED.gold], ["--cs-teal", BRAND_FIXED.teal]];
			const fixedText = renderPairs(fixed);
			const nonColorText = renderPairs(NON_COLOR_TOKENS);
			return [
				`body[data-cs-brand="${preset.id}"] {`,
				fixedText,
				nonColorText,
				renderPairs(SURFACE_LIGHT),
				renderPairs(light),
				"}",
				`body[data-ds-dark-theme][data-cs-brand="${preset.id}"] {`,
				renderPairs(SURFACE_DARK),
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
		/**
		* 媒体区默认尺寸（真实分辨率尚未就绪时的占位**意图**）。
		*
		* 注意这描述的是**媒体区**，不是节点框 —— 节点框 = 媒体区 + chrome，
		* 由 `frameSizeOf` 换算。改前这个 260×180 是节点框尺寸，加上 48px chrome 后
		* 媒体区只剩 132 高（2:1 的扁条），占位卡片的比例会失真。
		*/
		const DEFAULT_MEDIA_BOX = {
			width: 260,
			height: 180
		};
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
		* 真实分辨率（宽高像素）→ **节点框**尺寸（媒体区 + 镜头条 chrome）。
		*
		* 这是写进 `node.width/height` 的那一个 —— 画布上摆的整张卡。`previewSizeOf`
		* 仍然是「画面本身」的尺寸，两者不可混用：把 `previewSizeOf` 的结果直接写进
		* 节点框，卡片就比画面矮 48px，头/脚会把画面挤掉；反过来把 `frameSizeOf`
		* 的结果当成媒体区，画面就会被放大 48px。
		*/
		function frameSizeOf(media) {
			const box = previewSizeOf(media);
			return {
				width: box.width,
				height: box.height + 48
			};
		}
		/**
		* 节点框尺寸 → **媒体区**尺寸（`frameSizeOf` 的逆运算）。
		*
		* 自然尺寸校正要用它：判「框比例是否偏了」必须比**画面区域**的比例，
		* 拿整张卡（含 48px chrome）的比例去比，任何卡片都会判定为「偏了」，
		* 于是每加载一次媒体就重设一次尺寸 —— 而且是设成错的（把 chrome 算进画面）。
		* 地板取 1 防除零。
		*/
		function mediaBoxOf(frame) {
			return {
				width: Math.max(1, frame.width),
				height: Math.max(1, frame.height - 48)
			};
		}
		/**
		* 节点框默认尺寸 —— 全仓新增节点（生成 / 合成 / 抽帧 / 导入占位）共用同一个出口。
		*
		* **刻意不走 `frameSizeOf(DEFAULT_MEDIA_BOX)`**：`previewSizeOf` 会把长边统一
		* 拉到 `MEDIA_LONG_SIDE`（480）—— 那是「已经知道真实分辨率之后怎么校正」的规则，
		* 不是「还不知道分辨率时摆多大」的规则。用它算占位会把占位卡从 260×180 直接
		* 放大成 480×332，自动布局的 `LAYOUT.stepX/stepY`（300/240）立刻重叠。
		* 占位就是「媒体区照原样 + chrome」，一行加法，语义直白。
		*/
		const DEFAULT_NODE_SIZE = {
			width: DEFAULT_MEDIA_BOX.width,
			height: DEFAULT_MEDIA_BOX.height + 48
		};
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
		//#region src/reference-token.ts
		/** 把上传文件的原始名清洗成合法节点标题：空名兜底 + 去除 [ ]（CR-031）。 */
		function sanitizeTitle(raw, fallback = "本地素材") {
			return (raw.trim() === "" ? fallback : raw).replace(/[[\]]/gu, "");
		}
		/**
		* 在已占用标题集合内生成不重名的节点标题：重名时在扩展名前追加序号
		* （`image.png` → `image 2.png`）。剪贴板粘贴的 File.name 恒为 image.png，
		* 多张重名会让 @ref[token] 无法区分——parseRefTokens 按名去重，同消息里
		* 第二条同名引用会被静默丢弃，agent 拿到的参考就缺图了。生成的新标题会
		* 回写进 used，供同批次后续文件继续去重。
		*/
		function uniqueTitle(raw, used, fallback = "本地素材") {
			const base = sanitizeTitle(raw, fallback);
			if (!used.has(base)) {
				used.add(base);
				return base;
			}
			const dot = base.lastIndexOf(".");
			const stem = dot > 0 ? base.slice(0, dot) : base;
			const ext = dot > 0 ? base.slice(dot) : "";
			for (let i = 2;; i += 1) {
				const candidate = `${stem} ${i}${ext}`;
				if (!used.has(candidate)) {
					used.add(candidate);
					return candidate;
				}
			}
		}
		/**
		* 把引用句柄（优先节点 id）格式化为对话内引用标记。
		*
		* CV-114 起传 node.id；仍兼容任意句柄字符串（旧的 `@ref[标题]`）。
		*/
		function formatRefToken(handle) {
			if (/[[\]]/u.test(handle)) throw new Error("引用句柄包含 [ 或 ]，无法生成 @ref 引用标记，请先重命名该节点");
			return `@ref[${handle}]`;
		}
		//#endregion
		//#region src/reference-handle.ts
		/** 句柄前缀（按类型分道编号，图片/视频序号互不干扰）。 */
		const HANDLE_PREFIX = {
			image: "img",
			video: "vid"
		};
		/** 完整标题的展示截断长度（hover 卡片标题行用）。 */
		const LABEL_MAX = 16;
		/** 超出上限的标题截断成 `前 N 字…`（按 Unicode 码点切，避免切坏 emoji/汉字）。 */
		function truncateLabel(text, max = LABEL_MAX) {
			const chars = [...text];
			if (chars.length <= max) return text;
			return `${chars.slice(0, max - 1).join("")}…`;
		}
		/**
		* 为当前项目的可引用素材派生短句柄（按节点数组顺序 = 创建顺序编号）。
		* 只有 image / video 节点可引用（文本便利贴等没有素材语义）。
		*/
		function buildAssetHandles(nodes) {
			const counters = {
				image: 0,
				video: 0
			};
			const out = [];
			for (const node of nodes) {
				if (node.kind !== "image" && node.kind !== "video") continue;
				counters[node.kind] += 1;
				out.push({
					nodeId: node.id,
					handle: `${HANDLE_PREFIX[node.kind]}-${String(counters[node.kind]).padStart(2, "0")}`,
					kind: node.kind,
					title: node.title ?? "",
					url: node.url ?? null,
					...typeof node.duration === "number" ? { duration: node.duration } : {}
				});
			}
			return out;
		}
		/**
		* 从 chip 上的文本反查素材（hover 浮层用）。
		*
		* chip 文案有四种来源，逐个兜：
		* 1. 我们自己的短句柄 `img-01`（右键插入 / 画布素材源选中）；
		* 2. node id（`@ref[<id>]` 被原样贴进输入框时）；
		* 3. 节点标题（上游 `@` 文件源选中后 label 是文件名，恰好与画布标题同名）；
		* 4. 文件 basename（上游文件源的 label 形如 `d73ea812.png`，与节点 url 末段一致）。
		*
		* 上游文件源（ui-reference）产生的 chip 走的正是 3/4：它不认识画布节点，
		* 但只要这个名字在画布上存在同名素材，就照样能出缩略图。
		*/
		function findAssetByChipText(handles, text) {
			for (const match of text.matchAll(/@?ref\[([^\]]+)\]/giu)) {
				const id = (match[1] ?? "").trim().toLowerCase();
				if (id === "") continue;
				const hit = handles.find((item) => item.nodeId.toLowerCase() === id);
				if (hit !== void 0) return hit;
			}
			const raw = text.trim().toLowerCase();
			if (raw === "") return void 0;
			const key = raw.replace(/^@/u, "");
			const base = key.slice(Math.max(key.lastIndexOf("/"), key.lastIndexOf("\\")) + 1);
			const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
			const urlNames = (url) => {
				const path = url.split(/[?#]/u)[0] ?? url;
				const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
				return name.includes(".") ? [name, name.slice(0, name.lastIndexOf("."))] : [name];
			};
			const titleKey = (title) => title.trim().toLowerCase();
			return handles.find((item) => item.handle.toLowerCase() === key) ?? handles.find((item) => item.nodeId.toLowerCase() === key) ?? handles.find((item) => titleKey(item.title) === key || titleKey(item.title) === base) ?? handles.find((item) => item.url !== null && urlNames(item.url).includes(base)) ?? handles.find((item) => item.url !== null && urlNames(item.url).includes(stem));
		}
		/** 按 query 过滤候选（句柄 / 标题 / 类型都参与匹配，空 query 返回全部）。 */
		function filterAssetHandles(handles, query) {
			const key = query.trim().toLowerCase();
			if (key === "") return [...handles];
			return handles.filter((item) => {
				if (item.handle.toLowerCase().includes(key)) return true;
				if (item.title.toLowerCase().includes(key)) return true;
				return item.kind.toLowerCase().includes(key);
			});
		}
		/** chip 显示文案：`⚡手绘发光动画`（超长按码点截断，空标题落兜底）。 */
		function skillChipLabel(title) {
			const trimmed = title.trim();
			return `⚡${trimmed === "" ? "技能" : truncateLabel(trimmed, 12)}`;
		}
		/** 提交给模型的文本（与「使用」按钮历史注入的纯文本逐字一致，勿改格式）。 */
		function formatSkillToken(name, title) {
			return `使用技能「${title}」（${name}）：`;
		}
		/**
		* 按 chip 文本反查技能（hover 命中）：注册名精确 → 标题精确 → 截断标题前缀。
		* 截断尾是 `…` 时先剥掉再做前缀匹配；前缀至少 2 字防误命中。
		*/
		function findSkillByChipLabel(skills, text) {
			const body = text.trim().replace(/^@?/u, "").replace("⚡", "").trim();
			if (body === "") return void 0;
			const key = body.toLowerCase();
			const stemKey = (body.endsWith("…") ? [...body].slice(0, -1).join("").trim() : body).toLowerCase();
			return skills.find((skill) => skill.name.toLowerCase() === key) ?? skills.find((skill) => skill.title.trim() === body) ?? (stemKey.length >= 2 ? skills.find((skill) => skill.title.trim().toLowerCase().startsWith(stemKey)) : void 0);
		}
		/** `/` 菜单候选过滤（name / title / summary 包含匹配；空 query 返回全量）。 */
		function filterSkillEntries(skills, query) {
			const q = query.trim().toLowerCase();
			if (q === "") return [...skills];
			return skills.filter((skill) => skill.name.toLowerCase().includes(q) || skill.title.toLowerCase().includes(q) || (skill.summary?.toLowerCase().includes(q) ?? false));
		}
		//#endregion
		//#region src/client/reference-source.ts
		/**
		* 触发源名字（occurrence 的 source，也是提交时序列化器的路由键）。
		* 改名会让已插入但未发送的 chip 失去 owner → 渲染成 invalid，勿动。
		*/
		const CANVAS_ASSET_SOURCE = "canvas-asset";
		/** CV-124：技能触发源名字（occurrence 的 source，提交时序列化器的路由键）。 */
		const CANVAS_SKILL_SOURCE = "canvas-skill";
		/** 候选分组标题（与上游「文件 / 会话」区分）。 */
		const ASSET_SECTION = "画布素材";
		/** 技能候选分组标题。 */
		const SKILL_SECTION = "技能";
		/** 输入框 DOM 查询（与 StudioFrame 现有注入路径同一选择器）。 */
		const COMPOSER_INPUT_SELECTOR = ".csConversation textarea, .csConversation [contenteditable=\"true\"], .csConversation input[type=\"text\"]";
		/**
		* 注册 `@` 画布素材源。
		* @returns disposer；上游服务不可用时返回 null（调用方照旧，不注册）。
		*/
		function registerCanvasAssetSource(ctx, deps) {
			const service = ctx.get("inputTriggers");
			if (service === void 0 || typeof service.registerSource !== "function") return null;
			const source = {
				trigger: "@",
				name: CANVAS_ASSET_SOURCE,
				order: -1,
				showGroupTitle: false,
				async candidates(_session, { query }) {
					return filterAssetHandles(deps.assets(), query).map((asset) => {
						const description = asset.title === "" ? void 0 : truncateLabel(asset.title, 24);
						return {
							name: asset.handle,
							hint: asset.kind === "video" ? "视频" : "图片",
							section: ASSET_SECTION,
							value: asset.nodeId,
							...description === void 0 ? {} : { description }
						};
					});
				},
				onPick({ candidate }) {
					const nodeId = candidate.value;
					if (nodeId === void 0) return void 0;
					const asset = deps.assets().find((item) => item.nodeId === nodeId);
					return { insert: {
						source: CANVAS_ASSET_SOURCE,
						ref: nodeId,
						label: asset?.handle ?? candidate.name,
						appearance: "file",
						clipboardText: formatRefToken(nodeId)
					} };
				},
				codec: {
					clipboardText: (ref) => formatRefToken(ref),
					serialize: (ref) => Promise.resolve(formatRefToken(ref))
				}
			};
			try {
				return service.registerSource(source);
			} catch {
				return null;
			}
		}
		/** 注册诊断日志前缀（桌面 devtools 控制台可查）。 */
		const LOG = "[canvas-studio] @ 画布素材源";
		const SKILL_LOG = "[canvas-studio] / 技能源";
		/**
		* 「等服务就绪再注册」的共用骨架（CV-114/123）。
		*
		* 为什么不能直接在 apply 里 `ctx.get('inputTriggers')`：服务读取要求提供方的
		* fiber 已 ACTIVE，而 canvas-studio 的 client apply 常常跑在 ui-input-trigger
		* 之前（roster 顺序 + 我们没声明该依赖）→ 那一刻 get 恒为 undefined，注册被
		* 静默跳过，菜单里自然没有对应分组。上游 ui-reference 就是靠静态声明
		* `inject: ['inputTriggers']` 规避的，这里用等价的运行时写法 `ctx.inject`，
		* 服务一到就注册；再加短轮询兜底，任何一环失灵都能在控制台看到原因。
		*/
		function registerSourceWhenReady(ctx, log, label, tryRegister) {
			let disposed = false;
			let off = null;
			let attempts = 0;
			const attempt = (scope) => {
				attempts += 1;
				const next = tryRegister(scope);
				if (next === null) {
					console.info(`${log}: inputTriggers 不可用（第 ${attempts} 次尝试）`);
					return false;
				}
				off = next;
				console.info(`${log}: 注册成功（第 ${attempts} 次尝试）`);
				return true;
			};
			ctx.inject(["inputTriggers"], (scope) => {
				if (disposed || off !== null) return;
				attempt(scope);
			});
			let tries = 0;
			const timer = setInterval(() => {
				if (disposed || off !== null) {
					clearInterval(timer);
					return;
				}
				tries += 1;
				if (attempt(ctx) || tries >= 8) {
					clearInterval(timer);
					if (off === null) console.info(`${log}: 注册失败 —— 菜单不会出现「${label}」分组`);
				}
			}, 800);
			ctx.effect(() => () => {
				disposed = true;
				clearInterval(timer);
				off?.();
			}, "canvas-studio: 输入框触发源");
		}
		/** 等服务就绪后注册 `@` 画布素材源（调用方唯一入口）。 */
		function registerCanvasAssetSourceWhenReady(ctx, deps) {
			registerSourceWhenReady(ctx, LOG, ASSET_SECTION, (scope) => registerCanvasAssetSource(scope, deps));
		}
		/** 技能目录里找注册名对应的条目（序列化时补人读标题用）。 */
		function skillTitleOf(skills, ref) {
			return skills.find((skill) => skill.name === ref)?.title ?? ref;
		}
		/**
		* CV-124：注册 `/` 技能源——输入框行首打 `/` 弹出技能候选，选中插入 chip
		* （显示 `⚡短标题`，提交时序列化成 `使用技能「标题」（name）：`，与「使用」
		* 按钮历史注入的纯文本逐字一致，agent 侧零改动）。
		* @returns disposer；上游服务不可用时返回 null（调用方照旧，不注册）。
		*/
		function registerCanvasSkillSource(ctx, deps) {
			const service = ctx.get("inputTriggers");
			if (service === void 0 || typeof service.registerSource !== "function") return null;
			const source = {
				trigger: "/",
				name: CANVAS_SKILL_SOURCE,
				showGroupTitle: false,
				async candidates(_session, { query }) {
					return filterSkillEntries(deps.skills(), query).slice(0, 30).map((skill) => ({
						name: skill.title,
						hint: "技能",
						section: SKILL_SECTION,
						value: skill.name,
						...skill.summary === void 0 ? {} : { description: truncateLabel(skill.summary, 30) }
					}));
				},
				onPick({ candidate }) {
					const name = candidate.value;
					if (name === void 0) return void 0;
					const title = skillTitleOf(deps.skills(), name);
					return { insert: {
						source: CANVAS_SKILL_SOURCE,
						ref: name,
						label: skillChipLabel(title),
						clipboardText: formatSkillToken(name, title)
					} };
				},
				codec: {
					clipboardText: (ref) => formatSkillToken(ref, skillTitleOf(deps.skills(), ref)),
					serialize: (ref) => Promise.resolve(formatSkillToken(ref, skillTitleOf(deps.skills(), ref)))
				}
			};
			try {
				return service.registerSource(source);
			} catch {
				return null;
			}
		}
		/** 等服务就绪后注册 `/` 技能源（调用方唯一入口）。 */
		function registerCanvasSkillSourceWhenReady(ctx, deps) {
			registerSourceWhenReady(ctx, SKILL_LOG, SKILL_SECTION, (scope) => registerCanvasSkillSource(scope, deps));
		}
		/** 读取作曲框光标（草稿坐标）；拿不到时返回 null，由调用方追加到末尾。 */
		function composerCaret() {
			const input = document.querySelector(COMPOSER_INPUT_SELECTOR);
			if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return input.selectionStart;
			return null;
		}
		/**
		* 往当前会话输入框插一个 occurrence chip 的共用通道（CV-114/123）。
		*
		* 走 `conversation.input.shell(id).insertReference`：与用户在输入框打 `@`/`/`
		* 选中候选走的是同一条通路，产物（occurrence chip）完全一致。
		* 上游服务缺失 / 会话未绑定 / draftRev CAS 失败 → 返回 false，调用方降级。
		*/
		function insertOccurrence(ctx, sessionId, reference) {
			if (sessionId === void 0) return false;
			try {
				const shell = ctx.get("conversation")?.input?.shell?.(sessionId);
				if (shell === void 0) return false;
				const state = shell.state.getSnapshot();
				const caret = composerCaret();
				const at = caret === null ? state.draft.length : Math.min(Math.max(caret, 0), state.draft.length);
				return shell.insertReference(reference, {
					start: at,
					end: at,
					draftRev: state.draftRev
				}) === true;
			} catch {
				return false;
			}
		}
		/**
		* 把一个画布素材作为**真 chip** 插入当前会话的输入框。
		*/
		function insertAssetChip(ctx, sessionId, asset) {
			return insertOccurrence(ctx, sessionId, {
				source: CANVAS_ASSET_SOURCE,
				ref: asset.nodeId,
				label: asset.handle,
				appearance: "file",
				clipboardText: formatRefToken(asset.nodeId)
			});
		}
		/**
		* CV-124：把一个技能作为**真 chip** 插入当前会话的输入框（「使用」按钮入口）。
		* 显示 `⚡短标题`，提交时序列化成 `使用技能「标题」（name）：`。
		*/
		function insertSkillChip(ctx, sessionId, skill) {
			return insertOccurrence(ctx, sessionId, {
				source: CANVAS_SKILL_SOURCE,
				ref: skill.name,
				label: skillChipLabel(skill.title),
				clipboardText: formatSkillToken(skill.name, skill.title)
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
				summary: "需求澄清 → 剧本创作审批 → 分镜审批 → 关键帧 → 成片的标准串联流程，所有创作的默认规范。",
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
				name: "music-prompt-writing",
				title: "音乐生成提示词",
				summary: "ACE Step 音频写法：Caption / Lyrics 规则、标签字典、参数与元数据边界。",
				category: "prompting",
				icon: "music",
				hue: 322,
				featured: false,
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
				name: "oriental-mythic-visual-director",
				title: "东方异境视觉导演",
				summary: "东方母题与传统纹样转译为自然秩序，电影级绘画写实的神话视觉。",
				category: "style",
				icon: "film",
				hue: 28,
				featured: false,
				stage: "preview"
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
				name: "direct-street-interview-video",
				title: "街拍互动实拍",
				summary: "自然街拍/边走边聊机制：第一人称手持跟随、短对白与街道视差的纪录片能量。",
				category: "style",
				icon: "film",
				hue: 96,
				featured: false,
				demo: "direct-street-interview-video.gif",
				h3: true
			},
			{
				name: "stage-startle-to-truce-encounter",
				title: "惊变求和遭遇",
				summary: "平静观察→不可能贴近→可读惊吓→克制求和的短遭遇战机制，非致命张力收尾。",
				category: "style",
				icon: "film",
				hue: 8,
				featured: false,
				demo: "stage-startle-to-truce-encounter.gif",
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
			image: { ...DEFAULT_NODE_SIZE },
			video: { ...DEFAULT_NODE_SIZE },
			audio: {
				width: 260,
				height: 132
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
			return node.isLoading === true || node.id.startsWith("pending-") || (node.kind === "image" || node.kind === "video" || node.kind === "audio") && node.url === void 0;
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
					/**
					* C1：按 id 集选中（阶段轨道 → 聚焦该阶段产物）。
					*
					* 只保留**当前项目真实存在**的 id：调用方拿的是上一次渲染算出的快照，期间
					* 节点可能已被删除 / 撤销 / 换项目 —— 直接写入会留下幽灵选中项，表现为
					* 「详情面板空着，但画布显示有选中、于是别的操作全落空」。
					*/
					selectNodes: (draft, ids) => {
						if (draft.selectedProjectId === null) return;
						const alive = new Set(nodesOf(draft, draft.selectedProjectId).map((node) => node.id));
						const kept = ids.filter((id) => alive.has(id));
						draft.selectedNodeIds = kept;
						draft.selectedNodeId = kept.length === 1 ? kept[0] : null;
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
					addImportNode: (draft, projectId, url, title, filename, referenceRole = "image", isReference = true, display, contentHash) => {
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
							...contentHash !== void 0 && contentHash.length > 0 ? { contentHash } : {},
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
							...asset.audioComposition !== void 0 ? { audioComposition: asset.audioComposition } : {},
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
/* Presentation follows the official design system: structural / interaction
 * colors come from the --dsw-alias-* semantic tokens owned by
 * @deepseek-ai/dsh-client-ui-theme (imported into the web shell base.css).
 * Those tokens resolve to light or dark values via body[data-ds-dark-theme],
 * so this panel adapts to the app theme automatically.
 *
 * DD-01/DD-02 起是**两层令牌**：宿主语义令牌（文字 / 交互态 / 滚动条）之上，
 * 叠插件自有品牌命名空间 --cs-*（定义在 src/brand.ts，随 body 继承），
 * 承载宿主不表达的概念 —— 制作现场的空间三档（壳 / 画布 / 节点 / 浮层）。
 * 命名空间仍是「语义」而非「色值」：换预设或换明暗主题时令牌自己变，本文件
 * 不出现任何十六进制或 rgb() 字面量。Never hardcode colors or use currentColor. */

.csFrame {
  display: grid;
  /* C9（Q4 拍板：不做断点，改最小窗 + 窄窗降级）：三栏全部弹性化 ——
     宿主允许把窗口拖到 schema 下限（minWidth 可低至 640，默认 900），写死
     280px/480px 会让画布只剩 140px 碎掉。现在窗口收窄时按 minmax 下限收缩：
     200 + 320 + 320 = 840px 是可用下限，再窄由 min-width 兜底横向滚动。
     宽窗口下行为与旧版完全一致（280 / 1fr / 480）。 */
  grid-template-columns: minmax(200px, 280px) minmax(320px, 1fr) minmax(320px, 480px);
  /* C9：比三栏下限之和更窄时允许横向滚动 —— 布局不碎、内容不被裁掉。 */
  min-width: 840px;
  overflow-x: auto;
  height: 100%;
  /* DD-02：壳层 —— 整机最外层底色，与画布拉开一档。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  /* CV-064：lobby ↔ work 切换时列宽平滑过渡。lobby 态保持 3 列（第三列压到
     0px），列数一致才能插值；列数变化会退化成瞬跳。 */
  transition: grid-template-columns var(--cs-duration-slow, 300ms) var(--cs-ease, ease);
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
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：工作流条属于「壳层」的第二档 —— 比工具栏略亮，与画布区分。 */
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csWorkflowMode {
  display: inline-flex;
  /* 顺带修的既有缺陷（不属 DD-02 设计范围，DD-05 仍会整体重做该条）：
     .csWorkflowApproval 带 margin-left:auto，中栏变窄时会把可收缩的模式组一起挤扁，
     按钮文字折成两行（实测中栏 920px 时按钮高 40px = 两行，1100px 起恢复 23px 单行）。
     模式组是固定文案的小控件，不该参与收缩。 */
  flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  overflow: hidden;
}

.csWorkflowMode button {
  padding: 3px 10px;
  font-size: 12px;
  white-space: nowrap;
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
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}

/* DD-05：五阶段行进指示（需求 → 剧本 → 分镜 → 关键帧 → 制作）。
   只有「行进」语义、不可点击 —— 六阶段轨道可跳转需要阶段模型，工程暂无
   （visual-direction-plan 还原度判定）。方块节点读成一格一格的胶片孔。 */
/* C1 / DD-05：六段制作轨道。每段是**可点的 button**（有产物才可点，判定见
   src/workflow-stage.ts 的 idsByStage）——「能点但没有动作」的假按钮比不可点更糟，
   所以无产物的未来段走 :disabled，不做 hover 反馈。
   连接线与圆点承载「行进」语义：已完成段 = 青（落定），当前段 = accent + 脉冲。 */
.csWorkflowStages {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

/* N4（对齐清单 §8.3）：产出计数（设计稿 wfTime）。等宽数字 —— 数字每生成一个
   就跳一格，比例数字会让整段文本随计数左右抖。 */
.csWorkflowTime {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.csStageLink {
  width: 16px;
  height: 1px;
  flex: 0 0 auto;
  background: var(--cs-line, var(--dsw-alias-border-l2));
}

.csStageLink.csStageLinkDone {
  background: color-mix(in srgb, var(--cs-teal, #35C2A6) 50%, transparent);
}

.csWorkflowStage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: var(--cs-radius-pill, 999px);
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    background var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csWorkflowStage:hover:not(:disabled) {
  color: var(--dsw-alias-label-secondary);
  border-color: var(--cs-line, var(--dsw-alias-border-l2));
}

.csWorkflowStage:disabled {
  cursor: default;
  opacity: 0.55;
}

.csWorkflowStage i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
  flex: 0 0 auto;
}

.csWorkflowStage.csStageDone {
  color: var(--dsw-alias-label-secondary);
}

.csWorkflowStage.csStageDone i {
  background: var(--cs-teal, #35C2A6);
}

.csWorkflowStage.csStageNow {
  color: var(--dsw-alias-label-primary);
  background: var(--cs-accent-soft, transparent);
  border-color: color-mix(in srgb, var(--cs-accent, #6c5ce7) 45%, transparent);
}

.csWorkflowStage.csStageNow i {
  background: var(--cs-accent, #6c5ce7);
  animation: csAdvancePulse 1.6s var(--cs-ease, ease) infinite;
}

/* 行进语义（动效三语义契约之一）：当前段圆点向外扩散的脉冲环。 */
@keyframes csAdvancePulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cs-accent, #6c5ce7) 60%, transparent); }
  50% { box-shadow: 0 0 0 5px transparent; }
}

/* DD-05：审批条 = 场记板形态 —— 金色拍板条压左缘、顶缘斜纹待打板，
   体块用壳二档托住；gold = HITL 审批的固定功能色（不随预设切换）。 */
.csWorkflowApproval {
  display: flex;
  /* C9：窄窗下审批元素（图标 / 文案 / 驳回输入 / 双按钮）换行而不是把
     六段轨道挤没 —— 工作流条是横向最脆弱的一行。 */
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  position: relative;
  padding: 5px 10px 5px 12px;
  border-radius: 6px;
  border-left: 3px solid var(--cs-gold, #e8b45a);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 7%, var(--cs-shell-2, var(--dsw-alias-bg-layer-1)));
  /* C5：入场 rise（让位语义 —— 审批请求到达，工作流条把注意力让给它）。
     设计稿 .approval 的原节奏：slow + ease，从上方 6px 沉进来。 */
  animation: csYieldRise var(--cs-duration-slow, 320ms) var(--cs-ease, ease);
}

/* C5：场记板图标 —— 打板动作的载体（设计稿 .clap，26px 金色小方块）。
   条到达后补一记合板，把「该你拍板了」做成看得见的动作，而不是又一行字。 */
.csWorkflowClap {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 14%, transparent);
  color: var(--cs-gold, #e8b45a);
  /* rise 落地一小拍之后合板（420ms 是设计稿 .clap.isHit 的原节奏） */
  animation: csDevelopClapHit 420ms var(--cs-ease, ease) var(--cs-duration-fast, 120ms) both;
}

@media (prefers-reduced-motion: reduce) {
  .csWorkflowApproval,
  .csWorkflowClap {
    animation: none;
  }
}

/* C5：显影语义 —— 打板合板。22% 处张到 -13°、48% 回弹 4°，是场记板「咔」的手感。 */
@keyframes csDevelopClapHit {
  0% { transform: rotate(0); }
  22% { transform: rotate(-13deg); }
  48% { transform: rotate(4deg); }
  100% { transform: rotate(0); }
}

/* C5：让位语义 —— 审批条入场。 */
@keyframes csYieldRise {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

/* 场记板顶缘的打板斜纹：3px 高、gold/透明交替，纯装饰。 */
.csWorkflowApproval::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 6px 6px 0 0;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--cs-gold, #e8b45a) 85%, black) 0 5px,
    transparent 5px 10px
  );
  pointer-events: none;
}

/* DD-05：审批消息走 gold 调（向 label 混 25% 保明暗双轨可读）。 */
.csWorkflowApproval .csWorkflowMessage {
  font-size: 12px;
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 75%, var(--dsw-alias-label-primary));
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

/* DD-05：批准主按钮 = 打板动作，gold 实底 + 深色字（明暗双轨都成立）。 */
.csWorkflowApproval button.csPrimary {
  background: var(--cs-gold, #e8b45a);
  border-color: var(--cs-gold, #e8b45a);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, black);
}

.csWorkflowApproval button.csPrimary:hover {
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 88%, white);
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

/* CV-116：风格已注册但无 GIF 素材时的占位，尺寸与预览图一致以免布局跳动 */
.csStyleDemoFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
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
      /* DD-02：左栏属壳层，与中栏画布拉开明度。 */
      background: var(--cs-shell, var(--dsw-alias-bg-base));
      border-right: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
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
  font-size: var(--cs-fs-lg, 14px);
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
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
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
  /* DD-02：中栏是「制作现场」——整机最暗一档，让节点与浮层浮起来。 */
  background: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
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
  /* DD-02：中栏最暗档，节点与浮层因此「浮」起来。 */
  background-color: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
  /* DD-02 网格：由「两条 1px 直角线」改为**点阵**，并叠出主次两层 ——
     细格 24px 走 --cs-canvas-grid，主格 120px（5 格一跳）走
     --cs-canvas-grid-major。点阵比直角线更弱化网格本身的存在感：直角线在
     大画布上会读成「表格」，点阵则读成「制图台」，节点成为画面主角。
     同时退休 CV-035 的 color-mix 降透明 workaround —— 原实现让网格线与节点
     描边同源（border-l2），只能靠降到 45% 不透明度绕过同色冲突，等于同一件
     事有两套逻辑；现在网格有自己的令牌，绕路直接消失。 */
  background-image:
    radial-gradient(var(--cs-canvas-grid-major, var(--dsw-alias-border-l2)) 1px, transparent 1px),
    radial-gradient(var(--cs-canvas-grid, var(--dsw-alias-border-l2)) 1px, transparent 1px);
  background-size: 120px 120px, 24px 24px;
  background-position: 0 0, 0 0;
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
  /* CR-081：位移走 transform（CanvasNode 用 translate3d 定位），提升为合成层，
     拖拽/微调不触发布局重绘。 */
  will-change: transform;
  /* C10：节点是**三段竖列** —— 头（类型 + 标题）/ 体（画面或正文）/ 脚（读数）。
     改前是「一块内容 + 若干绝对定位角标」：height: 100% 的内容区各自为政，
     角标只能浮在画面之上，压画面、压彼此、被圆角裁掉。改成 flex 列之后，
     头脚各占固定高度、体区吃剩余空间，**重叠在结构上不可能发生**，
     也不需要谁来记「哪个角标归哪个角」。 */
  display: flex;
  flex-direction: column;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：节点是空间三档里**最亮**的一档 —— 高于壳层与画布，形成「浮在
     制图台上」的层次。这是本轮的核心改动：改前 .csFrame / .csCanvas /
     .csCanvasSurface / .csNode 四层全部 background: var(--dsw-alias-bg-base)，
     整界面只靠 1px border-l2 切分，节点读起来像「画在纸上的框」而不是
     「摆在台上的卡」。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  overflow: hidden;
  cursor: grab;
  /* N1（对齐清单 §8.3）：入场显影（显影语义，设计稿 .nd.isNew 的 scale .94→1）。
     只动 transform、**不动 opacity** —— 动画期间 opacity 声明会整体覆盖上面的
     DD-03 乘法链，灰显 / 失效节点入场时会先亮一下再跳回灰，是一次刺眼的闪烁。
     消费时机 = 元素挂载（新卡落画布、切阶段显现），动画只播一次不循环。 */
  animation: csDevelopIn var(--cs-duration-base, 200ms) var(--cs-ease, ease) both;
  box-shadow: var(--cs-shadow-1, 0 1px 4px rgb(0 0 0 / 12%));
  /* DD-03：不透明度**只有一条算式**。三个来源各写各的乘数：
     数据层 --cs-node-opacity（inline，来自 node.opacity）
     状态层 --cs-node-state（locked 0.75 / retired 0.45）
     血缘层 --cs-node-dim（聚光生效时为 --cs-dim）
     为什么要改：改前数据层是把 opacity 直接写在 inline style 上的，inline
     永远赢，于是 .csNodeLocked / .csNodeRetired 的 opacity 一直是**死代码**
     —— CV-108 号称「失效版本灰显」，实际只有 grayscale(1) 生效，透明度从未
     降到 0.45。改成变量链后三层按乘法叠加，语义与代码终于一致。 */
  opacity: calc(var(--cs-node-opacity, 1) * var(--cs-node-state, 1) * var(--cs-node-dim, 1));
  transition:
    background-color var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    border-color var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    opacity var(--cs-duration-base, 200ms) var(--cs-ease, ease);
}

/* N1：显影语义 —— 节点入场。260ms 是设计稿 .nd.isNew 的原节奏，取 base 档 200ms
   走令牌（差 60ms 在体感阈以下，不值得为它开第四个时长档）。
   N1 修复（2026-09-13 真机验收）：必须用**独立 scale 属性**而不是 transform ——
   节点定位就是 inline transform: translate3d(x,y,0)，而 CSS 动画（含 fill both
   的 to 帧）在 cascade 中优先级高于 inline style，写「to 帧把 transform 归零」
   会把定位永久锁死：所有节点锁在画布原点、拖不动，血缘边却按数据坐标画 →
   箭头全部指向虚空。独立 scale 与 transform 是两个属性（最终变换按
   translate → rotate → scale → transform 组合），scale:1 是恒等项，fill 保持
   也不影响定位。 */
@keyframes csDevelopIn {
  from { scale: 0.94; }
  to { scale: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .csNode {
    animation: none;
  }
}

/* DD-03：悬停 = 节点抬高一档（面 + 描边一起亮），是「这张卡是活的」的最短反馈。
   改前 .csNode 没有任何 hover 规则，鼠标扫过整屏卡片毫无回应。 */
.csNode:hover {
  background: var(--cs-node-hi, var(--dsw-alias-bg-base));
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csNode:active {
  cursor: grabbing;
  box-shadow: var(--cs-shadow-2, 0 4px 12px rgb(0 0 0 / 45%));
}

/* DD-03：成片节点（kind=video + toolName=compose）—— 用青（--cs-teal，品牌里
   「播放 / 预览」的功能色）描出一道细边，把「已经拼好的成品」和「待用的素材」
   分开。描边很淡：成片只是一个身份标记，不该比选中态还跳。 */
.csNodeFilm {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 38%, var(--cs-line, transparent));
}

.csNodeFilm:hover {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 60%, var(--cs-line, transparent));
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
/* DD-03：主节点 = 2px 实色环 + 同一枚光晕令牌（不再手抄一遍 box-shadow）。
   改前这里有 4 处硬编码 var(--cs-accent, #6c5ce7) 兜底 —— #6c5ce7 是旧
   预设的紫，四个品牌预设下都在悄悄用错色。现在全部走令牌。 */
.csNodePrimary.csNodeSelected {
  z-index: 3;
  box-shadow:
    0 0 0 2px var(--cs-accent, #6c5ce7),
    var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
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
  border: 2px solid var(--cs-node, var(--dsw-alias-bg-base));
  background: var(--dsw-alias-interactive-bg-active);
  cursor: crosshair;
  z-index: 4;
  opacity: 0;
  transition: opacity var(--cs-duration-fast, 100ms) var(--cs-ease, ease);
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
  /* DD-03：选中光晕收敛到单一令牌 --cs-glow-accent。
     此前它**只在暗色块里定义**（浅色轨完全没有），浅色主题下 var() 一路退到
     空值 → 选中态只剩 border-color 一根 1px 线；而 DD-02 又把「四层同色 + 处处
     描边」拆掉了，于是浅色下「选中」几乎读不出来。现在两条明暗轨都有值。 */
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* DD-03：血缘聚光压暗 —— 见 src/canvas-lineage.ts 的判定口径（唯一实现）。
   只写乘数，不写 opacity，与数据层/状态层相乘而不是互相覆盖。 */
.csNodeDimmed {
  --cs-node-dim: var(--cs-dim, 0.42);
}

.csNodeMedia {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* DD-03：媒体窗口的底色 = **画布最深档**，不是壳层底色。图的四周（letterbox
     或加载中）露出的是「工作台面」而不是「卡片面」，这才是片门该有的读数。 */
  background: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}

/* Images stay inert so node dragging owns every pointer; the video keeps
   native controls (play/seek/volume) interactive. */
img.csNodeMedia {
  pointer-events: none;
}

/* CV-128/130：音频节点卡片（画布就地播放）。节点尺寸 260×132（契约常量
   AUDIO_NODE_WIDTH/HEIGHT）：波形 + 播放/进度 + 歌词摘要 —— 标题行与时长
   C10 起由卡片自己的头/脚承载，卡内不再重复一遍。
   颜色走主题 token，深色/浅色自适应（与 .csNode 一致）。overflow:hidden 是必要的
   ——老项目里还留着更矮的节点，内容超出时不能溢出到其它节点上。 */
.csNodeAudioBox {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-2, 8px) var(--cs-space-3, 12px);
  /* C10：与 .csNodeMediaBox 同理 —— 体区吃剩余空间，不再 height: 100%。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  /* DD-03：跟随节点面（改前是宿主 bg-base，与 .csNode 的 --cs-node 不同源，
     音频卡比旁边的图/视频卡整低一档）。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
}

/* C10：音频卡的**内层标题行已删**（原本是 ♪ + 标题 + 时长）。
   三样东西在卡片头部/脚部各有了正式位置：标题进头部标题槽、
   时长进脚部读数、「这是音频」由头部的 BGM 标签回答。留着内层标题行等于
   同一张卡上写两遍标题 —— 而且内层行会跟着卡片高度一起被压缩变形。 */

.csNodeAudioWave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 22px;
  overflow: hidden;
}

.csNodeAudioBar {
  flex: 1 1 auto;
  min-width: 2px;
  border-radius: 1px;
  background: var(--cs-accent, #6c5ce7);
  transition: opacity 120ms ease;
}

.csNodeAudioControls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csNodeAudioPlay {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--cs-accent, #6c5ce7);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.csNodeAudioPlay:hover {
  filter: brightness(1.08);
}

.csNodeAudioProgress {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
  /* CV-130：进度条可拖动 —— 命中区比 4px 视觉高度大一圈（上下各 5px 隐形
     内边距），否则 4px 的目标根本点不准。 */
  padding: 5px 0;
  margin: -5px 0;
  box-sizing: content-box;
  background-clip: content-box;
  cursor: pointer;
  touch-action: none;
}

.csNodeAudioProgress:hover .csNodeAudioProgressFill {
  filter: brightness(1.15);
}

.csNodeAudioProgressFill {
  height: 100%;
  background: var(--cs-accent, #6c5ce7);
  border-radius: 2px;
  pointer-events: none;
}

/* CV-130：歌词摘要行（卡片只有一行位置，全文在播放器窗口/详情面板）。
   纯器乐时显示「纯器乐 · 无歌词」，两种情况都占位 → 卡片高度不跳动。 */
.csNodeAudioLyrics {
  font-size: 10px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 隐藏的 <audio> 元素：仅作播放引擎，不渲染控件（控件由上面的按钮+进度条自绘）。 */
.csNodeAudioEl {
  display: none;
}

/* 详情面板音频试听控件 + 图层列表音频缩略图。 */
.csDetailAudio {
  width: 100%;
  max-width: 320px;
  height: 32px;
}

.csLayerThumbAudio {
  font-size: 18px;
  color: var(--cs-accent, #6c5ce7);
}

.csNodeText {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-3, 12px);
  /* C10：体区 —— 吃头/脚之外的剩余高度（改前 height: 100%）。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}

/* C2：加载失败卡 —— 卡片里只剩一句说明，居中。
   角标牌面是 inline-flex，在 flex 列里默认被拉伸成满宽，不居中就会读成
   「一行被拉长的字」而不是「这张卡坏了」。 */
.csNodeTextAlert {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.csNodeKind {
  font-size: var(--cs-fs-xs, 11px);
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary);
}

.csNodeBody {
  margin: 0;
  font-size: var(--cs-fs-md, 13px);
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
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-interactive-bg-active));
  border-radius: var(--cs-radius-sm, 4px);
  padding: var(--cs-space-1, 4px) var(--cs-space-2, 8px);
  font: inherit;
  font-size: var(--cs-fs-md, 13px);
  line-height: 1.4;
  background: var(--cs-node, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csTimeline {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：时间轴归壳层 —— 与上方画布拉开一档，读成「台面下的导播条」。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* P9.3 合成工具条：片段计数 + 导出按钮。 */
.csTimelineToolbar {
  display: flex;
  /* C9：窄窗下换行（播放 / 计数 / 预计 / BGM / 显示全部 / 导出），不溢出。 */
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

/* N3（对齐清单 §8.3）：播放/暂停。工具条里的最小按钮 —— 素文 + 边框，不抢
   右侧「合成导出成片」主按钮的戏。 */
.csTimelinePlay {
  flex: 0 0 auto;
  padding: 2px 8px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}

.csTimelinePlay:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.csTimelinePlay:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csTimelineCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* DD-04a：旧「等宽 chip 列表」横向滚动条已由三轨时间轴取代（csTlBody 内自管滚动）。 */

.csTimelineEmpty {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-base);
}

/* ==== DD-04a：真时间轴（标尺 + 三轨 + 可拖播放头） ====
   设计稿 docs/visual-direction-preview.html 的 .tl* 规格落到工程令牌：
   片段宽度 = 真实 duration 比例（src/timeline-layout.ts 唯一权威），
   多轨 = 视频轨 / BGM 轨 / 参考·产物轨。标签列宽 56px 与播放头 left 公式同源。 */
.csTlBody {
  padding: 2px 4px 4px;
}

.csTlLanes {
  position: relative;
}

.csTlRuler {
  position: relative;
  height: 14px;
  margin-left: 56px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  cursor: ew-resize;
}

.csTlTick {
  position: absolute;
  top: 0;
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

.csTlTick::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 3px;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csTlTrack {
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  margin-top: var(--cs-space-1, 4px);
}

.csTlTrkLabel {
  flex: 0 0 56px;
  width: 56px;
  box-sizing: border-box;
  padding-right: 8px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  text-align: right;
  white-space: nowrap;
}

/* 轨道底：用 --cs-line（明暗双轨）做极淡的槽底，不引入新令牌也自动跟主题。 */
.csTlLane {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  border-radius: var(--cs-radius-sm, 6px);
  background: color-mix(in srgb, var(--cs-line, var(--dsw-alias-border-l2)) 22%, transparent);
}

.csTlLaneTall {
  height: 38px;
}

.csTlLaneEmpty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

/* 片段 = 定位容器（left/width 由 timeline-layout 算出的百分比）。
   勾选区是它的兄弟绝对定位元素——兄弟互不穿透，点勾选不触发选中/拖拽。 */
.csTlClipWrap {
  position: absolute;
  top: 3px;
  bottom: 3px;
}

.csTlClip {
  position: absolute;
  inset: 0;
  border-radius: var(--cs-radius-sm, 6px);
  overflow: hidden;
  background: var(--cs-node, var(--dsw-alias-bg-base));
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  cursor: grab;
  transition: border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csTlClip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-node-hi, var(--dsw-alias-bg-base));
}

/* 选中：与画布节点同一份 --cs-glow-accent 光晕（明暗双轨都有定义）。 */
.csTlClipSel {
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* 播放头正压着的片段：teal 行进高亮（teal = 播放 / 预览的固定功能色）。 */
.csTlClipHot {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 70%, transparent);
}

.csTlClipExcluded {
  opacity: 0.4;
}

/* P9.1：拖拽排序的插入落点提示。 */
.csTlClipTarget {
  outline: 2px dashed var(--cs-accent, #6c5ce7);
  outline-offset: 1px;
}

.csTlClipArt {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  pointer-events: none;
}

.csTlClipArt img,
.csTlClipArt video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csTlClipLbl {
  position: absolute;
  left: 5px;
  bottom: 3px;
  max-width: calc(100% - 10px);
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  text-shadow: 0 1px 3px rgb(0 0 0 / 90%);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 片段右缘切点：读成「下一段从这里开始」。 */
.csTlClipCut {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
  pointer-events: none;
}

.csTlClipBgm {
  cursor: pointer;
}

/* C3：BGM 真波形条带（use-waveform.ts 的 WaveBars）。铺在 clip 底层当材料，
   歌名 label 叠其上；条形不接交互（选中/点按是 clip 整体的事）。真包络由
   Host ffmpeg 解码，未就绪时是确定性降级条 —— 两种来源同一套样式。 */
.csWaveBars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  gap: 1px;
  padding: 2px 6px;
  pointer-events: none;
}
.csWaveBars i {
  flex: 1 1 0;
  min-width: 1px;
  border-radius: 1px;
  background: var(--cs-accent, currentColor);
  opacity: 0.3;
}
.csTlClipSel .csWaveBars i {
  opacity: 0.5;
}

.csTlCheck {
  position: absolute;
  top: -6px;
  right: -4px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-node, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}

.csTlCheckOff {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* 参考·产物轨：金色 chip = 素材参考，teal chip = 成片产物（产物 ≠ 素材）。
   文字色向黑混 18%：gold/teal 是固定功能色不分轨，浅色主题下原值对比不足。 */
.csTlRefRow {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  padding: 0 8px;
  overflow-x: auto;
}

.csTlRefChip {
  flex: 0 0 auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 7px;
  font-size: var(--cs-fs-xs, 11px);
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 14%, transparent);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 82%, black);
  border: 1px solid transparent;
  white-space: nowrap;
  cursor: pointer;
}

.csTlRefChip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csTlRefChipFilm {
  background: color-mix(in srgb, var(--cs-teal, #35c2a6) 14%, transparent);
  color: color-mix(in srgb, var(--cs-teal, #35c2a6) 82%, black);
}

/* 失效版本 chip：与画布语义一致——保留可回溯，灰显。 */
.csTlRefChipRetired {
  opacity: 0.55;
  text-decoration: line-through;
}

/* 播放头：纵向贯穿三轨；top 15px = 标尺(14px)下沿起。accent 光晕双轨都有。 */
.csTlPlayhead {
  position: absolute;
  top: 15px;
  bottom: 0;
  width: 1px;
  background: var(--cs-accent, #6c5ce7);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cs-accent, #6c5ce7) 70%, transparent);
  pointer-events: none;
  z-index: 8;
}

.csTlPhGrip {
  position: absolute;
  top: 0;
  left: -4px;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--cs-accent, #6c5ce7);
  cursor: ew-resize;
  pointer-events: auto;
}

/* 预计成片时长（Σ 参与合成的逐镜片段真值；成片产物与失效版本都不计入）。 */
.csTimelineEst {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

/* CV-160：时间轴上有成片产物时的说明（避免「预计时长对不上」的误解）。 */
.csTimelineHint {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csTimelineBgm {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csTimelineBgm select {
  max-width: 180px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  padding: 2px 4px;
}

/* BGM 可能短于成片的 amber 软提示（不拦，服务端守卫兜底报精确差额）。 */
.csTimelineWarn {
  font-size: 12px;
  color: var(--dsw-status-warning-fg, #b8860b);
}

.csTimelineToggleAll {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  white-space: nowrap;
}

.csConversation {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* ---- CV-114：素材 chip 的 hover 缩略图浮层 ----
   chip 画在 composer 的镜像层里（不可交互），卡片是我们自己的元素：
   fixed 定位 + 自身可点，点一下打开大图 / 播放器。 */
.csChipPreview {
  position: fixed;
  z-index: 90;
  transform: translateY(-100%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 10px;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
  cursor: pointer;
  overflow: hidden;
}

.csChipPreviewMedia {
  position: relative;
  width: 100%;
  height: 124px;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
}

.csChipPreviewImage,
.csChipPreviewVideo {
  display: block;
  width: 100%;
  height: 124px;
  object-fit: cover;
  border-radius: 6px;
}

.csChipPreviewEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 124px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.16);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

/* CV-124：技能 chip 的 hover 说明卡（无缩略图概念，图标 + 标题 + 一句话说明）。 */
.csChipPreviewSkill {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 2px;
  color: var(--dsw-alias-label-primary);
}

.csChipPreviewSkill > svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--cs-accent, #7aa2f7);
}

.csChipPreviewSkillBody {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csChipPreviewSummary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.csChipPreviewBadge,
.csChipPreviewDuration {
  position: absolute;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
}

.csChipPreviewBadge {
  left: 6px;
}

.csChipPreviewDuration {
  right: 6px;
}

.csChipPreviewFoot {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.csChipPreviewHandle {
  flex: 0 0 auto;
  color: var(--cs-accent, #7aa2f7);
  font-size: 12px;
  font-weight: 600;
}

.csChipPreviewTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
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
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：工具栏归壳层，与下方画布成形明度落差。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
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
/* DD-03：locked / retired 只写**状态乘数**，由 .csNode 的 calc 统一乘进
   opacity。改前这里写的是 opacity: 0.75，被 CanvasNode 的 inline opacity
   永久压制（inline 永远赢）—— 这两个数字从来没生效过。 */
.csNodeLocked {
  --cs-node-state: 0.75;
  cursor: not-allowed;
}

.csNodeError {
  border-color: var(--dsw-alias-state-error-primary);
}

.csNodeLoading {
  border-style: dashed;
  border-color: var(--cs-line-hi, var(--dsw-alias-interactive-bg-active));
}

/* DD-03：媒体窗口 = 片门。上下各一道 2px 的暗带，把「画面」和「卡片壳」切开
   —— 这是单张卡片看起来像「镜头条」而不是「通用卡片」的关键一笔。
   box-sizing：height:100% 配上下边框，默认 content-box 会把节点撑高 4px 并被
   .csNode 的 overflow:hidden 裁掉底部 2px；border-box 让边框向内吃，画面
   上下各让 2px（对象是 object-fit:cover，读数是「闸门」，不是「画面被裁」）。 */
.csNodeMediaBox {
  position: relative;
  width: 100%;
  /* C10：媒体窗口是**体区** —— 吃头/脚之外的全部剩余高度。
     改前是 height: 100%（占满整张卡）：加头部之后那一份「整张卡」里已经含了
     头脚，100% 就会比实际可用空间高 48px，画面底部被 .csNode 的 overflow 裁掉。
     flex: 1 1 auto + min-height: 0 是 flex 列里「吃掉剩余空间且允许被压缩」的
     标准写法；min-height 若留在 auto，内容的最小尺寸会把卡片顶开。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  border-top: 2px solid var(--cs-gate, #0b0d12);
  border-bottom: 2px solid var(--cs-gate, #0b0d12);
}

/* CV-083 / CV-089：时长（m:ss）与分辨率角标。
   C2：从「媒体框内的绝对定位」并入**底部角标带**（见 .csNodeBadgeBand），
   牌面交回共用规则（--cs-chip-*），这里只留各自不能丢的那一条。搬家的两个理由：
   1. 原先分辨率钉在「媒体框内右下 8px」、音轨构成角标钉在「卡片外右下 8px」，
      两者在视频节点上**互相压住**（实测重叠）；收进同一条带后由 flex 排布，
      重叠在结构上不可能发生。
   2. 媒体框带翻转 transform（node.flipX / node.flipY），挂在它里面的文字会
      跟着镜像 —— 翻转过的视频，时长曾显示成一串反写的数字。角标带挂在卡片上，
      不受翻转影响（画面翻转、读数不翻转，这才是对的）。
   时长数字必须等宽：它每帧都在变（拖播放头 / 播放中），比例数字会让整行左右抖。 */
.csNodeDuration,
.csNodeMediaDims {
  font-variant-numeric: tabular-nums;
}

.csNodeGroup {
  display: flex;
  align-items: flex-start;
  padding: var(--cs-space-2, 8px);
  /* C10：分组卡是唯一**没有**头/脚的节点（它是容器，不是产物），所以这里
     flex: 1 1 auto 直接吃满整张卡 —— 与改前的 height: 100% 等价，
     但统一到同一种写法后，将来给分组加头也不会踩「100% 里含着 chrome」的坑。 */
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  /* DD-03：分组框也跟品牌走 —— 改前是写死的靛蓝 rgb(99 102 241 / 6%)，
     切到琥珀金预设时分组框还是一片紫。 */
  border: 1px dashed color-mix(in srgb, var(--cs-accent, #7c6cff) 45%, transparent);
  border-radius: var(--cs-radius-md, 8px);
  background: color-mix(in srgb, var(--cs-accent, #7c6cff) 7%, transparent);
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

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

/* DD-03：生成中遮罩 —— 改前是 bg-base + opacity .92 的实心板，浅色主题下
   一块白板、深色下一块黑板，都读成「卡片坏了」。现在是一层**主题感知**的
   纱（--cs-scrim），通透度靠颜色本身给，不再靠 opacity 折中。
   C10：遮罩只盖**体区**（top 让开头部）—— 正在显影的是画面，标题与类型标签
   应该一直读得到；顺带把扫描光带关进片门里，跟设计稿的 .ndScan 一致。
   脚部不遮：那是读数，不是画面。 */
.csNodeOverlay {
  position: absolute;
  top: 26px;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--cs-scrim, var(--dsw-alias-bg-base));
}

.csNodeOverlayLabel {
  font-size: var(--cs-fs-sm, 12px);
  /* DD-03：MM:SS 计时每秒都在跳，等宽数字才不会让整行左右晃。 */
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}

/* DD-03：生成中 = **显影扫描光带**（设计稿的 develop 语义），不再是横向进度条。
   进度条说的是「还剩多少」（没人知道），扫描光带说的是「正在显影」（一定成立）。
   DOM 不动（.csNodeProgress 仍是那个 <span>，宿主测试与快照不受影响）：把容器
   变成覆盖整张卡的绝对定位层，把内条变成一道自上而下扫过的渐变光带。 */
.csNodeProgress {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  overflow: hidden;
  background: none;
  pointer-events: none;
}

.csNodeProgressBar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: block;
  width: auto;
  /* 40% 高的光带，在 100% 高的容器里自上而下扫 —— 首尾都停在画面外，
     读者看不到「跳回起点」这一帧。 */
  height: 40%;
  border-radius: 0;
  background: linear-gradient(
    180deg,
    transparent,
    color-mix(in srgb, var(--cs-accent, #7c6cff) 30%, transparent) 50%,
    transparent
  );
  animation: csDevelop 1.6s linear infinite;
}

/* DD-03：显影语义（新内容出现）—— 动效三语义的第一个。
   命名规则：@keyframes 必须归入 develop / advance / yield 其一（守卫断言）。 */
@keyframes csDevelop {
  from { transform: translateY(-110%); }
  to { transform: translateY(360%); }
}

@media (prefers-reduced-motion: reduce) {
  .csNodeProgressBar { animation: none; }
}

/* CV-010：loading 超时（>3 分钟）的可打断提示。 */
.csNodeOverlayHint {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* ======================= C10：节点镜头条（头 / 脚） ======================= */

/* 规格：头 26px / 脚 22px，两个数字来自
   src/canvas-aspect.ts 的 NODE_HEAD_HEIGHT / NODE_FOOT_HEIGHT —— 那里也是
   frameSizeOf 算节点框高度的依据。**在这里写死字面量就会漂移**：常量说 48、
   CSS 实际 52，自然尺寸校正每次加载都把卡片高度改错 4px，而画面上只是
   「看着有点挤」，没有任何报错。（tests/visual-tokens.test.mjs 断言此处是插值。） */

/* ---- 头部：「这是什么产物」 ----
   左：类型标签（剧本 / 分镜 / 关键帧 / 角色 / 成片 …）+ 标题；
   右：身份 chips（版本 / 镜号 / 锁）+ 失效标记。
   为什么值得占掉 26px：卡片从此回答「它是哪一步的什么产物」，而不是「一个框里
   有张图」。媒体的尺寸一点没被挤 —— 高度是**加在卡片上**的（见 frameSizeOf）。 */
.csNodeHead {
  flex: 0 0 auto;
  height: 26px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 6px);
  padding: 0 var(--cs-space-3, 8px);
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* 头部是**实底**：加载遮罩只盖体区，不盖头部（见 .csNodeOverlay）——
     正在显影的是画面，标题应该一直读得到。实底同时保证遮罩不会从缝隙里透出来。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  /* 头部整条都是拖拽面（改前浮动角标必须 pointer-events: none 才能让出起手区，
     实底之后不必再让）。可点的失败角标自己再收回来。 */
  cursor: grab;
}

/* 类型标签（产物名）。材料走 accent-soft / accent 一对令牌：它们在明暗两轨都是
   为「同主题的面」调的（浅色取 accentDeep 系、深色取 accent 系），所以标签在
   两种主题下都读得清，不需要为明暗各写一遍。 */
.csNodeHeadKind {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-hover));
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
  font-size: var(--cs-fs-xs, 11px);
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* 标题。flex: 1 1 auto + min-width: 0 —— 标题是唯一允许被压缩的成员，
   长标题先省略，而不是把右边的身份 chips 挤出卡片。 */
.csNodeHeadTitle {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csNodeHeadChips {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  min-width: 0;
  /* 标题为空（如 BGM 卡：标题就是类型本身）时，身份 chips 仍要靠在右端 ——
     靠标题的 flex: 1 把它推过去是「碰巧」，标题一没就左移了。 */
  margin-left: auto;
}

/* ---- 脚部：读什么数 ----
   左：读数（时长 / 分辨率 / 音轨构成 / 声明时长 / 字数）；右：素材角色（金色书签）。
   读数是**素文**而不是药丸：C2 时它们压在画面上，必须自带墨底才读得清；搬进
   脚部之后底下就是节点面，再给药丸就是无谓的框套框（设计稿的 .ndFoot 也是素文）。 */
.csNodeFoot {
  flex: 0 0 auto;
  height: 22px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 6px);
  padding: 0 var(--cs-space-3, 8px);
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  background: var(--cs-node, var(--dsw-alias-bg-base));
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

.csNodeFootReadings {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 6px);
  min-width: 0;
  overflow: hidden;
}

/* 所有会逐帧变化的数字（时长 / 分辨率 / 字数）共用等宽数字：比例数字会让整行
   随播放时间左右抖 —— 脚部在卡片最下方，抖动会被读成「卡片在动」。 */
.csNodeFootReadings,
.csNodeDuration,
.csNodeMediaDims,
.csNodeChars {
  font-variant-numeric: tabular-nums;
}

/* C10：字数读数（文案卡）。与时长/分辨率同属读数族但**不是秒数** ——
   给它自己的类名，将来想弱化它时不用去动数字族共用的规则。 */
.csNodeChars {
  color: var(--dsw-alias-label-tertiary);
}

/* CV-011：参考图的素材角色 —— 脚部右端的一枚**金色书签**，不占读数的地方。
   金色的明度在浅色主题下压不住白底，所以往当前主题的正文色混一档：混的是
   「明暗方向」而不是色相，四种预设下都仍是金。 */
.csNodeRefBadge {
  margin-left: auto;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  padding: 1px 7px 1px 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, transparent);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 72%, var(--dsw-alias-label-primary));
  font-size: var(--cs-fs-xs, 11px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csNodeRefDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--dsw-alias-border-l3);
}

/* 牌面（头部身份 chips 共用）：版本 / 镜号 / 锁 / 失效 / 音轨构成。
   材料走**宿主交互面**（interactive-bg-hover）而不是自造的墨底 —— 它本来就是
   「当前主题下比卡片面亮一档」的语义，明暗两轨都由宿主保证对比度。
   flex: 0 1 auto + min-width: 0 让长牌面先压缩再省略，而不是被挤出卡片。 */
.csNodeBadge {
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  padding: 1px 6px;
  border-radius: var(--cs-radius-pill, 999px);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 告警牌面（共用）：头部占标题格的那一枚，与「体区整块坏掉」时居中的那一枚。
   同一个外观必须只写一份 —— 否则两处告警会慢慢长成两种红。 */
.csNodeAlert,
.csNodeHeadAlert {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: var(--cs-fs-xs, 11px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 头部里的那一枚 —— 占**标题那一格**（不是浮在卡片上）。放标题槽有三个好处：
   ① 长标题压不掉它（它是 flex: 1 的成员，不会被省略）；
   ② 不遮画面、不遮类型标签；
   ③ 它可点（重试），而整条头部都是拖拽面 —— 占住标题格就不必再和拖拽抢指针。
   配色：错误色直接压宿主交互面。浅色主题的 error primary 是深红、深色主题下
   偏亮，两轨都够对比，所以不再需要往白里混（那是在墨底上才要做的补救）。 */
.csNodeHeadAlert {
  flex: 1 1 auto;
  min-width: 0;
}

/* CV-018：可重试的失败告警 —— 同一牌面 + 可点 affordance。
   用 <button> 是**功能要求**不是排版选择：CanvasNode 的 isInteractiveTarget 靠
   button / input / [contenteditable] 判定「这一下不是拖拽」，换成 span 会让
   点击重试变成「拖走了节点」。 */
button.csNodeHeadAlert {
  cursor: pointer;
  font: inherit;
  font-size: var(--cs-fs-xs, 11px);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
}

button.csNodeHeadAlert:hover {
  background: var(--dsw-alias-state-error-primary);
  color: #fff;
}

/* 角色色点：构图=蓝 / 角色=红 / 风格=紫 / 首末帧=青。 */
.csNodeRefBadge[data-role='image'] .csNodeRefDot { background: #4d9fff; }
.csNodeRefBadge[data-role='character'] .csNodeRefDot { background: #ff6b6b; }
.csNodeRefBadge[data-role='style'] .csNodeRefDot { background: #b58cff; }
.csNodeRefBadge[data-role='frame'] .csNodeRefDot { background: #38c9b8; }

/* C2：锁定角标 = 一个图标位（emoji 自己带宽度，横向留白要比文字角标更紧，
   否则在头部一排里显得比邻座胖一圈）。 */
.csNodeBadgeLock {
  padding: 0 5px;
}

/* CV-108：失效版本（被新版取代 / 已作废）——灰显 + 虚线框，保留在画布上可回溯与恢复。
   注意：样式名用连字符，注释里不要写反引号包围的选择器。 */
.csNodeRetired {
  --cs-node-state: 0.45;
  filter: grayscale(1);
}

.csNodeRetired::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--cs-radius-md, 8px);
  pointer-events: none;
}

/* C2：镜号 chip —— 画布与底部成片时间轴之间的那根线。
   画布上摆的是素材，时间轴上排的是成片顺序；卡片带一个与时间轴同号的镜号，
   扫一眼就知道「这张卡最终排在成片的第几段」。编号口径与时间轴同源（都是
   有效片段序），不是各自数出来的第二个真相。
   C10：材料换成 accent-soft / accent —— 它是头部的**身份**标记，不是读数，
   与类型标签同族但更轻（标签实心、它描边），视觉上分得开。 */
.csNodeShotIdx {
  border: 1px solid color-mix(in srgb, var(--cs-accent, #7c6cff) 40%, transparent);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-hover));
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* DD-03：版本 chip 用 accent 底 —— 版本是「镜头条」的身份标记，
   值得比普通角标高一档的识别度，也把「同一镜位出过几版」摆在明面上。
   C2：镜号与版本合成**同一组身份标记**放头部右端 —— 它们是同一件事的两个维度
   （第几段 / 这段的第几版），分开放会让人以为它们无关。 */
.csNodeBadgeVersion {
  border: 1px solid color-mix(in srgb, var(--cs-accent, #7c6cff) 40%, transparent);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-hover));
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}

/* C10：失效版本标记 —— 划掉它。头部底色是节点面，所以压暗要对**主题正文色**
   做，不能再对已删掉的墨色牌面做（那样在浅色主题下会混成一抹灰）。 */
.csNodeBadgeRetired {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}

/* CV-143：成片音轨构成读数 —— 不用回放听就能确认「环境声有没有被丢、
   BGM 有没有混进去」。单镜保留环境声、多镜全丢是自动策略，用户必须能一眼
   看到结论。C10：落到脚部左侧，与时长 / 分辨率排在一起（它们都是「这段素材
   的读数」）。颜色按构成区分：有环境声=青、无声=错误色 —— 同样是往主题正文色
   混一档拿到可读明度，而不是往白里混（脚部底下是节点面）。
   注意：注释里不要写反引号包围的选择器名。 */
.csNodeAudioMix[data-audio='native'],
.csNodeAudioMix[data-audio='native+bgm'] {
  background: color-mix(in srgb, var(--cs-teal, #35c2a6) 16%, transparent);
  color: color-mix(in srgb, var(--cs-teal, #35c2a6) 72%, var(--dsw-alias-label-primary));
}

.csNodeAudioMix[data-audio='none'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color: var(--dsw-alias-state-error-primary);
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
  /* DD-02：右栏与左栏同属壳层（硬约束：不动右侧对话区结构，只对齐底色）。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  border-left: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
}

/* ---- Floating layer-list overlay (inside the canvas body) ---- */
.csCanvasLayers {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  width: 260px;
  border-radius: var(--cs-radius-lg, 10px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* DD-02：图层浮层与检查器同属最亮档（浮层压节点）。
     C4：玻璃化（Q3 拍板：玻璃只给详情面板 + 这块图层浮层，minimap 不给）。 */
  background: color-mix(in srgb, var(--cs-float, var(--dsw-alias-bg-base)) 82%, transparent);
  backdrop-filter: var(--dsw-mask-blur, 12px);
  /* C5：浮层出现 pop（让位语义 —— 画布让位给面板）。scale 从 .96 起：比位移安全
     （fixed 面板位移会甩出视口边缘），比纯透明「出现感」强。base 档 200ms，快得不挡手。 */
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

@media (prefers-reduced-motion: reduce) {
  .csCanvasLayers {
    animation: none;
  }
}

/* C5：让位语义 —— 浮层出现。 */
@keyframes csYieldPop {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
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

/* 框选退役后的替代品：按类型选择行（下拉 + 反选 + 清除）。 */
.csLayerQuickSelect {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 8px;
}

.csLayerTypeSelect {
  font: inherit;
  font-size: 12px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csLayerQuickSelect .csLayerAction {
  flex: 0 0 auto;
  font-size: 12px;
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
  border-radius: var(--cs-radius-lg, 10px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* DD-02：浮层是最亮档 —— 必须高于节点，否则检查器压在节点上会「糊成一片」。
     C4：玻璃化（Q3 拍板：详情面板 + 图层浮层两处；minimap 常驻可见、背后多是
     空画布，blur 的收益最低，刻意不给 —— 模糊是合成开销，只给真正压着内容的浮层）。 */
  background: color-mix(in srgb, var(--cs-float, var(--dsw-alias-bg-base)) 82%, transparent);
  backdrop-filter: var(--dsw-mask-blur, 12px);
  /* C5：浮层出现 pop，与图层浮层同一词汇（见 .csCanvasLayers 处的说明）。 */
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
  overflow: hidden;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

@media (prefers-reduced-motion: reduce) {
  .csDetailPanel,
  .csErrorCard {
    animation: none;
  }
}

/* C4：blur 不可用时的兜底。半透明底一旦没有模糊配合，会直接透出底下的节点，
   可读性比不玻璃更差 —— 所以必须成对给。支持 backdrop-filter 的浏览器不命中这条。 */
@supports not (backdrop-filter: blur(2px)) {
  .csDetailPanel,
  .csCanvasLayers {
    background: var(--cs-float, var(--dsw-alias-bg-base));
  }
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
  /* DD-05：入场动效接动效令牌（行进语义 csToastIn，白名单已归位）。 */
  animation: csToastIn var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
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

/* ---- CV-099：新建项目预置规格（画幅 / 目标时长）---- */
/* 规格行：下拉 + 自定义秒数输入（仅选中「自定义」时出现输入框）。 */
.csPlanRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csPlanRow .csFieldSelect {
  flex: 1 1 auto;
  min-width: 0;
}

.csPlanRow .csFieldInput {
  flex: 0 0 96px;
}

/* 字段下方的弱化说明（如 1:1 不支持视频的提示）。 */
.csFieldHint {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
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

/* ===== CV-130：音频播放器窗口（双击音频节点打开） ===== */

/* 卡片宽 560，高度受自适应（歌词多时内部滚动，窗口本身不无限长）。 */
.csAudioModalCard {
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
}

/* 舞台：音频没有画面，让位给歌词 / 波形。固定高度让「有词/无词」两种形态
   尺寸一致，切换节点时不跳。 */
.csAudioStage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  max-height: calc(100vh - 260px);
  padding: 20px 24px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  overflow: hidden;
}

/* 纯器乐：波形（进度按条数点亮，与卡片同一套语义）。 */
.csAudioStageWave {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 140px;
}

.csAudioStageBar {
  flex: 1 1 auto;
  min-width: 2px;
  border-radius: 2px;
  background: var(--cs-accent, #6c5ce7);
  transition: opacity 120ms ease;
}

/* 有歌词：逐行铺开，长词可滚动（overflow-y auto + overscroll 阻断）。 */
.csAudioStageLyrics {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  text-align: center;
  cursor: text;
}

.csAudioLyricLine {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--dsw-alias-label-primary);
}

/* 结构标记（[Verse] / [Chorus - anthemic]）：弱化成小号灰字，不当正文读。 */
.csAudioLyricMarker {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}

/* 空行分隔（段落边界）：保留高度，让歌词段落感不丢。 */
.csAudioLyricGap {
  display: block;
  height: 8px;
}

/* 详情面板里的歌词全文（复用 csDetailPrompt 排版，额外给最大高度避免刷屏）。 */
.csDetailLyrics {
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  padding: var(--cs-space-6, 32px);
  /* DD-06：accent-soft 主光晕 + accent-deep 底部余晖（顺带接线空转的 deep）。 */
  background:
    radial-gradient(60% 50% at 50% 40%, var(--cs-accent-soft, transparent), transparent 70%),
    radial-gradient(45% 35% at 50% 88%, var(--cs-accent-deep, transparent), transparent 72%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csWelcomeCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cs-space-3, 12px);
  max-width: 460px;
  text-align: center;
  padding: var(--cs-space-6, 32px) var(--cs-space-7, 48px);
  border-radius: var(--cs-radius-lg, 12px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-06：欢迎卡浮在画布上 —— 用浮层令牌 + 三级阴影。 */
  background: var(--cs-float, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--cs-shadow-3, none);
}
.csWelcomeTitle {
  margin: 0;
  font-size: var(--cs-fs-2xl, 24px);
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csWelcomeNameZh {
  margin-left: var(--cs-space-2, 8px);
  font-size: var(--cs-fs-lg, 14px);
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomeTagline {
  margin: 0;
  font-size: var(--cs-fs-md, 13px);
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomePositioning {
  margin: 0;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}
.csWelcomeActions {
  display: flex;
  gap: var(--cs-space-3, 12px);
  margin-top: var(--cs-space-2, 8px);
}
.csWelcomeActions button {
  padding: 7px var(--cs-space-4, 16px);
  font-size: var(--cs-fs-md, 13px);
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
  margin: var(--cs-space-1, 4px) 0 0;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* CV-064：Lobby 态中栏顶部品牌条（横向紧凑版，与下方居中的聊天卡片配套）。
   与 .csWelcome*（整屏欢迎卡）分开：后者会把聊天挤出视口。 */
.csLobbyHero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cs-space-5, 24px);
  padding: var(--cs-space-5, 24px) var(--cs-space-6, 32px) var(--cs-space-4, 16px);
  /* C7「未开拍的现场」（DD-06）：lobby 态画布隐藏，hero 就是首屏主体 ——
     直接借用画布的制图台语言：L1 底色（**自然消费 --cs-canvas-bg-l1**，
     D3 空转令牌就此退役）+ 与 .csCanvasSurface 同参数的双层点阵（120 主格 /
     24 细格）+ 一束自顶洒下的低透明度 accent 光晕。层序：光晕最上、主格、细格，
     光落在点阵上而不是点阵压住光。 */
  background-color: var(--cs-canvas-bg-l1, var(--dsw-alias-bg-base));
  background-image:
    radial-gradient(70% 130% at 50% 0%, var(--cs-accent-soft, transparent), transparent 70%),
    radial-gradient(var(--cs-canvas-grid-major, var(--dsw-alias-border-l2)) 1px, transparent 1px),
    radial-gradient(var(--cs-canvas-grid, var(--dsw-alias-border-l2)) 1px, transparent 1px);
  background-size: 100% 100%, 120px 120px, 24px 24px;
  background-position: 0 0, 0 0, 0 0;
  background-repeat: no-repeat, repeat, repeat;
}
.csLobbyBrand {
  display: flex;
  align-items: center;
  gap: var(--cs-space-4, 16px);
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
  font-size: var(--cs-fs-xl, 18px);
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csLobbyNameZh {
  margin-left: var(--cs-space-2, 8px);
  font-size: var(--cs-fs-md, 13px);
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyTagline {
  margin: 0;
  font-size: var(--cs-fs-sm, 12px);
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyHint {
  margin: var(--cs-space-1, 4px) 0 0;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}
.csLobbyActions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--cs-space-2, 8px);
}
.csLobbyButtons {
  display: flex;
  gap: var(--cs-space-3, 12px);
}
.csLobbyActions button {
  padding: 7px var(--cs-space-4, 16px);
  font-size: var(--cs-fs-md, 13px);
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
  font-size: var(--cs-fs-xs, 11px);
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

/* C8（DD-06）：空画布「预演」—— 幽灵流水线（分镜 → 定妆 → 镜头 → 成片）。
   极淡材料：虚线胶囊 + 虚线连接线，终点「成片」用 accent-soft 微光收束。
   静态不挂动画 —— 预演是常驻的舞台指示，不该每次清空画布都闪一遍。 */
.csGhostPipeline {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--cs-space-2, 8px);
  margin-top: var(--cs-space-3, 12px);
}
.csGhostNode {
  padding: 3px 12px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  border: 1px dashed var(--cs-line, var(--dsw-alias-border-l2));
  border-radius: 999px;
  background: var(--cs-accent-soft, transparent);
}
.csGhostLink {
  width: 26px;
  border-top: 1px dashed var(--cs-line, var(--dsw-alias-border-l2));
}
.csGhostNodeFinal {
  border-style: solid;
  border-color: color-mix(in srgb, var(--cs-accent, transparent) 45%, transparent);
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
  /* C8：错误卡出现走浮层词汇 pop（与详情面板 / 图层浮层一致）。 */
  animation: csYieldPop var(--cs-duration-base, 200ms) var(--cs-ease, ease);
}
/* C8 三级视觉分级：左缘 3px 色条 + 标题色随级走，梯度 = 越严重越往宿主错误色靠。
   可重试 = accent（中性、可行动）；缺配置 = gold（缺料、要去拍板）；服务不可达 =
   宿主错误色（真故障，重）。左缘条语言与审批条的 gold 拍板条同源。 */
.csErrorKindRetryable {
  border-left: 3px solid var(--cs-accent, var(--dsw-alias-state-error-border));
}
.csErrorKindRetryable .csErrorTitle {
  color: var(--cs-accent, var(--dsw-alias-state-error-primary));
}
.csErrorKindConfig {
  border-left: 3px solid var(--cs-gold, var(--dsw-alias-state-error-border));
}
.csErrorKindConfig .csErrorTitle {
  color: var(--cs-gold, var(--dsw-alias-state-error-primary));
}
.csErrorKindUnreachable {
  border-left: 3px solid var(--dsw-alias-state-error-primary, var(--dsw-alias-state-error-border));
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
  padding: var(--cs-space-1, 4px) var(--cs-space-5, 24px) var(--cs-space-4, 16px);
  overflow: hidden;
}
.csLobbyTailHead {
  display: flex;
  align-items: baseline;
  gap: var(--cs-space-3, 12px);
  margin-bottom: var(--cs-space-2, 8px);
}
.csLobbyTailHead > span:first-child {
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csLobbyTailHint {
  font-size: var(--cs-fs-xs, 11px);
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

/* CV-118 语义修订（2026-09-09）：试跑期角标（卡片右上 absolute；弹窗标题内 static）。 */
.csSkillPreviewBadge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgb(128 128 128 / 30%)) 88%, transparent);
  border: 1px solid var(--dsw-alias-border-l2);
  pointer-events: none;
}
.csSkillDetailTitle .csSkillPreviewBadge {
  position: static;
  align-self: center;
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
  position: relative;
  flex-shrink: 0;
  width: 132px;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  color: rgb(255 255 255 / 92%);
}
/* CV-112：详情弹窗缩略图 GIF（与卡片默认显示的 csSkillThumbGif 一致——盖在渐变上）。 */
.csSkillDetailThumbGif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .csSkillDetailThumbGif {
    display: none;
  }
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
		/** 幽灵流水线站点（DD-06：分镜 → 定妆 → 镜头 → 成片，静态极淡预演）。 */
		const GHOST_PIPELINE_STAGES = [
			"分镜",
			"定妆",
			"镜头",
			"成片"
		];
		/** 有项目但画布无节点：画布中心引导卡（pointer-events none，不挡画布交互）。 */
		function CanvasEmptyHint() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csCanvasEmptyHint",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csCanvasEmptyHintTitle",
						children: EMPTY_COPY.canvasEmptyTitle
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "csCanvasEmptyHintText",
						children: EMPTY_COPY.canvasEmptyHint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csGhostPipeline",
						"aria-hidden": "true",
						children: GHOST_PIPELINE_STAGES.map((stage, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [i > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csGhostLink" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: i === GHOST_PIPELINE_STAGES.length - 1 ? "csGhostNode csGhostNodeFinal" : "csGhostNode",
							children: stage
						})] }, stage))
					})
				]
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
		/** 错误三级处置卡。C8：kind 映射到视觉分级（左缘色条 + 标题色 + 主按钮切换）。 */
		function StudioErrorState(props) {
			const { message, onRetry, onOpenSettings } = props;
			const kind = classifyStudioError(message);
			const isConfig = kind === "config";
			const isUnreachable = kind === "unreachable";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `csErrorCard ${isConfig ? "csErrorKindConfig" : isUnreachable ? "csErrorKindUnreachable" : "csErrorKindRetryable"}`,
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
							className: "csErrorAction csErrorActionPrimary",
							onClick: onOpenSettings,
							children: ERROR_COPY.openSettings
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: isConfig && onOpenSettings !== void 0 ? "csErrorAction" : "csErrorAction csErrorActionPrimary",
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
		/** CV-099：目标时长下拉的预设档位（秒）；另可自定义。 */
		const DURATION_PRESETS = [
			15,
			30,
			60
		];
		/** CV-099：时长下拉的「自定义」哨兵值（选中后展示数字输入框）。 */
		const DURATION_CUSTOM = "custom";
		/** CV-099：画幅候选项（value 为空串 = 不锁定，沿用旧行为）。 */
		const ASPECT_OPTIONS = [
			{
				value: "",
				label: "不锁定（由 AI 确认）"
			},
			{
				value: "16:9",
				label: "16:9 横屏"
			},
			{
				value: "9:16",
				label: "9:16 竖屏"
			},
			{
				value: "1:1",
				label: "1:1 方形（仅图片）"
			}
		];
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
			const [createAspect, setCreateAspect] = (0, react.useState)("");
			const [createDuration, setCreateDuration] = (0, react.useState)("");
			const [createDurationCustom, setCreateDurationCustom] = (0, react.useState)("");
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
			const resetPlanDraft = () => {
				setCreateAspect("");
				setCreateDuration("");
				setCreateDurationCustom("");
			};
			const openCreateModal = (groupId) => {
				setCreateModalGroupId(groupId);
				setCreateName("");
				setCreateError(null);
				resetPlanDraft();
				setCreateModalOpen(true);
			};
			const closeCreateModal = () => {
				setCreateModalOpen(false);
				setCreateName("");
				setCreateError(null);
				resetPlanDraft();
				onCreateOpenChange(false);
			};
			(0, react.useEffect)(() => {
				if (createOpen) {
					setCreateModalGroupId(null);
					setCreateName("");
					setCreateError(null);
					resetPlanDraft();
					setCreateModalOpen(true);
				}
			}, [createOpen]);
			const buildPlan = () => {
				const plan = {};
				if (createAspect !== "") plan.aspectRatio = createAspect;
				const seconds = Number.parseInt(createDuration === DURATION_CUSTOM ? createDurationCustom : createDuration, 10);
				if (Number.isFinite(seconds) && seconds > 0) plan.targetDuration = Math.min(300, seconds);
				return plan.aspectRatio === void 0 && plan.targetDuration === void 0 ? void 0 : plan;
			};
			const submitCreate = async () => {
				const name = createName.trim();
				if (name.length === 0 || creating) return;
				setCreateError(null);
				try {
					await onCreate(name, createModalGroupId, buildPlan());
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "csField",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
													className: "csFieldLabel",
													htmlFor: "cs-create-aspect",
													children: "画幅"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
													id: "cs-create-aspect",
													className: "csFieldSelect",
													value: createAspect,
													disabled: creating,
													onChange: (event) => {
														setCreateAspect(event.target.value);
													},
													children: ASPECT_OPTIONS.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: option.value,
														children: option.label
													}, option.value))
												}),
												createAspect === "1:1" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: "csFieldHint",
													children: "1:1 仅图片工具支持，生成视频时会自动降级为 16:9。"
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "csField",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
												className: "csFieldLabel",
												htmlFor: "cs-create-duration",
												children: "目标时长"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "csPlanRow",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
													id: "cs-create-duration",
													className: "csFieldSelect",
													value: createDuration,
													disabled: creating,
													onChange: (event) => {
														setCreateDuration(event.target.value);
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: "",
															children: "不锁定（由 AI 确认）"
														}),
														DURATION_PRESETS.map((seconds) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
															value: String(seconds),
															children: [seconds, " 秒"]
														}, seconds)),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
															value: DURATION_CUSTOM,
															children: "自定义…"
														})
													]
												}), createDuration === DURATION_CUSTOM && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													className: "csFieldInput",
													type: "number",
													min: 1,
													max: 300,
													placeholder: "秒",
													value: createDurationCustom,
													disabled: creating,
													onChange: (event) => {
														setCreateDurationCustom(event.target.value);
													}
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
			if (node.kind !== "image" && node.kind !== "video" && node.kind !== "audio") return false;
			return typeof node.url === "string" && node.url.length > 0;
		}
		/** 各节点类型的产物扩展名（`assetDownloadName` 兜底补后缀用）。 */
		const ASSET_EXTENSION = {
			image: ".png",
			video: ".mp4",
			audio: ".mp3"
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
		//#region src/canvas-lineage.ts
		/**
		* 计算选中集的血缘聚光。
		*
		* 为什么「没有血缘就不压暗」：压暗是一种**对比手段** —— 它的作用是把血缘
		* 从背景里显出来。选中一张孤立节点（既没引用谁、也没被谁引用）时，压暗只
		* 会把整屏压灰而**揭示不了任何关系**，用户看到的是"画面突然变暗"。故此处
		* 只在「确有血缘可看」时置 active。这条规则同时挡住了最刺眼的场景：刚导入
		* 素材、还没连线时随手点一下卡片，全屏变灰。
		*
		* @param nodes 画布上的全部节点（调用方传可见节点；隐藏节点不参与，否则
		*              会点亮画布上根本看不见的节点 id）。
		* @param selectedIds 当前选中集。
		*/
		function canvasSpotlight(nodes, selectedIds) {
			const present = new Set(nodes.map((node) => node.id));
			const selected = new Set(selectedIds.filter((id) => present.has(id)));
			const lit = new Set(selected);
			if (selected.size === 0) return {
				active: false,
				lit
			};
			for (const node of nodes) {
				if (selected.has(node.id)) {
					for (const sourceId of node.sourceIds) if (present.has(sourceId)) lit.add(sourceId);
					continue;
				}
				if (node.sourceIds.some((sourceId) => selected.has(sourceId))) lit.add(node.id);
			}
			return {
				active: lit.size > selected.size,
				lit
			};
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
			audio: "音频",
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
			"video-composite": "视频合成",
			"text-to-audio": "BGM 生成"
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
			"video-composite": "#a855f7",
			"text-to-audio": "#f43f5e"
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
		//#endregion
		//#region src/shot-versions.ts
		/** 节点状态判定（有效 = 未被取代且未手动作废）。 */
		function shotStatusOf(node) {
			if (node.retired === true) return "retired";
			if (node.supersededBy !== void 0) return "superseded";
			return "active";
		}
		/** 是否参与默认合成的「有效」节点。 */
		function isActiveShot(node) {
			return shotStatusOf(node) === "active";
		}
		/**
		* 合成产物（成片）判定：`kind='video'` 但 `toolName='compose'`。
		*
		* 成片是**产物**不是**素材**——它由若干片段拼出来，若再被当成片段参与时长
		* 估算 / 下一次合成，就会出现「成片把自己再拼一遍」的递归叠加，预计时长也
		* 会凭空多出一整部成片的长度（CV-160：实测预期 15.51s 被算成 30.99s）。
		*/
		function isComposeProduct(node) {
			return node.kind === "video" && node.toolName === "compose";
		}
		/**
		* 「逐镜片段」判定——**全仓唯一权威口径**。
		*
		* 视频素材（video_generate / video_composite 产物）+ 存活版本（未被取代、未作废），
		* 且排除成片节点。此前该规则在 `defaultComposeClips`（Host 缺省选片）、时间轴
		* 预计时长、右键菜单三处各写一份，CV-006/007 新增的选择层漏了「非成片」一条，
		* 直接导致成片被重复计入时长并递归叠加（CV-160）。任何新消费方都必须复用本函数，
		* 不得再内联 `kind === 'video'` 自行判片段。
		*/
		function isShotClip(node) {
			return node.kind === "video" && !isComposeProduct(node) && isActiveShot(node);
		}
		/**
		* 作废 / 恢复（画布右键用，纯函数）。
		*
		* - 有效节点 → 置 `retired: true`；
		* - 失效节点 → 清除 `retired` 与 `supersededBy` 复活，**并把接管它的那个节点
		*   作废**，保证同一镜位始终只有一份有效（避免恢复后成片里出现两份同镜）。
		*/
		function toggleRetire(nodes, id) {
			const target = nodes.find((node) => node.id === id);
			if (target === void 0) return [...nodes];
			if (isActiveShot(target)) return nodes.map((node) => node.id === id ? {
				...node,
				retired: true
			} : node);
			const takerId = target.supersededBy;
			return nodes.map((node) => {
				if (node.id === id) {
					const { retired: _retired, supersededBy: _supersededBy, ...rest } = node;
					return rest;
				}
				if (takerId !== void 0 && node.id === takerId) return {
					...node,
					retired: true
				};
				return node;
			});
		}
		//#endregion
		//#region src/workflow-stage.ts
		/** 六段展示名（顺序即阶段序）。 */
		const WORKFLOW_STAGE_LABELS = [
			"剧本",
			"分镜",
			"定妆",
			"关键帧",
			"镜头",
			"成片"
		];
		const WORKFLOW_STAGE_COUNT = WORKFLOW_STAGE_LABELS.length;
		/**
		* `workflow.state` 给出的**地板值**（即「至少走到哪」）。
		*
		* 注意 `script_review` 的地板是 0 而不是 1：它的含义是「剧本已提交、**待批准**」，
		* 也就是我们正**站在剧本阶段**等确认，而不是已经进了分镜。同理 `awaiting_approval`
		* 是站在分镜阶段（1）。把「待批准」误读成「已完成」会让轨道抢跑一格。
		*/
		const STATE_FLOOR = {
			drafting: 0,
			script_review: 0,
			awaiting_approval: 1,
			keyframe_review: 3,
			executing: 4
		};
		/** 待批准态 —— 决定审批条显隐（与阶段派生无关，随 state 走）。 */
		const APPROVAL_STATES = /* @__PURE__ */ new Set([
			"script_review",
			"awaiting_approval",
			"keyframe_review"
		]);
		/**
		* 图片类产物的 `operationType` → 阶段。
		*
		* 只收**制作产物**。`import` / `drawing` 不在表内 —— 手动导入的素材不属于任何
		* 制作阶段（它没有「被哪一步做出来」这回事），硬塞进某一段会让轨道虚报进度。
		* 注意 `import` 同时是剧本卡（`user_brief`）的 operationType，所以那一类必须靠
		* `toolName` 判，不能靠 operationType（见 `stageOfNode`）。
		*/
		const OPERATION_STAGE = {
			storyboard: 1,
			"storyboard-split": 1,
			"character-sheet": 2,
			"scene-concept": 2,
			"text-to-image": 3,
			"image-to-image": 3,
			variant: 3,
			expand: 3,
			"style-transfer": 3,
			"background-replace": 3,
			"background-remove": 3,
			"text-to-video": 4,
			"image-to-video": 4,
			"mkr-video": 4,
			"video-clip": 4,
			"video-composite": 4,
			"text-to-audio": 4
		};
		/**
		* 单个节点归属哪个阶段。`null` = 不属于任何制作阶段（便签 / 文案 / 导入素材 /
		* 分组节点）。这类节点不参与进度判定，也不会被「点阶段 → 聚焦产物」选中。
		*
		* 判定优先级（从强到弱）：
		* 1. **成片** —— `isComposeProduct`（全仓唯一口径）。成片是终点产物，压过一切。
		* 2. **剧本卡** —— `toolName === BRIEF_NODE_TOOL`。必须排在 operationType 之前，
		*    因为剧本卡的 operationType 是 `import`（与手动导入同值）。
		* 3. **视频类** —— 非成片的 `kind === 'video'` 一律算镜头。不查 operationType：
		*    视频端点会随供应商增加（H3 就换过两轮），逐个列举迟早漏一个，而「画布上
		*    能播的片段 = 镜头段产物」这个语义不会漏。
		* 4. **图片类** —— 查 `OPERATION_STAGE`。
		*/
		function stageOfNode(node) {
			if (isComposeProduct(node)) return 5;
			if (node.toolName === "user_brief") return 0;
			if (node.kind === "video") return 4;
			if (node.kind !== "image") return null;
			return (node.operationType === void 0 ? void 0 : OPERATION_STAGE[node.operationType]) ?? null;
		}
		/**
		* C10：节点头部要显示的**产物名** —— 六段的细分，不是第二套阶段模型。
		*
		* 六段名是为**轨道**（一条横轴上六个刻度）取的，一格一个词；卡片头部问的是
		* 另一个问题：「这一步做出来的**东西**叫什么」。两者大多同字（剧本 / 分镜 /
		* 关键帧 / 成片），但有两处必须分开，否则卡片会说谎：
		*
		* - `定妆` 是一格，格里的产物是**角色**或**场景**两种卡。标成「定妆」等于把
		*   两种东西压成一个词，用户看卡面认不出这是角色表还是场景图。
		* - `镜头` 是一格，格里的产物是**片段**，还可能是并行产出的 **BGM**。
		*
		* 因此本表**只收与阶段名不同字的那几个**，其余交给 `WORKFLOW_STAGE_LABELS`
		* 兜底 —— 不抄一份全表，就不会出现「轨道改了名、卡片没跟着改」。
		*
		* 未进表但在 `OPERATION_STAGE` 里的（`text-to-image` 等）走阶段名兜底 = 关键帧。
		*/
		const OPERATION_PRODUCT = {
			"character-sheet": "角色",
			"scene-concept": "场景",
			"video-clip": "片段",
			"text-to-audio": "BGM"
		};
		/** 与阶段无关的产物名（模板 / 手动素材）。 */
		const KIND_PRODUCT = {
			sticky: "便签",
			text: "文本",
			prompt: "提示",
			group: "分组",
			audio: "BGM"
		};
		/**
		* C10：单个节点在卡片头部显示的产物名（简称「类型」）。
		*
		* 判定优先级（从强到弱）——**与 `stageOfNode` 逐条对齐**，两者若给出互相矛盾的
		* 答案（比如 `stageOfNode` 说这是剧本段、头部却写着「文本」），阶段轨道与卡片
		* 就会各说各话。所以这里复用同一个 `isComposeProduct` / `BRIEF_NODE_TOOL` 判据，
		* 而不是另写一遍。
		*
		* 1. 成片 —— `isComposeProduct`（全仓唯一口径），压过一切。
		* 2. 剧本卡 —— `toolName === BRIEF_NODE_TOOL`。必须排在 operationType 之前：
		*    剧本卡的 operationType 是 `import`，与手动导入素材同值。
		* 3. `OPERATION_PRODUCT` —— 与阶段名不同字的产物（角色 / 场景 / 片段 / BGM）。
		* 4. 音频 —— 没有 operationType 的音频节点仍是 BGM（工具生成路径都会写，但
		*    历史节点与手动落卡不保证）。
		* 5. 视频 —— 非成片的视频一律「片段」（与 `stageOfNode` 的「不查 operationType」
		*    同一理由：端点会随供应商换，逐个列举迟早漏一个）。
		* 6. 参考图 —— 标记为参考的素材。
		* 7. 导入 —— 手动素材（`import` 同时是剧本卡的值，故只能排在第 2 条之后）。
		* 8. 阶段名兜底 —— `WORKFLOW_STAGE_LABELS[stage]`。
		* 9. `KIND_PRODUCT` —— 便签 / 文本 / 提示 / 分组。
		*
		* 返回 `null` = 交调用方兜底（目前只有 `kind: 'image'` 且没有任何判据命中的
		* 裸图片节点，客户端用 `KIND_LABEL` 显示「图片」）。
		*/
		function productLabelOf(node) {
			if (isComposeProduct(node)) return WORKFLOW_STAGE_LABELS[5];
			if (node.toolName === "user_brief") return WORKFLOW_STAGE_LABELS[0];
			const byOperation = node.operationType === void 0 ? void 0 : OPERATION_PRODUCT[node.operationType];
			if (byOperation !== void 0) return byOperation;
			if (node.kind === "audio") return KIND_PRODUCT.audio ?? null;
			if (node.kind === "video") return "片段";
			if (node.isReference === true) return "参考";
			if (node.operationType === "import") return "导入";
			const stage = stageOfNode(node);
			if (stage !== null) return WORKFLOW_STAGE_LABELS[stage] ?? null;
			return KIND_PRODUCT[node.kind] ?? null;
		}
		/**
		* 派生当前阶段 + 每阶段产物索引。
		*
		* **已作废 / 被取代的节点照常计入**（它们仍是那一步的产物，聚焦时看到灰显卡片
		* 是有信息量的）；**不可见节点也计入** —— 「看不见」是显隐开关，不是「没做过」。
		*/
		function deriveWorkflowStage(state, nodes) {
			const buckets = WORKFLOW_STAGE_LABELS.map(() => []);
			let evidence = 0;
			for (const node of nodes) {
				const stage = stageOfNode(node);
				if (stage === null) continue;
				buckets[stage].push(node.id);
				if (stage > evidence) evidence = stage;
			}
			const floor = state === void 0 ? 0 : STATE_FLOOR[state] ?? 0;
			return {
				stage: Math.min(WORKFLOW_STAGE_COUNT - 1, Math.max(floor, evidence)),
				idsByStage: buckets,
				approvalPending: state !== void 0 && APPROVAL_STATES.has(state)
			};
		}
		//#endregion
		//#region src/node-presentation.ts
		/** 标题里「类型」与「名字」的分隔符 —— 产品里就是它（`mediaNodeTitle` 也用）。 */
		const SEGMENT_SEPARATOR = "·";
		/**
		* 摘掉标题里与头部标签重复的那一段。
		*
		* 三种输入都要照顾到（都是真实标题）：
		* - `关键帧` + 「分镜 3 · 关键帧」 → 「分镜 3」（标签在尾段，整段删掉）
		* - `分镜` + 「分镜 3 · 中近景」   → 「3 · 中近景」（标签是首段的**前缀**，
		*   只摘前缀，编号要留下 —— 编号是这张卡最有信息量的部分）
		* - `角色` + 「角色 · 林晚」       → 「林晚」
		* - `BGM` + 「BGM」                → `''`（标题就是类型本身，头部只剩标签，
		*   不显示重复的空标题）—— 这一条最关键：没有它，BGM 卡的头部会写成「BGM BGM」。
		*
		* 全程不改 `node.title`：这是**显示层**派生，用户重命名与磁盘数据都不受影响。
		*/
		function headTitleOf(node, label) {
			const raw = (node.title ?? "").trim();
			if (raw.length === 0) return "";
			const kept = raw.split(SEGMENT_SEPARATOR).map((segment) => segment.trim()).filter((segment) => segment.length > 0).filter((segment) => segment !== label);
			if (kept.length === 0) return "";
			const first = kept[0];
			if (first !== void 0 && first.startsWith(label)) {
				const rest = first.slice(label.length).trim();
				if (rest.length === 0) kept.shift();
				else kept[0] = rest;
			}
			return kept.length === 0 ? "" : kept.join(` ${SEGMENT_SEPARATOR} `);
		}
		/**
		* 节点**自带**的读数（不依赖媒体加载）。
		*
		* 为什么有真实产物时不再显示声明时长：`CV-140` 起 `duration` 是 ffprobe 实测值，
		* `declaredDuration` 是下当时的请求值，两者会差几十毫秒。同一张卡上同时出现
		* 两个来源不同的秒数，读者无法判断该信哪个 —— 只留实测值。
		*/
		function declaredReadingsOf(node) {
			const out = [];
			const declared = node.declaredDuration;
			if (node.url === void 0 && declared !== void 0 && Number.isFinite(declared) && declared > 0) out.push({
				key: "declared-duration",
				text: `${declared.toFixed(1)}s`
			});
			if (node.kind === "text" || node.kind === "sticky" || node.kind === "prompt") {
				const chars = (node.text ?? "").replace(/\s+/g, "").length;
				if (chars > 0) out.push({
					key: "chars",
					text: `${chars} 字`
				});
			}
			return out;
		}
		/** 把任意条数请求收口到合法区间。 */
		function clampWaveBars(bars) {
			if (!Number.isFinite(bars)) return 28;
			return Math.max(8, Math.min(96, Math.round(bars)));
		}
		/**
		* 确定性降级：由 seedText（url 或节点 id）派生 bars 根条高（22–92，单位 %）。
		* 同一 seedText 每次结果一致；不同 seedText 概率上不同 —— 只作「看起来像波形」，
		* 不承诺对应真实响度。真波形由 waveBarsFromEnvelope 承载。
		*/
		function waveBarsDeterministic(seedText, bars) {
			const count = clampWaveBars(bars);
			let seed = 17;
			for (let index = 0; index < seedText.length; index += 1) seed = (seed * 31 + seedText.charCodeAt(index)) % 9973;
			return Array.from({ length: count }, (_, index) => 22 + seed * (index + 3) % 71);
		}
		/**
		* 真包络重采样：envelope 是 Host 侧 ffmpeg 解码出的峰值序列（任意长度、
		* 0–1 归一化），线性分桶取 max 压到 bars 根。空包络退回全静音平线（不抛错
		* —— 波形是装饰性信息，失败不该打断播放/渲染）。条高 4–100（单位 %），
		* 保底 4% 让静音段仍是「看得见的平线」而不是消失。
		*/
		function waveBarsFromEnvelope(envelope, bars) {
			const count = clampWaveBars(bars);
			if (envelope.length === 0) return Array.from({ length: count }, () => 4);
			return Array.from({ length: count }, (_, index) => {
				const start = Math.floor(index * envelope.length / count);
				const end = Math.max(start + 1, Math.floor((index + 1) * envelope.length / count));
				let peak = 0;
				for (let cursor = start; cursor < end && cursor < envelope.length; cursor += 1) {
					const value = envelope[cursor];
					if (typeof value === "number" && Number.isFinite(value) && value > peak) peak = value;
				}
				return Math.round(4 + Math.min(1, Math.max(0, peak)) * 96);
			});
		}
		//#endregion
		//#region src/client/use-waveform.ts
		/**
		* C3：波形条共用 hook —— 三处音频消费方（CanvasNode 节点卡 / AudioPlayerModal
		* 播放器 / CanvasTimeline BGM 轨）**必须**都走这里，防止再长出第二套波形公式
		* （旧代码曾有两套互不相同的伪随机公式）。
		*
		* 行为：先用确定性降级公式同步出条（同一 url 每次一致，CV-128 语义保留），
		* 再异步向 Host 要真包络（ffmpeg 解码）—— 拿到就重采样覆盖，失败静默保持
		* 降级。url 变化时重置；卸载时丢弃在途请求结果。
		*/
		/** 从同源资产 URL 解析 projectId / file（非资产 URL 返回 null）。 */
		function parseAssetRef(url) {
			const match = url.match(/\/canvas-studio\/assets\/([^/]+)\/(.+?)(?:\?.*)?$/);
			return match === null ? null : {
				projectId: match[1],
				file: match[2]
			};
		}
		function useWaveBars(url, bars) {
			const seedText = url ?? "";
			const fallback = (0, react.useMemo)(() => waveBarsDeterministic(seedText, bars), [seedText, bars]);
			const [barsState, setBarsState] = (0, react.useState)(fallback);
			(0, react.useEffect)(() => {
				setBarsState(fallback);
			}, [fallback]);
			(0, react.useEffect)(() => {
				if (url === void 0) return;
				const asset = parseAssetRef(url);
				if (asset === null) return;
				const controller = new AbortController();
				let alive = true;
				fetchStudioWaveform(asset.projectId, asset.file, controller.signal).then((envelope) => {
					if (alive && envelope !== null) setBarsState(waveBarsFromEnvelope(envelope, bars));
				});
				return () => {
					alive = false;
					controller.abort();
				};
			}, [url, bars]);
			return barsState;
		}
		/**
		* 波形条带（`.csWaveBars > i`）。时间轴 BGM 轨等「在 map 里渲染」的场景不能
		* 逐项调 hook，用这个实例级组件承载（组件内部调 useWaveBars 合规）。
		*/
		function WaveBars(props) {
			const { url, bars } = props;
			return (0, react.createElement)("span", {
				className: "csWaveBars",
				"aria-hidden": "true"
			}, useWaveBars(url, bars).map((height, index) => (0, react.createElement)("i", {
				key: index,
				style: { height: `${height}%` }
			})));
		}
		//#endregion
		//#region src/client/canvas/CanvasNode.tsx
		/**
		* Tool names for the transient (loading) node titles.
		*
		* `inpaint` 仅为**历史节点**保留：该工具已于 2026-09-11 删除，老项目里由它生成
		* 的节点仍在画布上，重试时要能显示正确的加载文案。新节点不会再产生这个 toolName。
		*/
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
		/** CV-128：全画布同一时刻只允许一个音频在响（模块级登记，显式点击播放时互停）。 */
		let activeAudioEl = null;
		/** CV-128：音频波形条数量（高度由节点 id 确定性派生，见 waveBars）。 */
		const AUDIO_WAVE_BARS = 28;
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
			const { node, selected, primary = false, dimmed = false, shotIndex, onNodePointerDown, onResizePointerDown, onLinkPointerDown, onRenameSubmit, onTextSubmit, onOpenDetail, onOpenPlayback, onOpenPreview, onContextMenu, onRetry, onMediaNatural } = props;
			const [editingTitle, setEditingTitle] = (0, react.useState)(false);
			const [titleInput, setTitleInput] = (0, react.useState)("");
			const [editingBody, setEditingBody] = (0, react.useState)(false);
			const [bodyInput, setBodyInput] = (0, react.useState)("");
			const [mediaFailed, setMediaFailed] = (0, react.useState)(false);
			const [durationLabel, setDurationLabel] = (0, react.useState)(null);
			const [mediaDims, setMediaDims] = (0, react.useState)(null);
			const videoRef = (0, react.useRef)(null);
			const hoverTimer = (0, react.useRef)(null);
			const audioRef = (0, react.useRef)(null);
			const audioProgressRef = (0, react.useRef)(null);
			const audioSeekingRef = (0, react.useRef)(false);
			const [audioPlaying, setAudioPlaying] = (0, react.useState)(false);
			const [audioProgress, setAudioProgress] = (0, react.useState)(0);
			const [audioDuration, setAudioDuration] = (0, react.useState)(0);
			const isAudio = node.kind === "audio";
			const waveBars = useWaveBars(isAudio ? node.url : void 0, AUDIO_WAVE_BARS);
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
					const v = videoRef.current;
					if (v !== null && !v.paused) v.pause();
					if (v !== null && activeHoverVideo === v) activeHoverVideo = null;
					const a = audioRef.current;
					if (a !== null && !a.paused) a.pause();
					if (a !== null && activeAudioEl === a) activeAudioEl = null;
				};
			}, []);
			const handleAudioToggle = () => {
				const el = audioRef.current;
				if (el === null) return;
				if (!el.paused) {
					el.pause();
					return;
				}
				if (activeAudioEl !== null && activeAudioEl !== el) activeAudioEl.pause();
				activeAudioEl = el;
				el.play().catch(() => {});
			};
			const seekAudioToClientX = (clientX) => {
				const el = audioRef.current;
				const bar = audioProgressRef.current;
				if (el === null || bar === null || audioDuration <= 0) return;
				const rect = bar.getBoundingClientRect();
				if (rect.width <= 0) return;
				const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
				el.currentTime = ratio * audioDuration;
				setAudioProgress(ratio);
			};
			const audioLyrics = node.lyrics?.trim() ?? "";
			const lyricsIsInstrumental = audioLyrics.length === 0 || audioLyrics === "[Instrumental]";
			const lyricsHeadline = lyricsIsInstrumental ? "" : (() => {
				const lines = audioLyrics.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
				return lines.find((line) => !line.startsWith("[")) ?? lines[0] ?? "";
			})();
			(0, react.useEffect)(() => {
				const el = audioRef.current;
				if (el === null) return;
				const onTime = () => {
					if (audioSeekingRef.current) return;
					if (el.duration > 0) setAudioProgress(el.currentTime / el.duration);
				};
				const onEnded = () => {
					setAudioPlaying(false);
					setAudioProgress(0);
					if (activeAudioEl === el) activeAudioEl = null;
				};
				const onPlay = () => setAudioPlaying(true);
				const onPause = () => setAudioPlaying(false);
				const onMeta = () => {
					if (!Number.isFinite(el.duration)) return;
					setDurationLabel(formatMediaDuration(el.duration));
					setAudioDuration(el.duration);
				};
				el.addEventListener("timeupdate", onTime);
				el.addEventListener("ended", onEnded);
				el.addEventListener("play", onPlay);
				el.addEventListener("pause", onPause);
				el.addEventListener("loadedmetadata", onMeta);
				return () => {
					el.removeEventListener("timeupdate", onTime);
					el.removeEventListener("ended", onEnded);
					el.removeEventListener("play", onPlay);
					el.removeEventListener("pause", onPause);
					el.removeEventListener("loadedmetadata", onMeta);
				};
			}, [node.id]);
			(0, react.useEffect)(() => {
				if (!canHoverPreview) stopHoverPreview();
			}, [canHoverPreview]);
			const isMedia = node.kind === "image" || node.kind === "video";
			const isGroup = node.kind === "group";
			const opacity = node.opacity ?? 1;
			const retired = node.supersededBy !== void 0 || node.retired === true;
			const showShotIdx = shotIndex !== void 0;
			const showVersion = node.shotVersion !== void 0 && node.shotVersion > 1 && !retired;
			const isReference = node.isReference === true;
			const showAudioMix = node.audioComposition !== void 0;
			const showDuration = node.kind === "video" && durationLabel !== null;
			const showDims = mediaDims !== null;
			const showResize = !node.locked && isMedia;
			const headLabel = productLabelOf(node) ?? KIND_LABEL[node.kind] ?? node.kind;
			const headTitle = headTitleOf(node, headLabel);
			/** 脚部读数：声明值来自契约（node-presentation），实测值来自媒体元素。 */
			const declaredReadings = declaredReadingsOf(node);
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
				if ((node.kind === "video" || node.kind === "audio") && node.url !== void 0 && onOpenPlayback !== void 0) {
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
					node.isLoading ? "csNodeLoading" : "",
					retired ? "csNodeRetired" : "",
					isComposeProduct(node) ? "csNodeFilm" : "",
					dimmed && !selected ? "csNodeDimmed" : ""
				].filter(Boolean).join(" "),
				style: {
					left: 0,
					top: 0,
					transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
					width: node.width,
					height: node.height,
					"--cs-node-opacity": opacity
				},
				onPointerDown: handleNodePointerDown,
				onDoubleClick: handleDoubleClick,
				onContextMenu: handleContextMenu,
				"data-node-id": node.id,
				children: [
					!isGroup && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csNodeHead",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csNodeHeadKind",
								children: headLabel
							}),
							node.error !== void 0 ? canRetryNode(node) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csNodeHeadAlert",
								title: `${node.error}\n点击重试（同参数重新生成）`,
								onClick: () => {
									onRetry(node.id);
								},
								children: "生成失败 · 点击重试"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "csNodeHeadAlert",
								title: node.error,
								children: ["生成失败：", node.error]
							}) : headTitle.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csNodeHeadTitle",
								title: node.title ?? void 0,
								children: headTitle
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csNodeHeadChips",
								children: [
									retired && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csNodeBadge csNodeBadgeRetired",
										title: node.retired === true ? "已作废，不参与默认合成（右键可恢复）" : "已被新版本取代，不参与默认合成（右键可恢复）",
										children: [node.retired === true ? "已作废" : "已失效", node.shotVersion !== void 0 ? ` · v${node.shotVersion}` : ""]
									}),
									showShotIdx && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csNodeBadge csNodeShotIdx",
										title: `成片第 ${shotIndex} 段 · 与底部时间轴同号`,
										children: ["#", shotIndex]
									}),
									showVersion && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csNodeBadge csNodeBadgeVersion",
										title: `第 ${node.shotVersion} 版（同一镜位重出过）`,
										children: ["v", node.shotVersion]
									}),
									node.locked === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csNodeBadge csNodeBadgeLock",
										title: "已锁定（拖拽 / 缩放 / 编辑被拦下）",
										children: "🔒"
									})
								]
							})
						]
					}),
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
						onPointerEnter: handleVideoEnter,
						onPointerLeave: stopHoverPreview,
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
							ref: videoRef,
							className: "csNodeMedia",
							src: node.url,
							preload: "metadata",
							onLoadedMetadata: handleVideoMetadata,
							onError: () => {
								setMediaFailed(true);
							}
						})
					}) : null,
					isAudio && node.url !== void 0 && !mediaFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csNodeAudioBox",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csNodeAudioWave",
								"aria-hidden": true,
								children: waveBars.map((height, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csNodeAudioBar",
									style: {
										height: `${height}%`,
										opacity: audioPlaying && index / waveBars.length <= audioProgress ? .95 : .4
									}
								}, index))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csNodeAudioControls",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "csNodeAudioPlay",
									onClick: handleAudioToggle,
									onDoubleClick: (event) => {
										event.stopPropagation();
									},
									title: audioPlaying ? "暂停" : "播放",
									children: audioPlaying ? "⏸" : "▶"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									ref: audioProgressRef,
									className: "csNodeAudioProgress",
									role: "slider",
									"aria-label": "播放进度",
									"aria-valuemin": 0,
									"aria-valuemax": Math.round(audioDuration),
									"aria-valuenow": Math.round(audioProgress * audioDuration),
									onPointerDown: (event) => {
										event.stopPropagation();
										audioSeekingRef.current = true;
										event.currentTarget.setPointerCapture(event.pointerId);
										seekAudioToClientX(event.clientX);
									},
									onPointerMove: (event) => {
										if (audioSeekingRef.current) seekAudioToClientX(event.clientX);
									},
									onPointerUp: (event) => {
										audioSeekingRef.current = false;
										event.currentTarget.releasePointerCapture(event.pointerId);
									},
									onDoubleClick: (event) => {
										event.stopPropagation();
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "csNodeAudioProgressFill",
										style: { width: `${audioProgress * 100}%` }
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csNodeAudioLyrics",
								title: audioLyrics.length > 0 ? audioLyrics : void 0,
								children: lyricsIsInstrumental ? "纯器乐 · 无歌词" : lyricsHeadline
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
								ref: audioRef,
								className: "csNodeAudioEl",
								src: node.url,
								preload: "metadata",
								onError: () => {
									setMediaFailed(true);
								}
							})
						]
					}) : null,
					isAudio && mediaFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeText csNodeTextAlert",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csNodeAlert",
							children: ["音频加载失败：", node.title ?? node.kind]
						})
					}),
					isMedia && mediaFailed && node.isLoading !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeText csNodeTextAlert",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csNodeAlert",
							children: ["媒体加载失败：", node.title ?? node.kind]
						})
					}),
					node.kind === "sticky" || node.kind === "text" || node.kind === "prompt" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csNodeText",
						children: editingBody ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
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
						})
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
					!isGroup && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csNodeFoot",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csNodeFootReadings",
							children: [
								showAudioMix && node.audioComposition !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csNodeAudioMix",
									"data-audio": node.audioComposition,
									title: AUDIO_COMPOSITION_HINTS[node.audioComposition],
									children: AUDIO_COMPOSITION_LABELS[node.audioComposition]
								}),
								showDuration && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csNodeDuration",
									children: durationLabel
								}),
								showDims && mediaDims !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "csNodeMediaDims",
									children: [
										mediaDims.width,
										" × ",
										mediaDims.height
									]
								}),
								declaredReadings.map((reading) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: reading.key === "declared-duration" ? "csNodeDuration" : "csNodeChars",
									children: reading.text
								}, reading.key))
							]
						}), isReference && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csNodeRefBadge",
							"data-role": node.referenceRole ?? "image",
							title: `参考图 · ${REFERENCE_ROLE_SHORT[node.referenceRole ?? "image"]}`,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csNodeRefDot" }),
								"参考 · ",
								REFERENCE_ROLE_SHORT[node.referenceRole ?? "image"]
							]
						})]
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
					showResize && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [RESIZE_CORNERS.map((corner) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
			audio: "#f43f5e",
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
				onPointerDown: (event) => {
					event.stopPropagation();
				},
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
		* so it survives restarts (canvas.json v3) and project switches. Interactions:
		* a blank press clears the selection immediately (Ctrl/Cmd excepted) and
		* left-drag (or middle button) pans, wheel without modifiers pans, Ctrl/Cmd+wheel
		* zooms around the cursor, node pointer-down begins a node drag (snap
		* alignment + guides), the node's resize handles begin a resize, and the link
		* handle begins a manual connection drag. Keyboard: Delete removes the
		* selection, Ctrl/Cmd+C/V copy/paste, Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
		* undo/redo, Ctrl/Cmd+A selects all, Escape clears the selection. Marquee
		* box-selection has been removed — type-based selection lives in the layer
		* panel header.
		*/
		const CanvasSurface = (0, react.forwardRef)(function CanvasSurface(props, ref) {
			const { nodes, view, onViewChange, selectedNodeIds, onSelectNode, onSelectAllNodes, onMoveNode, onUpdateNode, onBeginEdit, onPersist, onRemoveNodes, onCopy, onPaste, onUndo, onRedo, onLinkLayers, onRename, onNodeTextSubmit, onNodeOpenDetail, onNodeOpenPlayback, onNodeOpenPreview, onContextMenu, onBlankContextMenu, onRetry, onMediaNatural, focusNodeId, minimapVisible = true, shotIndexOf } = props;
			const [guides, setGuides] = (0, react.useState)({
				vertical: [],
				horizontal: []
			});
			const [linkLine, setLinkLine] = (0, react.useState)(null);
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
				if (event.button === 1 || event.button === 0) {
					if (event.button === 0 && !(event.ctrlKey || event.metaKey)) onSelectNode(null);
					gesture.current = {
						mode: "pan",
						startX: event.clientX,
						startY: event.clientY
					};
					armPointer(event);
					event.preventDefault();
					return;
				}
			};
			const onNodePointerDown = (event, node) => {
				const additive = event.ctrlKey || event.metaKey;
				const inRoster = selectedNodeIds.includes(node.id);
				const roster = additive ? inRoster ? selectedNodeIds.filter((id) => id !== node.id) : [...selectedNodeIds, node.id] : inRoster ? selectedNodeIds : [node.id];
				const memberClick = !additive && inRoster && selectedNodeIds.length > 1;
				if (!memberClick) onSelectNode(node.id);
				if (node.locked) {
					if (memberClick) onSelectNode(node.id);
					return;
				}
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
					origins,
					collapseOnClick: memberClick
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
				if (current.mode === "node" && current.collapseOnClick === true && current.editBegun !== true && current.nodeId !== void 0) onSelectNode(current.nodeId);
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
			const spotlight = (0, react.useMemo)(() => canvasSpotlight(visibleNodes, selectedNodeIds), [visibleNodes, selectedNodeIds]);
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
						ordered.map((node) => {
							const shotIndex = shotIndexOf?.get(node.id);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CanvasNode, {
								node,
								selected: selectedNodeIds.includes(node.id),
								primary: node.id === primaryDragId,
								dimmed: spotlight.active && !spotlight.lit.has(node.id),
								...shotIndex !== void 0 ? { shotIndex } : {},
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
							}, node.id);
						}),
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
		/**
		* 片段可参与合成的有效性。
		*
		* CV-160：**委托给 `shot-versions.isShotClip`（全仓唯一权威口径）**——此前这里
		* 内联了 `kind==='video' && !retired && !supersededBy`，漏掉「非成片节点」一条，
		* 与 Host 的 `defaultComposeClips` 分叉：成片节点（kind=video + toolName=compose）
		* 被当成片段计入预计时长（15.51s → 30.99s），并会作为 clipId 再拼进下一次成片。
		* 判片段的口径只允许有一份，UI / 估算 / Host 必须同源。
		*/
		function isComposableClip(node) {
			return isShotClip(node);
		}
		/** 合成产物（成片）：时间轴上要显示但**不计入**片段数与预计时长（CV-160）。 */
		function isComposedFilm(node) {
			return isComposeProduct(node);
		}
		/** BGM 候选有效性：只收存活的音频节点（CV-006 拍板：不列成片节点，少一个歧义源）。 */
		function isValidBgmNode(node) {
			return node !== void 0 && node.kind === "audio" && node.retired !== true && node.supersededBy === void 0;
		}
		/**
		* 把时间轴 + 勾选态归约成一次合成请求的输入。
		* 纯函数：不读 store、不发请求；排除语义 = 「显式排除优先于一切」，作废片段
		* 在勾选区直接禁用（不进 excluded），所以这里不需要再防两者冲突。
		*/
		function resolveComposeSelection(input) {
			const { ordered, excluded } = input;
			const excludedSet = new Set(excluded);
			const clips = ordered.filter((node) => isComposableClip(node) && !excludedSet.has(node.id));
			const clipIds = clips.map((node) => node.id);
			const estSeconds = clips.reduce((sum, node) => sum + (typeof node.duration === "number" ? node.duration : 0), 0);
			const warnings = [];
			const bgmCandidate = input.bgmNodeId === void 0 ? void 0 : ordered.find((node) => node.id === input.bgmNodeId);
			const bgmNode = isValidBgmNode(bgmCandidate) ? bgmCandidate : void 0;
			const bgmInvalid = input.bgmNodeId !== void 0 && bgmNode === void 0;
			if (bgmNode !== void 0 && typeof bgmNode.duration === "number" && estSeconds > 0 && bgmNode.duration + .05 < estSeconds) {
				const shortfall = estSeconds - bgmNode.duration;
				warnings.push(`BGM（${bgmNode.duration.toFixed(2)}s）可能比预计成片（${estSeconds.toFixed(2)}s）短 ≈${shortfall.toFixed(2)}s，合成会被拒绝 —— 建议先让 agent 生成更长的 BGM`);
			}
			return {
				clipIds,
				...bgmNode !== void 0 ? { bgmNode } : {},
				estSeconds,
				warnings,
				bgmInvalid
			};
		}
		/** 刻度步长候选：保证标尺刻度数量可读（≤ 12 个左右）。 */
		const TICK_STEPS = [
			1,
			2,
			5,
			10,
			15,
			30,
			60
		];
		/**
		* 标尺右端点：总时长向上取整到刻度步长的整数倍。
		* 例：total=10.7 → step=2 → rulerMax=12（刻度 0,2,4,…,12）。
		*/
		function niceRulerMax(totalSeconds) {
			const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
			if (total === 0) return 0;
			const step = TICK_STEPS.find((s) => total / s <= 10) ?? 60;
			return Math.ceil(total / step) * step;
		}
		/**
		* 标尺刻度：从 0 到 rulerMax、按自适应步长均匀分布。
		* 返回 t（秒）与 pct（0-100，相对 rulerMax）。
		*/
		function rulerTicks(rulerMax) {
			if (!(rulerMax > 0)) return [];
			const step = TICK_STEPS.find((s) => rulerMax / s <= 10) ?? 60;
			const ticks = [];
			for (let t = 0; t <= rulerMax + 1e-9; t += step) ticks.push({
				t: Math.round(t * 100) / 100,
				pct: t / rulerMax * 100
			});
			return ticks;
		}
		/**
		* 片段布局：按顺序从 0 累加排布，宽度 = 有效时长 / rulerMax。
		*
		* 不变量（tests/timeline 固化）：
		* 1. 任意两片段宽度之比 == 其有效时长之比（真值片段严格成立）；
		* 2. 真值片段的宽度比例 == duration / 总时长（相对累计起点同理）；
		* 3. 片段首尾相接无重叠、无间隙（start[i+1] === start[i] + span[i]）。
		*/
		function planClipLayout(clips) {
			const spans = clips.map((clip) => {
				const measured = typeof clip.duration === "number" && Number.isFinite(clip.duration) && clip.duration > 0;
				return {
					id: clip.id,
					span: measured ? clip.duration : 1,
					measured
				};
			});
			const rulerMax = niceRulerMax(spans.reduce((sum, s) => sum + s.span, 0));
			let acc = 0;
			return spans.map((s) => {
				const start = acc;
				acc += s.span;
				return {
					id: s.id,
					start,
					span: s.span,
					measured: s.measured,
					leftPct: rulerMax > 0 ? start / rulerMax * 100 : 0,
					widthPct: rulerMax > 0 ? s.span / rulerMax * 100 : 0
				};
			});
		}
		/** 标尺总时长（布局片段的有效时长之和；空 → 0）。 */
		function clipTotalSeconds(clips) {
			return clips.reduce((sum, clip) => {
				return sum + (typeof clip.duration === "number" && Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 1);
			}, 0);
		}
		/** 播放头时间 → 相对 rulerMax 的百分比（0-100，越界夹紧）。 */
		function playheadLeftPct(timeSeconds, rulerMax) {
			if (!(rulerMax > 0)) return 0;
			return Math.min(rulerMax, Math.max(0, timeSeconds)) / rulerMax * 100;
		}
		/** 播放头时间落在哪个片段内（用于画布联动高亮）；不在任何片段内 → undefined。 */
		function clipIdAt(timeSeconds, spans) {
			for (const span of spans) if (timeSeconds >= span.start && timeSeconds < span.start + span.span) return span.id;
		}
		//#endregion
		//#region src/client/canvas/CanvasTimeline.tsx
		/** CV-007：真值时长标签；无探测值回落创建时间，不造假数据。 */
		function durationOrTime(node) {
			const time = new Date(node.createdAt);
			return typeof node.duration === "number" ? `${node.duration.toFixed(1)}s` : Number.isNaN(time.getTime()) ? "-" : time.toLocaleTimeString();
		}
		/**
		* The review timeline（DD-04a：从等宽 chip 列表升维为真时间轴）。
		*
		* 三轨：视频轨（片段宽度 = 真实 duration 比例，可拖拽重排 + 勾选纳入合成）、
		* BGM 轨（音频资产按时长比例排布，点选即选定）、参考·产物轨（图片素材 +
		* 成片产物 + 失效版本，固定宽 chip——它们不属于合成序列，不参与比例布局）。
		* 标尺 + 可拖播放头：在标尺或轨道空白处按下即擦洗，播放头下的片段高亮
		* （isHot），松手时联动画布选中该片段。
		*
		* CV-006/007 语义不变：成片产物与失效版本不计入片段数 / 预计时长 / 布局
		* （CV-160：产物 ≠ 素材）；工具栏能力（BGM 下拉、显示全部、导出）原样保留。
		*/
		function CanvasTimeline(props) {
			const { ordered, selectedNodeId, onSelect, onReorder, onCompose, composeBusy, composeClipCount, composeEstSeconds, composeWarnings, composeExcluded, composeBgmNodeId, onToggleComposeExcluded, onComposeBgmChange } = props;
			const [dragIndex, setDragIndex] = (0, react.useState)(null);
			const [hoverIndex, setHoverIndex] = (0, react.useState)(null);
			const [showAll, setShowAll] = (0, react.useState)(false);
			const [playT, setPlayT] = (0, react.useState)(0);
			const [playing, setPlaying] = (0, react.useState)(false);
			const lanesRef = (0, react.useRef)(null);
			const scrubbingRef = (0, react.useRef)(false);
			const excludedSet = new Set(composeExcluded);
			const displayed = showAll ? ordered : ordered.filter((node) => node.kind === "image" || node.kind === "video" || node.kind === "audio");
			const bgmCandidates = ordered.filter(isValidBgmNode);
			const filmNodes = displayed.filter(isComposedFilm);
			const refNodes = displayed.filter((node) => node.kind === "image" || node.kind === "video" && (isComposedFilm(node) || node.retired === true || node.supersededBy !== void 0));
			const clips = displayed.filter(isShotClip);
			const spans = (0, react.useMemo)(() => planClipLayout(clips), [clips]);
			const rulerMax = (0, react.useMemo)(() => niceRulerMax(clipTotalSeconds(clips)), [clips]);
			const ticks = (0, react.useMemo)(() => rulerTicks(rulerMax), [rulerMax]);
			const hotId = clipIdAt(playT, spans);
			(0, react.useEffect)(() => {
				if (!playing) return;
				const timer = window.setInterval(() => {
					setPlayT((prev) => Math.min(rulerMax, prev + .1));
				}, 100);
				return () => {
					window.clearInterval(timer);
				};
			}, [playing, rulerMax]);
			(0, react.useEffect)(() => {
				if (playing && playT >= rulerMax) setPlaying(false);
			}, [
				playing,
				playT,
				rulerMax
			]);
			const togglePlay = () => {
				setPlaying((prev) => {
					const next = !prev;
					if (next && playT >= rulerMax) setPlayT(0);
					return next;
				});
			};
			const hideBrokenMedia = (event) => {
				event.currentTarget.style.display = "none";
			};
			const handleDrop = (targetIndex) => {
				if (dragIndex === null || dragIndex === targetIndex) {
					setDragIndex(null);
					setHoverIndex(null);
					return;
				}
				const ids = clips.map((node) => node.id);
				const [moved] = ids.splice(dragIndex, 1);
				if (moved !== void 0) ids.splice(targetIndex, 0, moved);
				onReorder(ids);
				setDragIndex(null);
				setHoverIndex(null);
			};
			/**
			* DD-04a：指针横向坐标 → 时间（秒）。可用宽度 = 轨道区宽 − 标签列宽
			* （64px = 标签列 56 + 轨道 gap 8，与播放头 left 公式同源）。返回 null = 无法换算（未挂载/无片段）。
			*/
			const timeAt = (clientX) => {
				const lanes = lanesRef.current;
				if (lanes === null || rulerMax <= 0) return null;
				const rect = lanes.getBoundingClientRect();
				const usable = rect.width - 64;
				if (usable <= 0) return null;
				return Math.min(1, Math.max(0, (clientX - rect.left - 64) / usable)) * rulerMax;
			};
			const scrubTo = (clientX) => {
				const time = timeAt(clientX);
				if (time !== null) setPlayT(time);
			};
			const handleScrubPointerDown = (event) => {
				if (event.target.closest(".csTlClipWrap") !== null) return;
				scrubbingRef.current = true;
				event.currentTarget.setPointerCapture(event.pointerId);
				scrubTo(event.clientX);
			};
			if (ordered.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "csTimeline csTimelineEmpty",
				children: "尚无产物 —— 在右侧对话让 agent 生成后，按时间线回看"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csTimeline",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csTimelineToolbar",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csTimelinePlay",
							disabled: clips.length === 0,
							title: playing ? "暂停（播放头自动推进，不改动画布选区）" : "播放：播放头自动推进，当前片段高亮（不改动画布选区）",
							onClick: togglePlay,
							children: playing ? "⏸ 暂停" : "▶ 播放"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csTimelineCount",
							title: "参与合成的逐镜片段数：成片产物与失效版本（已作废 / 被新版取代）都不计入",
							children: ["视频片段 ", composeClipCount]
						}),
						composeEstSeconds > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csTimelineEst",
							title: "Σ 参与合成的逐镜片段真值时长：排除勾选、已作废/被取代版本与成片产物——与「合成导出成片」实际提交的 clipIds 完全一致",
							children: [
								"预计成片 ≈ ",
								composeEstSeconds.toFixed(2),
								"s"
							]
						}) : null,
						filmNodes.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "csTimelineHint",
							title: `时间轴上有 ${filmNodes.length} 个成片产物：成片由片段拼成，属于结果而非素材，因此不计入「视频片段」与「预计成片」（也不会被再次拼进新成片，避免递归叠加）`,
							children: [
								"成片 ",
								filmNodes.length,
								" 个不计入"
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "csTimelineBgm",
							children: ["BGM", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: composeBgmNodeId ?? "",
								onChange: (event) => {
									onComposeBgmChange(event.target.value === "" ? void 0 : event.target.value);
								},
								title: "选用画布上的音频节点作为成片 BGM；多镜将只保留 BGM，单镜保留环境声并叠混",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "不使用"
								}), bgmCandidates.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: node.id,
									children: [node.title ?? "音频", typeof node.duration === "number" ? ` · ${node.duration.toFixed(2)}s` : ""]
								}, node.id))]
							})]
						}),
						composeWarnings.map((warning) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csTimelineWarn",
							title: "服务端守卫会在合成时给出精确差额",
							children: warning
						}, warning)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "csTimelineToggleAll",
							title: "非媒体节点（便签/文案/提示词等）默认不进时间轴",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: showAll,
								onChange: (event) => {
									setShowAll(event.target.checked);
								}
							}), "显示全部"]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "csPrimary",
							disabled: composeClipCount < 1 || composeBusy,
							title: composeClipCount < 1 ? "至少 1 个有效片段才能导出成片（排除勾选与作废片段不计入）" : "有效片段将按顺序拼接成片；单片段 = 一镜整出（保留环境声），多镜 = 只保留 BGM / 无声",
							onClick: () => {
								onCompose();
							},
							children: composeBusy ? "合成中…" : "合成导出成片"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csTlBody",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csTlLanes",
						ref: lanesRef,
						onPointerDown: handleScrubPointerDown,
						onPointerMove: (event) => {
							if (scrubbingRef.current) scrubTo(event.clientX);
						},
						onPointerUp: (event) => {
							if (!scrubbingRef.current) return;
							scrubbingRef.current = false;
							event.currentTarget.releasePointerCapture(event.pointerId);
							const time = timeAt(event.clientX);
							if (time !== null) {
								setPlayT(time);
								const id = clipIdAt(time, spans);
								if (id !== void 0) onSelect(id);
							}
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csTlRuler",
								children: ticks.map((tick) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "csTlTick",
									style: { left: `${tick.pct}%` },
									children: [tick.t, "s"]
								}, tick.t))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csTlTrack",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csTlTrkLabel",
									children: "视频轨"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "csTlLane csTlLaneTall",
									children: clips.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csTlLaneEmpty",
										children: "暂无视频片段 —— 生成视频后按真实时长排入轨道"
									}) : spans.map((span, index) => {
										const node = clips[index];
										if (node === void 0) return null;
										const excluded = excludedSet.has(node.id);
										const className = [
											"csTlClip",
											node.id === selectedNodeId ? "csTlClipSel" : "",
											node.id === hotId ? "csTlClipHot" : "",
											excluded ? "csTlClipExcluded" : "",
											index === hoverIndex && dragIndex !== null && dragIndex !== index ? "csTlClipTarget" : ""
										].filter(Boolean).join(" ");
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "csTlClipWrap",
											style: {
												left: `${span.leftPct}%`,
												width: `calc(${span.widthPct}% - 3px)`
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className,
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
													setPlayT(span.start);
												},
												title: `${node.title ?? KIND_LABEL[node.kind]} · ${durationOrTime(node)}（宽度 = 真实时长比例）· 拖拽排序${excluded ? " · 已排除出合成" : ""}`,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "csTlClipArt",
														children: node.url ? node.kind === "video" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
															src: node.url,
															muted: true,
															preload: "metadata",
															onError: hideBrokenMedia
														}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
															src: node.url,
															alt: node.title ?? "image",
															draggable: false,
															onError: hideBrokenMedia
														}) : null
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "csTlClipLbl",
														children: [
															index + 1,
															" · ",
															durationOrTime(node)
														]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csTlClipCut" })
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: `csTlCheck${excluded ? " csTlCheckOff" : ""}`,
												title: excluded ? "已排除出合成 —— 点按重新纳入" : "将参与合成 —— 点按排除",
												onClick: () => {
													onToggleComposeExcluded(node.id);
												},
												children: excluded ? "" : "✓"
											})]
										}, node.id);
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csTlTrack",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csTlTrkLabel",
									children: "BGM"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "csTlLane",
									children: bgmCandidates.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csTlLaneEmpty",
										children: "未选择 BGM —— 生成音频后在此点选"
									}) : (() => {
										return planClipLayout(bgmCandidates).map((span, index) => {
											const node = bgmCandidates[index];
											if (node === void 0) return null;
											const active = node.id === composeBgmNodeId;
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: `csTlClip csTlClipBgm${active ? " csTlClipSel" : ""}`,
												style: {
													left: `${span.leftPct}%`,
													width: `calc(${span.widthPct}% - 3px)`
												},
												onClick: () => {
													onComposeBgmChange(active ? void 0 : node.id);
												},
												title: `${node.title ?? "音频"} · ${durationOrTime(node)}${active ? " · 已选用，点按取消" : " · 点按选用"}`,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WaveBars, {
													url: node.url,
													bars: 32
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "csTlClipLbl",
													children: [
														"♪ ",
														node.title ?? "音频",
														typeof node.duration === "number" ? ` · ${node.duration.toFixed(1)}s` : ""
													]
												})]
											}, node.id);
										});
									})()
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csTlTrack",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csTlTrkLabel",
									children: "参考·产物"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "csTlLane",
									children: refNodes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "csTlLaneEmpty",
										children: "参考图 / 成片产物会出现在这条轨道"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "csTlRefRow",
										children: refNodes.map((node) => {
											const film = isComposedFilm(node);
											const retired = !film && (node.retired === true || node.supersededBy !== void 0);
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: `csTlRefChip${film ? " csTlRefChipFilm" : ""}${retired ? " csTlRefChipRetired" : ""}`,
												onClick: () => {
													onSelect(node.id);
												},
												title: `${node.title ?? KIND_LABEL[node.kind]}${film ? " · 成片产物，不计入片段与预计时长" : ""}${retired ? " · 已作废 / 被新版取代" : ""} · 点按在画布定位`,
												children: [film ? "成片 · " : "", node.title ?? KIND_LABEL[node.kind]]
											}, node.id);
										})
									})
								})]
							}),
							rulerMax > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csTlPlayhead",
								style: { left: `calc(64px + (100% - 64px) * ${playheadLeftPct(playT, rulerMax) / 100})` },
								title: `播放头 ${playT.toFixed(1)}s · 拖动标尺擦洗`,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csTlPhGrip" })
							}) : null
						]
					})
				})]
			});
		}
		//#endregion
		//#region src/client/canvas/LayerPanel.tsx
		const TYPE_FILTERS = [
			{
				value: "reference",
				label: "参考图",
				match: (node) => node.isReference === true
			},
			{
				value: "image",
				label: "图片",
				match: (node) => node.kind === "image" && node.isReference !== true
			},
			{
				value: "video",
				label: "视频",
				match: (node) => node.kind === "video"
			},
			{
				value: "text",
				label: "文本 / 便签",
				match: (node) => node.kind === "sticky" || node.kind === "prompt"
			},
			{
				value: "audio",
				label: "音频",
				match: (node) => node.kind === "audio"
			}
		];
		/**
		* The layer list: every node as a row with thumbnail/kind, lock and visibility
		* toggles, z-order buttons, and delete. Click selects (ctrl/cmd multi-select);
		* group members indent under their group row. The header carries type-based
		* selection (marquee box-select was retired) plus invert/clear. Rendered with
		* the DSH theme tokens.
		*/
		function LayerPanel(props) {
			const { nodes, selectedNodeIds, onSelect, onSelectIds, onDelete, onToggleLock, onToggleVisibility, onReorder } = props;
			const [query, setQuery] = (0, react.useState)("");
			const [typeValue, setTypeValue] = (0, react.useState)("");
			const selected = new Set(selectedNodeIds);
			const ordered = [...nodes].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
			const selectable = ordered.filter((node) => node.visible !== false);
			const selectType = (value) => {
				setTypeValue("");
				if (value === "all") {
					onSelectIds(selectable.map((node) => node.id));
					return;
				}
				const filter = TYPE_FILTERS.find((candidate) => candidate.value === value);
				if (filter === void 0) return;
				onSelectIds(selectable.filter((node) => filter.match(node)).map((node) => node.id));
			};
			const invertSelection = () => {
				onSelectIds(selectable.filter((node) => !selected.has(node.id)).map((node) => node.id));
			};
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
							}) : node.kind === "audio" && node.url !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "csLayerThumbKind csLayerThumbAudio",
								children: "♪"
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
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "csLayerPanelHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "图层" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "csLayerSearch",
							placeholder: "搜索图层…",
							value: query,
							onChange: (event) => {
								setQuery(event.target.value);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csLayerQuickSelect",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "csLayerTypeSelect",
								value: typeValue,
								onChange: (event) => {
									selectType(event.target.value);
								},
								title: "按类型批量选中画布节点",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										disabled: true,
										children: "按类型选择…"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "all",
										children: "全部节点"
									}),
									TYPE_FILTERS.map((filter) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: filter.value,
										children: filter.label
									}, filter.value))
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csLayerAction",
								title: "反选（可见图层内）",
								onClick: invertSelection,
								children: "反选"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "csLayerAction",
								title: "清除选择",
								onClick: () => {
									onSelectIds([]);
								},
								children: "清除"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csLayerList",
						children: grouped.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csLayerEmpty",
							children: "暂无图层"
						}) : grouped.map((node) => renderRow(node, 0))
					})
				]
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
							node.kind === "audio" && node.url !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "试听"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
									className: "csDetailAudio",
									src: node.url,
									controls: true,
									preload: "metadata"
								})]
							}),
							node.kind === "audio" && node.lyrics !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csDetailRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailLabel",
									children: "歌词"
								}), node.lyrics === "[Instrumental]" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csDetailValue",
									children: "纯器乐（无歌词）"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
									className: "csDetailPrompt csDetailLyrics",
									children: node.lyrics
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
		function formatTime$1(seconds) {
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: duration > 0 ? `时长 ${formatTime$1(duration)}` : "加载中…" })
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
									children: formatTime$1(current)
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
									children: formatTime$1(duration)
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
		//#region src/client/canvas/AudioPlayerModal.tsx
		/** 秒 → mm:ss（超一小时兜底 h:mm:ss）。与 VideoPlayerModal 保持同一格式。 */
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
		/** 波形动画条数（纯器乐时的视觉主体）。 */
		const WAVE_BARS = 48;
		function AudioPlayerModal(props) {
			const { title, url, lyrics, duration: nodeDuration, onClose } = props;
			const [paused, setPaused] = (0, react.useState)(false);
			const [duration, setDuration] = (0, react.useState)(nodeDuration ?? 0);
			const [current, setCurrent] = (0, react.useState)(0);
			const [volume, setVolume] = (0, react.useState)(1);
			const [muted, setMuted] = (0, react.useState)(false);
			const audioRef = (0, react.useRef)(null);
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
			const trimmed = lyrics?.trim() ?? "";
			const instrumental = trimmed.length === 0 || trimmed === "[Instrumental]";
			const lyricLines = (0, react.useMemo)(() => instrumental ? [] : trimmed.split("\n").map((line) => line.trim()), [instrumental, trimmed]);
			const waveBars = useWaveBars(url, WAVE_BARS);
			const handleTogglePlay = () => {
				const el = audioRef.current;
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
				const el = audioRef.current;
				const bar = progressRef.current;
				if (el === null || bar === null || duration <= 0) return;
				const rect = bar.getBoundingClientRect();
				if (rect.width <= 0) return;
				el.currentTime = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
				setCurrent(el.currentTime);
			};
			const handleVolumeChange = (next) => {
				const el = audioRef.current;
				if (el === null) return;
				el.volume = next;
				setVolume(next);
				if (next > 0 && el.muted) {
					el.muted = false;
					setMuted(false);
				}
			};
			const handleToggleMute = () => {
				const el = audioRef.current;
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
					className: "csModal csAudioModalCard",
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
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: instrumental ? "纯器乐" : `歌词 ${lyricLines.filter((line) => line.length > 0 && !line.startsWith("[")).length} 行` }),
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "csAudioStage",
							onClick: handleTogglePlay,
							children: instrumental ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csAudioStageWave",
								"aria-hidden": "true",
								children: waveBars.map((height, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csAudioStageBar",
									style: {
										height: `${height}%`,
										opacity: paused ? .4 : (index + 1) / waveBars.length <= progressRatio ? .95 : .3
									}
								}, index))
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csAudioStageLyrics",
								onClick: (event) => {
									event.stopPropagation();
								},
								children: lyricLines.map((line, index) => line.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csAudioLyricGap",
									"aria-hidden": "true"
								}, index) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: line.startsWith("[") ? "csAudioLyricLine csAudioLyricMarker" : "csAudioLyricLine",
									children: line
								}, index))
							})
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
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
							ref: audioRef,
							src: url,
							autoPlay: true,
							onPlay: () => {
								setPaused(false);
							},
							onPause: () => {
								setPaused(true);
							},
							onLoadedMetadata: () => {
								const el = audioRef.current;
								if (el !== null && Number.isFinite(el.duration)) setDuration(el.duration);
							},
							onTimeUpdate: () => {
								const el = audioRef.current;
								if (el !== null && !seekingRef.current) setCurrent(el.currentTime);
							},
							onEnded: () => {
								setPaused(true);
								setCurrent(0);
							}
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
			const { node, x, y, onClose, onRename, onCopy, onDelete, onReorder, onToggleLock, onToggleVisibility, onRetry, onSteer, onCancel, onUngroup, onReferenceToChat, onDownload, onOpenDetail, onToggleRetire } = props;
			const isAgent = node.origin === "agent" && node.toolName !== void 0;
			const hasPrompt = node.generationPrompt !== void 0;
			const retired = node.supersededBy !== void 0 || node.retired === true;
			const isShot = node.kind === "video" && node.toolName !== "compose";
			const isRefImage = node.kind === "image" && node.isReference === true;
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
					(isShot || isRefImage) && item(retired ? isRefImage ? "恢复为参考（新版自动作废）" : "恢复使用（作废取代它的版本）" : isRefImage ? "作废（不再作为参考）" : "作废（不参与成片合成）", () => {
						onToggleRetire(node.id);
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
		//#region src/client/AssetChipPreview.tsx
		/**
		* CV-114：聊天输入框里素材 chip 的 hover 缩略图浮层。
		*
		* 为什么不是监听 chip 的 mouseover：chip 画在上游 composer 的**镜像层**
		* （`.backdrop`，`pointer-events: none`）里，鼠标事件全部穿透到下面的 textarea，
		* chip 元素本身永远收不到事件。所以这里做**几何命中**——按指针坐标匹配
		* chip 的 `getBoundingClientRect()`，命中即出卡。
		*
		* 卡片本身是我们自己的元素（可点）：点一下打开已有的大图/播放器浮层，
		* 等于把 chip 变成「素材入口」，与 WorkBuddy 的引用预览一致。
		*/
		/**
		* 素材 chip 的选择器，两种都收：
		* - `[data-decoration="chip"]`：输入框草稿里的 occurrence chip（镜像层）；
		* - `[data-ref-chip]`：**已发送气泡**里的引用 chip —— 上游 projectUserText 把
		*   文本里的 `@xxx` token 一律渲染成它（`title` 存完整原文，显示名剥掉 @）。
		*/
		const CHIP_SELECTOR = "[data-decoration=\"chip\"], [data-ref-chip]";
		/** 卡片宽高上限（CSS 里同为固定盒，保证定位计算一致）。 */
		const CARD_WIDTH = 220;
		const CARD_MARGIN = 8;
		/** 时长徽标：秒 → `m:ss`。 */
		function formatDuration(seconds) {
			const total = Math.max(0, Math.round(seconds));
			return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
		}
		/**
		* 渲染（或不渲染）hover 缩略图卡片。常驻挂载、只在命中时出卡，
		* 不做条件渲染换容器（避免 composer 重挂载）。
		*/
		function AssetChipPreview({ assets, skills, onOpen }) {
			const [hover, setHover] = (0, react.useState)(null);
			const assetsRef = (0, react.useRef)(assets);
			assetsRef.current = assets;
			const skillsRef = (0, react.useRef)(skills);
			skillsRef.current = skills;
			const hoverRef = (0, react.useRef)(null);
			hoverRef.current = hover;
			(0, react.useEffect)(() => {
				/** 按指针坐标找命中的 chip（backdrop 不可交互，只能几何匹配）。 */
				const hitTest = (x, y) => {
					const chips = document.querySelectorAll(CHIP_SELECTOR);
					for (const chip of chips) {
						const rect = chip.getBoundingClientRect();
						if (rect.width === 0 && rect.height === 0) continue;
						if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
						const label = chip.getAttribute("title") ?? chip.textContent ?? "";
						const asset = findAssetByChipText(assetsRef.current, label);
						if (asset !== void 0) return {
							kind: "asset",
							asset,
							top: rect.top,
							left: rect.left
						};
						const skill = findSkillByChipLabel(skillsRef.current, label);
						if (skill !== void 0) return {
							kind: "skill",
							skill,
							top: rect.top,
							left: rect.left
						};
					}
					return null;
				};
				const onMove = (event) => {
					const next = hitTest(event.clientX, event.clientY);
					const current = hoverRef.current;
					if (next === null && current === null) return;
					const nextId = next === null ? null : next.kind === "asset" ? next.asset.nodeId : next.skill.name;
					const currentId = current === null ? null : current.kind === "asset" ? current.asset.nodeId : current.skill.name;
					if (nextId !== null && nextId === currentId) return;
					setHover(next);
				};
				const dismiss = (event) => {
					const target = event?.target;
					if (target instanceof Element && target.closest(".csChipPreview") !== null) return;
					if (hoverRef.current !== null) setHover(null);
				};
				document.addEventListener("pointermove", onMove, true);
				document.addEventListener("pointerdown", dismiss, true);
				window.addEventListener("blur", dismiss);
				document.addEventListener("scroll", dismiss, true);
				return () => {
					document.removeEventListener("pointermove", onMove, true);
					document.removeEventListener("pointerdown", dismiss, true);
					window.removeEventListener("blur", dismiss);
					document.removeEventListener("scroll", dismiss, true);
				};
			}, []);
			if (hover === null) return null;
			if (hover.kind === "skill") {
				const { skill, top, left } = hover;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csChipPreview",
					style: {
						left: `${Math.min(Math.max(left, CARD_MARGIN), window.innerWidth - CARD_WIDTH - CARD_MARGIN)}px`,
						top: `${top - CARD_MARGIN}px`,
						width: `${CARD_WIDTH}px`
					},
					onPointerDown: (event) => {
						event.preventDefault();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "csChipPreviewSkill",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillIcon, {
							id: skill.icon,
							size: 22
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "csChipPreviewSkillBody",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csChipPreviewTitle",
								children: skill.title
							}), skill.summary !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "csChipPreviewSummary",
								children: truncateLabel(skill.summary, 60)
							})]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csChipPreviewFoot",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csChipPreviewHandle",
							children: skill.name
						})
					})]
				});
			}
			const { asset, top, left } = hover;
			const clampedLeft = Math.min(Math.max(left, CARD_MARGIN), window.innerWidth - CARD_WIDTH - CARD_MARGIN);
			const isVideo = asset.kind === "video";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "csChipPreview",
				style: {
					left: `${clampedLeft}px`,
					top: `${top - CARD_MARGIN}px`,
					width: `${CARD_WIDTH}px`
				},
				onPointerDown: (event) => {
					event.preventDefault();
				},
				onClick: () => {
					onOpen(asset.nodeId);
				},
				title: "点击打开大图 / 播放",
				children: [asset.url === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "csChipPreviewEmpty",
					children: "无预览"
				}) : isVideo ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csChipPreviewMedia",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("video", {
							className: "csChipPreviewVideo",
							src: `${asset.url}#t=0.1`,
							muted: true,
							playsInline: true,
							preload: "metadata"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csChipPreviewBadge",
							"aria-hidden": true,
							children: "▶"
						}),
						asset.duration !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csChipPreviewDuration",
							children: formatDuration(asset.duration)
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: "csChipPreviewImage",
					src: asset.url,
					alt: ""
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "csChipPreviewFoot",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csChipPreviewHandle",
						children: asset.handle
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "csChipPreviewTitle",
						children: truncateLabel(asset.title === "" ? "未命名素材" : asset.title, 18)
					})]
				})]
			});
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
								children: ["未开拍的现场 —— ", BRAND.taglineZh]
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
						entry.stage === "preview" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "csSkillPreviewBadge",
							title: "试跑期技能：功能可用，尚未转正",
							children: "试跑"
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
								children: detail.demo !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: "csSkillDetailThumbGif",
									src: `/canvas-studio/style-demos/${detail.demo}`,
									alt: "",
									draggable: false
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillIcon, {
									id: detail.icon,
									size: 30
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "csSkillDetailBody",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
										className: "csSkillDetailTitle",
										children: [
											detail.title,
											detail.h3 === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csSkillH3",
												children: "H3"
											}),
											detail.stage === "preview" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csSkillPreviewBadge",
												title: "试跑期技能：功能可用，尚未转正",
												children: "试跑"
											})
										]
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
				const onPointerDown = (event) => {
					if (rootRef.current !== null && event.target instanceof Node && rootRef.current.contains(event.target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("pointerdown", onPointerDown);
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("pointerdown", onPointerDown);
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
		* C5：场记板图标（设计稿 .clapIcon）—— 审批条的打板动作载体。
		* 条挂载时 CSS 播一记 csDevelopClapHit 合板（见 styles.ts）。React 元素不可变，
		* 三处审批条复用同一个元素是安全的（同一时刻只会渲染一条审批条）。
		*/
		const clapIcon = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "csWorkflowClap",
			"aria-hidden": "true",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 32 32",
				fill: "none",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "15",
					width: "26",
					height: "13",
					rx: "3",
					fill: "currentColor",
					opacity: "0.92"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "6",
					width: "26",
					height: "7",
					rx: "2",
					fill: "currentColor",
					transform: "rotate(-12 16 9)"
				})]
			})
		});
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
			const { renderSlot, useStudio, refreshProjects, createProject, openProject, deleteProject, createSampleProject, persistCanvas, retryNode, steerNode, cancelCurrentTurn, approveStoryboard, rejectStoryboard, confirmKeyframes, approveScreenplay, rejectScreenplay, setWorkflowMode, activateSkill, deactivateSkill, actions, runEffectTests, createGroup, renameGroup, deleteGroup, moveProjectToGroup, settingsScope, getCredentials, getModelApi, getDirectoryPicker, theme, insertAssetChip, insertSkillChip } = props;
			const projects = useStudio((store) => store.projects);
			const groups = useStudio((store) => store.groups);
			const selectedProjectId = useStudio((store) => store.selectedProjectId);
			const selectedNodeId = useStudio((store) => store.selectedNodeId);
			const selectedNodeIds = useStudio((store) => store.selectedNodeIds);
			const nodes = useStudio((store) => nodesOf(store, store.selectedProjectId));
			const nodesRef = (0, react.useRef)(nodes);
			nodesRef.current = nodes;
			const referenceNodes = (0, react.useMemo)(() => nodes.filter((node) => node.isReference === true && node.kind === "image"), [nodes]);
			const assetHandles = (0, react.useMemo)(() => buildAssetHandles(nodes), [nodes]);
			const handleOpenAsset = (0, react.useCallback)((nodeId) => {
				const node = nodesRef.current.find((entry) => entry.id === nodeId);
				if (node === void 0) return;
				if (node.kind === "video" || node.kind === "audio") setPlaybackNodeId(node.id);
				else setPreviewNodeId(node.id);
			}, []);
			const selectedNode = useStudio((store) => selectedNodeOf(store));
			const phase = useStudio((store) => store.phase);
			const error = useStudio((store) => store.error);
			const creating = useStudio((store) => store.creating);
			const historyIndex = useStudio((store) => store.historyIndex);
			const historyLength = useStudio((store) => store.history.length);
			const viewEntry = useStudio((store) => viewOf(store, store.selectedProjectId));
			const view = viewEntry.view;
			const workflow = useStudio((store) => store.selectedProjectId === null ? void 0 : store.workflows[store.selectedProjectId]);
			const workflowStages = (0, react.useMemo)(() => deriveWorkflowStage(workflow?.state, nodes), [workflow?.state, nodes]);
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
				const onPointerDown = (event) => {
					if (shouldKeepMenuOpen(event.target, menuRef.current)) return;
					close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				window.addEventListener("pointerdown", onPointerDown);
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("pointerdown", onPointerDown);
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [menu]);
			(0, react.useEffect)(() => {
				if (blankMenu === null) return;
				const close = () => {
					setBlankMenu(null);
				};
				const onPointerDown = (event) => {
					if (shouldKeepMenuOpen(event.target, blankMenuRef.current)) return;
					close();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				window.addEventListener("pointerdown", onPointerDown);
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("pointerdown", onPointerDown);
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
						display: frameSizeOf({
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
					const usedTitles = /* @__PURE__ */ new Set();
					for (const node of nodes) if (node.title !== void 0 && node.title !== "") usedTitles.add(node.title);
					persistAfter(() => actions.addImportNode(projectId, url, uniqueTitle(file.name, usedTitles), filename, void 0, void 0, probe === null ? void 0 : {
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
				if (insertAssetChip(node.id)) return;
				let token;
				try {
					token = formatRefToken(node.id);
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
				if (insertSkillChip(entry.name)) pushToast(`已填入技能：${entry.title}。补充说明后发送，agent 会加载该技能。`);
				else {
					const token = formatSkillToken(entry.name, entry.title);
					const input = document.querySelector(".csConversation textarea, .csConversation [contenteditable=\"true\"], .csConversation input[type=\"text\"]");
					if (input instanceof HTMLElement && insertReferenceToken(input, token)) pushToast(`已填入技能提示词：${entry.title}。补充说明后发送，agent 会加载该技能。`);
					else {
						navigator.clipboard?.writeText(token).catch(() => {});
						pushToast(`已复制技能提示词：${token}\n粘贴到聊天框并补充说明后发送。`);
					}
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
			/**
			* CV-108：作废 / 恢复片段。失效片段不参与默认合成（compose 只收有效版），
			* 但仍留在画布上可回溯。恢复旧版时接管它的新版本自动作废，保证同一镜位
			* 只有一份有效——否则成片里会同时出现同一镜的两版。
			*/
			const handleToggleRetire = (0, react.useCallback)((id) => {
				if (projectId === null) return;
				const current = nodesRef.current;
				const next = toggleRetire(current, id);
				const byId = new Map(next.map((node) => [node.id, node]));
				persistAfter(() => {
					for (const node of current) {
						const updated = byId.get(node.id);
						if (updated === void 0 || updated === node) continue;
						actions.updateNode(projectId, node.id, {
							retired: updated.retired,
							supersededBy: updated.supersededBy
						});
					}
				});
			}, [
				projectId,
				actions,
				persistAfter
			]);
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
			const handleApproveScreenplay = () => {
				if (projectId !== null) approveScreenplay(projectId).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "批准剧本失败");
				});
			};
			const handleRejectScreenplay = () => {
				if (projectId !== null) rejectScreenplay(projectId, rejectFeedback).then(() => {
					setRejectFeedback("");
				}).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "驳回剧本失败");
				});
			};
			const handleSetMode = (mode) => {
				if (projectId !== null) setWorkflowMode(projectId, mode).catch((cause) => {
					actions.setFailed(cause instanceof Error ? cause.message : "模式切换失败");
				});
			};
			const timelineOrder = (0, react.useMemo)(() => deriveTimelineOrder(nodes, view.timeline), [nodes, view.timeline]);
			/**
			* C2：镜号表（节点 id → 成片第几段，1 起）。
			*
			* 口径与底部时间轴**同源**：同一次 `isShotClip` 筛选 + 同一个 `timelineOrder`
			* 顺序 = `CanvasTimeline` 里 `clips` 的同一份序列（该处已改为直接 filter
			* isShotClip，所以这不是「两处碰巧一致」，而是同一个判断）。因此画布卡上的
			* `#N` 与轨道上的第 N 段永远是同一个数 —— 包括用户拖拽重排之后（重排写回
			* view.timeline → timelineOrder 变 → 两边一起变）。
			*
			* 不在 CanvasNode 里各自数：节点数组的顺序是画布渲染顺序，与成片顺序无关。
			*/
			const shotIndexOf = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				let index = 0;
				for (const node of timelineOrder) {
					if (!isShotClip(node)) continue;
					index += 1;
					map.set(node.id, index);
				}
				return map;
			}, [timelineOrder]);
			const handleTimelineReorder = (ids) => {
				handleViewChange({ timeline: ids });
			};
			const composeSelection = (0, react.useMemo)(() => resolveComposeSelection({
				ordered: timelineOrder,
				excluded: view.composeExcluded ?? [],
				...view.composeBgmNodeId !== void 0 ? { bgmNodeId: view.composeBgmNodeId } : {}
			}), [
				timelineOrder,
				view.composeExcluded,
				view.composeBgmNodeId
			]);
			const handleComposeExcludeToggle = (id) => {
				const current = view.composeExcluded ?? [];
				const next = current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
				handleViewChange({ composeExcluded: next });
			};
			const handleComposeBgmChange = (nodeId) => {
				handleViewChange(nodeId === void 0 ? { composeBgmNodeId: void 0 } : { composeBgmNodeId: nodeId });
			};
			const handleComposeExport = async () => {
				if (projectId === null || composeBusy) return;
				const clipIds = composeSelection.clipIds;
				if (clipIds.length < 1) {
					pushToast("请先在时间轴上放置至少 1 个视频片段，再导出成片", "error");
					return;
				}
				setComposeBusy(true);
				try {
					const { url, duration, width, height, audioComposition, warnings } = await composeStudioVideo(projectId, clipIds, ...composeSelection.bgmNode !== void 0 ? [composeSelection.bgmNode.id] : []);
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
						...audioComposition !== void 0 ? { audioComposition } : {},
						sourceIds: clipIds
					}));
					setFocusNodeId(composedId);
					fitPendingRef.current = true;
					setFitRequestedAt(Date.now());
					const audioLabel = audioComposition === void 0 ? "" : ` · ${AUDIO_COMPOSITION_LABELS[audioComposition]}`;
					pushToast(`成片已生成（${duration.toFixed(1)}s${audioLabel}），已添加到画布并自动定位到视图中心。`, "success");
					for (const warning of warnings ?? []) pushToast(warning, "error");
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
			/**
			* C1：点阶段轨道 → 选中该段全部产物 + 把视口对上去。
			*
			* 「可点击」必须有动作 —— 只做高亮的按钮是假按钮（比不可点更糟：用户会反复点）。
			* 这里给的动作是**定位该阶段产物**：点「定妆」就把定妆那几张卡选中并铺满视口。
			* 无产物的段在渲染层走 `:disabled`，不会进到这里。
			*/
			const handleFocusStage = (0, react.useCallback)((ids) => {
				if (ids.length === 0) return;
				actions.selectNodes(ids);
				requestAnimationFrame(() => {
					surfaceRef.current?.zoomToSelection();
				});
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
					const mediaBox = mediaBoxOf(target);
					const boxAspect = mediaBox.width / mediaBox.height;
					if (Math.abs(boxAspect - mediaAspect) / mediaAspect > .05) {
						const display = frameSizeOf({
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
							shotIndexOf,
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
								onSelectIds: (ids) => {
									actions.selectNodes(ids);
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
					composeBusy,
					composeClipCount: composeSelection.clipIds.length,
					composeEstSeconds: composeSelection.estSeconds,
					composeWarnings: composeSelection.warnings,
					composeExcluded: view.composeExcluded ?? [],
					composeBgmNodeId: composeSelection.bgmNode?.id,
					onToggleComposeExcluded: handleComposeExcludeToggle,
					onComposeBgmChange: handleComposeBgmChange
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "csWorkflowStages",
										role: "group",
										"aria-label": "制作阶段",
										title: `制作阶段：${WORKFLOW_STAGE_LABELS[workflowStages.stage]}（${workflow?.state === "awaiting_approval" ? "分镜待批准" : workflow?.state === "script_review" ? "剧本待批准" : workflow?.state === "keyframe_review" ? "关键帧待确认" : workflow?.state === "executing" ? "制作中" : "需求沟通中"}）`,
										children: WORKFLOW_STAGE_LABELS.map((label, i) => {
											const ids = workflowStages.idsByStage[i] ?? [];
											return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [i > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "csStageLink" + (i <= workflowStages.stage ? " csStageLinkDone" : "") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: "csWorkflowStage" + (i === workflowStages.stage ? " csStageNow" : i < workflowStages.stage ? " csStageDone" : ""),
												disabled: ids.length === 0,
												title: ids.length === 0 ? `「${label}」阶段暂无产物` : `定位「${label}」阶段的 ${ids.length} 个产物`,
												onClick: () => {
													handleFocusStage(ids);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}), label]
											})] }, label);
										})
									}),
									workflow?.state !== "script_review" && workflow?.state !== "awaiting_approval" && workflow?.state !== "keyframe_review" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "csWorkflowTime",
										title: "画布上已产出的制作节点数（便签等手工件不计）",
										children: [
											"已产出 ",
											WORKFLOW_STAGE_LABELS.map((_, i) => workflowStages.idsByStage[i]?.length ?? 0).reduce((sum, n) => sum + n, 0),
											" 个节点 · 阶段 ",
											WORKFLOW_STAGE_LABELS[workflowStages.stage]
										]
									}),
									workflow?.state === "script_review" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csWorkflowApproval",
										children: [
											clapIcon,
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowMessage",
												children: "剧本已提交到画布，请确认故事方向后批准"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "text",
												className: "csRejectInput",
												value: rejectFeedback,
												onChange: (event) => {
													setRejectFeedback(event.target.value);
												},
												onKeyDown: (event) => {
													if (event.key === "Enter") handleRejectScreenplay();
												},
												placeholder: "不满意哪里？（可选，随驳回转给 AI）",
												title: "填写具体意见（如：结尾反转太生硬），AI 将按意见重写剧本；留空则只打回",
												maxLength: 500
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "csPrimary",
												onClick: handleApproveScreenplay,
												children: "批准剧本"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												onClick: handleRejectScreenplay,
												children: "驳回，继续修改"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "csWorkflowState",
												children: "批准后进入分镜规划"
											})
										]
									}),
									workflow?.state === "awaiting_approval" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "csWorkflowApproval",
										children: [
											clapIcon,
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
											clapIcon,
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
						className: "csChat",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
							className: "csConversation",
							children: renderSlot("conversation", {})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AssetChipPreview, {
							assets: assetHandles,
							skills: VISIBLE_CATALOG,
							onOpen: handleOpenAsset
						})]
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
						if (target === void 0 || target.url === void 0) return null;
						if (target.kind === "video") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VideoPlayerModal, {
							title: target.title ?? "视频",
							url: target.url,
							onClose: () => {
								setPlaybackNodeId(null);
							}
						});
						if (target.kind === "audio") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AudioPlayerModal, {
							title: target.title ?? "音频",
							url: target.url,
							...target.lyrics !== void 0 ? { lyrics: target.lyrics } : {},
							...target.duration !== void 0 ? { duration: target.duration } : {},
							onClose: () => {
								setPlaybackNodeId(null);
							}
						});
						return null;
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
						onToggleRetire: handleToggleRetire,
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
		//#region src/style-grid.ts
		/**
		* CV-151：风格 GIF 网格的判定逻辑（纯函数，无 JSX / 无 IO）。
		*
		* 从 `client/question-capture.tsx` 抽出到根级：① Host 侧 node --test 可直接
		* 单测（client 打包产物是单文件 bundle，测试够不着）；② 客户端按既有先例
		* （`skill-catalog.ts`）引用根级模块 —— 两要件：`tsconfig.client.json` include
		* 追加 + import 带 `.js` 后缀。
		*
		* 数据职责分工（防 CV-116 式四处漂移）：
		* - 本表只管「选项文案 → skill 名」；
		* - GIF 是否真实存在由 `skill-catalog.ts` 的 `demo` 字段单点决定（渲染层查它）；
		* - 预设名与 Look tokens 的权威在 `style-presets.md` 预设表（测试对账两侧）。
		*/
		/** 风格预设名 → 上游 skill 名（与 style-presets.md 预设表首列逐字对应）。 */
		const STYLE_DEMO_MAP = {
			"极简产品广告": "minimalist-product-ad-generator",
			"3D 动画短片": "3d-animation-short-generator",
			"纸艺定格讲解": "papercraft-stop-motion-explainer",
			"品牌宣传": "brand-promo-video-generator",
			"MV 字幕": "music-video-subtitle-generator",
			"合作游戏开场": "co-op-game-intro-generator",
			"纸拼贴讲解": "paper-collage-explainer-generator",
			"手绘实景融合": "handdrawn-live-video-generator",
			"东方神话视觉导演": "oriental-mythic-visual-director",
			"街采跟拍": "direct-street-interview-video",
			"惊吓遭遇战": "stage-startle-to-truce-encounter"
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
		/**
		* 是否按「风格 GIF 网格」渲染（CV-151 前的旧规则：任一选项命中即入网格）。
		*
		* 旧规则在 Look 采集类问题上会误触发：样张确认（②-2）的选项里只要顺带提到
		* 一个预设名，宽松匹配就命中 → 网格渲染，而网格分支对未命中选项 `return null`
		* **整个吞掉**（用户选不到「我来说说」这类按钮）。改为「几乎全部选项都是预设」
		* 才进网格：
		* - 命中数 ≥ 2（单个预设名撑不起网格，走文字按钮足够）；
		* - 未命中 ≤ 1（预设出口 ②-3 常附一个「我自己描述」类兜底选项——它照常渲染
		*   成文字按钮，不再丢，见 `question-capture.tsx` 的 unmatched 分支）。
		*/
		function shouldRenderStyleGrid(options) {
			const matched = options.filter((option) => styleDemoSkill(option) !== null).length;
			return matched >= 2 && matched >= options.length - 1;
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
					shouldRenderStyleGrid(data.options) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csStyleDemoGrid",
						children: data.options.map((option) => {
							const skill = styleDemoSkill(option);
							if (skill === null) return null;
							const recommended = option.includes("（推荐）");
							const label = option.replace("（推荐）", "").trim();
							const demo = getSkillEntry(skill)?.demo;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `csStyleDemoCard${selected.includes(option) ? " csSelected" : ""}`,
								disabled: settled,
								onClick: () => {
									handleOptionClick(option);
								},
								children: [demo === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "csStyleDemoFallback",
									title: "可正常选用，仅暂无预览动画",
									children: "暂无预览"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: "csStyleDemoImg",
									loading: "lazy",
									src: `/canvas-studio/style-demos/${demo}`,
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
					}), data.options.some((option) => styleDemoSkill(option) === null) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "csQuestionOptions",
						children: data.options.filter((option) => styleDemoSkill(option) === null).map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: selected.includes(option) ? "csSelected" : void 0,
							disabled: settled,
							onClick: () => {
								handleOptionClick(option);
							},
							children: option
						}, option))
					})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
			},
			audio: {
				width: 260,
				height: 132
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
			const promoteDeferredAssets = (projectId, deferred) => {
				for (const item of deferred) (async () => {
					try {
						const filename = await promoteStudioImage(projectId, item.assetFile);
						const node = storeInstance.getSnapshot().nodes[projectId]?.find((entry) => entry.url === item.url);
						if (node === void 0 || node.filename === filename) return;
						storeInstance.actions.updateNode(projectId, node.id, { filename });
						persistCanvasQueued(projectId);
					} catch (cause) {
						ctx.logger.warn(`canvas-studio: deferred Drama promote failed for ${item.assetFile}: ${cause instanceof Error ? cause.message : String(cause)}`);
					}
				})();
			};
			/** 内容指纹（SHA-256 hex）：同字节图片复用已有节点（草稿还原重发 / 双击免疫）。 */
			const sha256Hex = async (buffer) => {
				const digest = await crypto.subtle.digest("SHA-256", buffer);
				return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
			};
			/** 按内容哈希找已有素材节点（contentHash 持久在 canvas.json，重启后依然生效）。 */
			const findNodeByHash = (projectId, hash) => (storeInstance.getSnapshot().nodes[projectId] ?? []).find((node) => node.kind === "image" && node.contentHash === hash);
			const divertAttachments = async (files, text, signal) => {
				if (files.length === 0) return void 0;
				const projectId = resolveActiveProjectId();
				if (projectId === null) return void 0;
				const usedTitles = /* @__PURE__ */ new Set();
				for (const node of storeInstance.getSnapshot().nodes[projectId] ?? []) if (node.title !== void 0 && node.title !== "") usedTitles.add(node.title);
				const titles = files.map((file) => uniqueTitle(file.name, usedTitles));
				const prepared = await Promise.all(files.map(async (file, i) => {
					const buffer = await file.arrayBuffer();
					const [dataBase64, contentHash] = await Promise.all([Promise.resolve(bytesToBase64(new Uint8Array(buffer))), sha256Hex(buffer)]);
					const { url, assetFile } = await uploadLocalStudioImageDeferred(projectId, file.name, dataBase64, signal);
					const title = titles[i];
					let display;
					try {
						const bitmap = await createImageBitmap(new Blob([buffer]));
						display = {
							...previewSizeOf({
								width: bitmap.width,
								height: bitmap.height
							}),
							mediaWidth: bitmap.width,
							mediaHeight: bitmap.height
						};
						bitmap.close();
					} catch {
						display = void 0;
					}
					return {
						url,
						assetFile,
						title,
						display,
						contentHash
					};
				}));
				const tokens = [];
				const deferred = [];
				for (const item of prepared) {
					const existing = findNodeByHash(projectId, item.contentHash);
					if (existing !== void 0) {
						tokens.push(formatRefToken(existing.id));
						continue;
					}
					storeInstance.actions.addImportNode(projectId, item.url, item.title, void 0, void 0, true, item.display, item.contentHash);
					const created = (storeInstance.getSnapshot().nodes[projectId] ?? []).find((node) => node.url === item.url);
					tokens.push(formatRefToken(created?.id ?? item.title));
					deferred.push({
						url: item.url,
						assetFile: item.assetFile
					});
				}
				if (deferred.length > 0) {
					persistCanvasQueued(projectId);
					promoteDeferredAssets(projectId, deferred);
				}
				const tokenText = tokens.join(" ");
				return text.trim() === "" ? tokenText : `${text}\n${tokenText}`;
			};
			const currentSessionId = () => sessionSvc.list.getSnapshot().current;
			const activeAssetHandles = () => {
				const projectId = storeInstance.getSnapshot().selectedProjectId;
				if (projectId === null) return [];
				return buildAssetHandles(storeInstance.getSnapshot().nodes[projectId] ?? []);
			};
			registerCanvasAssetSourceWhenReady(ctx, {
				assets: activeAssetHandles,
				sessionId: currentSessionId
			});
			/** 「引用到对话」插入真 chip；false = 调用方降级为纯文本注入。 */
			const insertAssetChipForNode = (nodeId) => {
				const asset = activeAssetHandles().find((item) => item.nodeId === nodeId);
				if (asset === void 0) return false;
				return insertAssetChip(ctx, currentSessionId(), asset);
			};
			registerCanvasSkillSourceWhenReady(ctx, {
				skills: () => VISIBLE_CATALOG,
				sessionId: currentSessionId
			});
			const insertSkillChipForName = (name) => {
				const skill = VISIBLE_CATALOG.find((item) => item.name === name);
				if (skill === void 0) return false;
				return insertSkillChip(ctx, currentSessionId(), skill);
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
			ctx.effect(() => {
				let timer = null;
				let attempts = 0;
				let installed;
				const tryInstall = () => {
					if (installed !== void 0) return;
					const conversation = ctx.get("conversation");
					if (conversation === void 0) {
						attempts += 1;
						if (attempts <= 60 && timer !== null) return;
						if (timer !== null) {
							clearInterval(timer);
							timer = null;
						}
						return;
					}
					if (timer !== null) {
						clearInterval(timer);
						timer = null;
					}
					if (typeof conversation.sendSession !== "function" || typeof conversation.draftImages !== "function" || typeof conversation.releaseDraftImages !== "function") {
						ctx.logger.warn("canvas-studio: conversation sendSession facade not detected (upstream changed?), attachment divert disabled — native behavior preserved");
						return;
					}
					const original = conversation.sendSession;
					conversation.sendSession = (...args) => {
						const [session, text, attachmentIds, mode, signal] = args;
						if (attachmentIds.length === 0) return original.apply(conversation, args);
						const attachments = conversation.draftImages(attachmentIds);
						if (attachments.length === 0 || attachments.length !== attachmentIds.length) return original.apply(conversation, args);
						const files = attachments.map((attachment) => attachment.file);
						return divertAttachments(files, text, signal).then((divertedText) => {
							if (divertedText === void 0) return original.apply(conversation, args);
							return original.call(conversation, session, divertedText, [], mode, signal).then((result) => {
								if (result.kind === "success") conversation.releaseDraftImages(attachments);
								return result;
							});
						}).catch((cause) => {
							ctx.logger.warn(`canvas-studio: attachment divert failed, fallback to native: ${cause instanceof Error ? cause.message : String(cause)}`);
							return original.apply(conversation, args);
						});
					};
					installed = {
						conversation,
						original
					};
				};
				timer = setInterval(tryInstall, 500);
				tryInstall();
				return () => {
					if (timer !== null) {
						clearInterval(timer);
						timer = null;
					}
					if (installed !== void 0) {
						installed.conversation.sendSession = installed.original;
						installed = void 0;
					}
				};
			}, "canvas-studio: conversation attachment divert");
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
			const approveScreenplay = async (projectId) => {
				await applyWorkflowAction(projectId, "approve_script");
				wakeAgent("剧本已批准，请进入分镜规划");
			};
			const rejectScreenplay = async (projectId, feedback) => {
				await applyWorkflowAction(projectId, "reject_script");
				const trimmed = feedback?.trim();
				wakeAgent(trimmed !== void 0 && trimmed.length > 0 ? `剧本已驳回，请按以下意见修改后重新提交：${trimmed}` : "请按我的修改意见重写剧本并重新提交审批");
			};
			const setWorkflowMode = async (projectId, mode) => {
				const before = storeInstance.getSnapshot().workflows[projectId];
				const workflow = await postStudioWorkflowAction(projectId, "setMode", mode);
				storeInstance.actions.setWorkflow(projectId, workflow);
				if ((before?.state === "awaiting_approval" || before?.state === "script_review" || before?.state === "keyframe_review") && workflow.state === "executing") wakeAgent("继续");
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
						const createProject = async (name, groupId, plan) => {
							storeInstance.actions.setCreating(true);
							try {
								const project = await createStudioProject(name, groupId, plan);
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
							approveScreenplay,
							rejectScreenplay,
							setWorkflowMode,
							runEffectTests,
							activateSkill,
							deactivateSkill,
							settingsScope: ctx.settingsScope,
							getCredentials: () => ctx.get("connection")?.api?.credentials,
							getModelApi: () => ctx.get("connection")?.api,
							getDirectoryPicker: () => ({ pick: () => ctx.workspaces.pickDirectory() }),
							insertAssetChip: insertAssetChipForNode,
							insertSkillChip: insertSkillChipForName,
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