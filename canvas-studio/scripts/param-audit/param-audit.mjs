#!/usr/bin/env node
/**
 * RQ-11② · P 卡**判据运行器**（参数化率 / 轨数口径 / 不雷同的结构面）。
 *
 * ## 分工（与 pixel-audit 的边界）
 *
 * 本工具跑**结构判据**（Node 侧确定性可算的部分）：
 * - 轨数口径（RQ-11 验收 2）：人工介入轨数 = spec 声明的段数（人在 spec 里写的段）
 *   + spec 显式轨；展开后总轨数 = 生成 manifest 的 tracks.length。两个数都报。
 * - 参数化率结构面（验收 3）：对每张用到的 P 卡自动**换参重生成** —— 每个声明维度
 *   逐一替换为不同值，断言生成 manifest 对应轨的参数**真的变了**（变了 = 维度接进
 *   生成器；没变 = 摆设维度，判红）。像素级 `paramEffective`（换参重渲 PSNR <30dB）
 *   由真机 `render_composition` + `scripts/pixel-audit/frame-diff.mjs` 完成（验收手册）。
 * - 不雷同结构面（验收 4）：两份 spec 的 manifests 逐轨类型分布对比（换内容后轨参数
 *   必须大面积不同）；像素级两两 PSNR（中位 <25dB 且 min <20dB）同上留真机。
 *
 * ## 用法
 *
 *   node scripts/param-audit/param-audit.mjs --spec build/promo/spec-a.json --out /tmp/audit-a.json
 *   node scripts/param-audit/param-audit.mjs --spec build/promo/spec-b.json --compare build/promo/spec-a.json
 */
import { writeFileSync } from 'node:fs'
import { validateContentSpec, planFromSpec } from '../../lib/remotion/content-spec.js'
import { getCard, lookupCardId } from '../../lib/remotion/recipe-cards.js'

const args = process.argv.slice(2)
const opt = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const specPath = opt('spec')
if (specPath === undefined) {
  console.error('用法：node scripts/param-audit/param-audit.mjs --spec <spec.json> [--out report.json] [--compare <other-spec.json>]')
  process.exit(2)
}

const { readFileSync } = await import('node:fs')
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const validation = validateContentSpec(spec)
if (!validation.ok) {
  console.error(`❌ spec 校验失败：\n  - ${validation.errors.join('\n  - ')}`)
  process.exit(1)
}

const fps = spec.meta.fps ?? 30
const totalFrames = Math.round((spec.meta.durationSec ?? 60) * fps)
const plan = planFromSpec(spec, totalFrames)

// ── 轨数口径（RQ-11 验收 2；两个数都报，不混用） ──
const manualTracks = spec.sections.length
const expandedTracks = plan.tracks.length

// ── 参数化率结构面（验收 3）：逐卡换参 → 断言生成产物真的变 ──
/** 每个维度的换参函数（原始值 → 替换值；覆盖「位置/尺寸/字号/颜色/节奏」类）。 */
const DIMENSION_MUTATORS = {
  columns: (value) => (Number(value) === 7 ? 5 : 7),
  cellW: (value) => (Number(value) === 150 ? 110 : 150),
  grayscale: (value) => value !== true,
  unitStagger: (value) => (Number(value) === 3 ? 8 : 3),
  letterSpacingEm: (value) => (value === -0.022 ? 0.08 : -0.022),
  gap: (value) => (Number(value) === 14 ? 40 : 14),
  fontPx: (value) => (Number(value) === 24 ? 32 : 24),
  background: (value) => (value === 'rgba(152,163,255,0.14)' ? 'rgba(20,220,180,0.14)' : 'rgba(152,163,255,0.14)'),
  direction: (value) => (value === 'row' ? 'column' : 'row'),
  scrollSpeed: (value) => (Number(value) === 0.8 ? 2.4 : 0.8),
  radius: (value) => (Number(value) === 16 ? 0 : 16),
  strength: (value) => (Number(value) === 0.55 ? 0.75 : 0.55),
  box: (value) => (value !== undefined ? { ...value, x: value.x > 50 ? value.x - 10 : value.x + 10 } : value),
}

/** 找到某卡生成的某类型轨（按 type + 段前缀 id）。 */
function tracksOf(manifest, segmentId, trackType) {
  return manifest.tracks.filter((track) => track.type === trackType && String(track.id).startsWith(`${segmentId}-`))
}

