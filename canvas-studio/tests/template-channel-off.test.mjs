/**
 * 模板通道开关的行为守卫（2026-11-12 下线批 → **2026-11-13 重开批语义反转**）。
 *
 * 历史语义：2026-11-12 临时下线时本文件守「缺省关闭」。**2026-11-13 用户拍板重开**
 *（`DEFAULT_ENABLED = true`，并新增 vo-ad 口播模板）⇒ 守卫翻转为「缺省开启」；
 * 关闭态行为改为**显式 env=0** 切入断言（关闭路径必须仍然可用 —— 应急下线的
 * 能力不能因为重开而烂掉）。
 *
 * 反向变异仍然成立：把 `DEFAULT_ENABLED` 改回 false，「缺省为开启态」断言必红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioTools } from '../lib/host-tools.js'
import { TEMPLATE_CHANNEL_ENV, templateChannelEnabled } from '../lib/template-channel.js'
import {
  TEMPLATE_CHANNEL_OFF_TEXT,
  TEMPLATE_CHANNEL_SECTION_NAME,
  TEMPLATE_CHANNEL_SECTION_ORDER,
  registerTemplateChannelPrompt,
} from '../lib/skills/template-channel-prompt.js'
import { loadTemplateBundle } from '../lib/remotion/template-registry.js'
import '../lib/errors/catalog.js'

function setChannel(value) {
  if (value === undefined) delete process.env[TEMPLATE_CHANNEL_ENV]
  else process.env[TEMPLATE_CHANNEL_ENV] = value
}

function mockCtx() {
  const sections = []
  const ctx = {
    systemPrompt: {
      section: (section) => {
        sections.push(section)
        return () => {}
      },
    },
  }
  return { ctx, sections }
}

function tools(value) {
  setChannel(value)
  return createStudioTools({}, 3000)
}

test('模板通道：缺省为开启态（2026-11-13 用户拍板重开）', () => {
  setChannel(undefined)
  assert.equal(templateChannelEnabled(), true, '默认必须开启 —— 关闭只能通过 env=0 显式表达')
})

test('模板通道：env=0 显式关闭仍然可用（应急下线能力不烂）', () => {
  setChannel('0')
  assert.equal(templateChannelEnabled(), false)
  setChannel(undefined)
})

test('关闭态（env=0）★list_templates 不出现在 Host 工具清单', () => {
  const names = tools('0').map((definition) => definition.name)
  assert.ok(!names.includes('list_templates'), '关闭态仍注册模板清单工具 = 模型能看见入口')
  assert.ok(names.includes('scaffold_manifest'), '自由编排的骨架工具必须还在')
})

test('关闭态 ★scaffold_manifest 传 templateId 被拒且给出自由编排路径', async () => {
  const found = tools('0').find((definition) => definition.name === 'scaffold_manifest')
  assert.ok(found)
  await assert.rejects(
    () => found.execute({ templateId: 'science/three-cards', slots: {} }, {}),
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      assert.match(message, /整片模板通道已临时下线/)
      assert.match(message, /scaffold_manifest/)
      assert.match(message, /render_composition/)
      return true
    },
  )
})

test('关闭态 ★自由编排路径完全不受影响', async () => {
  const found = tools('0').find((definition) => definition.name === 'scaffold_manifest')
  const out = await found.execute({ title: '自由编排验收片', durationSeconds: 6 }, {})
  const text = out.text ?? JSON.stringify(out)
  assert.match(text, /自由编排验收片/, 'title 必须落进骨架，证明只是关了模板入口')
})

test('关闭态 ★system prompt 覆盖小节确实注册且含禁用指令', () => {
  setChannel('0')
  const { ctx, sections } = mockCtx()
  const dispose = registerTemplateChannelPrompt(ctx)
  assert.equal(typeof dispose, 'function')
  assert.equal(sections.length, 1, '关闭态必须注入覆盖指令，压过 skill 文档里的旧模板章节')
  assert.equal(sections[0].name, TEMPLATE_CHANNEL_SECTION_NAME)
  assert.equal(sections[0].order, TEMPLATE_CHANNEL_SECTION_ORDER)
  assert.match(sections[0].text, /禁止调用 list_templates/)
  assert.match(sections[0].text, /自由编排/)
  assert.ok(!sections[0].text.includes('{{'), 'renderPrompt 严格解析变量，文本不得含双花括号')
  assert.equal(TEMPLATE_CHANNEL_OFF_TEXT, sections[0].text)
})

test('开启态 ★工具回归、模板仍可编译、覆盖小节不注册（一行恢复）', () => {
  setChannel('1')
  assert.equal(templateChannelEnabled(), true)
  const on = tools('1').map((definition) => definition.name)
  const off = tools('0').map((definition) => definition.name)
  assert.ok(on.includes('list_templates'), '恢复后模板清单工具必须回来')
  assert.equal(on.length, off.length + 1, '恢复只应多出模板清单这一个工具')
  setChannel('1')
  const { bundle } = loadTemplateBundle('science/three-cards')
  assert.ok(bundle.slots.length > 0, '模板资产与槽位合同必须原样保留')
  const { ctx, sections } = mockCtx()
  registerTemplateChannelPrompt(ctx)
  assert.equal(sections.length, 0, '开启态不应再注入「模板下线」指令')
})

test('收尾：恢复环境，不把关闭态泄漏给其它用例', () => {
  setChannel(undefined)
  assert.equal(templateChannelEnabled(), true)
})
