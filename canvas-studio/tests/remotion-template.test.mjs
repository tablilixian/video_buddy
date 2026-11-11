/**
 * 1（CV-463）· 模板库内核：槽位合同 / 编译器 / 注册表 / 五条判据。
 *
 * 守的核心是四条（`执行总表.md` §5.5）：
 *
 * 1. **同输入编译两次逐字节相同**（确定性 —— 不能有 `Date.now()` / `Math.random()`）；
 * 2. **不同 slots 编译两次，除文本字段外轨道结构逐字节相同**（「只改内容不动结构」的机器证明）；
 * 3. **产物与骨架都过 `validateManifest`**；
 * 4. **槽位超限在编译前拦下**，且文案能直接指导「改到多少字」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  charCount,
  lineCount,
  requiredCapacity,
  resolveSlotValues,
  validateSlotValues,
} from '../lib/remotion/slot-contract.js'
import { compileTemplate, TemplateContractError } from '../lib/remotion/template-compile.js'
import { gateTemplate, INFO_SUFFICIENCY_MIN_RATIO } from '../lib/remotion/template-gate.js'
import { listTemplateSummaries, loadTemplateBundle } from '../lib/remotion/template-registry.js'
import { validateManifest } from '../lib/remotion/manifest.js'

const REAL_TEMPLATES = ['science/three-cards', 'product/feature-walkthrough', 'report/data-summary']

/** 用模板自己的 `example` 当填参（最稳的「合法内容」来源：作者亲手写的示例）。 */
function exampleValues(bundle) {
  const values = {}
  for (const slot of bundle.slots) {
    if (slot.example !== undefined) values[slot.id] = slot.example
  }
  return values
}

const SLOT = (over) => ({ id: 'x', label: '示例槽', type: 'string', required: true, ...over })

// ── ① 槽位合同 ──────────────────────────────────────────────────────────

test('1 ★槽位：必填缺失 ⇒ error，文案带槽位名、语义与示例', () => {
  const issues = validateSlotValues([SLOT({ id: 'title', label: '主标题', semantic: '一句话结论', example: '四季从哪来' })], {})
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'SLOT_REQUIRED')
  assert.equal(issues[0].severity, 'error')
  for (const piece of ['title', '主标题', '一句话结论', '四季从哪来']) {
    assert.ok(issues[0].message.includes(piece), `文案缺「${piece}」：${issues[0].message}`)
  }
})

test('1 ★槽位：类型不符 ⇒ error（string[] 不许传字符串）', () => {
  const issues = validateSlotValues([SLOT({ id: 'tags', label: '标签', type: 'string[]' })], { tags: '第一行' })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, 'SLOT_TYPE')
  assert.ok(issues[0].message.includes('数组'), issues[0].message)
})

test('1 ★槽位：总字数超限 ⇒ error，且告诉「删掉几字」', () => {
  const issues = validateSlotValues([SLOT({ maxChars: 10 })], { x: '一'.repeat(13) })
  assert.equal(issues[0].code, 'SLOT_TOO_LONG')
  assert.ok(issues[0].message.includes('13 字'), issues[0].message)
  assert.ok(issues[0].message.includes('删掉 3 字'), issues[0].message)
})

test('1 ★槽位：行数按「行」算而不是按换行符个数（2 行 OK / 3 行红）', () => {
  const slot = SLOT({ maxLines: 2 })
  assert.deepEqual(validateSlotValues([slot], { x: '一\n二' }), [], '2 行必须放行')
  const three = validateSlotValues([slot], { x: '一\n二\n三' })
  assert.equal(three.length, 1)
  assert.equal(three[0].code, 'SLOT_TOO_MANY_LINES')
  assert.ok(three[0].message.includes('3 行'), three[0].message)
})

