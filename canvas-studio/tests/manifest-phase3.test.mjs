/**
 * REQ-034 · 三期契约层单测（W1 / W2 / W3 / W4 / W5）。
 *
 * 覆盖 `validateManifest` 对三期全部新增字段的**边界**：合法就放过、非法就拒收、
 * 契约外字段只告警。三期新增字段全是可选的，所以还有一条更重要的回归：
 * **一个字段都不写的老 manifest 必须仍然零契约告警**（向后兼容的唯一机器判据）。
 *
 * 为什么这块必须测：这些字段的「静默失效」比报错危险得多 —— 模型写了 `exit:{target:…}`
 * 少一层嵌套，成片里没有退场，而 `ok=true`。`collectUnknownFieldWarnings` 是唯一的回执。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/manifest.js`。
 * 定向跑：node --test tests/manifest-phase3.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from '../lib/remotion/manifest.js'

/**
 * 合法基线：`lint:'off'` 让本文件只关心**契约层**（编排体检另有专门测试）。
 * 一条标题轨撑满全片，不依赖任何素材文件。
 */
function base(overrides = {}) {
  return {
    id: 'comp-p3',
    meta: { title: '三期契约', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off' },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
    ],
    ...overrides,
  }
}

function errorsOf(manifest) {
  const result = validateManifest(manifest)
  assert.equal(result.ok, false, `本用例应当被拒收，实际通过（warnings: ${result.warnings.join('；')}）`)
  return result.errors.join('；')
}

const IMG = '/canvas-studio/assets/p1/brain.png'
const VID = '/canvas-studio/assets/p1/clip.mp4'
const AUD = '/canvas-studio/assets/p1/bgm.mp3'

// ───────────────────────── 回归：老 manifest 一字不改 ─────────────────────────

test('老 manifest（三期字段一个都不写）仍然通过，且无任何契约告警', () => {
  const result = validateManifest(base())
  assert.deepEqual(result.errors, [], result.errors.join('；'))
  assert.deepEqual(result.warnings, [], `老片子不该被新字段的检查干扰：\n${result.warnings.join('\n')}`)
})

test('三期字段全开的一份 manifest 仍然通过，且无契约告警', () => {
  const manifest = base({
    meta: {
      title: '三期全字段', width: 1280, height: 720, fps: 30, durationInFrames: 300,
      look: { contrast: 1.06, saturation: 1.12, brightness: 1.02, temperature: 0.12, vignette: 0.35, grain: 0.16 },
      quality: 'high',
      lint: 'off',
    },
    tracks: [
      {
        id: 'img', type: 'image', src: IMG, startFrame: 0, durationInFrames: 150,
        blend: 'screen',
        colorShift: { from: '#4f9cf9', to: '#ff7a59', durationInFrames: 60, easing: 'easeInOutCubic' },
        animate: {
          from: { x: 60, opacity: 0 }, to: { x: 50, opacity: 1 }, durationInFrames: 18,
          easing: 'spring', spring: { stiffness: 170, damping: 18, mass: 1 },
        },
        exit: { to: { y: 44, opacity: 0 }, durationInFrames: 8, easing: 'easeIn' },
      },
      {
        id: 'vid', type: 'video', src: VID, startAfter: { trackId: 'img', gapFrames: 2 },
        durationInFrames: 160,
        trimBeforeFrames: 12, playbackRate: 0.5, muted: false, volume: 0.8, loop: true,
      },
      {
        id: 'tc', type: 'textCard', variant: 'title', text: '标题', startFrame: 20, durationInFrames: 100,
        anim: 'wordStagger', animOptions: { wordDelayFrames: 3, offsetY: 14, blur: 4 },
        accentColor: '#F59E0B',
      },
      {
        id: 'tr', type: 'transition', effect: 'wipeLeft',
        fromTrackId: 'img', toTrackId: 'vid',
        startFrame: 130, durationInFrames: 14,
        easing: 'easeInOutCubic', softness: 0.35, direction: 'left',
      },
      {
        id: 'viz', type: 'audioViz', src: AUD, startFrame: 0, durationInFrames: 300,
        mode: 'line', smoothing: 0.4, gradient: { from: '#38BDF8', to: 'rgba(0,0,0,0)' }, bars: 32,
      },
    ],
    audio: { bgmUrl: AUD, voiceOverUrl: AUD, fadeInSeconds: 0.6, fadeOutSeconds: 1.2, duck: { amount: 0.55 } },
  })
  const result = validateManifest(manifest)
  assert.deepEqual(result.errors, [], result.errors.join('\n'))
  // `startAfter` 尚未解析 ⇒ 「轨道总时长」偏差那条 warning 不该出现（该轨没有 startFrame）；
  // 但 `vid` 结束帧会超总时长 ⇒ 有一条裁切 warning，属预期，不计入契约告警。
  const contract = result.warnings.filter((w) => !w.includes('渲染将按 meta 裁切'))
  assert.deepEqual(contract, [], contract.join('\n'))
})

