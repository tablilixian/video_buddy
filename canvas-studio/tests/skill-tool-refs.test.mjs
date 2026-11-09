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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')

/** 本仓真实注册的工具表来源。占位工具已逐个转真或下线，故一并从源码取。
 *  2026-11-02 复刻提效批把工具外置到 host-tools-artifact.ts（image_crop/write_note/image_matting），
 *  2026-11-03 复刻客户端能力批外置到 host-tools-remake.ts（media_probe/evidence_grid/download_video）
 *  —— 外置后 host-tools.ts 源文本里不再有这些名字，本表必须跟着注册面走（上批遗留修正）。
 *  2026-11-03 skill 覆盖审计（plans/skill-覆盖审计与修复清单-20261103.md CV-401）：补
 *  host-tools-audio.ts —— analyze_beats/snap_cuts_to_beats 经 defineAudioTools 工厂展开注册
 *  （host-tools.ts:3030 只剩展开调用），名字只在该文件源文本出现；漏列时门禁表 41 vs 真实 43，
 *  且 skill 正文一旦正确引用这两件工具会被误判幽灵。 */
const TOOL_SOURCES = ['host-tools.ts', 'host-tools-audio.ts', 'host-tools-artifact.ts', 'host-tools-remake.ts', 'host-tools-data.ts', 'host-tools-series.ts', 'skills/placeholder-tools.ts']

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
  // ── 组 4b：工具 action 取值（schema 枚举值不是工具名；3.1 episodic 的 upsert_episode）
  'tool-action-values': ['upsert_episode'],
  // ── 组 5：后端工作流 / 模型档位标识（配置名，不是工具）
  'backend-workflow-ids': ['txt2image_withtxt', 'qwen_4view_char_2step', 'krea2_edit', 'krea2_quadview', 'krea2_workflow'],
  // ── 组 6：测试 fixture 里的**空断言**——断言「未调用过」的工具名，
  //         而它们从未注册，故该断言恒真。保留原样，记录此弱断言。
  'test-fixture-negative-assertions': ['storyboard_generate', 'storyboard_split'],
  // ── 组 7：manifest 的**轨道 id**（pitfalls.md 引用的真实事故轨，不是工具）。
  //         2026-11-04 科普 0.1 验收 P4：pitfalls.md §2 用真实事故轨 id 定位
  //         「animate 段 durationInFrames=1 把整层钉死」的实证，读者需要能按 id 检索。
  'manifest-track-ids': ['s2_callout'],
  // ── 组 8：**运行时原生工具**（DSH harness 内置，不经本包 createStudioTools 注册）。
  //         CV-435 读图能力恢复后 toolchain.md §7 与 code-driven-explainer 分册把
  //         read_image 定为画面取证首选，skill 层必须能点名它；注册面在运行时，非本仓。
  'runtime-native-tools': ['read_image'],
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

// ─────────────────────────────────────────────────────────────────────────
// REQ-034 R6（CV-329）：成片合成的**二择路由**
//
// 缺口背景：总纲第 10 步过去只写 `compose_video`，而 `render_composition`
// （代码驱动合成，REQ-034）的承接 skill 走 `slot: general`、不进能力槽位绑定表
// ⇒ **总纲根本不指向这条分支**。结果：R1~R4 做得再对，真实对话里可能一次都
// 触达不到 —— 能力存在 ≠ 能力被用上。
//
// 本组的判据分三段，缺一段路由就是断的：
//   ① 总纲正文给出二择判据（模型第一个动作加载总纲，这是必命中面）；
//   ② 分册 `shot-format.md` 同节给同一判据（总纲第 10 步明确让模型去读它）；
//   ③ 承接链不断：工具真注册 + 分支 skill 的 frontmatter 带触发词与反向边界
//      （不勾 skill 时，模型自主加载的唯一线索就是 description）。
//
// ⚠️ 能被本组证伪的只是「判据在不在、指向的工具存不存在」；**「模型真会不会选
// 这条路」无法离线断言**，须桌面验收：不勾选任何 skill，说「做一条带字幕卡的
// 科普视频」，看是否路由到 `render_composition`。
// ─────────────────────────────────────────────────────────────────────────

