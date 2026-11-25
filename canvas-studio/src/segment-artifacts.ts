/**
 * RQ-038 R11-B2（2026-11-16）· **段产物的纯规划层**（无 IO / 无时钟 / 无随机）。
 *
 * ## 解决什么
 *
 * R11 之前的段产物只活在 `build/shot-cache/<hash前16位>.mp4`：hash 名不可读、
 * 不进 `assets/history.json`、不进 `deliver/`、不挂画布 —— 用户「看不到一段视频」
 * 就等于「每段没有视频」，段级局部迭代也就没有反馈闭环（真机会话 6f8ba13c 实测：
 * 3 个段文件确实存在，但交付目录里一个都没有）。
 *
 * 本模块只回答三个问题，落盘与渲染留在 `shot-render.ts`：
 * ① 每段叫什么 id（可读、无路径穿越、同批唯一）；
 * ② 该段的交付指针长什么样（`deliver/segments/<id>.mp4` + 帧窗 + 时长）；
 * ③ 段级抽帧取哪一帧（段中点绝对帧号）。
 *
 * ## id 从哪儿来（这是「可寻址」的一半）
 *
 * 首选 `manifest.meta.segments[].id`（= spec `sections[].id`，宿主在 scaffold 时写入），
 * 但**必须整表对齐才采信**：段数相同且逐段 `startFrame` / `frames` 与切出来的段
 * 完全一致。对不上（过期段表、手写 manifest、段表被改过没重建）就退回
 * `seg-1..seg-N` —— 宁可名字不好看，也不要把 s2 的名字挂到实际是 s3 的段上。
 * 名字错了比没有名字更糟：用户对着「分镜 2」说话，改的却是第三段。
 *
 * 纪律：`../` 之类的穿越串必须被吃掉（id 直接进文件名）。白名单字符
 * `[A-Za-z0-9_-]`，其余一律折成 `-`；折完为空则用 `seg-N` 兜底。
 */
import type { ManifestSegment } from './remotion/manifest.js'
import { segmentRefOf } from './segment-binding.js'

/** 段产物 id 的合法字符（写进文件名 / 交付卡，必须无路径语义）。 */
const UNSAFE_ID_CHARS = /[^A-Za-z0-9_-]/g

/** id 过长会顶爆路径长度，48 足够区分且远低于任何文件系统限制。 */
const MAX_ID_LENGTH = 48

/** 一段的产物规划（纯数据；`file` 由指针层拼）。 */
export interface SegmentArtifact {
  /** 段序号（0 起，与 `ShotSegment.index` 同源）。 */
  index: number
  /** 可读且可寻址的段 id（`s1` / `s2` / `seg-3`…）。 */
  id: string
  /** 段首帧（含转场预卷，绝对帧号）。 */
  startFrame: number
  /** 段长（帧）。 */
  frames: number
  /** 段级抽帧的绝对帧号（段中点）；末段取 `start + (frames-1)/2` 向下取整。 */
  sampleFrame: number
  /**
   * 段表整表对齐时 = spec 原始 id 的 `segmentRef`（`spec:s2`）；对不齐**缺省**。
   *
   * REQ-041：卡上 `segmentRef` 存 spec 原文，而 `id` 是清洗过的产物名 —— 两者
   * 中文 id / 过期段表场景下并不相等。客户端必须拿 `ref` 做等值匹配，禁止按序号配。
   */
  ref?: string
}

/** 交付卡里的段指针（`card.json pointers.segments[]`）。 */
export interface SegmentPointer {
  id: string
  /** 相对项目根的路径（`deliver/segments/<id>.mp4`）——卡是可搬的，别写绝对路径。 */
  file: string
  /** `assets/` 下确定性副本文件名（`seg-<id>.mp4`）；只读清单据此 stat / 拼 URL。 */
  assetFile?: string
  startFrame: number
  frames: number
  /** 段时长（秒，3 位小数：`frames / fps`，不做任何取整到整秒）。 */
  durationSec: number
  /** 只有段表对齐才给；对齐失败时客户端收不到 ref，卡诚实显示文案（不猜）。 */
  ref?: string
}

/** 段产物在项目内的子目录（相对项目根）。 */
export const SEGMENT_DELIVER_DIR = 'deliver/segments'

/**
 * 单个段 id 的清洗（导出给测试与文案用）。
 * 非法字符折 `-`、连续 `-` 合一个、去首尾 `-`、超长截断；空 ⇒ `seg-<index+1>`。
 */
export function segmentArtifactId(raw: unknown, index: number): string {
  const fallback = `seg-${String(index + 1)}`
  if (typeof raw !== 'string') return fallback
  const cleaned = raw
    .replace(UNSAFE_ID_CHARS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, '')
  return cleaned === '' ? fallback : cleaned
}

