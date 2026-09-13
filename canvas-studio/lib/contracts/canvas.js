/**
 * Shared canvas-node wire types for the Canvas Studio host persistence and the
 * browser client. Pure types only: both halves import them and erase them at
 * build time, so this file never appears in the runtime bundles.
 *
 * The shape mirrors the WL-AI-Director `LayerData` model (see plan §7.2 and
 * docs/plans/canvas-studio-reference-integration.md S1) extended with the
 * fields Canvas Studio renders: visual state (locked/visible/opacity/zIndex),
 * generation provenance (operationType/generationPrompt/duration), transient
 * generation state (isLoading/progress/error), and grouping (parentId).
 * Bloodline is derived from `sourceIds` at render time — there is no separate
 * edge table (plan §7.3: bloodline IS the edge).
 */
/**
 * 音频节点默认尺寸（CV-128 / CV-130）。
 *
 * Host（`generate.ts` 落盘）与 client（`NODE_SIZE` / 占位节点尺寸表）共用同一
 * 常量——此前 `260×84` 是两边各自手写的，改一处忘一处就会让新落盘节点与
 * 用户拖拽过的旧节点对不齐。
 *
 * C10 起高度 132，预算 = 镜头条 chrome 48（头 26 + 脚 22）+ 体区 84
 * （16 padding + 波形 22 + 播放条 24 + 歌词 14 + 8 间距）。改前是 116 =
 * 卡内标题行 18 + 其余 —— 标题行与时长已上交给卡片的头/脚，所以净增 16 而不是
 * 把内容挤小：音频卡的波形与播放条一丝没变。
 *
 * `projects.ts` 的规范化会按本常量**向上**修正过矮的节点，所以调大是自愈的
 * （旧音频卡下次打开自动补足高度，不会留下一个把播放条裁掉一半的卡）。
 */
export const AUDIO_NODE_WIDTH = 260;
export const AUDIO_NODE_HEIGHT = 132;
/**
 * 纯器乐的歌词占位值（CV-127 起）。官方要求纯器乐必须显式写 `[Instrumental]`
 * ——传空串虽能过校验但语义不明。
 *
 * 放在共享契约里（而非 Host 的 generate.ts）：UI 也要用它区分「纯器乐」与
 * 「真歌词」——节点 `lyrics` 等于该串时卡片显示「纯器乐」而不是这个方括号关键字。
 */
export const INSTRUMENTAL_LYRICS = '[Instrumental]';
/**
 * CV-143：音轨构成的中文标签。放共享契约而非各端各写一份——Host 的工具结果
 * 文案与客户端角标必须说同一句话，否则用户看到的和模型读到的不一致。
 */
export const AUDIO_COMPOSITION_LABELS = {
    native: '环境声',
    'native+bgm': '环境声 + BGM',
    bgm: '纯 BGM',
    none: '无声',
};
/** CV-143：音轨构成的悬停解释（角标 title，说明「为什么是这个构成」）。 */
export const AUDIO_COMPOSITION_HINTS = {
    native: '单镜整出，保留该镜原生环境声',
    'native+bgm': '单镜整出，原生环境声与 BGM 叠混',
    bgm: '多镜拼接，各镜环境声已丢弃，成片只有 BGM',
    none: '多镜拼接且未提供 BGM，各镜环境声已丢弃 —— 成片无声',
};
/** Current canvas document version (4: project-level consistency assets). */
export const CANVAS_DOCUMENT_VERSION = 4;
/** Viewport defaults used when a document predates v3 or a field is invalid. */
export const VIEW_DEFAULTS = {
    x: 0,
    y: 0,
    scale: 1,
    // 验收反馈（2026-08-24）：面板默认收起，画布默认最大化内容区。
    layersOpen: false,
    minimapVisible: false,
};
/** Defaults applied when migrating nodes that predate a field. */
export const NODE_DEFAULTS = {
    locked: false,
    visible: true,
    opacity: 1,
    flipX: false,
    flipY: false,
};
/**
 * CV-023/025：用户首条创意节点的 toolName 标记。客户端（幂等去重）与 Host
 * （分镜/文案节点自动挂接创意血缘、落位）共用同一常量。
 */
export const BRIEF_NODE_TOOL = 'user_brief';
