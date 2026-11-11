/**
 * 1（CV-463）· 模板通道的**宿主侧编排**（`scaffold_manifest({ templateId, slots })`）。
 *
 * 为什么单独一个文件而不是塞进 `host-tools.ts`：工具壳文件已有行数棘轮，且
 * 「读盘 + 编译 + 落盘 + 回执文案」是四件事。这里只做编排，判据全在纯函数里
 * （`slot-contract` / `template-compile` / `template-gate`）。
 *
 * ## 唯一入口原则（`决策-模板需求收口.md` §3.1）
 *
 * ```
 * 起点 A：模板    scaffold_manifest({ templateId, slots, writeTo })   ← 本文件
 * 起点 B：体裁    scaffold_manifest({ recipe })
 * 起点 C：从零    scaffold_manifest({ title, durationSeconds })
 *                       ↓ 都是「产出一份 manifest 并落盘」
 *                 render_composition({ manifestPath })               ← 唯一出片口
 * ```
 *
 * **不做** `render_composition({ templateId })`：模型拿不到中间产物就无法微调，
 * 模板会退化成「要么全接受要么全弃」的二值选择。
 */
import { writeManifestFile } from './manifest-file.js'
import { throwError } from './error-system.js'
import { loadTemplateBundle } from './remotion/template-registry.js'
import type { SlotContract } from './remotion/slot-contract.js'
import { charCount } from './remotion/slot-contract.js'
import { compileTemplate, type TemplateBundle, type TemplateMeta } from './remotion/template-compile.js'

const MANIFEST_PREVIEW_LINES = 40

export interface TemplateScaffoldInput {
  templateId: string
  /** 槽位填参（`slotId → 值`）。 */
  slots: Record<string, unknown>
  /** 落盘路径（相对项目根）；空 = 只回显 JSON。 */
  writeTo?: string
  /** true = 只看模板说明书，不编译（替代独立的 `describe_template` 工具）。 */
  dryRun?: boolean
  /** `writeTo` 时必填：项目根目录（`registry.projectDir(projectId)`）。 */
  projectDir?: string
}

/** 槽位一行（dryRun 与错误文案共用同一份格式）。 */
function slotLine(slot: SlotContract): string {
  const limits: string[] = []
  if (slot.maxChars !== undefined) limits.push(`≤${String(slot.maxChars)} 字`)
  if (slot.maxLines !== undefined) limits.push(`≤${String(slot.maxLines)} 行`)
  if (slot.maxCharsPerLine !== undefined) limits.push(`单行 ≤${String(slot.maxCharsPerLine)} 字`)
  const type = slot.type === 'string[]' ? 'string[]（按行数组）' : slot.type
  return `· \`${slot.id}\` ${slot.label}${slot.required === true ? ' **必填**' : ''}`
    + ` [${type}${limits.length === 0 ? '' : ` · ${limits.join(' · ')}`}]`
    + `${slot.semantic === undefined ? '' : `\n  ${slot.semantic}`}`
    + `${slot.example === undefined ? '' : `\n  例：${JSON.stringify(slot.example)}`}`
}

/** 干跑（这就是 `describe_template`）：完整槽位合同 + 构件 + 音效 + 用法。 */
function describe(bundle: TemplateBundle, values: Record<string, unknown>): string {
  const { meta, slots } = bundle
  const lines = [
    `**${meta.name}**（\`${meta.id}\`）· v${meta.version} · 契约 v${meta.contractVersion}`,
    meta.summary,
    '',
    `规格：${String(meta.fps)}fps · ${String(meta.durationInFrames)} 帧（${(meta.durationInFrames / meta.fps).toFixed(1)}s）· ${meta.aspect}`,
    `适合：${meta.suitableFor.join(' / ')}${meta.notSuitableFor.length === 0 ? '' : `　不适合：${meta.notSuitableFor.join(' / ')}`}`,
    `卡片位：${meta.itemCapacity === undefined ? '（未声明）' : `${String(meta.itemCapacity)} 条要点`}`
      + `　素材需求：${(meta.requiredAssets ?? []).length === 0 ? '无' : (meta.requiredAssets ?? []).join(' / ')}`,
    `装饰构件：${(meta.furniture ?? []).length === 0 ? '无' : (meta.furniture ?? []).join(' + ')}`
      + `${(bundle.audio ?? []).length === 0 ? '' : `　音效事件：${String((bundle.audio ?? []).length)} 个`}`,
    '',
    `**槽位合同**（${String(slots.filter((slot) => slot.required === true).length)} 个必填 / 共 ${String(slots.length)} 个）：`,
    ...slots.map(slotLine),
    '',
    meta.usage === undefined ? '' : `用法：${meta.usage}`,
    Object.keys(values).length === 0
      ? `下一步：\`scaffold_manifest({ templateId: ${JSON.stringify(meta.id)}, slots: {…}, writeTo: "build/manifest.json" })\``
      : `**按你给的值核对**：${slots.map((slot) => {
        const value = values[slot.id]
        if (value === undefined) return `${slot.id}=（未给）`
        const text = Array.isArray(value) ? value.join('\n') : String(value)
        const limit = slot.maxChars === undefined ? '' : `/${String(slot.maxChars)}`
        return `${slot.id}=${String(charCount(text))}${limit}字`
      }).join('　')}`,
  ]
  return lines.join('\n')
}

