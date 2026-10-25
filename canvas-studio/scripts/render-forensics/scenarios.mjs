/**
 * 渲染取证台 · 场景矩阵（纯函数，无 IO 副作用以外的依赖）
 *
 * 每个场景回答一个**会话里没有定论的问题**。矩阵故意做成"单变量"：
 * 同一组里只改一个维度，否则不能归因。
 *
 * 归因目标：**同样是 Remotion + 同一台机器**，差异只可能来自
 *   ① Remotion 能力边界  ② 产品调用参数  ③ 窗口/进程环境  ④ manifest 内容
 */
import { readFileSync } from 'node:fs'
import { REAL_ASSETS, PROJECT_ASSET_PREFIX } from './fixtures.mjs'
import * as cardsMod from './cards.mjs'
export { REAL_ASSETS, PROJECT_ASSET_PREFIX } from './fixtures.mjs'
import { dirname, join } from 'node:path'

const REAL_MANIFEST_HINT = '/Users/lilixian/.videobuddy/canvas-studio/projects/使用技能「代码驱动科普成片」（code- 2/build/manifest.json'

export const DEFAULT_REAL_MANIFEST = process.env.RF_MANIFEST ?? REAL_MANIFEST_HINT

/** 会话里 agent 手搓出来的中间产物目录（48 份 manifest，含所有"超时刺客"）。 */
export const REAL_BUILD_DIR = process.env.RF_BUILD_DIR ?? dirname(DEFAULT_REAL_MANIFEST)

/* ─────────────────────────── manifest 工具 ─────────────────────────── */

export function meta(frames, extra = {}) {
  return { title: 'fornsics', width: 1280, height: 720, fps: 30, durationInFrames: frames, backgroundColor: '#06080B', ...extra }
}

/**
 * 合成 n 条"会动的形状轨"——刻意不带任何素材，用来隔离"轨道数"这一个变量。
 * 每条轨做与真实产物同量级的逐帧变换（x 位移 + 透明度呼吸）。
 */
export function synthManifest(nTracks, frames) {
  const tracks = []
  const half = Math.max(1, Math.floor(frames / 2))
  const rest = Math.max(1, frames - half - 1)
  for (let i = 0; i < nTracks; i++) {
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = 12 + col * 22
    const y = 14 + (row % 5) * 15
    tracks.push({
      id: `t${String(i).padStart(2, '0')}`,
      type: 'shape',
      shape: 'rect',
      color: ['#1b2b44', '#24405f', '#2d5175', '#37628b'][col],
      box: { x, y, w: 18, h: 10 },
      startFrame: 0,
      durationInFrames: frames,
      fadeFrames: 0,
      // 与真实产物同量级的逐帧变换：位移 + 透明度，逼着渲染器每帧重算样式
      animate: [
        { startFrame: 0, durationInFrames: half, from: { x, opacity: 0.35 }, to: { x: x + 6, opacity: 0.9 } },
        { startFrame: half, durationInFrames: rest, from: { x: x + 6, opacity: 0.9 }, to: { x, opacity: 0.35 } },
      ],
    })
  }
  return { id: 'fornsics', meta: meta(frames), tracks }
}

/**
 * 从真实 manifest 派生子集：只保留 [0, frames) 内开始的轨，并把边界裁整齐。
 * 三条规则都是从校验器里学来的（本会话踩过其中两条）：
 *   1. meta.durationInFrames 必须 === max(startFrame + durationInFrames)
 *   2. exit.durationInFrames 必须 <= 轨道时长
 *   3. 不能留下指向已删轨的 transition
 */
export function subsetManifest(src, { tracks = null, frames = null, stripAudio = false } = {}) {
  const cloned = JSON.parse(JSON.stringify(src))
  if (stripAudio) delete cloned.audio
  const limit = frames ?? cloned.meta.durationInFrames
  let picked = cloned.tracks
  if (tracks !== null) picked = picked.slice(0, tracks)
  picked = picked.filter((t) => (t.startFrame ?? 0) < limit)
  for (const t of picked) {
    const room = limit - (t.startFrame ?? 0)
    t.durationInFrames = Math.max(1, Math.min(t.durationInFrames, room))
    if (t.exit && typeof t.exit === 'object') {
      t.exit.durationInFrames = Math.max(1, Math.min(t.exit.durationInFrames ?? 1, t.durationInFrames))
    }
  }
  const live = new Set(picked.map((t) => t.id))
  picked = picked.filter((t) => t.type !== 'transition' || (live.has(t.fromTrackId) && live.has(t.toTrackId)))
  cloned.tracks = picked
  const end = picked.reduce((m, t) => Math.max(m, (t.startFrame ?? 0) + t.durationInFrames), 1)
  cloned.meta.durationInFrames = limit === null ? end : Math.max(1, Math.min(limit, end))
  return cloned
}

