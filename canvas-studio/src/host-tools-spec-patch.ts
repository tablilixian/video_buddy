/**
 * R11-B3 · `patch_spec_section` —— **段级原子改**（改一处 spec 字段 + 整份校验 + 重编）。
 *
 * ## 为什么需要它
 *
 * R11 的产品判据只有一条：**改一段的代价 = 1 段渲染 + 1 次确认**。改一句话现在要么
 * 「模型重写整份 spec 再 scaffold」（全量落盘 + 段表可能整体漂移 + 缓存全废），要么
 * 「直接改 manifest」（排版是 spec 的产物，下次重编就覆盖，等于白改）。
 *
 * 本模块把「改一处」变成一次工具调用，并把三件事绑在一起：
 *
 * 1. **范围可判定** —— 一次只改一个内容字段（多字段补丁的 diff 无法一眼核对）；
 * 2. **改完仍合法** —— 写回前跑**整份** `validateContentSpec`（改 copy 也可能撑爆
 *    校验里的长度上限）；
 * 3. **改完可出片** —— 给了 `writeTo` 就立刻重编 manifest（复用 scaffold 的体检与
 *    回执），模型不必再记「改完还要重编」这一步。
 *
 * ## 拒收比改错重要
 *
 * 真机会话 6f8ba13c 里有一处静默不一致：成片数据卡是 `−64°C`，而全程工具参数与交付
 * 说明都是 `−60°C`。归因是一个纯格式校验逼模型编了一句拼合文案，顺手把唯一的数值
 * 写错了。所以这里宁可拒收也不「尽量理解」：
 *
 * - `units` 型屏改 `copy` ⇒ 拒绝（那字段不上屏，改了看不到效果，用户会以为 agent 没改）；
 * - 段 id 不存在 ⇒ 拒绝并列出真实 id（不做过期指针的模糊匹配）；
 * - 一次给多个内容字段 ⇒ 拒绝（范围不误解是产品承诺）。
 */
import { writeFileSync } from 'node:fs'
import { throwError } from './error-system.js'
import { readContentSpecFile, scaffoldFromSpec } from './host-tools-spec.js'
import { segmentIdFromRef } from './segment-binding.js'
import type { ContentSpec } from './remotion/content-spec.js'
import { validateContentSpec } from './remotion/content-spec.js'
import type { StudioCanvasNode } from './contracts/canvas.js'
// 本模块自己抛的用户可见错误码出自 catalog：使用方注册一次（同 storyboard-land 的口径）。
import './errors/catalog.js'

/** 白名单补丁字段（**只有这些**能改；其余一律拒收 —— 段级编辑不是 spec 编辑器）。 */
export interface SpecPatchSet {
  /** 屏级文案（仅对「单单元」屏有效；units 型屏会被拒收）。 */
  readonly copy?: string
  /** 屏级标签（eyebrow 用；对两种形态都有效）。 */
  readonly label?: string
  /** 单元下标（0 基）；`unitCopy` / `unitCard` 必带。 */
  readonly unitIndex?: number
  /** 单元的文案（units 型屏的**实际上屏**字段）。 */
  readonly unitCopy?: string
  /** 单元的卡编号（换版式；如 `B1` → `A4`）。 */
  readonly unitCard?: string
  /** 数据来源（写进 section，编译期透传到数据轨的 `dataSource`）。 */
  readonly dataSource?: string
}

export interface SpecPatchInput {
  readonly specPath: string
  /** 目标段（spec `sections[].id`）。 */
  readonly segmentId: string
  readonly set: SpecPatchSet
  /** 重编落盘路径（相对项目根 / 绝对路径，须在项目内）；缺省只改 spec 不重编。 */
  readonly writeTo?: string
  readonly projectDir?: string
  /** 经由哪张卡发起（回执里点名，用户才知道改的是他指的那一段）。 */
  readonly via?: { readonly nodeId: string; readonly nodeTitle: string }
}

/** 一处改动的回显（`path` 是 spec 内定位，人可核对）。 */
export interface SpecPatchDiff {
  readonly path: string
  readonly before: string
  readonly after: string
}

/**
 * 由画布分镜卡解析段 id。
 *
 * 返回判别式结果而不是抛错 —— 调用方（工具层）要把「这张卡没有段指针」翻译成
 * 有建设性的回执（可能原因 + 怎么修），而不是一条通用失败。
 */
