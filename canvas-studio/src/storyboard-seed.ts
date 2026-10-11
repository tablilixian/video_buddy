/**
 * REQ-022（CV-295a）· `seed(storyboard) → 画布节点/资产` —— **纯函数**，对终版做投影。
 *
 * 契约见 `docs/plans/REQ-022-storyboard数据契约.md` §7：这是 req3「干净落地」与
 * req4「拆分落节点」的落点。取值口径全对齐真实 `canvas.json` 拓扑（实测
 * `~/.videobuddy/canvas-studio/projects/.draft-202609-2/canvas.json`：
 * `user_brief → write_screenplay → submit_storyboard_for_approval(operationType:'storyboard',
 * declaredDuration/declaredFrames/sourceIds) → image → video`，且 `assets[]` 有
 * `role:'style'` 带 `anchorNodeIds`/`lockedPrompt`）—— 所以 seed 产物与既有
 * `video_composite` 的 `sourceIds`/`shotNodeIds` 拉节点链路**同构，那条链路零改动**。
 *
 * ## 三条硬纪律
 *
 * 1. **只造骨架，不预生成媒体**（§7.7）：角色图 / 场景图 / 视频留给执行期的
 *    `image_generate` / `character_sheet` / `video_composite`。seed 只造锚点文档、
 *    分镜卡、资产定义 + 占位图节点、旁白参数节点。
 * 2. **显式丢弃**（§7.4）：版本历史、编辑痕迹、§01 里 `status:'pending'` 的待核实项、
 *    agent 对话、活副本状态、回退指针 —— 一个新节点都不落。
 * 3. **镜号一次铸造、永不重排**（§7.6）：按 scene×shot 遍历序铸全局号 1..N；
 *    后续结构修订新增取 `max+1`、删除留空号。素材组 / 产物命名（`分镜 N · 关键帧`、
 *    `分镜 N · 素材`）全钉在镜号上，重编 = 全线孤儿。
 *
 * ## 纯函数，不碰盘
 *
 * 本模块`不`读写文件、不 new UUID 之外的副作用（`id` 由调用方注入以便测试确定性）。
 */

import type { StudioAsset, StudioCanvasNode } from './contracts/canvas.js'
import { SEED_ANCHOR_TOOL, SEED_SHOT_TOOL } from './contracts/canvas.js'
import type { StoryboardDocument, StoryboardSections } from './contracts/storyboard.js'

/** seed 结果（调用方负责落盘）。 */
export interface StoryboardSeedPlan {
  readonly nodes: readonly StudioCanvasNode[]
  readonly assets: readonly StudioAsset[]
  /** 本次铸出的镜号范围（1 基，含），供返回文案与后续 delta re-seed 对照。 */
  readonly shotNumbers: readonly number[]
}

/** seed 选项。 */
export interface StoryboardSeedOptions {
  /** 节点 id 生成器（默认 `crypto.randomUUID`；测试注入可复现序列）。 */
  readonly newId?: () => string
  /** 时间戳（默认 `Date.now()`）。 */
  readonly now?: number
  /** 画布上已有的「创意」节点 id（有则挂到锚点的 `sourceIds`，血缘 锚点 → 创意）。 */
  readonly briefNodeId?: string
  /** 版本文案（如 `v2` / `live`），写进锚点标题。 */
  readonly sourceVersion?: string
}

/** 分镜卡正文里的稳定字段标签（契约 §8.4：渲染器与解析器共享这一份定义）。 */
export const SHOT_TEXT_LABELS = {
  index: '镜',
  visual: '视觉',
  camera: '运镜',
  audio: '声音',
  narration: '旁白',
  prompt: '英文 prompt',
} as const

/** 单行文本兜底（空值 → `—`，让卡面不留空白也不误导）。 */
function orDash(value: string): string {
  return value.trim() === '' ? '—' : value
}

/**
 * 分镜卡正文模板 —— **带稳定字段标签**，供将来 L 类回写反向解析
 * （契约 §8.4：渲染器与解析器共享一份模板定义，避免「写得进、读不回」）。
 */