/** 总纲正文（去掉 frontmatter）—— 模型加载总纲时真正看到的部分。 */
function masterBody() {
  const lines = readFileSync(join(SKILLS_DIR, 'canvas-studio-creation', 'SKILL.md'), 'utf8').split('\n')
  assert.equal(lines[0], '---', '总纲首行应是 frontmatter 起始 `---`')
  const end = lines.findIndex((line, i) => i > 0 && line === '---')
  assert.ok(end > 0, '总纲 frontmatter 未闭合')
  return { lines, start: end + 1 }
}

/** 已知 skill 目录名（总纲正文里不得出现，CV-319 判据二的精神）。 */
function knownSkillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
}

test('CV-329：总纲「成片合成」步须给出二择判据，且写在正文而非 frontmatter', () => {
  const { lines, start } = masterBody()
  const idx = lines.findIndex((line, i) => i >= start && line.startsWith('10. **成片合成**'))
  assert.ok(idx >= 0, '总纲正文找不到第 10 步「成片合成」—— 路由判据没有落点')
  const step = lines[idx]

  assert.ok(step.includes('compose_video'), '成片合成步丢了 `compose_video` 分支')
  assert.ok(
    step.includes('render_composition'),
    '成片合成步没有指向 `render_composition` —— 模型看不到代码合成这条路径（这正是 R6 的缺口）',
  )
  assert.ok(
    /纯/u.test(step) && step.includes('字幕卡'),
    '成片合成步只有工具名、没有二择判据（「纯片段拼接」vs「字幕卡 / 数据卡」）—— 模型仍不知道何时用哪个',
  )

  const tools = registeredToolNames()
  for (const name of ['compose_video', 'render_composition']) {
    assert.ok(tools.has(name), `成片合成步引用的 \`${name}\` 未真实注册 —— 路由指向幽灵工具`)
  }

  const hardcoded = knownSkillNames().filter(name => step.includes(name))
  assert.deepEqual(
    hardcoded, [],
    '总纲成片合成步写死了 skill 名 —— 应只点名工具。CV-319 判据二：会因新增 skill 而过期的规则不能写进总纲：\n'
    + hardcoded.join('\n'),
  )
})

test('CV-329：分册 shot-format.md「成片合成与自检」节须给同一判据（总纲让模型读它）', () => {
  const lines = readFileSync(
    join(SKILLS_DIR, 'canvas-studio-creation', 'references', 'shot-format.md'), 'utf8',
  ).split('\n')
  const head = lines.findIndex(line => line.startsWith('## 成片合成与自检'))
  assert.ok(head >= 0, '分册缺少「成片合成与自检」节 —— 总纲第 10 步的指针是死的')
  const next = lines.findIndex((line, i) => i > head && line.startsWith('## '))
  const section = lines.slice(head, next > head ? next : lines.length).join('\n')

  assert.ok(section.includes('compose_video'), '分册该节丢了 `compose_video` 分支')
  assert.ok(
    section.includes('render_composition'),
    '分册该节没有「何时改用代码合成」的判据 —— 总纲把模型引到这节，读完仍不知有第二条路径',
  )
  assert.ok(section.includes('字幕卡'), '分册该节缺少改用判据的触发条件（字幕卡 / 数据卡）')
  assert.ok(
    /纯片段顺序拼接/u.test(section),
    '分册该节缺少反向边界（纯拼接仍走 `compose_video`）—— 两条路径会互相抢活',
  )
})

