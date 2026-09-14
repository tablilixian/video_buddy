/**
 * 宿主边界守卫（DD-09 / a 批）—— 「不改 dsh 本体、保随时无缝升级」的唯一硬保障。
 *
 * 背景：用户硬约束「不能修改 dsh 自己的功能，因为要保留随时无缝升级 dsh 的能力」。
 * 2026-09-14 实测结论：**三条纪律当时就已经是 0**（不是这批改出来的）——
 * 704 个样式选择器全含 `.cs`、`--dsw-*` 赋值 0 次（只读 var() 577 次 / 22 令牌）、
 * 深入 `deepseek-harness/` 的相对 import 0 处。
 *
 * 所以这条守卫的职责**不是修违规，而是把 0 钉住**（棘轮）。没有它，任何一次
 * 顺手写下的宿主选择器都会静默地让「无缝升级」失效 —— 而且代价要到下次升级
 * dsh 时才暴露：样式不生效、页面不报错。
 *
 * 四条红线：
 *
 * 1. **样式边界** —— 插件样式表的选择器必须全是插件自有的（`.cs*` / `[data-cs-*]`，
 *    以及 html / body / :root / * 这类宿主根）。写宿主类名（尤其 CSS Modules 的
 *    hash 类名）在升级时会静默失配：命中不了、不报错，且 hash 一变永远命中不了。
 * 2. **令牌边界** —— 禁止**赋值** `--dsw-*`。令牌是宿主公开契约，`var()` 只读引用
 *    永远安全（插件引用 577 次）；赋值等于把插件与「宿主当前那套值」耦合起来。
 * 3. **宿主属性白名单** —— 写 `data-ds-*` 必须显式登记。目前唯一合法项是
 *    `data-ds-dark-theme`（主题状态声明，宿主消费该属性，插件只是把状态说给它听）。
 * 4. **槽注册纪律** —— 往宿主槽注册 occupant 必须由 `slots.inject` 包着。裸
 *    `register` 到未声明槽会抛「registering into an undeclared slot throws」→
 *    渲染进程 abort（Renderer boot failed）；`inject` 的 callback 在**声明就绪后**
 *    才跑，所以宿主删/改槽位时插件静默不挂那块 UI、整体照常启动 —— 这才是
 *    「无缝升级」的技术基础。声明**自己的**槽（带 `children`）不受此限。
 *
 * 全部是读源码文本的静态检查，不依赖 DOM、不需要先 build。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// 槽注册纪律（红线④）用真实 AST 判定，不用手写扫描器 —— 理由见 slotCallsOf。
const require = createRequire(import.meta.url)
const ts = require('typescript')

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * 剥注释：块注释 + 整行注释（行内剥除会吃掉 `https://`，见 visual-tokens 同名辅助）。
 *
 * 与 visual-tokens 的同名辅助有一处**关键差异**：这里把注释替换成**等量空白**而不是
 * 直接删行 —— 因为本文件要报出违规所在的**行号**，一旦删行，报出来的 653 行指的
 * 是「剥注释后的 653 行」，去源码里一查是个函数定义（实测踩过）。块注释保留换行，
 * 整行注释替换成空行，行号就和源码严格对齐。
 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (line.trim().startsWith('//') ? '' : line))
    .join('\n')

const STYLES_SRC = readSrc('../src/client/styles.ts')
const BRAND_SRC = readSrc('../src/brand.ts')

const SRC_ROOT = new URL('../src/', import.meta.url)

const walkSources = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
    if (entry.isDirectory()) walkSources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const SOURCE_FILES = walkSources(SRC_ROOT)

/** styles.ts 里 STUDIO_STYLES 模板的内容（纯 CSS —— 模板外的 JS 不参与选择器解析）。 */
const studioCss = () => {
  const open = STYLES_SRC.indexOf('`', STYLES_SRC.indexOf('const STUDIO_STYLES'))
  return STYLES_SRC.slice(open + 1, STYLES_SRC.lastIndexOf('`'))
}