export function resolveSegmentIdFromNode(
  node: StudioCanvasNode,
  sectionIds: readonly string[],
): { readonly segmentId: string } | { readonly reason: string } {
  const ref = node.segmentRef
  if (ref === undefined || ref.trim() === '') {
    return {
      reason: `分镜卡「${node.title}」没有段指针（segmentRef）：它可能是备份拍（不占银幕时间，不落卡）、`
        + '也可能落地时屏数与分镜数不相等（不做位置对位）。'
        + `要按段改，请直接指定 segmentId（${sectionIds.join(' / ')}）。`,
    }
  }
  const id = segmentIdFromRef(ref)
  if (id === null) {
    return {
      reason: `分镜卡「${node.title}」的段指针形态不认识（${ref}）—— 只认 \`spec:<段id>\`。`
        + `请直接指定 segmentId（${sectionIds.join(' / ')}）。`,
    }
  }
  if (!sectionIds.includes(id)) {
    return {
      reason: `分镜卡「${node.title}」的段指针已过期（${ref}）：当前 spec 里没有段 ${id}`
        + `（现有 ${sectionIds.join(' / ')}）。spec 换过结构后需要重新 scaffold 才能对齐。`,
    }
  }
  return { segmentId: id }
}

/** 单元下标校验（给 unitCopy / unitCard 用）。 */
function requireUnitIndex(set: SpecPatchSet, units: readonly unknown[] | undefined): number {
  if (units === undefined || units.length === 0) {
    throwError('CS-USER-ERR', {
      message: '这一段是**单单元**屏（没有 units 数组）—— 改它的文案请用 `copy`，不要用 `unitCopy`。',
    })
  }
  const index = set.unitIndex
  if (index === undefined || !Number.isInteger(index) || index < 0) {
    throwError('CS-USER-ERR', {
      message: `改单元必须给 unitIndex（0 基整数）：本段有 ${String(units.length)} 个单元（0–${String(units.length - 1)}）。`,
    })
  }
  if (index >= units.length) {
    throwError('CS-USER-ERR', {
      message: `unitIndex ${String(index)} 越界：本段只有 ${String(units.length)} 个单元（0–${String(units.length - 1)}）。`,
    })
  }
  return index
}

/**
 * 应用补丁到 spec 对象（**纯函数，不碰盘**），返回 diff。
 *
 * 放在这里而不是内联进 `patchSpecSection`，是为了让「哪一处被改了」可以被单测直接
 * 断言 —— diff 的长度就是「影响范围」的证据。
 */
export function applySpecPatch(spec: ContentSpec, segmentId: string, set: SpecPatchSet): SpecPatchDiff {
  const index = spec.sections.findIndex((section) => section.id === segmentId)
  if (index < 0) {
    throwError('CS-USER-ERR', {
      message: `spec 里没有段 ${segmentId}（现有 ${spec.sections.map((section) => section.id).join(' / ')}）`
        + ' —— 段 id 拼错或 spec 已换结构。用 scaffold 回执里的屏表核对。',
    })
  }
  const section = spec.sections[index] as ContentSpec['sections'][number]

  const contentKeys = (['copy', 'label', 'unitCopy', 'unitCard'] as const)
    .filter((key) => typeof set[key] === 'string')
  if (contentKeys.length === 0) {
    throwError('CS-USER-ERR', {
      message: '没有要改的内容字段：`set` 里至少给一个（copy / label / unitCopy / unitCard；'
        + 'dataSource 是附加信息，单独给它不构成一次改动）。',
    })
  }
  if (contentKeys.length > 1) {
    throwError('CS-USER-ERR', {
      message: `一次只改一处，收到 ${String(contentKeys.length)} 个（${contentKeys.join(' / ')}）—— `
        + '多字段补丁的 diff 无法一眼核对「范围有没有跑出去」，而范围不误解正是段级编辑的产品承诺。'
        + '分多次调用即可。',
    })
  }
  const key = contentKeys[0] as (typeof contentKeys)[number]

  // ── 拒收：units 型屏改 copy（不上屏，改了看不到效果） ──
  if (key === 'copy') {
    const units = section.units
    if (units !== undefined && units.length > 0) {
      const copyList = units
        .map((unit, unitIndex) => `  [${String(unitIndex)}] ${unit.card ?? '—'}：${JSON.stringify(unit.copy ?? '')}`)
        .join('\n')
      throwError('CS-USER-ERR', {
        message: `段 ${segmentId} 是 **units 型屏**（${String(units.length)} 个单元），\`copy\` 是屏级权重文案、**不上屏** —— `
          + '改它画面不会有任何变化。请改用 `unitCopy` + `unitIndex` 指定要改的单元：\n' + copyList,
      })
    }
    const before = section.copy ?? ''
    if (typeof set.copy !== 'string') throwError('CS-DEV-ERR', { detail: 'copy patch 缺值（这是产品缺陷）' })
    section.copy = set.copy
    return { path: `sections[${String(index)}].copy`, before, after: set.copy }
  }

  if (key === 'label') {
    const before = section.label ?? ''
    if (typeof set.label !== 'string') throwError('CS-DEV-ERR', { detail: 'label patch 缺值（这是产品缺陷）' })
    section.label = set.label
    return { path: `sections[${String(index)}].label`, before, after: set.label }
  }

  const unitIndex = requireUnitIndex(set, section.units)
  const unit = (section.units as NonNullable<typeof section.units>)[unitIndex] as NonNullable<typeof section.units>[number]

  if (key === 'unitCopy') {
    const before = unit.copy ?? ''
    if (typeof set.unitCopy !== 'string') throwError('CS-DEV-ERR', { detail: 'unitCopy patch 缺值（这是产品缺陷）' })
    unit.copy = set.unitCopy
    return {
      path: `sections[${String(index)}].units[${String(unitIndex)}].copy`,
      before,
      after: set.unitCopy,
    }
  }

  const before = unit.card ?? ''
  if (typeof set.unitCard !== 'string') throwError('CS-DEV-ERR', { detail: 'unitCard patch 缺值（这是产品缺陷）' })
  unit.card = set.unitCard
  return {
    path: `sections[${String(index)}].units[${String(unitIndex)}].card`,
    before,
    after: set.unitCard,
  }
}

