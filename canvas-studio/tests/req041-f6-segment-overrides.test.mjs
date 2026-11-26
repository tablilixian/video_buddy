/**
 * REQ-041 F6（2026-11-26）· **段级手工轨覆盖**（`build/overrides/`）的行为守卫。
 *
 * ## 为什么需要有这一层
 *
 * 真机会话（超级月亮 2026-11-25）三条原话：
 * ①「若用 writeTo 重编 manifest，会把第 2 屏手工编写的椭圆轨道重建成旧文字卡」
 * ②「拆分要重新生成 spec 段表，这会覆盖 manifest，所以我会在重编后恢复第 2 屏的椭圆轨道和音频」
 * ③「spec 只能表达卡 + 文案 + 格位；沿路径运动 / 分段停顿 / 引线标注表达不了」
 *
 * 即手工轨**没有合法住所**：写 manifest 会被 scaffold 冲掉，写 spec 超出 spec 语义。
 * F6 给它们一个独立住所，本文件钉住下面六件事：
 *
 * - 合并是**纯新增**（层叠序：既有轨原位不动，手工轨追加在末尾 = 最上层）；
 * - 时间窗越出本段 / id 与既有轨同名 / 用 `startAfter` ⇒ 写入即拒（不留给渲染期炸）；
 * - 段窗漂移 / 段表里没这个 ref ⇒ **不合并并说清原因**（绝对帧号错位比丢失更难查）；
 * - 改 override ⇒ **只有该段 hash 变**，其余段命中（F1/F2 的缓存契约在 F6 上仍然成立）；
 * - 写盘先留档；坏文件逐份跳过（一份坏 override 不许毁掉整片）；
 * - 手工轨**不落** `build/manifest.json`（它同时是下次渲染的输入，写进去就成了删不掉的僵尸轨）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SEGMENT_OVERRIDES_DIR,
  SEGMENT_OVERRIDES_VERSION,
  applySegmentOverrides,
  mergeOverrideTracks,
  normalizeOverrideRef,
  overrideFileName,
  overrideReceiptLines,
  readOverrideDoc,
  validateOverrideTracks,
  withoutOverrideTracks,
} from '../lib/segment-overrides.js'
import {
  overrideCountByRef,
  overrideTrackIds,
  readProjectOverrides,
  removeProjectOverride,
  writeProjectOverride,
} from '../lib/segment-overrides-io.js'
import { planSegmentTable } from '../lib/segment-table.js'
import { manifestGlobalsFingerprint, segmentHash } from '../lib/shot-cache.js'

const FPS = 30

function textCard(id, startFrame, durationInFrames, text = id) {
  // `variant` 是 textCard 的必填项（`TEXT_VARIANTS`）——夹具必须本身合法，
  // 否则校验报的是夹具的错，测不出 override 的问题。
  return { id, type: 'textCard', variant: 'subtitle', startFrame, durationInFrames, text }
}

/** 两段片：s1 = [0,200)、s2 = [200,400)；`meta.segments` 与 spec 都整表对齐。 */
function buildManifest(tracks) {
  return {
    id: 'm1',
    meta: {
      title: 't',
      fps: FPS,
      durationInFrames: 400,
      width: 1920,
      height: 1080,
      backgroundColor: '#000',
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 200 },
      ],
    },
    tracks,
  }
}

const SPEC = {
  meta: { fps: FPS, durationSec: 400 / FPS },
  sections: [{ id: 's1', durationSec: 200 / FPS }, { id: 's2', durationSec: 200 / FPS }],
}

/** 一段的手工轨：圆点绕圈（真机那次「椭圆轨道」的最小形态）。 */
function orbitTrack(id, startFrame, durationInFrames) {
  return {
    id,
    type: 'shape',
    shape: 'circle',
    color: '#ffcc66',
    startFrame,
    durationInFrames,
    orbit: { center: { x: 50, y: 50 }, radius: 20, periodInFrames: durationInFrames },
  }
}

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'cs-f6-'))
  mkdirSync(join(dir, 'build'), { recursive: true })
  return dir
}

