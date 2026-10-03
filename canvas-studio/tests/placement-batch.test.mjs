/**
 * 批 E（2026-10-03）：落位三件套——A-4 占位预连血缘 / A-9 拖入落点 / A-5 文案卡锚定。
 * 客户端落位与 Host 落卡各测可测面：纯函数直连 + 源码闸。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePendingSourceIds } from '../lib/canvas-placement.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = rel => readFileSync(join(here, '..', rel), 'utf8')

const node = (id, extra = {}) => ({
  id, kind: 'image', x: 0, y: 0, width: 10, height: 10, createdAt: 1, sourceIds: [], ...extra,
})

test('A-4：resolvePendingSourceIds 按 url 末段 / 句柄 / shotRefs 预连血缘（脏 JSON 容错）', () => {
  const nodes = [
    node('img1', { url: '/canvas-studio/assets/p1/a.png', filename: 'ref-1.png' }),
    node('card1', { kind: 'text', title: '分镜 1 · 全景' }),
  ]
  const args = JSON.stringify({
    prompt: 'p',
    filename: 'ref-1.png',
    sourceUrls: ['/canvas-studio/assets/p1/a.png'],
    shotRefs: ['分镜 1'],
  })
  assert.deepEqual(resolvePendingSourceIds(nodes, args), ['img1', 'card1'], 'url 与句柄命中同一节点去重，shotRefs 按镜号前缀命中分镜卡')
  assert.deepEqual(resolvePendingSourceIds(nodes, JSON.stringify({ filenames: ['ref-1.png'], filenameTail: 'ref-1.png' })), ['img1'])
  assert.deepEqual(resolvePendingSourceIds(nodes, undefined), [])
  assert.deepEqual(resolvePendingSourceIds(nodes, '不是 JSON'), [], '脏 arguments 静默跳过')
  assert.deepEqual(resolvePendingSourceIds(nodes, JSON.stringify({ filename: 'ghost.png' })), [], '未命中不硬凑')
  // 「分镜 10」不得被「分镜 1」前缀误命中
  const nodes10 = [node('card10', { kind: 'text', title: '分镜 10 · 全景' })]
  assert.deepEqual(resolvePendingSourceIds(nodes10, JSON.stringify({ shotRefs: ['分镜 1'] })), [])
})

test('A-9：拖入落点链路——onDrop 捕获坐标、add* 居中锚定、落点在画布外回落网格', () => {
  const frame = read('src/client/StudioFrame.tsx')
  assert.match(frame, /droppedFilesRef\.current\(files, dropWorldAt\(event\.clientX, event\.clientY\) \?\? undefined\)/, 'drop 当帧捕获坐标')
  assert.match(frame, /dropWorldAt/, '必须有落点换算 helper（screenToWorld）')
  const store = read('src/client/project-store.ts')
  const atFormula = (store.match(/at !== undefined\s*\?\s*\{ x: at\.x - size\.width \/ 2, y: at\.y - size\.height \/ 2 \}/g) ?? []).length
  assert.ok(atFormula >= 3, `三个 add*（text/audio/video）都要居中锚定，实测 ${atFormula}`)
})

test('A-5：文案卡锚定优先级（shotRefs > 镜号最大分镜卡 > 创意卡）+ 高度自适应 + 正文折叠', () => {
  const hostTools = read('src/host-tools.ts')
  assert.match(hostTools, /shotRefs: \{ type: 'array' as const, description: '可选：文案要跟随的分镜卡/)
  const wsBlock = hostTools.slice(hostTools.indexOf("name: 'write_script'"), hostTools.indexOf("name: 'write_script'") + 4200)
  assert.match(wsBlock, /镜号最大的分镜卡|shotCardNumberOf\(node\.title\)/, '兜底锚必须取镜号最大的分镜卡')
  assert.match(wsBlock, /cardHeight = Math\.min\(280 \+ Math\.ceil\(/, '文案卡高度按内容自适应')
  const styles = read('src/client/styles.ts')
  assert.match(styles, /\.csNodeBody \{[\s\S]*?-webkit-line-clamp: 12;/, '长文默认折叠 12 行')
  assert.match(styles, /\.csNodeSelected \.csNodeBody \{[\s\S]*?-webkit-line-clamp: unset;/, '选中展开解除钳制（CV-081 互斥）')
})
