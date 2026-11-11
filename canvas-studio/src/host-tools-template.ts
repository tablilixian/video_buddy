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
import { MANIFEST_CONTRACT_VERSION } from './remotion/manifest.js'
import { gateTemplate, type TemplateRequirement } from './remotion/template-gate.js'
import { listTemplateSummaries } from './remotion/template-registry.js'

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
  if (contentChars !== undefined) requirement.contentChars = contentChars
  if (itemCount !== undefined) requirement.itemCount = itemCount
  if (assetCount !== undefined) requirement.assetCount = assetCount
  if (durationSeconds !== undefined) requirement.durationSeconds = durationSeconds
  return requirement
}

export function defineTemplateTools() {
  return [
    defineTool({
      name: 'list_templates',
      description:
        '**列出可用视频模板**（整片级：版式 + 时序 + 槽位合同 + 音效 + 装饰构件都已固化）。'
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
          description: '可选：按体裁过滤（science 科普 / product 产品 / report 汇报）；不传则全列',
        },
        requirements: {
          type: 'object' as const,
          additionalProperties: false,
          description: '可选：你的内容需求（用于五条判据）。四个字段都可缺省 —— 缺的判据不参与判定',
          properties: {
            contentChars: { type: 'number' as const, description: '要讲的内容总字数（原话信息量，不含客套）' },
            itemCount: { type: 'number' as const, description: '用户列举的条目数（「三点」「4 个特性」）' },
            assetCount: { type: 'number' as const, description: '手上已有几张素材（图 / 视频）' },
            durationSeconds: { type: 'number' as const, description: '目标时长（秒）' },
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