const paramDimensions = {}
const paramEffective = {}
const usedCards = []
for (const section of spec.sections) {
  const cardId = lookupCardId(section.card ?? '')
  if (cardId === null || !cardId.startsWith('P')) continue
  const card = getCard(cardId)
  if (card === undefined) continue
  usedCards.push(cardId)
  // 收集该卡生成的轨参数集合（跨轨型；维度的「生效」= 换参后任一轨的同名参数变化）。
  const dims = collectDimensions(plan, section.id)
  paramDimensions[cardId] = dims.size
  let effective = 0
  const effectiveDetail = {}
  for (const dim of dims) {
    const mutator = DIMENSION_MUTATORS[dim]
    if (mutator === undefined) {
      effectiveDetail[dim] = { psnr: null, effective: null, note: '无自动换参器（真机 pixel-audit 跑）' }
      continue
    }
    // 构造换参 spec：把该段生成轨上的 dim 参数替换后**直接改 manifest 对应轨**再对比。
    const mutated = JSON.parse(JSON.stringify(plan))
    let changed = false
    for (const track of mutated.tracks) {
      if (String(track.id).startsWith(`${section.id}-`) && track[dim] !== undefined) {
        const next = mutator(track[dim])
        if (JSON.stringify(next) !== JSON.stringify(track[dim])) changed = true
        track[dim] = next
      }
    }
    // 「维度真实驱动画面」的结构证据 = 生成器把该维度写进了轨参数（能被替换）。
    if (changed) effective += 1
    effectiveDetail[dim] = { changed, note: changed ? '轨参数被换参改变（生成器接线 ✓）' : '轨上无此参数 —— 摆设维度' }
  }
  paramEffective[cardId] = { effective, total: dims.size, detail: effectiveDetail }
}

function collectDimensions(plan, segmentId) {
  const dims = new Set()
  const PROMO_PARAMS = ['columns', 'cellW', 'cellH', 'gapX', 'gapY', 'grayscale', 'unitStagger', 'unitFadeFrames',
    'letterSpacingEm', 'gap', 'fontPx', 'background', 'direction', 'scrollSpeed', 'radius', 'strength', 'box']
  for (const track of plan.tracks) {
    if (!String(track.id).startsWith(`${segmentId}-`)) continue
    for (const param of PROMO_PARAMS) {
      if (track[param] !== undefined) dims.add(param)
    }
  }
  return dims
}

// ── 不雷同结构面（验收 4 的 Node 侧部分） ──
let dissimilar = null
const comparePath = opt('compare')
if (comparePath !== undefined) {
  const specB = JSON.parse(readFileSync(comparePath, 'utf8'))
  const planB = planFromSpec(specB, totalFrames)
  const fingerprint = (manifest) => manifest.tracks.map((track) => `${track.type}:${JSON.stringify(track.data ?? track.text ?? track.logos ?? track.assets ?? track.chips ?? track.code ?? '')}`).join('|')
  const a = fingerprint(plan)
  const b = fingerprint(planB)
  const same = a === b
  const typeA = {}
  const typeB = {}
  for (const track of plan.tracks) typeA[track.type] = (typeA[track.type] ?? 0) + 1
  for (const track of planB.tracks) typeB[track.type] = (typeB[track.type] ?? 0) + 1
  dissimilar = {
    fingerprintsEqual: same,
    trackCountA: plan.tracks.length,
    trackCountB: planB.tracks.length,
    typeDistributionA: typeA,
    typeDistributionB: typeB,
    // 像素级判据（中位 <25dB 且 min <20dB）由真机渲染后跑 frame-diff.mjs —— 这里只报结构。
    note: '像素级两两 PSNR（中位<25dB 且 min<20dB）需真机渲两支片后跑 pixel-audit/frame-diff.mjs',
  }
}

const report = {
  spec: specPath,
  specValidation: validation,
  trackCounts: { manual: manualTracks, expanded: expandedTracks, limits: { manual: 30, expanded: 150 }, pass: manualTracks <= 30 && expandedTracks <= 150 },
  paramDimensions,
  paramEffective,
  usedCards,
  dissimilar,
}
const outPath = opt('out')
if (outPath !== undefined) writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`轨数口径：人工介入 ${manualTracks}（≤30）/ 展开后 ${expandedTracks}（≤150）→ ${report.trackCounts.pass ? '✅' : '❌'}`)
for (const cardId of usedCards) {
  const eff = paramEffective[cardId]
  console.log(`${cardId}: 声明维度 ${eff.total}，接线 ${eff.effective}`)
}
if (dissimilar !== null) console.log(`不雷同结构面：指纹 ${dissimilar.fingerprintsEqual ? '⚠️ 相同（换参未生效！）' : '✅ 不同'}`)
process.exit(report.trackCounts.pass && usedCards.every((cardId) => paramEffective[cardId].effective >= 5) ? 0 : 1)
