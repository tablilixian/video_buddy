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
    '> 本表回答四件事：**哪些枚举值合法、哪些键会被「契约外字段」告警、默认常量是多少、机制的行为口径是什么**。',
    '> 枚举 / 默认值由源码 AST 直接抽出，与源码逐字同步（有漂移门禁守着）；下方「行为语义速查」是手写口径段，',
    '> 只写机制语义不写数值——数值一律以生成段为准（会话 19 实证：只给合法值不够，模型会为行为口径回去读源码）。',
    '',
    '## 行为语义速查（机制口径；真机实证坑位标注出处）',
    '',
    '- **reveal 两口径**：`reveal.direction` 是**进场**方向（可见区自该侧展开，`left` = 从左展开）；',
    '  退场擦除用 `reveal.out.direction`（内容朝该侧**退去** ⇒ 隐藏侧在反方向）；`exit` 不支持 clip，',
    '  不要拿 exit 做擦除。两段揭示窗口不得同帧「屏上全空」（四季片 D-08）。',
    '- **入场首帧不空**（ML-15）：`fadeUp` 等 animate 的 `from.opacity` 要么 0（正常淡入）、',
    '  要么 ≥0.35（完整可见）——**半截起步（如 0.25）= 首帧近全黑**，lint 会报（四季片 D-01）。',
    '- **countUp**（dataCard 专用）：数值前 **45 帧缓出滚动**到目标值，前后缀原样保留；滚动期间卡片标签',
    '  **不得与图表末点标签同值**（「2025 年」配滚动中间值 = 事实错误组合，ML-14）——标签用区间或「滚动中」。',
    '- **gauge**：`values` 恰 1 项 = 进度值，分母 `gaugeMax`（缺省 100），中心数位滚动；',
    '  指针类 = `shape` + `pivot:{x:50,y:100}` + `animate.rotation` 甩弧。',
    '- **caption 字幕**：`fontSize` 缺省 = **canvasHeight×0.11**（720p 即 79px——四季片实测压住图形，',
    '  显式给 40px 级）；折行宽 `widthPercent` 缺省 66；矮盒子给足 `box` 宽高防裁切。词级时间戳三级来源：',
    '  显式 `words`（0-based）> **`audioFrames` 音频真值等分**（强烈建议填，填法见 `manifest-builder.md`）> 能量包络兜底。',
    '- **shape `draw`（路径生长）**：非等比画布（`viewBox 0 0 100 100` + `PA=none` + 等宽描边）下',
    '  Chrome 的 dash 语义整体坏 ⇒ **生长结束也是断续胶囊**（取证台 QR2 实证）。不需要绘制动画的线',
    '  **不传 draw**（首帧即成）；确需 draw 接受退化或等根治批（pitfalls §9）。',
    '- **音频人声**：`voiceOver[].volume` / `mix.voiceVolume` 范围 **0–2**（>1 为增益，补偿过轻 TTS，',
    '  四季片 §6.4）；BGM / duck / 音轨 volume 仍 0–1。禁止重编码源音频凑响度（A 版提示词 A9）。',
    '- **chart**：`title`（1–40 字）画在绘图区上方标题带；`labelEvery` / `maxLabels` 只抽**标签**',
    '  不改数据点，首末点强制保留（末点是 countUp 锚点）；类目标签画在绘图区底边 88% 带内（§18.4）。',
    '- **textCard 无 `color` 键**（品牌宣传第一版 v1 / 2026-11-09）：合法键只有 `variant` / `text` /',
    '  `data` / `accentColor` / `anim` / `animOptions` / `countUp` / `dataSource`。写 `color` 只会进',
    '  「契约外字段」warning 并**静默丢弃**（该场一次 13 条）；正文色由 variant 固定为浅色系，',
    '  ⇒ 浅底配深字不可能用 textCard 实现，改用深色底板 / `caption`（有 color）/ `shape` 承载。',
    '- **textCard `title` 变体**（品牌宣传第一版 v1）：无条件铺满整盒的 35% 黑色遮罩，换行宽度按',
    '  `canvasWidth * 0.9` 算、**忽略 `box`**；`subtitle` 变体铺 `rgba(0,0,0,0.62)` 药丸底。想做轻底或',
    '  精确盒宽排版别硬调这两个变体（该场实测标题溢出盒子、浅瓷底被压成深板）。',
    '- **shape 的 `fx` 是文字效果**（品牌宣传第一版 v1）：`fxStyles()` 里 `stroke` 只产出 `textStroke`',
    '  与 `textShadow`，对形状填充/轮廓**完全无效** ⇒ 指望 `fx:stroke` 把实心圆变环会失败（该场 s4 环',
    '  渲染成与 s3 相同的实心圆）。要环形/绕圈点用 `path` 或 `orbit`，别靠 fx。',
    '- **shape `path` 忽略 `box`**（品牌宣传第一版 v1）：path 是铺满画布的 SVG，坐标为 0–100 双轴',
    '  百分比（`preserveAspectRatio=none`），源码注释明写「path 没有 box 落点」；用 `box` 限制轨迹范围',
    '  无效、会横贯整幅画面。要控尺寸就在 `d` 里写真实半径，或改用受 box 约束的其它 shape 类型。',
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
