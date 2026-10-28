/**
 * S1（2026-10-28 · CV-040 收口）：音频契约「文案钉回行为」测试。
 *
 * 同款做法见 manifest-contract-doc.test.mjs（CV-365）：AUDIO_COMPOSITION_HINTS 的
 * 悬停文案必须与实际行为一致 —— 此前 `bgm`/`none` 写着「各镜环境声已丢弃」，而
 * CV-209 之后原生音轨早已是多镜主声轨，用户悬停角标看到的是错的行为解释。
 *
 * 同时覆盖 audio-timeline.ts 的三条退出条件（计划 §S1）：
 * - `compositionFromTimeline` 8 枚举映射 8 条断言；
 * - `resolveAudioTimeline` / `buildAudioGraph` 全分支行为；
 * - 文案漂移断言（「已丢弃」等过时表述出现即红）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_COMPOSITION_LABELS,
  AUDIO_COMPOSITION_HINTS,
  AUDIO_COMPOSITION_DERIVATION,
} from '../lib/contracts/canvas.js'
import {
  resolveAudioTimeline,
  compositionFromTimeline,
  compositionFromPresence,
  timelineFromComposition,
  buildAudioGraph,
  describeTimeline,
  duckRatioOf,
  roleLabel,
} from '../lib/audio-timeline.js'
import { audioCompositionFrom } from '../lib/remotion/manifest.js'

/** 快捷造段（url 必填，startSec 缺省 0）。 */
function seg(role, overrides = {}) {
  return { url: 'a.mp4', startSec: 0, role, ...overrides }
}

// ---------------------------------------------------------------------------
// 1. 八枚举映射：compositionFromTimeline 的 8 条断言（退出条件）
// ---------------------------------------------------------------------------
test('compositionFromTimeline：8 枚举映射逐条成立（段角色集合 → 枚举）', () => {
  assert.equal(compositionFromTimeline({ segments: [seg('native')] }), 'native')
  assert.equal(compositionFromTimeline({ segments: [seg('native'), seg('bgm')] }), 'native+bgm')
  assert.equal(compositionFromTimeline({ segments: [seg('native'), seg('voiceOver')] }), 'native+voiceOver')
  assert.equal(compositionFromTimeline({ segments: [seg('native'), seg('bgm'), seg('voiceOver')] }), 'native+bgm+voiceOver')
  assert.equal(compositionFromTimeline({ segments: [seg('bgm')] }), 'bgm')
  assert.equal(compositionFromTimeline({ segments: [seg('voiceOver')] }), 'voiceOver')
  assert.equal(compositionFromTimeline({ segments: [seg('bgm'), seg('voiceOver')] }), 'bgm+voiceOver')
  assert.equal(compositionFromTimeline({ segments: [] }), 'none')
})

test('compositionFromTimeline 与兼容包装 audioCompositionFrom 三布尔口径一致（8/8）', () => {
  const combos = [
    [{ hasNative: true, hasBgm: false, hasVoiceOver: false }, [seg('native')]],
    [{ hasNative: true, hasBgm: true, hasVoiceOver: false }, [seg('native'), seg('bgm')]],
    [{ hasNative: true, hasBgm: false, hasVoiceOver: true }, [seg('native'), seg('voiceOver')]],
    [{ hasNative: true, hasBgm: true, hasVoiceOver: true }, [seg('native'), seg('bgm'), seg('voiceOver')]],
    [{ hasNative: false, hasBgm: true, hasVoiceOver: false }, [seg('bgm')]],
    [{ hasNative: false, hasBgm: false, hasVoiceOver: true }, [seg('voiceOver')]],
    [{ hasNative: false, hasBgm: true, hasVoiceOver: true }, [seg('bgm'), seg('voiceOver')]],
    [{ hasNative: false, hasBgm: false, hasVoiceOver: false }, []],
  ]
  for (const [presence, segments] of combos) {
    assert.equal(audioCompositionFrom(presence), compositionFromTimeline({ segments }), `三布尔 ${JSON.stringify(presence)} 应与时间轴派生同值`)
    assert.equal(compositionFromPresence(presence), audioCompositionFrom(presence), '唯一分类实现应被两条入口共用')
  }
})