export function shotCardText(mirror: number, shot: StoryboardSections['04_storyboard']['scenes'][number]['shots'][number]): string {
  const lines = [
    `【${SHOT_TEXT_LABELS.index} ${String(mirror)}】${orDash(shot.visual)}`,
    `【${SHOT_TEXT_LABELS.camera}】${orDash(shot.camera)}`,
    `【${SHOT_TEXT_LABELS.audio}】${orDash(shot.audio)}`,
  ]
  if (shot.narrationRef !== undefined && shot.narrationRef !== '') {
    lines.push(`【${SHOT_TEXT_LABELS.narration}】${shot.narrationRef}`)
  }
  if (shot.promptEn !== undefined && shot.promptEn.trim() !== '') {
    lines.push(`【${SHOT_TEXT_LABELS.prompt}】${shot.promptEn}`)
  }
  return lines.join('\n')
}

/** 锚点文档节点正文（参数 / 创意 / 事实锚点三段，契约 §7.5 #1）。 */
export function anchorText(document: StoryboardDocument): string {
  const { sections, meta } = document
  const verified = sections['01_facts'].facts.filter((fact) => fact.status === 'verified')
  return [
    `【参数】${meta.targetDuration.toFixed(1)}s · ${orDash(meta.aspect)} · ${orDash(meta.genre)}`,
    `【创意】${orDash(sections['00_creative'].brief)}`,
    verified.length === 0
      ? '【事实锚点】—'
      : `【事实锚点】\n${verified.map((fact) => `- ${fact.claim}${fact.source.trim() === '' ? '' : `（${fact.source}）`}`).join('\n')}`,
  ].join('\n')
}

/** 旁白与声音参数节点正文（契约 §7.5 #4：逐句旁白 + BGM 参数模板）。 */
export function soundParamsText(sections: StoryboardSections): string {
  const { bgm, sfx } = sections['06_sound']
  const lines = sections['03_narration'].lines.length === 0
    ? ['【旁白】本片无旁白']
    : [
        '【旁白】',
        ...sections['03_narration'].lines.map((line) =>
          `- ${line.id}（${line.duration.toFixed(1)}s）：${orDash(line.text)}`),
      ]
  lines.push(
    `【BGM】BPM ${bgm.bpm > 0 ? String(bgm.bpm) : '—'} · 响度 ${bgm.lufs !== 0 ? `${String(bgm.lufs)} LUFS` : '—'}`
      + ` · 侧链避让 ${orDash(bgm.sidechain)}`,
  )
  lines.push(sfx.length === 0 ? '【音效】—' : `【音效】${sfx.join(' / ')}`)
  return lines.join('\n')
}

/** 简单网格布局（列宽固定；落位精细整形交给既有「整理布局」）。 */
function grid(index: number, columns: number, originX: number, originY: number, boxWidth: number, boxHeight: number, gap = 24): { x: number; y: number } {
  const col = index % columns
  const row = Math.floor(index / columns)
  return { x: originX + col * (boxWidth + gap), y: originY + row * (boxHeight + gap) }
}

/**
 * 把故事版终版投影成画布节点与资产（**纯计算，不落盘**）。
 *
 * 十行映射（契约 §7.5）中「不落」的四行在这里体现为**什么都不做**：
 * §01 pending 项、`05[].profile/palette/appearsIn`、§07（上传时参考节点已落）、
 * §08（纪律注入走 system prompt，不落节点）。
 */
