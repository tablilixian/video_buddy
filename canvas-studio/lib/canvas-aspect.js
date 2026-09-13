/**
 * 媒体节点画布显示尺寸统一规则（长边 480）。
 *
 * 真实分辨率 → 画布框换算的唯一事实来源。此前三处各自实现、规则漂移：
 * - generate.ts 的 previewSizeOf（1:1 → 420×420 特判）
 * - StudioFrame.tsx 的 longSide480（min60 短边地板）
 * - StudioFrame.tsx onMediaNatural 校正（长边 480）
 *
 * 统一后：1:1 用 420×420 紧凑框（保持 4 列网格视觉平衡，验收用例 I-2）；
 * 其余按长边固定 MEDIA_LONG_SIDE、短边等比缩放，并对极端宽/窄比例夹取
 * MIN_SHORT_SIDE 地板（防超宽银幕图被压成接近 1px 高）。
 *
 * C10 起本模块管**两级**尺寸，别混用：
 * - `previewSizeOf` = **画面**尺寸（媒体区）
 * - `frameSizeOf`  = **节点框**尺寸（画面 + 镜头条 chrome），写进 `node.width/height`
 * 逆运算 `mediaBoxOf` 供自然尺寸校正判比例用。
 */
/** 非 1:1 媒体画布框的长边（像素）。 */
export const MEDIA_LONG_SIDE = 480;
/** 1:1 正方形画布框边长（像素）：比长边 480 更紧凑，避免占满整行网格。 */
export const SQUARE_SIDE = 420;
/** 极端宽/窄比例下的最小短边（像素）。 */
export const MIN_SHORT_SIDE = 60;
/**
 * C10：节点「镜头条」chrome 高度 —— 头部一行 + 脚部一行（各含自己那道 1px 分隔线）。
 *
 * **这两个数字是高度的唯一来源。** `client/styles.ts` 用 `${NODE_HEAD_HEIGHT}px`
 * 插值出真实高度，`tests/visual-tokens.test.mjs` 断言插值确实在（写完高度就忘了
 * 同步常量的漂移是静默失败：`previewSizeOf` 会按错的 chrome 反算媒体区，
 * 自然尺寸校正于是每加载一张图就把卡片高度改错一次）。
 *
 * 为什么 chrome 要**加在卡片上**而不是从媒体区里扣：媒体窗口是产品的正品
 * ——「显示区域小了一些」的代价不该由画面付。加上头部后卡片变高，画面尺寸
 * 与加头部之前一模一样。
 */
export const NODE_HEAD_HEIGHT = 26;
export const NODE_FOOT_HEIGHT = 22;
export const NODE_CHROME_HEIGHT = NODE_HEAD_HEIGHT + NODE_FOOT_HEIGHT;
/**
 * 媒体区默认尺寸（真实分辨率尚未就绪时的占位**意图**）。
 *
 * 注意这描述的是**媒体区**，不是节点框 —— 节点框 = 媒体区 + chrome，
 * 由 `frameSizeOf` 换算。改前这个 260×180 是节点框尺寸，加上 48px chrome 后
 * 媒体区只剩 132 高（2:1 的扁条），占位卡片的比例会失真。
 */
export const DEFAULT_MEDIA_BOX = { width: 260, height: 180 };
/** 真实分辨率（宽高像素）→ 画布显示框尺寸。 */
export function previewSizeOf(media) {
    // CR-027：非正 / 非法输入（如 height=0 会让短边算出 Infinity）回退正方形占位，
    // 避免把 Infinity 写进节点框。
    if (!Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0) {
        return { width: SQUARE_SIDE, height: SQUARE_SIDE };
    }
    if (media.width === media.height)
        return { width: SQUARE_SIDE, height: SQUARE_SIDE };
    return media.width > media.height
        ? { width: MEDIA_LONG_SIDE, height: Math.max(MIN_SHORT_SIDE, Math.round((MEDIA_LONG_SIDE * media.height) / media.width)) }
        : { width: Math.max(MIN_SHORT_SIDE, Math.round((MEDIA_LONG_SIDE * media.width) / media.height)), height: MEDIA_LONG_SIDE };
}
/**
 * 真实分辨率（宽高像素）→ **节点框**尺寸（媒体区 + 镜头条 chrome）。
 *
 * 这是写进 `node.width/height` 的那一个 —— 画布上摆的整张卡。`previewSizeOf`
 * 仍然是「画面本身」的尺寸，两者不可混用：把 `previewSizeOf` 的结果直接写进
 * 节点框，卡片就比画面矮 48px，头/脚会把画面挤掉；反过来把 `frameSizeOf`
 * 的结果当成媒体区，画面就会被放大 48px。
 */
export function frameSizeOf(media) {
    const box = previewSizeOf(media);
    return { width: box.width, height: box.height + NODE_CHROME_HEIGHT };
}
/**
 * 节点框尺寸 → **媒体区**尺寸（`frameSizeOf` 的逆运算）。
 *
 * 自然尺寸校正要用它：判「框比例是否偏了」必须比**画面区域**的比例，
 * 拿整张卡（含 48px chrome）的比例去比，任何卡片都会判定为「偏了」，
 * 于是每加载一次媒体就重设一次尺寸 —— 而且是设成错的（把 chrome 算进画面）。
 * 地板取 1 防除零。
 */
export function mediaBoxOf(frame) {
    return {
        width: Math.max(1, frame.width),
        height: Math.max(1, frame.height - NODE_CHROME_HEIGHT),
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
export const DEFAULT_NODE_SIZE = {
    width: DEFAULT_MEDIA_BOX.width,
    height: DEFAULT_MEDIA_BOX.height + NODE_CHROME_HEIGHT,
};
/**
 * CV-083：媒体秒数 → 「m:ss」显示（时长角标）。非法值（NaN/负数/未定义）
 * 返回 null，调用方据此决定是否渲染角标。纯函数，单测直连。
 */
export function formatMediaDuration(seconds) {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
        return null;
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
