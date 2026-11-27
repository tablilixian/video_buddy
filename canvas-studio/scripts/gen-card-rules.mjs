/**
 * 从**注册表**机器生成「卡解析规则」表（P1-1，REQ-038 R11 二轮）。
 *
 * ## 抓的是什么浪费
 *
 * 真机二轮 34 次源码探查里 **12 次在问同一件事：`copy` 到底怎么拆**。
 * `card-catalog.generated.md` 只答「用不用」（形态标签 `多行` / `键:值`），不答「怎么拆」——
 * 它把 DAT3 判成「多行」，实际是二级解析（`键:值` 按 `;`/`；`/`\n` 分段，段内按冒号拆
 * k/v，v 非数字落序号）⇒ 模型按目录写 `买入\n卖出` 拿到自动编号而不是 99/101，
 * 读源码才搞对。**回答「怎么写」的规则不能只给存在性标签。**
 *
 * ## 口径（全部跑出来，不抄源码）
 *
 * 1. **copy 解析规则**：对每张卡喂带哨兵的探针串（`甲甲:11；乙乙:22`…），逐个分隔符
 *    试「能不能把段拆开」（哨兵段各自出现且探针串**不**完整出现 = 拆开了）；
 *    再看键与值是否被**分开取用**（`labels[]` + `values[]` / `data[].k` + `.v`）还是
 *    整段当一句（`甲甲:11` 原样出现在 text 里）。非数字值探针测「落序号」兜底。
 * 2. **label 用法**：复用 `gen-card-catalog.mjs` 的 `probeSlotUsage`（口径只有一份）。
 * 3. **能力**：`highlights` / `dataSource` 传进去看产物有没有 —— 卡「支持什么」
 *    只能从产物看出来（R11 的教训：卡目录阶段这两列欠着，模型又得回源码）。
 * 4. **同义卡**：按「主体轨型 + 是否依赖图片素材」分组 —— 渲染缺陷降级时
 *    「换同义卡」查的就是这一列（P1-3 第 0 档）。
 *
 * ## 用法
 *
 *   node scripts/gen-card-rules.mjs           # 重写生成物
 *   node scripts/gen-card-rules.mjs --check   # 只比对，不一致退出 1
 *
 * 生成物：`skills/code-driven-explainer/references/card-rules.generated.md`
 * 守卫：`tests/card-rules-drift.test.mjs`（含 DAT3 键:值 回归断言 + 临时卡反向变异）。
 *
 * 与 `yarn check` 的顺序关系同 `gen-card-catalog.mjs`：import `lib/` ⇒ 必须在 build 之后。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCard, registeredCardIds } from '../lib/remotion/recipe-cards-all.js'
import { probeSlotUsage, mockCtx, safeGenerate } from './gen-card-catalog.mjs'
import { BULLETS_MAX_LINES, CAPTION_SOFT_MAX_LINES, TITLE_MAX_LINES } from '../lib/remotion/text-fit-plan.js'
import { SUBTITLE_MAX_LINES } from '../lib/remotion/subtitle-fit.js'

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
export const OUTPUT = join(workspaceRoot, 'skills', 'code-driven-explainer', 'references', 'card-rules.generated.md')

// ── 产物字段扫描：标记出现在哪条轨的哪个字段 ─────────────────────────────

/** 收集产物里所有字符串 / 数字叶子：[{ path, text }]。path 形如 `tracks[2](p-chart).values[0]`。 */
function markerLocations(tracks) {
  const found = []
  const visit = (node, path) => {
    if (node === null || node === undefined) return
    const type = typeof node
    if (type === 'string' || type === 'number') {
      found.push({ path, text: String(node) })
      return
    }
    if (type !== 'object') return
    for (const [key, value] of Object.entries(node)) visit(value, `${path}.${key}`)
  }
  tracks.forEach((track, index) => visit(track, `tracks[${index}](${String(track?.id ?? '?')})`))
  return found
}

/** 叶子字段名：剥掉数组下标（`[0]` 与纯数字段 `.0` 都是数组足迹）→ `values`。 */
function leafOf(path) {
  const segments = path.split('.').filter((segment) => !/^\d+$/u.test(segment))
  const last = segments[segments.length - 1] ?? ''
  return last.replace(/\[\d+\]/gu, '')
}

// ── copy 解析规则探针 ─────────────────────────────────────────────────────

const KEY_MARKERS = ['甲甲', '乙乙', '丙丙']
const NUMERIC_VALUES = ['11', '22', '33']
const TEXT_VALUES = ['戊戊', '己己']

