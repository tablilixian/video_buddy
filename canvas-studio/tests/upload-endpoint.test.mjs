/**
 * CV-137 统一上传端点契约：`POST /api/v1/generate/upload`。
 *
 * 背景（2026-09-10 实测）：旧的 `/api/v1/generate/uploadimage` 已从后端路由表移除
 * ——对图片/视频/音频任何文件均返回 `404 {"detail":"Not Found"}`，`openapi.json`
 * 里也不再出现该路径。新端点是**唯一**的上传入口，且不限文件类型。
 *
 * 「先上传拿 name，再把 name 填进以文件名为入参的接口」是所有下游生成接口的标准
 * 前置流程（image2image 的 image、image2vl 的 image、ref2va 的 image1..9 /
 * video1..3 / audio1..3 …），因此本文件把这条通路的四件事全部锁死：
 *
 * 1. 端点常量 = `/api/v1/generate/upload`，且**不再存在** `uploadimage` 键（防回弹）。
 * 2. 请求形态：form-data 字段名必须是 `file`；上传文件名走唯一安全名
 *    （只含 [A-Za-z0-9._-]，无空格/括号——后端会给重名加 ` (1)` 后缀，
 *    带空格括号的名字会让下游 500）。
 * 3. 响应解析：取 `name`（ComfyUI 原生 `{name, subfolder, type}`），并兼容
 *    `filename` / `data.filename` / `data.url`。
 * 4. 404 / 非 2xx / 缺字段都有明确中文错误，不静默返回 undefined。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DRAMA_ENDPOINTS } from '../lib/config.js'
import { uploadBytesToDrama, resetDramaProbeCache } from '../lib/generate.js'

/** 打桩：健康探针放行 + 记录上传请求，按 json 返回给定响应。 */
function stubUpload(response, status = 200) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    const form = init.body
    const file = typeof form?.get === 'function' ? form.get('file') : null
    calls.push({
      url: target,
      method: init.method ?? 'GET',
      fieldNames: typeof form?.getAll === 'function' ? form.getAll('file').length : 0,
      fileName: file?.name,
      fileType: file?.type,
      // 请求头里是否被写死了 Content-Type（写死会让 boundary 丢失，后端解析失败）。
      contentType: init.headers === undefined ? undefined : JSON.stringify(init.headers),
    })
    return { ok: status < 400, status, json: async () => response, text: async () => JSON.stringify(response) }
  }
  return calls
}

test('CV-137 上传端点：只认 /api/v1/generate/upload，uploadimage 已从常量表移除', () => {
  assert.equal(DRAMA_ENDPOINTS.upload, '/api/v1/generate/upload')
  assert.ok(
    !Object.keys(DRAMA_ENDPOINTS).includes('uploadimage'),
    'uploadimage 已从后端路由表移除（实测 404），不得再出现在端点常量里',
  )
  assert.ok(
    !Object.values(DRAMA_ENDPOINTS).some((path) => path.includes('uploadimage')),
    '端点表里不应再残留 uploadimage 路径',
  )
})

test('CV-137 上传请求形态：form-data 字段 file + 唯一安全名（无空格/括号）', async () => {
  resetDramaProbeCache()
  const calls = stubUpload({ name: 'ref-abcd1234.png', subfolder: '', type: 'input' })
  const name = await uploadBytesToDrama(new Uint8Array([1, 2, 3]), 'png')
  assert.equal(name, 'ref-abcd1234.png', '应取响应里的 name 字段')
  assert.equal(calls.length, 1, '应恰好发起一次上传请求')
  assert.equal(calls[0].url, 'http://117.50.108.73:8082/api/v1/generate/upload')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].fieldNames, 1, 'form-data 字段名必须是 file')
  // 唯一安全名：ref-<8 位 uuid>.<ext>——只含 [A-Za-z0-9._-]，且每次不同。
  assert.match(calls[0].fileName ?? '', /^ref-[0-9a-f]{8}\.png$/u, `上传文件名不合安全名约定: ${calls[0].fileName}`)
  assert.equal(calls[0].contentType, undefined, '不得手工写死 Content-Type（boundary 会丢失）')
})

test('CV-137 上传响应解析：兼容 name / filename / data.* 四种形态', async () => {
  const cases = [
    [{ name: 'a.png', subfolder: '', type: 'input' }, 'a.png'],
    [{ filename: 'b.png' }, 'b.png'],
    [{ data: { filename: 'c.png' } }, 'c.png'],
    [{ data: { url: 'd.png' } }, 'd.png'],
  ]
  for (const [response, expected] of cases) {
    resetDramaProbeCache()
    stubUpload(response)
    const name = await uploadBytesToDrama(new Uint8Array([1]), 'png')
    assert.equal(name, expected, `响应 ${JSON.stringify(response)} 应解析出 ${expected}，实际 ${name}`)
  }
})

test('CV-137 上传失败有明确中文提示：404 / 500 / 缺字段', async () => {
  resetDramaProbeCache()
  stubUpload({ detail: 'Not Found' }, 404)
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'png'),
    /404.*Drama Backend/u,
    '404 应给出「后端未注册该端点」的定位提示，而不是笼统的上传失败',
  )

  resetDramaProbeCache()
  stubUpload({}, 500)
  await assert.rejects(() => uploadBytesToDrama(new Uint8Array([1]), 'png'), /文件上传失败: 500/u)

  resetDramaProbeCache()
  stubUpload({ subfolder: '', type: 'input' }, 200)
  await assert.rejects(
    () => uploadBytesToDrama(new Uint8Array([1]), 'png'),
    /未返回 filename/u,
    '响应缺文件名时必须报错，不得返回 undefined 污染下游',
  )
})
