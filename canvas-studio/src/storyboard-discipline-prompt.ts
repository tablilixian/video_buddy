/**
 * REQ-022（CV-295b）· 把「拍摄定稿」的全局纪律注入 system prompt（`order: 153`）。
 *
 * 契约 §12.2 四层通道的第 1 层：**§00 创意前提 + §08 硬约束**进 system prompt。
 * 另外三层各归其位（§04 → agent 组装 prompt；§05 lockedPrompt / §02 tokens → 资产卡；
 * 每镜内容由 agent 消费），本模块只管这一层。
 *
 * ## 三条口径
 *
 * 1. **只注入已落地的成稿**（`versions.final !== null`）。未落地时故事板还在改，
 *    把草稿纪律灌进 prompt 会让 agent 按一份随时会变的东西干活。
 * 2. **不是 prompt 合并器**（契约 §12.3）：Host **不做隐式 prompt 合并** ——
 *    中文纪律无法可靠英译，且强制覆盖显式 prompt 会把用户的手改弹回。这里只
 *    「告诉 agent 有这么几条纪律」，组装权仍在 agent。
 * 3. **§08 归 L 类**：改约束不改画布拓扑 ⇒ 直写 sections + 刷本缓存，不触发结构修订。
 *
 * 实现照抄 `plan-prompt.ts`：小节 text 必须是**同步** provider，而读故事版是异步的，
 * 所以用模块级 per-cwd 缓存桥接；`agent/created` 预热 + provider 内兜底自愈刷新。
 *
 * 注意：文本中不得出现 `{{variable}}` —— renderPrompt 对未知引用会直接抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectRegistry } from './projects.js'
import { loadStoryboard } from './storyboard-store.js'
import type { StoryboardDocument } from './contracts/storyboard.js'

/** system prompt 小节名（命名空间化防冲突；重名注册会抛错）。 */
export const STORYBOARD_DISCIPLINE_SECTION_NAME = 'canvas-studio:storyboard-discipline'

/**
 * 小节顺序。
 *
 * 100–199 为工具使用指引带：150 = skill 路由、151 = 项目预置、152 = 资产库清单，
 * 本段取 **153**（契约原稿写 152 有误 —— 152 已被资产库占用，2026-10-10 实测修正）。
 */
export const STORYBOARD_DISCIPLINE_SECTION_ORDER = 153

/** cwd → 纪律小节文本（未落地 / 无故事版的项目不入表）。 */
const cache = new Map<string, string>()

/** 从 assemble 上下文取会话 cwd（agent 由 dispatch 注入，非 AssembleContext 声明字段）。 */
function agentCwdOf(context: unknown): string | undefined {
  const agent = (context as { agent?: { session?: { header?: { cwd?: string } } } }).agent
  return agent?.session?.header?.cwd
}

/**
 * 由已落地的故事版生成小节正文。纯函数，可单测。
 *
 * @returns 空串表示「无可注入的纪律」（未落地 / 三节都空），调用方跳过注入。
 */
export function storyboardDisciplineText(document: StoryboardDocument | undefined): string {
  if (document === undefined) return ''
  if (document.landed === null) return ''
  const sections = document.landed.sections
  const constraints = sections['08_constraints'].filter((item) => item.trim() !== '')
  const premise = sections['00_creative'].brief.trim()
  const tokens = sections['02_visual'].tokens.filter((token) => token.v.trim() !== '')
  if (premise === '' && constraints.length === 0 && tokens.length === 0) return ''

  const lines: string[] = [
    '# 拍摄定稿纪律（来源：本项目故事版 · 逐次生成都必须遵守）',
    '',
    '以下内容来自用户已确认的拍摄定稿（全片规划的唯一事实源）。它们是**硬纪律**，不是建议：每次生成提示词都要满足，出现冲突时以本段为准。',
  ]
  if (premise !== '') {
    lines.push('', `## 创意前提（故事版 §00）`, premise)
  }
  if (tokens.length > 0) {
    lines.push('', '## 视觉规范（故事版 §02）')
    for (const token of tokens) lines.push(`- ${token.k}：${token.v}`)
  }
  if (constraints.length > 0) {
    lines.push('', '## 硬约束（故事版 §08）')
    for (const constraint of constraints) lines.push(`- ${constraint}`)
  }
  lines.push('', '另外：每镜的画面内容与运镜以故事版 §04 定稿的那一条为基底，不要自行另起一套。')
  return lines.join('\n')
}

/** 读取缓存文本（未预热返回空串）。 */
export function cachedStoryboardDisciplineText(cwd: string | undefined): string {
  if (!cwd) return ''
  return cache.get(cwd) ?? ''
}

/** 刷新某个 cwd 的纪律缓存（读盘失败按「无可注入」处理，不抛）。 */
export async function refreshStoryboardDisciplineCache(
  registry: ProjectRegistry,
  cwd: string | undefined,
): Promise<void> {
  if (cwd === undefined || cwd === '') return
  try {
    const project = (await registry.list()).find((entry) => entry.dir === cwd)
    if (project === undefined) {
      cache.delete(cwd)
      return
    }
    const load = await loadStoryboard(registry, project.id)
    // 损坏时按「无可注入」处理：纪律缺失不会让 agent 失控，而把损坏内容当纪律注入更糟。
    const text = load.status === 'ok' ? storyboardDisciplineText(load.document) : ''
    if (text === '') cache.delete(cwd)
    else cache.set(cwd, text)
  } catch {
    /* 读盘失败按无可注入处理 */
  }
}

/**
 * 注册故事版纪律小节 + `agent/created` 缓存预热。
 * @returns 联合 disposer（同时移除小节与事件监听）。
 */
export function registerStoryboardDisciplinePrompt(ctx: Pick<Context, 'systemPrompt' | 'on'>, registry: ProjectRegistry): () => void {
  const disposeSection = ctx.systemPrompt.section({
    name: STORYBOARD_DISCIPLINE_SECTION_NAME,
    order: STORYBOARD_DISCIPLINE_SECTION_ORDER,
    text: (context) => {
      const cwd = agentCwdOf(context)
      if (cwd === undefined) return ''
      if (!cache.has(cwd)) {
        // 兜底自愈：预热未覆盖（测试直连 / 事件错过 / 落地后才开会话）时异步刷新，下一轮生效。
        void refreshStoryboardDisciplineCache(registry, cwd)
        return ''
      }
      return cache.get(cwd) ?? ''
    },
  })
  const disposeListener = ctx.on('agent/created', ({ agent }) => {
    void refreshStoryboardDisciplineCache(registry, agent?.session?.header?.cwd)
    return undefined
  })
  return () => { disposeSection(); disposeListener() }
}
