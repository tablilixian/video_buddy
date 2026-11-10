/**
 * 0A · SFX 事件轨契约与换算（CV-460）。
 *
 * 三件事必须钉死，任何一件松了都会静默出错：
 * 1. **三定位互斥恰好给一个** —— 叠在一起语义不明，不能"取优先级最高的那个"静默忽略；
 * 2. **换算唯一的入口 `resolveSfxStartFrame`** —— 渲染/校验/验收脚本各写一份必然漂；
 * 3. **sfx 计入出声源** —— 否则"只有音效"的片被判 `none`，画布角标显示"无声"
 *    （CV-334 踩过同类坑），而实际有 7 个音效点。
 *
 * 真值口径见 `docs/plans/2026-11-10-视频模板化/gt/mix-report.json`（7 条事件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveSfxStartFrame,
  summarizeManifestAudio,
  validateManifest,
} from '../lib/remotion/manifest.js'
import { timelineFromManifestAudio } from '../lib/audio-compose.js'
import { compositionFromTimeline } from '../lib/audio-timeline.js'
import { sfxVolumeAt } from '../lib/remotion/timing.js'

/**
 * 校验必过的最小 manifest（纯呈现轨，不依赖素材文件）。
 *
 * `durationInFrames` 必须与轨道总时长一致（否则触发"尾部截断"校验，与 sfx 无关）；
 * `lint: 'off'` 关掉编排体检（ML-10「静态占比 > 70%」对单张静帧卡必然报警，也无关 sfx）。
 * 两者都是为了让断言只反映 sfx 的行为。
 */
function manifestWithSfx(sfx, extraTracks = []) {
  return {
    id: 'm-sfx',
    meta: { title: 'SFX 测试片', width: 1280, height: 720, fps: 60, durationInFrames: 60, lint: 'off' },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题卡', startFrame: 0, durationInFrames: 60 },
      ...extraTracks,
    ],
    audio: { sfx },
  }
}

const OK_SRC = '/canvas-studio/remotion/sfx/thud.wav'

// ───────────────── ① resolveSfxStartFrame：三种定位 ─────────────────

test('0A：startSec 按 fps 换算并四舍五入（60fps 的 0.58 → 35）', () => {
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startSec: 0.58 }, { fps: 60 }), 35)
})

test('0A：startSec 30fps 取整（7.6×30 = 228，无余量）', () => {
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startSec: 7.6 }, { fps: 30 }), 228)
})

test('0A：同一 startSec 换 fps 必须重算（0.58@60=35 / @30=17）—— 秒值跨 fps 不变的代价', () => {
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startSec: 0.58 }, { fps: 60 }), 35)
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startSec: 0.58 }, { fps: 30 }), 17)
})

test('0A：startFrame 不随 fps 变（帧精确，GT 复刻靠它）', () => {
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startFrame: 1056 }, { fps: 60 }), 1056)
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startFrame: 1056 }, { fps: 30 }), 1056)
})

test('0A：anchor at=start 解析到目标轨起点', () => {
  const trackById = new Map([['b2-card-1', { startFrame: 534, durationInFrames: 50 }]])
  assert.equal(
    resolveSfxStartFrame({ src: OK_SRC, anchor: { trackId: 'b2-card-1', at: 'start' } }, { fps: 60, trackById }),
    534,
  )
})

test('0A：anchor at=start + offsetSec 偏移（534 + round(0.1×60)=6 → 540）', () => {
  const trackById = new Map([['b2-card-1', { startFrame: 534, durationInFrames: 50 }]])
  assert.equal(
    resolveSfxStartFrame(
      { src: OK_SRC, anchor: { trackId: 'b2-card-1', at: 'start', offsetSec: 0.1 } },
      { fps: 60, trackById },
    ),
    540,
  )
})

test('0A：anchor at=end 解析到目标轨终点（534+50 → 584）', () => {
  const trackById = new Map([['b2-card-1', { startFrame: 534, durationInFrames: 50 }]])
  assert.equal(
    resolveSfxStartFrame({ src: OK_SRC, anchor: { trackId: 'b2-card-1', at: 'end' } }, { fps: 60, trackById }),
    584,
  )
})

