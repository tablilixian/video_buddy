// 参数矩阵**干跑**预览：打印「每组参数 × 每个端点」真正会发出的请求体，不发任何请求。
//
// 为什么需要它：矩阵是 UI 功能，点不出来就没法验证；而后端是同步单任务，
// 真跑一遍 3×2×2 = 12 组可能几十分钟。干跑把「值到底有没有传对」和「跑得久不久」
// 彻底分开 —— 前者在这里秒级查清，后者才是真机验收的事。
//
// 它走的是**和网页完全相同的代码路径**：
//   mergeVals(草稿, 组合, 角色) → endpoint.buildBody(values) → 请求体
// 所以这里的输出就是网页点「运行矩阵」时会发的东西。
//
// 用法：
//   node scripts/preview-matrix.mjs
//   node scripts/preview-matrix.mjs --matrix "resolution:480p,736p;aspectRatio:16:9,9:16"
//   node scripts/preview-matrix.mjs --endpoints image2image,videoFl2va --json
//
// 退出码：0 = 全部不变量通过；1 = 有不变量被破坏（如档位→像素映射错了）。

const [maj, min] = process.versions.node.split('.').map(Number)
if (maj < 22 || (maj === 22 && min < 18)) {
  console.error(`✗ 需要 Node >= 22.18（原生 TS 类型剥离），当前 ${process.versions.node}`)
  process.exit(2)
}

const { ENDPOINTS, getEndpoint } = await import('../src/endpoints.ts')
const { EMPTY_MATRIX, CHAR_BASE_EPS, expandMatrix, comboLabel, comboIdSuffix, mergeVals, estimateCalls } = await import(
  '../src/batch.ts'
)

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

/**
 * `"resolution:480p,736p;aspectRatio:16:9,9:16"` → MatrixSpec
 *
 * ⚠️ 必须只按**第一个**冒号切：宽高比取值 `16:9` 自带冒号，`split(':')` 会把
 * `16:9,9:16` 切成 `['16','9,9','16']`，于是 aspect 变成 `"16"` —— 这个 bug 被
 * 本脚本的不变量检查抓出来过（页面用勾选芯片、不走字符串解析，所以页面不受影响；
 * 但凡是「从命令行收矩阵」的地方都要按这个写法）。
 */
function parseMatrix(spec) {
  if (typeof spec !== 'string') return EMPTY_MATRIX
  const m = { ...EMPTY_MATRIX }
  for (const part of spec.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const key = part.slice(0, i).trim()
    if (key !== 'resolution' && key !== 'aspectRatio' && key !== 'duration') continue
    m[key] = part.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean)
  }
  return m
}