function planOf(manifest) {
  const plan = planSegmentTable({ manifest, spec: SPEC })
  assert.notEqual(plan, null, '夹具必须能切出段')
  return plan
}

// ─────────────────── 1. 合并语义：纯新增 + 层叠序 ───────────────────

test('F6：手工轨追加在末尾（= 最上层），既有轨原位不动', () => {
  const base = [textCard('V2', 0, 200), textCard('V3', 200, 200)]
  const merged = mergeOverrideTracks(base, [orbitTrack('hi-orbit-1', 210, 60)])
  assert.deepEqual(merged.map((track) => track.id), ['V2', 'V3', 'hi-orbit-1'])
  assert.deepEqual(base.map((track) => track.id), ['V2', 'V3'], '不许改入参（纯函数）')
})

// ─────────────────── 2. 写入即校验（三条脏参数） ───────────────────

test('F6：时间窗越出本段 ⇒ 拒收，并报出两个窗口', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const check = validateOverrideTracks({
    manifest,
    artifacts: plan.artifacts,
    ref: 'spec:s2',
    // s2 = [200,400)，这条从 150 起 ⇒ 一半落在 s1
    tracks: [orbitTrack('hi-orbit-1', 150, 60)],
  })
  assert.equal(check.ok, false)
  const text = check.issues.join('\n')
  assert.match(text, /越出本段/, text)
  assert.match(text, /200–400/, '必须把本段帧窗写出来，否则模型不知道该改成多少')
})

test('F6：id 与既有轨同名 ⇒ 拒收（手工轨只做新增）', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const check = validateOverrideTracks({
    manifest,
    artifacts: plan.artifacts,
    ref: 'spec:s2',
    tracks: [{ ...orbitTrack('V2', 210, 60) }],
  })
  assert.equal(check.ok, false)
  assert.match(check.issues.join('\n'), /只做\*\*新增\*\*/)
})

test('F6：用 startAfter ⇒ 拒收（顺序衔接会随 spec 重编漂移）', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const check = validateOverrideTracks({
    manifest,
    artifacts: plan.artifacts,
    ref: 'spec:s2',
    tracks: [{ id: 'hi-1', type: 'textCard', text: 'x', startAfter: { trackId: 'V2' } }],
  })
  assert.equal(check.ok, false)
  assert.match(check.issues.join('\n'), /startAfter/)
})

test('F6：合法手工轨通过校验（orbit 是轨级字段，不需要新轨型）', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const check = validateOverrideTracks({
    manifest,
    artifacts: plan.artifacts,
    ref: 'spec:s2',
    tracks: [orbitTrack('hi-orbit-1', 210, 180)],
  })
  assert.equal(check.ok, true, check.ok ? '' : check.issues.join('；'))
  assert.equal(check.tracks.length, 1)
})

// ─────────────────── 3. 合并入口：两种跳过 + 回执文案 ───────────────────

test('F6：段窗变了 ⇒ 不合并，并报「写时 / 现在」两个窗口', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const result = applySegmentOverrides({
    manifest,
    artifacts: plan.artifacts,
    overrides: [{
      version: SEGMENT_OVERRIDES_VERSION,
      ref: 'spec:s2',
      // 写时是 [260,400) —— 后来 spec 把这一屏改短了 60 帧
      anchor: { startFrame: 260, frames: 140 },
      updatedAt: 0,
      tracks: [orbitTrack('hi-orbit-1', 270, 60)],
    }],
  })
  assert.equal(result.manifest, manifest, '不合并就原样返回同一个对象')
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /段窗已变/)
  assert.match(result.skipped[0].reason, /260\+140/)
  assert.match(result.skipped[0].reason, /200\+200/)
})

test('F6：段表里没有这个 ref ⇒ 跳过并说明（不静默丢弃）', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const result = applySegmentOverrides({
    manifest,
    artifacts: plan.artifacts,
    overrides: [{
      version: SEGMENT_OVERRIDES_VERSION,
      ref: 'spec:s9',
      anchor: { startFrame: 0, frames: 200 },
      updatedAt: 0,
      tracks: [orbitTrack('hi-orbit-1', 10, 60)],
    }],
  })
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /段表里没有这一段/)
})