test('0A：anchor 允许负 offset（对齐转场重叠），但结果不能为负帧', () => {
  const trackById = new Map([['t-title', { startFrame: 5, durationInFrames: 50 }]])
  assert.equal(
    resolveSfxStartFrame({ src: OK_SRC, anchor: { trackId: 't-title', at: 'start', offsetSec: -0.05 } }, { fps: 60, trackById }),
    2,
  )
  // 5 - 0.2*60 = -7 ⇒ null（调用方报 error，不能夹到 0 静默放行）
  assert.equal(
    resolveSfxStartFrame({ src: OK_SRC, anchor: { trackId: 't-title', at: 'start', offsetSec: -0.2 } }, { fps: 60, trackById }),
    null,
  )
})

test('0A：三定位给 0 个或 ≥2 个 → null（不猜、不取优先级）', () => {
  assert.equal(resolveSfxStartFrame({ src: OK_SRC }, { fps: 60 }), null)
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startSec: 1, startFrame: 60 }, { fps: 60 }), null)
  assert.equal(
    resolveSfxStartFrame(
      { src: OK_SRC, startSec: 1, anchor: { trackId: 'x', at: 'start' } },
      { fps: 60, trackById: new Map([['x', { startFrame: 0, durationInFrames: 10 }]]) },
    ),
    null,
  )
})

test('0A：anchor 查不到目标轨 → null（startAfter 未解析时也走这条）', () => {
  assert.equal(
    resolveSfxStartFrame({ src: OK_SRC, anchor: { trackId: 'nope', at: 'start' } }, { fps: 60, trackById: new Map() }),
    null,
  )
  // 只给 fps、没有 trackById ⇒ anchor 一律 null（纯 sec/frame 定位不依赖它）
  assert.equal(
    resolveSfxStartFrame({ src: OK_SRC, anchor: { trackId: 't-title', at: 'start' } }, { fps: 60 }),
    null,
  )
})

test('0A：非法数值一律 null（负 sec / 非整数 frame / 非法 at）', () => {
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startSec: -1 }, { fps: 60 }), null)
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startFrame: 1.5 }, { fps: 60 }), null)
  assert.equal(resolveSfxStartFrame({ src: OK_SRC, startFrame: -3 }, { fps: 60 }), null)
  assert.equal(
    resolveSfxStartFrame(
      { src: OK_SRC, anchor: { trackId: 'x', at: 'middle' } },
      { fps: 60, trackById: new Map([['x', { startFrame: 0, durationInFrames: 10 }]]) },
    ),
    null,
  )
})

// ───────────────── ② 反向变异等价性（守卫必须能变红） ─────────────────
//
// 真正的变异在 CI 之外对 lib 产物做（见 docs/plans/.../无人值守推进协议.md §5）。
// 这里钉住"为什么该断言有效"：round → floor 会让 0.58@60 从 35 变成 34。

test('0A：反向变异等价性 —— round 与 floor 在 0.58@60 上结论不同（证明舍入口径被钉住）', () => {
  assert.equal(Math.round(0.58 * 60), 35)
  assert.notEqual(Math.floor(0.58 * 60), 35, '若实现用 floor，上面 35 的断言必须变红')
  assert.equal(Math.floor(0.58 * 60), 34)
})

// ───────────────── ③ validateManifest 集成 ─────────────────

test('0A：合法 sfx（startSec 定位）→ ok=true，无 error 无 warning', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 0.58, gain: 0.55, pan: 0 }]))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.ok, true)
})

test('0A：合法 sfx（anchor 定位）→ ok=true（anchor 是被鼓励的模板写法）', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, anchor: { trackId: 't-title', at: 'start' } }]))
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('0A：sfx 不是数组 → error', () => {
  const r = validateManifest(manifestWithSfx('thud.wav'))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('必须是数组')), r.errors.join('；'))
})

test('0A：sfx 为空数组 → error（没有音效就别写这个字段）', () => {
  const r = validateManifest(manifestWithSfx([]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('空数组')), r.errors.join('；'))
})

