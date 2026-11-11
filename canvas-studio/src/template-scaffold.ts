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
import { compileTemplate, type TemplateBgm, type TemplateBundle, type TemplateMeta } from './remotion/template-compile.js'

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
  /**
   * A1：已生成的配乐地址。模板声明了 `audio.bgm` 时，把它传回来即可一次编进产物
   * （音量 / 淡入淡出按模板建议值写），不必再手改 manifest 的 `audio` 段。
   */
  bgmUrl?: string
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
  const bgm = bundle.audio?.bgm
  const bgmLine = bgm === undefined
    ? undefined
    : `配乐位：**未内置音频**（现场生成）—— 提示「${bgm.prompt}」`
      + `　约 ${String(bgm.durationSeconds ?? Math.round(meta.durationInFrames / meta.fps))}s`
      + `${bgm.volume === undefined ? '' : `　建议音量 ${bgm.volume.toFixed(2)}`}`
      + `${bgm.fadeOutSeconds === undefined ? '' : `　淡出 ${bgm.fadeOutSeconds}s`}`
  const lines = [
    `**${meta.name}**（\`${meta.id}\`）· v${meta.version} · 契约 v${meta.contractVersion}`,
    meta.summary,
    '',
    `规格：${String(meta.fps)}fps · ${String(meta.durationInFrames)} 帧（${(meta.durationInFrames / meta.fps).toFixed(1)}s）· ${meta.aspect}`,
    `适合：${meta.suitableFor.join(' / ')}${meta.notSuitableFor.length === 0 ? '' : `　不适合：${meta.notSuitableFor.join(' / ')}`}`,
    `卡片位：${meta.itemCapacity === undefined ? '（未声明）' : `${String(meta.itemCapacity)} 条要点`}`
      + `　素材需求：${(meta.requiredAssets ?? []).length === 0 ? '无' : (meta.requiredAssets ?? []).join(' / ')}`,
    `装饰构件：${(meta.furniture ?? []).length === 0 ? '无' : (meta.furniture ?? []).join(' + ')}`
      + `${(bundle.audio?.sfx ?? []).length === 0 ? '' : `　音效事件：${String((bundle.audio?.sfx ?? []).length)} 个`}`,
    ...(bgmLine === undefined ? [] : [bgmLine]),
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
 * 配乐位未接时的下一步（A1）。
 *
 * 为什么必须由宿主写这段：真机会话里模型想出带 BGM 的片子，只能自己 `node -e` 手改
 * manifest 的 `audio` 段（4 次），因为它不知道「模板有配乐位」也不知道「生成后怎么编进去」。
 * 这段把「生成 → 回传 → 出片」写成三条可执行指令，省掉摸索。
 */
function bgmHint(bundle: TemplateBundle, request: TemplateBgm, input: TemplateScaffoldInput): string[] {
  const seconds = request.durationSeconds ?? Math.round(bundle.meta.durationInFrames / bundle.meta.fps)
  const params = [
    request.volume === undefined ? '' : `音量 ${request.volume.toFixed(2)}`,
    request.fadeOutSeconds === undefined ? '' : `淡出 ${String(request.fadeOutSeconds)}s`,
  ].filter((part) => part !== '').join(' / ')
  return [
    `🎵 **这个模板带配乐位，本次产物没有 BGM** —— 提示「${request.prompt}」，约 ${seconds}s`
      + `${params === '' ? '' : `（建议 ${params}）`}。`,
    '补齐只要两步（比「出片后才发现没音乐」便宜得多）：',
    `① 生成一条 ≥${String(seconds)}s 的**纯器乐**（音乐生成工具，提示词直接用上面那句）；`,
    '② 把产物 URL 传回来重编 —— 同一批 slots 原样重发，覆盖同一个文件：',
    `   \`scaffold_manifest({ templateId: ${JSON.stringify(bundle.meta.id)}, slots: {…同前…}, `
      + `bgmUrl: "<上一步的产物 URL>", writeTo: ${JSON.stringify(input.writeTo ?? 'build/manifest.json')} })\``,
    '再 `render_composition({ manifestPath })` 出片。音量与淡出按模板建议值自动写入，不用手改 JSON。',
    '**也可以不配乐直接出片**（无 BGM 是合法成片），但要在回复里明说「本条未配乐」。',
  ]
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

  const bgmUrl = input.bgmUrl?.trim() ?? ''
  let compiled
  try {
    compiled = compileTemplate(bundle, input.slots, bgmUrl === '' ? undefined : { bgmUrl })
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
  // A1：音频这次是什么状态必须写进统计行 —— 「渲完发现没声音」比「没配乐」贵得多。
  const bgmStat = compiled.stats.bgmApplied
    ? ' · BGM 已接入'
    : bundle.audio?.bgm === undefined ? '' : ' · 无 BGM（模板有配乐位）'
  const stat = `轨 ${String(compiled.stats.trackCount)} 条（其中装饰构件 ${String(compiled.stats.furnitureTracks)} 条）`
    + ` · 音效 ${String(compiled.stats.sfxCount)} 个${bgmStat}`
    + ` · ${String(manifest.meta.durationInFrames)} 帧（${(manifest.meta.durationInFrames / manifest.meta.fps).toFixed(1)}s）`
  const notes = [
    ...warnings.map((line) => `⚠️ ${line}`),
    ...compiled.warnings.map((line) => `⚠️ ${line}`),
    // 给了 bgmUrl 但模板没声明配乐位：接入合法，但音量走缺省 —— 说清楚免得压不住人声。
    ...(bgmUrl !== '' && bundle.audio?.bgm === undefined
      ? ['ℹ️ 模板未声明配乐位，BGM 已按原音量接入（要压低请显式写 `audio.mix.bgmVolume`）。']
      : []),
  ]
  const bgm = compiled.bgmRequest === undefined ? [] : bgmHint(bundle, compiled.bgmRequest, input)

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
        ...(bgm.length === 0 ? [] : ['', ...bgm]),
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
      ...(bgm.length === 0 ? [] : ['', ...bgm]),
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