/** 候选分段符（探针会逐个试；卡只认其中一部分）。名字里不许有 ASCII 竖线 —— 它会打断 markdown 表格列。 */
const SEPARATORS = [
  { token: '\n', name: '换行' },
  { token: '；', name: '全角；' },
  { token: ';', name: '半角;' },
  { token: '|', name: '半角竖线' },
  { token: '｜', name: '全角｜' },
]

const normalize = (value) => value.replace(/\s+/gu, '')

/**
 * 探针串在产物里的三个事实：
 * - `segmentsUsed`：哨兵段各自出现的个数（≥2 才算拆开了多段）
 * - `intactWhole`：整条探针串是否原样出现（原样 = 没拆）
 * - `intactSegment`：某段（含键值）是否原样出现（键:值 整段当一句用的证据）
 */
/** `label = null` 表示「不传 label」（模拟 spec 里没填 —— `??` 兜底只认 null/undefined）。 */
function probeFacts(card, probe, label = '丁丁') {
  const tracks = safeGenerate(card, probe, label === null ? undefined : label)
  if (tracks.length === 0) return { tracks, locations: [], used: 0, intactWhole: false, intactSegment: false }
  const text = normalize(JSON.stringify(tracks))
  const locations = markerLocations(tracks)
  const heads = [...KEY_MARKERS, ...NUMERIC_VALUES, ...TEXT_VALUES]
  const used = heads.filter((head) => text.includes(head)).length
  return {
    tracks,
    locations,
    used,
    intactWhole: text.includes(normalize(probe)),
    intactSegment: text.includes('甲甲:11') || text.includes('甲甲:戊戊'),
  }
}

/** 键与值是否被「分开取用」（labels+values 或 data[].k + .v），返回去向字段名集合。 */
function kvDestinations(locations) {
  const keyLeaves = new Set()
  const valueLeaves = new Set()
  for (const { path, text } of locations) {
    const leaf = leafOf(path)
    if (KEY_MARKERS.includes(text)) keyLeaves.add(leaf)
    if (NUMERIC_VALUES.includes(text) || TEXT_VALUES.includes(text)) valueLeaves.add(leaf)
  }
  return { keyLeaves, valueLeaves }
}

/**
 * 一张卡的 copy 解析规则（探测式；每张卡 ≤5 次 generate）。
 *
 * 返回人读的一句话：分段符 / 拆法 / 去向 / 兜底，全部来自产物观察。
 */
/**
 * 数值对差分探针（DAT1 式 + 数字对误报防线）。
 *
 * 直接找数字会撞上几何/计时字段的巧合值（`box.h:11` / `durationInFrames:150`）——
 * 真机二轮的教训：巧合不是因果。这里跑**两轮不同数字**，只把「随 copy 数字变化」的
 * 叶子算作去向；只有 `text` 变化 = 段当整句用（多行），非 text 字段变化 = 数值串。
 */
function differentialNumericParse(card) {
  for (const sep of SEPARATORS) {
    // 四位质数对：设计常量（box 百分比 / 设计 px / 帧）不可能出现这个量级的数，
    // 排除「卡内几何常量撞上探针数字」的巧合（TYP5 实测踩过：dash [26,49] 撞 26,49）。
    const probeA = `9137,5873${sep.token}2649,8246${sep.token}6319,5784`
    const probeB = `7159,2963${sep.token}4177,6521${sep.token}8303,9719`
    const factsA = probeFacts(card, probeA)
    if (factsA.tracks.length === 0 || factsA.intactWhole) continue
    // 差分按「同路径、值不同」判，不按「值包含标记」判 —— 卡会对数字做变换
    //（取模 / 截断 / Math.min），DAT1 实测 9137° 进卡后不再原样出现。
    const mapOf = (facts) => {
      const map = new Map()
      for (const { path, text } of facts.locations) {
        if (path.includes('.id') || leafOf(path) === 'id') continue
        map.set(path, text)
      }
      return map
    }
    const mapA = mapOf(factsA)
    const mapB = mapOf(probeFacts(card, probeB))
    const numericDest = new Set()
    const textOnly = new Set()
    const probeTokens = new Set(['9137', '5873', '2649', '8246', '6319', '5784', '7159', '2963', '4177', '6521', '8303', '9719'])
    for (const [path, textA] of mapA) {
      const textB = mapB.get(path)
      if (textB === undefined || textB === textA) continue
      const leaf = leafOf(path)
      if (leaf === 'text' || leaf === 'lines') {
        // 文本叶子分两种：探针数字**原样**出现 = 值被抽取后显示（DAT1 的 `5873`）；
        // 整段 copy 原样出现 = 段当整句用（TYP1 的 `9137,5873 2649,8246 …`）。
        if (probeTokens.has(textA.trim()) || probeTokens.has(String(textB).trim())) numericDest.add(leaf)
        else textOnly.add(leaf)
      } else {
        numericDest.add(leaf)
      }
    }
    if (numericDest.size > 0) {
      return `数值串 ｜ 分段: ${sep.name} ｜ 数字对被单独取用 → ${[...numericDest].join('+')}（非数字落 0 且不显字，实测 DAT1）`
    }
    if (textOnly.size > 0) {
      // 首段 vs 多行：第二段（2649/8246）没出现 = 只用第一段
      const secondSegmentUsed = factsA.locations.some(({ text }) => text.includes('2649') || text.includes('8246'))
      if (secondSegmentUsed) return `多行 ｜ 分段: ${sep.name} ｜ 每段整句上画面 → text`
      return `首段（只用第一段，整段原样上画面；后面的段不上画面）`
    }
    continue
  }
  return null
}