// ───────────────────────── W1-1 · exit ─────────────────────────

test('exit：缺 to / 时长非正 / 超过轨道时长 / gapFrames 负数 / easing 非法 ⇒ 全部拒收', () => {
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, exit: { durationInFrames: 8 } }] })),
    /exit\.to 缺失/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, exit: { to: { opacity: 0 }, durationInFrames: 0 } }] })),
    /exit\.durationInFrames 必须是正整数/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, exit: { to: { opacity: 0 }, durationInFrames: 80 } }] })),
    /超过轨道时长 60/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, exit: { to: { opacity: 0 }, gapFrames: -1 } }] })),
    /exit\.gapFrames 必须是 >= 0 的整数/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, exit: { to: { opacity: 0 }, easing: 'bounce' } }] })),
    /exit\.easing 非法/,
  )
})

test('exit：合法声明通过（只给 to 也能过 —— from 由入场读数自动推导）', () => {
  const result = validateManifest(base({
    tracks: [{ id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, exit: { to: { y: 44, opacity: 0 }, durationInFrames: 8 } }],
  }))
  assert.deepEqual(result.errors, [], result.errors.join('；'))
})

// ───────────────────────── W1-2 · startAfter ─────────────────────────

test('startAfter：与 startFrame 互斥（同时给 ⇒ 拒收）', () => {
  assert.match(
    errorsOf(base({
      tracks: [
        { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60 },
        { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 60, startAfter: { trackId: 'a' }, durationInFrames: 60 },
      ],
    })),
    /不能同时给 startFrame 与 startAfter/,
  )
})

test('startAfter：trackId 缺失 / gapFrames 非整数 ⇒ 拒收（引用顺序由 normalize 阶段判）', () => {
  assert.match(
    errorsOf(base({
      tracks: [
        { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60 },
        { id: 'b', type: 'textCard', variant: 'title', text: 'B', startAfter: {}, durationInFrames: 60 },
      ],
    })),
    /startAfter\.trackId 必须是非空字符串/,
  )
  assert.match(
    errorsOf(base({
      tracks: [
        { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60 },
        { id: 'b', type: 'textCard', variant: 'title', text: 'B', startAfter: { trackId: 'a', gapFrames: 1.5 }, durationInFrames: 60 },
      ],
    })),
    /startAfter\.gapFrames 必须是整数/,
  )
  // O-08：负值合法（= 与引用轨重叠），校验层必须放行 —— 这里不能用 errorsOf
  // （它断言「必须被拒收」），直接看 ok。
  const negative = validateManifest(base({
    tracks: [
      { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60 },
      { id: 'b', type: 'textCard', variant: 'title', text: 'B', startAfter: { trackId: 'a', gapFrames: -12 }, durationInFrames: 60 },
    ],
  }))
  assert.deepEqual(negative.errors, [], negative.errors.join('；'))
})

// ───────────────────────── W2-3 / W2-4 / W2-5 ─────────────────────────

test('colorShift：非 hex 颜色 / easing 非法 ⇒ 拒收', () => {
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'shape', shape: 'circle', color: '#fff', box: { x: 0, y: 0, w: 4, h: 4 }, startFrame: 0, durationInFrames: 60, colorShift: { from: 'red', to: '#ffffff' } }] })),
    /colorShift\.from 必须是 #rgb 或 #rrggbb/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'shape', shape: 'circle', color: '#fff', box: { x: 0, y: 0, w: 4, h: 4 }, startFrame: 0, durationInFrames: 60, colorShift: { from: '#000', to: '#fff', easing: 'wobble' } }] })),
    /colorShift\.easing 非法/,
  )
})

