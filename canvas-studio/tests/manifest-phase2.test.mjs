/**
 * REQ-034 · 二期契约层单测：`orbit` / `fx` / `shape:'path'` / 新转场 / `audioViz` 的校验，
 * 以及**音轨构成的唯一实现**（`audioCompositionFrom`）与 D6 的旁白判定口径。
 *
 * 这些断言守的是「不合法就拒收，合法就放过」这条边界 —— 二期新增了 5 类字段，
 * 只要有一条守卫漏了，模型写错就变成静默失效（比报错更难查）。
 *
 * 直连 Host tsc 编译产物 `lib/remotion/manifest.js`。
 * 定向跑：node --test tests/manifest-phase2.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  audioCompositionFrom,
  collectUnknownFieldWarnings,
  deriveAudioComposition,
  validateManifest,
} from '../lib/remotion/manifest.js'

/** 合法基线：一条标题轨撑满全片（不依赖任何素材文件）。 */
function base(overrides = {}) {
  return {
    id: 'comp-p2',
    meta: { title: '二期契约', width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    tracks: [
      { id: 't-title', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
    ],
    ...overrides,
  }
}

function errorsOf(manifest) {
  const result = validateManifest(manifest)
  assert.equal(result.ok, false, '本用例应当被拒收')
  return result.errors.join('；')
}

// ───────────────────────────── A1：orbit 校验 ─────────────────────────────

/**
 * 三期 W1-3：`validateManifest` 现在会把**编排体检**（motion lint）并入 warnings。
 * 本文件守的是「契约边界」—— 断言无告警时先滤掉 lint 行（那是观感建议，不是契约错误）。
 */
function contractWarnings(result) {
  return result.warnings.filter((warning) => !warning.startsWith('[编排体检 '))
}

test('orbit：合法声明通过，且不产生契约告警', () => {
  const manifest = base({
    tracks: [{
      id: 'planet', type: 'shape', shape: 'circle', color: '#4EA8DE',
      box: { x: 0, y: 0, w: 6, h: 6 }, startFrame: 0, durationInFrames: 300,
      orbit: { center: { x: 50, y: 50 }, radius: 26, startAngle: -90, periodInFrames: 300, direction: 'ccw' },
    }],
  })
  const result = validateManifest(manifest)
  assert.deepEqual(result.errors, [], result.errors.join('；'))
  assert.deepEqual(contractWarnings(result), [], result.warnings.join('；'))
})

test('orbit：与 transform.x/y 同时声明 ⇒ 拒收（位置只能有一处来源）', () => {
  const manifest = base({
    tracks: [{
      id: 'p1', type: 'shape', shape: 'circle', color: '#fff',
      startFrame: 0, durationInFrames: 300, transform: { x: 30 },
      orbit: { center: { x: 50, y: 50 }, radius: 20, periodInFrames: 300 },
    }],
  })
  assert.match(errorsOf(manifest), /位置已由 orbit 决定/)
})

test('orbit：与 animate.from/to 的 x/y 同时声明 ⇒ 拒收', () => {
  const manifest = base({
    tracks: [{
      id: 'p2', type: 'shape', shape: 'circle', color: '#fff',
      startFrame: 0, durationInFrames: 300,
      animate: { from: { x: 10, opacity: 0 }, to: { x: 50, opacity: 1 } },
      orbit: { center: { x: 50, y: 50 }, radius: 20, periodInFrames: 300 },
    }],
  })
  assert.match(errorsOf(manifest), /animate 中 from \/ to 的 x \/ y/)
})

test('orbit：scale / rotation / opacity 不受位置互斥限制（可同时动）', () => {
  const manifest = base({
    tracks: [{
      id: 'p3', type: 'shape', shape: 'circle', color: '#fff',
      startFrame: 0, durationInFrames: 300,
      animate: { from: { scale: 1, opacity: 0.4 }, to: { scale: 1.2, opacity: 1 } },
      orbit: { center: { x: 50, y: 50 }, radius: 20, periodInFrames: 300 },
    }],
  })
  assert.deepEqual(validateManifest(manifest).errors, [])
})

test('orbit：字段越界逐条报错（center / radius / period / direction）', () => {
  const badCenter = base({
    tracks: [{
      id: 'b1', type: 'shape', shape: 'circle', color: '#fff', startFrame: 0, durationInFrames: 300,
      orbit: { center: { x: 120, y: -5 }, radius: 10, periodInFrames: 300 },
    }],
  })
  assert.match(errorsOf(badCenter), /orbit\.center\.x 必须是 0–100/)

  const badRadius = base({
    tracks: [{
      id: 'b2', type: 'shape', shape: 'circle', color: '#fff', startFrame: 0, durationInFrames: 300,
      orbit: { center: { x: 50, y: 50 }, radius: 0, periodInFrames: 300 },
    }],
  })
  assert.match(errorsOf(badRadius), /orbit\.radius 必须是 \(0, 100\]/)

  const badPeriod = base({
    tracks: [{
      id: 'b3', type: 'shape', shape: 'circle', color: '#fff', startFrame: 0, durationInFrames: 300,
      orbit: { center: { x: 50, y: 50 }, radius: 10, periodInFrames: -3 },
    }],
  })
  assert.match(errorsOf(badPeriod), /orbit\.periodInFrames 必须是 > 0/)

  const badDirection = base({
    tracks: [{
      id: 'b4', type: 'shape', shape: 'circle', color: '#fff', startFrame: 0, durationInFrames: 300,
      orbit: { center: { x: 50, y: 50 }, radius: 10, periodInFrames: 300, direction: 'up' },
    }],
  })
  assert.match(errorsOf(badDirection), /orbit\.direction 非法/)
})

// ───────────────────────── A2：fx 校验 ─────────────────────────

test('fx：白名单内通过，白名单外拒收，数组写法拒收', () => {
  for (const fx of ['glow', 'stroke', 'shadow', 'blur', 'maskFade']) {
    const manifest = base({
      tracks: [{ id: `f-${fx}`, type: 'textCard', variant: 'title', text: 'X', startFrame: 0, durationInFrames: 300, fx }],
    })
    assert.deepEqual(validateManifest(manifest).errors, [], `${fx} 应当合法`)
  }
  const bogus = base({
    tracks: [{ id: 'f-bad', type: 'textCard', variant: 'title', text: 'X', startFrame: 0, durationInFrames: 300, fx: 'sparkle' }],
  })
  assert.match(errorsOf(bogus), /fx 非法/)

  const asArray = base({
    tracks: [{ id: 'f-arr', type: 'textCard', variant: 'title', text: 'X', startFrame: 0, durationInFrames: 300, fx: ['glow', 'blur'] }],
  })
  assert.match(errorsOf(asArray), /fx 非法/, '单值枚举：数组必须拒收')
})

// ───────────────────────── A1：shape:'path' 校验 ─────────────────────────

test('shape:"path"：缺 d 拒收；给了 d 与 draw 通过', () => {
  const missingD = base({
    tracks: [{ id: 'pth', type: 'shape', shape: 'path', color: '#7DD3FC', startFrame: 0, durationInFrames: 300 }],
  })
  assert.match(errorsOf(missingD), /必须给 SVG path 的 d/)

  const ok = base({
    tracks: [{
      id: 'pth-ok', type: 'shape', shape: 'path', color: '#7DD3FC', strokeWidth: 0.8,
      d: 'M 12 74 C 32 40, 58 88, 86 30', startFrame: 0, durationInFrames: 300,
      draw: { to: 1, durationInFrames: 90, easing: 'easeInOut' },
    }],
  })
  assert.deepEqual(validateManifest(ok).errors, [])
})

test('shape:"path"：draw.to 越界 / strokeWidth 越界 拒收', () => {
  const badTo = base({
    tracks: [{
      id: 'p-bad-to', type: 'shape', shape: 'path', color: '#fff', d: 'M 0 0 L 100 100',
      startFrame: 0, durationInFrames: 300, draw: { to: 1.5, durationInFrames: 60 },
    }],
  })
  assert.match(errorsOf(badTo), /draw\.to 必须是 0–1/)

  const badStroke = base({
    tracks: [{
      id: 'p-bad-sw', type: 'shape', shape: 'path', color: '#fff', d: 'M 0 0 L 100 100',
      strokeWidth: 0, startFrame: 0, durationInFrames: 300,
    }],
  })
  assert.match(errorsOf(badStroke), /strokeWidth 必须是 \(0, 100\]/)
})

test('shape 新族（arrow / triangle / star / polygon）通过校验', () => {
  for (const shape of ['arrow', 'triangle', 'star', 'polygon']) {
    const manifest = base({
      tracks: [{
        id: `s-${shape}`, type: 'shape', shape, color: '#F59E0B',
        box: { x: 40, y: 40, w: 10, h: 10 }, startFrame: 0, durationInFrames: 300,
      }],
    })
    assert.deepEqual(validateManifest(manifest).errors, [], `${shape} 应当合法`)
  }
})

test('非 path 形状写 d / draw ⇒ 不拒收，但明确告警「不生效」', () => {
  const manifest = base({
    tracks: [{
      id: 'c-1', type: 'shape', shape: 'circle', color: '#fff',
      d: 'M 0 0 L 10 10', draw: { to: 1, durationInFrames: 60 },
      startFrame: 0, durationInFrames: 300,
    }],
  })
  const result = validateManifest(manifest)
  assert.deepEqual(result.errors, [], '容忍冗余，不阻断')
  assert.ok(result.warnings.some((w) => w.includes('d 只在 shape:\'path\' 上生效')), result.warnings.join('；'))
  assert.ok(result.warnings.some((w) => w.includes('draw 只在 shape:\'path\' 上生效')), result.warnings.join('；'))
})

// ───────────────────────── A4：新转场 ─────────────────────────

test('transition：四种新效果通过，非法效果拒收', () => {
  for (const effect of ['wipeLeft', 'wipeRight', 'clock', 'flipX']) {
    const manifest = base({
      tracks: [
        { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 200 },
        { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 188, durationInFrames: 112 },
        { id: 'tr', type: 'transition', effect, fromTrackId: 'a', toTrackId: 'b', startFrame: 188, durationInFrames: 12 },
      ],
    })
    assert.deepEqual(validateManifest(manifest).errors, [], `${effect} 应当合法`)
  }
  const bogus = base({
    tracks: [
      { id: 'a', type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: 200 },
      { id: 'b', type: 'textCard', variant: 'title', text: 'B', startFrame: 188, durationInFrames: 112 },
      { id: 'tr', type: 'transition', effect: 'spin', fromTrackId: 'a', toTrackId: 'b', startFrame: 188, durationInFrames: 12 },
    ],
  })
  assert.match(errorsOf(bogus), /effect 非法/)
})

// ───────────────────────── B1：audioViz 轨道 ─────────────────────────

test('audioViz：合法声明通过（含 mode / position 缺省）', () => {
  const manifest = base({
    tracks: [
      { id: 'a-1', type: 'textCard', variant: 'title', text: '标题', startFrame: 0, durationInFrames: 300 },
      {
        id: 'viz', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3',
        startFrame: 0, durationInFrames: 300, bars: 32, mode: 'mirror', gain: 1.8,
        heightPercent: 24, position: 'bottom', color: '#38BDF8', fx: 'maskFade',
      },
    ],
  })
  const result = validateManifest(manifest)
  assert.deepEqual(result.errors, [], result.errors.join('；'))
})

test('audioViz：src 缺失 / 外链 / 参数越界 全部拒收', () => {
  const cases = [
    [{ id: 'v1', type: 'audioViz', startFrame: 0, durationInFrames: 300 }, /src 必须是/],
    [{ id: 'v2', type: 'audioViz', src: 'https://evil.example/bgm.mp3', startFrame: 0, durationInFrames: 300 }, /src 必须是/],
    [{ id: 'v3', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3', startFrame: 0, durationInFrames: 300, bars: 200 }, /bars 必须是 1–128/],
    [{ id: 'v4', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3', startFrame: 0, durationInFrames: 300, mode: 'wave' }, /mode 非法/],
    [{ id: 'v5', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3', startFrame: 0, durationInFrames: 300, gain: 9 }, /gain 必须是 0–4/],
    [{ id: 'v6', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3', startFrame: 0, durationInFrames: 300, heightPercent: 0 }, /heightPercent 必须是 \(0, 100\]/],
    [{ id: 'v7', type: 'audioViz', src: '/canvas-studio/assets/p1/bgm.mp3', startFrame: 0, durationInFrames: 300, position: 'middle' }, /position 只允许 bottom \/ top/],
  ]
  for (const [track, pattern] of cases) {
    const manifest = base({ tracks: [{ id: 'title', type: 'textCard', variant: 'title', text: 'T', startFrame: 0, durationInFrames: 300 }, track] })
    assert.match(errorsOf(manifest), pattern, `${track.id} 应当被拒收`)
  }
})

// ───────────────────────── 契约外字段告警（子对象也要扫） ─────────────────────────

test('collectUnknownFieldWarnings：orbit / orbit.center / draw 的子对象字段都能被抓到', () => {
  const warnings = collectUnknownFieldWarnings(base({
    tracks: [{
      id: 'w-1', type: 'shape', shape: 'path', color: '#fff',
      d: 'M 0 0 L 100 100', startFrame: 0, durationInFrames: 300,
      orbit: { center: { x: 50, y: 50, z: 1 }, radius: 20, periodInFrames: 300, centerX: 40 },
      draw: { to: 1, durationInFrames: 60, ease: 'linear' },
    }],
  }))
  const joined = warnings.join('；')
  assert.ok(joined.includes('orbit 含契约外字段 "centerX"'), joined)
  assert.ok(joined.includes('orbit.center 含契约外字段 "z"'), joined)
  assert.ok(joined.includes('draw 含契约外字段 "ease"'), joined)
})

// ───────────────────── 音轨构成：唯一实现 + 8 值穷举 ─────────────────────

test('audioCompositionFrom：三布尔正交展开的 8 种组合', () => {
  assert.equal(audioCompositionFrom({ hasNative: true, hasBgm: false, hasVoiceOver: false }), 'native')
  assert.equal(audioCompositionFrom({ hasNative: true, hasBgm: true, hasVoiceOver: false }), 'native+bgm')
  assert.equal(audioCompositionFrom({ hasNative: true, hasBgm: false, hasVoiceOver: true }), 'native+voiceOver')
  assert.equal(audioCompositionFrom({ hasNative: true, hasBgm: true, hasVoiceOver: true }), 'native+bgm+voiceOver')
  assert.equal(audioCompositionFrom({ hasNative: false, hasBgm: true, hasVoiceOver: false }), 'bgm')
  assert.equal(audioCompositionFrom({ hasNative: false, hasBgm: false, hasVoiceOver: true }), 'voiceOver')
  assert.equal(audioCompositionFrom({ hasNative: false, hasBgm: true, hasVoiceOver: true }), 'bgm+voiceOver')
  assert.equal(audioCompositionFrom({ hasNative: false, hasBgm: false, hasVoiceOver: false }), 'none')
})

test('deriveAudioComposition：与 audioCompositionFrom 同结论（角标与工具结果同源）', () => {
  const videoTrack = { id: 'n1', type: 'video', src: '/canvas-studio/assets/p1/c.mp4', startFrame: 0, durationInFrames: 100 }
  const withBoth = {
    id: 'c1',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 100 },
    tracks: [videoTrack],
    audio: { bgmUrl: '/canvas-studio/assets/p1/bgm.mp3', voiceOverUrl: '/canvas-studio/assets/p1/vo.mp3' },
  }
  assert.equal(deriveAudioComposition(withBoth), 'native+bgm+voiceOver')
  assert.equal(
    deriveAudioComposition(withBoth),
    audioCompositionFrom({ hasNative: true, hasBgm: true, hasVoiceOver: true }),
    '两条路径必须调用同一实现，不得各自 if 链',
  )

  const voiceOnly = {
    id: 'c2',
    meta: { title: 't', width: 1280, height: 720, fps: 30, durationInFrames: 100 },
    tracks: [{ id: 'tc', type: 'textCard', variant: 'title', text: 'X', startFrame: 0, durationInFrames: 100 }],
    audio: { voiceOverUrl: '/canvas-studio/assets/p1/vo.mp3' },
  }
  assert.equal(deriveAudioComposition(voiceOnly), 'voiceOver', 'D6：有旁白就是旁白，不再并入「纯 BGM」')
})
