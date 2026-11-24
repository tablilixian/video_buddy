#!/usr/bin/env node
/**
 * 价目采样（A 层最后一件，B 层的原料）—— 只读、幂等、**不扣分**。
 *
 * 全部走 `POST /v1/generations/quote`（纯计算，不建任务不冻结），把后端的价格
 * 逐点问出来，再反推成「一张只有 10 条规则的表」写进 `capabilities/pricing.json`。
 *
 * ## 为什么要有这个脚本
 *
 * 后端没有公开价目接口（`/v1/pricing` 等全 404，2026-11-02 实测）。手抄一份价目表
 * 在代码里，等于把「价格」这个**会变的事实**冻成常量：后端改价后 UI 会一直报旧价，
 * 而且没有任何一处会红。这个脚本让价目表变成**可复现的产物**：
 *
 *   变更后重跑 → 表变了 → diff 里看得见 → 明细/兜底跟着走。
 *
 * ## 三条实测结论（脚本内置为 EXPECT，漂移就告警）
 *
 * 1. 图片按**面积**（积分/px），跨模型同价；
 * 2. 视频只看**时长**（积分/秒），**megapixels 不计价**（480P 与 1080P 同价）；
 * 3. 固定价项不吃尺寸（`image2character` 请求体为空也是同一个价）。
 *
 * ## 安全阀：单条失败不清表
 *
 * 采样失败（网络抖动 / 这个 operation 需要真实素材而我们没法造）时，**沿用旧表
 * 的那条规则**并在 `staleRules` 里记名。否则一次抖动就会把「离线兜底」这道防线
 * 删掉一半，而下次报「—」时没人会想到是采样脚本干的。
 *
 * ## 用法
 *
 *   node scripts/probe-pricing.mjs                      # 全量采样并写 capabilities/pricing.json
 *   node scripts/probe-pricing.mjs --dry                # 只打印，不写文件
 *   node scripts/probe-pricing.mjs --only video         # 只采视频组
 *   node scripts/probe-pricing.mjs --check              # 不联网：只校验现有表的结构与表龄
 *   node scripts/probe-pricing.mjs --token <jwt>        # 显式给 token
 *   CS_BUSINESS_TOKEN=<jwt> node scripts/probe-pricing.mjs
 *   node scripts/probe-pricing.mjs --token-file /tmp/.tok
 *
 * token 来源优先级：`--token` > `--token-file` > `CS_BUSINESS_TOKEN` > `/tmp/.tok`。
 * 桌面端 access token 寿命 1 小时，过期会拿 401（脚本会直说「请重开应用刷新登录态」）。
 *
 * 注：Node 内置 fetch（undici）**不读** `HTTP_PROXY`/`HTTPS_PROXY`，裸 IP 直连不会
 * 被会话里的注入代理截胡（这跟 curl 必须加 `--noproxy '*'` 是两回事）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = resolve(ROOT, 'capabilities', 'pricing.json')
const BASE = (arg('base') ?? process.env.CS_BUSINESS_API_BASE ?? 'http://117.50.108.73').replace(/\/+$/, '')

/** 复算容差：服务端 4 位小数的舍入误差。差得比这多就是改价了，不是浮点。 */
const EPSILON = 0.0001
/** 表龄超过这个天数，Host 侧会给「约」再挂一句「采样于 N 天前」。 */
const MAX_TABLE_AGE_DAYS = 7

// ── 采样矩阵 ────────────────────────────────────────────────────────────────
//
// 每个用例带 `expect`：`basis` + `multiplier` 是**结构**（后端怎么算），
// `rate` 是**价格**（多少钱）。结构由人工判断（读实测），价格由本次采样反推。
// 结构错了脚本不会告诉你 —— 它只会发现「算不出来」，所以改动这块要回看方案 §1.1。

