#!/usr/bin/env node
/**
 * 参考视频通道探针（`image2videoref2va` 的 `video1`–`video3`）—— 串行，快速失败优先。
 *
 * 回答三个问题（成本升序）：
 *   1. **产物名能否直接当 `video1`**？CV-155 对图片的结论是「不能」，视频此前未实测。
 *      兼答「参考视频能否作**唯一**输入」（官方说可以，后端待证）。
 *   2. **上传句柄能否当 `video1`**？（上传拿 `ref-*.mp4`）
 *   3. 图 + 视频同场（官方推荐形态）。
 *
 * ⚠️ 动手之前先读 `docs/api-probe/video-reference-20260922/report.md` —— 该通道
 *    2026-09-10/11 已有 200 实证（`docs/api.md:658`），别重复问已经答过的问题。
 *
 * 用法
 * ----
 *   node scripts/probe-video-reference.mjs              # 跑 1→2→3（串行，约十几分钟）
 *   node scripts/probe-video-reference.mjs --only 1      # 只跑产物名对照（约 1 秒）
 *   DRAMA_API_BASE=http://x:port node scripts/probe-video-reference.mjs
 *   node scripts/probe-video-reference.mjs --video <本地mp4> --image <本地png>
 *
 * 后端是**单任务同步**的 ⇒ 全程串行，且避开用户使用时段。
 *
 * ⚠️ 两个必须知道的坑（本脚本已处理，改动时别改回去）
 *   1. **长超时 dispatcher**：undici 默认 `headersTimeout`/`bodyTimeout` = 300s，且**先于**
 *      `AbortSignal` 触发（CV-133）。不注入 dispatcher 的话，301s 就被掐 —— 看起来像
 *      「后端挂了」，其实是传输层。做法同 `src/long-request.ts`。
 *   2. **`Symbol.for('undici.globalDispatcher.1')` 要等首次请求之后才存在**（实测：发请求前
 *      `undefined`、发过一次 GET 后是 `Agent`）。脚本里必须先 ping 一次再取 dispatcher，
 *      否则永远拿不到、静默退回 300s。
 */

const BASE = process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082'
const REF2VA = '/api/v1/generate/image2videoref2va'
const UPLOAD = '/api/v1/generate/upload'

/** 默认样本：两端都取真实项目里的资产（有意义的尺寸，别用 1×1 占位图 —— CV-145 误判过）。 */
const DEFAULT_VIDEO = '/Users/wl/Desktop/job/VideoOut/newOut/projects/测试放手跑2/assets/3bd7c12c-601e-4805-a434-2890c22e7d58.mp4'
const DEFAULT_IMAGE = '/Users/wl/Desktop/job/VideoOut/newOut/projects/北京书市/assets/85353f04-7a61-466c-a055-d3aa445248d5.png'
/** 产物名对照样本（取自画布上真实的生成产物节点）。形态不同则 `isDramaProductName` 判定不同。 */
const PRODUCT_NAME = 'MiniMax_H3_ref2va_00020_.mp4'

const PROMPT = 'Refer to video 1 for the camera movement and pacing. '
  + 'A calm lake at sunrise, slow push in. Cinematic, natural light.'

function argOf(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}
const only = argOf('--only', null)
const videoPath = argOf('--video', DEFAULT_VIDEO)
const imagePath = argOf('--image', DEFAULT_IMAGE)

/** 长超时 dispatcher（与 `src/long-request.ts` 同一手法：借全局实例的 constructor 造同款）。 */
function longDispatcher(timeoutMs) {
  try {
    const ctor = globalThis[Symbol.for('undici.globalDispatcher.1')]?.constructor
    if (typeof ctor !== 'function') return undefined
    const instance = new ctor({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs })
    return typeof instance?.dispatch === 'function' ? instance : undefined
  } catch {
    return undefined
  }
}

async function postJson(path, body, timeoutMs, dispatcher) {
  const started = Date.now()
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      ...(dispatcher !== undefined ? { dispatcher } : {}),
    })
    const text = await response.text()
    return { status: response.status, ms: Date.now() - started, body: text.slice(0, 800) }
  } catch (cause) {
    return { status: 'NETWORK_FAIL', ms: Date.now() - started, body: String(cause?.message ?? cause) }
  }
}

