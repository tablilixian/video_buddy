/**
 * AR-03 守卫（棘轮）：禁止用**裸 `writeFile`** 写 JSON 状态档。
 *
 * 背景（canvas-studio/docs/canvas-studio-architecture-review.md §6.2 AR-03）：
 * 全仓的 JSON 状态档（canvas.json / storyboard.json / projects.json / jobs.json /
 * history.json / reference-manifest.json）此前有 5 处写点走 `node:fs/promises` 的
 * `writeFile` —— 那些写点**外面都有进程内串行队列**，所以不存在「并发撕档」；
 * 真正的问题是**原子性**：进程被杀 / 磁盘满 / 断电时留下半截 JSON，读回按空表起底，
 * 于是「产物历史」整档清零、句柄映射整批丢失（虽可自愈，但白丢）。
 *
 * 本守卫把「JSON 状态档一律走 `writeFileAtomic`」钉成棘轮：
 *
 * 1. **红线** —— 任何 `writeFile(...)` 调用的实参里不得出现 `JSON.stringify`
 *    （判定依据是实参文本，而不是变量名——变量名会漂移，序列化调用不会）。
 * 2. **白名单是显式的** —— 二进制媒体 / 临时件（ffmpeg concat 清单）本来就不该
 *    原子写（大文件双拷贝），但它们**不序列化 JSON**，所以天然不触发红线；
 *    这里额外断言白名单里的「二进制写」仍然存在，防止白名单条目腐烂成死条目。
 * 3. **正面断言** —— 6 个 JSON 状态档宿主模块必须仍然 import `writeFileAtomic`
 *    （防止有人「清理未使用导入」时把它顺手删掉，红线又变成静默）。
 * 4. **扫描器自检** —— 正则失配时断言必须红，而不是静默放行全部
 *    （这是本项目在 tool-presentation 守卫上踩过的坑：`>= N` 的弱断言）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const SRC_ROOT = new URL('../src/', import.meta.url)

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const SOURCE_FILES = walk(SRC_ROOT)

/** 相对 `canvas-studio/` 的路径（报错信息里可读）。 */
const relOf = (url) => decodeURIComponent(new URL(url).pathname).split('/canvas-studio/').pop()

/**
 * 只剥注释，**不动字符串/模板字面量** —— `writeFile(x, `${JSON.stringify(v)}`)`
 * 的违规定义就藏在模板插值里，剥掉字符串会让红线全部漏判。
 */
const stripComments = (text) => {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] ?? ''); i += 2; continue }
        out += text[i]
        if (text[i] === quote) { i += 1; break }
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * 扫出全部 `writeFile(` 调用（排除 `writeFileAtomic(` / `writeFileSync(`），
 * 返回实参文本。按括号深度配对，字符串/模板字面量内的括号不计深度。
 */
const writeFileCalls = (source) => {
  const calls = []
  const re = /(?<![A-Za-z0-9_$])writeFile\(/g
  let match
  while ((match = re.exec(source))) {
    const argsStart = match.index + match[0].length
    let depth = 1
    let i = argsStart
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '\'' || ch === '"' || ch === '`') {
        const quote = ch
        i += 1
        while (i < source.length) {
          if (source[i] === '\\') { i += 2; continue }
          if (source[i] === quote) { i += 1; break }
          i += 1
        }
        continue
      }
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    const line = source.slice(0, match.index).split('\n').length
    calls.push({ line, args: source.slice(argsStart, i - 1) })
  }
  return calls
}

/** 扫描缓存：注释已剥、调用已拆。 */
const SCANNED = SOURCE_FILES.map((url) => {
  const raw = readFileSync(url, 'utf8')
  const source = stripComments(raw)
  return { file: relOf(url), source, calls: writeFileCalls(source) }
})

/** 允许保留裸 `writeFile` 的**二进制媒体 / 临时件**写点（数量=下限，只增不减不报警）。 */
const BINARY_WRITE_WHITELIST = new Map([
  ['src/asset-library.ts', 3],
  ['src/generate.ts', 5],
  ['src/providers/reference.ts', 1],
  ['src/video-style.ts', 1],
  ['src/compose.ts', 1],
  ['src/routes.ts', 1],
])

