/**
 * canvas-studio-creation 创作规范 skill 的契约冒烟测试。
 * 事实源：skills-local/canvas-studio-creation/SKILL.md（本仓库自有的 skills-local
 * bundle，构建时由 sync 脚本合并进 skills/ 并随目录扫描注册）。
 * 校验：frontmatter 合法、内容覆盖工具链与核心规则、skills/ 同步副本与源一致。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills-local', 'canvas-studio-creation')
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

test('skill 注册输入：name kebab-case 且 description 非空 ≤500（registry 校验三条）', () => {
  assert.equal(meta.name, 'canvas-studio-creation', 'frontmatter name 应与目录名一致')
  assert.match(meta.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  assert.ok(meta.description && meta.description.length > 0, 'description 为空')
  // 注册时描述截断到 500 字符；保持在其内保证路由语义完整。
  assert.ok(meta.description.length <= 500, 'description 超 500 字符')
})

test('skill 内容：覆盖工具链与 upload 核心规则', () => {
  for (const tool of [
    'prompt_enhance',
    'ask_user_choice',
    'submit_storyboard_for_approval',
    'submit_keyframes_for_approval',
    'image_generate',
    'upload_image',
    'image2vl',
    'storyboard_generate',
    'storyboard_split',
    'video_generate',
    'video_composite',
    'compose_video',
    'write_script',
    'list_references',
    'music_generation',
    'tts_voiceover',
    'subtitle_burn',
  ]) {
    assert.ok(body.includes(tool), `缺少工具 ${tool}`)
  }
  assert.ok(body.includes('filename'), '缺少 filename 核心规则')
  assert.ok(body.includes('sourceUrls'), '缺少血缘箭头指引')
  assert.ok(body.includes('shotRefs'), '缺少分镜卡关联指引')
})

test('skill 内容：包含 P7 审批门禁协议、五要素点选澄清与 H3 提示词规范', () => {
  assert.ok(body.includes('逐步确认'), '缺少执行模式说明')
  assert.ok(body.includes('放手跑'), '缺少放手跑模式说明')
  assert.ok(body.includes('批准'), '缺少审批等待说明')
  for (const element of ['时长', '画幅', '风格', '节奏', '受众']) {
    assert.ok(body.includes(element), `缺少澄清要素 ${element}`)
  }
  assert.ok(body.includes('禁止用纯文本列表提问'), '缺少点选式提问约束')
  assert.ok(body.includes('multiSelect'), '缺少多选参数指引')
  assert.ok(body.includes('integrated_multimodal_description'), '缺少 H3 三字段结构')
})

test('skill 内容：包含分镜表格式与镜头词汇', () => {
  assert.ok(body.includes('分镜表'), '缺少分镜表格式')
  for (const term of ['景别', '镜头运动', 'aspectRatio', 'duration']) {
    assert.ok(body.includes(term), `缺少镜头词汇 ${term}`)
  }
})

test('同步一致性：skills/ 内的副本与 skills-local 源逐字节一致（build 后有效）', () => {
  const synced = join(ROOT, 'skills', 'canvas-studio-creation', 'SKILL.md')
  if (!existsSync(synced)) return // sync 脚本未跑过（submodule 缺失等），跳过
  assert.ok(readFileSync(SKILL_FILE).equals(readFileSync(synced)), 'skills/ 副本与 skills-local 源不一致，重跑 build 同步')
})