/** 图片尺寸：三个档位 + 1:1 + 小图（覆盖面积线性）。 */
const IMAGE_SIZES = [[864, 480], [1376, 768], [1920, 1088], [1024, 1024], [512, 512]]
/** 视频时长（秒）：生成链允许的档位里取五个。 */
const VIDEO_DURATIONS = [4, 5, 6, 10, 15]
/** 视频清晰度三档（**预期同价**，这正是要验证的）。 */
const VIDEO_MEGAPIXELS = [0.4, 1, 2]
/** 音乐时长（秒）。 */
const AUDIO_DURATIONS = [5, 10, 15, 30]
/** 报价用的占位提示词（报价不消费 prompt，但入参校验与创建任务同源，空串会被拒）。 */
const PROMPT = 'pricing probe'

const IMAGE_MODELS = ['image.krea2', 'image.qwen-image-2.1']

/**
 * 用例表。`group` 只用于 `--only`，`expect` 里的 rate 是**方案 §1.1 的实测值**：
 * 拿它当基准，采样偏离就说明后端改价了。
 */
function buildCases(only) {
  const cases = []
  const add = (group, item) => {
    if (only === null || only === group) cases.push(item)
  }

  for (const model of IMAGE_MODELS) {
    for (const [width, height] of IMAGE_SIZES) {
      add('image', {
        id: `txt2image:${model}:${width}x${height}`,
        model,
        operation: 'txt2image',
        input: { prompt: PROMPT, width, height },
        expect: { basis: 'pixels', rate: 0.00002, multiplier: 1 },
      })
    }
  }
  // 图生图：只有 Qwen 声明（目录事实），×1.25 是 operation 级系数。
  for (const [width, height] of IMAGE_SIZES.slice(0, 3)) {
    add('image', {
      id: `image2image:qwen:${width}x${height}`,
      model: 'image.qwen-image-2.1',
      operation: 'image2image',
      input: { prompt: PROMPT, width, height },
      expect: { basis: 'pixels', rate: 0.00002, multiplier: 1.25 },
    })
  }
  // 角色四视图：固定价、不吃尺寸 —— 空 input 与带尺寸必须是同一个数。
  add('image', {
    id: 'image2character:krea2:empty',
    model: 'image.krea2',
    operation: 'image2character',
    input: {},
    expect: { basis: 'flat', rate: 30, multiplier: 1 },
  })
  add('image', {
    id: 'image2character:krea2:sized',
    model: 'image.krea2',
    operation: 'image2character',
    input: { prompt: PROMPT, width: 1376, height: 768 },
    expect: { basis: 'flat', rate: 30, multiplier: 1 },
  })

  // 视频：时长 × 清晰度网格（同一格内 megapixels 变了价不变 = 清晰度不计价）。
  for (const duration of VIDEO_DURATIONS) {
    for (const megapixels of VIDEO_MEGAPIXELS) {
      add('video', {
        id: `fl2va:${duration}s:${megapixels}mp`,
        model: 'video.minimax_h3',
        operation: 'image2videofl2va',
        input: { prompt: PROMPT, aspect: '16:9', megapixels, duration },
        expect: { basis: 'seconds', rate: 6, multiplier: 1 },
      })
    }
  }
  // ref2va：quote 不吃 `inputs`，所以这里只能验「与 fl2va 同价」。
  // ⚠️ 真实带 9 张参考图的 commit 是否同价，quote 层回答不了（方案待验证项 V-1）。
  for (const duration of [5, 10]) {
    add('video', {
      id: `ref2va:${duration}s`,
      model: 'video.minimax_h3',
      operation: 'image2videoref2va',
      input: { prompt: PROMPT, aspect: '16:9', megapixels: 1, duration },
      expect: { basis: 'seconds', rate: 6, multiplier: 1 },
    })
  }

  for (const duration of AUDIO_DURATIONS) {
    add('audio', {
      id: `txt2audio:${duration}s`,
      model: 'audio.yue2',
      operation: 'txt2audio',
      input: { prompt: PROMPT, lyrics: '[Instrumental]', duration },
      expect: { basis: 'seconds', rate: 1, multiplier: 1 },
    })
  }
  // TTS：固定 3，与字数无关（两份不同长度的文本必须同价）。
  for (const [index, text] of ['短句。', '这'.repeat(120)].entries()) {
    add('audio', {
      id: `txt2speech:${index}`,
      model: 'audio.voxcpm2',
      operation: 'txt2speech',
      input: { prompt: text },
      expect: { basis: 'flat', rate: 3, multiplier: 1 },
    })
  }

  // 理解类：固定价。ASR 需要真实音频句柄，quote 大概率拒 ⇒ 失败时沿用旧规则。
  add('analysis', {
    id: 'image2vl',
    model: 'image.qwen3-vl',
    operation: 'image2vl',
    input: {},
    expect: { basis: 'flat', rate: 4, multiplier: 1 },
  })
  add('analysis', {
    id: 'video2vl',
    model: 'video.qwen3-vl',
    operation: 'video2vl',
    input: {},
    expect: { basis: 'flat', rate: 8, multiplier: 1 },
  })
  add('analysis', {
    id: 'asr2txt',
    model: 'audio.fast-whisper',
    operation: 'asr2txt',
    input: {},
    expect: { basis: 'flat', rate: 3, multiplier: 1 },
  })
  return cases
}

