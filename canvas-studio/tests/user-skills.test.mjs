/**
 * CV-332 / CV-333：用户 skill 落盘实现（`src/user-skills.ts`）的行为断言。
 *
 * ## 隔离前提（本文件最重要的一条）
 *
 * `userSkillsRoot()` = `<DSH_HOME>/skills`。本文件在**模块作用域**把 `DSH_HOME`
 * 指向一个 `mkdtempSync` 出来的临时目录，并且在第一条用例里**断言它确实指过去了**。
 * 没有这条断言，一次环境变量拼错就会让测试往用户真实的 `~/.videobuddy/skills`
 * 里写文件、甚至清空真实回收站 —— 而这类破坏是静默的、事后极难追溯的。
 *
 * ## 每条用例自带前置（不依赖执行顺序）
 *
 * 落盘类用例通过 `ensureSkill()` 幂等地准备自己的样本，因此**单独跑某一条也成立**
 * （测试文件里的用例之间不应存在隐式顺序依赖 —— 那会让「只跑一条」时的失败无法复现）。
 *
 * ## 覆盖的三类失效
 *
 * 1. **落盘不原子**：写了一半就失败 ⇒ 留下半份 skill（上游会拿它当合法 skill 装载）。
 * 2. **删除不可逆**：`rm` 而非「移入回收站」⇒ 用户误删无法挽回。
 * 3. **生效判定的三态混淆**：把「还没扫完」（`complete:false`）显示成「没进目录」，
 *    或把「被同名内置顶掉」显示成「已生效」—— 前者是假警报，后者是假绿。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ⚠️ 必须在调用任何 user-skills 函数之前改好：`dshHomePath` 每次调用都读 env。
const SANDBOX = mkdtempSync(join(tmpdir(), 'cs-user-skills-'))
process.env.DSH_HOME = SANDBOX

const {
  TRASH_DIR, countProjectsLoadingSkill, emptySkillTrash, listUserSkills, relativePathsOf,
  skillNameOfSlug, trashEntryCount, trashUserSkill, userSkillsRoot, writeUserSkill,
} = await import(join(ROOT, 'lib', 'user-skills.js'))

const SKILL_MD = (name, extra = '') => [
  '---',
  `name: ${name}`,
  'role: knowledge',
  `description: ${name} 的一句话说明。`,
  ...(extra === '' ? [] : [extra]),
  '---',
  '',
  '# 正文',
  '',
].join('\n')

/** 一份标准落盘内容（入口 + 一个 references/ 文件）。 */
const filesOf = (name) => [
  { path: 'SKILL.md', text: SKILL_MD(name) },
  { path: 'references/basics.md', text: '# 基础\n' },
]

/** 幂等准备：目标已存在就当作已完成（用例之间不互相依赖）。 */
async function ensureSkill(slug) {
  try {
    await writeUserSkill(slug, filesOf(slug))
  } catch (error) {
    if (error.name !== 'SkillExistsError') throw error
  }
}

/** 假 catalog（窄接口，不需要真上游）。 */
const reader = (skills, complete = true) => ({ snapshot: async () => ({ skills, complete }) })
const builtin = (name) => ({ name, description: '内置条目', source: 'bundled' })
const userDsh = (name) => ({ name, description: '用户条目', source: 'user-dsh' })

after(() => {
  rmSync(SANDBOX, { recursive: true, force: true })
})

test('守卫：DSH_HOME 必须被指向临时目录（否则本文件会写用户真实 home）', () => {
  const root = userSkillsRoot()
  assert.ok(
    root.startsWith(SANDBOX + sep),
    `userSkillsRoot() 落在 \`${root}\`，不在沙箱 \`${SANDBOX}\` 内 —— 立即停止，`
      + '否则本文件会往用户真实 skills 目录写入 / 删除文件',
  )
  assert.ok(root.endsWith(`${sep}skills`), '用户 skill 落点必须是 <DSH_HOME>/skills')
})

// ─────────────────────────── 原子写 ───────────────────────────

test('CV-332：writeUserSkill 落盘到 <root>/<slug>/，且不留临时目录', async () => {
  const result = await writeUserSkill('night-noir-lighting', filesOf('night-noir-lighting'))
  assert.equal(result.trashedTo, null, '首次写入不该产生回收站条目')

  const root = userSkillsRoot()
  assert.ok(statSync(join(root, 'night-noir-lighting', 'SKILL.md')).isFile(), '入口没落盘')
  assert.ok(statSync(join(root, 'night-noir-lighting', 'references', 'basics.md')).isFile(), '子目录文件没落盘')

  const leftovers = readdirSync(root).filter(entry => entry.startsWith('.incoming-'))
  assert.deepEqual(leftovers, [], 'rename 成功后临时目录必须已消失（残留 = 半份 skill 会被上游当合法条目装载）')
})

