/**
 * 故事板强约束 **L4 · 老项目迁移**：从**画布上已有的分镜卡**反推一份故事板骨架。
 *
 * ## 为什么必须有这一层
 *
 * L1 让「未落地 ⇒ 产线工具不可用」变成硬约束，而拍板是**不豁免存量**。于是一个在故事板
 * 强制之前就落了画布、没有 `storyboard.json` 的老项目，第一次调产线工具就会被 `CS-STORY-001`
 * 拦下。拦下本身是对的（L1 要的就是这个），但如果**没有出路**，"不豁免存量"就等于"老项目全废"。
 *
 * 所以本模块只做一件事：把画布上**真的存在的**事实还原成 §04，剩下的留空并在阻断项里点名。
 * 宁可留下 3 条待补，也不猜（猜出来的 token / 角色会污染全片，且用户看不出是猜的）。
 *
 * ## 只还原卡上有的
 *
 * | 来源 | 能反推 | 拿不到（留空 + 阻断项点名） |
 * |---|---|---|
 * | 分镜卡 `sbRef` | scene id / shot id | —— |
 * | `declaredDuration` / `declaredFrames` | 时长 / 帧数 | —— |
 * | 卡面正文 `【视觉】/【运镜】/【声音】/【旁白】/【英文 prompt】` | visual / camera / audio / narrationRef / promptEn | 旁白**原文**（卡上只有引用号，正文在 §03） |
 * | 卡面正文 `【面部】` 标记 | `facesVisible:false` | —— |
 * | 项目预置 `plan` | `meta.aspect` / `meta.targetDuration` | `meta.genre` |
 * | —— | —— | §02 视觉规范 / §05 角色 / §01 事实锚点 |
 *
 * ## 为什么不用 `title` 兜底反推 id
 *
 * `title` 是给人看的（`分镜 3 · S1-Sh1 · 缓慢推进`），用户手改卡标题就会改坏它；
 * `sbRef` 是结构化回指针（契约 §7.6），只在 seed 写入时产生，稳定得多。
 * 所以 `sbRef` 优先，`title` 只在没有 `sbRef` 的历史卡上兜底。
 */
import { SEED_SHOT_TOOL, type StudioCanvasNode } from './contracts/canvas.js'
import { SHOT_TEXT_LABELS, SHOT_NO_FACE_MARKER } from './storyboard-seed.js'
import type { StoryboardSections } from './contracts/storyboard.js'

/** 反推结果：只填 §04，其余保持空（由调用方合并进现文档）。 */
export interface AdoptedStoryboard {
  /** §04 分镜（按画布上出现的顺序，scene 内 shot 按 `declaredDuration` 之前的原始顺序）。 */
  readonly storyboard: StoryboardSections['04_storyboard']
  readonly scenes: number
  readonly shots: number
  /** 反推过程中降级的地方（如「N 张卡没有 sbRef，按标题反推」），要如实报给用户。 */
  readonly warnings: readonly string[]
}

/** `04:S1/shots/S1-Sh1` → `['S1', 'S1-Sh1']` */
const SB_REF_PATTERN = /^04:([^/]+)\/shots\/(.+)$/

/** `分镜 3 · S1-Sh1 · 缓慢推进` → 三段（历史卡没有 sbRef 时的兜底）。 */
function splitTitle(title: string | undefined): { sceneId?: string; shotId?: string; camera?: string } {
  if (title === undefined) return {}
  const parts = title.split('·').map((part) => part.trim())
  if (parts.length < 2) return {}
  const shotId = parts[1] ?? ''
  const sceneId = shotId.includes('-') ? shotId.split('-')[0] : shotId
  return {
    ...(sceneId === undefined || sceneId === '' ? {} : { sceneId }),
    ...(shotId === '' ? {} : { shotId }),
    ...(parts[2] === undefined || parts[2] === '' ? {} : { camera: parts[2] }),
  }
}

/** 从卡面正文里取一行 `【标签】值`；没有就返回 undefined（不猜）。 */
function cardField(text: string | undefined, label: string): string | undefined {
  if (text === undefined) return undefined
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(`【${label}`)) continue
    const close = trimmed.indexOf('】', 1)
    if (close < 0) continue
    const value = trimmed.slice(close + 1).trim()
    return value === '' || value === '—' ? undefined : value
  }
  return undefined
}

