#!/usr/bin/env node
/**
 * RQ-16（REQ-038）· **预生成资产流水线**（参数化入口）。
 *
 * ## 解决什么（需求正本 §3 RQ-16）
 *
 * playsout 的 26 张预生成 PNG 全部出自 `stage-assets.mjs` 私有函数 —— 不可复用、
 * 不可继承、每次重造。本入口把**通用件**（`playsout-replica/lib/png.mjs` 的
 * createCanvas / encodePng）+ **自带自检**（pixel-audit 的 alpha 剖面断言，RQ-14）
 * 收成一个参数化 CLI：其他体裁直接 `--kind <recipe>` 出图，不需要再复制私有函数。
 *
 * ## recipe 清单（首批；都是 playsout 实测过的参数形态）
 *
 * | kind | 参数 | 自检 |
 * | --- | --- | --- |
 * | `scrim` | --from bottom|top --band N --color #xxx --peak 0.9 --mid 0.55 --midAt 0.46 | 带外零 + 峰值窗口 |
 * | `vignette` | --strength 0.55 | 径向中心透明(lowWindow) |
 * | `glow` | --color rgba() --radius-x 60 --radius-y 50 | 全幅（无带外断言） |
 * | `scrim-top-bottom` | --top-peak --top-end --bottom-start --bottom-peak --color | 双带窗口 + 中段透明 |
 *
 * ## 用法
 *
 *   node scripts/asset-pipeline/generate.mjs --kind scrim --out build/assets/scrim-hero.png \
 *     --from bottom --band 300 --color "#05080f" --peak 0.9
 *
 * 出图后自动跑 alpha 剖面断言（不合格**拒绝写盘**）；`--manifest out/assets.json`
 * 追加一条 {file, kind, params, sha256} 清单（素材 URL 清单 = RQ-16 验收面）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCanvas, encodePng, hexToRgb } from '../playsout-replica/lib/png.mjs'
import { decodePng, alphaProfile, assertAlphaProfile } from '../pixel-audit/lib/png.mjs'

const W = 1920
const H = 1080

const args = process.argv.slice(2)
const opt = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const num = (name, fallback) => {
  const raw = opt(name)
  return raw === undefined ? fallback : Number(raw)
}

const kind = opt('kind')
const out = opt('out')
if (kind === undefined || out === undefined) {
  console.error('用法：node scripts/asset-pipeline/generate.mjs --kind scrim|vignette|glow|scrim-top-bottom --out build/assets/x.png [--manifest assets.json] [参数…]')
  process.exit(2)
}

const clamp01 = (value) => Math.max(0, Math.min(1, value))

/** 各 recipe 的渲染器（与 stage-assets.mjs 同公式；此处按参数重入）。 */
const RENDERERS = {
  scrim: () => {
    const from = opt('from') ?? 'bottom'
    const band = num('band', 300)
    const [r, g, b] = hexToRgb(opt('color') ?? '#05080f')
    const peak = num('peak', 0.9)
    const mid = num('mid', 0.55)
    const midAt = num('midAt', 0.46)
    const { data } = createCanvas(W, H, (x, y) => {
      const d = from === 'bottom' ? H - 1 - y : y
      if (d >= band) return [r, g, b, 0]
      const t = d / band
      const a = t <= midAt ? peak + (mid - peak) * (t / midAt) : mid * (1 - (t - midAt) / (1 - midAt))
      return [r, g, b, Math.round(clamp01(a) * 255)]
    })
    return {
      png: encodePng(W, H, data),
      check: {
        topBand: from === 'bottom' ? H - band : 0,
        bottomBand: from === 'top' ? H - band : 0,
        peakFrom: from === 'bottom' ? 0.9 : 0,
        peakTo: from === 'bottom' ? 1 : 0.1,
      },
      label: `scrim-${from}-${band}`,
    }
  },
  vignette: () => {
    const strength = num('strength', 0.55)
    const { data } = createCanvas(W, H, (x, y) => {
      const dx = (x - 0.5 * W) / (1.18 * W)
      const dy = (y - 0.44 * H) / (0.88 * H)
      const d = Math.sqrt(dx * dx + dy * dy)
      const a = d <= 0.38 ? 0 : strength * ((d - 0.38) / (1 - 0.38))
      return [0, 0, 0, Math.round(clamp01(a) * 255)]
    })
    return {
      png: encodePng(W, H, data),
      // 行剖面峰值在**底边中点**（椭圆中心 44% 高 ⇒ 底边距中心更近）：alpha ≈ 0.48×strength。
      // 实测 0.55 → 67.8/255。下限取 0.4×strength（留素材粒度余量）。
      check: { outOfBandZero: false, lowWindow: { from: 0.34, to: 0.54, maxAlpha: 12 }, peakMinAlpha: Math.round(strength * 255 * 0.4) },
      label: `vignette-${strength}`,
    }
  },
  glow: () => {
    const [r, g, b] = hexToRgb(opt('color') ?? '#4f9cf9')
    const alpha = num('alpha', 0.2)
    const rx = num('radius-x', 60) / 100
    const ry = num('radius-y', 50) / 100
    const { data } = createCanvas(W, H, (x, y) => {
      const dx = (x - W * 0.5) / (rx * W)
      const dy = (y - H * 0.44) / (ry * H)
      const d = Math.sqrt(dx * dx + dy * dy)
      const a = (1 - clamp01(d)) * alpha
      return [r, g, b, Math.round(clamp01(a) * 255)]
    })
    return { png: encodePng(W, H, data), check: { outOfBandZero: false, peakMinAlpha: Math.round(alpha * 255 * 0.5), peakFrom: 0.3, peakTo: 0.6 }, label: 'glow' }
  },
  'scrim-top-bottom': () => {
    const topPeak = num('top-peak', 0.92)
    const topEnd = num('top-end', 0.26)
    const bottomStart = num('bottom-start', 0.74)
    const bottomPeak = num('bottom-peak', 0.92)
    const [r, g, b] = hexToRgb(opt('color') ?? '#05080f')
    const { data } = createCanvas(W, H, (x, y) => {
      const p = y / (H - 1)
      let a = 0
      if (p <= topEnd) a = topPeak * (1 - p / topEnd)
      else if (p >= bottomStart) a = bottomPeak * ((p - bottomStart) / (1 - bottomStart))
      return [r, g, b, Math.round(clamp01(a) * 255)]
    })
    return {
      png: encodePng(W, H, data),
      check: { peakFrom: 0, peakTo: 0.15, lowWindow: { from: topEnd + 0.05, to: bottomStart - 0.05, maxAlpha: 20 } },
      label: 'scrim-top-bottom',
    }
  },
}

