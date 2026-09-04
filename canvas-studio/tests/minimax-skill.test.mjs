/**
 * MiniMax-H3 上游 skill 冒烟测试（目录式方案）：
 * 1) skills/ 目录与 minimax-h3 submodule 逐字一致（SKILL.md 字节级相同、references/ 文件集合与内容一致）；
 * 2) 注册输入合法（name kebab-case、description 非空 ≤500、content 非空、resourceBase 指向存在的目录）；
 * 3) 8 个风格 demo GIF 已同步进包内 assets/style-demos。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MINIMAX_SKILL_NAMES, MINIMAX_SKILLS_DIR, registerMinimaxSkills } from '../lib/skills/minimax-skills.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUBMODULE_SKILLS = resolve(ROOT, '..', 'minimax-h3', 'skills')

/** 上游全部 9 个 skill（h3-prompt-writing + 8 风格生成器）。 */
const EXPECTED_NAMES = [
  '3d-animation-short-generator',
  'brand-promo-video-generator',
  'co-op-game-intro-generator',
  'h3-prompt-writing',
  'handdrawn-live-video-generator',
  'minimalist-product-ad-generator',
  'music-video-subtitle-generator',
  'paper-collage-explainer-generator',
  'papercraft-stop-motion-explainer',
]

const submodulePresent = existsSync(join(SUBMODULE_SKILLS, '3d-animation-short-generator', 'SKILL.md'))

/** 收集 skills-local/<name>/ 的覆盖文件相对路径（顶层文件 + 二级目录文件，如 references/xxx.md）。 */
function localOverrideFiles(name) {
  const dir = join(ROOT, 'skills-local', name)
  const files = new Set()
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) files.add(entry.name)
    else if (entry.isDirectory()) {
      for (const file of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
        if (file.isFile()) files.add(`${entry.name}/${file.name}`)
      }
    }
  }
  return files
}

test('skills/ 目录包含全部 9 个上游 skill（skills-local 追加项允许额外存在）', () => {
  for (const name of EXPECTED_NAMES) {
    assert.ok(MINIMAX_SKILL_NAMES.includes(name), `上游 skill 缺失: ${name}`)
  }
})

test('verbatim 验证：上游 skill 与 submodule 逐字节一致（skills-local 覆盖文件除外）', { skip: !submodulePresent && 'minimax-h3 submodule 未初始化' }, () => {
  for (const name of EXPECTED_NAMES) {
    const srcDir = join(SUBMODULE_SKILLS, name)
    const dstDir = join(MINIMAX_SKILLS_DIR, name)
    // skills-local/<name>/ 中的文件是本仓库的 file-level overlay，允许与 submodule 不一致
    const overrides = localOverrideFiles(name)
    if (!overrides.has('SKILL.md')) {
      const upstream = readFileSync(join(srcDir, 'SKILL.md'))
      const copied = readFileSync(join(dstDir, 'SKILL.md'))
      assert.ok(upstream.equals(copied), `${name}/SKILL.md 与 submodule 不一致（应逐字节原样，或放入 skills-local/${name}/SKILL.md 覆盖）`)
    }
    // references/ 文件集合与内容逐字节一致（覆盖文件除外；dst 允许包含 overlay 新增文件）
    const srcRefs = join(srcDir, 'references')
    const dstRefs = join(dstDir, 'references')
    const srcFiles = existsSync(srcRefs) ? readdirSync(srcRefs).sort() : []
    const dstFiles = existsSync(dstRefs) ? readdirSync(dstRefs).sort() : []
    for (const file of srcFiles) {
      assert.ok(dstFiles.includes(file), `${name}/references/${file} 缺失`)
      if (overrides.has(`references/${file}`)) continue
      assert.ok(
        readFileSync(join(srcRefs, file)).equals(readFileSync(join(dstRefs, file))),
        `${name}/references/${file} 与 submodule 不一致（应逐字节原样，或放入 skills-local/${name}/references/${file} 覆盖）`,
      )
    }
  }
})

test('注册输入：name kebab-case、description 非空 ≤500、content 非空、resourceBase 指向存在的目录', () => {
  const registered = []
  const fakeCtx = {
    skills: {
      register(skill) {
        registered.push(skill)
        return () => { }
      },
    },
  }
  const dispose = registerMinimaxSkills(fakeCtx)
  assert.equal(typeof dispose, 'function')
  assert.equal(registered.length, MINIMAX_SKILL_NAMES.length, '注册数量应与 skills/ 目录一致')
  for (const skill of registered) {
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `name 非法: ${skill.name}`)
    assert.ok(skill.description.length > 0, `${skill.name} description 为空`)
    assert.ok(skill.description.length <= 500, `${skill.name} description 超 500 字符`)
    assert.ok(skill.content.length > 0, `${skill.name} content 为空`)
    assert.ok(/^#\s/m.test(skill.content), `${skill.name} content 缺 markdown 标题`)
    assert.equal(skill.source, 'runtime')
    assert.deepEqual(
      { kind: skill.resourceBase?.kind, path: skill.resourceBase?.path },
      { kind: 'directory', path: join(MINIMAX_SKILLS_DIR, skill.name) },
      `${skill.name} resourceBase 应指向 skills/<name>/ 目录`,
    )
    assert.ok(existsSync(join(skill.resourceBase.path, 'SKILL.md')), `${skill.name} resourceBase 目录缺少 SKILL.md`)
  }
})

test('渐进披露前提：所有 skill 正文引用的 references/ 文件真实存在', () => {
  for (const skill of MINIMAX_SKILL_NAMES) {
    const body = readFileSync(join(MINIMAX_SKILLS_DIR, skill, 'SKILL.md'), 'utf8')
    const tokens = [...body.matchAll(/references\/([a-z0-9./_-]+)/giu)].map((m) => m[1])
    for (const token of new Set(tokens)) {
      assert.ok(existsSync(join(MINIMAX_SKILLS_DIR, skill, 'references', token)), `${skill} 引用的 references/${token} 不存在于资源目录`)
    }
  }
})

test('S3：8 个风格 demo GIF 已同步进包内 assets/style-demos', () => {
  const demoDir = join(ROOT, 'assets', 'style-demos')
  let gifCount = 0
  for (const name of EXPECTED_NAMES) {
    if (name === 'h3-prompt-writing') continue // 无 demo GIF
    const gif = join(demoDir, `${name}.gif`)
    assert.ok(existsSync(gif), `${name}.gif 缺失`)
    gifCount += 1
  }
  assert.equal(gifCount, 8, '应有 8 个风格 demo GIF')
})