test('0A：三种定位同时给 → error（不能静默取其一）', () => {
  const r = validateManifest(manifestWithSfx([
    { src: OK_SRC, startSec: 1, startFrame: 60, anchor: { trackId: 't-title', at: 'start' } },
  ]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('必须且只能用一种定位')), r.errors.join('；'))
})

test('0A：三种定位都不给 → error（起点不明，不能默认 0）', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('必须且只能用一种定位')), r.errors.join('；'))
})

test('0A：两种定位（startSec + startFrame）→ error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 1, startFrame: 60 }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('必须且只能用一种定位')), r.errors.join('；'))
})

test('0A：anchor.trackId 不存在于 tracks[] → error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, anchor: { trackId: 'ghost', at: 'start' } }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('不存在')), r.errors.join('；'))
})

test('0A：anchor.at 非 start/end → error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, anchor: { trackId: 't-title', at: 'middle' } }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('anchor.at')), r.errors.join('；'))
})

test('0A：外链 src → error（同源约束不放宽）', () => {
  const r = validateManifest(manifestWithSfx([{ src: 'https://evil.example/x.wav', startSec: 1 }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('audio.sfx[0].src')), r.errors.join('；'))
})

test('0A：gain 越界（5）→ error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 1, gain: 5 }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('gain')), r.errors.join('；'))
})

test('0A：pan 越界（3）→ error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 1, pan: 3 }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('pan')), r.errors.join('；'))
})

test('0A：负 startSec → error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: -0.5 }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('startSec')), r.errors.join('；'))
})

test('0A：startFrame 非整数 → error', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startFrame: 1.5 }]))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('startFrame')), r.errors.join('；'))
})

test('0A：sfx 条数超上限（65）→ error', () => {
  const many = Array.from({ length: 65 }, (_, i) => ({ src: OK_SRC, startFrame: i }))
  const r = validateManifest(manifestWithSfx(many))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('最多 64 条')), r.errors.join('；'))
})

test('0A：sfx 里的契约外字段只 warning 不阻断（与既有 warnUnknownKeys 同策略）', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 1, volumn: 0.5 }]))
  assert.equal(r.ok, true, r.errors.join('；'))
  assert.ok(r.warnings.some((w) => w.includes('volumn')), r.warnings.join('；'))
})

test('0A：★ 防回归 —— audio.sfx 必须在 KNOWN_AUDIO_KEYS 里（否则整段被判契约外字段）', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 1 }]))
  assert.ok(
    !r.warnings.some((w) => w.includes('"sfx"')),
    `sfx 被当成契约外字段了，说明 KNOWN_AUDIO_KEYS 漏加：${r.warnings.join('；')}`,
  )
})

test('0A：音效完全落在片外 → warning（不是 error：音频轨短于成片是常态）', () => {
  // 60 帧的片，startSec 1.5 → 第 90 帧，已超出
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 1.5 }]))
  assert.equal(r.ok, true, r.errors.join('；'))
  assert.ok(r.warnings.some((w) => w.includes('不会响')), r.warnings.join('；'))
})

test('0A：音效在片内 → 不得有"不会响"告警（防误报）', () => {
  const r = validateManifest(manifestWithSfx([{ src: OK_SRC, startSec: 0.5 }]))
  assert.ok(!r.warnings.some((w) => w.includes('不会响')), r.warnings.join('；'))
})

// ───────────────── ④ summarizeManifestAudio 计入 sfx ─────────────────

test('0A：★ 只有 sfx 的 manifest 必须判为"有声音"（否则画布角标显示无声）', () => {
  const manifest = {
    id: 'm-sfx-only',
    meta: { title: '纯音效片', width: 1280, height: 720, fps: 60, durationInFrames: 1080 },
    tracks: [
      // 一条静音 video 轨：native 声 = 0
      {
        id: 't-video', type: 'video', src: '/proj-1/clip.mp4', muted: true,
        startFrame: 0, durationInFrames: 1080,
      },
    ],
    audio: { sfx: [{ src: OK_SRC, startSec: 0.58 }] },
  }
  const summary = summarizeManifestAudio(manifest)
  assert.equal(summary.mutedVideoTracks, 1)
  assert.ok(summary.audibleSources > 0, 'sfx 未计入 audibleSources —— 纯音效片会被判 none')
})

