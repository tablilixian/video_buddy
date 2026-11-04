/**
 * B-3（CV-439）体检回执消费端 —— 编排体检完整清单的落盘与可见回执。
 *
 * 背景（会话 15 实测）：F-14 把 ≥3 条编排体检折叠成一行计数后，13 条告警的
 * 逐条定位躺在结构化字段 `report.lint[]` 里，agent 一次都没读 —— 折叠治住了
 * 上下文膨胀，却把「看到具体问题」这一步也折没了。本模块把完整清单（编号 /
 * 定位 / 文案 / 建议）落盘成项目 `build/` 下的 markdown；回执只给
 * 「计数 + 前 N 条原文 + 落盘路径」，要修哪条再按路径取全文，不占常驻上下文。
 *
 * 与 F-14（`collapseLintWarnings`）的分工：F-14 管 warnings 里的**计数行**，
 * 这里管渲染报告里的**前 N 条原文 + 落盘路径**。两处拼起来才是完整回执。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MotionLintIssue } from './remotion/motion-lint.js'

/** 回执可见的前 N 条（其余走落盘文件；全部进上下文 = 折叠前的老问题）。 */
export const LINT_VISIBLE = 5

/** 完整清单的 markdown 全文（纯函数，可单测）。 */
export function lintReportMarkdown(issues: readonly MotionLintIssue[]): string {
  const lines = [
    `# 编排体检完整清单（${issues.length} 条）`,
    '',
    '> 本文件由 render_composition 自动落盘。回执只展示前 5 条原文；修哪条读哪条，不必整读。',
    '',
  ]
  issues.forEach((issue, i) => {
    lines.push(`## ${i + 1}. ${issue.code} @ ${issue.at}`, '', issue.message, '', `建议：${issue.hint}`, '')
  })
  return lines.join('\n')
}

/**
 * 落盘并返回绝对路径；`build/` 不存在自动建。写失败返回 null —— 回执退化为
 * 只有前 N 条原文，**不阻断渲染**（体检是提示不是闸门，落盘失败不值得让一单白渲）。
 */
export function writeLintReport(projectDir: string, issues: readonly MotionLintIssue[], stamp: string): string | null {
  try {
    const dir = join(projectDir, 'build')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `lint-${stamp}.md`)
    writeFileSync(path, lintReportMarkdown(issues), 'utf8')
    return path
  } catch {
    return null
  }
}

/** 渲染报告里的体检可见段（纯函数）。lint 为空 ⇒ 不出任何行。 */
export function lintReceiptLines(
  lint: readonly { code: string; at: string; message: string }[],
  lintPath: string | undefined,
): string[] {
  if (lint.length === 0) return []
  const head = lint.slice(0, LINT_VISIBLE)
  const lines = [
    `体检 ${lint.length} 条（前 ${head.length} 条原文；完整清单落盘路径在末行，修哪条读哪条）：`,
  ]
  for (const issue of head) lines.push(`- ${issue.code} @ ${issue.at}：${issue.message}`)
  lines.push(lintPath !== undefined
    ? `完整清单已落盘：${lintPath}`
    : '（完整清单落盘失败，以上可见条目即全部可得）')
  return lines
}
