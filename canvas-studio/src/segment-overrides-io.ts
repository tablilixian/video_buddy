/**
 * REQ-041 F6 · override 的**唯一 IO 层**（读盘 / 写盘 / 留档 / 合并入口）。
 *
 * 分成两个文件的原因：`segment-overrides.ts` 是纯函数（可被大量行为测试驱动，
 * 无临时目录也能跑），本文件是那层薄 IO —— 读坏的、写丢的、留档的都只在这里发生。
 *
 * ## 读盘永不抛
 *
 * 一份坏 override 不该让整片渲不出来。读不出来的文件逐份记原因（进回执），
 * 其余照常合并 —— 与段抽帧 / 交付卡同一条纪律（辅助设施不陪葬）。
 *
 * ## 写盘先留档
 *
 * 覆盖前把旧文复制到 `build/overrides/versions/<name>-<k>.json`。手工轨是「用户表达的
 * 效果」，改错一次就没了，值一份留档。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CompositionManifest } from './remotion/manifest.js'
import type { SegmentArtifact } from './segment-artifacts.js'
import { planSegmentTable } from './segment-table.js'
import {
  SEGMENT_OVERRIDES_DIR,
  SEGMENT_OVERRIDES_VERSIONS_DIR,
  applySegmentOverrides,
  overrideFileName,
  overrideReceiptLines,
  readOverrideDoc,
  type ApplyOverridesResult,
  type OverrideSkip,
  type SegmentOverride,
} from './segment-overrides.js'

function overridesDir(projectDir: string): string {
  return join(projectDir, SEGMENT_OVERRIDES_DIR)
}

/**
 * 读全项目 override（按 ref 排序，回执与测试都要可复现）。
 *
 * 目录不存在 = 没有任何 override（常态，不是错误）；单个文件坏 = 记一条 `skipped`。
 */
export function readProjectOverrides(projectDir: string): {
  overrides: SegmentOverride[]
  skipped: OverrideSkip[]
} {
  const dir = overridesDir(projectDir)
  if (!existsSync(dir)) return { overrides: [], skipped: [] }
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return { overrides: [], skipped: [] }
  }
  const overrides: SegmentOverride[] = []
  const skipped: OverrideSkip[] = []
  for (const name of names) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
    } catch (cause) {
      skipped.push({ ref: name, reason: `文件读不出来（${cause instanceof Error ? cause.message : String(cause)}）` })
      continue
    }
    const parsed = readOverrideDoc(raw)
    if ('reason' in parsed) {
      skipped.push({ ref: name, reason: parsed.reason })
      continue
    }
    // 文件名与文件内 ref 不一致 ⇒ 以文件内 ref 为准，另记一条提示（改名过的残留）。
    if (overrideFileName(parsed.override.ref) !== name) {
      skipped.push({ ref: parsed.override.ref, reason: `文件名 ${name} 与 ref 不一致（按 ref 处理，建议删掉这个旧名文件）` })
      continue
    }
    overrides.push(parsed.override)
  }
  return { overrides, skipped }
}

/** ref → 手工轨条数（托盘角标 / 诊断用；坏文件**不计**）。 */
export function overrideCountByRef(projectDir: string): Map<string, number> {
  const { overrides } = readProjectOverrides(projectDir)
  const map = new Map<string, number>()
  for (const override of overrides) map.set(override.ref, override.tracks.length)
  return map
}

/**
 * 全部手工轨 id（**不算「被重编丢掉」的那一批**）。
 *
 * 渲后的 `build/manifest.json` 里含 override 轨（它就是「渲了什么」的快照）⇒
 * 下一次 scaffold 整份覆盖时，`diffOverwrittenTracks` 会把它们当丢失告警。
 * 但它们的源头在 `build/overrides/`，下次渲染自动并回来 —— 告警常亮就等于没有告警。
 */
export function overrideTrackIds(projectDir: string): Set<string> {
  const { overrides } = readProjectOverrides(projectDir)
  const ids = new Set<string>()
  for (const override of overrides) {
    for (const track of override.tracks) {
      const id = (track as { id?: unknown }).id
      if (typeof id === 'string' && id !== '') ids.add(id)
    }
  }
  return ids
}

