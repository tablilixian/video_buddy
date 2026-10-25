/**
 * 镜头卡册（`skills/code-driven-explainer/references/shot-cards.md`）的**可渲性守卫**。
 *
 * 为什么必须有这一条：卡册给的是「可直接粘进 tracks 的片段」，模型会**照抄**。
 * 一旦某张卡的字段名写错（少个字母、`scaleX` 这种不存在的维度），模型拿到的就是一条
 * 必然报错的片段 —— 比没有卡册更糟（它会以为是环境问题，反复重试）。
 *
 * 判据：把文档里每个 ```jsonc 片段抽出来，包成最小 manifest 过 `validateManifest`，
 * **errors 必须为空**。警告允许（时长偏差之类属内容层，不是结构错）。
 *
 * 注意：本文件与 `tests/shot-cards.test.mjs`（CV-050 分镜卡按镜号对齐）无关，只是名字像。
 *
 * 运行：node --test tests/shot-card-library.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../lib/remotion/manifest.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(ROOT, 'skills/code-driven-explainer/references/shot-cards.md')

/** 抽出文档里所有 ```jsonc 块。 */
function jsonBlocks(text) {
  const blocks = []
  const pattern = /```jsonc\n([\s\S]*?)```/gu
  let match = pattern.exec(text)
  while (match !== null) {
    blocks.push(match[1].trim())
    match = pattern.exec(text)
  }
  return blocks
}

/** 包成最小 manifest：底色 + 该片段（转场卡补它引用的两条锚点轨）。 */
function wrap(track) {
  const tracks = [{ ...track }]
  if (track.type === 'transition') {
    // 片段里不会带 fromTrackId / toTrackId 引用的那两条轨 —— 补同名锚点，
    // 否则测的是「引用完整性」而不是这张卡本身。
    const span = (track.startFrame ?? 0) + (track.durationInFrames ?? 0) + 10
    tracks.unshift(
      { id: String(track.fromTrackId), type: 'textCard', variant: 'title', text: 'A', startFrame: 0, durationInFrames: span, fadeFrames: 0 },
      { id: String(track.toTrackId), type: 'textCard', variant: 'title', text: 'B', startFrame: 0, durationInFrames: span, fadeFrames: 0 },
    )
  }
  const maxEnd = tracks.reduce((max, item) => Math.max(max, (item.startFrame ?? 0) + (item.durationInFrames ?? 0)), 0)
  return {
    // `id` 在**顶层**（不在 meta 里）—— 事故第一轮报错就是缺它。
    id: 'shot-card-check',
    meta: {
      title: '卡册守卫',
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: maxEnd,
      backgroundColor: '#0B1220',
    },
    tracks,
  }
}

test('卡册：每个片段都必须能被 validateManifest 接受', () => {
  const blocks = jsonBlocks(readFileSync(DOC, 'utf8'))
  assert.ok(blocks.length >= 10, `至少要 10 张卡（实际 ${String(blocks.length)}）—— 太少说明文档被删残了`)
  for (const [index, block] of blocks.entries()) {
    let parsed
    try {
      parsed = JSON.parse(block)
    } catch (cause) {
      assert.fail(`第 ${String(index + 1)} 个片段不是合法 JSON（模型照抄会直接失败）：${cause instanceof Error ? cause.message : String(cause)}`)
    }
    assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), `第 ${String(index + 1)} 块应是单个 track 对象`)
    const result = validateManifest(wrap(parsed))
    assert.deepEqual(result.errors, [], `第 ${String(index + 1)} 块（${String(parsed.id)}）结构不合法：${result.errors.join('；')}`)
  }
})

test('卡册：不许示范静默失效的写法（scaleX/scaleY、kenBurns）', () => {
  for (const block of jsonBlocks(readFileSync(DOC, 'utf8'))) {
    assert.doesNotMatch(block, /"scaleX"|"scaleY"/u,
      '`animate` 只有等比 `scale`：写 scaleX/scaleY 不报错也不生效，卡册绝不能示范')
    assert.doesNotMatch(block, /"kenBurns"\s*:/u,
      '`kenBurns: true` 是死字段：卡册只能写 fit:"kenburns"')
  }
})