test('meta.look：越界数值 / 非数值 ⇒ 拒收；合法六项通过', () => {
  assert.match(
    errorsOf(base({ meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300, look: { contrast: 9 } } })),
    /meta\.look\.contrast 必须是 0–4 的数值/,
  )
  assert.match(
    errorsOf(base({ meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300, look: { temperature: 2 } } })),
    /meta\.look\.temperature 必须是 -1–1 的数值/,
  )
  assert.match(
    errorsOf(base({ meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300, look: { grain: '4%' } } })),
    /meta\.look\.grain 必须是 0–1 的数值/,
  )
})

test('meta.quality / meta.lint：非法取值拒收（质量档只有三档，lint 只有 off）', () => {
  assert.match(
    errorsOf(base({ meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300, quality: 'ultra' } })),
    /meta\.quality 非法/,
  )
  assert.match(
    errorsOf(base({ meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'on' } })),
    /meta\.lint 只允许 "off"/,
  )
})

test('blend：白名单外拒收，五档全过', () => {
  assert.match(
    errorsOf(base({ tracks: [{ id: 'a', type: 'shape', shape: 'circle', color: '#fff', box: { x: 0, y: 0, w: 4, h: 4 }, startFrame: 0, durationInFrames: 60, blend: 'color-burn' }] })),
    /blend 非法/,
  )
  for (const blend of ['normal', 'screen', 'multiply', 'overlay', 'soft-light']) {
    const result = validateManifest(base({
      tracks: [{ id: 'a', type: 'shape', shape: 'circle', color: '#fff', box: { x: 0, y: 0, w: 4, h: 4 }, startFrame: 0, durationInFrames: 60, blend }],
    }))
    assert.deepEqual(result.errors, [], `${blend} 应当合法：${result.errors.join('；')}`)
  }
})

// ───────────────────────── W3-1 · 媒体参数 ─────────────────────────

test('video：trimBeforeFrames / playbackRate / volume / muted / loop 越界或类型错 ⇒ 拒收', () => {
  const videoTrack = (extra) => base({
    tracks: [{ id: 'v', type: 'video', src: VID, startFrame: 0, durationInFrames: 60, ...extra }],
  })
  assert.match(errorsOf(videoTrack({ trimBeforeFrames: -3 })), /trimBeforeFrames 必须是 >= 0 的整数/)
  assert.match(errorsOf(videoTrack({ playbackRate: 5 })), /playbackRate 必须是 0\.1–4 的数值/)
  assert.match(errorsOf(videoTrack({ playbackRate: 0 })), /playbackRate 必须是 0\.1–4 的数值/)
  assert.match(errorsOf(videoTrack({ volume: 1.4 })), /volume 必须是 0–1 的数值/)
  assert.match(errorsOf(videoTrack({ muted: 'yes' })), /muted 必须是布尔值/)
  assert.match(errorsOf(videoTrack({ loop: 1 })), /loop 必须是布尔值/)
})

test('video：五个媒体参数合法组合通过', () => {
  const result = validateManifest(base({
    tracks: [{ id: 'v', type: 'video', src: VID, startFrame: 0, durationInFrames: 60, trimBeforeFrames: 0, playbackRate: 2, muted: true, volume: 0, loop: false }],
  }))
  assert.deepEqual(result.errors, [], result.errors.join('；'))
})

// ───────────────────────── W3-2 / W3-3 · 音频与可视化 ─────────────────────────

test('audio：fadeIn/Out 超上限、duck.amount 越界 ⇒ 拒收', () => {
  assert.match(
    errorsOf(base({ audio: { bgmUrl: AUD, fadeInSeconds: 40 } })),
    /audio\.fadeInSeconds 必须是 0–30 的数值/,
  )
  assert.match(
    errorsOf(base({ audio: { bgmUrl: AUD, duck: { amount: 1.5 } } })),
    /audio\.duck\.amount 必须是 0–1 的数值/,
  )
})

test('audioViz：新增 line 模式与 smoothing / gradient 合法；越界拒收', () => {
  const viz = (extra) => base({
    tracks: [{ id: 'viz', type: 'audioViz', src: AUD, startFrame: 0, durationInFrames: 300, ...extra }],
  })
  const ok = validateManifest(viz({ mode: 'line', smoothing: 0.9, gradient: { from: '#38BDF8', to: '#0b1220' } }))
  assert.deepEqual(ok.errors, [], ok.errors.join('；'))
  assert.match(errorsOf(viz({ smoothing: 0.95 })), /smoothing 必须是 0–0\.9 的数值/)
  assert.match(errorsOf(viz({ mode: 'wave' })), /mode 非法/)
  // 错误文案必须列出真实白名单（三期加了 line；手写文案漏过一次）
  assert.match(errorsOf(viz({ mode: 'wave' })), /bars \/ mirror \/ line/)
})

