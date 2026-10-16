/**
 * 只读探针（不联网 / 不写产品数据 / 不调后端）：把「30 秒太阳系科普 · 纯代码合成」的
 * 三种 manifest 拿**仓里的真校验器与真风险评分**跑一遍，用于 REQ-034 的流程推演取证。
 *
 * 用法：node scripts/probe-solar-manifest.mjs
 * 依赖：canvas-studio/lib/**（由 `yarn build` 的 tsc 步骤 emit，勿只跑 tsdown）
 */
import { validateManifest, deriveAudioComposition, collectManifestSourceIds } from '../lib/remotion/manifest.js'
import { scoreSlideshowRisk } from '../lib/remotion/slideshow-risk.js'
import { deriveSubtitleTiming, fadeOpacity, reconcileManifestVideoDurations } from '../lib/remotion/timing.js'

const FPS = 30
const TOTAL_SEC = 30
const TOTAL = TOTAL_SEC * FPS

/** 旁白稿（中文；字数决定每句时长占比）。 */
const NARRATION = [
  '太阳系有八颗行星，全都绕太阳运行',
  '太阳独自占据整个太阳系九成九以上的质量',
  '从内到外依次是水星金星地球火星木星土星天王星和海王星',
  '木星最大，直径约是地球的十一倍',
  '土星拥有一圈壮观的环',
  '火星上矗立着太阳系最高的火山',
  '月球是地球唯一的天然卫星',
]

const line = (ch = '─') => console.log(ch.repeat(78))
const head = (t) => { console.log(); line('━'); console.log(t); line('━') }

/** 报告一份 manifest 的真校验 + 真风险评分结论。 */
function report(label, manifest) {
  head(label)
  const v = validateManifest(manifest)
  console.log(`validateManifest : ok=${String(v.ok)}  errors=${v.errors.length}  warnings=${v.warnings.length}`)
  for (const e of v.errors) console.log(`  ✗ ${e}`)
  for (const w of v.warnings) console.log(`  ⚠ ${w}`)
  const risk = scoreSlideshowRisk(manifest)
  console.log(`幻灯片风险分     : ${risk.score} (阈值 60)${risk.warning === undefined ? '  —— 不告警' : '  —— 告警'}`)
  for (const d of risk.dims) console.log(`  ${d.hit ? '●' : '○'} ${d.name.padEnd(6)} 权重 ${String(d.weight).padStart(2)}  ${d.note}`)
  if (risk.warning !== undefined) console.log(`  告警原文：${risk.warning}`)
  console.log(`音轨角标         : ${deriveAudioComposition(manifest)}`)
  console.log(`血缘 sourceIds   : [${collectManifestSourceIds(manifest).join(', ')}]`)
  return { validate: v, risk }
}

// ───────────────────────── 0. 字幕时序派生（句级，无 TTS 时间戳） ─────────────────────────
head('0. deriveSubtitleTiming（旁白真值 30.0s @30fps）')
const t = deriveSubtitleTiming({ sentences: NARRATION, fps: FPS, voiceOverDurationSec: TOTAL_SEC })
console.log(`总字数 ${[...NARRATION.join('')].length} 字 / 总帧 ${t.totalFrames} / 走估算? ${String(t.estimated)}`)
console.log('  start  dur  end   句')
let prevEnd = null
for (const c of t.cues) {
  const end = c.startFrame + c.durationInFrames
  const gap = prevEnd === null ? '' : `   ← 与前句空档 ${String(c.startFrame - prevEnd)} 帧`
  console.log(`  ${String(c.startFrame).padStart(5)} ${String(c.durationInFrames).padStart(4)} ${String(end).padStart(5)}${gap}`)
  prevEnd = end
}

/**
 * 按 `deriveSubtitleTiming` 的边界铺卡。
 *
 * 2026-10-16 修复后：cue 的 `durationInFrames` **已经是屏上时长**（延伸到下一句
 * `startFrame`，末句到总帧）—— 本探针 §0 逐句打印的「与前句空档」现在全为 **0 帧**。
 * 修复前这里是两套（字面版留空档 + 手工 sealed 版吃空档），现已合并为一套：
 * 按派生结果照字面铺卡即得零空档排布。
 */
const cardTracks = t.cues.map((c, i) => ({
  type: 'textCard', id: `sub-${i}`, variant: 'subtitle', text: c.text,
  startFrame: c.startFrame, durationInFrames: c.durationInFrames,
}))

