/**
 * CV-333：导入校验层（结构 + 规模）的判据。
 *
 * ## 为什么单独一个测试文件
 *
 * `validateImport` 与 `validateUpload` 是**两层**、串行调用：前者管「文件结构与规模」，
 * 后者管「frontmatter 契约」。两层混在一个测试文件里会让「一条红到底属于哪层」需要
 * 读代码才能判断 —— 而这条判据恰恰是排障时第一个要问的问题。
 *
 * ## 覆盖的三类失效
 *
 * 1. **判据本身错**：合法目录被拒 / 非法目录被放行。
 * 2. **归位错**：该自动修正的（根级多余 .md）没修，或该拒的（多个入口）被静默挑一个。
 * 3. **规模闸漏**：四个上限（单文件 / 总量 / 文件数 / 深度）任一失效 ⇒ 一次导入
 *    就能把上百 MB 塞进 `<DSH_HOME>/skills`，而这是**用户的 home 目录**。
 *
 * 所有用例都是纯函数调用：不碰文件系统、不起服务。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const {
  AUX_DIR, ENTRY_FILE, IMPORT_LIMITS, TEXT_EXTENSIONS, hiddenPathsOf, normalizeRelativePath, validateImport,
} = await import(join(ROOT, 'lib', 'skill-import-validate.js'))

/** 一份**最小合法**的 SKILL.md 正文。 */
const SKILL_MD = [
  '---',
  'name: night-noir-lighting',
  'role: knowledge',
  'description: 夜戏黑色电影布光规范。',
  '---',
  '',
  '# 正文',
  '',
].join('\n')

const file = (path, text) => (text === undefined ? { path } : { path, text })

/** 便捷：一份「目录包」形态的合法导入。 */
const pack = (...extra) => [file(`${ENTRY_FILE}`, SKILL_MD), ...extra]

// ─────────────────── 路径归一化（逃逸折叠） ───────────────────

test('CV-333：normalizeRelativePath 折叠 `..` 与绝对路径（逃逸在数据模型上无处落脚）', () => {
  assert.equal(normalizeRelativePath('a/../../b'), 'b')
  assert.equal(normalizeRelativePath('../../../../etc/passwd'), 'etc/passwd')
  assert.equal(normalizeRelativePath('./x/./y'), 'x/y')
  assert.equal(normalizeRelativePath('/abs/path'), 'abs/path')
  assert.equal(normalizeRelativePath('windows\\style\\p'), 'windows/style/p')
  assert.equal(normalizeRelativePath(''), '')
})

test('CV-333：hiddenPathsOf 与 validateImport 用同一判据（任一段以 . 开头）', () => {
  const files = [file('.DS_Store'), file('.git/config'), file('a/.hidden/b.md'), file('SKILL.md', SKILL_MD)]
  assert.deepEqual(hiddenPathsOf(files), ['.DS_Store', '.git/config', 'a/.hidden/b.md'])
})

// ─────────────────────────── 结构层 ───────────────────────────

test('CV-333：一个文件都没有 → CS-SKILL-001，且提示要选什么', () => {
  const v = validateImport([])
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-001')
  assert.ok(v.reason.includes(ENTRY_FILE), '提示没告诉用户该选什么')
})

test('CV-333：目录包里没有入口 .md → CS-SKILL-001', () => {
  const v = validateImport([file('references/a.md', '# 参考'), file('photo.png')])
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-001')
})

test('CV-333：根级多个 .md → CS-SKILL-001（不静默挑一个）', () => {
  // ⚠️ 输入必须**不含** SKILL.md：有 SKILL.md 时其余根级 .md 属「该归位的辅助文件」
  // （devdoc §5.5 / U-8：自动移进 references/ + 一条 advisory），不是「多个候选入口」。
  const v = validateImport([file('a.md', SKILL_MD), file('extra.md', '# 另一份')])
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-001')
  assert.ok(v.reason.includes('a.md') && v.reason.includes('extra.md'), '提示没列出究竟是哪几个 .md 打架')
})

test('CV-333：单独一个 .md → 落成目录包 <slug>/SKILL.md（内容等价，行为一致）', () => {
  const v = validateImport([file('my-skill.md', SKILL_MD)])
  assert.equal(v.ok, true)
  assert.equal(v.slug, 'my-skill')
  assert.deepEqual(v.files.map(f => f.path), [ENTRY_FILE], '扁平 .md 应被归一成目录包形态的入口')
})

test('CV-333：剥离所有文件共有的顶层目录（目录选择器给的就是这种形态）', () => {
  const v = validateImport([
    file('night-noir-lighting/SKILL.md', SKILL_MD),
    file('night-noir-lighting/references/basics.md', '# 基础'),
  ])
  assert.equal(v.ok, true)
  assert.equal(v.slug, 'night-noir-lighting', 'slug 应取自共有的顶层目录名')
  assert.deepEqual(v.files.map(f => f.path).sort(), [ENTRY_FILE, 'references/basics.md'])
})

// ───────────────────────── 规模上限 ─────────────────────────

test('CV-333：文件数超过上限 → CS-SKILL-006', () => {
  const many = Array.from({ length: IMPORT_LIMITS.fileCount + 1 }, (_, i) => file(`references/f${String(i)}.md`, 'x'))
  const v = validateImport([...pack(...many)])
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-006')
  assert.ok(v.reason.includes(String(IMPORT_LIMITS.fileCount)), '提示没给出上限值')
})

