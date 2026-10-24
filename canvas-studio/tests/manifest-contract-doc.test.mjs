/**
 * REQ-035 F-12：`manifest-contract.md` 的**实现细节**章节必须与组件源码对得上。
 *
 * 抓的是什么：2026-10-24 事故里，agent 为了搞清楚"圆点占多宽""字号会不会自动放大"
 * "glow 能不能换色"这类问题，把 `Shape.tsx` / `TextCard.tsx` / `timing.ts` 读了 27 次、
 * 花了 1.5 小时，还因此触发 5 次上下文压缩。这批事实一旦写进契约文档，就必须**防止漂移**：
 * 文档说"圆点 18px + 24px 边距"，源码就得还是 18/24；源码改了而文档没改，这里变红。
 *
 * 直连源码与文档（不做编译产物依赖，纯文本断言）。
 * 定向跑：node --test tests/manifest-contract-doc.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC = join(ROOT, 'skills/code-driven-explainer/references/manifest-contract.md')
const txt = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** 文档断言 ↔ 源码事实 的一一对应表。 */
const CLAIMS = [
  {
    // 第 1 条：circle 的直径由 box.w 决定（h 被忽略）
    doc: '`paddingBottom: w%`',
    file: 'src/remotion/components/Shape.tsx',
    pattern: /paddingBottom: `\$\{box\.w\}%`/u,
    hint: 'circle 的实现改成按 h/paddingBottom 就别的方式了？同步改文档第 1 条',
  },
  {
    // 第 3 条：bullets 文字色硬编码
    doc: '`#e6edf3`',
    file: 'src/remotion/components/TextCard.tsx',
    pattern: /#e6edf3/u,
    hint: 'bullets/title 的文字色不再硬编码？同步改文档第 3 条',
  },
  {
    // 第 4 条：圆点 18px + marginRight 24（= 文字左缘偏 42px）
    doc: '圆点 18px + 右边距 24px',
    file: 'src/remotion/components/TextCard.tsx',
    pattern: /width: 18, height: 18[\s\S]{0,200}marginRight: 24/u,
    hint: '圆点尺寸/边距变了？同步改文档第 4 条（并重算 42px）',
  },
  {
    // 第 4 条：容器固定 900px
    doc: '容器固定 **900px** 宽',
    file: 'src/remotion/components/TextCard.tsx',
    pattern: /width: 900/u,
    hint: 'bullets 容器宽变了？同步改文档第 4 条',
  },
  {
    // 第 6 条：title 变体带全屏蒙版
    doc: '`rgba(0,0,0,0.35)`',
    file: 'src/remotion/components/TextCard.tsx',
    pattern: /rgba\(0,0,0,0\.35\)/u,
    hint: 'title 的蒙版色变了？同步改文档第 6 条',
  },
  {
    // 第 7 条：自动排版只缩不放（0.94 递减）
    doc: '以 0.94 递减收缩',
    file: 'src/remotion/timing.ts',
    pattern: /fontPx \* 0\.94/u,
    hint: 'fitTextPolicy 的收缩系数变了？同步改文档第 7 条',
  },
  {
    // 第 11 条：glow 固定冷蓝
    doc: '`rgba(120,190,255,…)`',
    file: 'src/remotion/timing.ts',
    pattern: /rgba\(120,\s?190,\s?255/u,
    hint: 'glow 颜色变成可配了？同步改文档第 11 条',
  },
  {
    // 第 12 条：temperature 暖= -12deg / 冷= 168deg
    doc: '`hue-rotate(-12deg)`',
    file: 'src/remotion/timing.ts',
    pattern: /hue-rotate\(\$\{temperature > 0 \? -12 : 168\}deg\)/u,
    hint: '色温实现变了？同步改文档第 12 条（冷调必须给负值这条结论会跟着变）',
  },
  {
    // 第 13 条：path 非等比
    doc: '`preserveAspectRatio="none"`',
    file: 'src/remotion/components/Shape.tsx',
    pattern: /preserveAspectRatio/u,
    hint: 'path 改成等比了？同步改文档第 13 条（rx:ry 补偿不再需要）',
  },
]

test('F-12：契约文档有「实现细节」章节，且 16 条齐全', () => {
  const doc = readFileSync(DOC, 'utf8')
  assert.ok(doc.includes('## 实现细节'), '必须有「实现细节」章节（读源码才看得到的坑）')
  const start = doc.indexOf('## 实现细节')
  const end = doc.indexOf('\n## ', start + 1)
  const section = end === -1 ? doc.slice(start) : doc.slice(start, end)
  const rows = [...section.matchAll(/^\| (\d+) \|/gmu)].map((m) => Number(m[1]))
  assert.deepEqual(rows, Array.from({ length: 16 }, (_, i) => i + 1), `16 条编号必须连续，实际 ${rows.join(',')}`)
})

for (const claim of CLAIMS) {
  test(`F-12：文档断言与源码一致 —— ${claim.doc}`, () => {
    const doc = readFileSync(DOC, 'utf8')
    assert.ok(doc.includes(claim.doc), `文档里找不到断言「${claim.doc}」`)
    const src = txt(claim.file)
    assert.match(
      src,
      claim.pattern,
      `${claim.file} 已不再匹配「${claim.doc}」。${claim.hint}`,
    )
  })
}

test('F-12：文档不得残留「不要手写脚本」式的旧口径（inspect_image 已改）', () => {
  const doc = readFileSync(DOC, 'utf8')
  assert.ok(!doc.includes('不要再手写 PNG 解码脚本'), '旧承诺已证伪，不该出现在契约里')
  // 但"用 inspect_image 拿像素真值"这个正确引导要保留
  assert.ok(doc.includes('inspect_image'), '像素真值引导不能一起删掉')
})