test('CV-329：路由承接链不断 —— 分支 skill 可被自主加载（description 带触发词与反向边界）', async () => {
  const lines = readFileSync(join(SKILLS_DIR, 'code-driven-explainer', 'SKILL.md'), 'utf8').split('\n')
  assert.equal(lines[0], '---', 'code-driven-explainer 缺 frontmatter')
  const end = lines.findIndex((line, i) => i > 0 && line === '---')
  assert.ok(end > 0, 'code-driven-explainer frontmatter 未闭合')
  const fm = lines.slice(1, end).join('\n')

  assert.ok(
    fm.includes('render_composition'),
    'frontmatter description 未提 `render_composition` —— 不勾 skill 时，模型没有加载它的线索',
  )
  assert.ok(/字幕卡|数据卡/u.test(fm), 'frontmatter description 缺触发词（字幕卡 / 数据卡）')
  assert.ok(
    fm.includes('compose_video'),
    'frontmatter description 缺反向边界（纯拼接走 `compose_video`）—— 两个分支会抢同一批请求',
  )

  const { getSkillEntry } = await import(join(ROOT, 'lib', 'skill-catalog.js'))
  const entry = getSkillEntry('code-driven-explainer')
  assert.ok(entry, 'catalog 缺 code-driven-explainer 条目 —— 技能广场里看不到，用户也无从勾选')
  assert.ok(
    /字幕卡|数据卡/u.test(entry.summary),
    'catalog 摘要看不出它做的是卡片类成片 —— 用户/模型都认不出用途',
  )
})

// ─────────────────────────────────────────────────────────────────────────
// REQ-034（2026-10-16）：**零视频模型产线的入口分流**
//
// 缺口背景：`render_composition`（代码驱动合成）在总纲第 10 步有个选项、在
// `shot-format.md` 有判据，但**整条工作流里没有「图文路线可以跳过第 9 步」的入口**：
// 第 9 步是无条件的「逐镜视频」，而零视频模型的图文短片**第 9 步整个是空的**。
// ⇒ 用户说「30 秒纯代码生成的科普片」时，模型仍会去逐镜出视频 —— 意图与默认路径相反。
//
// 本组三段的判据（缺一段分流就是断的）：
//   ① **分流阶段**（总纲入口分流行）就要看得到这条路线，不能只在第 9 步说；
//   ② **第 9 步**本身给出「整步跳过」的分支（模型顺序执行时这里是必经点）；
//   ③ 细则落在 `clarification.md §入口分流` 第 6 条（总纲让模型去读它）。
//
// ⚠️ 与 CV-329 同一条纪律：**总纲只点名工具、不点名 skill**（会因新增 skill 而过期的
// 规则不写进总纲）。第 ① ② 段同时断言这一点 —— 本组首次落地时就是这么写错的。
// ─────────────────────────────────────────────────────────────────────────

test('零视频模型分流①：总纲入口分流行给出该分支，且不写死 skill 名', () => {
  const { lines, start } = masterBody()
  const idx = lines.findIndex((line, i) => i >= start && line.startsWith('**入口分流'))
  assert.ok(idx >= 0, '总纲正文找不到入口分流行 —— 分流判据没有落点')
  const line = lines[idx]

  assert.ok(
    /render_composition/u.test(line),
    '入口分流行没给出「零视频模型 → 第 10 步 render_composition」这条路线 ——'
      + '模型在分流阶段就看不到它，只能等撞到第 9 步',
  )
  assert.ok(
    /第 9 步/u.test(line) && /跳过/u.test(line),
    '入口分流行没有说明「第 9 步整步跳过」—— 只给工具名，模型仍会照默认路径逐镜出视频',
  )
  assert.ok(
    line.includes('clarification.md'),
    '入口分流行没有指向 `clarification.md` —— 判据无细则可读',
  )

  const hardcoded = knownSkillNames().filter(name => line.includes(name))
  assert.deepEqual(
    hardcoded, [],
    '总纲入口分流行写死了 skill 名 —— 应只点名工具（CV-319 判据二：会因新增 skill 而过期的规则不写进总纲）：\n'
    + hardcoded.join('\n'),
  )
})

