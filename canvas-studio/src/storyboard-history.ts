/**
 * REQ-022 · 版本历史的**纯函数层** —— 打点 / 回退 / 查询，全部无 IO、可直连单测。
 *
 * 为什么单独一层：存档与回退都会改 `versions` 结构，而它们同时被工具（落地）、
 * 路由（手动存档）两条路径调用。把逻辑写在路由里，两条路径迟早各写一份、各错一半。
 *
 * ## 语义（方案 §三，已拍板）
 *
 * 打点**只发生在四个时刻**：首稿 / 用户手动存档 / 回退前 / 落地固化。
 * `write_storyboard` 的整体重写**不打点** —— 否则「分次写」会刷出满屏机械命名的版本。
 *
 * ## 两条硬约束
 *
 * 1. **快照写入后不可变**：每次打点都 `structuredClone` 一份，绝不把调用方的对象
 *    引用塞进 history（否则后续改活副本会“顺带”改掉历史，版本对比永远显示「无差异」）。
 * 2. **版本号单调**：`v{seq+1}`，`seq` 只增不减（不提供删除版本的接口）。
 */
import type {
  StoryboardSections,
  StoryboardVersion,
  StoryboardVersionKind,
  StoryboardVersions,
} from './contracts/storyboard.js'

/** 下一个版本号（`v{seq+1}`）。 */
export function nextVersionId(versions: StoryboardVersions): string {
  return `v${String(versions.seq + 1)}`
}

/** 打点入参。 */
export interface ArchiveInput {
  readonly kind: StoryboardVersionKind
  readonly label: string
  readonly note?: string
  readonly now?: number
}

/** 按版本号取版本。 */
export function versionById(versions: StoryboardVersions, id: string): StoryboardVersion | undefined {
  return versions.history.find((entry) => entry.version === id)
}

/** 最近一次打点的版本（`history` 末项）。 */
export function latestVersion(versions: StoryboardVersions): StoryboardVersion | undefined {
  return versions.history[versions.history.length - 1]
}

/**
 * 打点：把当前 `sections` 存成一个新版本，`seq` 前进，`baseline` 指向新版本。
 *
 * 快照是**深拷贝**（见文件头约束 1）。`parent` 取打点前的 `baseline`（版本链）。
 */
export function archive(
  versions: StoryboardVersions,
  sections: StoryboardSections,
  input: ArchiveInput,
): StoryboardVersions {
  const version = nextVersionId(versions)
  const note = input.note ?? ''
  return {
    seq: versions.seq + 1,
    baseline: version,
    history: [
      ...versions.history,
      {
        version,
        kind: input.kind,
        label: input.label,
        ...(note === '' ? {} : { note }),
        createdAt: input.now ?? Date.now(),
        parent: versions.baseline,
        snapshot: structuredClone(sections),
      },
    ],
  }
}

/** 回退结果：新的版本仓库 + 新的活副本。 */
export interface RestoreResult {
  readonly versions: StoryboardVersions
  readonly sections: StoryboardSections
}

/**
 * 回退到某个历史版本（**方案 §3.3 选项 A**）。
 *
 * 顺序刻意如此：
 * 1. 先把**当前活副本**打点（`kind:auto` / `回退前存档`）—— 这是「不丢数据」的实现载体：
 *    回退会覆盖活副本，若不打点，用户刚改的内容就没了；
 * 2. 再把活副本换成目标版快照（深拷贝，不共享引用）；
 * 3. `baseline` 指回**目标版**而不是第 1 步的新版本 —— 它回答的是「现在的活副本
 *    派生自哪一版」，答案是目标版。
 *
 * 目标版不存在时返回 `undefined`（调用方据此报错，不猜）。
 */
export function restoreTo(
  versions: StoryboardVersions,
  currentSections: StoryboardSections,
  targetVersion: string,
  now?: number,
): RestoreResult | undefined {
  const target = versionById(versions, targetVersion)
  if (target === undefined) return undefined
  const archived = archive(versions, currentSections, { kind: 'auto', label: '回退前存档', ...(now === undefined ? {} : { now }) })
  return {
    versions: { ...archived, baseline: target.version },
    sections: structuredClone(target.snapshot),
  }
}

/** 改名（不变量：版本号与内容都不动，只动 label / note）。 */
export function relabel(
  versions: StoryboardVersions,
  version: string,
  label: string,
  note?: string,
): StoryboardVersions | undefined {
  const index = versions.history.findIndex((entry) => entry.version === version)
  if (index === -1) return undefined
  const current = versions.history[index]!
  const nextNote = note ?? current.note ?? ''
  const next: StoryboardVersion = {
    ...current,
    label,
    ...(nextNote === '' ? {} : { note: nextNote }),
  }
  const history = [...versions.history]
  history[index] = next
  return { ...versions, history }
}
