/**
 * 视频供应商共享的纯函数工具（阶段 2）。
 *
 * 抽到这里是因为 Drama adapter 与 generate.ts 都会用到，而 generate.ts 已经
 * import 了 providers，故 providers 内部不能再 import generate.ts（避免循环依赖）。
 * 本文件不依赖任何内部模块，可安全被两侧引用。
 */
/**
 * 把列表收敛到最多 max 项：保留首/尾，中间均匀采样，避免超出接口上限。
 * 与改造前 generate.ts 的 `sliceToMax` 行为完全一致（含 noUncheckedIndexedAccess 下的断言）。
 *
 * 泛型：Drama 侧传文件名数组，fal 侧（阶段 5）传 VideoReference 数组，采样逻辑同一套。
 */
export function sliceToMax(items, max) {
    if (items.length <= max)
        return [...items];
    const step = (items.length - 1) / (max - 1);
    const out = [];
    for (let i = 0; i < max; i++)
        out.push(items[Math.round(i * step)]);
    return out;
}
