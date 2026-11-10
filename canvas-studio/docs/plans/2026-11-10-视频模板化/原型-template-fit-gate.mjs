// 模板适配度闸门（装配前的内容级判据）
//
// ## 为什么需要它
//
// `compile()` 只判格式。`原型-llm-fill-test.mjs` 实测出两类**格式合法但结果错误**：
//
//   p5  用户说了 4 条要点，模板只有 3 张卡 ⇒ 第 4 条被**静默丢弃**，compile 返回 ok=true
//   p6  用户只说了一句话，模板强制 10 个槽位 ⇒ 其余 9 个值全是为了过校验**编造**的
//
// 这两件事靠提示词治不住（模型的失败模式是可预见的：宁可硬套也不肯说"这模板不合适"）。
// 所以必须做成**机器判据**，在填槽之前就把不适配的模板挡掉。
//
// ## 两条判据（都能离线算，不依赖模型）
//
// A. **条目数匹配**：用户原话里列举了 N 条，模板有 M 个条目位，N > M ⇒ 拒绝。
// B. **信息充足度**：用户原话总字数 / 模板必填槽位总容量 < 阈值 ⇒ 拒绝（否则必然注水）。
//
// ## 误判方向（有意保守）
//
// 判据 A 会把"第一次""第二步"这类非列举的序数词也算进去 ⇒ 偶尔多算。
// 这是**有意选择**：多问一句的成本，远低于静默丢内容后用户发现"我说的第四点没讲"。
//
// 跑法：node 原型-template-fit-gate.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { displayLen, loadTemplate } from './原型-audit-text-fit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 信息充足度阈值：用户内容字数 / 必填槽位总容量 低于它 ⇒ 判"内容不足"。 */
export const INFO_SUFFICIENCY_MIN = 0.35

const CN_NUM = '一二三四五六七八九十'

/**
 * 数用户原话里"列举了几条"。
 *
 * 三种常见中英文列举法各扫一遍，取最大值：
 *   第一/第二/… ｜ 一是/二是/… ｜ ①②③ ｜ 1. 2. 3.
 */
export function countItems(brief) {
  const text = String(brief)
  const found = new Set()

  // 「第一」「第二」…（也覆盖「第一步」「第一点」「第一是」）
  for (const m of text.matchAll(new RegExp(`第([${CN_NUM}])`, 'g'))) found.add(`第${m[1]}`)
  // 「一是」「二是」…（负向后视排除「第一是」里的「一是」——
  // 否则同一处会被上面和这里各数一次，p3 会从 3 条翻成 6 条，实测踩到）
  for (const m of text.matchAll(new RegExp(`(?<!第)([${CN_NUM}])(?:是|则|来)`, 'g'))) found.add(`第${m[1]}是`)
  // 圈号 ①②③
  for (const m of text.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩]/g)) found.add(m[0])
  // 行首阿拉伯数字列表 1. / 2) / 3、
  for (const m of text.matchAll(/^[ \t]*(\d{1,2})[.、)）]/gm)) found.add(`#${m[1]}`)

  return found.size
}

/** 模板有几个"条目位"—— 从槽位 id 的 `cardN.xxx` 提取，返回卡片数。 */
export function countItemSlots(slotsDoc) {
  const indexes = new Set()
  for (const s of slotsDoc.slots ?? []) {
    const m = /^card(\d+)\./.exec(s.id)
    if (m) indexes.add(Number(m[1]))
  }
  return indexes.size
}

/** 必填槽位的容量总和（= 不注水需要的最少内容量）。 */
export function requiredCapacity(slotsDoc) {
  return (slotsDoc.slots ?? [])
    .filter((s) => s.required === true)
    .reduce((n, s) => n + (Number.isFinite(s.maxChars) ? s.maxChars : 0), 0)
}

/**
 * 判断一段用户需求能否套这个模板。
 *
 * @param options.disableItems 关掉条目数判据（**仅供反向变异验证**：关掉后 p5 应误判为放行）
 * @param options.disableInfo  关掉信息充足度判据（同上：p6 应误判为放行）
 * @returns {{ok:boolean, items:number, itemSlots:number, briefChars:number,
 *            capacity:number, ratio:number, reasons:string[]}}
 */
export function gateTemplate(brief, slotsDoc, options = {}) {
  const reasons = []
  const items = countItems(brief)
  const itemSlots = countItemSlots(slotsDoc)
  const briefChars = displayLen(brief)
  const capacity = requiredCapacity(slotsDoc)
  const ratio = capacity > 0 ? briefChars / capacity : 1

  if (options.disableItems !== true && items > 0 && itemSlots > 0 && items > itemSlots) {
    reasons.push(
      `条目数不匹配：用户列举了 ${items} 条，模板只有 ${itemSlots} 个条目位`
        + ` ⇒ 多出的 ${items - itemSlots} 条会被静默丢弃。`
        + `处理：合并到 ${itemSlots} 条，或改用条目位更多的模板。`,
    )
  }

  if (options.disableInfo !== true && ratio < INFO_SUFFICIENCY_MIN) {
    reasons.push(
      `内容不足：用户原话 ${briefChars} 字，模板必填槽位总容量 ${capacity} 字`
        + `（占比 ${(ratio * 100).toFixed(0)}% < ${Math.round(INFO_SUFFICIENCY_MIN * 100)}%）`
        + ` ⇒ 强行套模板必然注水编造。处理：先补素材，或改自由编排。`,
    )
  }

  return { ok: reasons.length === 0, items, itemSlots, briefChars, capacity, ratio, reasons }
}

