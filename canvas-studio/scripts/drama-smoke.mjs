/**
 * Drama Backend 真机烟测脚本 —— 阶段 7 A11（Drama 回归）用。
 *
 * 直驱 `lib/providers/drama.js`，用最小化的 `dramaPostWithFallback` 注入
 * （与 generate.ts 的 callDrama 行为对齐：POST base+endpoint、JSON、
 * 响应归一 full_url ?? data[0].url + 可选 filename；无鉴权头，后端 keyless）。
 *
 * 用法：
 *   node scripts/drama-smoke.mjs                       # A11：Drama 纯文生视频
 *   node scripts/drama-smoke.mjs --image a.png         # i2v：单首帧（fl2va + image1）
 *   node scripts/drama-smoke.mjs --image a.png --image b.png   # 首尾帧（fl2va + image1/2）
 *   DRAMA_API_BASE=http://x.x.x.x:port node scripts/drama-smoke.mjs
 *
 * 退出码：0 = 符合预期；1 = 异常。
 */
import { createDramaProvider } from '../lib/providers/drama.js'
import { readFileSync } from 'node:fs'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const HAS_DURATION = process.argv.includes('--duration')
const DURATION = Number(HAS_DURATION ? process.argv[process.argv.indexOf('--duration') + 1] : 5)
// 收集 --image <path>（可传 1–2 张）；0 张 = t2v。
const IMAGES = []
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--image') {
    const p = process.argv[i + 1]
    if (p === undefined || p.startsWith('--')) fail('--image 需要跟一个图片路径')
    IMAGES.push(p)
    i++
  }
}
const EXT_OF = (p) => (p.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? 'png').toLowerCase()
const TIMEOUT_MS = 600_000 // 10 分钟

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function fail(msg) { console.error(`✗ ${msg}`); process.exit(1) }

/** 与 generate.ts callDrama 对齐的最小 POST + 响应归一。 */
async function post(endpoint, body, signal) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal !== undefined ? { signal } : {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`生成失败: HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const url = data.full_url ?? data.data?.[0]?.url
  if (!url) throw new Error(`生成响应中未找到产物 URL：${JSON.stringify(data).slice(0, 300)}`)
  return data.filename !== undefined ? { url, filename: data.filename } : { url }
}

async function main() {
  // 0. 健康检查
  try {
    const h = await fetch(`${BASE}/api/v1/health`)
    const j = await h.json()
    if (j.status !== 'ok') fail(`health 异常：${JSON.stringify(j)}`)
    console.log(`[drama-smoke] health ok (${BASE})`)
  } catch (e) {
    return fail(`后端不可达：${e instanceof Error ? e.message : e}`)
  }

  const provider = createDramaProvider()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const ctx = {
    signal: controller.signal,
    dramaPostWithFallback: async (endpoint, body) => post(endpoint, body, controller.signal),
  }

  // --image 模式：先 multipart 上传（与 generate.ts uploadBytesToDrama 对齐），拿服务器 filename。
  const refs = []
  for (const p of IMAGES) {
    const bytes = readFileSync(p)
    const assetId = Math.random().toString(36).slice(2, 10)
    const form = new FormData()
    form.append('file', new Blob([bytes]), `ref-${assetId}.${EXT_OF(p)}`)
    const up = await fetch(`${BASE}/api/v1/generate/uploadimage`, { method: 'POST', body: form, signal: controller.signal })
    if (!up.ok) { clearTimeout(timer); return fail(`参考图上传失败：HTTP ${up.status} ${(await up.text()).slice(0, 200)}`) }
    const data = await up.json()
    const filename = data.filename ?? data.name ?? data.data?.filename ?? data.data?.url
    if (!filename) { clearTimeout(timer); return fail(`上传成功但未返回 filename：${JSON.stringify(data).slice(0, 200)}`) }
    refs.push({ localPath: String(filename) })
    console.log(`  uploaded ${p} → ${filename}`)
  }

  const req = {
    capability: refs.length > 0 ? 'first-last-frame' : 'text-to-video',
    prompt: '一只橘猫在阳光下的草地上奔跑，镜头缓慢平移，写实风格，电影感',
    duration: DURATION,
    aspectRatio: '16:9',
    references: refs, // VideoRequest 契约：references 必填
  }
  console.log(`[drama-smoke] ${refs.length > 0 ? `i2v×${refs.length}` : 't2v'} duration=${req.duration} aspect=${req.aspectRatio}`)

  let handle
  try {
    handle = await provider.submit(req, ctx)
  } catch (e) {
    clearTimeout(timer)
    return fail(`submit 抛错 → ${e instanceof Error ? e.message : e}`)
  }
  clearTimeout(timer)
  if (handle.settled?.url) {
    console.log('✓ A11 通过：Drama 出片成功（同步 settled）')
    console.log(`  视频 URL: ${handle.settled.url}`)
    if (handle.settled.filename) console.log(`  filename: ${handle.settled.filename}`)
    process.exit(0)
  }
  fail(`settled 缺失 url → ${JSON.stringify(handle).slice(0, 200)}`)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
