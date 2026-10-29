/**
 * 能力基准 · 产物落盘（verdict.json / README.md / source.json / probe.mjs）。
 *
 * 铁律：这些文件**由脚本生成**，不许手写（D9）——手写的结论会与 checks 漂移。
 * `README.md` 里的人类判断也只有两个字段可手改：`humanScore` 与 `missing`，
 * 其余数字一律来自 `checks.json`。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 归因表（10 行）——写"缺什么能力"时只能从这里挑，杜绝"略有瑕疵"这类空话（§9.4 第四步）。 */
export const ATTRIBUTION = [
  ['A1', '整块元素不出现', '组件不在 web-renderer 白名单，或属性被静默忽略'],
  ['A2', '转场像硬切', 'mask 只认 linear-gradient/url、perspective 不被读取'],
  ['A3', '3D 极慢或花屏', 'WebGL 退化成软件渲染（换机复跑 Q12 确认）'],
  ['A4', '文字出画/换行错', '文本测量缺失，或字体未就绪回退系统字体'],
  ['A5', '音频缺失或不同步', 'TTS/编码链断，或 trimBefore 与音轨起点没对齐'],
  ['A6', '两次渲染不一致', '非确定性混进渲染（随机数、Date.now、未等待的加载）'],
  ['A7', '画面糊但元素正确', '素材分辨率不足（占位素材 1280 宽铺 1080p），**不是渲染缺陷**'],
  ['A8', '效果对但明显偏慢', '合成复杂度（每帧几何重算 / 多层滤镜），非环境问题'],
  ['A9', '颜色/混合不对', 'blend/backdrop 类属性在 4.0.535 未实现'],
  ['A10', '完全跑不通', '依赖缺失或版本冲突（双 React、r3f 9.x、remotion 版本不齐）'],
]

function sha256Prefix(file, bytes = 12) {
  if (!existsSync(file)) return null
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, bytes)
}