test('零视频模型分流②：总纲第 9 步给出「整步跳过」分支，且不写死 skill 名', () => {
  const { lines, start } = masterBody()
  const idx = lines.findIndex((line, i) => i >= start && line.startsWith('9. **逐镜视频'))
  assert.ok(idx >= 0, '总纲正文找不到第 9 步「逐镜视频」—— 跳过分支没有落点')
  const step = lines[idx]

  assert.ok(
    step.includes('render_composition'),
    '第 9 步没有给出「图文路线改走 render_composition」的去处 —— 模型只看到「跳过」，不知去哪',
  )
  assert.ok(/跳过/u.test(step), '第 9 步没有「整步跳过」的措辞')

  const hardcoded = knownSkillNames().filter(name => step.includes(name))
  assert.deepEqual(
    hardcoded, [],
    '总纲第 9 步写死了 skill 名 —— 应只点名工具：\n' + hardcoded.join('\n'),
  )
})

test('零视频模型分流③：clarification.md §入口分流 第 6 条给出同一判据', () => {
  const lines = readFileSync(
    join(SKILLS_DIR, 'canvas-studio-creation', 'references', 'clarification.md'), 'utf8',
  ).split('\n')
  const head = lines.findIndex(line => line.startsWith('## 入口分流'))
  assert.ok(head >= 0, '分册缺少「入口分流」节 —— 总纲的指针是死的')
  const next = lines.findIndex((line, i) => i > head && line.startsWith('## '))
  const section = lines.slice(head, next > head ? next : lines.length).join('\n')

  assert.ok(
    section.includes('六条'),
    '入口分流仍写「五条」—— 新增第 6 条后计数没同步（判据条数本身就是给模型的进度锚）',
  )
  const item = lines.slice(head, next > head ? next : lines.length)
    .find(line => line.startsWith('6. '))
  assert.ok(item, '入口分流缺第 6 条 ——「零视频模型」这条路线没有细则')
  assert.ok(item.includes('render_composition'), '第 6 条没指向 `render_composition`')
  assert.ok(/第 9 步/u.test(item) && /跳过/u.test(item), '第 6 条没说明第 9 步整步跳过')
  assert.ok(
    /科普|讲解|数据可视化/u.test(item),
    '第 6 条缺触发词（科普 / 讲解 / 数据可视化）—— 模型认不出自己正落在这条路上',
  )
})

// ─────────────────────────────────────────────────────────────────────────
// CV-404（2026-11-03）：**反向对账** —— 每个注册工具必须在 skills/** 交代 ≥1 次
//
// 缺口背景（plans/skill-覆盖审计与修复清单-20261103.md §二 D2）：既有门禁只有
// 单向「skill 引用的工具必须真实注册」（防幽灵），没有反向「注册的工具必须在
// skill 层有交代」。5 个新工具（REQ-036 批 3 件 + 音频批 2 件）静默漏掉、账本
// 同时记「联动完成」，两道防线都没响 —— 本组断言即该根因的机器化：工具加了、
// skill 没更，当场红。
//
// 口径：**词边界包含**（`(?<![A-Za-z0-9_])name(?![A-Za-z0-9_])`），**不复用**
// `scanSnakeCaseTokens` —— 那个正则要求 ≥1 个下划线，看不见 video2vl / image2vl
// 这类无下划线工具名（实测漏报）。扫描后缀 md/txt/yaml 与幽灵门禁同口径；
// 占位工具 subtitle_burn 由 toolchain.md 的说明行交代，同样计入。
//
// 豁免通道：新增「有意不在 skill 层出现」的纯内部件工具时进 REVERSE_EXEMPT
// 并写明理由（与 EXEMPT 同一条「放行通道可审计」纪律）；豁免词一旦进了 skill
// 文本，自清洁断言会要求移除豁免。
// ─────────────────────────────────────────────────────────────────────────

/** 反向豁免：**只登记「确属本仓工具、但有意不进 skill 层」的名字**，按理由分组。 */
const REVERSE_EXEMPT = new Map(Object.entries({}))

