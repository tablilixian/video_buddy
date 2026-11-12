/**
 * REQ-035 B2-3（D11）：`scaffold_manifest` 骨架生成器。
 *
 * 守的核心只有一条：**它产出的 JSON 必须自己就能过 validateManifest**。
 * 如果这条不成立，这个工具就只是把"手写错误"换成了"复制骨架再改错"，毫无意义。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '../lib/errors/catalog.js'

function tool() {
  const found = createStudioTools({}, 3000).find((entry) => entry.name === 'scaffold_manifest')
  assert.ok(found, 'scaffold_manifest 必须已注册')
  return found
}

const exec = {}

async function scaffold(args) {
  const out = await tool().execute(args, exec)
  const text = out.text ?? ''
  const match = /```json\n([\s\S]*?)\n```/u.exec(text)
  assert.ok(match, `返回里必须带 JSON 代码块，实际：\n${text}`)
  return { text, manifest: JSON.parse(match[1]) }
}

test('B2-3：默认参数产出合法骨架，且 meta.durationInFrames === 最大结束帧', async () => {
  const { manifest } = await scaffold({ title: '测试片', durationSeconds: 10 })
  assert.equal(manifest.meta.fps, 30)
  assert.equal(manifest.meta.width, 1920)
  assert.equal(manifest.meta.height, 1080)
  assert.equal(manifest.meta.durationInFrames, 300)
  const maxEnd = Math.max(...manifest.tracks.map((t) => t.startFrame + t.durationInFrames))
  assert.equal(manifest.meta.durationInFrames, maxEnd, '尾部完整性：总时长必须等于最大结束帧')
  assert.deepEqual(validateManifest(manifest).errors, [], '骨架必须自己过校验')
})

test('B2-3：exit 不超轨道时长（短片也不会生成非法退场）', async () => {
  // 1.5s 片子：片头只有 30 帧，退场必须被压到 ≤30
  const { manifest } = await scaffold({ title: '短片', durationSeconds: 1.5 })
  const title = manifest.tracks.find((t) => t.id === 'title')
  assert.ok(title.exit !== undefined)
  assert.ok(title.exit.durationInFrames <= title.durationInFrames, 'exit 不能超轨道时长')
  assert.deepEqual(validateManifest(manifest).errors, [])
})

test('B2-3：fps / aspect 生效，非法值回落缺省', async () => {
  const v = await scaffold({ title: '竖屏', durationSeconds: 8, fps: 60, aspect: '9:16' })
  assert.equal(v.manifest.meta.fps, 60)
  assert.equal(v.manifest.meta.width, 1080)
  assert.equal(v.manifest.meta.height, 1920)
  assert.equal(v.manifest.meta.durationInFrames, 480)

  const fallback = await scaffold({ title: '乱填', durationSeconds: 3, fps: 17, aspect: '4:3' })
  assert.equal(fallback.manifest.meta.fps, 30, '非法 fps 回落 30')
  assert.equal(fallback.manifest.meta.width, 1920, '非法 aspect 回落 16:9')
  assert.equal(fallback.manifest.meta.height, 1080, '非法 aspect 回落 16:9')
})

test('B2-3：title 为空 / durationSeconds 非正数时拒收（不生成非法骨架）', async () => {
  await assert.rejects(() => tool().execute({ title: '   ', durationSeconds: 5 }, exec), (err) => err.code === 'CS-USER-ERR')
  await assert.rejects(() => tool().execute({ title: 'x', durationSeconds: 0 }, exec), (err) => err.code === 'CS-USER-ERR')
  await assert.rejects(() => tool().execute({ title: 'x', durationSeconds: 5000 }, exec), (err) => err.code === 'CS-USER-ERR')
})

/* ───────── P1-3（2026-11-05）：writeTo 落盘 ───────── */

/** 带项目目录的注册表桩：resolveProjectId 走 list() 的 dir 前缀匹配，projectDir 直接给。 */
function projectHarness(dir) {
  const registry = {
    list: async () => [{ id: 'p1', dir }],
    projectDir: () => dir,
  }
  const entry = createStudioTools(registry, 3000).find((t) => t.name === 'scaffold_manifest')
  assert.ok(entry, 'scaffold_manifest 必须已注册')
  return { entry, exec: { agent: { session: { header: { cwd: dir } } } } }
}

test('P1-3：writeTo 直接落盘，返回路径/轨数/字节数，且不再回显完整 JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-scaffold-write-'))
  try {
    const { entry, exec: execWithCwd } = projectHarness(dir)
    const out = await entry.execute({ title: '落盘片', durationSeconds: 12, writeTo: 'build/manifest.json' }, execWithCwd)
    const text = out.text ?? ''
    const path = join(dir, 'build', 'manifest.json')
    assert.ok(text.includes(path), `返回里要点名落盘路径，实际：\n${text.slice(0, 300)}`)
    const json = JSON.parse(readFileSync(path, 'utf8'))
    assert.deepEqual(validateManifest(json).errors, [], '落盘的那份必须自己过校验')
    // 只回显前 40 行：完整 12s 骨架 JSON 远长于此。
    assert.ok(text.length < 12_000, `不能把整份 JSON 回显回来（实际 ${String(text.length)} 字符）`)
    assert.ok(text.includes('render_composition'), '必须给出下一步：用它出片')
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 沙箱可能拦删除 */ }
  }
})

test('P1-3：writeTo 逃出项目目录 → CS-USER-ERR 拒收，零副作用', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-scaffold-out-'))
  try {
    const { entry, exec: execWithCwd } = projectHarness(dir)
    const error = await entry
      .execute({ title: '逃逸', durationSeconds: 5, writeTo: '../escape.json' }, execWithCwd)
      .then(() => undefined, (cause) => cause)
    assert.equal(error?.code, 'CS-USER-ERR')
    assert.equal(existsSync(join(dir, '..', 'escape.json')), false)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 同上 */ }
  }
})
