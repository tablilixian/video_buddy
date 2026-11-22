/**
 * B2 三段式上传共享桩（迁移方案 2026-11-22）。
 *
 * 旧通道 multipart `POST /api/v1/generate/upload`（ComfyUI `{name}` 句柄）已随
 * 生成后端 8082 退役；流程类测试统一从这里拿 `/v1/assets/*` 三段式分支：
 * presign（201，确定性 asset_id）→ PUT（200）→ complete（ready）。
 *
 * 用法（在测试文件的 fetch 桩里，health 分支之后插入）：
 *   const handled = assetUploadBranch(text, init)
 *   if (handled !== null) return handled
 *
 * 句柄断言用 {@link lastAssetHandle}（本用例 `resetAssetUploadStub()` 后的
 * 第一次上传 = `ASSET_HANDLE(1)` 的同值）。asset id 形态恒为 UUID（complete
 * 解析守卫要求），序号跨用例递增 —— 断言前先 `resetAssetUploadStub()`。
 */

/** 第 n 次上传的确定性 asset id（UUID 形态，8-4-4-4-12）。 */
export const ASSET_HANDLE = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`

let seq = 0
let lastAsset = ''

/** 用例开头归一：让 ASSET_HANDLE(1) 恒为本用例的第一次上传。 */
export function resetAssetUploadStub() {
  seq = 0
  lastAsset = ''
}

/** 最近一次 presign 返回的 asset id（promote/heal 句柄断言用）。 */
export function lastAssetHandle() {
  return lastAsset
}

/**
 * 三段式分支：命中返回假响应对象（调用方直接 return），未命中返回 null。
 * presign 的 upload_url 指向 blob.test（https，能过安全校验）；PUT 与
 * complete 都在本分支内闭环，不触真实网络。
 */
export function assetUploadBranch(text, init = {}) {
  if (init.method === 'POST' && text.includes('/v1/assets/presign')) {
    seq += 1
    lastAsset = ASSET_HANDLE(seq)
    return {
      ok: true,
      status: 201,
      json: async () => ({
        asset: { id: lastAsset, type: 'image', status: 'uploading' },
        upload_url: 'https://blob.test/put/ref',
        headers: { 'content-type': 'image/png' },
      }),
    }
  }
  if (text === 'https://blob.test/put/ref') {
    return { ok: true, status: 200, json: async () => ({}) }
  }
  if (init.method === 'POST' && text.includes('/v1/assets/complete')) {
    return { ok: true, status: 200, json: async () => ({ id: lastAsset, type: 'image', status: 'ready' }) }
  }
  return null
}
