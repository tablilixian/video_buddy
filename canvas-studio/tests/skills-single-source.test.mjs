/**
 * 技能内容单一事实源守卫（2026-09-17 整合）。
 *
 * 背景：skill 内容原先来自两处——pinned 上游 submodule 的逐字节同步 +
 * `skills-local/` 的覆盖合并——`skills/` 是二者的并集产物。整合后 `skills/` 升为
 * 唯一手写源（其内容已逐字节包含原 skills-local 全部文件，故迁移零内容损失），
 * 上游 checkout、sync 脚本与 `skills-local/` 目录一并移除。
 *
 * 守护四件事，任一回退即红：
 * 1. 事实源唯一：`skills-local/` 目录与 sync 脚本都不存在；
 * 2. build 首步不再是 skill 同步；
 * 3. 无上游依赖：源码 / 脚本 / 配置 / 根启动脚本里不得再出现上游 submodule 名
 *    （比较前剥离注释：注释里写旧路径不算违规，但「只删注释」也不算真修好）；
 * 4. 导入完整性：上游独有的 8 件 meta.yaml（上游署名 author/source/version 的
 *    唯一载体）与 5 件被正文引用的 references 在位。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(ROOT, '..')

/** 本守卫自身：正文必须写出被禁的 submodule 名，故按文件名从扫描面排除。 */
const SELF_NAME = 'skills-single-source.test.mjs'

/** 被禁止再出现的上游 submodule 名（小写连字符形式；大写品牌名不在此列）。 */
const FORBIDDEN = ['minimax-h3', 'minimax_h3']

const SCAN_DIRS = [
  { dir: join(ROOT, 'src'), exts: ['.ts', '.tsx'] },
  { dir: join(ROOT, 'scripts'), exts: ['.mjs', '.ts'] },
  { dir: join(ROOT, 'tests'), exts: ['.mjs'] },
  { dir: join(REPO_ROOT, 'scripts'), exts: ['.mjs'] },
]

const SCAN_FILES = [
  join(ROOT, 'package.json'),
  join(ROOT, 'cordis.patch.yml'),
  join(REPO_ROOT, 'start-canvas-studio.sh'),
  join(REPO_ROOT, '.gitmodules'),
]

/** 上游独有、但被 SKILL.md 正文点名的 references（不再有 submodule 兜底，删了就断链）。 */
const UPSTREAM_REFS = [
  '3d-animation-short-generator/references/storyboard-guidelines.md',
  'co-op-game-intro-generator/references/h3-confirmation-image-template.md',
  'co-op-game-intro-generator/references/h3-video-prompt-template.md',
  'h3-prompt-writing/references/base-en.txt',
  'h3-prompt-writing/references/ref-en.txt',
]

/** 上游独有的 8 件 meta.yaml（h3-prompt-writing 上游即无此文件）。 */
const UPSTREAM_META = [
  '3d-animation-short-generator',
  'brand-promo-video-generator',
  'co-op-game-intro-generator',
  'handdrawn-live-video-generator',
  'minimalist-product-ad-generator',
  'music-video-subtitle-generator',
  'paper-collage-explainer-generator',
  'papercraft-stop-motion-explainer',
]

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, exts, out)
    else if (entry.name !== SELF_NAME && exts.some((ext) => entry.name.endsWith(ext))) out.push(path)
  }
  return out
}

/**
 * 剥离块注释与整行注释（块注释、`//` 整行、`*` 续行、`#` 整行）。
 * 只剥整行 `//`、不动行内 —— 否则会把 `https://…` 后半段当注释吃掉，
 * 让「URL 里残留 submodule 名」这类真实违规漏检。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|#|\*)/u.test(line))
    .join('\n')
}

test('单一事实源：skills-local/ 目录与 skill 同步脚本都不存在', () => {
  assert.equal(
    existsSync(join(ROOT, 'skills-local')),
    false,
    'skills-local/ 已被 skills/ 取代，不应重新出现（skills/ 是唯一手写源）',
  )
  assert.equal(
    existsSync(join(ROOT, 'scripts', 'sync-minimax-skills.mjs')),
    false,
    'skill 同步脚本已删除：skills/ 不再由任何脚本生成',
  )
})

test('build 链第一步不再是 skill 同步', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const build = pkg.scripts?.build ?? ''
  assert.ok(build.length > 0, 'build 脚本缺失')
  assert.equal(build.includes('sync-minimax-skills'), false, `build 仍在跑 skill 同步：${build}`)
  assert.ok(build.startsWith('node scripts/clean.mjs'), `build 首步应为 clean：${build}`)
})

test('无上游依赖：源码 / 脚本 / 配置 / 根启动脚本里没有上游 submodule 名', () => {
  const files = [...SCAN_DIRS.flatMap(({ dir, exts }) => walk(dir, exts)), ...SCAN_FILES]
  assert.ok(files.length > 20, `扫描面过窄（仅 ${files.length} 个文件），守卫形同虚设`)
  const hits = []
  for (const file of files) {
    if (!existsSync(file)) continue
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const name of FORBIDDEN) {
      if (text.includes(name)) hits.push(`${relative(REPO_ROOT, file)} → ${name}`)
    }
  }
  assert.deepEqual(hits, [], `以下位置仍在引用上游 submodule（应改为读取本仓 skills/）：\n${hits.join('\n')}`)
})

test('导入完整性：8 件上游 meta.yaml 在位且带署名（署名载体，勿删）', () => {
  for (const name of UPSTREAM_META) {
    const meta = join(ROOT, 'skills', name, 'meta.yaml')
    assert.ok(
      existsSync(meta),
      `skills/${name}/meta.yaml 缺失 —— 它是上游署名（author/source/version）的唯一载体`,
    )
    assert.match(
      readFileSync(meta, 'utf8'),
      /author-en:|author:/u,
      `skills/${name}/meta.yaml 缺署名信息`,
    )
  }
})

test('导入完整性：5 件上游独有的被引用 references 在位', () => {
  for (const rel of UPSTREAM_REFS) {
    assert.ok(
      existsSync(join(ROOT, 'skills', rel)),
      `skills/${rel} 缺失 —— SKILL.md 正文引用它，渐进披露会断链`,
    )
  }
})
