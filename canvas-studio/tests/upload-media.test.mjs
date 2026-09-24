/**
 * CV-241 Step 2：`POST /canvas-studio/upload-media` 端点契约 + `saveLocalAssetBytes`。
 *
 * 钉四件事：
 * 1. **行为**（`saveLocalAssetBytes`）：白名单落盘、未知扩展拒绝、空 body 拒绝、
 *    **零 Drama 调用**（不 promote）。
 * 2. **接线**（读源码）：路由存在、octet-stream、分类型限额（MEDIA_UPLOAD_LIMITS）、
 *    超限 413、未知扩展 400、成功回 {url, assetFile}、路由内不得出现 promoteAssetFile。
 * 3. **限额同源**：路由引用的限额表 = `MEDIA_UPLOAD_LIMITS`（不另抄字面量）。
 * 4. **api 层哑管道**：`uploadStudioMedia` 走 octet-stream，不做 classifyFile。
 *
 * ⚠️ 接线断言用「读源码 + 剥注释」（与 video-upload-wiring 同一手法）——
 *    产品注释不要写出块注释起始序列。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { dirname, join as pathJoin } from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveLocalAssetBytes } from '../lib/generate.js'
import { MEDIA_UPLOAD_LIMITS } from '../lib/media-extension.js'

const here = dirname(fileURLToPath(import.meta.url))
const readSource = (relative) => readFileSync(pathJoin(here, relative), 'utf8')
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const ROUTES = codeOnly(readSource('../src/routes.ts'))
const API = codeOnly(readSource('../src/client/api.ts'))

/** 打桩 fetch：记录一切 Drama 调用（upload / promote / generate）。 */
function stubFetch() {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' })
    return { ok: true, status: 200, json: async () => ({ filename: 'ref.png' }), text: async () => '' }
  }
  return calls
}

function stubRegistry(assetsDir) {
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir: assetsDir, createdAt: 1 }],
    assetsDir: () => assetsDir,
  }
}

// ── 行为：saveLocalAssetBytes ────────────────────────────────────────────────

