/**
 * 清晰度档位的**唯一决策实现**：节点显式 > 项目预置 > 设置页默认 > 出厂默认。
 *
 * ## 为什么必须只有一个 resolver
 *
 * 改造前生成链有 `generate.ts` 的 `resolutionOf()`，UI 各有各的 fallback
 * （`NodeInputCard.tsx:830` 写 `|| '736p'`、`CanvasNode.tsx:391` 写 `|| '480p'`）——
 * 于是同一个视频节点在输入框显示 720P、在画布角标显示 480P、实际出片又是设置页的
 * 480P。**读数说谎的根因不是文案，是有三份判定**。
 *
 * 现在生成链与三处 UI 读数调用同一个函数：UI 显示的就是即将生效的值，并且能读到
 * `source` 告诉用户"这是继承来的还是你点过的"。
 *
 * ## 为什么没有 `kind: 'image' | 'video'` 参数
 *
 * 图片与视频的差别**只在于设置页读哪个字段**（`defaultImageResolution` /
 * `defaultVideoResolution`，出厂值不同：图片 720P、视频 480P）。让调用方自己选好
 * 再传进来的好处是：本模块不需要知道设置项长什么样，`node --test` 可以零依赖直连，
 * 且不会出现「resolver 里再写一遍哪个 kind 读哪个字段」的第二份映射。
 *
 * 纯函数、无 IO、无 React。
 */
import { DEFAULT_RESOLUTION_ID, normalizeResolutionId, type ResolutionId } from './resolution-tiers.js'

/** 生效值来自哪一层（UI 用来渲染「跟随项目 / 跟随默认」这类读数）。 */
export type ResolutionSource = 'node' | 'plan' | 'settings' | 'fallback'

/** 决策结果：档位 + 来源。 */
export interface ResolvedResolution {
  readonly id: ResolutionId
  readonly source: ResolutionSource
}

/** 决策入参（三个都缺省 = 未指定，落到出厂默认）。 */
export interface ResolveResolutionInput {
  /** 节点 `generationPrompt.resolution`（用户在这个节点上点过的值）。 */
  readonly nodeValue?: unknown
  /**
   * 项目预置 `project.plan.videoResolution`（新建项目时锁定的值）。
   *
   * ⚠️ **只对视频传**：这一项语义是「本项目成片要多少」，图片档位归图片节点与
   * 会话设置管。生成链（`generate.ts` 的 `resolutionOf`）按 `kind` 硬切，
   * 客户端（`CanvasSurface` 的 `resolutionInheritFor`）也只给视频节点带 plan。
   */
  readonly planValue?: unknown
  /** 设置页对应字段（图片 → `defaultImageResolution`，视频 → `defaultVideoResolution`）。 */
  readonly settingValue?: unknown
}

/**
 * 解析当前生效档位。逐层归一（历史键 `736p` / `2k` 在这一步就地转换），
 * 任何一层的脏值都视为「该层未指定」，**不阻断**后续层 —— 一个坏字段不该让整条链失效。
 */
export function resolveResolution(input: ResolveResolutionInput): ResolvedResolution {
  const node = normalizeResolutionId(input.nodeValue)
  if (node !== undefined) return { id: node, source: 'node' }
  const plan = normalizeResolutionId(input.planValue)
  if (plan !== undefined) return { id: plan, source: 'plan' }
  const settings = normalizeResolutionId(input.settingValue)
  if (settings !== undefined) return { id: settings, source: 'settings' }
  return { id: DEFAULT_RESOLUTION_ID, source: 'fallback' }
}

/** 来源 → 用户可见短名（与 `studio-defaults.ts` 的 `SOURCE_LABELS` 同一套措辞）。 */
export const RESOLUTION_SOURCE_LABELS: Readonly<Record<ResolutionSource, string>> = {
  node: '节点指定',
  plan: '项目预置',
  settings: '设置页',
  fallback: '出厂默认',
}
