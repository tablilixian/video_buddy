/**
 * REQ-021 自动测试报告的 **markdown 构造**（纯函数）。
 *
 * 报告是自包含的评估底稿（设计文档 §4.6）：机器断言逐条 pass/fail + 证据、
 * 产物索引（可直接点开的 URL）、创作过程留档（分镜 / 旁白 / 每次生成的 prompt
 * 原文）、内容评估指引。**内容质量不由本报告判定** —— 「pass」只覆盖客观检查点，
 * 审美与逐字正确性交给验收方（人工或外部大模型）。
 *
 * 放 src/ 根：client 执行器打包进 bundle，node:test 可直连（同 checkpoints 的理由）。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'
import { STORYBOARD_NODE_TOOL } from './contracts/canvas.js'
import type { AutoTestSnapshots } from './auto-test-checkpoints.js'
import { QWEN_TEXT_RENDER_PREFIX } from './auto-test-checkpoints.js'

/** 报告的输入（执行器在运行期间现拉现算；全量重发、Host 覆盖写）。 */
export interface AutoTestReportInput {
  scenarioId: string
  scenarioLabel: string
  scenarioVersion: number
  round: string
  projectName: string
  projectDir: string
  startedAt: number
  finishedAt: number
  appVersion: string
  effective: {
    aspectRatio: string
    videoProvider: string
    imageResolution: string
    videoResolution: string
  }
  /** 逐轮断言结果（turn = 发送序号，0 = 创意剧本回合）。 */
  results: readonly { turn: number; id: string; label: string; pass: boolean; evidence: string }[]
  snapshots: AutoTestSnapshots
  /** 各回合实际发送的剧本原文（留档，验收对账用）。 */
  sentTurns: readonly string[]
  /**
   * 浮窗执行日志（执行器 appendLog 累积的全程留痕）。此前日志只活在前端内存，
   * 排障必须去翻会话转录（R001 实证）；落盘后报告自包含。缺省 = 旧调用方
   * 兼容（不输出该节）。
   */
  logs?: readonly { at: number; text: string; kind: string }[]
}

