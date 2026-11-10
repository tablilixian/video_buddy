/**
 * §07 用户参考**确定性登记**（REQ-037 延伸，CV-459）。
 *
 * 病灶：登记进 §07 这一步原本押在 agent 身上（纪律提示词 + 工具描述，CV-405），
 * 但「提醒」不是「保证」——真机会话里 agent 漏登记，用户参考就只在画布上、§07 空
 * （2026-11-10 翻拍本实证）。本模块把登记从概率性的模型行为改成确定性的 Host 行为：
 * 文件落进项目 `assets/` 的同一拍（开始创作消费首页暂存 / 用户点「落进画布」），
 * Host 直接追加 `source:"user"` 条目。模型退化为可选的「补语义」（neededBy 等）。
 *
 * 为什么独立成文件：routes.ts 在文件行数棘轮下只准减不准增
 * （`tests/file-size-guard.test.mjs`），判据 + 写入落在这里，routes 只留接线。
 *
 * 防冲掉：agent 重传 `assets` 段时 `keepUserAssets`（contracts）保住登记条目。
 * 读失败 / 非法条目一律降级返回，绝不抛错 —— 画布落卡链路不能被登记拖死。
 */
import type { ProjectRegistry } from './projects.js'
import { isAssetFileName } from './asset-path.js'
import { loadStoryboard, updateStoryboardOrFail } from './storyboard-store.js'
import type { StoryboardAsset, StoryboardAssetType } from './contracts/storyboard.js'

/** 客户端上报的一条落盘附件（kind 与 MediaKind / StoryboardAssetType 同值域）。 */
export interface UserRefItem {
  readonly name: string
  readonly kind: string
  readonly assetFile: string
}

export interface UserRefOutcome {
  readonly registered: number
  readonly skipped: number
  readonly rejected: readonly string[]
}

const USER_REF_KINDS: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'text'])
const USER_REF_NAME_LIMIT = 200
const USER_REF_ITEM_LIMIT = 32

/**
 * 纯函数：上报条目 → 待追加的 §07 条目。逐条校验（kind 白名单 / 文件名判据 /
 * 名称非空超限截断）；已在册（同 assetFile 的 file 引用，不论来源）的跳过不重登。
 * 单批 ≤ 32 条——首页暂存与一次落卡都远够，防脏输入刷爆 §07。
 */
export function planUserRefEntries(
  items: readonly UserRefItem[],
  existing: readonly StoryboardAsset[],
): { entries: StoryboardAsset[]; rejected: string[] } {
  const knownFiles = new Set(
    existing.filter((asset) => asset.ref.kind === 'file').map((asset) => asset.ref.id),
  )
  const entries: StoryboardAsset[] = []
  const rejected: string[] = []
  for (const [index, item] of items.entries()) {
    const label = item.name !== '' && item.name !== undefined ? item.name : `#${String(index + 1)}`
    if (entries.length + rejected.length >= USER_REF_ITEM_LIMIT) {
      rejected.push(`${label}（超出单批 32 条上限）`)
      continue
    }
    if (typeof item.name !== 'string' || item.name.trim() === '') { rejected.push(`${label}（缺名称）`); continue }
    if (!USER_REF_KINDS.has(item.kind)) { rejected.push(`${item.name}（类型不支持：${item.kind}）`); continue }
    if (typeof item.assetFile !== 'string' || !isAssetFileName(item.assetFile)) {
      rejected.push(`${item.name}（非法资产文件名）`); continue
    }
    if (knownFiles.has(item.assetFile)) continue // 已在册：幂等重放（重发 / 哈希去重复用）不重登
    const name = item.name.length > USER_REF_NAME_LIMIT ? `${item.name.slice(0, USER_REF_NAME_LIMIT)}…` : item.name
    entries.push({
      name,
      type: item.kind as StoryboardAssetType,
      status: 'ready',
      ref: { kind: 'file', id: item.assetFile },
      neededBy: [],
      source: 'user',
    })
    knownFiles.add(item.assetFile)
  }
  return { entries, rejected }
}

/**
 * 登记入口（路由侧调用）：读盘 → 规划 → 追加写。任何失败都降级为 outcome 返回，
 * 不抛错 —— 登记失败时画布节点与待落画布条语义照旧，agent 登记纪律仍是兜底。
 */
export async function registerUserReferenceAssets(
  registry: ProjectRegistry,
  projectId: string,
  items: readonly UserRefItem[],
): Promise<UserRefOutcome> {
  const load = await loadStoryboard(registry, projectId).catch(() => null)
  if (load === null || load.status !== 'ok') {
    return { registered: 0, skipped: 0, rejected: ['故事板不可用（未创建 / 损坏 / 旧格式）'] }
  }
  const { entries, rejected } = planUserRefEntries(items, load.document.sections['07_assets'])
  if (entries.length === 0) {
    return { registered: 0, skipped: items.length, rejected }
  }
  await updateStoryboardOrFail(registry, projectId, (doc) => ({
    ...doc,
    sections: { ...doc.sections, '07_assets': [...doc.sections['07_assets'], ...entries] },
  }))
  return { registered: entries.length, skipped: items.length - entries.length - rejected.length, rejected }
}
