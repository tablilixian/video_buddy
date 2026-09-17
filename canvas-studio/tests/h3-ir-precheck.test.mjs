/**
 * CV-119：H3-Context-IR 工具层预检（assertH3IrPrompt / looksLikeH3Ir）契约测试。
 *
 * 闸门语义：
 *  1. 官方 4 组 IR（tests/fixtures/official_ir.json）经预检必须全部放行；
 *  2. 纯文本 prompt（含单标记误报场景）必须原样透传，绝不误拦；
 *  3. 半成品 IR（漏段 / 模板混用 / 模式用错）必须抛错且报错信息带规则名。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assertH3IrPrompt, looksLikeH3Ir, detectIrTemplate, irModeMismatchHint, modeByPictureCount, prepareH3IrPrompt } from '../lib/h3-ir-validate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OFFICIAL_IR = JSON.parse(readFileSync(join(HERE, 'fixtures', 'official_ir.json'), 'utf8'))

/** 与 validate.py --self-test 相同的素材计数方式。 */
function materialCounts(pair) {
  const counts = { image_url: 0, video_url: 0, audio_url: 0 }
  for (const c of pair.request.content) {
    if (c.type in counts) counts[c.type] += 1
  }
  return counts
}

/** 预检不抛 = 放行。 */
function assertPasses(text, opts) {
  assert.doesNotThrow(() => assertH3IrPrompt(text, opts))
}

/** 预检必须抛，且信息包含指定规则名。 */
function assertThrowsWith(text, opts, rule) {
  assert.throws(
    () => assertH3IrPrompt(text, opts),
    (err) => {
      assert.equal(typeof err.message, 'string')
      return err.message.includes(rule)
    },
    `预检应报出 ${rule}`,
  )
}

const A1 = OFFICIAL_IR.find((p) => p.id === 'A1-t2va-space-10s')
const A2 = OFFICIAL_IR.find((p) => p.id === 'A2-i2va-ramen-8s')
const A3 = OFFICIAL_IR.find((p) => p.id === 'A3-ref2va-lamb-5s')

// ---------------- 1. 官方 IR 全放行 ----------------

test('CV-119：官方 IR 经预检全部放行（与校验器闸门同源）', () => {
  for (const pair of OFFICIAL_IR) {
    const counts = materialCounts(pair)
    assertPasses(pair.ir_output, {
      mode: pair.mode,
      duration: pair.duration,
      pictures: counts.image_url,
      videos: counts.video_url,
      audios: counts.audio_url,
    })
  }
})

// ---------------- 2. 纯文本透传（防误伤） ----------------

test('纯文本 prompt 原样透传，不触发预检', () => {
  const plain = '一只橘猫在午后阳光下伸懒腰，镜头缓缓推近它的眼睛，温暖的钢琴配乐。'
  assert.equal(looksLikeH3Ir(plain), false)
  assertPasses(plain, { mode: 'T2VA', duration: 5 })
})

test('单个可疑标记不构成 IR（防误报）——一行 summary: 开头不算', () => {
  const borderline = 'a cinematic shot of the city at dusk\nsummary: golden hour, slow pan'
  assert.equal(looksLikeH3Ir(borderline), false)
  assertPasses(borderline, { mode: 'T2VA', duration: 5 })
})

// ---------------- 3. 半成品 IR 必须拦下 ----------------

test('漏段（删掉 non_diegetic_music）→ 抛错含 [S1]', () => {
  const lines = A1.ir_output.split('\n')
  const start = lines.findIndex((l) => l.startsWith('non_diegetic_music:'))
  assert.ok(start > 0, 'fixture 里应存在 non_diegetic_music 段')
  const ndEnd = lines.findIndex((l, i) => i > start && /^[a-z_]+:/.test(l))
  const cut = lines.filter((_, i) => i < start || (ndEnd >= 0 && i >= ndEnd)).join('\n')
  assert.notEqual(cut, A1.ir_output)
  assertThrowsWith(cut, { mode: 'T2VA', duration: 10 }, '[S1]')
})

test('三段式里混入 <Subject N> 标签 → 抛错含 [M1]', () => {
  const mixed = A1.ir_output.replace('[Shot 1]', '<Subject 1> [Shot 1]')
  assertThrowsWith(mixed, { mode: 'T2VA', duration: 10 }, '[M1]')
})

