/**
 * skill 渐进披露门禁（CV-322 / CV-321 改动 1）。
 *
 * ## 为什么有这道门
 *
 * `skill-expansion-spec.md` §1.3 要求 SKILL.md 保持精简入口、细节放 `references/`。
 * 实测这一条此前没有任何机器闸：五个 skill（minimalist-product-ad 32KB /
 * papercraft 23KB / paper-collage 21KB / music-video-subtitle 16KB /
 * brand-promo 14KB）既是超长入口，`references/` 又全空——渐进披露形同虚设。
 *
 * 同时暴露了第二个结构性问题：**风格 skill 自带审批门**。总纲说"审批门禁不参与
 * 风格优先原则"，但风格 skill 自己带一套"确认后才生成"的表述，安全底线随时可能
 * 被绕过去。审批语义只有一处事实源（`canvas-studio-creation`），风格 skill 必须让位。
 *
 * ## 本门禁怎么工作（四条）
 *
 * 1. **入口体积上限**：除总纲外的每个 SKILL.md ≤ 12 KB，超了就是"细则没下沉"。
 *    总纲由 `skill-catalog.test.mjs` 的 CV-121 体积断言单独管，本文件**不**纳入，
 *    免得两处阈值互相打架。
 * 2. **渐进披露真实性（分层，不重复造轮子）**：`minimax-skill.test.mjs` 已守
 *    "每个 SKILL.md 引用的 `references/<file>` 存在（含跨 skill）"。本文件守的是
 *    它**没覆盖**的那一层：`references/**` 分册正文里的引用同样不许断链——
 *    细则下沉之后，分册之间互相指路（甚至指回总纲分册）才成为常态。
 * 3. **禁止自设审批门**：不得出现已下线审批工具名，也不得出现"先问用户确认再生成"
 *    这类自建 HITL 门。`ask_user_choice` 做需求澄清是允许的。
 * 4. **风格 skill 必须让位**：11 个风格/机制 skill 必须写明立场声明。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS_DIR = join(ROOT, 'skills')

/**
 * 入口体积上限。总纲（路由 + 审批语义 + 安全协议）体量天然更大，另由
 * skill-catalog.test.mjs 的 CV-121 断言管辖，此处排除。
 */
const ENTRY_LIMIT = 12 * 1024
const ORCHESTRATOR = 'canvas-studio-creation'

/**
 * 11 个风格 / 机制 skill：它们提供风格知识，不规定流程。
 * 与 `skill-catalog.test.mjs` 的 styleIds 同源（风格预设表要求登记的那批）。
 */
const STYLE_SKILLS = [
  'minimalist-product-ad-generator',
  '3d-animation-short-generator',
  'papercraft-stop-motion-explainer',
  'brand-promo-video-generator',
  'music-video-subtitle-generator',
  'co-op-game-intro-generator',
  'paper-collage-explainer-generator',
  'handdrawn-live-video-generator',
  'oriental-mythic-visual-director',
  'direct-street-interview-video',
  'stage-startle-to-truce-encounter',
]

/**
 * 立场声明的语义判据（措辞可微调，五要素须同时出现在同一段落）：
 * 「流程」+「审批门禁」+「工具契约」+ 指向 `canvas-studio-creation` + 「为准」。
 */
const STANCE_PARTS = [/流程/u, /审批门禁/u, /工具契约/u, /canvas-studio-creation/u, /为准/u]

/**
 * REQ-022 已下线的审批工具。权威记录见 `src/approval-gate.ts`。
 * `submit_keyframes_for_approval` 是**现存的**唯一对话流审批门，不在此列——
 * 引用它是合法的（写清"出过关键帧时另有它一道"）。
 */
const RETIRED_APPROVAL_TOOLS = ['submit_screenplay', 'submit_storyboard_for_approval']

/**
 * 自建 HITL 审批门的表述。`ask_user_choice` 做需求澄清不在此列（allowed-tools
 * 与总纲澄清节都要求用它），这里只打"问完确认才能往下做"这种**流程门**。
 */
