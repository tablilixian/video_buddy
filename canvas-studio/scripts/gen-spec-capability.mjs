/**
 * 表达力边界表（S-2）：**每条结论都由一次真实探测得出**，不是抄注释。
 *
 * ## 抓的是什么浪费
 *
 * 2026-11-16 第二轮真机会话：+46.7 分钟才发现「`carry` 只能画形状、放不了文字」
 * （`SpecCarry` 只有 `id/box/color/radius`），此后 7 分钟原地打转找「合法的手搓出口」。
 * 而这条事实**一条类型声明 + 一次探测就能说清**。
 *
 * 表达力边界是**负面清单**，最容易被手写文档遗漏 —— 写文档的人在描述「能做什么」时
 * 心情好，不会系统列「不能做什么」。所以这里不手写结论：每条都跑一次
 * `validateContentSpec` / `planFromSpec`，把**实测到的行为**写进表格。
 *
 * ## 两种内容分开
 *
 * - **事实行**：结论由 `PROBES` 跑出来（探测失败 ⇒ 脚本直接抛，不发布假结论）。
 * - **判断行**：`JUDGEMENTS` 里手写（「这个缺口该怎么绕」属判断，机器判不了），
 *   但每条都点名它引用的实测行，便于对照。
 *
 * ## 用法
 *
 *   node scripts/gen-spec-capability.mjs           # 重写生成物
 *   node scripts/gen-spec-capability.mjs --check   # 只比对
 *
 * ⚠️ import `lib/`（tsc 产物）⇒ 必须在 `yarn build` 之后跑（`yarn check` 已按此排序）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { validateContentSpec, planFromSpec } from '../lib/remotion/content-spec.js'
import { getCard, registerCard } from '../lib/remotion/recipe-cards-all.js'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(here, '..')
const SPEC_SOURCE = join(workspaceRoot, 'src', 'remotion', 'content-spec.ts')
export const OUTPUT = join(workspaceRoot, 'skills', 'code-driven-explainer', 'references', 'spec-capability.generated.md')

// ── 探测脚手架 ──────────────────────────────────────────────

const REF = { x: 50, y: 50, w: 90, h: 40 }
const meta = { title: 'probe', width: 1080, height: 1920, fps: 30, durationSec: 6 }

/** 两屏最小 spec（探针基线）。 */
const twoScreens = (extra = {}) => ({
  meta,
  sections: [
    { id: 's1', label: '甲', card: 'A1', copy: '一句话', cell: REF },
    { id: 's2', label: '乙', card: 'A1', copy: '另一句', cell: REF },
  ],
  ...extra,
})

const plan = (spec) => planFromSpec(spec, 180)
const track = (spec, id) => plan(spec).tracks.find((item) => item.id === id)

/** 断言式探测：不成立就抛（生成器宁可不产出，也不发布假结论）。 */
function expect(cond, message) {
  if (!cond) throw new Error(`gen-spec-capability 探测失败：${message}`)
}

/**
 * `SpecCarry` 的字段表（AST 抽）—— 「carry 能放什么」的唯一机读事实。
 *
 * 为什么不从运行时读：interface 在编译后被抹掉，没有运行时读取面。
 * 为什么只抽这一个：边界问题里只有它需要逐字段列举（其余在探测里已有行为结论）。
 */