function probeCopyParsing(card) {
  // 第 1 步：哪些分隔符能把段拆开（键:值 探针）
  const working = []
  let kvProbe = null
  for (const sep of SEPARATORS) {
    const probe = `甲甲:11${sep.token}乙乙:22${sep.token}丙丙:33`
    const facts = probeFacts(card, probe)
    if (facts.used === 0) continue // copy 完全不影响画面
    const split = facts.used >= 4 && !facts.intactWhole
    if (split) working.push(sep)
    if (kvProbe === null && facts.used > 0) kvProbe = { probe, facts }
  }
  if (kvProbe === null || working.length === 0) {
    // 键:值 探针拆不出段：要么整段当一句 / 只用首段 / 不用，要么 copy 全程走
    // Number() 转换（DAT1 式，键永远不出现）—— 差分探针先跑，再下结论。
    const numeric = differentialNumericParse(card)
    if (numeric !== null) return numeric
    // 整段当一句 / 只用首段 / 不用 —— 用最朴素的单段探针分辨
    const single = probeFacts(card, '甲甲')
    if (single.used === 0) {
      // 盲区兜底：有的卡 copy 是 label 的兜底（OPN3 = `label ?? copy`）——
      // label 传了就轮不到 copy。label=null（= 不传）复跑一次再下「不用」的结论
      //（空串不行：`'' ?? copy` 仍是 ''，探针必须模拟「没填」）。
      const fallback = probeFacts(card, '甲甲', null)
      if (fallback.used > 0) return 'label 缺省时用 copy（整段原样；label 优先，填了 label 就不看 copy）'
      return '不用 copy（写了也不上画面）'
    }
    return '单段（整段 copy 原样上画面，分段符无意义）'
  }

  // 第 2 步：键值是否分开取用（拿第一个可用分隔符的产物判断）
  const facts = kvProbe.facts
  const { keyLeaves, valueLeaves } = kvDestinations(facts.locations)
  const dest = (leaves) => [...leaves].filter((leaf) => leaf !== 'id' && leaf.length > 0).join('+') || '?'
  const intact = facts.intactSegment
  const kvSeparated = keyLeaves.size > 0 && valueLeaves.size > 0 && !intact
  const sepNames = working.map((sep) => sep.name).join(' / ')

  if (!kvSeparated && intact) {
    // 键:值 原样出现在 text 里 = 整段当一句（真「多行」）
    const where = dest(keyLeaves.size > 0 ? keyLeaves : new Set(['text']))
    return `多行 ｜ 分段: ${sepNames} ｜ 每段整句上画面 → ${where}`
  }
  if (kvSeparated) {
    // 第 3 步：非数字值有没有「落序号」兜底
    const fallbackProbe = `甲甲:戊戊${working[0].token}乙乙:己己`
    const fallbackFacts = probeFacts(card, fallbackProbe)
    const numericOnly = markerLocations(fallbackFacts.tracks)
      .filter(({ path }) => leafOf(path) !== 'id')
      .some(({ text }) => text === '1' || text === '2')
    const withFallback = numericOnly && !fallbackFacts.locations.some(({ text }) => TEXT_VALUES.includes(text))
    const kvSyntax = keyLeaves.has('values') || valueLeaves.has('values') ? 'labels+values' : `${dest(keyLeaves)} + ${dest(valueLeaves)}`
    return `键:值 ｜ 分段: ${sepNames} ｜ 段内按冒号拆 → ${kvSyntax}${withFallback ? '（v 非数字 ⇒ 落序号 1,2…）' : ''}`
  }
  return `多行 ｜ 分段: ${sepNames} ｜ 每段整句上画面`
}

