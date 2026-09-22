#!/usr/bin/env node
/**
 * 视频理解通道探针（`video2vl`，Qwen3-VL）—— 串行，快速失败优先。
 *
 * 回答两个问题（成本升序）：
 *   1. **产物名能否直接当 `video`**？CV-155 对图片、CV-226 对参考视频的结论都是「不能」
 *      （后端 0.1s 前置 500），本端点待证 —— 它决定工具描述要不要写警告、要不要自愈。
 *   2. **上传句柄能否当 `video`、返回什么、耗时多少**？耗时决定超时档位选
 *      `DRAMA_TIMEOUT_MS` 的哪一档（text 180s / image 360s / video 600s）。
 *
 * ⚠️ 动手之前先读 `docs/api-probe/video2vl-20260922/report.md`（若已存在则别重复问）。
 *
 * 用法
 * ----
 *   node scripts/probe-video2vl.mjs            # 跑 1→2
 *   node scripts/probe-video2vl.mjs --only 1   # 只跑产物名对照（约 1 秒）
 *   node scripts/probe-video2vl.mjs --video <本地mp4>
 *   DRAMA_API_BASE=http://x:port node scripts/probe-video2vl.mjs
 *
 * ⚠️ 两个必须知道的坑（本脚本已处理，改动时别改回去）
 *   1. **长超时 dispatcher**：undici 默认 headersTimeout/bodyTimeout = 300s 且**先于**
 *      AbortSignal 触发（CV-133）。做法同 `src/long-request.ts`。
 *   2. **`Symbol.for('undici.globalDispatcher.1')` 要等首次请求之后才存在** —— 所以先 ping
 *      一次再取 dispatcher，否则永远拿不到、静默退回 300s。
 */

const BASE = process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082'
const VIDEO2VL = '/api/v1/generate/video2vl'
const UPLOAD = '/api/v1/generate/upload'

/** 默认样本：真实项目里的视频资产（别用 1×1 占位 —— CV-145 误判过）。 */
const DEFAULT_VIDEO = '/Users/wl/Desktop/job/VideoOut/newOut/projects/测试放手跑2/assets/3bd7c12c-601e-4805-a434-2890c22e7d58.mp4'
/** 产物名对照样本（取自画布上真实的生成产物节点）。 */
const PRODUCT_NAME = 'MiniMax_H3_ref2va_00020_.mp4'

const SYSTEM_PROMPT = 'You are a helpful video analysis assistant.'
const PROMPT = '请按时间轴描述这段视频的镜头运动、景别变化与主体动作，逐段列出。'

function argOf(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}
const only = argOf('--only', null)
const videoPath = argOf('--video', DEFAULT_VIDEO)

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
    return { status: response.status, ms: Date.now() - started, body: text.slice(0, 900) }
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
  form.append('file', new Blob([new Uint8Array(bytes)]), `probe-v2vl-${Date.now().toString(36)}.${ext}`)
  const started = Date.now()
  try {
    const response = await fetch(`${BASE}${UPLOAD}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(300_000),
      ...(dispatcher !== undefined ? { dispatcher } : {}),
    })
    const json = await response.json()
    return { status: response.status, ms: Date.now() - started, bytes: bytes.byteLength, handle: json?.name ?? json?.filename }
  } catch (cause) {
    return { status: 'NETWORK_FAIL', ms: Date.now() - started, bytes: bytes.byteLength, handle: null, body: String(cause?.message ?? cause) }
  }
}

async function main() {
  const ping = await postJson(VIDEO2VL, {}, 20_000, undefined)
  console.log(`[ping] status=${ping.status} ms=${ping.ms} body=${ping.body.slice(0, 160)}`)
  if (ping.status === 'NETWORK_FAIL') {
    console.log('\n后端不可达 —— 探针终止。')
    return 2
  }
  const dispatcher = longDispatcher(900_000)
  console.log(`[dispatcher] ${dispatcher === undefined ? '不可用（会退回 300s）' : 'ok（900s）'}`)

  if (only === null || only === '1') {
    console.log('\n===== 探针 1：video = 生成产物名 =====')
    const result = await postJson(VIDEO2VL, {
      system_prompt: SYSTEM_PROMPT, prompt: PROMPT, video: PRODUCT_NAME,
    }, 620_000, dispatcher)
    console.log(`  status=${result.status} ms=${(result.ms / 1000).toFixed(1)}s`)
    console.log(`  body=${result.body}`)
    console.log('  判读：0.1s 级 500 = 产物名被前置拒绝（与 CV-155/226 一致）；200 = 本端点不校验文件名来源')
  }

  if (only === null || only === '2') {
    console.log('\n===== 探针 2：video = 上传句柄（端到端）=====')
    const up = await upload(videoPath, dispatcher)
    console.log(`  [upload] status=${up.status} ms=${up.ms} bytes=${up.bytes} handle=${up.handle}`)
    if (up.handle) {
      const result = await postJson(VIDEO2VL, {
        system_prompt: SYSTEM_PROMPT, prompt: PROMPT, video: up.handle,
      }, 900_000, dispatcher)
      console.log(`  status=${result.status} ms=${(result.ms / 1000).toFixed(1)}s`)
      console.log(`  body=${result.body}`)
      console.log('  判读：200 且 output 有内容 = 通道可用；耗时决定 DRAMA_TIMEOUT_MS 取哪一档')
    }
  }
  return 0
}

process.exitCode = await main()
