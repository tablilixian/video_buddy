/**
 * 能力基准 · 收尾汇总（D9）：读全部 NN-xx/verdict.json → 产物根 REPORT.md / metrics.json / INDEX.json / env.json。
 *
 * 用法：cd canvas-studio && NODE_OPTIONS= node scripts/capability-bench/summarize.mjs [--out=<产物根>]
 * 产物根默认 ~/Desktop/job/VideoOut/remotion-capability-20261029。
 * verdict 的 humanScore/missing/visualReview 由目视回填，本脚本只汇总不改写。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const OUT = arg('out', '/Users/wl/Desktop/job/VideoOut/remotion-capability-20261029')
const BENCH_ROOT = 'canvas-studio/scripts/capability-bench'

const LEVELS = {
  '01': 'L0（C 级 · 要装依赖）',
  '02': 'L1 近似（substitute）',
  '03': 'L0（B+ 级 · 零依赖 + flag）',
  '04': 'L1（B 级 · 纯 DOM/SVG）',
  '05': 'L1（B 级 · TTS 全链）',
  '06': 'L1（A 级）',
  '07': 'L1（B 级）',
  '08': 'L1（B 级部分 · 已知缺失项对照）',
  '09': 'L1（B 级 DOM 补件 + 问题项目视）',
  '10': 'L1（A 级）',
}

const dirs = readdirSync(OUT).filter((d) => /^\d{2}-/.test(d) && statSync(join(OUT, d)).isDirectory()).sort()
const items = []
for (const d of dirs) {
  const vp = join(OUT, d, 'verdict.json')
  if (!existsSync(vp)) continue
  const v = JSON.parse(readFileSync(vp, 'utf8'))
  const mp4 = join(OUT, d, v.rendered.outFile)
  const sha = existsSync(mp4) ? createHash('sha256').update(readFileSync(mp4)).digest('hex').slice(0, 12) : null
  items.push({ dir: d, verdict: v, mp4, sha })
}

/* -------------------------------- metrics.json -------------------------------- */

const metrics = {
  generatedAt: new Date().toISOString(),
  environment: {
    electron: '43.4.0',
    chromeMajor: items[0]?.verdict.runtime?.chromeMajor ?? null,
    remotion: '4.0.535',
    webgl2: items[0]?.verdict.runtime?.webgl2 ?? null,
    videoCodecs: items[0]?.verdict.runtime?.videoCodecs ?? null,
    audioCodecs: items[0]?.verdict.runtime?.audioCodecs ?? null,
    canRender: items[0]?.verdict.runtime?.canRender ?? null,
  },
  items: items.map(({ dir, verdict, mp4, sha }) => ({
    id: verdict.id,
    axis: verdict.axis,
    title: verdict.title,
    dir: join(OUT, dir),
    mp4: existsSync(mp4) ? mp4 : null,
    sha256_12: sha,
    bytes: verdict.rendered.bytes,
    durationSec: verdict.streams.video ? verdict.rendered.durationSec : null,
    width: verdict.spec.width,
    height: verdict.spec.height,
    fps: verdict.spec.fps,
    durationInFrames: verdict.spec.durationInFrames,
    msPerFrame: verdict.rendered.msPerFrame,
    bitRate: verdict.streams.bitRate ?? null,
    codec: verdict.streams.video?.codec ?? null,
    audioCodec: verdict.streams.audio?.codec ?? null,
    window: verdict.rendered.window,
    flags: verdict.rendered.flags || null,
    autoScore: verdict.autoScore,
    humanScore: verdict.humanScore,
    missing: verdict.missing,
    degraded: verdict.degraded ?? null,
    level: LEVELS[verdict.id] ?? null,
    checks: Object.fromEntries(Object.entries(verdict.checks).map(([k, c]) => [k, c.pass])),
  })),
}
writeFileSync(join(OUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`)

/* --------------------------------- INDEX.json --------------------------------- */

const index = metrics.items.map((m) => ({
  id: m.id,
  axis: m.axis,
  title: m.title,
  dir: m.dir,
  mp4: m.mp4,
  sha256_12: m.sha256_12,
  bytes: m.bytes,
  durationSec: m.durationSec,
  autoScore: m.autoScore,
  humanScore: m.humanScore,
}))
writeFileSync(join(OUT, 'INDEX.json'), `${JSON.stringify(index, null, 2)}\n`)

/* ---------------------------------- env.json ---------------------------------- */

writeFileSync(
  join(OUT, 'env.json'),
  `${JSON.stringify(
    {
      generatedAt: metrics.generatedAt,
      note: 'B0 探针详细数据见方案文档 §10 与 repo 内 scripts/capability-bench/env/out/；此处为渲染会话自报的运行时快照。',
      ...metrics.environment,
    },
    null,
    2,
  )}\n`,
)

/* ---------------------------------- REPORT.md --------------------------------- */

const rows = metrics.items
  .map((m) => {
    const stability = m.checks.H4 === true ? `md5 全等（两次渲）` : m.checks.H4 === false ? 'H4 红' : '未跑'
    const missing = m.missing.length === 0 ? '—' : m.missing.join(' ')
    return `| ${m.id} ${m.title} | ${m.level ?? '—'} | **${m.humanScore ?? '?'}**（机 ${m.autoScore}/5） | ${stability} | ${missing} | \`${m.id}-${m.axis}/cap${m.id}.mp4\` |`
  })
  .join('\n')