test('模式用错（I2VA 简报按 T2VA 预检）→ 抛错含 [K5]', () => {
  assertThrowsWith(A2.ir_output, { mode: 'T2VA', duration: 8, pictures: 1 }, '[K5]')
})

test('时间戳超出有效时长 → 抛错含 [T4]', () => {
  // A1 是 10s 简报（Shot 2 时间戳 4.5s）：把有效时长钳到 4s，T4 必触发
  assertThrowsWith(A1.ir_output, { mode: 'T2VA', duration: 4 }, '[T4]')
})

test('报错信息可指导修复（含规则名与修正指引）', () => {
  const mixed = A1.ir_output.replace('[Shot 1]', '<Subject 1> [Shot 1]')
  assert.throws(
    () => assertH3IrPrompt(mixed, { mode: 'T2VA', duration: 10 }),
    (err) => err.message.includes('h3-prompt-writing') && err.message.includes('ERROR'),
  )
})

// ---------------- 4. CV-156 模式判定双轨：真因必须被点出来 ----------------

test('CV-156：detectIrTemplate 只认模板形态，不认模式', () => {
  assert.equal(detectIrTemplate(A1.ir_output), 'base')
  assert.equal(detectIrTemplate(A3.ir_output), 'ref')
  assert.equal(detectIrTemplate('一只猫在窗台上晒太阳。'), null)
  // 半成品 IR：只有段名、没有内容，也要能判出想走哪套模板
  assert.equal(detectIrTemplate('summary: [keyframe completion] foo'), 'ref')
})

test('CV-156：modeByPictureCount 是数量→模式的唯一映射', () => {
  assert.equal(modeByPictureCount(0), 'T2VA')
  assert.equal(modeByPictureCount(1), 'I2VA')
  assert.equal(modeByPictureCount(2), 'FL2VA')
  assert.equal(modeByPictureCount(3), 'Ref2VA')
  assert.equal(modeByPictureCount(6), 'Ref2VA')
})

test('CV-156：六段式 IR 按 2 图（FL2VA）预检 → 报错点出「模式选错」并给两步走方案', () => {
  // 这正是实测踩到的形态：Agent 以「风格参考 + 首帧」语义（Ref2VA）写六段式，
  // 传 2 张图 → 工具按数量解成 FL2VA → 一堆段名/对齐行 ERROR。
  assert.throws(
    () => assertH3IrPrompt(A3.ir_output, { mode: 'FL2VA', duration: 5, pictures: 2 }),
    (err) => {
      assert.ok(err.message.includes('模式选错'), '应点出真因是模式选错')
      assert.ok(err.message.includes('pictures=2'), '应回显数量上下文')
      assert.ok(err.message.includes('Ref2VA'), '应说明作者写的是 Ref2VA 六段式')
      assert.ok(err.message.includes('六段式'), '应点出作者用的是六段式模板')
      assert.ok(err.message.includes('FL2VA'), '应说明工具判成了什么模式')
      assert.ok(err.message.includes('两步'), '应给出拆两步的正解')
      return true
    },
  )
})

test('CV-156：三段式 IR 按 ≥3 图（Ref2VA）预检 → 指引改六段式或减图', () => {
  assert.throws(
    () => assertH3IrPrompt(A1.ir_output, { mode: 'Ref2VA', duration: 10, pictures: 3 }),
    (err) => {
      assert.ok(err.message.includes('模式选错'))
      assert.ok(err.message.includes('Ref2VA'), '应说明工具判成了 Ref2VA')
      assert.ok(err.message.includes('subject_definitions'), '应给出六段式段名清单')
      assert.ok(err.message.includes('≤2 张'), '应给出「减图」这条出路')
      return true
    },
  )
})

test('CV-156：模式与模板一致时不产生错位提示（防噪音）', () => {
  assert.equal(irModeMismatchHint('T2VA', 'base'), null)
  assert.equal(irModeMismatchHint('FL2VA', 'base'), null)
  assert.equal(irModeMismatchHint('Ref2VA', 'ref'), null)
  assert.equal(irModeMismatchHint('FL2VA', null), null, '纯粹非 IR 文本不应有提示')
  assert.equal(typeof irModeMismatchHint('FL2VA', 'ref', 2), 'string')
})

