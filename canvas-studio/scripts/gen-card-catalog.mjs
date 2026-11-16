/**
 * 从**注册表**机器生成 58 张卡的目录（S-1）。
 *
 * ## 抓的是什么浪费
 *
 * 2026-11-16 第二轮真机会话（session 2a475a33）53 分钟零产物，其中 48 次 bash 里
 * **约 14 次在枚举卡**（`grep -rhn "id: '" src/remotion/recipe-cards*.ts`、
 * 逐个数 assets），`recipe-cards*.ts` 被命中 **11 次**。原因是
 * `references/shot-cards.md` 里 24 个编号只有 7 个是真实卡号 —— 模型查不到卡，
 * 只能回源码枚举。
 *
 * ## 口径（为什么这么抽）
 *
 * 目录里的每一列都是**跑出来的**，不是读注释抄的：
 *
 * 1. `id` / 卡名 / `assets` —— 直接来自注册表（`registeredCardIds` / `getCard`）。
 * 2. **主体 box** —— 用 mock ctx 真跑一次 `generate()`，取「非全屏、非装饰细线、
 *    面积最大」那条轨的 box。模型要的就是「这张卡的内容放在哪、多大」，而这
 *    只能从产物里看出来（卡内 box 是生成器内部常量，没有别的读取面）。
 * 3. **copy / label 用法** —— 见 `probeSlotUsage()`：分四组候选分隔符各跑一次
 *    `generate()`，看产物里到底出现了几个哨兵段，据此判定「多行 / 键:值 / 首段 /
 *    不用」。**不猜语法**：猜错就是「假信息」，而假信息会让模型判定文档不可信
 *    （这正是本轮信任崩塌的机制，见复盘文档 §2.3）。
 *
 * ## 用法
 *
 *   node scripts/gen-card-catalog.mjs           # 重写生成物
 *   node scripts/gen-card-catalog.mjs --check   # 只比对，不一致退出 1
 *
 * 生成物：`skills/code-driven-explainer/references/card-catalog.generated.md`
 *
 * ⚠️ 本脚本 **import `lib/`（tsc 产物）而不是 `src/`**：卡注册表是模块加载期副作用
 * 注册的，没有源码级读取面。所以它必须在 `yarn build` 之后跑 —— `yarn check` 里
 * 的顺序已经是 build → gen:card-catalog --check。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registeredCardIds, getCard } from '../lib/remotion/recipe-cards-all.js'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(here, '..')
export const OUTPUT = join(workspaceRoot, 'skills', 'code-driven-explainer', 'references', 'card-catalog.generated.md')

/**
 * 类目（按卡号前缀）。`A` / `B` / `C` / `E` 是单字母类目，其余是三位前缀。
 *
 * 新增类目前缀而没登记 ⇒ 生成器直接抛（见 `categoryOf`）—— 否则新卡会静默落进
 * 「其它」分组，模型按类目找卡就找不到。
 */
const CATEGORIES = [
  ['A', '标题 / 收尾（整屏一句话）'],
  ['B', '数据卡（大数字 / 指标组）'],
  ['C', '版式容器（图文分栏）'],
  ['E', '素材编排（图片 / 视频为主体）'],
  ['CAM', '相机运动（素材运动学）'],
  ['DAT', '图表与数据可视化'],
  ['FX', '视觉特效（扫描 / 冲击 / 光效）'],
  ['INT', '界面交互（光标 / 面板 / 筛选）'],
  ['OPN', '开场（品牌 / 主题引入）'],
  ['OUT', '收尾落版'],
  ['P', '产品 / 品牌（logo 墙 / 芯片条 / 代码面板）'],
  ['RHY', '节奏（闪切 / 变速 / 分屏）'],
  ['TRN', '转场'],
  ['TYP', '字体表现（排版本身是主角）'],
  ['UI', 'UI 界面（App / 网页内部）'],
]

/** 卡号 → 类目前缀（长前缀优先，`CAM1` 不能被 `C` 抢走）。 */
function categoryOf(id) {
  const prefixes = CATEGORIES.map(([prefix]) => prefix).sort((a, b) => b.length - a.length)
  for (const prefix of prefixes) {
    if (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))) return prefix
  }
  throw new Error(`卡号 ${id} 的类目前缀没有登记（scripts/gen-card-catalog.mjs 的 CATEGORIES）——`
    + '新类目必须登记中文名，否则它会在目录里静默失踪')
}

/** 素材种类 → 单字（列宽紧张，一列放下）。 */
const KIND_SHORT = { logo: '标', image: '图', audio: '音', font: '字', ui: '面' }

/** 素材列：`—` = 零素材；否则「数量 + 种类」，有必填项加 `!`。 */
function assetCell(assets) {
  if (assets.length === 0) return '—'
  const kinds = [...new Set(assets.map((decl) => KIND_SHORT[decl.kind] ?? '?'))].join('')
  const required = assets.some((decl) => decl.required === true) ? '!' : ''
  return `${assets.length}${kinds}${required}`
}

