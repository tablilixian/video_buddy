/**
 * 文件大小守卫（执行计划 T0.4，2026-10-28，canvas-studio/docs/plans/2026-10-28-超大文件拆分执行计划.md）。
 *
 * 与 `canvas-studio/tests/file-size-guard.test.mjs` 同规格的独立实现 —— 三包互不 import
 * 是依赖方向规则，这份扫描器有意复制三份，改尺请三处同步。
 *
 * ## 闸规格
 *
 * 1. **单文件 ≤ 1,200 行**；**单函数 ≤ 600 行**（两把尺都过才算过）。
 * 2. **函数跨度 = 真实体量**：单遍词法扫描（状态机 + 帧栈）跳过字符串 / 模板字面量 /
 *    注释 / 正则字面量后，按 `{` 帧与模板帧的进出量出每个声明的真实行数。计量对象：
 *    顶层 `function` / `class`、类成员方法、顶层 `const`（跟随其初始化的模板字面量或
 *    行尾对象体）、行中 `function` 表达式（含 forwardRef 内嵌）、`useEffect` /
 *    `useLayoutEffect` 块。
 * 3. **棘轮**：白名单登记「当前实测值」，实测 > 登记值即红；实测降到闸线以下判红并提示
 *    「请删除条目」。同名声明取**最大**跨度登记（只高不低，安全方向）。
 * 4. **fail-closed**：扫描器对任何文件失步（EOF 栈非空 / 声明头未落块）即整条红。
 *
 * ## 变红验证记录（T0.4，2026-10-28）
 *
 * - 给 `src/adapters/standard-http.ts` 追加 1,300 行 → 文件闸红；撤销。
 * - 给白名单内声明超棘轮追加 → 红棘轮生效；撤销。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

export const FILE_LIMIT = 1200
export const FUNC_LIMIT = 600

/** 生成目录（相对包根）：守卫测生成器，不测生成物。 */
const GENERATED_DIRS: readonly string[] = ['src/contracts/generated']

/** 文件行数棘轮。键 = `src/...`，值 = 当前实测行数（拆分时逐段下调，达标即删）。实测回填于 2026-10-28（PR-0）。 */
export const FILE_WHITELIST: Record<string, number> = {
  'src/client/MarketSettingsTab.tsx': 1998,
  'src/host/routes.ts': 1232,
}

/** 函数跨度棘轮。键 = `src/...#声明名`，值 = { lines, note }。 */
export const FUNC_WHITELIST: Record<string, { lines: number; note: string }> = {
  'src/client/MarketSettingsTab.tsx#MarketSurface': { lines: 845, note: '视图已分块，补 action hook 外提（阶段 5b）' },
  'src/client/styles.ts#css': { lines: 790, note: '样式模板字面量（数据形态，只钉不涨）' },
}

const RE_TOP_FUNC = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*[\w$]+/
const RE_TOP_CLASS = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[\w$]+/
const RE_TOP_CONST = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+/
const RE_MEMBER = /^  (?:(?:public|private|protected|static|readonly|override|get|set)\s+)*(?:async\s+)?[\w$]+\s*\(/
const HOOKS = new Set(['useEffect', 'useLayoutEffect'])

const NON_DECL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'with',
  'await', 'yield', 'throw', 'new', 'typeof', 'delete', 'void', 'in', 'of', 'case',
  'default', 'function', 'const', 'let', 'var', 'class', 'export', 'import', 'super', 'this',
])

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await',
])

const WORD_RE = /[\w$]/