// ---------------------------------------------------------------------------
// 2. 文案钉回行为（CV-040 收口计划 §1.2 #7：「已丢弃」与 CV-209 行为冲突）
// ---------------------------------------------------------------------------
test('AUDIO_COMPOSITION_HINTS：不再宣称「环境声已丢弃」，bgm/none 文案与实际行为一致', () => {
  for (const [key, hint] of Object.entries(AUDIO_COMPOSITION_HINTS)) {
    assert.ok(!hint.includes('已丢弃'), `hints.${key} 不得再写「已丢弃」（CV-209 后原生音轨保留为主声轨），实得「${hint}」`)
    assert.ok(hint.length > 0, `hints.${key} 不得为空`)
  }
  // bgm 的行为语义：只有「没有原生段」时才会派生出 bgm —— 文案的「唯一声轨」必须对得上。
  assert.equal(compositionFromTimeline({ segments: [seg('bgm')] }), 'bgm')
  assert.ok(AUDIO_COMPOSITION_HINTS.bgm.includes('唯一声轨'), `bgm 文案应说明 BGM 是唯一声轨，实得「${AUDIO_COMPOSITION_HINTS.bgm}」`)
  // none 的行为语义：任何段都没有（三布尔全 false），不是「多镜拼接丢了声」。
  assert.equal(compositionFromTimeline({ segments: [] }), 'none')
  assert.ok(AUDIO_COMPOSITION_HINTS.none.includes('无任何声源'), `none 文案应说明是无任何声源，实得「${AUDIO_COMPOSITION_HINTS.none}」`)
})

test('AUDIO_COMPOSITION_LABELS/HINTS：8 键齐全（新增枚举漏文案当场红）', () => {
  const enums = ['native', 'native+bgm', 'native+voiceOver', 'native+bgm+voiceOver', 'bgm', 'voiceOver', 'bgm+voiceOver', 'none']
  assert.deepEqual(Object.keys(AUDIO_COMPOSITION_LABELS).sort(), [...enums].sort())
  assert.deepEqual(Object.keys(AUDIO_COMPOSITION_HINTS).sort(), [...enums].sort())
})

test('AUDIO_COMPOSITION_DERIVATION：说明「枚举由时间轴派生」并指到唯一实现', () => {
  assert.ok(AUDIO_COMPOSITION_DERIVATION.includes('AudioTimeline'), '应点名 AudioTimeline')
  assert.ok(AUDIO_COMPOSITION_DERIVATION.includes('派生'), '应说明派生关系')
  assert.ok(AUDIO_COMPOSITION_DERIVATION.includes('只读反推'), '应说明老数据处理方式（D-03）')
})

// ---------------------------------------------------------------------------
// 3. timelineFromComposition（D-03：老数据只读反推，不写回）
// ---------------------------------------------------------------------------
test('timelineFromComposition：8 枚举反推后重新派生回原值（roundtrip），且不带时间/来源信息', () => {
  const enums = ['native', 'native+bgm', 'native+voiceOver', 'native+bgm+voiceOver', 'bgm', 'voiceOver', 'bgm+voiceOver', 'none']
  for (const composition of enums) {
    const timeline = timelineFromComposition(composition)
    assert.equal(compositionFromTimeline(timeline), composition, `${composition} 反推→派生应回原值`)
    for (const segment of timeline.segments) {
      assert.equal(segment.url, '', '反推段无来源（url 空串标记「来源未知」）')
      assert.equal(segment.startSec, 0, '反推段无时间信息')
    }
  }
  assert.deepEqual(timelineFromComposition('native+bgm').segments.map((s) => s.role), ['native', 'bgm'])
})

