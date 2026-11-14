/**
 * REQ-038 R7（RQ-27）· **起点 D：内容规格（屏表）**。
 *
 * ## 为什么需要这个文件
 *
 * `content-spec.ts` 在 2026-11-12 就实现了 `ContentSpec` + `validateContentSpec` +
 * `planFromSpec`（提交 `9e715ab9b7`，3 个测试文件），但**没有任何工具入口**：
 * `grep "planFromSpec\|ContentSpec" src/host-tools*.ts src/routes.ts` 零命中。
 * 于是模型在真机会话（223 次调用）里根本没碰到这条通道，自己写了 29KB 的
 * `gen_specs.py`（7 个硬编码盒常量）—— 落地对照表 RQ-18 所述「已有 recipe/spec 入口」
 * 与代码不符，本条需求即修正该陈述。
 *
 * ## 与另外三个起点的关系
 *
 * - A `templateId`：整片模板（结构与时长都固化）；
 * - B `recipe`：片型配方（4 个配方，段结构固定）；
 * - C `title + durationSeconds`：三轨裸骨架；
 * - **D `specPath`（本文件）**：屏级编排 —— 每屏 1–4 个单元 + 格位 + 跨屏常驻层。
 *
 * 四者互斥：给了 `specPath` 就说明结构、时长、文案全在 spec 里，再给 `title` 只会
 * 产生两个事实来源。
 */

import { readFileSync, statSync } from 'node:fs'
import { sep } from 'node:path'
import { throwError } from './error-system.js'
import { MANIFEST_PREVIEW_LINES, writeManifestFile } from './manifest-file.js'
import { validateManifest } from './remotion/manifest.js'
import type { CompositionManifest } from './remotion/manifest.js'
import type { ContentSpec } from './remotion/content-spec.js'
import { planFromSpec, validateContentSpec } from './remotion/content-spec.js'
import { formatMotionLint, lintMotion } from './remotion/motion-lint.js'
import { auditTextFit, textFitWarnings } from './remotion/text-fit-audit.js'
import { resolveTheme } from './remotion/themes.js'

/** spec 文件上限：与 `render_composition` 的 manifestPath 同口径（8MB）。 */
const MAX_SPEC_BYTES = 8 * 1024 * 1024

export interface SpecScaffoldInput {
  /** spec JSON 的**绝对路径**（与 manifestPath 同口径：相对路径会歧义到 cwd 还是项目根）。 */
  specPath: string
  /** 落盘路径（相对项目根，必须在项目内）；缺省只回显不落盘。 */
  writeTo?: string
  /** 落盘时的项目根；`writeTo` 给了就必须有。 */
  projectDir?: string
}