// ── 参数 ────────────────────────────────────────────────────────────────────

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}
const has = name => process.argv.includes(`--${name}`)

// ── 工具 ────────────────────────────────────────────────────────────────────

/** 本地时区 ISO（`2026-11-24T14:30:00.000+08:00`）—— 表是给人看的，别写 UTC。 */
function localIso(date = new Date()) {
  const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

const round4 = value => Math.round(value * 10_000) / 10_000
/** 反推单价：抹掉浮点尾巴（0.0000200000003 → 0.00002）。 */
const tidyRate = value => Number(value.toPrecision(6))

function resolveToken() {
  const explicit = arg('token')
  if (explicit !== undefined) return explicit.trim()
  const file = arg('token-file') ?? process.env.CS_TOKEN_FILE ?? '/tmp/.tok'
  const fromEnv = process.env.CS_BUSINESS_TOKEN
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  try {
    const token = readFileSync(file, 'utf8').trim()
    if (token !== '') return token
  } catch {
    // 没文件：交给下面统一报错
  }
  return ''
}

function oldRules() {
  try {
    const doc = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    const map = new Map()
    for (const rule of Array.isArray(doc.rules) ? doc.rules : []) {
      if (typeof rule?.operation === 'string') map.set(rule.operation, rule)
    }
    return map
  } catch {
    return new Map()
  }
}

/** 按结构复算一个用例的期望积分（不参与结论，只用于发现漂移）。 */
function computeExpected(expect, input) {
  if (expect.basis === 'flat') return round4(expect.rate)
  if (expect.basis === 'seconds') {
    const duration = Number(input.duration)
    return Number.isFinite(duration) && duration > 0 ? round4(duration * expect.rate) : null
  }
  const width = Number(input.width)
  const height = Number(input.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return round4(width * height * expect.rate * (expect.multiplier ?? 1))
}

/** 从实测积分反推单价（结构已知，只有价格未知）。 */
function inferRate(expect, input, credits) {
  if (expect.basis === 'flat') return tidyRate(credits)
  if (expect.basis === 'seconds') return tidyRate(credits / Number(input.duration))
  const area = Number(input.width) * Number(input.height)
  // 反推的是「扣除系数之前」的单价：`image2image` 的 ×1.25 是结构，不是价。
  return tidyRate(credits / (area * (expect.multiplier ?? 1)))
}

// ── 网络 ────────────────────────────────────────────────────────────────────

async function quote(token, item) {
  const response = await fetch(`${BASE}/v1/generations/quote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: item.model, operation: item.operation, input: item.input }),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  if (!response.ok) {
    const hint = response.status === 401 ? '（token 过期：请重开桌面端刷新登录态，或传 --token）' : ''
    throw new Error(`HTTP ${response.status}${hint} ${text.slice(0, 160)}`)
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`响应不是 JSON：${text.slice(0, 160)}`)
  }
  const credits = body?.estimated_credits
  if (typeof credits !== 'number' || !Number.isFinite(credits)) {
    throw new Error(`响应缺 estimated_credits：${text.slice(0, 160)}`)
  }
  return credits
}

/** 固定并发跑完（串行 40 次太慢，全并发又怕把边缘打抖）。 */
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

// ── `--check`：不联网，只校验现有表 ─────────────────────────────────────────

function checkOnly() {
  let doc
  try {
    doc = JSON.parse(readFileSync(OUT_PATH, 'utf8'))
  } catch (cause) {
    console.error(`✗ 读不到 ${OUT_PATH}：${cause instanceof Error ? cause.message : String(cause)}`)
    process.exitCode = 1
    return
  }
  const rules = Array.isArray(doc.rules) ? doc.rules : []
  const problems = []
  if (typeof doc.sampled_at !== 'string' || !Number.isFinite(Date.parse(doc.sampled_at))) {
    problems.push('sampled_at 缺失或不可解析')
  }
  const ageDays = typeof doc.sampled_at === 'string' && Number.isFinite(Date.parse(doc.sampled_at))
    ? Math.floor((Date.now() - Date.parse(doc.sampled_at)) / 86_400_000)
    : null
  for (const rule of rules) {
    if (typeof rule?.operation !== 'string') problems.push('有规则缺 operation')
    if (!['pixels', 'seconds', 'flat'].includes(rule?.basis)) problems.push(`${rule?.operation}: basis 非法`)
    if (typeof rule?.rate !== 'number' || rule.rate <= 0) problems.push(`${rule?.operation}: rate 非法`)
    if (typeof rule?.sampledAt !== 'string' || !Number.isFinite(Date.parse(rule.sampledAt))) {
      problems.push(`${rule?.operation}: sampledAt 缺失`)
    }
  }
  console.info(`表：${rules.length} 条规则，采样于 ${doc.sampled_at}（${ageDays} 天前）`)
  if (ageDays !== null && ageDays > MAX_TABLE_AGE_DAYS) {
    console.warn(`⚠ 表龄 ${ageDays} 天 > ${MAX_TABLE_AGE_DAYS} 天：Host 会把兜底值标成「约」。建议重跑采样。`)
  }
  if (problems.length > 0) {
    console.error(`✗ ${problems.length} 处问题：\n  ${problems.join('\n  ')}`)
    process.exitCode = 1
    return
  }
  console.info('✓ 结构合法')
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  if (has('check')) {
    checkOnly()
    return
  }
  const token = resolveToken()
  if (token === '') {
    console.error('✗ 没有 token。用 --token / CS_BUSINESS_TOKEN / --token-file 给一个（桌面端登录后可从 leveldb 提）。')
    process.exitCode = 1
    return
  }
  const only = arg('only') ?? null
  const cases = buildCases(only)
  const concurrency = Number(arg('concurrency') ?? 3)
  console.info(`采样 ${cases.length} 个用例 → ${BASE}（只调 quote，不建任务不扣分）`)

  const started = Date.now()
  const outcomes = await runWithConcurrency(cases, Number.isFinite(concurrency) ? concurrency : 3, async item => {
    try {
      const credits = await quote(token, item)
      return { item, credits, error: null }
    } catch (cause) {
      return { item, credits: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
  })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  const ok = outcomes.filter(outcome => outcome.error === null)
  const failed = outcomes.filter(outcome => outcome.error !== null)
  console.info(`完成：成功 ${ok.length} / 失败 ${failed.length}，用时 ${elapsed}s`)
  // 401 全灭时别继续写表（会让人以为「后端把这些 operation 都下架了」）。
  if (ok.length === 0) {
    console.error('✗ 全部失败，未写文件。首个错误：' + (failed[0]?.error ?? '未知'))
    process.exitCode = 1
    return
  }

  // ── 反推 + 漂移判定 ──
  const drift = []
  /** operation → { 反推结果 } */
  const inferred = new Map()
  for (const { item, credits, error } of outcomes) {
    if (error !== null) {
      drift.push({ id: item.id, kind: 'sample-failed', detail: error })
      continue
    }
    const expected = computeExpected(item.expect, item.input)
    if (expected !== null && Math.abs(expected - credits) > EPSILON) {
      drift.push({ id: item.id, kind: 'price-drift', expected, actual: credits })
    }
    const rate = inferRate(item.expect, item.input, credits)
    const bucket = inferred.get(item.operation) ?? {
      operation: item.operation,
      models: new Set(),
      basis: item.expect.basis,
      multiplier: item.expect.multiplier ?? 1,
      rates: [],
      samples: 0,
    }
    bucket.models.add(item.model)
    bucket.rates.push(rate)
    bucket.samples += 1
    inferred.set(item.operation, bucket)
  }

  const sampledAt = localIso()
  const rules = []
  for (const [operation, bucket] of inferred) {
    // 同一 operation 的多个样本必须反推出**同一个**单价，否则说明不是线性计价（结构变了）。
    const first = bucket.rates[0]
    const consistent = bucket.rates.every(rate => Math.abs(rate - first) <= Math.max(1e-9, Math.abs(first) * 1e-6))
    if (!consistent) {
      drift.push({
        id: `${operation}:nonlinear`,
        kind: 'not-linear',
        detail: `同 operation 反推出多个单价：${[...new Set(bucket.rates)].join(', ')}`,
      })
    }
    const rate = consistent ? first : tidyRate(bucket.rates.reduce((sum, value) => sum + value, 0) / bucket.rates.length)
    rules.push({
      operation,
      models: [...bucket.models].sort(),
      basis: bucket.basis,
      rate,
      ...(bucket.multiplier !== 1 ? { multiplier: bucket.multiplier } : {}),
      samples: bucket.samples,
      sampledAt,
    })
  }

  // ── 沿用旧表（本次没采到的 operation 不清掉）──
  const previous = oldRules()
  const staleRules = []
  for (const [operation, rule] of previous) {
    if (rules.some(item => item.operation === operation)) continue
    rules.push(rule)
    staleRules.push(operation)
  }
  rules.sort((a, b) => String(a.operation).localeCompare(String(b.operation)))

  const doc = {
    schema: 'canvas-studio/pricing/v1',
    sampled_at: sampledAt,
    source: 'probe-pricing.mjs',
    endpoint: 'POST /v1/generations/quote',
    note: '本表只做两件事：quote 不可用时给近似值（永远标「约」）、quote 可用时把总数拆成单项。绝不覆盖服务端报价。重跑 node scripts/probe-pricing.mjs 可刷新。',
    ...(staleRules.length > 0 ? { staleRules } : {}),
    ...(drift.length > 0 ? { drift } : {}),
    rules,
    evidence: ok.map(({ item, credits }) => ({
      operation: item.operation,
      model: item.model,
      input: item.input,
      credits,
    })),
  }

  for (const rule of rules) {
    const mark = staleRules.includes(rule.operation) ? '（沿用旧值）' : ''
    console.info(`  ${rule.operation.padEnd(20)} ${rule.basis.padEnd(8)} ${String(rule.rate).padEnd(10)} ×${rule.multiplier ?? 1}  n=${rule.samples ?? '-'} ${mark}`)
  }
  if (drift.length > 0) {
    console.warn(`\n⚠ ${drift.length} 处漂移（表仍会写入，但请人工确认后端是否改价）：`)
    for (const item of drift) console.warn(`  - ${item.id}：${item.kind} ${JSON.stringify(item)}`)
  } else {
    console.info('\n✓ 全部样本与方案 §1.1 的公式复算一致（容差 4 位小数）')
  }

  if (has('dry')) {
    console.info('\n--dry：未写文件。以下是完整内容：')
    console.info(JSON.stringify(doc, null, 2))
    return
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  console.info(`\n✓ 已写入 ${OUT_PATH}`)
  if (drift.length > 0) process.exitCode = 1
}

await main()
