/**
 * CV-323：激活集注入 system prompt 的契约测试。
 *
 * 背景：技能广场的「装载」是纯 UI 概念（`skills.json` + chips），与 skill 注册无关，
 * 模型此前完全看不到用户在项目上勾了什么。本批把清单注入 system prompt（order 154），
 * 并在写入侧失效缓存。
 *
 * 这里测的是**纯函数 + 注册契约**那部分：IO 与 assemble 链路由 smoke 里的
 * 集成测试覆盖，本文件锁住「文案本身不能漂」的几条底线。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 编译产物：test:smoke 跑的是 lib/
const {
  activeSkillsSectionText,
  ACTIVE_SKILLS_SECTION_NAME,
  ACTIVE_SKILLS_SECTION_ORDER,
  cachedActiveSkillsSectionText,
  invalidateActiveSkillsPromptCache,
  registerActiveSkillsPrompt,
} = await import(join(ROOT, 'lib', 'active-skills-prompt.js'))

const { getSkillEntry } = await import(join(ROOT, 'lib', 'skill-catalog.js'))

test('CV-323：空激活集不注入（小节返回空串，不白占上下文）', () => {
  assert.equal(activeSkillsSectionText([]), '')
  // 只有总纲被勾选（决策型，由路由小节强制加载）时同样不重复列出
  assert.equal(activeSkillsSectionText(['canvas-studio-creation']), '')
})

test('CV-323：清单逐条列出 skill 名 + catalog 标题摘要', () => {
  const text = activeSkillsSectionText(['h3-prompt-writing', 'cinematic-moves'])
  assert.ok(text.includes('`h3-prompt-writing`'), '未列出 skill 注册名 h3-prompt-writing')
  assert.ok(text.includes('`cinematic-moves`'), '未列出 skill 注册名 cinematic-moves')
  const entry = getSkillEntry('h3-prompt-writing')
  assert.ok(entry, 'catalog 缺 h3-prompt-writing 条目')
  assert.ok(text.includes(entry.title), '清单未带 catalog 中文标题，模型看不懂这条是干什么的')
  assert.ok(text.includes(entry.summary.slice(0, 12)), '清单未带 catalog 摘要')
})

test('CV-323：去重且剔除总纲，不重复陈述已做的事', () => {
  const text = activeSkillsSectionText([
    'h3-prompt-writing', 'h3-prompt-writing', 'canvas-studio-creation',
  ])
  const occurrences = text.split('`h3-prompt-writing`').length - 1
  assert.equal(occurrences, 1, '同名 skill 出现多次，未去重')
  // 只看清单行（`- \`name\` —— …`），规则正文里合法地提到总纲（"以总纲为准"）
  const listed = text.split('\n').filter(line => line.startsWith('- `'))
  assert.ok(listed.length >= 1, '没有解析出任何清单行')
  assert.ok(
    !listed.some(line => line.includes('`canvas-studio-creation`')),
    '总纲被列进清单 —— 它由路由小节强制加载，不该要求用户勾选',
  )
  assert.equal(listed.length, 1, `去重并剔除总纲后应只剩 1 行，实际 ${listed.length} 行：\n${listed.join('\n')}`)
})

test('CV-323：清单不越权——流程与安全底线仍归总纲', () => {
  const text = activeSkillsSectionText(['minimalist-product-ad-generator'])
  // 用户勾选只表达「用这个技能的知识」，不表达「它可以自带审批门 / 自定流程」
  assert.ok(text.includes('canvas-studio-creation'), '未声明流程与工具契约仍以总纲为准')
  assert.ok(text.includes('安全底线'), '未声明任何 skill 不得覆盖安全底线')
  assert.ok(text.includes('不要'), '未写明「用户选定即视为已确认、不要再问」这条交互契约')
})

test('CV-323：文本不得含 `{{variable}}`（renderPrompt 对未知引用会直接抛错）', () => {
  const text = activeSkillsSectionText(['h3-prompt-writing', 'music-prompt-writing'])
  assert.ok(!/\{\{[^}]*\}\}/u.test(text), '小节文本含 {{variable}}，会触发 renderPrompt 抛错')
})

test('CV-323：catalog 无此条目时不静默漏掉（残留记录要显式暴露）', () => {
  const text = activeSkillsSectionText(['totally-retired-skill'])
  assert.ok(text.includes('`totally-retired-skill`'), 'catalog 无此条目时该行被整条丢弃，模型无从发现不一致')
  assert.ok(text.includes('残留'), '未标注这是项目里残留的旧记录')
})

test('CV-323：注册契约——小节名/order 稳定且与既有小节不冲突', () => {
  assert.equal(ACTIVE_SKILLS_SECTION_NAME, 'canvas-studio:active-skills')
  assert.equal(ACTIVE_SKILLS_SECTION_ORDER, 154)
  // 已占用：150 skill 路由 / 151 项目预置 / 152 资产库 / 153 拍摄定稿纪律
  for (const taken of [150, 151, 152, 153]) {
    assert.notEqual(ACTIVE_SKILLS_SECTION_ORDER, taken, `order ${taken} 已被占用`)
  }
})

test('CV-323：注册函数把 text 传成函数形态并挂 agent/created 预热', () => {
  const sections = []
  const listeners = []
  const dispose = registerActiveSkillsPrompt(
    {
      systemPrompt: { section: (s) => { sections.push(s); return () => {} } },
      on: (event, listener) => { listeners.push(event); return () => {} },
    },
    { list: async () => [] },
  )
  assert.equal(typeof dispose, 'function')
  assert.equal(sections.length, 1)
  assert.equal(typeof sections[0].text, 'function', 'text 必须是函数形态（同步 provider），静态串无法按 cwd 取激活集')
  assert.deepEqual(listeners, ['agent/created'], '未挂 agent/created 预热，首轮 assemble 读不到清单')
  dispose()
})

test('CV-323：写入侧必须失效缓存，否则用户勾掉 skill 后本轮仍按旧清单行事', () => {
  const routes = readFileSync(join(ROOT, 'src', 'routes.ts'), 'utf8')
  const write = routes.indexOf('await registry.writeActiveSkills(')
  assert.ok(write > 0, 'routes.ts 里找不到激活集写入点')
  const tail = routes.slice(write, write + 400)
  assert.ok(
    tail.includes('invalidateActiveSkillsPromptCache()'),
    '写完 skills.json 没有失效激活集缓存 —— 用户改勾选后模型这一轮仍读到旧清单',
  )
})
