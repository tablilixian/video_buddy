/**
 * R11（2026-11-16）· **出片优先（M1）护栏** —— 骨架落盘之后不许先去改渲染层。
 *
 * ## 病史
 *
 * 真机一次会话 13:22 → 15:02（100 分钟）**零成片**，根因不是渲染慢：
 * - `scaffold_manifest` 在 14:41 就成功落盘了（116 轨、`validateManifest` 通过，回执里
 *   明写「下一步：直接 render_composition({ manifestPath, quality:"draft" })」）；
 * - 模型却因为「画幅是 1920×1080、我要 9:16」转去**重读渲染层源码 + 计划另写生成器**，
 *   之后 21 分钟 17 次 `bash`、21 万字符推理、**一次没落笔、一次没渲**。
 *
 * 所以「先出片」这条不能只写在 skill 正文里（它已经写过，仍被绕过）—— 必须同时落在
 * **工具描述**上：工具描述每一步都在上下文里，skill 只在开头读一次。
 *
 * 本文件钉三件事：① 工具描述带硬规则；② skill 正文带硬规则（两处 canonical 分册）；
 * ③ 判据词表一致（「会被裁掉」/「盒高只有」），否则模型看不懂回执。
 *
 * 定向跑：node --test tests/req038-r11-render-first.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStudioTools } from '../lib/host-tools.js'

const ROOT = new URL('../', import.meta.url)

function read(rel) {
  return readFileSync(new URL(rel, ROOT), 'utf8')
}

function scaffoldDescription() {
  const tool = createStudioTools({}, 3000).find((entry) => entry.name === 'scaffold_manifest')
  assert.ok(tool, 'scaffold_manifest 必须注册')
  return String(tool.description ?? '')
}

test('R11-出片优先：scaffold_manifest 的工具描述写明「下一条命令必须是 render_composition」', () => {
  const described = scaffoldDescription()
  assert.match(described, /下一条命令必须是/, '工具描述要给出顺序硬规则')
  assert.match(described, /render_composition/, '要点名具体工具，不能只说「出片」')
  assert.match(described, /改 spec 重跑/, '要给出正确出口：画幅/字号不对都是 spec 的问题')
  assert.match(described, /不要另写生成器|不要.{0,8}另写生成器/, '真机事故的路径要显式禁掉')
})

test('R11-出片优先：skill 正文（SKILL.md + content-spec.md）带同一条硬规则', () => {
  const skill = read('skills/code-driven-explainer/SKILL.md')
  assert.match(skill, /下一条命令必须是\s*`render_composition`/, 'SKILL.md 的组装步骤要写死顺序')
  const spec = read('skills/code-driven-explainer/references/content-spec.md')
  assert.match(spec, /## 出片优先（M1 硬规则/, '分册要有独立小节，便于模型按需回读')
  assert.match(spec, /禁止/, '要显式禁止「读改宿主源码 / 另写生成器」')
})

test('R11-出片优先：判据词表与回执同源（「会被裁掉」= 必须改 / 「盒高只有」= 字被压小）', () => {
  const described = scaffoldDescription()
  assert.match(described, /会被裁掉/)
  assert.match(described, /盒高只有/)
  // 两个词必须真的会由代码吐出（不是描述里编的）：
  const plan = read('src/remotion/text-fit-plan.ts')
  assert.match(plan, /成片会裁掉多出的/, '溢出文案的正本在 text-fit-plan.ts')
  assert.match(plan, /盒高只有/, '盒高压号的文案正本在 text-fit-plan.ts')
})
