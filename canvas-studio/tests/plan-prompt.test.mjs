/**
 * CV-099/CV-100：项目预置（plan-prompt 纯函数）与剧本门禁状态（script_review）
 * 的单元测试。直连 Host 侧编译产物 lib/。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWorkflow, resolveSetModePatch } from '../lib/contracts/project.js'
import { planSectionText, PLAN_SECTION_NAME, PLAN_SECTION_ORDER } from '../lib/plan-prompt.js'

test('CV-099 planSectionText：无预置返回空串（不注入小节）', () => {
  assert.equal(planSectionText(undefined), '')
  assert.equal(planSectionText({}), '')
})

test('CV-099 planSectionText：仅画幅时不含时长 bullet 与镜头数推导', () => {
  const text = planSectionText({ aspectRatio: '9:16' })
  assert.ok(text.includes('9:16'))
  assert.ok(!text.includes('目标总时长：'))
  assert.ok(!text.includes('建议镜头数'))
})

test('CV-099 planSectionText：30s 预置给出 2–3 镜推导与跳过规则', () => {
  const text = planSectionText({ aspectRatio: '16:9', targetDuration: 30 })
  assert.ok(text.includes('16:9'))
  assert.ok(text.includes('30 秒'))
  assert.ok(text.includes('2–3 镜'))
  assert.ok(text.includes('跳过'))
  // renderPrompt 严格解析变量引用，小节文本禁用 {{ }}
  assert.ok(!text.includes('{{'))
})

test('CV-099 planSectionText：15s 下限为 1 镜（ceil(15/15)），上界不低于下界', () => {
  const text = planSectionText({ targetDuration: 15 })
  assert.ok(text.includes('1–2 镜'))
})

test('CV-099 小节命名与顺序：命名空间化 + 落在工具指引带', () => {
  assert.equal(PLAN_SECTION_NAME, 'canvas-studio:project-plan')
  assert.ok(Number.isFinite(PLAN_SECTION_ORDER) && PLAN_SECTION_ORDER >= 100 && PLAN_SECTION_ORDER < 200)
})

test('CV-100 script_review：normalizeWorkflow 白名单接受该状态', () => {
  assert.equal(normalizeWorkflow({ mode: 'confirm', state: 'script_review' }).state, 'script_review')
  // 脏数据仍降级 drafting
  assert.equal(normalizeWorkflow({ mode: 'confirm', state: 'screenplay' }).state, 'drafting')
})

test('CV-100 script_review：切放手跑 → executing（解除等待）', () => {
  const patch = resolveSetModePatch({ mode: 'confirm', state: 'script_review' }, 'auto')
  assert.deepEqual(patch, { mode: 'auto', state: 'executing' })
})

test('CV-100 script_review：切逐步确认 → 保持等待（镜像 awaiting_approval 语义）', () => {
  const patch = resolveSetModePatch({ mode: 'auto', state: 'script_review' }, 'confirm')
  assert.deepEqual(patch, { mode: 'confirm' })
})