// ---------------------------------------------------------------------------
// 4. resolveAudioTimeline：校验（error）+ 归一化（warning）
// ---------------------------------------------------------------------------
test('resolveAudioTimeline：合法时间轴原样通过，ok=true', () => {
  const resolved = resolveAudioTimeline({
    fps: 25,
    durationSec: 30,
    segments: [seg('bgm', { url: 'b.mp3', gain: 0.35, fadeInSec: 1, fadeOutSec: 1 }), seg('voiceOver', { url: 'v.mp3', startSec: 5, durationSec: 3 })],
  })
  assert.equal(resolved.ok, true)
  assert.deepEqual(resolved.issues, [])
  assert.equal(resolved.timeline.segments.length, 2)
  assert.equal(resolved.timeline.segments[1].startSec, 5)
})

test('resolveAudioTimeline：结构性非法一律 error（负起点/负时长/非有限数/空url/坏角色/坏onShort/坏fade）', () => {
  const cases = [
    [seg('bgm', { startSec: -1 })],
    [seg('bgm', { durationSec: -2 })],
    [seg('bgm', { startSec: Number.NaN })],
    [seg('bgm', { durationSec: Number.POSITIVE_INFINITY })],
    [seg('bgm', { url: '' })],
    [seg('不存在的角色')],
    [seg('bgm', { onShort: 'bogus' })],
    [seg('bgm', { fadeInSec: -1 })],
    [seg('bgm', { fadeOutSec: Number.NaN })],
  ]
  for (const segments of cases) {
    const resolved = resolveAudioTimeline({ fps: 25, durationSec: 30, segments })
    assert.equal(resolved.ok, false, `应判 error：${JSON.stringify(segments)}`)
    assert.ok(resolved.issues.some((issue) => issue.severity === 'error'))
  }
})

test('resolveAudioTimeline：gain/duck 越界收拢到 0–1 并给 warning（归一化不拒绝）', () => {
  const resolved = resolveAudioTimeline({
    fps: 25, durationSec: 30,
    segments: [seg('bgm', { gain: 1.5 }), seg('voiceOver', { url: 'v.mp3', startSec: 2, duckAmount: 2 })],
  })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.timeline.segments[0].gain, 1)
  assert.equal(resolved.timeline.segments[1].duckAmount, 1)
  assert.equal(resolved.issues.filter((issue) => issue.code === 'invalid-gain').length, 2)
})

test('resolveAudioTimeline：duck 只属于旁白（非旁白段带 duckAmount → 忽略 + warning）', () => {
  const resolved = resolveAudioTimeline({
    fps: 25, durationSec: 30,
    segments: [seg('bgm', { duckAmount: 0.6 }), seg('sfx', { url: 's.mp3', startSec: 1, duckAmount: 0.6 })],
  })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.timeline.segments[0].duckAmount, undefined)
  assert.equal(resolved.timeline.segments[1].duckAmount, undefined)
  assert.equal(resolved.issues.filter((issue) => issue.code === 'duck-without-voiceOver').length, 2)
})

test('resolveAudioTimeline：onShort=loop 降级为 pad + warning（v1 不静默丢语义）', () => {
  const resolved = resolveAudioTimeline({ fps: 25, durationSec: 30, segments: [seg('bgm', { onShort: 'loop' })] })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.timeline.segments[0].onShort, 'pad')
  assert.ok(resolved.issues.some((issue) => issue.code === 'loop-unsupported' && issue.severity === 'warning'))
})

test('resolveAudioTimeline：同 role 重叠 → warning（多轨重叠不静默）；跨 role 叠放合法', () => {
  const overlap = resolveAudioTimeline({
    fps: 25, durationSec: 30,
    segments: [seg('voiceOver', { url: 'v1.mp3', startSec: 0, durationSec: 4 }), seg('voiceOver', { url: 'v2.mp3', startSec: 2, durationSec: 4 })],
  })
  assert.equal(overlap.ok, true)
  assert.ok(overlap.issues.some((issue) => issue.code === 'role-overlap'))
  const stacked = resolveAudioTimeline({
    fps: 25, durationSec: 30,
    segments: [seg('bgm', { url: 'b.mp3', durationSec: 30 }), seg('voiceOver', { url: 'v.mp3', startSec: 2, durationSec: 4 })],
  })
  assert.ok(!stacked.issues.some((issue) => issue.code === 'role-overlap'), 'bgm 与旁白本就该叠，不算重叠问题')
})

