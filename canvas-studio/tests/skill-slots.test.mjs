/**
 * 能力槽位门禁（CV-319）。
 *
 * ## 为什么有这道门
 *
 * 总纲（`skills/canvas-studio-creation/SKILL.md`）过去直接硬写「纯文生图 → 加载
 * `krea2-turbo-writing`」。CV-319 把它改成：总纲**不点名具体 skill**，只指向
 * `references/toolchain.md` 的**能力槽位绑定表**。
 *
 * 这么改不是为了好看，是为了**让总纲不会因为新增 skill 而过期**：
 * 新增一个知识型 skill 只改绑定表一处，总纲一个字都不用动。
 *
 * 但「改成查表」本身会引入新的失效方式，而结构门禁看不见：
 *   ① 绑定表里写了一个**不存在的 skill 名** —— 模型按表去 `skill(name=…)` 直接失配；
 *   ② 同一个槽位被**两个**知识型 skill 占用 —— 平台不知道该装配哪个；
 *   ③ 总纲里**又手痒写回了**硬编码 skill 名 —— 过期机制复活，判据二失效；
 *   ④ 槽位表与实际 skill 目录**悄悄漂移** —— 有人删了 skill 忘了改表。
 *
 * **只有语义对账能挡住这四条。**
 *
 * 运行：`corepack yarn workspace canvas-studio test:smoke`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')
const CREATION = join(SKILLS_DIR, 'canvas-studio-creation')
const TOOLCHAIN = join(CREATION, 'references', 'toolchain.md')

/** 6 个能力槽位 + 编排 + 通用。编排与通用不参与「一槽一 skill」约束。 */
export const SLOT_IDS = [
  'video-prompt', 'image-t2i', 'image-edit',
  'audio-music', 'audio-voice', 'camera-language',
  'orchestration', 'general',
]

/** 真正参与占用互斥的槽位（编排/通用不互斥）。 */
const EXCLUSIVE_SLOTS = SLOT_IDS.filter(id => id !== 'orchestration' && id !== 'general')

/** 已知 skill 目录。绑定表里出现表外的名字即为幽灵。 */
function skillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
}

/**
 * 解析能力槽位绑定表。返回 `槽位 → skill 名`。
 *
 * 只认这张表，不猜别处：表的行格式是
 * `| \`槽位\` | \`skill-name\` | 用途 | 必读 |`
 */
export function parseSlotTable() {
  const text = readFileSync(TOOLCHAIN, 'utf8')
  const table = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|\s*`([a-z0-9-]+(?:-[a-z0-9]+)*)`\s*\|/u)
    if (m) table.set(m[1], m[2])
  }
  return table
}

test('CV-319：绑定表存在且格式可解析（防止门禁空转）', () => {
  assert.ok(existsSync(TOOLCHAIN), '总纲分册 toolchain.md 缺失 —— 能力槽位绑定表没有落点')
  const table = parseSlotTable()
  assert.ok(
    table.size >= 6,
    `绑定表只解析出 ${table.size} 条，至少应有 6 个能力槽位 —— 表格格式可能变了，解析正则要跟着改`,
  )
  for (const [slot, skill] of table) {
    assert.ok(
      SLOT_IDS.includes(slot),
      `绑定表出现未知槽位 \`${slot}\`（指向 \`${skill}\`）—— 合法槽位只有：${SLOT_IDS.join(' / ')}`,
    )
  }
})

test('CV-319：6 个能力槽位全部有绑定（不许留空槽）', () => {
  const table = parseSlotTable()
  for (const slot of EXCLUSIVE_SLOTS) {
    assert.ok(
      table.has(slot),
      `能力槽位 \`${slot}\` 在绑定表里没有绑定 —— 槽位留空等于让模型在若干个同类 skill 里随机挑`,
    )
  }
})