test('1 ★槽位：数组按长度判行数、按元素判单行（两个元素各 20 字 = 合法）', () => {
  const slot = SLOT({ id: 'body', label: '正文', type: 'string[]', maxLines: 2, maxCharsPerLine: 20, maxChars: 40 })
  assert.deepEqual(validateSlotValues([slot], { body: ['一'.repeat(20), '二'.repeat(20)] }), [])
  const tooMany = validateSlotValues([slot], { body: ['一', '二', '三'] })
  assert.equal(tooMany[0].code, 'SLOT_TOO_MANY_LINES', '数组 3 元素 > maxLines 2 必须拒')
  const tooLongLine = validateSlotValues([slot], { body: ['一'.repeat(21)] })
  assert.equal(tooLongLine[0].code, 'SLOT_LINE_TOO_LONG')
  assert.ok(tooLongLine[0].message.includes('第 1 行'), tooLongLine[0].message)
})

test('1 ★槽位：多余槽位只 warning（不阻断），并列出可用槽位', () => {
  const issues = validateSlotValues([SLOT({ id: 'title' })], { title: '好', 多余: 1 })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].severity, 'warning')
  assert.equal(issues[0].code, 'SLOT_UNKNOWN')
  assert.ok(issues[0].message.includes('title'), issues[0].message)
})

test('1 ★槽位：default 先合并再校验（必填由缺省值满足）', () => {
  const slots = [SLOT({ id: 'title', default: '四季从哪来' })]
  const merged = resolveSlotValues(slots, {})
  assert.deepEqual(validateSlotValues(slots, merged), [])
})

test('1：charCount 按码点、不计换行（与 text-fit-plan 同口径）', () => {
  assert.equal(charCount('四季\n从哪来'), 5)
  assert.equal(charCount('👍👍'), 2, 'emoji 算 1 字（码点）而非 2')
  assert.equal(lineCount('一\n二\n三'), 3)
  assert.equal(requiredCapacity([SLOT({ maxChars: 10 }), SLOT({ id: 'y', maxChars: 20 }), SLOT({ id: 'z', required: false, maxChars: 99 })]), 30)
})

// ── ② 编译器 ────────────────────────────────────────────────────────────

test('1 ★编译：真实模板全部能编译，产物轨道数 = 骨架 + 构件，音效已注入', () => {
  for (const id of REAL_TEMPLATES) {
    const { bundle } = loadTemplateBundle(id)
    const out = compileTemplate(bundle, exampleValues(bundle))
    assert.equal(out.ok, true, `${id} 编译失败：${out.errors.join('；')}`)
    assert.equal(out.manifest.tracks.length, bundle.skeleton.tracks.length + out.stats.furnitureTracks)
    assert.ok(out.stats.furnitureTracks > 0, `${id} 的装饰构件没展开`)
    assert.equal(out.stats.sfxCount, bundle.audio.sfx.length)
    assert.equal(out.manifest.audio.sfx.length, bundle.audio.sfx.length)
    assert.deepEqual(validateManifest(out.manifest).errors, [])
    assert.deepEqual(out.warnings, [], `${id} 产物不该有体检告警：${out.warnings.join('；')}`)
  }
})

test('1 ★编译：同输入编译两次逐字节相同（确定性）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const values = exampleValues(bundle)
  const first = compileTemplate(bundle, values).manifest
  const second = compileTemplate(bundle, values).manifest
  const a = JSON.stringify(first, null, 2)
  const b = JSON.stringify(second, null, 2)
  assert.equal(a, b, '同输入两次编译必须逐字节相同（禁 Date.now / Math.random）')
  // ⚠️ 只比字节**不够**：`Date.now()` 的分辨率是 1ms，连续两次编译常常落在同一毫秒里
  // ⇒ 掺了时间的 id 也能过上面那条（反向变异 B 实测：23/23 全绿）。所以这里同时钉住
  // id 的形状：`comp-tpl-` + 8 位内容哈希，**不许有任何时间成分**。
  assert.match(first.id, /^comp-tpl-[0-9a-f]{8}$/u, `id 必须只由内容哈希决定，实际 ${first.id}`)
  // 换一份内容 ⇒ id 必须变（否则哈希没吃到 values）
  const other = compileTemplate(bundle, { ...values, title: '换一个标题' }).manifest
  assert.notEqual(other.id, first.id, '内容变了 id 必须变')
})