async function upload(localPath, dispatcher) {
  const { readFile } = await import('node:fs/promises')
  const { basename } = await import('node:path')
  const bytes = await readFile(localPath)
  const ext = basename(localPath).split('.').pop()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), `ref-probe-${Date.now().toString(36)}.${ext}`)
  const started = Date.now()
  try {
    const response = await fetch(`${BASE}${UPLOAD}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(300_000),
      ...(dispatcher !== undefined ? { dispatcher } : {}),
    })
    const json = await response.json()
    return { status: response.status, ms: Date.now() - started, bytes: bytes.byteLength, json, handle: json?.name ?? json?.filename }
  } catch (cause) {
    return { status: 'NETWORK_FAIL', ms: Date.now() - started, bytes: bytes.byteLength, json: null, handle: null, body: String(cause?.message ?? cause) }
  }
}

async function main() {
  // 连通性先探一次：连不上就不必浪费后端额度。**顺带**把 undici 的全局 dispatcher 装上，
  // 之后 longDispatcher() 才拿得到（见文件头 ⚠️2）。
  const ping = await postJson(REF2VA, {}, 20_000, undefined)
  console.log(`[ping] status=${ping.status} ms=${ping.ms} body=${ping.body.slice(0, 120)}`)
  if (ping.status === 'NETWORK_FAIL') {
    console.log('\n后端不可达 —— 探针终止。')
    return 2
  }
  const dispatcher = longDispatcher(900_000)
  console.log(`[dispatcher] ${dispatcher === undefined ? '不可用（会退回 300s）' : 'ok（900s）'}`)

  if (only === null || only === '1') {
    console.log('\n===== 探针 1：video1 = 生成产物名，且无图（兼测「视频可作唯一输入」）=====')
    const result = await postJson(REF2VA, {
      prompt: PROMPT, aspect: '16:9', megapixels: 0.9, duration: 5, video1: PRODUCT_NAME,
    }, 620_000, dispatcher)
    console.log(`  status=${result.status} ms=${(result.ms / 1000).toFixed(1)}s`)
    console.log(`  body=${result.body}`)
    console.log('  判读：0.1s 级 500 = 产物名被前置拒绝（预期）；若长时间未返回 ⇒ 与 CV-155 结论不符，需复查')
  }

  if (only === null || only === '2') {
    console.log('\n===== 探针 2：video1 = 上传句柄，无图 =====')
    const up = await upload(videoPath, dispatcher)
    console.log(`  [upload] status=${up.status} ms=${up.ms} bytes=${up.bytes} handle=${up.handle}`)
    if (up.handle) {
      const result = await postJson(REF2VA, {
        prompt: PROMPT, aspect: '16:9', megapixels: 0.9, duration: 5, video1: up.handle,
      }, 900_000, dispatcher)
      console.log(`  status=${result.status} ms=${(result.ms / 1000).toFixed(1)}s`)
      console.log(`  body=${result.body}`)
      console.log('  判读：0.1s 500 = 句柄被拒（与预期不符）；跑满超时 = 被接受并在生成')
    }
  }

  if (only === null || only === '3') {
    console.log('\n===== 探针 3：image1 = 图句柄 + video1 = 视频句柄（官方推荐形态）=====')
    const upImage = await upload(imagePath, dispatcher)
    const upVideo = await upload(videoPath, dispatcher)
    console.log(`  [upload] image=${upImage.handle} (${upImage.bytes}B)  video=${upVideo.handle} (${upVideo.bytes}B)`)
    if (upImage.handle && upVideo.handle) {
      const result = await postJson(REF2VA, {
        prompt: PROMPT, aspect: '16:9', megapixels: 0.9, duration: 5,
        image1: upImage.handle, video1: upVideo.handle,
      }, 900_000, dispatcher)
      console.log(`  status=${result.status} ms=${(result.ms / 1000).toFixed(1)}s`)
      console.log(`  body=${result.body}`)
    }
  }
  return 0
}

process.exitCode = await main()