test('CV-319：绑定表指向的 skill 必须真实存在（幽灵绑定直接红）', () => {
  const names = new Set(skillNames())
  const ghosts = []
  for (const [slot, skill] of parseSlotTable()) {
    if (!names.has(skill)) ghosts.push(`\`${slot}\` → \`${skill}\`（该目录不存在）`)
  }
  assert.deepEqual(
    ghosts, [],
    '能力槽位绑定表指向了不存在的 skill —— 模型按表去加载会直接失配：\n' + ghosts.join('\n'),
  )
})

test('CV-319：一个槽位至多一个知识型 skill 占用（CV-325 槽位互斥的第一阶段约束）', () => {
  const table = parseSlotTable()
  const occupied = new Map()
  for (const [slot, skill] of table) {
    if (!EXCLUSIVE_SLOTS.includes(slot)) continue
    if (occupied.has(slot)) {
      // 同一个槽位出现两次 = 解析到了重复行
      assert.fail(
        `槽位 \`${slot}\` 在绑定表里出现多次（\`${occupied.get(slot)}\` 与 \`${skill}\`）——`
        + '一槽一 skill 是 CV-325 开放用户上传后的硬约束：平台必须能确定装配哪一个',
      )
    }
    occupied.set(slot, skill)
  }
  assert.equal(
    occupied.size, EXCLUSIVE_SLOTS.length,
    `互斥槽位应各占一条，实际 ${occupied.size}/${EXCLUSIVE_SLOTS.length}`,
  )
})

test('CV-319：总纲不得硬编码能力槽位对应的 skill 名（判据二：会因新增 skill 而变的规则不能写死）', () => {
  const main = readFileSync(join(CREATION, 'SKILL.md'), 'utf8')
  const table = parseSlotTable()
  // 总纲是系统级常驻内容，一旦写死 skill 名，新增 skill 就必须改总纲 = 过期机制复活
  const hardcoded = [...table.values()].filter(name => main.includes(`\`${name}\``))
  assert.deepEqual(
    hardcoded, [],
    '总纲里出现了能力槽位对应 skill 的硬编码引用 —— 应当只写「查 toolchain.md 能力槽位绑定表」：\n'
    + hardcoded.map(n => `  ${n}`).join('\n'),
  )
})

test('CV-319：总纲必须真的指向绑定表（不能只把名字删了却不给去处）', () => {
  const main = readFileSync(join(CREATION, 'SKILL.md'), 'utf8')
  assert.ok(
    main.includes('能力槽位绑定表') && main.includes('toolchain.md'),
    '总纲没有指向 `toolchain.md` 的「能力槽位绑定表」—— 不点名 skill 的同时必须给出去处，否则模型无处可查',
  )
})

test('CV-319：绑定表行不得越权承载流程/审批门/工具契约（CV-325 安全协议）', () => {
  const text = readFileSync(TOOLCHAIN, 'utf8')
  // 只取表格行本身（`| `slot` | `skill` | ... |`），不取周围散文：
  // 散文里写「槽位纪律」「用户安装的声明边界」是本节该讲的内容。
  const rows = text.split('\n').filter(line => /^\|\s*`[a-z0-9-]+`\s*\|\s*`/u.test(line))
  assert.ok(rows.length >= 6, `绑定表行只匹配到 ${rows.length} 条，格式可能变了`)
  // 决策型工具名 / 自设审批门的话术，一旦出现在槽位行里，就等于知识型 skill 在声明流程
  const banned = [
    'submit_keyframes_for_approval', 'submit_screenplay', 'ask_user_choice',
    'write_storyboard', 'write_script', 'compose_video', '批准后', '等用户确认后',
  ]
  const offenders = []
  for (const row of rows) {
    for (const word of banned) {
      if (row.includes(word)) offenders.push(`${word} ← ${row.slice(0, 60)}…`)
    }
  }
  assert.deepEqual(
    offenders, [],
    '槽位绑定行里出现了决策型工具或自设审批门话术 —— 槽位行只登记「哪个槽位装哪个知识型 skill」，'
    + '不承载流程、审批门与工具契约：\n' + offenders.join('\n'),
  )
})