test('F6：合并成功时回执点明「不在 spec 里、重编不会丢」', () => {
  const manifest = buildManifest([textCard('V2', 200, 200)])
  const plan = planOf(manifest)
  const result = applySegmentOverrides({
    manifest,
    artifacts: plan.artifacts,
    overrides: [{
      version: SEGMENT_OVERRIDES_VERSION,
      ref: 'spec:s2',
      anchor: { startFrame: 200, frames: 200 },
      updatedAt: 0,
      tracks: [orbitTrack('hi-orbit-1', 210, 180)],
    }],
  })
  assert.deepEqual(result.applied, [{ ref: 'spec:s2', tracks: 1 }])
  assert.equal(result.manifest.tracks.length, 2)
  const lines = overrideReceiptLines(result.applied, result.skipped)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /不在 spec 里/)
  assert.match(lines[0], /重编 manifest 不会丢/)
})

// ─────────────────── 4. 缓存契约：只有该段变 ───────────────────

test('F6：加 override ⇒ 只有该段 hash 变，其余段仍命中', () => {
  const manifest = buildManifest([textCard('V2', 0, 200), textCard('V3', 200, 200)])
  const globals = manifestGlobalsFingerprint(manifest)
  const before = planOf(manifest)
  const hashesBefore = before.segments.map((segment) => segmentHash(segment, 'standard', globals))

  const merged = applySegmentOverrides({
    manifest,
    artifacts: before.artifacts,
    overrides: [{
      version: SEGMENT_OVERRIDES_VERSION,
      ref: 'spec:s2',
      anchor: { startFrame: 200, frames: 200 },
      updatedAt: 0,
      tracks: [orbitTrack('hi-orbit-1', 210, 180)],
    }],
  })
  const after = planOf(merged.manifest)
  const hashesAfter = after.segments.map((segment) => segmentHash(segment, 'standard', globals))

  assert.equal(hashesAfter[0], hashesBefore[0], 's1 没改 ⇒ 必须命中同一份缓存')
  assert.notEqual(hashesAfter[1], hashesBefore[1], 's2 内容变了 ⇒ 必须重渲')
  assert.equal(after.segments[1].endFrame - after.segments[1].startFrame, 200, '段窗不许被 override 改')
  assert.equal(after.segments[1].tracks.length, 2, 's2 = 原 1 条 + 手工 1 条')
})

// ─────────────────── 5. IO：留档 / 坏文件 / 删除 ───────────────────

