/** 画布媒体工具名 → 产物类型。 */
export const STUDIO_TOOL_KINDS = {
    image_generate: 'image',
    video_generate: 'video',
    video_composite: 'video',
    style_transfer: 'image',
    storyboard_generate: 'image',
};
/** 判断工具名是否属于画布媒体工具。 */
export function isStudioTool(name) {
    return Object.prototype.hasOwnProperty.call(STUDIO_TOOL_KINDS, name);
}
/**
 * P7 工作流工具：结果会改变审批门禁状态 / 落分镜表节点 / 弹出点选问题。
 * 它们不产生媒体产物（不放占位节点），但 tool/call 与 tool/result 后客户端
 * 必须刷新工作流状态与画布，否则审批条与点选卡片永远不出现。
 */
export const WORKFLOW_TOOLS = new Set([
    'submit_storyboard_for_approval',
    'submit_keyframes_for_approval',
    'ask_user_choice',
]);
/**
 * 从 tool/result 的内容块中抽取托管 URL。
 * Host 的 renderResult 产出形如 `已生成产物: <url> (WxH...)` 的文本块，产物
 * 是完整 http(s) URL，正则可稳定提取。
 */
export function extractAssetUrl(blocks) {
    if (blocks === undefined)
        return null;
    for (const block of blocks) {
        if (block.type === 'text') {
            const match = /https?:\/\/[^\s)）]+/.exec(block.text);
            if (match !== null)
                return match[0];
        }
    }
    return null;
}
/** 从 tool/call 的 arguments 字段解析出参考图 URL（video 工具的 imageUrl）。 */
function sourceUrlFromArguments(value) {
    if (value === undefined || value === null)
        return undefined;
    let parsed = value;
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value);
        }
        catch {
            return undefined;
        }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return undefined;
    const imageUrl = parsed.imageUrl;
    return typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : undefined;
}
/**
 * 创建 P4 的 conversationEvents 节点 definition。
 * @param hooks - 与画布 store 的接线（React 之外）。
 * @returns 节点 definition，供 `ctx.conversationEvents.register` 注册。
 */
export function createAssetCaptureDefinition(hooks) {
    const onToolCall = hooks.onToolCall ?? (() => { });
    const onToolError = hooks.onToolError ?? (() => { });
    const onToolFinished = hooks.onToolFinished ?? (() => { });
    const onWorkflowToolStarted = hooks.onWorkflowToolStarted ?? (() => { });
    const match = (event) => {
        if (event.type === 'tool/call') {
            const data = event.data;
            if (isStudioTool(data.name) || WORKFLOW_TOOLS.has(data.name)) {
                return { id: String(data.callId), role: 'start' };
            }
            return null;
        }
        if (event.type === 'tool/result') {
            // 画布工具的任意结果都视为 update（触发画布重载）。不再要求
            // surfaceOp==='append'：重载是幂等操作，compaction 重放 / 崩溃合成
            // 的副本只会重复触发一次无害的本地 reload，不会产生重复节点。
            // CR-018：message.source 是盲访问点——事件缺该结构时直接不匹配，
            // 避免 TypeError 阻断整个事件处理（tool/result 事件不带工具名字段，
            // 无法按名过滤；reload 幂等，非画布工具多触发一次无害）。
            const source = event.data.message?.source;
            if (source === undefined || source === null || source.callId === undefined || source.callId === null)
                return null;
            return { id: String(source.callId), role: 'update' };
        }
        return null;
    };
    return {
        kind: 'canvas-studio-asset',
        target: 'chat',
        match,
        start: (_context, startMatch) => {
            const data = startMatch.event.data;
            const toolName = data.name;
            const rawArguments = typeof data.arguments === 'string' ? data.arguments : '';
            // P7 工作流工具：无媒体产物，不放占位节点；ask_user_choice 需要延迟
            // 刷新一两次把点选卡片拉出来，其余在结算时刷新。
            const kind = WORKFLOW_TOOLS.has(toolName) ? 'workflow' : STUDIO_TOOL_KINDS[toolName];
            if (kind === 'workflow') {
                const projectId = hooks.getSelectedProjectId();
                if (projectId !== null)
                    onWorkflowToolStarted(projectId, toolName);
            }
            else {
                const projectId = hooks.getSelectedProjectId();
                if (projectId !== null) {
                    onToolCall(projectId, {
                        toolName,
                        runId: String(data.callId),
                        kind,
                        arguments: rawArguments,
                    });
                }
            }
            return {
                toolName,
                sourceUrl: sourceUrlFromArguments(data.arguments) ?? '',
                kind,
            };
        },
        update: (context, updateMatch) => {
            const state = context.state;
            const projectId = hooks.getSelectedProjectId();
            if (updateMatch.event.type === 'tool/result' && projectId !== null) {
                if (state.kind === 'workflow') {
                    // P7：工作流工具结算（成功或失败）——刷新工作流状态与画布，
                    // 让审批条与分镜表节点即时出现。
                    onToolFinished(projectId, state.toolName);
                    return state;
                }
                const data = updateMatch.event.data;
                if (data.error !== undefined) {
                    // 工具失败（含用户打断）：占位节点标记错误，保留在画布上供重试。
                    const error = data.error;
                    const message = typeof error === 'string'
                        ? error
                        : error !== null && typeof error === 'object' && typeof error.message === 'string'
                            ? error.message
                            : '生成失败';
                    onToolError(projectId, String(data.message.source.callId), message);
                }
                else {
                    // 生成产物的节点由 Host 在落盘时写入 canvas.json；这里只触发画布重载，
                    // 让客户端从单一真相源拿到最新节点（含血缘 sourceIds），不再依赖
                    // 解析事件渲染文本里的 URL —— 那在后端异常 / 渲染差异时并不可靠。
                    hooks.reloadCanvas(projectId);
                }
            }
            return state;
        },
        buildViewNode: () => null,
    };
}
