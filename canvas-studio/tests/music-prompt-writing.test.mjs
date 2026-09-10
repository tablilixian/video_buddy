/**
 * CV-127：music-prompt-writing 技能（ACE Step / txt2audio 提示词规范）契约冒烟。
 *
 * 事实源：skills-local/music-prompt-writing/（sync 脚本合并进 skills/ 后随目录扫描注册）。
 * 校验：frontmatter 合法、主文覆盖工具与纯器乐默认路径、两个分册存在且含关键规则、
 * skills/ 同步副本与源一致。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills-local', 'music-prompt-writing')
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md')

/** 解析 frontmatter（name/description）与正文。 */
function parseSkill(md) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md)
  const meta = {}
  if (match !== null) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line)
      if (kv !== null) meta[kv[1]] = kv[2].trim()
    }
  }
  return { meta, body: match === null ? md.trimStart() : md.slice(match[0].length).trimStart() }
}

const raw = readFileSync(SKILL_FILE, 'utf8')
const { meta, body } = parseSkill(raw)

test('skill 注册输入：name 与目录名一致、description 非空 ≤500', () => {
  assert.equal(meta.name, 'music-prompt-writing', 'frontmatter name 应与目录名一致')
  assert.match(meta.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  assert.ok(meta.description && meta.description.length > 0, 'description 为空')
  assert.ok(meta.description.length <= 500, 'description 超 500 字符')
})

test('skill 主文：工具名、纯器乐默认路径与参数边界齐备', () => {
  for (const marker of ['music_generation', '[Instrumental]', 'duration', 'bpm', 'keyscale', 'timesignature', 'language']) {
    assert.ok(body.includes(marker), '主文缺少：' + marker)
  }
  // 渐进披露：两个分册必须被主文指名，否则 agent 不知道要读
  assert.ok(body.includes('tag-dictionary.md'), '主文缺少标签字典分册指针')
  assert.ok(body.includes('caption-lyrics-rules.md'), '主文缺少写法规则分册指针')
  // 硬规则：BPM 不写进 Caption、响应 duration 是耗时不是音频时长
  assert.ok(body.includes('禁止在 Caption 写 BPM'), '缺少「BPM 不写进 Caption」硬规则')
  assert.ok(body.includes('生成耗时'), '缺少「响应 duration 是生成耗时」警示')
  // CV-127b：软提示铁律——元数据可能被拒，必须靠 degradedFields 判断，不许产生错觉
  assert.ok(body.includes('degradedFields'), '主文缺少 degradedFields（降级回显）说明')
  assert.ok(body.includes('软提示'), '主文缺少「元数据是软提示」的说明')
})

test('分册：标签字典与写法规则各自存在且含关键内容', () => {
  const dict = join(SKILL_DIR, 'references', 'tag-dictionary.md')
  const rules = join(SKILL_DIR, 'references', 'caption-lyrics-rules.md')
  assert.ok(statSync(dict).size > 2000, '标签字典分册过小（疑似未写全）')
  assert.ok(statSync(rules).size > 2000, '写法规则分册过小（疑似未写全）')

  const dictText = readFileSync(dict, 'utf8')
  for (const tag of ['acoustic guitar and harmonica', 'hard rock', 'melancholic', 'C# minor', 'Ambient Electronic']) {
    assert.ok(dictText.includes(tag), '标签字典缺少：' + tag)
  }

  const rulesText = readFileSync(rules, 'utf8')
  for (const marker of ['[Chorus - anthemic]', '[Instrumental]', '音节', 'repainting_start', '6–10']) {
    assert.ok(rulesText.includes(marker), '写法规则缺少：' + marker)
  }
})

test('同步一致性：skills/ 内的副本与 skills-local 源逐字节一致（sync 后有效）', () => {
  const synced = join(ROOT, 'skills', 'music-prompt-writing', 'SKILL.md')
  if (!existsSync(synced)) return // sync 未跑过（submodule 缺失等），跳过
  assert.ok(readFileSync(SKILL_FILE).equals(readFileSync(synced)), 'skills/ 副本与源不一致，重跑 sync')
})
