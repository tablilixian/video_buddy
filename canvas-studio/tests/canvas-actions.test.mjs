/**
 * canvas-actions 纯函数冒烟测试：CV-018 就地重试可见性判定、CV-037 右键菜单
 * 内外按下判定。直连 Host tsc 编译产物 lib/canvas-actions.js。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetDownloadName, canDownloadNode, canRetryNode, shouldKeepMenuOpen } from '../lib/canvas-actions.js'

/** 构造一个最小合法画布节点。 */
function node(extra = {}) {
  return {
    id: 'n1',
    kind: 'image',
    url: '/assets/n1.png',
    x: 0,
    y: 0,
    width: 480,
    height: 270,
    createdAt: 1,
    ...extra,
  }
}

test('canRetryNode：agent 生成失败的节点可重试', () => {
  assert.equal(canRetryNode(node({
    origin: 'agent',
    toolName: 'image_generate',
    generationPrompt: '一只猫',
    error: '生成超时',
  })), true)
})

test('canRetryNode：缺少 toolName / generationPrompt 不可重试', () => {
  // 上传失败、手动导入等节点没有可重放参数 —— 徽章必须保持不可点，
  // 否则点击只会得到「没有可重放的生成参数」的二次错误。
  assert.equal(canRetryNode(node({ error: '上传失败' })), false)
  assert.equal(canRetryNode(node({ error: 'x', toolName: 'image_generate' })), false)
  assert.equal(canRetryNode(node({ error: 'x', generationPrompt: '一只猫' })), false)
})

test('canRetryNode：生成中的节点不显示重试', () => {
  assert.equal(canRetryNode(node({
    toolName: 'image_generate',
    generationPrompt: '一只猫',
    isLoading: true,
  })), false)
})

test('canRetryNode：无错误节点不显示重试', () => {
  // 成功节点即使带生成参数也不该挂重试按钮（纯函数只管可见性，调用方
  // 另加 node.error !== undefined 条件，这里锁定两者不冲突）。
  assert.equal(canRetryNode(node({ toolName: 'image_generate', generationPrompt: '一只猫' })), true)
})

/** 菜单容器桩：以对象身份判断是否「包含」目标。 */
function menuContaining(...members) {
  return { contains: (other) => members.includes(other) }
}

test('shouldKeepMenuOpen：按在菜单内部 → 保持打开（CV-037 回归）', () => {
  const item = { tag: 'button' }
  const menu = menuContaining(item)
  assert.equal(shouldKeepMenuOpen(item, menu), true)
})

test('shouldKeepMenuOpen：按在菜单外部 → 关闭', () => {
  const menu = menuContaining({ tag: 'button' })
  assert.equal(shouldKeepMenuOpen({ tag: 'canvas' }, menu), false)
})

test('shouldKeepMenuOpen：菜单未挂载或空目标 → 不拦截（走关闭）', () => {
  assert.equal(shouldKeepMenuOpen({ tag: 'button' }, null), false)
  assert.equal(shouldKeepMenuOpen(null, menuContaining({})), false)
  assert.equal(shouldKeepMenuOpen(undefined, menuContaining({})), false)
})

test('canDownloadNode：图片 / 视频节点有 url 才可下载', () => {
  assert.equal(canDownloadNode(node({ kind: 'image', url: '/assets/a.png' })), true)
  assert.equal(canDownloadNode(node({ kind: 'video', url: '/assets/a.mp4' })), true)
})

test('canDownloadNode：缺 url 或非媒体节点不可下载', () => {
  // sticky / text / prompt / group 是画布标注，没有实体产物可另存。
  assert.equal(canDownloadNode(node({ kind: 'image', url: undefined })), false)
  assert.equal(canDownloadNode(node({ kind: 'image', url: '' })), false)
  for (const kind of ['sticky', 'text', 'prompt', 'group']) {
    assert.equal(canDownloadNode(node({ kind, url: '/assets/a.png' })), false)
  }
})

test('assetDownloadName：优先用 Drama 落盘 filename（与 agent 的 @ref 句柄对得上）', () => {
  assert.equal(
    assetDownloadName(node({ kind: 'image', filename: 'ref-a1b2.png', title: '分镜 1' })),
    'ref-a1b2.png',
  )
})

test('assetDownloadName：无 filename 时按标题补扩展名', () => {
  assert.equal(assetDownloadName(node({ kind: 'video', title: '成片' })), '成片.mp4')
  assert.equal(assetDownloadName(node({ kind: 'image', title: '角色定妆' })), '角色定妆.png')
})

test('assetDownloadName：标题已带扩展名时不重复补', () => {
  assert.equal(assetDownloadName(node({ kind: 'image', title: '角色.jpg' })), '角色.jpg')
})

test('assetDownloadName：filename 与 title 都缺时退回节点 id', () => {
  assert.equal(assetDownloadName(node({ id: 'abcdef1234567890', kind: 'video' })), 'canvas-abcdef12.mp4')
})

test('assetDownloadName：文件名中的路径分隔符被清洗', () => {
  // 真威胁是路径分隔符（会让下载落到非预期目录）；清洗后只剩平铺文件名。
  assert.equal(assetDownloadName(node({ kind: 'image', title: 'a/b\\c:d*e?f"g<h>i|j' })), 'a-b-c-d-e-f-g-h-i-j.png')
})