// ── 能力探针 ─────────────────────────────────────────────────────────────

/** ctx.highlights / ctx.dataSource 传进去，看产物有没有对应字段。 */
function probeCapabilities(card) {
  const tracks = safeGenerateWithExtra(card, '甲甲：11\n乙乙：22', '丁丁', {
    highlights: [
      { text: '戊戊', color: '#ff0000' },
      { text: '己己', color: '#00ff00' },
    ],
    dataSource: '数据来源标记',
  })
  const locations = markerLocations(tracks)
  const highlightsPath = locations.find(({ path }) => path.includes('highlights'))
  const dataSourceHit = locations.some(({ path }) => path.includes('dataSource'))
  return {
    highlights: highlightsPath !== undefined ? '✓' : '—',
    dataSource: dataSourceHit ? '✓' : '—',
  }
}

// ── 容量探针 ─────────────────────────────────────────────────────────────

/**
 * **这张卡到底能装几条 / 几行** —— 从产物实测，不抄源码常量。
 *
 * 为什么必须单列：2026-11-27 超级月亮会话里，模型为「这卡能放几行」重编了 3 次
 * （A4 有底板 → 换 A2 只装 2 行 → 换 A1 也只装 2 行 → 最后删文案），因为旧表只答
 * 「copy 怎么拆」，不答「装得下吗」。而答案是两件不同的事：
 *
 * - **条数**：有的卡硬截断（A4 `.slice(0,6)` / B1 `.slice(0,4)`），给 8 条只出 6/4 条；
 *   有的卡不截断，把 8 条塞进同一个多行文本块 —— 后者才是更坑的，因为"没丢字"但溢出。
 * - **行数**：由 textCard 的 `variant` 决定（title 2 / subtitle 3 / bullets 6）。
 *
 * 探针喂 8 条带序号的条目，数产物里还剩几条：全在 ⇒ 不截断（`不限条`），
 * 少几条 ⇒ 那就是硬上限。行数取产物里**出现过的 variant 中最小的那个上限**
 * （最受限的字段决定文案能写多长）。
 */
const VARIANT_LINES = {
  title: TITLE_MAX_LINES,
  subtitle: SUBTITLE_MAX_LINES,
  bullets: BULLETS_MAX_LINES,
  caption: CAPTION_SOFT_MAX_LINES,
}
const CAPACITY_MARKS = ['壹条', '贰条', '叁条', '肆条', '伍条', '陆条', '柒条', '捌条']
/**
 * 数值串卡的探针标记（DAT* 只认数字，中文串一条都取不到 —— 那会得出「0 条」的假结论）。
 * 用三位数 + 前后数字边界判定，避免和产物里的坐标/序号撞车。
 */
const CAPACITY_NUM_MARKS = ['901', '902', '903', '904', '905', '906', '907', '908']

function countMarks(blob, marks, numeric) {
  if (!numeric) return marks.filter((mark) => blob.includes(mark)).length
  return marks.filter((mark) => new RegExp(`(?<!\\d)${mark}(?!\\d)`, 'u').test(blob)).length
}

function probeCapacity(card) {
  const probes = [
    { marks: CAPACITY_MARKS, numeric: false, copy: CAPACITY_MARKS.join('\n') },
    // 键:值 型卡：无冒号的串可能整段当值或直接丢，退一步用带冒号的形态再探。
    { marks: CAPACITY_MARKS, numeric: false, copy: CAPACITY_MARKS.map((mark, index) => `${mark}:${index + 1}`).join('\n') },
    { marks: CAPACITY_NUM_MARKS, numeric: true, copy: CAPACITY_NUM_MARKS.join('\n') },
  ]
  // 三种形态取**保留条数最多**的那次 —— 那才是这张卡的真实上限（谁最合适用谁）。
  let best = null
  for (const probe of probes) {
    let tracks = null
    try {
      tracks = card.generate(mockCtx(card, probe.copy, '标'))
    } catch {
      continue
    }
    if (!Array.isArray(tracks)) continue
    const blob = markerLocations(tracks).map(({ text }) => text).join('\u0001')
    const kept = countMarks(blob, probe.marks, probe.numeric)
    if (best === null || kept > best.kept) best = { kept, tracks, total: probe.marks.length }
  }
  // `—` = 这张卡不吃 copy（DAT4「写了也不上画面」）或三种形态都取不到 ⇒ 容量问题不适用，
  // 不能写成「0 条」——那会被读成"一张都装不下"，比不给答案更误导。
  if (best === null || best.kept === 0) return '—'

  const countText = best.kept >= best.total ? '不限条' : `${String(best.kept)} 条`
  const variants = best.tracks
    .map((track) => (typeof track?.variant === 'string' ? VARIANT_LINES[track.variant] : undefined))
    .filter((lines) => typeof lines === 'number')
  if (variants.length === 0) return countText
  return `${countText} / ${String(Math.min(...variants))} 行`
}

