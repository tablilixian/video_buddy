/**
 * D-1（末帧卡收起）守卫：辅助卡（auxiliary）落卡、判读、画布收起与布局豁免。
 *
 * 无 React 渲染环境 —— 行为按仓库惯例拆两层：
 *   纯函数 isAuxiliaryNode 直连编译产物 lib/canvas-view.js；
 *   字段往返直连 lib/projects.js（writeCanvas → readCanvas，auxiliary 过
 *   normalizeCanvasDocument 必须原样保留）；
 *   渲染接线（StudioFrame 过滤 / 工具栏开关 / 两条排布路径）用源码闸钉住。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectRegistry } from '../lib/projects.js'
import { isAuxiliaryNode } from '../lib/canvas-view.js'

const here = dirname(fileURLToPath(import.meta.url))
/** 去注释切片：断言只看代码本体，不受注释里出现旧字样的干扰。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (rel) => codeOnly(readFileSync(join(here, '..', rel), 'utf8'))

/** 最小合法画布节点（字段与 normalizeCanvasDocument 兼容）。 */
const node = (overrides = {}) => ({
  id: 'n1',
  kind: 'image',
  title: '末帧 · 分镜 5',
  url: '/canvas-studio/assets/p/n1.png',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  createdAt: 1,
  origin: 'agent',
  sourceIds: [],
  ...overrides,
})

test('D-1 isAuxiliaryNode：auxiliary 字段与 toolName 兜底取并（老末帧卡同样收起）', () => {
  assert.equal(isAuxiliaryNode(node({ auxiliary: true })), true, '落卡即标 auxiliary:true')
  assert.equal(isAuxiliaryNode(node({ toolName: 'extract_last_frame' })), true,
    '老项目末帧卡没有新字段——toolName 兜底，渐进兼容')
  assert.equal(isAuxiliaryNode(node()), false, '普通节点不受影响')
  assert.equal(isAuxiliaryNode(node({ retired: true })), false, '作废语义（retired）与辅助语义（auxiliary）互不替代')
})

test('D-1 落卡即标辅助态：extractLastFrame 新建与 retry 重写都带 auxiliary:true', () => {
  const frames = read('src/video-frames.ts')
  assert.match(frames, /referenceRole: 'frame',\s+auxiliary: true,/, '新建末帧节点必须标辅助态')
  const retry = frames.slice(frames.indexOf('options.retryOf !== undefined'))
  assert.match(retry, /auxiliary: true,/, 'retry 重写（overwriteNodeAsset）必须补标——老卡重抽一次即入辅助态')
})

test('D-1 字段往返：auxiliary 过 writeCanvas → readCanvas 原样保留', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-d1-roundtrip-'))
  try {
    const registry = new ProjectRegistry(root)
    const project = await registry.create('辅助卡往返')
    await registry.writeCanvas(project.id, [node({ auxiliary: true })])
    const doc = await registry.readCanvas(project.id)
    assert.equal(doc.nodes[0].auxiliary, true, 'normalizeCanvasDocument 不得丢辅助标记')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('D-1 渲染收起：visibleNodes 过滤辅助卡（isAuxiliaryNode 共享谓词，开关恢复）', () => {
  const frame = read('src/client/StudioFrame.tsx')
  assert.match(frame, /const \[showAuxiliary, setShowAuxiliary\] = useState\(false\)/,
    '默认收起（false）——D-1 的产品语义是「画布默认不见末帧卡」')
  assert.match(frame, /if \(isAuxiliaryNode\(node\) && !showAuxiliary\) return false/,
    '画布可见集必须用共享谓词过滤辅助卡（不得在渲染层另写第二份判定）')
  assert.match(frame, /showAuxiliary=\{showAuxiliary\}/, '工具栏开关必须接线')
  assert.match(frame, /onToggleShowAuxiliary=\{\(\) => \{ setShowAuxiliary\(!showAuxiliary\) \}\}/)
})

test('D-1 布局豁免：显式整理与生成到达的自动整理都不给辅助卡占槽位', () => {
  const frame = read('src/client/StudioFrame.tsx')
  // 显式「整理布局」：restricted = hideRetired || !showAuxiliary —— 只要有
  // 隐藏语义在，排布输入就收窄到可见子集（CV-244 的 layoutOverVisible 口径）。
  assert.match(frame, /const restricted = hideRetired \|\| !showAuxiliary/,
    '整理布局的可见性收窄必须同时覆盖废弃素材与辅助卡')
  // 生成到达（放手跑模式）的自动整理：与 retired 同一条过滤链。
  const arrival = frame.slice(frame.indexOf('autoArrangeRevealRef.current.clear()'))
  assert.match(arrival, /&& !isAuxiliaryNode\(node\)/,
    '自动整理的 visible 集必须滤掉辅助卡（否则新生成的末帧卡又把末帧泳道撑开）')
})

test('D-1 工具栏：开关按钮在位且与废弃素材开关可区分（aria + 标题写清用途）', () => {
  const toolbar = read('src/client/canvas/CanvasToolbar.tsx')
  assert.match(toolbar, /showAuxiliary: boolean/, 'CanvasToolbar 必须声明 showAuxiliary prop')
  assert.match(toolbar, /onToggleShowAuxiliary\(\): void/)
  assert.match(toolbar, /显示辅助卡（末帧等机器衔接用卡）/, '开关文案必须写清「机器衔接用卡」——收起后用户找不到末帧时靠它')
  assert.match(toolbar, /aria-pressed=\{showAuxiliary\}/)
})