/** JSON 状态档宿主模块 —— 必须仍然持有 `writeFileAtomic` 导入。 */
const ATOMIC_CONSUMERS = [
  'src/projects.ts',
  'src/storyboard-store.ts',
  'src/video-jobs.ts',
  'src/asset-history.ts',
  'src/generate.ts',
]

test('AR-03①：禁止裸 writeFile 序列化 JSON（JSON 状态档一律走 writeFileAtomic）', () => {
  const offenders = []
  for (const { file, calls } of SCANNED) {
    for (const call of calls) {
      if (call.args.includes('JSON.stringify')) offenders.push(`${file}:${call.line}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '以下位置用裸 writeFile 写 JSON —— 中断会留下半截 JSON（读回按空表起底 = 整档清零）。'
    + `请改用 @deepseek-ai/dsh-atomic-write 的 writeFileAtomic：\n  ${offenders.join('\n  ')}`,
  )
})

test('AR-03②：扫描器自检 —— writeFile 调用量与二进制写点都对得上（正则失配即红）', () => {
  const total = SCANNED.reduce((sum, entry) => sum + entry.calls.length, 0)
  // 2026-10-11 基线：12 处裸 writeFile（全为二进制媒体 / 临时件）。
  // 该断言的作用是**防空过**：正则一旦失配，total 会塌到 0，本用例立刻红。
  assert.ok(
    total >= 12,
    `全仓只扫出 ${total} 处 writeFile 调用（基线 12）—— 扫描正则很可能已失配，`
    + '此时 AR-03① 会「无违规」地通过，等于守卫失效',
  )
  for (const [file, min] of BINARY_WRITE_WHITELIST) {
    const entry = SCANNED.find((candidate) => candidate.file === file)
    assert.ok(entry !== undefined, `白名单文件不存在（改名了？）：${file}`)
    assert.ok(
      entry.calls.length >= min,
      `${file} 的裸 writeFile 调用从 ${min} 降到 ${entry.calls.length} —— 白名单条目已腐烂，`
      + '请核对是「二进制写被改成了原子写（性能退化）」还是「写点搬家」后更新本表',
    )
  }
})

test('AR-03③：JSON 状态档宿主模块必须仍持有 writeFileAtomic（防「清理未使用导入」把红线变静默）', () => {
  for (const file of ATOMIC_CONSUMERS) {
    const entry = SCANNED.find((candidate) => candidate.file === file)
    assert.ok(entry !== undefined, `状态档宿主模块不存在：${file}`)
    assert.ok(
      entry.source.includes('writeFileAtomic'),
      `${file} 不再引用 writeFileAtomic —— 该模块的 JSON 状态档失去了原子写保障`,
    )
  }
})

test('AR-03④：检测器自测 —— 合成违例必须被认出（守卫不能是「永远绿」）', () => {
  // 守卫的价值取决于「它真的会红」。这里用合成代码片段验证检测器：
  // 三种真实写法的违例都要被抓到，且注释里的同款文本**不得**误报。
  const violations = [
    'await writeFile(file, `${JSON.stringify(manifest, null, 2)}\\n`, \'utf8\')',
    'await writeFile(path, JSON.stringify(doc))',
    'await writeFile(path, `x${JSON.stringify({ a: 1 })}y`)',
  ]
  for (const source of violations) {
    const calls = writeFileCalls(stripComments(source))
    assert.equal(calls.length, 1, `检测器漏掉了 writeFile 调用：${source}`)
    assert.ok(
      calls[0].args.includes('JSON.stringify'),
      `检测器未从实参里认出 JSON.stringify（红线会漏判）：${source}`,
    )
  }
  // 反例：注释里写了违例样例，剥注释后必须**不**被认成调用。
  const commented = '// 反面教材：await writeFile(p, JSON.stringify(x))\nawait writeFileAtomic(p, JSON.stringify(x))'
  assert.equal(
    writeFileCalls(stripComments(commented)).length,
    0,
    '注释里的 writeFile 被误判为真实调用；且 writeFileAtomic 不匹配 writeFile(（前瞻断言失效）',
  )
  // 反例：二进制写（合法白名单）不得被认成 JSON 违例。
  const binary = 'await writeFile(join(dir, file), bytes, { mode: 0o600 })'
  const binaryCalls = writeFileCalls(stripComments(binary))
  assert.equal(binaryCalls.length, 1)
  assert.ok(!binaryCalls[0].args.includes('JSON.stringify'), '二进制写被误判为 JSON 违例')
})