function carryFields() {
  const text = readFileSync(SPEC_SOURCE, 'utf8')
  const source = ts.createSourceFile(SPEC_SOURCE, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const node = source.statements.find((item) => ts.isInterfaceDeclaration(item) && item.name.getText(source) === 'SpecCarry')
  expect(node !== undefined, 'content-spec.ts 里找不到 interface SpecCarry（改名了？本表与文档同时失效）')
  return node.members.filter((member) => ts.isPropertySignature(member)).map((member) => {
    const name = member.name.getText(source).replace(/^['"]|['"]$/gu, '')
    return { name, optional: member.questionToken !== undefined }
  })
}

/** `carry` 的输出轨型 —— 决定「能不能放文字」。 */
function carryTrackType() {
  const spec = twoScreens({ carry: [{ id: 'band', box: { x: 50, y: 8, w: 60, h: 6 }, color: '#222222' }] })
  expect(validateContentSpec(spec).ok, '带 carry 的最小 spec 过不了校验')
  const out = track(spec, 'band')
  expect(out !== undefined, 'carry 没有产出任何轨（常驻层静默消失）')
  return out
}

/** 带 `text` 的 carry 会出什么轨？—— S-5 之前是 shape，之后应是 textCard。 */
function carryWithText() {
  const spec = twoScreens({
    carry: [{ id: 'band', box: { x: 50, y: 8, w: 60, h: 6 }, color: '#222222', text: '常驻文案' }],
  })
  return track(spec, 'band')
}

/** 多单元屏的屏级 chrome 归属。 */
function chromeOwnership() {
  const spec = {
    meta,
    sections: [{
      id: 's1',
      label: '甲',
      units: [
        { id: 'u1', card: 'A1', copy: '上一句', cell: { x: 50, y: 30, w: 90, h: 30 } },
        { id: 'u2', card: 'A1', copy: '下一句', cell: { x: 50, y: 70, w: 90, h: 30 } },
      ],
    }],
  }
  expect(validateContentSpec(spec).ok, '两单元最小 spec 过不了校验')
  const tracks = plan(spec).tracks
  const count = (suffix) => tracks.filter((item) => String(item.id).endsWith(suffix)).length
  return { base: count('-base'), eyebrow: count('-eyebrow'), total: tracks.length }
}

/** 单手写单元时 `section.label` 的渲染形态。 */
function eyebrowText() {
  const spec = twoScreens()
  const item = plan(spec).tracks.find((candidate) => String(candidate.id).endsWith('-eyebrow'))
  expect(item !== undefined, 'A1 没有眉标轨（eyebrow 改名了？）')
  return String(item.text)
}

/** 卡内 box 是否随 `cell` 等比缩放（= spec 能不能逐轨指定卡内 box）。 */
function innerBoxRatio() {
  const small = plan(twoScreens()).tracks.find((item) => String(item.id).endsWith('-title'))
  const spec = twoScreens()
  for (const section of spec.sections) section.cell = { x: 50, y: 50, w: 90, h: 80 }
  const big = plan(spec).tracks.find((item) => String(item.id).endsWith('-title'))
  expect(small !== undefined && big !== undefined, 'A1 没有标题轨')
  return {
    small: (small.box.h / REF.h).toFixed(2),
    big: (big.box.h / 80).toFixed(2),
  }
}

/**
 * D5：`data` 结构化数值通道探测 —— 临时注册一张消费 `ctx.data` 的探针卡
 * （进程内专用，注册前查重以支持本脚本被测试多次调用），验「透传 + 形状校验」两半。
 */
function dataChannelProbe(deps) {
  if (getCard('DAT99') === undefined) {
    registerCard({
      id: 'DAT99',
      title: 'data 通道探针卡（生成器临时注册）',
      assets: [],
      dataKeys: ['probeValue'],
      generate: (ctx) => [{
        id: `${ctx.segmentId}-dprobe`,
        type: 'textCard',
        variant: 'subtitle',
        text: `probe=${String(ctx.data?.probeValue ?? 'missing')}`,
        startFrame: ctx.startFrame,
        durationInFrames: ctx.durationInFrames,
        fadeFrames: 0,
      }],
    })
  }
  const spec = {
    meta,
    sections: [{ id: 's1', label: '甲', card: 'DAT99', copy: '探针', data: { probeValue: 9137 } }],
  }
  const check = deps.validateContentSpec(spec)
  expect(check.ok, `带 data 的最小 spec 过不了校验：${check.errors.join('；')}`)
  const hit = deps.planFromSpec(spec, 180).tracks.find((item) => String(item.text ?? '').includes('probe=9137'))
  expect(hit !== undefined, 'section.data 没有透传进卡产物（planFromSpec 丢了 data）')
  const badSpec = {
    meta,
    sections: [{ id: 's1', label: '甲', card: 'DAT99', copy: '探针', data: { probeValue: Number.NaN } }],
  }
  const bad = deps.validateContentSpec(badSpec)
  expect(!bad.ok && bad.errors.some((message) => message.includes('.data')), '坏 data（NaN）没被拒收')
  return { text: String(hit.text), rejected: true }
}

// ── 事实行 ─────────────────────────────────────────────────

function buildFacts(deps = { validateContentSpec, planFromSpec }) {
  const { validateContentSpec, planFromSpec } = deps
  const facts = []

  // 1) units 上限
  const band = (i) => ({ id: `u${i}`, card: 'A1', copy: `第${i}句`, cell: { x: 50, y: 12 + i * 24, w: 90, h: 22 } })
  const four = { meta, sections: [{ id: 's1', label: '甲', units: [0, 1, 2, 3].map(band) }] }
  const five = { meta, sections: [{ id: 's1', label: '甲', units: [0, 1, 2, 3, 4].map(band) }] }
  const fourOk = validateContentSpec(four).ok
  const fiveErrors = validateContentSpec(five).errors
  expect(fourOk, '4 个单元应通过校验')
  expect(fiveErrors.some((text) => text.includes('4 个单元')), '5 个单元应被拒收并点名上限')
  facts.push({
    capability: '一屏能放几个单元（`units`）',
    verdict: '**最多 4 个**，第 5 个直接被拒收（不是警告）',
    evidence: '探测：4 个通过 / 5 个拒收，错误原文「units 最多 4 个单元」',
  })

  // 2) carry 轨型
  const carry = carryTrackType()
  facts.push({
    capability: '`carry`（跨屏常驻层）不带 `text` 时画什么',
    verdict: `**形状底板**：输出 \`type: "shape"\` / \`shape: "rect"\`（颜色 + 圆角），只承受"一条色块"，没有描边字段`,
    evidence: `探测：不带 text 的 carry 出轨 ${JSON.stringify({ type: carry.type, shape: carry.shape })}`,
  })

  // 3) carry + text
  const withText = carryWithText()
  // 文字层专属字段 = SpecCarry 全部字段 − 形状层基线字段（新增字段自动进这一句，不用改文档）
  const SHAPE_BASELINE = new Set(['id', 'box', 'color', 'radius', 'fromSection', 'toSection'])
  const textOnlyFields = carryFields().map((field) => field.name).filter((name) => !SHAPE_BASELINE.has(name))
  facts.push({
    capability: '`carry` 里写 `text` 会怎样',
    verdict: withText !== undefined && withText.type === 'textCard'
      ? `**出文字轨**（\`type: "textCard"\`，\`fadeFrames\` 0）—— 常驻文字层，可配 ${textOnlyFields.filter((name) => name !== 'text').map((name) => `\`${name}\``).join(' / ')}`
      : '**被忽略**（仍出 `shape`）—— 要放固定文字只能改用第 3 个单元',
    evidence: withText === undefined
      ? '探测：带 text 的 carry 没有产出轨'
      : `探测：带 text 的 carry 出轨 type=${String(withText.type)}${withText.variant === undefined ? '' : ` / variant=${String(withText.variant)}`}`,
  })

  // 4) carry 时间窗
  const window = twoScreens({ carry: [{ id: 'band', box: { x: 50, y: 8, w: 60, h: 6 }, color: '#222222', fromSection: 's2' }] })
  const windowTrack = track(window, 'band')
  expect(windowTrack !== undefined, 'carry 时间窗探针没有出轨')
  facts.push({
    capability: '`carry` 的时间窗',
    verdict: '`fromSection..toSection` **并集铺满**（缺省 = 首屏到末屏），`fadeFrames` **恒为 0**',
    evidence: `探测：\`fromSection: "s2"\` 的 carry → startFrame ${String(windowTrack.startFrame)} / durationInFrames ${String(windowTrack.durationInFrames)} / fadeFrames ${String(windowTrack.fadeFrames)}`,
  })

  // 5) carry 指向不存在的屏
  const bad = twoScreens({ carry: [{ id: 'band', box: { x: 50, y: 8, w: 60, h: 6 }, color: '#222222', fromSection: '不存在' }] })
  const badCheck = validateContentSpec(bad)
  expect(badCheck.ok === false && badCheck.errors.some((text) => text.includes('不存在的屏')), 'carry 指向不存在的屏应被拒收')
  facts.push({
    capability: '`carry.fromSection` 写错屏 id',
    verdict: '**拒收**（`指向不存在的屏`），不会静默退化成「全片」',
    evidence: '探测：`fromSection: "不存在"` → 校验失败',
  })

  // 6) 多单元 chrome
  const chrome = chromeOwnership()
  expect(chrome.base === 1 && chrome.eyebrow === 1, `多单元屏应只出 1 块底板 + 1 个眉标，实测 base=${chrome.base} eyebrow=${chrome.eyebrow}`)
  facts.push({
    capability: '多单元屏的屏级 chrome（底板 / 眉标 / 点阵 / 光晕）',
    verdict: '**只首单元出**且不投影进各单元格位（否则第二格位会露出 `#111827` 全屏底色）',
    evidence: `探测：两单元屏共 ${chrome.total} 轨，其中 \`-base\` ${chrome.base} 条 / \`-eyebrow\` ${chrome.eyebrow} 条`,
  })

  // 7) 眉标形态
  const eyebrow = eyebrowText()
  expect(/^\d{2} \/ \d{2} · 甲$/u.test(eyebrow), `眉标形态变了：${eyebrow}`)
  facts.push({
    capability: '`section.label` 怎么上屏',
    verdict: '渲染为眉标 `${两位序号} / ${总屏数} · ${label}`，**不能自由排版**（位置与字号由卡决定）',
    evidence: `探测：label「甲」→ \`${eyebrow}\``,
  })

  // 8) 卡内 box
  const ratio = innerBoxRatio()
  expect(ratio.small === ratio.big, `卡内 box 比例不再固定（${ratio.small} vs ${ratio.big}）—— 本行结论失效，需改写`)
  facts.push({
    capability: '能否逐轨指定**卡内** box（标题占卡高多少）',
    verdict: `不能。卡内 box 是卡自己的百分比（A1 标题恒占卡高 ${Number(ratio.small) * 100}%），spec 只能缩放整个 \`cell\``,
    evidence: `探测：cell.h 40 → 80，标题轨高度占 cell 的比例不变（${ratio.small} / ${ratio.big}）`,
  })

  // 9) D5：data 结构化数值通道
  const data = dataChannelProbe({ validateContentSpec, planFromSpec })
  facts.push({
    capability: '`data`（D5 结构化数值）怎么进卡',
    verdict: '**透传进卡的 `ctx.data`**（单元级覆盖屏级）；形状校验收在 spec 侧 —— 键空 / 非有限数 / 字符串超 200 字符直接拒收',
    evidence: `探测：section.data { probeValue: 9137 } → 产物 \`${data.text}\`；NaN 值 → ${data.rejected ? '拒收（错误含 `.data`）' : '未拒收'}`,
  })

  return facts
}

// ── 判断行（手写；机器判不了，但每条都引用上面的实测） ──

const JUDGEMENTS = [
  {
    gap: '大号线性图标（锚、手机、网络节点）',
    fallback: '用素材图走 `E1` / `C2` 的图槽，或用 `shape: "path"` 手写一条简单 path（复杂图标写不对，别硬写）',
    ref: '表外事实：没有图标系统（卡与 manifest 都只有 shape / 素材图两条路）',
  },
  {
    gap: '卡片的细描边 / 内阴影 / 双层边框',
    fallback: '卡内视觉由卡决定，spec 改不了；要「极细边框」的观感就换一张本来就带边框的卡，或整体换风格 skill',
    ref: '能否逐轨指定卡内 box',
  },
  {
    gap: '逐单元字号（同一屏里标题 90px、注释 30px）',
    fallback: '字号由 variant + 卡内 box + 盒高共同决定；要大小对比就用**不同 variant 的卡**（`A1` 大标题 + `TYP6` 降格标签）',
    ref: '能否逐轨指定卡内 box',
  },
  {
    gap: '每屏 5 个以上独立视觉元素',
    fallback: '上限是 4 个单元；把「左上角小字 / 右上角标签」这类**跨屏固定**的东西收进 `carry`，或干脆交给眉标',
    ref: '一屏能放几个单元',
  },
  {
    gap: '跨屏固定文字（每屏同一个角标）',
    fallback: '`carry` 一条铺满全片（时间窗缺省即全片）；两段不同文本就写两条 carry 各管一半屏',
    ref: '`carry` 里写 text 会怎样',
  },
  {
    gap: '竖屏的宽扁卡片（参考片 900×420 那种长宽比）',
    fallback: '卡内 box 按 16:9 写死，投影进竖屏格位后近方；这是设计工程，不在本轮 —— 先按方形交付，别为此改渲染层',
    ref: '能否逐轨指定卡内 box',
  },
]

/** 生成整份文档。 */
export function renderSpecCapability(deps) {
  const facts = buildFacts(deps)
  const fields = carryFields()
  const lines = [
    '<!-- 机器生成：node scripts/gen-spec-capability.mjs；请勿手改（结论由探测得出，探测失败脚本会直接抛） -->',
    '',
    '# 表达力边界（能做什么 / 做不到什么）',
    '',
    '> **回答「这个设计能不能表达」只看本表**，不要去读 `src/remotion/**` ——',
    '> 下表的每条结论都是跑 `validateContentSpec` / `planFromSpec` **实测**出来的，源码里的注释不是规格。',
    '> 表里没有的能力 ≠ 一定做不到；但**表里说「不能」的，就是真的不能**，再 grep 十遍也不会出现。',
    '',
    '## 1. 能 / 不能（实测）',
    '',
    '| 能力 | 结论 | 怎么验的 |',
    '|---|---|---|',
    ...facts.map((fact) => `| ${fact.capability} | ${fact.verdict} | ${fact.evidence} |`),
    '',
    '## 2. `SpecCarry` 的全部字段（唯一机读来源）',
    '',
    `共 ${fields.length} 个字段 —— **这就是常驻层能承载的全部**：`,
    '',
    `\`${fields.map((field) => `${field.name}${field.optional ? '?' : ''}`).join(' · ')}\``,
    '',
  ]
  lines.push('## 3. 常见「做不到」清单与替代做法', '')
  lines.push('| 想要的 | 替代做法 | 依据（上表哪一行） |')
  lines.push('|---|---|---|')
  for (const item of JUDGEMENTS) lines.push(`| ${item.gap} | ${item.fallback} | ${item.ref} |`)
  lines.push('')
  lines.push('## 4. 撞到「做不到」时的唯一合法路径（三级降级）', '')
  lines.push('1. **加单元**（上限 4 —— 用户说「2 个单元」往往是下限不是上限）：一个单元一张卡，能解决绝大多数「还要多一块东西」。')
  lines.push('2. **用 `carry`**：跨屏不变的东西（左上角固定文案、分组标签、框线）放常驻层，不占单元。')
  lines.push('3. **仍不行 → `write_note` 记一句**「这条做不到：<原因>，替代方案：<方案>」，**然后继续出片**。')
  lines.push('')
  lines.push('> 第 3 级是**明确允许**的，不是失败：把缺口记下来继续出片，比停在原地推演 45 分钟有用。')
  lines.push('> 真机会话的教训就是「只写了禁止、没写替代」⇒ 模型在红线前原地打转（复盘文档 §2.1 第四层）。')
  lines.push('')
  return lines.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-spec-capability.mjs')
if (invokedDirectly) {
  const generated = renderSpecCapability()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-spec-capability: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-spec-capability.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-spec-capability: 能力表与实测行为不一致（改了校验规则 / carry 语义但没重跑本脚本）。')
      console.error('修法：yarn build && node scripts/gen-spec-capability.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-spec-capability: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-spec-capability: 已写入 ${OUTPUT}（${Buffer.byteLength(generated)} 字节）`)
  }
}
