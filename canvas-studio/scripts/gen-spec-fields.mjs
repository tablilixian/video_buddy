/**
 * 从 `content-spec.ts` 的 TS 类型机器生成 spec 全字段表（P1-2，REQ-038 R11 二轮）。
 *
 * ## 抓的是什么浪费
 *
 * 真机二轮 34 次源码探查里有 **4 次在问 `SpecUnit` 的完整合法键**
 * （`highlights` / `overlap` / `assetSlots` 到底认哪些）。`content-spec.md` 是散文 +
 * 两个示例，**没有全字段表**；而 `SpecUnit` 的合法键只存在于 TS 类型里（编译后没有
 * 运行时读取面），手写必漂移。与 `gen-manifest-fields.mjs` 同一套路：TS AST 抽
 * interface 字段（名字 / 可选性 / 类型原文 / JSDoc 首句），复用其 `sectionsOfOneFile`。
 *
 * ## 用法
 *
 *   node scripts/gen-spec-fields.mjs           # 重写生成物
 *   node scripts/gen-spec-fields.mjs --check   # 只比对，不一致退出 1
 *
 * 生成物：`skills/code-driven-explainer/references/spec-fields.generated.md`
 * 守卫：`tests/spec-fields-drift.test.mjs`（含「临时源文件加字段必须出现在生成物」反向变异）。
 *
 * 与 `yarn check` 的顺序：AST 只读 `src/`，不依赖 `lib/` ⇒ 位置不限；沿用 manifest-fields
 * 的位置（typecheck 后、build 前）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionsOfOneFile } from './gen-manifest-fields.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(here, '..', 'src', 'remotion', 'content-spec.ts')
export const OUTPUT = join(here, '..', 'skills', 'code-driven-explainer', 'references', 'spec-fields.generated.md')

/** 生成整份文档（sourcePath 可注入 ⇒ 反向变异用临时源文件验证）。 */
export function renderSpecFields(sourcePath = SOURCE) {
  const sections = sectionsOfOneFile(sourcePath)
  const header = [
    '<!-- 机器生成：node scripts/gen-spec-fields.mjs；请勿手改（改 content-spec.ts 后重跑，门禁 tests/spec-fields-drift.test.mjs 会红） -->',
    '',
    '# Content Spec 全字段表（从 content-spec.ts 生成）',
    '',
    '> **这是 spec 各级对象（ContentSpec / SpecSection / SpecUnit / SpecCarry）字段的唯一权威清单**：',
    '> 字段名、可选性、类型、枚举取值都以此为准，与源码逐字同步（有门禁守着）。',
    '> **不要再 grep `src/remotion/content-spec.ts` 确认「SpecUnit 认哪些键」** —— 答案就在下面。',
    '> 本表只讲「有哪些字段、什么类型」；**怎么填出好画面**看同目录 `content-spec.md`，',
    '> **格位 / 字号怎么算**看 `spec-geometry.generated.md`，**能表达什么**看 `spec-capability.generated.md`。',
    '',
  ].join('\n')
  return header + '\n' + sections.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-spec-fields.mjs')
if (invokedDirectly) {
  const generated = renderSpecFields()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-spec-fields: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-spec-fields.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-spec-fields: 字段表与 content-spec.ts 不一致（改了类型但没重跑本脚本）。')
      console.error('修法：node scripts/gen-spec-fields.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-spec-fields: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-spec-fields: 已写入 ${OUTPUT}（${Buffer.byteLength(generated)} 字节）`)
  }
}
