/**
 * CV-323：把「本项目已装载的技能」注入 system prompt。
 *
 * ## 为什么有这道小节
 *
 * 技能广场的「装载」是**纯 UI 概念**（CV-066 起写在项目目录的 `skills.json`，
 * 由 `StudioFrame` 渲染成 chips）。它与 skill 注册、与模型能否加载某个 skill
 * **完全无关** —— 注册是全局静态的，模型看到的是整份 catalog。
 *
 * 于是产生了一个说不出口的缺口：**用户在界面上替项目挑好的技能，模型不知道。**
 * 表现是模型照 catalog 自行判断要不要加载，用户勾选形同虚设；反过来用户没勾
 * 但模型自己加载了，用户也无从察觉。
 *
 * 注入一份清单就是补上这条链路，让「用户选了什么」成为模型可见的事实。
 *
 * ## 实现要点（与 `plan-prompt.ts` 同款，避免另立一套）
 *
 * - 小节 `text` 是**同步** provider（`PromptSection.text` 的函数形态不接受
 *   async），而 `readActiveSkills` 是异步的 → 用**模块级 per-cwd 缓存**桥接。
 * - 预热点：`agent/created`（会话发布早于首轮 assemble，正常路径下首轮可见）；
 *   provider 内部对未命中 cwd 再兜底自愈刷新（下一轮生效）。
 * - 「未装载任何技能」是**合法且常见**的状态，此时小节返回空串、不占上下文。
 *
 * 注意：文本中不得出现 `{{variable}}`——renderPrompt 对未知引用会直接抛错。
 */
import type { ProjectRegistry } from './projects.js'
import { CREATION_SKILL_NAME } from './skills/routing-prompt.js'
import { getSkillEntry } from './skill-catalog.js'

/** system prompt 小节名（命名空间化防冲突；重名注册会抛错）。 */
export const ACTIVE_SKILLS_SECTION_NAME = 'canvas-studio:active-skills'

/**
 * 小节顺序。约定：100–199 为工具使用指引带。已占用 150（skill 路由）/151（项目预置）
 * /152（资产库）/153（拍摄定稿纪律）。本段讲「用户已选定哪些技能」，是总纲加载
 * 之后、下游细则之前的前置事实，取 154 接在已占用的号段之后，避免改动既有号段
 * 导致所有小节的相对顺序位移。
 */
export const ACTIVE_SKILLS_SECTION_ORDER = 154

/** cwd → 激活集小节文本（**空清单也入表**，值为空串，避免每轮重跑 IO）。 */
const cache = new Map<string, string>()

/** 从 assemble 上下文里取会话 cwd（agent 由 dispatch 注入，非 AssembleContext 声明字段）。 */
function agentCwdOf(context: unknown): string | undefined {
  const agent = (context as { agent?: { session?: { header?: { cwd?: string } } } }).agent
  return agent?.session?.header?.cwd
}

/** 项目目录 → 项目（与 host-tools.resolveProjectId 同规则：精确匹配优先，取最长前缀）。 */
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
 * 由激活集生成小节正文。纯函数，可单测。
 *
 * @param names - 本项目已装载的 skill 注册名（`skills.json` 原样）。
 * @returns 空串表示未装载任何技能（调用方不注入，避免白占上下文）。
 */
export function activeSkillsSectionText(names: readonly string[]): string {
  // 总纲恒为决策型总纲，由上一小节（skill 路由）负责强制加载，
  // 不在本清单里重复列出 —— 否则会让人误以为它需要用户勾选。
  const listed = [...new Set(names)].filter(name => name !== CREATION_SKILL_NAME)
  if (listed.length === 0) return ''

  const rows = listed.map((name) => {
    const entry = getSkillEntry(name)
    const label = entry ? `${entry.title}：${entry.summary}` : '（catalog 无此条目，可能是项目里残留的旧记录）'
    return `- \`${name}\` —— ${label}`
  })

  return `## Canvas Studio 本项目已装载的技能

用户在画布顶条为本项目选定了以下技能，**已装载、可直接 skill(name=…) 加载**：

${rows.join('\n')}

规则：

1. **用户选定即视为已确认**：命中清单时直接加载使用，**不要**再问「要不要用 XX 风格 / 要不要加 XX 技能」。
2. 清单之外的技能仍可按创作总纲的路由规则自行选择，无需先征得同意。
3. 清单是**用户意图的表达**，不是执行顺序：流程、审批门禁与工具契约一律以 \`${CREATION_SKILL_NAME}\` 为准，**任何** skill 都不能覆盖安全底线。`
}

/**
 * 刷新某 cwd 的激活集缓存文本。
 *
 * 与 `refreshPlanPromptCache` 同口径：cwd 不对应任何项目时 `delete` 条目
 * （目录名可复用，留着会让新项目读到旧项目的清单）；项目存在但未装载任何技能
 * 时写空串（刻意为之，防止每轮 assemble 重跑 IO）。
 * @returns 是否存在非空文本。
 */
export async function refreshActiveSkillsPromptCache(registry: ProjectRegistry, cwd: string | undefined): Promise<boolean> {
  if (!cwd) return false
  try {
    const project = await projectOf(registry, cwd)
    if (project === null || project === undefined) {
      cache.delete(cwd)
      return false
    }
    const text = activeSkillsSectionText(await registry.readActiveSkills(project.id))
    cache.set(cwd, text)
    return text !== ''
  } catch {
    return false
  }
}

/** 读取缓存文本（未预热返回空串）。 */
export function cachedActiveSkillsSectionText(cwd: string | undefined): string {
  if (!cwd) return ''
  return cache.get(cwd) ?? ''
}

/**
 * 失效全部缓存。装载清单变更时调用（`POST /canvas-studio/active-skills`）。
 *
 * 为什么不按 projectId 精确定位条目：缓存键是 **cwd**（assemble 上下文只给得出
 * cwd），而写入方给的是 projectId，两者要在 `registry.list()` 里做一次前缀匹配
 * 才能换算 —— 那是为一次低频写操作（用户点一下 chips）引入的复杂度。
 * 装载是**低频交互**（一次会话内个位数次），整表清空的代价可忽略，
 * 换来的是「写完立刻下一轮 assemble 一定读到新值」这个简单且可证明正确的语义。
 */
export function invalidateActiveSkillsPromptCache(): void {
  cache.clear()
}

/**
 * 注册激活集小节 + `agent/created` 缓存预热。
 * @returns 联合 disposer（同时移除小节与事件监听）。
 */
export function registerActiveSkillsPrompt(ctx: {
  systemPrompt: { section(section: { name: string; order: number; text: string | ((context: unknown) => string) }): () => void }
  on(event: 'agent/created', listener: (payload: { agent: { session?: { header?: { cwd?: string } } } }) => void): () => void
}, registry: ProjectRegistry): () => void {
  const disposeSection = ctx.systemPrompt.section({
    name: ACTIVE_SKILLS_SECTION_NAME,
    order: ACTIVE_SKILLS_SECTION_ORDER,
    text: (context) => {
      const cwd = agentCwdOf(context)
      if (cwd === undefined) return ''
      if (!cache.has(cwd)) {
        // 兜底自愈：预热未覆盖（测试直连 / 事件错过）时异步刷新，下一轮生效。
        void refreshActiveSkillsPromptCache(registry, cwd)
        return ''
      }
      return cache.get(cwd) ?? ''
    },
  })
  const disposeListener = ctx.on('agent/created', ({ agent }) => {
    void refreshActiveSkillsPromptCache(registry, agent?.session?.header?.cwd)
  })
  return () => { disposeSection(); disposeListener() }
}
