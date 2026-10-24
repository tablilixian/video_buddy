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
  assert.equal(manifest.meta.width, 1280)
  assert.equal(manifest.meta.height, 720)
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
  assert.equal(v.manifest.meta.width, 720)
  assert.equal(v.manifest.meta.height, 1280)
  assert.equal(v.manifest.meta.durationInFrames, 480)

  const fallback = await scaffold({ title: '乱填', durationSeconds: 3, fps: 17, aspect: '4:3' })
  assert.equal(fallback.manifest.meta.fps, 30, '非法 fps 回落 30')
  assert.equal(fallback.manifest.meta.width, 1280, '非法 aspect 回落 16:9')
})

test('B2-3：title 为空 / durationSeconds 非正数时拒收（不生成非法骨架）', async () => {
  await assert.rejects(() => tool().execute({ title: '   ', durationSeconds: 5 }, exec), (err) => err.code === 'CS-USER-ERR')
  await assert.rejects(() => tool().execute({ title: 'x', durationSeconds: 0 }, exec), (err) => err.code === 'CS-USER-ERR')
  await assert.rejects(() => tool().execute({ title: 'x', durationSeconds: 5000 }, exec), (err) => err.code === 'CS-USER-ERR')
})