/**
 * 分镜卡 → §04。**纯函数**：不读盘、不写盘，节点数组进来、分镜数组出去（单测直连）。
 *
 * 空 id 的卡会被跳过并计数（无法作为语义 ID 使用），这比铸一个 `S1-Sh1` 假装成功安全。
 */
export function sectionsFromShotCards(nodes: readonly StudioCanvasNode[]): AdoptedStoryboard {
  const cards = nodes.filter((node) => node.toolName === SEED_SHOT_TOOL)
  const warnings: string[] = []
  let noRef = 0

  type Draft = {
    sceneId: string
    shot: {
      id: string
      duration: number
      frames: number
      camera: string
      visual: string
      audio: string
      promptEn?: string
      narrationRef?: string
      facesVisible?: boolean
      backup: false
    }
  }
  const drafts: Draft[] = []
  let skipped = 0

  for (const node of cards) {
    const fromRef = SB_REF_PATTERN.exec(node.sbRef ?? '')
    // 标题第三段是「运镜」（seed 写入时就是 `分镜 N · shotId · camera`）：**只有在卡面正文
    // 拿不到运镜时**才用它兜底。scene/shot 号则严格只认 sbRef —— 用户手改标题不该改 id。
    const titleParts = splitTitle(node.title)
    const fallback = fromRef === null ? titleParts : { ...(titleParts.camera === undefined ? {} : { camera: titleParts.camera }) }
    if (fromRef === null) noRef += 1
    const sceneId = (fromRef?.[1] ?? fallback.sceneId ?? '').trim()
    const shotId = (fromRef?.[2] ?? fallback.shotId ?? '').trim()
    if (sceneId === '' || shotId === '') {
      skipped += 1
      continue
    }
    const duration = typeof node.declaredDuration === 'number' && node.declaredDuration > 0
      ? node.declaredDuration
      : 3
    const frames = typeof node.declaredFrames === 'number' && node.declaredFrames > 0
      ? node.declaredFrames
      : Math.max(1, Math.round(duration * 30))
    const text = typeof node.text === 'string' ? node.text : undefined
    const camera = cardField(text, SHOT_TEXT_LABELS.camera) ?? fallback.camera ?? ''
    // 画面描述的落点随卡面形态有两种：seed 写的卡是 `【镜 N】<visual>`（`shotCardText`），
    // 手改过或早期卡可能是 `【视觉】<visual>`。先认前者，再认后者，都没有才留空。
    const visual = cardField(text, SHOT_TEXT_LABELS.index) ?? cardField(text, SHOT_TEXT_LABELS.visual) ?? ''
    const audio = cardField(text, SHOT_TEXT_LABELS.audio) ?? ''
    const promptEn = cardField(text, SHOT_TEXT_LABELS.prompt)
    const narrationRef = cardField(text, SHOT_TEXT_LABELS.narration)
    const noFace = text !== undefined && text.includes(SHOT_NO_FACE_MARKER)
    drafts.push({
      sceneId,
      shot: {
        id: shotId,
        duration,
        frames,
        camera,
        visual,
        audio,
        ...(promptEn === undefined ? {} : { promptEn }),
        ...(narrationRef === undefined ? {} : { narrationRef }),
        ...(noFace ? { facesVisible: false } : {}),
        backup: false,
      },
    })
  }

  if (noRef > 0) {
    warnings.push(`${String(noRef)} 张分镜卡没有结构化的 sbRef，按标题反推的 scene/shot 号 —— 请核对一遍，标题被手改过就会错位`)
  }
  if (skipped > 0) {
    warnings.push(`${String(skipped)} 张分镜卡读不出 scene/shot 号，已跳过（它们无法充当语义 ID）`)
  }

  // 按 sceneId 分组，保持画布上的先后顺序（不排序：用户摆的顺序就是叙事顺序）。
  // 本地用可变数组累加，返回时交给 readonly 契约类型。
  const scenes: Array<{ id: string; title: string; shots: Array<Draft['shot']> }> = []
  for (const draft of drafts) {
    const last = scenes[scenes.length - 1]
    if (last !== undefined && last.id === draft.sceneId) {
      last.shots.push(draft.shot)
      continue
    }
    scenes.push({ id: draft.sceneId, title: draft.sceneId, shots: [draft.shot] })
  }

  return {
    storyboard: { scenes },
    scenes: scenes.length,
    shots: drafts.length,
    warnings,
  }
}
