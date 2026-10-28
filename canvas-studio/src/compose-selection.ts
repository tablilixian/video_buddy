/**
 * CV-006 / CV-007：合成选择的派生逻辑（纯函数，无 JSX / 无 IO）。
 *
 * 从 `client/StudioFrame.tsx` 抽出到根级（按 `style-grid.ts` 先例）：① Host 侧
 * node --test 可直接单测（client 打包产物是单文件 bundle，测试够不着）；② 客户端
 * 引用根级模块两要件：`tsconfig.client.json` include 追加 + import 带 `.js` 后缀。
 *
 * 职责单一：把「时间轴顺序 + 排除勾选 + BGM 下拉选择」归约成一次 `/compose` 请求
 * 需要的全部输入（clipIds / bgmNodeId / 预计成片时长 / 软提示）。硬校验不在这里做
 * —— BGM 短于成片的精确差额由服务端 CV-138 守卫报错，本模块只出 amber 软提示。
 */

import type { StudioCanvasNode } from './contracts/canvas.js'
import { isComposeProduct, isShotClip } from './shot-versions.js'

/** BGM 时长与预计成片时长的容差（秒）：差值在此以内不提示，与服务端守卫口径一致。 */
export const BGM_TOLERANCE_SECONDS = 0.05

/** resolveComposeSelection 的输入：时间轴有效顺序 + 用户勾选态。 */
export type ComposeSelectionInput = {
  /** 时间轴有效顺序（deriveTimelineOrder 产物，含全部 kind）。 */
  ordered: readonly StudioCanvasNode[]
  /** 用户显式排除的片段 id（view.composeExcluded）。 */
  excluded: readonly string[]
  /** 用户选中的 BGM 节点 id（view.composeBgmNodeId）；缺省 = 不使用。 */
  bgmNodeId?: string
}

/** 一次合成导出的完整输入与提示。 */
export type ComposeSelection = {
  /** 实际提交给 /compose 的片段 id（排除项与作废片段均已剔除）。 */
  clipIds: string[]
  /** 校验通过的 BGM 节点；undefined = 不使用（或引用失效自动回退）。 */
  bgmNode?: StudioCanvasNode
  /** 预计成片时长（秒）= Σ 有效纳入片段的真值 duration（缺探测值按 0 计）。 */
  estSeconds: number
  /** BGM 可能短于成片的软提示（不拦，服务端守卫兜底报精确差额）。 */
  warnings: string[]
  /** bgmNodeId 非空但节点已失效（删除/非音频/作废）——调用方据此把下拉回退「不使用」。 */
  bgmInvalid: boolean
}

/**
 * 片段可参与合成的有效性。
 *
 * CV-160：**委托给 `shot-versions.isShotClip`（全仓唯一权威口径）**——此前这里
 * 内联了 `kind==='video' && !retired && !supersededBy`，漏掉「非成片节点」一条，
 * 与 Host 的 `defaultComposeClips` 分叉：成片节点（kind=video + toolName=compose）
 * 被当成片段计入预计时长（15.51s → 30.99s），并会作为 clipId 再拼进下一次成片。
 * 判片段的口径只允许有一份，UI / 估算 / Host 必须同源。
 */
export function isComposableClip(node: StudioCanvasNode): boolean {
  return isShotClip(node)
}

/** 合成产物（成片）：时间轴上要显示但**不计入**片段数与预计时长（CV-160）。 */
export function isComposedFilm(node: StudioCanvasNode): boolean {
  return isComposeProduct(node)
}

/** BGM 候选有效性：只收存活的音频节点（CV-006 拍板：不列成片节点，少一个歧义源）。 */
export function isValidBgmNode(node: StudioCanvasNode | undefined): node is StudioCanvasNode {
  return node !== undefined
    && node.kind === 'audio'
    && node.retired !== true
    && node.supersededBy === undefined
}

/**
 * 把时间轴 + 勾选态归约成一次合成请求的输入。
 * 纯函数：不读 store、不发请求；排除语义 = 「显式排除优先于一切」，作废片段
 * 在勾选区直接禁用（不进 excluded），所以这里不需要再防两者冲突。
 */
export function resolveComposeSelection(input: ComposeSelectionInput): ComposeSelection {
  const { ordered, excluded } = input
  const excludedSet = new Set(excluded)

  const clips = ordered.filter(node => isComposableClip(node) && !excludedSet.has(node.id))
  const clipIds = clips.map(node => node.id)
  const estSeconds = clips.reduce((sum, node) => sum + (typeof node.duration === 'number' ? node.duration : 0), 0)

  const warnings: string[] = []
  const bgmCandidate = input.bgmNodeId === undefined
    ? undefined
    : ordered.find(node => node.id === input.bgmNodeId)
  const bgmNode = isValidBgmNode(bgmCandidate) ? bgmCandidate : undefined
  const bgmInvalid = input.bgmNodeId !== undefined && bgmNode === undefined

  if (bgmNode !== undefined && typeof bgmNode.duration === 'number'
    && estSeconds > 0 && bgmNode.duration + BGM_TOLERANCE_SECONDS < estSeconds) {
    const shortfall = estSeconds - bgmNode.duration
    warnings.push(
      `BGM（${bgmNode.duration.toFixed(2)}s）可能比预计成片（${estSeconds.toFixed(2)}s）短 ≈${shortfall.toFixed(2)}s，合成会被拒绝 —— 建议先让 agent 生成更长的 BGM`,
    )
  }

  return {
    clipIds,
    ...(bgmNode !== undefined ? { bgmNode } : {}),
    estSeconds,
    warnings,
    bgmInvalid,
  }
}

