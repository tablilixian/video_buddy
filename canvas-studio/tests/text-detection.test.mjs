/**
 * CV-212 / **CV-218**：含文字 prompt 的自动 image_fix 链路 —— 单测 + 接线守卫。
 *
 * CV-218 的核心断言是「**原 prompt 直通**」：修复 prompt 不再是字符清单，而是从
 * 原始出图 prompt 里抽出的「文字规格段 + 逐字约束段」。真实性依据见
 * `docs/api-probe/image2fix-20260920-text-spec/`（正例：8 处错字全对、排版零漂移）。
 *
 * 夹具 `fixtures/text-spec/` 里放的是**该正例的原文与人工确认过的目标修复 prompt**。
 * 最强的两条断言：
 *   - `buildTextFixPrompt(原文)` 必须与人工确认的目标 prompt **逐行完全一致**；
 *   - `host-tools.ts` 必须把 `a.prompt` 真的传进 `runTextAutoFix`（否则抽取逻辑
 *     再对也是死代码 —— 本仓反复出现过的「判定对了但没接 = 等于没做」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  hasNonAscii,
  extractQuotedText,
  shouldAutoFixText,
  buildTextFixPrompt,
  extractTextSpec,
  DEFAULT_TEXT_CONSTRAINT,
} from '../lib/text-detection.js'

const readFixture = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const ORIGINAL_POSTER = readFixture('./fixtures/text-spec/original-poster.txt').trim()
const EXPECTED_FIX = readFixture('./fixtures/text-spec/expected-fix.txt').trim()

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
/** 剥块注释 + 整行注释（不剥行内，免吃掉 `https://`）。 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
const HOST_TOOLS_CODE = codeOnly(readSource('../src/host-tools.ts'))

test('hasNonAscii: 纯 ASCII / 中文 / 日文 / 韩文 / 阿拉伯 / 重音拉丁', () => {
  assert.equal(hasNonAscii('Hello SALE 2024'), false)
  assert.equal(hasNonAscii(''), false)
  assert.equal(hasNonAscii('中文测试'), true)
  assert.equal(hasNonAscii('日本語テスト'), true)
  assert.equal(hasNonAscii('한국어'), true)
  assert.equal(hasNonAscii('العربية'), true)
  assert.equal(hasNonAscii('café résumé'), true) // 重音拉丁
  assert.equal(hasNonAscii('Привет'), true) // 西里尔
})

test('extractQuotedText: 双引号 / 中文双引号 / 日文方括号 / 书名号', () => {
  assert.deepEqual(
    extractQuotedText('把标题 "SUMMER SALE" 居中，副标题 "限时优惠"'),
    ['SUMMER SALE', '限时优惠'],
  )
  assert.deepEqual(
    extractQuotedText('标题 "SALE"，下方文字「新品上市」'),
    ['SALE', '新品上市'],
  )
  assert.deepEqual(
    extractQuotedText('"Hello" 『世界』 《2024》'),
    ['Hello', '世界', '2024'],
  )
  assert.deepEqual(extractQuotedText('一幅风景画，无文字'), [])
  assert.deepEqual(extractQuotedText("她说 hello, 没有引号"), [])
})

test('shouldAutoFixText: 全 ASCII 引号文本 → 不触发', () => {
  const r = shouldAutoFixText('画一张海报，标题 "SUMMER SALE"')
  assert.equal(r.needsFix, false)
  assert.deepEqual(r.quotedTexts, ['SUMMER SALE'])
})

test('shouldAutoFixText: 含中文 → 触发', () => {
  const r = shouldAutoFixText('画一张海报，标题 "限时特惠"')
  assert.equal(r.needsFix, true)
  assert.deepEqual(r.quotedTexts, ['限时特惠'])
})

test('shouldAutoFixText: 中英文混合 → 任一非 ASCII 即触发；quotedTexts 全部返回', () => {
  const r = shouldAutoFixText('标题 "SALE" 中文副标题 "新品上市"')
  assert.equal(r.needsFix, true)
  assert.deepEqual(r.quotedTexts, ['SALE', '新品上市'])
})

test('shouldAutoFixText: 引号文本去重 + 保序', () => {
  const r = shouldAutoFixText('"限时" 与 "限时" + "新品"')
  assert.equal(r.needsFix, true)
  assert.deepEqual(r.quotedTexts, ['限时', '新品'])
})

test('shouldAutoFixText: 无引号 → 不触发', () => {
  const r = shouldAutoFixText('画一张清新风格的咖啡海报')
  assert.equal(r.needsFix, false)
  assert.deepEqual(r.quotedTexts, [])
})

// ───────────────────────── CV-218：抽取层 ─────────────────────────

test('extractTextSpec: 正例原文 → 7 段文字规格 + 1 段逐字约束 + 11 个文字单元', () => {
  const spec = extractTextSpec(ORIGINAL_POSTER)
  assert.equal(spec.specLines.length, 7)
  assert.equal(spec.constraintLines.length, 1)
  assert.deepEqual(spec.renderableTexts, [
    '山见茶事',
    '春山一盏',
    '新茶初醒',
    '明前头采 · 高山云雾',
    '限定',
    '鲜叶当日采摘',
    '零添加蔗糖',
    '冷萃 8 小时',
    '首杯 ¥19 起',
    '开业限定 9.17 - 9.30',
    '青石巷 27 号',
  ])
})

test('extractTextSpec: 美术描述句必须被滤掉（画幅 / 材质 / 光线 / 配色 / 气质）', () => {
  const spec = extractTextSpec(ORIGINAL_POSTER)
  const joined = spec.specLines.join('\n')
  for (const noise of ['宣纸底纹', '纤维纸纹', '正视角', '透视变形', '正面平光', '视野', '印刷品级', '清雅、克制']) {
    assert.ok(!joined.includes(noise), `美术描述句混进了规格段：${noise}`)
  }
  // 反向：文字规格句必须在（否则上面那组断言可能因为「什么都没抽到」而假绿）
  assert.ok(joined.includes('顶部横向居中一行细黑体品牌名「山见茶事」'))
  assert.ok(joined.includes('底部为价格与活动信息'))
})

test('extractTextSpec: 占位元素句必须保留（丢了模型会把占位方框一起重绘掉）', () => {
  const spec = extractTextSpec(ORIGINAL_POSTER)
  const joined = spec.specLines.join('\n')
  assert.ok(joined.includes('右下角一个正方形细线空白方框，作为二维码占位'))
})

test('extractTextSpec: 被否定的引号文本不进 renderableTexts', () => {
  const spec = extractTextSpec('画一张海报，不要"水墨"风格')
  assert.deepEqual(spec.renderableTexts, [])
  // 反向：非否定语境下的同一个词必须留下 —— 否则「一律丢弃」也能让上面那条变绿
  const keep = extractTextSpec('画一张海报，"水墨"风格')
  assert.deepEqual(keep.renderableTexts, ['水墨'])
})

test('extractTextSpec: 同一句里否定与正常引号并存 → 正常的仍被采纳', () => {
  const spec = extractTextSpec('不要「水墨」风格，标题用「春山一盏」')
  assert.deepEqual(spec.renderableTexts, ['春山一盏'])
  assert.equal(spec.specLines.length, 1)
})

test('shouldAutoFixText: 引号只框住风格词（否定语境）→ 不触发', () => {
  const r = shouldAutoFixText('画一张海报，不要"水墨"风格')
  assert.equal(r.needsFix, false)
})

test('shouldAutoFixText: 否定句 + 正常文字句 → 仍要触发（防漏修）', () => {
  const r = shouldAutoFixText('不要「水墨」风格，标题用「春山一盏」，副标题 "SALE"')
  assert.equal(r.needsFix, true)
})

// ───────────────────────── CV-218：构造层 ─────────────────────────

test('buildTextFixPrompt: 正例原文 → 与人工确认的目标修复 prompt 逐行完全一致', () => {
  const built = buildTextFixPrompt(ORIGINAL_POSTER)
  assert.equal(built, EXPECTED_FIX)
})

test('buildTextFixPrompt: 不得再出现旧模板的开场祈使句与 bullet 清单形态', () => {
  const built = buildTextFixPrompt(ORIGINAL_POSTER)
  assert.ok(!built.includes('确保画面中以下文字字符正确渲染'))
  assert.ok(!built.includes('保持原字体、字号、颜色、位置不变'))
  // 逐字约束必须在（正例里它是末尾那段）
  assert.ok(built.endsWith('最小的字号也必须清晰可读。'))
})

test('buildTextFixPrompt: 短句也走原句直通（保留「居中」这类位置词，比字符清单更有锚点）', () => {
  const p = buildTextFixPrompt('画一张海报，标题写着"限时特惠"，居中')
  assert.match(p, /限时特惠/)
  assert.match(p, /居中/)
  assert.ok(!p.includes('保持原字体、字号、颜色、位置不变'), '不得再退回字符清单形态')
  assert.ok(p.includes(DEFAULT_TEXT_CONSTRAINT), '原文没写逐字约束时须补兜底约束')
})

test('buildTextFixPrompt: 无引号无约束 → 空串', () => {
  assert.equal(buildTextFixPrompt(''), '')
  assert.equal(buildTextFixPrompt('一幅干净的水彩风景，无文字'), '')
})

test('DEFAULT_TEXT_CONSTRAINT: 逐字还原约束必须覆盖「替换 / 增删 / 乱码」三类风险', () => {
  assert.match(DEFAULT_TEXT_CONSTRAINT, /逐字准确还原/)
  assert.match(DEFAULT_TEXT_CONSTRAINT, /不得替换、增删、乱码/)
})

// ───────────────────────── CV-218：接线守卫 ─────────────────────────

test('接线：runTextAutoFix 必须收下原 prompt，并从它构造修复 prompt', () => {
  assert.match(HOST_TOOLS_CODE, /async function runTextAutoFix\([\s\S]*?originalPrompt: string/)
  assert.match(HOST_TOOLS_CODE, /buildTextFixPrompt\(originalPrompt\)/)
})

test('接线：image_generate 调用点必须把 a.prompt 传进去（漏传 = 退回字符清单形态）', () => {
  assert.match(
    HOST_TOOLS_CODE,
    /runTextAutoFix\(registry, projectId, port, result, a\.prompt, decision\.quotedTexts/,
  )
})
