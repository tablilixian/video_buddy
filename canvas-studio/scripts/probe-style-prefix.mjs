#!/usr/bin/env node
/**
 * 风格前缀出图差异探针（V1）—— 零产品代码改动，纯实测。
 *
 * 要回答一个问题：**节点卡「风格」参数从 10 字短句改成 50–70 字厚描述后，
 * Krea2 是否真的能读出可辨且稳定的风格差异？**
 *
 * 背景：本轮改造的核心前提是 `krea2-turbo-writing/SKILL.md:17` 的实测结论
 * （「偏好长而具体的提示词，甜点区约 80–250 词」），而现状 STYLE_OPTIONS 的
 * 三条前缀各只有 10–11 字（`NodeInputCard.tsx:146-148`），差了一到两个数量级。
 * 本探针用同一句用户提示词、只变风格前缀，验证「写厚」这件事是否真的有收益。
 *
 * 口径与生产一致（`src/generate.ts:276-280` 的 composeImagePrompt）：
 *   prompt = 风格前缀 + "，" + 用户提示词
 * 探针只比「风格差异是否肉眼可辨」，不掺入 generate.ts 的路由/自愈/重试逻辑。
 *
 * 用法：
 *   node scripts/probe-style-prefix.mjs
 *   node scripts/probe-style-prefix.mjs --repeat 2
 *   node scripts/probe-style-prefix.mjs --cooldown 3000
 *   node scripts/probe-style-prefix.mjs --only 05,06      # 只跑指定用例（补跑用）
 *   DRAMA_API_BASE=http://x:port node scripts/probe-style-prefix.mjs
 *   node scripts/probe-style-prefix.mjs --out /tmp/style-probe
 *
 * ⚠️ 必须串行：后端是单任务同步的（见 probe-resolution-tiers.mjs:11-12）。
 * ⚠️ 用 node:http 而非 fetch：Node 内置 fetch 走 undici，headersTimeout 默认 300s
 *   且与 AbortSignal 无关会先触发（见 h3-duration-probe.mjs:25-28）。生图虽快，
 *   但 Qwen 文字渲染链路约 20s、Krea2 20s 上下，仍走 postJson 统一口径。
 * ⚠️ 每跑完一个用例增量落盘：回合结束时不在任务表里的子进程会被连同进程组杀掉。
 *
 * 退出码：0 = 全部用例完成（不判定优劣）；1 = 环境不可用/参数错。
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { join, resolve } from 'node:path'

const BASE = (process.env.DRAMA_API_BASE ?? 'http://117.50.108.73:8082').replace(/\/+$/, '')
const TIMEOUT_MS = 300_000

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? fallback : v
}
const has = (name) => process.argv.includes(`--${name}`)

const REPEAT = Number(arg('repeat', '1'))
const COOLDOWN = Number(arg('cooldown', '3000'))
const OUT_DIR = resolve(arg('out', `docs/api-probe/style-prefix-${Date.now()}`))
/** `--only 05,06` 按用例 id 前缀过滤（补跑用；传 'all' 或不给 = 全跑）。 */
const ONLY = arg('only', 'all')

/** 固定用户提示词：六组完全一致，只变风格前缀。取自演示 HTML 的参考提示词。 */
const USER_PROMPT = '一位少女站在长安城楼上，远处是连绵的山脊与晨雾'

/**
 * 用例表。`kind` 分三类：
 *   base  —— 无风格基线（空前缀）
 *   old   —— 现状 10 字短句（对照组，验证「写厚」是否真有收益）
 *   new   —— 本轮 50–70 字厚描述草稿
 */
