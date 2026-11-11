/**
 * 1（CV-463）· 模板通道的**工具层**：`list_templates` + `scaffold_manifest({ templateId })`。
 *
 * 守的是「模型能不能只用工具就选对、填对、落到盘」：
 *
 * 1. `list_templates` 传 `requirements` 时必须给出 ✅/❌ 与「恰好 1 个」结论；
 * 2. 槽位超限必须**编译前**拒收（`CS-USER-ERR` + 改到多少字），而不是出片后才发现字被裁；
 * 3. `templateId` 与 `recipe` / `title` 互斥（三个结构起点不许同时给）；
 * 4. `writeTo` 落盘的那份必须自己过校验，且带 `generatedBy`（K-9：否则每份模板片都带假告警）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { validateManifest } from '../lib/remotion/manifest.js'
import { loadTemplateBundle } from '../lib/remotion/template-registry.js'
import '../lib/errors/catalog.js'

const exec = {}

function tool(name, registry = {}) {
  const found = createStudioTools(registry, 3000).find((entry) => entry.name === name)
  assert.ok(found, `${name} 必须已注册`)
  return found
}

/** 用模板自己的示例值当填参（作者写的就是「合法内容」的样本）。 */
function exampleSlots(templateId) {
  const { bundle } = loadTemplateBundle(templateId)
  const slots = {}
  for (const slot of bundle.slots) {
    if (slot.example !== undefined) slots[slot.id] = slot.example
  }
  return slots
}

// ── list_templates ──────────────────────────────────────────────────────

test('1 ★list_templates：无 requirements ⇒ 全列且标明「未做适配判定」', async () => {
  const out = await tool('list_templates').execute({}, exec)
  const text = out.text ?? ''
  for (const id of ['science/three-cards', 'product/feature-walkthrough', 'report/data-summary']) {
    assert.ok(text.includes(id), `清单缺 ${id}：\n${text.slice(0, 400)}`)
  }
  assert.ok(text.includes('未做适配判定'), '没给 requirements 就必须说清「没判」')
  assert.ok(text.includes('scaffold_manifest'), '必须给下一步的具体调用式')
})

test('1 ★list_templates：给了 requirements ⇒ 逐条 ✅/❌ + 「恰好 1 个」结论', async () => {
  const out = await tool('list_templates').execute({
    requirements: { contentChars: 128, itemCount: 3, assetCount: 0, durationSeconds: 18 },
  }, exec)
  const text = out.text ?? ''
  assert.ok(text.includes('恰好 1 个模板适配'), `应判出唯一候选：\n${text}`)
  assert.ok(text.includes('science/three-cards'))
  assert.ok(text.includes('❌'), '不适配的模板必须给 ❌ 与原因')
  assert.ok(text.includes('容量'), '容量判据的拒因要出现')
})

test('1 ★list_templates：内容太少 ⇒ 信息充足度判红并提示改自由编排', async () => {
  const out = await tool('list_templates').execute({
    requirements: { contentChars: 8, itemCount: 1, assetCount: 0, durationSeconds: 18 },
  }, exec)
  const text = out.text ?? ''
  assert.ok(text.includes('信息充足度'), text.slice(0, 600))
  assert.ok(text.includes('没有模板通过适配判据'), '全红时要说清下一步（自由编排 + 显式告知用户）')
})

test('1 ★list_templates：按体裁过滤（未知体裁 ⇒ 说明可选题材）', async () => {
  const ok = await tool('list_templates').execute({ family: 'report' }, exec)
  assert.ok((ok.text ?? '').includes('report/data-summary'))
  assert.ok(!(ok.text ?? '').includes('science/three-cards'))
  const none = await tool('list_templates').execute({ family: 'nope' }, exec)
  assert.ok((none.text ?? '').includes('自由编排'), none.text)
})

// ── scaffold_manifest：模板通道 ─────────────────────────────────────────

