/**
 * 1（CV-463）· 模板工具组：`list_templates`（只读）。
 *
 * 为什么只有这一个工具：`describe_template` **不做**（`决策-模板需求收口.md` §3.2）——
 * 它已经并进 `scaffold_manifest({ templateId, dryRun: true })`。两个「看模板」的入口
 * 会让模型在「先 describe 再 scaffold」和「直接 scaffold」之间犹豫，多一次工具调用。
 *
 * 输出刻意是**文本清单**而不是结构化 JSON：
 * - 结构化清单会把 `slotSummary` 的每个字段都塞进上下文（3 个模板 ≈ 2KB 纯 JSON 语法）；
 * - 文本能让「✅ 适配 / ❌ 不适配 + 原因」直接贴着模板显示，模型不需要自己推理判据。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderTextResult } from './tool-result-text.js'
import { templateChannelEnabled } from './template-channel.js'
import { MANIFEST_CONTRACT_VERSION } from './remotion/manifest.js'
import { gateTemplate, type TemplateRequirement } from './remotion/template-gate.js'
import { listTemplateSummaries } from './remotion/template-registry.js'
import { RECIPES, type Recipe } from './remotion/recipes.js'
import { getCard, lookupCardId } from './remotion/recipe-cards.js'
import { recipeToStoryboardSeed } from './remotion/recipe-to-storyboard.js'
import { MAX_STAGE_SEC, MIN_STAGE_SEC, TARGET_STAGE_SEC } from './remotion/stage-plan.js'

/** `requirements` 的四个可算字段（都没给 = 不做适配判定）。 */
function readRequirement(raw: unknown): TemplateRequirement {
  if (raw === null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const num = (key: string): number | undefined =>
    typeof r[key] === 'number' && Number.isFinite(r[key] as number) ? r[key] as number : undefined
  const requirement: TemplateRequirement = {}
  const contentChars = num('contentChars')
  const itemCount = num('itemCount')
  const assetCount = num('assetCount')
  const durationSeconds = num('durationSeconds')
  const stageSeconds = num('stageSeconds')
  const totalSeconds = num('totalSeconds')
  if (contentChars !== undefined) requirement.contentChars = contentChars
  if (itemCount !== undefined) requirement.itemCount = itemCount
  if (assetCount !== undefined) requirement.assetCount = assetCount
  if (durationSeconds !== undefined) requirement.durationSeconds = durationSeconds
  if (stageSeconds !== undefined) requirement.stageSeconds = stageSeconds
  if (totalSeconds !== undefined) requirement.totalSeconds = totalSeconds
  return requirement
}

export function defineTemplateTools() {
  // 临时下线（2026-11-12）：入口不注册，工具定义与判据实现原样保留，开关打开即恢复。
  if (!templateChannelEnabled()) return []
  return [
    defineTool({
      name: 'list_templates',
      description:
        '**列出可用视频模板**（屏级可复用版式单元：一段固定节拍的版式 + 槽位合同 + 音效 + 装饰构件都已固化；'
        + 'D2 定位 —— 长片里模板最多吃 2–3 屏，主力是卡 + 格位）。'
        + '选模板**先调这个**，别自己从零编排 —— 模板的价值是「审美已验过、只改内容不动结构」。'
        + '传 `requirements` 会按五条判据（容量 / 素材 / 时长 / 条目数 / 信息充足度）**机器判定**适配性，'
        + '每条模板给出 ✅/❌ 与原因。'
        + '纪律（判据治不住的两件事）：① 用户说 4 条要点而模板只有 3 个卡片位 ⇒ 不许硬套（第 4 条会被静默丢弃）；'
        + '② 用户只给一句话 ⇒ 不许拿模板硬编（其余槽位会变成编造）。这两种都走自由编排。'
        + '**恰好 1 个模板通过判据**才可自主选择；0 个走自由编排；≥2 个把候选列给用户选，不要自己拍。'
        + '不适配时必须在回复里**明确告知**「没有匹配模板，已按自由编排生成」+ 原因，静默降级会让用户以为是模板效果差。',
      parameters: {
        family: {
          type: 'string' as const,
          description: '可选：按体裁过滤（10 个 family：data 数据 / outro 收尾 / press 报刊 / product 产品 / promo 促销 / report 汇报 / science 科普 / tech 数码 / ui 界面 / vo-ad 口播广告）；不传则全列',
        },
        requirements: {
          type: 'object' as const,
          additionalProperties: false,
          description: '可选：你的内容需求（用于五条判据）。字段都可缺省 —— 缺的判据不参与判定',
          properties: {
            contentChars: { type: 'number' as const, description: '要讲的内容总字数（原话信息量，不含客套）' },
            itemCount: { type: 'number' as const, description: '用户列举的条目数（「三点」「4 个特性」）' },
            assetCount: { type: 'number' as const, description: '手上已有几张素材（图 / 视频）' },
            stageSeconds: { type: 'number' as const, description: '这一屏分给模板的秒数（屏表预留；屏级判定主入口，≥45s 多屏片必传）' },
            totalSeconds: { type: 'number' as const, description: '整片总时长（秒）—— 只用来估屏数（提示），不参与拒收' },
            durationSeconds: { type: 'number' as const, description: '目标时长（秒）—— 旧整片口径，仅单模板短片用；屏表调用请传 stageSeconds' },
          },
        },
        minInfoRatio: {
          type: 'number' as const,
          description: '可选：信息充足度阈值（缺省 0.35）。内容字数 / 必填槽容量低于它 ⇒ 判为「内容不足，套模板会编造」',
        },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '模板清单（含量规、槽位摘要、适配判定、下一步调用式）' },
          },
        },
        render: renderTextResult,
      },
      async execute(args) {
        const a = args as { family?: unknown; requirements?: unknown; minInfoRatio?: unknown }
        const requirement = readRequirement(a.requirements)
        const hasRequirement = Object.keys(requirement).length > 0
        const minInfoRatio = typeof a.minInfoRatio === 'number' && Number.isFinite(a.minInfoRatio) && a.minInfoRatio > 0
          ? a.minInfoRatio
          : undefined
        const family = typeof a.family === 'string' ? a.family.trim() : ''
        const catalog = listTemplateSummaries()
        const items = family === '' ? catalog.items : catalog.items.filter((item) => item.meta.family === family)

        if (items.length === 0) {
          return {
            text: [
              family === ''
                ? '模板库当前为空（`assets/templates/` 下没有可用模板）。'
                : `没有 \`${family}\` 体裁的模板（全部体裁：${catalog.items.map((item) => item.meta.family).join(' / ') || '无'}）。`,
              '请走**自由编排**：`scaffold_manifest({ title, durationSeconds })` 或直接写 manifest，',
              '并在回复里明确告知用户「没有匹配模板，已按自由编排生成」。',
              ...(catalog.problems.length === 0 ? [] : ['', '⚠️ 另有模板读取问题：', ...catalog.problems.map((problem) => `· ${problem.dir}：${problem.reason}`)]),
            ].join('\n'),
          }
        }

        const blocks = items.map((item, index) => {
          const gate = gateTemplate(item.meta, item.slots, requirement, minInfoRatio === undefined ? {} : { minInfoRatio })
          const required = item.slotSummary.filter((slot) => slot.required)
          // 契约版本不符的模板**不进候选**（D-24：渲出来不会报错、只会渲错）——
          // 五条判据是在「模板可用」的前提下判适配，所以这一条必须盖掉判据结论。
          const verdict = !item.contractOk
            ? `❌ 契约版本不符（模板 ${item.meta.contractVersion} ≠ 渲染器 ${MANIFEST_CONTRACT_VERSION}）—— 不可用，删掉这个模板或升版`
            : !hasRequirement
              ? '（未提供 requirements ⇒ 未做适配判定，请按下面槽位字数自行核对）'
              : gate.pass
                ? '✅ 适配（五条判据全过）'
                : gate.failures.map((failure) => `❌ ${failure.message}`).join('\n')
          return [
            `${String(index + 1)}. **${item.meta.name}** \`${item.meta.id}\` · ${item.meta.family}`
              + ` · ${String(item.meta.durationInFrames)} 帧（${(item.meta.durationInFrames / item.meta.fps).toFixed(0)}s）· ${item.meta.aspect}`,
            `   ${item.meta.summary}`,
            `   适合：${item.meta.suitableFor.join(' / ')}　不宜：${item.meta.notSuitableFor.join(' / ') || '—'}`,
            `   槽位 ${String(required.length)} 必填 / ${String(item.slotSummary.length)} 总：`
              + item.slotSummary.map((slot) => `\`${slot.id}\`${slot.required ? '*' : ''}`
                + `${slot.maxChars === undefined ? '' : `≤${String(slot.maxChars)}字`}（${slot.label}）`).join('　'),
            `   构件：${(item.meta.furniture ?? []).join(' + ') || '无'}　素材：${(item.meta.requiredAssets ?? []).join(' / ') || '无'}`
              + `${item.contractOk ? '' : '　⚠️ 契约版本不符，不可用'}`,
            `   ${verdict}`,
            ...(gate.stageHint === undefined ? [] : [`   ${gate.stageHint}`]),
            `   → \`scaffold_manifest({ templateId: ${JSON.stringify(item.meta.id)}, slots: {…}, writeTo: "build/manifest.json" })\``
              + `；看完整槽位说明加 \`dryRun: true\``,
          ].join('\n')
        })

        const passing = hasRequirement
          ? items.filter((item) => item.contractOk
            && gateTemplate(item.meta, item.slots, requirement, minInfoRatio === undefined ? {} : { minInfoRatio }).pass)
          : []
        const tail = hasRequirement
          ? passing.length === 1
            ? [`判据结论：**恰好 1 个模板适配**（\`${passing[0]?.meta.id ?? ''}\`）⇒ 可以直接用，但仍要先把槽位填满。`]
            : passing.length === 0
              ? ['判据结论：**没有模板通过适配判据** ⇒ 走自由编排（`scaffold_manifest({ title, durationSeconds })`），',
                '并在回复里明确告知用户「没有匹配模板，已按自由编排生成」+ 上面的原因。']
              : ['判据结论：**多个模板都适配**（' + passing.map((item) => `\`${item.meta.id}\``).join(' / ') + '）',
                '⇒ 把候选（名称 + 一句话差异）列给用户选，**不要自己拍**（模型的偏好不可复现）。']
          : []

        return {
          text: [
            `模板库共 ${String(items.length)} 个${family === '' ? '' : `（体裁 ${family}）`}：`,
            '',
            ...blocks,
            ...(tail.length === 0 ? [] : ['', ...tail]),
            ...(catalog.problems.length === 0 ? [] : ['', '⚠️ 另有模板读取问题：', ...catalog.problems.map((problem) => `· ${problem.dir}：${problem.reason}`)]),
          ].join('\n'),
        }
      },
    }),
  ]
}