const renderer = RENDERERS[kind]
if (renderer === undefined) {
  console.error(`未知 kind：${kind}（可用：${Object.keys(RENDERERS).join(' / ')}）`)
  process.exit(2)
}
const { png, check, label } = renderer()

// RQ-14：出图即自检 —— 不合格**拒绝写盘**（资产阶段红，不是渲染后才发现）。
const audit = assertAlphaProfile(alphaProfile(decodePng(png)), check)
if (!audit.ok) {
  console.error(`❌ [资产自检 RQ-14] ${label} alpha 剖面不合格（拒绝出图）：`)
  for (const reason of audit.reasons) console.error(`  - ${reason}`)
  process.exit(1)
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
const manifestPath = opt('manifest')
if (manifestPath !== undefined) {
  // 参数回执：完整 argv 扫描（--k v / --flag 两种形态），排除控制项。
  const params = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    if (['kind', 'out', 'manifest'].includes(name)) continue
    const next = args[i + 1]
    params[name] = next !== undefined && !next.startsWith('--') ? next : true
  }
  const entry = {
    file: out,
    kind,
    params,
    sha256: createHash('sha256').update(png).digest('hex'),
    bytes: png.length,
  }
  const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { assets: [] }
  existing.assets = (existing.assets ?? []).filter((item) => item.file !== out).concat(entry)
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(existing, null, 2))
  appendFileSync('/dev/null', '')
}
console.log(`✅ ${label} → ${out}（${(png.length / 1024).toFixed(1)}KB，自检过；峰值行 ${audit.peakRow}/${audit.height}）`)
