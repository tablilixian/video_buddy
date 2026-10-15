/**
 * skill 工具引用语义门禁（CV-317）。
 *
 * ## 为什么有这道门
 *
 * 既有 5 道 skill 门禁（目录成员即注册 / 引用完整性 / kebab-case+description 长度 /
 * 截断哨兵 / catalog 双向断言）**全是结构门禁**：它们检查文件在不在、名字合不合法、
 * 长度够不够，但**不检查 skill 正文里引用的工具是否真的存在**。
 *
 * 后果（均为本轮实测确认的现存缺陷）：
 *   ① `canvas-studio-creation/SKILL.md` 的安全底线①引用 `submit_screenplay`
 *      ——该工具已随 REQ-022 下线（权威记录见 `src/approval-gate.ts:98-99`），
 *      即「风格 skill 不得绕过的安全底线」的第一条指向一个不存在的工具；
 *   ② 同文件「提交即停手（最重要的一条）」与放手跑两处写「三个 submit 工具」，
 *      与同文件 `:17` 的「唯一保留关键帧确认」自相矛盾；
 *   ③ `direct-street-interview-video` / `stage-startle-to-truce-encounter`
 *      写「总纲的 分镜 / 关键帧审批节奏」，而分镜门已下线。
 *
 * 结构门禁对上述三条全部无感。**只有语义对账能挡住。**
 *
 * ## 本门禁怎么工作
 *
 * 1. 从 `src/host-tools.ts` + `src/skills/placeholder-tools.ts` 提取**真实注册工具表**；
 * 2. 扫 `skills/**` 下全部 `.md` / `.txt` / `.yaml`，取 snake_case 词候选；
 * 3. 候选若不在注册表 → 查豁免表 → **仍不在即红**。
 *
 * ## 豁免表纪律
 *
 * 豁免表是本门禁最容易腐烂的地方，因此：
 *   - 按「为什么不是工具」分组，每组写明理由，禁止无理由放行；
 *   - `test('豁免表自身不腐烂')` 断言**每个豁免词在 skills/ 里真实出现过**——
 *     词被删干净后必须顺手移除豁免，否则门禁自身变成噪声源。
 *
 * 运行：`corepack yarn workspace canvas-studio test:smoke`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')

/** 本仓真实注册的工具表来源。占位工具已逐个转真或下线，故一并从源码取。 */
const TOOL_SOURCES = ['host-tools.ts', 'skills/placeholder-tools.ts']

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) collectFiles(p, out)
    else if (/\.(md|txt|yaml)$/u.test(entry)) out.push(p)
  }
  return out
}

/** 从源码提取真实注册的工具名（defineTool({ name: '...' })）。 */
export function registeredToolNames() {
  const names = new Set()
  for (const src of TOOL_SOURCES) {
    const text = readFileSync(join(ROOT, 'src', src), 'utf8')
    for (const m of text.matchAll(/\bname:\s*'([a-z][a-z0-9_]*)'/gu)) names.add(m[1])
  }
  return names
}

/**
 * 豁免表：**只登记「确知不是本仓工具」的词**，并按理由分组。
 * 新增豁免必须归入某一组并写清理由——这是本门禁唯一的放行通道。
 */
