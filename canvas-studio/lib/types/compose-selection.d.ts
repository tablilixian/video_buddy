/**
 * CV-006 / CV-007：合成选择的派生逻辑（纯函数，无 JSX / 无 IO）。
 *
 * 从 `client/StudioFrame.tsx` 抽出到根级（按 `style-grid.ts` 先例）：① Host 侧
 * node --test 可直接单测（client 打包产物是单文件 bundle，测试够不着）；② 客户端
 * 引用根级模块两要件：`tsconfig.client.json` include 追加 + import 带 `.js` 后缀。
 *
 * 职责单一：把「时间轴顺序 + 排除勾选 + BGM 下拉选择」归约成一次 `/compose` 请求
 * 需要的全部输入（clipIds / bgmNodeId / 预计成片时长 / 软提示）。硬校验不在这里做
 * —— BGM 短于成片的精确差额由服务端 CV-138 守卫报错，本模块只出 amber 软提示。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** BGM 时长与预计成片时长的容差（秒）：差值在此以内不提示，与服务端守卫口径一致。 */
export declare const BGM_TOLERANCE_SECONDS = 0.05;
/** resolveComposeSelection 的输入：时间轴有效顺序 + 用户勾选态。 */
export type ComposeSelectionInput = {
    /** 时间轴有效顺序（deriveTimelineOrder 产物，含全部 kind）。 */
    ordered: readonly StudioCanvasNode[];
    /** 用户显式排除的片段 id（view.composeExcluded）。 */
    excluded: readonly string[];
    /** 用户选中的 BGM 节点 id（view.composeBgmNodeId）；缺省 = 不使用。 */
    bgmNodeId?: string;
};
/** 一次合成导出的完整输入与提示。 */
export type ComposeSelection = {
    /** 实际提交给 /compose 的片段 id（排除项与作废片段均已剔除）。 */
    clipIds: string[];
    /** 校验通过的 BGM 节点；undefined = 不使用（或引用失效自动回退）。 */
    bgmNode?: StudioCanvasNode;
    /** 预计成片时长（秒）= Σ 有效纳入片段的真值 duration（缺探测值按 0 计）。 */
    estSeconds: number;
    /** BGM 可能短于成片的软提示（不拦，服务端守卫兜底报精确差额）。 */
    warnings: string[];
    /** bgmNodeId 非空但节点已失效（删除/非音频/作废）——调用方据此把下拉回退「不使用」。 */
    bgmInvalid: boolean;
};
/**
 * 片段可参与合成的有效性。
 *
 * CV-160：**委托给 `shot-versions.isShotClip`（全仓唯一权威口径）**——此前这里
 * 内联了 `kind==='video' && !retired && !supersededBy`，漏掉「非成片节点」一条，
 * 与 Host 的 `defaultComposeClips` 分叉：成片节点（kind=video + toolName=compose）
 * 被当成片段计入预计时长（15.51s → 30.99s），并会作为 clipId 再拼进下一次成片。
 * 判片段的口径只允许有一份，UI / 估算 / Host 必须同源。
 */
export declare function isComposableClip(node: StudioCanvasNode): boolean;
/** 合成产物（成片）：时间轴上要显示但**不计入**片段数与预计时长（CV-160）。 */
export declare function isComposedFilm(node: StudioCanvasNode): boolean;
/** BGM 候选有效性：只收存活的音频节点（CV-006 拍板：不列成片节点，少一个歧义源）。 */
export declare function isValidBgmNode(node: StudioCanvasNode | undefined): node is StudioCanvasNode;
/**
 * 把时间轴 + 勾选态归约成一次合成请求的输入。
 * 纯函数：不读 store、不发请求；排除语义 = 「显式排除优先于一切」，作废片段
 * 在勾选区直接禁用（不进 excluded），所以这里不需要再防两者冲突。
 */
export declare function resolveComposeSelection(input: ComposeSelectionInput): ComposeSelection;