/** 单条检查点结果在浮窗/报告里的行形态（执行器写 store 用同一形状）。 */
export interface AutoTestCheckpointLine {
  turn: number
  id: string
  label: string
  pass: boolean
  evidence: string
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

/** 分镜卡节点按标题排序（标题通常带「镜 1」等序号；无标题的按 createdAt）。 */
function storyboardCards(nodes: readonly StudioCanvasNode[]): readonly StudioCanvasNode[] {
  return nodes
    .filter(node => node.toolName === STORYBOARD_NODE_TOOL)
    .sort((left, right) => (left.title ?? '').localeCompare(right.title ?? '', 'zh-Hans-CN') || left.createdAt - right.createdAt)
}

/** 产物索引行：成片 / 海报 / 关键帧（全部取自画布节点，URL 为同源相对路径）。 */
function artifactLines(snap: AutoTestSnapshots): readonly string[] {
  const nodes = snap.nodes.filter(node => node.isLoading !== true)
  const lines: string[] = []
  const films = nodes.filter(node => node.kind === 'video' && node.toolName === 'compose')
  for (const film of films) {
    const durationNote = film.duration !== undefined ? `（时长 ${film.duration.toFixed(1)}s）` : ''
    lines.push(`- 成片：${film.url ?? '（缺 URL）'}${durationNote}`)
  }
  const posters = nodes.filter(node => node.kind === 'image' && node.filename !== undefined && QWEN_TEXT_RENDER_PREFIX.test(node.filename))
  for (const poster of posters) lines.push(`- 海报（Qwen 含字链路）：${poster.url ?? '（缺 URL）'} · ${poster.filename}`)
  const keyframes = nodes.filter(node => node.kind === 'image' && node.toolName === 'image_generate')
  for (const frame of keyframes) {
    lines.push(`- 关键帧/概念图：${frame.url ?? '（缺 URL）'} · ${frame.title ?? frame.filename ?? frame.id}`)
  }
  const clips = nodes.filter(node => node.kind === 'video' && node.toolName === 'video_generate')
  for (const clip of clips) {
    lines.push(`- 镜位视频：${clip.url ?? '（缺 URL）'} · ${clip.title ?? clip.id}`)
  }
  return lines
}

/** 创作过程留档：分镜全文 / 旁白全文 / 每次生成的 prompt 原文。 */
function processLines(snap: AutoTestSnapshots): readonly string[] {
  const nodes = snap.nodes.filter(node => node.isLoading !== true)
  const lines: string[] = []
  const cards = storyboardCards(nodes)
  lines.push('### 分镜表全文（分镜卡节点）')
  if (cards.length === 0) lines.push('（画布上没有分镜卡节点）')
  for (const card of cards) {
    lines.push(`#### ${card.title ?? card.id}`)
    lines.push(card.text ?? '（无正文）')
  }
  lines.push('')
  lines.push('### 旁白全文（tts_voiceover）')
  const voices = nodes.filter(node => node.toolName === 'tts_voiceover')
  if (voices.length === 0) lines.push('（画布上没有旁白节点）')
  for (const voice of voices) {
    const text = typeof voice.lyrics === 'string' && voice.lyrics.length > 0
      ? voice.lyrics
      : voice.text ?? '（节点未留文本）'
    lines.push(`- ${text}`)
  }
  lines.push('')
  lines.push('### 每次生成的 prompt 原文（generationPrompt，JSON）')
  const generated = nodes.filter(node => node.generationPrompt !== undefined && node.toolName !== undefined)
  if (generated.length === 0) lines.push('（画布上没有带生成参数的节点）')
  for (const node of generated) {
    lines.push(`- ${node.toolName} · ${node.title ?? node.id}：`)
    lines.push('  ```json')
    for (const line of (node.generationPrompt ?? '').split('\n')) lines.push(`  ${line}`)
    lines.push('  ```')
  }
  return lines
}

/** 浮窗执行日志行：UTC 时钟 + 文本，fail 行显式标注（与浮窗逐行对账）。 */
function logLines(logs: readonly { at: number; text: string; kind: string }[]): readonly string[] {
  return logs.map((entry) => {
    const clock = new Date(entry.at).toISOString().slice(11, 19)
    // 断言类日志的文本自带 [PASS]/[FAIL] 前缀，不重复标注；只补「报告写入失败 /
    // 执行中断」这类文本不带标记的 fail 行。
    const marker = entry.kind === 'fail' && !entry.text.includes('[FAIL]') ? ' [FAIL]' : ''
    return `- ${clock}${marker} ${entry.text}`
  })
}

/** 构造完整报告 markdown（覆盖写全量，增量更新靠执行器每检查点后重发）。 */
export function buildAutoTestReport(input: AutoTestReportInput): string {
  const { snapshots: snap } = input
  const out: string[] = []
  out.push(`# 自动测试报告 · ${input.scenarioLabel}（scenario ${input.scenarioId} v${input.scenarioVersion}）`)
  out.push('')
  out.push(`- 运行：${new Date(input.startedAt).toISOString()} 起，耗时 ${formatDuration(input.finishedAt - input.startedAt)}；app 构建 ${input.appVersion}`)
  out.push(`- 测试项目：${input.projectName}（${input.projectDir}）`)
  out.push(`- 本次生效设置（只读快照，运行期间未改任何设置）：画幅 ${input.effective.aspectRatio} · 视频供应商 ${input.effective.videoProvider} · 图片档位 ${input.effective.imageResolution} · 视频档位 ${input.effective.videoResolution}`)
  out.push('')
  const turns = [...new Set(input.results.map(entry => entry.turn))].sort((left, right) => left - right)
  for (const turn of turns) {
    const sent = input.sentTurns[turn]
    out.push(`## 机器断言（第 ${turn + 1} 轮）`)
    if (sent !== undefined) {
      out.push('')
      out.push(`> 本轮发送原文：`)
      for (const line of sent.split('\n')) out.push(`> ${line}`)
    }
    out.push('')
    for (const entry of input.results.filter(row => row.turn === turn)) {
      out.push(`- [${entry.pass ? 'PASS' : 'FAIL'}] ${entry.label}`)
      out.push(`  - 证据：${entry.evidence}`)
    }
    out.push('')
  }
  out.push('## 产物索引')
  out.push('')
  const artifacts = artifactLines(snap)
  out.push(...(artifacts.length > 0 ? artifacts : ['（暂无产物）']))
  out.push('')
  if (input.logs !== undefined && input.logs.length > 0) {
    out.push('## 执行日志（浮窗留痕）')
    out.push('')
    out.push(...logLines(input.logs))
    out.push('')
  }
  out.push('## 创作过程留档')
  out.push('')
  out.push(...processLines(snap))
  out.push('')
  out.push('## 内容评估指引')
  out.push('')
  out.push('把本文件交给人工或外部大模型，评估以下四项（机器断言不覆盖它们）：')
  out.push('')
  out.push('1. 逐字正确：海报片名《山谷晨光》与画面文字是否逐字正确；')
  out.push('2. 节奏：15s 内晨雾起手 / 骑车下山 / 黄昏收束的节奏是否成立；')
  out.push('3. 美感：画面质感、构图、色调；')
  out.push('4. 纪律遵守：角色形象一致性、旁白同音色、成片无字幕等剧本约束。')
  out.push('')
  out.push('> 机器断言 PASS 不代表内容质量合格；本报告的断言部分只证明客观检查点成立。')
  out.push('')
  return out.join('\n')
}
