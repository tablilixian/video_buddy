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
    // 第 12 条：temperature 角度按 |temperature| 缩放（暖 sepia-12t / 冷 saturate+14t）
    doc: '`hue-rotate(-12·t)°`',
    file: 'src/remotion/timing.ts',
    pattern: /round3\(14 \* t\)/u,
    hint: '色温实现变了？同步改文档第 12 条（冷调必须给负值、角度按强度缩放这条结论会跟着变）',
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

// ── 故事板强约束 L5 / G6（2026-10-25）：`animation-and-assets.md` 与源码对码 ──────
//
// 这一册补的是「字段写了会怎样」—— 全是读源码才拿得到的事实。它们的失效方式最隐蔽：
// 源码改了而文档没改，模型照着旧文档写 manifest，渲出来不对却查不到原因。
// 所以每条都要求「文档里有这句话」+「源码里还是这个实现」双向成立。

const ANIM_DOC = join(ROOT, 'skills/code-driven-explainer/references/animation-and-assets.md')

const ANIMATION_FACTS = [
  {
    doc: '`typewriter` = **1**，其它 = **3**',
    file: 'src/remotion/timing.ts',
    pattern: /options\.preset === 'typewriter' \? 1 : 3/u,
    hint: 'wordDelayFrames 的缺省值变了？同步改动画分册第 1 节',
  },
  {
    doc: '`unitDurationInFrames`，缺省 **12 帧**',
    file: 'src/remotion/timing.ts',
    pattern: /options\.unitDurationInFrames \?\? 12/u,
    hint: '单元素入场时长缺省变了？同步改动画分册第 1 节',
  },
  {
    doc: '`easeOutCubic`',
    file: 'src/remotion/timing.ts',
    pattern: /EASINGS\.easeOutCubic\(raw\)/u,
    hint: '缓动曲线换了？同步改动画分册第 1 节',
  },
  {
    doc: '**1.0 → 1.08**',
    file: 'src/remotion/components/ImageClip.tsx',
    pattern: /1 \+ 0\.08 \* \(frame \/ duration\)/u,
    hint: 'kenburns 的推幅变了？同步改动画分册第 2 节',
  },
  {
    doc: '**`cover`**',
    file: 'src/remotion/components/ImageClip.tsx',
    pattern: /track\.fit \?\? 'cover'/u,
    hint: 'fit 的缺省变了？同步改动画分册第 2 节',
  },
  {
    doc: '`objectFit` 仍走 `cover`',
    file: 'src/remotion/components/ImageClip.tsx',
    pattern: /fit === 'contain' \? 'contain' : 'cover'/u,
    hint: 'kenburns 是否还落 cover 变了？同步改动画分册第 2 节',
  },
  {
    doc: 'ffmpeg 探**真值时长与真实像素**',
    file: 'src/remotion/asset-check.ts',
    pattern: /probeMediaInfo/u,
    hint: '素材核对不再探真值了？同步改动画分册第 3 节',
  },
  {
    doc: '`innerRatio` 缺省 **0.45**',
    file: 'src/remotion/shape-geometry.ts',
    pattern: /innerRatio = 0\.45/u,
    hint: 'star 的内半径比变了？同步改动画分册第 4 节',
  },
  {
    doc: '起始角 **-90°**',
    file: 'src/remotion/shape-geometry.ts',
    pattern: /rotationDeg = -90/u,
    hint: '多边形的起始角变了？同步改动画分册第 4 节',
  },
]

test('L5 · G6 分册与源码对码（动画时序 / 图片轨 / 素材 / 形状）', () => {
  const doc = readFileSync(ANIM_DOC, 'utf8')
  for (const fact of ANIMATION_FACTS) {
    assert.ok(doc.includes(fact.doc), `分册里必须保留这条事实（被删了就失去意义）：${fact.doc}`)
    const source = readFileSync(join(ROOT, fact.file), 'utf8')
    assert.match(source, fact.pattern, fact.hint)
  }
})

test('L5 · 分册必须保留那句「kenBurns 是死字段」的警告', () => {
  const doc = readFileSync(ANIM_DOC, 'utf8')
  assert.ok(doc.includes('**`kenBurns: true` 是死字段**'),
    '这条是事故里踩过的坑（类型里有、实现从不读）：删了模型会继续写它')
  assert.ok(doc.includes("`fit:'kenburns'`"), '必须给出正确写法')
})
