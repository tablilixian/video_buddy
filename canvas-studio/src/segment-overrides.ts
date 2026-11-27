/**
 * REQ-041 F6（2026-11-26）· **段级手工轨覆盖（overrides）** —— 纯函数层（无 IO / 无时钟）。
 *
 * ## 解决什么（真机会话 2026-11-25 的三条原话）
 *
 * 「若用 `writeTo` 重编 manifest，会把第 2 屏手工编写的椭圆轨道重建成旧文字卡」
 * 「拆分要重新生成 spec 段表，这会覆盖 manifest，所以我会在重编后恢复第 2 屏的椭圆轨道和音频」
 * 「spec 只能表达卡 + 文案 + 格位；沿路径运动 / 分段停顿 / 引线标注表达不了」
 *
 * 即：**表达力已经有了**（`orbit` / `animate` / `exit` / `reveal` 都是轨级字段，
 * 求值在 `timing.ts` 的纯函数里），但「这一屏额外加的那些轨」在产品里**没有合法住所** ——
 * 写进 `build/manifest.json` 会被下一次 `scaffold_manifest(writeTo)` 整份覆盖，
 * 写进 spec 又超出 spec 的语义（屏级编排合同 = 卡 + 文案 + 格位）。
 *
 * 本模块给它们一个独立住所：`build/overrides/<ref>.json`。手工轨不在 spec 产物里，
 * 任何一次 scaffold 都碰不到它；渲染前按 ref 合并进 manifest，**段缓存自然按内容失效**
 * （hash 用的是合并后的轨，见 `shot-cache.ts:segmentHash`）。
 *
 * ## 三条纪律
 *
 * 1. **不扩宽 spec 语义**：`section` 仍然是「卡 + 文案 + 格位」，任意轨不进 spec。
 * 2. **写入即校验**：时间窗必须落在该段内、id 不得与跨段轨冲突、类型必须是 manifest 已知轨型。
 *    脏 override 在写入时就被拒，绝不留给渲染期炸。
 * 3. **合并失败不炸渲染**：读盘时任何一份 override 不合格 ⇒ **跳过它并说清原因**，
 *    而不是让整片渲不出来（辅助设施不陪葬，同 `deliverable.ts` / 段抽帧纪律）。
 */

import { createHash } from 'node:crypto'
import type { CompositionManifest, CompositionTrack } from './remotion/manifest.js'
import { validateManifest } from './remotion/manifest.js'
import type { SegmentArtifact } from './segment-artifacts.js'
import { segmentRefOf } from './segment-binding.js'

/** override 文件目录（相对项目根）。临时产物纪律：只进 `build/` 下。 */
export const SEGMENT_OVERRIDES_DIR = 'build/overrides'

/** 覆盖前的旧版留档目录（与 `build/versions/` 同思路：改坏了能回对）。 */
export const SEGMENT_OVERRIDES_VERSIONS_DIR = 'build/overrides/versions'

/** 文件 schema 版本（形状变更时 +1，读取端按此拒收旧版而不是猜）。 */
export const SEGMENT_OVERRIDES_VERSION = 1

/**
 * 单段手工轨上限。理由不是性能而是**可审阅性**：一屏塞十几条手工轨后，
 * 「画面为什么这样」再也无法从 spec 读出来 —— 那就该改 spec 或换模板，
 * 而不是继续在 override 里堆。
 */
export const MAX_OVERRIDE_TRACKS = 8

/**
 * 段窗漂移的容忍（帧）。0 = 严格相等：段窗一变就不合并。
 *
 * 为什么不容忍：override 的轨是**绝对帧号**，段窗一变它们就落在别的画面上
 * （错位比丢失更难查）。真机已批准的口径是「不匹配就告警、不静默套用」。
 */
export const OVERRIDE_ANCHOR_TOLERANCE_FRAMES = 0

/** 写盘时记下的段窗快照 —— 合并时用它判「这段还是不是原来那段」。 */
export interface SegmentOverrideAnchor {
  /** 段首帧（含，绝对帧号）。 */
  startFrame: number
  /** 段长（帧）。 */
  frames: number
}