// ── 同义卡分组 ───────────────────────────────────────────────────────────

/** 主体轨的 type（与卡目录 mainBoxCell 同一扫描口径，取面积最大者）。 */
function mainTrackType(tracks) {
  let best = null
  for (const track of tracks) {
    const box = track?.box
    if (box === undefined || typeof box !== 'object') continue
    const { x, y, w, h } = box
    if (![x, y, w, h].every((value) => typeof value === 'number' && Number.isFinite(value))) continue
    if (w >= 90 && h >= 90) continue
    if (h < 1.5 || w < 1.5) continue
    if (h <= 8 && y <= 26) continue
    const area = w * h
    if (best === null || area > best.area) best = { area, type: String(track.type ?? '?') }
  }
  return best?.type ?? '?'
}

const needsImage = (card) => card.assets.some((decl) => decl.kind === 'image' && decl.required === true)

// ── 组装 ─────────────────────────────────────────────────────────────────

const safeGenerateWithExtra = (card, copy, label, extra = {}) => {
  try {
    const slots = Object.fromEntries(card.assets.map((decl) => [decl.slot, '/canvas-studio/assets/demo/shot.png']))
    return card.generate({ ...mockCtx(card, copy, label), assetSrc: (slot) => slots[slot], ...extra })
  } catch {
    return []
  }
}

/** 一条卡的规则行。 */
function rowOf(id, synonymsOf) {
  const card = getCard(id)
  const label = probeSlotUsage(card, 'label')
  const labelCell = label.mode === 'none' ? '不用' : label.mode === 'single' ? '首段' : label.shape
  const capabilities = probeCapabilities(card)
  return {
    id,
    title: card.title,
    copyRule: probeCopyParsing(card),
    capacity: probeCapacity(card),
    // 素材槽名：卡目录只说「2图」，不说「叫什么」。2026-11-27 真机会话里模型只能猜
    // `body1`（真名 core / satellite），猜错 ⇒ assetSrc 拿不到 ⇒ 静默降级纯色圆，
    // 观感塌成「两个圆圈」。槽名必须可查，`(选)` = required:false（缺图有降级、不报错）。
    assetSlots: card.assets.length === 0
      ? '—'
      : card.assets.map((decl) => `${decl.slot}${decl.required === true ? '' : '(选)'}`).join(' '),
    label: labelCell,
    highlights: capabilities.highlights,
    dataSource: capabilities.dataSource,
    dataKeys: (card.dataKeys ?? []).join(' ') || '—',
    synonyms: synonymsOf(id),
  }
}

