/**
 * 配方正确用法（2026-11-26）守卫：**recipe enum 覆盖** + **D8 文档漂移断言**。
 *
 * ## 抓什么
 *
 * 1. **enum 覆盖**：`scaffold_manifest` 的 `recipe` 参数 enum 是手写字面量数组，
 *    与 `RECIPES` 注册表是两处事实 —— 新增配方忘了改 enum ⇒ 模型永远选不到它，
 *    且没有任何测试红（编译期只查字面量，不查集合相等）。这里把两边抽出来比对。
 *
 * 2. **D8（反变异① · 文档漂移断言）**：结构起点裁决在 prompt 层（D1 不加
 *    `structure` 字段 ⇒ 无运行时拒收点）。所以护栏是**两份文档同口径**：
 *    `intent-card.md` 的结构起点规则与 `list_recipes` 工具描述必须同含
 *    「0✅ → 不选配方、落自由编排」的拒收句。任一侧改口径而另一侧没跟，
 *    模型就会拿到互相矛盾的指令（一边说 0✅ 自由编排、一边不说）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RECIPES } from '../lib/remotion/recipes.js'

const ROOT = join(import.meta.dirname, '..')

test('recipe enum 覆盖：scaffold_manifest 的 recipe enum 必须与 RECIPES 注册表逐个相等', () => {
  const source = readFileSync(join(ROOT, 'src/host-tools.ts'), 'utf8')
  const match = source.match(/recipe: \{\s*type: 'string' as const,\s*enum: (\[[^\]]*\]) as const,/u)
  assert.ok(match, '在 src/host-tools.ts 里找不到 recipe 参数的 enum 字面量（结构变了？）')
  // eslint-disable-next-line no-eval -- 只是字面量数组 ['a', 'b']，非用户输入
  const declared = JSON.parse(match[1].replace(/'/g, '"'))
  const registered = Object.keys(RECIPES).sort()
  assert.deepEqual(
    [...declared].sort(),
    registered,
    'recipe enum 与 RECIPES 不一致 —— 新增/删除配方后，enum 少一项模型就选不到，多一项会选到不存在的配方。',
  )
})

test('D8 反变异①：intent-card.md 与 list_recipes 描述同含「0✅ → 落自由编排」拒收口径', () => {
  const intentCard = readFileSync(
    join(ROOT, 'skills/canvas-studio-creation/references/intent-card.md'),
    'utf8',
  )
  // intent-card.md 的结构起点行：五判据 0 个 ✅ ⇒ 自由编排（prompt 层裁决规则）。
  assert.match(
    intentCard,
    /0 个才自由编排/u,
    'intent-card.md 丢了「0 个才自由编排」口径 —— 结构起点裁决规则漂移，模型会凭直觉静默选边',
  )

  const template = readFileSync(join(ROOT, 'src/host-tools-template.ts'), 'utf8')
  const description = template.match(/name: 'list_recipes',\s*description:\s*([\s\S]*?),\s*parameters:/u)
  assert.ok(description, '找不到 list_recipes 的 description（工具结构变了？）')
  const text = description[1]
  assert.match(text, /不得选配方/u, 'list_recipes 描述缺「不得选配方」拒收句')
  assert.match(text, /落自由编排/u, 'list_recipes 描述缺「落自由编排」去向句')
  assert.match(text, /0✅/u, 'list_recipes 描述缺 0✅ 判据锚点（与 intent-card.md 的「0 个」对不上）')
})
