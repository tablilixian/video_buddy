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
/** 未探测到真值时长的片段占位时长（秒）。 */
export const FALLBACK_CLIP_S = 1;
/** 刻度步长候选：保证标尺刻度数量可读（≤ 12 个左右）。 */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60];
/**
 * 标尺右端点：总时长向上取整到刻度步长的整数倍。
 * 例：total=10.7 → step=2 → rulerMax=12（刻度 0,2,4,…,12）。
 */
export function niceRulerMax(totalSeconds) {
    const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
    if (total === 0)
        return 0;
    const step = TICK_STEPS.find(s => total / s <= 10) ?? 60;
    return Math.ceil(total / step) * step;
}
/**
 * 标尺刻度：从 0 到 rulerMax、按自适应步长均匀分布。
 * 返回 t（秒）与 pct（0-100，相对 rulerMax）。
 */
export function rulerTicks(rulerMax) {
    if (!(rulerMax > 0))
        return [];
    const step = TICK_STEPS.find(s => rulerMax / s <= 10) ?? 60;
    const ticks = [];
    for (let t = 0; t <= rulerMax + 1e-9; t += step) {
        ticks.push({ t: Math.round(t * 100) / 100, pct: t / rulerMax * 100 });
    }
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
export function planClipLayout(clips) {
    const spans = clips.map(clip => {
        const measured = typeof clip.duration === 'number' && Number.isFinite(clip.duration) && clip.duration > 0;
        return { id: clip.id, span: measured ? clip.duration : FALLBACK_CLIP_S, measured };
    });
    const total = spans.reduce((sum, s) => sum + s.span, 0);
    const rulerMax = niceRulerMax(total);
    let acc = 0;
    return spans.map(s => {
        const start = acc;
        acc += s.span;
        return {
            id: s.id,
            start,
            span: s.span,
            measured: s.measured,
            leftPct: rulerMax > 0 ? start / rulerMax * 100 : 0,
            widthPct: rulerMax > 0 ? s.span / rulerMax * 100 : 0,
        };
    });
}
/** 标尺总时长（布局片段的有效时长之和；空 → 0）。 */
export function clipTotalSeconds(clips) {
    return clips.reduce((sum, clip) => {
        const measured = typeof clip.duration === 'number' && Number.isFinite(clip.duration) && clip.duration > 0;
        return sum + (measured ? clip.duration : FALLBACK_CLIP_S);
    }, 0);
}
/**
 * 播放头水平位置（px）：进度 × 可用宽度。
 * 设计稿踩过的「数学期望」原样固化 —— 播放头必须落在 label 列右侧的
 * 可用轨道区内，由调用方保证 usableWidth 已扣除 label 列。
 */
export function playheadPx(progress, usableWidth) {
    const p = Math.min(1, Math.max(0, progress));
    return p * usableWidth;
}
/** 播放头时间 → 相对 rulerMax 的百分比（0-100，越界夹紧）。 */
export function playheadLeftPct(timeSeconds, rulerMax) {
    if (!(rulerMax > 0))
        return 0;
    const t = Math.min(rulerMax, Math.max(0, timeSeconds));
    return t / rulerMax * 100;
}
/** 播放头时间落在哪个片段内（用于画布联动高亮）；不在任何片段内 → undefined。 */
export function clipIdAt(timeSeconds, spans) {
    for (const span of spans) {
        if (timeSeconds >= span.start && timeSeconds < span.start + span.span)
            return span.id;
    }
    return undefined;
}