/** 插件自有选择器前缀：类名 `.cs*`，或自有属性 `[data-cs-*]`。 */
const OWN_SELECTOR = /\.cs|\[data-cs-/

/** 宿主根元素 —— 全局层，任何插件都躲不开，不算越界。 */
const ROOT_SELECTORS = new Set(['html', 'body', ':root', '*'])

/** 从一段 CSS 里拆出全部选择器（逗号分段已拆开），并丢掉 @规则与 keyframes 关键帧。 */
const selectorsOf = (css) => {
  // 必须先剥注释：styles.ts 的注释里写了大量选择器与花括号（「`.csFrame[data-rail=...]`」），
  // 不剥就会把注释文本当成选择器 —— 实测报出 20 多条纯属注释的「越界」。
  const src = codeOnly(css)
  const out = []
  // 首字符类必须排除**空白**（`[^\s{}/@]`），只排除 `{}/@` 是不够的：`\s*` 是贪婪的，
  // 遇到 `}\n\n@media ...{` 时会回溯成「`\s*` 吃一个换行、字符类吃掉第二个换行」，
  // 于是 `@media` / `@keyframes` / `@supports` 整行被当成选择器 —— 实测 17 条
  // 「宿主选择器」假违规全出自这里。排掉空白后，回溯无处可去。
  const re = /(?:^|[}\n])\s*([^\s{}/@][^{}]*?)\s*\{/g
  let match
  while ((match = re.exec(src))) {
    const raw = match[1].trim()
    if (raw === '') continue
    // 模板插值（${...}）被字符类切碎后，残留的声明或 JS 片段会含分号 / 箭头。
    if (raw.includes(';') || raw.includes('=>')) continue
    for (const piece of raw.split(',')) {
      const selector = piece.trim()
      if (selector === '') continue
      if (/^(\d+(\.\d+)?%|from|to)$/.test(selector)) continue
      out.push(selector)
    }
  }
  return out
}

/** brand.ts 里所有模板字面量行末尾是 `{` 的选择器（`${...}` 先替换成占位）。 */
const brandSelectorsOf = () => {
  const out = []
  for (const [, body] of BRAND_SRC.matchAll(/`([^`]*)`/g)) {
    for (const line of body.split('\n')) {
      const text = line.replace(/\$\{[^}]*\}/g, 'x').trim()
      if (!text.endsWith('{')) continue
      const raw = text.slice(0, -1).trim()
      if (raw === '' || raw.includes(';')) continue
      for (const piece of raw.split(',')) {
        const selector = piece.trim()
        if (selector !== '') out.push(selector)
      }
    }
  }
  return out
}

test('红线①：插件样式表不得出现宿主选择器（升级即静默失配）', () => {
  const pluginSelectors = [...selectorsOf(studioCss()), ...brandSelectorsOf()]
  const offenders = pluginSelectors.filter(
    (selector) => !OWN_SELECTOR.test(selector) && !ROOT_SELECTORS.has(selector),
  )
  assert.deepEqual(
    offenders,
    [],
    `插件样式表写了下述非自有选择器 —— 它们会在 dsh 升级后静默失配（不报错、样式不生效）：\n  ${offenders.join('\n  ')}`,
  )
  // 反向自证：解析器真的解析到了选择器（否则「越界为空」只说明正则没工作）。
  assert.ok(
    pluginSelectors.length >= 500,
    `只解析到 ${pluginSelectors.length} 个选择器，解析器形同虚设（基线约 712 个）`,
  )
  assert.ok(
    brandSelectorsOf().length >= 2,
    `brand.ts 只解析到 ${brandSelectorsOf().length} 个选择器（基线 2 个：浅色 / 深色两套品牌规则）`,
  )
})

test('红线②：禁止赋值宿主令牌 --dsw-*（var() 只读引用不受限）', () => {
  for (const [label, src] of [['styles.ts', STYLES_SRC], ['brand.ts', BRAND_SRC]]) {
    const assigned = [...new Set([...codeOnly(src).matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))]
    assert.deepEqual(
      assigned,
      [],
      `${label} 赋值了宿主令牌 —— 令牌是宿主公开契约，只能 var() 只读引用：${assigned.join(', ')}`,
    )
  }
  // 反向自证：只读引用确实存在（说明「没有赋值」不是因为整份文件没碰令牌）。
  const refs = [...STYLES_SRC.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)]
  assert.ok(refs.length >= 400, `styles.ts 对宿主令牌的只读引用只有 ${refs.length} 次（基线 577）`)
})

test('红线③：写宿主 data-ds-* 属性必须显式白名单', () => {
  const ALLOWED = new Set(['data-ds-dark-theme'])
  const offenders = []
  for (const file of SOURCE_FILES) {
    const src = codeOnly(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(/(set|toggle|remove)Attribute\(\s*'(data-ds-[a-z-]+)'/g)) {
      if (!ALLOWED.has(m[2])) offenders.push(`${path.relative(SRC_ROOT.pathname, file.pathname)}: ${m[2]}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `写入了未登记的宿主属性 —— 宿主属性是它的内部状态，新增必须在此显式登记并说明理由：\n  ${offenders.join('\n  ')}`,
  )
  // 反向自证：白名单那一项确实在用（否则白名单是摆设，规则可能早就不匹配了）。
  const used = SOURCE_FILES.some((file) =>
    /toggleAttribute\(\s*'data-ds-dark-theme'/.test(readFileSync(file, 'utf8')),
  )
  assert.ok(used, '白名单里的 data-ds-dark-theme 已无人写入 —— 白名单需要同步清理')
})

/**
 * 收集一个源码文件里全部 `slots.register(...)` 调用点，标出「声明」还是「占位」。
 *
 * **为什么用 TypeScript AST，而不是手写括号配对**：初版手写了一个「从 `(` 配对括号、
 * 再向前看是否被 `.inject(` 包住」的扫描器。实测 `index.ts:867` 的**声明式**注册被判成
 * 违规 —— 那个调用的参数对象里塞了近两百行箭头函数，期间任何行尾注释、字符串或正则
 * 字面量里出现一个不平衡的 `)`，配对就会提前闭合、参数被切成多段，「单参数 + children」
 * 这个特征当场失效。注释与字符串对手写扫描器是雷区，对 AST 不是；而 typescript 本来
 * 就是本仓的既有依赖（验证链里的 `tsc`）。
 *
 * 判定依据：
 * - **声明**（合法裸调）= 单参数对象字面量且含 `children` 字段 —— 声明插件自己的槽树。
 * - **占位**（必须被守卫）= 其余调用，且它的直接外层调用不是 `.inject(...)`。
 */