interface Decl { name: string; kind: string; line: number; extent: number }
interface Frame {
  kind: string
  opener: { name: string; kind: string; line: number } | null
  startLine: number
}
interface LexResult { desync: string | null; decls: Decl[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function lexFile(text: string): LexResult {
  const lines = text.split('\n')
  const decls: Decl[] = []
  const stack: Frame[] = []
  let pendingOpener: { name: string; kind: string; line: number } | null = null
  let pendingConst: { name: string; line: number; bracketBase: number } | null = null
  let pendingMember: { name: string; line: number } | null = null
  let awaitingFuncName = false
  let bracketDepth = 0
  let lastMeaningful: { type: 'word' | 'sig'; value: string } | null = null
  let lastSig = ''
  let lastSig2 = ''
  let word = ''
  let lastWord = ''
  let line = 1
  let checkedLine = 0
  let i = 0

  const flushWord = () => {
    if (word !== '') {
      lastWord = word
      word = ''
      lastMeaningful = { type: 'word', value: lastWord }
    }
  }
  const sig = (c: string | undefined) => {
    const ch: string = c ?? ''
    lastSig2 = lastSig
    lastSig = ch
    lastMeaningful = { type: 'sig', value: ch }
  }
  const memberHeadOnLine = (idx: number): string | null => {
    if (idx < 0 || idx >= lines.length) return null
    const l: string = lines[idx] ?? ''
    if (!RE_MEMBER.test(l)) return null
    const m = l.match(/^  (?:(?:public|private|protected|static|readonly|override|get|set)\s+)*(?:async\s+)?([\w$]+)/)
    const name: string | undefined = m?.[1]
    return name && !NON_DECL.has(name) ? name : null
  }
  const isLastOpenerOnLine = (idx: number, col: number): boolean => {
    const l: string = lines[idx] ?? ''
    return l.indexOf('{', col + 1) === -1
  }
  const popFrame = (): string | null => {
    const frame = stack.pop()
    if (!frame) return 'underflow'
    if (frame.opener && frame.opener.kind !== 'class') {
      decls.push({ name: frame.opener.name, kind: frame.opener.kind, line: frame.opener.line, extent: line - frame.opener.line + 1 })
    }
    return null
  }
  const isRegexPosition = (): boolean => {
    if (lastMeaningful === null) return true
    if (lastMeaningful.type === 'word') return REGEX_KEYWORDS.has(lastMeaningful.value)
    const c = lastMeaningful.value
    if (c === ')' || c === ']' || c === '}' || c === "'" || c === '"' || c === '`') return false
    return '([{,;=:!&|?%~^<>+-*'.includes(c)
  }
  const isIncrementRun = (): boolean => (lastSig === '+' || lastSig === '-') && lastSig2 === lastSig
  const sealWord = () => {
    if (word === '') return
    if (awaitingFuncName) {
      pendingOpener = { name: word, kind: 'function', line }
      awaitingFuncName = false
    } else if (word === 'function') {
      awaitingFuncName = true
    }
    flushWord()
  }
  const lineEntry = (idx: number): void => {
    if (lastSig === ';' || lastSig === '}' || lastSig === '') {
      pendingOpener = null
      pendingConst = null
      pendingMember = null
    }
    if (stack.length !== 0 || bracketDepth !== 0) return
    const l = lines[idx] ?? ''
    if (RE_TOP_FUNC.test(l)) {
      const m = l.match(/function\s*\*?\s*([\w$]+)/)
      pendingOpener = { name: m?.[1] ?? '?', kind: 'function', line: idx + 1 }
      return
    }
    if (RE_TOP_CLASS.test(l)) {
      const m = l.match(/class\s+([\w$]+)/)
      pendingOpener = { name: m?.[1] ?? '?', kind: 'class', line: idx + 1 }
      return
    }
    if (RE_TOP_CONST.test(l)) {
      const m = l.match(/^(?:export\s+)?(?:const|let|var)\s+([\w$]+)/)
      pendingConst = { name: m?.[1] ?? '?', line: idx + 1, bracketBase: bracketDepth }
      return
    }
    const member = memberHeadOnLine(idx)
    if (member) {
      const top = stack[stack.length - 1]
      const inClassBody = top !== undefined && top.kind === 'class'
      if (inClassBody || (HOOKS.has(member) && top !== undefined && top.kind !== 'class')) {
        pendingMember = { name: member, line: idx + 1 }
      }
    }
  }
  const lineStartOffset = (pos: number): number => text.lastIndexOf('\n', pos - 1) + 1

  while (i < text.length) {
    const c: string = text[i] ?? ''
    if (c === '\n') {
      sealWord()
      line += 1
      i += 1
      continue
    }
    const top = stack[stack.length - 1]
    const inTemplate = top !== undefined && top.kind === 'template'
    if (!inTemplate && checkedLine !== line) {
      checkedLine = line
      lineEntry(line - 1)
    }
    if (inTemplate) {
      if (c === '\\') {
        i += 2
      } else if (c === '`') {
        const err = popFrame()
        if (err) return { desync: `第 ${line} 行：栈下溢`, decls }
        i += 1
        sig('`')
      } else if (c === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'block', opener: null, startLine: line })
        i += 2
        sig('{')
      } else {
        i += 1
      }
      continue
    }
    // ---- code 状态 ----
    if (!WORD_RE.test(c)) sealWord()
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') line += 1
        i += 1
      }
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      i += 1
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i += 1
        if (text[i] === '\n') return { desync: `第 ${line} 行：字符串未闭合跨行`, decls }
        i += 1
      }
      i += 1
      sig(c)
      continue
    }
    if (c === '`') {
      const col = i - lineStartOffset(i)
      let opener: { name: string; kind: string; line: number } | null = null
      const pc = pendingConst as { name: string; line: number; bracketBase: number } | null
      if (pc !== null && bracketDepth === pc.bracketBase && isLastOpenerOnLine(line - 1, col)) {
        opener = { name: pc.name, kind: 'const', line: pc.line }
        pendingConst = null
      }
      stack.push({ kind: 'template', opener, startLine: opener ? opener.line : line })
      i += 1
      sig('`')
      continue
    }
    if (c === '{') {
      const col = i - lineStartOffset(i)
      let opener: { name: string; kind: string; line: number } | null = null
      const po = pendingOpener as { name: string; kind: string; line: number } | null
      if (po !== null && isLastOpenerOnLine(line - 1, col)) {
        opener = po
        pendingOpener = null
      } else {
        const pc = pendingConst as { name: string; line: number; bracketBase: number } | null
        const pm = pendingMember as { name: string; line: number } | null
        if (pc !== null && bracketDepth === pc.bracketBase && isLastOpenerOnLine(line - 1, col)) {
          opener = { name: pc.name, kind: 'const', line: pc.line }
          pendingConst = null
        } else if (pm !== null && isLastOpenerOnLine(line - 1, col)) {
          opener = { name: pm.name, kind: 'method', line: pm.line }
          pendingMember = null
        }
      }
      stack.push(opener ? { kind: opener.kind, opener, startLine: opener.line } : { kind: 'block', opener: null, startLine: line })
      i += 1
      sig('{')
      continue
    }
    if (c === '}') {
      const err = popFrame()
      if (err) return { desync: `第 ${line} 行：栈下溢`, decls }
      i += 1
      sig('}')
      continue
    }
    if (c === '/' && text[i - 1] === '<') {
      i += 1 // JSX 闭合标签
      sig('/')
      continue
    }
    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i += 1
      continue
    }
    if (c === '/' && isRegexPosition() && !isIncrementRun()) {
      i += 1
      let inClass = false
      let closed = false
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === '\n') break
        if (inClass) {
          if (text[i] === ']') inClass = false
        } else if (text[i] === '[') {
          inClass = true
        } else if (text[i] === '/') {
          closed = true
          break
        }
        i += 1
      }
      if (closed) {
        i += 1
        while (i < text.length && /[a-z]/i.test(text[i] ?? '')) i += 1
      }
      sig('/')
      continue
    }
    if (c === '(' || c === '[') {
      if (awaitingFuncName) {
        pendingOpener = { name: '(anon)', kind: 'function', line }
        awaitingFuncName = false
      }
      bracketDepth += 1
      i += 1
      sig(c)
      continue
    }
    if (c === ')') {
      awaitingFuncName = false
      bracketDepth = Math.max(0, bracketDepth - 1)
      i += 1
      sig(c)
      continue
    }
    if (c === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      i += 1
      sig(c)
      continue
    }
    if (c === ';') {
      pendingOpener = null
      pendingConst = null
      pendingMember = null
      awaitingFuncName = false
      i += 1
      sig(';')
      continue
    }
    if (WORD_RE.test(c)) {
      word += c
    } else if (c === ' ' || c === '\t' || c === '\r') {
      // 空白只封词，不动 lastMeaningful
    } else {
      sig(c)
    }
    i += 1
  }
  sealWord()
  if (stack.length !== 0) {
    const frames = stack
      .map((f) => (f.opener ? `${f.opener.kind} ${f.opener.name}@L${f.opener.line}` : `${f.kind}@L${f.startLine}`))
      .join(' ← ')
    return { desync: `EOF 时栈未清空（深 ${stack.length}）：${frames}`, decls }
  }
  const eofOpener = pendingOpener as { name: string; line: number } | null
  const eofMember = pendingMember as { name: string; line: number } | null
  if (eofOpener !== null || eofMember !== null) {
    const p = (eofOpener ?? eofMember) as { name: string; line: number }
    return { desync: `EOF 时声明头未落块：${p.name}（第 ${p.line} 行）`, decls }
  }
  return { desync: null, decls }
}