test('CV-404：注册面每个工具必须在 skills/ 出现 ≥1 次（工具加了 skill 没更 = 红）', () => {
  const texts = collectFiles(SKILLS_DIR).map(f => ({
    file: relative(ROOT, f),
    text: readFileSync(f, 'utf8'),
  }))
  const exempt = new Set()
  for (const words of REVERSE_EXEMPT.values()) for (const w of words) exempt.add(w)

  const silent = []
  for (const name of registeredToolNames()) {
    if (exempt.has(name)) continue
    const re = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'u')
    const hits = texts.filter(t => re.test(t.text)).map(t => t.file)
    if (hits.length === 0) silent.push(name)
  }
  assert.deepEqual(
    silent, [],
    '以下已注册工具在 skills/**（md/txt/yaml）零出现 —— 工具加了、skill 没更，'
      + '模型按 skill 走永远路由不到它（2026-11-03 审计 D2 根因）。'
      + '补 skill 文本；确属纯内部件时进 REVERSE_EXEMPT 并写明理由：\n' + silent.join('\n'),
  )
})

test('CV-404：反向豁免必须指向真实注册工具，且工具进 skill 文本后豁免即过期', () => {
  const tools = registeredToolNames()
  const texts = collectFiles(SKILLS_DIR).map(f => readFileSync(f, 'utf8'))
  const stale = []
  const ghosts = []
  for (const [reason, words] of REVERSE_EXEMPT) {
    assert.ok(Array.isArray(words) && words.length > 0, `反向豁免组 ${reason} 为空`)
    for (const w of words) {
      if (!tools.has(w)) ghosts.push(`${w}（豁免组 ${reason}）`)
      const re = new RegExp(`(?<![A-Za-z0-9_])${w}(?![A-Za-z0-9_])`, 'u')
      if (texts.some(t => re.test(t))) stale.push(`${w}（豁免组 ${reason}）`)
    }
  }
  assert.deepEqual(
    ghosts, [],
    '反向豁免登记了未注册的名字（它不可能是「有意不进 skill 的工具」）：\n' + ghosts.join('\n'),
  )
  assert.deepEqual(
    stale, [],
    '以下反向豁免工具已在 skills/ 真实出现，豁免已过期请移除：\n' + stale.join('\n'),
  )
})

// ── 2026-11-04 · 科普 0.1 验收 P3：体裁壳的「点名消解」门禁 ─────────────────
//
// 事故（A1）：用户点名 `code-driven-explainer` 时，agent 主动**跳过**了
// `explainer-format-director` 编排壳 —— 定向三问（受众 / 记住哪一件事 / 时长画幅）
// 一项未问。第二步 reasoning 原文："User named the executor directly. I'll load
// code-driven-explainer and its references." ⇒ 光靠会话行为约定无效，
// **必须在描述层把两条规则的冲突消解掉**。
//
// 门禁钉两件事：
// ① 6 个 format director 的 description 必须含「点名下游 executor 时本壳仍须先加载做定向」；
// ② 每个 executor 必须**回指**自己的上游体裁壳 —— 点名 executor 时 agent 一定会读它，
//    回指是唯一拦得住的那一环（A1 事故里 executor 侧对体裁壳**零提及**）。

const FORMAT_DIRECTORS = [
  'brand-format-director',
  'data-viz-format-director',
  'drama-format-director',
  'explainer-format-director',
  'product-format-director',
  'social-ad-format-director',
]

/** executor → 它必须回指的上游体裁壳。 */
const EXECUTOR_TO_SHELL = {
  'code-driven-explainer': [
    'explainer-format-director',
    'data-viz-format-director',
    'product-format-director',
    'social-ad-format-director',
  ],
  'papercraft-stop-motion-explainer': ['explainer-format-director'],
  'paper-collage-explainer-generator': ['explainer-format-director'],
  'brand-promo-video-generator': ['brand-format-director'],
  'minimalist-product-ad-generator': ['product-format-director'],
  'viral-remake': ['social-ad-format-director'],
  'drama-episode-executor': ['drama-format-director'],
}

function frontmatterDescription(skillName) {
  const raw = readFileSync(join(SKILLS_DIR, skillName, 'SKILL.md'), 'utf8')
  const m = /^description:\s*(.*)$/mu.exec(raw)
  assert.ok(m !== null, `${skillName}: 没有 description`)
  return m[1]
}