// ── list_recipes（2026-11-26 · 配方正确用法 D1）─────────────────────────────
// 结构起点三选一的**配方档**入口：模板档是 list_templates，都不行落自由编排。
// 判据五条（段数 / 素材 / 主题 / 表达力 / 互斥）逐条 ✅/❌，输出风格同 gateTemplate。
// 与 list_templates 的区别：不设开关 —— 配方是主路径能力，不随模板通道下线。

/** `requirements` 的五个可算字段（同 list_templates 读取器口径，不消费 durationSeconds）。 */
interface RecipeRequirement {
  contentChars?: number
  itemCount?: number
  assetCount?: number
  stageSeconds?: number
  totalSeconds?: number
}

function readRecipeRequirement(raw: unknown): RecipeRequirement {
  if (raw === null || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const num = (key: string): number | undefined =>
    typeof r[key] === 'number' && Number.isFinite(r[key] as number) ? r[key] as number : undefined
  const requirement: RecipeRequirement = {}
  const contentChars = num('contentChars')
  const itemCount = num('itemCount')
  const assetCount = num('assetCount')
  const stageSeconds = num('stageSeconds')
  const totalSeconds = num('totalSeconds')
  if (contentChars !== undefined) requirement.contentChars = contentChars
  if (itemCount !== undefined) requirement.itemCount = itemCount
  if (assetCount !== undefined) requirement.assetCount = assetCount
  if (stageSeconds !== undefined) requirement.stageSeconds = stageSeconds
  if (totalSeconds !== undefined) requirement.totalSeconds = totalSeconds
  return requirement
}

/** 物理演示需求 → 演示卡映射（缺口判 ❌ 时指名缺哪张卡）。 */
const DEMO_CARD: Readonly<Record<string, string>> = {
  orbit: 'ORB1',
  轨道: 'ORB1',
  中心体: 'ORB1',
}

interface RecipeCheck {
  readonly mark: '✅' | '❌' | '—'
  readonly line: string
}

/**
 * 五判据（文档 §3.3）：
 * 1. 段数：配方段数 ≤ 期望屏数（totalSeconds / stageSeconds 推；字段缺 ⇒ 不参与「—」）；
 * 2. 素材：assets.length ≤ assetCount（给了才判），且 source 只能是 user / library；
 * 3. 主题：缺省 theme 可覆盖，但与用户偏好不同时**显式提示**；
 * 4. 表达力：段卡全在册 + 卡级 required 素材不超 assetCount + 演示需求卡在册；
 * 5. 互斥：specPath 已给 ⇒ 本工具不参与裁决（工具入口短路，不在此表）。
 */
export function gateRecipe(
  recipe: Recipe,
  requirement: RecipeRequirement,
  options: { theme?: string; demoNeeds?: readonly string[] },
): { checks: RecipeCheck[]; pass: boolean } {
  const checks: RecipeCheck[] = []

  // 1 · 段数
  const { totalSeconds, assetCount } = requirement
  // 屏长的权威值在 Host 这边（`stage-plan.ts`，`autoStages` 用的就是同一组常量）。
  // 此前完全由模型自填：真机会话填了 12s（成片真实 7.5s/屏），于是「4 段 ≤ 6 屏 ✅」这种
  // 结论是**用错的输入跑对的判据**——判据没错，模型却拿它当"配方不合适"的依据去否配方。
  // 现在缺省 / 越界一律按 Host 口径兜底，并把「实际用了哪个值」写进回执，不让自填数隐身。
  const stageRaw = requirement.stageSeconds
  const stage = stageRaw === undefined || stageRaw <= 0
    ? TARGET_STAGE_SEC
    : Math.min(MAX_STAGE_SEC, Math.max(MIN_STAGE_SEC, stageRaw))
  const stageNote = stageRaw === undefined || stageRaw <= 0
    ? `，未给 stageSeconds ⇒ 按 Host 值 ${String(TARGET_STAGE_SEC)}s/屏`
    : stageRaw === stage ? '' : `，stageSeconds ${String(stageRaw)} 越界（${String(MIN_STAGE_SEC)}–${String(MAX_STAGE_SEC)}s）已钳到 ${String(stage)}s`
  if (totalSeconds !== undefined && totalSeconds > 0) {
    const screens = Math.max(1, Math.floor(totalSeconds / stage))
    const ok = recipe.segments.length <= screens
    checks.push({
      mark: ok ? '✅' : '❌',
      line: `段数：配方 ${String(recipe.segments.length)} 段 ${ok ? '≤' : '>'} 期望屏 ${String(screens)}（${String(totalSeconds)}s / ${String(stage)}s${stageNote}）`
        // 段数只是上限判据：段 ≠ 屏。配方永远只给骨架段（4–5 段），真实屏数由屏表决定。
        + (ok ? '；段数过闸 ≠ 屏数正确，成片屏数按屏表（每屏 4–10s）另行切分' : ''),
    })
  } else {
    checks.push({ mark: '—', line: '段数：未给 totalSeconds ⇒ 不参与判定' })
  }

  // 2 · 素材
  const sourceOk = recipe.assets.every((asset) => asset.source === 'user' || asset.source === 'library')
  const countOk = assetCount === undefined ? null : recipe.assets.length <= assetCount
  const ok2 = sourceOk && countOk !== false
  checks.push({
    mark: ok2 ? '✅' : '❌',
    line: `素材：${String(recipe.assets.length)} 项${assetCount === undefined ? '（未给 assetCount，不判数量）' : ` ≤ assetCount ${String(assetCount)}${countOk ? '' : ' —— 超了，素材落不了地'}`}`
      + `${sourceOk ? '' : '；存在 source ∉ {user, library} 的声明，§07 落不了地'}`,
  })

  // 3 · 主题（恒可覆盖，但要显式提示）
  const themeDiff = options.theme !== undefined && options.theme !== recipe.theme
  checks.push({
    mark: '✅',
    line: `主题：缺省 \`${recipe.theme}\`${themeDiff ? ` ≠ 你的 \`${options.theme ?? ''}\` —— 可覆盖，但要在回复里显式告知用户改了主题` : ''}`,
  })

  // 4 · 表达力
  const missingCards: string[] = []
  for (const segment of recipe.segments) {
    const cardId = lookupCardId(segment.card)
    if (cardId === null || getCard(cardId) === undefined) missingCards.push(segment.card)
  }
  const requiredAssets = recipe.segments.reduce((sum, segment) => {
    const cardId = lookupCardId(segment.card)
    const card = cardId === null ? undefined : getCard(cardId)
    if (card === undefined) return sum
    return sum + card.assets.filter((decl) => decl.required).length
  }, 0)
  const missingDemos: string[] = []
  for (const need of options.demoNeeds ?? []) {
    const mapped = DEMO_CARD[need.trim()]
    if (mapped === undefined) continue
    if (getCard(mapped) === undefined) missingDemos.push(`${need}→${mapped}`)
  }
  const ok4 = missingCards.length === 0
    && missingDemos.length === 0
    && (assetCount === undefined || requiredAssets <= assetCount)
  checks.push({
    mark: ok4 ? '✅' : '❌',
    line: `表达力：段卡在册 ${String(recipe.segments.length - missingCards.length)}/${String(recipe.segments.length)}`
      + `${missingCards.length === 0 ? '' : `（缺 ${missingCards.join(' / ')} —— 会回落 textCard/subtitle 占位）`}`
      + `；卡级 required 素材 ${String(requiredAssets)}${assetCount === undefined ? '（未给 assetCount，不判）' : ` ≤ ${String(assetCount)}`}`
      + `${missingDemos.length === 0 ? '' : `；演示卡缺口 ${missingDemos.join(' / ')}`}`,
  })

  return { checks, pass: checks.every((check) => check.mark !== '❌') }
}

export function defineRecipeTools() {
  return [
    defineTool({
      name: 'list_recipes',
      description:
        '**列出片型配方并做五判据适配判定**（结构起点三选一的「配方档」入口；模板档是 `list_templates`，'
        + '两档都不行落自由编排）。传 `requirements` 按五条判据（段数 / 素材 / 主题 / 表达力 / 互斥）逐条给 ✅/❌ 与原因，'
        + '每个配方给段序列、素材清单与 `note`。'
        + '**判据 0✅（没有配方通过）时不得选配方**：落自由编排 `scaffold_manifest({ title, durationSeconds })`，'
        + '并在回复里明确告知用户「没有适配配方，已按自由编排生成」+ 原因；1✅ 自主选该配方；'
        + '≥2✅ 把候选（id + 一段差异）列给用户选，不要自己拍。'
        + '给了 `specPath` ⇒ 本工具不参与裁决（spec 自带结构起点）。'
        + '选中的配方还要把结构落进 `write_storyboard` 九节（结构起点一句话进 §00 brief / §08 硬约束）。',
      parameters: {
        requirements: {
          type: 'object' as const,
          additionalProperties: false,
          description: '可选：你的内容需求（用于五判据）。字段都可缺省 —— 缺的判据不参与判定',
          properties: {
            contentChars: { type: 'number' as const, description: '要讲的内容总字数（原话信息量，不含客套）' },
            itemCount: { type: 'number' as const, description: '用户列举的条目数（「三点」「4 个特性」）' },
            assetCount: { type: 'number' as const, description: '手上已有几张素材（图 / 视频）' },
            stageSeconds: { type: 'number' as const, description: '每段/屏分给的秒数 —— 与 totalSeconds 一起推期望屏数（段数判据）' },
            totalSeconds: { type: 'number' as const, description: '整片总时长（秒）' },
          },
        },
        theme: {
          type: 'string' as const,
          description: '可选：用户偏好的视觉主题（cold-tech / ink-press / warm-ember / neon-data）—— 与配方缺省不同时会显式提示可覆盖',
        },
        demoNeeds: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '可选：物理演示需求标记（如 `["orbit"]` = 中心体+绕行演示）—— 判据 4 会检查对应演示卡（ORB1）在册',
        },
        specPath: {
          type: 'string' as const,
          description: '可选：已决定走 spec 通道时传它 —— 本工具直接返回「不参与裁决」（spec 与 recipe 互斥）',
        },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '配方清单（段序列 / 素材 / note / 五判据逐条 + 裁决结论）' },
          },
        },
        render: renderTextResult,
      },
      async execute(args) {
        const a = args as {
          requirements?: unknown; theme?: unknown; demoNeeds?: unknown; specPath?: unknown
        }
        // 判据 5 · 互斥：specPath 已给 ⇒ spec 是结构起点，配方裁决不参与。
        if (typeof a.specPath === 'string' && a.specPath.trim() !== '') {
          return {
            text: [
              '`specPath` 已给 ⇒ spec 是结构起点，**配方裁决不参与**（二者互斥）。',
              '本工具只回答「配方能不能用」；走 spec 通道请直接 `scaffold_manifest({ specPath })`。',
            ].join('\n'),
          }
        }
        const requirement = readRecipeRequirement(a.requirements)
        const hasRequirement = Object.keys(requirement).length > 0
        const theme = typeof a.theme === 'string' && a.theme.trim() !== '' ? a.theme.trim() : undefined
        const demoNeeds = Array.isArray(a.demoNeeds)
          ? a.demoNeeds.filter((item): item is string => typeof item === 'string')
          : []
        const entries = Object.entries(RECIPES)

        const blocks = entries.map(([id, recipe], index) => {
          const { checks, pass } = gateRecipe(recipe, requirement, { ...(theme === undefined ? {} : { theme }), demoNeeds })
          const verdict = !hasRequirement
            ? '（未提供 requirements ⇒ 未做适配判定，请按段序列与素材清单自行核对）'
            : pass ? '✅ 通过（五判据无 ❌）' : '❌ 未通过（见上面的 ❌ 项）'
          return [
            `${String(index + 1)}. **${recipe.title}** \`${id}\` · ${String(recipe.segments.length)} 段`,
            `   段序：${recipe.segments.map((segment) => segment.label).join(' → ')}`,
            `   素材：${recipe.assets.length === 0 ? '无（零素材直通）' : recipe.assets.map((asset) => `${asset.name}（${asset.type}/${asset.source}）`).join('；')}`,
            ...(recipe.note === '' ? [] : [`   note：${recipe.note}`]),
            ...(hasRequirement
              ? ['   判据：', ...checks.map((check) => `     ${check.mark} ${check.line}`)]
              : []),
            `   ${verdict}`,
            `   → \`scaffold_manifest({ recipe: ${JSON.stringify(id)}, title: "…", durationSeconds: … })\``
              + '，然后把段结构落进 `write_storyboard` 九节',
          ].join('\n')
        })

        const passing = hasRequirement
          ? entries.filter(([, recipe]) => gateRecipe(recipe, requirement, { ...(theme === undefined ? {} : { theme }), demoNeeds }).pass)
          : []
        const tail = hasRequirement
          ? passing.length === 1
            ? [`判据结论：**恰好 1 个配方通过**（\`${passing[0]?.[0] ?? ''}\`）⇒ 结构起点选它：接着调 \`write_storyboard\` 把段结构填进九节。`]
            : passing.length === 0
              ? ['判据结论：**0 个配方通过 ⇒ 不得选配方**，落自由编排（`scaffold_manifest({ title, durationSeconds })`），',
                '并在回复里明确告知用户「没有适配配方，已按自由编排生成」+ 上面的 ❌ 原因。']
              : ['判据结论：**' + String(passing.length) + ' 个配方都通过**（' + passing.map(([id]) => `\`${id}\``).join(' / ') + '）',
                '⇒ 把候选（id + 一段差异）列给用户选，**不要自己拍**（模型的偏好不可复现）。']
          : []

        // D7 拍板：seed 载体 = 本工具回执。结论「恰好 1 ✅」时附 seed（bare 形态），
        // 模型原样喂 write_storyboard 分节参数 —— 不新增独立 seed 工具。
        // 0✅ 自由编排 / ≥2✅ 用户挑：结构未定，不产 seed。生成失败降级不阻断判据。
        const seedBlock: string[] = []
        if (hasRequirement && passing.length === 1 && passing[0] !== undefined) {
          const [chosenId, chosenRecipe] = passing[0]
          try {
            const seed = recipeToStoryboardSeed({ recipe: chosenRecipe, requirements: requirement })
            seedBlock.push(
              '',
              `seed（配方 \`${chosenId}\`，原样喂 \`write_storyboard\` 分节参数；**只填 00/02/04/07/08 五节**，没传的节保留现值，§03/§05/§06 不由配方生成；节键→入参：00_creative→creative、02_visual→visual、04_storyboard→storyboard、07_assets→assets、08_constraints→constraints，JSON 值取该节对象/数组本身）：`,
              JSON.stringify(seed.sections, null, 2),
              'specSeed（写进 `build/manifest-spec.json` 后 `scaffold_manifest({ specPath })`；**copy 是提示语不是真文案，必须改写**；units/carry 留空、autoStages 不开）：',
              JSON.stringify(seed.specSeed, null, 2),
            )
          } catch (error) {
            seedBlock.push('', `seed 生成失败：${error instanceof Error ? error.message : String(error)}（判据结论不受影响）`)
          }
        }

        return {
          text: [
            `配方库共 ${String(entries.length)} 套：`,
            '',
            ...blocks,
            ...(tail.length === 0 ? [] : ['', ...tail]),
            ...seedBlock,
          ].join('\n'),
        }
      },
    }),
  ]
}