// ───────────────────────── 1. 边界空帧取证（无转场轨时的裸背景闪） ─────────────────────────
head('1. 边界空帧取证：第 0/1 句交界处逐帧不透明度（修复前 vs 修复后）')
const b0 = cardTracks[0]
const b1 = cardTracks[1]
console.log(`  句0 [${b0.startFrame}, ${b0.startFrame + b0.durationInFrames})  句1 [${b1.startFrame}, ${b1.startFrame + b1.durationInFrames})`)
const cut = b1.startFrame
console.log('  —— 修复前（该 bug 的成因复现）：字面版留呼吸空档 + 每卡默认 fade 6 帧')
for (let f = cut - 8; f <= cut + 8; f += 2) {
  const a = fadeOpacity(f - b0.startFrame, b0.durationInFrames)
  const b = fadeOpacity(f - b1.startFrame, b1.durationInFrames)
  const sum = (a + b).toFixed(2)
  console.log(`  frame ${String(f).padStart(4)}  句0 α=${a.toFixed(2)}  句1 α=${b.toFixed(2)}  叠合不透明度=${sum}${Number(sum) < 0.9 ? '   ← 露出背景' : ''}`)
}
console.log('  —— 修复后（现行组件行为）：卡首尾相接 + subtitle 硬切（fade 0 帧）')
for (let f = cut - 8; f <= cut + 8; f += 2) {
  const a = fadeOpacity(f - b0.startFrame, b0.durationInFrames, 0)
  const b = fadeOpacity(f - b1.startFrame, b1.durationInFrames, 0)
  const sum = (a + b).toFixed(2)
  console.log(`  frame ${String(f).padStart(4)}  句0 α=${a.toFixed(2)}  句1 α=${b.toFixed(2)}  叠合不透明度=${sum}${Number(sum) < 0.9 ? '   ← 露出背景' : ''}`)
}

// ───────────────────────── 2. 三种方案 ─────────────────────────
const META = { title: '太阳系速览', width: 1280, height: 720, fps: FPS, durationInFrames: TOTAL, backgroundColor: '#0B1020' }

// S1 朴素：卡首尾相接、无转场轨、只有一条底色 gradient
const s1 = {
  id: 'solar-s1', meta: META,
  tracks: [
    { type: 'shape', id: 'bg', shape: 'gradient', color: '#111C3A', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: TOTAL },
    ...cardTracks,
  ],
  audio: { voiceOverUrl: '/canvas-studio/assets/p1/vo.mp3', bgmUrl: '/canvas-studio/assets/p1/bgm.mp3', mix: { bgmVolume: 0.35, voiceVolume: 1 } },
  global: { fontFamily: 'Noto Sans SC', theme: 'dark' },
}
report('2. 方案 S1 —— 纯代码：顺序铺卡 + 无转场轨（「最短代码」路线）', s1)

// S2 打磨：卡轻微重叠 8 帧 + 4 种转场轮换
const OVERLAP = 8
const mixedTracks = cardTracks.map((tr, i) => ({
  ...tr,
  startFrame: i === 0 ? 0 : tr.startFrame - OVERLAP,
  durationInFrames: tr.durationInFrames + (i === 0 ? 0 : OVERLAP),
}))
const eff = ['fade', 'slide', 'zoom', 'dissolve']
const transitions = mixedTracks.slice(0, -1).map((tr, i) => {
  const next = mixedTracks[i + 1]
  return {
    type: 'transition', id: `tr-${i}`, effect: eff[i % eff.length],
    fromTrackId: tr.id, toTrackId: next.id,
    startFrame: next.startFrame, durationInFrames: OVERLAP + 4,
  }
})
const s2 = {
  id: 'solar-s2', meta: META,
  tracks: [
    { type: 'shape', id: 'bg', shape: 'gradient', color: '#111C3A', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: TOTAL },
    ...mixedTracks.map((tr, i) => (i % 3 === 1
      ? { ...tr, variant: 'bullets', text: tr.text.length > 12 ? [tr.text.slice(0, 8), tr.text.slice(8)] : [tr.text] }
      : tr)),
    ...transitions,
    { type: 'textCard', id: 'ring', variant: 'dataCard', text: '太阳系主要成员', data: [{ k: '太阳质量占比', v: '99.86%' }, { k: '行星数量', v: '8' }], startFrame: TOTAL - 200, durationInFrames: 120 },
  ],
  audio: { voiceOverUrl: '/canvas-studio/assets/p1/vo.mp3', bgmUrl: '/canvas-studio/assets/p1/bgm.mp3', mix: { bgmVolume: 0.35, voiceVolume: 1 } },
  global: { fontFamily: 'Noto Sans SC', theme: 'dark' },
}
report('3. 方案 S2 —— 纯代码：卡重叠 8 帧 + fade/slide/zoom/dissolve 轮换 + 数据卡', s2)

/**
 * ⚠️ 组装陷阱取证：素材轨的 `id` **必须**填该素材的画布节点 id（血缘据此生成），
 * 于是「把一张 textCard 换成 image 轨」并不是改一个 type —— **所有引用它的
 * transition 的 from/to 都要同步改名**，否则 `validateManifest` 直接报
 * 「引用了不存在的轨道」。下面按真实做法做一次 id 重映射。
 */