test('P3：每个体裁壳的 description 必须写明「点名 executor 也先过本壳做定向」', () => {
  for (const shell of FORMAT_DIRECTORS) {
    const description = frontmatterDescription(shell)
    assert.match(
      description,
      /用户点名下游 executor 时本壳仍须先加载做定向/,
      `${shell}: description 缺消解句 —— 点名 executor 时 agent 会直接跳壳（A1 事故）`,
    )
    assert.match(description, /不替代/, `${shell}: 消解句必须说明「点名不替代定向三问」`)
    assert.ok(description.length <= 500, `${shell}: description 超 500 字符（${description.length}）`)
  }
})

test('P3：每个 executor 必须回指上游体裁壳（点名 executor 时 agent 读的是它）', () => {
  for (const [executor, shells] of Object.entries(EXECUTOR_TO_SHELL)) {
    const raw = readFileSync(join(SKILLS_DIR, executor, 'SKILL.md'), 'utf8')
    assert.match(raw, /上游体裁壳/, `${executor}: 缺「上游体裁壳」回指段`)
    assert.match(raw, /仍须先加载/, `${executor}: 回指段必须写明「仍须先加载」`)
    // 壳名可以写在 SKILL.md，也可以下沉到 references/（细则下沉优先）。
    const refsDir = join(SKILLS_DIR, executor, 'references')
    const refFiles = existsSync(refsDir)
      ? readdirSync(refsDir).filter((f) => f.endsWith('.md'))
      : []
    const refBodies = refFiles.map((f) => readFileSync(join(refsDir, f), 'utf8')).join('\n')
    for (const shell of shells) {
      assert.ok(
        raw.includes(shell) || refBodies.includes(shell),
        `${executor}: 未回指上游壳 ${shell} —— A1 事故里 executor 侧对体裁壳零提及`,
      )
    }
  }
})

test('P3：体裁壳与 executor 的双向引用不得成环（壳引 executor、executor 引壳）', () => {
  for (const [executor, shells] of Object.entries(EXECUTOR_TO_SHELL)) {
    for (const shell of shells) {
      const shellRaw = readFileSync(join(SKILLS_DIR, shell, 'SKILL.md'), 'utf8')
      assert.ok(
        shellRaw.includes(executor),
        `${shell}: description/正文未列出下游 executor ${executor} —— 路由表与回指对不上`,
      )
    }
  }
})

// ── 2026-11-09 · CV-429 回归反证（`9853fa28` 瑞幸 C 档）───────────────────
//
// 事故：11-04 已给 6 壳 description 与 executor 回指段补过「点名也先过壳」，
// 但 brief 同时做了三件事：点名 executor + 把三问答案写死 + 声明「不要反问」。
// agent 自述 "doc explicitly declares brand-promo-video-generator, load it"，
// 整场未加载 brand-format-director ⇒ 消解句没覆盖「答案已给全」这个形态，
// 且总纲「点名具体技能 → Look 采集整体跳过」被泛化成了「定向也跳过」。
//
// 本组钉三处入口，并带反向变异哨兵：把例外句拿掉后判据必须变红。
const BRIEF_CARVE_OUT = /答案.{0,10}给全|不要反问|写.{0,4}三问/u
const SHELL_REQUIRED = /不跳体裁壳定向|仍须先加载|不得跳过本壳|壳不可跳/u
const carveOutPresent = (text) => BRIEF_CARVE_OUT.test(text) && SHELL_REQUIRED.test(text)