/** mock ctx：素材槽位一律给同源 URL（走主路径，不是降级版式）。 */
function mockCtx(card, copy, label) {
  const slots = Object.fromEntries(card.assets.map((decl) => [decl.slot, '/canvas-studio/assets/demo/shot.png']))
  return {
    segmentId: 'p',
    label,
    copy,
    startFrame: 0,
    durationInFrames: 120,
    index: 0,
    sectionCount: 1,
    assetSrc: (slot) => slots[slot],
    accentColor: '#4f9cf9',
    unitIndex: 0,
    unitCount: 1,
    dataSource: 'observed',
  }
}

const safeGenerate = (card, copy, label) => {
  try {
    return card.generate(mockCtx(card, copy, label))
  } catch {
    return []
  }
}

/**
 * 判 slot（copy / label）的用法：逐组候选跑一遍，看哨兵段出现在产物里的个数。
 *
 * 返回 `{ mode, shape }`：
 * - `mode: 'multi'` 多段都被用上；`shape` 说明分隔符与「值是否二次拆分」
 * - `mode: 'single'` 只用了首段
 * - `mode: 'none'` 完全不影响画面
 *
 * 三个易踩的坑（都是实测踩过的，写在这里免得下一个人重新踩）：
 * 1. **逐字卡会把字符用空格隔开**（`OPN3` 的 `chars.join(' ')`）⇒ 匹配前必须
 *    去掉空白，否则「丁丁」在产物里是「丁 丁」，探针会误判成「不用」。
 * 2. **有的卡要数值**（`DAT1` 的角度是 `Number()` 转的，非数字直接落 0 且不显字）
 *    ⇒ 候选里必须有一组纯数字，否则同样误判成「不用」。
 * 3. 段的「完整性」判定要按**整段原文**匹配：`甲甲：11` 原样出现说明值没被单独
 *    取用（只是整行当一句）；拆开才说明是键值语法。
 */
function probeSlotUsage(card, slot) {
  const isCopy = slot === 'copy'
  const other = isCopy ? '丁丁' : '甲甲'
  /** 每项：{ shape, probe, heads, separatedBy } —— heads 是「出现几个就算几段」的哨兵。 */
  const candidates = isCopy
    ? [
      { shape: '多行', probe: '甲甲：11\n乙乙：22\n丙丙：33', heads: ['甲甲', '乙乙', '丙丙'], split: '键:值' },
      { shape: '数,数', probe: '15,11\n150,22\n270,33', heads: ['11', '22', '33'], split: '数,数' },
      { shape: '单行', probe: '甲甲', heads: ['甲甲'], split: null },
    ]
    : [
      { shape: '多行', probe: '丁丁\n戊戊\n己己', heads: ['丁丁', '戊戊', '己己'], split: '多行' },
      { shape: '值|值', probe: '丁丁|戊戊|己己', heads: ['丁丁', '戊戊', '己己'], split: '值|值' },
      { shape: '单行', probe: '丁丁', heads: ['丁丁'], split: null },
    ]

  for (const candidate of candidates) {
    const tracks = safeGenerate(card, isCopy ? candidate.probe : other, isCopy ? other : candidate.probe)
    if (tracks.length === 0) continue
    // 去空白：逐字卡把字符用空格隔开（见函数头注坑 1）
    const text = JSON.stringify(tracks).replace(/\s+/gu, '')
    const hits = candidate.heads.filter((head) => text.includes(head)).length
    if (hits < 2) continue
    if (candidate.split === null) return { mode: 'single', shape: '单行' }
    const segments = candidate.probe.split('\n')
    const intact = segments.some((segment) => text.includes(segment.replace(/\s+/gu, '')))
    return { mode: 'multi', shape: intact ? '多行' : candidate.split }
  }

  // 连首段都没命中 ⇒ 这个 slot 对画面无影响
  const probe = isCopy ? '甲甲' : '丁丁'
  const single = safeGenerate(card, isCopy ? probe : other, isCopy ? other : probe)
  const used = JSON.stringify(single).replace(/\s+/gu, '').includes(probe)
  return { mode: used ? 'single' : 'none', shape: '单行' }
}

/** 主体 box：非全屏、非细线装饰，面积最大的一条轨。 */
function mainBoxCell(tracks) {
  let best = null
  for (const track of tracks) {
    const box = track.box
    if (box === undefined || typeof box !== 'object') continue
    const { x, y, w, h } = box
    if (![x, y, w, h].every((value) => typeof value === 'number' && Number.isFinite(value))) continue
    if (w >= 90 && h >= 90) continue // 全屏底板
    if (h < 1.5 || w < 1.5) continue // 细线 / 描边（accent / underline / scan）
    // 眉标带（`y` 顶部 + 一行高）不是「主体」：E1 的素材铺满全屏，眉标
    // 反而是唯一有 box 的小轨 —— 不排除它就会把 `50,12 40×6` 说成主体 box。
    if (h <= 8 && y <= 26) continue
    const area = w * h
    if (best === null || area > best.area) best = { area, cell: `${round(x)},${round(y)} ${round(w)}×${round(h)}` }
  }
  return best === null ? '—' : best.cell
}

