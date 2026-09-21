// Drama Backend 离线夹具（mock）—— 只为一件事：在没有真实后端时也能端到端验证
// **测试工具自己**（同源代理链路、串行依赖、判定口径、负向用例判据）。
//
// ⚠️ 这不是契约来源。所有响应形态都抄自实测留档，改后端后必须先回归本文件：
//   · 成功响应体 → canvas-studio/docs/api-probe/image2fix-20260918/report.md
//   · health     → 2026-09-21 直连实测：{"status":"ok","queue_task_count":0}
//                  （更早留档 video-backend-test-*/raw.json 是 {"status":"ok"}，后端后来加了队列深度）
//   · 422 形状   → docs/api-probe/krea2-turbo-20260916/openapi-20260916.json（HTTPValidationError）
//   · 产品名 500 → image2fix-20260918 留档：产物名当句柄 52ms 内 500
//
// 它同时扮演 vite 的同源代理：真实链路是「浏览器 → /api/proxy → Drama」，
// 这里把 /api/proxy、/api/fetch-to-upload、/api/fetch-media 三条路由一起实现，
// 于是 smoke.mjs 可以完全不依赖 vite dev server 跑通。
//
// 用法：
//   node scripts/mock-backend.mjs                 # 默认 127.0.0.1:5189
//   MOCK_PORT=5190 MOCK_DELAY_MS=50 node scripts/mock-backend.mjs
//   MOCK_QUEUE=3 node scripts/mock-backend.mjs    # 伪装有 3 个任务在队列里（验证队列告警）
//   node scripts/smoke.mjs --base http://127.0.0.1:5189 --proxy http://127.0.0.1:5189
//
// 自省：GET /__log 返回收到的全部请求；GET /__reset 清空计数。

import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 5189)
const HOST = process.env.MOCK_HOST ?? '127.0.0.1'
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 0)
/** 伪装的队列深度（真实后端 health 会回 queue_task_count）。 */
const QUEUE = Number(process.env.MOCK_QUEUE ?? 0)
/** 注入故障：逗号分隔的 path 片段，命中的请求返回 500（验证错误分级）。 */
const FAIL_ON = (process.env.MOCK_FAIL_ON ?? '').split(',').map((s) => s.trim()).filter(Boolean)
/**
 * 注入「**静默坏 200**」：逗号分隔的 path 片段，命中的请求返回 `200 {}`。
 *
 * 这是断言层存在的理由 —— 旧口径（只看 HTTP）会把 `200 {}` 判成 PASS，而客户端
 * 拿到的是「生成响应中未找到产物 URL」。用它做变异检验：注入后报告必须转红。
 */
