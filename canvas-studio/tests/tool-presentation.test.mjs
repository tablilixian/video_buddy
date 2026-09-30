/**
 * REQ-008：tool-presentation.ts 唯一口径测试。
 *
 * 覆盖方案 v1.1 §5 的九项断言：
 * 1. 全覆盖对账 —— src/host-tools.ts 源码里全部 `name: '…'` 工具名逐一有表项
 *    （漏登记即红；读源文本交叉断言，不依赖运行 createStudioTools）；
 * 2. 占位 2 个在表内；
 * 3. 排除清单（cordis_define / todo_write 不注册）；
 * 4. 上游 keyed 12 键对账（除排除键外全部接管）；
 * 5. 历史别名 5 个在表内（老会话本地化）；
 * 6. 摘要提取器逐路径 + 坏 JSON；
 * 7. 兜底；
 * 8. 耗时；
 * 9. labelOfTool 资产历史契约（与 tests/asset-history.test.mjs 同口径）。
 *
 * 从 ../lib/*.js 导入 —— 先 build（yarn workspace canvas-studio build）再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  TOOL_PRESENTATION, TOOLVIEW_KEYS, labelOfTool, presentationOf,
  durationSeconds, errorSummaryOf, stateOfBlock, summaryOf,
} from '../lib/tool-presentation.js'

const readSrc = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('REQ-008①：host-tools.ts 全部工具名逐一有展示表项（漏登记即红）', () => {
  const src = readSrc('../src/host-tools.ts')
  const names = [...src.matchAll(/name: '([a-z0-9_]+)'/g)].map((m) => m[1])
  // 0.7.0 对拍：prompt_enhance 退役后 23 个（image_generate_text 接入后回到 24）
  assert.ok(names.length >= 23, `host-tools.ts 只解析出 ${names.length} 个工具名，正则可能失配`)
  const missing = names.filter((name) => presentationOf(name) === undefined)
  assert.deepEqual(missing, [], `以下工具未登记三档表（keyed 无 catch-all，漏了会回落英文通用行）：${missing.join(', ')}`)
})

test('REQ-008②：占位工具在表内', () => {
  assert.ok(presentationOf('tts_voiceover') !== undefined)
  assert.ok(presentationOf('subtitle_burn') !== undefined)
})

test('REQ-008③：排除清单 —— cordis_define / todo_write 不注册', () => {
  assert.equal(presentationOf('cordis_define'), undefined)
  assert.equal(presentationOf('todo_write'), undefined)
  assert.equal(TOOL_PRESENTATION['cordis_define'], undefined)
})

test('REQ-008④：上游 keyed 12 键对账（除排除键外全部接管）', () => {
  const upstreamKeyed = [
    'read', 'write', 'edit', 'bash', 'grep', 'glob',
    'web_search', 'web_fetch', 'todo_write', 'skill',
    'cordis_define', 'cordis_stop', 'cordis_undefine',
  ]
  const unhandled = upstreamKeyed.filter(
    (key) => key !== 'cordis_define' && key !== 'todo_write' && presentationOf(key) === undefined,
  )
  assert.deepEqual(unhandled, [], '上游 keyed 行未接管（将继续显示英文行）')
})

test('REQ-008⑤：历史别名 5 个在表内（老会话按 call.name 原样分发）', () => {
  for (const alias of ['compose', 'upload', 'image2image', 'txt2image', 'character']) {
    assert.ok(presentationOf(alias) !== undefined, `历史别名 ${alias} 未登记`)
  }
})

test('REQ-008⑥：摘要提取器（A 档动态规则 + 通用链 + 坏 JSON）', () => {
  assert.equal(
    summaryOf('image_generate', JSON.stringify({ prompt: '竹林月夜，双人对打，逆光剪影', filenames: ['a.png', 'b.png'] })),
    '竹林月夜，双人对打，逆光剪影 · 2 张参考',
  )
  const long = '一'.repeat(50)
  const clipped = summaryOf('image_generate', JSON.stringify({ prompt: long }))
  assert.ok(clipped.endsWith('…') && clipped.length === 41, `40 字截断 + 省略号，实际：${clipped?.length}`)
  assert.equal(
    summaryOf('video_generate', JSON.stringify({ prompt: '镜头推进', duration: 8 })),
    '镜头推进 · 8s',
  )
  assert.equal(summaryOf('ask_user_choice', JSON.stringify({ question: '画风选哪个？' })), '画风选哪个？')
  assert.equal(summaryOf('bash', JSON.stringify({ command: 'ls -la /tmp' })), 'ls -la /tmp')
  assert.equal(summaryOf('read', JSON.stringify({ path: 'projects/p/storyboard.md' })), 'storyboard.md')
  assert.equal(summaryOf('web_fetch', JSON.stringify({ url: 'https://example.com/a' })), 'example.com')
  // 通用链兜底（无 per-tool 规则的工具取 prompt → … → id）。
  assert.equal(summaryOf('write_screenplay', JSON.stringify({ prompt: '写个剧本' })), '写个剧本')
  // 坏 JSON / 空 / 非对象 → null。
  assert.equal(summaryOf('bash', '{oops'), null)
  assert.equal(summaryOf('bash', ''), null)
  assert.equal(summaryOf('bash', '[1,2]'), null)
})

test('REQ-008⑦：兜底 —— 表外工具无表项；labelOfTool 未知兜底原名', () => {
  assert.equal(presentationOf('unknown_future_tool'), undefined)
  assert.equal(labelOfTool('unknown_tool'), 'unknown_tool')
})

test('REQ-008⑧：耗时（0.1s 精度；缺 callTime → null；running → null）', () => {
  assert.equal(durationSeconds({ kind: 'tool-result', time: 5_000, callTime: 2_350 }), 2.7)
  assert.equal(durationSeconds({ kind: 'tool-result', time: 5_000 }), null)
  assert.equal(durationSeconds({ kind: 'tool-result', time: 5_000, callTime: null }), null)
  assert.equal(durationSeconds({ callId: 'c1', name: 'x', argsRaw: '{}' }), null)
  assert.equal(formatDurationOf(2.7), '2.7s')
  assert.equal(formatDurationOf(21), '21s')
})

function formatDurationOf(seconds) {
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`
}

test('REQ-008⑨：labelOfTool 资产历史契约（与 asset-history.test.mjs 同口径）', () => {
  assert.equal(labelOfTool('video_generate'), '视频生成')
  assert.equal(labelOfTool('compose'), '成片合成')
  assert.equal(labelOfTool('cut_audio'), '音频裁切')
  assert.equal(labelOfTool('image_fix'), '图内文字修复')
  assert.equal(labelOfTool('upload'), '上传文件')
})

test('REQ-008：状态四态与错误首行提取', () => {
  assert.equal(stateOfBlock({ callId: 'c' }), 'running')
  assert.equal(stateOfBlock({ kind: 'tool-result', isError: false }), 'ok')
  assert.equal(stateOfBlock({ kind: 'tool-result', isError: true }), 'error')
  assert.equal(stateOfBlock({ kind: 'tool-result', isError: false, error: { name: 'x', code: 'interrupted' } }), 'stopped')
  assert.equal(
    errorSummaryOf({ kind: 'tool-result', isError: true, content: [{ type: 'text', text: '{"error":"provider timeout after 30s"}' }] }),
    'provider timeout after 30s',
  )
  assert.equal(
    errorSummaryOf({ kind: 'tool-result', isError: true, content: [], error: { name: 'ToolErr', code: 'boom' } }),
    'ToolErr: boom',
  )
})

test('REQ-008：注册键表无重复（重复键会在 slots.register 抛错）', () => {
  assert.equal(new Set(TOOLVIEW_KEYS).size, TOOLVIEW_KEYS.length)
  assert.deepEqual(TOOLVIEW_KEYS, Object.keys(TOOL_PRESENTATION))
})
