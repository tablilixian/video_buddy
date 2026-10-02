/**
 * D-2（2026-10-02）源码闸：多参考视频的边标签语义——「MKR 多关键帧」旧口径与
 * 帧位角色表（首帧/中间帧/尾帧）是「文本被描述成 MKR 参考、参考图被贴首尾帧」
 * 的直接来源。无 React 渲染环境，用源码闸钉住关键判定。
 *
 * 运行：corepack yarn build && corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

test('D-2：操作全称不再用「MKR 多关键帧」旧口径', () => {
  const labels = read('src/client/canvas/labels.ts')
  assert.ok(!labels.includes('MKR'), '「MKR」缩写已退役（D-2：用户读到的是不可读缩写）')
  assert.match(labels, /'mkr-video': '多参考视频'/)
})

test('D-2：mkr-video 边 chip 用参考锚点语义，不再贴帧位角色表', () => {
  const edges = read('src/client/canvas/CanvasEdges.tsx')
  assert.ok(!edges.includes("'mkr-video': ['首帧'"), 'Ref2VA 参考图不得再贴首帧/中间帧/尾帧')
  assert.match(edges, /multiReferenceChipLabel/, 'mkr-video 必须走参考锚点特例（参考 N / 分镜）')
  assert.match(edges, /'image-to-video': \['首帧', '尾帧'\]/, '真实首尾帧（video_generate 书挡）保留帧位角色表')
})