function fmtBytes(n) {
  if (!n) return '?'
  return n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`
}

/**
 * @param {{ spec: any, outDir: string, run: any, checks: any, assets: any[], entryRel: string, benchRun: string }} options
 */
export function writeReport(options) {
  const { spec, outDir, run, checks, assets, entryRel, benchRun } = options
  mkdirSync(outDir, { recursive: true })

  const verdict = {
    id: spec.id,
    axis: spec.axis,
    title: spec.title,
    reference: spec.reference,
    status: spec.status,
    spec: { width: run.width, height: run.height, fps: run.fps, durationInFrames: run.durationInFrames },
    rendered: {
      outFile: run.outName,
      bytes: checks.info.sizeBytes,
      durationSec: checks.info.durationSec,
      ms: run.ms,
      msPerFrame: run.msPerFrame,
      window: run.window,
      flags: run.flags,
    },
    streams: {
      video: checks.info.video,
      audio: checks.info.audio,
      bitRate: checks.info.bitRate,
    },
    checks: checks.checks,
    passedCount: checks.passedCount,
    hardFail: checks.hardFail,
    autoScore: checks.autoScore,
    humanScore: null,
    missing: [],
    runtime: run.runtime,
    assets,
    generatedAt: new Date().toISOString(),
    note: 'autoScore 是机械分（5 条硬检查）；humanScore 由目视复核后手填；missing 只能引用 ATTRIBUTION 的编号。',
  }
  writeFileSync(join(outDir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`)

  writeFileSync(
    join(outDir, 'source.json'),
    `${JSON.stringify(
      {
        composition: entryRel,
        registryKey: spec.id,
        remotion: run.runtime?.remotionVersion ?? null,
        react: run.runtime?.reactVersion ?? null,
        chrome: run.runtime?.chromeMajor ?? null,
      },
      null,
      2,
    )}\n`,
  )

  // 可复跑入口：一行 wrapper。**写绝对路径**——产物目录深度会变，算相对层级必错一次。
  writeFileSync(
    join(outDir, 'probe.mjs'),
    `#!/usr/bin/env node
/**
 * 复跑这一条能力片（产物写回本目录）。
 * 用法：node probe.mjs [--window=hidden] [--repeat=2] [--flags=CanvasDrawElement]
 * 环境变量 BENCH_RUN 可覆盖 bench 入口（换机器/换 checkout 时用）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BENCH = process.env.BENCH_RUN || ${JSON.stringify(benchRun)}
if (!existsSync(BENCH)) {
  console.error('[probe] 找不到 bench 入口：' + BENCH + '\\n用 BENCH_RUN=/abs/path/run.mjs 覆盖')
  process.exit(2)
}
const result = spawnSync(process.execPath, [BENCH, '--only=${spec.id}', '--out=' + HERE, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '' },
})
process.exit(result.status ?? 1)
`,
    { mode: 0o755 },
  )

  const checkRows = Object.entries(checks.checks)
    .map(([key, c]) => `| ${key} | ${c.name} | ${c.pass === true ? '✅ 通过' : c.pass === false ? '❌ 未过' : '➖ 未跑'} | ${c.detail} |`)
    .join('\n')

  const assetRows =
    assets.length > 0
      ? assets.map((a) => `| \`${a.key}\` | \`${a.path}\` | ${a.bytes ? fmtBytes(a.bytes) : '?'} | \`${a.sha256 ?? '?'}\` |`).join('\n')
      : '| — | 本条不用外部素材 | — | — |'

  const attributionRows = ATTRIBUTION.map(([code, symptom, cause]) => `| ${code} | ${symptom} | ${cause} |`).join('\n')

  const readme = `# ${spec.id} · ${spec.title}

> 本条能力轴：\`${spec.axis}\`　官方对照：${spec.reference}
> 判定：**autoScore ${checks.autoScore}/5**（机械）　humanScore：**待填**（目视）
> 生成时间：${verdict.generatedAt}　规格：${run.width}×${run.height} @${run.fps}fps / ${run.durationInFrames} 帧

## 1. 这条片想证明什么

${spec.design}

## 2. 判定（5 条硬检查，机械）

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
${checkRows}

- 成片：\`${run.outName}\`　${fmtBytes(checks.info.sizeBytes)}　${checks.info.durationSec ?? '?'}s
- 渲染：${run.ms ?? '?'} ms / ${run.durationInFrames} 帧 = **${run.msPerFrame ?? '?'} ms/帧**（窗口：${run.window}，flags：${run.flags || '无'}）
- 流：video \`${checks.info.video?.codec ?? '?'}\` ${checks.info.video?.width ?? '?'}×${checks.info.video?.height ?? '?'} @${checks.info.video?.fps ?? '?'}fps / audio \`${checks.info.audio?.codec ?? '无'}\`
- 硬检查未过项：${checks.hardFail.length === 0 ? '**无**' : checks.hardFail.join('、')}

## 3. 缺什么能力（只能从归因表挑，编号写进 verdict.json 的 missing）

| 编号 | 症状 | 归因 |
|---|---|---|
${attributionRows}

> 目视复核后，把结论填进 \`verdict.json\`：\`humanScore\`（0–5）+ \`missing\`（如 \`["A2"]\`）。
> **允许写"没做到"，不允许写"差不多"。**

## 4. 素材（只占位，不评画质）

| 键 | 路径 | 体积 | sha256 前 12 |
|---|---|---|---|
${assetRows}

## 5. 复跑

\`\`\`bash
node probe.mjs                 # 用本目录已有配置重跑一次
node probe.mjs --repeat=2      # 连渲两次做可复现比对（H4）
node probe.mjs --window=hidden # 换窗口档
\`\`\`

源码：\`${entryRel}\`（注册键 \`${spec.id}\`）——源码不在产物目录，见文档 §9.2（代码可 diff、产物可删）。
`

  writeFileSync(join(outDir, 'README.md'), readme)
  return verdict
}

/** repo 内索引（只留指针，mp4 不进 git）。**按 id 合并**，避免单条复跑把别人的行冲掉。 */
export function writeIndex(indexFile, rows) {
  const sidecar = join(dirname(indexFile), 'INDEX.json')
  let merged = []
  if (existsSync(sidecar)) {
    try {
      merged = JSON.parse(readFileSync(sidecar, 'utf8'))
    } catch {
      merged = []
    }
  }
  for (const row of rows) {
    const at = merged.findIndex((r) => r.id === row.id)
    if (at >= 0) merged[at] = { ...merged[at], ...row }
    else merged.push(row)
  }
  merged.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  mkdirSync(dirname(indexFile), { recursive: true })
  writeFileSync(sidecar, `${JSON.stringify(merged, null, 2)}\n`)

  const body = merged
    .map(
      (r) =>
        `| ${r.id} | ${r.title ?? ''} | ${r.status ?? ''} | ${r.autoScore == null ? '—' : `${r.autoScore}/5`} | ${r.outFile ?? '—'} | \`${r.dir ?? '—'}\` |`,
    )
    .join('\n')
  writeFileSync(
    indexFile,
    `# 能力基准产物索引

> 产物在 repo 外（mp4 不进 git）。本文件由 \`scripts/capability-bench/run.mjs\` 生成，
> 数据源是旁边的 \`INDEX.json\`（按 id 合并，单条复跑不会冲掉其它条目）。
> 生成时间：${new Date().toISOString()}

| # | 能力项 | 状态 | autoScore | 成片 | 产物目录 |
|---|---|---|---|---|---|
${body}
`,
  )
}