test('resolveAudioTimeline：空时间轴 → no-source warning（不拦 ok，交给调用方分流）；越片尾段 → warning', () => {
  const empty = resolveAudioTimeline({ fps: 25, durationSec: 30, segments: [] })
  assert.equal(empty.ok, true)
  assert.ok(empty.issues.some((issue) => issue.code === 'no-source'))
  const beyond = resolveAudioTimeline({
    fps: 25, durationSec: 30,
    segments: [seg('voiceOver', { url: 'v.mp3', startSec: 31, durationSec: 2 })],
  })
  assert.ok(beyond.issues.some((issue) => issue.code === 'segment-beyond-duration'))
})

test('resolveAudioTimeline：durationSec=0 归一化为缺省（用素材真实时长）；fps/durationSec 非法归 0', () => {
  const resolved = resolveAudioTimeline({ fps: Number.NaN, durationSec: 0, segments: [seg('bgm', { durationSec: 0 })] })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.timeline.segments[0].durationSec, undefined)
  assert.equal(resolved.timeline.fps, 0)
  assert.equal(resolved.timeline.durationSec, 0)
})

// ---------------------------------------------------------------------------
// 5. buildAudioGraph：filter_complex 唯一生成点
// ---------------------------------------------------------------------------
test('buildAudioGraph：单 BGM 段——统一 48k 立体声、atrim 段长、apad 补到成片时长（D-02 收口）', () => {
  const graph = buildAudioGraph({ fps: 25, durationSec: 60, segments: [seg('bgm', { url: 'b.mp3', durationSec: 30, gain: 0.8 })] })
  assert.equal(graph.inputCount, 1)
  assert.equal(graph.outputLabel, '[out]')
  assert.ok(graph.filterComplex.includes('aformat=sample_rates=48000:channel_layouts=stereo'), '所有段统一交付口径（实验 C 对策）')
  assert.ok(graph.filterComplex.includes('atrim=duration=30.000'), '段长裁切')
  assert.ok(graph.filterComplex.includes('volume=0.8'), '增益')
  assert.ok(graph.filterComplex.includes('apad=whole_dur=60.000,atrim=duration=60.000'), '短 BGM 自动补静音钉到成片时长')
  assert.ok(!graph.filterComplex.includes('amix'), '单段不混音')
})

test('buildAudioGraph：多段线性求和 amix=normalize=0；旁白 adelay 挪绝对起点', () => {
  const graph = buildAudioGraph({
    fps: 25, durationSec: 30,
    segments: [seg('bgm', { url: 'b.mp3', durationSec: 30 }), seg('voiceOver', { url: 'v.mp3', startSec: 5, durationSec: 3 })],
  })
  assert.ok(graph.filterComplex.includes('amix=inputs=2:duration=longest:normalize=0'))
  assert.ok(graph.filterComplex.includes('adelay=delays=5000:all=1'), '5s 起点的旁白')
  assert.ok(!graph.filterComplex.includes('sidechaincompress'), '未声明 duck 不压 BGM（无旁白段完全不动）')
})

test('buildAudioGraph：duck 深度 → sidechaincompress ratio；双旁白先合成 key 总线', () => {
  const single = buildAudioGraph({
    fps: 25, durationSec: 30,
    segments: [seg('bgm', { url: 'b.mp3', durationSec: 30 }), seg('voiceOver', { url: 'v.mp3', startSec: 5, durationSec: 3, duckAmount: 0.5 })],
  })
  assert.ok(single.filterComplex.includes(`sidechaincompress=threshold=0.03:ratio=${duckRatioOf(0.5)}:attack=50:release=400`), 'duck 0.5 → ratio 5')
  const dual = buildAudioGraph({
    fps: 25, durationSec: 30,
    segments: [
      seg('bgm', { url: 'b.mp3', durationSec: 30 }),
      seg('voiceOver', { url: 'v1.mp3', startSec: 5, durationSec: 3, duckAmount: 0.5 }),
      seg('voiceOver', { url: 'v2.mp3', startSec: 12, durationSec: 3, duckAmount: 0.8 }),
    ],
  })
  assert.ok(dual.filterComplex.includes('amix=inputs=2:duration=longest:normalize=0[voKey]'), '双旁白先合成 key 总线')
  assert.ok(dual.filterComplex.includes(`ratio=${duckRatioOf(0.8)}`), '取最大 duck 深度')
  assert.ok(dual.filterComplex.includes('amix=inputs=3:duration=longest:normalize=0'), '主混音 3 路')
})

