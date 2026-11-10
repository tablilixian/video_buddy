// 「LLM 能否按合同填参」验证
//
// ## 为什么必须做这一项
//
// 模板方案的全部价值前提是：**LLM 只读 `slots.json` 的 id + label + maxChars + maxLines
// + usage，就能把一段用户原话改写成合格的槽位值。**
// 如果它填不对，模板只是把「试结构」换成「试文案」，省时效果大打折扣。
//
// ## 做法（尽量诚实）
//
// 6 段真实用户原话，覆盖三种正常体裁 + 三种边界（超长术语、条目数不匹配、需求极短）。
// 每个 case 的 `values` 是**第一次尝试**（v1），刻意不做"预先适配"——
// 填写的心理状态是"按语义完整优先，别丢信息"，这正是真实 LLM 的行为。
//
// 填写时**没有参考 `example` 字段**（那是 6–8 字的短句，对"15 字槽位怎么压"没有指导性）。
//
// ## 关键：机器判定 vs 人工判定
//
// `compile()` 只能判**格式**（超字数、超行数、缺必填、未知槽位）。
// 它判不了两件事：① 内容是否被**静默丢弃**；② 内容不足时是否**编造**。
// 这两个缺口就是本测试最重要的产出 —— 它们决定模板通道必须补哪几条判据。
//
// 跑法：node 原型-llm-fill-test.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '../../../lib/remotion')
const { validateManifest } = await import(`${LIB}/manifest.js`)
const { createCompiler } = await import('./原型-compile-core.mjs')
const { loadTemplate } = await import('./原型-audit-text-fit.mjs')

const { manifest, slotsDoc } = loadTemplate(path.join(HERE, '原型-template-b1b2'))
const { compile } = createCompiler({ manifest, slotsDoc, validateManifest })

// ─────────────────────────────────────────────────────────────
// 6 个用例
//
// verdict 是**人工**判定（机器判不出来），用于和 compile 的结论对照：
//   pass    内容完整、格式合格
//   over    格式被拦（超字数/超行数）
//   loss    **格式通过但用户明确说的内容被丢了**
//   invent  **格式通过但内容是为了填满槽位编出来的**
// ─────────────────────────────────────────────────────────────
const CASES = [
  {
    id: 'p1',
    genre: '产品介绍',
    brief:
      '我们做了一个给中小团队用的项目管理工具，主要是把任务、文档和进度放在一个页面里，不用来回切换。团队再小也能一眼看到谁在做什么。现在上线三个月，有 200 个团队在用。',
    verdict: 'pass',
    values: {
      badge: '项目管理',
      keyword: '一屏管好团队',
      body: '把任务、文档和进度放在一个页面\n不用来回切换',
      heading: '三个好处',
      'card1.no': '01',
      'card1.text': '任务文档进度同屏',
      'card2.no': '02',
      'card2.text': '一眼看到谁在做什么',
      'card3.no': '03',
      'card3.text': '三个月两百个团队在用',
    },
  },
  {
    id: 'p2',
    genre: '知识科普',
    brief:
      '为什么飞机能飞起来？不是靠发动机把飞机吹上去的，主要是机翼形状让空气流速不同，上面快下面慢，产生压力差，这个压力差就是升力。发动机提供的是向前的速度，让升力足够大。',
    verdict: 'pass',
    values: {
      badge: '科学问答',
      keyword: '飞机为什么能飞',
      body: '关键不是发动机\n而是机翼上下的压力差',
      heading: '两个条件',
      'card1.no': '01',
      'card1.text': '机翼形状产生压力差',
      'card2.no': '02',
      'card2.text': '发动机提供向前速度',
      'card3.no': '03',
      'card3.text': '速度够大升力才够',
    },
  },
  {
    id: 'p3',
    genre: '工作汇报',
    brief:
      '这个季度我们复盘了三件事。第一是发现用户最在意的不是功能多少，而是上手快不快，所以我们砍掉了两个功能；第二是把新手引导从五步改成两步，转化率提升了百分之三十七；第三是下个季度重点做协作能力。',
    verdict: 'over', // keyword 8 字 > 7
    values: {
      badge: '季度复盘',
      keyword: '砍功能换上手速度', // 8 字，超 1
      body: '用户在意的是上手快不快\n不是功能数量',
      heading: '三件事',
      'card1.no': '01',
      'card1.text': '砍掉两个次要功能',
      'card2.no': '02',
      'card2.text': '引导从五步改两步',
      'card3.no': '03',
      'card3.text': '转化率提升百分之三十七',
    },
  },
  {
    id: 'p4',
    genre: '技术分享（含英文术语与数字）',
    brief:
      'PostgreSQL 16 的 logical replication 支持双向同步，配合 pg_stat_replication 可以监控跨区域复制延迟，我们实测把法兰克福到新加坡的延迟从 800 毫秒压到了 120 毫秒。',
    verdict: 'pass', // 半角算 0.5 ⇒ 英文术语占宽比直觉小
    values: {
      badge: '技术分享',
      keyword: '跨区域复制延迟',
      body: 'PG16 支持双向同步\n延迟从 800ms 压到 120ms',
      heading: '两个改进',
      'card1.no': '01',
      'card1.text': '支持双向同步',
      'card2.no': '02',
      'card2.text': '延迟压到 120ms',
      'card3.no': '03',
      'card3.text': '跨区延迟可监控',
    },
  },
  {
    id: 'p5',
    genre: '条目数不匹配（用户说 4 条，模板只有 3 卡）',
    brief:
      '这次改版我们做了四件事：第一是首页信息架构重排，第二是把搜索放到全局导航，第三是统一了按钮规范，第四是重写了所有错误提示文案。',
    // ★ 这是本测试最重要的一条：格式完全合法，但「第四件事」被丢掉了，
    //   而 compile() 会返回 ok=true —— 机器看不见内容丢失。
    verdict: 'loss',
    lostContent: '重写所有错误提示文案',
    values: {
      badge: '改版复盘',
      keyword: '四件事都做完了', // 8 字？见下方诊断 —— 这里先按 6 字写
      body: '信息架构、导航、规范\n还有全部提示文案',
      heading: '四件事',
      'card1.no': '01',
      'card1.text': '首页信息架构重排',
      'card2.no': '02',
      'card2.text': '搜索提升到全局导航',
      'card3.no': '03',
      'card3.text': '统一按钮规范',
      // ← 第四件事「重写错误提示文案」没有槽位可放，被我静默丢弃
    },
  },
  {
    id: 'p6',
    genre: '需求极短（内容不足以填满 10 个槽位）',
    brief: '帮我做个视频，介绍我们的新 logo。',
    // ★ 第二条缺口：模板强制 11 个值（多数 required），内容只有一句话 ⇒
    //   为了通过校验，只能**编造**。格式合法，但每一句都是无中生有。
    verdict: 'invent',
    values: {
      badge: '品牌更新',
      keyword: '全新标识',
      body: '一个更简洁的形态\n延续原有气质',
      heading: '三个变化',
      'card1.no': '01',
      'card1.text': '线条更加凝练',
      'card2.no': '02',
      'card2.text': '配色更有活力',
      'card3.no': '03',
      'card3.text': '识别度更高',
    },
  },
]

