// 模板编译器原型（P-3 可运行验证）
//
// 验证四件事，全部用仓库**真实**函数，不复制逻辑：
//   ① 占位符骨架本身能否过 validateManifest（不替换直接校验）
//   ② 替换后能否过 validateManifest，且**非文本字段逐字节不变**
//   ③ 槽位超 maxChars / maxLines 能否在**编译前**拦住（而不是出片后才发现）
//   ④ maxChars 是否可由排版几何**自动反推**（不靠人拍脑袋）
//
// 容量/排版逻辑**不在本文件**，统一从 `原型-audit-text-fit.mjs` 引入 ——
// 单一事实源，避免编译器和审计器各算一套然后漂移。
//
// 不写产品代码、不改仓；产物是模板样例 + 这份可复跑脚本。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '../../../lib/remotion')
const { validateManifest } = await import(`${LIB}/manifest.js`)

const { displayLen, measure, scanSlots, auditTemplate, canvasOf } = await import('./原型-audit-text-fit.mjs')

const TPL_DIR = path.join(HERE, '原型-template-b1b2')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const tpl = readJson(path.join(TPL_DIR, 'manifest.template.json'))
const slotsDoc = readJson(path.join(TPL_DIR, 'slots.json'))
const canvas = canvasOf(tpl)

// ─────────────────────────────────────────────────────────────
// 1. 扫描占位符：骨架里出现的槽位 vs slots.json 声明的槽位
// ─────────────────────────────────────────────────────────────
const usedSlots = scanSlots(tpl)
const declared = new Set(slotsDoc.slots.map((s) => s.id))
const missingDecl = [...usedSlots.keys()].filter((k) => !declared.has(k))
const unusedDecl = [...declared].filter((k) => !usedSlots.has(k))

// ─────────────────────────────────────────────────────────────
// 2. 容量审计（逻辑在 audit-text-fit，这里只取数）
// ─────────────────────────────────────────────────────────────
const auditMap = auditTemplate(tpl)
const audit = slotsDoc.slots.map((s) => ({
  slotId: s.id,
  maxChars: auditMap.get(s.id)?.maxChars ?? 0,
  declared: s.maxChars,
  trackIds: auditMap.get(s.id)?.trackIds ?? [],
}))

// ─────────────────────────────────────────────────────────────
// 3. 编译：先校验再替换（超长在编译前拦住，给可执行建议）
// ─────────────────────────────────────────────────────────────
function compile(values) {
  const errors = []
  const warnings = []
  const known = new Set(slotsDoc.slots.map((s) => s.id))
  for (const k of Object.keys(values)) {
    if (!known.has(k)) errors.push(`未知槽位 "${k}"（可用：${[...known].join(', ')}）`)
  }
  for (const s of slotsDoc.slots) {
    const raw = values[s.id]
    if (raw === undefined || String(raw).trim() === '') {
      if (s.required) errors.push(`缺少必填槽位 "${s.id}"（${s.label}）`)
      continue
    }
    const text = String(raw)
    const chars = displayLen(text)
    if (chars > s.maxChars) {
      errors.push(
        `槽位 "${s.id}" 超字数：${chars} > ${s.maxChars}（${s.label}）—— 建议压到 ${s.maxChars} 个全角字内（半角算半个）`,
      )
    }
    const lineCount = text.split('\n').length
    if (lineCount > s.maxLines) {
      errors.push(`槽位 "${s.id}" 超行数：${lineCount} > ${s.maxLines}（${s.label}）—— 建议只写 ${s.maxLines} 行`)
    }
  }
  const manifest = JSON.parse(JSON.stringify(tpl))
  const PLACEHOLDER = /^\{\{([^{}]+)\}\}$/
  for (const t of manifest.tracks) {
    if (t.type !== 'textCard') continue
    const m = PLACEHOLDER.exec(String(t.text))
    if (!m) continue
    const v = values[m[1]]
    if (v !== undefined) t.text = String(v)
  }
  if (errors.length > 0) return { ok: false, errors, warnings, manifest: null }
  const v = validateManifest(manifest)
  for (const e of v.errors) errors.push(`validateManifest: ${e}`)
  for (const w of v.warnings) warnings.push(`validateManifest: ${w}`)
  // 替换后逐轨再量一遍（容量是"声明值"，这里验"实际填的内容"也放得下）
  for (const s of slotsDoc.slots) {
    const raw = values[s.id]
    if (raw === undefined) continue
    for (const trackId of usedSlots.get(s.id) ?? []) {
      const t = manifest.tracks.find((x) => x.id === trackId)
      const m = measure(t, String(raw), canvas)
      if (m.overflow || m.clipped) {
        errors.push(`槽位 "${s.id}" 填入轨 "${trackId}" 后版面溢出（字号 ${m.fontPx}px，${m.lineCount}/${m.maxLines} 行）`)
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings, manifest }
}

// ─────────────────────────────────────────────────────────────
// 4. 结构比对：除 text 外任何差异都算失败
// ─────────────────────────────────────────────────────────────
function structuralDiff(a, b, at = '') {
  const out = []
  const isObj = (x) => x !== null && typeof x === 'object'
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${at}: 数组/非数组不一致`]
    if (a.length !== b.length) out.push(`${at}: 轨数 ${a.length} → ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) out.push(...structuralDiff(a[i], b[i], `${at}[${i}]`))
    return out
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (k === 'text') continue // 唯一允许变的字段
      out.push(...structuralDiff(a[k], b[k], at === '' ? k : `${at}.${k}`))
    }
    return out
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
  return out
}