const BAD_200_ON = (process.env.MOCK_BAD_200 ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const SELF = `http://${HOST}:${PORT}`

// —— 请求约束（与 09-16 OpenAPI 的 required / enum / 类型一致）——
const REQUIRED = {
  '/api/v1/generate/txt2image': ['prompt'],
  '/api/v1/generate/txt2imageanime': ['prompt'],
  '/api/v1/generate/image2image': ['prompt'],
  '/api/v1/generate/image2fix': ['prompt', 'image'],
  '/api/v1/generate/image2character': [], // 契约里 image 可选（default ''）
  '/api/v1/generate/image2vl': ['system_prompt', 'prompt'],
  '/api/v1/generate/image2promptenhance': ['prompt'],
  '/api/v1/generate/image2videofl2va': ['prompt'],
  '/api/v1/generate/image2videoref2va': ['prompt'],
  '/api/v1/generate/txt2audio': ['caption_prompt', 'lyrics_prompt'],
}
const ASPECT_ENUM = ['16:9', '9:16']
/** 产物名形态（与 canvas-studio/src/generate.ts 的 isDramaProductName 同判据）。 */
const PRODUCT_NAME = /_\d{4,}_?\.[A-Za-z0-9]+$/u

/** 1×1 透明 PNG —— 给 /view 和 /api/fetch-media 用（真后端也走这条通道）。 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const log = []
const seen = new Map()
/**
 * 夹具「发出去过」的句柄集合。
 *
 * 真后端把上传文件放 temp/，「文件不存在」与「产品名直用」一样报笼统 500
 * （canvas-studio/src/generate.ts 的 isBadReferenceError 注释）。夹具要能复现这一点，
 * 否则「不存在的句柄」这类负向用例在离线环境下会被误判成通过 —— 夹具比后端宽松
 * 会漏报，比后端严格会假警报，两边都要对齐。
 */
const knownHandles = new Set()

function validationError(field, msg, type = 'missing') {
  return { loc: ['body', field], msg, type }
}

/** 模拟 FastAPI 的请求校验（422）与「产物名当句柄」的 500 快失败。 */
function validate(path, body) {
  const errs = []
  for (const f of REQUIRED[path] ?? []) {
    const v = body?.[f]
    // ⚠️ 只有「字段缺失 / null」才算 422。**空串是合法的 str**（Pydantic 口径），
    //    例如 txt2audio 的 lyrics_prompt 传 "" 是正常用法（纯音乐）。
    //    早期版本把空串也判成缺失，导致对真实用例误报 —— 夹具比后端更严 = 假警报。
    if (v === undefined || v === null) {
      errs.push(validationError(f, 'Field required', 'missing'))
    }
  }
  if (errs.length > 0) return { status: 422, json: { detail: errs } }

  if ('aspect' in (body ?? {})) {
    if (!ASPECT_ENUM.includes(body.aspect)) {
      return {
        status: 422,
        json: { detail: [validationError('aspect', `Input should be '${ASPECT_ENUM.join("' or '")}'`, 'enum')] },
      }
    }
  }
  for (const f of ['duration', 'width', 'height']) {
    if (f in (body ?? {}) && !Number.isInteger(body[f])) {
      return {
        status: 422,
        json: { detail: [validationError(f, 'Input should be a valid integer', 'int_parsing')] },
      }
    }
  }

  // 句柄类入参必须「真的存在」：产物名 → 500（实测 52ms）；未上传过的名字 → 500（temp/ 里没有）
  for (const f of ['image', 'filename', 'image1', 'image2', 'image3', 'image4']) {
    const v = body?.[f]
    if (typeof v !== 'string' || v === '') continue
    if (PRODUCT_NAME.test(v)) return { status: 500, json: null }
    if (!knownHandles.has(v)) return { status: 500, json: null }
  }
  return null
}

function artifactBody(name) {
  return { prompt_id: `mock-${name}`, filename: name, full_url: `${SELF}/view?filename=${name}`, duration: 1.23 }
}

function handle(path, body) {
  const bad = validate(path, body)
  if (bad) return bad
  switch (path) {
    case '/api/v1/generate/txt2image':
      return { status: 200, json: artifactBody('krea2_00001_.png') }
    case '/api/v1/generate/txt2imageanime':
      return { status: 200, json: artifactBody('anime_00001_.png') }
    case '/api/v1/generate/image2image':
      return { status: 200, json: artifactBody('krea2_00002_.png') }
    case '/api/v1/generate/image2fix':
      return { status: 200, json: artifactBody('boogu_00009_.png') }
    case '/api/v1/generate/image2character':
      return { status: 200, json: artifactBody('quadview_00003_.png') }
    case '/api/v1/generate/image2videofl2va':
    case '/api/v1/generate/image2videoref2va':
      return { status: 200, json: artifactBody('video_00007_.mp4') }
    case '/api/v1/generate/txt2audio':
      return { status: 200, json: artifactBody('audio_00004_.mp3') }
    case '/api/v1/generate/image2vl':
      return { status: 200, json: { prompt_id: 'mock-vl', output: '画面中央是一名角色，构图居中。', duration: 0.4 } }
    case '/api/v1/generate/image2promptenhance':
      return { status: 200, json: { output: 'a cat sitting on a windowsill, soft morning light, cinematic' } }
    default:
      return null
  }
}

function send(res, status, payload, contentType = 'application/json') {
  const body = payload === null ? 'Internal Server Error'
    : contentType === 'application/json' ? JSON.stringify(payload)
    : payload
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', SELF)
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    void (async () => {
      if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS))

      // —— 自省路由 ——
      if (u.pathname === '/__log') return send(res, 200, { count: log.length, log })
      if (u.pathname === '/__reset') {
        log.length = 0
        seen.clear()
        return send(res, 200, { ok: true })
      }
      if (u.pathname === '/view') return send(res, 200, PNG_1PX, 'image/png')

      if (FAIL_ON.some((frag) => u.pathname.includes(frag))) return send(res, 500, null)

      const raw = Buffer.concat(chunks).toString('utf8')

      // —— 同源代理路由（与 vite.config.ts 的同名中间件同形）——
      if (u.pathname === '/api/proxy') {
        const target = u.searchParams.get('target') ?? ''
        const path = u.searchParams.get('path') ?? ''
        let body = null
        try { body = raw ? JSON.parse(raw) : null } catch { body = null }
        log.push({ via: 'proxy', target, path, method: req.method, body, at: Date.now() })
        seen.set(path, (seen.get(path) ?? 0) + 1)
        if (path === '/api/v1/health') {
          // 形状与真实后端一致（2026-09-21 实测）：status 之外还有 queue_task_count（number）。
          // 它不是 string，违反 OpenAPI 的 additionalProperties:string —— 用来验证
          // 「契约漂移记告警、不判失败」这条分界线。MOCK_QUEUE>0 可模拟后端繁忙。
          return send(res, 200, { status: 'ok', queue_task_count: QUEUE })
        }
        if (path === '/api/v1/generate/upload') {
          // 契约：Body_upload_file.required = [file]。没有文件的 multipart 应 422。
          if (!raw.includes('filename="')) {
            return send(res, 422, { detail: [validationError('file', 'Field required', 'missing')] })
          }
          knownHandles.add('ref-deadbeef.png')
          return send(res, 200, { name: 'ref-deadbeef.png', subfolder: '', type: 'input' })
        }
        if (BAD_200_ON.some((frag) => path.includes(frag))) return send(res, 200, {})
        const r = handle(path, body)
        if (r) return send(res, r.status, r.json)
        return send(res, 404, { detail: 'Not Found' })
      }
      if (u.pathname === '/api/fetch-to-upload') {
        const url = u.searchParams.get('url') ?? ''
        log.push({ via: 'fetch-to-upload', url, at: Date.now() })
        const name = `ref-${Date.now().toString(16).slice(-8)}.png`
        knownHandles.add(name)
        return send(res, 200, { name })
      }
      if (u.pathname === '/api/fetch-media') {
        log.push({ via: 'fetch-media', url: u.searchParams.get('url') ?? '', at: Date.now() })
        return send(res, 200, PNG_1PX, 'image/png')
      }

      send(res, 404, { detail: 'Not Found' })
    })()
  })
})

server.listen(PORT, HOST, () => {
  console.log(`mock Drama Backend + 同源代理: ${SELF}`)
  console.log(`  真实链路: 前端 → /api/proxy → Drama；本夹具把两跳合并，故 --base 与 --proxy 都填它`)
  if (DELAY_MS > 0) console.log(`  人为延迟: ${DELAY_MS}ms`)
  if (FAIL_ON.length > 0) console.log(`  故障注入: ${FAIL_ON.join(', ')} → 500`)
  if (BAD_200_ON.length > 0) console.log(`  静默坏 200 注入: ${BAD_200_ON.join(', ')} → 200 {}（断言层应判 FAIL）`)
  console.log(`  health 固定回 {"status":"ok","queue_task_count":${QUEUE}}（number 违反 additionalProperties:string → 记为告警，不判失败）`)
})
