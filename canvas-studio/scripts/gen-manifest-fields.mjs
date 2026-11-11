/**
 * 复刻提效批四：从 `src/remotion/manifest.ts` **机器生成**字段表。
 *
 * ## 抓的是什么浪费
 *
 * 2026-11-02 甜品复刻真机会话实测：模型为确认「manifest 到底有哪些字段」，
 * 18 次读 `src/remotion/manifest.ts`、15 次读 `host-tools.ts`，光是「读源码定契约」
 * 这一类就烧掉 42.8 分钟（占全会话模型时间 40.5%）。而 skill 里的手写契约
 * `manifest-contract.md` 已有 39.6KB —— **它照样去读源码**。
 *
 * 结论很清楚：手写文档会漂，源码不会，所以模型信源码。要让它不读源码，唯一的
 * 办法是让文档**由源码生成**，并用门禁保证「源码变 ⇒ 文档必须跟着变」。
 *
 * ## 用法
 *
 *   node scripts/gen-manifest-fields.mjs           # 重写生成物
 *   node scripts/gen-manifest-fields.mjs --check   # 只比对，不一致退出 1（门禁用）
 *
 * 生成物：`skills/code-driven-explainer/references/manifest-fields.generated.md`
 *
 * ## 口径
 *
 * - 只抽 `interface` / `type` 的**字段事实**（名字 / 可选性 / 类型原文 / JSDoc 首行），
 *   不抽实现逻辑 —— 实现细节仍属于源码，但那不是「契约」。
 * - 字段顺序按源码出现顺序（与读源码的阅读顺序一致，便于对照）。
 * - 嵌套类型只给类型名（如 `ManifestBox`），不展开 —— 展开会让体积翻倍，而模型
 *   需要的是「这个字段叫什么、必填吗、放什么」，类型细节按名字二次查即可。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(here, '..')
/**
 * 字段表要扫的源文件（**顺序即文档顺序**）。
 *
 * 2026-11-11 起 `Transform` / `VisualState` 外提到 `manifest-transform.ts` —— `manifest.ts`
 * 在 file-size-guard 的行数棘轮上（只准减不准增），加真 3D 四个字段会破线。所以这里不能
 * 只扫一个文件：漏扫的后果是真 3D 字段在字段表里**整段消失**，而字段表正是模型
 * 「不去读源码」的唯一依据（这份文档存在的全部理由，见文件头注）。
 */
const SOURCES = [
  join(workspaceRoot, 'src', 'remotion', 'manifest.ts'),
  join(workspaceRoot, 'src', 'remotion', 'manifest-transform.ts'),
]
/** 生成物路径（skill 引用目录）。 */
export const OUTPUT = join(workspaceRoot, 'skills', 'code-driven-explainer', 'references', 'manifest-fields.generated.md')

/** JSDoc 注释文本（兼容 string / array of nodes 两种内部形态）。 */
function docOf(node) {
  const docs = ts.getJSDocCommentsAndTags(node)
  for (const doc of docs) {
    const comment = doc.comment
    if (typeof comment === 'string' && comment.trim() !== '') return comment.trim().split('\n')[0].trim()
    if (Array.isArray(comment)) {
      const text = comment.map((part) => part.text ?? '').join('').trim()
      if (text !== '') return text.split('\n')[0].trim()
    }
  }
  return ''
}

/** 类型节点 → 一行类型文本（去掉多余换行，压缩 union 的排版）。 */
function typeText(node, source) {
  return node.getText(source).replace(/\s+/gu, ' ').trim()
}

/** 一个属性签名 → `- `name`? : Type — doc` */
function renderMember(member, source) {
  if (ts.isPropertySignature(member) === false) return null
  const name = member.name.getText(source).replace(/^['"]|['"]$/gu, '')
  const optional = member.questionToken === undefined ? '' : '?'
  const type = member.type === undefined ? 'any' : typeText(member.type, source)
  const doc = docOf(member)
  return `- \`${name}\`${optional}: ${type}${doc === '' ? '' : ` — ${doc}`}`
}

/** 扫一个源文件，产出它的全部字段小节（interface / 字符串字面量 union / type literal）。 */
function sectionsOfOneFile(sourcePath) {
  const text = readFileSync(sourcePath, 'utf8')
  const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const sections = []
  for (const statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement)) {
      const name = statement.name.getText(source)
      const doc = docOf(statement)
      const heritage = statement.heritageClauses?.map((clause) => clause.getText(source).replace(/\s+/gu, ' ')).join(' ') ?? ''
      const lines = statement.members.map((member) => renderMember(member, source)).filter((line) => line !== null)
      if (lines.length === 0) continue
      sections.push([`## ${name}${heritage === '' ? '' : ` (${heritage})`}`, ...(doc === '' ? [] : [`> ${doc}`]), '', ...lines, ''].join('\n'))
      continue
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      const name = statement.name.getText(source)
      const doc = docOf(statement)
      const type = statement.type
      // 字符串字面量 union ⇒ 枚举取值表（这是模型最常猜错的地方）
      if (ts.isUnionTypeNode(type) && type.types.every((part) => ts.isLiteralTypeNode(part))) {
        const values = type.types.map((part) => part.getText(source)).join(' | ')
        sections.push([`## ${name}`, ...(doc === '' ? [] : [`> ${doc}`]), '', `取值：${values}`, ''].join('\n'))
        continue
      }
      if (ts.isTypeLiteralNode(type)) {
        const lines = type.members.map((member) => renderMember(member, source)).filter((line) => line !== null)
        if (lines.length === 0) continue
        sections.push([`## ${name}`, ...(doc === '' ? [] : [`> ${doc}`]), '', ...lines, ''].join('\n'))
        continue
      }
      sections.push([`## ${name}`, ...(doc === '' ? [] : [`> ${doc}`]), '', `定义：${typeText(type, source)}`, ''].join('\n'))
    }
  }
  return sections
}

/** 生成整份文档。 */
export function renderManifestFields(sourcePath = SOURCES) {
  const paths = typeof sourcePath === 'string' ? [sourcePath] : sourcePath
  const sections = paths.flatMap((path) => sectionsOfOneFile(path))
  const header = [
    '<!-- 机器生成：node scripts/gen-manifest-fields.mjs；请勿手改（改源码后重跑，门禁 tests/manifest-fields-drift.test.mjs 会红） -->',
    '',
    '# Composition Manifest 字段表（从 manifest.ts / manifest-transform.ts 生成）',
    '',
    '> **这是字段契约的权威清单**：字段名、可选性、枚举取值都以此为准，与源码逐字同步（有门禁守着）。',
    '> 写 manifest 时**不要再去读 `src/remotion/manifest.ts` 确认字段名** —— 那份信息就在下面，读源码是最后一手且很贵。',
    '> 本文件只讲「有哪些字段」，**怎么组合出好画面**看同目录的 `manifest-contract.md`。',
    '',
  ].join('\n')
  return header + '\n' + sections.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-manifest-fields.mjs')
if (invokedDirectly) {
  const generated = renderManifestFields()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-manifest-fields: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-manifest-fields.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-manifest-fields: 字段表与源码不一致（manifest.ts 改了但没重跑本脚本）。')
      console.error('修法：node scripts/gen-manifest-fields.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-manifest-fields: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-manifest-fields: 已写入 ${OUTPUT}（${generated.length} 字节）`)
  }
}