test('1 ★编译：不同 slots 编译两次 ⇒ 除文本外结构逐字节相同', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const first = exampleValues(bundle)
  const second = {
    ...first,
    title: '玻璃为什么透明',
    lead: '因为它根本不吸收可见光',
    card1: '没有杂质',
  }
  const shape = (manifest) => {
    // 只抹掉「内容位」：textCard.text / dataCard.data，以及 meta.title（也是槽位）
    const clone = JSON.parse(JSON.stringify(manifest))
    for (const track of clone.tracks) {
      if ('text' in track) track.text = '<text>'
      if ('data' in track) track.data = track.data.map(() => '<k/v>')
    }
    clone.meta.title = '<title>'
    clone.id = '<id>'
    return JSON.stringify(clone)
  }
  const a = compileTemplate(bundle, first)
  const b = compileTemplate(bundle, second)
  assert.equal(a.ok && b.ok, true)
  assert.equal(shape(a.manifest), shape(b.manifest), '换内容不许改结构（版式 / 时机 / 构件位置必须逐字节一致）')
  assert.notEqual(
    JSON.stringify(a.manifest.tracks.find((track) => track.id === 'card1').text),
    JSON.stringify(b.manifest.tracks.find((track) => track.id === 'card1').text),
    '内容确实换了（否则上面的相等是无意义的）',
  )
})

test('1 ★编译：meta 补 templateId / generatedBy / family，且时长 = 最大结束帧（K-6）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const out = compileTemplate(bundle, exampleValues(bundle))
  assert.equal(out.manifest.meta.templateId, 'science/three-cards')
  assert.equal(out.manifest.meta.generatedBy, 'manifest-builder', '编译器就是 builder（K-9：不写就会被当成手写）')
  // P-7：family 落地产物（G2 段组合唯一「同族可拼」判据）。缺了这条，将来只能靠 templateId 前缀猜。
  assert.equal(out.manifest.meta.family, 'science', 'meta.family 必须随产物落地')
  // ⚠️ 光有值不够：`family` 若不进 KNOWN_META_KEYS 会被 warnUnknownKeys 报「未知键」，
  // 而编译器的出厂自检只拦 error 不拦 warning ⇒ 上面那条 assert 照样绿。
  // 所以这里必须钉「产物零告警」，否则「字段生效」是假象。
  const verdict = validateManifest(out.manifest)
  assert.deepEqual(verdict.warnings, [], `产物不该有告警，实际 ${JSON.stringify(verdict.warnings)}`)
  const maxEnd = Math.max(...out.manifest.tracks.map((track) => track.startFrame + track.durationInFrames))
  assert.equal(out.manifest.meta.durationInFrames, maxEnd)
})

test('1 ★编译：占位符指向不存在的槽 ⇒ 结构错误（不许当空串糊过去）', () => {
  const bundle = {
    meta: { id: 'x/y', name: '坏模板', family: 'x', version: '1', contractVersion: '1', summary: '', suitableFor: [], notSuitableFor: [], durationInFrames: 30, fps: 30, aspect: '16:9' },
    skeleton: { id: 't', meta: { title: 't', width: 1920, height: 1080, fps: 30, durationInFrames: 30 }, tracks: [] },
    slots: [],
  }
  // 骨架里写了一个没人声明的占位符
  bundle.skeleton.meta.title = '{{nobody}}'
  const out = compileTemplate(bundle, {})
  assert.equal(out.ok, false)
  assert.ok(out.errors.some((line) => line.includes('nobody') && line.includes('占位符')), out.errors.join('；'))
})

test('1 ★编译：契约版本不符 ⇒ 明确抛错（不许静默降级出假成功）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  assert.throws(
    () => compileTemplate({ ...bundle, meta: { ...bundle.meta, contractVersion: '99' } }, exampleValues(bundle)),
    (error) => error instanceof TemplateContractError && /v99/.test(error.message),
  )
})