const CASES = [
  { id: '00-baseline', label: '无风格（基线）', kind: 'base', prefix: '' },
  {
    id: '01-old-cinematic',
    label: '电影感（旧 10 字）',
    kind: 'old',
    prefix: '电影感构图，宽银幕质感',
  },
  {
    id: '02-new-cinematic',
    label: '电影感（新 55 字）',
    kind: 'new',
    prefix: '电影质感，低饱和青橙色调，暗部厚重保留细节；高对比侧逆主光配柔和补光，背景自然虚化；细腻胶片颗粒与轻微暗角，克制而高级',
  },
  { id: '03-old-anime', label: '动漫插画（旧 11 字）', kind: 'old', prefix: '动漫插画风格，清晰线条' },
  {
    id: '04-new-anime',
    label: '动漫插画（新 55 字）',
    kind: 'new',
    prefix: '日式动漫赛璐璐画风，干净的黑色描边搭配平涂色块；均匀柔和的环境光加轻微轮廓光，色块边界分明；高饱和配色，明快通透，背景简洁',
  },
  { id: '05-old-realistic', label: '写实摄影（旧 11 字）', kind: 'old', prefix: '写实摄影风格，自然光影' },
  {
    id: '06-new-ink',
    label: '国风水墨（新 56 字）',
    kind: 'new',
    prefix: '水墨写意，宣纸渗化的柔和边缘与浓淡干湿的墨色层次；大面积留白，淡青灰墨色，极简概括的线条；绢本设色的细腻颗粒感，安静克制',
  },
]

// ================= N2 · Qwen 文字渲染链路（CV-288 §11.6 待补验） =================
/**
 * N2 要回答：**风格描述会不会挤占 Qwen 文字渲染链路的注意力。**
 *
 * V1 全跑 Krea2，Qwen 链路（txt2image_withtxt）零验证。风险假设：风格描述 60 字 + 文字规格，
 * 若模型把「电影质感/胶片颗粒」误读成要画在画面上的**图案**，会在字周围堆装饰、
 * 牺牲字形清晰度。判据 = 文字是否逐字正确 + 字周围有无风格误读产物。
 *
 * 走 `txt2image_withtxt`（CV-270 起带字图一步直出，约 20s）。
 */
const QWEN_CASES = [
  { id: '10-qwen-baseline', label: 'Qwen 无风格基线', kind: 'base', prefix: '' },
  {
    id: '11-qwen-cinematic',
    label: 'Qwen + 电影感（59 字）',
    kind: 'new',
    prefix: '电影质感，低饱和青橙色调，暗部厚重保留细节；高对比侧逆主光配柔和补光，背景自然虚化；细腻胶片颗粒与轻微暗角，克制而高级',
  },
  {
    id: '12-qwen-ink',
    label: 'Qwen + 国风水墨（60 字）',
    kind: 'new',
    prefix: '水墨写意，宣纸渗化的柔和边缘与浓淡干湿的墨色层次；大面积留白，淡青灰墨色，极简概括的线条；绢本设色的细腻颗粒感，安静克制',
  },
]
/** 带字的固定提示词（文字规格逐字给，遵 krea2-turbo-writing 的文字渲染节）。 */
const QWEN_PROMPT = '把标题文字 "长安月明" 以粗体衬线字居中排布在画面上方，留白充足，浅景深，宣纸质感背景'

// ================= N3 · 图生图链路（CV-288 §11.6 待补验） =================
/**
 * N3 要回答：**长风格前缀会不会干扰参考图的语义。**
 *
 * 带参考图走 Krea2 Edit（`image2image`，`krea2-edit-writing` 规则：传多图须说明分工）。
 * 风险假设：50–70 字风格描述抢戏，模型把参考图当成"要改的对象"而非"要保留的设定"，
 * 表现为角色/场景漂移。判据 = 参考图的主体与场景是否被保留。
 *
 * 需先 bootstrap 一张参考图（480p 最快），再作为 image1 打入。
 */
const I2I_CASES = [
  { id: '20-i2i-baseline', label: '图生图 无风格基线', kind: 'base', prefix: '' },
  {
    id: '21-i2i-cinematic',
    label: '图生图 + 电影感（59 字）',
    kind: 'new',
    prefix: '电影质感，低饱和青橙色调，暗部厚重保留细节；高对比侧逆主光配柔和补光，背景自然虚化；细腻胶片颗粒与轻微暗角，克制而高级',
  },
]
/** 图生图的固定指令（描述要改什么，不描述风格——风格由前缀管）。 */
const I2I_PROMPT = '保持参考图中人物的发型、服装与体型完全一致，把她放到夜晚的城楼上，背景是远处的山脊与云雾'