/** 生成整份文档。 */
export function renderCardRules() {
  const ids = registeredCardIds()
  // 同义分组：主体轨型 + 是否必填图（跑一次产物拿轨型）
  const groupOf = new Map()
  for (const id of ids) {
    const card = getCard(id)
    const tracks = safeGenerateWithExtra(card, '甲甲:11\n乙乙:22', '丁丁')
    const key = `${mainTrackType(tracks)}|${needsImage(card) ? 'img' : 'noimg'}`
    if (!groupOf.has(key)) groupOf.set(key, [])
    groupOf.get(key).push(id)
  }
  const synonymsOf = (id) => {
    const card = getCard(id)
    const tracks = safeGenerateWithExtra(card, '甲甲:11\n乙乙:22', '丁丁')
    const key = `${mainTrackType(tracks)}|${needsImage(card) ? 'img' : 'noimg'}`
    const others = (groupOf.get(key) ?? []).filter((other) => other !== id)
    return others.length === 0 ? '—' : others.slice(0, 5).join(' ')
  }

  const rows = ids.map((id) => rowOf(id, synonymsOf))
  const byPrefix = new Map()
  for (const row of rows) {
    const prefix = /^([A-Z]+)/u.exec(row.id)?.[1] ?? '?'
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix).push(row)
  }

  const lines = [
    '<!-- 机器生成：node scripts/gen-card-rules.mjs；请勿手改（改卡注册表后重跑，门禁 tests/card-rules-drift.test.mjs 会红） -->',
    '',
    '# 卡解析规则（从注册表 + generate() 产物生成）',
    '',
    '> **这是「copy 到底怎么拆」的唯一权威清单**——卡目录（`card-catalog.generated.md`）只答',
    '> 「有哪些卡、内容放哪」，本表答「怎么写 copy / label、卡支持什么、坏了换哪张」。',
    '> **选卡读卡目录，写 copy 读本表。** 每一格都是探针跑出来的产物观察，不是源码注释。',
    '',
    '列口径：',
    '',
    '- **copy 解析规则**：`分段` = 实测能把多段拆开的分隔符；`→` 后面是段落的去向字段。',
    '  「每段整句上画面」= 键:值 写法不会拆 k/v（写了冒号也当普通文字）。',
    '- **容量**（`条 / 行`）：**这张卡装得下多少**——喂 8 条探针后产物里还剩几条（`不限条` = 不截断，'
      + '但超出行数会溢出/缩字，不是"安全"），以及正文最多显示几行（由 textCard 变体决定）。'
      + '**写文案前先看这列**：`4 条 / 3 行` 的卡塞 6 条要点，后 2 条会直接消失。',
    '- **素材槽**：`assetSlots` 里能写的**键名**（`(选)` = 可选槽，缺图自动降级、不报错）。'
      + '卡目录的「素材」列只说几张，槽名只有本列有 —— 猜错名字不会报错，图会静默丢掉。',
    '- **highlights / dataSource**：`✓` = 传了真的进产物（R11 的分段着色 / 数据来源标注）；`—` = 不支持，传了被忽略。',
    '- **data 键**（D5）：该卡消费的 `ctx.data` 结构化数值键（spec 写 `data: { "半径": 384 }` 时能传哪些键）；`—` = 不消费。键由卡注册时 `dataKeys` 声明，产物响应该卡的单测保证。',
    '- **同义卡**：主体轨型相同且素材依赖相同（渲染坏了 / 想换观感时按这列换，第 0 档降级）。',
    '',
    '| 卡 | copy 解析规则 | 容量 | 素材槽 | label | highlights | dataSource | data 键 | 同义卡 |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const [, group] of byPrefix) {
    for (const row of group) {
      lines.push(`| ${row.id} | ${row.copyRule} | ${row.capacity} | ${row.assetSlots} | ${row.label} | ${row.highlights} | ${row.dataSource} | ${row.dataKeys} | ${row.synonyms} |`)
    }
  }
  lines.push('')
  lines.push('## 已知坑（实测踩过，别再踩）', '')
  lines.push('- **键:值 卡的 v 非数字会落序号**：写 `买入\\n卖出` 得到 labels=[买入,卖出]、values=[1,2]——')
  lines.push('  想要真数值必须写 `买入:99`。数值串卡（DAT1 式）相反：非数字直接落 0 且不显字。')
  lines.push('- 逐字卡（OPN3 式）把字符逐个上画面：copy 长度就是字数，分段符无意义。')
  lines.push('- 「同义卡」只保证**主体轨型相同**，观感细节（动效 / 配色）仍有差异——换卡后重跑 scaffold_manifest 看体检回执。')
  lines.push('')
  return lines.join('\n')
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('gen-card-rules.mjs')
if (invokedDirectly) {
  const generated = renderCardRules()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`gen-card-rules: 生成物不存在（${OUTPUT}）—— 先跑 node scripts/gen-card-rules.mjs 并提交。`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error('gen-card-rules: 解析规则表与注册表不一致（改了卡的 generate / 加了卡但没重跑本脚本）。')
      console.error('修法：yarn build && node scripts/gen-card-rules.mjs 后连同生成物一起提交。')
      process.exit(1)
    }
    console.log('gen-card-rules: 一致 ✓')
  } else {
    writeFileSync(OUTPUT, generated, 'utf8')
    console.log(`gen-card-rules: 已写入 ${OUTPUT}（${Buffer.byteLength(generated)} 字节）`)
  }
}
