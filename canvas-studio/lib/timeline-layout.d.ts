/**
 * DD-04a：时间轴骨架的布局数学 —— 全部纯函数，不依赖 DOM。
 *
 * 为什么抽成根级模块：这是「片段宽度比例」「播放头位置」两条数学期望的唯一
 * 权威实现（与 canvas-lineage.ts 同理）。组件里只消费、不重算；tests/timeline
 * 把设计稿里踩过的「数学期望」直接固化为断言。
 *
 * 坐标系：时间轴以「合成片段顺序」为一维轴，单位秒。rulerMax 是标尺右端点
 * （总时长向上取整到刻度步长），片段按顺序从 0 累加排布。
 */
/** 单个片段的布局输入。 */
export interface TimelineClipInput {
    id: string;
    /**
     * ffprobe 真值时长（秒）。未探测到时 undefined：布局按 FALLBACK_CLIP_S 占位
     * （否则无宽不可点），但 `measured=false`，UI 标签**不得**显示假时长
     * （CV-007 原则：无探测值回落，不造假数据）。
     */
    duration?: number | undefined;
}
/** 单个片段的布局结果（秒坐标 + 相对 rulerMax 的百分比）。 */
export interface ClipSpan {
    id: string;
    /** 片段起点（秒）。 */
    start: number;
    /** 参与布局的时长（真值或 FALLBACK 占位）。 */
    span: number;
    /** 时长是否为 ffprobe 真值。 */
    measured: boolean;
    /** 轨道内 left（%，相对 rulerMax）。 */
    leftPct: number;
    /** 轨道内宽度（%，相对 rulerMax）。 */
    widthPct: number;
}
/** 未探测到真值时长的片段占位时长（秒）。 */
export declare const FALLBACK_CLIP_S = 1;
/**
 * 标尺右端点：总时长向上取整到刻度步长的整数倍。
 * 例：total=10.7 → step=2 → rulerMax=12（刻度 0,2,4,…,12）。
 */
export declare function niceRulerMax(totalSeconds: number): number;
/**
 * 标尺刻度：从 0 到 rulerMax、按自适应步长均匀分布。
 * 返回 t（秒）与 pct（0-100，相对 rulerMax）。
 */
export declare function rulerTicks(rulerMax: number): readonly {
    t: number;
    pct: number;
}[];
/**
 * 片段布局：按顺序从 0 累加排布，宽度 = 有效时长 / rulerMax。
 *
 * 不变量（tests/timeline 固化）：
 * 1. 任意两片段宽度之比 == 其有效时长之比（真值片段严格成立）；
 * 2. 真值片段的宽度比例 == duration / 总时长（相对累计起点同理）；
 * 3. 片段首尾相接无重叠、无间隙（start[i+1] === start[i] + span[i]）。
 */
export declare function planClipLayout(clips: readonly TimelineClipInput[]): readonly ClipSpan[];
/** 标尺总时长（布局片段的有效时长之和；空 → 0）。 */
export declare function clipTotalSeconds(clips: readonly TimelineClipInput[]): number;
/**
 * 播放头水平位置（px）：进度 × 可用宽度。
 * 设计稿踩过的「数学期望」原样固化 —— 播放头必须落在 label 列右侧的
 * 可用轨道区内，由调用方保证 usableWidth 已扣除 label 列。
 */
export declare function playheadPx(progress: number, usableWidth: number): number;
/** 播放头时间 → 相对 rulerMax 的百分比（0-100，越界夹紧）。 */
export declare function playheadLeftPct(timeSeconds: number, rulerMax: number): number;
/** 播放头时间落在哪个片段内（用于画布联动高亮）；不在任何片段内 → undefined。 */
export declare function clipIdAt(timeSeconds: number, spans: readonly ClipSpan[]): string | undefined;