const results = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

function writeOut() {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'raw.json'), JSON.stringify({ userPrompt: USER_PROMPT, cases: CASES, results }, null, 2))
}

/** describeError：fetch failed 零信息，必须把 err.cause 的 code 掏出来（见 probe 脚本注释）。 */
function describeError(e) {
  const cause = e?.cause
  const code = cause?.code ?? cause?.errno
  const msg = cause?.message ?? cause?.toString?.()
  return [e?.message, code !== undefined ? `[${code}]` : undefined, msg].filter((x) => x && x !== '').join(' ')
}

/** postJson 走 node:http —— headersTimeout/timeout 真正生效，且能显式设长超时。 */
function postJson(endpoint, body, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolvePromise, rejectPromise) => {
    const payload = Buffer.from(JSON.stringify(body))
    const t0 = Date.now()
    const req = http.request(
      `${BASE}${endpoint}`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': payload.length } },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const ms = Date.now() - t0
          let data
          try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 500) } }
          resolvePromise({ status: res.statusCode, ms, data })
        })
      },
    )
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时 ${timeoutMs}ms`)))
    req.on('error', rejectPromise)
    req.write(payload)
    req.end()
  })
}

/** 从 Drama 响应里取产物 URL（与 generate.ts 的归一一致）。 */
function urlOf(data) {
  return data?.full_url ?? data?.data?.[0]?.url ?? undefined
}

/** 后端活性探针：每个用例前后各一次 —— 唯一能分开「请求体被拒」与「后端被拖住」的手段。 */
async function healthCheck(label) {
  const t0 = Date.now()
  const rec = { kind: 'health', label, at: new Date().toISOString() }
  try {
    const h = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(15_000) })
    rec.status = h.status
  } catch (e) {
    rec.error = describeError(e)
  }
  rec.ms = Date.now() - t0
  log(`  [health] ${label} → ${rec.status !== undefined ? `HTTP ${rec.status}` : rec.error}  ${rec.ms}ms`)
  results.push(rec)
  writeOut()
  return rec.status === 200
}

/** 下载产物落盘（比产物链接更可靠地看到图，也便于人工对照）。 */
async function downloadTo(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) return { error: `下载失败 HTTP ${res.status}` }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  return { bytes: buf.length }
}

/**
 * 跑一个用例。`group` 决定端点与提示词：
 *   base（Krea2 纯文生）    → txt2image + USER_PROMPT
 *   qwen（Qwen 文字渲染）   → txt2image_withtxt + QWEN_PROMPT
 *   i2i（图生图）           → image2image + I2I_PROMPT + image1=BOOTSTRAP
 */
async function runCase(testCase, round, group = 'base', bootFile = '') {
  const key = `${testCase.id}${REPEAT > 1 ? `-r${round + 1}` : ''}`
  // 与 composeImagePrompt（generate.ts:279）逐字同构：prefixes.join('，') + prompt
  const userPrompt = group === 'qwen' ? QWEN_PROMPT : group === 'i2i' ? I2I_PROMPT : USER_PROMPT
  const prompt = testCase.prefix.trim() === '' ? userPrompt : `${testCase.prefix}，${userPrompt}`
  const endpoint = group === 'qwen' ? '/api/v1/generate/txt2image_withtxt' : group === 'i2i' ? '/api/v1/generate/image2image' : '/api/v1/generate/txt2image'
  const body = { prompt, width: 1280, height: 736 }
  if (group === 'i2i' && bootFile !== '') body.image1 = bootFile
  const rec = {
    kind: 'case',
    group,
    endpoint,
    id: key,
    label: testCase.label,
    styleKind: testCase.kind,
    prefix: testCase.prefix,
    prefixChars: testCase.prefix.length,
    finalPrompt: prompt,
    at: new Date().toISOString(),
  }
  log(`\n[${key}] ${testCase.label}  (${group} · 前缀 ${testCase.prefix.length} 字)`)
  const before = await healthCheck(`${key} 前`)
  if (!before) log('  ⚠ 前置 health 非 200，后端可能正忙 —— 本用例结果不可信')
  try {
    const r = await postJson(endpoint, body)
    rec.status = r.status
    rec.ms = r.ms
    const url = urlOf(r.data)
    rec.url = url
    if (r.status !== 200) rec.response = JSON.stringify(r.data).slice(0, 400)
    if (url !== undefined) {
      const ext = url.match(/\.([A-Za-z0-9]+)(?:\?|$)/)?.[1] ?? 'png'
      const dest = join(OUT_DIR, `${key}.${ext}`)
      const dl = await downloadTo(url, dest)
      rec.localFile = dest
      rec.bytes = dl.bytes ?? undefined
      rec.downloadError = dl.error
      log(`  ✓ HTTP ${r.status} ${r.ms}ms → ${dest}${dl.error ? ` (下载失败: ${dl.error})` : ''}`)
    } else {
      log(`  ✗ HTTP ${r.status} ${r.ms}ms 未取到产物 URL：${JSON.stringify(r.data).slice(0, 200)}`)
    }
  } catch (e) {
    rec.error = describeError(e)
    rec.failed = true
    log(`  ✗ 失败：${rec.error}`)
  }
  await healthCheck(`${key} 后`)
  results.push(rec)
  writeOut()
}

function writeReport() {
  const cases = results.filter((r) => r.kind === 'case')
  const ok = cases.filter((r) => r.localFile !== undefined)
  const fail = cases.filter((r) => r.failed === true || r.localFile === undefined)
  const lines = []
  lines.push('# 风格前缀出图差异探针（V1）')
  lines.push('')
  lines.push(`- 固定用户提示词：\`${USER_PROMPT}\``)
  lines.push(`- 重复次数：${REPEAT}`)
  lines.push(`- 端点：POST ${BASE}/api/v1/generate/txt2image（1280×736）`)
  lines.push(`- 成功 ${ok.length} / 失败 ${fail.length}`)
  lines.push('')
  lines.push('> **机器只负责产出可比对的图，不判定优劣。** 风格差异是否肉眼可辨、')
  lines.push('> 哪条前缀真的生效，交给人工看图判断。')
  lines.push('')
  lines.push('## 用例与产物')
  lines.push('')
  lines.push('| # | 风格 | 前缀字数 | 耗时 | 产物 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const c of cases) {
    const name = c.localFile !== undefined ? `\`${c.id}\`` : '—'
    lines.push(`| ${c.id.split('-')[0]} | ${c.label} | ${c.prefixChars} | ${c.ms !== undefined ? `${(c.ms / 1000).toFixed(1)}s` : '—'} | ${name} |`)
  }
  lines.push('')
  lines.push('## 各用例最终提示词（与生产 composeImagePrompt 同构）')
  lines.push('')
  for (const c of cases) {
    lines.push(`### ${c.label}`)
    lines.push('')
    lines.push('```')
    lines.push(c.finalPrompt)
    lines.push('```')
    lines.push('')
  }
  if (fail.length > 0) {
    lines.push('## 失败用例')
    lines.push('')
    for (const f of fail) {
      lines.push(`- \`${f.id}\`：${f.error ?? `HTTP ${f.status}`} ${f.response ?? ''}`)
    }
    lines.push('')
  }
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
}