const EXEMPT = new Map(Object.entries({
  // ── 组 1：H3 视频提示词 IR 的**字段名**（prompt schema 里的 key，不是工具）
  'h3-ir-fields': [
    'overall_soundscape', 'subject_definitions', 'integrated_multimodal_description',
    'non_diegetic_music', 'retention_analysis', 'detailed_description', 'attribute_transfer',
    'weak_reference', 'fully_preserved', 'partially_preserved', 'fully_copy', 'partially_copy',
    'instruct_prompt', 'reference_audio', 'caption_prompt', 'lyrics_prompt', 'visual_style',
    'player1_name', 'player2_name', 'player1_ref', 'player2_ref', 'ui_ref', 'height_ref',
    'first_frame', 'main_background_color', 'ui_body_color', 'text_color',
    'functional_accent_color', 'character_count', 'game_title', 'social_premise',
    'on_camera_subject', 'interviewer_role', 'route_geometry', 'distance_change',
    'gesture_chain', 'camera_follow', 'light_behavior', 'resolved_state',
    'display_name', 'short_description', 'default_prompt', 'vocal_language',
    'src_audio', 'audio_codes',
  ],
  // ── 组 2：上游 MiniMax Hub 的工具名（本仓从未注册；实测 host-tools 中 hub_ 出现 0 次）
  'upstream-hub-tools': [
    'hub_generate_image', 'hub_generate_video', 'hub_generate_audio', 'hub_generate_music',
    'hub_image_search', 'hub_analyse_media', 'hub_synthesize_speech', 'hub_video_edit',
    'hub_canvas_get_node', 'hub_canvas_group_recent_outputs', 'hub_audio_meta',
    'upload_video',
  ],
  // ── 组 3：已下线工具的**历史记录**（skill 正文在说明它没了，不是在调用它）
  'deployed-tool-history': ['write_screenplay'],
  // ── 组 4：工具的**参数名**（出现在取值语境，不是被调用的对象）
  // 注：本组被「豁免表自身不腐烂」断言两次清过 —— CV-318 删 qwen-image-edit-writing
  // 后 guidance_scale 无处出现；CV-321b 把 brand-promo 的 generate_audio 下沉后同样无处出现。
  // 这正是该断言存在的意义：豁免表本身也是需要维护的代码，不是可以无限膨胀的逃生舱。
  'tool-parameter-names': [
    'file_path', 'image_url', 'video_url', 'audio_url', 'reference_video',
    'negative_prompt', 'job_id', 'repainting_start',
    'tts_cpm', 'style_transfer', 'image_generate_withtxt',
  ],
  // ── 组 5：后端工作流 / 模型档位标识（配置名，不是工具）
  'backend-workflow-ids': ['txt2image_withtxt', 'qwen_4view_char_2step', 'krea2_edit', 'krea2_quadview', 'krea2_workflow'],
  // ── 组 6：测试 fixture 里的**空断言**——断言「未调用过」的工具名，
  //         而它们从未注册，故该断言恒真。保留原样，记录此弱断言。
  'test-fixture-negative-assertions': ['storyboard_generate', 'storyboard_split'],
}))

/** 展开成词 → 理由的扁平表。 */
function exemptMap() {
  const m = new Map()
  for (const [reason, words] of EXEMPT) for (const w of words) m.set(w, reason)
  return m
}