export function planSeedFromStoryboard(
  document: StoryboardDocument,
  options: StoryboardSeedOptions = {},
): StoryboardSeedPlan {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now()
  const { sections } = document
  const nodes: StudioCanvasNode[] = []
  const assets: StudioAsset[] = []

  // ── 行 1：锚点文档节点（血缘新宿主） ──
  const anchor: StudioCanvasNode = {
    id: newId(),
    kind: 'text',
    toolName: SEED_ANCHOR_TOOL,
    title: `${document.title} 拍摄定稿 · ${options.sourceVersion ?? '终版'}`,
    text: anchorText(document),
    x: 0,
    y: 0,
    width: 460,
    height: 220,
    createdAt: now,
    origin: 'agent',
    sourceIds: options.briefNodeId === undefined ? [] : [options.briefNodeId],
    // 锚点是只读投影，没有回写需求 ⇒ 不带 sbRef（契约 §7.5 锚点规格）。
  }
  nodes.push(anchor)

  // ── 行 5：分镜卡 ×N（镜号按 scene×shot 遍历序一次铸造） ──
  const shotNumbers: number[] = []
  let mirror = 0
  for (const scene of sections['04_storyboard'].scenes) {
    for (const shot of scene.shots) {
      mirror += 1
      shotNumbers.push(mirror)
      const position = grid(mirror - 1, 4, 0, 280, 300, 200)
      nodes.push({
        id: newId(),
        kind: 'text',
        toolName: SEED_SHOT_TOOL,
        operationType: 'storyboard',
        title: `分镜 ${String(mirror)} · ${shot.id} · ${orDash(shot.camera)}`,
        text: shotCardText(mirror, shot),
        x: position.x,
        y: position.y,
        width: 300,
        height: 200,
        createdAt: now + mirror,
        origin: 'agent',
        sourceIds: [anchor.id],
        declaredDuration: shot.duration,
        declaredFrames: shot.frames,
        sbRef: `04:${scene.id}/shots/${shot.id}`,
      })
    }
  }

  // ── 行 3：§02 tokens → style 资产卡（挂既有 Look 样张由执行期补 anchorNodeIds） ──
  if (sections['02_visual'].tokens.length > 0) {
    assets.push({
      id: newId(),
      name: `Look · ${document.meta.genre.trim() === '' ? '本片' : document.meta.genre}`,
      role: 'style',
      // 无锚点分图：seed 不预生成样张（§7.7）。执行期出样张后由 agent 补锚点。
      anchorNodeIds: [],
      lockedPrompt: sections['02_visual'].tokens.map((token) => `${token.k}：${token.v}`).join('\n'),
      createdAt: now,
      sbRef: '02:look',
    })
  }

  // ── 行 4：§03 + §06 → 旁白与声音参数 text 节点 ──
  const soundNode: StudioCanvasNode = {
    id: newId(),
    kind: 'text',
    title: '旁白与声音',
    text: soundParamsText(sections),
    x: 0,
    y: 520,
    width: 380,
    height: 180,
    createdAt: now + 1,
    origin: 'agent',
    sourceIds: [anchor.id],
    sbRef: '03',
  }
  nodes.push(soundNode)

  // ── 行 6：§05 gen → character 资产卡 + 占位 character-sheet 图节点 ──
  let characterRow = 0
  for (const character of sections['05_characters']) {
    const assetId = newId()
    const placeholderId = newId()
    const label = character.label.trim() === '' ? character.name : character.label
    const position = grid(characterRow, 3, 440, 520, 260, 200)
    characterRow += 1
    assets.push({
      id: assetId,
      name: character.name.trim() === '' ? label : character.name,
      role: 'character',
      anchorNodeIds: [placeholderId],
      lockedPrompt: character.gen.lockedPrompt,
      ...(character.gen.negativePrompt.trim() === '' ? {} : { negativePrompt: character.gen.negativePrompt }),
      createdAt: now,
      sbRef: `05:${character.id}`,
    })
    nodes.push({
      id: placeholderId,
      kind: 'image',
      toolName: 'character_sheet',
      operationType: 'character-sheet',
      // 「待生成」写进标题而不是 generationPrompt —— 后者的全库语义是
      // **JSON 编码的请求参数**，塞裸文本会让节点重放与 auto-test-checkpoints
      // 的断言同时读错（契约 §7.5 #6 的修正点）。
      title: `角色 · ${label}（待生成）`,
      x: position.x,
      y: position.y,
      width: 260,
      height: 200,
      createdAt: now + 2 + characterRow,
      origin: 'agent',
      sourceIds: [anchor.id],
      assetId,
      sbRef: `05:${character.id}`,
    })
  }

  return { nodes, assets, shotNumbers }
}