test('1 ★骨架自洽：三份 manifest.template.json 不替换占位符也能过校验（占位符是合法字符串）', () => {
  for (const id of REAL_TEMPLATES) {
    const { bundle } = loadTemplateBundle(id)
    const verdict = validateManifest(bundle.skeleton)
    assert.deepEqual(verdict.errors, [], `${id} 骨架过不了校验：${verdict.errors.join('；')}`)
    assert.deepEqual(verdict.warnings, [], `${id} 骨架有告警：${verdict.warnings.join('；')}`)
  }
})

// ── ③ 五条判据 ──────────────────────────────────────────────────────────

test('1 ★判据：五条各自能红（容量 / 素材 / 时长 / 条目数 / 信息充足度）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const capacity = requiredCapacity(bundle.slots)

  const capacityFail = gateTemplate(bundle.meta, bundle.slots, { contentChars: capacity + 10 })
  assert.deepEqual(capacityFail.failures.map((failure) => failure.criterion), ['capacity'])

  const assetFail = gateTemplate({ ...bundle.meta, requiredAssets: ['产品图'] }, bundle.slots, { assetCount: 0 })
  assert.deepEqual(assetFail.failures.map((failure) => failure.criterion), ['assets'])

  const durationFail = gateTemplate(bundle.meta, bundle.slots, { durationSeconds: 90 }, { minInfoRatio: 0 })
  assert.deepEqual(durationFail.failures.map((failure) => failure.criterion), ['duration'])

  const itemFail = gateTemplate(bundle.meta, bundle.slots, { itemCount: 5 }, { minInfoRatio: 0 })
  assert.deepEqual(itemFail.failures.map((failure) => failure.criterion), ['itemCount'])

  const infoFail = gateTemplate(bundle.meta, bundle.slots, { contentChars: 5 })
  assert.deepEqual(infoFail.failures.map((failure) => failure.criterion), ['infoSufficiency'])
  assert.ok(infoFail.failures[0].message.includes('35%'), infoFail.failures[0].message)
})

test('1 ★判据：判据字段缺省 ⇒ 该条不参与（不给 ≠ 0）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  assert.equal(gateTemplate(bundle.meta, bundle.slots, {}).pass, true, '什么都不给就不该误判')
  assert.equal(gateTemplate(bundle.meta, bundle.slots, { itemCount: 3 }).pass, true, '3 条 ≤ 3 个卡片位')
})

test('1 ★判据：内容填充合理时全过（science 模板 + 真实需求）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const capacity = requiredCapacity(bundle.slots)
  const gate = gateTemplate(bundle.meta, bundle.slots, {
    contentChars: Math.round(capacity * 0.7),
    itemCount: 3,
    assetCount: 0,
    durationSeconds: 18,
  })
  assert.equal(gate.pass, true, gate.failures.map((failure) => failure.message).join('；'))
})

test('1 ★判据：阈值可配置（minInfoRatio 覆盖缺省）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const capacity = requiredCapacity(bundle.slots)
  const contentChars = Math.round(capacity * (INFO_SUFFICIENCY_MIN_RATIO - 0.05))
  assert.equal(gateTemplate(bundle.meta, bundle.slots, { contentChars }).pass, false)
  assert.equal(gateTemplate(bundle.meta, bundle.slots, { contentChars }, { minInfoRatio: 0.05 }).pass, true)
})

test('1 ★判据：三模板里「恰好 1 个通过」可被判出来（自动选模板的前提）', () => {
  const catalog = listTemplateSummaries()
  // 128 字：只有科普模板（必填槽容量 134）装得下 —— 产品 122 / 汇报 90 都在容量判据红。
  const requirement = {
    contentChars: 128,
    itemCount: 3,
    assetCount: 0,
    durationSeconds: 18,
  }
  const passing = catalog.items.filter((item) => gateTemplate(item.meta, item.slots, requirement).pass)
  assert.equal(passing.length, 1, `应恰好 1 个通过，实际：${passing.map((item) => item.meta.id).join(' / ') || '0 个'}`)
  assert.equal(passing[0].meta.id, 'science/three-cards', '18s 的需求只有科普模板装得下')
})

// ── ④ 注册表 ────────────────────────────────────────────────────────────