/**
 * 段级 patch：读 → 改一处 → 整份校验 → 写回 →（可选）重编 manifest。
 *
 * 写回的是 **spec 文件本身**（2 空格缩进，人可读可 diff）；manifest 是它的产物，
 * 由 scaffold 重编覆盖 —— 手改 manifest 会在下一次重编时被抹掉，那是既有纪律。
 */
export function patchSpecSection(input: SpecPatchInput): { text: string } {
  const spec = readContentSpecFile(input.specPath)
  const diff = applySpecPatch(spec, input.segmentId, input.set)
  if (typeof input.set.dataSource === 'string') {
    const index = spec.sections.findIndex((section) => section.id === input.segmentId)
    const section = spec.sections[index] as ContentSpec['sections'][number]
    section.dataSource = input.set.dataSource
  }

  // 写回前整份复校：改一个字也可能撑爆长度上限（校验是唯一事实源）。
  const check = validateContentSpec(spec)
  if (!check.ok) {
    throwError('CS-USER-ERR', {
      message: `patch 会让 spec 变成非法（已回滚，文件未改）：\n${check.errors.map((error) => `· ${error}`).join('\n')}`,
      detail: 'content spec invalid after patch',
    })
  }

  writeFileSync(input.specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')

  const who = input.via === undefined ? '' : `（经分镜卡「${input.via.nodeTitle}」）`
  const lines = [
    `已改 1 处${who}：\`${diff.path}\`：${JSON.stringify(diff.before)} → ${JSON.stringify(diff.after)}`,
  ]
  if (typeof input.set.dataSource === 'string') {
    lines.push(`同时写 dataSource：${JSON.stringify(input.set.dataSource)}（编译期透传到数据轨，消掉「缺 dataSource」告警）`)
  }
  lines.push(
    `影响面：下一次渲染只有段 ${input.segmentId} 需要重渲（前提：其他段内容与全局态未变；`
      + '段表与时长都没动，所以段窗不变）。',
  )

  if (input.writeTo === undefined || input.writeTo.trim() === '') {
    lines.push(
      `下一步：\`scaffold_manifest({ specPath: ${JSON.stringify(input.specPath)}, writeTo: "build/manifest.json" })\` 重编 → `
        + '`render_composition({ manifestPath })` 出片（会回执「几段复用 / 几段重渲」）。',
    )
    return { text: lines.join('\n') }
  }
  if (input.projectDir === undefined) {
    throwError('CS-USER-ERR', { message: 'writeTo 需要项目根（内部调用错误：projectDir 缺失）' })
  }
  const scaffolded = scaffoldFromSpec({
    specPath: input.specPath,
    writeTo: input.writeTo.trim(),
    projectDir: input.projectDir,
  })
  lines.push('', scaffolded.text)
  return { text: lines.join('\n') }
}