test('CV-332：writeUserSkill 对非法 slug 直接抛错（不构造路径）', async () => {
  for (const bad of ['Bad Slug', '../escape', '.trash', 'a']) {
    await assert.rejects(
      () => writeUserSkill(bad, filesOf('x')),
      `非法 slug \`${bad}\` 竟被接受 —— 这等于让用户指定写入路径`,
    )
  }
})

test('CV-332：目标已存在且未授权覆盖 → SkillExistsError（不静默覆盖）', async () => {
  const slug = 'dup-skill'
  await ensureSkill(slug)
  await assert.rejects(
    () => writeUserSkill(slug, filesOf(slug)),
    (error) => {
      assert.equal(error.name, 'SkillExistsError', '冲突必须以专用错误类型暴露，路由才能转成 CS-SKILL-007')
      assert.match(error.message, new RegExp(slug), '错误信息没点名冲突的 slug')
      return true
    },
  )
})

test('CV-332：overwrite 时旧版本移入回收站（可恢复），并返回 trashedTo', async () => {
  const slug = 'overwrite-me'
  await ensureSkill(slug)
  const result = await writeUserSkill(
    slug,
    [{ path: 'SKILL.md', text: SKILL_MD(slug, 'version: 2') }],
    { overwrite: true },
  )
  assert.ok(result.trashedTo, '覆盖时没有把旧版本放进回收站 —— 用户失去恢复途径')
  assert.ok(result.trashedTo.includes(TRASH_DIR), 'trashedTo 不在回收站目录里')
  assert.ok(result.trashedTo.includes(slug), 'trashedTo 没带原 slug，用户认不出是哪一个')
})

// ─────────────────────────── 回收站 ───────────────────────────

test('CV-332：trashUserSkill 移入 .trash/<slug>-<时间戳>，原路径消失', async () => {
  const slug = 'to-be-deleted'
  await ensureSkill(slug)
  const { trashedTo } = await trashUserSkill(slug)

  assert.ok(statSync(trashedTo).isDirectory(), '回收站目标目录不存在 —— 用户无法恢复')
  assert.throws(
    () => statSync(join(userSkillsRoot(), slug)),
    '原目录还在 —— 删除没生效（用户会看到「点了删除但卡片还在」）',
  )
})

test('CV-332：trashUserSkill 对不存在的 slug 抛错（不静默成功）', async () => {
  await assert.rejects(() => trashUserSkill('never-existed'), '删一个不存在的 skill 竟成功了 —— UI 会显示假的成功提示')
})

test('CV-332：emptySkillTrash 清空并计数；回收站不存在时返回 0', async () => {
  // 自带前置：造两个回收站条目（不依赖别的用例跑过）
  for (const slug of ['trash-a', 'trash-b']) {
    await ensureSkill(slug)
    await trashUserSkill(slug)
  }
  assert.ok(await trashEntryCount() >= 2, '前置条件不成立：刚移入的条目没被计入回收站')

  const { removed } = await emptySkillTrash()
  assert.ok(removed >= 2, `清空了 ${String(removed)} 条，至少应有 2 条 —— 计数口径与目录枚举不一致`)
  assert.equal(await trashEntryCount(), 0, '清空后仍有残留')

  // 幂等：再清一次是 0，不抛错
  assert.deepEqual(await emptySkillTrash(), { removed: 0 })
})

// ─────────────── 生效判定：三态（found / conflict / missing·unknown） ───────────────

test('CV-332：catalog 收录且 source 是 user-dsh → found；装载了才 active', async () => {
  const slug = 'found-skill'
  await ensureSkill(slug)

  const idle = await listUserSkills(reader([userDsh(slug)]))
  assert.equal(idle.complete, true)
  assert.equal(idle.skillsRoot, userSkillsRoot())
  const item = idle.items.find(i => i.name === slug)
  assert.ok(item, '已落盘且被 catalog 收录的 skill 没出现在列表里')
  assert.equal(item.status, 'idle')
  assert.equal(item.catalogState, 'found')

  const active = await listUserSkills(reader([userDsh(slug)]), { loaded: [slug] })
  assert.equal(active.items.find(i => i.name === slug).status, 'active')
})

test('CV-332：被同名内置顶掉（source 非 user-dsh）→ conflict，并点名赢家', async () => {
  const slug = 'found-skill'
  await ensureSkill(slug)
  const view = await listUserSkills(reader([builtin(slug)]), { loaded: [slug] })
  const item = view.items.find(i => i.name === slug)
  assert.ok(item, '用户上传过的 skill 从列表里消失了 —— 只看 snapshot 会丢掉「被顶掉」这个最该展示的状态')
  assert.equal(item.catalogState, 'conflict')
  assert.equal(item.status, 'conflict')
  assert.equal(item.conflictWith, slug, '没告知用户是被谁顶掉的')
})