test('CV-156：工具描述必须写死位次，且数量→模式文案只有一份权威', () => {
  const tools = readFileSync(join(HERE, '..', 'lib', 'host-tools.js'), 'utf8')
  const ir = readFileSync(join(HERE, '..', 'lib', 'h3-ir-validate.js'), 'utf8')
  // 位次说明必须落在工具描述里（否则 Agent 只能靠猜「2 图是什么模式」）
  assert.ok(tools.includes('顺序即语义与位次'), 'video_composite 的 filenames 描述应写死位次映射')
  assert.ok(tools.includes('本工具只有这一个图片位次'), 'video_generate 的 filename 描述应说明只有一个图片位次')
  // 数量→模式的文案只允许 COUNT_MODE_HINT 一处权威，工具描述靠引用而非抄一遍
  assert.ok(tools.includes('COUNT_MODE_HINT'), '工具描述应引用 COUNT_MODE_HINT 常量，不要复制粘贴映射文案')
  assert.ok(ir.includes('1 图 = 首帧 I2VA'), 'COUNT_MODE_HINT 应在 h3-ir-validate 里定义')
})

// ---------------- CV-156 ③：irMode 显式声明（fail-fast 模式核对） ----------------

test('CV-156 ③：声明与位次一致 → 按声明模式正常校验放行', () => {
  assertPasses(A2.ir_output, { mode: 'I2VA', duration: A2.duration, pictures: 1, declaredMode: 'I2VA' })
  assertPasses(A1.ir_output, { mode: 'T2VA', duration: A1.duration, declaredMode: 'T2VA' })
  const a3Counts = materialCounts(A3)
  assertPasses(A3.ir_output, { mode: 'Ref2VA', duration: A3.duration, pictures: a3Counts.image_url, videos: a3Counts.video_url, audios: a3Counts.audio_url, declaredMode: 'Ref2VA' })
})

test('CV-156 ③：声明与位次不一致 → fail-fast 报「模式声明不一致」，语义级报错而非派生 ERROR', () => {
  // 2 图按位次 = FL2VA，却声明 I2VA ——「把风格参考当首帧」的典型误用。
  // 旧路径下这会走完校验器、报出 K1 对齐行句式不符等派生 ERROR；现在应立即拦截。
  assert.throws(
    () => assertH3IrPrompt(A2.ir_output, { mode: 'FL2VA', duration: 5, pictures: 2, declaredMode: 'I2VA' }),
    (err) => {
      assert.ok(err.message.includes('irMode=I2VA'), '应回显声明值')
      assert.ok(err.message.includes('FL2VA'), '应说明按位次判成了什么')
      assert.ok(err.message.includes('两步走'), '应给「风格参考 + 首帧两步走」出路')
      assert.ok(err.message.includes('端点由素材数量决定'), '应说明声明改变不了路由')
      return true
    },
  )
  // 反向：1 图声明 Ref2VA 同样拦（位次语义反了）
  assert.throws(
    () => assertH3IrPrompt(A3.ir_output, { mode: 'I2VA', duration: 5, pictures: 1, declaredMode: 'Ref2VA' }),
    (err) => err.message.includes('irMode=Ref2VA') && err.message.includes('I2VA'),
  )
})

test('CV-156 ③：纯文本提示词不受 irMode 影响（声明只对 IR 生效）', () => {
  assertPasses('一只猫在雨夜的街道上慢慢走，镜头缓缓推近。', { mode: 'T2VA', duration: 5, declaredMode: 'Ref2VA' })
})

// ---------------- CV-196：先修后拦（prepareH3IrPrompt） ----------------

/** 取官方样本的预检入参（与闸门同一套素材计数）。 */
function optsOf(pair) {
  const counts = materialCounts(pair)
  return {
    mode: pair.mode,
    duration: pair.duration,
    pictures: counts.image_url,
    videos: counts.video_url,
    audios: counts.audio_url,
  }
}

test('CV-196：纯文本 prompt 不经修复原样返回', () => {
  const plain = '一只猫在雨夜的街道上慢慢走，镜头缓缓推近。'
  const p = prepareH3IrPrompt(plain, { mode: 'T2VA', duration: 5 })
  assert.equal(p.text, plain)
  assert.deepEqual(p.repairs, [])
})