/** 在 manifest 上挂一条 image / video 轨（用真实素材路径，走同源 http）。 */
export function withAssetTrack(base, { type, file, frames }) {
  const m = JSON.parse(JSON.stringify(base))
  m.tracks.push({
    id: `asset-${type}`,
    type,
    src: PROJECT_ASSET_PREFIX + file,
    fit: type === 'image' ? 'cover' : 'contain',
    startFrame: 0,
    durationInFrames: frames,
    fadeFrames: 0,
  })
  m.meta.durationInFrames = Math.max(m.meta.durationInFrames, frames)
  return m
}

/** 把 5 段旁白 + BGM 挂进 manifest.audio（会话里生成了却从没接进去）。 */
export function withAudio(base, voiceFiles, bgmFile) {
  const m = JSON.parse(JSON.stringify(base))
  m.audio = {
    ...(bgmFile === null ? {} : { bgmUrl: PROJECT_ASSET_PREFIX + bgmFile }),
    voiceOver: voiceFiles.map((f, i) => ({ src: PROJECT_ASSET_PREFIX + f, startFrame: i * 300 })),
    duck: { amount: 0.45 },
  }
  return m
}

/* ─────────────────────────── 场景计划 ─────────────────────────── */

const PROBE = { frames: 10 }

/**
 * 生成完整矩阵。
 * @param {{ real: object|null }} env
 * @returns {{groups: {id,title,question,runs: object[]}[]}}
 */
