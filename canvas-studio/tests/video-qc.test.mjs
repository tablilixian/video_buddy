/**
 * OPT-10（2026-10-26）：视频镜头质检（qc_shot videoRefs 通道）单测。
 *
 * 覆盖三层：抽帧时间点规划（纯函数）、多帧结论聚合（纯函数）、工具入参二选一校验。
 * 每条规则一个独立断言点 —— 删掉 video-qc.ts 里任一分支，对应 test 必须变红
 * （铁律：守卫必须能反向变红）。ffmpeg 抽帧 / 上传 / VLM 链路以注入替身在
 * runVideoShotQc 层覆盖（见文件尾集成用例）。
 *
 * 直连 Host tsc 编译产物 lib/video-qc.js（零 Remotion 依赖）。
 * 定向跑：node --test tests/video-qc.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planQcFrameSeeks,
  aggregateVideoQc,
  validateQcTargetInput,
  runVideoShotQc,
  buildVideoQcRecord,
} from '../lib/video-qc.js'

// ───────── 抽帧时间点规划 ─────────

test('planQcFrameSeeks：8s 素材 → 首/中/末三点（末帧内缩 0.05s）', () => {
  assert.deepEqual(planQcFrameSeeks(8), [0, 4, 7.95])
})

test('planQcFrameSeeks：时长未知/非正 → 只抽首帧', () => {
  assert.deepEqual(planQcFrameSeeks(0), [0])
  assert.deepEqual(planQcFrameSeeks(-2), [0])
  assert.deepEqual(planQcFrameSeeks(Number.NaN), [0])
})

test('planQcFrameSeeks：短视频三点挤在 0.1s 内 → 近邻去重只抽首帧', () => {
  assert.deepEqual(planQcFrameSeeks(0.08), [0])
  assert.deepEqual(planQcFrameSeeks(0.15), [0])
  // 1s 素材三点仍在阈值外：0 / 0.5 / 0.95
  assert.deepEqual(planQcFrameSeeks(1), [0, 0.5, 0.95])
})

// ───────── 多帧结论聚合 ─────────

test('aggregateVideoQc：最差档 —— 任一 fail → fail，漂移项带帧号前缀', () => {
  const merged = aggregateVideoQc([
    { seek: 0, verdict: 'pass', drifts: [], reason: '一致' },
    { seek: 4, verdict: 'fail', drifts: ['外套颜色漂移'], reason: '外套变色' },
    { seek: 7.95, verdict: 'pass', drifts: [], reason: '一致' },
  ])
  assert.equal(merged.verdict, 'fail')
  assert.deepEqual(merged.drifts, ['帧2(4.00s): 外套颜色漂移'])
  assert.ok(merged.reason.includes('帧2') && merged.reason.includes('外套变色'), `reason 要汇总各帧与最差档理由：${merged.reason}`)
})

test('aggregateVideoQc：无 fail 有 warn → warn；全 pass → pass', () => {
  const warn = aggregateVideoQc([
    { seek: 0, verdict: 'pass', drifts: [], reason: '一致' },
    { seek: 2, verdict: 'warn', drifts: [], reason: '画面模糊' },
  ])
  assert.equal(warn.verdict, 'warn')
  assert.equal(warn.drifts.length, 0)

  const pass = aggregateVideoQc([
    { seek: 0, verdict: 'pass', drifts: [], reason: '一致' },
    { seek: 2, verdict: 'pass', drifts: [], reason: '一致' },
  ])
  assert.equal(pass.verdict, 'pass')
})

test('aggregateVideoQc：空帧列表 → warn 兜底（不臆造 pass）', () => {
  const merged = aggregateVideoQc([])
  assert.equal(merged.verdict, 'warn')
})

// ───────── 工具入参二选一 ─────────

test('validateQcTargetInput：都传 / 都缺 / 合法单传', () => {
  assert.throws(() => validateQcTargetInput('ref-abc', ['node-v1']), /二选一/, '都传必须拒')
  assert.throws(() => validateQcTargetInput(undefined, undefined), /缺少被检镜头/, '都缺必须拒')
  assert.throws(() => validateQcTargetInput('  ', []), /缺少被检镜头/, '空白等价于缺')

  const onlyImage = validateQcTargetInput('ref-abc', undefined)
  assert.deepEqual(onlyImage, { videoRefs: [], filename: 'ref-abc' })

  const onlyVideo = validateQcTargetInput(undefined, [' node-v1 ', ''])
  assert.deepEqual(onlyVideo, { videoRefs: ['node-v1'], filename: '' })
})

// ───────── runVideoShotQc 集成（ffmpeg/上传/VLM 全替身） ─────────

/** 造一个最小 registry 替身：assetsDir 指向临时目录，无需真项目。 */
function fakeRegistry(assetsDir) {
  return { assetsDir: () => assetsDir }
}