const SELF_GATED_PATTERNS = [
  {
    re: /(?:先|必须先|硬性要求先)[^\n。]{0,20}(?:调用|问|确认|提交)[^\n。]{0,20}(?:确认|批准|通过)[^\n。]{0,20}(?:才|后)[^\n。]{0,12}(?:生成|出片|出图|继续|下一步)/u,
    hint: '改成「审批节奏以 canvas-studio-creation 为准」，不要自建确认门',
  },
  {
    re: /(?:等|待|经)[^\n。]{0,6}用户[^\n。]{0,8}(?:确认|批准|点头)[^\n。]{0,20}(?:才|后)[^\n。]{0,12}(?:生成|出片|出图|继续|进入)/u,
    hint: '改成「审批节奏以 canvas-studio-creation 为准」，不要自建确认门',
  },
  {
    re: /collect approval/iu,
    hint: '英文同义改写同样是自建审批门，删掉',
  },
  {
    re: /(?:do not|don't|never)[^\n.]{0,40}(?:generate|proceed)[^\n.]{0,40}(?:until|before)[^\n.]{0,40}(?:the user|user)[^\n.]{0,20}(?:confirm|approve)/iu,
    hint: '英文同义改写同样是自建审批门，删掉',
  },
]

/** 收集 skills/ 下每个 SKILL.md（跳过本守卫自身不适用，它在 tests/）。 */
function skillEntries() {
  return readdirSync(SKILLS_DIR)
    .filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(SKILLS_DIR, name, 'SKILL.md')))
    .map((name) => ({
      name,
      file: join(SKILLS_DIR, name, 'SKILL.md'),
      body: readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf8'),
    }))
}

test('CV-322：扫描面有效（skills/ 非空且能读到正文，否则下面每条都是恒真）', () => {
  const entries = skillEntries()
  assert.ok(entries.length >= 20, `只扫到 ${entries.length} 个 SKILL.md，扫描面可能已断`)
  assert.ok(entries.some((e) => e.name === ORCHESTRATOR), `总纲 ${ORCHESTRATOR} 不在扫描面里`)
  assert.ok(entries.every((e) => e.body.length > 0), '存在空 SKILL.md')
})

test('CV-322：SKILL.md 是入口级文件（体积上限 12 KB），细则必须下沉到 references/', () => {
  const overweight = skillEntries()
    .filter((e) => e.name !== ORCHESTRATOR)
    .map((e) => ({ ...e, bytes: Buffer.byteLength(e.body) }))
    .filter((e) => e.bytes > ENTRY_LIMIT)
    .map((e) => `skills/${e.name}/SKILL.md（${e.bytes} B，超 ${ENTRY_LIMIT - e.bytes} B）`)
  assert.deepEqual(
    overweight, [],
    '以下 SKILL.md 超过入口级体积上限 —— 把细则抽到该 skill 的 references/ 分册，'
    + '正文只留定位、加载理由与必读指针：\n' + overweight.join('\n'),
  )
})

test('CV-322：渐进披露真实性 —— references/ 分册正文里的引用也不得断链（补 minimax-skill.test.mjs 只守 SKILL.md 的那一层）', () => {
  // 分册之间可以互相指路、也可以指回总纲分册。正文里存在两种写法：
  //   同 skill：      `references/x.md`
  //   跨 skill：      `h3-prompt-writing/references/x.md`
  // 但也有散文式跨指（"按 h3-prompt-writing 的 references/x.md"），此时
  // `references/` 前缀不带 owner，从当前 skill 解析必然误报成断链。因此这里按
  // **存在性**判定：被点名的分册必须真的躺在某个 `skills/*/references/` 下。
  // 严格的按 owner 解析仍由 minimax-skill.test.mjs 在 SKILL.md 层守着。
  const allBooklets = new Set()
  for (const entry of skillEntries()) {
    for (const name of referenceFiles(entry.name)) allBooklets.add(name)
  }
  const broken = []
  for (const entry of skillEntries()) {
    for (const ref of referenceFiles(entry.name)) {
      const body = readFileSync(join(SKILLS_DIR, entry.name, 'references', ref), 'utf8')
      for (const m of body.matchAll(/references\/([a-z0-9./_-]+)/giu)) {
        const file = m[1].split('/').pop()
        if (!existsSync(join(SKILLS_DIR, entry.name, 'references', file))
          && !allBooklets.has(file)) {
          broken.push(`skills/${entry.name}/references/${ref} → references/${m[1]}（skills/ 下任何 skill 都没有这个分册）`)
        }
      }
    }
  }
  assert.deepEqual(
    broken, [],
    '以下 references 分册引用了 skills/ 下不存在的分册 —— 模型 read 不到，细则链即断：\n'
    + broken.join('\n'),
  )
})