interface Span { path: string; name: string; start: number; lines: number }

export function scanSource(): { fileLines: { path: string; lines: number }[]; spans: Span[]; desyncs: string[] } {
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
  const files = walk(join(pkgRoot, 'src'))
    .map((abs) => ({ abs, path: relative(pkgRoot, abs).replaceAll('\\', '/') }))
    .filter((f) => !GENERATED_DIRS.some((d) => f.path === d || f.path.startsWith(d + '/')))
    .sort((a, b) => (a.path < b.path ? -1 : 1))

  const fileLines: { path: string; lines: number }[] = []
  const spanMax = new Map<string, Span>()
  const desyncs: string[] = []
  for (const { abs, path } of files) {
    const text = readFileSync(abs, 'utf8')
    const raw = text.split('\n')
    if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
    fileLines.push({ path, lines: raw.length })
    const { desync, decls } = lexFile(text)
    if (desync) desyncs.push(`${path}: ${desync}`)
    for (const d of decls) {
      const key = `${path}#${d.name}`
      const prev = spanMax.get(key)
      if (prev === undefined || d.extent > prev.lines) {
        spanMax.set(key, { path, name: d.name, start: d.line, lines: d.extent })
      }
    }
  }
  return {
    fileLines,
    spans: [...spanMax.values()].sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name)),
    desyncs,
  }
}