test('1 ★scaffold dryRun：只给说明书（槽位合同 + 用量），不编译不出 JSON', async () => {
  const out = await tool('scaffold_manifest').execute({ templateId: 'science/three-cards', dryRun: true }, exec)
  const text = out.text ?? ''
  assert.ok(text.includes('slot'), `应含槽位合同：\n${text.slice(0, 300)}`)
  assert.ok(text.includes('card1Body'), '要点解释槽位要在清单里')
  assert.ok(text.includes('≤20 字'), '每个槽位必须给出字数上限')
  assert.ok(!text.includes('```json'), 'dryRun 不该产出 manifest JSON')
})

test('1 ★scaffold 编译前拦截：字数超限 ⇒ CS-USER-ERR 且文案含「改到 N 字以内」', async () => {
  const slots = exampleSlots('science/three-cards')
  slots.title = '这是一个明显超过十个字的主标题内容'
  const error = await tool('scaffold_manifest')
    .execute({ templateId: 'science/three-cards', slots }, exec)
    .then(() => undefined, (cause) => cause)
  assert.equal(error?.code, 'CS-USER-ERR')
  assert.match(error.message, /改到 10 字以内/u)
  assert.match(error.message, /删掉 \d+ 字/u)
})

test('1 ★scaffold 编译前拦截：必填槽缺失 ⇒ 拒收并点名槽位', async () => {
  const slots = exampleSlots('report/data-summary')
  delete slots.conclusion
  const error = await tool('scaffold_manifest')
    .execute({ templateId: 'report/data-summary', slots }, exec)
    .then(() => undefined, (cause) => cause)
  assert.equal(error?.code, 'CS-USER-ERR')
  assert.match(error.message, /conclusion/u)
  assert.match(error.message, /必填/u)
})

test('1 ★scaffold 互斥：templateId + recipe / title 必须拒收（三个结构起点只能选一个）', async () => {
  for (const args of [
    { templateId: 'science/three-cards', recipe: 'explainer-cards' },
    { templateId: 'science/three-cards', title: '自己起名', durationSeconds: 18 },
  ]) {
    const error = await tool('scaffold_manifest').execute(args, exec).then(() => undefined, (cause) => cause)
    assert.equal(error?.code, 'CS-USER-ERR', `${JSON.stringify(args)} 应被拒收`)
    assert.match(error.message, /互斥/u)
  }
})

test('1 ★scaffold 未知模板 ⇒ 拒收并列出可用模板', async () => {
  const error = await tool('scaffold_manifest')
    .execute({ templateId: 'nope/nothing', slots: {} }, exec)
    .then(() => undefined, (cause) => cause)
  assert.equal(error?.code, 'CS-USER-ERR')
  assert.match(error.message, /science\/three-cards/u)
})

test('1 ★scaffold writeTo：落盘的那份自己过校验、带 generatedBy、只回显前 40 行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-tpl-write-'))
  try {
    const registry = { list: async () => [{ id: 'p1', dir }], projectDir: () => dir }
    const entry = tool('scaffold_manifest', registry)
    const ctx = { agent: { session: { header: { cwd: dir } } } }
    const out = await entry.execute({
      templateId: 'product/feature-walkthrough',
      slots: exampleSlots('product/feature-walkthrough'),
      writeTo: 'build/manifest.json',
    }, ctx)
    const text = out.text ?? ''
    const path = join(dir, 'build', 'manifest.json')
    assert.ok(text.includes(path), `返回必须点名落盘路径：\n${text.slice(0, 300)}`)
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    assert.deepEqual(validateManifest(manifest).errors, [])
    assert.equal(manifest.meta.generatedBy, 'manifest-builder', 'K-9：模板产物必须带 builder 标记')
    assert.equal(manifest.meta.templateId, 'product/feature-walkthrough')
    assert.ok(Array.isArray(manifest.audio.sfx) && manifest.audio.sfx.length > 0, '模板音效要进 manifest')
    assert.ok(text.includes('render_composition'), '必须给出下一步（唯一出片口）')
    assert.ok(text.length < 12_000, `不该回显整份 JSON（实际 ${text.length} 字符）`)
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 沙箱可能拦删除 */ }
  }
})