// ───────────────────────── W4-2 · 文本动效 ─────────────────────────

test('textCard：anim 白名单外拒收；animOptions 越界拒收', () => {
  assert.match(
    errorsOf(base({ tracks: [{ id: 't', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, anim: 'explode' }] })),
    /anim 非法/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 't', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animOptions: { blur: 40 } }] })),
    /animOptions\.blur 必须是 0–32 的数值/,
  )
  assert.match(
    errorsOf(base({ tracks: [{ id: 't', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60, animOptions: { wordDelayFrames: -1 } }] })),
    /animOptions\.wordDelayFrames 必须是 >= 0 的整数/,
  )
})

// ───────────────────────── W2-6 · 转场参数化 ─────────────────────────

test('transition：softness / direction / easing 各自越界 ⇒ 拒收', () => {
  const withTransition = (extra) => base({
    tracks: [
      { id: 'a', type: 'image', src: IMG, startFrame: 0, durationInFrames: 120 },
      { id: 'b', type: 'image', src: IMG, startFrame: 100, durationInFrames: 200 },
      { id: 'tr', type: 'transition', effect: 'wipeLeft', fromTrackId: 'a', toTrackId: 'b', startFrame: 100, durationInFrames: 16, ...extra },
    ],
  })
  assert.match(errorsOf(withTransition({ softness: 1.5 })), /softness 必须是 0–1 的数值/)
  assert.match(errorsOf(withTransition({ direction: 'diagonal' })), /direction 只允许 left \/ right \/ up \/ down/)
  assert.match(errorsOf(withTransition({ easing: 'swing' })), /easing 非法/)

  const ok = validateManifest(withTransition({ softness: 0, direction: 'down', easing: 'easeOutCubic' }))
  assert.deepEqual(ok.errors, [], ok.errors.join('；'))
})

// ───────────────────────── 契约外字段（静默失效的唯一回执）─────────────────────────

test('契约外字段：只告警不阻断，且定位到具体层（exit.target 这种少一层嵌套必须被点名）', () => {
  const manifest = base({
    tracks: [{
      id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 60,
      exit: { target: { opacity: 0 }, durationInFrames: 8 },
      cut: true,
    }],
  })
  const result = validateManifest(manifest)
  const joined = result.warnings.join('\n')
  assert.match(joined, /tracks\[0\]\.exit 含契约外字段 "target"/)
  assert.match(joined, /tracks\[0\] 含契约外字段 "cut"/)
})

test('契约外字段：新增子对象（startAfter / colorShift / animOptions / look / audio.duck）逐层都扫', () => {
  const manifest = base({
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 300, lint: 'off', look: { contast: 1.1 } },
    tracks: [
      { id: 'a', type: 'shape', shape: 'circle', color: '#fff', box: { x: 0, y: 0, w: 4, h: 4 }, startFrame: 0, durationInFrames: 60,
        colorShift: { from: '#000', to: '#fff', ease: 'linear' } },
      { id: 'b', type: 'textCard', variant: 'title', text: 'B', startAfter: { trackId: 'a', delay: 2 }, durationInFrames: 60,
        anim: 'fadeUp', animOptions: { wordDelay: 2 } },
    ],
    audio: { bgmUrl: AUD, duck: { level: 0.5 } },
  })
  const joined = validateManifest(manifest).warnings.join('\n')
  assert.match(joined, /meta\.look 含契约外字段 "contast"/)
  assert.match(joined, /colorShift 含契约外字段 "ease"/)
  assert.match(joined, /animOptions 含契约外字段 "wordDelay"/)
  assert.match(joined, /audio\.duck 含契约外字段 "level"/)
  // `delay` 是 startAfter 的契约外字段；但本用例的 b 轨 startAfter 引用合法（向后找不到时
  // 只是 normalize 阶段的事），这里只要求「被点名」。
  assert.match(joined, /startAfter 含契约外字段 "delay"/)
})