/** 调用接收者是不是 `slots` 服务本身（`slots.register` / `ctx.slots.register`）。 */
const isSlotsReceiver = (node) => {
  if (node === undefined) return false
  if (ts.isIdentifier(node)) return node.text === 'slots'
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'slots'
  return false
}

/**
 * 按扩展名选 ScriptKind —— **不能一律用 TSX**：`.tsx` 之外的 `.ts` 里合法存在
 * 泛型箭头函数与 `<T>expr` 类型断言，TSX 模式会把 `<` 当 JSX 起点解析，
 * 实测 `client/index.ts` 直接炸出 597 条 parseDiagnostics、AST 全废
 * （症状是整个文件扫不出一个调用点）。
 */
const scriptKindOf = (fileName) => (fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** 剥掉 `as never` / 括号等纯包裹层（本仓调用处的惯用写法）。 */
const unwrapAs = (node) => {
  let cur = node
  while (cur !== undefined
    && (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isParenthesizedExpression(cur))) {
    cur = cur.expression
  }
  return cur
}

const slotCallsOf = (fileName, src) => {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, scriptKindOf(fileName))
  const found = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'register'
      // 必须再校验接收者：本仓另有 tools / conversationEvents / webServer 三处
      // 同名的 `register`，只看方法名会当场报出 4 条假违规（实测）。
      && isSlotsReceiver(node.expression.expression)
    ) {
      const args = node.arguments
      // 注意不能用「参数个数 == 1」判声明：本仓的调用处一律写成
      // `register({ ... } as never, renderer)`，参数是**两个**，且第一个还被
      // `as never` 包着。形状判据只能是「剥壳后的对象字面量里有没有 children」——
      // children 是「声明自己的槽树」，name 是「往宿主槽里塞 occupant」。
      const target = unwrapAs(args[0])
      const isDeclaration = ts.isObjectLiteralExpression(target)
        && target.properties.some((p) => p.name !== undefined && p.name.getText(sf) === 'children')
      // slots.inject('槽名', () => slots.register(...)) —— register 的父节点是
      // 箭头函数 / 函数表达式，再上一层是该 inject 调用本身。
      const callback = node.parent
      const wrapper = callback === undefined ? undefined : callback.parent
      const guarded = (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
        && wrapper !== undefined
        && ts.isCallExpression(wrapper)
        && ts.isPropertyAccessExpression(wrapper.expression)
        && wrapper.expression.name.text === 'inject'
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      found.push({ line: line + 1, isDeclaration, guarded })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

test('红线④：注册宿主槽 occupant 必须经 slots.inject（守护「无缝升级」本身）', () => {
  const declarations = []
  const guardedOccupants = []
  const occupants = []
  for (const file of SOURCE_FILES) {
    const rel = path.relative(SRC_ROOT.pathname, file.pathname)
    for (const call of slotCallsOf(file.pathname, readFileSync(file, 'utf8'))) {
      if (call.isDeclaration) {
        declarations.push(`${rel}:${call.line}`)
        continue
      }
      if (call.guarded) {
        guardedOccupants.push(`${rel}:${call.line}`)
        continue
      }
      occupants.push(`${rel}:${call.line}`)
    }
  }
  assert.deepEqual(
    occupants,
    [],
    `裸调 slots.register 注册 occupant —— 宿主若未声明该槽会抛「registering into an undeclared slot」\n`
      + `并让渲染进程 abort。必须写成 slots.inject('槽名', () => slots.register(...))：\n  ${occupants.join('\n  ')}`,
  )
  // 反向自证：两类调用都真的扫到了（否则「occupants 为空」可能只是因为扫描器什么都没匹配到）。
  assert.ok(declarations.length >= 1, `没有扫到任何槽声明调用（基线 1 处：index.ts 的 root 子槽表）`)
  assert.ok(
    guardedOccupants.length >= 2,
    `只扫到 ${guardedOccupants.length} 处受 slots.inject 保护的 occupant（基线 2 处：chat.node 点选卡 + 输入区 dock）`
      + '—— 判定可能过宽，把真 occupant 误当成「声明」放过去了',
  )
})

test('红线补充：插件不得用相对路径深入 deepseek-harness/（依赖走包名）', () => {
  const offenders = []
  for (const file of SOURCE_FILES) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/from\s+'([^']*deepseek-harness[^']*)'/g)) {
      offenders.push(`${path.relative(SRC_ROOT.pathname, file.pathname)} -> ${m[1]}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `插件按相对路径深入了 dsh 子模块 —— 这是「改宿主」的入口，必须改走包名依赖：\n  ${offenders.join('\n  ')}`,
  )
})