test('1 ★注册表：三个模板都在册、契约版本一致、按 id 排序', () => {
  const catalog = listTemplateSummaries()
  assert.deepEqual(catalog.items.map((item) => item.meta.id), [...REAL_TEMPLATES].sort())
  assert.deepEqual(catalog.problems, [])
  for (const item of catalog.items) {
    assert.equal(item.contractOk, true, `${item.meta.id} 契约版本不符`)
    assert.ok(item.slotSummary.length > 0)
    assert.ok(item.slotSummary.every((slot) => slot.required), '模板起步阶段应全是必填槽（可选槽等有真实需求再加）')
  }
})

test('1 ★注册表：坏模板点名（缺 meta.json / id 与目录不一致）而不是静默跳过', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-tpl-root-'))
  try {
    mkdirSync(join(root, 'demo', 'broken'), { recursive: true })
    mkdirSync(join(root, 'demo', 'mismatch'), { recursive: true })
    writeFileSync(join(root, 'demo', 'broken', 'slots.json'), '{"slots":[]}', 'utf8')
    writeFileSync(join(root, 'demo', 'mismatch', 'meta.json'), JSON.stringify({ id: 'demo/other', name: 'x', family: 'demo', version: '1', contractVersion: '1', summary: '', suitableFor: [], notSuitableFor: [], durationInFrames: 30, fps: 30, aspect: '16:9' }), 'utf8')
    writeFileSync(join(root, 'demo', 'mismatch', 'slots.json'), '{"slots":[]}', 'utf8')
    const catalog = listTemplateSummaries({ root })
    assert.equal(catalog.items.length, 0)
    assert.equal(catalog.problems.length, 2)
    assert.ok(catalog.problems.some((problem) => problem.reason.includes('meta.json')))
    assert.ok(catalog.problems.some((problem) => problem.reason.includes('不一致')))
  } finally {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* 沙箱可能拦删除 */ }
  }
})

test('1 ★注册表：未知模板 id ⇒ 报错并列出可用模板（不返回空对象）', () => {
  assert.throws(() => loadTemplateBundle('nope/nothing'), (error) => /可用/.test(error.message) && /science\/three-cards/.test(error.message))
})

// ── ⑤ 配乐位（A1）──────────────────────────────────────────────────────
//
// 口径：模板**不自带音频文件**（D-35：一首 20s 免版税曲子 3–5MB + 授权审计），
// 只声明「要什么样的曲子」；实际音频由模型现场生成后经 `bgmUrl` 编进产物。
// 三条必须成立：① 不给 URL 时产物**不能**撒谎说「有配乐」；② 给了 URL 时模板建议的
// 音量/淡入淡出一次落地；③ 换曲子不动结构（BGM 是内容，不是布局）。

const BGM_URL = '/canvas-studio/remotion/sfx/card.wav'

test('A1 ★配乐位：三个真实模板都声明了可执行的配乐位（提示 / 音量 / 时长与整片一致）', () => {
  for (const id of REAL_TEMPLATES) {
    const { bundle } = loadTemplateBundle(id)
    const bgm = bundle.audio?.bgm
    assert.ok(bgm !== undefined, `${id} 没声明配乐位`)
    assert.ok(bgm.prompt.trim().length > 20, `${id} 的配乐提示太短（模型无从生成）：${bgm.prompt}`)
    assert.ok(bgm.volume === undefined || (bgm.volume > 0 && bgm.volume <= 1), `${id} 的 volume 越界：${bgm.volume}`)
    assert.equal(bgm.durationSeconds, Math.round(bundle.meta.durationInFrames / bundle.meta.fps), `${id} 的时长与整片不一致`)
  }
})