const GROUP = arg('group', 'base')

/** 从 `/view?filename=xxx.png` 取后端文件名（能直接当 image1 打的句柄）。 */
function filenameOf(url) {
  const m = /[?&]filename=([^&]+)/.exec(url ?? '')
  return m === null ? undefined : decodeURIComponent(m[1])
}

/**
 * 图生图组要先有一张参考图，且**必须换成上传句柄**才能当 image1 打。
 *
 * CV-155 硬约束（`generate.ts:144-147`）：image2image 的入参**只收上传句柄**
 * （`ref-xxxxxxxx.png`），**后端产物名（`img_*` / `krea2_*` / `z-image_*`）会被直接拒，
 * 约 0.1s 内笼统 500**。所以这里多走一步 `POST /api/v1/generate/upload`（与生产
 * `uploadBytesToDrama` 同一端点），否则连基线组都会红 —— 那是探针写错，不是风格问题。
 */
async function uploadRefHandle(filename) {
  const src = `${BASE}/view?filename=${encodeURIComponent(filename)}`
  const res = await fetch(src, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    console.error(`✗ 下载参考图失败 HTTP ${res.status}`)
    process.exit(1)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)]), `ref-style${filename.replace(/[^A-Za-z0-9]/g, '').slice(-6)}.png`)
  const up = await fetch(`${BASE}/api/v1/generate/upload`, { method: 'POST', body: form })
  const txt = await up.text()
  if (!up.ok) {
    console.error(`✗ 上传失败 HTTP ${up.status}：${txt.slice(0, 300)}`)
    process.exit(1)
  }
  let data
  try { data = JSON.parse(txt) } catch { data = { _raw: txt.slice(0, 300) } }
  const handle = data?.name ?? data?.filename ?? data?.data?.filename
  if (typeof handle !== 'string' || handle === '') {
    console.error(`✗ 上传响应里没有句柄：${JSON.stringify(data).slice(0, 300)}`)
    process.exit(1)
  }
  return handle
}