test('0A：sfx 条数逐条计数（3 条 → audibleSources 至少 3）', () => {
  const manifest = {
    id: 'm-sfx-3',
    meta: { title: '三条音效', width: 1280, height: 720, fps: 60, durationInFrames: 300 },
    tracks: [],
    audio: {
      sfx: [
        { src: OK_SRC, startSec: 0.5 },
        { src: OK_SRC, startSec: 1.5 },
        { src: OK_SRC, startSec: 2.5 },
      ],
    },
  }
  assert.equal(summarizeManifestAudio(manifest).audibleSources, 3)
})

// ───────────────── ⑤ 音频构成派生（0A-3） ─────────────────
//
// 这一节守住的核心：**纯音效片不能显示成「无声」**。
// 枚举是「原生/BGM/旁白」三布尔正交展开，sfx 不参与展开（否则 8 → 16 值），
// 但必须能在三者皆无时把 none 顶掉。

function derive(manifest) {
  return compositionFromTimeline(timelineFromManifestAudio(manifest))
}

test('0A-3：★ 纯音效片派生为 sfx，不是 none（角标曾显示"成片无声"）', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [],
    audio: { sfx: [{ src: OK_SRC, startSec: 0.58 }] },
  }
  assert.equal(derive(manifest), 'sfx')
})

test('0A-3：真·无声片仍是 none（sfx 不能把 none 全都顶掉）', () => {
  assert.equal(derive({ meta: { fps: 60 }, tracks: [], audio: undefined }), 'none')
  assert.equal(derive({ meta: { fps: 60 }, tracks: [], audio: {} }), 'none')
})

test('0A-3：sfx 不参与正交展开 —— native + sfx 仍为 native', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [{ id: 'v1', type: 'video', src: '/p/a.mp4', startFrame: 0, durationInFrames: 600 }],
    audio: { sfx: [{ src: OK_SRC, startSec: 0.58 }] },
  }
  assert.equal(derive(manifest), 'native')
})

test('0A-3：旁白 + sfx 仍为 voiceOver（sfx 不抢主音源判定）', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [],
    audio: { voiceOver: [{ src: '/p/vo.mp3', startFrame: 0 }], sfx: [{ src: OK_SRC, startSec: 1 }] },
  }
  assert.equal(derive(manifest), 'voiceOver')
})

test('0A-3：sfx 每条独立成段，startSec 由 resolveSfxStartFrame 换算（0.58@60 → 35 帧 → 0.583s）', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [],
    audio: { sfx: [{ src: OK_SRC, startSec: 0.58 }] },
  }
  const timeline = timelineFromManifestAudio(manifest)
  const sfxSegs = timeline.segments.filter((seg) => seg.role === 'sfx')
  assert.equal(sfxSegs.length, 1, '每条 sfx 必须独立成段')
  assert.equal(sfxSegs[0].startSec, 0.583, '35/60 = 0.5833… 取三位小数')
})

test('0A-3：anchor 定位在派生里也用轨的真实 startFrame（不是 0）', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [{ id: 'b2-card-1', type: 'textCard', startFrame: 534, durationInFrames: 50 }],
    audio: { sfx: [{ src: OK_SRC, anchor: { trackId: 'b2-card-1', at: 'start' } }] },
  }
  const sfxSegs = timelineFromManifestAudio(manifest).segments.filter((seg) => seg.role === 'sfx')
  assert.equal(sfxSegs.length, 1)
  assert.equal(sfxSegs[0].startSec, 8.9, '534/60 = 8.9')
})

test('0A-3：anchor 指向不存在的轨 → 派生里静默跳过（校验层已报 error，不重复报）', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [],
    audio: { sfx: [{ src: OK_SRC, anchor: { trackId: 'ghost', at: 'start' } }] },
  }
  assert.equal(timelineFromManifestAudio(manifest).segments.filter((seg) => seg.role === 'sfx').length, 0)
})