test('F6：写两次会留档旧版，读回的是最新一版', () => {
  const projectDir = tmpProject()
  try {
    const first = { version: SEGMENT_OVERRIDES_VERSION, ref: 'spec:s2', anchor: { startFrame: 200, frames: 200 }, updatedAt: 1, tracks: [orbitTrack('hi-1', 210, 60)] }
    const second = { ...first, updatedAt: 2, tracks: [orbitTrack('hi-1', 210, 60), orbitTrack('hi-2', 300, 60)] }
    const wroteFirst = writeProjectOverride({ projectDir, override: first })
    assert.equal(wroteFirst.backup, null, '首次写入没有旧文可留档')
    assert.equal(wroteFirst.relPath, `${SEGMENT_OVERRIDES_DIR}/spec-s2.json`)

    const wroteSecond = writeProjectOverride({ projectDir, override: second })
    assert.equal(wroteSecond.backup, 'spec-s2-1.json')
    const backup = readFileSync(join(projectDir, SEGMENT_OVERRIDES_DIR, 'versions', 'spec-s2-1.json'), 'utf8')
    assert.equal(JSON.parse(backup).tracks.length, 1, '留档的是**旧版**')

    const read = readProjectOverrides(projectDir)
    assert.equal(read.skipped.length, 0)
    assert.equal(read.overrides.length, 1)
    assert.equal(read.overrides[0].tracks.length, 2)
    assert.deepEqual([...overrideCountByRef(projectDir)], [['spec:s2', 2]])
    assert.deepEqual([...overrideTrackIds(projectDir)].sort(), ['hi-1', 'hi-2'])
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6：坏文件逐份跳过，好文件照常生效（一份坏 override 不许毁整片）', () => {
  const projectDir = tmpProject()
  try {
    const dir = join(projectDir, SEGMENT_OVERRIDES_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'spec-s1.json'), '{ 这不是 JSON', 'utf8')
    writeFileSync(join(dir, 'spec-s3.json'), JSON.stringify({ version: 99, ref: 'spec:s3' }), 'utf8')
    writeFileSync(join(dir, 'spec-s2.json'), JSON.stringify({
      version: SEGMENT_OVERRIDES_VERSION,
      ref: 'spec:s2',
      anchor: { startFrame: 200, frames: 200 },
      updatedAt: 1,
      tracks: [orbitTrack('hi-1', 210, 60)],
    }), 'utf8')
    const read = readProjectOverrides(projectDir)
    assert.equal(read.overrides.length, 1, '只有那份合法的生效')
    assert.equal(read.overrides[0].ref, 'spec:s2')
    assert.equal(read.skipped.length, 2, '两份坏的都要留原因')
    assert.match(read.skipped.map((entry) => entry.reason).join('\n'), /schema 版本不支持/)
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('F6：删除 override 之后读盘为空（画面不再带手工轨）', () => {
  const projectDir = tmpProject()
  try {
    writeProjectOverride({
      projectDir,
      override: { version: SEGMENT_OVERRIDES_VERSION, ref: 'spec:s2', anchor: { startFrame: 200, frames: 200 }, updatedAt: 1, tracks: [orbitTrack('hi-1', 210, 60)] },
    })
    assert.equal(removeProjectOverride(projectDir, 'spec:s2'), true)
    assert.equal(readProjectOverrides(projectDir).overrides.length, 0)
    assert.equal(removeProjectOverride(projectDir, 'spec:s2'), false, '删不存在的返回 false（不假装成功）')
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

// ─────────────────── 6. 归一化小件 ───────────────────

test('F6：ref 归一化 / 文件名派生 / 读盘拒收要点', () => {
  assert.equal(normalizeOverrideRef('s2'), 'spec:s2')
  assert.equal(normalizeOverrideRef(' spec:s2 '), 'spec:s2')
  assert.equal(normalizeOverrideRef('   '), '')
  assert.equal(overrideFileName('spec:s2'), 'spec-s2.json', '冒号不能进文件名')
  // 中文段 id 不能一律折成 `-`：`spec:第二屏` 与 `spec:第三屏` 会撞到同一个文件名，
  // 后写的静默覆盖前一个。按码点编码后必须不同。
  assert.notEqual(overrideFileName('spec:第二屏'), overrideFileName('spec:第三屏'))
  assert.match(overrideFileName('spec:第二屏'), /^spec-_/)
  assert.ok('reason' in readOverrideDoc({ version: SEGMENT_OVERRIDES_VERSION, ref: 's2' }), 'ref 必须带 spec: 前缀')
  assert.ok('reason' in readOverrideDoc({ version: SEGMENT_OVERRIDES_VERSION, ref: 'spec:s2', anchor: { startFrame: 0, frames: 0 }, tracks: [] }), 'frames 必须 > 0')
})

// ─────────────────── 7. 落盘快照不许含手工轨（防僵尸轨） ───────────────────

test('F6：`build/manifest.json` 快照剔除手工轨（删 override 后画面真的会回去）', () => {
  const manifest = buildManifest([textCard('V2', 0, 200), textCard('V3', 200, 200)])
  const merged = mergeOverrideTracks(manifest.tracks, [orbitTrack('hi-orbit-1', 210, 180)])
  const snapshot = withoutOverrideTracks({ ...manifest, tracks: merged }, new Set(['hi-orbit-1']))
  assert.deepEqual(snapshot.tracks.map((track) => track.id), ['V2', 'V3'])

  // 没有手工轨 ⇒ 原样返回（同一对象：绝大多数项目零成本，也便于调用方跳过写盘）。
  assert.equal(withoutOverrideTracks(manifest, new Set()), manifest)
  // 名单里有、但 manifest 里没有 ⇒ 也不重建对象。
  assert.equal(withoutOverrideTracks(manifest, new Set(['nope'])), manifest)
})