/**
 * CV-204：成片节点的血缘 = 片段 + BGM + 文案，去重保序。
 *
 * 「成片用了哪条 BGM / 哪篇文案」此前只被消费（混音 / 内嵌 script 快照）不进
 * 血缘，图上读不出「v6 成片 ↔ BGM ↔ 文案」这组关系。两处调用点（Host 工具
 * `compose_video` 与客户端时间轴导出）此前各写了一份 `new Set` 展开 —— 按
 * 「同一规则只准一份实现」收口到这里，测试直连本模块。
 */
export function composedSourceIds(
  clipIds: readonly string[],
  bgmNodeId?: string,
  scriptId?: string,
  voiceOverNodeIds?: readonly (string | { nodeId: string })[],
): string[] {
  return [...new Set([
    ...clipIds,
    ...(bgmNodeId !== undefined && bgmNodeId !== null ? [bgmNodeId] : []),
    ...(scriptId !== undefined && scriptId !== null ? [scriptId] : []),
    // S2b（2026-10-28）：多句旁白也是成片的血缘源（与 bgmNodeId 并存）。
    ...(voiceOverNodeIds ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.nodeId)),
  ])]
}

/** 混入音源的角色（CV-334 · D6；S3 起住在本文件 —— 客户端混音面板要复用，
 *  而 compose.js 是 Host 重模块）。`compose.ts` 原样再导出保持老 import 路径。 */
export type AudioMixRole = 'bgm' | 'voiceOver'

/**
 * 判定一个画布音频节点该按「配乐」还是「旁白」混入（纯函数）。
 *
 * 判据顺序（先硬后软，任一层命中即返回）：
 * 1. **来源工具**：`tts_voiceover` 一定是旁白；`music_generation` / `cut_audio` 按其
 *    源头判断（`cut_audio` 裁的是旁白就还是旁白 —— 见第 2 层语义）。
 * 2. **标题关键词**：老节点 / 手工改过名的节点没有可靠 toolName，用标题兜底
 *    （旁白、配音、口播、念白、narration、voiceover、voice-over）。
 * 3. 兜底 `bgm`：宁可当配乐（多一条淡入淡出），也不要误把配乐当旁白灌满音量。
 */
export function resolveAudioMixRole(node: Pick<StudioCanvasNode, 'toolName' | 'title'> | undefined): AudioMixRole {
  if (node === undefined) return 'bgm'
  const tool = node.toolName ?? ''
  if (tool === 'tts_voiceover') return 'voiceOver'
  if (tool === 'music_generation') return 'bgm'
  const title = node.title ?? ''
  if (/旁白|配音|口播|念白|narration|voice[\s-]?over/i.test(title)) return 'voiceOver'
  return 'bgm'
}

// ── S3（2026-10-28 · CV-040 收口）：节点级混音设置与导出前预检 ─────────────

/**
 * 从音频节点读混音覆盖（纯函数，客户端混音面板与 Host 装配共用同一实现）：
 * 节点 `audioTimeline` 的第一段匹配角色时生效（混音面板写回的形态）。
 */
export function nodeAudioOverride(node: Pick<StudioCanvasNode, 'audioTimeline'>, role: 'bgm' | 'voiceOver'): AudioTimelineOverride | undefined {
  const segments = node.audioTimeline?.segments ?? []
  return segments.find((segment) => segment.role === role)
}

/** 节点混音覆盖允许的字段（AudioSegment 的子集 —— 只放表现参数，不放来源）。 */
export type AudioTimelineOverride = import('./audio-timeline.js').AudioSegment

/**
 * 组装要写回的 audioTimeline（纯函数）：保留其它角色的段，替换本角色的第一段。
 * 混音面板每次滑杆/开关变更都经此写回节点（StudioCanvasNode.audioTimeline）。
 */