test('CV-196：围栏包裹的官方 IR → 剥围栏后放行，修复项透明', () => {
  const wrapped = '```yaml\n' + A2.ir_output + '\n```'
  const opts = optsOf(A2)
  assert.throws(() => assertH3IrPrompt(wrapped, opts), /S6/, '修复前围栏应被拦')
  const p = prepareH3IrPrompt(wrapped, opts)
  assert.ok(p.repairs.some((r) => r.includes('围栏')))
  assertPasses(p.text, opts)
})

test('CV-196：六段式段间缺空行 → 归一后放行（S5）', () => {
  const opts = optsOf(A3)
  const squeezed = A3.ir_output.replace(/\n\n+/g, '\n')
  assert.throws(() => assertH3IrPrompt(squeezed, opts), /S5/, '修复前缺空行应被拦')
  const p = prepareH3IrPrompt(squeezed, opts)
  assert.ok(p.repairs.length > 0)
  assertPasses(p.text, opts)
})

test('CV-196：段序错乱 → 归一后放行（S2）', () => {
  const opts = optsOf(A3)
  // 把 non_diegetic_music 段搬到最前（破坏规范段序），修复层应搬回末尾。
  const idx = A3.ir_output.indexOf('non_diegetic_music:')
  assert.ok(idx > 0)
  const music = A3.ir_output.slice(idx).trim()
  const head = A3.ir_output.slice(0, idx).replace(/\n+$/, '')
  const shuffled = music + '\n\n' + head
  assert.throws(() => assertH3IrPrompt(shuffled, opts), /段顺序/, '修复前段序错乱应被拦')
  const p = prepareH3IrPrompt(shuffled, opts)
  assert.ok(p.repairs.some((r) => r.includes('段顺序归一')))
  assertPasses(p.text, opts)
})

test('CV-196：I2VA 对齐行变形 → 重建唯一合法形态后放行（K1）', () => {
  const opts = optsOf(A2)
  const broken = A2.ir_output.replace(/^For the target video,[^\n]*/m, 'For the target video, the first picture is fully referenced.')
  assert.throws(() => assertH3IrPrompt(broken, opts), /对齐行/, '修复前变形对齐行应被拦')
  const p = prepareH3IrPrompt(broken, opts)
  assert.ok(p.repairs.some((r) => r.includes('重建 I2VA 对齐行')))
  assertPasses(p.text, opts)
})

test('CV-196：I2VA 缺对齐行 → 前置补齐后放行（K1）', () => {
  const opts = optsOf(A2)
  const noAlign = A2.ir_output.replace(/^For the target video,[^\n]*\n\n/m, '')
  assert.notEqual(noAlign, A2.ir_output)
  assert.throws(() => assertH3IrPrompt(noAlign, opts), /对齐行/, '修复前缺对齐行应被拦')
  const p = prepareH3IrPrompt(noAlign, opts)
  assert.ok(p.repairs.some((r) => r.includes('补齐 I2VA 对齐行')))
  assertPasses(p.text, opts)
})

test('CV-196：FL2VA 对齐行时间与时长不符 → 按 duration 重写后放行（K4）', () => {
  // 官方 fixtures 无 FL2VA 样本，用最小合法 FL2VA 合成（三段 + 对齐行）。
  const fl2va =
    'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 8.00-second mark of the target video.\n\n'
    + 'integrated_multimodal_description: [Shot 1] A held shot of a quiet street at dusk.\n'
    + 'overall_soundscape: Wind.\n'
    + 'non_diegetic_music: N/A'
  const opts = { mode: 'FL2VA', duration: 8, pictures: 2 }
  assertPasses(fl2va, opts)
  const wrong = fl2va.replace('aligns with the 8.00-second mark', 'aligns with the 9.99-second mark')
  assert.notEqual(wrong, fl2va)
  assert.throws(() => assertH3IrPrompt(wrong, opts), /K4/, '修复前时间不符应被拦')
  const p = prepareH3IrPrompt(wrong, opts)
  assert.ok(p.repairs.some((r) => r.includes('K4')))
  assertPasses(p.text, opts)
})