export interface SegmentOverride {
  version: number
  /** `spec:<spec 原始 id>`（与卡上 `segmentRef` 同源）。 */
  ref: string
  anchor: SegmentOverrideAnchor
  /** 写入时刻（毫秒）—— 只用于人读与留档排序，不参与任何判据。 */
  updatedAt: number
  /** 该段额外要画的轨（绝对帧号，窗口必须落在段内）。 */
  tracks: CompositionTrack[]
}

/** 一份 override 未生效的原因（人读一句话，进回执）。 */
export interface OverrideSkip {
  ref: string
  reason: string
}

/** 一份 override 已合并的结果。 */
export interface OverrideApplied {
  ref: string
  /** 合并进 manifest 的轨数。 */
  tracks: number
}

export interface ApplyOverridesResult {
  /** 合并后的 manifest（无 override 时**原样返回同一个对象**，调用方可据此跳过重算）。 */
  manifest: CompositionManifest
  applied: OverrideApplied[]
  skipped: OverrideSkip[]
}

/**
 * ref → 文件名（`spec:s2` → `spec-s2.json`）。文件名只是寻址，**真值在文件内的 `ref`**。
 *
 * 两条约束同时对：
 * - **可读**：ASCII 段 id（`s1` / `open` / `seg_1`）保留原样，人打开 `build/overrides/`
 *   一眼能认（`_` 是 id 里的常见字符，必须原样留）；
 * - **不撞车**：非白名单字符按码点编成 `~<hex>~`（可逆、必不同名），超长再截断加
 *   哈希尾巴。转义符 `~` **不在**白名单里（自身编成 `~7e~`）—— P2-3（2026-11-27
 *   审查）：旧式 `_<hex>_` 与白名单里的 `_` 同形 ⇒ 字面 id `spec:_7b2c_` 与
 *   `spec:第` 产出同一个文件名，后写静默覆盖前一个。读盘按目录扫描取文件内 ref
 *   （文件名不符只提示），换转义式不孤儿化存量文件。
 */
export function overrideFileName(ref: string): string {
  // `spec:` 前缀是固定语法，单独折成 `spec-`（否则每份文件都以转义序列开头，很难读）。
  const body = ref.startsWith('spec:') ? `spec-${ref.slice('spec:'.length)}` : ref
  let encoded = ''
  for (const char of body) {
    encoded += /^[A-Za-z0-9_-]$/.test(char) ? char : `~${(char.codePointAt(0) ?? 0).toString(16)}~`
  }
  if (encoded.length <= 48) return `${encoded === '' ? 'override' : encoded}.json`
  // 太长：保留前 32 个字符 + 原 ref 的哈希尾巴（同一 ref 稳定，不同 ref 极难相撞）。
  const digest = createHash('sha256').update(ref, 'utf8').digest('hex').slice(0, 8)
  return `${encoded.slice(0, 32)}-${digest}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

/**
 * 读盘文档 → `SegmentOverride`。**永不抛**：形状不符返回原因（调用方跳过这一份）。
 *
 * 版本号必须精确匹配：v2 的字段语义可能不同，猜着读等于把旧数据当新数据用。
 */
export function readOverrideDoc(raw: unknown): { override: SegmentOverride } | { reason: string } {
  if (!isRecord(raw)) return { reason: '文件内容不是 JSON 对象' }
  if (raw.version !== SEGMENT_OVERRIDES_VERSION) {
    return { reason: `schema 版本不支持（文件 ${String(raw.version)}，当前 ${String(SEGMENT_OVERRIDES_VERSION)}）` }
  }
  const ref = typeof raw.ref === 'string' ? raw.ref.trim() : ''
  if (!ref.startsWith('spec:')) return { reason: `ref 必须以 \`spec:\` 开头（收到 ${JSON.stringify(raw.ref)}）` }
  const anchor = raw.anchor
  if (!isRecord(anchor) || !isInteger(anchor.startFrame) || anchor.startFrame < 0 || !isInteger(anchor.frames) || anchor.frames <= 0) {
    return { reason: 'anchor 必须是 { startFrame: >=0 整数, frames: >0 整数 }' }
  }
  if (!Array.isArray(raw.tracks)) return { reason: 'tracks 必须是数组' }
  if (raw.tracks.length > MAX_OVERRIDE_TRACKS) {
    return { reason: `tracks 超过上限（${String(raw.tracks.length)} > ${String(MAX_OVERRIDE_TRACKS)}）` }
  }
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  return {
    override: {
      version: SEGMENT_OVERRIDES_VERSION,
      ref,
      anchor: { startFrame: anchor.startFrame, frames: anchor.frames },
      updatedAt,
      tracks: raw.tracks as CompositionTrack[],
    },
  }
}

