/**
 * MiniMax-H3 上游 skill 冒烟测试：
 * 1) 注册输入合法（name kebab-case、description 非空 ≤500、content 非空）；
 * 2) 零改编验证——content 与 minimax-h3 submodule 的 SKILL.cn.md 正文逐字一致。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MINIMAX_SKILL_NAMES } from '../lib/skills/minimax-skills.js'
import { MINIMAX_SKILL_ASSETS } from '../lib/skills/generated/minimax-skills.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 轻量 frontmatter 解析（与 sync 脚本同规则，零依赖）。 */
function stripFrontmatter(md) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(md)
  return match === null ? md.trimStart() : md.slice(match[0].length).trimStart()
}

test('注册输入：name kebab-case、description 非空 ≤500、content 非空', () => {
  assert.ok(MINIMAX_SKILL_NAMES.length > 0, '至少注册一个上游 skill')
  for (const asset of MINIMAX_SKILL_ASSETS) {
    assert.match(asset.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, `name 非法: ${asset.name}`)
    assert.ok(asset.description.length > 0, `${asset.name} description 为空`)
    assert.ok(asset.description.length <= 500, `${asset.name} description 超 500 字符`)
    assert.ok(asset.content.length > 0, `${asset.name} content 为空`)
  }
})

test('零改编验证：content 与 submodule SKILL.cn.md 正文逐字一致', () => {
  for (const asset of MINIMAX_SKILL_ASSETS) {
    const dir = join(ROOT, '..', 'minimax-h3', 'skills', asset.name)
    const cnPath = join(dir, 'SKILL.cn.md')
    const enPath = join(dir, 'SKILL.md')
    const mdPath = existsSync(cnPath) ? cnPath : (existsSync(enPath) ? enPath : null)
    assert.ok(mdPath !== null, `${asset.name} 源文件缺失`)
    const upstream = stripFrontmatter(readFileSync(mdPath, 'utf8'))
    assert.equal(asset.content, upstream, `${asset.name} 内容被改编（应逐字原样）`)
  }
})

test('content 结构：以 markdown 标题开头且长度合理', () => {
  for (const asset of MINIMAX_SKILL_ASSETS) {
    assert.ok(/^#\s/m.test(asset.content), `${asset.name} 缺 markdown 标题`)
    assert.ok(asset.content.length >= 1000, `${asset.name} content 过短（${asset.content.length} 字符）`)
  }
})
