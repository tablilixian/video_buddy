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

// ---------------- CV-236：素材标签编号连续性降为「只提示、不阻断」 ----------------

/**
 * 官方样本里唯一的 Ref2VA（六段式）那组 —— 但它是**剪辑**样本：素材是
 * `<Video 1>` + `<Audio N>`，**一个 `<Picture N>` 都没有**（实测 2026-09-24）。
 *
 * 所以不能「改名」造样本：把 `<Video 1>` 整体换成 `<Picture N>` 会连带撞两条无关规则
 * —— R15（`video editing` 的 summary 固定首句必须引用 `<Video 1>`）与音频上限
 * （`<Audio 2>` 的上限 = 输入音频 + **视频同步轨**，视频没了上限就掉到 1）。
 * 改用**追加**：只在 `<Subject 1>` 的定义句尾多一句 Picture 出处，其余段一字不动。
 * （`<Subject N>` 里 inline 注明出处本来就是技能分册允许的写法，见 format-ref2va.md。）
 */
const REF_SAMPLE = OFFICIAL_IR.find((pair) => pair.mode === 'Ref2VA')
const REF_ANCHOR = 'holding a small black lamb in his arms in <Video 1>.'

/** 官方 Ref2VA 样本 + `n` 号 Picture 引用（其余一字不动）。 */
function refSampleWithPicture(n) {
  const injected = REF_SAMPLE.ir_output.replace(
    REF_ANCHOR,
    `${REF_ANCHOR.replace(/\.$/, '')}, and the lamb also appears in <Picture ${n}>.`,
  )
  assert.notEqual(injected, REF_SAMPLE.ir_output, '注入锚点句在官方样本里找不到了 —— fixture 形状变了')
  return injected
}

/** 该样本的预检入参；`pictures` 由调用方给（要隔离「连续性」与「越界」两条判据）。 */
function refOpts(pictures) {
  const counts = materialCounts(REF_SAMPLE)
  return {
    mode: 'Ref2VA',
    duration: REF_SAMPLE.duration,
    pictures,
    ...(counts.video_url > 0 ? { videos: counts.video_url } : {}),
    ...(counts.audio_url > 0 ? { audios: counts.audio_url } : {}),
  }
}

test('CV-236：派生的 Ref2VA 样本本身合法（后续用例的前提）', () => {
  // 与「漏段」用例同款的前置断言：前提不成立要**指出 fixture 形状变了**，
  // 而不是让下游断言以看不懂的方式红。
  assert.ok(REF_SAMPLE !== undefined, 'official_ir.json 里应有一个 Ref2VA 样本')
  assert.match(REF_SAMPLE.ir_output, new RegExp(REF_ANCHOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '注入锚点句不在样本里')
  assertPasses(refSampleWithPicture(1), refOpts(1))
})

test('CV-236：编号跳号只出提示、不阻断生成（原为 ERROR）', () => {
  // 只用 `4` 号、且上限正好是 4 ⇒ 只有「不连续」这一条会响，越界那条不参与
  // （否则一次断言里混着两条判据，谁也说不清是哪条在起作用）。
  const notes = assertH3IrPrompt(refSampleWithPicture(4), refOpts(4))
  // 不抛 = 不阻断（这正是用户拍板的点：别再为「记账不齐」掐断一次生成）。
  assert.ok(notes.some((n) => n.includes('[R7]')), `应给出 R7 提示，实际：${JSON.stringify(notes)}`)
  assert.ok(notes.some((n) => n.includes('<Picture 1>')), '提示要点名缺哪一号（模型下一轮才能自纠）')
  assert.ok(notes.some((n) => n.includes('不影响本次生成')), '提示要讲清不阻断')
})

test('CV-236 反向对照：引用了不存在的素材仍是 ERROR（降级只针对「不连续」）', () => {
  // 只传 4 张却在简报里引用第 5 张 —— 这是**真矛盾**（那张图不存在），不是记账不齐。
  assert.throws(() => assertH3IrPrompt(refSampleWithPicture(5), refOpts(4)), /R7[\s\S]*超出输入的 Picture 数量/, '越界必须仍被拦下')
})

test('CV-236：预检提示必须并进 result.warnings（否则「只提示」等于没提示）', () => {
  // 这是接线守卫：返回值被丢掉时，用户与模型都看不到那句「不影响本次生成」，
  // 而 WARN 又不会抛错 ⇒ 表现为**静默**，比原来报错更糟。
  const tools = readFileSync(join(HERE, '..', 'lib', 'host-tools.js'), 'utf8')
  const caught = tools.match(/const irNotes = assertH3IrPrompt\(/g) ?? []
  assert.equal(caught.length, 2, 'video_generate 与 video_composite 都必须接住 assertH3IrPrompt 的返回值')
  assert.ok(tools.includes('...irNotes'), '返回值必须并进 warnings 数组（result.warnings）')
})
