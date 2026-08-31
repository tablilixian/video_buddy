/**
 * Canvas Studio browser API: same-origin fetch helpers over the project
 * registry and canvas routes (the community-market client fetch pattern).
 */
import type { StudioProject, StudioWorkflow, StudioWorkflowMode } from '../contracts/project.js';
import type { StudioCanvasNode, StudioCanvasView, StudioVideoStylePayload } from '../contracts/canvas.js';
import type { GenerateParams } from '../generate.js';
/** HTTP facts used to localize safe Client-facing Studio failures. */
export declare class StudioApiError extends Error {
    readonly status: number;
    readonly code?: string | undefined;
    constructor(message: string, status: number, code?: string | undefined);
}
/** List all registered projects. */
export declare function listStudioProjects(signal?: AbortSignal): Promise<readonly StudioProject[]>;
/** Create a project and return its record. */
export declare function createStudioProject(name: string, signal?: AbortSignal): Promise<StudioProject>;
/** Delete a project by id (removes its directory and registry record). */
export declare function deleteStudioProject(id: string, signal?: AbortSignal): Promise<void>;
/** P7：读某项目的创作工作流（模式 + 审批门禁状态），缺失字段降级为默认值。 */
export declare function getStudioWorkflow(projectId: string, signal?: AbortSignal): Promise<StudioWorkflow>;
/** P7：工作流动作（批准 / 驳回 / 确认关键帧 / 切换模式），返回更新后的工作流。 */
export declare function postStudioWorkflowAction(projectId: string, action: 'approve' | 'reject' | 'confirm_keyframes' | 'setMode', mode?: StudioWorkflowMode, signal?: AbortSignal): Promise<StudioWorkflow>;
/** P7 点选式澄清：提交用户对当前问题的选择，返回更新后的工作流（问题已带答案）。 */
export declare function answerStudioQuestion(projectId: string, value: string, signal?: AbortSignal): Promise<StudioWorkflow>;
/** Load a project's persisted canvas (nodes + viewport; view is null pre-v3). */
export declare function loadStudioCanvas(projectId: string, signal?: AbortSignal): Promise<{
    nodes: StudioCanvasNode[];
    view: StudioCanvasView | null;
}>;
/**
 * 把 `Uint8Array` 编码为标准 base64。
 *
 * 不能用 `File.text() + btoa(unescape(encodeURIComponent(text)))` 这条捷径：
 * `File.text()` 会按 UTF-8 解码二进制，把 0x80–0xFF 的字节替换成 U+FFFD，
 * 导致 PNG/JPEG 头部字节被破坏，落地后再被 `<img>` 加载会触发 `onerror`。
 * 这里直接走字节，单测里也用真实 PNG magic 字节校验过。
 */
export { bytesToBase64 } from '../encoding.js';
/** P8.1：本地图片上传（base64）→ 返回同源 URL + Drama filename（供生成工具引用）。 */
export declare function uploadLocalStudioImage(projectId: string, name: string, dataBase64: string, signal?: AbortSignal): Promise<{
    url: string;
    filename: string;
}>;
/**
 * P8.4：本地参考视频上传（原始字节流，免 base64 膨胀）→ Host 抽帧提风格。
 * 返回帧列表（含 Drama filename）与风格归纳文本，由调用方落成画布节点。
 */
export declare function uploadStudioVideo(projectId: string, file: File, signal?: AbortSignal): Promise<StudioVideoStylePayload>;
/** Persist a project's full canvas node list plus the current viewport state. */
export declare function saveStudioCanvas(projectId: string, nodes: readonly StudioCanvasNode[], view: StudioCanvasView, signal?: AbortSignal): Promise<void>;
/** P9.2/P9.3：合成成片。提交选中的分镜视频 clip id（与可选 BGM 节点 id），返回成片同源 URL + 时长。 */
export declare function composeStudioVideo(projectId: string, clipIds: readonly string[], bgmNodeId?: string, signal?: AbortSignal): Promise<{
    url: string;
    duration: number;
    width?: number;
    height?: number;
}>;
/**
 * 节点级重试 / 修改提示词：按原参数（可带 overrides）重新请求 Host 生成，
 * 并把结果写回原节点（retryOf，不产生新边）。成功后返回新的产物 URL。
 */
export declare function retryStudioNode(projectId: string, node: StudioCanvasNode, overrides?: Partial<GenerateParams>, signal?: AbortSignal): Promise<{
    url: string;
}>;