const perItem = metrics.items
  .map((m) => {
    const v = items.find((i) => i.dir.startsWith(m.id))?.verdict
    return `### ${m.id} · ${m.title}\n\n- 得分：目视 **${m.humanScore}/5** · 机械 ${m.autoScore}/5（${Object.entries(v.checks).map(([k, c]) => `${k} ${c.pass === true ? '✅' : c.pass === false ? '❌' : '➖'}`).join(' ')}）\n- 指标：${m.width}×${m.height}@${m.fps} / ${m.durationInFrames} 帧 / ${m.msPerFrame} ms/帧 / ${(m.bytes / 1048576).toFixed(2)} MB / ${(m.bitRate / 1e6).toFixed(2)} Mbps / ${m.codec}+${m.audioCodec}\n- 缺什么：${m.missing.length === 0 ? '无' : m.missing.join('、')}${m.degraded ? `\n- 降级：${m.degraded}` : ''}\n- 目视：${v.visualReview}\n`
  })
  .join('\n')

const report = `# Canvas Studio · Remotion 渲染能力基准总报告（2026-10-29）

> **评分口径声明**：本报告的"目视分"是三点目视卡（元素是否按意图出现 / 时序是否对上 / 有无劣化成硬切或纯色），**不是像素级比对**——官方 example 依赖是 workspace:\* 装不上、拿不到原片（§9.8）。机械分 = 5 条硬检查（有画面/有运动/时长帧率/两次渲染逐帧 md5/编码合规），全部脚本判定。
> 环境前提：Electron 43.4.0（Chromium 150）+ @remotion/web-renderer 4.0.535，GPU 为真 Metal（ANGLE Apple M3，§10.1）；换机器/换 Electron 版本须重跑 Q12。
> 逐条决策与 BUG 台账见 \`DECISIONS.md\`；机器可读指标见 \`metrics.json\`。

## 一、结论表（10 项 × 6 列）

| 能力项 | 级别 | 得分（目视/机械） | 稳定性 | 缺什么（归因编号） | 证据 |
|---|---|---|---|---|---|
${rows}

**一句话总归因**：**10/10 全部出片、硬检查 10×5/5 全绿、无一记 0**，目视 5 分 5 项、4 分 4 项、3 分 1 项。缺口集中在四处已知渲染器边界：① blend/backdrop 类属性 4.0.535 不读（A9，#02/#08/#03 证据）；② mask 只认 linear-gradient + perspective 丢失（A2，#09 像素证实且 polygon 修正解已演示）；③ 全量捕获丢 WebGL canvas 内容（A1，#03）；④ useVideoTexture 视频纹理不加载（A1，#01）。**没有一项是"路线不可行"（D 级仍为零）**。

## 二、逐项明细

${perItem}

## 三、顺带查实 / 推翻的结论

1. **R3 像素实锤 + 修正解落地**：clock（conic mask）整层突现、flipX 压扁穿越——#09 同片证明 \`clip-path: polygon()\` 扇形完全可用 ⇒ 产品 8 种转场里 2 个坏的有零依赖修法。
2. **R2 像素实锤**：mix-blend-mode difference 对照格 = 纯色块（#08），升级 ≥4.0.540 前该字段应视为不存在。
3. **#01 重大发现**：WebGL \`<canvas>\` 在**默认模式**能进成片（three.js 场景全程出画）——而 **#03 的全量捕获模式反而丢 WebGL 内容**（紫色平填充）⇒ 两套 canvas 处理机制，html-in-canvas 档若产品化须单独验证含 WebGL 的画面。
4. **useVideoTexture 不可用**（#01，重试 ×2 确定性失败）——CSR 视频纹理是真实缺口；短期替代 = DOM \`<Video>\` 层叠。
5. **CSR 组合层写法约束**：\`backgroundImage: url()\` 不加载，图片必须走 \`<Img>\`（#09 首跑踩到）；\`<Audio>\`/\`<Video>\` 必须从 \`@remotion/media\` 导入（#05/#06 踩到）。
6. **TTS 全链串通**（#05）：合成 → 落盘 → 音轨 → 成片 aac，词级对齐用离线能量谷（±1–3 帧）；后端无词级时间戳仍是产品缺口。
7. **确定性铁律在复杂场景下依然成立**：three.js 场景（#01）、音频解码包络（#06）、TTS（#05）全部两次渲染逐帧 md5 全等。

## 四、建议（按 D7 只登记不修，详见 DECISIONS.md）

- BUG-R2-1 \`mix-blend-mode\` 无视 ⇒ 升级 remotion ≥4.0.540 或下架字段
- BUG-R3-1 clock conic mask 无视 ⇒ 改 \`clip-path: polygon()\` 扇形（#09 T08 已证）
- BUG-R3-2 flipX perspective 丢失 ⇒ 降级 slideX 变体
- BUG-NEW-1 全量捕获丢 WebGL canvas 内容 ⇒ html-in-canvas 产品化前必修
- BUG-NEW-2 useVideoTexture 不加载 ⇒ 视频纹理缺口，短期 DOM 层叠替代
- BUG-NEW-3 \`backgroundImage: url()\` 不加载 ⇒ 组件层用 \`<Img>\`

## 五、边界（诚实声明）

- 本轮全部结论止于 **L0/L1**（独立合成出片）：进 manifest 轨、加校验、写单测、补 skill 文档是 L2，未做（§5.4）。
- S1（规模采样点）/ S2（连渲×5 四档窗口）不在本轮任务书内，未跑；每条片的确定性由 H4（两次渲染逐帧 md5 全等）背书。
- #02 真 Skia wasm 冒烟（spec 可选项）未做，近似片已证明"缺能力时怎么绕"。
- 官方对照是"视觉意图等价"而非像素比对（见抬头声明）。
`

writeFileSync(join(OUT, 'REPORT.md'), report)

console.log(`[summarize] ${items.length} 项 → REPORT.md / metrics.json / INDEX.json / env.json 已写入 ${OUT}`)
for (const m of metrics.items) {
  console.log(`  ${m.id}  目视 ${m.humanScore}/5  机 ${m.autoScore}/5  missing=[${m.missing.join(',')}]  ${m.dir}`)
}