/** 扫 skills/ 得到：词 → 出现它的文件集合。 */
export function scanSnakeCaseTokens() {
  const found = new Map()
  for (const file of collectFiles(SKILLS_DIR)) {
    const text = readFileSync(file, 'utf8')
    // 前后不接字母/数字/下划线/斜杠/点，避免把 xxx_yyy 的片段或路径切开
    for (const m of text.matchAll(/(?<![A-Za-z0-9_.\/-])([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?![A-Za-z0-9_-])/gu)) {
      const w = m[1]
      if (!found.has(w)) found.set(w, new Set())
      found.get(w).add(relative(ROOT, file))
    }
  }
  return found
}

test('CV-317：注册表工具表非空，且与本仓工具数一致（防止正则失配导致门禁空转）', () => {
  const tools = registeredToolNames()
  assert.ok(tools.size >= 20, `只提取到 ${tools.size} 个工具，正则可能失配`)
  for (const required of ['write_storyboard', 'submit_keyframes_for_approval', 'video_composite', 'look_card']) {
    assert.ok(tools.has(required), `工具表缺少关键项：${required}`)
  }
})

test('CV-317：skill 正文引用的工具必须真实注册（幽灵引用直接红）', () => {
  const tools = registeredToolNames()
  const exempt = exemptMap()
  const tokens = scanSnakeCaseTokens()

  const ghosts = []
  for (const [word, files] of tokens) {
    if (tools.has(word)) continue
    if (exempt.has(word)) continue
    ghosts.push(`${word}（${[...files].join(', ')}）`)
  }
  assert.deepEqual(
    ghosts, [],
    '以下 snake_case 词既不是已注册工具、也不在豁免表里 —— 若是幽灵工具引用请改名，'
    + '若确属非工具请归入 EXEMPT 并写明理由：\n' + ghosts.join('\n'),
  )
})

test('CV-317：豁免表自身不腐烂（每个豁免词都必须在 skills/ 里真实出现）', () => {
  const tokens = scanSnakeCaseTokens()
  const stale = []
  for (const [reason, words] of EXEMPT) {
    for (const w of words) {
      if (!tokens.has(w)) stale.push(`${w}（豁免组 ${reason}）`)
    }
  }
  assert.deepEqual(
    stale, [],
    `以下豁免词在 skills/ 下已不存在对应文本，请从豁免表移除，避免门禁自身变成噪声源：\n${stale.join('\n')}`,
  )
})

test('CV-317：豁免表分组非空且无重复（放行通道必须可审计）', () => {
  const seen = new Map()
  const dupes = []
  for (const [reason, words] of EXEMPT) {
    assert.ok(Array.isArray(words) && words.length > 0, `豁免组 ${reason} 为空`)
    for (const w of words) {
      if (seen.has(w)) dupes.push(`${w}（同时出现在 ${seen.get(w)} 与 ${reason}）`)
      seen.set(w, reason)
    }
  }
  assert.deepEqual(dupes, [], `豁免词重复登记：\n${dupes.join('\n')}`)
})

test('CV-317：回归哨兵——已下线工具名不得再作为调用出现（submit_screenplay）', () => {
  const text = readFileSync(join(SKILLS_DIR, 'canvas-studio-creation', 'SKILL.md'), 'utf8')
  const lines = text.split('\n')

  // CV-321 起「核心规则」节已改名「安全协议」，哨兵跟着结构走：
  // 找「不参与此原则」所在的安全协议节，再取其中的第 1 条（审批门禁）。
  const anchor = lines.findIndex(line => line.includes('不参与此原则'))
  assert.ok(anchor >= 0, '总纲缺少「安全协议 … 不参与此原则」那一段')
  const bottomLine = lines.slice(anchor).find(line => /^\d+\.\s/.test(line)) ?? ''
  assert.ok(bottomLine.includes('审批门禁'), '安全协议第 1 条应是「审批门禁」')
  assert.ok(
    !bottomLine.includes('submit_screenplay'),
    '安全协议① 仍引用已下线的 submit_screenplay —— REQ-022 后唯一保留的是 submit_keyframes_for_approval',
  )
  // 审批门必须点名现存工具（写在上文「执行模式与审批门禁」节里也算数）
  assert.ok(
    text.includes('submit_keyframes_for_approval'),
    '总纲未点名现存的关键帧审批门 submit_keyframes_for_approval',
  )

  // 「提交即停手」与放手跑两处不得再说「三个 submit 工具」
  assert.ok(
    !text.includes('三个 submit 工具'),
    '总纲仍写「三个 submit 工具」—— REQ-022 后只剩 submit_keyframes_for_approval',
  )
})

test('CV-317：审批语义的 skill 引用不得提「分镜门」（分镜门已随 REQ-022 下线）', () => {
  for (const name of ['direct-street-interview-video', 'stage-startle-to-truce-encounter']) {
    const text = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8')
    assert.ok(
      !/分镜\/关键帧审批节奏/u.test(text),
      `${name} 仍写「分镜/关键帧审批节奏」—— 分镜门已下线，现行是覆盖层「确认落地」+ 关键帧条件门`,
    )
    assert.ok(text.includes('submit_keyframes_for_approval'), `${name} 应显式写出现存的关键帧审批门`)
  }
})