/** 图生图组：产一张参考图（480p 最快）→ 换上传句柄。 */
async function bootstrapRef() {
  log('\n[bootstrap] 先产一张参考图（480p），再换上传句柄…')
  const r = await postJson('/api/v1/generate/txt2image', {
    prompt: '一位少女站在长安城楼上，远处是连绵的山脊与晨雾，写实质感',
    width: 864,
    height: 480,
  })
  const url = urlOf(r.data)
  const file = url === undefined ? undefined : filenameOf(url)
  if (file === undefined) {
    console.error(`✗ 拿不到参考图文件名，响应：${JSON.stringify(r.data).slice(0, 300)}`)
    process.exit(1)
  }
  log(`  [bootstrap] 产物名 = ${file}（这个直接当 image1 会被后端拒）`)
  const handle = await uploadRefHandle(file)
  log(`  [bootstrap] image1 = ${handle}`)
  return handle
}

const POOL = GROUP === 'qwen' ? QWEN_CASES : GROUP === 'i2i' ? I2I_CASES : CASES
const SELECTED = ONLY === 'all'
  ? POOL
  : POOL.filter((c) => ONLY.split(',').map((s) => s.trim()).some((p) => c.id.startsWith(p)))

log('=== 风格前缀出图差异探针 ===')
log(`分组：${GROUP}`)
log(`后端：${BASE}`)
log(`产物目录：${OUT_DIR}`)
log(`固定提示词：${GROUP === 'qwen' ? QWEN_PROMPT : GROUP === 'i2i' ? I2I_PROMPT : USER_PROMPT}`)
log(`用例 ${SELECTED.length} 个 × 重复 ${REPEAT} = ${SELECTED.length * REPEAT} 次生成`)

const initial = await healthCheck('开始前')
if (!initial) {
  console.error('✗ 后端 health 非 200，先确认后端可用再跑。')
  process.exit(1)
}

const boot = GROUP === 'i2i' ? await bootstrapRef() : ''

for (let round = 0; round < REPEAT; round++) {
  for (const c of SELECTED) {
    await runCase(c, round, GROUP, boot)
    if (COOLDOWN > 0) await sleep(COOLDOWN)
  }
}

writeOut()
writeReport()
log(`\n完成。产物：${OUT_DIR}`)
log(`report.md + raw.json + 各用例图片文件已落盘。`)