test('CV-322：不得引用已下线的审批工具（审批语义只有 canvas-studio-creation 一处事实源）', () => {
  const hits = []
  for (const entry of skillEntries()) {
    for (const tool of RETIRED_APPROVAL_TOOLS) {
      if (entry.body.includes(tool)) hits.push(`skills/${entry.name}/SKILL.md → ${tool}`)
    }
  }
  assert.deepEqual(
    hits, [],
    '以下正文引用了 REQ-022 已下线的审批工具 —— 换成现存的 submit_keyframes_for_approval，'
    + '并把审批语义交回 canvas-studio-creation：\n' + hits.join('\n'),
  )
})

test('CV-322：任何 skill 都不得自建 HITL 审批门（ask_user_choice 做需求澄清不在此列）', () => {
  const hits = []
  for (const entry of skillEntries()) {
    if (entry.name === ORCHESTRATOR) continue // 审批语义的事实源本身，豁免
    entry.body.split('\n').forEach((line, i) => {
      for (const { re, hint } of SELF_GATED_PATTERNS) {
        if (re.test(line)) hits.push(`skills/${entry.name}/SKILL.md:${i + 1} → ${hint}\n    原文：${line.trim()}`)
      }
    })
  }
  assert.deepEqual(
    hits, [],
    '以下正文自建了"问用户确认后才生成"的审批门 —— 审批门只有一个来源，'
    + 'skill 只能让位：\n' + hits.join('\n'),
  )
})

test('CV-321 改动 1：11 个风格/机制 skill 必须写明立场声明（流程与审批让位给总纲）', () => {
  const missing = []
  for (const name of STYLE_SKILLS) {
    const entry = skillEntries().find((e) => e.name === name)
    if (!entry) { missing.push(`${name}（skill 不存在）`); continue }
    const hasStance = entry.body
      .split(/\n{2,}/u)
      .some((para) => STANCE_PARTS.every((re) => re.test(para)))
    if (!hasStance) {
      const near = entry.body.includes('canvas-studio-creation') ? '（正文提到总纲，但没有这句立场声明）' : '（正文完全没提总纲）'
      missing.push(`${name} ${near}`)
    }
  }
  assert.deepEqual(
    missing, [],
    '以下风格 skill 缺立场声明 —— 在正文开头加一段：'
    + '「本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 '
    + '`canvas-studio-creation` 为准。」\n' + missing.join('\n'),
  )
})

test('CV-322：风格 skill 的分册必须真在位（声明了 references/ 却没有文件等于没声明）', () => {
  const missing = []
  for (const name of STYLE_SKILLS) {
    const entry = skillEntries().find((e) => e.name === name)
    if (!entry) continue
    if (!existsSync(join(SKILLS_DIR, name, 'references'))) continue // 没有分册的风格 skill 合法
    if (referenceFiles(name).length === 0) missing.push(`${name}（references/ 是空目录）`)
  }
  assert.deepEqual(missing, [], `以下风格 skill 有 references/ 目录却一个分册都没有：\n${missing.join('\n')}`)
})

/** 列出某 skill references/ 下的分册文件名。 */
function referenceFiles(skill) {
  const dir = join(SKILLS_DIR, skill, 'references')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile())
}

/**
 * CV-324：`SKILL.cn.md` 中文对照镜像已撤下，不得重新出现。
 *
 * 为什么必须守：它是**手维护的第二份内容副本**。CV-321b 改写 11 个风格 skill 的
 * SKILL.md 之后，8 个存量镜像全部陈旧，且仍写着「已交出工作流的旧流程 + 自建 HITL
 * 确认点」—— 人读到的是已经废止的规则，而机器读的是新规则，两者对同一件事给相反答案。
 * 这与本批消灭第二事实源（catalog→platform.yaml、细则→分册、硬编码名→绑定表）
 * 是同一件事，故一并撤下，见 docs/skill-expansion-spec.md §2。
 */
test('CV-324：不得存在 SKILL.cn.md 第二事实源镜像', () => {
  const mirrors = skillEntries()
    .filter((entry) => existsSync(join(SKILLS_DIR, entry.name, 'SKILL.cn.md')))
    .map((entry) => join(SKILLS_DIR, entry.name, 'SKILL.cn.md'))
  assert.deepEqual(
    mirrors, [],
    'SKILL.cn.md 是手维护的第二份内容副本，会与 SKILL.md 漂移（CV-321b 后 8 个存量镜像已全部陈旧）。'
    + '\n要中文阅读直接读 SKILL.md 本身，它就是中文；细则读 references/。'
    + '\n若确有维护镜像的强需求，请同时给出「谁来更新、何时校验漂移」的机制，而不是只加文件：\n'
    + mirrors.map((p) => `  ${p}`).join('\n'),
  )
})