export function buildNodeAudioTimeline(
  node: Pick<StudioCanvasNode, 'audioTimeline' | 'url'>,
  role: 'bgm' | 'voiceOver',
  patch: Partial<Pick<AudioTimelineOverride, 'gain' | 'fadeInSec' | 'fadeOutSec' | 'duckAmount' | 'startSec'>>,
): import('./audio-timeline.js').AudioTimeline {
  const base = node.audioTimeline ?? { fps: 0, durationSec: 0, segments: [] as AudioTimelineOverride[] }
  const url = node.url ?? ''
  const existing = base.segments.filter((segment) => segment.role !== role)
  const prior = nodeAudioOverride(node, role)
  const gain = patch.gain ?? prior?.gain
  const fadeInSec = patch.fadeInSec ?? prior?.fadeInSec
  const fadeOutSec = patch.fadeOutSec ?? prior?.fadeOutSec
  const duckAmount = patch.duckAmount ?? prior?.duckAmount
  const segment: AudioTimelineOverride = {
    url,
    startSec: patch.startSec ?? prior?.startSec ?? 0,
    role,
    ...(gain !== undefined ? { gain } : {}),
    ...(fadeInSec !== undefined ? { fadeInSec } : {}),
    ...(fadeOutSec !== undefined ? { fadeOutSec } : {}),
    ...(duckAmount !== undefined ? { duckAmount } : {}),
  }
  return { fps: base.fps, durationSec: base.durationSec, segments: [segment, ...existing] }
}

/** 导出前预检结论：confirm = 弹确认（不硬拦，给「补静音/重新生成/继续」出路）。 */
export interface ComposeAudioPrecheck {
  level: 'ok' | 'confirm'
  /** confirm 级的中文说明（window.confirm 文案；ok 级为 undefined）。 */
  message?: string
}

/**
 * 导出前音频预检（纯函数；客户端只知道自己探测到的真值 —— 片段原生声有无由
 * Host 装配期判定，这里只查客户端可知的三类）：
 * ① BGM 短于预计成片 → 确认（D-02：继续则装配自动补静音并明确告知；取消 = 重新生成 BGM）；
 * ② 画布上没有任何音频节点且未选 BGM → 确认（成片可能只有片段原生声甚至无声）；
 * ③ 已知信息都对齐 → ok 不打扰。
 */
export function composeAudioPrecheck(input: {
  bgmDurationSec?: number | undefined
  estSeconds: number
  hasAnyAudioNode: boolean
}): ComposeAudioPrecheck {
  const { estSeconds, hasAnyAudioNode } = input
  const bgm = input.bgmDurationSec
  if (typeof bgm === 'number' && bgm > 0 && estSeconds > 0 && bgm < estSeconds - 0.05) {
    return {
      level: 'confirm',
      message: `BGM（${bgm.toFixed(1)}s）比预计成片（${estSeconds.toFixed(1)}s）短 ${(estSeconds - bgm).toFixed(1)}s。`
        + '\n\n确定 = 继续导出（成片将自动补静音并明确标注）；取消 = 回去重新生成更长的 BGM。',
    }
  }
  if (bgm === undefined && !hasAnyAudioNode && estSeconds > 0) {
    return {
      level: 'confirm',
      message: '画布上没有任何音频节点，也未选 BGM —— 成片将只有片段原生声（片段未开启原生声时无声）。'
        + '\n\n确定 = 继续导出；取消 = 先生成 BGM/旁白再导出。',
    }
  }
  return { level: 'ok' }
}
/** 混音面板的行派生（纯函数供测试）：从画布节点集合导出面板输入。 */
export function audioMixRows(nodes: readonly StudioCanvasNode[], bgmNodeId: string | undefined): { bgmNode?: StudioCanvasNode; voiceOverNodes: StudioCanvasNode[] } {
  const bgmNode = bgmNodeId !== undefined ? nodes.find((node) => node.id === bgmNodeId) : undefined
  // tts_voiceover 产物 = 旁白；标题关键词兜底（与 compose-selection.resolveAudioMixRole 同口径）。
  const voiceOverNodes = nodes.filter((node) => node.kind === 'audio'
    && (node.toolName === 'tts_voiceover' || /旁白|配音|口播|念白|narration|voice[\s-]?over/i.test(node.title ?? '')))
  return { ...(bgmNode !== undefined ? { bgmNode } : {}), voiceOverNodes }
}

/** 音频节点的展示行派生（纯函数供测试）：全部音频节点 + 角色 + 歌词首行 + 失效标记。 */
export function audioDrawerRows(nodes: readonly StudioCanvasNode[]): Array<{
  node: StudioCanvasNode
  role: 'bgm' | 'voiceOver'
  retired: boolean
  lyricFirstLine?: string
  durationSec?: number
}> {
  return nodes
    .filter((node) => node.kind === 'audio')
    .map((node) => {
      const lyric = typeof node.text === 'string' && node.text.trim().length > 0
        ? node.text.trim().split('\n')[0]
        : undefined
      return {
        node,
        role: resolveAudioMixRole(node),
        retired: node.retired === true || node.supersededBy !== undefined,
        ...(lyric !== undefined ? { lyricFirstLine: lyric } : {}),
        ...(typeof node.duration === 'number' && node.duration > 0 ? { durationSec: node.duration } : {}),
      }
    })
}