test('A1 ★配乐位：不给 bgmUrl ⇒ 产物无 BGM，且回传可执行的配乐请求（不静默丢）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const out = compileTemplate(bundle, exampleValues(bundle))
  assert.equal(out.ok, true, out.errors.join('；'))
  assert.equal(out.stats.bgmApplied, false)
  assert.equal(out.manifest.audio.bgmUrl, undefined)
  assert.equal(out.manifest.audio.mix, undefined, '没接 BGM 时不该留孤立 mix（读起来像配乐丢了）')
  assert.equal(out.manifest.audio.fadeInSeconds, undefined, '淡入只在真接了 BGM 时才写')
  assert.ok(out.bgmRequest !== undefined, '模板有配乐位就必须回传请求，否则模型不知道要补')
  assert.equal(out.bgmRequest.prompt, bundle.audio.bgm.prompt)
})

test('A1 ★配乐位：给了 bgmUrl ⇒ 地址 + 模板建议的音量/淡入淡出一次落地，产物仍过校验', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const out = compileTemplate(bundle, exampleValues(bundle), { bgmUrl: BGM_URL })
  assert.equal(out.ok, true, out.errors.join('；'))
  assert.equal(out.stats.bgmApplied, true)
  assert.equal(out.bgmRequest, undefined, '接上了就没有下一步要交代')
  assert.equal(out.manifest.audio.bgmUrl, BGM_URL)
  assert.equal(out.manifest.audio.mix.bgmVolume, bundle.audio.bgm.volume)
  assert.equal(out.manifest.audio.fadeInSeconds, bundle.audio.bgm.fadeInSeconds)
  assert.equal(out.manifest.audio.fadeOutSeconds, bundle.audio.bgm.fadeOutSeconds)
  assert.deepEqual(validateManifest(out.manifest).errors, [])
})

test('A1 ★配乐位：换 BGM 不动结构（轨道段逐字节相同），同输入仍逐字节确定', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const values = exampleValues(bundle)
  const a = compileTemplate(bundle, values, { bgmUrl: BGM_URL }).manifest
  const b = compileTemplate(bundle, values, { bgmUrl: BGM_URL }).manifest
  assert.equal(JSON.stringify(a), JSON.stringify(b), '同输入两次编译必须逐字节相同（BGM 也不能引入时间成分）')
  const other = compileTemplate(bundle, values, { bgmUrl: '/canvas-studio/remotion/sfx/thud.wav' }).manifest
  assert.equal(JSON.stringify(a.tracks), JSON.stringify(other.tracks), '换曲子只该动 audio，不该动轨道')
  assert.notEqual(JSON.stringify(a.audio), JSON.stringify(other.audio))
})

test('A1 ★编译：bgm 缺 prompt ⇒ 点名 warning 且不产请求（模板缺陷不能静默）', () => {
  const { bundle } = loadTemplateBundle('science/three-cards')
  const broken = { ...bundle, audio: { sfx: [], bgm: { volume: 0.3 } } }
  const out = compileTemplate(broken, exampleValues(bundle))
  assert.equal(out.bgmRequest, undefined)
  assert.ok(out.warnings.some((line) => line.includes('prompt')), `warnings 必须点名缺 prompt：${out.warnings.join('；')}`)
})

test('A1 ★注册表：audio.json 的旧裸数组写法照样认（1/CV-463 的老模板不用改文件）', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-tpl-audio-'))
  try {
    const dir = join(root, 'demo', 'mini')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({
      id: 'demo/mini', name: '小模板', family: 'demo', version: '1', contractVersion: '1',
      summary: '', suitableFor: [], notSuitableFor: [], durationInFrames: 30, fps: 30, aspect: '16:9',
    }), 'utf8')
    writeFileSync(join(dir, 'slots.json'), '{"slots":[]}', 'utf8')
    writeFileSync(join(dir, 'manifest.template.json'), JSON.stringify({ id: 'x', meta: { durationInFrames: 30, fps: 30 }, tracks: [] }), 'utf8')
    writeFileSync(join(dir, 'audio.json'), JSON.stringify([{ src: BGM_URL, startSec: 1 }]), 'utf8')
    const { bundle } = loadTemplateBundle('demo/mini', { root })
    assert.equal(bundle.audio.sfx.length, 1, '裸数组必须归一成 { sfx }')
    assert.equal(bundle.audio.bgm, undefined)
  } finally {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* 沙箱可能拦删除 */ }
  }
})
