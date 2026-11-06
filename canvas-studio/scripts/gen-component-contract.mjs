/**
 * P0-1：从源码**机器生成**组件契约速查（合法枚举 / 合法键 / 默认常量）。
 *
 * ## 抓的是什么浪费
 *
 * 2026-11-06 会话 18：48 分钟、3 次 compaction、零成片。turn2 里 56 次 bash
 * 读 `src/remotion/manifest.ts` / `Shape.tsx` / `Chart.tsx` / `Caption.tsx` /
 * `Callout.tsx` / `reveal.ts`（回灌 189.5KB），只为确认「哪些值合法、哪些键会被
 * 拒绝、默认是多少」。`SKILL.md` 早已写「禁止用 bash 读 src/remotion/** 推契约」，
 * 但文本规则拦不住：模型不信任手写文档，因为手写会漂。
 *
 * 现有 `gen-manifest-fields.mjs` 只抽 interface/type 的字段名，抽不到这些
 * `new Set([...])` 白名单与 `KNOWN_*_KEYS` 合法键表 —— 正是模型反复回去读源码
 * 的那部分。本脚本补齐这一层，同样由源码生成 + 漂移门禁（见
 * tests/component-contract-drift.test.mjs）。
 *
 * ## 用法
 *   node scripts/gen-component-contract.mjs
 *   node scripts/gen-component-contract.mjs --check
 *
 * 生成物：skills/code-driven-explainer/references/component-contract.generated.md
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
export const OUTPUT = join(root, 'skills', 'code-driven-explainer', 'references', 'component-contract.generated.md')

/** 单一真源：只登记「模型写 spec 时会去读源码确认」的文件。 */
export const SOURCES = [
  'src/remotion/manifest.ts',
  'src/remotion/reveal.ts',
  'src/remotion/components/Shape.tsx',
  'src/remotion/components/Chart.tsx',
  'src/remotion/components/Caption.tsx',
  'src/remotion/components/Callout.tsx',
  'skills/code-driven-explainer/assets/manifest-builder.mjs',
]

const CONST_NAME = /DEFAULT|FRAMES|RADIUS|LIMIT|MAX_|PREFIX|SIZES|THEME/u

/** `new Set(['a','b'])` → ['a','b']；其它形状返回 null。 */
function setValues(initializer, source) {
  if (initializer === undefined || !ts.isNewExpression(initializer)) return null
  if (initializer.expression.getText(source) !== 'Set') return null
  const array = initializer.arguments?.[0]
  if (array === undefined || !ts.isArrayLiteralExpression(array)) return null
  // 忽略 spread（如 `...OTHER_SET`）：那是内部复用，不是可抄的合法值。
  return array.elements.filter((el) => ts.isStringLiteral(el)).map((el) => el.text)
}

function objectLiteralText(initializer, source) {
  return initializer.getText(source).replace(/\s+/gu, ' ').trim()
}

/** 抽一个源文件的三组事实。 */
function extractOne(relPath, text) {
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : relPath.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(relPath, text, ts.ScriptTarget.ESNext, true, kind)
  const sets = []
  const constants = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const name = declaration.name.getText(source)
      const init = declaration.initializer
      if (init === undefined) continue
      const direct = setValues(init, source)
      if (direct !== null) {
        sets.push([name, direct])
        continue
      }
      // `KNOWN_TRACK_KEYS` 这类：对象字面量里每个值又是一个 Set。
      if (ts.isObjectLiteralExpression(init)) {
        let nested = 0
        for (const property of init.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue
          const values = setValues(property.initializer, source)
          if (values === null) continue
          sets.push([`${name}.${property.name.getText(source)}`, values])
          nested += 1
        }
        if (nested > 0) continue
        if (CONST_NAME.test(name)) constants.push([name, objectLiteralText(init, source)])
        continue
      }
      if ((ts.isNumericLiteral(init) || ts.isStringLiteral(init)) && CONST_NAME.test(name)) {
        constants.push([name, init.getText(source)])
      }
    }
  }
  return { sets, constants }
}

/** 生成整份文档；overrides 用于测试的反向变异（key = SOURCES 里的相对路径）。 */
export function renderComponentContract(overrides = {}) {
  const header = [
    '<!-- 机器生成：node scripts/gen-component-contract.mjs；请勿手改（改源码后重跑，tests/component-contract-drift.test.mjs 会红） -->',
    '',
    '# 组件契约速查：合法值 / 合法键 / 默认常量（从源码生成）',
    '',
    '> **写 manifest-spec 前读这一份就够，不要用 bash 去读 `src/remotion/**`。**',
    '> 字段名、可选性、类型看同目录 `manifest-fields.generated.md`；怎么组合出好画面看 `manifest-contract.md`；',
    '> 本表只回答三件事：**哪些枚举值合法、哪些键会被「契约外字段」告警、默认常量是多少**。',
    '> 下面每个值都由源码 AST 直接抽出，与源码逐字同步（有漂移门禁守着）；手写契约会漂，源码不会。',
    '',
  ].join('\n')

  const sections = []
  for (const relPath of SOURCES) {
    const text = overrides[relPath] ?? readFileSync(join(root, relPath), 'utf8')
    const { sets, constants } = extractOne(relPath, text)
    if (sets.length === 0 && constants.length === 0) continue
    const lines = [`## ${relPath}`, '']
    if (sets.length > 0) {
      lines.push('### 合法值与合法键', '')
      for (const [name, values] of sets) {
        lines.push(`- \`${name}\`: ${values.map((v) => `'${v}'`).join(' | ') || '（空）'}`)
      }
      lines.push('')
    }
    if (constants.length > 0) {
      lines.push('### 默认 / 边界常量', '')
      for (const [name, value] of constants) lines.push(`- \`${name}\` = ${value}`)
      lines.push('')
    }
    sections.push(lines.join('\n'))
  }
  return header + '\n' + sections.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-component-contract.mjs')
if (invokedDirectly) {
  const generated = renderComponentContract()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-component-contract: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-component-contract.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-component-contract: 契约速查与源码不一致（源码改了但没重跑本脚本）。')
      console.error('修法：node scripts/gen-component-contract.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-component-contract: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-component-contract: 已写入 ${OUTPUT}（${generated.length} 字节）`)
  }
}