test('CV-241 saveLocalAssetBytes：四类白名单落盘 + 同源 URL + assetFile', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-upload-media-'))
  try {
    const calls = stubFetch()
    const cases = [
      ['shot.PNG', /\.png$/u],
      ['track.mp3', /\.mp3$/u],
      ['notes.txt', /\.txt$/u],
      ['doc.md', /\.md$/u],
    ]
    for (const [name, pattern] of cases) {
      const result = await saveLocalAssetBytes(stubRegistry(dir), 'p1', name, Buffer.from([1, 2, 3]))
      assert.match(result.assetFile, pattern, `${name} 后缀不匹配: ${result.assetFile}`)
      assert.match(result.url, /^\/canvas-studio\/assets\/p1\//u, `${name} URL 应同源`)
    }
    assert.equal(
      calls.filter((c) => c.url.includes('/upload') || c.url.includes('/promote')).length,
      0,
      `saveLocalAssetBytes 不得触发 Drama 上传/promote，实际: ${JSON.stringify(calls)}`,
    )
    const files = await readdir(dir)
    assert.equal(files.length, cases.length, `应落 ${cases.length} 个文件: ${files.join(',')}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-241 saveLocalAssetBytes：未知扩展 / 空 body 拒绝且不写盘', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-upload-media-rej-'))
  try {
    stubFetch()
    await assert.rejects(
      () => saveLocalAssetBytes(stubRegistry(dir), 'p1', 'payload.exe', Buffer.from([1])),
      (err) => err.code === 'CS-USER-ERR' && /不支持的文件类型/u.test(err.message),
      '未知扩展名必须 CS-USER-ERR',
    )
    await assert.rejects(
      () => saveLocalAssetBytes(stubRegistry(dir), 'p1', 'noextension', Buffer.from([1])),
      (err) => err.code === 'CS-USER-ERR',
      '无扩展名必须拒绝',
    )
    await assert.rejects(
      () => saveLocalAssetBytes(stubRegistry(dir), 'p1', 'empty.txt', Buffer.alloc(0)),
      (err) => err.code === 'CS-USER-ERR' && /为空/u.test(err.message),
      '空 body 必须拒绝',
    )
    const files = await readdir(dir)
    assert.equal(files.length, 0, `拒绝时不得写盘: ${files.join(',')}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ── 接线：路由与 api ─────────────────────────────────────────────────────────

test('CV-241 upload-media 路由：octet-stream + 分类型限额 + 413/400 + 无 promote', () => {
  assert.match(ROUTES, /ROUTE_UPLOAD_MEDIA = '\/canvas-studio\/upload-media'/,
    '必须有 upload-media 路由常量')
  const mediaRoute = ROUTES.slice(
    ROUTES.indexOf('path: ROUTE_UPLOAD_MEDIA'),
    ROUTES.indexOf('path: ROUTE_UPLOAD,'),
  )
  assert.ok(mediaRoute.length > 0, 'upload-media 路由注册必须存在')
  // Query 形态
  assert.match(mediaRoute, /searchParams\.get\('projectId'\)/, '必须读 projectId query')
  assert.match(mediaRoute, /searchParams\.get\('name'\)/, '必须读 name query')
  // 分类 + 限额同源
  assert.match(mediaRoute, /classifyFile\(name\)/, '必须按扩展名分类')
  assert.match(mediaRoute, /MEDIA_UPLOAD_LIMITS\[kind\]/, '限额必须取自 MEDIA_UPLOAD_LIMITS（不另抄字面量）')
  assert.match(mediaRoute, /readRawBody\(req, controller\.signal, limit\)/, '必须用 readRawBody + 分类型 limit')
  // 失败路径
  assert.match(mediaRoute, /413/, '超限必须回 413')
  assert.match(mediaRoute, /不支持的文件类型/, '未知扩展必须给中文 400')
  assert.match(mediaRoute, /body too large/, '流式超限必须识别并转 413')
  // 成功句柄
  assert.match(mediaRoute, /saveLocalAssetBytes\(/, '必须调 saveLocalAssetBytes 落盘')
  assert.match(mediaRoute, /assetFile: result\.assetFile/, '成功响应必须带 assetFile')
  // §5.4 不变量：上传路由内不得 promote
  assert.doesNotMatch(mediaRoute, /promoteAssetFile\(/,
    'upload-media 路由不得调用 promoteAssetFile（惰性提升）')
  // octet-stream 客户端接线
  assert.match(API, /uploadStudioMedia/, 'api.ts 必须导出 uploadStudioMedia')
  assert.match(API, /\/canvas-studio\/upload-media\?/, 'uploadStudioMedia 必须打到 upload-media')
  assert.match(API, /'content-type': 'application\/octet-stream'/, '必须是 octet-stream')
  assert.doesNotMatch(
    API.slice(API.indexOf('export async function uploadStudioMedia'), API.indexOf('export async function uploadStudioVideo')),
    /classifyFile/,
    'api 层是哑管道，不得在客户端分类',
  )
})

test('CV-241 限额表：路由可见的 MEDIA_UPLOAD_LIMITS 与 Q2 拍板一致', () => {
  assert.equal(MEDIA_UPLOAD_LIMITS.image, 16 * 1024 * 1024, 'image 16MB')
  assert.equal(MEDIA_UPLOAD_LIMITS.audio, 32 * 1024 * 1024, 'audio 32MB')
  assert.equal(MEDIA_UPLOAD_LIMITS.text, 5 * 1024 * 1024, 'text 5MB')
  assert.equal(MEDIA_UPLOAD_LIMITS.video, 128 * 1024 * 1024, 'video 128MB')
  // 路由必须 import 这张表（防「路由里另写一份上限」）
  assert.match(ROUTES, /MEDIA_UPLOAD_LIMITS/, 'routes.ts 必须引用 MEDIA_UPLOAD_LIMITS')
})
