/**
 * CV-023 创意捕获：项目会话第一条真人消息自动落为画布「创意」文本节点 ——
 * 画布的叙事锚点（创意 → 素材 → 生成物的血缘起点）。
 *
 * 捕获规则（方案 A，已拍板）：
 * - 只认 `user/message` 事件且 `source.kind === 'user'`（真人输入）；合成注入
 *   （skill 内容 / 文件变更通知 / 目录快照等 plugin/model/tool 来源）不触发。
 * - 每项目至多一个创意节点：幂等去重由 store 的 `addBriefNode` 负责（按
 *   `BRIEF_NODE_TOOL` 标记），会话历史重放反复触发也是空操作 —— 这同时让
 *   旧项目在首次打开时自动补落创意节点（历史重放会走一遍 start）。
 *
 * 纯副作用的 state-only definition：不声明 target、buildViewNode 恒 null，
 * 对话区渲染不受影响（模式同 asset-capture）。
 */
/** definition 与 store / 持久化之间的接线点（apply 世界注入）。 */
export interface BriefCaptureHooks {
    /** 当前画布绑定的项目 id；未绑定时为 null（不捕获）。 */
    getSelectedProjectId(): string | null;
    /** 选中项目画布已存在创意节点时返回 true（幂等去重）。 */
    hasBriefNode(projectId: string): boolean;
    /** 写入创意节点并持久化（接线层负责画布未载入时的暂存与补落）。 */
    onBrief(projectId: string, text: string): void;
}
/** definition 自身关心的会话事件最小形态（运行时按 type 收窄）。 */
interface BriefCaptureEvent {
    readonly type: string;
    readonly data: unknown;
}
/** match 的返回（与 ConversationMatchResult 结构兼容）。 */
interface BriefCaptureMatchResult {
    readonly id: string;
    readonly role: 'start' | 'update';
}
/**
 * 创建创意捕获 definition（state-only：start/update 返回 null 状态）。
 * @param hooks - 与画布 store 的接线。
 */
export declare function createBriefCaptureDefinition(hooks: BriefCaptureHooks): {
    kind: string;
    match(event: BriefCaptureEvent): BriefCaptureMatchResult | null;
    start: (_context: unknown, startMatch: {
        readonly event: BriefCaptureEvent;
    }) => null;
    update: () => null;
};
export {};
