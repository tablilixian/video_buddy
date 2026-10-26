/**
 * 会话效率优化（2026-10-26，见 docs/plans/session-efficiency-and-layout-optimization-20261026.md）
 * · OPT-1 + OPT-5：把「项目执行模式（workflow.mode）」与「项目记录（projects.json）绝对路径」
 *   注入 system prompt，让 agent 无需翻源码 / 猜目录就能确定 confirm vs auto。
 *
 * 背景（2026-10-26 会话实测）：runtime context 快照不含 mode，模型用 6 轮推理 +
 * 查错目录 + 翻宿主源码才确认 mode=confirm，单会话浪费 ~5 min；projects.json
 * 路径也被猜错两次（~/.videobuddy 不存在该文件）。
 *
 * 实现照抄 `plan-prompt.ts`：小节 text 是**同步** provider，而 registry.list() 是
 * 异步的 → 模块级 per-cwd 缓存桥接；`agent/created` 预热 + provider 内兜底自愈。
 * 与 plan 小节的一点差异：**mode 会在会话中期被热切换**（settings 画布顶条 →
 * POST /canvas-studio/workflow setMode），且该路径不发事件 —— 所以 routes.ts 的
 * setMode 分支调用 `invalidateWorkflowModeCache()` 主动失效，provider 下一轮自愈刷新。
 *
 * 注意：文本中不得出现 `{{variable}}`——renderPrompt 对未知引用会直接抛错。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectRegistry } from './projects.js'
import { normalizeWorkflow } from './contracts/project.js'
import type { StudioWorkflowMode } from './contracts/project.js'

/** system prompt 小节名（命名空间化防冲突；重名注册会抛错）。 */
export const WORKFLOW_MODE_SECTION_NAME = 'canvas-studio:workflow-mode'

/**
 * 小节顺序。100–199 为工具使用指引带：150 skill 路由、151 项目预置、152 资产库、
 * 153 拍摄定稿纪律、154 激活集；本段取 **155**（模式与路径是「怎么干活」的元信息，
 * 排在内容类小节之后即可）。
 */
export const WORKFLOW_MODE_SECTION_ORDER = 155

/** cwd → 小节文本（cwd 不对应任何项目时不入表，与 plan-prompt 同口径）。 */
const cache = new Map<string, string>()

/** 从 assemble 上下文里取会话 cwd（agent 由 dispatch 注入，非 AssembleContext 声明字段）。 */
function agentCwdOf(context: unknown): string | undefined {
  const agent = (context as { agent?: { session?: { header?: { cwd?: string } } } }).agent
  return agent?.session?.header?.cwd
}

/**
 * 由执行模式 + 项目记录路径生成小节正文。纯函数，可单测。
 * @returns 空串表示无项目绑定（调用方跳过注入）。
 */
export function workflowModeSectionText(mode: StudioWorkflowMode, projectsFilePath: string): string {
  const modeLine = mode === 'auto'
    ? '- 当前执行模式：auto（放手跑）——除关键帧确认等保留闸口外连续推进；ask_user_choice 不提问、不等待，可自行决定的细节不要打断用户。'
    : '- 当前执行模式：confirm（逐步确认）——在阶段闸口（需求澄清、故事板落地、关键帧确认等）先用 ask_user_choice 征求用户确认再推进；不要假设可以连续执行到成片。'
  return `## Canvas Studio 执行模式（本会话绑定的项目）

${modeLine}
- 项目记录文件：${projectsFilePath}——项目清单、分组与工作流状态以该文件为事实源；需要查项目元信息时直接读它，不要在 ~/.videobuddy 下猜测路径。`
}

/** 项目目录 → 项目（与 plan-prompt.projectOf 同规则：精确匹配优先，取最长前缀）。 */
async function projectOf(registry: ProjectRegistry, cwd: string) {
  const projects = await registry.list()
  let match = null
  let bestLength = -1
  for (const project of projects) {
    if (cwd === project.dir || cwd.startsWith(project.dir + '/')) {
      if (project.dir.length > bestLength) {
        bestLength = project.dir.length
        match = project
      }
    }
  }
  return match
}

/**
 * 刷新某 cwd 的模式缓存文本。读盘 / 解析失败按「无可注入」处理，不抛。
 * @returns 是否写入了有效文本。
 */
export async function refreshWorkflowModeCache(registry: ProjectRegistry, cwd: string | undefined): Promise<boolean> {
  if (cwd === undefined || cwd === '') return false
  try {
    const project = await projectOf(registry, cwd)
    if (project === null || project === undefined) {
      cache.delete(cwd)
      return false
    }
    // list() 已对存量记录做 normalizeWorkflow 降级（缺 workflow 字段 → confirm），
    // 这里再 normalize 一次属于防御性读取：语义与 host-tools 读 mode 的口径一致。
    const mode = normalizeWorkflow(project.workflow).mode
    const text = workflowModeSectionText(mode, registry.registryFile)
    cache.set(cwd, text)
    return true
  } catch {
    return false
  }
}

/** 读取缓存文本（未预热返回空串）。 */
export function cachedWorkflowModeSectionText(cwd: string | undefined): string {
  if (!cwd) return ''
  return cache.get(cwd) ?? ''
}

/**
 * 整表失效。setMode 是唯一会中期改变 mode 的写路径且不发事件，routes.ts 在
 * setMode 成功后调用本函数；下一次 assemble 时 provider 兜底自愈刷新新值。
 */
export function invalidateWorkflowModeCache(): void {
  cache.clear()
}

/**
 * 注册执行模式小节 + `agent/created` 缓存预热。
 * @returns 联合 disposer（同时移除小节与事件监听）。
 */
export function registerWorkflowModePrompt(ctx: Pick<Context, 'systemPrompt' | 'on'>, registry: ProjectRegistry): () => void {
  const disposeSection = ctx.systemPrompt.section({
    name: WORKFLOW_MODE_SECTION_NAME,
    order: WORKFLOW_MODE_SECTION_ORDER,
    text: (context) => {
      const cwd = agentCwdOf(context)
      if (cwd === undefined) return ''
      if (!cache.has(cwd)) {
        // 兜底自愈：预热未覆盖（测试直连 / 事件错过 / setMode 失效后首轮）时异步刷新。
        void refreshWorkflowModeCache(registry, cwd)
        return ''
      }
      return cache.get(cwd) ?? ''
    },
  })
  const disposeListener = ctx.on('agent/created', ({ agent }) => {
    void refreshWorkflowModeCache(registry, agent?.session?.header?.cwd)
    return undefined
  })
  return () => { disposeSection(); disposeListener() }
}