// ─────────────────────────────────────────────────────────────
// 5. 跑验证
// ─────────────────────────────────────────────────────────────
const line = (s = '') => console.log(s)
line('='.repeat(78))
line('P-3 可运行验证：模板 = manifest 骨架 + {{slot}} 占位符')
line('='.repeat(78))

line('\n【① 占位符骨架本身过 validateManifest】（不替换直接校验）')
const rawCheck = validateManifest(JSON.parse(JSON.stringify(tpl)))
line(`  ok=${rawCheck.ok}  errors=${rawCheck.errors.length}  warnings=${rawCheck.warnings.length}`)
for (const e of rawCheck.errors) line(`  ✗ ${e}`)

line('\n【② 占位符覆盖一致性】')
line(`  骨架里出现的槽位：${usedSlots.size} 个 / 覆盖 ${[...usedSlots.values()].flat().length} 条文本轨`)
line(`  一槽多轨：${[...usedSlots.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k} → ${v.join('+')}`).join('；') || '无'}`)
line(`  声明了但骨架没用：${unusedDecl.length === 0 ? '无' : unusedDecl.join(', ')}`)
line(`  骨架用了但没声明：${missingDecl.length === 0 ? '无' : missingDecl.join(', ')}`)

line('\n【③ 容量审计（全角字数上限，由排版几何反推；逻辑同 原型-audit-text-fit.mjs）】')
line('  槽位            实测  声明  偏差  服务轨')
for (const a of audit) {
  const delta = a.declared === undefined ? '—' : a.maxChars - a.declared
  const flag = delta === 0 ? '' : delta < 0 ? ' ← 声明过头！' : ' ← 作者收紧'
  line(`  ${a.slotId.padEnd(14)} ${String(a.maxChars).padStart(4)}  ${String(a.declared ?? '—').padStart(4)}  ${String(delta).padStart(4)}  ${a.trackIds.join('+')}${flag}`)
}
// 对照：若判据只看「不溢出、不看字号」，同一个盒子能塞多少字、字会缩到多小
{
  const narrow = tpl.tracks.find((t) => t.id === 'b1-badge')
  const looseBest = (() => {
    let n = 0
    for (let k = 1; k <= 40; k += 1) {
      const m = measure(narrow, '测'.repeat(k), canvas)
      if (m.overflow || m.clipped) break
      n = k
    }
    return { n, m: measure(narrow, '测'.repeat(n), canvas) }
  })()
  line(
    `\n  对照（不卡字号的后果）：badge 能塞 ${looseBest.n} 字，但字号从 ${looseBest.m.baseFontPx}px 缩到 ${looseBest.m.fontPx.toFixed(1)}px` +
      `（${Math.round((looseBest.m.fontPx / looseBest.m.baseFontPx) * 100)}%）⇒ 不可读。`,
  )
  line('  这就是 maxChars 必须按「字号不降」定、而不是按「不overflow」定的原因。')
}

line('\n【④ 三组内容编译 + 校验 + 结构比对】')
const original = readJson(path.join(HERE, '原型-manifest-b1b2.json'))
const PLACEHOLDER = /^\{\{([^{}]+)\}\}$/
const originalValues = {}
for (const t of original.tracks) {
  if (t.type !== 'textCard') continue
  // 反查原文对应的槽位：骨架同 id 轨的占位符
  const skeleton = tpl.tracks.find((x) => x.id === t.id)
  const m = PLACEHOLDER.exec(String(skeleton?.text ?? ''))
  if (m) originalValues[m[1]] = String(t.text)
}
const cases = [
  { name: 'A 原文回填（应逐字节还原成原 manifest）', values: originalValues, strict: true },
  {
    name: 'B 换一套内容（产品讲解）',
    values: {
      badge: '产品讲解',
      keyword: '一屏看懂',
      body: '把复杂流程\n压成三步',
      heading: '三个卖点',
      'card1.no': '01',
      'card1.text': '一句话说清价值',
      'card2.no': '02',
      'card2.text': '三步完成配置',
      'card3.no': '03',
      'card3.text': '随时可以回滚',
    },
  },
  {
    name: 'C 边界（每槽位刚好写满 maxChars）',
    values: Object.fromEntries(slotsDoc.slots.map((s) => [s.id, '字'.repeat(s.maxChars)])),
  },
]
let allOk = true
for (const c of cases) {
  const r = compile(c.values)
  line(`\n  ── ${c.name}`)
  line(`     ok=${r.ok}  errors=${r.errors.length}  warnings=${r.warnings.length}`)
  for (const e of r.errors) line(`     ✗ ${e}`)
  for (const w of r.warnings.slice(0, 3)) line(`     ! ${w}`)
  if (r.ok) {
    const d = structuralDiff(original, r.manifest)
    line(`     结构差异（除 text 外）：${d.length === 0 ? '0 处 ✓' : `${d.length} 处 ✗`}`)
    for (const x of d.slice(0, 5)) line(`       ✗ ${x}`)
    if (d.length > 0) allOk = false
    if (c.strict === true) {
      // 最硬的断言：原文回填必须**整份 JSON 逐字节等于**原 manifest
      const identical = JSON.stringify(r.manifest) === JSON.stringify(original)
      line(`     与原 manifest 整份 JSON 逐字节相同：${identical ? '✓' : '✗'}`)
      if (!identical) {
        allOk = false
        const dd = structuralDiff(original, r.manifest)
        for (const x of dd.slice(0, 3)) line(`       ✗ ${x}`)
        for (const t of r.manifest.tracks) {
          const o = original.tracks.find((x) => x.id === t.id)
          if (o && o.text !== t.text) line(`       ✗ text 不同 ${t.id}: ${JSON.stringify(o.text)} vs ${JSON.stringify(t.text)}`)
        }
      }
    }
  } else {
    allOk = false
  }
}

line('\n【⑤ 超长拦截（必须在编译前拦住，且给可执行建议）】')
const tooLong = compile({ ...originalValues, keyword: '这个词实在是太长了放不下' })
line(`  keyword=12 字 → ok=${tooLong.ok}  errors=${tooLong.errors.length}`)
for (const e of tooLong.errors) line(`     ✗ ${e}`)
const tooManyLines = compile({ ...originalValues, body: '一\n二\n三\n四' })
line(`  body=4 行 → ok=${tooManyLines.ok}  errors=${tooManyLines.errors.length}`)
for (const e of tooManyLines.errors) line(`     ✗ ${e}`)
const unknownKey = compile({ ...originalValues, 'card4.text': '不存在的槽位' })
line(`  未知槽位 → ok=${unknownKey.ok}  errors=${unknownKey.errors.length}`)
for (const e of unknownKey.errors) line(`     ✗ ${e}`)
const missing = compile(Object.fromEntries(Object.entries(originalValues).filter(([k]) => k !== 'heading')))
line(`  缺必填 heading → ok=${missing.ok}  errors=${missing.errors.length}`)
for (const e of missing.errors) line(`     ✗ ${e}`)

line('\n【⑥ 确定性：同输入编译两次逐字节相同】')
const once = compile(originalValues)
const twice = compile(originalValues)
const same = JSON.stringify(once.manifest) === JSON.stringify(twice.manifest)
line(`  两次编译 JSON 完全一致：${same ? '✓' : '✗'}`)
if (!same) allOk = false

line('\n【⑦ 编排体检开启时，占位符会不会引入额外告警】')
line('  （原 manifest 带 meta.lint:"off"，关掉了体检；这里显式打开做对照）')
const withLint = (m) => {
  const c = JSON.parse(JSON.stringify(m))
  delete c.meta.lint
  return validateManifest(c)
}
const skelLint = withLint(tpl)
line(`  占位符骨架（lint 开）：errors=${skelLint.errors.length}  warnings=${skelLint.warnings.length}`)
const compiledB = compile(cases[1].values)
if (compiledB.manifest !== null) {
  const compLint = withLint(compiledB.manifest)
  line(`  编译产物（lint 开）：errors=${compLint.errors.length}  warnings=${compLint.warnings.length}`)
  const extra = skelLint.warnings.filter((w) => !compLint.warnings.includes(w))
  line(`  只在骨架出现的告警：${extra.length === 0 ? '0 条 ✓ 占位符不引入噪声' : `${extra.length} 条 ✗`}`)
  for (const x of extra.slice(0, 3)) line(`     ! ${x}`)
  if (extra.length > 0 || skelLint.errors.length > 0) allOk = false
}

line('\n' + '='.repeat(78))
line(`总判定：${allOk && rawCheck.ok && missingDecl.length === 0 ? '通过 ✓' : '有失败项 ✗'}`)
line('='.repeat(78))
process.exitCode = allOk && rawCheck.ok && missingDecl.length === 0 ? 0 : 1