export function buildMatrix(env) {
  const real = env.real
  const groups = []

  groups.push({
    id: 'Q1',
    title: '冷启动 / 预热',
    question: '同一个窗口连渲多次，第 2、3 次是否明显更快？「每次都要付 40–60s 冷启动」是否成立？',
    runs: [1, 2, 3, 4].map((n) => ({
      id: `q1-run${n}`,
      title: `10 帧小探针 第 ${n} 次（同窗口）`,
      manifest: synthManifest(1, PROBE.frames),
      quality: 'draft',
      frames: PROBE.frames,
      timeoutMs: 180_000,
    })),
  })

  groups.push({
    id: 'Q2',
    title: '轨道数 → 每帧成本',
    question: '「57 轨就挂、1 轨就快」到底是轨道数导致，还是别的原因？',
    runs: [1, 4, 11, 28, 57].map((n) => ({
      id: `q2-t${n}`,
      title: `${n} 轨 × 60 帧（纯形状）`,
      manifest: synthManifest(n, 60),
      quality: 'draft',
      frames: 60,
      timeoutMs: 240_000,
    })),
  })

  groups.push({
    id: 'Q3',
    title: '帧数 → 总时长',
    question: '固定 1 轨时，耗时是否随帧数线性？截距（固定开销）到底多大？',
    runs: [10, 60, 270, 600].map((f) => ({
      id: `q3-f${f}`,
      title: `1 轨 × ${f} 帧`,
      manifest: synthManifest(1, f),
      quality: 'draft',
      frames: f,
      timeoutMs: 300_000,
    })),
  })

  if (real !== null) {
    groups.push({
      id: 'Q4',
      title: '素材通道是否死锁',
      question: '「任何 image/video/audio 轨都会让渲染器挂死」是否成立？（v2 的 P0 根因）',
      runs: [
        { id: 'q4-base', title: '真实 manifest 前 3 轨 / 60 帧（去音频、无素材）', manifest: subsetManifest(real, { tracks: 3, frames: 60, stripAudio: true }), quality: 'draft', frames: 60, timeoutMs: 240_000 },
        { id: 'q4-image', title: '同上 + 1 条 image 轨（watch-hero）', manifest: withAssetTrack(subsetManifest(real, { tracks: 3, frames: 60, stripAudio: true }), { type: 'image', file: REAL_ASSETS.image, frames: 60 }), quality: 'draft', frames: 60, timeoutMs: 240_000 },
        { id: 'q4-audio', title: '同上 + 5 段旁白 + BGM（manifest.audio）', manifest: withAudio(subsetManifest(real, { tracks: 3, frames: 60, stripAudio: true }), ['a3ca636c-7880-4516-8a20-81c3b60c5c22.mp3', 'e2991bd6-3945-4676-8f89-f48891ee1f46.mp3'], REAL_ASSETS.bgm), quality: 'draft', frames: 60, timeoutMs: 240_000 },
        { id: 'q4-video', title: '同上 + 1 条 video 轨', manifest: withAssetTrack(subsetManifest(real, { tracks: 3, frames: 60, stripAudio: true }), { type: 'video', file: REAL_ASSETS.video, frames: 60 }), quality: 'draft', frames: 60, timeoutMs: 240_000 },
      ],
    })

    groups.push({
      id: 'Q8',
      title: '全片复现（决定性实验）',
      question: '同一份 61 轨 / 1800 帧 manifest，在**独立工程**里能不能渲出来？多久？',
      runs: [
        { id: 'q8-full', title: '61 轨 / 1800 帧 / draft', manifest: real, quality: 'draft', frames: real.meta.durationInFrames, timeoutMs: 1_200_000 },
        { id: 'q8-full-std', title: '61 轨 / 1800 帧 / standard', manifest: real, quality: 'standard', frames: real.meta.durationInFrames, timeoutMs: 1_800_000 },
        { id: 'q8-noise', title: '61 轨 / 1800 帧 / draft + 无硬件加速', manifest: real, quality: 'draft-sw', frames: real.meta.durationInFrames, timeoutMs: 1_200_000 },
      ],
    })

    groups.push({
      id: 'Q6',
      title: '中断后是否劣化',
      question: '一次超时/中断之后，紧接着的小渲染是否被拖慢？（自锁循环假设）',
      runs: [
        { id: 'q6-before', title: '中断前：10 帧探针', manifest: synthManifest(1, 10), quality: 'draft', frames: 10, timeoutMs: 180_000 },
        { id: 'q6-abort', title: '600 帧全速跑 5s 后 abort', manifest: synthManifest(11, 600), quality: 'draft', frames: 600, timeoutMs: 180_000, abortAfterMs: 5_000 },
        { id: 'q6-after', title: '中断后立即：同一份 10 帧探针', manifest: synthManifest(1, 10), quality: 'draft', frames: 10, timeoutMs: 180_000 },
      ],
    })
  }

  groups.push({
    id: 'Q7',
    title: '质量档参数',
    question: 'draft 档的 prefer-hardware / pageResponsiveness:disabled 是不是元凶？',
    runs: [
      { id: 'q7-draft', title: '60 帧 · draft（prefer-hardware + disabled）', manifest: synthManifest(11, 60), quality: 'draft', frames: 60, timeoutMs: 240_000 },
      { id: 'q7-draft-sw', title: '60 帧 · draft 但不要求硬件加速', manifest: synthManifest(11, 60), quality: 'draft-sw', frames: 60, timeoutMs: 240_000 },
      { id: 'q7-draft-resp', title: '60 帧 · draft 但允许主线程让出', manifest: synthManifest(11, 60), quality: 'draft-resp', frames: 60, timeoutMs: 240_000 },
      { id: 'q7-standard', title: '60 帧 · standard（no-preference + medium）', manifest: synthManifest(11, 60), quality: 'standard', frames: 60, timeoutMs: 240_000 },
    ],
  })

  groups.push({
    id: 'Q9',
    title: '窗口可见性 / 背景节流',
    question: '隐藏窗口 / 可见窗口 / 被遮挡，哪个会把 rAF 打下去并拖慢渲染？',
    runs: [
      {
        id: 'q9-probe',
        title: '30 帧探针（同一份 manifest，只换窗口档）',
        manifest: synthManifest(4, 30),
        quality: 'draft',
        frames: 30,
        timeoutMs: 240_000,
      },
    ],
  })

  if (real !== null) {
    const q10base = withAssetTrack(
      withAudio(
        subsetManifest(real, { tracks: 3, frames: 60, stripAudio: true }),
        ['a3ca636c-7880-4516-8a20-81c3b60c5c22.mp3', 'e2991bd6-3945-4676-8f89-f48891ee1f46.mp3'],
        REAL_ASSETS.bgm,
      ),
      { type: 'image', file: REAL_ASSETS.image, frames: 60 },
    )
    groups.push({
      id: 'Q10',
      title: '产品包装层开销',
      question: '不走工单、只走产品自己的 renderManifestOnWeb（字体注入 + 时长探测），会不会凭空多出几十秒？',
      runs: [
        { id: 'q10-raw-60', title: '同一份 manifest · 裸调 renderMediaOnWeb', manifest: q10base, quality: 'draft', frames: 60, timeoutMs: 240_000 },
        { id: 'q10-product-60', title: '同一份 manifest · 走产品 renderManifestOnWeb', manifest: q10base, quality: 'draft', frames: 60, mode: 'product', timeoutMs: 240_000 },
        { id: 'q10-product-full', title: '真实全片 · 走产品 renderManifestOnWeb（1800 帧）', manifest: real, quality: 'draft', frames: real.meta.durationInFrames, mode: 'product', timeoutMs: 900_000 },
      ],
    })
  }

  groups.push({
    id: 'Q11',
    title: '真实工件重放',
    question: '会话里**原样那些文件**（探针 / 分段 / 半片 / shape-only）在独立工程里各要多久？',
    runs: REPLAY.map((item) => {
      const manifest = loadArtifact(item.file)
      return {
        id: `q11-${item.file.replace(/\.json$/, '')}`,
        title: `${item.file} · ${manifest.meta.durationInFrames} 帧 / ${manifest.tracks.length} 轨`,
        note: `会话结果：${item.session}`,
        manifest,
        quality: 'draft',
        frames: manifest.meta.durationInFrames,
        mode: 'product',
        timeoutMs: 900_000,
      }
    }),
  })

  // ── REQ-035 / shotcraft 吸收方案：镜头卡与主题预设的**实证**（不是纸面判断）──
  // 每张卡 = 一份完整 manifest；渲染成功 + 采样三帧亮度有变化，才算"这张卡能用"。
  try {
    groups.push({
      id: 'Q12',
      title: '镜头卡验证（12+2 张）',
      question: '我们现在这套 manifest 字段，能不能把常用镜头写成"可直接粘的片段"，并且真的渲得出来？',
      runs: cardsMod.buildCardMatrix(),
    })
    groups.push({
      id: 'Q13',
      title: '主题预设验证（同一内容两套设计语言）',
      question: '换主题（调色 + 配色）能不能在**不改内容轨**的前提下改变观感？',
      runs: cardsMod.buildThemeMatrix(),
    })
  } catch (cause) {
    // 卡片模块缺失不该让整个实验台挂掉（老版本 checkout 仍要能跑 Q1–Q11）
    console.warn(`[rf] 跳过 Q12/Q13：${String(cause)}`)
  }

  return { groups }
}