function swapTracks(tracks, idMap, make) {
  return tracks.map((tr) => {
    if (tr.type === 'transition') {
      return { ...tr, fromTrackId: idMap[tr.fromTrackId] ?? tr.fromTrackId, toTrackId: idMap[tr.toTrackId] ?? tr.toTrackId }
    }
    return make(tr) ?? tr
  })
}

// S3 上限：把两个要点换成静态图（KenBurns）—— 仍然 0 次视频模型调用
const imgMap = { 'sub-2': 'n-7c41a2e0', 'sub-4': 'n-5b90ff13' }
const s3 = {
  id: 'solar-s3', meta: META,
  tracks: swapTracks(s2.tracks, imgMap, (tr) => {
    if (tr.id === 'sub-2') return { type: 'image', id: 'n-7c41a2e0', src: '/canvas-studio/assets/p1/planets.png', startFrame: tr.startFrame, durationInFrames: tr.durationInFrames, fit: 'kenburns', caption: '从内到外八颗行星' }
    if (tr.id === 'sub-4') return { type: 'image', id: 'n-5b90ff13', src: '/canvas-studio/assets/p1/saturn.png', startFrame: tr.startFrame, durationInFrames: tr.durationInFrames, fit: 'kenburns', caption: '土星环' }
    return null
  }),
  audio: s2.audio,
  global: s2.global,
}
report('4. 方案 S3 —— 代码 + 静态图（KenBurns）：仍 0 次视频模型调用', s3)

// ───────────────────────── 5. 对照：有真视频轨时风险分怎么变 ─────────────────────────
head('5. 对照 S4 —— 把 S3 的首卡换成 1 条真视频轨（仅 3 秒 / 10%）')
const s4 = {
  id: 'solar-s4', meta: META,
  tracks: swapTracks(s3.tracks, { 'sub-0': 'n-aa11bb22' }, (tr) => (
    tr.id === 'sub-0'
      ? { type: 'video', id: 'n-aa11bb22', src: '/canvas-studio/assets/p1/clip.mp4', startFrame: tr.startFrame, durationInFrames: tr.durationInFrames }
      : null
  )),
  audio: s3.audio, global: s3.global,
}
report('5. 对照 S4 —— 含 1 条 ~4.2 秒视频轨（占 14%）', s4)

// ───────────────────────── 6. 宿主校正 vs 校验的先后顺序（真问题） ─────────────────────────
head('6. 顺序取证：宿主「按真值校正 video 时长」发生在 validateManifest **之后**')
console.log('  场景：模型声明 video 轨 125 帧（4.17s，为了与相邻卡的转场窗口重叠），')
console.log('        但素材真值只有 3.0s（90 帧）→ 宿主 reconcile 会把它改成 90 帧。')
const declared = 125
const reconciled = reconcileManifestVideoDurations(s4, { '/canvas-studio/assets/p1/clip.mp4': 3.0 }, FPS)
console.log(`  reconcile 前 video 轨时长：${declared} 帧`)
console.log(`  reconcile 后 video 轨时长：${reconciled.tracks.find((x) => x.type === 'video').durationInFrames} 帧`)
console.log(`  reconcile warnings：${reconciled.warnings.join(' / ') || '（无）'}`)
const afterFix = { ...s4, tracks: reconciled.tracks }
const vAfter = validateManifest(afterFix)
console.log(`  用**校正后**的轨道重跑 validateManifest：ok=${String(vAfter.ok)}`)
for (const e of vAfter.errors) console.log(`    ✗ ${e}`)
console.log('  ⇒ 校验放行发生在校正**之前**；2026-10-16 修复：宿主在 reconcile 之后对')
console.log('    `renderManifest` **复校**，此处 ok=false 会连同校正明细一起 CS-USER-ERR 拒收，')
console.log('    不再静默进渲染（报错文案会点名「按素材真值校正时长后不再自洽」）。')

// ───────────────────────── 7. 阈值反推 ─────────────────────────
head('7. 阈值反推 —— 要把风险分压到 60 以下，视频轨要满足什么')
console.log('  三个必清维度（30s / 900 帧为例）：')
console.log('  ① 静态占比 ≤70%  → 非 image/textCard 的时长 ≥ 270 帧（9.0s）')
console.log('  ② 运动密度 ≥20%  → video 轨合计时长 ≥ 180 帧（6.0s）')
console.log('  ③ 镜头数   ≥3 条 → video 轨至少 3 条（<60s 档）')
console.log('  ⇒ 现实门槛：video 轨 ≥3 条、合计 ≥270 帧（9s）——即 30s 里让出 30% 给视频。')