/**
 * 合并：**同 id 替换（保留原位 = 保住层叠序）、新 id 追加在末尾（= 最上层）**。
 *
 * 为什么不把替换项也挪到末尾：数组序就是 z-order（`Root.tsx` 按数组顺序铺 Sequence），
 * 把一条底板挪到最上层会让整屏画面翻个面 —— 改效果的手工轨不该顺带改层叠。
 */
export function mergeOverrideTracks(
  base: readonly CompositionTrack[],
  overrides: readonly CompositionTrack[],
): CompositionTrack[] {
  if (overrides.length === 0) return [...base]
  const byId = new Map<string, CompositionTrack>()
  for (const track of overrides) {
    const id = (track as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') byId.set(id, track)
  }
  const replaced = new Set<string>()
  const out = base.map((track) => {
    const hit = byId.get((track as { id?: string }).id ?? '')
    if (hit === undefined) return track
    replaced.add((hit as { id: string }).id)
    return hit
  })
  for (const track of overrides) {
    const id = (track as { id?: unknown }).id
    if (typeof id === 'string' && replaced.has(id)) continue
    out.push(track)
  }
  return out
}

/** 校验结论：`ok` 时带回清洗后的轨。 */
export type OverrideTrackCheck =
  | { ok: true; tracks: CompositionTrack[] }
  | { ok: false; issues: string[] }

/**
 * 手工轨的**唯一校验入口**（写入时 + 合并时各跑一次，判据只有这一份）。
 *
 * 校验四层：
 * ① 形状：数组、条数 ≤ {@link MAX_OVERRIDE_TRACKS}、必须给绝对 `startFrame`（不接受 `startAfter`：
 *    顺序衔接的语义是「接在上一轨后面」，而手工轨挂在某一段里，衔接目标会随 spec 重编漂移）；
 * ② 时间窗：整条必须落在目标段 `[start, end)` 内 —— 越界就是错位，不是「大概对」；
 * ③ id：同 id = 替换该段里那条轨；若同 id 的既有轨**跨段可见**则拒收（那一下会顺手
 *    删掉别的屏上的画面）；
 * ④ 整份 manifest 校验：把合并结果交给 `validateManifest`，box / orbit / 未知字段 /
 *    文字容量这些规则一条都不重写。
 */
export function validateOverrideTracks(input: {
  manifest: CompositionManifest
  artifacts: readonly SegmentArtifact[]
  ref: string
  tracks: unknown
}): OverrideTrackCheck {
  const issues: string[] = []
  const raw = input.tracks
  if (!Array.isArray(raw)) return { ok: false, issues: ['tracks 必须是数组'] }
  if (raw.length === 0) return { ok: false, issues: ['tracks 为空 —— 想取消这一段的手工轨请用 `mode: "clear"`'] }
  if (raw.length > MAX_OVERRIDE_TRACKS) {
    return {
      ok: false,
      issues: [`一次最多 ${String(MAX_OVERRIDE_TRACKS)} 条手工轨（这次 ${String(raw.length)} 条）—— 再多就该改 spec 或换版式，不是继续堆轨`],
    }
  }

  const targetIndex = input.artifacts.findIndex((artifact) => artifact.ref === input.ref)
  if (targetIndex < 0) {
    const known = input.artifacts.map((artifact) => artifact.ref ?? artifact.id).join(' / ')
    return {
      ok: false,
      issues: [`段表里没有 ${input.ref}（现有：${known === '' ? '无' : known}）—— 先在回执里核对屏 id`],
    }
  }
  const artifact = input.artifacts[targetIndex] as SegmentArtifact
  const segStart = artifact.startFrame
  const segEnd = artifact.startFrame + artifact.frames

  for (let i = 0; i < raw.length; i += 1) {
    const track = raw[i]
    const at = `tracks[${String(i)}]`
    if (!isRecord(track)) {
      issues.push(`${at} 必须是对象`)
      continue
    }
    if (track.startAfter !== undefined) {
      issues.push(`${at} 不接受 \`startAfter\`（顺序衔接会随 spec 重编漂移）—— 请给绝对 \`startFrame\``)
    }
    const start = track.startFrame
    const duration = track.durationInFrames
    if (!isInteger(start) || start < 0) {
      issues.push(`${at}.startFrame 必须是 >= 0 的整数（绝对帧号）`)
      continue
    }
    if (!isInteger(duration) || duration <= 0) {
      issues.push(`${at}.durationInFrames 必须是正整数`)
      continue
    }
    if (start < segStart || start + duration > segEnd) {
      issues.push(
        `${at}（${String(track.id)}）时间窗 ${String(start)}–${String(start + duration)} 越出本段 `
        + `${String(segStart)}–${String(segEnd)}（${input.ref}）—— 手工轨只能画在本屏时间窗内`,
      )
    }
    // ③ id 冲突：**只做新增**。spec 产出的轨不在这里改（要改就改 spec）——
    //    否则「这条轨到底来自 spec 还是 override」再也说不清，而且重编时删不掉。
    //    真机那次「椭圆轨道」本身就是**新增**一条 shape+orbit 轨，不需要覆盖任何既有轨。
    const id = typeof track.id === 'string' ? track.id : ''
    if (id === '') continue
    const collided = (Array.isArray(input.manifest.tracks) ? input.manifest.tracks : [])
      .some((candidate) => (candidate as { id?: unknown }).id === id)
    if (collided) {
      issues.push(
        `${at}.id \`${id}\` 与 manifest 里既有的轨同名 —— 手工轨只做**新增**，不覆盖既有轨：`
        + '要改那条轨请改 spec（它才是那条轨的来源），这里请换一个新 id（如 `hi-orbit-1`）',
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  const tracks = raw as CompositionTrack[]

  // ④ 整份校验：合并后的 manifest 必须仍然合法（规则不重写）。
  const merged = mergeOverrideTracks(input.manifest.tracks, tracks)
  const validation = validateManifest({ ...input.manifest, tracks: merged })
  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.errors.map((error) => `合并后 manifest 校验失败：${error}`),
    }
  }
  return { ok: true, tracks }
}

/**
 * 把一批 override 合并进 manifest（**纯函数**；IO 在 `segment-overrides-io.ts`）。
 *
 * 三种跳过情形，每一种都带可执行的原因（不静默）：
 * - 段表里找不到这个 ref（spec 改了屏 id / 删了一屏）；
 * - 段窗已变（`anchor` 对不上）—— 绝对帧号会错位；
 * - 校验失败（画布尺寸变了 / 手工轨越界）。
 *
 * 全都没有 override ⇒ 原样返回入参对象（调用方可据此零成本跳过）。
 */
export function applySegmentOverrides(input: {
  manifest: CompositionManifest
  artifacts: readonly SegmentArtifact[]
  overrides: readonly SegmentOverride[]
}): ApplyOverridesResult {
  const applied: OverrideApplied[] = []
  const skipped: OverrideSkip[] = []
  if (input.overrides.length === 0) return { manifest: input.manifest, applied, skipped }

  const collected: CompositionTrack[] = []
  for (const override of input.overrides) {
    const index = input.artifacts.findIndex((artifact) => artifact.ref === override.ref)
    if (index < 0) {
      skipped.push({
        ref: override.ref,
        reason: '段表里没有这一段（spec 的 sections 改过、或这段被合并了）—— 手工轨仍在盘上，重新 patch 到当前段即可',
      })
      continue
    }
    const artifact = input.artifacts[index] as SegmentArtifact
    const drift = Math.abs(artifact.startFrame - override.anchor.startFrame)
    const driftFrames = Math.abs(artifact.frames - override.anchor.frames)
    if (drift > OVERRIDE_ANCHOR_TOLERANCE_FRAMES || driftFrames > OVERRIDE_ANCHOR_TOLERANCE_FRAMES) {
      skipped.push({
        ref: override.ref,
        reason: `段窗已变（写时 ${String(override.anchor.startFrame)}+${String(override.anchor.frames)} 帧，`
          + `现在 ${String(artifact.startFrame)}+${String(artifact.frames)} 帧）—— 绝对帧号会落到别的画面上，`
          + '本次不合并。确认新段窗后重新 patch 一次',
      })
      continue
    }
    const check = validateOverrideTracks({
      manifest: input.manifest,
      artifacts: input.artifacts,
      ref: override.ref,
      tracks: override.tracks,
    })
    if (!check.ok) {
      skipped.push({ ref: override.ref, reason: `校验未通过：${check.issues.join('；')}` })
      continue
    }
    // P2-2（2026-11-27 审查）：跨 override 文件的轨 id 撞名零校验 —— `validateOverrideTracks`
    // 只比对基 manifest，两份 override 各自合法地新增同名轨时 `mergeOverrideTracks`
    // 会**都追加**（重复 id ⇒ React key / z 序语义未定义、hash 与清单不再唯一对应）。
    // 这里对本批次已收集的 id 查重：撞名的那份整体跳过并点名。
    const batchIds = new Set(collected.map((track) => track.id))
    const duplicated = check.tracks.filter((track) => batchIds.has(track.id)).map((track) => String(track.id))
    if (duplicated.length > 0) {
      skipped.push({
        ref: override.ref,
        reason: `轨 id 与另一份 override 撞名（${duplicated.join('、')}）—— 手工轨 id 全局唯一，换新 id 后重新 patch`,
      })
      continue
    }
    collected.push(...check.tracks)
    applied.push({ ref: override.ref, tracks: check.tracks.length })
  }

  if (collected.length === 0) return { manifest: input.manifest, applied, skipped }
  return {
    manifest: { ...input.manifest, tracks: mergeOverrideTracks(input.manifest.tracks, collected) },
    applied: applied.map((entry) => ({ ...entry })),
    skipped,
  }
}

/**
 * 落盘前剔除手工轨（渲染路径**唯一调用点**：`build/manifest.json` 的快照）。
 *
 * 为什么必须剔：那份文件同时是**下一次渲染的输入**。手工轨一旦写进去，就会在删掉
 * override 之后继续存在 —— 一条谁也说不清来源的僵尸轨（画面永远多一层）。
 * 手工轨的唯一住所是 `build/overrides/`。
 *
 * `trackIds` 为空 ⇒ 原样返回同一个对象（绝大多数项目没有 override，零成本）。
 */
export function withoutOverrideTracks(
  manifest: CompositionManifest,
  trackIds: ReadonlySet<string>,
): CompositionManifest {
  if (trackIds.size === 0) return manifest
  const kept = (Array.isArray(manifest.tracks) ? manifest.tracks : [])
    .filter((track) => !trackIds.has((track as { id?: string }).id ?? ''))
  if (kept.length === manifest.tracks.length) return manifest
  return { ...manifest, tracks: kept }
}

/** 合并后的回执行（空数组 = 无 override，调用方别输出空行）。 */
export function overrideReceiptLines(
  applied: readonly OverrideApplied[],
  skipped: readonly OverrideSkip[],
): string[] {
  const lines: string[] = []
  if (applied.length > 0) {
    const listed = applied
      .map((entry) => `${entry.ref.replace(/^spec:/, '')} +${String(entry.tracks)} 条`)
      .join('、')
    lines.push(
      `🎛 手工轨覆盖已并入：${listed} —— 来自 \`${SEGMENT_OVERRIDES_DIR}/\`，`
      + '**不在 spec 里**，下次重编 manifest 不会丢；改这些轨用 `patch_segment_tracks`，别手改 manifest',
    )
  }
  for (const entry of skipped) {
    lines.push(`⚠️ 手工轨覆盖未生效：${entry.ref} —— ${entry.reason}`)
  }
  return lines
}

/** 校验失败时给模型的可执行结论（写入工具的回执/错误文案）。 */
export function overrideIssueSummary(issues: readonly string[]): string {
  return [
    '手工轨校验未通过（本次未写盘，零副作用）：',
    ...issues.map((issue) => `- ${issue}`),
    '时间窗按**绝对帧号**给，且必须落在本段内；轨类型沿用 manifest 已知轨型（`orbit` / `animate` / `exit` / `reveal` 都是轨级字段）。',
  ].join('\n')
}

/** 段 ref 归一化：接受 `spec:s2` 或裸 `s2`，一律返回 `spec:s2`。 */
export function normalizeOverrideRef(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  const id = trimmed.startsWith('spec:') ? trimmed.slice('spec:'.length).trim() : trimmed
  return id === '' ? '' : segmentRefOf(id)
}