test('0A-3：sfx 的 gain/fade 传递到段上（gain 不丢）', () => {
  const manifest = {
    meta: { fps: 60 },
    tracks: [],
    audio: { sfx: [{ src: OK_SRC, startFrame: 100, gain: 0.3, fadeInSec: 0.05, fadeOutSec: 0.1 }] },
  }
  const seg = timelineFromManifestAudio(manifest).segments.find((x) => x.role === 'sfx')
  assert.equal(seg.gain, 0.3)
  assert.equal(seg.fadeInSec, 0.05)
  assert.equal(seg.fadeOutSec, 0.1)
})

// ─────────────────── 0A-7 · sfxVolumeAt（渲染音量包络，timing.ts） ───────────────────

test('0A-7：无 fade —— 起点帧即 gain（任务包 §5.1 断言 1 的缺省口径），起点前与 NaN 为 0', () => {
  assert.equal(sfxVolumeAt(100, { startFrame: 100, fps: 60 }), 1)
  assert.equal(sfxVolumeAt(150, { startFrame: 100, fps: 60 }), 1, '起点后整段保持 gain')
  assert.equal(sfxVolumeAt(99, { startFrame: 100, fps: 60 }), 0)
  assert.equal(sfxVolumeAt(Number.NaN, { startFrame: 100, fps: 60 }), 0)
})

test('0A-7：显式 gain 生效；>1 放行（增益口径），>2 收敛回契约上限', () => {
  assert.equal(sfxVolumeAt(100, { startFrame: 100, fps: 60, gain: 0.3 }), 0.3)
  assert.equal(sfxVolumeAt(100, { startFrame: 100, fps: 60, gain: 1.5 }), 1.5)
  assert.equal(sfxVolumeAt(100, { startFrame: 100, fps: 60, gain: 5 }), 2)
})

test('0A-7：淡入线性 0→gain，完成帧起满音量（任务包 §5.1 断言 2）', () => {
  const startFrame = 100
  const fadeInFrames = Math.round(0.5 * 60) // 30
  const opts = { startFrame, fps: 60, gain: 0.8, fadeInSec: 0.5 }
  assert.equal(sfxVolumeAt(startFrame, opts), 0, '淡入起点 = 0')
  assert.ok(
    Math.abs(sfxVolumeAt(startFrame + 15, opts) - 0.4) < 1e-9,
    '区间中点 = gain 的一半（线性）',
  )
  assert.equal(sfxVolumeAt(startFrame + fadeInFrames, opts), 0.8, '完成帧起 = gain')
  assert.equal(sfxVolumeAt(startFrame + fadeInFrames + 7, opts), 0.8)
})

test('0A-7：淡出需要显式 durationInFrames —— 给了才线性降、片尾为 0（任务包 §5.1 断言 3）', () => {
  const end = 220
  const opts = { startFrame: 100, fps: 60, gain: 1, fadeOutSec: 0.5, durationInFrames: 120 }
  assert.equal(sfxVolumeAt(end, opts), 0, '片尾帧 = 0')
  // afade 约定：淡出区间起点（边界帧）保持满音量，`frame > end - fadeOut` 才开始下降。
  assert.equal(sfxVolumeAt(end - 30, opts), 1, '淡出区间起点的边界帧保持 gain')
  assert.ok(
    Math.abs(sfxVolumeAt(end - 15, opts) - 0.5) < 1e-9,
    '淡出中点 = gain 的一半（线性下降）',
  )
  assert.equal(sfxVolumeAt(end - 31, opts), 1, '淡出区间之外保持 gain')
})

test('0A-7：不给 durationInFrames —— fadeOutSec 不生效（渲染器 MVP 口径，D-16）', () => {
  const opts = { startFrame: 100, fps: 60, gain: 0.9, fadeOutSec: 0.5 }
  assert.equal(sfxVolumeAt(1000, opts), 0.9)
})
