/**
 * CV-324：`skills/<name>/platform.yaml` 守卫 —— 展示元数据的单一事实源。
 *
 * 为什么要有这个文件：广场元数据原先是 `src/skill-catalog.ts` 里的一串 TS 字面量，
 * 与 `skills/` 的真实 skill 是两份东西。新增 skill 忘记补表**不会报任何错**，用户
 * 上传的 skill 会静默消失在广场里（比红更糟的故障）。CV-324 起展示元数据搬进
 * `skills/<name>/platform.yaml`，本文件把「搬过来之后可能出的错」逐条钉死：
 *
 *   1. 每个 skill 目录都有 platform.yaml，且必填字段齐全、取值域合法
 *   2. 目录名 = platform.yaml 的 name = SKILL.md frontmatter 的 name（三方一致）
 *   3. 无重复条目、无幽灵条目（platform.yaml ↔ 已注册 skill，两向都查）
 *   4. role / slot 取值合法，且每个能力槽位至多一个知识型 skill 占用
 *      （槽位机制第一阶段约束：内置优先，用户上传只能顶替空槽位）
 *   5. 删除保护：`meta.yaml` 里不许出现任何平台展示字段名
 *      —— 它是上游 MiniMax-H3 署名的唯一载体，被平台字段污染等于毁掉署名
 *   6. 渲染器快照不漂移：`BUNDLED_CATALOG` 与 platform.yaml 逐字段相等
 *      （渲染器无文件系统，只能用这份内嵌副本；副本与事实源分叉 = 浏览器上少卡）
 *
 * 刻意不测的：title / summary 的具体措辞与字节数（那是展示层，改文案不该红）、
 * YAML 解析器的行为（复用 `lib/skill-catalog.js` 的 `parsePlatformYaml`，
 * 同一规则不写第二份）。platform.yaml 的字段契约见该文件头注释。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_CATALOG,
  CATALOG_SOURCE,
  PLATFORM_ROLES,
  PLATFORM_SLOTS,
  SKILL_CATALOG,
  SKILL_CATEGORY_IDS,
  SKILL_ICON_IDS,
  parsePlatformYaml,
} from '../lib/skill-catalog.js'
import { MINIMAX_SKILL_NAMES } from '../lib/skills/minimax-skills.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')

/** platform.yaml 的字段名全集（含 `demo`/`h3`/`stage` 三个可选展示字段）。 */
const PLATFORM_KEYS = ['name', 'title', 'summary', 'category', 'icon', 'hue', 'featured', 'demo', 'h3', 'stage', 'hidden']

/** 必填字段（无缺省值：缺了就得是显式决策）。 */
const REQUIRED_KEYS = ['name', 'title', 'summary', 'category', 'icon', 'hue', 'featured', 'role', 'slot']

/** skills/ 下的全部 skill 目录（含未注册的 —— 少一份 platform.yaml 同样是错）。 */
const SKILL_DIRS = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

/** 平台展示字段在 platform.yaml 里的取值域（category/icon 由 skill-catalog 声明）。 */
const SKILL_CATEGORIES = new Set(SKILL_CATEGORY_IDS)
const SKILL_ICONS = new Set(SKILL_ICON_IDS)

/** 目录名 → 该目录 platform.yaml 的解析结果（缺文件由第 1 条测试报告）。 */
const platformRecords = new Map()
for (const name of SKILL_DIRS) {
  const file = join(SKILLS_DIR, name, 'platform.yaml')
  const source = `skills/${name}/platform.yaml`
  if (!existsSync(file)) continue
  const parsed = parsePlatformYaml(readFileSync(file, 'utf8'), source)
  assert.ok(parsed.ok, `${parsed.ok ? '' : parsed.reason}`)
  platformRecords.set(name, parsed.value)
}

/** SKILL.md frontmatter 的 name（用于三方一致断言）。 */
function frontmatterName(skillMd) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(skillMd)
  const line = (match?.[1] ?? '').split(/\r?\n/).find((row) => /^name\s*:/u.test(row))
  return line?.slice(line.indexOf(':') + 1).trim() ?? null
}

test('CV-324：每个 skill 目录都有 platform.yaml，且必填字段齐全', () => {
  assert.ok(SKILL_DIRS.length > 0, 'skills/ 目录为空 —— 打包产物不完整')
  const missing = SKILL_DIRS.filter((name) => !existsSync(join(SKILLS_DIR, name, 'platform.yaml')))
  assert.deepEqual(
    missing,
    [],
    `以下 skill 目录缺 platform.yaml（它在广场里会静默消失）：${missing.join(', ')}`,
  )
  for (const [name, record] of platformRecords) {
    const absent = REQUIRED_KEYS.filter((key) => !(key in record))
    assert.deepEqual(absent, [], `skills/${name}/platform.yaml 缺字段：${absent.join(', ')}`)
  }
})

