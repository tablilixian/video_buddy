#!/usr/bin/env node
/**
 * RQ-11① · 手法库分册**装配器**：把 10 个类目的改写产出合并成
 * `skills/code-driven-explainer/references/shotcraft-catalog.md`。
 *
 * 用法：node scripts/shotcraft-catalog/assemble-catalog.mjs <sources-dir>
 * sources-dir 下每类目一个 .md（camera.md / data.md / …），每条 `### sc-` 开头。
 * 类目顺序与数量来自上游实测清单（152 张：10/11/17/15/10/7/11/19/25/27）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const sourcesDir = process.argv[2]
if (sourcesDir === undefined) {
  console.error('用法：node scripts/shotcraft-catalog/assemble-catalog.mjs <sources-dir>')
  process.exit(2)
}

const SECTIONS = [
  ['camera', 'camera（10 张）', '相机与运镜'],
  ['data', 'data（11 张）', '数据与图表'],
  ['effects', 'effects（17 张）', '效果与强调'],
  ['interaction', 'interaction（15 张）', 'UI 交互模拟'],
  ['opening', 'opening（10 张）', '开场'],
  ['outro', 'outro（7 张）', '收尾落版'],
  ['rhythm', 'rhythm（11 张）', '节奏与剪辑'],
  ['transition', 'transition（19 张）', '转场'],
  ['typography', 'typography（25 张）', '文字动效'],
  ['ui-entrance', 'uiEntrance（27 张）', 'UI 元素入场'],
]

const header = `# shotcraft 手法库 · 152 张镜头卡映射（RQ-11① · REQ-038）

> **来源**：开源 \`video-shotcraft-dsh\`（<https://github.com/kingselyjoe/video-shotcraft-dsh>，
> Apache License 2.0，"video-shotcraft Copyright 2026 Wei Yihao"）的 \`references/shots/\` 152 张
> 镜头配方卡。**只取「参数表 + 已知坑」的手法与参数知识**，提炼改写为本仓口吻；上游的
> TSX 实现 / 模板工程 / 音频 / 美术 / 品牌元素**一件未取**（路线也不同：他们 Route A
> agent 写 TSX，我们 Route B manifest DSL）。许可与边界全文见仓根 \`THIRD_PARTY_NOTICES.md\`；
> 上游的来源研究与二次借鉴纪律（手法参考、独立实现、无原素材、去品牌化）沿用于本分册。
>
> **「我们能不能做」的判定基准**（与本仓渲染器能力一一对应）：
> 能（原生）= DSL 单字段直接表达；近似 = 少量组合（写明组合方式）；暂缓 = 写明缺什么、
> 顶替路线（预生成资产 RQ-16 / 截图采集 RQ-24 / 伪 3D RQ-23）。
> 轨道原语的完整清单见 \`component-contract.generated.md\`（机器生成，永不漂移）。
> 用法：选卡 → 查本卡「走哪条轨道」→ 用对应原语填 spec / manifest；调节手感与已知坑
> 直接是调参起点。
`

const parts = [header]
let total = 0
const counts = []
for (const [file, title, label] of SECTIONS) {
  const path = join(sourcesDir, `${file}.md`)
  if (!existsSync(path)) {
    console.error(`缺类目产出：${path}`)
    process.exit(1)
  }
  const body = readFileSync(path, 'utf8').trim()
  const count = (body.match(/^### sc-/gm) ?? []).length
  total += count
  counts.push(`${file}=${count}`)
  parts.push(`\n## ${title} — ${label}\n\n${body}\n`)
}

const stats = `\n---\n\n**映射统计**：${total} / 152 张（${counts.join(' · ')}）；每卡 7 字段
（一句话 / 能量·时长 / 典型参数 / 调节手感 / 已知坑 / 我们能不能做 / 走哪条轨道）。
重新装配：\`node scripts/shotcraft-catalog/assemble-catalog.mjs <sources-dir>\`。
`
parts.push(stats)
const out = 'skills/code-driven-explainer/references/shotcraft-catalog.md'
writeFileSync(out, parts.join(''))
console.log(`✅ 装配完成：${out}（${total}/152 张）`)
