/**
 * 工具 + 参数 → 能力 的解析（阶段 1）。
 *
 * 这是抽象层存在的核心理由之一：现状下 `video_generate` 无论有无参考图都走
 * 同一个 Drama 端点 `image2videofl2va`；但 fal 把「文生视频」与「图生视频」
 * 拆成了两个不同端点。因此「模型 = 端点路径」的隐含假设在多供应商下不成立，
 * 必须显式解析成语义能力。
 */
/**
 * 解析出本次生成所需的能力。
 *
 * | 工具 | 条件 | 能力 |
 * | --- | --- | --- |
 * | 任意 | **带参考音频** | `multi-reference`（官方 r2v，优先级最高） |
 * | `video_generate` | 无参考图 | `text-to-video` |
 * | `video_generate` | 有首帧图 | `first-last-frame` |
 * | `video_composite` | 恰好 2 张 | `first-last-frame`（首尾帧插值） |
 * | `video_composite` | 1 张或 ≥3 张 | `multi-reference` |
 *
 * 带音频参考时**一律**按参考模式（r2v）解析：官方规定帧模式（first_frame /
 * last_frame）与参考模式（reference_*）互斥，且音频必须与视觉素材同行。若仍按
 * 帧语义解析，「1 张关键帧 + 1 段参考音频」会被误判成首尾帧插值，与官方语义冲突。
 * 语义变更由 `audioModeNotice` 显式回 warning，不静默改写。
 *
 * @throws 传入的不是视频生成工具时抛错。
 */
export function capabilityOf(tool, params) {
    if (tool !== 'video_generate' && tool !== 'video_composite') {
        throw new Error(`不是视频生成工具，无法解析能力: ${tool}`);
    }
    if ((params.audioRefs?.length ?? 0) > 0)
        return 'multi-reference';
    if (tool === 'video_generate') {
        return params.filename !== undefined ? 'first-last-frame' : 'text-to-video';
    }
    return (params.filenames?.length ?? 0) === 2 ? 'first-last-frame' : 'multi-reference';
}
