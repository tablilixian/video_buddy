/**
 * canvas-studio-creation 创作规范 skill 的契约冒烟测试。
 * 事实源：skills/canvas-studio-creation/SKILL.md（本仓库唯一源，随目录扫描注册）。
 * 校验：frontmatter 合法、内容覆盖工具链与核心规则。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL_DIR = join(ROOT, 'skills', 'canvas-studio-creation')
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

// CV-121 总纲拆分后，内容分册到 references/；内容覆盖类断言用「主文 + 全部分册」合并文本，
// 意图不变：规则只要还能被 agent 从本 skill 读到就算覆盖（防拆分时把规则弄丢）。
const refsDir = join(SKILL_DIR, 'references')
const full = existsSync(refsDir)
  ? body + '\n' + readdirSync(refsDir).filter(f => f.endsWith('.md')).map(f => readFileSync(join(refsDir, f), 'utf8')).join('\n')
  : body

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
    'video_generate',
    'video_composite',
    'compose_video',
    'write_script',
    'list_references',
    'music_generation',
    'tts_voiceover',
    'subtitle_burn',
  ]) {
    assert.ok(full.includes(tool), `缺少工具 ${tool}`)
  }
  assert.ok(full.includes('filename'), '缺少 filename 核心规则')
  assert.ok(full.includes('sourceUrls'), '缺少血缘箭头指引')
  assert.ok(full.includes('shotRefs'), '缺少分镜卡关联指引')
})

test('skill 内容：包含 P7 审批门禁协议、五要素点选澄清与 H3 提示词规范', () => {
  assert.ok(full.includes('逐步确认'), '缺少执行模式说明')
  assert.ok(full.includes('放手跑'), '缺少放手跑模式说明')
  assert.ok(full.includes('批准'), '缺少审批等待说明')
  for (const element of ['时长', '画幅', '风格', '节奏', '受众']) {
    assert.ok(full.includes(element), `缺少澄清要素 ${element}`)
  }
  assert.ok(full.includes('禁止用纯文本列表提问'), '缺少点选式提问约束')
  assert.ok(full.includes('multiSelect'), '缺少多选参数指引')
  assert.ok(full.includes('integrated_multimodal_description'), '缺少 H3 三字段结构')
})

test('skill 内容：包含分镜表格式与镜头词汇', () => {
  assert.ok(full.includes('分镜表'), '缺少分镜表格式')
  for (const term of ['景别', '镜头运动', 'aspectRatio', 'duration']) {
    assert.ok(full.includes(term), `缺少镜头词汇 ${term}`)
  }
})

/**
 * 工具登记完整性（2026-09-22 加 video2vl 时立的守卫）。
 *
 * 由来：加 `image_fix`（CV-202）时只补了正文节、漏了 api.md 的工具表，工具计数因此
 * 差了 1，直到本轮新增 `video2vl` 才被发现。**「工具加了、文档忘了」是这类改动最常见的
 * 漏项**，而这两份文档都是 agent 与人的第一入口。
 *
 * 判据取「**必须作为表格行登记**」而不是「文中出现过」：工具表才是可查的入口，一份只在
 * 段落里被顺带提一句、没有表格行的文档等于没登记（首版用子串判定，反向变异时漏红）。
 */
test('工具登记完整：每个注册工具都必须在 skill 分册与工具文档里各有一行登记', () => {
  const hostTools = readFileSync(join(ROOT, 'src', 'host-tools.ts'), 'utf8')
  const names = [...hostTools.matchAll(/^ {6}name: '([a-z_0-9]+)'/gmu)].map((match) => match[1])
  assert.ok(names.length >= 20, `解析出的工具数异常少（${names.length}）—— 正则或 defineTool 缩进变了？`)

  const targets = {
    'skill 分册 references/toolchain.md': readFileSync(join(SKILL_DIR, 'references', 'toolchain.md'), 'utf8'),
    'docs/canvas-studio-tools.md': readFileSync(join(ROOT, 'docs', 'canvas-studio-tools.md'), 'utf8'),
  }
  for (const [label, text] of Object.entries(targets)) {
    // 表格行的首格：`| video2vl | …` 或 `| \`video2vl\` | …`（两份文档的反引号习惯不同）。
    const rowed = new Set([...text.matchAll(/^\| *`?([a-z_0-9]+)`? *\|/gmu)].map((match) => match[1]))
    const missing = names.filter((name) => !rowed.has(name))
    assert.deepEqual(missing, [], `${label} 缺少这些工具的行登记：${missing.join('、')}`)
  }
})