const round = (value) => Math.round(value * 10) / 10

/** 一条卡的六列。 */
function rowOf(id) {
  const card = getCard(id)
  const tracks = safeGenerate(card, '甲甲：11\n乙乙：22', '丁丁')
  const copy = probeSlotUsage(card, 'copy')
  const label = probeSlotUsage(card, 'label')
  const copyCell = copy.mode === 'none' ? '不用' : copy.mode === 'single' ? '首段' : copy.shape
  const labelCell = label.mode === 'none' ? '不用' : label.mode === 'single' ? '首段' : label.shape
  return {
    id,
    title: card.title,
    assets: assetCell(card.assets),
    box: mainBoxCell(tracks),
    copy: copyCell,
    label: labelCell,
    tracks: tracks.length,
  }
}

/** 生成整份文档。 */
export function renderCardCatalog() {
  const rows = registeredCardIds().map(rowOf)
  const byCategory = new Map()
  for (const row of rows) {
    const prefix = categoryOf(row.id)
    if (!byCategory.has(prefix)) byCategory.set(prefix, [])
    byCategory.get(prefix).push(row)
  }
  const noAsset = rows.filter((row) => row.assets === '—').length
  const lines = [
    '<!-- 机器生成：node scripts/gen-card-catalog.mjs；请勿手改（改卡注册表后重跑，门禁 tests/card-catalog-drift.test.mjs 会红） -->',
    '',
    '# 卡目录（58 张，从注册表生成）',
    '',
    '> **这是「有哪些卡」的唯一权威清单**：`section.card` / `unit.card` 能写的值只在本表出现。',
    '> 没在本表里的编号（`subtitle` / `chartBars` / `wipeLeft` 之类）**不是卡号**，写进 `card` 会被拒收。',
    `> 本表共 ${rows.length} 张：**${noAsset} 张零素材可用**，其余需素材（素材列写法：数量+种类，感叹号 = 有必填项；标=logo 图=image 音=audio 字=font 面=ui）。`,
    '',
    '列口径：',
    '',
    '- **主体 box**：真跑一次 `generate()` 取「非全屏、面积最大」那条轨的 `x,y w×h`（画布百分比）。',
    '  它告诉你这张卡的内容**落在哪、占多大**；`—` = 该卡只出群组 / 全屏轨，无单一主体。',
    '- **copy / label**：也是跑出来的 —— 分别喂多段探针串，看产物里用上了几段。',
    '  `多行` = 按换行拆成多条（每行一句）；`键:值` / `值,值` / `值|值` = 拆开后**值被单独取用**；',
    '  `首段` = 只用第一段；`不用` = 这个 slot 对画面无影响（随便填）。',
    '',
  ]
  for (const [prefix, label] of CATEGORIES) {
    const group = byCategory.get(prefix)
    if (group === undefined) continue
    lines.push(`## ${prefix} · ${label}（${group.length} 张）`, '')
    lines.push('| 卡号 | 卡名 | 素材 | 主体 box | copy | label |')
    lines.push('|---|---|---|---|---|---|')
    for (const row of group) {
      lines.push(`| ${row.id} | ${row.title} | ${row.assets} | ${row.box} | ${row.copy} | ${row.label} |`)
    }
    lines.push('')
  }
  lines.push('## 怎么用这张表', '')
  lines.push('- **零素材任务**（全代码绘制、不用图 / 视频）：只在素材列为 `—` 的行里挑。')
  lines.push('- **要一张图讲一件事**：`E` / `C` / `CAM` 类；**数据 / 对比**：`DAT` / `B` 类；**纯文字的力量**：`A` / `TYP` 类。')
  lines.push('- 卡内 box 由卡自己定，**spec 无法逐轨指定**；要给内容更大空间，调该单元的 `cell`（见 `spec-geometry.generated.md`）。')
  lines.push('')
  return lines.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-card-catalog.mjs')
if (invokedDirectly) {
  const generated = renderCardCatalog()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-card-catalog: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-card-catalog.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-card-catalog: 卡目录与注册表不一致（加了卡 / 改了 title / 改了 assets 但没重跑本脚本）。')
      console.error('修法：yarn build && node scripts/gen-card-catalog.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-card-catalog: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-card-catalog: 已写入 ${OUTPUT}（${Buffer.byteLength(generated)} 字节）`)
  }
}