test('CV-332：catalog 里没有且 complete:true → missing（真的没进目录）', async () => {
  const slug = 'found-skill'
  await ensureSkill(slug)
  const view = await listUserSkills(reader([]))
  const item = view.items.find(i => i.name === slug)
  assert.equal(item.catalogState, 'missing')
  assert.equal(item.status, 'idle')
})

test('CV-332：catalog 里没有但 complete:false → unknown，**不许**显示成 missing', async () => {
  // 这是「导入后头 200ms」的真实形态：Chokidar 还没扫完。当成 missing 就是一次假警报。
  await ensureSkill('found-skill')
  const view = await listUserSkills(reader([], false))
  assert.equal(view.complete, false)
  assert.ok(view.items.length > 0, '前置条件不成立：应有已落盘的条目可比对')
  for (const item of view.items) {
    assert.equal(item.catalogState, 'unknown', `${item.name} 被标成了 ${item.catalogState}，扫描未完成时会误导用户`)
  }
})

test('CV-332：snapshot 抛错 → complete:false（不假装「什么都没有」）', async () => {
  await ensureSkill('found-skill')
  const broken = { snapshot: async () => { throw new Error('provider exploded') } }
  const view = await listUserSkills(broken)
  assert.equal(view.complete, false, '发现失败被吞成「成功且为空」—— UI 会显示「你没有上传过任何 skill」')
  assert.ok(view.items.length > 0, '发现失败不该影响「我上传过哪些」（那份事实来自目录枚举）')
  for (const item of view.items) assert.equal(item.catalogState, 'unknown')
})

// ─────────────────────── 列表的两个数据源 ───────────────────────

test('CV-332：目录枚举不把 .trash 与 .incoming-* 当 skill 列出', async () => {
  const root = userSkillsRoot()
  mkdirSync(join(root, TRASH_DIR, 'ghost-skill'), { recursive: true })
  writeFileSync(join(root, TRASH_DIR, 'ghost-skill', 'SKILL.md'), SKILL_MD('ghost-skill'))
  mkdirSync(join(root, '.incoming-1'), { recursive: true })
  writeFileSync(join(root, '.incoming-1', 'SKILL.md'), SKILL_MD('half-written'))

  const view = await listUserSkills(reader([]))
  const names = view.items.map(i => i.name)
  assert.ok(!names.includes('ghost-skill'), '回收站里的 skill 被当成了生效条目')
  assert.ok(!names.includes('half-written'), '写了一半的临时目录被当成了生效条目')
})

test('CV-332：读不到正文时仍列出（用 slug 兜底），不静默丢条目', async () => {
  const root = userSkillsRoot()
  // SKILL.md 是个**目录**：stat 通过（所以列表认为它存在），readFile 抛 EISDIR。
  mkdirSync(join(root, 'weird-skill', 'SKILL.md'), { recursive: true })

  const view = await listUserSkills(reader([]))
  const item = view.items.find(i => i.slug === 'weird-skill')
  assert.ok(item, '读不到正文的 skill 被静默丢弃 —— 用户需要知道它存在')
  assert.equal(item.name, 'weird-skill', '正文读不到时没有回落 slug')
  assert.equal(item.origin, 'user')
})

test('CV-332：builtinCount 原样带回（UI 显示「官方 N · 我的 M」）', async () => {
  const view = await listUserSkills(reader([]), { builtinCount: 16 })
  assert.equal(view.builtinCount, 16)
  assert.equal((await listUserSkills(reader([]))).builtinCount, 0)
})

// ─────────────────────── 辅助函数 ───────────────────────

test('CV-332：skillNameOfSlug 读注册名；非法 slug / 不存在 → null', async () => {
  await ensureSkill('found-skill')
  assert.equal(await skillNameOfSlug('found-skill'), 'found-skill')
  assert.equal(await skillNameOfSlug('Bad Slug'), null)
  assert.equal(await skillNameOfSlug('never-existed'), null)
})

test('CV-332：countProjectsLoadingSkill 跨项目统计，失败按 0 且互不牵连', async () => {
  const roster = {
    list: async () => [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    readActiveSkills: async (id) => {
      if (id === 'p1') return ['found-skill']
      if (id === 'p2') throw new Error('项目损坏')
      return []
    },
  }
  assert.equal(await countProjectsLoadingSkill(roster, 'found-skill'), 1)

  const broken = { list: async () => { throw new Error('清单不可读') }, readActiveSkills: async () => [] }
  assert.equal(
    await countProjectsLoadingSkill(broken, 'found-skill'), 0,
    '清单读不到时应按 0 而不是抛错 —— 删除动作不该因此被阻塞',
  )
})

test('CV-332：relativePathsOf 只回相对路径清单（导入完成页展示用）', () => {
  assert.deepEqual(relativePathsOf(filesOf('x')), ['SKILL.md', 'references/basics.md'])
})
