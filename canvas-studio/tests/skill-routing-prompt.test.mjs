/**
 * SK-01 创作任务路由硬指令测试（src/skills/routing-prompt.ts → lib/ 产物）。
 *
 * 守护三件事：
 * 1. 指令内容在位——硬指令三要素（第一个动作加载总纲 / 先于一切提问与工具 /
 *    已即兴则中止重走）不能被误删（防源码漂移）；
 * 2. 指令引用的总纲 skill 名真实存在——总纲目录一旦改名，路由指令必须同步，
 *    否则模型会去加载一个不存在的 skill；
 * 3. 注册行为正确——unique name、有限 order、text 原样透传、disposer 透传，
 *    以及 lib/index.js 产物真的注册了该小节（防漏 build）。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CREATION_SKILL_NAME,
  SKILL_ROUTING_SECTION_NAME,
  SKILL_ROUTING_SECTION_ORDER,
  SKILL_ROUTING_SECTION_TEXT,
  registerSkillRoutingPrompt,
} from '../lib/skills/routing-prompt.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('SK-01：路由指令含硬指令三要素（第一个动作 / 先于提问与工具 / 即兴中止重走）', () => {
  assert.match(
    SKILL_ROUTING_SECTION_TEXT,
    /第一个动作必须/,
    '缺少「第一个动作」硬指令',
  )
  assert.match(SKILL_ROUTING_SECTION_TEXT, /先于一切提问/, '缺少「先于一切提问」时序约束')
  assert.match(SKILL_ROUTING_SECTION_TEXT, /任何工具调用/, '缺少「任何工具调用」时序约束')
  assert.match(
    SKILL_ROUTING_SECTION_TEXT,
    /立即停止当前即兴流程/,
    '缺少「已即兴则中止重走」自救条款',
  )
})

test('SK-01：指令为条件触发式而非 persona——canvas-studio 是全局插件，非创作会话不应被影响', () => {
  assert.match(
    SKILL_ROUTING_SECTION_TEXT,
    /仅当当前请求涉及/,
    '缺少条件触发前提（全局插件会把本段注入所有会话）',
  )
  assert.match(
    SKILL_ROUTING_SECTION_TEXT,
    /其它请求请完全忽略/,
    '缺少对非创作请求的豁免语句',
  )
  assert.match(
    SKILL_ROUTING_SECTION_TEXT,
    /不改变你的身份/,
    '缺少「不改动身份」声明（防被当作 persona 覆盖）',
  )
})

test('SK-01：文本不得含 {{variable}} 引用（renderPrompt 对未知变量严格抛错）', () => {
  assert.ok(!SKILL_ROUTING_SECTION_TEXT.includes('{{'), '路由指令含 {{，会被 renderPrompt 当作变量引用解析')
})

test('SK-01：指令引用的总纲 skill 真实存在（防总纲改名后路由指向空）', () => {
  assert.match(SKILL_ROUTING_SECTION_TEXT, new RegExp(`skill\\(name="${CREATION_SKILL_NAME}"\\)`), '指令未用标准调用形式引用总纲')
  const dir = join(ROOT, 'skills', CREATION_SKILL_NAME)
  assert.ok(existsSync(join(dir, 'SKILL.md')), `路由指令指向的 skills/${CREATION_SKILL_NAME}/ 不存在——总纲改名了吗？请同步 CREATION_SKILL_NAME`)
})

test('SK-01：注册行为——unique name / 有限 order / text 原样透传 / disposer 透传', () => {
  const registered = []
  let disposed = false
  const fakeCtx = {
    systemPrompt: {
      section(section) {
        registered.push(section)
        return () => { disposed = true }
      },
    },
  }
  const dispose = registerSkillRoutingPrompt(fakeCtx)
  assert.equal(registered.length, 1, '应恰好注册一个小节')
  const section = registered[0]
  assert.equal(section.name, SKILL_ROUTING_SECTION_NAME)
  assert.ok(Number.isFinite(section.order), 'order 必须是有限数（SystemPrompt 会抛 TypeError）')
  assert.ok(section.order >= 100 && section.order < 200, 'order 应落在工具指引带（100–199），当前约定 -100 身份 / 0 persona')
  assert.equal(section.text, SKILL_ROUTING_SECTION_TEXT, 'text 应原样透传（静态串，勿在注册侧加工）')
  assert.equal(section.complete, undefined, '不得声明 complete（会顶掉 harness 组装的其余小节）')
  dispose()
  assert.ok(disposed, 'disposer 应原样透传（插件卸载时移除小节）')
})

test('SK-01：lib/ 产物已包含路由小节（防漏 build）', () => {
  const indexSrc = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
  assert.ok(indexSrc.includes('registerSkillRoutingPrompt'), 'lib/index.js 未调用 registerSkillRoutingPrompt（产物未更新？先 build）')
  const moduleSrc = readFileSync(join(ROOT, 'lib', 'skills', 'routing-prompt.js'), 'utf8')
  assert.ok(moduleSrc.includes(SKILL_ROUTING_SECTION_NAME), 'lib/skills/routing-prompt.js 未包含路由小节名（产物未更新？先 build）')
})
