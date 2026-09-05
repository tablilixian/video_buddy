/**
 * assetKeyFromUrl 契约测试（2026-09-05 两段式上传）。
 *
 * 惰性 promote 的关键解析：画布素材节点 url（/canvas-studio/assets/<projectId>/<file>）
 * → `<projectId>/<file>` 键。非画布资产 url（外链 / 其他路由）必须返回 null，
 * 让 @ref 惰性兜底走「非画布资产」报错分支；含路径穿越片段的 url 一律拒绝。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetKeyFromUrl } from '../lib/generate.js'

test('assetKeyFromUrl：标准画布资产 url → projectId/file 键', () => {
  assert.equal(assetKeyFromUrl('/canvas-studio/assets/proj-1/abc123.png'), 'proj-1/abc123.png')
})

test('assetKeyFromUrl：无扩展名文件名同样可解析', () => {
  assert.equal(assetKeyFromUrl('/canvas-studio/assets/p/aB9-_'), 'p/aB9-_')
})

test('assetKeyFromUrl：外链 url → null', () => {
  assert.equal(assetKeyFromUrl('https://example.com/x.png'), null)
  assert.equal(assetKeyFromUrl('/canvas-studio/upload'), null)
  assert.equal(assetKeyFromUrl(''), null)
})

test('assetKeyFromUrl：多余路径段 / 目录穿越 → null', () => {
  assert.equal(assetKeyFromUrl('/canvas-studio/assets/p/a/b.png'), null)
  assert.equal(assetKeyFromUrl('/canvas-studio/assets/p/../x.png'), null)
  assert.equal(assetKeyFromUrl('/canvas-studio/assets/p/..%2Fx.png'), null)
})