// ─────────────────────────────────────────────────────────────
// 跑
// ─────────────────────────────────────────────────────────────
const line = (s = '') => console.log(s)
line('='.repeat(78))
line('LLM 填参验证：只读 slots.json 的 usage 能不能填对')
line('='.repeat(78))
line(`模板：motiongit-kinetic-b1b2（${slotsDoc.slots.length} 槽位 / ${manifest.tracks.length} 轨）`)
line('')

const rows = []
for (const c of CASES) {
  const r = compile(c.values)
  const machine = r.ok ? 'ok' : 'blocked'
  // 机器说 ok、人工说 loss/invent ⇒ 这就是缺口
  const gap = r.ok && (c.verdict === 'loss' || c.verdict === 'invent') ? 'GAP' : ''
  rows.push({ id: c.id, genre: c.genre, verdict: c.verdict, machine, gap, errors: r.errors })

  line(`── ${c.id}　${c.genre}`)
  line(`   compile: ok=${r.ok}  errors=${r.errors.length}  warnings=${r.warnings.length}`)
  for (const e of r.errors) line(`     ✗ ${e}`)
  line(`   人工判定: ${c.verdict}${gap === 'GAP' ? '　★ 机器看不见' : ''}`)
  if (c.lostContent !== undefined) line(`   被丢弃的内容：「${c.lostContent}」`)
  if (c.verdict === 'invent') line('   问题：用户只给了一句话，其余 9 个值全是为了过校验编出来的')
  line('')
}

line('='.repeat(78))
line('汇总')
line('='.repeat(78))
line('用例  体裁                                机器   人工    一致?')
for (const r of rows) {
  const consistent = (r.machine === 'ok') === (r.verdict === 'pass')
  line(`  ${r.id.padEnd(4)} ${r.genre.padEnd(34)} ${r.machine.padEnd(8)} ${r.verdict.padEnd(7)} ${consistent ? '一致' : '★ 不一致'}`)
}

const passCount = CASES.filter((c) => c.verdict === 'pass').length
const overCount = CASES.filter((c) => c.verdict === 'over').length
const gaps = rows.filter((r) => r.gap === 'GAP').length
line('')
line(`  一次过：${passCount} / ${CASES.length}`)
line(`  格式被拦（compile 正确拦住）：${overCount}`)
line(`  机器判 ok 但实际有问题：${gaps}　← **这是真正的缺口**`)
line('')
line('结论：compile() 只判格式。它拦得住"超字数"，拦不住两件事：')
line('  ① 用户说了 N 条、模板只有 M 个槽位（M < N）⇒ 内容被静默丢弃；')
line('  ② 内容不足以填满必填槽位 ⇒ LLM 编造。')
line('两者都必须靠**装配前的内容级判据**拦，不能指望模型自觉。')

process.exitCode = gaps > 0 ? 0 : 1 // 本测试的目的是"发现缺口"，缺口存在才算通过