// ─────────────────────────────────────────────────────────────
// CLI：回跑 6 个用例，看闸门能否抓住 compile 抓不到的两个
// ─────────────────────────────────────────────────────────────
function run(briefs, slotsDoc, options = {}) {
  const results = []
  let failures = 0
  for (const [label, brief] of briefs) {
    const g = gateTemplate(brief, slotsDoc, options)
    const shouldReject = label.includes('★')
    const correct = g.ok !== shouldReject
    if (!correct) failures += 1
    results.push({ label, g, correct })
  }
  return { results, failures }
}

async function main() {
  const { slotsDoc } = loadTemplate(path.join(HERE, '原型-template-b1b2'))
  const briefs = [
    ['p1 产品介绍（应放行）', '我们做了一个给中小团队用的项目管理工具，主要是把任务、文档和进度放在一个页面里，不用来回切换。团队再小也能一眼看到谁在做什么。现在上线三个月，有 200 个团队在用。'],
    ['p2 知识科普（应放行）', '为什么飞机能飞起来？不是靠发动机把飞机吹上去的，主要是机翼形状让空气流速不同，上面快下面慢，产生压力差，这个压力差就是升力。发动机提供的是向前的速度，让升力足够大。'],
    ['p3 工作汇报（应放行，只超字数）', '这个季度我们复盘了三件事。第一是发现用户最在意的不是功能多少，而是上手快不快，所以我们砍掉了两个功能；第二是把新手引导从五步改成两步，转化率提升了百分之三十七；第三是下个季度重点做协作能力。'],
    ['p4 技术分享（应放行）', 'PostgreSQL 16 的 logical replication 支持双向同步，配合 pg_stat_replication 可以监控跨区域复制延迟，我们实测把法兰克福到新加坡的延迟从 800 毫秒压到了 120 毫秒。'],
    ['p5 四条要点（★应拒绝）', '这次改版我们做了四件事：第一是首页信息架构重排，第二是把搜索放到全局导航，第三是统一了按钮规范，第四是重写了所有错误提示文案。'],
    ['p6 需求极短（★应拒绝）', '帮我做个视频，介绍我们的新 logo。'],
  ]

  console.log('='.repeat(78))
  console.log('模板适配度闸门：能否抓住 compile 抓不到的两个缺口')
  console.log('='.repeat(78))
  console.log(`模板：${slotsDoc.templateId}　条目位 ${countItemSlots(slotsDoc)} 个　必填总容量 ${requiredCapacity(slotsDoc)} 字`)
  console.log('')
  console.log('用例                              条目  内容/容量    占比   判定')
  const { results, failures } = run(briefs, slotsDoc)
  for (const { label, g, correct } of results) {
    console.log(
      `  ${label.padEnd(30)} ${String(g.items).padStart(2)}/${g.itemSlots}  `
      + `${String(g.briefChars).padStart(5)}/${String(g.capacity).padStart(4)}  `
      + `${(g.ratio * 100).toFixed(0).padStart(3)}%  ${g.ok ? '放行' : '拒绝'}${correct ? '' : '  ✗ 判错'}`,
    )
    for (const r of g.reasons) console.log(`      · ${r}`)
  }
  console.log('')
  console.log(failures === 0
    ? '✓ 6/6 判定正确：两条 compile 抓不到的缺口已被闸门拦住'
    : `✗ ${failures} 个用例判错`)

  // ── 反向变异：关掉任一条判据，必须有用例变红，否则说明判据是空转的 ──
  console.log('')
  console.log('反向变异验证（守卫必须能变红）：')
  const mutItems = run(briefs, slotsDoc, { disableItems: true })
  const mutInfo = run(briefs, slotsDoc, { disableInfo: true })
  const m1 = mutItems.failures > 0
  const m2 = mutInfo.failures > 0
  console.log(`  关掉「条目数」判据 → ${m1 ? `变红 ${mutItems.failures} 个 ✓（p5 被误放行）` : '仍然全绿 ✗ 该判据没起作用'}`)
  console.log(`  关掉「信息充足度」判据 → ${m2 ? `变红 ${mutInfo.failures} 个 ✓（p6 被误放行）` : '仍然全绿 ✗ 该判据没起作用'}`)
  const mutantsOk = m1 && m2
  console.log('')
  console.log(mutantsOk && failures === 0 ? '总判定：通过 ✓' : '总判定：失败 ✗')
  process.exitCode = failures === 0 && mutantsOk ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