/** 造替身 ffmpeg：探测模式回 8s 时长到 stderr；抽取模式产出伪 PNG。 */
function fakeFfmpegScript(dir) {
  const script = join(dir, 'fake-ffmpeg.sh')
  writeFileSync(script, [
    '#!/bin/sh',
    'out=""',
    'prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "-y" ]; then out="$a"; fi',
    '  prev="$a"',
    'done',
    'if [ -n "$out" ]; then',
    '  printf \'PNG\' > "$out" && exit 0',
    'fi',
    'echo "Input #0, mov,mp4 from \'x.mp4\':" >&2',
    'echo "  Duration: 00:00:08.00, start: 0.000000, bitrate: 1000 kb/s" >&2',
    'exit 1',
    '',
  ].join('\n'), { mode: 0o755 })
  return script
}

test('runVideoShotQc：抽帧→逐帧 QC→聚合，结论定位回源视频节点（全替身）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-qc-'))
  try {
    const videoFile = join(dir, 'clip.mp4')
    writeFileSync(videoFile, 'fake')
    const nodes = [
      { id: 'node-v1', kind: 'video', url: '/canvas-studio/assets/p1/clip.mp4', title: 'S1 镜头' },
    ]
    const qcInputs = []
    const result = await runVideoShotQc(nodes, fakeRegistry(dir), 'p1', 'node-v1', {
      expect: '女主穿红色外套',
      ffmpegPath: fakeFfmpegScript(dir),
      upload: async (bytes) => `qc-frame-${bytes.length}-${qcInputs.length}.png`,
      analyze: async (filename) => {
        qcInputs.push(filename)
        return '{"verdict":"FAIL","drifts":["外套是蓝色的"],"reason":"颜色不符"}'
      },
    })
    assert.equal(result.frameCount, 3, '8s 素材应抽首/中/末三帧')
    assert.equal(qcInputs.length, 3, '逐帧各走一次 VLM')
    assert.equal(result.verdict, 'fail', '三帧全 fail → 聚合 fail')
    assert.equal(result.nodeId, 'node-v1', '结论要能定位回源视频节点')
    assert.ok(result.drifts.every((d) => d.startsWith('帧')), '漂移项要带帧号前缀')
    assert.ok(result.frames.map((f) => f.seek).includes(7.95), '末帧要内缩 0.05s')

    const record = buildVideoQcRecord(
      { verdict: result.verdict, drifts: result.drifts, reason: result.reason },
      '女主穿红色外套', 0,
    )
    assert.equal(record.verdict, 'fail')
    assert.equal(record.attempts, 1, 'video 通道不参与预算重跑，attempts 恒 1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runVideoShotQc：视频文件不存在 → 可执行中文报错（句柄教育）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-qc-miss-'))
  try {
    const nodes = [{ id: 'node-v1', kind: 'video', url: '/canvas-studio/assets/p1/gone.mp4', title: 'S1' }]
    await assert.rejects(
      () => runVideoShotQc(nodes, fakeRegistry(dir), 'p1', 'node-v1', {
        expect: 'x',
        ffmpegPath: '/bin/echo',
        upload: async () => 'x.png',
        analyze: async () => '{"verdict":"PASS","drifts":[],"reason":"ok"}',
      }),
      /视频文件不存在/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