/**
 * 执行模板通道。返回 `{ text }`（与其它工具同形）。
 *
 * 失败一律 `CS-USER-ERR` 抛出（带**可执行**文案）：槽位超限必须**编译前**拦下，
 * 而不是等出片后发现字被裁。
 */
export function scaffoldFromTemplate(input: TemplateScaffoldInput): { text: string } {
  let bundle: TemplateBundle
  try {
    bundle = loadTemplateBundle(input.templateId).bundle
  } catch (error) {
    throwError('CS-USER-ERR', {
      message: error instanceof Error ? error.message : String(error),
      detail: 'template not found',
    })
  }

  if (bundle.meta.contractVersion === '' || bundle.meta.contractVersion === undefined) {
    throwError('CS-USER-ERR', { message: `模板 ${input.templateId} 的 meta.json 缺 contractVersion` })
  }

  if (input.dryRun === true) return { text: describe(bundle, input.slots) }

  let compiled
  try {
    compiled = compileTemplate(bundle, input.slots)
  } catch (error) {
    throwError('CS-USER-ERR', {
      message: error instanceof Error ? error.message : String(error),
      detail: 'template compile failed',
    })
  }
  if (!compiled.ok || compiled.manifest === null) {
    throwError('CS-USER-ERR', {
      message: [
        `模板 ${input.templateId} 拒绝编译（${String(compiled.errors.length)} 处问题）：`,
        ...compiled.errors.map((line, index) => `${String(index + 1)}. ${line}`),
        `提示：\`scaffold_manifest({ templateId: ${JSON.stringify(input.templateId)}, dryRun: true })\` 可看完整槽位合同。`,
      ].join('\n'),
      detail: 'slot contract violation',
    })
  }

  const manifest = compiled.manifest
  const json = JSON.stringify(manifest, null, 2)
  const warnings = compiled.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message)
  const stat = `轨 ${String(compiled.stats.trackCount)} 条（其中装饰构件 ${String(compiled.stats.furnitureTracks)} 条）`
    + ` · 音效 ${String(compiled.stats.sfxCount)} 个`
    + ` · ${String(manifest.meta.durationInFrames)} 帧（${(manifest.meta.durationInFrames / manifest.meta.fps).toFixed(1)}s）`
  const notes = [
    ...warnings.map((line) => `⚠️ ${line}`),
    ...compiled.warnings.map((line) => `⚠️ ${line}`),
  ]

  if (input.writeTo !== undefined && input.writeTo.trim() !== '') {
    if (input.projectDir === undefined) {
      throwError('CS-DEV-ERR', { message: 'writeTo 需要项目目录（内部调用缺参，请报给开发）' })
    }
    const written = writeManifestFile({
      projectDir: input.projectDir,
      writeTo: input.writeTo,
      json,
      trackCount: (manifest.tracks as unknown[]).length,
    })
    return {
      text: [
        `已按模板 **${bundle.meta.name}** 生成并写入 ${written.path}（${stat}），已通过 validateManifest。`,
        `本轮**不回显完整 JSON**（它就是刚写进去的那份）。前 ${String(MANIFEST_PREVIEW_LINES)} 行供核对：`,
        '```json',
        written.preview,
        '```',
        ...notes,
        `下一步：\`render_composition({ manifestPath: ${JSON.stringify(written.path)}, quality: "draft" })\` 出片 —— 不要再读源码、不要先美化。`,
        '要微调就直接改这个小文件（文案 / 配色 / 加轨都行），模板只是起点不是终点。',
      ].join('\n'),
    }
  }

  return {
    text: [
      `已按模板 **${bundle.meta.name}** 生成（${stat}），已通过 validateManifest：`,
      '```json',
      json,
      '```',
      ...notes,
      '提示：下次传 `writeTo: "build/manifest.json"` 可直接落盘（省掉回显 + 抄写，而抄写正是括号错与截断的主要来源），',
      '然后用 `render_composition({ manifestPath })` 出片。',
    ].join('\n'),
  }
}

/** `list_templates` 用的一行摘要（与 `describe` 分离：清单不带全文）。 */
export function templateSummaryLine(meta: TemplateMeta, slotSummary: { id: string; label: string; required: boolean; maxChars?: number }[]): string {
  const required = slotSummary.filter((slot) => slot.required)
  return [
    `**${meta.name}** \`${meta.id}\` · ${meta.family} · ${(meta.durationInFrames / meta.fps).toFixed(0)}s`,
    `  ${meta.summary}`,
    `  槽位 ${String(required.length)} 必填 / ${String(slotSummary.length)} 总：`
      + slotSummary.map((slot) => `${slot.id}${slot.required ? '*' : ''}${slot.maxChars === undefined ? '' : `≤${String(slot.maxChars)}`}`).join(' '),
  ].join('\n')
}