test('CV-324：platform.yaml 字段取值合法（category/icon 取域、hue 整数、布尔字段真的是布尔）', () => {
  for (const [name, record] of platformRecords) {
    const where = `skills/${name}/platform.yaml`
    assert.ok(SKILL_CATEGORIES.has(record.category), `${where} category 未声明：${String(record.category)}`)
    assert.ok(SKILL_ICONS.has(record.icon), `${where} icon 未声明：${String(record.icon)}`)
    assert.ok(Number.isInteger(record.hue), `${where} hue 必须是整数（读到 ${String(record.hue)}）`)
    assert.equal(typeof record.featured, 'boolean', `${where} featured 必须是布尔`)
    assert.equal(typeof record.role, 'string', `${where} role 必须是字符串`)
    assert.equal(typeof record.slot, 'string', `${where} slot 必须是字符串`)
    for (const key of ['demo', 'h3', 'hidden']) {
      if (key in record) assert.ok(['string', 'boolean'].includes(typeof record[key]), `${where} ${key} 类型非法`)
    }
  }
})

test('CV-324：三方一致 —— 目录名 = platform.yaml name = SKILL.md frontmatter name', () => {
  for (const name of SKILL_DIRS) {
    const record = platformRecords.get(name)
    if (record === undefined) continue
    assert.equal(record.name, name, `skills/${name}/platform.yaml 的 name 必须与目录名逐字一致`)
    const skillMd = join(SKILLS_DIR, name, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    assert.equal(
      frontmatterName(readFileSync(skillMd, 'utf8')),
      name,
      `skills/${name}/SKILL.md 的 frontmatter name 与目录名不一致`,
    )
  }
})

test('CV-324：无重复条目、无幽灵条目（platform.yaml ↔ 已注册 skill 两向都查）', () => {
  const names = [...platformRecords.values()].map((record) => record.name)
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
  assert.deepEqual([...new Set(duplicates)], [], `platform.yaml 里有重复 name：${[...new Set(duplicates)].join(', ')}`)

  const declared = new Set(SKILL_DIRS)
  const unregistered = names.filter((name) => !declared.has(name))
  assert.deepEqual(unregistered, [], `platform.yaml 指向不存在的目录：${unregistered.join(', ')}`)

  // 反向：有 SKILL.md（⇒ 已注册）却没有 platform.yaml 的目录，由第 1 条测试兜底；
  // 这里查的是「注册了但没声明」——即漏写 platform.yaml 又把目录改名的幽灵态。
  const declaredSet = new Set(names)
  const ghosts = MINIMAX_SKILL_NAMES.filter((name) => !declaredSet.has(name))
  assert.deepEqual(ghosts, [], `以下已注册 skill 没有 platform.yaml（广场上点不到）：${ghosts.join(', ')}`)
})

test('CV-324：role/slot 取值合法，且每个能力槽位至多一个知识型 skill（内置优先的机械保证）', () => {
  const occupied = new Map()
  for (const [name, record] of platformRecords) {
    const where = `skills/${name}/platform.yaml`
    assert.ok(PLATFORM_ROLES.includes(record.role), `${where} role 非法：${String(record.role)}`)
    assert.ok(PLATFORM_SLOTS.includes(record.slot), `${where} slot 非法：${String(record.slot)}`)
    // 决策型不占槽位：同一项目只能选一条路线，槽位是给「查表型」知识 skill 的。
    if (record.role !== 'knowledge' || record.slot === 'general') continue
    const previous = occupied.get(record.slot)
    assert.equal(
      previous,
      undefined,
      `槽位 ${String(record.slot)} 被两个知识型 skill 占用：${String(previous)} 与 ${name}（先到先得，另一个该换 slot 或改 general）`,
    )
    occupied.set(record.slot, name)
  }
  // 6 个能力槽位必须都有内置实现 —— 用户上传只能顶替「空槽位」，
  // 内置实现被误改成 general 会让槽位静默空掉，绑定表随之断链。
  const boundSlots = PLATFORM_SLOTS.filter((slot) => slot !== 'orchestration' && slot !== 'general')
  const emptySlots = boundSlots.filter((slot) => !occupied.has(slot))
  assert.deepEqual(emptySlots, [], `以下能力槽位没有内置实现：${emptySlots.join(', ')}`)
})

test('CV-324 删除保护：meta.yaml 里不许出现任何平台展示字段名（它是上游署名载体）', () => {
  // 拦的是**键名**：`slot: video-prompt` 里的 `video-prompt` 是取值，不在拦的范围；
  // 真正要拦的是有人把 `role:` / `slot:` 这类平台字段写进署名文件。
  const forbidden = new RegExp(`^\\s*(${[...PLATFORM_KEYS, 'role', 'slot'].join('|')}):`, 'mu')
  const metas = SKILL_DIRS
    .map((name) => join(SKILLS_DIR, name, 'meta.yaml'))
    .filter((file) => existsSync(file))
  assert.ok(metas.length > 0, '一份 meta.yaml 都没有 —— 上游署名载体疑被整体删除')
  for (const file of metas) {
    const hit = forbidden.exec(readFileSync(file, 'utf8'))
    assert.equal(
      hit,
      null,
      `${file.replace(`${ROOT}/`, '')} 里出现了平台展示字段「${String(hit?.[0] ?? '').trim()}」——` +
        '展示元数据只许放 platform.yaml；meta.yaml 是上游 MiniMax-H3 署名（author/source/version）的唯一载体',
    )
  }
})

test('CV-324：渲染器内嵌快照与 platform.yaml 逐字段相等（浏览器无文件系统，只能用这份副本）', () => {
  // 读盘失败时 SKILL_CATALOG 就是快照，下面那些比对会**假绿**（两边都是快照）。
  // 所以先钉住路径本身。
  assert.equal(
    CATALOG_SOURCE,
    'platform-yaml',
    'SKILL_CATALOG 没有从 skills/<name>/platform.yaml 读到（退回内嵌快照了）——' +
      '本文件的比对会因此假绿，先查 skills/ 是否可读、platform.yaml 是否能解析',
  )
  const bundled = new Map(BUNDLED_CATALOG.map((entry) => [entry.name, entry]))
  for (const [name, record] of platformRecords) {
    const entry = SKILL_CATALOG.find((candidate) => candidate.name === name)
    assert.ok(entry !== undefined, `运行期 catalog 缺 ${name} —— platform.yaml 没被读到`)
    const snapshot = bundled.get(name)
    assert.ok(snapshot !== undefined, `BUNDLED_CATALOG 快照缺 ${name} —— 渲染器上这张卡不存在`)
    // role/slot 不进 SkillCatalogEntry，比较时显式剔掉。
    for (const key of PLATFORM_KEYS) {
      assert.deepEqual(
        entry[key],
        snapshot[key],
        `skills/${name}/platform.yaml 改了 ${key}，但 BUNDLED_CATALOG 快照还是旧值` +
          `（${String(entry[key])} vs ${String(snapshot[key])}）`,
      )
    }
  }
  // 整表对比（含顺序）：平台新增 skill 却没同步快照时，渲染器上就是「少一张卡」。
  assert.deepEqual(
    [...SKILL_CATALOG].map((entry) => entry.name),
    [...BUNDLED_CATALOG].map((entry) => entry.name),
    'platform.yaml 的 skill 集合/顺序与 BUNDLED_CATALOG 快照不一致 ——' +
      '渲染器没有文件系统，快照没同步 = 广场静默少卡（改完 platform.yaml 请同步快照）',
  )
})

test('CV-317 同类语义门禁：展示文案不得引用已下线的审批门（它们会直接出现在广场卡片上）', () => {
  // 已下线的审批门：REQ-022 起剧本审批 / 分镜审批两门退役，
  // 现行唯一的对话流审批门是关键帧确认（src/approval-gate.ts）。
  // 注意判据是「具体的门/工具名」，不是「审批」二字 —— 审批语义本身仍然存在。
  const RETIRED = [
    'submit_screenplay',
    'submit_storyboard_for_approval',
    'approve_screenplay',
    'approve_storyboard',
    '剧本审批',
    '剧本创作审批',
    '分镜审批',
    '分镜创作审批',
  ]
  for (const [name, record] of platformRecords) {
    const summary = String(record.summary ?? '')
    for (const retired of RETIRED) {
      assert.ok(
        !summary.includes(retired),
        `skills/${name}/platform.yaml 的 summary 引用了已下线的审批门「${retired}」：` +
          `「${summary}」—— REQ-022 起剧本审批 / 分镜审批已退役，改成现行流程（关键帧确认是唯一的审批门）`,
      )
    }
  }
})