test('1 ★scaffold 默认路径（自由编排）也带 generatedBy（否则每份骨架都被当手写）', async () => {
  const out = await tool('scaffold_manifest').execute({ title: '自由片', durationSeconds: 8 }, exec)
  const match = /```json\n([\s\S]*?)\n```/u.exec(out.text ?? '')
  assert.ok(match, '必须回显 JSON 代码块')
  const manifest = JSON.parse(match[1])
  assert.equal(manifest.meta.generatedBy, 'manifest-builder', 'K-9 修复点')
  assert.equal(validateManifest(manifest).warnings.some((line) => line.includes('generatedBy')), false)
})

// ── A1：配乐位（模板声明 → 模型生成 → bgmUrl 回传重编）─────────────────
//
// 真机会话的痛点：模型想出带 BGM 的片子，只能 `node -e` 手改 manifest 的 audio 段
// （4 次），因为它既不知道模板有配乐位，也不知道生成后怎么编进去。这三条守的就是
// 「宿主有没有把这条路铺到工具层」——文案里缺任何一环，模型就会退回手改 JSON。

test('A1 ★dryRun 列出配乐位（提示 / 时长 / 建议音量），否则模型不知道要生成 BGM', async () => {
  const out = await tool('scaffold_manifest').execute({ templateId: 'science/three-cards', dryRun: true }, exec)
  const text = out.text ?? ''
  assert.ok(text.includes('配乐位'), `dryRun 必须列配乐位：\n${text.slice(0, 400)}`)
  assert.match(text, /未内置音频/u, '要说清音频不是模板自带的')
  assert.match(text, /约 18s/u, '要给生成目标时长')
  assert.match(text, /建议音量/u)
})

test('A1 ★不给 bgmUrl ⇒ 回执给「生成 → 回传 → 出片」三条可执行指令', async () => {
  const out = await tool('scaffold_manifest').execute({
    templateId: 'science/three-cards',
    slots: exampleSlots('science/three-cards'),
  }, exec)
  const text = out.text ?? ''
  assert.match(text, /本次产物没有 BGM/u)
  assert.match(text, /纯器乐/u, '要指明生成纯器乐而不是歌曲')
  assert.match(text, /bgmUrl/u, '必须给回传参数名')
  assert.match(text, /render_composition/u, '最后一环要接上出片')
  assert.match(text, /未配乐/u, '不配乐也可以，但要显式告知用户')
})

test('A1 ★给 bgmUrl ⇒ 一次编进产物（bgmUrl + 模板建议音量），回执不再催补', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-tpl-bgm-'))
  try {
    const registry = { list: async () => [{ id: 'p1', dir }], projectDir: () => dir }
    const ctx = { agent: { session: { header: { cwd: dir } } } }
    const { bundle } = loadTemplateBundle('report/data-summary')
    const out = await tool('scaffold_manifest', registry).execute({
      templateId: 'report/data-summary',
      slots: exampleSlots('report/data-summary'),
      bgmUrl: '/canvas-studio/remotion/sfx/card.wav',
      writeTo: 'build/manifest.json',
    }, ctx)
    const text = out.text ?? ''
    const manifest = JSON.parse(readFileSync(join(dir, 'build', 'manifest.json'), 'utf8'))
    assert.equal(manifest.audio.bgmUrl, '/canvas-studio/remotion/sfx/card.wav')
    assert.equal(manifest.audio.mix.bgmVolume, bundle.audio.bgm.volume, '模板建议音量要落地')
    assert.match(text, /BGM 已接入/u)
    assert.ok(!text.includes('本次产物没有 BGM'), '接上了就不该再催补')
    assert.deepEqual(validateManifest(manifest).errors, [])
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 沙箱可能拦删除 */ }
  }
})