/**
 * 段表能否整表采信：段数一致 + 逐段帧窗完全一致（见模块头「id 从哪儿来」）。
 * 只认同源数据，不做「差不多」的近似匹配。
 */
function declaredTableAligned(
  segments: readonly { index: number; startFrame: number; endFrame: number }[],
  declared: readonly ManifestSegment[] | undefined,
): declared is readonly ManifestSegment[] {
  if (!Array.isArray(declared) || declared.length !== segments.length) return false
  return segments.every((segment, i) => {
    const row = declared[i] as ManifestSegment
    return typeof row?.id === 'string'
      && Math.round(row.startFrame) === segment.startFrame
      && Math.round(row.frames) === segment.endFrame - segment.startFrame
  })
}

/**
 * 段级抽帧帧号：段中点（`start + floor((end - start) / 2)`）。
 *
 * 为什么不取段首：段首那一帧正是转场叠化的起点（`applyStageTransitions` 把下一屏
 * 轨左移 10 帧就是为它留的窗），取段首会拍到两张画面叠在一起的中间态 —— 看起来
 * 像排版 bug，实际是过渡帧（既有铁律：抽帧落在动画窗口内先看窗口末帧）。
 */
export function segmentSampleFrame(startFrame: number, frames: number): number {
  const span = Math.max(1, Math.round(frames))
  return Math.round(startFrame) + Math.floor((span - 1) / 2)
}

/**
 * 规划每段的产物 id 与抽帧帧号。
 *
 * 传 `declared = manifest.meta.segments`（可缺省）；表对不齐 ⇒ 整表不用、退回
 * `seg-N`。同批 id 冲突（spec 里两张屏都用 `s1`）按出现顺序加 `-2` / `-3` 后缀，
 * 绝不静默覆盖前一个段产物。
 */
export function planSegmentArtifacts(input: {
  segments: readonly { index: number; startFrame: number; endFrame: number }[]
  declared?: readonly ManifestSegment[] | undefined
  fps: number
}): SegmentArtifact[] {
  const aligned = declaredTableAligned(input.segments, input.declared)
  const used = new Set<string>()
  return input.segments.map((segment, i) => {
    // 产物 id 走清洗，ref 保留 spec 原文 —— 两者故意不同源，客户端只认 ref。
    const declaredId = aligned ? (input.declared as readonly ManifestSegment[])[i]?.id : undefined
    const base = segmentArtifactId(declaredId, i)
    let id = base
    let suffix = 2
    while (used.has(id)) {
      id = `${base}-${String(suffix)}`
      suffix += 1
    }
    used.add(id)
    const frames = Math.max(0, segment.endFrame - segment.startFrame)
    return {
      index: segment.index,
      id,
      startFrame: segment.startFrame,
      frames,
      sampleFrame: segmentSampleFrame(segment.startFrame, frames),
      ...(declaredId === undefined ? {} : { ref: segmentRefOf(declaredId) }),
    }
  })
}

/** 段产物文件名（`<id>.mp4`）——**只有这一处拼扩展名**。 */
export function segmentArtifactName(id: string): string {
  return `${id}.mp4`
}

/** 段产物相对项目根的路径（发布目录 + 文件名）。 */
export function segmentArtifactRelPath(id: string): string {
  return `${SEGMENT_DELIVER_DIR}/${segmentArtifactName(id)}`
}

/**
 * REQ-041：段副本在 `assets/` 下的确定性文件名（`seg-<id>.mp4`）。
 *
 * 覆盖写、不含随机 id（禁 `newAssetId()`）—— URL 漂移会让缓存与卡引用全废。
 * assets 路由只接受 `<projectId>/<file>` 两段，因此这里必须是**根目录下平铺文件名**。
 */
export function segmentAssetName(id: string): string {
  return `seg-${segmentArtifactName(id)}`
}

/** 规划结果 → 交付卡指针（fps 用于折算时长，保留 3 位小数）。 */
export function segmentPointers(artifacts: readonly SegmentArtifact[], fps: number): SegmentPointer[] {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  return artifacts.map((artifact) => ({
    id: artifact.id,
    file: segmentArtifactRelPath(artifact.id),
    assetFile: segmentAssetName(artifact.id),
    startFrame: artifact.startFrame,
    frames: artifact.frames,
    durationSec: Math.round((artifact.frames / safeFps) * 1000) / 1000,
    ...(artifact.ref === undefined ? {} : { ref: artifact.ref }),
  }))
}

/** 回执一行：段产物清单（空数组 = 无产物，调用方别输出空行）。 */
export function segmentReceiptLine(pointers: readonly SegmentPointer[]): string {
  if (pointers.length === 0) return ''
  const listed = pointers.map((p) => `${p.id}（${p.file}）`).join('、')
  return `📦 段产物已落交付目录：${listed} —— 改某一屏只重渲该段，可直接对照单段文件`
}