/* ─────────────────────────── 真实工件重放 ─────────────────────────── */

/** 会话里被重试到烂的那些文件，`session` 是会话日志里的真实结局。 */
export const REPLAY = [
  { file: 'speed_bg60.json', session: '✅ 1.4s' },
  { file: 'probe_min.json', session: '✅ 55.6s / 45.0s / 59.9s（同一文件三次）' },
  { file: 'probe_ecg.json', session: '❌ 超时 90s' },
  { file: 'probe_nograin.json', session: '❌ 超时 90s' },
  { file: 'speed_img10.json', session: '❌ 超时 90s（背景+一张图）' },
  { file: 'speed_img60.json', session: '❌ 超时 90s' },
  { file: 'speed_audio10.json', session: '❌ 超时 90s（背景+音频）' },
  { file: 'seg_s2.json', session: '❌ 超时 150s' },
  { file: 'h1.json', session: '❌ 超时 420s' },
  { file: 'shape57x60.json', session: '❌ 超时 90s（57 轨 / 60 帧）' },
  { file: 'shapeonly_full.json', session: '❌ 超时 420s（57 轨 / 1800 帧）' },
  { file: 'manifest_lite.json', session: '❌ 超时 420s（59 轨 / 1800 帧）' },
]

function loadArtifact(file) {
  const p = join(REAL_BUILD_DIR, file)
  return JSON.parse(readFileSync(p, 'utf8'))
}

/** 窗口档位（由 Electron 外壳实现，用于 Q9）。 */
export const WINDOW_MODES = [
  { id: 'hidden', title: '隐藏窗口 + 关后台节流（= 产品现状 render-host/window.ts）' },
  { id: 'hidden-throttled', title: '隐藏窗口 + 保留后台节流（对照组）' },
  { id: 'visible', title: '可见窗口 + 关后台节流' },
  { id: 'occluded', title: '可见但被另一窗口盖住 + 关后台节流' },
]