/** 写入一份 override（覆盖前留档）。返回落盘相对路径与留档文件名（无旧文 = null）。 */
export function writeProjectOverride(input: {
  projectDir: string
  override: SegmentOverride
}): { relPath: string; backup: string | null } {
  const dir = overridesDir(input.projectDir)
  mkdirSync(dir, { recursive: true })
  const name = overrideFileName(input.override.ref)
  const target = join(dir, name)
  let backup: string | null = null
  if (existsSync(target)) {
    const versionsDir = join(input.projectDir, SEGMENT_OVERRIDES_VERSIONS_DIR)
    mkdirSync(versionsDir, { recursive: true })
    const base = name.replace(/\.json$/, '')
    let index = 1
    while (existsSync(join(versionsDir, `${base}-${String(index)}.json`))) index += 1
    backup = `${base}-${String(index)}.json`
    copyFileSync(target, join(versionsDir, backup))
  }
  writeFileSync(target, `${JSON.stringify(input.override, null, 2)}\n`, 'utf8')
  return { relPath: `${SEGMENT_OVERRIDES_DIR}/${name}`, backup }
}

/** 删掉一份 override（`mode: "clear"`）。返回是否真的删了。 */
export function removeProjectOverride(projectDir: string, ref: string): boolean {
  const target = join(overridesDir(projectDir), overrideFileName(ref))
  if (!existsSync(target)) return false
  rmSync(target, { force: true })
  return true
}

/** 合并入口的返回：manifest + 回执行（+ 明细，测试与诊断用）。 */
export interface ProjectOverridesMerge {
  manifest: CompositionManifest
  lines: string[]
  applied: ApplyOverridesResult['applied']
  skipped: ApplyOverridesResult['skipped']
  /**
   * 本次**已并入**的手工轨 id 集合（skipped 的不进集合）。
   *
   * 渲后 `build/manifest.json` 落盘时要**剔除**它们：那份文件同时是下一次渲染的输入，
   * 手工轨一旦写进去就成了「没有 override 也还在」的僵尸轨（删掉 override 也不消失）。
   * 手工轨的唯一住所是 `build/overrides/`。**反过来，被跳过的 override 轨 id 一个都不能
   * 进来** —— 它们撞的往往是 manifest 既有轨的名字，剔了等于删合法轨（P1-1）。
   */
  trackIds: Set<string>
}

/**
 * **渲染前唯一合并入口** —— `render_composition` 与 `rerender_segment` 都调它。
 *
 * 为什么必须共用一个入口：段缓存的钥匙是「合并后轨」的 hash。两条路径如果各写一遍
 * 合并逻辑，一处漏掉 override ⇒ 同一段在两条路径算出两个 hash ⇒ 永远 cache miss
 * （表现是「改一屏每次都整片重渲」，且没有任何报错）。
 *
 * 无 override 文件 ⇒ 原样返回入参（零成本）。
 */
export function mergeProjectOverrides(input: {
  projectDir: string
  manifest: CompositionManifest
  spec: unknown
}): ProjectOverridesMerge {
  const { overrides, skipped } = readProjectOverrides(input.projectDir)
  if (overrides.length === 0) {
    return { manifest: input.manifest, lines: overrideReceiptLines([], skipped), applied: [], skipped, trackIds: new Set() }
  }
  // 段表 = 唯一切法（`segment-table.ts`）：段窗与 ref 必须与渲染侧同源，否则按 ref 找不到段。
  const plan = planSegmentTable({ manifest: input.manifest, spec: input.spec })
  if (plan === null) {
    return {
      manifest: input.manifest,
      lines: overrideReceiptLines([], [
        ...skipped,
        ...overrides.map((override) => ({
          ref: override.ref,
          reason: '这份 manifest 切不出段（无 meta.segments 也没 spec 屏边界）—— 手工轨按段定位，无段可挂',
        })),
      ]),
      applied: [],
      skipped,
      trackIds: new Set(),
    }
  }
  const artifacts: readonly SegmentArtifact[] = plan.artifacts
  const result = applySegmentOverrides({ manifest: input.manifest, artifacts, overrides })
  // P1-1（2026-11-27 审查）：只剔**已并入**（`result.applied`）的 override 轨 id。
  // 此前收集的是**全部** override —— 被跳过的那份（尤其「id 与 manifest 既有轨
  // 同名」这个确定场景）会把同名的合法 spec 轨从渲后快照里误删，而 `build/manifest.json`
  // 是段清单派生的事实源 ⇒ 「卡上这一段其实是隔壁那一段」的静默错位复发。
  const appliedRefs = new Set(result.applied.map((entry) => entry.ref))
  const trackIds = new Set<string>()
  for (const override of overrides) {
    if (!appliedRefs.has(override.ref)) continue
    for (const track of override.tracks) {
      const trackId = (track as { id?: unknown }).id
      if (typeof trackId === 'string' && trackId !== '') trackIds.add(trackId)
    }
  }
  return {
    manifest: result.manifest,
    lines: overrideReceiptLines(result.applied, [...result.skipped, ...skipped]),
    applied: result.applied,
    skipped: [...result.skipped, ...skipped],
    trackIds,
  }
}