test('buildAudioGraph：淡入淡出落在 adelay 之前（否则淡变落在前插静音上）', () => {
  const graph = buildAudioGraph({
    fps: 25, durationSec: 30,
    segments: [seg('voiceOver', { url: 'v.mp3', startSec: 10, durationSec: 6, fadeInSec: 1, fadeOutSec: 1 })],
  })
  const fadeIn = graph.filterComplex.indexOf('afade=t=in:st=0:d=1')
  const fadeOut = graph.filterComplex.indexOf('afade=t=out:st=5.000:d=1')
  const delay = graph.filterComplex.indexOf('adelay=delays=10000:all=1')
  assert.ok(fadeIn >= 0 && fadeOut >= 0 && delay >= 0, `应同时含淡变与 delay，实得 ${graph.filterComplex}`)
  assert.ok(fadeIn < delay && fadeOut < delay, '淡变必须在 adelay 之前')
})

test('buildAudioGraph：成片时长未知时不 apad；空时间轴回数字静音源', () => {
  const noDur = buildAudioGraph({ fps: 25, durationSec: 0, segments: [seg('bgm', { url: 'b.mp3' })] })
  assert.ok(noDur.filterComplex.includes('anull'), '无时长 → 不钉长度')
  assert.ok(!noDur.filterComplex.includes('apad'))
  const empty = buildAudioGraph({ fps: 25, durationSec: 30, segments: [] })
  assert.ok(empty.filterComplex.startsWith('anullsrc=r=48000:cl=stereo'), '空时间轴 → 数字静音')
})

test('duckRatioOf：0→1（不压）、0.5→5、1→9（满压约 9:1）', () => {
  assert.equal(duckRatioOf(0), 1)
  assert.equal(duckRatioOf(0.5), 5)
  assert.equal(duckRatioOf(1), 9)
})

// ---------------------------------------------------------------------------
// 6. describeTimeline：模型自查通道
// ---------------------------------------------------------------------------
test('describeTimeline：空轴/有段/反推段的中文摘要', () => {
  assert.ok(describeTimeline({ fps: 25, durationSec: 30, segments: [] }).includes('无任何音频段'))
  const text = describeTimeline({
    fps: 25, durationSec: 30,
    segments: [seg('bgm', { url: 'music/b.mp3', durationSec: 30, gain: 0.35, fadeInSec: 1 }), seg('voiceOver', { url: 'v.mp3', startSec: 5, durationSec: 3, duckAmount: 0.5, onShort: 'error' })],
  })
  assert.ok(text.includes('配乐（BGM）'), `应含角色中文，实得 ${text}`)
  assert.ok(text.includes('旁白'))
  assert.ok(text.includes('0.00s–30.00s'), 'BGM 起止')
  assert.ok(text.includes('5.00s–8.00s'), '旁白起止')
  assert.ok(text.includes('音量 0.35'), '增益回显')
  assert.ok(text.includes('压 BGM 深度 0.5'), 'duck 回显')
  assert.ok(text.includes('素材过短即报错'), 'onShort=error 回显')
  assert.ok(text.includes('b.mp3'), '素材文件名回显')
  const derived = describeTimeline(timelineFromComposition('bgm'))
  assert.ok(derived.includes('来源未知'), '老数据反推段必须标明来源未知')
})

test('roleLabel：四角色中文名', () => {
  assert.equal(roleLabel('native'), '原生环境声')
  assert.equal(roleLabel('bgm'), '配乐（BGM）')
  assert.equal(roleLabel('voiceOver'), '旁白')
  assert.equal(roleLabel('sfx'), '音效')
})
