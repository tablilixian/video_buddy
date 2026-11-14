/**
 * RQ-R8/P1-10（2026-11-14 复盘 #10）· **离线 manifest 体检**（毫秒级、零副作用）。
 *
 * ## 解决什么
 *
 * 手写 manifest 路径的模型此前要「调一次渲染（14s）换一行报错」——schema 错误、编排
 * 告警、文字溢出分散在三处、分三次发现。本模块把三件套一次列全：
 * validateManifest（schema 全量 errors）+ lintMotion（编排体检，C2 合并形态）+
 * auditTextFit（文字容量估算口径）。spec 通道已在 scaffold 回执前置（A2/A3），本模块
 * 补齐**另一条路**；`validate_manifest` 工具（host-tools.ts）是它的唯一工具入口。
 *
 * 纪律：只读（不落盘、不渲染、不改 manifest）；schema 之外的段落**从不抛错**
 * （体检是辅助设施，坏了不能把校验本身带崩）。
 */
import { readFileSync, statSync } from 'node:fs'
import { throwError } from './error-system.js'
import { validateManifest, type CompositionManifest } from './remotion/manifest.js'
import { formatMotionLint, lintMotion } from './remotion/motion-lint.js'
import { auditTextFit, textFitWarnings } from './remotion/text-fit-audit.js'

export interface ManifestAuditResult {
  /** schema 校验通过（errors 为空）。 */
  manifestOk: boolean
  /** schema 错误**全量**（一次列全，不是第一处就停）。 */
  schemaErrors: string[]
  /** 编排体检条数（C2 合并形态；meta.lint === 'off' 时为 0）。 */
  lintCount: number
  lintLines: string[]
  /** 文字容量预估告警行（估算口径；无溢出为空）。 */
  textFitLines: string[]
  /** 概要（诊断用）；解析失败时 null。 */
  trackCount: number | null
  durationInFrames: number | null
}

/** 读盘 + 解析（不合法即 CS-USER-ERR 拒收，与 specPath 同口径）。 */
function parseManifestFile(manifestPath: string): CompositionManifest {
  let stat: { size: number; isFile: () => boolean }
  try {
    stat = statSync(manifestPath)
  } catch {
    throwError('CS-USER-ERR', { message: `manifest 文件不存在或不可读：${manifestPath}` })
  }
  if (!stat.isFile()) throwError('CS-USER-ERR', { message: `manifestPath 不是普通文件：${manifestPath}` })
  if (stat.size > 16 * 1024 * 1024) {
    throwError('CS-USER-ERR', { message: `manifest 文件过大（${String(stat.size)} 字节 > 16MB）：${manifestPath}` })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (cause) {
    throwError('CS-USER-ERR', { message: `manifest JSON 解析失败：${manifestPath}（${cause instanceof Error ? cause.message : String(cause)}）` })
  }
  return parsed as CompositionManifest
}

/**
 * 三件套体检（schema 段抛错拒收；lint / 文字容量段从不抛）。纯读，零副作用。
 */
export function auditManifestFile(manifestPath: string): ManifestAuditResult {
  const manifest = parseManifestFile(manifestPath)
  const check = validateManifest(manifest)
  const trackCount = Array.isArray(manifest?.tracks) ? manifest.tracks.length : null
  const durationInFrames = typeof manifest?.meta?.durationInFrames === 'number' ? manifest.meta.durationInFrames : null

  let lintLines: string[] = []
  let lintCount = 0
  try {
    const issues = lintMotion(manifest)
    lintCount = issues.length
    lintLines = issues.length === 0
      ? []
      : [`共 ${String(issues.length)} 条（C2 合并形态；渲染时以成片体检为准）：`, ...formatMotionLint(issues).map((line) => `· ${line}`)]
  } catch {
    lintLines = ['（编排体检内部错误——不影响 schema 结论，请把本文件报给开发）']
  }

  let textFitLines: string[] = []
  try {
    textFitLines = textFitWarnings(auditTextFit(manifest))
  } catch {
    textFitLines = ['（文字容量预估内部错误——不影响 schema 结论）']
  }

  return {
    manifestOk: check.ok,
    schemaErrors: check.errors,
    lintCount,
    lintLines,
    textFitLines,
    trackCount,
    durationInFrames,
  }
}

/** 体检结果 → 工具回执文本（三段式；零告警时紧凑一句话）。 */
export function formatManifestAudit(result: ManifestAuditResult, manifestPath: string): string {
  const head = `manifest 校验（毫秒级、零副作用；${String(result.trackCount ?? '?')} 轨 / ${String(result.durationInFrames ?? '?')} 帧）：`
  const schemaLines = result.manifestOk
    ? ['· schema：通过']
    : [`· schema：${String(result.schemaErrors.length)} 条错误（修完再跑本工具，一次列全不用渲染试错）：`,
      ...result.schemaErrors.map((error) => `  · ${error}`)]
  const lintSection = result.lintCount === 0
    ? []
    : [`· 编排体检：`, ...result.lintLines.map((line) => `  ${line}`)]
  const textFitSection = result.textFitLines.length === 0
    ? []
    : ['· 文字容量预估（估算口径，渲染时以 report.textFit 为准；格位宽度就是字号旋钮）：',
      ...result.textFitLines.map((line) => `  · ${line}`)]
  const next = result.manifestOk
    ? '下一步：全绿 → `render_composition({ manifestPath })` 出片。'
    : '下一步：按上面逐条修正后重跑本工具（渲前过闸，别用渲染试错）。'
  return [`文件：${manifestPath}`, head, ...schemaLines, ...lintSection, ...textFitSection, next].join('\n')
}