describe('文件大小守卫（执行计划 T0.4）', () => {
  it('词法扫描器对所有源文件不失步（fail-closed）', () => {
    const { desyncs } = scanSource()
    const desyncMsg = desyncs.length ? ['词法扫描器失步 —— 请先修扫描器，不要用白名单掩盖：', ...desyncs].join('\n') : ''
    expect(desyncs, desyncMsg).toEqual([])
  })

  it('单文件行数 ≤ 1,200（白名单棘轮，只准减不准增）', () => {
    const { fileLines } = scanSource()
    const over: string[] = []
    const stale: string[] = []
    for (const f of fileLines) {
      const registered = FILE_WHITELIST[f.path]
      if (registered === undefined) {
        if (f.lines > FILE_LIMIT) over.push(`${f.path}: 实测 ${f.lines} > ${FILE_LIMIT}（未登记白名单）`)
        continue
      }
      if (f.lines > registered) over.push(`${f.path}: 实测 ${f.lines} > 棘轮登记 ${registered} —— 只准减不准增`)
      else if (f.lines <= FILE_LIMIT) stale.push(`${f.path}: 实测 ${f.lines} 已达标（≤${FILE_LIMIT}），请从白名单删除条目`)
    }
    for (const key of Object.keys(FILE_WHITELIST)) {
      if (!fileLines.some((f) => f.path === key)) stale.push(`${key}: 白名单条目指向不存在的文件，请清理`)
    }
    expect(over, over.join('\n')).toEqual([])
    expect(stale, stale.join('\n')).toEqual([])
  })

  it('单函数跨度 ≤ 600（白名单棘轮，只准减不准增）', () => {
    const { spans } = scanSource()
    const over: string[] = []
    const stale: string[] = []
    const seen = new Set(Object.keys(FUNC_WHITELIST))
    for (const m of spans) {
      const key = `${m.path}#${m.name}`
      const registered = FUNC_WHITELIST[key]
      if (registered === undefined) {
        if (m.lines > FUNC_LIMIT) over.push(`${key}: 实测 ${m.lines} > ${FUNC_LIMIT}（未登记白名单）`)
        continue
      }
      seen.delete(key)
      if (m.lines > registered.lines) over.push(`${key}: 实测 ${m.lines} > 棘轮登记 ${registered.lines} —— 只准减不准增`)
      else if (m.lines <= FUNC_LIMIT) stale.push(`${key}: 实测 ${m.lines} 已达标（≤${FUNC_LIMIT}），请从白名单删除条目`)
    }
    for (const key of seen) stale.push(`${key}: 白名单条目没有对应的实测声明（声明被删/改名），请清理`)
    expect(over, over.join('\n')).toEqual([])
    expect(stale, stale.join('\n')).toEqual([])
  })
})