export function scaffoldFromSpec(input: SpecScaffoldInput): { text: string } {
  const raw = input.specPath.trim()
  if (raw === '') throwError('CS-USER-ERR', { message: 'specPath 不能为空' })
  if (!raw.startsWith(sep)) {
    throwError('CS-USER-ERR', {
      message: `specPath 必须是绝对路径（收到 ${raw}）—— 相对路径在「cwd / 项目根 / 会话根」之间有歧义，`
        + '写错一次就会读到上一版 spec，出片后才发现。',
    })
  }
  let stat: { size: number; isFile: () => boolean }
  try {
    stat = statSync(raw)
  } catch {
    throwError('CS-USER-ERR', { message: `spec 文件不存在或不可读：${raw}` })
  }
  if (!stat.isFile()) throwError('CS-USER-ERR', { message: `specPath 不是普通文件：${raw}` })
  if (stat.size > MAX_SPEC_BYTES) {
    throwError('CS-USER-ERR', { message: `spec 文件过大（${String(stat.size)} 字节 > 8MB）：${raw}` })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(raw, 'utf8'))
  } catch (cause) {
    throwError('CS-USER-ERR', {
      message: `spec JSON 解析失败：${raw}（${cause instanceof Error ? cause.message : String(cause)}）`,
    })
  }

  // 校验先于一切：error 即拒收且**零副作用**（不落盘、不建目录）。
  const check = validateContentSpec(parsed)
  if (!check.ok) {
    throwError('CS-USER-ERR', {
      message: `spec 校验失败（${String(check.errors.length)} 条），未落盘也未生成任何轨道：\n`
        + check.errors.map((error) => `· ${error}`).join('\n'),
      detail: 'content spec invalid',
    })
  }
  const spec = parsed as ContentSpec

  const fps = typeof spec.meta.fps === 'number' && spec.meta.fps > 0 ? spec.meta.fps : 30
  const declared = spec.meta.durationSec
  const summed = spec.sections.reduce((acc, section) => {
    const seconds = typeof section.durationSec === 'number' ? section.durationSec : 0
    return acc + seconds
  }, 0)
  const seconds = typeof declared === 'number' && declared > 0 ? declared : summed
  if (seconds <= 0) {
    throwError('CS-USER-ERR', {
      message: 'spec 算不出时长：既没给 meta.durationSec，sections 也都没给 durationSec（至少给一个，否则帧数无解）',
    })
  }
  const total = Math.max(fps, Math.round(seconds * fps))

  const { theme } = resolveTheme(spec.meta.theme)
  const plan = planFromSpec(spec, total)
  const manifest = {
    id: `comp-spec-${Date.now().toString(36)}`,
    meta: {
      title: spec.meta.title,
      width: 1920,
      height: 1080,
      fps,
      durationInFrames: total,
      backgroundColor: theme.backgroundColor,
      // RQ-19 的密度报告按前缀判定「配方生成」：spec 产物必须自报家门，否则算手写。
      generatedBy: 'spec:content-spec' as const,
    },
    tracks: plan.tracks,
  }
  const manifestCheck = validateManifest(manifest as unknown as CompositionManifest)
  if (!manifestCheck.ok) {
    throwError('CS-DEV-ERR', {
      message: `spec 编译出的 manifest 校验失败（这是产品缺陷，请报给开发）：${manifestCheck.errors.join('；')}`,
      detail: 'spec compiled to invalid manifest',
    })
  }

  const json = JSON.stringify(manifest, null, 2)
  const compactJson = JSON.stringify(manifest)
  const unitCount = spec.sections.reduce((acc, section) => acc + (Array.isArray(section.units) ? section.units.length : 1), 0)
  const carryCount = Array.isArray(spec.carry) ? spec.carry.length : 0

  const screenTable = [
    `**屏表**（${String(spec.sections.length)} 屏 · ${String(unitCount)} 单元 · ${String(carryCount)} 块常驻层 · ${String(total)} 帧 / ${String(seconds)}s）：`,
    ...plan.timeline.map((slot) => {
      const section = spec.sections.find((candidate) => candidate.id === slot.id)
      const units = section === undefined
        ? 1
        : (Array.isArray(section.units) && section.units.length > 0 ? section.units.length : 1)
      return `· ${slot.id}「${slot.label}」帧 ${String(slot.startFrame)}–${String(slot.startFrame + slot.durationInFrames - 1)}`
        + `（${String(Math.round(slot.durationInFrames / fps * 10) / 10)}s · ${String(units)} 单元）`
    }),
  ]

  // B1（RQ-N2）：autoStages 时把工具替模型做的节奏决定原文带出 —— 看不见的决定等于没做。
  const rhythmNote: string[] = []
  if (plan.stagePlan !== undefined) {
    const sp = plan.stagePlan
    const lengths = sp.stages.map((stage) => Math.round((stage.durationInFrames / fps) * 10) / 10)
    rhythmNote.push(
      `节奏：planStages 算出 ${String(sp.stages.length)} 屏（目标 ${String(sp.meta.target)}${sp.meta.clamped ? '，触到屏数上限' : ''}），屏长 ${String(Math.min(...lengths))}–${String(Math.max(...lengths))}s`
        + (Object.keys(sp.meta.absorbedBy).length > 0 ? `；短屏已合并：${JSON.stringify(sp.meta.absorbedBy)}` : ''),
    )
  }

  // A2（RQ-R8）：编译期编排体检 —— 渲染前把 ML-* 全量给到（C2 合并治理后通常 ≤5 条）。
  // 渲染期仍会以成片再跑一次为准；这里给的是「渲之前就能看到」的预估。
  const lintIssues = lintMotion(manifest as unknown as CompositionManifest)
  const lintLines = lintIssues.length === 0
    ? []
    : [`编排体检（编译期预估 ${String(lintIssues.length)} 条，渲染时以成片体检为准）：`,
      ...formatMotionLint(lintIssues).map((line) => `· ${line}`)]

  // A3：编译期文字容量预估 —— Node 侧自动走字符宽度估算口径（auditTextFit 从不抛错）；
  // 溢出 = 折行数超出盒子的设计行数（成片会被裁）。渲染时以 report.textFit 真值为准。
  const textFitNotes = textFitWarnings(auditTextFit(manifest as unknown as CompositionManifest))
  const textFitLines = textFitNotes.length === 0
    ? []
    : ['文字容量预估（估算口径，渲染时以 report.textFit 为准；格位宽度就是字号旋钮）：',
      ...textFitNotes.map((line) => `· ${line}`)]

  const needs = plan.assetNeeds
  const assetHints = needs.user.length === 0 ? [] : [
    `⚠️ **必须由用户提供的素材**（${String(needs.user.length)} 项；缺了会走降级版式，不会停）：`,
    ...needs.user.map((need) => `· ${need.segmentId} → ${need.slot}（${need.kind}）${need.fallback === undefined ? '' : `：${need.fallback}`}`),
  ]

  const hints = [
    ...(check.warnings.length === 0 ? [] : ['⚠️ spec 警告（不阻断）：', ...check.warnings.map((warning) => `· ${warning}`)]),
    ...screenTable,
    ...rhythmNote,
    ...lintLines,
    ...textFitLines,
    ...assetHints,
    `密度自检：本次 ${String(plan.tracks.length)} 轨 / ${String(seconds)}s = ${String(Math.round((plan.tracks.length / seconds) * 100) / 100)} 轨每秒`
      + '（真机 45s 版是 0.53 —— 低于 1.0 通常意味着「一屏一个单元」，回看 spec 的 units）。',
  ]

  if (input.writeTo === undefined || input.writeTo.trim() === '') {
    return {
      text: [
        `已按 spec 生成 ${String(1080)}p · ${String(fps)}fps · ${String(total)} 帧（${String(seconds)}s）的 manifest，已通过 validateManifest：`,
        '```json',
        json,
        '```',
        ...hints,
        '下一步：① 把这份 JSON 存成 build/manifest.json（或重跑本工具并传 `writeTo: "build/manifest.json"`）；'
          + '② `render_composition({ manifestPath, quality: "draft" })` 出片。',
      ].join('\n'),
    }
  }

  if (input.projectDir === undefined) {
    throwError('CS-USER-ERR', { message: 'writeTo 需要项目根才能判定「是否落在本项目内」（内部调用错误：projectDir 缺失）' })
  }
  const written = writeManifestFile({
    projectDir: input.projectDir,
    writeTo: input.writeTo.trim(),
    json,
    compactJson,
    trackCount: plan.tracks.length,
  })
  return {
    text: [
      `已写入 ${written.path}（${String(written.trackCount)} 轨 · ${written.bytes.toLocaleString('en-US')} 字节），已通过 validateManifest。`,
      `前 ${String(MANIFEST_PREVIEW_LINES)} 行供核对结构（**不要据此重传整份**）：`,
      '```json',
      written.preview,
      '```',
      ...hints,
      `下一步：直接 \`render_composition({ manifestPath: ${JSON.stringify(written.path)}, quality: "draft" })\` 出片。`,
      `改版面请改 **spec 文件**再重跑本工具（不要手改 manifest —— 排版是 spec 的产物，手改会被下次重编覆盖）。`,
    ].join('\n'),
  }
}