const CARVE_OUT_TARGETS = [
  {
    name: '总纲跳过规则',
    path: ['canvas-studio-creation', 'SKILL.md'],
    pick: (text) => text.split('\n').find((l) => l.startsWith('**跳过规则**')) ?? '',
    sentence: '只跳 Look，不跳体裁壳定向',
    legacy: '用户已点名具体技能或风格 → Look 采集整体跳过',
  },
  {
    name: 'brand-format-director §1',
    path: ['brand-format-director', 'SKILL.md'],
    pick: (text) => text.split('\n').filter((l) => l.startsWith('> **答案已给全的形态')).join('\n'),
    sentence: '答案已给全的形态',
    legacy: '问完即在回复中复述定向结论（素材现实 / 场景 / 时长画幅语言）再开工。',
  },
  {
    name: 'brand-promo-video-generator 回指段',
    path: ['brand-promo-video-generator', 'SKILL.md'],
    pick: (text) => text.split('\n').filter((l) => l.startsWith('> 即使任务书已把三问答案写死')).join('\n'),
    sentence: '答案可引用，壳不可跳',
    legacy: '点名只决定「用哪条链」，不替代定向。',
  },
]

test('P3 扩展：三处入口必须覆盖「brief 写死答案 / 不要反问」形态', () => {
  for (const t of CARVE_OUT_TARGETS) {
    const text = readFileSync(join(SKILLS_DIR, ...t.path), 'utf8')
    const clause = t.pick(text)
    assert.ok(clause.includes(t.sentence), `${t.name}: 缺定向例外句「${t.sentence}」`)
    assert.ok(carveOutPresent(clause), `${t.name}: 例外句没写明「答案可给全但壳不可跳」`)
  }
})

test('P3 扩展哨兵：换回事故前的旧文案后判据必须变红（门禁不得恒真）', () => {
  assert.equal(carveOutPresent('用户已点名具体技能或风格 → Look 采集整体跳过'), false,
    '无例外句的旧文案竟被判通过 —— 门禁恒真')
  for (const t of CARVE_OUT_TARGETS) {
    assert.equal(carveOutPresent(t.legacy), false,
      `${t.name}: 事故前旧文案仍判绿 ⇒ 断言命中了别处的无关文字（门禁失效）`)
  }
})

// ── 2026-11-09 · CV-452 第 6 次反证：契约知识必须落在「必读入口」 ───────
//
// 真机（`9853fa28`）：bash 读组件源码 25 次 > 12；19:47 补进
// component-contract.generated.md 的「行为语义速查」整场 0 命中 —— 模型的必读入口
// 是 `SKILL.md` 工作流第 2 步点名的 manifest-contract.md（713 行整读），
// 且它 sed builder 是在找「根本不存在的校验」（真校验在宿主侧）。
// ⇒ 继续往生成物堆知识无效：四条高频坑要放进必读入口，校验报错要自带修法。
test('P0-3 必读入口：manifest-contract.md 顶部四类速查在位，且工作流点名它', () => {
  const contract = readFileSync(
    join(SKILLS_DIR, 'code-driven-explainer', 'references', 'manifest-contract.md'), 'utf8',
  )
  const head = contract.split('\n').slice(0, 16).join('\n')
  assert.ok(head.includes('首轮必读速查表'), '速查表必须在文件最前面（模型整读时第一个看到）')
  for (const marker of ['数组靠后', 'sourceRect', '轨道 id', 'box × animate', '不在 `assets/manifest-builder.mjs`']) {
    assert.ok(head.includes(marker), `速查表缺「${marker}」`)
  }
  const skill = readFileSync(join(SKILLS_DIR, 'code-driven-explainer', 'SKILL.md'), 'utf8')
  assert.match(skill, /顶部速查表/, '工作流第 2 步没点名速查表 —— 模型仍不会走到它')
})

test('P0-3 报错带修法：sourceRect 越界 / 轨道 id 重复不再是「只说错」', () => {
  const sprite = readFileSync(join(ROOT, 'src', 'remotion', 'sprite.ts'), 'utf8')
  const manifest = readFileSync(join(ROOT, 'src', 'remotion', 'manifest.ts'), 'utf8')
  assert.match(sprite, /越界：x\+w[\s\S]{0,200}(缩小|左移)/u,
    'sourceRect 越界报错没给修法 —— 模型会回去 sed 源码找校验')
  assert.match(manifest, /id 重复[\s\S]{0,220}(换唯一 id|画布节点 id)/u,
    '轨道 id 重复报错没给修法 —— 同上')
})