const MATRIX = parseMatrix(arg('--matrix', 'resolution:480p,736p;aspectRatio:16:9,9:16;duration:5,10'))
const ONLY = String(arg('--endpoints', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const AS_JSON = !!arg('--json', false)
const CHARACTER = 'a single young adventurer, one person only, solo, full body'

const combos = expandMatrix(MATRIX)
const targets = (ONLY.length > 0 ? ONLY.map(getEndpoint) : ENDPOINTS).filter(Boolean)

console.log('\n=== 参数矩阵干跑预览（不发请求）===')
console.log(`矩阵：分辨率[${MATRIX.resolution.join(',') || '—'}] × 宽高比[${MATRIX.aspectRatio.join(',') || '—'}] × 时长[${MATRIX.duration.join(',') || '—'}]`)
console.log(`组合数 ${combos.length} · 端点 ${targets.length} · 单端点单组约 ${estimateCalls(new Set(targets.map((e) => e.id)))} 步（含自动前置）\n`)

const rows = []
const problems = []

for (const combo of combos) {
  const suffix = comboIdSuffix(combo)
  for (const ep of targets) {
    const v = mergeVals(ep, {}, combo, CHARACTER, ep.id)
    const body = ep.buildBody ? ep.buildBody(v) : Object.fromEntries(ep.fields.map((f) => [f.key, v[f.key]]))
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    const shown = isForm ? 'multipart' : JSON.stringify(body)
    const id = ep.id + suffix
    rows.push({ combo: comboLabel(combo), id, path: ep.path, body: shown })

    // —— 不变量 ——
    if (isForm) continue
    const b = body
    if (b.width !== undefined || b.height !== undefined) {
      const tier = combo.resolution ?? v.resolution
      const aspect = combo.aspectRatio ?? v.aspectRatio
      const EXPECT = {
        '480p|16:9': [864, 480], '480p|9:16': [480, 864], '480p|1:1': [1024, 1024],
        '736p|16:9': [1280, 736], '736p|9:16': [736, 1280], '736p|1:1': [1024, 1024],
        '2k|16:9': [1920, 1088], '2k|9:16': [1088, 1920], '2k|1:1': [1024, 1024],
      }[`${tier}|${aspect}`]
      if (!EXPECT) problems.push(`${id}: 未知的档位/宽高比组合 ${tier}/${aspect}`)
      else if (b.width !== EXPECT[0] || b.height !== EXPECT[1]) {
        problems.push(`${id}: 像素映射错，期望 ${EXPECT[0]}×${EXPECT[1]}，实际 ${b.width}×${b.height}`)
      }
      // 32 的倍数（后端与画布都靠这条保证「声明值 = 真实产物」）
      if (b.width % 32 !== 0 || b.height % 32 !== 0) problems.push(`${id}: 像素不是 32 的倍数 (${b.width}×${b.height})`)
    }
    if (b.megapixels !== undefined) {
      const tier = combo.resolution ?? v.resolution
      const MP = { '480p': 0.4, '736p': 0.9, '2k': 2.0 }
      if (MP[tier] === undefined) problems.push(`${id}: 未知档位 ${tier} 无法取 megapixels`)
      else if (b.megapixels !== MP[tier]) problems.push(`${id}: megapixels 错，${tier} 应为 ${MP[tier]}，实际 ${b.megapixels}`)
    }
    if (b.duration !== undefined && typeof b.duration !== 'number') {
      problems.push(`${id}: duration 必须是 number（后端契约 integer），实际 ${typeof b.duration}`)
    }
    if (combo.aspectRatio === '1:1' && b.aspect !== undefined) {
      problems.push(`${id}: 视频端点收到了 aspect=1:1（契约只有 16:9 / 9:16），该组合会被后端 422 挡下`)
    }
    // 矩阵不该把字段塞进没有该字段的端点
    const keys = new Set(ep.fields.map((f) => f.key))
    for (const axisKey of ['resolution', 'aspectRatio', 'duration']) {
      if (axisKey in combo && !keys.has(axisKey) && axisKey in b) {
        problems.push(`${id}: 端点没有「${axisKey}」字段，却被塞进了请求体`)
      }
    }
    // 句柄类字段在干跑里必然是空的（运行期由基图链路注入），所以**不查它是否为空**，
    // 改成查「批量运行知不知道怎么给它填上」—— 若某个端点的必填句柄不在这两个集合里，
    // 真机跑起来就会拿着空串去打后端（→ 500）。这条是覆盖护栏，防新端点漏配。
    for (const f of ep.fields) {
      if (!f.refKind || !f.required) continue
      const handleInjected = ['image2fix', 'image2vl'].includes(ep.id) || CHAR_BASE_EPS.includes(ep.id)
      if (ep.id !== 'upload' && !handleInjected) {
        problems.push(`${id}: 必填句柄「${f.key}」不在批量运行的注入清单里（真机会拿空串打后端 → 500）`)
      }
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  let lastCombo = null
  for (const r of rows) {
    if (r.combo !== lastCombo) {
      console.log(`\n— 组合 ${r.combo} —`)
      lastCombo = r.combo
    }
    console.log(`  ${r.id.padEnd(30)} ${r.body.slice(0, 150)}`)
  }
}

console.log('\n=== 不变量检查 ===')
if (problems.length === 0) {
  console.log(`✅ ${rows.length} 条请求体全部通过（档位→像素 / megapixels / duration 类型 / 字段归属 / 句柄非空）`)
} else {
  console.log(`❌ ${problems.length} 处问题：`)
  for (const p of problems) console.log(`   · ${p}`)
}
process.exit(problems.length === 0 ? 0 : 1)
