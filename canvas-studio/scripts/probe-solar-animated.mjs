/**
 * 只读探针（不联网 / 不写产品数据）：实测「Remotion 程序化动画到底能否救活 PPT 观感」。
 * 用仓里真校验器 + 真风险评分跑两种 manifest：
 *   S5a：纯 Remotion 程序化动画（公转太阳 shape+animate + 行星 KenBurns + 字幕滑入 + 转场），0 次视频模型调用
 *   S5b：S5a 基础上把 3 张行星卡换成真实 video 轨（占位 src，仅验证评分口径）
 * 结论：S5a 合法且视觉能动，但风险分仍 ≥60（scorer 不认程序化动画）；S5b 因有 video 轨才压到阈值下。
 *
 * 用法：node scripts/probe-solar-animated.mjs
 * 依赖：canvas-studio/lib/**（tcsc emit）
 */
import { validateManifest, deriveAudioComposition, collectManifestSourceIds } from '../lib/remotion/manifest.js'
import { scoreSlideshowRisk } from '../lib/remotion/slideshow-risk.js'

const FPS = 30
const TOTAL = 30 * FPS
const META = { title: '太阳系速览(动画)', width: 1280, height: 720, fps: FPS, durationInFrames: TOTAL, backgroundColor: '#0B1020' }
const AUDIO = { voiceOverUrl: '/canvas-studio/assets/p1/vo.mp3', bgmUrl: '/canvas-studio/assets/p1/bgm.mp3', mix: { bgmVolume: 0.35, voiceVolume: 1 } }
const GLOBAL = { fontFamily: 'Noto Sans SC', theme: 'dark' }

const line = (ch = '─') => console.log(ch.repeat(78))
const head = (t) => { console.log(); line('━'); console.log(t); line('━') }

// 7 句旁白 → 7 张字幕卡（屏上时长，首尾相接）
const NARRATION = [
  '太阳系有八颗行星，全都绕太阳运行', '太阳独自占据整个太阳系九成九以上的质量',
  '从内到外依次是水星金星地球火星木星土星天王星和海王星', '木星最大，直径约是地球的十一倍',
  '土星拥有一圈壮观的环', '火星上矗立着太阳系最高的火山', '月球是地球唯一的天然卫星',
]
const cues = [
  [0,129],[129,152],[281,207],[488,122],[610,82],[692,114],[806,94],
].map(([s,d],i)=>({ id:`sub-${i}`, text:NARRATION[i], startFrame:s, durationInFrames:d }))

const report = (label, manifest) => {
  head(label)
  const v = validateManifest(manifest)
  console.log(`validateManifest : ok=${String(v.ok)}  errors=${v.errors.length}  warnings=${v.warnings.length}`)
  for (const e of v.errors) console.log(`  ✗ ${e}`)
  for (const w of v.warnings) console.log(`  ⚠ ${w}`)
  const r = scoreSlideshowRisk(manifest)
  console.log(`风险分           : ${r.score} (阈值 60)  kind=${r.kind}${r.warning ? '  —— 仍告警' : '  —— 通过'}`)
  for (const d of r.dims) console.log(`  ${d.hit ? '●' : '○'} ${d.name.padEnd(6)} 权重 ${String(d.weight).padStart(2)}  ${d.note}`)
  console.log(`音轨角标         : ${deriveAudioComposition(manifest)}`)
  console.log(`血缘 sourceIds   : [${collectManifestSourceIds(manifest).join(', ')}]`)
}

// 公转太阳：shape(circle) + 多段线性 rotate（manifest-contract §100 套路）
// ⚠️ animate 的 startFrame/durationInFrames 必须整数帧（校验器硬约束），故用 6 段 ×150 帧（900/6）。
function orbitalSun() {
  const segs = []
  for (let i = 0; i < 6; i++) {
    segs.push({ from: { rotation: i * 60 }, to: { rotation: (i + 1) * 60 }, startFrame: i * 150, durationInFrames: 150, easing: 'linear' })
  }
  return { type: 'shape', id: 'sun', shape: 'circle', color: '#F6C445', box: { x: 50, y: 50, w: 16, h: 16 }, startFrame: 0, durationInFrames: TOTAL, animate: segs }
}

const slideIn = { from: { x: 115, opacity: 0 }, to: { x: 50, opacity: 1 }, durationInFrames: 18, easing: 'easeOut' }

// S5a：纯 Remotion 程序化动画，0 次视频模型调用
const s5a = {
  id: 'solar-s5a', meta: META, global: GLOBAL, audio: AUDIO,
  tracks: [
    { type: 'shape', id: 'bg', shape: 'gradient', color: '#111C3A', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: TOTAL },
    orbitalSun(),
    ...[0,1,2,3,4].map((i) => ({
      type: 'image', id: `img-${i}`, src: `/canvas-studio/assets/p1/p${i}.png`,
      startFrame: i * 180, durationInFrames: 150, fit: 'kenburns', animate: slideIn,
    })),
    ...cues.map((c) => ({ ...c, type: 'textCard', variant: 'subtitle', animate: slideIn })),
  ],
}
// 转场（字幕卡之间）
s5a.tracks.push(
  ...cues.slice(0, -1).map((c, i) => ({
    type: 'transition', id: `tr-${i}`, effect: ['fade','slide','zoom','dissolve'][i % 4],
    fromTrackId: `sub-${i}`, toTrackId: `sub-${i+1}`, startFrame: c.startFrame + c.durationInFrames - 10, durationInFrames: 14,
  })),
)
report('S5a —— 纯 Remotion 程序化动画：公转太阳 + 行星 KenBurns + 字幕滑入 + 4 种转场（0 次视频模型调用）', s5a)

// S5b：把其中 3 张行星卡换成 video 轨（占位 src，仅验证评分口径）
const vidIds = ['v0','v1','v2']
const s5b = {
  id: 'solar-s5b', meta: META, global: GLOBAL, audio: AUDIO,
  tracks: [
    { type: 'shape', id: 'bg', shape: 'gradient', color: '#111C3A', box: { x: 50, y: 50, w: 100, h: 100 }, startFrame: 0, durationInFrames: TOTAL },
    orbitalSun(),
    ...[0,1,2,3,4].map((i) => i < 3
      ? { type: 'video', id: vidIds[i], src: `/canvas-studio/assets/p1/clip${i}.mp4`, startFrame: i * 180, durationInFrames: 150 }
      : { type: 'image', id: `img-${i}`, src: `/canvas-studio/assets/p1/p${i}.png`, startFrame: i * 180, durationInFrames: 150, fit: 'kenburns', animate: slideIn }),
    ...cues.map((c) => ({ ...c, type: 'textCard', variant: 'subtitle', animate: slideIn })),
    ...cues.slice(0, -1).map((c, i) => ({
      type: 'transition', id: `tr-${i}`, effect: ['fade','slide','zoom','dissolve'][i % 4],
      fromTrackId: `sub-${i}`, toTrackId: `sub-${i+1}`, startFrame: c.startFrame + c.durationInFrames - 10, durationInFrames: 14,
    })),
  ],
}
report('S5b —— S5a + 3 条 video 轨（占位）：验证「只有 video 轨才压分」', s5b)
