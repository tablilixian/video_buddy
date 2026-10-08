/**
 * 媒体节点画布显示尺寸统一规则（**自然像素**：100% 视图时 1 CSS px = 1 像素）。
 *
 * 真实分辨率 → 画布框换算的唯一事实来源。此前三处各自实现、规则漂移：
 * - generate.ts 的 previewSizeOf（1:1 → 420×420 特判）
 * - StudioFrame.tsx 的 longSide480（min60 短边地板）
 * - StudioFrame.tsx onMediaNatural 校正（长边 480）
 *
 * CV-284 起规则改为**自然像素**：画布上的 image/video 节点在 100% 视图下按
 * 真实像素尺寸显示（1920×1080 的图 = 1920×1080 CSS px 的媒体区），不再压到
 * 固定长边 480。仅保留两条护栏：
 * - MIN_SHORT_SIDE 短边地板（极端宽/窄比例防贴地，**等比**放大不改比例）
 * - 非法输入（0 / 负数 / 非有限数）回退 DEFAULT_MEDIA_BOX 占位
 * 超大节点由 FIT_MIN_SCALE（0.1）与 fit 视图收纳（见 canvas-view.ts）。
 *
 * C10 起本模块管**两级**尺寸，别混用：
 * - `previewSizeOf` = **画面**尺寸（媒体区）
 * - `frameSizeOf`  = **节点框**尺寸（画面 + 镜头条 chrome），写进 `node.width/height`
 * 逆运算 `mediaBoxOf` 供自然尺寸校正判比例用。
 */

/** 极端宽/窄比例下的最小短边（像素）。 */
export const MIN_SHORT_SIDE = 60

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
export const NODE_HEAD_HEIGHT = 26
export const NODE_FOOT_HEIGHT = 22
export const NODE_CHROME_HEIGHT = NODE_HEAD_HEIGHT + NODE_FOOT_HEIGHT

/**
 * 媒体区默认尺寸（真实分辨率尚未就绪时的占位**意图**）。
 *
 * 注意这描述的是**媒体区**，不是节点框 —— 节点框 = 媒体区 + chrome，
 * 由 `frameSizeOf` 换算。改前这个 260×180 是节点框尺寸，加上 48px chrome 后
 * 媒体区只剩 132 高（2:1 的扁条），占位卡片的比例会失真。
 */
export const DEFAULT_MEDIA_BOX = { width: 260, height: 180 } as const

export interface MediaDisplaySize {
  width: number
  height: number
}

/** 真实分辨率（宽高像素）→ 画布显示框尺寸（媒体区，**自然像素**）。 */
export function previewSizeOf(media: { width: number; height: number }): MediaDisplaySize {
  // CR-027：非正 / 非法输入（如 height=0 会让短边算出 Infinity）回退占位媒体区，
  // 避免把 Infinity 写进节点框。
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height) || media.width <= 0 || media.height <= 0) {
    return { ...DEFAULT_MEDIA_BOX }
  }
  // 自然像素：真实分辨率即显示尺寸（100% 视图 = 1:1，用户所见即产物像素）。
  const width = media.width
  const height = media.height
  // 短边地板：极端宽/窄比例下短边不足 MIN_SHORT_SIDE 时**整体等比放大**——
  // 比例一个像素都不许变，mediaBoxOf 的比例自愈判据与 mediaWidth/Height
  // 对账全靠它（旧固定长边规则把短边单独夹到 60 会改比例，那是压图规则
  // 才有的妥协，自然像素规则下无须再付）。
  const short = Math.min(width, height)
  if (short < MIN_SHORT_SIDE) {
    const scale = MIN_SHORT_SIDE / short
    return { width: Math.round(width * scale), height: Math.round(height * scale) }
  }
  return { width, height }
}

/**
 * 真实分辨率（宽高像素）→ **节点框**尺寸（媒体区 + 镜头条 chrome）。
 *
 * 这是写进 `node.width/height` 的那一个 —— 画布上摆的整张卡。`previewSizeOf`
 * 仍然是「画面本身」的尺寸，两者不可混用：把 `previewSizeOf` 的结果直接写进
 * 节点框，卡片就比画面矮 48px，头/脚会把画面挤掉；反过来把 `frameSizeOf`
 * 的结果当成媒体区，画面就会被放大 48px。
 */
export function frameSizeOf(media: { width: number; height: number }): MediaDisplaySize {
  const box = previewSizeOf(media)
  return { width: box.width, height: box.height + NODE_CHROME_HEIGHT }
}

/**
 * 节点框尺寸 → **媒体区**尺寸（`frameSizeOf` 的逆运算）。
 *
 * 自然尺寸校正要用它：判「框比例是否偏了」必须比**画面区域**的比例，
 * 拿整张卡（含 48px chrome）的比例去比，任何卡片都会判定为「偏了」，
 * 于是每加载一次媒体就重设一次尺寸 —— 而且是设成错的（把 chrome 算进画面）。
 * 地板取 1 防除零。
 */
export function mediaBoxOf(frame: { width: number; height: number }): MediaDisplaySize {
  return {
    width: Math.max(1, frame.width),
    height: Math.max(1, frame.height - NODE_CHROME_HEIGHT),
  }
}

/**
 * 节点框默认尺寸 —— 全仓新增节点（生成 / 合成 / 抽帧 / 导入占位）共用同一个出口。
 *
 * 占位语义 = 「还不知道真实分辨率时，媒体区按占位意图 260×180 摆」，节点框
 * 就是它加 chrome —— CV-284 的自然像素规则下恒等式 `frameSizeOf(DEFAULT_MEDIA_BOX)`
 * 恰好直接表达这一点（旧固定长边规则下 previewSizeOf 会把长边拉到 480，
 * 所以当时只能手写加法）。自动布局的 `LAYOUT.stepX/stepY`（300/240）按
 * 308×228 的占位卡算间距，不变。
 */
export const DEFAULT_NODE_SIZE: MediaDisplaySize = frameSizeOf(DEFAULT_MEDIA_BOX)

/**
 * CV-083：媒体秒数 → 「m:ss」显示（时长角标）。非法值（NaN/负数/未定义）
 * 返回 null，调用方据此决定是否渲染角标。纯函数，单测直连。
 */
export function formatMediaDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