test('CV-333：单文件超过上限 → CS-SKILL-006', () => {
  const big = 'a'.repeat(IMPORT_LIMITS.fileBytes + 1024)
  const v = validateImport(pack(file('references/big.md', big)))
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-006')
  assert.ok(v.reason.includes('big.md'), '提示没点名是哪个文件超了')
})

test('CV-333：合计超过上限（每个都没超单文件闸）→ CS-SKILL-006', () => {
  // 9 × 250KB = 2.25MB > 2MB；单个 250KB < 256KB，所以只有总量闸能拦住
  const chunk = 'a'.repeat(250 * 1024)
  const files = pack(...Array.from({ length: 9 }, (_, i) => file(`references/f${String(i)}.md`, chunk)))
  const v = validateImport(files)
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-006')
  assert.ok(v.reason.includes(String(IMPORT_LIMITS.totalBytes / 1024)), '提示没给出总量上限')
})

test('CV-333：目录深度超过上限 → CS-SKILL-006', () => {
  const deep = 'a/b/c/d/x.md' // 4 层 > depth 3
  const v = validateImport(pack(file(deep, '# 太深')))
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-006')
  assert.ok(v.reason.includes('references/'), '提示没给出正确做法（放 references/）')
})

test('CV-333：恰好卡在上限上的输入必须放行（闸是 >，不是 >=）', () => {
  const exactFile = 'a'.repeat(IMPORT_LIMITS.fileBytes)
  const v = validateImport(pack(file('references/exact.md', exactFile)))
  assert.equal(v.ok, true, '刚好等于单文件上限的文件被拒了 —— 闸用成了 >=')
})

// ─────────────────── 非文本与自动归位 ───────────────────

test('CV-333：非文本文件跳过并提示，不算失败（D6）', () => {
  const v = validateImport(pack(file('references/logo.png'), file('notes.txt', '# 文本')))
  assert.equal(v.ok, true)
  const skipped = v.advisories.find(a => a.kind === 'binary-skipped')
  assert.ok(skipped, '没提示跳过了哪些非文本文件')
  assert.deepEqual(skipped.files, ['references/logo.png'])
})

test('CV-333：根级多余 .md 自动归位 references/（上游会把它当独立 skill 试解析）', () => {
  const v = validateImport([file(ENTRY_FILE, SKILL_MD), file('notes.txt', '# 根级文本')])
  assert.equal(v.ok, true)
  const relocated = v.advisories.find(a => a.kind === 'root-md-relocated')
  assert.ok(relocated, '没提示自动归位')
  assert.deepEqual(relocated.files, ['notes.txt'])
  assert.deepEqual(
    v.files.map(f => f.path).sort(), [ENTRY_FILE, `${AUX_DIR}/notes.txt`],
    '根级文本没有真的被搬进 references/',
  )
})

test('CV-333：TEXT_EXTENSIONS 覆盖全部被接受的文本格式（与提示文案同源）', () => {
  for (const ext of ['.md', '.txt', '.json', '.yaml', '.yml']) {
    assert.ok(TEXT_EXTENSIONS.includes(ext), `${ext} 不在接受清单里，但提示文案说接受它`)
  }
})

// ─────────────────── slug 派生与契约层串接 ───────────────────

test('CV-333：slug 优先级 = 用户指定 > 共有顶层目录 > frontmatter name', () => {
  const dir = 'night-noir-lighting'
  const files = [file(`${dir}/SKILL.md`, SKILL_MD)]
  assert.equal(validateImport(files, { requestedSlug: 'mine' }).slug, 'mine', 'requestedSlug 优先级最高')
  assert.equal(validateImport(files).slug, dir, '没有 requestedSlug 时用目录名')
  assert.equal(validateImport([file('SKILL.md', SKILL_MD)]).slug, 'night-noir-lighting', '无目录时用 frontmatter name')
})

test('CV-333：派生出的 slug 非法 → CS-SKILL-004（不静默改名）', () => {
  const v = validateImport([file('My Skill/SKILL.md', SKILL_MD)], { requestedSlug: 'Bad Slug' })
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-004')
})

test('CV-333：frontmatter 契约层的结果原样并入（不重复实现、不吞掉码）', () => {
  const decision = [file(ENTRY_FILE, '---\nname: my-skill\nrole: decision\ndescription: 说明。\n---\n')]
  const v = validateImport(decision)
  assert.equal(v.ok, false)
  assert.equal(v.code, 'CS-SKILL-003', '结构层吞掉/改写了契约层的错误码')
  assert.ok(Array.isArray(v.advisories), '拒绝时也要带回已发现的 advisories（UI 要显示「还差哪一步」）')
})

test('CV-333：被跳过 / 归位之外，合法输入的落盘内容必须逐字等于输入（唯一起点）', () => {
  const v = validateImport(pack(file('references/a.md', '# A')))
  assert.equal(v.ok, true)
  const entry = v.files.find(f => f.path === ENTRY_FILE)
  assert.equal(entry.text, SKILL_MD, '入口正文被改写了 —— 落盘必须逐字等于用户给的内容')
})

test('CV-333：meta 从 frontmatter 派生，非法 category / icon 回落而不拒绝（D7）', () => {
  const v = validateImport([
    file(ENTRY_FILE, '---\nname: my-skill\nrole: knowledge\ndescription: 说明。\ncategory: 不存在的分类\nicon: 不存在的图标\n---\n'),
  ])
  assert.equal(v.ok, true, '展示字段非法不该挡用户的路')
  assert.equal(v.meta.category, 'other')
  assert.equal(v.meta.icon, null)
  assert.equal(v.meta.slot, null, '没写 slot 时展示标签应为 null')
})
